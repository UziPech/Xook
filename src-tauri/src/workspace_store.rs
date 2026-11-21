use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const LOCAL_USER_FILENAME: &str = "local-user.json";
const USER_MEMORY_FILENAME: &str = "user-memory.json";
const CONVERSATIONS_FILENAME: &str = "conversations.json";
const MAX_STORED_CONVERSATIONS: usize = 100;
const MAX_USER_MEMORY_FACTS: usize = 120;
const MAX_USER_MEMORY_VALUE_CHARS: usize = 400;
const MAX_PROFILE_FIELD_CHARS: usize = 240;
const MAX_PROFILE_NOTES_CHARS: usize = 600;

pub const LOCAL_USER_UPDATED_EVENT: &str = "xook-local-user-updated";
pub const USER_MEMORY_UPDATED_EVENT: &str = "xook-user-memory-updated";

fn user_data_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn conversations_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUserProfile {
    pub id: String,
    pub name: String,
    pub store_name: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferred_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work_context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalUserPayload {
    pub name: String,
    #[serde(default)]
    pub store_name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub preferred_name: Option<String>,
    #[serde(default)]
    pub occupation: Option<String>,
    #[serde(default)]
    pub work_context: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchLocalUserPayload {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "store_name")]
    pub store_name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default, alias = "preferred_name")]
    pub preferred_name: Option<String>,
    #[serde(default)]
    pub occupation: Option<String>,
    #[serde(default, alias = "work_context")]
    pub work_context: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoryFact {
    pub id: String,
    pub key: String,
    pub category: String,
    pub value: String,
    pub scope: String,
    pub source_window: String,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoryStore {
    #[serde(default = "default_memory_version")]
    pub version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub facts: Vec<UserMemoryFact>,
}

fn default_memory_version() -> u32 {
    1
}

impl Default for UserMemoryStore {
    fn default() -> Self {
        Self {
            version: 1,
            updated_at: String::new(),
            facts: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertUserMemoryFactPayload {
    pub value: String,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default, alias = "source_window")]
    pub source_window: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

fn config_file_path<R: Runtime>(app: &AppHandle<R>, filename: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(filename))
}

fn backup_path_for(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.bak", path.to_string_lossy()))
}

fn apply_secure_perms(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Ruta inválida sin directorio padre.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("No se pudo crear el directorio local: {e}"))?;

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("xook_store.json");
    let tmp_path = parent.join(format!(".{file_name}.tmp.{}.{nanos}", std::process::id()));

    {
        let mut f = File::create(&tmp_path)
            .map_err(|e| format!("Error creando temporal local: {e}"))?;
        if let Err(err) = f.write_all(bytes) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Error escribiendo datos locales: {err}"));
        }
        let _ = f.sync_all();
    }
    apply_secure_perms(&tmp_path);
    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Error confirmando escritura local: {err}"));
    }
    apply_secure_perms(path);
    Ok(())
}

fn write_json_atomic(path: &Path, content: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| format!("JSON inválido antes de guardar: {e}"))?;

    if path.is_file() {
        if let Ok(prev) = fs::read_to_string(path) {
            if serde_json::from_str::<serde_json::Value>(&prev).is_ok() {
                let bak = backup_path_for(path);
                let _ = write_bytes_atomic(&bak, prev.as_bytes());
            }
        }
    }
    write_bytes_atomic(path, content.as_bytes())
}

fn read_json_with_backup<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if let Ok(raw) = fs::read_to_string(path) {
        if let Ok(parsed) = serde_json::from_str::<T>(&raw) {
            return Some(parsed);
        }
    }
    let bak = backup_path_for(path);
    let raw_bak = fs::read_to_string(bak).ok()?;
    serde_json::from_str::<T>(&raw_bak).ok()
}

fn count_matching_prefix(rest: &str, allowed: fn(char) -> bool) -> usize {
    rest.chars().take_while(|&ch| allowed(ch)).count()
}

fn is_token_char_alnum_dash_us(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'
}

fn is_token_char_alnum_us(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn is_token_char_alnum(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
}

fn is_upper_alnum(ch: char) -> bool {
    ch.is_ascii_uppercase() || ch.is_ascii_digit()
}

fn is_bearer_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-'
}

