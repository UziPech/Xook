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
    #[serde(default)]
    pub active_canvas: Option<serde_json::Value>,
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

pub(crate) fn find_sidecar_script<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
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

pub(crate) fn resolve_python_executable(script_path: &PathBuf) -> PathBuf {
    if let Ok(explicit) = std::env::var("XOOK_PYTHON") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(script_dir) = script_path.parent() {
        let venv_candidates = [
            script_dir.join(".venv").join("bin").join("python3"),
            script_dir.join(".venv").join("bin").join("python"),
            script_dir.join(".venv").join("Scripts").join("python.exe"),
        ];
        if let Some(found) = venv_candidates.into_iter().find(|p| p.is_file()) {
            return found;
        }
        if let Some(parent_dir) = script_dir.parent() {
            let parent_candidates = [
                parent_dir.join(".venv").join("bin").join("python3"),
                parent_dir.join(".venv").join("Scripts").join("python.exe"),
            ];
            if let Some(found) = parent_candidates.into_iter().find(|p| p.is_file()) {
                return found;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_candidates = [
            cwd.join("src-brain").join(".venv").join("bin").join("python3"),
            cwd.join("src-brain").join(".venv").join("Scripts").join("python.exe"),
        ];
        if let Some(found) = cwd_candidates.into_iter().find(|p| p.is_file()) {
            return found;
        }
    }

    PathBuf::from("python3")
}

pub(crate) fn call_python_sidecar(
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

    let py_bin = resolve_python_executable(script_path);
    let mut child = Command::new(&py_bin)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python sidecar ({}): {e}", py_bin.display()))?;

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
    let workspace_root = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app)
        .map(|p| p.to_string_lossy().to_string());
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
                "workspace_root": workspace_root,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
                "user_profile": payload.user_profile,
                "active_canvas": payload.active_canvas,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

struct BrokerPendingCleanup<'a> {
    broker: &'a crate::slices::command_runner::runner::CommandPermissionBroker,
    request_id: String,
}

impl Drop for BrokerPendingCleanup<'_> {
    fn drop(&mut self) {
        self.broker.remove(&self.request_id);
    }
}

