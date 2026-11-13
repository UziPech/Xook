use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const VAULT_FILENAME: &str = "ai-vault.json";
const DEFAULT_PROVIDER: &str = "openrouter";
const DEFAULT_MODEL_ID: &str = "openrouter/free";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiVault {
    provider: String,
    model_id: String,
    api_key: Option<String>,
    #[serde(default)]
    custom_models: Vec<String>,
}

impl Default for StoredAiVault {
    fn default() -> Self {
        Self {
            provider: DEFAULT_PROVIDER.to_string(),
            model_id: DEFAULT_MODEL_ID.to_string(),
            api_key: None,
            custom_models: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigPublic {
    pub provider: String,
    pub model_id: String,
    pub has_api_key: bool,
    pub masked_key: Option<String>,
    pub key_source: String, // "vault" | "env" | "none"
    pub custom_models: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiConfigPayload {
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub api_key: Option<String>,
    pub clear_key: Option<bool>,
    pub custom_models: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XoxChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<serde_json::Value>,
    #[serde(default)]
    pub current_tasks: Vec<serde_json::Value>,
    #[serde(default)]
    pub agenda_items: Vec<serde_json::Value>,
    #[serde(default)]
    pub attached_context: Vec<serde_json::Value>,
    pub model_override: Option<String>,
    pub stream_id: Option<String>,
    pub user_profile: Option<serde_json::Value>,
}

fn vault_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(VAULT_FILENAME))
}

fn load_vault<R: Runtime>(app: &AppHandle<R>) -> StoredAiVault {
    let Some(path) = vault_file_path(app) else {
        return StoredAiVault::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return StoredAiVault::default();
    };
    serde_json::from_str::<StoredAiVault>(&raw).unwrap_or_default()
}

fn write_vault<R: Runtime>(app: &AppHandle<R>, vault: &StoredAiVault) -> Result<(), String> {
    let path = vault_file_path(app).ok_or_else(|| "No se pudo resolver app_config_dir".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio de bóveda: {e}"))?;
    }
    let body = serde_json::to_string_pretty(vault)
        .map_err(|e| format!("Error serializando configuración de IA: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("Error escribiendo bóveda local: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.trim().chars().collect();
    let len = chars.len();
    if len <= 8 {
        return "••••".to_string();
    }
    let prefix_len = if key.starts_with("sk-or-v1-") && len > 14 {
        9
    } else {
        4.min(len / 3)
    };
    let prefix: String = chars[..prefix_len].iter().collect();
    let suffix: String = chars[len - 4..].iter().collect();
    format!("{prefix}••••{suffix}")
}

fn normalize_api_key(raw: &str) -> String {
    let mut trimmed = raw
        .trim()
        .trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | ';' | '.'));
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
        trimmed = trimmed[7..]
            .trim()
            .trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | ';' | '.'));
    }
    if let Some(idx) = trimmed.find("sk-or-") {
        let candidate: String = trimmed[idx..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if candidate.len() >= 18 {
            return candidate;
        }
    }
    trimmed.to_string()
}

fn resolve_effective_key(vault: &StoredAiVault) -> (Option<String>, &'static str) {
    if let Some(k) = vault
        .api_key
        .as_deref()
        .map(normalize_api_key)
        .filter(|s| !s.is_empty())
    {
        return (Some(k), "vault");
    }
    if let Ok(env_k) = std::env::var("OPENROUTER_API_KEY") {
        let trimmed = normalize_api_key(&env_k);
        if !trimmed.is_empty() {
            return (Some(trimmed), "env");
        }
    }
    (None, "none")
}

fn to_public_config(vault: &StoredAiVault) -> AiConfigPublic {
    let (key, source) = resolve_effective_key(vault);
    AiConfigPublic {
        provider: vault.provider.clone(),
        model_id: vault.model_id.clone(),
        has_api_key: key.is_some(),
        masked_key: key.as_deref().map(mask_api_key),
        key_source: source.to_string(),
        custom_models: vault.custom_models.clone(),
    }
}

fn find_sidecar_script<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-brain").join("main_sidecar.py"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("src-brain").join("main_sidecar.py"));
        }
    }
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("src-brain").join("main_sidecar.py"));
    }

    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "No se encontró src-brain/main_sidecar.py".to_string())
}

fn call_python_sidecar(
    script_path: &PathBuf,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request = serde_json::json!({
        "id": 1,
        "method": method,
        "params": params,
    });
    let line = format!("{request}\n");

    let mut child = Command::new("python3")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python3 sidecar: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Error enviando solicitud al sidecar: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Error esperando respuesta del sidecar: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout_str.is_empty() {
        return Err(if stderr_str.is_empty() {
            "El sidecar Python devolvió una respuesta vacía.".to_string()
        } else {
            format!("Error del sidecar Python: {stderr_str}")
        });
    }

    let first_line = stdout_str.lines().next().unwrap_or(&stdout_str);
    let parsed: serde_json::Value = serde_json::from_str(first_line)
        .map_err(|e| format!("Respuesta JSON inválida del sidecar: {e}"))?;

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    Ok(parsed.get("result").cloned().unwrap_or(parsed))
}

