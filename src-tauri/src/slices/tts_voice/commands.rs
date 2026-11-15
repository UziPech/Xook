use super::store::{
    delete_models_dir, inspect_disk_state, load_tts_config, save_tts_config, tts_models_dir,
    TtsConfig, TtsSpeechAudio, TtsStatus,
};
use super::worker::{build_tts_status, TtsWorkerState, TTS_STATUS_EVENT};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTtsConfigPayload {
    pub enabled: Option<bool>,
    pub auto_play: Option<bool>,
    pub voice_id: Option<String>,
    pub speed: Option<f32>,
    pub idle_unload_minutes: Option<u64>,
}

fn emit_status<R: Runtime>(app: &AppHandle<R>) -> Result<TtsStatus, String> {
    let status = build_tts_status(app)?;
    let _ = app.emit(TTS_STATUS_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn get_tts_status_cmd<R: Runtime>(app: AppHandle<R>) -> Result<TtsStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || build_tts_status(&app_clone))
        .await
        .map_err(|e| format!("Error consultando el estado de voz: {e}"))?
}

#[tauri::command]
pub async fn save_tts_config_cmd<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveTtsConfigPayload,
) -> Result<TtsStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut cfg = load_tts_config(&app_clone);
        if let Some(enabled) = payload.enabled {
            cfg.enabled = enabled;
        }
        if let Some(auto_play) = payload.auto_play {
            cfg.auto_play = auto_play;
        }
        if let Some(voice_id) = payload.voice_id {
            cfg.voice_id = voice_id;
        }
        if let Some(speed) = payload.speed {
            cfg.speed = speed;
        }
        if let Some(mins) = payload.idle_unload_minutes {
            cfg.idle_unload_minutes = mins;
        }

        let saved: TtsConfig = save_tts_config(&app_clone, &cfg)?;
        if !saved.enabled {
            // Al desactivar la voz, liberar de inmediato el 100% de la RAM del worker
            let worker = app_clone.state::<TtsWorkerState>();
            worker.kill_worker();
        }
        emit_status(&app_clone)
    })
    .await
    .map_err(|e| format!("No se pudo guardar la configuración de voz: {e}"))?
}

#[tauri::command]
pub async fn download_tts_models_cmd<R: Runtime>(
    app: AppHandle<R>,
    voices: Option<Vec<String>>,
) -> Result<TtsStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let models_dir = tts_models_dir(&app_clone)?;
        let worker = app_clone.state::<TtsWorkerState>();
        worker.download_models(&app_clone, &models_dir, voices)?;
        emit_status(&app_clone)
    })
    .await
    .map_err(|e| format!("No se pudo completar la descarga de voz: {e}"))?
}

#[tauri::command]
pub async fn delete_tts_models_cmd<R: Runtime>(app: AppHandle<R>) -> Result<TtsStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let worker = app_clone.state::<TtsWorkerState>();
        worker.kill_worker();
        let models_dir = tts_models_dir(&app_clone)?;
        delete_models_dir(&models_dir)?;

        let mut cfg = load_tts_config(&app_clone);
        if cfg.enabled {
            cfg.enabled = false;
            cfg.auto_play = false;
            let _ = save_tts_config(&app_clone, &cfg);
        }
        emit_status(&app_clone)
    })
    .await
    .map_err(|e| format!("No se pudieron eliminar los archivos de voz: {e}"))?
}

#[tauri::command]
pub async fn unload_tts_worker_cmd<R: Runtime>(app: AppHandle<R>) -> Result<TtsStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let worker = app_clone.state::<TtsWorkerState>();
        worker.kill_worker();
        emit_status(&app_clone)
    })
    .await
    .map_err(|e| format!("No se pudo liberar la memoria del motor de voz: {e}"))?
}

#[tauri::command]
pub async fn synthesize_tts_speech_cmd<R: Runtime>(
    app: AppHandle<R>,
    text: String,
    voice_id: Option<String>,
) -> Result<TtsSpeechAudio, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let cfg = load_tts_config(&app_clone);
        if !cfg.enabled {
            return Err("La voz de Xox está desactivada en Configuraciones.".to_string());
        }
        let models_dir = tts_models_dir(&app_clone)?;
        let (models_installed, _, _) = inspect_disk_state(&models_dir);
        if !models_installed {
            return Err(
                "Primero descarga el paquete de voz local en Configuraciones → Voz.".to_string(),
            );
        }

        let resolved_voice = voice_id
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| cfg.voice_id.clone());

        let worker = app_clone.state::<TtsWorkerState>();
        let audio = worker.synthesize(&app_clone, &models_dir, &text, &resolved_voice)?;
        let _ = emit_status(&app_clone);
        Ok(audio)
    })
    .await
    .map_err(|e| format!("Error generando voz local: {e}"))?
}
