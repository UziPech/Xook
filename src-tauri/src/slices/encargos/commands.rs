use super::runner::ENCARGOS_UPDATED_EVENT;
use super::store::{self, EncargoDto};
use crate::slices::task_ledger::commands::open_active_db;
use crate::slices::workspace_manager::sandbox::resolve_inside_workspace;
use chrono::Utc;
use tauri::{AppHandle, Emitter, Runtime};

#[tauri::command]
pub fn list_encargos<R: Runtime>(app: AppHandle<R>) -> Result<Vec<EncargoDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    store::list_encargos(&conn)
}

/// "Hacerlo ahora" para un pendiente perdido o detenido.
#[tauri::command]
pub fn run_encargo_now<R: Runtime>(app: AppHandle<R>, id: String) -> Result<bool, String> {
    let (_, _, conn) = open_active_db(&app)?;
    let changed = store::schedule_now(&conn, &id, Utc::now())?;
    let _ = app.emit(ENCARGOS_UPDATED_EVENT, serde_json::json!({}));
    Ok(changed)
}

/// Quita el pendiente. Su carpeta y sus informes se quedan en el espacio de trabajo.
#[tauri::command]
pub fn remove_encargo<R: Runtime>(app: AppHandle<R>, id: String) -> Result<bool, String> {
    let (_, _, conn) = open_active_db(&app)?;
    let removed = store::delete_encargo(&conn, &id)?;
    let _ = app.emit(ENCARGOS_UPDATED_EVENT, serde_json::json!({}));
    Ok(removed)
}

/// Texto del último informe del pendiente, si ya corrió alguna vez.
#[tauri::command]
pub fn read_encargo_report<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Option<String>, String> {
    let (_, root, conn) = open_active_db(&app)?;
    let Some(rel) = store::latest_report_path(&conn, &id) else {
        return Ok(None);
    };
    let (abs, _, _) = resolve_inside_workspace(&root, &rel, false)?;
    Ok(std::fs::read_to_string(abs).ok())
}
