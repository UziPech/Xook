use super::policy::{
    self, PermissionsConfig, add_or_update_rule, enable_readonly_preset, load_permissions,
    remove_rule,
};
use super::runner::{
    CommandExecutionDto, CommandPermissionBroker, CommandPermissionDecision,
    list_command_executions as query_command_executions,
};
use crate::slices::task_ledger::commands::{emit_workspace_updated, open_active_db};
use crate::slices::workspace_manager::registry::ensure_active_workspace;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime, State};

pub const PERMISSIONS_UPDATED_EVENT: &str = "xox:permissions-updated";

#[tauri::command]
pub fn get_command_permissions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionsConfig, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    Ok(load_permissions(&PathBuf::from(active.root_path)))
}

#[tauri::command]
pub fn enable_readonly_command_preset<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionsConfig, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let cfg = enable_readonly_preset(&PathBuf::from(active.root_path))?;
    let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
    emit_workspace_updated(&app, "permissions_preset_enabled");
    Ok(cfg)
}

#[tauri::command]
pub fn update_command_permission_rule<R: Runtime>(
    app: AppHandle<R>,
    pattern: String,
    action: String,
    scope: Option<String>,
    description: Option<String>,
) -> Result<PermissionsConfig, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let cfg = add_or_update_rule(
        &PathBuf::from(active.root_path),
        &pattern,
        &action,
        scope.as_deref().unwrap_or("program"),
        description,
    )?;
    let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
    emit_workspace_updated(&app, "permission_rule_updated");
    Ok(cfg)
}

#[tauri::command]
pub fn remove_command_permission_rule<R: Runtime>(
    app: AppHandle<R>,
    rule_id: String,
) -> Result<PermissionsConfig, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let cfg = remove_rule(&PathBuf::from(active.root_path), &rule_id)?;
    let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
    emit_workspace_updated(&app, "permission_rule_removed");
    Ok(cfg)
}

#[tauri::command]
pub fn update_command_default_policy<R: Runtime>(
    app: AppHandle<R>,
    default_policy: String,
) -> Result<PermissionsConfig, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(active.root_path);
    let mut cfg = load_permissions(&root);
    cfg.default_policy = if default_policy.trim().eq_ignore_ascii_case("deny") {
        "deny".to_string()
    } else {
        "ask".to_string()
    };
    let saved = policy::save_permissions(&root, cfg)?;
    let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn list_command_executions_cmd<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<i64>,
) -> Result<Vec<CommandExecutionDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    query_command_executions(&conn, limit)
}

#[tauri::command]
pub fn resolve_command_permission(
    broker: State<'_, CommandPermissionBroker>,
    request_id: String,
    decision: String,
) -> Result<(), String> {
    let parsed = CommandPermissionDecision::from_str(&decision)?;
    broker.resolve(&request_id, parsed)
}

