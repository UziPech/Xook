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

    let mut child = Command::new("python3")
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python3 sidecar: {e}"))?;

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
        if parsed.get("rpc_callback").and_then(|v| v.as_str()) == Some("run_workspace_command") {
            let req_id = parsed
                .get("request_id")
                .and_then(|v| v.as_str())
                .unwrap_or("cmd_req")
                .to_string();
            let cb_result = handle_command_rpc_callback(app, &parsed, ws_root_param.as_deref());
            let reply_msg = serde_json::json!({
                "rpc_callback_response": "run_workspace_command",
                "request_id": req_id,
                "result": cb_result,
            });
            let reply_line = format!("{reply_msg}\n");
            let _ = child_stdin.write_all(reply_line.as_bytes());
            let _ = child_stdin.flush();
            continue;
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

