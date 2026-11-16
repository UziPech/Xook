use crate::slices::workspace_manager::registry::resolve_active_workspace_root;
use crate::slices::workspace_manager::sandbox::write_string_atomic;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const XOX_PROFILE_UPDATED_EVENT: &str = "xox-profile-updated";

const XOX_PROFILE_FILENAME: &str = "xox-profile.json";
const XOX_SKILLS_DIRNAME: &str = "xox-skills";
const XOX_BACKUPS_DIRNAME: &str = "xox-backups";
const MAX_SKILL_BYTES: usize = 240_000;

const ALLOWED_ACCENTS: [&str; 5] = ["classic", "violet", "emerald", "amber", "rose"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalXoxProfile {
    #[serde(default = "default_agent_name")]
    pub agent_name: String,
    #[serde(default = "default_active_role")]
    pub active_role: String,
    #[serde(default = "default_personality")]
    pub personality: String,
    #[serde(default = "default_tone_tags")]
    pub tone_tags: Vec<String>,
    #[serde(default)]
    pub initial_instructions: String,
    #[serde(default)]
    pub global_rules: Vec<String>,
    #[serde(default)]
    pub likes: Vec<String>,
    #[serde(default)]
    pub workflows: Vec<String>,
    #[serde(default)]
    pub donts: Vec<String>,
    #[serde(default = "default_accent_preset")]
    pub accent_preset: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_agent_name() -> String {
    "Xox".to_string()
}

fn default_active_role() -> String {
    "Asistente Co-Constructor".to_string()
}

fn default_personality() -> String {
    "Cercano, claro, práctico y directo.".to_string()
}

fn default_tone_tags() -> Vec<String> {
    vec![
        "Cercano".to_string(),
        "Directo".to_string(),
        "Práctico".to_string(),
    ]
}

fn default_accent_preset() -> String {
    "classic".to_string()
}

impl Default for GlobalXoxProfile {
    fn default() -> Self {
        Self {
            agent_name: default_agent_name(),
            active_role: default_active_role(),
            personality: default_personality(),
            tone_tags: default_tone_tags(),
            initial_instructions: String::new(),
            global_rules: Vec::new(),
            likes: Vec::new(),
            workflows: Vec::new(),
            donts: Vec::new(),
            accent_preset: default_accent_preset(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveGlobalXoxProfilePayload {
    pub agent_name: Option<String>,
    pub active_role: Option<String>,
    pub personality: Option<String>,
    pub tone_tags: Option<Vec<String>>,
    pub initial_instructions: Option<String>,
    pub global_rules: Option<Vec<String>>,
    pub likes: Option<Vec<String>>,
    pub workflows: Option<Vec<String>>,
    pub donts: Option<Vec<String>>,
    pub accent_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XoxSkillEntry {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub role: String,
    pub domain: String,
    pub scope: String,
    pub rel_path: String,
    pub enabled: bool,
    pub source: String,
    pub updated_at: String,
    pub raw_markdown: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveXoxSkillPayload {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    pub name: String,
    pub raw_markdown: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteXoxSkillPayload {
    pub scope: String,
    pub slug: String,
}

pub fn xox_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))
}

pub fn xox_profile_path_in(config_dir: &Path) -> PathBuf {
    config_dir.join(XOX_PROFILE_FILENAME)
}

pub fn xox_global_skills_dir_in(config_dir: &Path) -> PathBuf {
    config_dir.join(XOX_SKILLS_DIRNAME)
}

pub fn normalize_accent_preset(raw: &str) -> String {
    let clean = raw.trim().to_ascii_lowercase();
    if ALLOWED_ACCENTS.contains(&clean.as_str()) {
        clean
    } else {
        default_accent_preset()
    }
}

fn clean_string_list(items: Vec<String>, max_items: usize, max_len: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in items {
        let collapsed: String = raw
            .trim()
            .trim_start_matches(['-', '*', '•'])
            .trim()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if collapsed.is_empty() {
            continue;
        }
        let clipped: String = collapsed.chars().take(max_len).collect();
        let key = clipped.to_lowercase();
        if seen.insert(key) {
            out.push(clipped);
            if out.len() >= max_items {
                break;
            }
        }
    }
    out
}

pub fn normalize_profile(mut profile: GlobalXoxProfile) -> GlobalXoxProfile {
    let name: String = profile.agent_name.trim().chars().take(40).collect();
    profile.agent_name = if name.is_empty() {
        default_agent_name()
    } else {
        name
    };

    let role: String = profile.active_role.trim().chars().take(80).collect();
    profile.active_role = if role.is_empty() {
        default_active_role()
    } else {
        role
    };

    let pers: String = profile.personality.trim().chars().take(240).collect();
    profile.personality = if pers.is_empty() {
        default_personality()
    } else {
        pers
    };

    profile.tone_tags = clean_string_list(profile.tone_tags, 8, 28);
    profile.initial_instructions = profile
        .initial_instructions
        .trim()
        .chars()
        .take(3000)
        .collect();
    profile.global_rules = clean_string_list(profile.global_rules, 30, 240);
    profile.likes = clean_string_list(profile.likes, 30, 240);
    profile.workflows = clean_string_list(profile.workflows, 30, 240);
    profile.donts = clean_string_list(profile.donts, 30, 240);
    profile.accent_preset = normalize_accent_preset(&profile.accent_preset);
    profile
}

fn snapshot_backup(config_dir: &Path, key: &str, existing_path: &Path) {
    if !existing_path.is_file() {
        return;
    }
    let Ok(raw) = fs::read_to_string(existing_path) else {
        return;
    };
    let backup_dir = config_dir.join(XOX_BACKUPS_DIRNAME);
    let safe_name = key.replace(['/', '\\', ':'], "__");
    let latest = backup_dir.join(format!("{safe_name}.bak"));
    let _ = write_string_atomic(&latest, &raw);
}

pub fn load_global_xox_profile_in(config_dir: &Path) -> GlobalXoxProfile {
    let path = xox_profile_path_in(config_dir);
    let Ok(raw) = fs::read_to_string(&path) else {
        return GlobalXoxProfile::default();
    };
    let parsed: GlobalXoxProfile = serde_json::from_str(&raw).unwrap_or_default();
    normalize_profile(parsed)
}

pub fn load_global_xox_profile<R: Runtime>(app: &AppHandle<R>) -> GlobalXoxProfile {
    let Ok(dir) = xox_config_dir(app) else {
        return GlobalXoxProfile::default();
    };
    load_global_xox_profile_in(&dir)
}

pub fn apply_global_xox_patch_in(
    config_dir: &Path,
    patch: SaveGlobalXoxProfilePayload,
) -> Result<GlobalXoxProfile, String> {
    let mut current = load_global_xox_profile_in(config_dir);

    if let Some(v) = patch.agent_name {
        current.agent_name = v;
    }
    if let Some(v) = patch.active_role {
        current.active_role = v;
    }
    if let Some(v) = patch.personality {
        current.personality = v;
    }
    if let Some(v) = patch.tone_tags {
        current.tone_tags = v;
    }
    if let Some(v) = patch.initial_instructions {
        current.initial_instructions = v;
    }
    if let Some(v) = patch.global_rules {
        current.global_rules = v;
    }
    if let Some(v) = patch.likes {
        current.likes = v;
    }
    if let Some(v) = patch.workflows {
        current.workflows = v;
    }
    if let Some(v) = patch.donts {
        current.donts = v;
    }
    if let Some(v) = patch.accent_preset {
        current.accent_preset = v;
    }

    let mut next = normalize_profile(current);
    next.updated_at = Utc::now().to_rfc3339();

    let path = xox_profile_path_in(config_dir);
    snapshot_backup(config_dir, XOX_PROFILE_FILENAME, &path);

    let serialized = serde_json::to_string_pretty(&next)
        .map_err(|e| format!("Error serializando perfil global de Xox: {e}"))?;
    write_string_atomic(&path, &format!("{serialized}\n"))?;
    Ok(next)
}

pub fn save_global_xox_profile<R: Runtime>(
    app: &AppHandle<R>,
    patch: SaveGlobalXoxProfilePayload,
) -> Result<GlobalXoxProfile, String> {
    let dir = xox_config_dir(app)?;
    let saved = apply_global_xox_patch_in(&dir, patch)?;
    let _ = app.emit(XOX_PROFILE_UPDATED_EVENT, &saved);
    Ok(saved)
}

pub fn slugify_skill_name(raw: &str) -> String {
    let lower = raw.trim().to_lowercase();
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        let mapped = match ch {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        };
        if mapped == '-' {
            if !slug.is_empty() && !prev_dash {
                slug.push('-');
            }
            prev_dash = true;
        } else {
            slug.push(mapped);
            prev_dash = false;
        }
        if slug.len() >= 64 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "habilidad-personalizada".to_string()
    } else {
        trimmed
    }
}

fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && slug != "."
        && slug != ".."
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

fn parse_frontmatter(raw: &str) -> (HashMap<String, String>, String) {
    let text = raw.trim_start_matches('\u{feff}');
    if !text.starts_with("---") {
        return (HashMap::new(), text.trim().to_string());
    }
    let lines: Vec<&str> = text.lines().collect();
    if lines.first().map(|s| s.trim()) != Some("---") {
        return (HashMap::new(), text.trim().to_string());
    }
    let Some(end_idx) = lines.iter().skip(1).position(|l| l.trim() == "---") else {
        return (HashMap::new(), text.trim().to_string());
    };
    let close_idx = end_idx + 1;

    let mut meta = HashMap::new();
    let mut current_key: Option<String> = None;
    for raw_line in &lines[1..close_idx] {
        let stripped = raw_line.trim();
        if stripped.is_empty() || stripped.starts_with('#') {
            continue;
        }
        let starts_ws = raw_line.chars().next().is_some_and(|c| c.is_whitespace());
        if !starts_ws {
            if let Some((k_part, v_part)) = raw_line.split_once(':') {
                let k = k_part.trim().to_lowercase();
                let v = v_part
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim()
                    .to_string();
                if !k.is_empty() {
                    current_key = Some(k.clone());
                    if matches!(v.as_str(), "|" | ">" | "|-" | ">-") {
                        meta.insert(k, String::new());
                    } else {
                        meta.insert(k, v);
                    }
                }
            }
        } else if let Some(ref k) = current_key {
            let extra = stripped.trim_start_matches('-').trim();
            if !extra.is_empty() {
                let prev = meta.get(k).cloned().unwrap_or_default();
                let joined = if prev.is_empty() {
                    extra.to_string()
                } else {
                    format!("{prev} {extra}")
                };
                meta.insert(k.clone(), joined);
            }
        }
    }

    let body = lines[(close_idx + 1)..].join("\n").trim().to_string();
    (meta, body)
}

fn has_hidden_bidi_unicode(raw: &str) -> bool {
    raw.chars().skip(usize::from(raw.starts_with('\u{feff}'))).any(|c| {
        matches!(
            c as u32,
            0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x206F | 0xFEFF
        )
    })
}

fn read_skill_entry(path: &Path, scope: &str, rel_path: String) -> Option<XoxSkillEntry> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.len() > MAX_SKILL_BYTES || has_hidden_bidi_unicode(&raw) {
        return None;
    }
    let (meta, body) = parse_frontmatter(&raw);
    let fallback_slug = if path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("SKILL.md"))
    {
        path.parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("skill")
    } else {
        path.file_stem().and_then(|n| n.to_str()).unwrap_or("skill")
    };

    let raw_slug = meta.get("slug").or_else(|| meta.get("name")).map(|s| s.as_str()).unwrap_or(fallback_slug);
    let slug = slugify_skill_name(if fallback_slug.is_empty() { raw_slug } else { fallback_slug });
    let title = meta
        .get("title")
        .filter(|s| !s.trim().is_empty())
        .cloned()
        .or_else(|| {
            body.lines()
                .find_map(|l| {
                    let t = l.trim();
                    t.strip_prefix("# ").map(|h| h.trim().to_string())
                })
        })
        .or_else(|| meta.get("name").cloned())
        .unwrap_or_else(|| slug.clone());

    let mut desc = meta.get("description").cloned().unwrap_or_default();
    if desc.trim().is_empty() {
        desc = body
            .lines()
            .find_map(|l| {
                let s = l.trim().trim_start_matches('#').trim();
                if s.is_empty() { None } else { Some(s.chars().take(180).collect()) }
            })
            .unwrap_or_default();
    }

    let enabled = meta
        .get("enabled")
        .map(|v| !matches!(v.trim().to_lowercase().as_str(), "false" | "0" | "no" | "off"))
        .unwrap_or(true);

    Some(XoxSkillEntry {
        slug,
        name: title,
        description: desc,
        role: meta.get("role").cloned().unwrap_or_default(),
        domain: meta.get("domain").cloned().unwrap_or_default(),
        scope: scope.to_string(),
        rel_path,
        enabled,
        source: meta.get("source").cloned().unwrap_or_else(|| scope.to_string()),
        updated_at: meta.get("updated_at").cloned().unwrap_or_default(),
        raw_markdown: raw,
    })
}

fn collect_skills_from_dir(dir: &Path, scope: &str, prefix: &str, out: &mut Vec<XoxSkillEntry>) {
    if !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut children: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    children.sort();

    for path in children {
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if fname.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.is_file() {
                let rel = format!("{prefix}{fname}/SKILL.md");
                if let Some(item) = read_skill_entry(&skill_md, scope, rel) {
                    out.push(item);
                }
            }
        } else if scope == "workspace"
            && path.is_file()
            && path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            && !matches!(fname.to_ascii_lowercase().as_str(), "perfil-usuario.md" | "readme.md")
        {
            let rel = format!("{prefix}{fname}");
            if let Some(item) = read_skill_entry(&path, scope, rel) {
                out.push(item);
            }
        }
    }
}

pub fn find_builtin_skills_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("skills"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("skills"));
        }
    }
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("skills"));
    }
    candidates.into_iter().find(|p| p.is_dir())
}

