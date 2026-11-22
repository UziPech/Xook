//! Evals de proveedores desde la app ("Probar mis modelos" en Ajustes).
//!
//! Las claves salen de la bóveda y llegan al runner de Python (`slices.provider_evals.runner`)
//! por stdin, igual que en `ai_chat`: nunca por variables de entorno, argumentos ni disco.

use serde::Deserialize;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Runtime};

use crate::ai_vault::{
    find_sidecar_script, provider_credentials_for_evals, python_command, resolve_python_executable,
};

const MAX_TARGETS: usize = 10;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProviderEvalsRequest {
    /// `proveedor:modelo`. Vacío = el modelo configurado de cada proveedor con clave.
    #[serde(default)]
    pub targets: Vec<String>,
}

#[tauri::command]
pub async fn run_provider_evals<R: Runtime>(
    app: AppHandle<R>,
    payload: Option<RunProviderEvalsRequest>,
) -> Result<serde_json::Value, String> {
    let credentials = provider_credentials_for_evals(&app);
    if credentials.is_empty() {
        return Err("No hay proveedores con clave en la bóveda.".to_string());
    }
    let script = find_sidecar_script(&app)?;
    let targets: Vec<String> = payload
        .unwrap_or_default()
        .targets
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .take(MAX_TARGETS)
        .collect();

    tokio::task::spawn_blocking(move || run_evals_blocking(&script, &credentials, &targets))
        .await
        .map_err(|e| format!("Las pruebas se interrumpieron: {e}"))?
}

fn run_evals_blocking(
    script: &Path,
    credentials: &serde_json::Map<String, serde_json::Value>,
    targets: &[String],
) -> Result<serde_json::Value, String> {
    let brain_dir = script
        .parent()
        .ok_or_else(|| "No se encontró la carpeta del sidecar.".to_string())?;
    let py_bin = resolve_python_executable(&script.to_path_buf());

    let mut cmd = python_command(&py_bin);
    cmd.current_dir(brain_dir)
        .args(["-m", "slices.provider_evals.runner", "--formato", "json"]);
    for target in targets {
        cmd.arg("--target").arg(target);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar Python ({}): {e}", py_bin.display()))?;

    {
        // Se cierra stdin al salir del bloque: el runner lee hasta EOF.
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "No se pudo abrir la entrada del runner.".to_string())?;
        let body = serde_json::to_vec(credentials)
            .map_err(|e| format!("No se pudieron preparar las credenciales: {e}"))?;
        stdin
            .write_all(&body)
            .map_err(|e| format!("No se pudieron enviar las credenciales al runner: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Error esperando las pruebas: {e}"))?;
    if !output.status.success() {
        let stderr: Vec<char> = String::from_utf8_lossy(&output.stderr).trim().chars().collect();
        let tail: String = stderr[stderr.len().saturating_sub(400)..].iter().collect();
        return Err(format!("Las pruebas fallaron: {tail}"));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Respuesta inválida de las pruebas: {e}"))
}
