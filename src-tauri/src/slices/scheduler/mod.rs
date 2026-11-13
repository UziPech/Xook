use crate::ai_vault;
use crate::slices::task_ledger::{
    commands::{LEDGER_UPDATED_EVENT, REVIEW_UPDATED_EVENT, WORKSPACE_UPDATED_EVENT},
    inventory,
    migrations::open_workspace_db,
    store,
};
use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

pub const AGENDA_DUE_EVENT: &str = "agenda:due-reminder";
pub const TIMER_EXPIRED_EVENT: &str = "agenda:timer-expired";
pub const DATOS_CHANGED_EVENT: &str = "workspace:datos-changed";

static LAST_INTERNAL_DATOS_WRITE_MS: AtomicI64 = AtomicI64::new(0);

pub fn mark_internal_datos_write() {
    LAST_INTERNAL_DATOS_WRITE_MS.store(Utc::now().timestamp_millis(), Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueAgendaNotice {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub time_label: String,
    pub auto_scheduled: bool,
}

#[derive(Debug, Clone)]
pub struct AutomationTickSummary {
    pub expired_timers: Vec<DueAgendaNotice>,
    pub due_agenda_items: Vec<DueAgendaNotice>,
    pub should_run_scheduled_review: bool,
}

fn compute_next_run_iso(current: DateTime<Utc>, rule_hint: Option<&str>) -> Option<String> {
    let lower = rule_hint.unwrap_or("").trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "una vez" || lower == "unico" || lower == "único" {
        return None;
    }
    let delta = if lower.contains("hora") || lower.contains("hourly") {
        ChronoDuration::hours(1)
    } else if lower.contains("seman") || lower.contains("weekly") {
        ChronoDuration::days(7)
    } else if lower.contains("mensual") || lower.contains("mes") || lower.contains("monthly") {
        ChronoDuration::days(30)
    } else {
        // Por defecto "diario" / "automática" / regla recurrente diaria
        ChronoDuration::days(1)
    };
    Some((current + delta).to_rfc3339())
}

pub fn advance_due_agenda_and_timers(
    conn: &mut Connection,
    now: DateTime<Utc>,
) -> Result<AutomationTickSummary, String> {
    let now_iso = now.to_rfc3339();
    let mut expired_timers = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, time_label, auto_scheduled
                 FROM agenda_items
                 WHERE kind = 'timer' AND is_running = 1 AND ends_at IS NOT NULL AND ends_at <= ?1",
            )
            .map_err(|e| format!("Error consultando timers vencidos: {e}"))?;
        let rows = stmt
            .query_map(params![now_iso], |row| {
                Ok(DueAgendaNotice {
                    id: row.get(0)?,
                    kind: "timer".to_string(),
                    title: row.get(1)?,
                    time_label: row.get(2)?,
                    auto_scheduled: row.get::<_, i64>(3)? != 0,
                })
            })
            .map_err(|e| format!("Error iterando timers vencidos: {e}"))?;
        for r in rows.flatten() {
            expired_timers.push(r);
        }
    }

    if !expired_timers.is_empty() {
        let _ = store::list_agenda_items_at(conn, now);
    }

    let mut due_agenda_items = Vec::new();
    let mut recurrence_hints: Vec<(String, Option<String>)> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, title, time_label, auto_scheduled, recurrence, schedule_cron_or_rule
                 FROM agenda_items
                 WHERE kind IN ('alarm', 'recurring')
                   AND next_run_at IS NOT NULL
                   AND TRIM(next_run_at) != ''
                   AND next_run_at <= ?1",
            )
            .map_err(|e| format!("Error consultando agenda vencida: {e}"))?;
        let rows = stmt
            .query_map(params![now_iso], |row| {
                let id: String = row.get(0)?;
                let kind: String = row.get(1)?;
                let title: String = row.get(2)?;
                let time_label: String = row.get(3)?;
                let auto_scheduled = row.get::<_, i64>(4)? != 0;
                let rec: Option<String> = row.get(5)?;
                let rule: Option<String> = row.get(6)?;
                Ok((
                    DueAgendaNotice {
                        id,
                        kind,
                        title,
                        time_label,
                        auto_scheduled,
                    },
                    rec.or(rule),
                ))
            })
            .map_err(|e| format!("Error iterando agenda vencida: {e}"))?;
        for item in rows.flatten() {
            recurrence_hints.push((item.0.id.clone(), item.1));
            due_agenda_items.push(item.0);
        }
    }

    let mut should_run_scheduled_review = false;
    for (idx, notice) in due_agenda_items.iter().enumerate() {
        let hint = recurrence_hints.get(idx).and_then(|(_, h)| h.as_deref());
        let next_iso = compute_next_run_iso(now, hint);
        conn.execute(
            "UPDATE agenda_items SET next_run_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![notice.id, next_iso, now_iso],
        )
        .map_err(|e| format!("Error reprogramando agenda '{}': {e}", notice.id))?;
        if notice.auto_scheduled {
            should_run_scheduled_review = true;
        }
    }

    Ok(AutomationTickSummary {
        expired_timers,
        due_agenda_items,
        should_run_scheduled_review,
    })
}