fn handle_command_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{PolicyVerdict, add_or_update_rule, evaluate_command},
        runner::{
            CommandPermissionBroker, CommandPermissionDecision, execute_sandboxed_command,
            finish_command_execution, insert_command_execution,
        },
    };
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cmd_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .unwrap_or("Ejecutar utilidad del workspace")
        .to_string();
    let command = parsed
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cwd = parsed
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or(".")
        .to_string();
    let timeout_sec = parsed
        .get("timeout_sec")
        .and_then(|v| v.as_u64())
        .unwrap_or(20);

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));

    let Some(workspace_root) = root else {
        return serde_json::json!({
            "ok": false,
            "status": "error",
            "error": "No hay un espacio de trabajo activo para ejecutar el comando."
        });
    };

    let Ok(conn) = open_workspace_db(&workspace_root) else {
        return serde_json::json!({
            "ok": false,
            "status": "error",
            "error": "No se pudo abrir la base de datos del espacio de trabajo."
        });
    };

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());
    let eval = evaluate_command(&workspace_root, &command, &cwd);

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "blocked",
                "blocked",
            );
            let _ = finish_command_execution(&conn, &cmd_id, "blocked", Some("blocked"), None, None, None);
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason
            })
        }
        PolicyVerdict::Allow => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "always_rule",
                "running",
            );
            let res = execute_sandboxed_command(
                &conn,
                &workspace_root,
                &cmd_id,
                &eval,
                "always_rule",
                timeout_sec,
            );
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "result": res,
                }),
            );
            if res.log_path.is_some() {
                let _ = app.emit(
                    WORKSPACE_UPDATED_EVENT,
                    serde_json::json!({ "reason": "command_log" }),
                );
            }
            serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
        }
        PolicyVerdict::Ask => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "ask",
                "awaiting_permission",
            );

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": eval.program,
                    "patternSuggestion": eval.pattern_suggestion,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => {
                    let res = execute_sandboxed_command(
                        &conn,
                        &workspace_root,
                        &cmd_id,
                        &eval,
                        "once",
                        timeout_sec,
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "result": res,
                        }),
                    );
                    if res.log_path.is_some() {
                        let _ = app.emit(
                            WORKSPACE_UPDATED_EVENT,
                            serde_json::json!({ "reason": "command_log" }),
                        );
                    }
                    serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
                }
                Ok(CommandPermissionDecision::AllowAlways) => {
                    if let Ok(cfg) = add_or_update_rule(
                        &workspace_root,
                        &eval.pattern_suggestion,
                        "allow",
                        "program",
                        Some(purpose.clone()),
                    ) {
                        let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                        let _ = app.emit(
                            WORKSPACE_UPDATED_EVENT,
                            serde_json::json!({ "reason": "permission_always" }),
                        );
                    }
                    let res = execute_sandboxed_command(
                        &conn,
                        &workspace_root,
                        &cmd_id,
                        &eval,
                        "always",
                        timeout_sec,
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "result": res,
                        }),
                    );
                    serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
                }
                Ok(CommandPermissionDecision::Deny) => {
                    let _ = finish_command_execution(
                        &conn,
                        &cmd_id,
                        "denied",
                        Some("denied"),
                        None,
                        None,
                        None,
                    );
                    let _ = try_record_audit_event_for_root(
                        &workspace_root,
                        "user",
                        "command_denied",
                        &eval.cwd_rel,
                        "agente",
                        Some(&command),
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": "El usuario rechazó ejecutar este comando."
                    })
                }
                Err(_) => {
                    let _ = finish_command_execution(
                        &conn,
                        &cmd_id,
                        "timeout_permission",
                        Some("ask"),
                        None,
                        None,
                        None,
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "status": "denied",
                            "error": "Tiempo de espera agotado para confirmar permiso."
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo."
                    })
                }
            }
        }
    }
}

fn compact_installed_app_json(app: &crate::slices::app_launcher::resolver::InstalledApp) -> serde_json::Value {
    serde_json::json!({
        "displayName": app.display_name,
        "fsName": app.fs_name,
        "bundleId": app.bundle_id,
        "category": app.category,
        "aliases": app.aliases,
    })
}

fn handle_list_apps_rpc_callback(parsed: &serde_json::Value) -> serde_json::Value {
    use crate::slices::app_launcher::resolver::{
        discover_installed_apps, resolve_app_in_catalog, AppResolution,
    };

    let query = parsed
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(25)
        .clamp(1, 60) as usize;

    let catalog = discover_installed_apps();
    if query.is_empty() {
        let items: Vec<serde_json::Value> = catalog
            .iter()
            .take(limit)
            .map(compact_installed_app_json)
            .collect();
        return serde_json::json!({
            "ok": true,
            "total": catalog.len(),
            "apps": items,
        });
    }

    match resolve_app_in_catalog(&catalog, &query) {
        AppResolution::Resolved { app } => serde_json::json!({
            "ok": true,
            "matchType": "exact",
            "apps": [compact_installed_app_json(&app)],
        }),
        AppResolution::Ambiguous { candidates, .. } => serde_json::json!({
            "ok": true,
            "matchType": "ambiguous",
            "apps": candidates.iter().take(limit).map(compact_installed_app_json).collect::<Vec<_>>(),
        }),
        AppResolution::NotFound { suggestions, .. } => serde_json::json!({
            "ok": true,
            "matchType": "suggestions",
            "apps": suggestions.iter().take(limit).map(compact_installed_app_json).collect::<Vec<_>>(),
        }),
        AppResolution::InvalidTarget { reason, .. } => serde_json::json!({
            "ok": false,
            "error": reason,
            "apps": [],
        }),
    }
}

