//! Lista personal de botones de riesgo. Se suma a `HIGH_RISK_UI_PHRASES`: Xox puede
//! agregarle botones que encuentre, pero solo el usuario puede quitarlos.
//! Decisión del 2026-11-23 en claude/DECISIONES.md.

use super::policy::{detect_high_risk_ui_target, fold_ascii_spanish};
use crate::slices::workspace_manager::sandbox::write_string_atomic;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "risk_buttons.json";
const MAX_PHRASES: usize = 100;

#[derive(Debug, Default, Serialize, Deserialize)]
struct RiskButtonsFile {
    #[serde(default)]
    phrases: Vec<String>,
}

fn file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn fold_words(raw: &str) -> String {
    fold_ascii_spanish(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn normalize_phrase(raw: &str) -> Result<String, String> {
    let folded = fold_words(raw);
    let len = folded.chars().count();
    if !(3..=40).contains(&len) {
        return Err("El texto del botón debe tener entre 3 y 40 letras.".to_string());
    }
    Ok(folded)
}

pub fn load_from(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<RiskButtonsFile>(&raw).ok())
        .map(|file| file.phrases)
        .unwrap_or_default()
}

fn save_to(path: &Path, phrases: Vec<String>) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&RiskButtonsFile { phrases })
        .map_err(|e| format!("No se pudo guardar la lista de botones: {e}"))?;
    write_string_atomic(path, &raw)
}

/// Agrega un botón. Devuelve la frase normalizada y si era nueva.
pub fn add_at(path: &Path, raw: &str) -> Result<(String, bool), String> {
    let phrase = normalize_phrase(raw)?;
    if detect_high_risk_ui_target(&phrase, "").is_some() {
        return Ok((phrase, false));
    }
    let mut phrases = load_from(path);
    if phrases.contains(&phrase) {
        return Ok((phrase, false));
    }
    if phrases.len() >= MAX_PHRASES {
        return Err("La lista de botones de riesgo está llena (100).".to_string());
    }
    phrases.push(phrase.clone());
    save_to(path, phrases)?;
    Ok((phrase, true))
}

pub fn remove_at(path: &Path, raw: &str) -> Result<bool, String> {
    let phrase = fold_words(raw);
    let mut phrases = load_from(path);
    let before = phrases.len();
    phrases.retain(|p| p != &phrase);
    if phrases.len() == before {
        return Ok(false);
    }
    save_to(path, phrases)?;
    Ok(true)
}

/// Frase de la lista personal que aparece completa en el nombre o la descripción del control.
pub fn matching_phrase(phrases: &[String], name: &str, description: &str) -> Option<String> {
    let padded = format!(" {} {} ", fold_words(name), fold_words(description));
    phrases
        .iter()
        .find(|p| padded.contains(&format!(" {p} ")))
        .cloned()
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    file_path(app).map(|p| load_from(&p)).unwrap_or_default()
}

/// Solo existe la vía de agregar para Xox (`mark_risky_button`); quitar es un comando de la interfaz.
pub fn add<R: Runtime>(app: &AppHandle<R>, raw: &str) -> Result<(String, bool), String> {
    let path = file_path(app).ok_or("No se encontró la carpeta de configuración de XOOK.")?;
    add_at(&path, raw)
}

#[tauri::command]
pub fn list_risky_buttons<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    load(&app)
}

#[tauri::command]
pub fn remove_risky_button<R: Runtime>(app: AppHandle<R>, phrase: String) -> Result<bool, String> {
    let path = file_path(&app).ok_or("No se encontró la carpeta de configuración de XOOK.")?;
    remove_at(&path, &phrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xook_risk_{label}_{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join(FILE_NAME)
    }

    #[test]
    fn add_normalizes_dedupes_and_skips_base_phrases() {
        let path = temp_file("add");
        assert_eq!(
            add_at(&path, "  Mandar  ").unwrap(),
            ("mandar".to_string(), true)
        );
        assert_eq!(
            add_at(&path, "MANDAR").unwrap(),
            ("mandar".to_string(), false)
        );
        // "Entregar" ya está en la lista base: no se duplica en la personal.
        assert_eq!(add_at(&path, "Entregar").unwrap().1, false);
        assert!(add_at(&path, "ok").is_err());
        assert_eq!(load_from(&path), vec!["mandar".to_string()]);
    }

    #[test]
    fn matches_whole_words_and_only_user_can_remove() {
        let path = temp_file("match");
        add_at(&path, "Mandar ahora").unwrap();
        let phrases = load_from(&path);
        assert_eq!(
            matching_phrase(&phrases, "Mandar ahora", ""),
            Some("mandar ahora".to_string())
        );
        assert_eq!(matching_phrase(&phrases, "Mandarina", "ahora"), None);

        assert!(remove_at(&path, "Mandar Ahora").unwrap());
        assert!(!remove_at(&path, "mandar ahora").unwrap());
        assert!(load_from(&path).is_empty());
    }
}
