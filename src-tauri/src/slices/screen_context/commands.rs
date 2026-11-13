use super::{helper, store, watcher};
use crate::slices::task_ledger::migrations::open_workspace_db;
use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveScreenCapturePayload {
    pub ok: bool,
    pub permission_granted: bool,
    pub accessibility_granted: bool,
    pub blocked_sensitive: bool,
    pub sensitive_reason: Option<String>,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub capture_mode: String,
    pub text: String,
    pub ocr_text: String,
    pub ax_text: String,
    pub image_data_url: Option<String>,
    pub captured_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetScreenConfigPayload {
    pub rolling_enabled: Option<bool>,
    pub retention_minutes: Option<i64>,
    pub capture_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedMemoryPayload {
    pub facts: Vec<store::AgentMemoryItem>,
    pub screen_summary: String,
    pub recent_observations: Vec<store::ScreenObservationRecord>,
}

#[tauri::command]
pub async fn get_screen_reader_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<watcher::ScreenReaderStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let perm = helper::check_screen_permission(&app_clone).ok();
        let cfg = store::load_screen_config(&app_clone);
        let now = Utc::now();
        let obs_count = resolve_active_workspace_root(&app_clone)
            .and_then(|root| open_workspace_db(&root).ok())
            .map(|conn| store::count_active_observations(&conn, now))
            .unwrap_or(0);

        let state = app_clone.state::<watcher::ScreenContextState>();
        let st = state.update(|s| {
            s.rolling_enabled = cfg.rolling_enabled;
            s.retention_minutes = cfg.retention_minutes;
            s.capture_mode = cfg.capture_mode.clone();
            s.observation_count = obs_count;
            if let Some(ref p) = perm {
                s.permission_granted = p.permission_granted;
                s.accessibility_granted = p.accessibility_granted;
                if p.permission_granted {
                    if s.last_error
                        .as_deref()
                        .unwrap_or("")
                        .contains("Permiso")
                    {
                        s.last_error = None;
                    }
                }
            }
        });
        Ok(st)
    })
    .await
    .map_err(|e| format!("Error consultando estado del lector de pantalla: {e}"))?
}

#[tauri::command]
pub async fn set_screen_reader_config<R: Runtime>(
    app: AppHandle<R>,
    payload: SetScreenConfigPayload,
) -> Result<watcher::ScreenReaderStatus, String> {
    let mut cfg = store::load_screen_config(&app);
    if let Some(enabled) = payload.rolling_enabled {
        cfg.rolling_enabled = enabled;
    }
    if let Some(mins) = payload.retention_minutes {
        cfg.retention_minutes = mins;
    }
    if let Some(mode) = payload.capture_mode {
        cfg.capture_mode = mode;
    }
    let saved = store::save_screen_config(&app, &cfg)?;
    let state = app.state::<watcher::ScreenContextState>();
    let obs_count = resolve_active_workspace_root(&app)
        .and_then(|root| open_workspace_db(&root).ok())
        .map(|conn| store::count_active_observations(&conn, Utc::now()))
        .unwrap_or(0);

    let st = state.update(|s| {
        s.rolling_enabled = saved.rolling_enabled;
        s.retention_minutes = saved.retention_minutes;
        s.capture_mode = saved.capture_mode.clone();
        s.observation_count = obs_count;
    });
    watcher::emit_screen_status(&app, &st);
    Ok(st)
}

#[tauri::command]
pub async fn request_screen_permission_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<watcher::ScreenReaderStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let out = helper::request_screen_permission(&app_clone)?;
        let state = app_clone.state::<watcher::ScreenContextState>();
        let st = state.update(|s| {
            s.permission_granted = out.permission_granted;
            s.accessibility_granted = out.accessibility_granted;
            s.last_error = out.error.clone();
        });
        watcher::emit_screen_status(&app_clone, &st);
        Ok(st)
    })
    .await
    .map_err(|e| format!("Error solicitando permiso de pantalla: {e}"))?
}

#[tauri::command]
pub fn open_screen_permission_settings() -> Result<(), String> {
    helper::open_macos_screen_settings()
}

