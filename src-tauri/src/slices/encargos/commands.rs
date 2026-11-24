use super::store::{self, EncargoDto};
use crate::slices::task_ledger::commands::open_active_db;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn list_encargos<R: Runtime>(app: AppHandle<R>) -> Result<Vec<EncargoDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    store::list_encargos(&conn)
}
