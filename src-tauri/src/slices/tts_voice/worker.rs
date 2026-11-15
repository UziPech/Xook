use super::store::{
    inspect_disk_state, load_tts_config, tts_models_dir, TtsDownloadProgress, TtsSpeechAudio,
    TtsStatus,
};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const TTS_DOWNLOAD_EVENT: &str = "tts://download-progress";
pub const TTS_STATUS_EVENT: &str = "tts://status-updated";

struct TtsWorkerHandle {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    pid: u32,
    last_used: Instant,
}

pub struct TtsWorkerState {
    process: Mutex<Option<TtsWorkerHandle>>,
    downloading: AtomicBool,
    reaper_started: AtomicBool,
    req_seq: AtomicU64,
}

impl Default for TtsWorkerState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            downloading: AtomicBool::new(false),
            reaper_started: AtomicBool::new(false),
            req_seq: AtomicU64::new(1),
        }
    }
}

impl Drop for TtsWorkerState {
    fn drop(&mut self) {
        self.kill_worker();
    }
}

struct DownloadResetGuard<'a>(&'a AtomicBool);
impl Drop for DownloadResetGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub fn resolve_tts_python_and_worker<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(PathBuf, PathBuf), String> {
    let sidecar = crate::ai_vault::find_sidecar_script(app)?;
    let py_bin = crate::ai_vault::resolve_python_executable(&sidecar);
    let brain_root = sidecar
        .parent()
        .ok_or_else(|| "No se pudo localizar el directorio src-brain.".to_string())?;
    let worker_script = brain_root
        .join("slices")
        .join("tts_service")
        .join("tts_worker.py");
    if !worker_script.exists() {
        return Err(format!(
            "No se encontró el módulo de voz en {}",
            worker_script.display()
        ));
    }
    Ok((py_bin, worker_script))
}

fn read_pid_rss_mb(pid: u32) -> f64 {
    let Ok(out) = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
    else {
        return 0.0;
    };
    if !out.status.success() {
        return 0.0;
    }
    let kb: f64 = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .unwrap_or(0.0);
    ((kb / 1024.0) * 10.0).round() / 10.0
}

fn terminate_handle(mut handle: TtsWorkerHandle) {
    drop(handle.stdin);
    drop(handle.stdout);
    let _ = handle.child.kill();
    let _ = handle.child.wait();
}

impl TtsWorkerState {
    pub fn is_downloading(&self) -> bool {
        self.downloading.load(Ordering::SeqCst)
    }

    pub fn kill_worker(&self) -> bool {
        let taken = match self.process.lock() {
            Ok(mut guard) => guard.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        if let Some(handle) = taken {
            terminate_handle(handle);
            true
        } else {
            false
        }
    }

    pub fn worker_metrics(&self) -> (bool, f64) {
        let mut guard = match self.process.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(handle) = guard.as_mut() {
            match handle.child.try_wait() {
                Ok(None) => {
                    let rss = read_pid_rss_mb(handle.pid);
                    return (true, rss);
                }
                _ => {
                    if let Some(dead) = guard.take() {
                        terminate_handle(dead);
                    }
                }
            }
        }
        (false, 0.0)
    }

    fn ensure_idle_reaper<R: Runtime>(&self, app: &AppHandle<R>) {
        if self.reaper_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let app_clone = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(20));
            let state = app_clone.state::<TtsWorkerState>();
            let cfg = load_tts_config(&app_clone);
            let idle_limit = Duration::from_secs(cfg.idle_unload_minutes.max(1) * 60);

            let killed = {
                let Ok(mut guard) = state.process.try_lock() else {
                    continue;
                };
                let should_kill = match guard.as_mut() {
                    Some(h) => {
                        let exited = matches!(h.child.try_wait(), Ok(Some(_)) | Err(_));
                        exited || !cfg.enabled || h.last_used.elapsed() >= idle_limit
                    }
                    None => false,
                };
                if should_kill {
                    if let Some(h) = guard.take() {
                        terminate_handle(h);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if killed {
                if let Ok(status) = build_tts_status(&app_clone) {
                    let _ = app_clone.emit(TTS_STATUS_EVENT, &status);
                }
            }
        });
    }

    pub fn synthesize<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        models_dir: &Path,
        text: &str,
        voice_id: &str,
    ) -> Result<TtsSpeechAudio, String> {
        self.ensure_idle_reaper(app);
        let (py_bin, worker_script) = resolve_tts_python_and_worker(app)?;
        let req_id = self.req_seq.fetch_add(1, Ordering::SeqCst);

        let mut guard = self
            .process
            .lock()
            .map_err(|_| "El estado interno del motor de voz quedó bloqueado.".to_string())?;

        if let Some(existing) = guard.as_mut() {
            if !matches!(existing.child.try_wait(), Ok(None)) {
                if let Some(dead) = guard.take() {
                    terminate_handle(dead);
                }
            }
        }

        if guard.is_none() {
            let mut cmd = Command::new(&py_bin);
            cmd.arg(&worker_script)
                .arg("--serve")
                .arg(models_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = cmd
                .spawn()
                .map_err(|e| format!("No se pudo iniciar el motor de voz local: {e}"))?;
            let pid = child.id();
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "No se pudo abrir entrada del motor de voz.".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "No se pudo abrir salida del motor de voz.".to_string())?;
            *guard = Some(TtsWorkerHandle {
                child,
                stdin: BufWriter::new(stdin),
                stdout: BufReader::new(stdout),
                pid,
                last_used: Instant::now(),
            });
        }

        let req_payload = serde_json::json!({
            "id": req_id,
            "method": "synthesize",
            "params": {
                "text": text,
                "voiceId": voice_id,
            }
        });

        let handle = guard
            .as_mut()
            .ok_or_else(|| "El motor de voz no está disponible.".to_string())?;
        let write_res = writeln!(handle.stdin, "{req_payload}")
            .and_then(|_| handle.stdin.flush());
        if let Err(err) = write_res {
            if let Some(dead) = guard.take() {
                terminate_handle(dead);
            }
            return Err(format!("No se pudo enviar texto al motor de voz: {err}"));
        }

        let mut line = String::new();
        loop {
            line.clear();
            let read_res = handle.stdout.read_line(&mut line);
            match read_res {
                Ok(0) => {
                    if let Some(dead) = guard.take() {
                        terminate_handle(dead);
                    }
                    return Err("El motor de voz se cerró inesperadamente.".to_string());
                }
                Ok(_) => {
                    if !line.trim().is_empty() {
                        break;
                    }
                }
                Err(err) => {
                    if let Some(dead) = guard.take() {
                        terminate_handle(dead);
                    }
                    return Err(format!("Error leyendo audio del motor de voz: {err}"));
                }
            }
        }

        handle.last_used = Instant::now();
        let parsed: serde_json::Value = serde_json::from_str(line.trim())
            .map_err(|e| format!("Respuesta inválida del motor de voz: {e}"))?;

        if !parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            let msg = parsed
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("No se pudo generar el audio.");
            return Err(msg.to_string());
        }

