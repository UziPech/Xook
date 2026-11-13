use super::migrations::open_workspace_db;
use crate::slices::workspace_manager::commands::append_decision_jsonl;
use chrono::{DateTime, Duration as ChronoDuration, Local, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLedgerRecord {
    pub card_id: String,
    pub dedup_key: Option<String>,
    pub review_run_id: Option<String>,
    pub title: String,
    pub category: String,
    pub urgency: String,
    pub status: String,
    pub proposal: Value,
    pub staging_payload: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTaskPayload {
    pub proposal: Value,
    #[serde(default)]
    pub dedup_key: Option<String>,
    #[serde(default)]
    pub review_run_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub staging_payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaChecklistItemDto {
    pub id: String,
    #[serde(alias = "text")]
    pub label: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItemDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub time_label: String,
    pub recurrence: Option<String>,
    pub auto_scheduled: bool,
    pub duration_seconds: Option<i64>,
    pub remaining_seconds: Option<i64>,
    pub ends_at: Option<String>,
    pub is_running: bool,
    pub note_content: Option<String>,
    pub checklist: Option<Vec<AgendaChecklistItemDto>>,
    pub tags: Option<Vec<String>>,
    pub schedule_cron_or_rule: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at_label: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAgendaItemPayload {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    pub time_label: String,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub auto_scheduled: bool,
    #[serde(default)]
    pub duration_seconds: Option<i64>,
    #[serde(default)]
    pub remaining_seconds: Option<i64>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub is_running: bool,
    #[serde(default)]
    pub note_content: Option<String>,
    #[serde(default)]
    pub checklist: Option<Vec<AgendaChecklistItemDto>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub schedule_cron_or_rule: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionHistoryDto {
    pub id: String,
    pub task_card_id: Option<String>,
    pub agenda_item_id: Option<String>,
    pub title: String,
    pub category: String,
    pub decision: String,
    pub summary: String,
    pub amount_label: Option<String>,
    pub verified_cost: Option<f64>,
    pub currency: Option<String>,
    pub execution_artifact_path: Option<String>,
    pub notes: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: String,
    pub timestamp_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideTaskPayload {
    pub card_id: String,
    #[serde(default)]
    pub decision_id: Option<String>,
    pub title: String,
    pub category: String,
    pub decision: String, // "approved" | "adjusted" | "rejected"
    pub summary: String,
    #[serde(default)]
    pub amount_label: Option<String>,
    #[serde(default)]
    pub verified_cost: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub adjusted_qty: Option<f64>,
    #[serde(default)]
    pub execution_artifact_path: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub decided_by: Option<String>,
    #[serde(default)]
    pub updated_proposal: Option<Value>,
    #[serde(default)]
    pub promote_agenda_item: Option<UpsertAgendaItemPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideTaskResult {
    pub history_entry: DecisionHistoryDto,
    pub promoted_agenda_item: Option<AgendaItemDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordHistoryPayload {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub task_card_id: Option<String>,
    #[serde(default)]
    pub agenda_item_id: Option<String>,
    pub title: String,
    pub category: String,
    pub decision: String,
    pub summary: String,
    #[serde(default)]
    pub amount_label: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub decided_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAgendaPayload {
    pub agenda_item_id: String,
    #[serde(default)]
    pub decision_id: Option<String>,
    #[serde(default)]
    pub decided_by: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogEntryDto {
    pub id: i64,
    pub actor: String,
    pub action: String,
    pub target_path: String,
    pub zone: String,
    pub detail: Option<String>,
    pub created_at: String,
    pub timestamp_label: String,
}

fn parse_utc(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn format_local_short_label(iso_ts: &str, include_hoy_prefix: bool) -> String {
    let Some(utc_dt) = parse_utc(iso_ts) else {
        return iso_ts.to_string();
    };
    let local_dt = utc_dt.with_timezone(&Local);
    let today = Local::now().date_naive();
    let hm = local_dt.format("%H:%M").to_string();
    if local_dt.date_naive() == today {
        if include_hoy_prefix {
            format!("Hoy · {hm}")
        } else {
            hm
        }
    } else {
        format!("{} · {hm}", local_dt.format("%d/%m"))
    }
}

fn format_clock_mmss(total_seconds: i64) -> String {
    let safe = total_seconds.max(0);
    let hours = safe / 3600;
    let mins = (safe % 3600) / 60;
    let secs = safe % 60;
    if hours > 0 {
        format!("{hours:02}:{mins:02}:{secs:02}")
    } else {
        format!("{mins:02}:{secs:02}")
    }
}

fn proposal_intent_type(proposal: &Value) -> Option<&str> {
    proposal
        .get("intent")
        .and_then(|v| v.get("type"))
        .and_then(|v| v.as_str())
}

fn proposal_str_field(proposal: &Value, camel: &str, snake: &str) -> Option<String> {
    proposal
        .get(camel)
        .or_else(|| proposal.get(snake))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn is_ephemeral_secret_task(proposal: &Value) -> bool {
    proposal_intent_type(proposal) == Some("save_api_key")
}

fn compute_live_timer_state(
    ends_at: Option<&str>,
    fallback_remaining: Option<i64>,
    is_running: bool,
    now: DateTime<Utc>,
) -> (Option<i64>, bool, bool) {
    if !is_running {
        return (fallback_remaining, false, false);
    }
    let Some(end_str) = ends_at else {
        let secs = fallback_remaining.unwrap_or(0).max(0);
        return (Some(secs), secs > 0, secs == 0);
    };
    let Some(end_dt) = parse_utc(end_str) else {
        let secs = fallback_remaining.unwrap_or(0).max(0);
        return (Some(secs), secs > 0, secs == 0);
    };
    let diff_ms = (end_dt - now).num_milliseconds();
    if diff_ms <= 0 {
        (Some(0), false, true)
    } else {
        let secs = (diff_ms + 999) / 1000;
        (Some(secs), true, false)
    }
}

pub fn record_audit_event_conn(
    conn: &Connection,
    actor: &str,
    action: &str,
    target_path: &str,
    zone: &str,
    detail: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workspace_audit_log (actor, action, target_path, zone, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            actor,
            action,
            target_path,
            zone,
            detail,
            now.to_rfc3339(),
        ],
    )
    .map_err(|e| format!("No se pudo registrar auditoría en SQLite: {e}"))?;
    Ok(())
}

pub fn try_record_audit_event_for_root(
    workspace_root: &Path,
    actor: &str,
    action: &str,
    target_path: &str,
    zone: &str,
    detail: Option<&str>,
) {
    if let Ok(conn) = open_workspace_db(workspace_root) {
        let _ = record_audit_event_conn(
            &conn,
            actor,
            action,
            target_path,
            zone,
            detail,
            Utc::now(),
        );
    }
}

fn row_to_task(row: &Row) -> rusqlite::Result<TaskLedgerRecord> {
    let proposal_raw: String = row.get("proposal_json")?;
    let staging_raw: Option<String> = row.get("staging_payload_json")?;
    let proposal = serde_json::from_str::<Value>(&proposal_raw).unwrap_or(Value::Null);
    let staging_payload = staging_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok());

    Ok(TaskLedgerRecord {
        card_id: row.get("card_id")?,
        dedup_key: row.get("dedup_key")?,
        review_run_id: row.get("review_run_id")?,
        title: row.get("title")?,
        category: row.get("category")?,
        urgency: row.get("urgency")?,
        status: row.get("status")?,
        proposal,
        staging_payload,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn row_to_agenda_item(row: &Row, now: DateTime<Utc>) -> rusqlite::Result<(AgendaItemDto, bool)> {
    let id: String = row.get("id")?;
    let kind: String = row.get("kind")?;
    let title: String = row.get("title")?;
    let subtitle: Option<String> = row.get("subtitle")?;
    let stored_time_label: String = row.get("time_label")?;
    let recurrence: Option<String> = row.get("recurrence")?;
    let auto_scheduled: i64 = row.get("auto_scheduled")?;
    let duration_seconds: Option<i64> = row.get("duration_seconds")?;
    let fallback_remaining: Option<i64> = row.get("remaining_seconds")?;
    let raw_ends_at: Option<String> = row.get("ends_at")?;
    let raw_is_running: i64 = row.get("is_running")?;
    let note_content: Option<String> = row.get("note_content")?;
    let checklist_raw: Option<String> = row.get("checklist_json")?;
    let tags_raw: Option<String> = row.get("tags_json")?;
    let schedule_cron_or_rule: Option<String> = row.get("schedule_cron_or_rule")?;
    let next_run_at: Option<String> = row.get("next_run_at")?;
    let created_at: String = row.get("created_at")?;
    let updated_at: String = row.get("updated_at")?;

    let checklist = checklist_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<AgendaChecklistItemDto>>(s).ok());
    let tags = tags_raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok());

    let was_running = raw_is_running != 0;
    let (live_remaining, live_running, just_expired) = if kind == "timer" {
        compute_live_timer_state(raw_ends_at.as_deref(), fallback_remaining, was_running, now)
    } else {
        (fallback_remaining, was_running, false)
    };

    let ends_at = if live_running { raw_ends_at } else { None };
    let time_label = if kind == "timer" {
        if let Some(secs) = live_remaining {
            format_clock_mmss(secs)
        } else {
            stored_time_label
        }
    } else {
        stored_time_label
    };

    Ok((
        AgendaItemDto {
            id,
            kind,
            title,
            subtitle,
            time_label,
            recurrence,
            auto_scheduled: auto_scheduled != 0,
            duration_seconds,
            remaining_seconds: live_remaining,
            ends_at,
            is_running: live_running,
            note_content,
            checklist,
            tags,
            schedule_cron_or_rule,
            next_run_at,
            created_at_label: format_local_short_label(&created_at, true),
            created_at,
            updated_at,
        },
        just_expired,
    ))
}

fn row_to_history(row: &Row) -> rusqlite::Result<DecisionHistoryDto> {
    let decided_at: String = row.get("decided_at")?;
    Ok(DecisionHistoryDto {
        id: row.get("id")?,
        task_card_id: row.get("task_card_id")?,
        agenda_item_id: row.get("agenda_item_id")?,
        title: row.get("title")?,
        category: row.get("category")?,
        decision: row.get("decision")?,
        summary: row.get("summary")?,
        amount_label: row.get("amount_label")?,
        verified_cost: row.get("verified_cost")?,
        currency: row.get("currency")?,
        execution_artifact_path: row.get("execution_artifact_path")?,
        notes: row.get("notes")?,
        decided_by: row.get("decided_by")?,
        timestamp_label: format_local_short_label(&decided_at, false),
        decided_at,
    })
}

fn row_to_audit(row: &Row) -> rusqlite::Result<AuditLogEntryDto> {
    let created_at: String = row.get("created_at")?;
    Ok(AuditLogEntryDto {
        id: row.get("id")?,
        actor: row.get("actor")?,
        action: row.get("action")?,
        target_path: row.get("target_path")?,
        zone: row.get("zone")?,
        detail: row.get("detail")?,
        timestamp_label: format_local_short_label(&created_at, false),
        created_at,
    })
}

pub fn list_tasks(conn: &Connection, status_filter: Option<&str>) -> Result<Vec<TaskLedgerRecord>, String> {
    let normalized = status_filter
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("pending");

    if normalized == "all" {
        let mut stmt = conn
            .prepare(
                "SELECT card_id, dedup_key, review_run_id, title, category, urgency, status, proposal_json, staging_payload_json, created_at, updated_at
                 FROM tasks
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| format!("Error preparando consulta de tareas: {e}"))?;
        let rows = stmt
            .query_map([], row_to_task)
            .map_err(|e| format!("Error leyendo tareas: {e}"))?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando tareas: {e}"));
    }

    let mut stmt = conn
        .prepare(
            "SELECT card_id, dedup_key, review_run_id, title, category, urgency, status, proposal_json, staging_payload_json, created_at, updated_at
             FROM tasks
             WHERE status = ?1
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Error preparando consulta de tareas por estado: {e}"))?;
    let rows = stmt
        .query_map(params![normalized], row_to_task)
        .map_err(|e| format!("Error leyendo tareas por estado: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando tareas: {e}"))
}

pub fn upsert_tasks_batch(
    conn: &mut Connection,
    items: Vec<UpsertTaskPayload>,
    replace_pending: bool,
    now: DateTime<Utc>,
) -> Result<Vec<TaskLedgerRecord>, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de tareas: {e}"))?;
    let now_iso = now.to_rfc3339();

    if replace_pending {
        tx.execute("DELETE FROM tasks WHERE status = 'pending'", [])
            .map_err(|e| format!("Error reemplazando tareas pendientes: {e}"))?;
    }

    let mut inserted_ids: Vec<String> = Vec::new();
    for item in items {
        if is_ephemeral_secret_task(&item.proposal) {
            continue;
        }
        let card_id = proposal_str_field(&item.proposal, "cardId", "card_id")
            .ok_or_else(|| "La tarjeta de tarea no contiene un cardId válido.".to_string())?;
        let title = proposal_str_field(&item.proposal, "title", "title")
            .unwrap_or_else(|| "Tarea sin título".to_string());
        let category = proposal_str_field(&item.proposal, "category", "category")
            .unwrap_or_else(|| "operacion".to_string());
        let urgency = proposal_str_field(&item.proposal, "urgency", "urgency")
            .unwrap_or_else(|| "normal".to_string());
        let status = item.status.unwrap_or_else(|| "pending".to_string());
        let proposal_json = serde_json::to_string(&item.proposal)
            .map_err(|e| format!("Error serializando propuesta de tarea: {e}"))?;
        let staging_json = item
            .staging_payload
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| format!("Error serializando stagingPayload: {e}"))?;

        tx.execute(
            "INSERT INTO tasks (card_id, dedup_key, review_run_id, title, category, urgency, status, proposal_json, staging_payload_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(card_id) DO UPDATE SET
                dedup_key = COALESCE(excluded.dedup_key, tasks.dedup_key),
                review_run_id = COALESCE(excluded.review_run_id, tasks.review_run_id),
                title = excluded.title,
                category = excluded.category,
                urgency = excluded.urgency,
                status = excluded.status,
                proposal_json = excluded.proposal_json,
                staging_payload_json = COALESCE(excluded.staging_payload_json, tasks.staging_payload_json),
                updated_at = excluded.updated_at",
            params![
                card_id,
                item.dedup_key,
                item.review_run_id,
                title,
                category,
                urgency,
                status,
                proposal_json,
                staging_json,
                now_iso
            ],
        )
        .map_err(|e| format!("Error guardando tarea en SQLite: {e}"))?;

        inserted_ids.push(card_id);
    }

    if !inserted_ids.is_empty() {
        record_audit_event_conn(
            &tx,
            "agent",
            "tasks_upserted",
            ".xook/xook.db",
            ".xook",
            Some(&format!("{} tarea(s) guardadas", inserted_ids.len())),
            now,
        )?;
    }

    tx.commit()
        .map_err(|e| format!("Error confirmando tareas en SQLite: {e}"))?;

    let mut out = Vec::with_capacity(inserted_ids.len());
    for card_id in inserted_ids {
        let rec = conn
            .query_row(
                "SELECT card_id, dedup_key, review_run_id, title, category, urgency, status, proposal_json, staging_payload_json, created_at, updated_at
                 FROM tasks WHERE card_id = ?1",
                params![card_id],
                row_to_task,
            )
            .map_err(|e| format!("Error leyendo tarea guardada: {e}"))?;
        out.push(rec);
    }
    Ok(out)
}

pub fn update_task_proposal(
    conn: &Connection,
    card_id: &str,
    proposal: &Value,
    now: DateTime<Utc>,
) -> Result<Option<TaskLedgerRecord>, String> {
    if is_ephemeral_secret_task(proposal) {
        return Ok(None);
    }
    let title = proposal_str_field(proposal, "title", "title")
        .unwrap_or_else(|| "Tarea sin título".to_string());
    let category = proposal_str_field(proposal, "category", "category")
        .unwrap_or_else(|| "operacion".to_string());
    let urgency = proposal_str_field(proposal, "urgency", "urgency")
        .unwrap_or_else(|| "normal".to_string());
    let proposal_json = serde_json::to_string(proposal)
        .map_err(|e| format!("Error serializando propuesta actualizada: {e}"))?;

    let updated_rows = conn
        .execute(
            "UPDATE tasks
             SET title = ?2, category = ?3, urgency = ?4, proposal_json = ?5, updated_at = ?6
             WHERE card_id = ?1",
            params![
                card_id,
                title,
                category,
                urgency,
                proposal_json,
                now.to_rfc3339()
            ],
        )
        .map_err(|e| format!("Error actualizando parámetros de tarea: {e}"))?;

    if updated_rows == 0 {
        return Ok(None);
    }

    conn.query_row(
        "SELECT card_id, dedup_key, review_run_id, title, category, urgency, status, proposal_json, staging_payload_json, created_at, updated_at
         FROM tasks WHERE card_id = ?1",
        params![card_id],
        row_to_task,
    )
    .optional()
    .map_err(|e| format!("Error leyendo tarea actualizada: {e}"))
}

fn upsert_agenda_tx(
    conn: &Connection,
    mut payload: UpsertAgendaItemPayload,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let now_iso = now.to_rfc3339();
    let existing_ends_at: Option<(Option<String>, i64, String)> = conn
        .query_row(
            "SELECT ends_at, is_running, created_at FROM agenda_items WHERE id = ?1",
            params![payload.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Error consultando elemento de agenda: {e}"))?;

    if payload.kind == "timer" {
        if payload.is_running {
            let secs = payload
                .remaining_seconds
                .or(payload.duration_seconds)
                .unwrap_or(900)
                .max(1);
            let computed_end = if let Some(ref incoming_end) = payload.ends_at {
                incoming_end.clone()
            } else if let Some((Some(prev_end), prev_running, _)) = &existing_ends_at {
                if *prev_running != 0 {
                    prev_end.clone()
                } else {
                    (now + ChronoDuration::seconds(secs)).to_rfc3339()
                }
            } else {
                (now + ChronoDuration::seconds(secs)).to_rfc3339()
            };
            payload.ends_at = Some(computed_end);
            payload.remaining_seconds = Some(secs);
        } else {
            payload.ends_at = None;
        }
    }

    let created_at = existing_ends_at
        .map(|(_, _, c)| c)
        .or(payload.created_at)
        .unwrap_or_else(|| now_iso.clone());

    let checklist_json = payload
        .checklist
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| format!("Error serializando checklist de agenda: {e}"))?;
    let tags_json = payload
        .tags
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| format!("Error serializando etiquetas de agenda: {e}"))?;

    conn.execute(
        "INSERT INTO agenda_items (
            id, kind, title, subtitle, time_label, recurrence, auto_scheduled,
            duration_seconds, remaining_seconds, ends_at, is_running,
            note_content, checklist_json, tags_json, schedule_cron_or_rule, next_run_at,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            subtitle = excluded.subtitle,
            time_label = excluded.time_label,
            recurrence = excluded.recurrence,
            auto_scheduled = excluded.auto_scheduled,
            duration_seconds = excluded.duration_seconds,
            remaining_seconds = excluded.remaining_seconds,
            ends_at = excluded.ends_at,
            is_running = excluded.is_running,
            note_content = excluded.note_content,
            checklist_json = excluded.checklist_json,
            tags_json = excluded.tags_json,
            schedule_cron_or_rule = excluded.schedule_cron_or_rule,
            next_run_at = excluded.next_run_at,
            updated_at = excluded.updated_at",
        params![
            payload.id,
            payload.kind,
            payload.title,
            payload.subtitle,
            payload.time_label,
            payload.recurrence,
            if payload.auto_scheduled { 1i64 } else { 0i64 },
            payload.duration_seconds,
            payload.remaining_seconds,
            payload.ends_at,
            if payload.is_running { 1i64 } else { 0i64 },
            payload.note_content,
            checklist_json,
            tags_json,
            payload.schedule_cron_or_rule,
            payload.next_run_at,
            created_at,
            now_iso,
        ],
    )
    .map_err(|e| format!("Error guardando elemento en Agenda: {e}"))?;

    Ok(())
}

pub fn get_agenda_item_at(
    conn: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<AgendaItemDto, String> {
    let (item, just_expired) = conn
        .query_row(
            "SELECT id, kind, title, subtitle, time_label, recurrence, auto_scheduled,
                    duration_seconds, remaining_seconds, ends_at, is_running,
                    note_content, checklist_json, tags_json, schedule_cron_or_rule, next_run_at,
                    created_at, updated_at
             FROM agenda_items WHERE id = ?1",
            params![id],
            |row| row_to_agenda_item(row, now),
        )
        .map_err(|e| format!("No se encontró el elemento de agenda: {e}"))?;

    if just_expired {
        conn.execute(
            "UPDATE agenda_items SET remaining_seconds = 0, is_running = 0, ends_at = NULL, updated_at = ?2 WHERE id = ?1",
            params![id, now.to_rfc3339()],
        )
        .map_err(|e| format!("Error finalizando reloj expirado: {e}"))?;
    }

    Ok(item)
}

pub fn list_agenda_items_at(
    conn: &mut Connection,
    now: DateTime<Utc>,
) -> Result<Vec<AgendaItemDto>, String> {
    let items_with_flags: Vec<(AgendaItemDto, bool)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, title, subtitle, time_label, recurrence, auto_scheduled,
                        duration_seconds, remaining_seconds, ends_at, is_running,
                        note_content, checklist_json, tags_json, schedule_cron_or_rule, next_run_at,
                        created_at, updated_at
                 FROM agenda_items
                 ORDER BY is_running DESC, updated_at DESC",
            )
            .map_err(|e| format!("Error preparando consulta de Agenda: {e}"))?;
        let rows = stmt
            .query_map([], |row| row_to_agenda_item(row, now))
            .map_err(|e| format!("Error leyendo Agenda: {e}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando Agenda: {e}"))?
    };

    let mut expired_ids = Vec::new();
    let mut result = Vec::with_capacity(items_with_flags.len());
    for (item, just_expired) in items_with_flags {
        if just_expired {
            expired_ids.push(item.id.clone());
        }
        result.push(item);
    }

    if !expired_ids.is_empty() {
        let now_iso = now.to_rfc3339();
        for id in expired_ids {
            conn.execute(
                "UPDATE agenda_items SET remaining_seconds = 0, is_running = 0, ends_at = NULL, updated_at = ?2 WHERE id = ?1",
                params![id, now_iso],
            )
            .map_err(|e| format!("Error actualizando reloj expirado en SQLite: {e}"))?;
        }
    }

    Ok(result)
}

pub fn upsert_agenda_item_at(
    conn: &mut Connection,
    payload: UpsertAgendaItemPayload,
    log_creation: bool,
    now: DateTime<Utc>,
) -> Result<AgendaItemDto, String> {
    let item_id = payload.id.clone();
    let item_kind = payload.kind.clone();
    let item_title = payload.title.clone();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de Agenda: {e}"))?;
    let existed: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agenda_items WHERE id = ?1)",
            params![item_id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    upsert_agenda_tx(&tx, payload, now)?;

    if log_creation && !existed {
        record_audit_event_conn(
            &tx,
            "user",
            &format!("agenda_created_{item_kind}"),
            ".xook/xook.db",
            ".xook",
            Some(&item_title),
            now,
        )?;
    }

    tx.commit()
        .map_err(|e| format!("Error confirmando elemento en Agenda: {e}"))?;

    get_agenda_item_at(conn, &item_id, now)
}

pub fn toggle_timer_state_at(
    conn: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<AgendaItemDto, String> {
    let row_data: Option<(String, Option<i64>, Option<i64>, Option<String>, i64)> = conn
        .query_row(
            "SELECT kind, duration_seconds, remaining_seconds, ends_at, is_running FROM agenda_items WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|e| format!("Error consultando reloj: {e}"))?;

    let (kind, duration_secs, fallback_rem, ends_at, raw_running) =
        row_data.ok_or_else(|| "El elemento de agenda ya no existe.".to_string())?;

    if kind != "timer" {
        return get_agenda_item_at(conn, id, now);
    }

    let was_running = raw_running != 0;
    if was_running {
        let (live_rem, still_running, _) =
            compute_live_timer_state(ends_at.as_deref(), fallback_rem, true, now);
        let frozen_secs = if still_running {
            live_rem.unwrap_or(0)
        } else {
            0
        };
        conn.execute(
            "UPDATE agenda_items SET is_running = 0, remaining_seconds = ?2, ends_at = NULL, updated_at = ?3 WHERE id = ?1",
            params![id, frozen_secs, now.to_rfc3339()],
        )
        .map_err(|e| format!("Error pausando reloj: {e}"))?;
    } else {
        let base_secs = match fallback_rem {
            Some(rem) if rem > 0 => rem,
            _ => duration_secs.unwrap_or(900).max(1),
        };
        let next_ends_at = (now + ChronoDuration::seconds(base_secs)).to_rfc3339();
        conn.execute(
            "UPDATE agenda_items SET is_running = 1, remaining_seconds = ?2, ends_at = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, base_secs, next_ends_at, now.to_rfc3339()],
        )
        .map_err(|e| format!("Error reanudando reloj: {e}"))?;
    }

    get_agenda_item_at(conn, id, now)
}

pub fn reset_timer_state_at(
    conn: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<AgendaItemDto, String> {
    conn.execute(
        "UPDATE agenda_items
         SET remaining_seconds = COALESCE(duration_seconds, remaining_seconds),
             is_running = 0,
             ends_at = NULL,
             updated_at = ?2
         WHERE id = ?1",
        params![id, now.to_rfc3339()],
    )
    .map_err(|e| format!("Error reiniciando reloj: {e}"))?;

    get_agenda_item_at(conn, id, now)
}

pub fn delete_agenda_item_at(
    conn: &mut Connection,
    id: &str,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let title: Option<String> = conn
        .query_row(
            "SELECT title FROM agenda_items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Error buscando elemento a eliminar: {e}"))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de borrado: {e}"))?;
    tx.execute("DELETE FROM agenda_items WHERE id = ?1", params![id])
        .map_err(|e| format!("Error eliminando elemento de Agenda: {e}"))?;

    if let Some(t) = title {
        record_audit_event_conn(
            &tx,
            "user",
            "agenda_deleted",
            ".xook/xook.db",
            ".xook",
            Some(&t),
            now,
        )?;
    }

    tx.commit()
        .map_err(|e| format!("Error confirmando eliminación en Agenda: {e}"))
}

pub fn complete_agenda_item_at(
    conn: &mut Connection,
    payload: CompleteAgendaPayload,
    now: DateTime<Utc>,
) -> Result<DecisionHistoryDto, String> {
    let existing = get_agenda_item_at(conn, &payload.agenda_item_id, now)?;
    let now_iso = now.to_rfc3339();
    let history_id = payload
        .decision_id
        .unwrap_or_else(|| format!("hist_ag_{}_{}", existing.id, now.timestamp_millis()));
    let category = if existing.kind == "note" {
        "nota"
    } else {
        "agenda"
    };
    let summary = existing
        .note_content
        .clone()
        .or_else(|| existing.subtitle.clone())
        .unwrap_or_else(|| existing.time_label.clone());

    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de agenda completada: {e}"))?;

    tx.execute(
        "INSERT INTO decision_history (
            id, task_card_id, agenda_item_id, title, category, decision,
            summary, amount_label, verified_cost, currency, execution_artifact_path,
            notes, decided_by, decided_at
        ) VALUES (?1, NULL, ?2, ?3, ?4, 'completed', ?5, NULL, NULL, NULL, NULL, ?6, ?7, ?8)",
        params![
            history_id,
            existing.id,
            existing.title,
            category,
            summary,
            payload.notes,
            payload.decided_by,
            now_iso
        ],
    )
    .map_err(|e| format!("Error registrando elemento completado en historial: {e}"))?;

    tx.execute(
        "DELETE FROM agenda_items WHERE id = ?1",
        params![existing.id],
    )
    .map_err(|e| format!("Error quitando elemento completado de Agenda: {e}"))?;

    record_audit_event_conn(
        &tx,
        payload.decided_by.as_deref().unwrap_or("user"),
        "agenda_completed",
        ".xook/xook.db",
        ".xook",
        Some(&existing.title),
        now,
    )?;

    tx.commit()
        .map_err(|e| format!("Error confirmando completado de Agenda: {e}"))?;

    conn.query_row(
        "SELECT id, task_card_id, agenda_item_id, title, category, decision, summary, amount_label, verified_cost, currency, execution_artifact_path, notes, decided_by, decided_at
         FROM decision_history WHERE id = ?1",
        params![history_id],
        row_to_history,
    )
    .map_err(|e| format!("Error leyendo historial recién guardado: {e}"))
}

pub fn decide_task_hitl_at(
    conn: &mut Connection,
    workspace_root: &Path,
    workspace_id: &str,
    payload: DecideTaskPayload,
    now: DateTime<Utc>,
) -> Result<DecideTaskResult, String> {
    let now_iso = now.to_rfc3339();
    let decision_norm = match payload.decision.as_str() {
        "approved" | "adjusted" | "rejected" => payload.decision.clone(),
        _ => "approved".to_string(),
    };
    let history_id = payload
        .decision_id
        .clone()
        .unwrap_or_else(|| format!("hist_{}_{}", payload.card_id, now.timestamp_millis()));

    let updated_proposal_json = payload
        .updated_proposal
        .as_ref()
        .filter(|p| !is_ephemeral_secret_task(p))
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| format!("Error serializando propuesta en decisión: {e}"))?;

    let promoted_id = payload
        .promote_agenda_item
        .as_ref()
        .filter(|_| decision_norm != "rejected")
        .map(|ag| ag.id.clone());

    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción HITL: {e}"))?;

    tx.execute(
        "UPDATE tasks
         SET status = ?2,
             proposal_json = COALESCE(?3, proposal_json),
             updated_at = ?4
         WHERE card_id = ?1",
        params![
            payload.card_id,
            decision_norm,
            updated_proposal_json,
            now_iso
        ],
    )
    .map_err(|e| format!("Error actualizando estado de tarea: {e}"))?;

    tx.execute(
        "INSERT INTO decision_history (
            id, task_card_id, agenda_item_id, title, category, decision,
            summary, amount_label, verified_cost, currency, execution_artifact_path,
            notes, decided_by, decided_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            history_id,
            payload.card_id,
            promoted_id,
            payload.title,
            payload.category,
            decision_norm,
            payload.summary,
            payload.amount_label,
            payload.verified_cost,
            payload.currency,
            payload.execution_artifact_path,
            payload.notes,
            payload.decided_by,
            now_iso
        ],
    )
    .map_err(|e| format!("Error guardando historial de decisión: {e}"))?;

    if let Some(ag_payload) = payload.promote_agenda_item {
        if decision_norm != "rejected" {
            upsert_agenda_tx(&tx, ag_payload, now)?;
        }
    }

    let action_name = format!("task_{decision_norm}");
    record_audit_event_conn(
        &tx,
        payload.decided_by.as_deref().unwrap_or("user"),
        &action_name,
        "memoria/decisiones.jsonl",
        "memoria",
        Some(&payload.title),
        now,
    )?;

    tx.commit()
        .map_err(|e| format!("Error confirmando decisión HITL en SQLite: {e}"))?;

    append_decision_jsonl(
        workspace_root,
        workspace_id,
        &payload.card_id,
        Some(&payload.title),
        &decision_norm,
        payload.adjusted_qty,
        payload.notes.as_deref(),
    )?;

    let history_entry = conn
        .query_row(
            "SELECT id, task_card_id, agenda_item_id, title, category, decision, summary, amount_label, verified_cost, currency, execution_artifact_path, notes, decided_by, decided_at
             FROM decision_history WHERE id = ?1",
            params![history_id],
            row_to_history,
        )
        .map_err(|e| format!("Error leyendo historial confirmado: {e}"))?;

    let mut history_entry = history_entry;
    super::inventory::apply_post_hitl_side_effects(
        conn,
        workspace_root,
        super::inventory::HitlSideEffectInput {
            card_id: &payload.card_id,
            title: &payload.title,
            category: &payload.category,
            summary: &payload.summary,
            decided_by: payload.decided_by.as_deref(),
            adjusted_qty: payload.adjusted_qty,
            verified_cost: payload.verified_cost,
            currency: payload.currency.as_deref(),
            notes: payload.notes.as_deref(),
            updated_proposal: payload.updated_proposal.as_ref(),
        },
        &decision_norm,
        &mut history_entry,
        now,
    )?;

    let promoted_agenda_item = if let Some(ag_id) = promoted_id {
        Some(get_agenda_item_at(conn, &ag_id, now)?)
    } else {
        None
    };

    Ok(DecideTaskResult {
        history_entry,
        promoted_agenda_item,
    })
}

pub fn record_history_entry_at(
    conn: &mut Connection,
    payload: RecordHistoryPayload,
    now: DateTime<Utc>,
) -> Result<DecisionHistoryDto, String> {
    let now_iso = now.to_rfc3339();
    let history_id = payload
        .id
        .unwrap_or_else(|| format!("hist_{}_{}", payload.category, now.timestamp_millis()));

    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de historial: {e}"))?;
    tx.execute(
        "INSERT INTO decision_history (
            id, task_card_id, agenda_item_id, title, category, decision,
            summary, amount_label, verified_cost, currency, execution_artifact_path,
            notes, decided_by, decided_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, ?9, ?10, ?11)",
        params![
            history_id,
            payload.task_card_id,
            payload.agenda_item_id,
            payload.title,
            payload.category,
            payload.decision,
            payload.summary,
            payload.amount_label,
            payload.notes,
            payload.decided_by,
            now_iso
        ],
    )
    .map_err(|e| format!("Error guardando registro en historial: {e}"))?;

    record_audit_event_conn(
        &tx,
        payload.decided_by.as_deref().unwrap_or("user"),
        "history_recorded",
        ".xook/xook.db",
        ".xook",
        Some(&payload.title),
        now,
    )?;

    tx.commit()
        .map_err(|e| format!("Error confirmando registro de historial: {e}"))?;

    conn.query_row(
        "SELECT id, task_card_id, agenda_item_id, title, category, decision, summary, amount_label, verified_cost, currency, execution_artifact_path, notes, decided_by, decided_at
         FROM decision_history WHERE id = ?1",
        params![history_id],
        row_to_history,
    )
    .map_err(|e| format!("Error leyendo historial guardado: {e}"))
}

pub fn list_task_history(
    conn: &Connection,
    limit: Option<i64>,
) -> Result<Vec<DecisionHistoryDto>, String> {
    let lim = limit.unwrap_or(150).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT id, task_card_id, agenda_item_id, title, category, decision, summary, amount_label, verified_cost, currency, execution_artifact_path, notes, decided_by, decided_at
             FROM decision_history
             ORDER BY decided_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error preparando consulta de historial: {e}"))?;
    let rows = stmt
        .query_map(params![lim], row_to_history)
        .map_err(|e| format!("Error leyendo historial de decisiones: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando historial de decisiones: {e}"))
}

pub fn get_audit_log(conn: &Connection, limit: Option<i64>) -> Result<Vec<AuditLogEntryDto>, String> {
    let lim = limit.unwrap_or(100).clamp(1, 500);
    let mut stmt = conn
        .prepare(
            "SELECT id, actor, action, target_path, zone, detail, created_at
             FROM workspace_audit_log
             ORDER BY id DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error preparando consulta de auditoría: {e}"))?;
    let rows = stmt
        .query_map(params![lim], row_to_audit)
        .map_err(|e| format!("Error leyendo auditoría: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando auditoría: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xook_store_test_{prefix}_{nanos}"));
        fs::create_dir_all(dir.join("memoria")).unwrap();
        dir
    }

    #[test]
    fn skips_ephemeral_api_key_tasks_and_persists_real_tasks() {
        let dir = make_temp_workspace("tasks");
        let mut conn = open_workspace_db(&dir).unwrap();
        let now = Utc::now();

        let saved = upsert_tasks_batch(
            &mut conn,
            vec![
                UpsertTaskPayload {
                    proposal: json!({
                        "cardId": "secret_card",
                        "title": "Guardar API key",
                        "category": "boveda",
                        "urgency": "alta",
                        "intent": { "type": "save_api_key" }
                    }),
                    dedup_key: None,
                    review_run_id: None,
                    status: None,
                    staging_payload: None,
                },
                UpsertTaskPayload {
                    proposal: json!({
                        "cardId": "card_reponer_1",
                        "title": "Reponer Café Chiapas",
                        "category": "inventario",
                        "urgency": "critica",
                        "intent": { "type": "purchase_order" },
                        "paramValues": { "qty": 20 }
                    }),
                    dedup_key: Some("stock:CAFE-500".to_string()),
                    review_run_id: None,
                    status: None,
                    staging_payload: None,
                },
            ],
            false,
            now,
        )
        .unwrap();

        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].card_id, "card_reponer_1");

        let updated = update_task_proposal(
            &conn,
            "card_reponer_1",
            &json!({
                "cardId": "card_reponer_1",
                "title": "Reponer Café Chiapas",
                "category": "inventario",
                "urgency": "critica",
                "intent": { "type": "purchase_order" },
                "paramValues": { "qty": 30 }
            }),
            now + ChronoDuration::seconds(5),
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.proposal["paramValues"]["qty"], 30);

        let pending = list_tasks(&conn, Some("pending")).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].proposal["paramValues"]["qty"], 30);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn timer_uses_ends_at_across_restarts_and_expires_cleanly() {
        let dir = make_temp_workspace("timers");
        let mut conn = open_workspace_db(&dir).unwrap();
        let t0 = DateTime::parse_from_rfc3339("2026-11-12T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let created = upsert_agenda_item_at(
            &mut conn,
            UpsertAgendaItemPayload {
                id: "ag_timer_1".to_string(),
                kind: "timer".to_string(),
                title: "Hornear pan".to_string(),
                subtitle: None,
                time_label: "05:00".to_string(),
                recurrence: None,
                auto_scheduled: false,
                duration_seconds: Some(300),
                remaining_seconds: Some(300),
                ends_at: None,
                is_running: true,
                note_content: None,
                checklist: None,
                tags: None,
                schedule_cron_or_rule: None,
                next_run_at: None,
                created_at: None,
            },
            true,
            t0,
        )
        .unwrap();

        assert!(created.is_running);
        assert!(created.ends_at.is_some());
        assert_eq!(created.remaining_seconds, Some(300));

        // 42 seconds later (simulating app reopen)
        let list_t1 = list_agenda_items_at(&mut conn, t0 + ChronoDuration::seconds(42)).unwrap();
        assert_eq!(list_t1.len(), 1);
        assert!(list_t1[0].is_running);
        assert_eq!(list_t1[0].remaining_seconds, Some(258));
        assert_eq!(list_t1[0].time_label, "04:18");

        // Pause at t0 + 42s -> remaining frozen at 258, ends_at cleared
        let paused = toggle_timer_state_at(&mut conn, "ag_timer_1", t0 + ChronoDuration::seconds(42)).unwrap();
        assert!(!paused.is_running);
        assert_eq!(paused.remaining_seconds, Some(258));
        assert!(paused.ends_at.is_none());

        // Still 258 even 20 seconds later while paused
        let list_t2 = list_agenda_items_at(&mut conn, t0 + ChronoDuration::seconds(62)).unwrap();
        assert_eq!(list_t2[0].remaining_seconds, Some(258));
        assert!(!list_t2[0].is_running);

        // Resume at t0 + 62s, then fast-forward 300s past expiration
        let resumed = toggle_timer_state_at(&mut conn, "ag_timer_1", t0 + ChronoDuration::seconds(62)).unwrap();
        assert!(resumed.is_running);
        let expired = list_agenda_items_at(&mut conn, t0 + ChronoDuration::seconds(400)).unwrap();
        assert!(!expired[0].is_running);
        assert_eq!(expired[0].remaining_seconds, Some(0));
        assert!(expired[0].ends_at.is_none());

        // Reset restores original 300s
        let reset = reset_timer_state_at(&mut conn, "ag_timer_1", t0 + ChronoDuration::seconds(410)).unwrap();
        assert!(!reset.is_running);
        assert_eq!(reset.remaining_seconds, Some(300));

        // Complete agenda item moves it to decision_history
        complete_agenda_item_at(
            &mut conn,
            CompleteAgendaPayload {
                agenda_item_id: "ag_timer_1".to_string(),
                decision_id: None,
                decided_by: Some("Uziel".to_string()),
                notes: None,
            },
            t0 + ChronoDuration::seconds(420),
        )
        .unwrap();

        assert!(list_agenda_items_at(&mut conn, t0 + ChronoDuration::seconds(421)).unwrap().is_empty());
        let hist = list_task_history(&conn, None).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].title, "Hornear pan");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hitl_decision_commits_history_agenda_audit_and_jsonl_atomically() {
        let dir = make_temp_workspace("hitl");
        let mut conn = open_workspace_db(&dir).unwrap();
        let t0 = Utc::now();

        upsert_tasks_batch(
            &mut conn,
            vec![UpsertTaskPayload {
                proposal: json!({
                    "cardId": "task_timer_1",
                    "title": "Revisar caja",
                    "category": "agenda",
                    "urgency": "normal",
                    "intent": { "type": "start_timer" }
                }),
                dedup_key: None,
                review_run_id: None,
                status: None,
                staging_payload: None,
            }],
            false,
            t0,
        )
        .unwrap();

        let res = decide_task_hitl_at(
            &mut conn,
            &dir,
            "ws_test",
            DecideTaskPayload {
                card_id: "task_timer_1".to_string(),
                decision_id: Some("hist_fixed".to_string()),
                title: "Revisar caja".to_string(),
                category: "agenda".to_string(),
                decision: "approved".to_string(),
                summary: "Temporizador de 10m".to_string(),
                amount_label: None,
                verified_cost: None,
                currency: None,
                adjusted_qty: None,
                execution_artifact_path: None,
                notes: Some("Autorizado".to_string()),
                decided_by: Some("Uziel".to_string()),
                updated_proposal: None,
                promote_agenda_item: Some(UpsertAgendaItemPayload {
                    id: "ag_promoted".to_string(),
                    kind: "timer".to_string(),
                    title: "Revisar caja".to_string(),
                    subtitle: None,
                    time_label: "10:00".to_string(),
                    recurrence: None,
                    auto_scheduled: false,
                    duration_seconds: Some(600),
                    remaining_seconds: Some(600),
                    ends_at: None,
                    is_running: true,
                    note_content: None,
                    checklist: None,
                    tags: None,
                    schedule_cron_or_rule: None,
                    next_run_at: None,
                    created_at: None,
                }),
            },
            t0 + ChronoDuration::seconds(1),
        )
        .unwrap();

        assert_eq!(res.history_entry.id, "hist_fixed");
        assert!(res.promoted_agenda_item.is_some());
        assert!(list_tasks(&conn, Some("pending")).unwrap().is_empty());
        assert_eq!(list_tasks(&conn, Some("approved")).unwrap().len(), 1);
        assert_eq!(list_task_history(&conn, None).unwrap().len(), 1);
        assert_eq!(get_audit_log(&conn, None).unwrap().len(), 2);

        let jsonl = fs::read_to_string(dir.join("memoria/decisiones.jsonl")).unwrap();
        assert!(jsonl.contains("task_timer_1"));
        assert!(jsonl.contains("approved"));

        let _ = fs::remove_dir_all(&dir);
    }
}