fn is_relevant_datos_event(ev: &Event) -> Option<PathBuf> {
    match ev.kind {
        EventKind::Create(_) | EventKind::Modify(_) => {}
        _ => return None,
    }
    for path in &ev.paths {
        let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if fname.starts_with('.') || fname.contains(".tmp.") {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if matches!(ext.to_ascii_lowercase().as_str(), "csv" | "tsv" | "json") {
            return Some(path.clone());
        }
    }
    None
}

pub fn start_background_automation<R: Runtime>(app: AppHandle<R>) {
    // 1. Watcher de datos/ en thread dedicado con debounce
    let watcher_app = app.clone();
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let Ok(mut watcher) = RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            notify::Config::default(),
        ) else {
            return;
        };

        let mut watched_datos_dir: Option<PathBuf> = None;

        loop {
            let desired_datos = resolve_active_workspace_root(&watcher_app).map(|r| r.join("datos"));
            if desired_datos != watched_datos_dir {
                if let Some(old) = watched_datos_dir.take() {
                    let _ = watcher.unwatch(&old);
                }
                if let Some(ref next_dir) = desired_datos {
                    if next_dir.is_dir() && watcher.watch(next_dir, RecursiveMode::Recursive).is_ok() {
                        watched_datos_dir = Some(next_dir.clone());
                    }
                }
            }

            match rx.recv_timeout(Duration::from_secs(3)) {
                Ok(Ok(event)) => {
                    let Some(changed_path) = is_relevant_datos_event(&event) else {
                        continue;
                    };
                    // Debounce ~1.1s para agrupar escrituras seguidas
                    std::thread::sleep(Duration::from_millis(1100));
                    while let Ok(_) = rx.try_recv() {}

                    let now_ms = Utc::now().timestamp_millis();
                    let last_self = LAST_INTERNAL_DATOS_WRITE_MS.load(Ordering::Relaxed);
                    if now_ms.saturating_sub(last_self) < 2500 {
                        continue;
                    }

                    if let Some(root) = resolve_active_workspace_root(&watcher_app) {
                        if let Ok(mut conn) = open_workspace_db(&root) {
                            let script = ai_vault::find_sidecar_script(&watcher_app).ok();
                            if let Ok(res) = inventory::execute_workspace_review(
                                &mut conn,
                                &root,
                                "datos_watcher",
                                script.as_ref(),
                                Utc::now(),
                            ) {
                                let rel = changed_path
                                    .strip_prefix(&root)
                                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                                    .unwrap_or_else(|_| "datos/".to_string());
                                let _ = watcher_app.emit(
                                    DATOS_CHANGED_EVENT,
                                    serde_json::json!({
                                        "path": rel,
                                        "summary": res.summary,
                                        "newTasksCount": res.new_tasks_count,
                                    }),
                                );
                                let _ = watcher_app.emit(REVIEW_UPDATED_EVENT, &res);
                                let _ = watcher_app.emit(
                                    LEDGER_UPDATED_EVENT,
                                    serde_json::json!({ "scope": "tasks" }),
                                );
                                let _ = watcher_app.emit(
                                    WORKSPACE_UPDATED_EVENT,
                                    serde_json::json!({ "reason": "datos_watcher" }),
                                );
                            }
                        }
                    }
                }
                Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    // 2. Loop Tokio cada 30s para agenda y timers
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Evitar corrida doble en segundo 0 de arranque
        ticker.tick().await;

        loop {
            ticker.tick().await;
            let app_clone = app.clone();
            let _ = tokio::task::spawn_blocking(move || {
                let Some(root) = resolve_active_workspace_root(&app_clone) else {
                    return;
                };
                let Ok(mut conn) = open_workspace_db(&root) else {
                    return;
                };
                let Ok(summary) = advance_due_agenda_and_timers(&mut conn, Utc::now()) else {
                    return;
                };

                for timer in &summary.expired_timers {
                    let _ = app_clone.emit(TIMER_EXPIRED_EVENT, timer);
                }
                for notice in &summary.due_agenda_items {
                    let _ = app_clone.emit(AGENDA_DUE_EVENT, notice);
                }
                if !summary.expired_timers.is_empty() || !summary.due_agenda_items.is_empty() {
                    let _ = app_clone.emit(
                        LEDGER_UPDATED_EVENT,
                        serde_json::json!({ "scope": "agenda" }),
                    );
                }
                if summary.should_run_scheduled_review {
                    let script = ai_vault::find_sidecar_script(&app_clone).ok();
                    if let Ok(res) = inventory::execute_workspace_review(
                        &mut conn,
                        &root,
                        "scheduled",
                        script.as_ref(),
                        Utc::now(),
                    ) {
                        let _ = app_clone.emit(REVIEW_UPDATED_EVENT, &res);
                        let _ = app_clone.emit(
                            LEDGER_UPDATED_EVENT,
                            serde_json::json!({ "scope": "tasks" }),
                        );
                        let _ = app_clone.emit(
                            WORKSPACE_UPDATED_EVENT,
                            serde_json::json!({ "reason": "scheduled_review" }),
                        );
                    }
                }
            })
            .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::task_ledger::store::{UpsertAgendaItemPayload, upsert_agenda_item_at};
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;
    use std::fs;

    #[test]
    fn scheduler_detects_expired_timers_and_advances_recurring_agenda() {
        let root = std::env::temp_dir().join(format!(
            "xook_sched_test_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&root).unwrap();
        scaffold_workspace_dir(&root, "ws_s", "Sched").unwrap();
        let mut conn = open_workspace_db(&root).unwrap();
        let now = Utc::now();

        // Timer vencido hace 10s
        upsert_agenda_item_at(
            &mut conn,
            UpsertAgendaItemPayload {
                id: "tm_due".to_string(),
                kind: "timer".to_string(),
                title: "Café listo".to_string(),
                subtitle: None,
                time_label: "01:00".to_string(),
                recurrence: None,
                auto_scheduled: false,
                duration_seconds: Some(60),
                remaining_seconds: Some(60),
                ends_at: Some((now - ChronoDuration::seconds(10)).to_rfc3339()),
                is_running: true,
                note_content: None,
                checklist: None,
                tags: None,
                schedule_cron_or_rule: None,
                next_run_at: None,
                created_at: None,
            },
            false,
            now - ChronoDuration::seconds(70),
        )
        .unwrap();

        // Revisión recurrente vencida hace 1 minuto
        upsert_agenda_item_at(
            &mut conn,
            UpsertAgendaItemPayload {
                id: "ag_rec".to_string(),
                kind: "recurring".to_string(),
                title: "Revisión diaria de inventario".to_string(),
                subtitle: None,
                time_label: "09:00 hrs".to_string(),
                recurrence: Some("Diario".to_string()),
                auto_scheduled: true,
                duration_seconds: None,
                remaining_seconds: None,
                ends_at: None,
                is_running: false,
                note_content: None,
                checklist: None,
                tags: None,
                schedule_cron_or_rule: Some("Diario".to_string()),
                next_run_at: Some((now - ChronoDuration::seconds(60)).to_rfc3339()),
                created_at: None,
            },
            false,
            now - ChronoDuration::hours(2),
        )
        .unwrap();

        let summary = advance_due_agenda_and_timers(&mut conn, now).unwrap();
        assert_eq!(summary.expired_timers.len(), 1);
        assert_eq!(summary.expired_timers[0].id, "tm_due");
        assert_eq!(summary.due_agenda_items.len(), 1);
        assert!(summary.should_run_scheduled_review);

        // Siguiente corrida inmediata no debe volver a disparar ni timer ni agenda (reprogramada a +1 día)
        let second = advance_due_agenda_and_timers(&mut conn, now).unwrap();
        assert_eq!(second.expired_timers.len(), 0);
        assert_eq!(second.due_agenda_items.len(), 0);
        assert!(!second.should_run_scheduled_review);

        let _ = fs::remove_dir_all(&root);
    }
}