fn execute_and_record_app_launch<R: Runtime>(
    app: &AppHandle<R>,
    conn: Option<&rusqlite::Connection>,
    workspace_root: Option<&std::path::Path>,
    cmd_id: &str,
    request_id: &str,
    stream_id: Option<&str>,
    purpose: &str,
    display_cmd: &str,
    permission_mode: &str,
    eval: &crate::slices::command_runner::policy::CommandEvaluation,
    target_app: &crate::slices::app_launcher::resolver::InstalledApp,
) -> serde_json::Value {
    use crate::slices::app_launcher::launcher::launch_resolved_app;
    use crate::slices::command_runner::runner::{finish_command_execution, CommandExecutionResult};
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;

    match launch_resolved_app(target_app) {
        Ok(outcome) => {
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "finished",
                    Some(permission_mode),
                    Some(outcome.exit_code),
                    Some(outcome.duration_ms),
                    None,
                );
            }
            if let Some(ws_root) = workspace_root {
                let _ = try_record_audit_event_for_root(
                    ws_root,
                    "user",
                    "app_opened",
                    "equipo",
                    "agente",
                    Some(display_cmd),
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: true,
                command_id: cmd_id.to_string(),
                status: "finished".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(outcome.exit_code),
                duration_ms: outcome.duration_ms.max(0) as u128,
                stdout: outcome.message.clone(),
                stderr: String::new(),
                truncated: false,
                log_path: None,
                error: None,
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "finished",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "result": cmd_result,
                }),
            );
            serde_json::json!({
                "ok": true,
                "status": "finished",
                "commandId": cmd_id,
                "permissionMode": permission_mode,
                "app": compact_installed_app_json(target_app),
                "message": outcome.message,
                "durationMs": outcome.duration_ms,
            })
        }
        Err(err_msg) => {
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "error",
                    Some(permission_mode),
                    Some(-1),
                    None,
                    None,
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: false,
                command_id: cmd_id.to_string(),
                status: "error".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(-1),
                duration_ms: 0,
                stdout: String::new(),
                stderr: err_msg.clone(),
                truncated: false,
                log_path: None,
                error: Some(err_msg.clone()),
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "error",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "result": cmd_result,
                    "error": err_msg,
                }),
            );
            serde_json::json!({
                "ok": false,
                "status": "error",
                "commandId": cmd_id,
                "error": err_msg,
            })
        }
    }
}

