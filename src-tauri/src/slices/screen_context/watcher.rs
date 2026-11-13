use super::{helper, store};
use crate::slices::task_ledger::migrations::open_workspace_db;
use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
use chrono::Utc;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const SCREEN_CONTEXT_UPDATED_EVENT: &str = "screen:context-updated";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenReaderStatus {
    pub rolling_enabled: bool,
    pub retention_minutes: i64,
    pub capture_mode: String,
    pub permission_granted: bool,
    pub accessibility_granted: bool,
    pub paused_sensitive: bool,
    pub sensitive_reason: Option<String>,
    pub active_app_name: String,
    pub active_window_title: String,
    pub last_captured_at: Option<String>,
    pub observation_count: usize,
    pub last_preview: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct ScreenContextState {
    pub inner: Mutex<ScreenReaderStatus>,
}

impl ScreenContextState {
    pub fn update<F>(&self, f: F) -> ScreenReaderStatus
    where
        F: FnOnce(&mut ScreenReaderStatus),
    {
        if let Ok(mut g) = self.inner.lock() {
            f(&mut g);
            g.clone()
        } else {
            ScreenReaderStatus::default()
        }
    }
}

pub fn emit_screen_status<R: Runtime>(app: &AppHandle<R>, status: &ScreenReaderStatus) {
    let _ = app.emit(SCREEN_CONTEXT_UPDATED_EVENT, status);
}

pub fn start_screen_watcher<R: Runtime>(app: AppHandle<R>) {
    let cfg = store::load_screen_config(&app);
    {
        let state = app.state::<ScreenContextState>();
        let st = state.update(|s| {
            s.rolling_enabled = cfg.rolling_enabled;
            s.retention_minutes = cfg.retention_minutes;
            s.capture_mode = cfg.capture_mode.clone();
        });
        emit_screen_status(&app, &st);
    }

    tauri::async_runtime::spawn(async move {
        // Espera breve al arrancar antes del primer ciclo de lectura en segundo plano
        tokio::time::sleep(Duration::from_secs(3)).await;

        let mut prev_signature = String::new();

        loop {
            let app_tick = app.clone();
            let sleep_secs = tokio::task::spawn_blocking(move || {
                let cfg = store::load_screen_config(&app_tick);
                let now = Utc::now();

                // Siempre purgar observaciones vencidas aunque la memoria continua esté pausada
                let active_ws = resolve_active_workspace_root(&app_tick);
                if let Some(ref root) = active_ws {
                    if let Ok(conn) = open_workspace_db(root) {
                        let _ = store::prune_expired_observations(&conn, now);
                    }
                }

                // Verificar permiso sin disparar diálogo del sistema operativo
                let perm_check = helper::check_screen_permission(&app_tick).ok();
                let permission_granted = perm_check
                    .as_ref()
                    .map(|p| p.permission_granted)
                    .unwrap_or(false);
                let accessibility_granted = perm_check
                    .as_ref()
                    .map(|p| p.accessibility_granted)
                    .unwrap_or(false);

                let state = app_tick.state::<ScreenContextState>();

                if !cfg.rolling_enabled || !permission_granted {
                    let obs_count = active_ws
                        .as_ref()
                        .and_then(|root| open_workspace_db(root).ok())
                        .map(|conn| store::count_active_observations(&conn, now))
                        .unwrap_or(0);

                    let updated = state.update(|st| {
                        st.rolling_enabled = cfg.rolling_enabled;
                        st.retention_minutes = cfg.retention_minutes;
                        st.capture_mode = cfg.capture_mode.clone();
                        st.permission_granted = permission_granted;
                        st.accessibility_granted = accessibility_granted;
                        st.paused_sensitive = false;
                        st.sensitive_reason = None;
                        st.observation_count = obs_count;
                    });
                    return (
                        if permission_granted { 5u64 } else { 8u64 },
                        updated,
                    );
                }

                // Captura continua en RAM sin imagen (solo texto OCR/AX deduplicado)
                let capture = helper::capture_screen_sync(
                    &app_tick,
                    &cfg.capture_mode,
                    false,
                    1280,
                );

                let mut obs_count = active_ws
                    .as_ref()
                    .and_then(|root| open_workspace_db(root).ok())
                    .map(|conn| store::count_active_observations(&conn, now))
                    .unwrap_or(0);

                let updated = match capture {
                    Ok(out) => {
                        if out.ok && !out.blocked_sensitive && !out.merged_text.trim().is_empty() {
                            if let Some(ref root) = active_ws {
                                if let Ok(mut conn) = open_workspace_db(root) {
                                    let _ = store::record_screen_observation_at(
                                        &mut conn,
                                        &store::NewScreenObservation {
                                            app_name: &out.app_name,
                                            bundle_id: &out.bundle_id,
                                            window_title: &out.window_title,
                                            content_text: &out.merged_text,
                                            capture_mode: &out.capture_mode,
                                        },
                                        cfg.retention_minutes,
                                        now,
                                    );
                                    obs_count = store::count_active_observations(&conn, now);
                                }
                            }
                        }

                        let preview: Option<String> = if out.blocked_sensitive {
                            None
                        } else {
                            let sample = out
                                .ocr_text
                                .lines()
                                .map(str::trim)
                                .filter(|l| !l.is_empty())
                                .take(2)
                                .collect::<Vec<_>>()
                                .join(" · ");
                            if sample.is_empty() {
                                None
                            } else {
                                Some(sample.chars().take(120).collect())
                            }
                        };

                        state.update(|st| {
                            st.rolling_enabled = cfg.rolling_enabled;
                            st.retention_minutes = cfg.retention_minutes;
                            st.capture_mode = cfg.capture_mode.clone();
                            st.permission_granted = out.permission_granted;
                            st.accessibility_granted = out.accessibility_granted;
                            st.paused_sensitive = out.blocked_sensitive;
                            st.sensitive_reason = out.sensitive_reason.clone();
                            st.active_app_name = out.app_name.clone();
                            st.active_window_title = out.window_title.clone();
                            st.last_captured_at = if out.ok {
                                Some(out.captured_at.clone())
                            } else {
                                st.last_captured_at.clone()
                            };
                            st.observation_count = obs_count;
                            if preview.is_some() {
                                st.last_preview = preview;
                            }
                            st.last_error = out.error.clone();
                        })
                    }
                    Err(err) => state.update(|st| {
                        st.rolling_enabled = cfg.rolling_enabled;
                        st.retention_minutes = cfg.retention_minutes;
                        st.capture_mode = cfg.capture_mode.clone();
                        st.observation_count = obs_count;
                        st.last_error = Some(err);
                    }),
                };

                (4u64, updated)
            })
            .await;

            if let Ok((secs, status)) = sleep_secs {
                let sig = format!(
                    "{}|{}|{}|{}|{}|{}|{}",
                    status.rolling_enabled,
                    status.permission_granted,
                    status.paused_sensitive,
                    status.active_app_name,
                    status.active_window_title,
                    status.observation_count,
                    status.last_error.as_deref().unwrap_or("")
                );
                if sig != prev_signature {
                    prev_signature = sig;
                    emit_screen_status(&app, &status);
                }
                tokio::time::sleep(Duration::from_secs(secs)).await;
            } else {
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });
}