fn starts_at_boundary(text: &str, idx: usize) -> bool {
    if idx == 0 {
        return true;
    }
    text[..idx]
        .chars()
        .next_back()
        .map(|prev| !prev.is_ascii_alphanumeric() && prev != '_')
        .unwrap_or(true)
}

pub fn contains_secret_material(text: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    if lower.contains("-----begin ") && lower.contains("private key-----") {
        return true;
    }

    for (idx, _) in lower.char_indices() {
        if !starts_at_boundary(&lower, idx) {
            continue;
        }
        let slice_orig = &text[idx..];
        let slice_low = &lower[idx..];

        if let Some(after) = slice_low.strip_prefix("sk-or-") {
            if count_matching_prefix(after, is_token_char_alnum_dash_us) >= 10 {
                return true;
            }
        }
        for pref in ["sk-ant-", "sk-proj-", "sk-live-", "sk-test-", "sk-svcacct-"] {
            if let Some(after) = slice_low.strip_prefix(pref) {
                if count_matching_prefix(after, is_token_char_alnum_dash_us) >= 12 {
                    return true;
                }
            }
        }
        if let Some(after) = slice_low.strip_prefix("sk-") {
            if count_matching_prefix(after, is_token_char_alnum) >= 20 {
                return true;
            }
        }
        if let Some(after) = slice_low.strip_prefix("github_pat_") {
            if count_matching_prefix(after, is_token_char_alnum_us) >= 20 {
                return true;
            }
        }
        for pref in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"] {
            if let Some(after) = slice_low.strip_prefix(pref) {
                if count_matching_prefix(after, is_token_char_alnum) >= 16 {
                    return true;
                }
            }
        }
        if let Some(after) = slice_orig.strip_prefix("AIza") {
            if count_matching_prefix(after, is_token_char_alnum_dash_us) >= 20 {
                return true;
            }
        }
        if let Some(after) = slice_orig.strip_prefix("AKIA") {
            if count_matching_prefix(after, is_upper_alnum) >= 16 {
                return true;
            }
        }
        if let Some(after) = slice_low.strip_prefix("gsk_") {
            if count_matching_prefix(after, is_token_char_alnum) >= 20 {
                return true;
            }
        }
        for pref in ["xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-"] {
            if let Some(after) = slice_low.strip_prefix(pref) {
                if count_matching_prefix(after, is_token_char_alnum_dash_us) >= 12 {
                    return true;
                }
            }
        }
        if slice_low.starts_with("bearer ") {
            let after = slice_orig["bearer ".len()..].trim_start();
            if count_matching_prefix(after, is_bearer_token_char) >= 20 {
                return true;
            }
        }
    }
    false
}

fn sanitize_optional_profile_field(
    incoming: Option<String>,
    existing: Option<String>,
    max_chars: usize,
) -> Result<Option<String>, String> {
    let Some(raw) = incoming else {
        return Ok(existing);
    };
    let clean = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        return Ok(None);
    }
    if contains_secret_material(&clean) {
        return Err(
            "Por seguridad, no se guardan claves API, tokens ni llaves privadas en el perfil."
                .to_string(),
        );
    }
    let clipped: String = clean.chars().take(max_chars).collect();
    Ok(Some(clipped.trim().to_string()))
}

fn normalize_category(raw: Option<&str>) -> String {
    let clean = raw.unwrap_or("other").trim().to_ascii_lowercase();
    match clean.as_str() {
        "identity" | "identidad" | "perfil" | "nombre" => "identity".to_string(),
        "preference" | "preferencia" | "preferencias" | "estilo" => "preference".to_string(),
        "work" | "trabajo" | "rol" | "oficio" | "negocio" => "work".to_string(),
        "contact" | "contacto" | "equipo" | "persona" => "contact".to_string(),
        "routine" | "rutina" | "horario" | "agenda" => "routine".to_string(),
        "project" | "proyecto" | "meta" => "project".to_string(),
        "other" | "otro" | "general" => "other".to_string(),
        _ => "other".to_string(),
    }
}

fn normalize_scope(raw: Option<&str>) -> String {
    if raw
        .map(|s| s.trim().eq_ignore_ascii_case("workspace"))
        .unwrap_or(false)
    {
        "workspace".to_string()
    } else {
        "global".to_string()
    }
}