pub fn list_xox_skills_in(
    config_dir: &Path,
    workspace_root: Option<&Path>,
    builtin_dir: Option<&Path>,
) -> Vec<XoxSkillEntry> {
    let mut out = Vec::new();
    collect_skills_from_dir(
        &xox_global_skills_dir_in(config_dir),
        "global",
        "global:xox-skills/",
        &mut out,
    );
    if let Some(ws) = workspace_root {
        collect_skills_from_dir(&ws.join("habilidades"), "workspace", "habilidades/", &mut out);
    }
    if let Some(bi) = builtin_dir {
        collect_skills_from_dir(bi, "builtin", "builtin:skills/", &mut out);
    }
    out
}

pub fn list_xox_skills<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<XoxSkillEntry>, String> {
    let dir = xox_config_dir(app)?;
    let ws = resolve_active_workspace_root(app);
    let bi = find_builtin_skills_dir(app);
    Ok(list_xox_skills_in(&dir, ws.as_deref(), bi.as_deref()))
}

pub fn save_xox_skill_in(
    config_dir: &Path,
    workspace_root: Option<&Path>,
    payload: SaveXoxSkillPayload,
) -> Result<XoxSkillEntry, String> {
    let scope = match payload.scope.as_deref().unwrap_or("global").trim().to_ascii_lowercase().as_str() {
        "workspace" => "workspace",
        _ => "global",
    };

    let raw_md = payload.raw_markdown.trim().to_string();
    if raw_md.is_empty() {
        return Err("La habilidad no puede estar vacía.".to_string());
    }
    if raw_md.len() > MAX_SKILL_BYTES {
        return Err("La habilidad supera el tamaño máximo permitido (240 KB).".to_string());
    }
    if has_hidden_bidi_unicode(&raw_md) {
        return Err("La habilidad contiene caracteres invisibles no permitidos.".to_string());
    }

    let raw_slug = payload
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&payload.name);
    let slug = slugify_skill_name(raw_slug);
    if !is_valid_slug(&slug) {
        return Err("El identificador de la habilidad no es válido.".to_string());
    }

    let (target_path, rel_path) = if scope == "workspace" {
        let ws = workspace_root.ok_or_else(|| "No hay un workspace activo.".to_string())?;
        let rel = format!("habilidades/{slug}/SKILL.md");
        (ws.join("habilidades").join(&slug).join("SKILL.md"), rel)
    } else {
        let rel = format!("global:xox-skills/{slug}/SKILL.md");
        (
            xox_global_skills_dir_in(config_dir)
                .join(&slug)
                .join("SKILL.md"),
            rel,
        )
    };

    snapshot_backup(config_dir, &format!("{scope}_{slug}_SKILL.md"), &target_path);
    write_string_atomic(&target_path, &format!("{raw_md}\n"))?;

    read_skill_entry(&target_path, scope, rel_path)
        .ok_or_else(|| "Se guardó la habilidad pero no pudo leerse su estructura.".to_string())
}