fn handle_open_app_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::app_launcher::resolver::{
        discover_installed_apps, resolve_app_in_catalog, AppResolution,
    };
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{PolicyVerdict, add_or_update_rule, evaluate_app_launch, make_app_evaluation},
        runner::{
            CommandPermissionBroker, CommandPermissionDecision, finish_command_execution,
            insert_command_execution,
        },
    };
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("app_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let app_name = parsed
        .get("app_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let raw_purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let catalog = discover_installed_apps();
    let target_app = match resolve_app_in_catalog(&catalog, &app_name) {
        AppResolution::Resolved { app } => app,
        AppResolution::Ambiguous { query, candidates } => {
            return serde_json::json!({
                "ok": false,
                "status": "ambiguous",
                "error": format!("Hay varias aplicaciones que coinciden con '{query}'. Pregunta al usuario cuál quiere abrir."),
                "candidates": candidates.iter().map(compact_installed_app_json).collect::<Vec<_>>(),
            });
        }
        AppResolution::NotFound { query, suggestions } => {
            return serde_json::json!({
                "ok": false,
                "status": "not_found",
                "error": format!("No se encontró una aplicación instalada que coincida con '{query}'."),
                "suggestions": suggestions.iter().map(compact_installed_app_json).collect::<Vec<_>>(),
            });
        }
        AppResolution::InvalidTarget { reason, .. } => {
            return serde_json::json!({
                "ok": false,
                "status": "invalid_target",
                "error": reason,
            });
        }
    };

    let purpose = if raw_purpose.is_empty() {
        format!("Abrir la aplicación {}.", target_app.display_name)
    } else {
        raw_purpose
    };
    let display_cmd = format!(
        "open_app: {} ({})",
        target_app.display_name,
        target_app.bundle_id.as_deref().unwrap_or(&target_app.fs_name)
    );

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let conn = root.as_deref().and_then(|r| open_workspace_db(r).ok());

    let eval = if let Some(ref ws_root) = root {
        evaluate_app_launch(
            ws_root,
            target_app.bundle_id.as_deref(),
            &target_app.display_name,
            &target_app.fs_name,
        )
    } else {
        let suggestion = target_app
            .bundle_id
            .as_deref()
            .unwrap_or(&target_app.fs_name);
        make_app_evaluation(
            PolicyVerdict::Ask,
            None,
            "low",
            PathBuf::from("/"),
            suggestion,
            &target_app.fs_name,
        )
    };

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "blocked",
                    "blocked",
                );
                let _ = finish_command_execution(c, &cmd_id, "blocked", Some("blocked"), None, None, None);
            }
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason,
            })
        }
        PolicyVerdict::Allow => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "always_rule",
                    "running",
                );
            }
            execute_and_record_app_launch(
                app,
                conn.as_ref(),
                root.as_deref(),
                &cmd_id,
                &request_id,
                stream_id.as_deref(),
                &purpose,
                &display_cmd,
                "always_rule",
                &eval,
                &target_app,
            )
        }
        PolicyVerdict::Ask => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "ask",
                    "awaiting_permission",
                );
            }

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": target_app.display_name,
                    "patternSuggestion": eval.pattern_suggestion,
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => execute_and_record_app_launch(
                    app,
                    conn.as_ref(),
                    root.as_deref(),
                    &cmd_id,
                    &request_id,
                    stream_id.as_deref(),
                    &purpose,
                    &display_cmd,
                    "once",
                    &eval,
                    &target_app,
                ),
                Ok(CommandPermissionDecision::AllowAlways) => {
                    if let Some(ref ws_root) = root {
                        if let Ok(cfg) = add_or_update_rule(
                            ws_root,
                            &eval.pattern_suggestion,
                            "allow",
                            "app",
                            Some(format!("Abrir {}", target_app.display_name)),
                        ) {
                            let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                            let _ = app.emit(
                                WORKSPACE_UPDATED_EVENT,
                                serde_json::json!({ "reason": "permission_always" }),
                            );
                        }
                    }
                    execute_and_record_app_launch(
                        app,
                        conn.as_ref(),
                        root.as_deref(),
                        &cmd_id,
                        &request_id,
                        stream_id.as_deref(),
                        &purpose,
                        &display_cmd,
                        "always",
                        &eval,
                        &target_app,
                    )
                }
                Ok(CommandPermissionDecision::Deny) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "denied",
                            Some("denied"),
                            None,
                            None,
                            None,
                        );
                    }
                    if let Some(ref ws_root) = root {
                        let _ = try_record_audit_event_for_root(
                            ws_root,
                            "user",
                            "app_open_denied",
                            "equipo",
                            "agente",
                            Some(&display_cmd),
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": "open_app",
                            "purpose": purpose,
                            "command": display_cmd,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                            "appName": target_app.display_name,
                            "bundleId": target_app.bundle_id,
                            "appPath": target_app.app_path,
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": format!("El usuario rechazó abrir '{}'.", target_app.display_name),
                    })
                }
                Err(_) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "timeout_permission",
                            Some("ask"),
                            None,
                            None,
                            None,
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": "open_app",
                            "status": "denied",
                            "appName": target_app.display_name,
                            "bundleId": target_app.bundle_id,
                            "appPath": target_app.app_path,
                            "error": "Tiempo de espera agotado para confirmar permiso.",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo.",
                    })
                }
            }
        }
    }
}

struct CapabilityActionSpec {
    kind: &'static str,
    capability_key: &'static str,
    risk_level: &'static str,
    purpose: String,
    display_cmd: String,
    audit_action: &'static str,
    deny_audit_action: &'static str,
    app_name: &'static str,
    bundle_id: &'static str,
    rule_description: &'static str,
    detail_preview: Option<String>,
}

