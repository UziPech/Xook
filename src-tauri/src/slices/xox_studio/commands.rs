use super::store::{
    delete_xox_skill_in, list_xox_skills, load_global_xox_profile, save_global_xox_profile,
    save_xox_skill_in, xox_config_dir, DeleteXoxSkillPayload, GlobalXoxProfile,
    SaveGlobalXoxProfilePayload, SaveXoxSkillPayload, XoxSkillEntry, XOX_PROFILE_UPDATED_EVENT,
};
use crate::ai_vault::{call_python_sidecar, find_sidecar_script};
use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
use tauri::{AppHandle, Emitter, Runtime};

#[tauri::command]
pub async fn get_global_xox_profile_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<GlobalXoxProfile, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || Ok(load_global_xox_profile(&app_clone)))
        .await
        .map_err(|e| format!("Error consultando el perfil global de Xox: {e}"))?
}

#[tauri::command]
pub async fn save_global_xox_profile_cmd<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveGlobalXoxProfilePayload,
) -> Result<GlobalXoxProfile, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || save_global_xox_profile(&app_clone, payload))
        .await
        .map_err(|e| format!("Error guardando el perfil global de Xox: {e}"))?
}

#[tauri::command]
pub async fn list_xox_skills_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<XoxSkillEntry>, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || list_xox_skills(&app_clone))
        .await
        .map_err(|e| format!("Error listando habilidades de Xox: {e}"))?
}

#[tauri::command]
pub async fn save_xox_skill_cmd<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveXoxSkillPayload,
) -> Result<XoxSkillEntry, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let dir = xox_config_dir(&app_clone)?;
        let ws = resolve_active_workspace_root(&app_clone);
        let saved = save_xox_skill_in(&dir, ws.as_deref(), payload)?;
        let profile = load_global_xox_profile(&app_clone);
        let _ = app_clone.emit(XOX_PROFILE_UPDATED_EVENT, &profile);
        if saved.scope == "workspace" {
            let _ = app_clone.emit(
                WORKSPACE_UPDATED_EVENT,
                serde_json::json!({ "reason": "xox_studio_skill_saved", "path": saved.rel_path }),
            );
        }
        Ok(saved)
    })
    .await
    .map_err(|e| format!("Error guardando habilidad: {e}"))?
}

#[tauri::command]
pub async fn delete_xox_skill_cmd<R: Runtime>(
    app: AppHandle<R>,
    payload: DeleteXoxSkillPayload,
) -> Result<(), String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let dir = xox_config_dir(&app_clone)?;
        let ws = resolve_active_workspace_root(&app_clone);
        let scope = payload.scope.clone();
        delete_xox_skill_in(&dir, ws.as_deref(), &payload.scope, &payload.slug)?;
        let profile = load_global_xox_profile(&app_clone);
        let _ = app_clone.emit(XOX_PROFILE_UPDATED_EVENT, &profile);
        if scope.trim().eq_ignore_ascii_case("workspace") {
            let _ = app_clone.emit(
                WORKSPACE_UPDATED_EVENT,
                serde_json::json!({ "reason": "xox_studio_skill_deleted", "slug": payload.slug }),
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Error eliminando habilidad: {e}"))?
}

#[tauri::command]
pub async fn discover_official_skills_cmd<R: Runtime>(
    app: AppHandle<R>,
    query: String,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let script = find_sidecar_script(&app)?;
    let lim = limit.unwrap_or(8);
    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "discover_official_skills",
            serde_json::json!({
                "query": query,
                "limit": lim,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error buscando habilidades oficiales: {e}"))?
}

#[tauri::command]
pub async fn install_official_skill_cmd<R: Runtime>(
    app: AppHandle<R>,
    source: String,
    skill_id: String,
    scope: Option<String>,
    local_slug: Option<String>,
) -> Result<serde_json::Value, String> {
    let script = find_sidecar_script(&app)?;
    let config_dir = xox_config_dir(&app)?;
    let ws = resolve_active_workspace_root(&app);
    let target_scope = scope.unwrap_or_else(|| "global".to_string());
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        let res = call_python_sidecar(
            &script,
            "install_official_skill",
            serde_json::json!({
                "source": source,
                "skill_id": skill_id,
                "local_slug": local_slug.unwrap_or_default(),
                "scope": target_scope,
                "xox_config_dir": config_dir.to_string_lossy().to_string(),
                "workspace_root": ws.as_ref().map(|p| p.to_string_lossy().to_string()),
            }),
        )?;
        if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
            let profile = load_global_xox_profile(&app_clone);
            let _ = app_clone.emit(XOX_PROFILE_UPDATED_EVENT, &profile);
            if target_scope.trim().eq_ignore_ascii_case("workspace") {
                let _ = app_clone.emit(
                    WORKSPACE_UPDATED_EVENT,
                    serde_json::json!({ "reason": "official_skill_installed" }),
                );
            }
        }
        Ok(res)
    })
    .await
    .map_err(|e| format!("Error instalando habilidad oficial: {e}"))?
}
