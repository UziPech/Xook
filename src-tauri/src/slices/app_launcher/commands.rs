use super::resolver::{discover_installed_apps, resolve_app_in_catalog, AppResolution, InstalledApp};

#[tauri::command]
pub async fn list_installed_apps(
    query: Option<String>,
) -> Result<Vec<InstalledApp>, String> {
    let q = query.unwrap_or_default().trim().to_string();
    let apps = tauri::async_runtime::spawn_blocking(move || {
        let all = discover_installed_apps();
        if q.is_empty() {
            return all;
        }
        match resolve_app_in_catalog(&all, &q) {
            AppResolution::Resolved { app } => vec![app],
            AppResolution::Ambiguous { candidates, .. } => candidates,
            AppResolution::NotFound { suggestions, .. } => suggestions,
            AppResolution::InvalidTarget { .. } => Vec::new(),
        }
    })
    .await
    .map_err(|e| format!("Error buscando aplicaciones instaladas: {e}"))?;
    Ok(apps)
}