fn execute_and_record_capability_action<R, F>(
    app: &AppHandle<R>,
    conn: Option<&rusqlite::Connection>,
    workspace_root: Option<&std::path::Path>,
    cmd_id: &str,
    request_id: &str,
    stream_id: Option<&str>,
    permission_mode: &str,
    eval: &crate::slices::command_runner::policy::CommandEvaluation,
    spec: &CapabilityActionSpec,
    action_fn: F,
) -> serde_json::Value
where
    R: Runtime,
    F: FnOnce() -> Result<(serde_json::Value, String), String>,
{
    use crate::slices::command_runner::runner::{finish_command_execution, CommandExecutionResult};
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;

    let started = std::time::Instant::now();
    match action_fn() {
        Ok((payload_val, summary)) => {
            let duration_ms = started.elapsed().as_millis() as i64;
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "finished",
                    Some(permission_mode),
                    Some(0),
                    Some(duration_ms),
                    None,
                );
            }
            if let Some(ws_root) = workspace_root {
                let _ = try_record_audit_event_for_root(
                    ws_root,
                    "user",
                    spec.audit_action,
                    "equipo",
                    "agente",
                    Some(&spec.display_cmd),
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: true,
                command_id: cmd_id.to_string(),
                status: "finished".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(0),
                duration_ms: duration_ms.max(0) as u128,
                stdout: summary,
                stderr: String::new(),
                truncated: false,
                log_path: None,
                error: None,
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "finished",
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "result": cmd_result,
                }),
            );
            payload_val
        }
        Err(err_msg) => {
            let duration_ms = started.elapsed().as_millis() as i64;
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "error",
                    Some(permission_mode),
                    Some(-1),
                    Some(duration_ms),
                    None,
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: false,
                command_id: cmd_id.to_string(),
                status: "error".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(-1),
                duration_ms: duration_ms.max(0) as u128,
                stdout: String::new(),
                stderr: err_msg.clone(),
                truncated: false,
                log_path: None,
                error: Some(err_msg.clone()),
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "error",
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "result": cmd_result,
                    "error": err_msg,
                }),
            );
            serde_json::json!({
                "ok": false,
                "status": "error",
                "commandId": cmd_id,
                "error": err_msg,
            })
        }
    }
}

