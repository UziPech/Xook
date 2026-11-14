use super::policy::CommandEvaluation;
use crate::slices::host_fs::guard::resolve_user_home;
use crate::slices::task_ledger::store::try_record_audit_event_for_root;
use crate::slices::workspace_manager::sandbox::{resolve_inside_workspace, write_string_atomic};
use chrono::Utc;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

const INLINE_OUTPUT_LIMIT_BYTES: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionDto {
    pub id: String,
    pub conversation_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub purpose: String,
    pub command: String,
    pub cwd_rel: String,
    pub risk_level: String,
    pub permission_mode: String,
    pub matched_rule: Option<String>,
    pub status: String,
    pub exit_code: Option<i64>,
    pub duration_ms: Option<i64>,
    pub log_path: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionResult {
    pub ok: bool,
    pub command_id: String,
    pub status: String,
    pub permission_mode: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub log_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum CommandPermissionDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

impl CommandPermissionDecision {
    pub fn from_str(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "allow_once" | "once" => Ok(Self::AllowOnce),
            "allow_always" | "always" => Ok(Self::AllowAlways),
            "deny" | "reject" => Ok(Self::Deny),
            other => Err(format!("Decisión de permiso desconocida: {other}")),
        }
    }
}

#[derive(Default)]
pub struct CommandPermissionBroker {
    pending: Mutex<HashMap<String, mpsc::SyncSender<CommandPermissionDecision>>>,
}

impl CommandPermissionBroker {
    pub fn register(&self, request_id: &str) -> mpsc::Receiver<CommandPermissionDecision> {
        let (tx, rx) = mpsc::sync_channel(1);
        if let Ok(mut guard) = self.pending.lock() {
            guard.insert(request_id.to_string(), tx);
        }
        rx
    }

    pub fn resolve(
        &self,
        request_id: &str,
        decision: CommandPermissionDecision,
    ) -> Result<(), String> {
        let sender = {
            let mut guard = self
                .pending
                .lock()
                .map_err(|_| "No se pudo bloquear el registro de permisos.".to_string())?;
            guard.remove(request_id)
        };
        let Some(tx) = sender else {
            return Err("La solicitud de permiso ya expiró o fue resuelta.".to_string());
        };
        tx.send(decision)
            .map_err(|_| "El canal del agente ya cerró antes de recibir la decisión.".to_string())
    }

    pub fn remove(&self, request_id: &str) {
        if let Ok(mut guard) = self.pending.lock() {
            guard.remove(request_id);
        }
    }
}

pub fn insert_command_execution(
    conn: &Connection,
    cmd_id: &str,
    conversation_id: Option<&str>,
    tool_call_id: Option<&str>,
    purpose: &str,
    command: &str,
    eval: &CommandEvaluation,
    permission_mode: &str,
    status: &str,
) -> Result<(), String> {
    let now_iso = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO command_executions (
            id, conversation_id, tool_call_id, purpose, command, cwd_rel,
            risk_level, permission_mode, matched_rule, status, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            cmd_id,
            conversation_id,
            tool_call_id,
            purpose,
            command,
            eval.cwd_rel,
            eval.risk_level,
            permission_mode,
            eval.matched_rule,
            status,
            now_iso
        ],
    )
    .map_err(|e| format!("Error registrando command_execution en SQLite: {e}"))?;
    Ok(())
}

pub fn finish_command_execution(
    conn: &Connection,
    cmd_id: &str,
    status: &str,
    permission_mode: Option<&str>,
    exit_code: Option<i32>,
    duration_ms: Option<i64>,
    log_path: Option<&str>,
) -> Result<(), String> {
    let now_iso = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE command_executions
         SET status = ?2,
             permission_mode = COALESCE(?3, permission_mode),
             exit_code = ?4,
             duration_ms = ?5,
             log_path = ?6,
             finished_at = ?7
         WHERE id = ?1",
        params![
            cmd_id,
            status,
            permission_mode,
            exit_code.map(i64::from),
            duration_ms,
            log_path,
            now_iso
        ],
    )
    .map_err(|e| format!("Error actualizando estado de comando en SQLite: {e}"))?;
    Ok(())
}