fn normalize_source_window(raw: Option<&str>) -> String {
    match raw.unwrap_or("main").trim().to_ascii_lowercase().as_str() {
        "quick" => "quick".to_string(),
        "document" => "document".to_string(),
        "settings" => "settings".to_string(),
        _ => "main".to_string(),
    }
}

fn ascii_fold_char(ch: char) -> char {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' | 'Á' | 'À' | 'Ä' | 'Â' | 'Ã' | 'Å' => 'a',
        'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
        'ñ' | 'Ñ' => 'n',
        _ => ch.to_ascii_lowercase(),
    }
}

pub fn normalize_memory_key(raw_key: Option<&str>, category: &str, value: &str) -> String {
    let custom = raw_key.unwrap_or("").trim();
    let value_preview: String = value.chars().take(48).collect();
    let base = if custom.is_empty() {
        format!("{category}_{value_preview}")
    } else {
        custom.to_string()
    };

    let mut slug = String::new();
    let mut prev_sep = true;
    for raw_ch in base.chars() {
        let ch = ascii_fold_char(raw_ch);
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_sep = false;
        } else if (ch == '-' || !prev_sep) && !slug.is_empty() {
            let push_ch = if ch == '-' { '-' } else { '_' };
            if !prev_sep || push_ch == '-' && !slug.ends_with('-') && !slug.ends_with('_') {
                slug.push(push_ch);
                prev_sep = true;
            }
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let trimmed = slug.trim_matches(['_', '-']).to_string();
    if trimmed.is_empty() {
        format!("{category}_item")
    } else {
        trimmed
    }
}

fn fnv1a_hex(text: &str) -> String {
    let mut hash: u32 = 2_166_136_261;
    for b in text.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("umem_{hash:x}")
}

pub fn get_local_user_in(config_dir: &Path) -> Option<LocalUserProfile> {
    let _guard = user_data_lock().lock().ok();
    let path = config_dir.join(LOCAL_USER_FILENAME);
    read_json_with_backup::<LocalUserProfile>(&path)
}

pub fn save_local_user_in(
    config_dir: &Path,
    payload: SaveLocalUserPayload,
) -> Result<LocalUserProfile, String> {
    let _guard = user_data_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de usuario.".to_string())?;

    let trimmed_name = payload.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed_name.is_empty() {
        return Err("Escribe tu nombre para crear el perfil local.".to_string());
    }
    if contains_secret_material(&trimmed_name) {
        return Err("El nombre no puede contener credenciales ni tokens.".to_string());
    }

    let path = config_dir.join(LOCAL_USER_FILENAME);
    let existing = read_json_with_backup::<LocalUserProfile>(&path);
    let now = Utc::now().to_rfc3339();

    let store_name = match payload.store_name {
        Some(raw) => {
            let s = raw.trim().to_string();
            if contains_secret_material(&s) {
                return Err("El nombre del negocio no puede contener claves o tokens.".to_string());
            }
            if s.is_empty() {
                existing
                    .as_ref()
                    .map(|u| u.store_name.clone())
                    .unwrap_or_else(|| "Mi Tienda".to_string())
            } else {
                s
            }
        }
        None => existing
            .as_ref()
            .map(|u| u.store_name.clone())
            .unwrap_or_else(|| "Mi Tienda".to_string()),
    };

    let role = match payload.role {
        Some(raw) => {
            let s = raw.trim().to_string();
            if contains_secret_material(&s) {
                return Err("El rol no puede contener claves o tokens.".to_string());
            }
            if s.is_empty() {
                existing
                    .as_ref()
                    .map(|u| u.role.clone())
                    .unwrap_or_else(|| "Administrador".to_string())
            } else {
                s
            }
        }
        None => existing
            .as_ref()
            .map(|u| u.role.clone())
            .unwrap_or_else(|| "Administrador".to_string()),
    };

    let preferred_name = sanitize_optional_profile_field(
        payload.preferred_name,
        existing.as_ref().and_then(|u| u.preferred_name.clone()),
        80,
    )?;
    let occupation = sanitize_optional_profile_field(
        payload.occupation,
        existing.as_ref().and_then(|u| u.occupation.clone()),
        MAX_PROFILE_FIELD_CHARS,
    )?;
    let work_context = sanitize_optional_profile_field(
        payload.work_context,
        existing.as_ref().and_then(|u| u.work_context.clone()),
        MAX_PROFILE_FIELD_CHARS,
    )?;
    let language = sanitize_optional_profile_field(
        payload.language,
        existing.as_ref().and_then(|u| u.language.clone()),
        64,
    )?;
    let timezone = sanitize_optional_profile_field(
        payload.timezone,
        existing.as_ref().and_then(|u| u.timezone.clone()),
        64,
    )?;
    let notes = sanitize_optional_profile_field(
        payload.notes,
        existing.as_ref().and_then(|u| u.notes.clone()),
        MAX_PROFILE_NOTES_CHARS,
    )?;

    let profile = LocalUserProfile {
        id: existing
            .as_ref()
            .map(|u| u.id.clone())
            .unwrap_or_else(|| format!("usr_{}", Utc::now().timestamp_millis())),
        name: trimmed_name,
        store_name,
        role,
        created_at: existing.map(|u| u.created_at).unwrap_or_else(|| now.clone()),
        updated_at: now,
        preferred_name,
        occupation,
        work_context,
        language,
        timezone,
        notes,
    };

    let body = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Error serializando perfil local: {e}"))?;
    write_json_atomic(&path, &body)?;
    Ok(profile)
}

pub fn patch_local_user_in(
    config_dir: &Path,
    patch: PatchLocalUserPayload,
) -> Result<LocalUserProfile, String> {
    let _guard = user_data_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de usuario.".to_string())?;

    let path = config_dir.join(LOCAL_USER_FILENAME);
    let existing = read_json_with_backup::<LocalUserProfile>(&path);
    let now = Utc::now().to_rfc3339();

    let resolved_name = match patch.name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => {
            if contains_secret_material(n) {
                return Err("El nombre no puede contener credenciales ni tokens.".to_string());
            }
            n.split_whitespace().collect::<Vec<_>>().join(" ")
        }
        None => match existing.as_ref() {
            Some(u) => u.name.clone(),
            None => match patch
                .preferred_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(pn) => {
                    if contains_secret_material(pn) {
                        return Err("El nombre no puede contener credenciales ni tokens.".to_string());
                    }
                    pn.split_whitespace().collect::<Vec<_>>().join(" ")
                }
                None => {
                    return Err(
                        "Aún no existe un perfil local con nombre para actualizar.".to_string(),
                    );
                }
            },
        },
    };

    let store_name = match patch.store_name {
        Some(raw) => {
            let s = raw.trim().to_string();
            if contains_secret_material(&s) {
                return Err("El negocio no puede contener claves o tokens.".to_string());
            }
            if s.is_empty() {
                existing
                    .as_ref()
                    .map(|u| u.store_name.clone())
                    .unwrap_or_else(|| "Mi Tienda".to_string())
            } else {
                s
            }
        }
        None => existing
            .as_ref()
            .map(|u| u.store_name.clone())
            .unwrap_or_else(|| "Mi Tienda".to_string()),
    };

    let role = match patch.role {
        Some(raw) => {
            let s = raw.trim().to_string();
            if contains_secret_material(&s) {
                return Err("El rol no puede contener claves o tokens.".to_string());
            }
            if s.is_empty() {
                existing
                    .as_ref()
                    .map(|u| u.role.clone())
                    .unwrap_or_else(|| "Administrador".to_string())
            } else {
                s
            }
        }
        None => existing
            .as_ref()
            .map(|u| u.role.clone())
            .unwrap_or_else(|| "Administrador".to_string()),
    };

    let preferred_name = sanitize_optional_profile_field(
        patch.preferred_name,
        existing.as_ref().and_then(|u| u.preferred_name.clone()),
        80,
    )?;
    let occupation = sanitize_optional_profile_field(
        patch.occupation,
        existing.as_ref().and_then(|u| u.occupation.clone()),
        MAX_PROFILE_FIELD_CHARS,
    )?;
    let work_context = sanitize_optional_profile_field(
        patch.work_context,
        existing.as_ref().and_then(|u| u.work_context.clone()),
        MAX_PROFILE_FIELD_CHARS,
    )?;
    let language = sanitize_optional_profile_field(
        patch.language,
        existing.as_ref().and_then(|u| u.language.clone()),
        64,
    )?;
    let timezone = sanitize_optional_profile_field(
        patch.timezone,
        existing.as_ref().and_then(|u| u.timezone.clone()),
        64,
    )?;
    let notes = sanitize_optional_profile_field(
        patch.notes,
        existing.as_ref().and_then(|u| u.notes.clone()),
        MAX_PROFILE_NOTES_CHARS,
    )?;

    let profile = LocalUserProfile {
        id: existing
            .as_ref()
            .map(|u| u.id.clone())
            .unwrap_or_else(|| format!("usr_{}", Utc::now().timestamp_millis())),
        name: resolved_name,
        store_name,
        role,
        created_at: existing.map(|u| u.created_at).unwrap_or_else(|| now.clone()),
        updated_at: now,
        preferred_name,
        occupation,
        work_context,
        language,
        timezone,
        notes,
    };

    let body = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Error serializando perfil local: {e}"))?;
    write_json_atomic(&path, &body)?;
    Ok(profile)
}

