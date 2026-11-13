use super::resolver::InstalledApp;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAppOutcome {
    pub launched: bool,
    pub app: InstalledApp,
    pub exit_code: i32,
    pub duration_ms: i64,
    pub message: String,
}

pub fn validate_launchable_bundle_path(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("La ruta de la aplicación está vacía.".to_string());
    }
    let candidate = Path::new(trimmed);
    if !candidate.is_absolute() {
        return Err("La ruta de la aplicación debe ser absoluta.".to_string());
    }
    let canonical = fs::canonicalize(candidate)
        .map_err(|e| format!("No se pudo verificar la ubicación de la aplicación: {e}"))?;
    if !canonical.is_dir() {
        return Err("La aplicación resuelta no es un paquete válido.".to_string());
    }
    let is_app_ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("app"))
        .unwrap_or(false);
    if !is_app_ext {
        return Err("Solo se permite abrir paquetes de aplicación (.app).".to_string());
    }
    let as_str = canonical.to_string_lossy();
    if as_str.starts_with('-') {
        return Err("Ruta de aplicación inválida.".to_string());
    }
    Ok(canonical)
}

pub fn launch_resolved_app(app: &InstalledApp) -> Result<LaunchAppOutcome, String> {
    let validated_path = validate_launchable_bundle_path(&app.app_path)?;
    let started = Instant::now();

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/open")
            .arg(&validated_path)
            .output()
            .map_err(|e| format!("No se pudo abrir '{}': {e}", app.display_name))?;

        let duration_ms = started.elapsed().as_millis() as i64;
        let exit_code = output.status.code().unwrap_or(-1);
        if output.status.success() {
            return Ok(LaunchAppOutcome {
                launched: true,
                app: app.clone(),
                exit_code,
                duration_ms,
                message: format!("Se abrió {}.", app.display_name),
            });
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "El sistema no pudo abrir '{}' (código {exit_code}).",
                app.display_name
            )
        } else {
            format!("No se pudo abrir '{}': {stderr}", app.display_name)
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = started;
        Err("La apertura directa de aplicaciones solo está disponible en macOS por ahora.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn rejects_non_app_paths_and_relative_paths() {
        assert!(validate_launchable_bundle_path("Notes.app").is_err());
        assert!(validate_launchable_bundle_path("").is_err());

        let tmp = std::env::temp_dir().join(format!(
            "xook_launcher_test_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(1)
        ));
        fs::create_dir_all(&tmp).unwrap();
        let file = tmp.join("script.sh");
        fs::write(&file, "#!/bin/sh\necho hi").unwrap();
        assert!(validate_launchable_bundle_path(file.to_str().unwrap()).is_err());

        let app_dir = tmp.join("Demo.app");
        fs::create_dir_all(&app_dir).unwrap();
        assert!(validate_launchable_bundle_path(app_dir.to_str().unwrap()).is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }
}

