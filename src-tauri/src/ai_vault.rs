use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::slices::secret_store::{self, SecretMap};

struct ActiveChatStream {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

static ACTIVE_CHAT_STREAMS: OnceLock<Mutex<HashMap<String, ActiveChatStream>>> = OnceLock::new();

fn active_chat_streams() -> &'static Mutex<HashMap<String, ActiveChatStream>> {
    ACTIVE_CHAT_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActiveStreamGuard {
    stream_id: String,
}

impl Drop for ActiveStreamGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = active_chat_streams().lock() {
            map.remove(&self.stream_id);
        }
    }
}

fn terminate_process_by_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[tauri::command]
pub fn cancel_xox_chat_stream(stream_id: String) -> Result<bool, String> {
    let clean_id = stream_id.trim();
    if clean_id.is_empty() {
        return Ok(false);
    }
    let entry = {
        let map = active_chat_streams()
            .lock()
            .map_err(|_| "No se pudo acceder al registro de streams.".to_string())?;
        map.get(clean_id).map(|s| (s.pid, Arc::clone(&s.cancelled)))
    };
    if let Some((pid, cancelled)) = entry {
        cancelled.store(true, Ordering::SeqCst);
        terminate_process_by_pid(pid);
        return Ok(true);
    }
    Ok(false)
}

const VAULT_FILENAME: &str = "ai-vault.json";
const USAGE_LEDGER_FILENAME: &str = "ai-usage-ledger.json";
const DEFAULT_PROVIDER: &str = "openrouter";
const DEFAULT_MODEL_ID: &str = "openrouter/free";
pub const AI_CONFIG_UPDATED_EVENT: &str = "xox-ai-config-updated";
pub const AI_USAGE_UPDATED_EVENT: &str = "xox-ai-usage-updated";

const SUPPORTED_PROVIDERS: [&str; 7] = [
    "openrouter",
    "deepseek",
    "kimi",
    "groq",
    "gemini",
    "openai",
    "anthropic",
];

fn default_auto_failover() -> bool {
    true
}

fn default_failover_order() -> Vec<String> {
    SUPPORTED_PROVIDERS.iter().map(|s| s.to_string()).collect()
}

pub(crate) fn normalize_provider_id(raw: &str) -> &'static str {
    let clean = raw.trim().to_ascii_lowercase();
    match clean.as_str() {
        "deepseek" => "deepseek",
        "kimi" | "moonshot" | "moonshot-ai" | "moonshot_ai" | "moonshotai" | "moonshot-cn" | "moonshot_cn" => "kimi",
        "groq" => "groq",
        "gemini" | "google" | "google_ai" | "google-gemini" | "aistudio" => "gemini",
        "openai" | "gpt" => "openai",
        "anthropic" | "claude" => "anthropic",
        _ => "openrouter",
    }
}

fn default_model_for_provider(provider: &str) -> &'static str {
    match normalize_provider_id(provider) {
        "deepseek" => "deepseek-flash",
        "kimi" => "kimi-k3.1-pro",
        "groq" => "openai/gpt-oss-120b",
        "gemini" => "gemini-2.5-flash-lite",
        "openai" => "gpt-4.1-mini",
        "anthropic" => "claude-sonnet-4-6",
        _ => "openrouter/free",
    }
}

fn provider_display_name(provider: &str) -> &'static str {
    match normalize_provider_id(provider) {
        "deepseek" => "DeepSeek",
        "kimi" => "Kimi (Moonshot)",
        "groq" => "Groq",
        "gemini" => "Google Gemini",
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        _ => "OpenRouter",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredProviderEntry {
    #[serde(default)]
    model_id: String,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    custom_models: Vec<String>,
    #[serde(default)]
    cooldown_until_ms: Option<i64>,
    #[serde(default)]
    quota_status: Option<String>,
    #[serde(default)]
    quota_reason: Option<String>,
    #[serde(default)]
    api_region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiVault {
    provider: String,
    model_id: String,
    api_key: Option<String>,
    #[serde(default)]
    custom_models: Vec<String>,
    #[serde(default)]
    providers: HashMap<String, StoredProviderEntry>,
    #[serde(default = "default_auto_failover")]
    auto_failover: bool,
    #[serde(default = "default_failover_order")]
    failover_order: Vec<String>,
}

impl Default for StoredAiVault {
    fn default() -> Self {
        let mut providers = HashMap::new();
        for pid in SUPPORTED_PROVIDERS {
            providers.insert(
                pid.to_string(),
                StoredProviderEntry {
                    model_id: default_model_for_provider(pid).to_string(),
                    ..Default::default()
                },
            );
        }
        Self {
            provider: DEFAULT_PROVIDER.to_string(),
            model_id: DEFAULT_MODEL_ID.to_string(),
            api_key: None,
            custom_models: Vec::new(),
            providers,
            auto_failover: true,
            failover_order: default_failover_order(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPublicStatus {
    pub provider: String,
    pub model_id: String,
    pub has_api_key: bool,
    pub masked_key: Option<String>,
    pub key_source: String, // "vault" | "env" | "none"
    pub custom_models: Vec<String>,
    pub cooldown_until_ms: Option<i64>,
    pub quota_status: String, // "ready" | "cooldown" | "exhausted" | "auth_error"
    pub quota_reason: Option<String>,
    pub api_region: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigPublic {
    pub provider: String,
    pub model_id: String,
    pub has_api_key: bool,
    pub masked_key: Option<String>,
    pub key_source: String, // "vault" | "env" | "none"
    pub custom_models: Vec<String>,
    pub auto_failover: bool,
    pub failover_order: Vec<String>,
    pub configured_providers: HashMap<String, ProviderPublicStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiConfigPayload {
    pub provider: Option<String>,
    pub target_provider: Option<String>,
    pub model_id: Option<String>,
    pub api_key: Option<String>,
    pub clear_key: Option<bool>,
    pub custom_models: Option<Vec<String>>,
    pub auto_failover: Option<bool>,
    pub failover_order: Option<Vec<String>>,
    pub clear_cooldown: Option<bool>,
    pub api_region: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XoxChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<serde_json::Value>,
    #[serde(default)]
    pub current_tasks: Vec<serde_json::Value>,
    #[serde(default)]
    pub agenda_items: Vec<serde_json::Value>,
    #[serde(default)]
    pub attached_context: Vec<serde_json::Value>,
    pub model_override: Option<String>,
    pub provider_override: Option<String>,
    pub stream_id: Option<String>,
    pub user_profile: Option<serde_json::Value>,
    #[serde(default)]
    pub active_canvas: Option<serde_json::Value>,
    #[serde(default)]
    pub active_mode: Option<String>,
    #[serde(default)]
    pub subagent_roster: Option<serde_json::Value>,
    #[serde(default)]
    pub context_scope: Option<String>,
    #[serde(default)]
    pub active_document: Option<serde_json::Value>,
    #[serde(default)]
    pub context_checkpoint: Option<serde_json::Value>,
    #[serde(default)]
    pub model_context_window: Option<u64>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactContextRequest {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub history: Vec<serde_json::Value>,
    #[serde(default)]
    pub prev_checkpoint: Option<serde_json::Value>,
    #[serde(default)]
    pub document_path: Option<String>,
    #[serde(default)]
    pub document_title: Option<String>,
    #[serde(default)]
    pub document_file_kind: Option<String>,
    #[serde(default)]
    pub focus_hint: Option<String>,
    #[serde(default)]
    pub keep_recent: Option<usize>,
    #[serde(default)]
    pub model_override: Option<String>,
    #[serde(default)]
    pub provider_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageDocumentContextRequest {
    pub action: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub file_kind: Option<String>,
    #[serde(default)]
    pub rules: Option<Vec<String>>,
    #[serde(default)]
    pub keep_rules: Option<bool>,
}

fn vault_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(VAULT_FILENAME))
}

fn normalize_failover_order(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in raw {
        let pid = normalize_provider_id(item).to_string();
        if !out.contains(&pid) {
            out.push(pid);
        }
    }
    for pid in SUPPORTED_PROVIDERS {
        let s = pid.to_string();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

fn normalize_vault_state(vault: &mut StoredAiVault) {
    let active_pid = normalize_provider_id(&vault.provider).to_string();
    vault.provider = active_pid.clone();

    let mut normalized_providers: HashMap<String, StoredProviderEntry> = HashMap::new();
    for (k, mut entry) in std::mem::take(&mut vault.providers) {
        let pid = normalize_provider_id(&k).to_string();
        if entry.model_id.trim().is_empty() {
            entry.model_id = default_model_for_provider(&pid).to_string();
        }
        if let Some(ref raw_k) = entry.api_key {
            let norm_k = normalize_api_key(raw_k);
            entry.api_key = if norm_k.is_empty() { None } else { Some(norm_k) };
        }
        normalized_providers.insert(pid, entry);
    }

    for pid in SUPPORTED_PROVIDERS {
        normalized_providers
            .entry(pid.to_string())
            .or_insert_with(|| StoredProviderEntry {
                model_id: default_model_for_provider(pid).to_string(),
                ..Default::default()
            });
    }

    // Migrate legacy single-provider fields into the active provider slot.
    if let Some(active_entry) = normalized_providers.get_mut(&active_pid) {
        if active_entry.api_key.is_none() {
            if let Some(ref legacy_key) = vault.api_key {
                let norm = normalize_api_key(legacy_key);
                if !norm.is_empty() {
                    active_entry.api_key = Some(norm);
                }
            }
        }
        if active_entry.model_id.trim().is_empty() || (active_entry.model_id == default_model_for_provider(&active_pid) && !vault.model_id.trim().is_empty() && active_pid == "openrouter") {
            let legacy_model = vault.model_id.trim();
            if !legacy_model.is_empty() {
                active_entry.model_id = legacy_model.to_string();
            }
        }
        if active_entry.custom_models.is_empty() && !vault.custom_models.is_empty() {
            active_entry.custom_models = vault.custom_models.clone();
        }
        vault.model_id = active_entry.model_id.clone();
        vault.api_key = active_entry.api_key.clone();
        vault.custom_models = active_entry.custom_models.clone();
    }

    vault.providers = normalized_providers;
    vault.failover_order = normalize_failover_order(&vault.failover_order);
}

/// Quita las claves del vault y las devuelve como `{proveedor: clave}`.
fn take_secrets(vault: &mut StoredAiVault) -> SecretMap {
    let mut secrets = SecretMap::new();
    for (pid, entry) in vault.providers.iter_mut() {
        if let Some(key) = entry
            .api_key
            .take()
            .map(|k| normalize_api_key(&k))
            .filter(|k| !k.is_empty())
        {
            secrets.insert(pid.clone(), key);
        }
    }
    // Campo heredado de la versión de un solo proveedor.
    if let Some(key) = vault
        .api_key
        .take()
        .map(|k| normalize_api_key(&k))
        .filter(|k| !k.is_empty())
    {
        secrets
            .entry(normalize_provider_id(&vault.provider).to_string())
            .or_insert(key);
    }
    secrets
}

fn apply_secrets(vault: &mut StoredAiVault, secrets: &SecretMap) {
    for (pid, key) in secrets {
        vault
            .providers
            .entry(pid.clone())
            .or_insert_with(|| StoredProviderEntry {
                model_id: default_model_for_provider(pid).to_string(),
                ..Default::default()
            })
            .api_key = Some(key.clone());
    }
    let active = normalize_provider_id(&vault.provider);
    vault.api_key = vault.providers.get(active).and_then(|e| e.api_key.clone());
}

fn read_vault_file<R: Runtime>(app: &AppHandle<R>) -> StoredAiVault {
    vault_file_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<StoredAiVault>(&raw).ok())
        .unwrap_or_default()
}

/// Claves heredadas del archivo (versiones anteriores, en texto plano) que se conservan en disco
/// cuando no hay almacén seguro: solo las que siguen vigentes sin cambios. Las nuevas o
/// modificadas quedan solo en la sesión; las borradas por el usuario desaparecen del archivo.
fn legacy_secrets_to_keep(on_disk: SecretMap, current: &SecretMap) -> SecretMap {
    on_disk
        .into_iter()
        .filter(|(pid, key)| current.get(pid) == Some(key))
        .collect()
}

fn load_vault<R: Runtime>(app: &AppHandle<R>) -> StoredAiVault {
    let mut vault = read_vault_file(app);
    normalize_vault_state(&mut vault);
    let file_secrets = take_secrets(&mut vault);
    let (mut secrets, persistent) = secret_store::load();

    if !file_secrets.is_empty() {
        // Migración de claves en texto plano al almacén seguro (el almacén gana si ya tenía una).
        for (pid, key) in file_secrets {
            secrets.entry(pid).or_insert(key);
        }
        // El archivo se reescribe sin ellas solo si el almacén confirmó que las guardó.
        if persistent {
            match secret_store::save(&secrets) {
                Ok(true) => {
                    if let Err(err) = write_vault_file(app, &vault) {
                        eprintln!("[ai_vault] {err}");
                    }
                }
                Ok(false) => {}
                Err(err) => eprintln!("[ai_vault] {err}"),
            }
        }
    }

    apply_secrets(&mut vault, &secrets);
    vault
}

/// Las claves van al almacén seguro del sistema y el archivo solo guarda la configuración.
/// El orden importa: si el almacén falla, el archivo no se toca.
fn write_vault<R: Runtime>(app: &AppHandle<R>, vault: &StoredAiVault) -> Result<(), String> {
    let mut public_vault = vault.clone();
    let secrets = take_secrets(&mut public_vault);
    if secret_store::save(&secrets)? {
        return write_vault_file(app, &public_vault);
    }
    // Solo sesión: ninguna clave nueva toca el disco, pero las heredadas sin cambios se conservan
    // para no perderlas al cerrar XOOK.
    let mut on_disk = read_vault_file(app);
    normalize_vault_state(&mut on_disk);
    let kept = legacy_secrets_to_keep(take_secrets(&mut on_disk), &secrets);
    apply_secrets(&mut public_vault, &kept);
    write_vault_file(app, &public_vault)
}

/// Dónde se guardan las claves (almacén seguro o solo esta sesión), para mostrarlo en Ajustes.
#[tauri::command]
pub fn get_secret_storage_status() -> secret_store::StorageStatus {
    secret_store::status()
}

fn write_vault_file<R: Runtime>(app: &AppHandle<R>, vault: &StoredAiVault) -> Result<(), String> {
    let path = vault_file_path(app).ok_or_else(|| "No se pudo resolver app_config_dir".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio de bóveda: {e}"))?;
    }
    let body = serde_json::to_string_pretty(vault)
        .map_err(|e| format!("Error serializando configuración de IA: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("Error escribiendo bóveda local: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.trim().chars().collect();
    let len = chars.len();
    if len <= 8 {
        return "••••".to_string();
    }
    let prefix_len = if key.starts_with("sk-or-v1-") && len > 14 {
        9
    } else if (key.starts_with("sk-ant-") || key.starts_with("sk-proj-")) && len > 13 {
        7
    } else if key.starts_with("AIza") || key.starts_with("gsk_") {
        4
    } else {
        4.min(len / 3)
    };
    let prefix: String = chars[..prefix_len].iter().collect();
    let suffix: String = chars[len - 4..].iter().collect();
    format!("{prefix}••••{suffix}")
}

fn normalize_api_key(raw: &str) -> String {
    let mut trimmed = raw
        .trim()
        .trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | ';' | '.'));
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
        trimmed = trimmed[7..]
            .trim()
            .trim_matches(|c| matches!(c, '"' | '\'' | '`' | ',' | ';' | '.'));
    }
    for (prefix, min_len) in [
        ("sk-or-", 18usize),
        ("sk-ant-", 18usize),
        ("sk-proj-", 18usize),
        ("sk-svcacct-", 18usize),
        ("gsk_", 18usize),
        ("AIza", 20usize),
        ("sk-", 18usize),
    ] {
        if let Some(idx) = trimmed.find(prefix) {
            let candidate: String = trimmed[idx..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if candidate.len() >= min_len {
                return candidate;
            }
        }
    }
    trimmed.to_string()
}

fn resolve_provider_key(vault: &StoredAiVault, provider: &str) -> (Option<String>, &'static str) {
    let pid = normalize_provider_id(provider);
    if let Some(entry) = vault.providers.get(pid) {
        if let Some(k) = entry
            .api_key
            .as_deref()
            .map(normalize_api_key)
            .filter(|s| !s.is_empty())
        {
            return (Some(k), "vault");
        }
    }
    if pid == vault.provider {
        if let Some(k) = vault
            .api_key
            .as_deref()
            .map(normalize_api_key)
            .filter(|s| !s.is_empty())
        {
            return (Some(k), "vault");
        }
    }
    // Las claves entran solo por la bóveda: no hay respaldo en variables de entorno.
    (None, "none")
}

fn resolve_effective_key(vault: &StoredAiVault) -> (Option<String>, &'static str) {
    resolve_provider_key(vault, &vault.provider)
}

fn resolve_first_available_provider(
    vault: &StoredAiVault,
    preferred_provider: &str,
) -> Option<(String, String, String)> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let pref = normalize_provider_id(preferred_provider).to_string();

    if let (Some(key), _) = resolve_provider_key(vault, &pref) {
        let model_id = vault
            .providers
            .get(&pref)
            .map(|e| e.model_id.clone())
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| vault.model_id.clone());
        return Some((pref, key, model_id));
    }

    if !vault.auto_failover {
        return None;
    }

    let mut ready_candidates: Vec<(String, String, String)> = Vec::new();
    let mut cooldown_candidates: Vec<(String, String, String)> = Vec::new();
    for pid in &vault.failover_order {
        let norm_pid = normalize_provider_id(pid).to_string();
        if norm_pid == pref {
            continue;
        }
        let (Some(key), _) = resolve_provider_key(vault, &norm_pid) else {
            continue;
        };
        let entry = vault.providers.get(&norm_pid);
        let model_id = entry
            .map(|e| e.model_id.clone())
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| default_model_for_provider(&norm_pid).to_string());
        let in_cooldown = entry
            .and_then(|e| e.cooldown_until_ms)
            .map(|ts| ts > now_ms)
            .unwrap_or(false);
        if in_cooldown {
            cooldown_candidates.push((norm_pid, key, model_id));
        } else {
            ready_candidates.push((norm_pid, key, model_id));
        }
    }
    ready_candidates
        .into_iter()
        .next()
        .or_else(|| cooldown_candidates.into_iter().next())
}

fn build_provider_credentials_json(vault: &StoredAiVault) -> serde_json::Map<String, serde_json::Value> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut map = serde_json::Map::new();
    for pid in SUPPORTED_PROVIDERS {
        let (maybe_key, _) = resolve_provider_key(vault, pid);
        let Some(api_key) = maybe_key else {
            continue;
        };
        let entry = vault.providers.get(pid);
        let model_id = entry
            .map(|e| e.model_id.trim().to_string())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| default_model_for_provider(pid).to_string());
        let cooldown_until_ms = entry
            .and_then(|e| e.cooldown_until_ms)
            .filter(|ts| *ts > now_ms);
        let region = entry.and_then(|e| e.api_region.clone());
        map.insert(
            pid.to_string(),
            serde_json::json!({
                "api_key": api_key,
                "model_id": model_id,
                "cooldown_until_ms": cooldown_until_ms,
                "region": region,
            }),
        );
    }
    map
}

fn to_public_config(vault: &StoredAiVault) -> AiConfigPublic {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let mut configured_providers = HashMap::new();

    for pid in SUPPORTED_PROVIDERS {
        let (key, source) = resolve_provider_key(vault, pid);
        let entry = vault.providers.get(pid);
        let model_id = entry
            .map(|e| e.model_id.trim().to_string())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| default_model_for_provider(pid).to_string());
        let custom_models = entry
            .map(|e| e.custom_models.clone())
            .unwrap_or_default();
        let raw_cd = entry.and_then(|e| e.cooldown_until_ms);
        let active_cd = raw_cd.filter(|ts| *ts > now_ms);
        let quota_status = if active_cd.is_some() {
            match entry.and_then(|e| e.quota_status.as_deref()) {
                Some("exhausted") => "exhausted".to_string(),
                Some("auth_error") => "auth_error".to_string(),
                _ => "cooldown".to_string(),
            }
        } else {
            "ready".to_string()
        };
        let quota_reason = if active_cd.is_some() {
            entry.and_then(|e| e.quota_reason.clone())
        } else {
            None
        };
        let api_region = entry.and_then(|e| e.api_region.clone());

        configured_providers.insert(
            pid.to_string(),
            ProviderPublicStatus {
                provider: pid.to_string(),
                model_id,
                has_api_key: key.is_some(),
                masked_key: key.as_deref().map(mask_api_key),
                key_source: source.to_string(),
                custom_models,
                cooldown_until_ms: active_cd,
                quota_status,
                quota_reason,
                api_region,
            },
        );
    }

    let (active_key, active_source) = resolve_effective_key(vault);
    AiConfigPublic {
        provider: vault.provider.clone(),
        model_id: vault.model_id.clone(),
        has_api_key: active_key.is_some(),
        masked_key: active_key.as_deref().map(mask_api_key),
        key_source: active_source.to_string(),
        custom_models: vault.custom_models.clone(),
        auto_failover: vault.auto_failover,
        failover_order: vault.failover_order.clone(),
        configured_providers,
    }
}

fn sync_vault_from_sidecar_result<R: Runtime>(
    app: &AppHandle<R>,
    result_val: &serde_json::Value,
    requested_provider: &str,
) {
    let exhausted = result_val
        .get("exhausted_providers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let failover_events = result_val
        .get("failover_events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let used_provider = result_val
        .get("provider_used")
        .and_then(|v| v.as_str())
        .map(normalize_provider_id);
    let model_used = result_val
        .get("model_used")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if exhausted.is_empty() && failover_events.is_empty() {
        return;
    }

    let mut vault = load_vault(app);
    let mut changed = false;

    for item in &exhausted {
        let Some(raw_pid) = item.get("provider").and_then(|v| v.as_str()) else {
            continue;
        };
        let pid = normalize_provider_id(raw_pid).to_string();
        let kind = item
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("cooldown");
        let status_label = match kind {
            "quota_exhausted" => "exhausted",
            "auth_error" => "auth_error",
            _ => "cooldown",
        };
        let cd_ms = item
            .get("cooldown_until_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis() + 180_000);
        let reason = item
            .get("reason")
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(240).collect::<String>());

        let entry = vault.providers.entry(pid).or_insert_with(StoredProviderEntry::default);
        entry.cooldown_until_ms = Some(cd_ms);
        entry.quota_status = Some(status_label.to_string());
        entry.quota_reason = reason;
        changed = true;
    }

    let has_hard_exhaustion = exhausted.iter().any(|item| {
        matches!(
            item.get("kind").and_then(|v| v.as_str()),
            Some("quota_exhausted" | "auth_error" | "rate_limit")
        )
    });

    if !failover_events.is_empty() && has_hard_exhaustion {
        if let Some(next_pid) = used_provider {
            if next_pid != normalize_provider_id(requested_provider) || next_pid != vault.provider {
                vault.provider = next_pid.to_string();
                let next_model = {
                    let entry = vault
                        .providers
                        .entry(next_pid.to_string())
                        .or_insert_with(|| StoredProviderEntry {
                            model_id: default_model_for_provider(next_pid).to_string(),
                            ..Default::default()
                        });
                    if let Some(m) = model_used {
                        entry.model_id = m.to_string();
                    } else if entry.model_id.trim().is_empty() {
                        entry.model_id = default_model_for_provider(next_pid).to_string();
                    }
                    entry.cooldown_until_ms = None;
                    entry.quota_status = Some("ready".to_string());
                    entry.quota_reason = None;
                    vault.api_key = entry.api_key.clone();
                    vault.custom_models = entry.custom_models.clone();
                    entry.model_id.clone()
                };
                vault.model_id = next_model;
                changed = true;
            }
        }
    }

    if changed {
        normalize_vault_state(&mut vault);
        let _ = write_vault(app, &vault);
        let public = to_public_config(&vault);
        let _ = app.emit(AI_CONFIG_UPDATED_EVENT, &public);
    }
}

pub(crate) fn find_sidecar_script<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-brain").join("main_sidecar.py"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("src-brain").join("main_sidecar.py"));
        }
    }
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("src-brain").join("main_sidecar.py"));
    }

    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "No se encontró src-brain/main_sidecar.py".to_string())
}