pub fn patch_local_user_sync<R: Runtime>(
    app: &AppHandle<R>,
    patch: PatchLocalUserPayload,
) -> Result<LocalUserProfile, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    let profile = patch_local_user_in(&dir, patch)?;
    let _ = app.emit(LOCAL_USER_UPDATED_EVENT, &profile);
    Ok(profile)
}

#[tauri::command]
pub fn get_local_user<R: Runtime>(app: AppHandle<R>) -> Option<LocalUserProfile> {
    let dir = app.path().app_config_dir().ok()?;
    get_local_user_in(&dir)
}

#[tauri::command]
pub fn save_local_user<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveLocalUserPayload,
) -> Result<LocalUserProfile, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    let profile = save_local_user_in(&dir, payload)?;
    let _ = app.emit(LOCAL_USER_UPDATED_EVENT, &profile);
    Ok(profile)
}

#[tauri::command]
pub fn clear_local_user<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let _guard = user_data_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear el almacén de usuario.".to_string())?;
    if let Some(path) = config_file_path(&app, LOCAL_USER_FILENAME) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("No se pudo cerrar el perfil local: {e}"))?;
        }
        let bak = backup_path_for(&path);
        if bak.exists() {
            let _ = fs::remove_file(bak);
        }
    }
    let _ = app.emit(LOCAL_USER_UPDATED_EVENT, serde_json::Value::Null);
    Ok(())
}