pub fn list_command_executions(
    conn: &Connection,
    limit: Option<i64>,
) -> Result<Vec<CommandExecutionDto>, String> {
    let lim = limit.unwrap_or(50).clamp(1, 200);
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, tool_call_id, purpose, command, cwd_rel,
                    risk_level, permission_mode, matched_rule, status, exit_code,
                    duration_ms, log_path, created_at, finished_at
             FROM command_executions
             ORDER BY created_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error preparando consulta de comandos: {e}"))?;
    let rows = stmt
        .query_map(params![lim], |row| {
            Ok(CommandExecutionDto {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                tool_call_id: row.get(2)?,
                purpose: row.get(3)?,
                command: row.get(4)?,
                cwd_rel: row.get(5)?,
                risk_level: row.get(6)?,
                permission_mode: row.get(7)?,
                matched_rule: row.get(8)?,
                status: row.get(9)?,
                exit_code: row.get(10)?,
                duration_ms: row.get(11)?,
                log_path: row.get(12)?,
                created_at: row.get(13)?,
                finished_at: row.get(14)?,
            })
        })
        .map_err(|e| format!("Error leyendo command_executions: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando command_executions: {e}"))
}

fn truncate_utf8(raw: &str, max_bytes: usize) -> (String, bool) {
    if raw.len() <= max_bytes {
        return (raw.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !raw.is_char_boundary(end) {
        end -= 1;
    }
    (raw[..end].to_string(), true)
}

pub fn execute_sandboxed_command(
    conn: &Connection,
    workspace_root: &Path,
    cmd_id: &str,
    eval: &CommandEvaluation,
    permission_mode: &str,
    timeout_sec: u64,
) -> CommandExecutionResult {
    let clamped_timeout = timeout_sec.clamp(1, 30);
    let safe_path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".to_string());
    let env_home = if eval.is_external {
        resolve_user_home().unwrap_or_else(|| workspace_root.to_path_buf())
    } else {
        workspace_root.to_path_buf()
    };

    let mut command = if eval.uses_shell {
        #[cfg(target_os = "windows")]
        {
            let mut c = Command::new("cmd");
            c.args(["/C", &eval.raw_command]);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = Command::new("/bin/sh");
            c.args(["-c", &eval.raw_command]);
            c
        }
    } else {
        let mut c = Command::new(&eval.program);
        c.args(&eval.args);
        c
    };
    command
        .current_dir(&eval.cwd_abs)
        .env_clear()
        .env("PATH", safe_path)
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .env("HOME", env_home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let started = Instant::now();
    let mut child = match command.spawn() {
        Ok(ch) => ch,
        Err(err) => {
            let msg = format!("No se pudo ejecutar '{}': {err}", eval.program);
            let _ = finish_command_execution(conn, cmd_id, "failed", Some(permission_mode), None, None, None);
            return CommandExecutionResult {
                ok: false,
                command_id: cmd_id.to_string(),
                status: "failed".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: None,
                duration_ms: 0,
                stdout: String::new(),
                stderr: msg.clone(),
                truncated: false,
                log_path: None,
                error: Some(msg),
            };
        }
    };

    let stdout_handle = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            buf
        })
    });

    let deadline = Duration::from_secs(clamped_timeout);
    let mut timed_out = false;
    let exit_status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if started.elapsed() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break None,
        }
    };

    let duration_ms = started.elapsed().as_millis();
    let stdout_bytes = stdout_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();
    let stderr_bytes = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    let raw_stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    let raw_stderr = String::from_utf8_lossy(&stderr_bytes).to_string();

    let total_bytes = raw_stdout.len() + raw_stderr.len();
    let mut log_path: Option<String> = None;
    if total_bytes > INLINE_OUTPUT_LIMIT_BYTES {
        let rel_log = format!("agente/logs/{cmd_id}.log");
        if let Ok((abs_log, _, _)) = resolve_inside_workspace(workspace_root, &rel_log, false) {
            let log_body = format!(
                "COMMAND: {} {}\nCWD: {}\nSTATUS: {}\n--- STDOUT ---\n{}\n--- STDERR ---\n{}\n",
                eval.program,
                eval.args.join(" "),
                eval.cwd_rel,
                if timed_out { "timeout" } else { "finished" },
                raw_stdout,
                raw_stderr
            );
            if write_string_atomic(&abs_log, &log_body).is_ok() {
                log_path = Some(rel_log);
            }
        }
    }

    let (stdout_preview, trunc_out) = truncate_utf8(&raw_stdout, INLINE_OUTPUT_LIMIT_BYTES);
    let (stderr_preview, trunc_err) = truncate_utf8(&raw_stderr, INLINE_OUTPUT_LIMIT_BYTES);
    let truncated = trunc_out || trunc_err;

    let exit_code = exit_status.and_then(|s| s.code());
    let ok = !timed_out && exit_code == Some(0);
    let status_str = if timed_out {
        "timeout"
    } else if ok {
        "completed"
    } else {
        "failed"
    };

    let _ = finish_command_execution(
        conn,
        cmd_id,
        status_str,
        Some(permission_mode),
        exit_code,
        Some(duration_ms as i64),
        log_path.as_deref(),
    );

    let full_cmd = std::iter::once(eval.program.as_str())
        .chain(eval.args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    let _ = try_record_audit_event_for_root(
        workspace_root,
        "command_guardian",
        if ok { "command_executed" } else { "command_failed" },
        log_path.as_deref().unwrap_or(&eval.cwd_rel),
        "agente",
        Some(&full_cmd),
    );

    let err_msg = if timed_out {
        Some(format!("El comando superó el tiempo máximo de {clamped_timeout}s."))
    } else if !ok && !stderr_preview.trim().is_empty() {
        Some(stderr_preview.clone())
    } else {
        None
    };

    CommandExecutionResult {
        ok,
        command_id: cmd_id.to_string(),
        status: status_str.to_string(),
        permission_mode: permission_mode.to_string(),
        exit_code,
        duration_ms,
        stdout: stdout_preview,
        stderr: stderr_preview,
        truncated,
        log_path,
        error: err_msg,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::command_runner::policy::{PolicyVerdict, evaluate_command};
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;
    use std::fs;

    #[test]
    fn executes_sandboxed_command_clears_env_and_records_log_when_large() {
        let root = std::env::temp_dir().join(format!(
            "xook_cmd_run_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&root).unwrap();
        scaffold_workspace_dir(&root, "ws_run", "Run Test").unwrap();
        let conn = open_workspace_db(&root).unwrap();

        let cmd = "python3 -c \"import os; print('SECRET=' + str(os.environ.get('OPENROUTER_API_KEY'))); print('X' * 5000)\"";
        let eval = evaluate_command(&root, cmd, ".");
        assert_eq!(eval.verdict, PolicyVerdict::Ask);

        insert_command_execution(
            &conn,
            "cmd_t1",
            Some("conv_1"),
            None,
            "Verificar limpieza de entorno",
            cmd,
            &eval,
            "once",
            "running",
        )
        .unwrap();

        let res = execute_sandboxed_command(&conn, &root, "cmd_t1", &eval, "once", 10);
        assert!(res.ok, "stderr: {}", res.stderr);
        assert!(res.stdout.contains("SECRET=None"));
        assert!(res.truncated);
        assert!(res.log_path.is_some());
        assert!(root.join(res.log_path.unwrap()).exists());

        let rows = list_command_executions(&conn, Some(10)).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "completed");

        let _ = fs::remove_dir_all(&root);
    }
}