pub fn delete_xox_skill_in(
    config_dir: &Path,
    workspace_root: Option<&Path>,
    scope: &str,
    slug: &str,
) -> Result<(), String> {
    let clean_slug = slugify_skill_name(slug);
    if !is_valid_slug(&clean_slug) {
        return Err("Identificador de habilidad inválido.".to_string());
    }
    let scope_norm = scope.trim().to_ascii_lowercase();
    let skill_dir = match scope_norm.as_str() {
        "global" => xox_global_skills_dir_in(config_dir).join(&clean_slug),
        "workspace" => {
            let ws = workspace_root.ok_or_else(|| "No hay un workspace activo.".to_string())?;
            ws.join("habilidades").join(&clean_slug)
        }
        _ => return Err("Solo se pueden eliminar habilidades personalizadas o del espacio.".to_string()),
    };

    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("No existe la habilidad '{clean_slug}'."));
    }

    snapshot_backup(config_dir, &format!("deleted_{scope_norm}_{clean_slug}_SKILL.md"), &skill_md);
    fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("No se pudo eliminar la habilidad '{clean_slug}': {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xook_studio_{label}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_and_patches_global_profile_with_backup() {
        let cfg = make_temp_dir("profile");
        let first = apply_global_xox_patch_in(
            &cfg,
            SaveGlobalXoxProfilePayload {
                agent_name: Some("Maya".into()),
                personality: Some("Clara y amable".into()),
                global_rules: Some(vec!["- Responder en pasos cortos".into()]),
                accent_preset: Some("violet".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(first.agent_name, "Maya");
        assert_eq!(first.accent_preset, "violet");
        assert_eq!(first.global_rules, vec!["Responder en pasos cortos"]);

        let second = apply_global_xox_patch_in(
            &cfg,
            SaveGlobalXoxProfilePayload {
                agent_name: Some("Atlas".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(second.agent_name, "Atlas");
        assert_eq!(second.personality, "Clara y amable");
        assert!(cfg.join(XOX_BACKUPS_DIRNAME).join("xox-profile.json.bak").is_file());
        let _ = fs::remove_dir_all(&cfg);
    }

    #[test]
    fn creates_lists_toggles_and_deletes_global_and_workspace_skills() {
        let cfg = make_temp_dir("skills_cfg");
        let ws = make_temp_dir("skills_ws");

        let created_global = save_xox_skill_in(
            &cfg,
            Some(&ws),
            SaveXoxSkillPayload {
                scope: Some("global".into()),
                slug: None,
                name: "Cierre Diario".into(),
                raw_markdown: "---\nname: \"cierre-diario\"\ntitle: \"Cierre Diario\"\ndescription: \"Revisa ventas y pendientes al cerrar\"\nenabled: true\n---\n\n# Cierre Diario\n\n## Pasos\n- Revisar caja\n".into(),
            },
        )
        .unwrap();
        assert_eq!(created_global.slug, "cierre-diario");
        assert_eq!(created_global.scope, "global");
        assert!(created_global.enabled);

        let created_ws = save_xox_skill_in(
            &cfg,
            Some(&ws),
            SaveXoxSkillPayload {
                scope: Some("workspace".into()),
                slug: None,
                name: "Revisión de Código".into(),
                raw_markdown: "---\nname: \"revision-de-codigo\"\ndescription: \"Analiza cambios antes de aprobar\"\nenabled: false\n---\n\n# Revisión de Código\n".into(),
            },
        )
        .unwrap();
        assert_eq!(created_ws.scope, "workspace");
        assert!(!created_ws.enabled);

        let all = list_xox_skills_in(&cfg, Some(&ws), None);
        assert_eq!(all.len(), 2);

        delete_xox_skill_in(&cfg, Some(&ws), "global", "cierre-diario").unwrap();
        let after = list_xox_skills_in(&cfg, Some(&ws), None);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].slug, "revision-de-codigo");

        let _ = fs::remove_dir_all(&cfg);
        let _ = fs::remove_dir_all(&ws);
    }
}
