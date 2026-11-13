pub mod calendar;
pub mod notes;

use std::io::Write;
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
pub(crate) fn run_static_jxa<T: serde::de::DeserializeOwned>(
    script: &'static str,
    json_arg: &str,
) -> Result<T, String> {
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-", json_arg])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar la automatización del sistema: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(script.as_bytes())
            .map_err(|e| format!("No se pudo enviar la operación al sistema: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Error esperando respuesta del sistema: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(humanize_jxa_error(&stderr, &stdout));
    }

    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("La aplicación no devolvió respuesta.".to_string());
    }
    serde_json::from_str::<T>(trimmed).map_err(|e| {
        format!("No se pudo interpretar la respuesta del sistema ({e}): {trimmed}")
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn run_static_jxa<T: serde::de::DeserializeOwned>(
    _script: &'static str,
    _json_arg: &str,
) -> Result<T, String> {
    Err("La integración directa con Notas y Calendario solo está disponible en macOS por ahora.".to_string())
}

pub fn humanize_jxa_error(stderr: &str, stdout: &str) -> String {
    let combined = format!("{stderr} {stdout}");
    let lower = combined.to_ascii_lowercase();
    if lower.contains("-1743")
        || lower.contains("not authorized to send apple events")
        || lower.contains("no tiene autorización")
        || lower.contains("not permitted")
    {
        return "macOS bloqueó el permiso de Automatización. Actívalo en Ajustes del Sistema -> Privacidad y seguridad -> Automatización para que XOOK pueda interactuar con Notas o Calendario.".to_string();
    }
    if lower.contains("calendar") && (lower.contains("-10000") || lower.contains("access")) {
        return "macOS requiere permiso para acceder a tu Calendario (Ajustes del Sistema -> Privacidad y seguridad -> Calendarios).".to_string();
    }
    let clean = if !stderr.is_empty() { stderr } else { stdout };
    if clean.is_empty() {
        "No se pudo completar la operación en la aplicación del sistema.".to_string()
    } else {
        clean.to_string()
    }
}