pub fn load_user_memory_in(config_dir: &Path) -> UserMemoryStore {
    let _guard = user_data_lock().lock().ok();
    let path = config_dir.join(USER_MEMORY_FILENAME);
    read_json_with_backup::<UserMemoryStore>(&path).unwrap_or_default()
}

pub fn upsert_user_memory_fact_in(
    config_dir: &Path,
    payload: UpsertUserMemoryFactPayload,
) -> Result<(UserMemoryFact, Vec<UserMemoryFact>), String> {
    let _guard = user_data_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear la memoria de usuario.".to_string())?;

    let collapsed_val = payload.value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed_val.is_empty() {
        return Err("El dato a recordar no puede estar vacío.".to_string());
    }
    if contains_secret_material(&collapsed_val) {
        return Err(
            "Por seguridad, no se guardan claves API, tokens ni llaves privadas en memoria del usuario."
                .to_string(),
        );
    }
    let clean_val: String = collapsed_val
        .chars()
        .take(MAX_USER_MEMORY_VALUE_CHARS)
        .collect::<String>()
        .trim()
        .to_string();

    let category = normalize_category(payload.category.as_deref());
    let scope = normalize_scope(payload.scope.as_deref());
    let source_window = normalize_source_window(payload.source_window.as_deref());
    let norm_key = normalize_memory_key(payload.key.as_deref(), &category, &clean_val);
    let norm_val_low = clean_val.to_lowercase();
    let now = Utc::now().to_rfc3339();

    let path = config_dir.join(USER_MEMORY_FILENAME);
    let mut store = read_json_with_backup::<UserMemoryStore>(&path).unwrap_or_default();

    let key_match_idx = store
        .facts
        .iter()
        .position(|item| item.key.trim().eq_ignore_ascii_case(&norm_key));
    let val_match_idx = if key_match_idx.is_some() {
        key_match_idx
    } else {
        store.facts.iter().position(|item| {
            item.value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                == norm_val_low
        })
    };

    let match_idx = val_match_idx;
    let matched_by_value_only = key_match_idx.is_none() && val_match_idx.is_some();
    let existing_item = match_idx.and_then(|idx| store.facts.get(idx).cloned());
    let custom_key_given = payload
        .key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let saved = UserMemoryFact {
        id: existing_item
            .as_ref()
            .map(|it| it.id.clone())
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| fnv1a_hex(&norm_key)),
        key: match &existing_item {
            Some(it) if (matched_by_value_only || !custom_key_given) && !it.key.trim().is_empty() => {
                it.key.clone()
            }
            _ => norm_key,
        },
        category,
        value: clean_val,
        scope,
        source_window,
        pinned: payload.pinned.unwrap_or(false)
            || existing_item.as_ref().map(|it| it.pinned).unwrap_or(false),
        created_at: existing_item
            .map(|it| it.created_at)
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
    };

    if let Some(idx) = match_idx {
        store.facts.remove(idx);
    }
    store.facts.insert(0, saved.clone());

    if store.facts.len() > MAX_USER_MEMORY_FACTS {
        let pinned_count = store.facts.iter().filter(|f| f.pinned).count();
        let mut unpinned_budget = MAX_USER_MEMORY_FACTS.saturating_sub(pinned_count);
        let mut kept = Vec::with_capacity(MAX_USER_MEMORY_FACTS);
        for fact in store.facts.drain(..) {
            if fact.pinned {
                if kept.len() < MAX_USER_MEMORY_FACTS {
                    kept.push(fact);
                }
            } else if unpinned_budget > 0 {
                unpinned_budget -= 1;
                kept.push(fact);
            }
        }
        store.facts = kept;
    }

    store.version = 1;
    store.updated_at = now;

    let body = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Error serializando memoria de usuario: {e}"))?;
    write_json_atomic(&path, &body)?;
    Ok((saved, store.facts))
}