pub fn capture_live_for_agent<R: Runtime>(
    app: &AppHandle<R>,
    mode_override: Option<&str>,
    include_image: bool,
    save_observation: bool,
) -> Result<LiveScreenCapturePayload, String> {
    let cfg = store::load_screen_config(app);
    let mode = mode_override.unwrap_or(&cfg.capture_mode);
    let out = helper::capture_screen_sync(app, mode, include_image, 1280)?;

    let now = Utc::now();
    let mut obs_count = 0usize;
    if let Some(root) = resolve_active_workspace_root(app) {
        if let Ok(mut conn) = open_workspace_db(&root) {
            if save_observation
                && out.ok
                && !out.blocked_sensitive
                && !out.merged_text.trim().is_empty()
            {
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
            }
            obs_count = store::count_active_observations(&conn, now);
        }
    }

    let state = app.state::<watcher::ScreenContextState>();
    let st = state.update(|s| {
        s.permission_granted = out.permission_granted;
        s.accessibility_granted = out.accessibility_granted;
        s.paused_sensitive = out.blocked_sensitive;
        s.sensitive_reason = out.sensitive_reason.clone();
        if !out.app_name.is_empty() {
            s.active_app_name = out.app_name.clone();
            s.active_window_title = out.window_title.clone();
        }
        if out.ok {
            s.last_captured_at = Some(out.captured_at.clone());
        }
        s.observation_count = obs_count;
        s.last_error = out.error.clone();
    });
    watcher::emit_screen_status(app, &st);

    Ok(LiveScreenCapturePayload {
        ok: out.ok,
        permission_granted: out.permission_granted,
        accessibility_granted: out.accessibility_granted,
        blocked_sensitive: out.blocked_sensitive,
        sensitive_reason: out.sensitive_reason,
        app_name: out.app_name,
        bundle_id: out.bundle_id,
        window_title: out.window_title,
        capture_mode: out.capture_mode,
        text: out.merged_text,
        ocr_text: out.ocr_text,
        ax_text: out.ax_text,
        image_data_url: out.image_data_url,
        captured_at: out.captured_at,
        error: out.error,
    })
}

#[tauri::command]
pub async fn capture_screen_context_now<R: Runtime>(
    app: AppHandle<R>,
    mode: Option<String>,
    include_image: Option<bool>,
    save_observation: Option<bool>,
) -> Result<LiveScreenCapturePayload, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        capture_live_for_agent(
            &app_clone,
            mode.as_deref(),
            include_image.unwrap_or(true),
            save_observation.unwrap_or(true),
        )
    })
    .await
    .map_err(|e| format!("Error capturando contexto de pantalla: {e}"))?
}

#[tauri::command]
pub fn query_screen_memory_cmd<R: Runtime>(
    app: AppHandle<R>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<store::ScreenObservationRecord>, String> {
    let Some(root) = resolve_active_workspace_root(&app) else {
        return Ok(Vec::new());
    };
    let conn = open_workspace_db(&root)?;
    let q = query.unwrap_or_default();
    let lim = limit.unwrap_or(6);
    if q.trim().is_empty() {
        store::list_recent_screen_observations(&conn, lim, Utc::now())
    } else {
        store::query_screen_observations_fts(&conn, &q, lim, Utc::now())
    }
}

#[tauri::command]
pub fn clear_screen_memory_cmd<R: Runtime>(app: AppHandle<R>) -> Result<watcher::ScreenReaderStatus, String> {
    if let Some(root) = resolve_active_workspace_root(&app) {
        if let Ok(conn) = open_workspace_db(&root) {
            let _ = store::clear_all_screen_observations(&conn);
        }
    }
    let state = app.state::<watcher::ScreenContextState>();
    let st = state.update(|s| {
        s.observation_count = 0;
        s.last_preview = None;
    });
    watcher::emit_screen_status(&app, &st);
    Ok(st)
}

#[tauri::command]
pub fn get_unified_memory_context_cmd<R: Runtime>(
    app: AppHandle<R>,
    query: Option<String>,
) -> Result<UnifiedMemoryPayload, String> {
    let root = resolve_active_workspace_root(&app);
    let q = query.unwrap_or_default();
    let (facts, screen_summary) = store::build_unified_memory_for_workspace(root.as_deref(), &q);
    let recent_observations = root
        .as_deref()
        .and_then(|r| open_workspace_db(r).ok())
        .and_then(|conn| store::list_recent_screen_observations(&conn, 6, Utc::now()).ok())
        .unwrap_or_default();

    Ok(UnifiedMemoryPayload {
        facts,
        screen_summary,
        recent_observations,
    })
}

