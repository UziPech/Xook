use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const LOCAL_USER_FILENAME: &str = "local-user.json";
const CONVERSATIONS_FILENAME: &str = "conversations.json";
const MAX_STORED_CONVERSATIONS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUserProfile {
    pub id: String,
    pub name: String,
    pub store_name: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalUserPayload {
    pub name: String,
    pub store_name: Option<String>,
    pub role: Option<String>,
}

fn config_file_path<R: Runtime>(app: &AppHandle<R>, filename: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(filename))
}

fn write_json_secure(path: &PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear el directorio local: {e}"))?;
    }
    fs::write(path, content).map_err(|e| format!("Error guardando datos locales: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

#[tauri::command]
pub fn get_local_user<R: Runtime>(app: AppHandle<R>) -> Option<LocalUserProfile> {
    let path = config_file_path(&app, LOCAL_USER_FILENAME)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<LocalUserProfile>(&raw).ok()
}

#[tauri::command]
pub fn save_local_user<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveLocalUserPayload,
) -> Result<LocalUserProfile, String> {
    let trimmed_name = payload.name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err("Escribe tu nombre para crear el perfil local.".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let existing = get_local_user(app.clone());
    let profile = LocalUserProfile {
        id: existing
            .as_ref()
            .map(|u| u.id.clone())
            .unwrap_or_else(|| format!("usr_{}", Utc::now().timestamp_millis())),
        name: trimmed_name,
        store_name: payload
            .store_name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|u| u.store_name.clone())
                    .unwrap_or_else(|| "Mi Tienda".to_string())
            }),
        role: payload
            .role
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|u| u.role.clone())
                    .unwrap_or_else(|| "Administrador".to_string())
            }),
        created_at: existing
            .map(|u| u.created_at)
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    let path = config_file_path(&app, LOCAL_USER_FILENAME)
        .ok_or_else(|| "No se pudo resolver app_config_dir".to_string())?;
    let body = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Error serializando perfil local: {e}"))?;
    write_json_secure(&path, &body)?;
    Ok(profile)
}

#[tauri::command]
pub fn clear_local_user<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(path) = config_file_path(&app, LOCAL_USER_FILENAME) {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|e| format!("No se pudo cerrar el perfil local: {e}"))?;
        }
    }
    Ok(())
}

fn read_conversations_vec<R: Runtime>(app: &AppHandle<R>) -> Vec<serde_json::Value> {
    let Some(path) = config_file_path(app, CONVERSATIONS_FILENAME) else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<serde_json::Value>>(&raw).unwrap_or_default()
}

fn write_conversations_vec<R: Runtime>(
    app: &AppHandle<R>,
    items: &[serde_json::Value],
) -> Result<(), String> {
    let path = config_file_path(app, CONVERSATIONS_FILENAME)
        .ok_or_else(|| "No se pudo resolver app_config_dir".to_string())?;
    let body = serde_json::to_string_pretty(items)
        .map_err(|e| format!("Error serializando conversaciones: {e}"))?;
    write_json_secure(&path, &body)
}

#[tauri::command]
pub fn list_conversations<R: Runtime>(app: AppHandle<R>) -> Vec<serde_json::Value> {
    read_conversations_vec(&app)
}

#[tauri::command]
pub fn save_conversation<R: Runtime>(
    app: AppHandle<R>,
    conversation: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let conv_id = conversation
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "La conversación requiere un id válido.".to_string())?
        .to_string();

    let mut list = read_conversations_vec(&app);
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(conv_id.as_str()));
    list.insert(0, conversation);
    if list.len() > MAX_STORED_CONVERSATIONS {
        list.truncate(MAX_STORED_CONVERSATIONS);
    }
    write_conversations_vec(&app, &list)?;
    Ok(list)
}

#[tauri::command]
pub fn delete_conversation<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let mut list = read_conversations_vec(&app);
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    write_conversations_vec(&app, &list)?;
    Ok(list)
}