/// Comando para lanzar el Python de XOOK en modo UTF-8 en todos los sistemas.
///
/// Sin esto, en Windows stdin/stdout por pipe usan la página de códigos local (cp1252): el texto
/// en español llega corrompido y caracteres como "Á" o "Í" hacen fallar la lectura.
/// `PYTHONIOENCODING` va explícito porque, si el usuario lo tiene definido, gana sobre `PYTHONUTF8`.
pub(crate) fn python_command(py_bin: &std::path::Path) -> Command {
    let mut cmd = Command::new(py_bin);
    cmd.env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8");
    cmd
}

pub(crate) fn resolve_python_executable(script_path: &PathBuf) -> PathBuf {
    if let Ok(explicit) = std::env::var("XOOK_PYTHON") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(script_dir) = script_path.parent() {
        let venv_candidates = [
            script_dir.join(".venv").join("bin").join("python3"),
            script_dir.join(".venv").join("bin").join("python"),
            script_dir.join(".venv").join("Scripts").join("python.exe"),
        ];
        if let Some(found) = venv_candidates.into_iter().find(|p| p.is_file()) {
            return found;
        }
        if let Some(parent_dir) = script_dir.parent() {
            let parent_candidates = [
                parent_dir.join(".venv").join("bin").join("python3"),
                parent_dir.join(".venv").join("Scripts").join("python.exe"),
            ];
            if let Some(found) = parent_candidates.into_iter().find(|p| p.is_file()) {
                return found;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_candidates = [
            cwd.join("src-brain").join(".venv").join("bin").join("python3"),
            cwd.join("src-brain").join(".venv").join("Scripts").join("python.exe"),
        ];
        if let Some(found) = cwd_candidates.into_iter().find(|p| p.is_file()) {
            return found;
        }
    }

    PathBuf::from("python3")
}

pub(crate) fn call_python_sidecar(
    script_path: &PathBuf,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request = serde_json::json!({
        "id": 1,
        "method": method,
        "params": params,
    });
    let line = format!("{request}\n");

    let py_bin = resolve_python_executable(script_path);
    let mut child = python_command(&py_bin)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python sidecar ({}): {e}", py_bin.display()))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Error enviando solicitud al sidecar: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Error esperando respuesta del sidecar: {e}"))?;

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout_str.is_empty() {
        return Err(if stderr_str.is_empty() {
            "El sidecar Python devolvió una respuesta vacía.".to_string()
        } else {
            format!("Error del sidecar Python: {stderr_str}")
        });
    }

    let first_line = stdout_str.lines().next().unwrap_or(&stdout_str);
    let parsed: serde_json::Value = serde_json::from_str(first_line)
        .map_err(|e| format!("Respuesta JSON inválida del sidecar: {e}"))?;

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    Ok(parsed.get("result").cloned().unwrap_or(parsed))
}

#[tauri::command]
pub fn get_ai_config<R: Runtime>(app: AppHandle<R>) -> AiConfigPublic {
    let vault = load_vault(&app);
    to_public_config(&vault)
}

#[tauri::command]
pub fn save_ai_config<R: Runtime>(
    app: AppHandle<R>,
    payload: SaveAiConfigPayload,
) -> Result<AiConfigPublic, String> {
    let mut vault = load_vault(&app);

    let switching_provider = payload
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id);

    let target_pid = payload
        .target_provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .or(switching_provider)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();

    {
        let entry = vault
            .providers
            .entry(target_pid.clone())
            .or_insert_with(|| StoredProviderEntry {
                model_id: default_model_for_provider(&target_pid).to_string(),
                ..Default::default()
            });

        if let Some(m) = payload.model_id {
            let trimmed = m.trim();
            if !trimmed.is_empty() {
                entry.model_id = trimmed.to_string();
            }
        }

        if let Some(custom) = payload.custom_models {
            entry.custom_models = custom
                .into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }

        if payload.clear_key.unwrap_or(false) {
            entry.api_key = None;
            entry.cooldown_until_ms = None;
            entry.quota_status = None;
            entry.quota_reason = None;
        } else if let Some(new_key) = payload.api_key {
            let normalized = normalize_api_key(&new_key);
            if !normalized.is_empty() {
                entry.api_key = Some(normalized);
                // Reset cooldown when user saves a fresh API key
                entry.cooldown_until_ms = None;
                entry.quota_status = None;
                entry.quota_reason = None;
            }
        }

        if payload.clear_cooldown.unwrap_or(false) {
            entry.cooldown_until_ms = None;
            entry.quota_status = None;
            entry.quota_reason = None;
        }

        if let Some(region_raw) = payload.api_region {
            let trimmed = region_raw.trim().to_string();
            entry.api_region = if trimmed.is_empty() { None } else { Some(trimmed) };
        }
    }

    if let Some(active_pid) = switching_provider {
        vault.provider = active_pid.to_string();
    }

    if let Some(auto_fo) = payload.auto_failover {
        vault.auto_failover = auto_fo;
    }

    if let Some(order) = payload.failover_order {
        vault.failover_order = normalize_failover_order(&order);
    }

    if let Some(active_entry) = vault.providers.get(&vault.provider) {
        vault.model_id = if active_entry.model_id.trim().is_empty() {
            default_model_for_provider(&vault.provider).to_string()
        } else {
            active_entry.model_id.clone()
        };
        vault.api_key = active_entry.api_key.clone();
        vault.custom_models = active_entry.custom_models.clone();
    }

    normalize_vault_state(&mut vault);
    write_vault(&app, &vault)?;
    let public = to_public_config(&vault);
    let _ = app.emit(AI_CONFIG_UPDATED_EVENT, &public);
    Ok(public)
}

#[tauri::command]
pub async fn test_ai_connection<R: Runtime>(
    app: AppHandle<R>,
    provider: Option<String>,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let target_pid = provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();

    let (maybe_key, _) = resolve_provider_key(&vault, &target_pid);
    let Some(api_key) = maybe_key else {
        return Ok(serde_json::json!({
            "ok": false,
            "provider": target_pid,
            "message": format!("No hay una clave API de {} guardada en la bóveda.", provider_display_name(&target_pid)),
        }));
    };
    let region = vault
        .providers
        .get(&target_pid)
        .and_then(|e| e.api_region.clone());

    let script = find_sidecar_script(&app)?;
    let pid_for_ledger = target_pid.clone();
    let res = tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "test_ai_key",
            serde_json::json!({
                "provider": target_pid,
                "api_key": api_key,
                "region": region,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))??;

    record_test_result_in_ledger(&app, &pid_for_ledger, &res);
    Ok(res)
}

#[tauri::command]
pub async fn fetch_openrouter_models<R: Runtime>(
    app: AppHandle<R>,
    free_only: Option<bool>,
    provider: Option<String>,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let target_pid = provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();
    let (maybe_key, _) = resolve_provider_key(&vault, &target_pid);
    let region = vault
        .providers
        .get(&target_pid)
        .and_then(|e| e.api_region.clone());
    let script = find_sidecar_script(&app)?;
    let only_free = free_only.unwrap_or(false);

    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "list_ai_models",
            serde_json::json!({
                "provider": target_pid,
                "api_key": maybe_key,
                "free_only": only_free,
                "region": region,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

#[tauri::command]
pub async fn run_xox_chat<R: Runtime>(
    app: AppHandle<R>,
    payload: XoxChatRequest,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let requested_provider = payload
        .provider_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();

    let Some((effective_provider, api_key, default_entry_model)) =
        resolve_first_available_provider(&vault, &requested_provider)
    else {
        return Err(format!(
            "Falta configurar tu clave API de {} (o un proveedor de respaldo).",
            provider_display_name(&requested_provider)
        ));
    };

    let script = find_sidecar_script(&app)?;
    let workspace_root_path = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app);
    let workspace_root = workspace_root_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());
    let (facts, screen_summary) =
        crate::slices::screen_context::store::build_unified_memory_for_workspace(
            workspace_root_path.as_deref(),
            &payload.message,
        );
    let model_id = if effective_provider == requested_provider {
        payload
            .model_override
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default_entry_model.clone())
    } else {
        default_entry_model
    };
    let provider_credentials = build_provider_credentials_json(&vault);
    let provider_region = vault
        .providers
        .get(&effective_provider)
        .and_then(|e| e.api_region.clone());
    let auto_failover = vault.auto_failover;
    let failover_order = vault.failover_order.clone();
    let xox_config_dir = crate::slices::xox_studio::store::xox_config_dir(&app)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let global_xox_profile = crate::slices::xox_studio::store::load_global_xox_profile(&app);
    let effective_user_profile =
        merge_effective_user_profile(&app, payload.user_profile.as_ref());
    let user_memory_facts = crate::workspace_store::load_user_memory(&app).facts;
    let tts_config = crate::slices::tts_voice::store::load_tts_config(&app);
    let app_for_sync = app.clone();
    let eff_for_sync = effective_provider.clone();

    let result = tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "ai_chat",
            serde_json::json!({
                "provider": effective_provider,
                "provider_region": provider_region,
                "api_key": api_key,
                "model_id": model_id,
                "provider_credentials": provider_credentials,
                "auto_failover": auto_failover,
                "failover_order": failover_order,
                "workspace_root": workspace_root,
                "xox_config_dir": xox_config_dir,
                "global_xox_profile": global_xox_profile,
                "tts_config": tts_config,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
                "user_profile": effective_user_profile,
                "user_memory_facts": user_memory_facts,
                "active_canvas": payload.active_canvas,
                "active_mode": payload.active_mode,
                "subagent_roster": payload.subagent_roster,
                "context_scope": payload.context_scope,
                "active_document": payload.active_document,
                "context_checkpoint": payload.context_checkpoint,
                "model_context_window": payload.model_context_window,
                "session_id": payload.session_id,
                "unified_memory": {
                    "facts": facts,
                    "screen_summary": screen_summary,
                },
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))??;

    sync_vault_from_sidecar_result(&app_for_sync, &result, &eff_for_sync);
    record_chat_turn_in_ledger(&app_for_sync, &result, &eff_for_sync);
    emit_user_data_updates_if_mutated(&app_for_sync, &result);
    Ok(result)
}

struct BrokerPendingCleanup<'a> {
    broker: &'a crate::slices::command_runner::runner::CommandPermissionBroker,
    request_id: String,
}

impl Drop for BrokerPendingCleanup<'_> {
    fn drop(&mut self) {
        self.broker.remove(&self.request_id);
    }
}

