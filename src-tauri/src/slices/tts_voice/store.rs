use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsConfig {
    pub enabled: bool,
    pub auto_play: bool,
    pub voice_id: String,
    pub speed: f32,
    pub idle_unload_minutes: u64,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_play: false,
            voice_id: "lola".to_string(),
            speed: 1.0,
            idle_unload_minutes: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoicePreset {
    pub id: String,
    pub name: String,
    pub gender: String,
    pub description: String,
    pub size_mb: f64,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    pub config: TtsConfig,
    pub models_installed: bool,
    pub model_bytes: u64,
    pub voices: Vec<TtsVoicePreset>,
    pub worker_running: bool,
    pub worker_rss_mb: f64,
    pub downloading: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDownloadProgress {
    pub progress: f64,
    pub label: String,
    pub step: u32,
    pub total_steps: u32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSpeechAudio {
    pub wav_base64: String,
    pub mime_type: String,
    pub duration_ms: u64,
    pub generation_ms: u64,
    pub voice_id: String,
    pub rss_mb: f64,
}

pub const CORE_MODEL_FILES: &[&str] = &[
    "bundle.json",
    "tokenizer.model",
    "text_conditioner_int8.onnx",
    "flow_lm_flow_int8.onnx",
    "mimi_decoder_int8.onnx",
    "flow_lm_main_int8.onnx",
];

struct VoiceMeta {
    id: &'static str,
    name: &'static str,
    gender: &'static str,
    description: &'static str,
    bytes: u64,
}

const VOICE_CATALOG: &[VoiceMeta] = &[
    VoiceMeta {
        id: "lola",
        name: "Lola",
        gender: "Femenina",
        description: "Cálida, expresiva y muy natural",
        bytes: 5_948_664,
    },
    VoiceMeta {
        id: "rafael",
        name: "Rafael",
        gender: "Masculina",
        description: "Clara, firme y equilibrada",
        bytes: 6_194_424,
    },
    VoiceMeta {
        id: "alba",
        name: "Alba",
        gender: "Femenina",
        description: "Suave y profesional",
        bytes: 6_194_424,
    },
    VoiceMeta {
        id: "estelle",
        name: "Estelle",
        gender: "Femenina",
        description: "Cercana y conversacional",
        bytes: 8_258_808,
    },
    VoiceMeta {
        id: "marius",
        name: "Marius",
        gender: "Masculina",
        description: "Profunda y pausada",
        bytes: 6_194_424,
    },
    VoiceMeta {
        id: "jean",
        name: "Jean",
        gender: "Masculina",
        description: "Serena y directa",
        bytes: 6_194_424,
    },
];

pub fn normalize_voice_id(raw: &str) -> String {
    let trimmed = raw.trim().to_ascii_lowercase();
    if VOICE_CATALOG.iter().any(|v| v.id == trimmed) {
        trimmed
    } else {
        "lola".to_string()
    }
}

pub fn tts_config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    Ok(dir.join("tts-settings.json"))
}

pub fn tts_models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver app_data_dir: {e}"))?;
    Ok(dir.join("tts-models").join("spanish"))
}

pub fn load_tts_config<R: Runtime>(app: &AppHandle<R>) -> TtsConfig {
    let Ok(path) = tts_config_path(app) else {
        return TtsConfig::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return TtsConfig::default();
    };
    let mut cfg: TtsConfig = serde_json::from_str(&raw).unwrap_or_default();
    cfg.voice_id = normalize_voice_id(&cfg.voice_id);
    cfg.speed = cfg.speed.clamp(0.8, 1.35);
    cfg.idle_unload_minutes = cfg.idle_unload_minutes.clamp(1, 60);
    cfg
}

pub fn save_tts_config<R: Runtime>(
    app: &AppHandle<R>,
    cfg: &TtsConfig,
) -> Result<TtsConfig, String> {
    let mut clean = cfg.clone();
    clean.voice_id = normalize_voice_id(&clean.voice_id);
    clean.speed = clean.speed.clamp(0.8, 1.35);
    clean.idle_unload_minutes = clean.idle_unload_minutes.clamp(1, 60);

    let path = tts_config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear directorio de configuración: {e}"))?;
    }
    let body = serde_json::to_string_pretty(&clean)
        .map_err(|e| format!("Error serializando configuración de voz: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| format!("No se pudo escribir configuración: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("No se pudo guardar configuración: {e}"))?;
    Ok(clean)
}

pub fn inspect_disk_state(models_dir: &Path) -> (bool, u64, Vec<TtsVoicePreset>) {
    let mut total_bytes: u64 = 0;
    let mut core_ok = true;

    for fname in CORE_MODEL_FILES {
        let p = models_dir.join(fname);
        match fs::metadata(&p) {
            Ok(meta) if meta.len() > 0 => total_bytes += meta.len(),
            _ => core_ok = false,
        }
    }

    let voices_dir = models_dir.join("voices");
    let mut has_any_voice = false;
    let mut voices = Vec::with_capacity(VOICE_CATALOG.len());

    for v in VOICE_CATALOG {
        let vp = voices_dir.join(format!("{}.safetensors", v.id));
        let installed = match fs::metadata(&vp) {
            Ok(meta) if meta.len() > 100_000 => {
                total_bytes += meta.len();
                has_any_voice = true;
                true
            }
            _ => false,
        };
        voices.push(TtsVoicePreset {
            id: v.id.to_string(),
            name: v.name.to_string(),
            gender: v.gender.to_string(),
            description: v.description.to_string(),
            size_mb: ((v.bytes as f64) / (1024.0 * 1024.0) * 10.0).round() / 10.0,
            installed,
        });
    }

    (core_ok && has_any_voice, total_bytes, voices)
}

pub fn delete_models_dir(models_dir: &Path) -> Result<(), String> {
    if models_dir.exists() {
        fs::remove_dir_all(models_dir)
            .map_err(|e| format!("No se pudieron eliminar los archivos locales de voz: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_config_keeps_voice_disabled_with_zero_memory_footprint() {
        let cfg = TtsConfig::default();
        assert!(!cfg.enabled);
        assert!(!cfg.auto_play);
        assert_eq!(cfg.voice_id, "lola");
        assert!((cfg.speed - 1.0).abs() < f32::EPSILON);
        assert_eq!(cfg.idle_unload_minutes, 5);
    }

    #[test]
    fn normalize_voice_falls_back_to_lola() {
        assert_eq!(normalize_voice_id("Rafael"), "rafael");
        assert_eq!(normalize_voice_id("unknown-voice"), "lola");
    }

    #[test]
    fn inspect_disk_state_detects_missing_and_installed_models() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("xook_tts_test_{nanos}"));
        let (installed_empty, bytes_empty, voices_empty) = inspect_disk_state(&tmp);
        assert!(!installed_empty);
        assert_eq!(bytes_empty, 0);
        assert_eq!(voices_empty.len(), 6);

        fs::create_dir_all(tmp.join("voices")).unwrap();
        for fname in CORE_MODEL_FILES {
            fs::write(tmp.join(fname), vec![1u8; 64]).unwrap();
        }
        fs::write(tmp.join("voices").join("lola.safetensors"), vec![2u8; 150_000]).unwrap();

        let (installed_ok, bytes_ok, voices_ok) = inspect_disk_state(&tmp);
        assert!(installed_ok);
        assert!(bytes_ok >= 150_000);
        assert!(voices_ok.iter().find(|v| v.id == "lola").unwrap().installed);
        assert!(!voices_ok.iter().find(|v| v.id == "rafael").unwrap().installed);

        delete_models_dir(&tmp).unwrap();
        assert!(!tmp.exists());
    }
}
