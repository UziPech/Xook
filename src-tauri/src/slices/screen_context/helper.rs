use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::fs;
#[cfg(target_os = "macos")]
use std::io::Read;
#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "macos")]
use std::thread;
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(target_os = "macos")]
const SWIFT_HELPER_SOURCE: &str = include_str!("../../../swift/xook_screen_helper.swift");

#[cfg(target_os = "macos")]
static HELPER_COMPILE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureOutput {
    pub ok: bool,
    pub permission_granted: bool,
    pub accessibility_granted: bool,
    pub blocked_sensitive: bool,
    pub sensitive_reason: Option<String>,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub capture_mode: String,
    pub ocr_text: String,
    pub ax_text: String,
    pub merged_text: String,
    pub image_data_url: Option<String>,
    pub captured_at: String,
    pub error: Option<String>,
}

#[cfg(target_os = "macos")]
fn fnv1a_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(target_os = "macos")]
fn cleanup_stale_helper_binaries(dir: &Path, keep_bin: &Path, keep_src: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p == keep_bin || p == keep_src {
            continue;
        }
        if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
            if name.starts_with("xook_screen_helper_") {
                let _ = fs::remove_file(p);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn ensure_compiled_helper<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("No se pudo resolver app_cache_dir para el lector de pantalla: {e}"))?;
    let helper_dir = cache_root.join("screen_helper");
    fs::create_dir_all(&helper_dir)
        .map_err(|e| format!("No se pudo crear carpeta cache para lector de pantalla: {e}"))?;

    let source_hash = fnv1a_hex(SWIFT_HELPER_SOURCE);
    let bin_path = helper_dir.join(format!("xook_screen_helper_{source_hash}"));
    if bin_path.exists() {
        return Ok(bin_path);
    }

    let lock = HELPER_COMPILE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Bloqueo de compilación de lector de pantalla corrupto.".to_string())?;

    if bin_path.exists() {
        return Ok(bin_path);
    }

    let src_path = helper_dir.join(format!("xook_screen_helper_{source_hash}.swift"));
    fs::write(&src_path, SWIFT_HELPER_SOURCE)
        .map_err(|e| format!("Error escribiendo fuente Swift del lector de pantalla: {e}"))?;

    let output = Command::new("/usr/bin/swiftc")
        .arg("-Onone")
        .arg("-parse-as-library")
        .arg("-o")
        .arg(&bin_path)
        .arg(&src_path)
        .output()
        .map_err(|e| format!("No se pudo invocar swiftc para compilar lector de pantalla: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Error compilando lector de pantalla nativo: {}",
            stderr.trim()
        ));
    }

    let _ = fs::remove_file(&src_path);
    cleanup_stale_binaries_and_keep(&helper_dir, &bin_path, &src_path);
    Ok(bin_path)
}

#[cfg(target_os = "macos")]
fn cleanup_stale_binaries_and_keep(dir: &Path, keep_bin: &Path, keep_src: &Path) {
    cleanup_stale_helper_binaries(dir, keep_bin, keep_src);
}

#[cfg(target_os = "macos")]
fn run_helper_command<R: Runtime>(
    app: &AppHandle<R>,
    args: &[&str],
) -> Result<ScreenCaptureOutput, String> {
    let bin = ensure_compiled_helper(app)?;
    let mut child = Command::new(&bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Error ejecutando lector de pantalla nativo: {e}"))?;

    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo abrir stdout del lector de pantalla.".to_string())?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "No se pudo abrir stderr del lector de pantalla.".to_string())?;

    let stdout_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let stderr_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + Duration::from_secs(6);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Error monitoreando lector de pantalla nativo: {e}"));
            }
        }
    }

    let stdout_bytes = stdout_handle.join().unwrap_or_default();
    let stderr_bytes = stderr_handle.join().unwrap_or_default();

    if timed_out {
        return Err(
            "La lectura de pantalla tardó demasiado (>6s) y fue cancelada para evitar bloqueo."
                .to_string(),
        );
    }

    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        return Err(format!(
            "El lector de pantalla no devolvió respuesta ({}).",
            stderr.trim()
        ));
    }

    serde_json::from_str::<ScreenCaptureOutput>(trimmed)
        .map_err(|e| format!("Respuesta inválida del lector de pantalla: {e}"))
}

#[cfg(not(target_os = "macos"))]
fn run_helper_command<R: Runtime>(
    _app: &AppHandle<R>,
    _args: &[&str],
) -> Result<ScreenCaptureOutput, String> {
    Ok(ScreenCaptureOutput {
        ok: false,
        error: Some("La lectura de pantalla en tiempo real requiere macOS.".to_string()),
        ..Default::default()
    })
}

pub fn check_screen_permission<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ScreenCaptureOutput, String> {
    run_helper_command(app, &["check-permission"])
}

pub fn request_screen_permission<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ScreenCaptureOutput, String> {
    run_helper_command(app, &["request-permission"])
}

pub fn capture_screen_sync<R: Runtime>(
    app: &AppHandle<R>,
    mode: &str,
    include_image: bool,
    max_dim: u32,
) -> Result<ScreenCaptureOutput, String> {
    let mode_norm = if mode.eq_ignore_ascii_case("window") {
        "window"
    } else {
        "display"
    };
    let inc_flag = if include_image { "1" } else { "0" };
    let dim_str = max_dim.clamp(480, 1920).to_string();

    run_helper_command(
        app,
        &[
            "capture",
            "--mode",
            mode_norm,
            "--exclude-title",
            "Xox Quick Bar",
            "--include-image",
            inc_flag,
            "--max-dim",
            &dim_str,
        ],
    )
}

pub fn open_macos_screen_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|e| format!("No se pudo abrir Ajustes del Sistema: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Disponible solo en macOS.".to_string())
    }
}