fn handle_command_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{
            PolicyVerdict, add_or_update_rule, command_needs_ext_write,
            evaluate_command_with_config,
        },
        runner::{
            CommandPermissionBroker, CommandPermissionDecision,
            execute_sandboxed_command_with_extra_bin, finish_command_execution,
            insert_command_execution,
        },
    };
    use crate::slices::host_fs::guard::is_broad_or_sensitive_root;
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cmd_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .unwrap_or("Ejecutar utilidad del workspace")
        .to_string();
    let command = parsed
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cwd = parsed
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or(".")
        .to_string();
    let timeout_sec = parsed
        .get("timeout_sec")
        .and_then(|v| v.as_u64())
        .unwrap_or(20);
    let detail_preview = parsed
        .get("detail_preview")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let venv_bin_dir = find_sidecar_script(app)
        .ok()
        .map(|sp| resolve_python_executable(&sp))
        .and_then(|py| py.parent().map(PathBuf::from))
        .filter(|dir| dir.is_dir());

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));

    let Some(workspace_root) = root else {
        return serde_json::json!({
            "ok": false,
            "status": "error",
            "error": "No hay un espacio de trabajo activo para ejecutar el comando."
        });
    };

    let Ok(conn) = open_workspace_db(&workspace_root) else {
        return serde_json::json!({
            "ok": false,
            "status": "error",
            "error": "No se pudo abrir la base de datos del espacio de trabajo."
        });
    };

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());
    let app_cfg_dir = app.path().app_config_dir().ok();
    let eval = evaluate_command_with_config(&workspace_root, app_cfg_dir.as_deref(), &command, &cwd);

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "blocked",
                "blocked",
            );
            let _ = finish_command_execution(&conn, &cmd_id, "blocked", Some("blocked"), None, None, None);
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason
            })
        }
        PolicyVerdict::Allow => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "always_rule",
                "running",
            );
            let res = execute_sandboxed_command_with_extra_bin(
                &conn,
                &workspace_root,
                &cmd_id,
                &eval,
                "always_rule",
                timeout_sec,
                venv_bin_dir.as_deref(),
            );
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "result": res,
                }),
            );
            if res.log_path.is_some() {
                let _ = app.emit(
                    WORKSPACE_UPDATED_EVENT,
                    serde_json::json!({ "reason": "command_log" }),
                );
            }
            serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
        }
        PolicyVerdict::Ask => {
            let _ = insert_command_execution(
                &conn,
                &cmd_id,
                stream_id.as_deref(),
                Some(&request_id),
                &purpose,
                &command,
                &eval,
                "ask",
                "awaiting_permission",
            );

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "purpose": purpose,
                    "command": command,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": eval.program,
                    "patternSuggestion": eval.pattern_suggestion,
                    "allowAlwaysAllowed": eval.allow_always_allowed,
                    "isExternal": eval.is_external,
                    "detailPreview": detail_preview,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => {
                    let res = execute_sandboxed_command_with_extra_bin(
                        &conn,
                        &workspace_root,
                        &cmd_id,
                        &eval,
                        "once",
                        timeout_sec,
                        venv_bin_dir.as_deref(),
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "result": res,
                        }),
                    );
                    if res.log_path.is_some() {
                        let _ = app.emit(
                            WORKSPACE_UPDATED_EVENT,
                            serde_json::json!({ "reason": "command_log" }),
                        );
                    }
                    serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
                }
                Ok(CommandPermissionDecision::AllowAlways) => {
                    let effective_mode = if eval.allow_always_allowed {
                        if let Ok(mut cfg) = add_or_update_rule(
                            &workspace_root,
                            &eval.pattern_suggestion,
                            "allow",
                            "program",
                            Some(purpose.clone()),
                        ) {
                            if eval.is_external {
                                let ext_scope = if command_needs_ext_write(&eval.program, eval.uses_shell) {
                                    "ext_write"
                                } else {
                                    "ext_read"
                                };
                                for ext_dir in &eval.external_dirs {
                                    if !is_broad_or_sensitive_root(ext_dir) {
                                        if let Ok(next_cfg) = add_or_update_rule(
                                            &workspace_root,
                                            &ext_dir.to_string_lossy(),
                                            "allow",
                                            ext_scope,
                                            Some(format!(
                                                "Carpeta externa autorizada para '{}'",
                                                eval.program
                                            )),
                                        ) {
                                            cfg = next_cfg;
                                        }
                                    }
                                }
                            }
                            let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                            let _ = app.emit(
                                WORKSPACE_UPDATED_EVENT,
                                serde_json::json!({ "reason": "permission_always" }),
                            );
                        }
                        "always"
                    } else {
                        "once"
                    };
                    let res = execute_sandboxed_command_with_extra_bin(
                        &conn,
                        &workspace_root,
                        &cmd_id,
                        &eval,
                        effective_mode,
                        timeout_sec,
                        venv_bin_dir.as_deref(),
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "result": res,
                        }),
                    );
                    serde_json::to_value(&res).unwrap_or_else(|_| serde_json::json!({ "ok": res.ok }))
                }
                Ok(CommandPermissionDecision::Deny) => {
                    let _ = finish_command_execution(
                        &conn,
                        &cmd_id,
                        "denied",
                        Some("denied"),
                        None,
                        None,
                        None,
                    );
                    let _ = try_record_audit_event_for_root(
                        &workspace_root,
                        "user",
                        "command_denied",
                        &eval.cwd_rel,
                        "agente",
                        Some(&command),
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "purpose": purpose,
                            "command": command,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": "El usuario rechazó ejecutar este comando."
                    })
                }
                Err(_) => {
                    let _ = finish_command_execution(
                        &conn,
                        &cmd_id,
                        "timeout_permission",
                        Some("ask"),
                        None,
                        None,
                        None,
                    );
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "status": "denied",
                            "error": "Tiempo de espera agotado para confirmar permiso."
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo."
                    })
                }
            }
        }
    }
}

fn compact_installed_app_json(app: &crate::slices::app_launcher::resolver::InstalledApp) -> serde_json::Value {
    serde_json::json!({
        "displayName": app.display_name,
        "fsName": app.fs_name,
        "bundleId": app.bundle_id,
        "category": app.category,
        "aliases": app.aliases,
    })
}

fn handle_list_apps_rpc_callback(parsed: &serde_json::Value) -> serde_json::Value {
    use crate::slices::app_launcher::resolver::{
        discover_installed_apps, resolve_app_in_catalog, AppResolution,
    };

    let query = parsed
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(25)
        .clamp(1, 60) as usize;

    let catalog = discover_installed_apps();
    if query.is_empty() {
        let items: Vec<serde_json::Value> = catalog
            .iter()
            .take(limit)
            .map(compact_installed_app_json)
            .collect();
        return serde_json::json!({
            "ok": true,
            "total": catalog.len(),
            "apps": items,
        });
    }

    match resolve_app_in_catalog(&catalog, &query) {
        AppResolution::Resolved { app } => serde_json::json!({
            "ok": true,
            "matchType": "exact",
            "apps": [compact_installed_app_json(&app)],
        }),
        AppResolution::Ambiguous { candidates, .. } => serde_json::json!({
            "ok": true,
            "matchType": "ambiguous",
            "apps": candidates.iter().take(limit).map(compact_installed_app_json).collect::<Vec<_>>(),
        }),
        AppResolution::NotFound { suggestions, .. } => serde_json::json!({
            "ok": true,
            "matchType": "suggestions",
            "apps": suggestions.iter().take(limit).map(compact_installed_app_json).collect::<Vec<_>>(),
        }),
        AppResolution::InvalidTarget { reason, .. } => serde_json::json!({
            "ok": false,
            "error": reason,
            "apps": [],
        }),
    }
}

fn execute_and_record_app_launch<R: Runtime>(
    app: &AppHandle<R>,
    conn: Option<&rusqlite::Connection>,
    workspace_root: Option<&std::path::Path>,
    cmd_id: &str,
    request_id: &str,
    stream_id: Option<&str>,
    purpose: &str,
    display_cmd: &str,
    permission_mode: &str,
    eval: &crate::slices::command_runner::policy::CommandEvaluation,
    target_app: &crate::slices::app_launcher::resolver::InstalledApp,
) -> serde_json::Value {
    use crate::slices::app_launcher::launcher::launch_resolved_app;
    use crate::slices::command_runner::runner::{finish_command_execution, CommandExecutionResult};
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;

    match launch_resolved_app(target_app) {
        Ok(outcome) => {
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "finished",
                    Some(permission_mode),
                    Some(outcome.exit_code),
                    Some(outcome.duration_ms),
                    None,
                );
            }
            if let Some(ws_root) = workspace_root {
                let _ = try_record_audit_event_for_root(
                    ws_root,
                    "user",
                    "app_opened",
                    "equipo",
                    "agente",
                    Some(display_cmd),
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: true,
                command_id: cmd_id.to_string(),
                status: "finished".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(outcome.exit_code),
                duration_ms: outcome.duration_ms.max(0) as u128,
                stdout: outcome.message.clone(),
                stderr: String::new(),
                truncated: false,
                log_path: None,
                error: None,
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "finished",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "result": cmd_result,
                }),
            );
            serde_json::json!({
                "ok": true,
                "status": "finished",
                "commandId": cmd_id,
                "permissionMode": permission_mode,
                "app": compact_installed_app_json(target_app),
                "message": outcome.message,
                "durationMs": outcome.duration_ms,
            })
        }
        Err(err_msg) => {
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "error",
                    Some(permission_mode),
                    Some(-1),
                    None,
                    None,
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: false,
                command_id: cmd_id.to_string(),
                status: "error".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(-1),
                duration_ms: 0,
                stdout: String::new(),
                stderr: err_msg.clone(),
                truncated: false,
                log_path: None,
                error: Some(err_msg.clone()),
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "error",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "result": cmd_result,
                    "error": err_msg,
                }),
            );
            serde_json::json!({
                "ok": false,
                "status": "error",
                "commandId": cmd_id,
                "error": err_msg,
            })
        }
    }
}

fn handle_open_app_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::app_launcher::resolver::{
        discover_installed_apps, resolve_app_in_catalog, AppResolution,
    };
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{PolicyVerdict, add_or_update_rule, evaluate_app_launch, make_app_evaluation},
        runner::{
            CommandPermissionBroker, CommandPermissionDecision, finish_command_execution,
            insert_command_execution,
        },
    };
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("app_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let app_name = parsed
        .get("app_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let raw_purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let catalog = discover_installed_apps();
    let target_app = match resolve_app_in_catalog(&catalog, &app_name) {
        AppResolution::Resolved { app } => app,
        AppResolution::Ambiguous { query, candidates } => {
            return serde_json::json!({
                "ok": false,
                "status": "ambiguous",
                "error": format!("Hay varias aplicaciones que coinciden con '{query}'. Pregunta al usuario cuál quiere abrir."),
                "candidates": candidates.iter().map(compact_installed_app_json).collect::<Vec<_>>(),
            });
        }
        AppResolution::NotFound { query, suggestions } => {
            return serde_json::json!({
                "ok": false,
                "status": "not_found",
                "error": format!("No se encontró una aplicación instalada que coincida con '{query}'."),
                "suggestions": suggestions.iter().map(compact_installed_app_json).collect::<Vec<_>>(),
            });
        }
        AppResolution::InvalidTarget { reason, .. } => {
            return serde_json::json!({
                "ok": false,
                "status": "invalid_target",
                "error": reason,
            });
        }
    };

    let purpose = if raw_purpose.is_empty() {
        format!("Abrir la aplicación {}.", target_app.display_name)
    } else {
        raw_purpose
    };
    let display_cmd = format!(
        "open_app: {} ({})",
        target_app.display_name,
        target_app.bundle_id.as_deref().unwrap_or(&target_app.fs_name)
    );

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let conn = root.as_deref().and_then(|r| open_workspace_db(r).ok());

    let eval = if let Some(ref ws_root) = root {
        evaluate_app_launch(
            ws_root,
            target_app.bundle_id.as_deref(),
            &target_app.display_name,
            &target_app.fs_name,
        )
    } else {
        let suggestion = target_app
            .bundle_id
            .as_deref()
            .unwrap_or(&target_app.fs_name);
        make_app_evaluation(
            PolicyVerdict::Ask,
            None,
            "low",
            PathBuf::from("/"),
            suggestion,
            &target_app.fs_name,
        )
    };

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "blocked",
                    "blocked",
                );
                let _ = finish_command_execution(c, &cmd_id, "blocked", Some("blocked"), None, None, None);
            }
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason,
            })
        }
        PolicyVerdict::Allow => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "always_rule",
                    "running",
                );
            }
            execute_and_record_app_launch(
                app,
                conn.as_ref(),
                root.as_deref(),
                &cmd_id,
                &request_id,
                stream_id.as_deref(),
                &purpose,
                &display_cmd,
                "always_rule",
                &eval,
                &target_app,
            )
        }
        PolicyVerdict::Ask => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval,
                    "ask",
                    "awaiting_permission",
                );
            }

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": "open_app",
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": target_app.display_name,
                    "patternSuggestion": eval.pattern_suggestion,
                    "appName": target_app.display_name,
                    "bundleId": target_app.bundle_id,
                    "appPath": target_app.app_path,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => execute_and_record_app_launch(
                    app,
                    conn.as_ref(),
                    root.as_deref(),
                    &cmd_id,
                    &request_id,
                    stream_id.as_deref(),
                    &purpose,
                    &display_cmd,
                    "once",
                    &eval,
                    &target_app,
                ),
                Ok(CommandPermissionDecision::AllowAlways) => {
                    if let Some(ref ws_root) = root {
                        if let Ok(cfg) = add_or_update_rule(
                            ws_root,
                            &eval.pattern_suggestion,
                            "allow",
                            "app",
                            Some(format!("Abrir {}", target_app.display_name)),
                        ) {
                            let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                            let _ = app.emit(
                                WORKSPACE_UPDATED_EVENT,
                                serde_json::json!({ "reason": "permission_always" }),
                            );
                        }
                    }
                    execute_and_record_app_launch(
                        app,
                        conn.as_ref(),
                        root.as_deref(),
                        &cmd_id,
                        &request_id,
                        stream_id.as_deref(),
                        &purpose,
                        &display_cmd,
                        "always",
                        &eval,
                        &target_app,
                    )
                }
                Ok(CommandPermissionDecision::Deny) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "denied",
                            Some("denied"),
                            None,
                            None,
                            None,
                        );
                    }
                    if let Some(ref ws_root) = root {
                        let _ = try_record_audit_event_for_root(
                            ws_root,
                            "user",
                            "app_open_denied",
                            "equipo",
                            "agente",
                            Some(&display_cmd),
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": "open_app",
                            "purpose": purpose,
                            "command": display_cmd,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                            "appName": target_app.display_name,
                            "bundleId": target_app.bundle_id,
                            "appPath": target_app.app_path,
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": format!("El usuario rechazó abrir '{}'.", target_app.display_name),
                    })
                }
                Err(_) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "timeout_permission",
                            Some("ask"),
                            None,
                            None,
                            None,
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": "open_app",
                            "status": "denied",
                            "appName": target_app.display_name,
                            "bundleId": target_app.bundle_id,
                            "appPath": target_app.app_path,
                            "error": "Tiempo de espera agotado para confirmar permiso.",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo.",
                    })
                }
            }
        }
    }
}

struct CapabilityActionSpec {
    kind: &'static str,
    capability_key: std::borrow::Cow<'static, str>,
    risk_level: &'static str,
    purpose: String,
    display_cmd: String,
    audit_action: &'static str,
    deny_audit_action: &'static str,
    app_name: std::borrow::Cow<'static, str>,
    bundle_id: std::borrow::Cow<'static, str>,
    rule_description: std::borrow::Cow<'static, str>,
    detail_preview: Option<String>,
    force_ask_once: bool,
}

fn execute_and_record_capability_action<R, F>(
    app: &AppHandle<R>,
    conn: Option<&rusqlite::Connection>,
    workspace_root: Option<&std::path::Path>,
    cmd_id: &str,
    request_id: &str,
    stream_id: Option<&str>,
    permission_mode: &str,
    eval: &crate::slices::command_runner::policy::CommandEvaluation,
    spec: &CapabilityActionSpec,
    action_fn: F,
) -> serde_json::Value
where
    R: Runtime,
    F: FnOnce() -> Result<(serde_json::Value, String), String>,
{
    use crate::slices::command_runner::runner::{finish_command_execution, CommandExecutionResult};
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;

    let started = std::time::Instant::now();
    match action_fn() {
        Ok((payload_val, summary)) => {
            let duration_ms = started.elapsed().as_millis() as i64;
            let payload_ok = payload_val
                .get("ok")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let final_status = if payload_ok { "finished" } else { "error" };
            let final_exit = if payload_ok { 0 } else { -1 };
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    final_status,
                    Some(permission_mode),
                    Some(final_exit),
                    Some(duration_ms),
                    None,
                );
            }
            if let Some(ws_root) = workspace_root {
                let _ = try_record_audit_event_for_root(
                    ws_root,
                    "user",
                    spec.audit_action,
                    "equipo",
                    "agente",
                    Some(&spec.display_cmd),
                );
            }
            let payload_err = if payload_ok {
                None
            } else {
                payload_val
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| Some(summary.clone()))
            };
            let cmd_result = CommandExecutionResult {
                ok: payload_ok,
                command_id: cmd_id.to_string(),
                status: final_status.to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(final_exit),
                duration_ms: duration_ms.max(0) as u128,
                stdout: if payload_ok { summary } else { String::new() },
                stderr: if payload_ok {
                    String::new()
                } else {
                    payload_err.clone().unwrap_or_default()
                },
                truncated: false,
                log_path: None,
                error: payload_err.clone(),
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": final_status,
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "result": cmd_result,
                    "error": payload_err,
                }),
            );
            payload_val
        }
        Err(err_msg) => {
            let duration_ms = started.elapsed().as_millis() as i64;
            if let Some(c) = conn {
                let _ = finish_command_execution(
                    c,
                    cmd_id,
                    "error",
                    Some(permission_mode),
                    Some(-1),
                    Some(duration_ms),
                    None,
                );
            }
            let cmd_result = CommandExecutionResult {
                ok: false,
                command_id: cmd_id.to_string(),
                status: "error".to_string(),
                permission_mode: permission_mode.to_string(),
                exit_code: Some(-1),
                duration_ms: duration_ms.max(0) as u128,
                stdout: String::new(),
                stderr: err_msg.clone(),
                truncated: false,
                log_path: None,
                error: Some(err_msg.clone()),
            };
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "error",
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "result": cmd_result,
                    "error": err_msg,
                }),
            );
            serde_json::json!({
                "ok": false,
                "status": "error",
                "commandId": cmd_id,
                "error": err_msg,
            })
        }
    }
}