#[tauri::command]
pub fn get_ai_config<R: Runtime>(app: AppHandle<R>) -> AiConfigPublic {
    let vault = load_vault(&app);
    to_public_config(&vault)
}

#[tauri::command]
pub fn save_ai_config<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveAiConfigPayload,
) -> Result<AiConfigPublic, String> {
    let mut vault = load_vault(&app);

    if let Some(p) = payload.provider {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            vault.provider = trimmed.to_string();
        }
    }

    if let Some(m) = payload.model_id {
        let trimmed = m.trim();
        if !trimmed.is_empty() {
            vault.model_id = trimmed.to_string();
        }
    }

    if let Some(custom) = payload.custom_models {
        vault.custom_models = custom
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    if payload.clear_key.unwrap_or(false) {
        vault.api_key = None;
    } else if let Some(new_key) = payload.api_key {
        let normalized = normalize_api_key(&new_key);
        if !normalized.is_empty() {
            vault.api_key = Some(normalized);
        }
    }

    write_vault(&app, &vault)?;
    Ok(to_public_config(&vault))
}

#[tauri::command]
pub async fn test_ai_connection<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let (maybe_key, _) = resolve_effective_key(&vault);
    let Some(api_key) = maybe_key else {
        return Ok(serde_json::json!({
            "ok": false,
            "message": "No hay una clave API de OpenRouter guardada en la bóveda."
        }));
    };

    let script = find_sidecar_script(&app)?;
    tokio::task::spawn_blocking(move || {
        call_python_sidecar(&script, "test_ai_key", serde_json::json!({ "api_key": api_key }))
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

#[tauri::command]
pub async fn fetch_openrouter_models<R: Runtime>(
    app: AppHandle<R>,
    free_only: Option<bool>,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let (maybe_key, _) = resolve_effective_key(&vault);
    let script = find_sidecar_script(&app)?;
    let only_free = free_only.unwrap_or(false);

    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "list_ai_models",
            serde_json::json!({
                "api_key": maybe_key,
                "free_only": only_free,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

#[tauri::command]
pub async fn run_xox_chat<R: Runtime>(
    app: AppHandle<R>,
    payload: XoxChatRequest,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let (maybe_key, _) = resolve_effective_key(&vault);
    let Some(api_key) = maybe_key else {
        return Err("Falta configurar tu clave API de OpenRouter.".to_string());
    };

    let script = find_sidecar_script(&app)?;
    let model_id = payload
        .model_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| vault.model_id.clone());

    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "ai_chat",
            serde_json::json!({
                "api_key": api_key,
                "model_id": model_id,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

fn call_python_sidecar_streaming<R: Runtime>(
    app: &AppHandle<R>,
    script_path: &PathBuf,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request = serde_json::json!({
        "id": 1,
        "method": "ai_chat_stream",
        "params": params,
    });
    let line = format!("{request}\n");

    let mut child = Command::new("python3")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python3 sidecar: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Error enviando solicitud al sidecar: {e}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo capturar stdout del sidecar.".to_string())?;
    let reader = BufReader::new(stdout);

    let mut final_envelope: Option<serde_json::Value> = None;
    for line_res in reader.lines() {
        let Ok(raw_line) = line_res else {
            continue;
        };
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if parsed.get("stream").and_then(|v| v.as_bool()) == Some(true) {
            let _ = app.emit("xox-chat-stream", &parsed);
        } else {
            final_envelope = Some(parsed);
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando respuesta del sidecar: {e}"))?;

    let mut stderr_str = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        use std::io::Read;
        let _ = stderr.read_to_string(&mut stderr_str);
    }

    let Some(parsed) = final_envelope else {
        let trimmed_err = stderr_str.trim();
        return Err(if trimmed_err.is_empty() {
            format!("El sidecar terminó sin respuesta (estado {status}).")
        } else {
            format!("Error del sidecar Python: {trimmed_err}")
        });
    };

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    Ok(parsed.get("result").cloned().unwrap_or(parsed))
}

#[tauri::command]
pub async fn run_xox_chat_stream<R: Runtime>(
    app: AppHandle<R>,
    payload: XoxChatRequest,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let (maybe_key, _) = resolve_effective_key(&vault);
    let Some(api_key) = maybe_key else {
        return Err("Falta configurar tu clave API de OpenRouter.".to_string());
    };

    let script = find_sidecar_script(&app)?;
    let model_id = payload
        .model_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| vault.model_id.clone());
    let stream_id = payload
        .stream_id
        .unwrap_or_else(|| format!("str_{}", chrono::Utc::now().timestamp_millis()));

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        call_python_sidecar_streaming(
            &app_clone,
            &script,
            serde_json::json!({
                "stream_id": stream_id,
                "api_key": api_key,
                "model_id": model_id,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
                "user_profile": payload.user_profile,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