fn run_capability_gated_action<R, F>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
    spec: CapabilityActionSpec,
    action_fn: F,
) -> serde_json::Value
where
    R: Runtime,
    F: FnOnce() -> Result<(serde_json::Value, String), String>,
{
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{PolicyVerdict, add_or_update_rule, evaluate_capability, make_app_evaluation},
        runner::{
            CommandPermissionBroker, CommandPermissionDecision, finish_command_execution,
            insert_command_execution,
        },
    };
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cap_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let conn = root.as_deref().and_then(|r| open_workspace_db(r).ok());

    let eval = if let Some(ref ws_root) = root {
        evaluate_capability(ws_root, spec.capability_key, spec.risk_level)
    } else {
        make_app_evaluation(
            PolicyVerdict::Ask,
            None,
            spec.risk_level,
            PathBuf::from("/"),
            spec.capability_key,
            spec.capability_key,
        )
    };

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "blocked",
                    "blocked",
                );
                let _ = finish_command_execution(c, &cmd_id, "blocked", Some("blocked"), None, None, None);
            }
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason,
            })
        }
        PolicyVerdict::Allow => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "always_rule",
                    "running",
                );
            }
            execute_and_record_capability_action(
                app,
                conn.as_ref(),
                root.as_deref(),
                &cmd_id,
                &request_id,
                stream_id.as_deref(),
                "always_rule",
                &eval,
                &spec,
                action_fn,
            )
        }
        PolicyVerdict::Ask => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "ask",
                    "awaiting_permission",
                );
            }

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": spec.app_name,
                    "patternSuggestion": spec.capability_key,
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => execute_and_record_capability_action(
                    app,
                    conn.as_ref(),
                    root.as_deref(),
                    &cmd_id,
                    &request_id,
                    stream_id.as_deref(),
                    "once",
                    &eval,
                    &spec,
                    action_fn,
                ),
                Ok(CommandPermissionDecision::AllowAlways) => {
                    if let Some(ref ws_root) = root {
                        if let Ok(cfg) = add_or_update_rule(
                            ws_root,
                            spec.capability_key,
                            "allow",
                            "capability",
                            Some(spec.rule_description.to_string()),
                        ) {
                            let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                            let _ = app.emit(
                                WORKSPACE_UPDATED_EVENT,
                                serde_json::json!({ "reason": "permission_always" }),
                            );
                        }
                    }
                    execute_and_record_capability_action(
                        app,
                        conn.as_ref(),
                        root.as_deref(),
                        &cmd_id,
                        &request_id,
                        stream_id.as_deref(),
                        "always",
                        &eval,
                        &spec,
                        action_fn,
                    )
                }
                Ok(CommandPermissionDecision::Deny) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "denied",
                            Some("denied"),
                            None,
                            None,
                            None,
                        );
                    }
                    if let Some(ref ws_root) = root {
                        let _ = try_record_audit_event_for_root(
                            ws_root,
                            "user",
                            spec.deny_audit_action,
                            "equipo",
                            "agente",
                            Some(&spec.display_cmd),
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": spec.kind,
                            "purpose": spec.purpose,
                            "command": spec.display_cmd,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                            "appName": spec.app_name,
                            "bundleId": spec.bundle_id,
                            "detailPreview": spec.detail_preview,
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": format!("El usuario rechazó esta acción en {}.", spec.app_name),
                    })
                }
                Err(_) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "timeout_permission",
                            Some("ask"),
                            None,
                            None,
                            None,
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": spec.kind,
                            "status": "denied",
                            "appName": spec.app_name,
                            "bundleId": spec.bundle_id,
                            "detailPreview": spec.detail_preview,
                            "error": "Tiempo de espera agotado para confirmar permiso.",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo.",
                    })
                }
            }
        }
    }
}