fn run_capability_gated_action<R, F>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
    spec: CapabilityActionSpec,
    action_fn: F,
) -> serde_json::Value
where
    R: Runtime,
    F: FnOnce() -> Result<(serde_json::Value, String), String>,
{
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{PolicyVerdict, add_or_update_rule, evaluate_capability, make_app_evaluation},
        runner::{
            CommandPermissionBroker, CommandPermissionDecision, finish_command_execution,
            insert_command_execution,
        },
    };
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("cap_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let conn = root.as_deref().and_then(|r| open_workspace_db(r).ok());

    let mut eval = if let Some(ref ws_root) = root {
        evaluate_capability(ws_root, spec.capability_key.as_ref(), spec.risk_level)
    } else {
        make_app_evaluation(
            PolicyVerdict::Ask,
            None,
            spec.risk_level,
            PathBuf::from("/"),
            spec.capability_key.as_ref(),
            spec.capability_key.as_ref(),
        )
    };
    if spec.force_ask_once {
        eval.allow_always_allowed = false;
        if matches!(eval.verdict, PolicyVerdict::Allow) {
            eval.verdict = PolicyVerdict::Ask;
        }
    }

    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());

    match &eval.verdict {
        PolicyVerdict::Deny(reason) => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "blocked",
                    "blocked",
                );
                let _ = finish_command_execution(c, &cmd_id, "blocked", Some("blocked"), None, None, None);
            }
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "status": "blocked",
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason,
            })
        }
        PolicyVerdict::Allow => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "always_rule",
                    "running",
                );
            }
            execute_and_record_capability_action(
                app,
                conn.as_ref(),
                root.as_deref(),
                &cmd_id,
                &request_id,
                stream_id.as_deref(),
                "always_rule",
                &eval,
                &spec,
                action_fn,
            )
        }
        PolicyVerdict::Ask => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &spec.purpose,
                    &spec.display_cmd,
                    &eval,
                    "ask",
                    "awaiting_permission",
                );
            }

            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": spec.kind,
                    "purpose": spec.purpose,
                    "command": spec.display_cmd,
                    "cwdRel": eval.cwd_rel,
                    "riskLevel": eval.risk_level,
                    "program": spec.app_name,
                    "patternSuggestion": spec.capability_key,
                    "allowAlwaysAllowed": !spec.force_ask_once,
                    "appName": spec.app_name,
                    "bundleId": spec.bundle_id,
                    "detailPreview": spec.detail_preview,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => execute_and_record_capability_action(
                    app,
                    conn.as_ref(),
                    root.as_deref(),
                    &cmd_id,
                    &request_id,
                    stream_id.as_deref(),
                    "once",
                    &eval,
                    &spec,
                    action_fn,
                ),
                Ok(CommandPermissionDecision::AllowAlways) => {
                    let eff_mode = if spec.force_ask_once {
                        "once"
                    } else {
                        if let Some(ref ws_root) = root {
                            if let Ok(cfg) = add_or_update_rule(
                                ws_root,
                                spec.capability_key.as_ref(),
                                "allow",
                                "capability",
                                Some(spec.rule_description.to_string()),
                            ) {
                                let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                                let _ = app.emit(
                                    WORKSPACE_UPDATED_EVENT,
                                    serde_json::json!({ "reason": "permission_always" }),
                                );
                            }
                        }
                        "always"
                    };
                    execute_and_record_capability_action(
                        app,
                        conn.as_ref(),
                        root.as_deref(),
                        &cmd_id,
                        &request_id,
                        stream_id.as_deref(),
                        eff_mode,
                        &eval,
                        &spec,
                        action_fn,
                    )
                }
                Ok(CommandPermissionDecision::Deny) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "denied",
                            Some("denied"),
                            None,
                            None,
                            None,
                        );
                    }
                    if let Some(ref ws_root) = root {
                        let _ = try_record_audit_event_for_root(
                            ws_root,
                            "user",
                            spec.deny_audit_action,
                            "equipo",
                            "agente",
                            Some(&spec.display_cmd),
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": spec.kind,
                            "purpose": spec.purpose,
                            "command": spec.display_cmd,
                            "cwdRel": eval.cwd_rel,
                            "riskLevel": eval.risk_level,
                            "status": "denied",
                            "appName": spec.app_name,
                            "bundleId": spec.bundle_id,
                            "detailPreview": spec.detail_preview,
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": format!("El usuario rechazó esta acción en {}.", spec.app_name),
                    })
                }
                Err(_) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "timeout_permission",
                            Some("ask"),
                            None,
                            None,
                            None,
                        );
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": spec.kind,
                            "status": "denied",
                            "appName": spec.app_name,
                            "bundleId": spec.bundle_id,
                            "detailPreview": spec.detail_preview,
                            "error": "Tiempo de espera agotado para confirmar permiso.",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo.",
                    })
                }
            }
        }
    }
}

fn run_host_fs_gated_action<R, F>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
    kind: &'static str,
    op: crate::slices::host_fs::guard::HostFsOperation,
    raw_path: &str,
    purpose: String,
    display_cmd: String,
    detail_preview: Option<String>,
    action_fn: F,
) -> serde_json::Value
where
    R: Runtime,
    F: FnOnce(&std::path::Path) -> Result<(serde_json::Value, String), String>,
{
    use crate::slices::command_runner::{
        commands::PERMISSIONS_UPDATED_EVENT,
        policy::{CommandEvaluation, PolicyVerdict, add_or_update_rule},
        runner::{
            CommandExecutionResult, CommandPermissionBroker, CommandPermissionDecision,
            finish_command_execution, insert_command_execution,
        },
    };
    use crate::slices::host_fs::guard::evaluate_host_fs_access;
    use crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::try_record_audit_event_for_root;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let request_id = parsed
        .get("request_id")
        .and_then(|v| v.as_str())
        .unwrap_or("extfs_req")
        .to_string();
    let stream_id = parsed
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let conn = root.as_deref().and_then(|r| open_workspace_db(r).ok());
    let app_cfg_dir = app.path().app_config_dir().ok();
    let ws_fallback = PathBuf::from("/__xook_no_workspace__");
    let ws_ref = root.as_deref().unwrap_or(&ws_fallback);

    let mut host_eval = match evaluate_host_fs_access(ws_ref, app_cfg_dir.as_deref(), raw_path, op) {
        Ok(ev) => ev,
        Err(err) => {
            return serde_json::json!({
                "ok": false,
                "status": "error",
                "error": err,
            });
        }
    };
    if root.is_none() && matches!(host_eval.verdict, PolicyVerdict::Allow) {
        host_eval.verdict = PolicyVerdict::Ask;
        host_eval.allow_always_allowed = false;
    }

    let scope_dir_str = host_eval.scope_dir.to_string_lossy().to_string();
    let eval_cmd = CommandEvaluation {
        verdict: host_eval.verdict.clone(),
        matched_rule: host_eval.matched_rule.clone(),
        risk_level: host_eval.risk_level.clone(),
        program: kind.to_string(),
        args: vec![host_eval.canonical_path.to_string_lossy().to_string()],
        cwd_abs: host_eval.scope_dir.clone(),
        cwd_rel: scope_dir_str.clone(),
        pattern_suggestion: scope_dir_str.clone(),
        allow_always_allowed: host_eval.allow_always_allowed,
        uses_shell: false,
        raw_command: display_cmd.clone(),
        is_external: !host_eval.inside_workspace,
        external_dirs: if host_eval.inside_workspace {
            Vec::new()
        } else {
            vec![host_eval.scope_dir.clone()]
        },
    };
    let cmd_id = format!("{request_id}_{}", chrono::Utc::now().timestamp_millis());
    let audit_action = if op.is_write() { "ext_fs_write" } else { "ext_fs_read" };

    let run_now = |perm_mode: &str, emit_events: bool| -> serde_json::Value {
        let started = std::time::Instant::now();
        match action_fn(&host_eval.canonical_path) {
            Ok((mut payload, summary)) => {
                let duration_ms = started.elapsed().as_millis() as i64;
                if emit_events {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "finished",
                            Some(perm_mode),
                            Some(0),
                            Some(duration_ms),
                            None,
                        );
                    }
                    let cmd_result = CommandExecutionResult {
                        ok: true,
                        command_id: cmd_id.clone(),
                        status: "finished".to_string(),
                        permission_mode: perm_mode.to_string(),
                        exit_code: Some(0),
                        duration_ms: duration_ms.max(0) as u128,
                        stdout: summary,
                        stderr: String::new(),
                        truncated: false,
                        log_path: None,
                        error: None,
                    };
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": kind,
                            "purpose": purpose,
                            "command": display_cmd,
                            "cwdRel": scope_dir_str,
                            "riskLevel": host_eval.risk_level,
                            "status": "finished",
                            "detailPreview": detail_preview,
                            "result": cmd_result,
                        }),
                    );
                }
                if emit_events || op.is_write() {
                    if let Some(ref ws_root) = root {
                        let _ = try_record_audit_event_for_root(
                            ws_root,
                            "user",
                            audit_action,
                            &host_eval.canonical_path.to_string_lossy(),
                            "agente",
                            Some(&display_cmd),
                        );
                    }
                }
                if let Some(obj) = payload.as_object_mut() {
                    obj.entry("ok").or_insert(serde_json::json!(true));
                    obj.insert("outside_workspace".to_string(), serde_json::json!(!host_eval.inside_workspace));
                }
                payload
            }
            Err(err_msg) => {
                let duration_ms = started.elapsed().as_millis() as i64;
                if emit_events {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(
                            c,
                            &cmd_id,
                            "error",
                            Some(perm_mode),
                            Some(-1),
                            Some(duration_ms),
                            None,
                        );
                    }
                    let cmd_result = CommandExecutionResult {
                        ok: false,
                        command_id: cmd_id.clone(),
                        status: "error".to_string(),
                        permission_mode: perm_mode.to_string(),
                        exit_code: Some(-1),
                        duration_ms: duration_ms.max(0) as u128,
                        stdout: String::new(),
                        stderr: err_msg.clone(),
                        truncated: false,
                        log_path: None,
                        error: Some(err_msg.clone()),
                    };
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": kind,
                            "purpose": purpose,
                            "command": display_cmd,
                            "cwdRel": scope_dir_str,
                            "riskLevel": host_eval.risk_level,
                            "status": "error",
                            "detailPreview": detail_preview,
                            "result": cmd_result,
                            "error": err_msg,
                        }),
                    );
                }
                serde_json::json!({
                    "ok": false,
                    "status": "error",
                    "error": err_msg,
                })
            }
        }
    };

    match &host_eval.verdict {
        PolicyVerdict::Deny(reason) => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval_cmd,
                    "blocked",
                    "blocked",
                );
                let _ = finish_command_execution(c, &cmd_id, "blocked", Some("blocked"), None, None, None);
            }
            let _ = app.emit(
                "xox:command-finished",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": kind,
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": scope_dir_str,
                    "riskLevel": "blocked",
                    "status": "blocked",
                    "detailPreview": detail_preview,
                    "error": reason,
                }),
            );
            serde_json::json!({
                "ok": false,
                "commandId": cmd_id,
                "status": "blocked",
                "error": reason,
            })
        }
        PolicyVerdict::Allow => run_now("always_rule", false),
        PolicyVerdict::Ask => {
            if let Some(ref c) = conn {
                let _ = insert_command_execution(
                    c,
                    &cmd_id,
                    stream_id.as_deref(),
                    Some(&request_id),
                    &purpose,
                    &display_cmd,
                    &eval_cmd,
                    "ask",
                    "awaiting_permission",
                );
            }
            let broker = app.state::<CommandPermissionBroker>();
            let rx = broker.register(&request_id);
            let _cleanup = BrokerPendingCleanup {
                broker: &broker,
                request_id: request_id.clone(),
            };

            let _ = app.emit(
                "xox-permission-request",
                serde_json::json!({
                    "requestId": request_id,
                    "streamId": stream_id,
                    "commandId": cmd_id,
                    "kind": kind,
                    "purpose": purpose,
                    "command": display_cmd,
                    "cwdRel": scope_dir_str,
                    "riskLevel": host_eval.risk_level,
                    "program": kind,
                    "patternSuggestion": scope_dir_str,
                    "allowAlwaysAllowed": host_eval.allow_always_allowed,
                    "isExternal": true,
                    "detailPreview": detail_preview,
                }),
            );

            match rx.recv_timeout(std::time::Duration::from_secs(180)) {
                Ok(CommandPermissionDecision::AllowOnce) => run_now("once", true),
                Ok(CommandPermissionDecision::AllowAlways) => {
                    let effective = if host_eval.allow_always_allowed {
                        if let Some(ref ws_root) = root {
                            let desc = if host_eval.scope_kind == "ext_write" {
                                format!("Escritura en carpeta externa: {scope_dir_str}")
                            } else {
                                format!("Lectura en carpeta externa: {scope_dir_str}")
                            };
                            if let Ok(cfg) = add_or_update_rule(
                                ws_root,
                                &scope_dir_str,
                                "allow",
                                &host_eval.scope_kind,
                                Some(desc),
                            ) {
                                let _ = app.emit(PERMISSIONS_UPDATED_EVENT, &cfg);
                                let _ = app.emit(
                                    WORKSPACE_UPDATED_EVENT,
                                    serde_json::json!({ "reason": "permission_always" }),
                                );
                            }
                        }
                        "always"
                    } else {
                        "once"
                    };
                    run_now(effective, true)
                }
                Ok(CommandPermissionDecision::Deny) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(c, &cmd_id, "denied", Some("denied"), None, None, None);
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": kind,
                            "purpose": purpose,
                            "command": display_cmd,
                            "cwdRel": scope_dir_str,
                            "riskLevel": host_eval.risk_level,
                            "status": "denied",
                            "detailPreview": detail_preview,
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "permissionMode": "denied",
                        "error": "El usuario rechazó el acceso a esta ruta del equipo.",
                    })
                }
                Err(_) => {
                    if let Some(ref c) = conn {
                        let _ = finish_command_execution(c, &cmd_id, "timeout_permission", Some("ask"), None, None, None);
                    }
                    let _ = app.emit(
                        "xox:command-finished",
                        serde_json::json!({
                            "requestId": request_id,
                            "streamId": stream_id,
                            "commandId": cmd_id,
                            "kind": kind,
                            "status": "denied",
                            "error": "Tiempo de espera agotado para confirmar acceso a la ruta.",
                        }),
                    );
                    serde_json::json!({
                        "ok": false,
                        "commandId": cmd_id,
                        "status": "denied",
                        "error": "No se recibió confirmación del usuario a tiempo.",
                    })
                }
            }
        }
    }
}

fn handle_host_fs_list_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::{actions::list_host_directory, guard::HostFsOperation};
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("~").trim();
    let filter = parsed.get("filter").and_then(|v| v.as_str()).map(str::to_string);
    let max_entries = parsed.get("max_entries").and_then(|v| v.as_u64()).map(|n| n as usize);
    let ws_root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let app_cfg_dir = app.path().app_config_dir().ok();

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_list",
        HostFsOperation::List,
        raw_path,
        format!("Listar carpeta del equipo: {raw_path}"),
        format!("Listar {raw_path}"),
        None,
        |canon| {
            let val = list_host_directory(
                canon,
                filter.as_deref(),
                max_entries,
                app_cfg_dir.as_deref(),
                ws_root.as_deref(),
            )?;
            let count = val
                .get("entries")
                .and_then(|e| e.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            Ok((val, format!("{count} elementos listados")))
        },
    )
}

fn handle_host_fs_search_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::{actions::search_host_files, guard::HostFsOperation};
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("~").trim();
    let query = parsed.get("query").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let mode = parsed.get("mode").and_then(|v| v.as_str()).unwrap_or("auto").to_string();
    let max_results = parsed.get("max_results").and_then(|v| v.as_u64()).map(|n| n as usize);
    let ws_root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let app_cfg_dir = app.path().app_config_dir().ok();

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_search",
        HostFsOperation::Search,
        raw_path,
        format!("Buscar '{query}' en {raw_path}"),
        format!("Buscar \"{query}\" en {raw_path}"),
        None,
        |canon| {
            let val = search_host_files(
                canon,
                &query,
                &mode,
                max_results,
                app_cfg_dir.as_deref(),
                ws_root.as_deref(),
            )?;
            let count = val
                .get("matches")
                .and_then(|m| m.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            Ok((val, format!("{count} coincidencias")))
        },
    )
}

fn handle_host_fs_authorize_read_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::guard::HostFsOperation;

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    if raw_path.is_empty() {
        return serde_json::json!({ "ok": false, "error": "Falta la ruta del archivo a leer." });
    }

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_read",
        HostFsOperation::Read,
        raw_path,
        format!("Leer archivo del equipo: {raw_path}"),
        format!("Leer {raw_path}"),
        None,
        |canon| {
            let canon_str = canon.to_string_lossy().to_string();
            Ok((
                serde_json::json!({
                    "ok": true,
                    "authorized_path": canon_str,
                }),
                format!("Lectura autorizada: {canon_str}"),
            ))
        },
    )
}

fn handle_host_fs_write_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::{actions::write_host_file_atomic, guard::HostFsOperation};

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if raw_path.is_empty() {
        return serde_json::json!({ "ok": false, "error": "Falta la ruta destino." });
    }

    let preview_snip: String = content.trim().chars().take(240).collect();
    let detail_preview = Some(format!(
        "Archivo: {raw_path}\nTamaño: {} bytes\nVista previa:\n{preview_snip}",
        content.len()
    ));

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_write",
        HostFsOperation::Write,
        raw_path,
        format!("Escribir archivo en el equipo: {raw_path}"),
        format!("Escribir {raw_path}"),
        detail_preview,
        |canon| {
            let val = write_host_file_atomic(canon, &content)?;
            Ok((val, format!("Archivo guardado ({} bytes)", content.len())))
        },
    )
}