        let res_val = parsed
            .get("result")
            .cloned()
            .ok_or_else(|| "El motor de voz no devolvió audio.".to_string())?;
        serde_json::from_value::<TtsSpeechAudio>(res_val)
            .map_err(|e| format!("Formato inesperado de audio generado: {e}"))
    }

    pub fn download_models<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        models_dir: &Path,
        voices: Option<Vec<String>>,
    ) -> Result<(), String> {
        if self.downloading.swap(true, Ordering::SeqCst) {
            return Err("Ya hay una descarga de voces en progreso.".to_string());
        }
        let _guard = DownloadResetGuard(&self.downloading);

        if let Ok(status) = build_tts_status(app) {
            let _ = app.emit(TTS_STATUS_EVENT, &status);
        }

        let (py_bin, worker_script) = resolve_tts_python_and_worker(app)?;
        let mut cmd = Command::new(&py_bin);
        cmd.arg(&worker_script).arg("--download").arg(models_dir);
        if let Some(list) = voices {
            let joined = list.join(",");
            if !joined.trim().is_empty() {
                cmd.arg(joined);
            }
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("No se pudo iniciar la descarga del paquete de voz: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "No se pudo leer el progreso de descarga.".to_string())?;
        let reader = BufReader::new(stdout);
        let mut last_error: Option<String> = None;

        for line in reader.lines() {
            let Ok(raw) = line else { break };
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                continue;
            };
            let event_kind = val.get("event").and_then(|v| v.as_str()).unwrap_or("");
            match event_kind {
                "download_progress" => {
                    let payload = TtsDownloadProgress {
                        progress: val.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        label: val
                            .get("label")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Descargando paquete de voz...")
                            .to_string(),
                        step: val.get("step").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                        total_steps: val.get("totalSteps").and_then(|v| v.as_u64()).unwrap_or(1) as u32,
                        downloaded_bytes: val.get("downloadedBytes").and_then(|v| v.as_u64()).unwrap_or(0),
                        total_bytes: val.get("totalBytes").and_then(|v| v.as_u64()).unwrap_or(0),
                        done: false,
                        error: None,
                    };
                    let _ = app.emit(TTS_DOWNLOAD_EVENT, &payload);
                }
                "download_done" => {
                    let payload = TtsDownloadProgress {
                        progress: 100.0,
                        label: "Paquete de voz instalado".to_string(),
                        step: 1,
                        total_steps: 1,
                        downloaded_bytes: val.get("downloadedBytes").and_then(|v| v.as_u64()).unwrap_or(0),
                        total_bytes: val.get("downloadedBytes").and_then(|v| v.as_u64()).unwrap_or(0),
                        done: true,
                        error: None,
                    };
                    let _ = app.emit(TTS_DOWNLOAD_EVENT, &payload);
                }
                "download_error" => {
                    let err_msg = val
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Error descargando modelos de voz.")
                        .to_string();
                    last_error = Some(err_msg.clone());
                    let payload = TtsDownloadProgress {
                        progress: 0.0,
                        label: "No se pudo completar la descarga".to_string(),
                        step: 0,
                        total_steps: 0,
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        done: true,
                        error: Some(err_msg),
                    };
                    let _ = app.emit(TTS_DOWNLOAD_EVENT, &payload);
                }
                _ => {}
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("Error esperando término de descarga: {e}"))?;
        if !status.success() {
            return Err(last_error.unwrap_or_else(|| {
                "La descarga del paquete de voz no pudo completarse. Revisa tu conexión."
                    .to_string()
            }));
        }
        Ok(())
    }
}

pub fn build_tts_status<R: Runtime>(app: &AppHandle<R>) -> Result<TtsStatus, String> {
    let config = load_tts_config(app);
    let models_dir = tts_models_dir(app)?;
    let (models_installed, model_bytes, voices) = inspect_disk_state(&models_dir);
    let state = app.state::<TtsWorkerState>();
    let (worker_running, worker_rss_mb) = state.worker_metrics();

    Ok(TtsStatus {
        config,
        models_installed,
        model_bytes,
        voices,
        worker_running,
        worker_rss_mb,
        downloading: state.is_downloading(),
    })
}