pub fn delete_user_memory_fact_in(
    config_dir: &Path,
    id_or_key: &str,
) -> Result<Vec<UserMemoryFact>, String> {
    let _guard = user_data_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear la memoria de usuario.".to_string())?;
    let target = id_or_key.trim();
    if target.is_empty() {
        return Err("Indica el identificador o clave del dato a olvidar.".to_string());
    }
    let target_norm_key = target.to_ascii_lowercase();

    let path = config_dir.join(USER_MEMORY_FILENAME);
    let mut store = read_json_with_backup::<UserMemoryStore>(&path).unwrap_or_default();
    let before = store.facts.len();
    store
        .facts
        .retain(|item| item.id != target && item.key.trim().to_ascii_lowercase() != target_norm_key);

    if store.facts.len() != before {
        store.version = 1;
        store.updated_at = Utc::now().to_rfc3339();
        let body = serde_json::to_string_pretty(&store)
            .map_err(|e| format!("Error serializando memoria de usuario: {e}"))?;
        write_json_atomic(&path, &body)?;
    }
    Ok(store.facts)
}

pub fn load_user_memory<R: Runtime>(app: &AppHandle<R>) -> UserMemoryStore {
    let Some(dir) = app.path().app_config_dir().ok() else {
        return UserMemoryStore::default();
    };
    load_user_memory_in(&dir)
}

pub fn save_user_memory_fact_sync<R: Runtime>(
    app: &AppHandle<R>,
    payload: UpsertUserMemoryFactPayload,
) -> Result<(UserMemoryFact, Vec<UserMemoryFact>), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    let source_win = normalize_source_window(payload.source_window.as_deref());
    let (saved, facts) = upsert_user_memory_fact_in(&dir, payload)?;
    let _ = app.emit(
        USER_MEMORY_UPDATED_EVENT,
        serde_json::json!({
            "kind": "memory",
            "sourceWindow": source_win,
            "updatedAt": saved.updated_at,
            "factCount": facts.len(),
        }),
    );
    Ok((saved, facts))
}

pub fn delete_user_memory_fact_sync<R: Runtime>(
    app: &AppHandle<R>,
    id_or_key: &str,
    source_window: Option<&str>,
) -> Result<Vec<UserMemoryFact>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    let facts = delete_user_memory_fact_in(&dir, id_or_key)?;
    let source_win = normalize_source_window(source_window);
    let _ = app.emit(
        USER_MEMORY_UPDATED_EVENT,
        serde_json::json!({
            "kind": "memory",
            "sourceWindow": source_win,
            "updatedAt": Utc::now().to_rfc3339(),
            "factCount": facts.len(),
        }),
    );
    Ok(facts)
}