fn handle_host_fs_edit_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::command_runner::policy::PolicyVerdict;
    use crate::slices::host_fs::{
        actions::{prepare_host_edit, write_host_file_atomic},
        guard::{HostFsOperation, evaluate_host_fs_access},
    };
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    let old_text = parsed.get("old_text").and_then(|v| v.as_str()).unwrap_or("");
    let new_text = parsed.get("new_text").and_then(|v| v.as_str()).unwrap_or("");
    let replace_all = parsed.get("replace_all").and_then(|v| v.as_bool()).unwrap_or(false);

    if raw_path.is_empty() {
        return serde_json::json!({ "ok": false, "error": "Falta la ruta del archivo a editar." });
    }

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let app_cfg_dir = app.path().app_config_dir().ok();
    let ws_fallback = PathBuf::from("/__xook_no_workspace__");
    let ws_ref = root.as_deref().unwrap_or(&ws_fallback);

    // Pre-checar Capa 1 ANTES de abrir el archivo para generar vista previa del parche
    let mut prepared_patch: Option<(String, String)> = None;
    if let Ok(pre_eval) = evaluate_host_fs_access(ws_ref, app_cfg_dir.as_deref(), raw_path, HostFsOperation::Edit) {
        if !matches!(pre_eval.verdict, PolicyVerdict::Deny(_)) {
            match prepare_host_edit(&pre_eval.canonical_path, old_text, new_text, replace_all) {
                Ok(pair) => prepared_patch = Some(pair),
                Err(err) => {
                    return serde_json::json!({ "ok": false, "error": err });
                }
            }
        }
    }

    let preview = prepared_patch.as_ref().map(|(_, p)| p.clone());
    let updated_content = prepared_patch.map(|(u, _)| u).unwrap_or_default();

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_edit",
        HostFsOperation::Edit,
        raw_path,
        format!("Editar archivo del equipo: {raw_path}"),
        format!("Editar {raw_path}"),
        preview,
        |canon| {
            let mut val = write_host_file_atomic(canon, &updated_content)?;
            if let Some(obj) = val.as_object_mut() {
                obj.insert("edited".to_string(), serde_json::json!(true));
            }
            Ok((val, "Archivo editado correctamente".to_string()))
        },
    )
}

fn handle_host_fs_mkdir_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::{actions::mkdir_host_dir, guard::HostFsOperation};

    let raw_path = parsed.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
    if raw_path.is_empty() {
        return serde_json::json!({ "ok": false, "error": "Falta la ruta de la carpeta a crear." });
    }

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_mkdir",
        HostFsOperation::Mkdir,
        raw_path,
        format!("Crear carpeta en el equipo: {raw_path}"),
        format!("Crear carpeta {raw_path}"),
        None,
        |canon| {
            let val = mkdir_host_dir(canon)?;
            Ok((val, format!("Carpeta creada: {}", canon.display())))
        },
    )
}

fn handle_host_fs_copy_from_workspace_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::host_fs::guard::HostFsOperation;
    use crate::slices::workspace_manager::{
        registry::resolve_active_workspace_root,
        sandbox::{WorkspaceZone, resolve_inside_workspace},
    };

    let src_rel = parsed.get("src_rel").and_then(|v| v.as_str()).unwrap_or("").trim();
    let dest_path = parsed.get("dest_path").and_then(|v| v.as_str()).unwrap_or("").trim();
    if src_rel.is_empty() || dest_path.is_empty() {
        return serde_json::json!({ "ok": false, "error": "Faltan rutas origen/destino." });
    }

    let Some(ws_root) = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app))
    else {
        return serde_json::json!({ "ok": false, "error": "No hay espacio de trabajo activo." });
    };

    let src_abs = match resolve_inside_workspace(&ws_root, src_rel, true) {
        Ok((abs, _, zone)) if zone != WorkspaceZone::Meta && abs.is_file() => abs,
        Ok(_) => return serde_json::json!({ "ok": false, "error": "El archivo origen no existe." }),
        Err(err) => return serde_json::json!({ "ok": false, "error": err }),
    };

    run_host_fs_gated_action(
        app,
        parsed,
        fallback_workspace_root,
        "ext_fs_write",
        HostFsOperation::Write,
        dest_path,
        format!("Guardar archivo generado en el equipo: {dest_path}"),
        format!("Guardar en {dest_path}"),
        Some(format!("Destino: {dest_path}\nOrigen temporal: {src_rel}")),
        |canon_dest| {
            if let Some(parent) = canon_dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("No se pudo crear carpeta destino: {e}"))?;
            }
            let copied = std::fs::copy(&src_abs, canon_dest)
                .map_err(|e| format!("Error copiando archivo a destino externo: {e}"))?;
            Ok((
                serde_json::json!({
                    "ok": true,
                    "path": canon_dest.to_string_lossy().to_string(),
                    "bytes_written": copied,
                }),
                format!("Archivo guardado ({copied} bytes)"),
            ))
        },
    )
}

fn handle_notes_list_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::notes::{list_notes, validate_notes_list_query};

    let query = parsed.get("query").and_then(|v| v.as_str());
    let folder = parsed.get("folder").and_then(|v| v.as_str());
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let validated = validate_notes_list_query(query, folder, limit);

    let mut preview_parts = Vec::new();
    if !validated.query.is_empty() {
        preview_parts.push(format!("Búsqueda: {}", validated.query));
    }
    if let Some(ref f) = validated.folder {
        preview_parts.push(format!("Carpeta: {f}"));
    }
    let display_cmd = if validated.query.is_empty() {
        "os_notes: listar notas".to_string()
    } else {
        format!("os_notes: buscar '{}'", validated.query)
    };
    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Consultar notas existentes en la app Notas de Mac.".to_string());

    let spec = CapabilityActionSpec {
        kind: "os_notes_read",
        capability_key: "notes:read".into(),
        risk_level: "low",
        purpose,
        display_cmd,
        audit_action: "os_notes_read",
        deny_audit_action: "os_notes_read_denied",
        app_name: "Notas".into(),
        bundle_id: "com.apple.Notes".into(),
        rule_description: "Consultar Notas de Mac".into(),
        detail_preview: if preview_parts.is_empty() {
            None
        } else {
            Some(preview_parts.join(" · "))
        },
        force_ask_once: false,
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = list_notes(&validated)?;
        let summary = format!("Se encontraron {} notas.", out.notes.len());
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_notes_create_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::notes::{create_note, validate_note_create_input};

    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let body = parsed.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let folder = parsed.get("folder").and_then(|v| v.as_str());
    let open_after = parsed
        .get("open_after")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let validated = match validate_note_create_input(title, body, folder, open_after) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let body_excerpt: String = validated
        .body
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(140)
        .collect();
    let mut preview = format!("Título: {}", validated.title);
    if let Some(ref f) = validated.folder {
        preview.push_str(&format!("\nCarpeta: {f}"));
    }
    if !body_excerpt.is_empty() {
        preview.push_str(&format!("\nContenido: {body_excerpt}"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Crear nota '{}' en Notas.", validated.title));

    let spec = CapabilityActionSpec {
        kind: "os_notes_write",
        capability_key: "notes:write".into(),
        risk_level: "medium",
        purpose,
        display_cmd: format!("os_notes: crear '{}'", validated.title),
        audit_action: "os_note_created",
        deny_audit_action: "os_note_create_denied",
        app_name: "Notas".into(),
        bundle_id: "com.apple.Notes".into(),
        rule_description: "Crear notas en Notas de Mac".into(),
        detail_preview: Some(preview),
        force_ask_once: false,
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = create_note(&validated)?;
        let summary = out
            .message
            .clone()
            .unwrap_or_else(|| format!("Se creó la nota '{}'.", out.title));
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_calendar_list_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::calendar::{
        list_calendar_events, validate_calendar_list_query,
    };

    let start_iso = parsed.get("start_iso").and_then(|v| v.as_str());
    let end_iso = parsed.get("end_iso").and_then(|v| v.as_str());
    let calendar_name = parsed.get("calendar_name").and_then(|v| v.as_str());
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);

    let validated = match validate_calendar_list_query(start_iso, end_iso, calendar_name, limit) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let mut preview = format!("Rango: {} → {}", validated.start_label, validated.end_label);
    if let Some(ref c) = validated.calendar_name {
        preview.push_str(&format!("\nCalendario: {c}"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Consultar eventos en Calendario ({} → {}).",
                validated.start_label, validated.end_label
            )
        });

    let spec = CapabilityActionSpec {
        kind: "os_calendar_read",
        capability_key: "calendar:read".into(),
        risk_level: "low",
        purpose,
        display_cmd: format!(
            "os_calendar: consultar ({} → {})",
            validated.start_label, validated.end_label
        ),
        audit_action: "os_calendar_read",
        deny_audit_action: "os_calendar_read_denied",
        app_name: "Calendario".into(),
        bundle_id: "com.apple.iCal".into(),
        rule_description: "Consultar eventos en Calendario de Mac".into(),
        detail_preview: Some(preview),
        force_ask_once: false,
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = list_calendar_events(&validated)?;
        let summary = format!(
            "Se consultaron {} calendarios y {} eventos.",
            out.calendars.len(),
            out.events.len()
        );
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_calendar_create_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::env_actions::calendar::{
        create_calendar_event, validate_calendar_create_input,
    };

    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let start_iso = parsed
        .get("start_iso")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let end_iso = parsed.get("end_iso").and_then(|v| v.as_str());
    let all_day = parsed
        .get("all_day")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let calendar_name = parsed.get("calendar_name").and_then(|v| v.as_str());
    let location = parsed.get("location").and_then(|v| v.as_str());
    let description = parsed.get("description").and_then(|v| v.as_str());
    let reminder_minutes_before = parsed
        .get("reminder_minutes_before")
        .and_then(|v| v.as_i64())
        .map(|n| n as i32);
    let open_after = parsed
        .get("open_after")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let validated = match validate_calendar_create_input(
        title,
        start_iso,
        end_iso,
        all_day,
        calendar_name,
        location,
        description,
        reminder_minutes_before,
        open_after,
    ) {
        Ok(v) => v,
        Err(err) => return serde_json::json!({ "ok": false, "status": "invalid", "error": err }),
    };

    let mut preview = if validated.all_day {
        format!("Evento: {}\nCuándo: {}", validated.title, validated.start_label)
    } else {
        format!(
            "Evento: {}\nHorario: {} → {}",
            validated.title, validated.start_label, validated.end_label
        )
    };
    if let Some(ref cal) = validated.calendar_name {
        preview.push_str(&format!("\nCalendario: {cal}"));
    }
    if let Some(ref loc) = validated.location {
        preview.push_str(&format!("\nLugar: {loc}"));
    }
    if let Some(mins) = validated.reminder_minutes_before {
        preview.push_str(&format!("\nAlerta: {mins} min antes"));
    }

    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "Agendar '{}' en Calendario ({}).",
                validated.title, validated.start_label
            )
        });

    let spec = CapabilityActionSpec {
        kind: "os_calendar_write",
        capability_key: "calendar:write".into(),
        risk_level: "medium",
        purpose,
        display_cmd: format!(
            "os_calendar: agendar '{}' ({})",
            validated.title, validated.start_label
        ),
        audit_action: "os_calendar_event_created",
        deny_audit_action: "os_calendar_event_denied",
        app_name: "Calendario".into(),
        bundle_id: "com.apple.iCal".into(),
        rule_description: "Crear eventos en Calendario de Mac".into(),
        detail_preview: Some(preview),
        force_ask_once: false,
    };

    run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = create_calendar_event(&validated)?;
        let summary = out
            .message
            .clone()
            .unwrap_or_else(|| format!("Se agendó '{}'.", out.title));
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        Ok((val, summary))
    })
}

fn handle_desktop_list_windows_rpc_callback(parsed: &serde_json::Value) -> serde_json::Value {
    use crate::slices::desktop_control::commands::list_windows_for_agent;

    let query = parsed
        .get("query")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .unwrap_or_default();
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| (n as usize).clamp(1, 20))
        .unwrap_or(12);

    let mut out = list_windows_for_agent();
    if !query.is_empty() {
        out.windows.retain(|w| {
            w.app_name.to_ascii_lowercase().contains(&query)
                || w.bundle_id.to_ascii_lowercase().contains(&query)
                || w.title.to_ascii_lowercase().contains(&query)
        });
    }
    out.windows.truncate(limit);
    serde_json::to_value(&out).unwrap_or_else(|e| {
        serde_json::json!({ "ok": false, "error": e.to_string() })
    })
}

fn handle_desktop_snapshot_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    use crate::slices::desktop_control::{
        commands::snapshot_for_agent, macos_ax::DesktopSnapshotOptions,
    };

    let opts = DesktopSnapshotOptions {
        app_name: parsed
            .get("app_name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        window_id: parsed
            .get("window_id")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
        root_ref: parsed
            .get("root_ref")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        max_depth: parsed
            .get("max_depth")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).clamp(2, 16))
            .unwrap_or(8),
        max_nodes: parsed
            .get("max_nodes")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).clamp(40, 400))
            .unwrap_or(220),
        interactive_only: parsed
            .get("interactive_only")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    };

    let out = snapshot_for_agent(app, &opts);
    serde_json::to_value(&out).unwrap_or_else(|e| {
        serde_json::json!({ "ok": false, "error": e.to_string() })
    })
}

fn handle_desktop_find_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    use crate::slices::desktop_control::{commands::find_for_agent, macos_ax::DesktopFindOptions};

    let roles: Vec<String> = parsed
        .get("roles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let opts = DesktopFindOptions {
        app_name: parsed
            .get("app_name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        window_id: parsed
            .get("window_id")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
        root_ref: parsed
            .get("root_ref")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        query: parsed
            .get("query")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        roles,
        limit: parsed
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).clamp(5, 40))
            .unwrap_or(25),
        max_nodes: parsed
            .get("max_nodes")
            .and_then(|v| v.as_u64())
            .map(|n| (n as usize).clamp(400, 6000))
            .unwrap_or(2400),
    };

    let out = find_for_agent(app, &opts);
    serde_json::to_value(&out).unwrap_or_else(|e| {
        serde_json::json!({ "ok": false, "error": e.to_string() })
    })
}

fn handle_desktop_act_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::desktop_control::{
        DesktopControlState,
        commands::{DesktopActionParams, execute_prepared_desktop_action, prepare_desktop_action},
        policy::DesktopOperation,
    };

    let client_req_id = parsed
        .get("client_request_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    if let Some(ref cid) = client_req_id {
        let state = app.state::<DesktopControlState>();
        if let Some(mut prev) = state.get_receipt(cid) {
            if let Some(obj) = prev.as_object_mut() {
                obj.insert("idempotentReplay".to_string(), serde_json::Value::Bool(true));
            }
            return prev;
        }
    }

    let action_str = parsed
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let ref_id = parsed.get("ref_id").and_then(|v| v.as_str());
    let value = parsed
        .get("value")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let key = parsed.get("key").and_then(|v| v.as_str());
    let clear_first = parsed
        .get("clear")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let press_enter = parsed
        .get("press_enter")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let headed = parsed
        .get("headed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let coord_xy = match (
        parsed.get("x").and_then(|v| v.as_f64()),
        parsed.get("y").and_then(|v| v.as_f64()),
    ) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    let app_name = parsed.get("app_name").and_then(|v| v.as_str());
    let window_id = parsed
        .get("window_id")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let raw_purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let prepared = match prepare_desktop_action(
        app,
        DesktopActionParams {
            action: action_str,
            ref_id,
            value,
            key,
            clear_first,
            press_enter,
            headed,
            coord_xy,
            app_name,
            window_id,
        },
    ) {
        Ok(p) => p,
        Err((err, disp)) => {
            return serde_json::json!({
                "ok": false,
                "status": "validation_error",
                "error": err,
                "disposition": disp,
            });
        }
    };

    let target_app_name = prepared.target_window.app_name.clone();
    let target_bundle_id = prepared.target_window.bundle_id.clone();
    let kind = match prepared.op {
        DesktopOperation::FocusWindow => "desktop_ui_focus",
        DesktopOperation::TypeText | DesktopOperation::PressKey => "desktop_ui_type",
        _ => "desktop_ui_act",
    };
    let purpose = raw_purpose
        .unwrap_or_else(|| format!("{} en {}.", prepared.op.human_verb_es(), target_app_name));
    let rule_desc = format!("Interactuar con la interfaz de {}", target_app_name);

    let spec = CapabilityActionSpec {
        kind,
        capability_key: prepared.capability_key.clone().into(),
        risk_level: prepared.risk_level,
        purpose,
        display_cmd: prepared.display_cmd.clone(),
        audit_action: kind,
        deny_audit_action: "desktop_ui_act_denied",
        app_name: target_app_name.into(),
        bundle_id: target_bundle_id.into(),
        rule_description: rule_desc.into(),
        detail_preview: Some(prepared.detail_preview.clone()),
        force_ask_once: prepared.force_ask_once,
    };

    let result = run_capability_gated_action(app, parsed, fallback_workspace_root, spec, move || {
        let out = execute_prepared_desktop_action(&prepared);
        let val = serde_json::to_value(&out).map_err(|e| e.to_string())?;
        if out.ok {
            Ok((val, out.summary))
        } else {
            Ok((
                val,
                out.error
                    .unwrap_or_else(|| "La acción de interfaz no pudo completarse.".to_string()),
            ))
        }
    });

    if let Some(ref cid) = client_req_id {
        if result.get("ok").and_then(|v| v.as_bool()) == Some(true)
            || result
                .get("disposition")
                .and_then(|d| d.get("delivery"))
                .and_then(|v| v.as_str())
                == Some("delivered_unverified")
        {
            let state = app.state::<DesktopControlState>();
            state.save_receipt(cid, result.clone());
        }
    }

    result
}