fn handle_notes_list_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::notes::{list_notes, validate_notes_list_query};

    let query = parsed.get("query").and_then(|v| v.as_str());
    let folder = parsed.get("folder").and_then(|v| v.as_str());
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let validated = validate_notes_list_query(query, folder, limit);

    let mut preview_parts = Vec::new();
    if !validated.query.is_empty() {
        preview_parts.push(format!("Búsqueda: {}", validated.query));
    }
    if let Some(ref f) = validated.folder {
        preview_parts.push(format!("Carpeta: {f}"));
    }
    let display_cmd = if validated.query.is_empty() {
        "os_notes: listar notas".to_string()
    } else {
        format!("os_notes: buscar '{}'", validated.query)
    };
    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Consultar notas existentes en la app Notas de Mac.".to_string());

    let spec = CapabilityActionSpec {
        kind: "os_notes_read",
        capability_key: "notes:read",
        risk_level: "low",
        purpose,
        display_cmd,
        audit_action: "os_notes_read",
        deny_audit_action: "os_notes_read_denied",
        app_name: "Notas",
        bundle_id: "com.apple.Notes",
        rule_description: "Consultar Notas de Mac",
        detail_preview: if preview_parts.is_empty() {
            None
        } else {
            Some(preview_parts.join(" · "))
        },
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = list_notes(&validated)?;
        let summary = format!("Se encontraron {} notas.", out.notes.len());
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_notes_create_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::notes::{create_note, validate_note_create_input};

    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let body = parsed.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let folder = parsed.get("folder").and_then(|v| v.as_str());
    let open_after = parsed
        .get("open_after")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let validated = match validate_note_create_input(title, body, folder, open_after) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let body_excerpt: String = validated
        .body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(140)
        .collect();
    let mut preview = format!("Título: {}", validated.title);
    if let Some(ref f) = validated.folder {
        preview.push_str(&format!("\nCarpeta: {f}"));
    }
    if !body_excerpt.is_empty() {
        preview.push_str(&format!("\nContenido: {body_excerpt}"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Crear nota '{}' en Notas.", validated.title));

    let spec = CapabilityActionSpec {
        kind: "os_notes_write",
        capability_key: "notes:write",
        risk_level: "medium",
        purpose,
        display_cmd: format!("os_notes: crear '{}'", validated.title),
        audit_action: "os_note_created",
        deny_audit_action: "os_note_create_denied",
        app_name: "Notas",
        bundle_id: "com.apple.Notes",
        rule_description: "Crear notas en Notas de Mac",
        detail_preview: Some(preview),
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = create_note(&validated)?;
        let summary = out
            .message
            .clone()
            .unwrap_or_else(|| format!("Se creó la nota '{}'.", out.title));
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_calendar_list_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::calendar::{
        list_calendar_events, validate_calendar_list_query,
    };

    let start_iso = parsed.get("start_iso").and_then(|v| v.as_str());
    let end_iso = parsed.get("end_iso").and_then(|v| v.as_str());
    let calendar_name = parsed.get("calendar_name").and_then(|v| v.as_str());
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);

    let validated = match validate_calendar_list_query(start_iso, end_iso, calendar_name, limit) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let mut preview = format!("Rango: {} → {}", validated.start_label, validated.end_label);
    if let Some(ref c) = validated.calendar_name {
        preview.push_str(&format!("\nCalendario: {c}"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Consultar eventos en Calendario ({} → {}).",
                validated.start_label, validated.end_label
            )
        });

    let spec = CapabilityActionSpec {
        kind: "os_calendar_read",
        capability_key: "calendar:read",
        risk_level: "low",
        purpose,
        display_cmd: format!(
            "os_calendar: consultar ({} → {})",
            validated.start_label, validated.end_label
        ),
        audit_action: "os_calendar_read",
        deny_audit_action: "os_calendar_read_denied",
        app_name: "Calendario",
        bundle_id: "com.apple.iCal",
        rule_description: "Consultar eventos en Calendario de Mac",
        detail_preview: Some(preview),
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = list_calendar_events(&validated)?;
        let summary = format!(
            "Se consultaron {} calendarios y {} eventos.",
            out.calendars.len(),
            out.events.len()
        );
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_calendar_create_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::calendar::{
        create_calendar_event, validate_calendar_create_input,
    };

    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let start_iso = parsed
        .get("start_iso")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let end_iso = parsed.get("end_iso").and_then(|v| v.as_str());
    let all_day = parsed
        .get("all_day")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let calendar_name = parsed.get("calendar_name").and_then(|v| v.as_str());
    let location = parsed.get("location").and_then(|v| v.as_str());
    let description = parsed.get("description").and_then(|v| v.as_str());
    let reminder_minutes_before = parsed
        .get("reminder_minutes_before")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32);
    let open_after = parsed
        .get("open_after")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let validated = match validate_calendar_create_input(
        title,
        start_iso,
        end_iso,
        all_day,
        calendar_name,
        location,
        description,
        reminder_minutes_before,
        open_after,
    ) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let mut preview = if validated.all_day {
        format!("Evento: {}\nCuándo: {}", validated.title, validated.start_label)
    } else {
        format!(
            "Evento: {}\nHorario: {} → {}",
            validated.title, validated.start_label, validated.end_label
        )
    };
    if let Some(ref cal) = validated.calendar_name {
        preview.push_str(&format!("\nCalendario: {cal}"));
    }
    if let Some(ref loc) = validated.location {
        preview.push_str(&format!("\nLugar: {loc}"));
    }
    if let Some(mins) = validated.reminder_minutes_before {
        preview.push_str(&format!("\nAlerta: {mins} min antes"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Agendar '{}' en Calendario ({}).",
                validated.title, validated.start_label
            )
        });

    let spec = CapabilityActionSpec {
        kind: "os_calendar_write",
        capability_key: "calendar:write",
        risk_level: "medium",
        purpose,
        display_cmd: format!(
            "os_calendar: agendar '{}' ({})",
            validated.title, validated.start_label
        ),
        audit_action: "os_calendar_event_created",
        deny_audit_action: "os_calendar_event_denied",
        app_name: "Calendario",
        bundle_id: "com.apple.iCal",
        rule_description: "Crear eventos en Calendario de Mac",
        detail_preview: Some(preview),
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = create_calendar_event(&validated)?;
        let summary = out
            .message
            .clone()
            .unwrap_or_else(|| format!("Se agendó '{}'.", out.title));
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn call_python_sidecar_streaming<R: Runtime>(
    app: &AppHandle<R>,
    script_path: &PathBuf,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let ws_root_param = params
        .get("workspace_root")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let request = serde_json::json!({
        "id": 1,
        "method": "ai_chat_stream",
        "params": params,
    });
    let line = format!("{request}\n");

    let py_bin = resolve_python_executable(script_path);
    let mut child = Command::new(&py_bin)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python sidecar ({}): {e}", py_bin.display()))?;

    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "No se pudo capturar stdin del sidecar.".to_string())?;
    child_stdin
        .write_all(line.as_bytes())
        .and_then(|_| child_stdin.flush())
        .map_err(|e| format!("Error enviando solicitud al sidecar: {e}"))?;

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
        if let Some(cb_name) = parsed.get("rpc_callback").and_then(|v| v.as_str()) {
            let ws_ref = ws_root_param.as_deref();
            let cb_result_opt = match cb_name {
                "run_workspace_command" => Some(handle_command_rpc_callback(app, &parsed, ws_ref)),
                "list_installed_apps" => Some(handle_list_apps_rpc_callback(&parsed)),
                "open_desktop_app" => Some(handle_open_app_rpc_callback(app, &parsed, ws_ref)),
                "os_notes_list" => Some(handle_notes_list_rpc_callback(app, &parsed, ws_ref)),
                "os_notes_create" => Some(handle_notes_create_rpc_callback(app, &parsed, ws_ref)),
                "os_calendar_list" => Some(handle_calendar_list_rpc_callback(app, &parsed, ws_ref)),
                "os_calendar_create_event" => {
                    Some(handle_calendar_create_rpc_callback(app, &parsed, ws_ref))
                }
                _ => None,
            };
            if let Some(cb_result) = cb_result_opt {
                let req_id = parsed
                    .get("request_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("rpc_req")
                    .to_string();
                let reply_msg = serde_json::json!({
                    "rpc_callback_response": cb_name,
                    "request_id": req_id,
                    "result": cb_result,
                });
                let reply_line = format!("{reply_msg}\n");
                let _ = child_stdin.write_all(reply_line.as_bytes());
                let _ = child_stdin.flush();
                continue;
            }
        }
        if parsed.get("stream").and_then(|v| v.as_bool()) == Some(true) {
            if parsed
                .get("event")
                .and_then(|e| e.get("type"))
                .and_then(|t| t.as_str())
                == Some("workspace_changed")
            {
                let _ = app.emit(
                    crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
                    parsed.get("event").unwrap(),
                );
            }
            let _ = app.emit("xox-chat-stream", &parsed);
        } else {
            final_envelope = Some(parsed);
            break;
        }
    }
    drop(child_stdin);

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

    let result_val = parsed.get("result").cloned().unwrap_or(parsed);
    if result_val
        .get("workspace_mutated")
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        let _ = app.emit(
            crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
            serde_json::json!({ "reason": "agent_tools" }),
        );
    }
    Ok(result_val)
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
    let workspace_root = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app)
        .map(|p| p.to_string_lossy().to_string());
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
                "workspace_root": workspace_root,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
                "user_profile": payload.user_profile,
                "active_canvas": payload.active_canvas,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