#[tauri::command]
pub async fn list_user_memory_facts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<UserMemoryFact>, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || Ok(load_user_memory(&app_clone).facts))
        .await
        .map_err(|e| format!("Error leyendo memoria de usuario: {e}"))?
}

#[tauri::command]
pub async fn save_user_memory_fact<R: Runtime>(
    app: AppHandle<R>,
    payload: UpsertUserMemoryFactPayload,
) -> Result<Vec<UserMemoryFact>, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        save_user_memory_fact_sync(&app_clone, payload).map(|(_, facts)| facts)
    })
    .await
    .map_err(|e| format!("Error guardando memoria de usuario: {e}"))?
}

#[tauri::command]
pub async fn delete_user_memory_fact<R: Runtime>(
    app: AppHandle<R>,
    id_or_key: String,
    source_window: Option<String>,
) -> Result<Vec<UserMemoryFact>, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        delete_user_memory_fact_sync(&app_clone, &id_or_key, source_window.as_deref())
    })
    .await
    .map_err(|e| format!("Error eliminando memoria de usuario: {e}"))?
}

fn read_conversations_in(config_dir: &Path) -> Vec<serde_json::Value> {
    let _guard = conversations_lock().lock().ok();
    let path = config_dir.join(CONVERSATIONS_FILENAME);
    read_json_with_backup::<Vec<serde_json::Value>>(&path).unwrap_or_default()
}

fn save_conversation_in(
    config_dir: &Path,
    conversation: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let conv_id = conversation
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "La conversación requiere un id válido.".to_string())?
        .to_string();

    let _guard = conversations_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear el historial de conversaciones.".to_string())?;
    let path = config_dir.join(CONVERSATIONS_FILENAME);
    let mut list = read_json_with_backup::<Vec<serde_json::Value>>(&path).unwrap_or_default();
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(conv_id.as_str()));
    list.insert(0, conversation);
    if list.len() > MAX_STORED_CONVERSATIONS {
        list.truncate(MAX_STORED_CONVERSATIONS);
    }
    let body = serde_json::to_string_pretty(&list)
        .map_err(|e| format!("Error serializando conversaciones: {e}"))?;
    write_json_atomic(&path, &body)?;
    Ok(list)
}

fn delete_conversation_in(
    config_dir: &Path,
    id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let _guard = conversations_lock()
        .lock()
        .map_err(|_| "No se pudo bloquear el historial de conversaciones.".to_string())?;
    let path = config_dir.join(CONVERSATIONS_FILENAME);
    let mut list = read_json_with_backup::<Vec<serde_json::Value>>(&path).unwrap_or_default();
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id));
    let body = serde_json::to_string_pretty(&list)
        .map_err(|e| format!("Error serializando conversaciones: {e}"))?;
    write_json_atomic(&path, &body)?;
    Ok(list)
}