fn handle_read_screen_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    let mode = parsed.get("mode").and_then(|v| v.as_str());
    let include_image = parsed
        .get("include_image")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let save_observation = parsed
        .get("save_observation")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    match crate::slices::screen_context::commands::capture_live_for_agent(
        app,
        mode,
        include_image,
        save_observation,
    ) {
        Ok(res) => serde_json::to_value(&res).unwrap_or_else(|e| {
            serde_json::json!({ "ok": false, "error": e.to_string() })
        }),
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn handle_query_screen_memory_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::screen_context::store;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));

    let Some(ws_root) = root else {
        return serde_json::json!({ "ok": true, "count": 0, "observations": [] });
    };
    let Ok(conn) = open_workspace_db(&ws_root) else {
        return serde_json::json!({ "ok": false, "error": "No se pudo abrir la base de datos local." });
    };
    let query = parsed
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(5);
    let now = chrono::Utc::now();
    let items = if query.trim().is_empty() {
        store::list_recent_screen_observations(&conn, limit, now).unwrap_or_default()
    } else {
        store::query_screen_observations_fts(&conn, query, limit, now).unwrap_or_default()
    };
    serde_json::json!({
        "ok": true,
        "count": items.len(),
        "observations": items,
    })
}

fn merge_effective_user_profile<R: Runtime>(
    app: &AppHandle<R>,
    payload_profile: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let stored = crate::workspace_store::get_local_user(app.clone());
    match (stored, payload_profile) {
        (Some(profile), Some(serde_json::Value::Object(incoming))) => {
            let mut merged = match serde_json::to_value(&profile) {
                Ok(serde_json::Value::Object(map)) => map,
                _ => serde_json::Map::new(),
            };
            for (k, v) in incoming {
                if !v.is_null() {
                    if let Some(s) = v.as_str() {
                        if s.trim().is_empty() {
                            continue;
                        }
                    }
                    merged.insert(k.clone(), v.clone());
                }
            }
            Some(serde_json::Value::Object(merged))
        }
        (Some(profile), _) => serde_json::to_value(profile).ok(),
        (None, Some(v)) => Some(v.clone()),
        (None, None) => None,
    }
}

fn emit_user_data_updates_if_mutated<R: Runtime>(app: &AppHandle<R>, result: &serde_json::Value) {
    if result.get("user_profile_mutated").and_then(|v| v.as_bool()) == Some(true) {
        if let Some(profile) = crate::workspace_store::get_local_user(app.clone()) {
            let _ = app.emit(crate::workspace_store::LOCAL_USER_UPDATED_EVENT, &profile);
        }
    }
    if result.get("user_memory_mutated").and_then(|v| v.as_bool()) == Some(true) {
        let store = crate::workspace_store::load_user_memory(app);
        let _ = app.emit(
            crate::workspace_store::USER_MEMORY_UPDATED_EVENT,
            serde_json::json!({
                "kind": "memory",
                "sourceWindow": result.get("source_window").and_then(|v| v.as_str()).unwrap_or("main"),
                "updatedAt": store.updated_at,
                "factCount": store.facts.len(),
            }),
        );
    }
}

fn handle_save_user_memory_fact_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    let payload = crate::workspace_store::UpsertUserMemoryFactPayload {
        value: parsed
            .get("value")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        key: parsed.get("key").and_then(|v| v.as_str()).map(str::to_string),
        category: parsed
            .get("category")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        scope: parsed
            .get("scope")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        source_window: parsed
            .get("source_window")
            .or_else(|| parsed.get("sourceWindow"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        pinned: parsed.get("pinned").and_then(|v| v.as_bool()),
    };
    match crate::workspace_store::save_user_memory_fact_sync(app, payload) {
        Ok((saved, facts)) => serde_json::json!({
            "ok": true,
            "fact": saved,
            "total": facts.len(),
        }),
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn handle_delete_user_memory_fact_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    let id_or_key = parsed
        .get("id_or_key")
        .or_else(|| parsed.get("idOrKey"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let source_window = parsed
        .get("source_window")
        .or_else(|| parsed.get("sourceWindow"))
        .and_then(|v| v.as_str());
    match crate::workspace_store::delete_user_memory_fact_sync(app, id_or_key, source_window) {
        Ok(facts) => serde_json::json!({
            "ok": true,
            "total": facts.len(),
        }),
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn handle_update_local_user_profile_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    let opt_str = |k1: &str, k2: &str| -> Option<String> {
        parsed
            .get(k1)
            .or_else(|| parsed.get(k2))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let patch = crate::workspace_store::PatchLocalUserPayload {
        name: opt_str("name", "name"),
        store_name: opt_str("store_name", "storeName"),
        role: opt_str("role", "role"),
        preferred_name: opt_str("preferred_name", "preferredName"),
        occupation: opt_str("occupation", "occupation"),
        work_context: opt_str("work_context", "workContext"),
        language: opt_str("language", "language"),
        timezone: opt_str("timezone", "timezone"),
        notes: opt_str("notes", "notes"),
    };
    match crate::workspace_store::patch_local_user_sync(app, patch) {
        Ok(profile) => serde_json::json!({
            "ok": true,
            "profile": profile,
        }),
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn filter_global_user_memory_for_query(
    facts: &[crate::workspace_store::UserMemoryFact],
    query: &str,
    limit: usize,
) -> Vec<crate::workspace_store::UserMemoryFact> {
    let tokens: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 2)
        .collect();
    if tokens.is_empty() {
        return facts.iter().take(limit).cloned().collect();
    }
    let matched: Vec<crate::workspace_store::UserMemoryFact> = facts
        .iter()
        .filter(|item| {
            let hay = format!("{} {} {}", item.key, item.category, item.value).to_lowercase();
            tokens.iter().any(|tok| hay.contains(tok))
        })
        .take(limit)
        .cloned()
        .collect();
    if matched.is_empty() {
        facts.iter().take(limit.min(6)).cloned().collect()
    } else {
        matched
    }
}

fn handle_memory_search_rpc_callback<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::screen_context::store;
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;

    let root = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let query = parsed
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = parsed
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n.clamp(1, 30) as usize)
        .unwrap_or(12);

    let (facts, screen_summary) =
        store::build_unified_memory_for_workspace(root.as_deref(), query);
    let global_store = crate::workspace_store::load_user_memory(app);
    let global_user_facts = filter_global_user_memory_for_query(&global_store.facts, query, limit);
    serde_json::json!({
        "ok": true,
        "factsCount": facts.len(),
        "facts": facts,
        "globalUserFactsCount": global_user_facts.len(),
        "globalUserFacts": global_user_facts,
        "screenSummary": screen_summary,
    })
}

fn merge_string_list(existing: &[String], incoming: &[String], mode: &str) -> Vec<String> {
    let mode_norm = mode.trim().to_ascii_lowercase();
    if mode_norm == "replace" {
        return incoming.to_vec();
    }
    if mode_norm == "remove" {
        let remove_keys: std::collections::HashSet<String> = incoming
            .iter()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        return existing
            .iter()
            .filter(|s| !remove_keys.contains(&s.trim().to_lowercase()))
            .cloned()
            .collect();
    }
    let mut combined = existing.to_vec();
    combined.extend(incoming.iter().cloned());
    combined
}

fn parse_optional_str_list(val: Option<&serde_json::Value>) -> Option<Vec<String>> {
    val.and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect()
    })
}

fn handle_update_xox_profile_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    use crate::slices::xox_studio::store::{
        load_global_xox_profile, save_global_xox_profile, SaveGlobalXoxProfilePayload,
    };

    let current = load_global_xox_profile(app);
    let list_mode = parsed
        .get("list_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("merge");

    let mut changed_fields: Vec<&'static str> = Vec::new();
    let get_str = |key: &str| -> Option<String> {
        parsed
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    let agent_name = get_str("agent_name").or_else(|| get_str("agentName"));
    if agent_name.is_some() {
        changed_fields.push("agentName");
    }
    let active_role = get_str("active_role").or_else(|| get_str("activeRole"));
    if active_role.is_some() {
        changed_fields.push("activeRole");
    }
    let personality = get_str("personality");
    if personality.is_some() {
        changed_fields.push("personality");
    }
    let initial_instructions = parsed
        .get("initial_instructions")
        .or_else(|| parsed.get("initialInstructions"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    if initial_instructions.is_some() {
        changed_fields.push("initialInstructions");
    }
    let accent_preset = get_str("accent_preset").or_else(|| get_str("accentPreset"));
    if accent_preset.is_some() {
        changed_fields.push("accentPreset");
    }

    let tone_tags = parse_optional_str_list(parsed.get("tone_tags").or_else(|| parsed.get("toneTags")));
    if tone_tags.is_some() {
        changed_fields.push("toneTags");
    }

    let global_rules =
        parse_optional_str_list(parsed.get("global_rules").or_else(|| parsed.get("globalRules")))
            .map(|inc| {
                changed_fields.push("globalRules");
                merge_string_list(&current.global_rules, &inc, list_mode)
            });
    let likes = parse_optional_str_list(parsed.get("likes")).map(|inc| {
        changed_fields.push("likes");
        merge_string_list(&current.likes, &inc, list_mode)
    });
    let workflows = parse_optional_str_list(parsed.get("workflows")).map(|inc| {
        changed_fields.push("workflows");
        merge_string_list(&current.workflows, &inc, list_mode)
    });
    let donts = parse_optional_str_list(parsed.get("donts")).map(|inc| {
        changed_fields.push("donts");
        merge_string_list(&current.donts, &inc, list_mode)
    });

    if changed_fields.is_empty() {
        return serde_json::json!({
            "ok": false,
            "error": "Indica al menos un campo del perfil global de Xox para actualizar."
        });
    }

    let patch = SaveGlobalXoxProfilePayload {
        agent_name,
        active_role,
        personality,
        tone_tags,
        initial_instructions,
        global_rules,
        likes,
        workflows,
        donts,
        accent_preset,
    };

    match save_global_xox_profile(app, patch) {
        Ok(saved) => serde_json::json!({
            "ok": true,
            "profile": saved,
            "changed_fields": changed_fields,
        }),
        Err(err) => serde_json::json!({
            "ok": false,
            "error": err,
        }),
    }
}

fn handle_set_tts_voice_config_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
) -> serde_json::Value {
    use crate::slices::tts_voice::store::{load_tts_config, normalize_voice_id, save_tts_config};
    use crate::slices::tts_voice::worker::{build_tts_status, TtsWorkerState, TTS_STATUS_EVENT};

    let mut cfg = load_tts_config(app);
    let mut changed: Vec<&'static str> = Vec::new();

    if let Some(v) = parsed.get("voice_id").or_else(|| parsed.get("voiceId")).and_then(|x| x.as_str()) {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            let norm = normalize_voice_id(trimmed);
            if norm != trimmed.to_ascii_lowercase() {
                return serde_json::json!({
                    "ok": false,
                    "error": format!("Voz no reconocida '{trimmed}'. Voces disponibles: lola, rafael, alba, estelle, marius, jean.")
                });
            }
            cfg.voice_id = norm;
            changed.push("voiceId");
        }
    }
    if let Some(s) = parsed.get("speed").and_then(|x| x.as_f64()) {
        cfg.speed = (s as f32).clamp(0.85, 1.25);
        changed.push("speed");
    }
    if let Some(en) = parsed.get("enabled").and_then(|x| x.as_bool()) {
        cfg.enabled = en;
        changed.push("enabled");
    }
    if let Some(ap) = parsed.get("auto_play").or_else(|| parsed.get("autoPlay")).and_then(|x| x.as_bool()) {
        cfg.auto_play = ap;
        changed.push("autoPlay");
    }

    if changed.is_empty() {
        return serde_json::json!({
            "ok": false,
            "error": "Indica al menos voice_id, speed, enabled o auto_play."
        });
    }

    match save_tts_config(app, &cfg) {
        Ok(saved) => {
            if !saved.enabled {
                let worker = app.state::<TtsWorkerState>();
                worker.kill_worker();
            }
            if let Ok(status) = build_tts_status(app) {
                let _ = app.emit(TTS_STATUS_EVENT, &status);
            }
            serde_json::json!({
                "ok": true,
                "config": saved,
                "changed": changed,
            })
        }
        Err(err) => serde_json::json!({
            "ok": false,
            "error": err,
        }),
    }
}

fn handle_save_xox_skill_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
    use crate::slices::xox_studio::store::{
        load_global_xox_profile, save_xox_skill_in, xox_config_dir, SaveXoxSkillPayload,
        XOX_PROFILE_UPDATED_EVENT,
    };

    let Ok(dir) = xox_config_dir(app) else {
        return serde_json::json!({ "ok": false, "error": "No se pudo resolver app_config_dir." });
    };
    let ws = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));

    let payload = SaveXoxSkillPayload {
        scope: parsed.get("scope").and_then(|v| v.as_str()).map(str::to_string),
        slug: parsed.get("slug").and_then(|v| v.as_str()).map(str::to_string),
        name: parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        raw_markdown: parsed
            .get("raw_markdown")
            .or_else(|| parsed.get("rawMarkdown"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    };

    match save_xox_skill_in(&dir, ws.as_deref(), payload) {
        Ok(saved) => {
            let profile = load_global_xox_profile(app);
            let _ = app.emit(XOX_PROFILE_UPDATED_EVENT, &profile);
            if saved.scope == "workspace" {
                let _ = app.emit(
                    crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
                    serde_json::json!({ "reason": "xox_skill_saved", "path": saved.rel_path }),
                );
            }
            serde_json::json!({ "ok": true, "skill": saved })
        }
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn handle_delete_xox_skill_rpc<R: Runtime>(
    app: &AppHandle<R>,
    parsed: &serde_json::Value,
    fallback_workspace_root: Option<&str>,
) -> serde_json::Value {
    use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
    use crate::slices::xox_studio::store::{
        delete_xox_skill_in, load_global_xox_profile, xox_config_dir, XOX_PROFILE_UPDATED_EVENT,
    };

    let Ok(dir) = xox_config_dir(app) else {
        return serde_json::json!({ "ok": false, "error": "No se pudo resolver app_config_dir." });
    };
    let ws = fallback_workspace_root
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| resolve_active_workspace_root(app));
    let scope = parsed.get("scope").and_then(|v| v.as_str()).unwrap_or("global");
    let slug = parsed.get("slug").and_then(|v| v.as_str()).unwrap_or("");

    match delete_xox_skill_in(&dir, ws.as_deref(), scope, slug) {
        Ok(()) => {
            let profile = load_global_xox_profile(app);
            let _ = app.emit(XOX_PROFILE_UPDATED_EVENT, &profile);
            if scope.trim().eq_ignore_ascii_case("workspace") {
                let _ = app.emit(
                    crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
                    serde_json::json!({ "reason": "xox_skill_deleted", "slug": slug }),
                );
            }
            serde_json::json!({ "ok": true, "slug": slug, "scope": scope })
        }
        Err(err) => serde_json::json!({ "ok": false, "error": err }),
    }
}

fn call_python_sidecar_streaming<R: Runtime>(
    app: &AppHandle<R>,
    script_path: &PathBuf,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let stream_id_param = params
        .get("stream_id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_default();
    let ws_root_param = params
        .get("workspace_root")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let request = serde_json::json!({
        "id": 1,
        "method": "ai_chat_stream",
        "params": params,
    });
    let line = format!("{request}\n");

    let py_bin = resolve_python_executable(script_path);
    let mut child = python_command(&py_bin)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar python sidecar ({}): {e}", py_bin.display()))?;

    let cancelled_flag = Arc::new(AtomicBool::new(false));
    let _stream_guard = if !stream_id_param.is_empty() {
        if let Ok(mut map) = active_chat_streams().lock() {
            map.insert(
                stream_id_param.clone(),
                ActiveChatStream {
                    pid: child.id(),
                    cancelled: Arc::clone(&cancelled_flag),
                },
            );
        }
        Some(ActiveStreamGuard {
            stream_id: stream_id_param,
        })
    } else {
        None
    };

    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "No se pudo capturar stdin del sidecar.".to_string())?;
    child_stdin
        .write_all(line.as_bytes())
        .and_then(|_| child_stdin.flush())
        .map_err(|e| format!("Error enviando solicitud al sidecar: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo capturar stdout del sidecar.".to_string())?;
    let reader = BufReader::new(stdout);

    let mut final_envelope: Option<serde_json::Value> = None;
    for line_res in reader.lines() {
        let Ok(raw_line) = line_res else {
            continue;
        };
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        if let Some(cb_name) = parsed.get("rpc_callback").and_then(|v| v.as_str()) {
            let ws_ref = ws_root_param.as_deref();
            let cb_result_opt = match cb_name {
                "run_workspace_command" => Some(handle_command_rpc_callback(app, &parsed, ws_ref)),
                "list_installed_apps" => Some(handle_list_apps_rpc_callback(&parsed)),
                "open_desktop_app" => Some(handle_open_app_rpc_callback(app, &parsed, ws_ref)),
                "os_notes_list" => Some(handle_notes_list_rpc_callback(app, &parsed, ws_ref)),
                "os_notes_create" => Some(handle_notes_create_rpc_callback(app, &parsed, ws_ref)),
                "os_calendar_list" => Some(handle_calendar_list_rpc_callback(app, &parsed, ws_ref)),
                "os_calendar_create_event" => {
                    Some(handle_calendar_create_rpc_callback(app, &parsed, ws_ref))
                }
                "read_screen_now" => Some(handle_read_screen_rpc_callback(app, &parsed)),
                "desktop_list_windows" => Some(handle_desktop_list_windows_rpc_callback(&parsed)),
                "desktop_snapshot" => Some(handle_desktop_snapshot_rpc_callback(app, &parsed)),
                "desktop_find" => Some(handle_desktop_find_rpc_callback(app, &parsed)),
                "desktop_act" => Some(handle_desktop_act_rpc_callback(app, &parsed, ws_ref)),
                "query_screen_memory" => {
                    Some(handle_query_screen_memory_rpc_callback(app, &parsed, ws_ref))
                }
                "memory_search" => Some(handle_memory_search_rpc_callback(app, &parsed, ws_ref)),
                "host_fs_list" => Some(handle_host_fs_list_rpc(app, &parsed, ws_ref)),
                "host_fs_search" => Some(handle_host_fs_search_rpc(app, &parsed, ws_ref)),
                "host_fs_authorize_read" => {
                    Some(handle_host_fs_authorize_read_rpc(app, &parsed, ws_ref))
                }
                "host_fs_write" => Some(handle_host_fs_write_rpc(app, &parsed, ws_ref)),
                "host_fs_edit" => Some(handle_host_fs_edit_rpc(app, &parsed, ws_ref)),
                "host_fs_mkdir" => Some(handle_host_fs_mkdir_rpc(app, &parsed, ws_ref)),
                "host_fs_copy_from_workspace" => {
                    Some(handle_host_fs_copy_from_workspace_rpc(app, &parsed, ws_ref))
                }
                "update_xox_profile" => Some(handle_update_xox_profile_rpc(app, &parsed)),
                "save_user_memory_fact" => Some(handle_save_user_memory_fact_rpc(app, &parsed)),
                "delete_user_memory_fact" => Some(handle_delete_user_memory_fact_rpc(app, &parsed)),
                "update_local_user_profile" => {
                    Some(handle_update_local_user_profile_rpc(app, &parsed))
                }
                "set_tts_voice_config" => Some(handle_set_tts_voice_config_rpc(app, &parsed)),
                "save_xox_skill" => Some(handle_save_xox_skill_rpc(app, &parsed, ws_ref)),
                "delete_xox_skill" => Some(handle_delete_xox_skill_rpc(app, &parsed, ws_ref)),
                _ => None,
            };
            if let Some(cb_result) = cb_result_opt {
                let req_id = parsed
                    .get("request_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("rpc_req")
                    .to_string();
                let reply_msg = serde_json::json!({
                    "rpc_callback_response": cb_name,
                    "request_id": req_id,
                    "result": cb_result,
                });
                let reply_line = format!("{reply_msg}\n");
                let _ = child_stdin.write_all(reply_line.as_bytes());
                let _ = child_stdin.flush();
                continue;
            }
        }
        if parsed.get("stream").and_then(|v| v.as_bool()) == Some(true) {
            if parsed
                .get("event")
                .and_then(|e| e.get("type"))
                .and_then(|t| t.as_str())
                == Some("workspace_changed")
            {
                let _ = app.emit(
                    crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
                    parsed.get("event").unwrap(),
                );
            }
            let _ = app.emit("xox-chat-stream", &parsed);
        } else {
            final_envelope = Some(parsed);
            break;
        }
    }
    drop(child_stdin);

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando respuesta del sidecar: {e}"))?;

    let mut stderr_str = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        use std::io::Read;
        let _ = stderr.read_to_string(&mut stderr_str);
    }

    let Some(parsed) = final_envelope else {
        if cancelled_flag.load(Ordering::SeqCst) {
            return Err("__XOOK_STREAM_CANCELLED__".to_string());
        }
        let trimmed_err = stderr_str.trim();
        return Err(if trimmed_err.is_empty() {
            format!("El sidecar terminó sin respuesta (estado {status}).")
        } else {
            format!("Error del sidecar Python: {trimmed_err}")
        });
    };

    if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    let result_val = parsed.get("result").cloned().unwrap_or(parsed);
    if result_val
        .get("workspace_mutated")
        .and_then(|v| v.as_bool())
        == Some(true)
    {
        let _ = app.emit(
            crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
            serde_json::json!({ "reason": "agent_tools" }),
        );
    }
    Ok(result_val)
}

#[tauri::command]
pub async fn run_xox_chat_stream<R: Runtime>(
    app: AppHandle<R>,
    payload: XoxChatRequest,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let requested_provider = payload
        .provider_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();

    let Some((effective_provider, api_key, default_entry_model)) =
        resolve_first_available_provider(&vault, &requested_provider)
    else {
        return Err(format!(
            "Falta configurar tu clave API de {} (o un proveedor de respaldo).",
            provider_display_name(&requested_provider)
        ));
    };

    let script = find_sidecar_script(&app)?;
    let workspace_root_path = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app);
    let workspace_root = workspace_root_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());
    let (facts, screen_summary) =
        crate::slices::screen_context::store::build_unified_memory_for_workspace(
            workspace_root_path.as_deref(),
            &payload.message,
        );
    let model_id = if effective_provider == requested_provider {
        payload
            .model_override
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default_entry_model.clone())
    } else {
        default_entry_model
    };
    let stream_id = payload
        .stream_id
        .unwrap_or_else(|| format!("str_{}", chrono::Utc::now().timestamp_millis()));
    let provider_credentials = build_provider_credentials_json(&vault);
    let provider_region = vault
        .providers
        .get(&effective_provider)
        .and_then(|e| e.api_region.clone());
    let auto_failover = vault.auto_failover;
    let failover_order = vault.failover_order.clone();
    let xox_config_dir = crate::slices::xox_studio::store::xox_config_dir(&app)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    let global_xox_profile = crate::slices::xox_studio::store::load_global_xox_profile(&app);
    let effective_user_profile =
        merge_effective_user_profile(&app, payload.user_profile.as_ref());
    let user_memory_facts = crate::workspace_store::load_user_memory(&app).facts;
    let tts_config = crate::slices::tts_voice::store::load_tts_config(&app);

    let app_clone = app.clone();
    let app_for_sync = app.clone();
    let eff_for_sync = effective_provider.clone();
    let result = tokio::task::spawn_blocking(move || {
        call_python_sidecar_streaming(
            &app_clone,
            &script,
            serde_json::json!({
                "stream_id": stream_id,
                "provider": effective_provider,
                "provider_region": provider_region,
                "api_key": api_key,
                "model_id": model_id,
                "provider_credentials": provider_credentials,
                "auto_failover": auto_failover,
                "failover_order": failover_order,
                "workspace_root": workspace_root,
                "xox_config_dir": xox_config_dir,
                "global_xox_profile": global_xox_profile,
                "tts_config": tts_config,
                "message": payload.message,
                "history": payload.history,
                "current_tasks": payload.current_tasks,
                "agenda_items": payload.agenda_items,
                "attached_context": payload.attached_context,
                "user_profile": effective_user_profile,
                "user_memory_facts": user_memory_facts,
                "active_canvas": payload.active_canvas,
                "active_mode": payload.active_mode,
                "subagent_roster": payload.subagent_roster,
                "context_scope": payload.context_scope,
                "active_document": payload.active_document,
                "context_checkpoint": payload.context_checkpoint,
                "model_context_window": payload.model_context_window,
                "session_id": payload.session_id,
                "unified_memory": {
                    "facts": facts,
                    "screen_summary": screen_summary,
                },
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))??;

    sync_vault_from_sidecar_result(&app_for_sync, &result, &eff_for_sync);
    record_chat_turn_in_ledger(&app_for_sync, &result, &eff_for_sync);
    emit_user_data_updates_if_mutated(&app_for_sync, &result);
    Ok(result)
}

#[tauri::command]
pub async fn compact_xox_context<R: Runtime>(
    app: AppHandle<R>,
    payload: CompactContextRequest,
) -> Result<serde_json::Value, String> {
    let vault = load_vault(&app);
    let requested_provider = payload
        .provider_override
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(&vault.provider))
        .to_string();

    let (effective_provider, api_key, default_entry_model) =
        resolve_first_available_provider(&vault, &requested_provider)
            .unwrap_or_else(|| (requested_provider.clone(), String::new(), default_model_for_provider(&requested_provider).to_string()));

    let script = find_sidecar_script(&app)?;
    let workspace_root = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app)
        .map(|p| p.to_string_lossy().to_string());
    let provider_region = vault
        .providers
        .get(&effective_provider)
        .and_then(|e| e.api_region.clone());
    let model_id = if effective_provider == requested_provider {
        payload
            .model_override
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default_entry_model.clone())
    } else {
        default_entry_model
    };

    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "compact_context",
            serde_json::json!({
                "provider": effective_provider,
                "provider_region": provider_region,
                "api_key": api_key,
                "model_id": model_id,
                "workspace_root": workspace_root,
                "scope": payload.scope.unwrap_or_else(|| "chat".to_string()),
                "history": payload.history,
                "prev_checkpoint": payload.prev_checkpoint,
                "document_path": payload.document_path,
                "document_title": payload.document_title,
                "document_file_kind": payload.document_file_kind,
                "focus_hint": payload.focus_hint.unwrap_or_default(),
                "keep_recent": payload.keep_recent.unwrap_or(2),
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

#[tauri::command]
pub async fn manage_document_context<R: Runtime>(
    app: AppHandle<R>,
    payload: ManageDocumentContextRequest,
) -> Result<serde_json::Value, String> {
    let script = find_sidecar_script(&app)?;
    let workspace_root = crate::slices::workspace_manager::registry::resolve_active_workspace_root(&app)
        .map(|p| p.to_string_lossy().to_string());

    tokio::task::spawn_blocking(move || {
        call_python_sidecar(
            &script,
            "manage_document_context",
            serde_json::json!({
                "workspace_root": workspace_root,
                "action": payload.action,
                "path": payload.path,
                "title": payload.title,
                "file_kind": payload.file_kind,
                "rules": payload.rules,
                "keep_rules": payload.keep_rules.unwrap_or(true),
            }),
        )
    })
    .await
    .map_err(|e| format!("Error de concurrencia: {e}"))?
}

static USAGE_LEDGER_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();

fn usage_ledger_mutex() -> &'static std::sync::Mutex<()> {
    USAGE_LEDGER_LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRateLimitsSnapshot {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
    #[serde(default)]
    pub rpm_limit: Option<u64>,
    #[serde(default)]
    pub rpm_remaining: Option<u64>,
    #[serde(default)]
    pub rpm_reset_at_ms: Option<i64>,
    #[serde(default)]
    pub tpm_limit: Option<u64>,
    #[serde(default)]
    pub tpm_remaining: Option<u64>,
    #[serde(default)]
    pub tpm_reset_at_ms: Option<i64>,
    #[serde(default)]
    pub itpm_limit: Option<u64>,
    #[serde(default)]
    pub itpm_remaining: Option<u64>,
    #[serde(default)]
    pub otpm_limit: Option<u64>,
    #[serde(default)]
    pub otpm_remaining: Option<u64>,
    #[serde(default)]
    pub retry_after_sec: Option<f64>,
    #[serde(default)]
    pub daily_limit: Option<u64>,
    #[serde(default)]
    pub daily_remaining: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBalanceSnapshot {
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub balance_raw: Option<f64>,
    #[serde(default)]
    pub balance_usd: Option<f64>,
    #[serde(default)]
    pub credits_remaining: Option<f64>,
    #[serde(default)]
    pub credits_total: Option<f64>,
    #[serde(default)]
    pub credits_usage: Option<f64>,
    #[serde(default)]
    pub balance_granted: Option<f64>,
    #[serde(default)]
    pub balance_topped_up: Option<f64>,
    #[serde(default)]
    pub limit: Option<f64>,
    #[serde(default)]
    pub limit_remaining: Option<f64>,
    #[serde(default)]
    pub limit_reset: Option<String>,
    #[serde(default)]
    pub is_free_tier: Option<bool>,
    #[serde(default)]
    pub can_use_paid_models: Option<bool>,
    #[serde(default)]
    pub api_usage_daily: Option<f64>,
    #[serde(default)]
    pub api_usage_monthly: Option<f64>,
    #[serde(default)]
    pub updated_at_ms: Option<i64>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimitConfig {
    #[serde(default)]
    pub monthly_budget_usd: Option<f64>,
    #[serde(default)]
    pub daily_request_limit: Option<u64>,
    #[serde(default)]
    pub rpm_limit: Option<u64>,
    #[serde(default)]
    pub tier_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageEntry {
    pub provider: String,
    #[serde(default)]
    pub today_date: String,
    #[serde(default)]
    pub today_requests: u64,
    #[serde(default)]
    pub today_prompt_tokens: u64,
    #[serde(default)]
    pub today_completion_tokens: u64,
    #[serde(default)]
    pub today_cached_tokens: u64,
    #[serde(default)]
    pub today_cost_usd: f64,
    #[serde(default)]
    pub month_key: String,
    #[serde(default)]
    pub month_requests: u64,
    #[serde(default)]
    pub month_prompt_tokens: u64,
    #[serde(default)]
    pub month_completion_tokens: u64,
    #[serde(default)]
    pub month_cached_tokens: u64,
    #[serde(default)]
    pub month_cost_usd: f64,
    #[serde(default)]
    pub recent_request_timestamps_ms: Vec<i64>,
    #[serde(default)]
    pub current_rpm: u64,
    #[serde(default)]
    pub last_model_id: Option<String>,
    #[serde(default)]
    pub last_request_at_ms: Option<i64>,
    #[serde(default)]
    pub rate_limits: Option<ProviderRateLimitsSnapshot>,
    #[serde(default)]
    pub balance: Option<ProviderBalanceSnapshot>,
    #[serde(default)]
    pub limits: ProviderLimitConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredUsageLedger {
    #[serde(default)]
    pub providers: HashMap<String, ProviderUsageEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetProviderLimitsPayload {
    pub provider: String,
    pub monthly_budget_usd: Option<f64>,
    pub daily_request_limit: Option<u64>,
    pub rpm_limit: Option<u64>,
    pub tier_mode: Option<String>,
}

fn usage_ledger_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(USAGE_LEDGER_FILENAME))
}

fn local_day_and_month_keys() -> (String, String, i64) {
    let now_local = chrono::Local::now();
    let day = now_local.format("%Y-%m-%d").to_string();
    let month = now_local.format("%Y-%m").to_string();
    let now_ms = chrono::Utc::now().timestamp_millis();
    (day, month, now_ms)
}

fn normalize_usage_ledger_at(ledger: &mut StoredUsageLedger, day_key: &str, month_key: &str, now_ms: i64) {
    let mut normalized: HashMap<String, ProviderUsageEntry> = HashMap::new();
    for (raw_pid, mut entry) in std::mem::take(&mut ledger.providers) {
        let pid = normalize_provider_id(&raw_pid).to_string();
        entry.provider = pid.clone();
        if entry.today_date != day_key {
            entry.today_date = day_key.to_string();
            entry.today_requests = 0;
            entry.today_prompt_tokens = 0;
            entry.today_completion_tokens = 0;
            entry.today_cached_tokens = 0;
            entry.today_cost_usd = 0.0;
        }
        if entry.month_key != month_key {
            entry.month_key = month_key.to_string();
            entry.month_requests = 0;
            entry.month_prompt_tokens = 0;
            entry.month_completion_tokens = 0;
            entry.month_cached_tokens = 0;
            entry.month_cost_usd = 0.0;
        }
        let window_start = now_ms - 60_000;
        entry
            .recent_request_timestamps_ms
            .retain(|ts| *ts >= window_start && *ts <= now_ms + 5_000);
        entry.current_rpm = entry.recent_request_timestamps_ms.len() as u64;
        normalized.insert(pid, entry);
    }

    for pid in SUPPORTED_PROVIDERS {
        normalized
            .entry(pid.to_string())
            .or_insert_with(|| ProviderUsageEntry {
                provider: pid.to_string(),
                today_date: day_key.to_string(),
                month_key: month_key.to_string(),
                ..Default::default()
            });
    }
    ledger.providers = normalized;
}

fn load_usage_ledger<R: Runtime>(app: &AppHandle<R>) -> StoredUsageLedger {
    let mut ledger = usage_ledger_file_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<StoredUsageLedger>(&raw).ok())
        .unwrap_or_default();
    let (day, month, now_ms) = local_day_and_month_keys();
    normalize_usage_ledger_at(&mut ledger, &day, &month, now_ms);
    ledger
}

fn write_usage_ledger<R: Runtime>(app: &AppHandle<R>, ledger: &StoredUsageLedger) -> Result<(), String> {
    let path = usage_ledger_file_path(app)
        .ok_or_else(|| "No se pudo resolver app_config_dir para historial de uso".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio de uso: {e}"))?;
    }
    let body = serde_json::to_string_pretty(ledger)
        .map_err(|e| format!("Error serializando uso IA: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("Error escribiendo ledger de uso IA: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn parse_rate_limits_from_json(raw: &serde_json::Value) -> Option<ProviderRateLimitsSnapshot> {
    let obj = raw.as_object()?;
    let snap = ProviderRateLimitsSnapshot {
        source: obj.get("source").and_then(|v| v.as_str()).map(str::to_string),
        updated_at_ms: obj.get("updated_at_ms").and_then(|v| v.as_i64()),
        rpm_limit: obj.get("rpm_limit").and_then(|v| v.as_u64()),
        rpm_remaining: obj.get("rpm_remaining").and_then(|v| v.as_u64()),
        rpm_reset_at_ms: obj.get("rpm_reset_at_ms").and_then(|v| v.as_i64()),
        tpm_limit: obj.get("tpm_limit").and_then(|v| v.as_u64()),
        tpm_remaining: obj.get("tpm_remaining").and_then(|v| v.as_u64()),
        tpm_reset_at_ms: obj.get("tpm_reset_at_ms").and_then(|v| v.as_i64()),
        itpm_limit: obj.get("itpm_limit").and_then(|v| v.as_u64()),
        itpm_remaining: obj.get("itpm_remaining").and_then(|v| v.as_u64()),
        otpm_limit: obj.get("otpm_limit").and_then(|v| v.as_u64()),
        otpm_remaining: obj.get("otpm_remaining").and_then(|v| v.as_u64()),
        retry_after_sec: obj.get("retry_after_sec").and_then(|v| v.as_f64()),
        daily_limit: obj.get("daily_limit").and_then(|v| v.as_u64()),
        daily_remaining: obj.get("daily_remaining").and_then(|v| v.as_u64()),
    };
    if snap.rpm_limit.is_some()
        || snap.rpm_remaining.is_some()
        || snap.tpm_limit.is_some()
        || snap.tpm_remaining.is_some()
        || snap.daily_limit.is_some()
        || snap.retry_after_sec.is_some()
    {
        Some(snap)
    } else {
        None
    }
}

fn apply_chat_turn_to_ledger(
    ledger: &mut StoredUsageLedger,
    provider_id: &str,
    result_val: &serde_json::Value,
    day_key: &str,
    month_key: &str,
    now_ms: i64,
) {
    normalize_usage_ledger_at(ledger, day_key, month_key, now_ms);
    let pid = normalize_provider_id(provider_id).to_string();
    let entry = ledger.providers.entry(pid.clone()).or_insert_with(|| ProviderUsageEntry {
        provider: pid,
        today_date: day_key.to_string(),
        month_key: month_key.to_string(),
        ..Default::default()
    });

    entry.today_requests = entry.today_requests.saturating_add(1);
    entry.month_requests = entry.month_requests.saturating_add(1);
    entry.recent_request_timestamps_ms.push(now_ms);
    let window_start = now_ms - 60_000;
    entry
        .recent_request_timestamps_ms
        .retain(|ts| *ts >= window_start && *ts <= now_ms + 5_000);
    entry.current_rpm = entry.recent_request_timestamps_ms.len() as u64;
    entry.last_request_at_ms = Some(now_ms);
    if let Some(m) = result_val.get("model_used").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()) {
        entry.last_model_id = Some(m.to_string());
    }

    if let Some(usage) = result_val.get("usage").and_then(|v| v.as_object()) {
        let prompt_tok = usage
            .get("prompt_tokens")
            .or_else(|| usage.get("input_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let completion_tok = usage
            .get("completion_tokens")
            .or_else(|| usage.get("output_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cached_tok = usage
            .get("cached_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                usage
                    .get("prompt_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
        let cost_usd = usage
            .get("estimated_cost_usd")
            .or_else(|| usage.get("cost"))
            .and_then(|v| v.as_f64())
            .filter(|c| c.is_finite() && *c >= 0.0)
            .unwrap_or(0.0);

        entry.today_prompt_tokens = entry.today_prompt_tokens.saturating_add(prompt_tok);
        entry.today_completion_tokens = entry.today_completion_tokens.saturating_add(completion_tok);
        entry.today_cached_tokens = entry.today_cached_tokens.saturating_add(cached_tok);
        entry.today_cost_usd = ((entry.today_cost_usd + cost_usd) * 100_000_000.0).round() / 100_000_000.0;

        entry.month_prompt_tokens = entry.month_prompt_tokens.saturating_add(prompt_tok);
        entry.month_completion_tokens = entry.month_completion_tokens.saturating_add(completion_tok);
        entry.month_cached_tokens = entry.month_cached_tokens.saturating_add(cached_tok);
        entry.month_cost_usd = ((entry.month_cost_usd + cost_usd) * 100_000_000.0).round() / 100_000_000.0;
    }

    if let Some(rl_val) = result_val.get("rate_limits") {
        if let Some(rl) = parse_rate_limits_from_json(rl_val) {
            entry.rate_limits = Some(rl);
        }
    }
}

fn apply_test_result_to_ledger(
    ledger: &mut StoredUsageLedger,
    provider_id: &str,
    test_val: &serde_json::Value,
    day_key: &str,
    month_key: &str,
    now_ms: i64,
) {
    normalize_usage_ledger_at(ledger, day_key, month_key, now_ms);
    let pid = normalize_provider_id(provider_id).to_string();
    let entry = ledger.providers.entry(pid.clone()).or_insert_with(|| ProviderUsageEntry {
        provider: pid,
        today_date: day_key.to_string(),
        month_key: month_key.to_string(),
        ..Default::default()
    });

    if let Some(rl_val) = test_val.get("rate_limits") {
        if let Some(rl) = parse_rate_limits_from_json(rl_val) {
            entry.rate_limits = Some(rl);
        }
    }

    let ok = test_val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if ok {
        let balance_usd = test_val.get("balance_usd").and_then(|v| v.as_f64());
        let credits_remaining = test_val.get("credits_remaining").and_then(|v| v.as_f64());
        let balance_raw = test_val
            .get("balance_raw")
            .and_then(|v| v.as_f64())
            .or(balance_usd)
            .or(credits_remaining);
        let currency = test_val
            .get("balance_currency")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| if balance_usd.is_some() || credits_remaining.is_some() { Some("USD".to_string()) } else { None });
        let bal_snap = ProviderBalanceSnapshot {
            currency,
            balance_raw,
            balance_usd: balance_usd.or(credits_remaining),
            credits_remaining: credits_remaining.or(balance_usd),
            credits_total: test_val.get("credits_total").and_then(|v| v.as_f64()),
            credits_usage: test_val.get("credits_usage").and_then(|v| v.as_f64()),
            balance_granted: test_val.get("balance_granted").and_then(|v| v.as_f64()),
            balance_topped_up: test_val.get("balance_topped_up").and_then(|v| v.as_f64()),
            limit: test_val.get("limit").and_then(|v| v.as_f64()),
            limit_remaining: test_val.get("limit_remaining").and_then(|v| v.as_f64()),
            limit_reset: test_val.get("limit_reset").and_then(|v| v.as_str()).map(str::to_string),
            is_free_tier: test_val.get("is_free_tier").and_then(|v| v.as_bool()),
            can_use_paid_models: test_val.get("can_use_paid_models").and_then(|v| v.as_bool()),
            api_usage_daily: test_val.get("usage_daily").and_then(|v| v.as_f64()),
            api_usage_monthly: test_val.get("usage_monthly").and_then(|v| v.as_f64()),
            updated_at_ms: Some(now_ms),
            source: test_val.get("rate_limit_source").and_then(|v| v.as_str()).map(str::to_string),
        };
        entry.balance = Some(bal_snap);
    }
}

fn record_chat_turn_in_ledger<R: Runtime>(
    app: &AppHandle<R>,
    result_val: &serde_json::Value,
    fallback_provider: &str,
) {
    let used_pid = result_val
        .get("provider_used")
        .and_then(|v| v.as_str())
        .map(normalize_provider_id)
        .unwrap_or_else(|| normalize_provider_id(fallback_provider));
    let Ok(_guard) = usage_ledger_mutex().lock() else {
        return;
    };
    let mut ledger = load_usage_ledger(app);
    let (day, month, now_ms) = local_day_and_month_keys();
    apply_chat_turn_to_ledger(&mut ledger, used_pid, result_val, &day, &month, now_ms);
    if write_usage_ledger(app, &ledger).is_ok() {
        let _ = app.emit(AI_USAGE_UPDATED_EVENT, &ledger);
    }
}

fn record_test_result_in_ledger<R: Runtime>(
    app: &AppHandle<R>,
    provider_id: &str,
    test_val: &serde_json::Value,
) {
    let Ok(_guard) = usage_ledger_mutex().lock() else {
        return;
    };
    let mut ledger = load_usage_ledger(app);
    let (day, month, now_ms) = local_day_and_month_keys();
    apply_test_result_to_ledger(&mut ledger, provider_id, test_val, &day, &month, now_ms);
    if write_usage_ledger(app, &ledger).is_ok() {
        let _ = app.emit(AI_USAGE_UPDATED_EVENT, &ledger);
    }
}

#[tauri::command]
pub fn get_ai_usage_ledger<R: Runtime>(app: AppHandle<R>) -> StoredUsageLedger {
    let Ok(_guard) = usage_ledger_mutex().lock() else {
        return StoredUsageLedger::default();
    };
    load_usage_ledger(&app)
}

#[tauri::command]
pub fn set_provider_usage_limits<R: Runtime>(
    app: AppHandle<R>,
    payload: SetProviderLimitsPayload,
) -> Result<StoredUsageLedger, String> {
    let Ok(_guard) = usage_ledger_mutex().lock() else {
        return Err("No se pudo bloquear el historial de límites.".to_string());
    };
    let pid = normalize_provider_id(&payload.provider).to_string();
    let mut ledger = load_usage_ledger(&app);
    let (day, month, _) = local_day_and_month_keys();
    let entry = ledger.providers.entry(pid.clone()).or_insert_with(|| ProviderUsageEntry {
        provider: pid,
        today_date: day,
        month_key: month,
        ..Default::default()
    });
    entry.limits = ProviderLimitConfig {
        monthly_budget_usd: payload.monthly_budget_usd.filter(|v| v.is_finite() && *v > 0.0),
        daily_request_limit: payload.daily_request_limit.filter(|v| *v > 0),
        rpm_limit: payload.rpm_limit.filter(|v| *v > 0),
        tier_mode: payload
            .tier_mode
            .as_deref()
            .map(str::trim)
            .filter(|s| matches!(*s, "free" | "paid"))
            .map(str::to_string),
    };
    write_usage_ledger(&app, &ledger)?;
    let _ = app.emit(AI_USAGE_UPDATED_EVENT, &ledger);
    Ok(ledger)
}

#[tauri::command]
pub fn reset_provider_usage_ledger<R: Runtime>(
    app: AppHandle<R>,
    provider: Option<String>,
) -> Result<StoredUsageLedger, String> {
    let Ok(_guard) = usage_ledger_mutex().lock() else {
        return Err("No se pudo bloquear el historial de límites.".to_string());
    };
    let mut ledger = load_usage_ledger(&app);
    let target = provider
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_provider_id);
    for (pid, entry) in ledger.providers.iter_mut() {
        if target.map(|t| t == pid).unwrap_or(true) {
            entry.today_requests = 0;
            entry.today_prompt_tokens = 0;
            entry.today_completion_tokens = 0;
            entry.today_cached_tokens = 0;
            entry.today_cost_usd = 0.0;
            entry.month_requests = 0;
            entry.month_prompt_tokens = 0;
            entry.month_completion_tokens = 0;
            entry.month_cached_tokens = 0;
            entry.month_cost_usd = 0.0;
            entry.recent_request_timestamps_ms.clear();
            entry.current_rpm = 0;
        }
    }
    write_usage_ledger(&app, &ledger)?;
    let _ = app.emit(AI_USAGE_UPDATED_EVENT, &ledger);
    Ok(ledger)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_round_trip_without_leaking_into_the_file() {
        let mut vault = StoredAiVault::default();
        vault.provider = "deepseek".to_string();
        vault.providers.get_mut("deepseek").unwrap().api_key = Some("Bearer sk-deepseek-000000000000".to_string());
        vault.providers.get_mut("groq").unwrap().api_key = Some("gsk_groqgroqgroqgroqgroq".to_string());
        vault.api_key = Some("sk-deepseek-000000000000".to_string());

        let secrets = take_secrets(&mut vault);
        assert_eq!(secrets.get("deepseek").map(String::as_str), Some("sk-deepseek-000000000000"));
        assert_eq!(secrets.get("groq").map(String::as_str), Some("gsk_groqgroqgroqgroqgroq"));
        let file_body = serde_json::to_string(&vault).unwrap();
        assert!(!file_body.contains("sk-deepseek"), "el archivo no debe contener claves");
        assert!(!file_body.contains("gsk_"), "el archivo no debe contener claves");

        apply_secrets(&mut vault, &secrets);
        assert_eq!(vault.providers["groq"].api_key.as_deref(), Some("gsk_groqgroqgroqgroqgroq"));
        assert_eq!(vault.api_key.as_deref(), Some("sk-deepseek-000000000000"));
    }

    #[test]
    fn legacy_single_provider_key_is_migrated_to_its_provider() {
        let mut vault = StoredAiVault::default();
        vault.provider = "openrouter".to_string();
        vault.api_key = Some("sk-or-v1-legacylegacylegacy".to_string());

        let secrets = take_secrets(&mut vault);
        assert_eq!(secrets.get("openrouter").map(String::as_str), Some("sk-or-v1-legacylegacylegacy"));
        assert!(vault.api_key.is_none());
    }

    #[test]
    fn session_only_keeps_only_unchanged_legacy_keys_on_disk() {
        let on_disk: SecretMap = [
            ("openrouter", "sk-or-vieja"),
            ("groq", "gsk_vieja"),
            ("deepseek", "sk-borrada"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let current: SecretMap = [
            ("openrouter", "sk-or-vieja"), // sin cambios: se conserva
            ("groq", "gsk_nueva"),         // cambiada: solo en la sesión
            ("gemini", "AIza-nueva"),      // nueva: solo en la sesión
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

        let kept = legacy_secrets_to_keep(on_disk, &current);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept.get("openrouter").map(String::as_str), Some("sk-or-vieja"));
    }

    #[test]
    fn python_is_always_launched_in_utf8_mode() {
        let cmd = python_command(std::path::Path::new("python3"));
        let env: HashMap<_, _> = cmd.get_envs().collect();
        assert_eq!(env.get(std::ffi::OsStr::new("PYTHONUTF8")).copied().flatten(), Some(std::ffi::OsStr::new("1")));
        assert_eq!(
            env.get(std::ffi::OsStr::new("PYTHONIOENCODING")).copied().flatten(),
            Some(std::ffi::OsStr::new("utf-8"))
        );
    }

    /// Viaje real por el pipe. En Windows (cp1252), sin modo UTF-8 la "Á" hace fallar a Python.
    #[test]
    fn spanish_text_survives_the_python_pipe() {
        let bin = if cfg!(windows) { "python" } else { "python3" };
        let text = "¿Qué hora es? Ágil, Índice, año, ü — ✓";
        let child = python_command(std::path::Path::new(bin))
            .args(["-c", "import sys; sys.stdout.write(sys.stdin.read())"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let Ok(mut child) = child else {
            eprintln!("sin `{bin}` en este equipo: se omite la prueba del pipe");
            return;
        };
        child.stdin.take().unwrap().write_all(text.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "Python falló: {}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(String::from_utf8(output.stdout).unwrap(), text);
    }

    #[test]
    fn provider_keys_never_come_from_environment() {
        let vault = StoredAiVault::default();
        // SAFETY: test de un solo hilo sobre una variable que nada más lee en este proceso.
        unsafe { std::env::set_var("DEEPSEEK_API_KEY", "sk-from-env-000000000000") };
        let (key, source) = resolve_provider_key(&vault, "deepseek");
        unsafe { std::env::remove_var("DEEPSEEK_API_KEY") };
        assert!(key.is_none());
        assert_eq!(source, "none");
    }

    #[test]
    fn normalizes_kimi_and_moonshot_aliases() {
        assert_eq!(normalize_provider_id("kimi"), "kimi");
        assert_eq!(normalize_provider_id("Moonshot"), "kimi");
        assert_eq!(normalize_provider_id("moonshot-ai"), "kimi");
        assert_eq!(normalize_provider_id("moonshot-cn"), "kimi");
        assert_eq!(default_model_for_provider("kimi"), "kimi-k3.1-pro");
        assert_eq!(SUPPORTED_PROVIDERS.len(), 7);
    }

    #[test]
    fn ledger_tracks_rpm_rollover_and_cost() {
        let mut ledger = StoredUsageLedger::default();
        let res = serde_json::json!({
            "provider_used": "deepseek",
            "model_used": "deepseek-flash",
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 500,
                "cached_tokens": 200,
                "estimated_cost_usd": 0.00042,
            },
            "rate_limits": {
                "source": "api_headers",
                "rpm_limit": 60,
                "rpm_remaining": 59,
            }
        });
        apply_chat_turn_to_ledger(&mut ledger, "deepseek", &res, "2026-11-14", "2026-11", 1_000_000);
        apply_chat_turn_to_ledger(&mut ledger, "deepseek", &res, "2026-11-14", "2026-11", 1_020_000);
        let ds = ledger.providers.get("deepseek").expect("deepseek entry");
        assert_eq!(ds.today_requests, 2);
        assert_eq!(ds.month_requests, 2);
        assert_eq!(ds.today_prompt_tokens, 2000);
        assert_eq!(ds.today_cached_tokens, 400);
        assert!((ds.today_cost_usd - 0.00084).abs() < 1e-8);
        assert_eq!(ds.current_rpm, 2);
        assert_eq!(ds.rate_limits.as_ref().and_then(|r| r.rpm_remaining), Some(59));

        // Next day resets today counters & old RPM window, keeps month totals
        apply_chat_turn_to_ledger(&mut ledger, "deepseek", &res, "2026-11-15", "2026-11", 87_000_000);
        let ds_next = ledger.providers.get("deepseek").expect("deepseek entry next day");
        assert_eq!(ds_next.today_requests, 1);
        assert_eq!(ds_next.month_requests, 3);
        assert_eq!(ds_next.current_rpm, 1);
    }

    #[test]
    fn ledger_stores_deepseek_and_kimi_balances() {
        let mut ledger = StoredUsageLedger::default();
        let kimi_test = serde_json::json!({
            "ok": true,
            "provider": "kimi",
            "balance_currency": "USD",
            "balance_raw": 14.5,
            "balance_usd": 14.5,
            "credits_remaining": 14.5,
            "balance_granted": 2.0,
            "balance_topped_up": 12.5,
            "can_use_paid_models": true,
            "rate_limit_source": "api_balance"
        });
        apply_test_result_to_ledger(&mut ledger, "kimi", &kimi_test, "2026-11-14", "2026-11", 2_000_000);
        let k = ledger.providers.get("kimi").expect("kimi entry");
        assert_eq!(k.balance.as_ref().and_then(|b| b.balance_usd), Some(14.5));
        assert_eq!(k.balance.as_ref().and_then(|b| b.balance_topped_up), Some(12.5));
    }
}