#[tauri::command]
pub async fn list_conversations<R: Runtime>(app: AppHandle<R>) -> Vec<serde_json::Value> {
    let Some(dir) = app.path().app_config_dir().ok() else {
        return Vec::new();
    };
    tokio::task::spawn_blocking(move || read_conversations_in(&dir))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn save_conversation<R: Runtime>(
    app: AppHandle<R>,
    conversation: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    tokio::task::spawn_blocking(move || save_conversation_in(&dir, conversation))
        .await
        .map_err(|e| format!("Error guardando conversación: {e}"))?
}

#[tauri::command]
pub async fn delete_conversation<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    tokio::task::spawn_blocking(move || delete_conversation_in(&dir, &id))
        .await
        .map_err(|e| format!("Error eliminando conversación: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_cfg_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xook_ws_store_test_{prefix}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_creates_backup_and_recovers_from_corrupt_primary() {
        let dir = temp_cfg_dir("bak_recovery");
        let saved1 = save_local_user_in(
            &dir,
            SaveLocalUserPayload {
                name: "Uziel".into(),
                store_name: Some("Xook Lab".into()),
                role: Some("Dueño".into()),
                preferred_name: None,
                occupation: None,
                work_context: None,
                language: None,
                timezone: None,
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(saved1.name, "Uziel");

        let saved2 = save_local_user_in(
            &dir,
            SaveLocalUserPayload {
                name: "Uziel Castillo".into(),
                store_name: None,
                role: None,
                preferred_name: Some("Uzi".into()),
                occupation: Some("Ingeniero".into()),
                work_context: None,
                language: Some("es-MX".into()),
                timezone: None,
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(saved2.store_name, "Xook Lab");

        let primary = dir.join(LOCAL_USER_FILENAME);
        let bak = backup_path_for(&primary);
        assert!(bak.is_file());

        // Simular archivo primario truncado/corrupto -> debe recuperar del .bak
        fs::write(&primary, "{corrupted").unwrap();
        let recovered = get_local_user_in(&dir).unwrap();
        assert_eq!(recovered.name, "Uziel");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deserializes_legacy_6_field_profile_and_supports_partial_patch() {
        let dir = temp_cfg_dir("legacy_patch");
        let legacy_json = r#"{
          "id": "usr_123",
          "name": "Ana",
          "storeName": "Café Central",
          "role": "Dueño",
          "createdAt": "2026-01-01T00:00:00Z",
          "updatedAt": "2026-01-01T00:00:00Z"
        }"#;
        fs::write(dir.join(LOCAL_USER_FILENAME), legacy_json).unwrap();

        let patched = patch_local_user_in(
            &dir,
            PatchLocalUserPayload {
                occupation: Some("Fundadora y barista".into()),
                timezone: Some("America/Mexico_City".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(patched.id, "usr_123");
        assert_eq!(patched.name, "Ana");
        assert_eq!(patched.store_name, "Café Central");
        assert_eq!(patched.occupation.as_deref(), Some("Fundadora y barista"));
        assert_eq!(patched.timezone.as_deref(), Some("America/Mexico_City"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn memory_upsert_deduplicates_preserves_pinned_and_rejects_secrets() {
        let dir = temp_cfg_dir("mem_upsert");
        let bad = upsert_user_memory_fact_in(
            &dir,
            UpsertUserMemoryFactPayload {
                value: "Mi llave es sk-or-v1-1234567890abcdef".into(),
                key: Some("api_key".into()),
                category: Some("other".into()),
                scope: None,
                source_window: Some("quick".into()),
                pinned: None,
            },
        );
        assert!(bad.is_err());

        let bad_gh = upsert_user_memory_fact_in(
            &dir,
            UpsertUserMemoryFactPayload {
                value: "ghp_1234567890abcdefghijklmnop".into(),
                key: None,
                category: None,
                scope: None,
                source_window: None,
                pinned: None,
            },
        );
        assert!(bad_gh.is_err());

        let (f1, list1) = upsert_user_memory_fact_in(
            &dir,
            UpsertUserMemoryFactPayload {
                value: "Prefiere respuestas concisas y en español".into(),
                key: Some("Estilo de respuesta".into()),
                category: Some("preference".into()),
                scope: Some("global".into()),
                source_window: Some("quick".into()),
                pinned: Some(true),
            },
        )
        .unwrap();
        assert_eq!(f1.key, "estilo_de_respuesta");
        assert_eq!(list1.len(), 1);

        let (f2, list2) = upsert_user_memory_fact_in(
            &dir,
            UpsertUserMemoryFactPayload {
                value: "Prefiere respuestas directas con ejemplos de código".into(),
                key: Some("Estilo de respuesta".into()),
                category: Some("preference".into()),
                scope: Some("global".into()),
                source_window: Some("main".into()),
                pinned: Some(false),
            },
        )
        .unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(f2.id, f1.id);
        assert!(f2.pinned);

        let after_del = delete_user_memory_fact_in(&dir, "estilo_de_respuesta").unwrap();
        assert!(after_del.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_secrets_and_allows_normal_words() {
        assert!(contains_secret_material("Usa sk-proj-abcd1234efgh5678ijkl"));
        assert!(contains_secret_material("-----BEGIN PRIVATE KEY-----"));
        assert!(contains_secret_material("Authorization: Bearer abcdefghijklmnopqrstuvwxyz12"));
        assert!(!contains_secret_material("Me dedico a programar en Rust y TypeScript"));
        assert!(!contains_secret_material("Revisa task-123 del skipper local"));
    }
}
