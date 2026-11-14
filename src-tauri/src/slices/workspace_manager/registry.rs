use super::sandbox::{slugify_workspace_name, write_string_atomic};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const REGISTRY_FILENAME: &str = "workspaces.json";
pub const DEFAULT_BASE_FOLDER_NAME: &str = "XoxMemoryApp";
pub const DEFAULT_WORKSPACE_BUDGET: f64 = 25000.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub root_path: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegistry {
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<WorkspaceEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManifest {
    pub id: String,
    pub name: String,
    pub schema_version: u32,
    pub agent_name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePermissionsConfig {
    pub version: u32,
    pub default_policy: String,
    pub rules: Vec<serde_json::Value>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceProfileFile {
    pub company_name: String,
    pub agent_name: String,
    pub currency: String,
    pub stock_threshold_days: u32,
    pub max_budget_per_order: f64,
    pub preferred_suppliers: Vec<serde_json::Value>,
    pub business_rules: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_role: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBusinessSummary {
    pub company_name: String,
    pub agent_name: String,
    pub currency: String,
    pub stock_threshold_days: u32,
    pub max_budget_per_order: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspacePatternItem {
    pub pattern_id: String,
    pub description: String,
    pub confidence: f64,
}

pub fn default_workspaces_base_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Ok(docs) = app.path().document_dir() {
        return Ok(docs.join(DEFAULT_BASE_FOLDER_NAME));
    }
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let p = PathBuf::from(home).join("Documents").join(DEFAULT_BASE_FOLDER_NAME);
        return Ok(p);
    }
    app.path()
        .app_config_dir()
        .map(|d| d.join(DEFAULT_BASE_FOLDER_NAME))
        .map_err(|e| format!("No se pudo resolver la carpeta Documentos del sistema: {e}"))
}

fn registry_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(REGISTRY_FILENAME))
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))
}

pub fn load_registry<R: Runtime>(app: &AppHandle<R>) -> WorkspaceRegistry {
    let Ok(path) = registry_path(app) else {
        return WorkspaceRegistry::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return WorkspaceRegistry::default();
    };
    serde_json::from_str::<WorkspaceRegistry>(&raw).unwrap_or_default()
}

pub fn save_registry<R: Runtime>(
    app: &AppHandle<R>,
    registry: &WorkspaceRegistry,
) -> Result<(), String> {
    let path = registry_path(app)?;
    let body = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Error serializando registro de espacios de trabajo: {e}"))?;
    write_string_atomic(&path, &body)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

fn backup_slug_for_rel(rel_path: &str) -> String {
    rel_path
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .replace('/', "__")
}

/// Valida que un archivo núcleo del workspace no esté truncado ni corrupto antes de respaldarlo o conservarlo.
pub fn is_valid_core_file_content(rel_path: &str, raw: &str) -> bool {
    let norm = rel_path
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_ascii_lowercase();
    match norm.as_str() {
        ".xook/workspace.json" | ".xook/permissions.json" | "empresa/perfil.json" | "memoria/patrones.json" => {
            serde_json::from_str::<serde_json::Value>(raw)
                .ok()
                .and_then(|v| v.as_object().map(|m| !m.is_empty()))
                .unwrap_or(false)
        }
        "empresa/proveedores.json" => serde_json::from_str::<serde_json::Value>(raw)
            .ok()
            .map(|v| match v {
                serde_json::Value::Array(_) => true,
                serde_json::Value::Object(m) => ["suppliers", "proveedores", "items"]
                    .iter()
                    .any(|k| m.get(*k).is_some_and(|x| x.is_array())),
                _ => false,
            })
            .unwrap_or(false),
        "memoria/decisiones.jsonl" => {
            let lines: Vec<&str> = raw.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
            !lines.is_empty()
                && lines
                    .iter()
                    .all(|l| serde_json::from_str::<serde_json::Value>(l).is_ok())
        }
        _ => !raw.trim().is_empty(),
    }
}

/// Guarda una copia sombra segura en `.xook/backups/` si el archivo núcleo es válido.
/// Nunca sobrescribe un respaldo sano con contenido vacío o inválido.
pub fn snapshot_core_file(root: &Path, rel_path: &str) {
    let target = root.join(rel_path);
    let Ok(raw) = fs::read_to_string(&target) else {
        return;
    };
    if !is_valid_core_file_content(rel_path, &raw) {
        return;
    }

    let backups_dir = root.join(".xook/backups");
    let slug = backup_slug_for_rel(rel_path);
    let latest_path = backups_dir.join(format!("{slug}.latest"));
    let prev_path = backups_dir.join(format!("{slug}.prev"));

    if let Ok(existing_latest) = fs::read_to_string(&latest_path) {
        if existing_latest == raw {
            return;
        }
        if is_valid_core_file_content(rel_path, &existing_latest) {
            let _ = write_string_atomic(&prev_path, &existing_latest);
        }
    }
    let _ = write_string_atomic(&latest_path, &raw);
}

fn restore_core_file_from_backup(root: &Path, rel_path: &str) -> Option<String> {
    let backups_dir = root.join(".xook/backups");
    let slug = backup_slug_for_rel(rel_path);
    for suffix in ["latest", "prev"] {
        let cand = backups_dir.join(format!("{slug}.{suffix}"));
        if let Ok(content) = fs::read_to_string(&cand) {
            if is_valid_core_file_content(rel_path, &content) {
                if write_string_atomic(&root.join(rel_path), &content).is_ok() {
                    return Some(suffix.to_string());
                }
            }
        }
    }
    None
}

fn ensure_core_file_resilient(
    root: &Path,
    rel_path: &str,
    default_content: &str,
    allow_empty_initial: bool,
    record_healing: bool,
    healed_out: &mut Vec<String>,
) -> Result<(), String> {
    let target = root.join(rel_path);
    if target.is_file() {
        if let Ok(raw) = fs::read_to_string(&target) {
            if is_valid_core_file_content(rel_path, &raw) {
                snapshot_core_file(root, rel_path);
                return Ok(());
            }
            if allow_empty_initial && raw.trim().is_empty() {
                if let Some(tag) = restore_core_file_from_backup(root, rel_path) {
                    if record_healing {
                        healed_out.push(format!("{rel_path} (restaurado desde respaldo {tag})"));
                    }
                }
                return Ok(());
            }
        }

        if let Some(tag) = restore_core_file_from_backup(root, rel_path) {
            if record_healing {
                healed_out.push(format!("{rel_path} (restaurado desde respaldo {tag})"));
            }
            return Ok(());
        }
        write_string_atomic(&target, default_content)?;
        snapshot_core_file(root, rel_path);
        if record_healing {
            healed_out.push(format!("{rel_path} (regenerado por corrupción/vacío)"));
        }
        return Ok(());
    }

    if let Some(tag) = restore_core_file_from_backup(root, rel_path) {
        if record_healing {
            healed_out.push(format!("{rel_path} (restaurado desde respaldo {tag})"));
        }
        return Ok(());
    }
    write_string_atomic(&target, default_content)?;
    snapshot_core_file(root, rel_path);
    if record_healing {
        healed_out.push(format!("{rel_path} (regenerado)"));
    }
    Ok(())
}

/// Crea de forma idempotente y auto-reparable la estructura base de un espacio de trabajo.
/// Si algún archivo núcleo fue eliminado o dañado externamente, prioriza restaurarlo desde
/// `.xook/backups/` antes de regenerar una plantilla limpia, y devuelve la lista de rutas reparadas.
pub fn scaffold_and_heal_workspace_dir(
    root: &Path,
    workspace_id: &str,
    display_name: &str,
) -> Result<Vec<String>, String> {
    let already_initialized = root.join(".xook/workspace.json").exists();
    let dirs = [
        ".xook",
        ".xook/backups",
        "empresa",
        "empresa/reglas",
        "datos",
        "datos/ventas",
        "datos/documentos",
        "memoria",
        "memoria/diario",
        "habilidades",
        "agente",
        "agente/adjuntos",
        "agente/proyectos",
        "agente/borradores",
        "agente/reportes",
        "agente/revisiones",
        "agente/ordenes",
        "agente/logs",
    ];

    for rel in dirs {
        fs::create_dir_all(root.join(rel))
            .map_err(|e| format!("No se pudo crear carpeta '{rel}': {e}"))?;
    }

    let now = Utc::now().to_rfc3339();
    let clean_name = if display_name.trim().is_empty() {
        "Xox".to_string()
    } else {
        display_name.trim().to_string()
    };

    let mut healed = Vec::new();

    let manifest_default = serde_json::to_string_pretty(&WorkspaceManifest {
        id: workspace_id.to_string(),
        name: clean_name.clone(),
        schema_version: 1,
        agent_name: "Xox".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    })
    .map_err(|e| format!("Error generando workspace.json: {e}"))?;
    ensure_core_file_resilient(
        root,
        ".xook/workspace.json",
        &manifest_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    let permissions_default = serde_json::to_string_pretty(&WorkspacePermissionsConfig {
        version: 1,
        default_policy: "ask".to_string(),
        rules: Vec::new(),
        updated_at: now.clone(),
    })
    .map_err(|e| format!("Error generando permissions.json: {e}"))?;
    ensure_core_file_resilient(
        root,
        ".xook/permissions.json",
        &permissions_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    let profile_default = serde_json::to_string_pretty(&WorkspaceProfileFile {
        company_name: clean_name.clone(),
        agent_name: "Xox".to_string(),
        currency: "MXN".to_string(),
        stock_threshold_days: 7,
        max_budget_per_order: DEFAULT_WORKSPACE_BUDGET,
        preferred_suppliers: Vec::new(),
        business_rules: vec![
            "Nunca ejecutar compras, borrados ni cambios estructurales sin autorización visual HITL.".to_string(),
            "Basar cada análisis en archivos reales de este espacio de trabajo y adaptarse al ámbito y rol activo.".to_string(),
        ],
        domain_type: Some("general".to_string()),
        domain_label: Some("General / Multi-propósito".to_string()),
        mission: None,
        active_role: Some("Asistente Co-Constructor".to_string()),
        roles: Vec::new(),
    })
    .map_err(|e| format!("Error generando empresa/perfil.json: {e}"))?;
    ensure_core_file_resilient(
        root,
        "empresa/perfil.json",
        &profile_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    ensure_core_file_resilient(
        root,
        "empresa/proveedores.json",
        "[]\n",
        false,
        already_initialized,
        &mut healed,
    )?;

    let rules_default = format!(
        "# Reglas de Operación — {clean_name}\n\n\
         Define aquí políticas de compras, topes de autorización, horarios o acuerdos con proveedores.\n\n\
         - Toda modificación propuesta por **Xox** sobre `empresa/` o `datos/` requerirá tu aprobación visual.\n"
    );
    ensure_core_file_resilient(
        root,
        "empresa/reglas/operacion.md",
        &rules_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    let facts_default = format!(
        "# Memoria Viva — {clean_name}\n\n\
         Este archivo guarda hechos reales y acuerdos confirmados del negocio.\n"
    );
    ensure_core_file_resilient(
        root,
        "memoria/hechos.md",
        &facts_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    let patterns_default = serde_json::to_string_pretty(&serde_json::json!({
        "patterns": [],
        "updated_at": now,
    }))
    .unwrap_or_default();
    ensure_core_file_resilient(
        root,
        "memoria/patrones.json",
        &patterns_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    ensure_core_file_resilient(
        root,
        "memoria/decisiones.jsonl",
        "",
        true,
        already_initialized,
        &mut healed,
    )?;

    let agent_note_default = format!(
        "# Espacio de Trabajo de Xox ({clean_name})\n\n\
         Aquí **Xox** organiza sus subcarpetas y entregables:\n\
         - `proyectos/`: análisis por tema, código o iniciativa.\n\
         - `borradores/`: propuestas pendientes de tu aprobación HITL.\n\
         - `reportes/`: resúmenes y tablas exportadas.\n\
         - `revisiones/`: historial legible de revisiones reales.\n\
         - `ordenes/`: órdenes o entregas aprobadas.\n\
         - `logs/`: bitácoras de comandos ejecutados con permiso.\n"
    );
    ensure_core_file_resilient(
        root,
        "agente/notas-xox.md",
        &agent_note_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    let user_profile_default = format!(
        "# Perfil del Usuario — {clean_name}\n\n\
         Espacio dedicado para adaptar a **Xox** según tu estilo, tu flujo de trabajo y tus límites.\n\n\
         ## Gustos y Estilo\n\
         - Español claro, directo y práctico.\n\n\
         ## Flujo de Trabajo Preferido\n\
         - Revisar el contexto y archivos reales antes de proponer cambios importantes.\n\
         - Explicar pasos concretos y opciones claras cuando haya decisiones clave.\n\n\
         ## Qué NO Hacer\n\
         - Nunca inventar datos, métricas, archivos, resultados ni acciones no ejecutadas.\n\
         - No asumir un solo giro o rol si el proyecto cambia de ámbito; preguntar o adaptarse.\n"
    );
    ensure_core_file_resilient(
        root,
        "habilidades/perfil-usuario.md",
        &user_profile_default,
        false,
        already_initialized,
        &mut healed,
    )?;

    Ok(healed)
}

/// Crea de forma idempotente la estructura real de carpetas y archivos base de un espacio de trabajo.
/// Nunca sobrescribe archivos válidos que ya existan; si faltan o se corrompen, restaura desde respaldo o regenera.
pub fn scaffold_workspace_dir(
    root: &Path,
    workspace_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let _ = scaffold_and_heal_workspace_dir(root, workspace_id, display_name)?;
    Ok(())
}

pub fn read_business_summary(root: &Path, fallback_name: &str) -> WorkspaceBusinessSummary {
    let profile_path = root.join("empresa/perfil.json");
    if let Ok(raw) = fs::read_to_string(profile_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            let company_name = val
                .get("company_name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(fallback_name)
                .to_string();
            let agent_name = val
                .get("agent_name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Xox")
                .to_string();
            let currency = val
                .get("currency")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("MXN")
                .to_string();
            let stock_threshold_days = val
                .get("stock_threshold_days")
                .and_then(|v| v.as_u64())
                .map(|n| n.max(1) as u32)
                .unwrap_or(7);
            let max_budget_per_order = val
                .get("max_budget_per_order")
                .and_then(|v| v.as_f64())
                .filter(|n| n.is_finite() && *n > 0.0)
                .unwrap_or(DEFAULT_WORKSPACE_BUDGET);
            let domain_type = val
                .get("domain_type")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let domain_label = val
                .get("domain_label")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let active_role = val
                .get("active_role")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            return WorkspaceBusinessSummary {
                company_name,
                agent_name,
                currency,
                stock_threshold_days,
                max_budget_per_order,
                domain_type,
                domain_label,
                active_role,
            };
        }
    }

    WorkspaceBusinessSummary {
        company_name: fallback_name.to_string(),
        agent_name: "Xox".to_string(),
        currency: "MXN".to_string(),
        stock_threshold_days: 7,
        max_budget_per_order: DEFAULT_WORKSPACE_BUDGET,
        domain_type: None,
        domain_label: None,
        active_role: None,
    }
}

pub fn read_workspace_patterns(root: &Path) -> Vec<WorkspacePatternItem> {
    let patterns_path = root.join("memoria/patrones.json");
    let Ok(raw) = fs::read_to_string(patterns_path) else {
        return Vec::new();
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(arr) = val
        .get("patterns")
        .or_else(|| val.get("inferred_patterns"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };

    arr.iter()
        .filter_map(|item| {
            Some(WorkspacePatternItem {
                pattern_id: item.get("pattern_id")?.as_str()?.to_string(),
                description: item.get("description")?.as_str()?.to_string(),
                confidence: item.get("confidence")?.as_f64()?,
            })
        })
        .collect()
}

pub fn read_permissions_rule_count(root: &Path) -> usize {
    let path = root.join(".xook/permissions.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return 0;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return 0;
    };
    val.get("rules")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0)
}

fn unique_workspace_dir(base_dir: &Path, base_slug: &str) -> (String, PathBuf) {
    let first = base_dir.join(base_slug);
    if !first.exists() || first.join(".xook/workspace.json").exists() {
        return (base_slug.to_string(), first);
    }

    for idx in 2..1000 {
        let candidate_slug = format!("{base_slug}-{idx}");
        let candidate_path = base_dir.join(&candidate_slug);
        if !candidate_path.exists() {
            return (candidate_slug, candidate_path);
        }
    }

    let fallback_slug = format!("{base_slug}-{}", Utc::now().timestamp());
    let fallback_path = base_dir.join(&fallback_slug);
    (fallback_slug, fallback_path)
}

fn ensure_and_audit_heal(root: &Path, ws_id: &str, ws_name: &str) -> Result<(), String> {
    let healed = scaffold_and_heal_workspace_dir(root, ws_id, ws_name)?;
    if !healed.is_empty() && root.join(".xook/xook.db").is_file() {
        let detail = healed.join(", ");
        crate::slices::task_ledger::store::try_record_audit_event_for_root(
            root,
            "system",
            "workspace_self_healed",
            &detail,
            "meta",
            Some("Auto-reparación al activar espacio de trabajo"),
        );
    }
    Ok(())
}

pub fn ensure_active_workspace<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(WorkspaceRegistry, WorkspaceEntry), String> {
    let mut registry = load_registry(app);
    let now = Utc::now().to_rfc3339();

    if let Some(active_id) = registry.active_workspace_id.clone() {
        if let Some(pos) = registry.workspaces.iter().position(|w| w.id == active_id) {
            let root = PathBuf::from(&registry.workspaces[pos].root_path);
            let ws_id = registry.workspaces[pos].id.clone();
            let ws_name = registry.workspaces[pos].name.clone();
            ensure_and_audit_heal(&root, &ws_id, &ws_name)?;
            registry.workspaces[pos].last_opened_at = now;
            let active = registry.workspaces[pos].clone();
            save_registry(app, &registry)?;
            return Ok((registry, active));
        }
    }

    if let Some(first) = registry.workspaces.first().cloned() {
        let root = PathBuf::from(&first.root_path);
        ensure_and_audit_heal(&root, &first.id, &first.name)?;
        registry.active_workspace_id = Some(first.id.clone());
        if let Some(entry) = registry.workspaces.first_mut() {
            entry.last_opened_at = now;
        }
        let active = registry.workspaces[0].clone();
        save_registry(app, &registry)?;
        return Ok((registry, active));
    }

    // Primer arranque limpio: derivar nombre del negocio guardado (si existe) o usar "Xox"
    let initial_name = crate::workspace_store::get_local_user(app.clone())
        .map(|u| u.store_name.trim().to_string())
        .filter(|s| !s.is_empty() && s != "Mi Tienda" && s != "Tienda Xook")
        .unwrap_or_else(|| "Xox".to_string());

    let (reg, active) = create_workspace_entry(app, initial_name, None)?;
    Ok((reg, active))
}

pub fn create_workspace_entry<R: Runtime>(
    app: &AppHandle<R>,
    name: String,
    custom_root_path: Option<String>,
) -> Result<(WorkspaceRegistry, WorkspaceEntry), String> {
    let clean_name = name.trim().to_string();
    if clean_name.is_empty() {
        return Err("Escribe un nombre para el espacio de trabajo.".to_string());
    }

    let base_slug = slugify_workspace_name(&clean_name);
    let (slug, target_root) = match custom_root_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(raw) => {
            let custom = PathBuf::from(&raw);
            if !custom.is_absolute() {
                return Err("La ruta personalizada del workspace debe ser absoluta.".to_string());
            }
            (base_slug.clone(), custom)
        }
        None => {
            let base_dir = default_workspaces_base_dir(app)?;
            fs::create_dir_all(&base_dir)
                .map_err(|e| format!("No se pudo preparar la carpeta base {}: {e}", base_dir.display()))?;
            unique_workspace_dir(&base_dir, &base_slug)
        }
    };

    let mut registry = load_registry(app);
    let root_str = target_root.to_string_lossy().to_string();
    let now = Utc::now().to_rfc3339();

    // Si esa carpeta ya está registrada, actívala sin duplicarla.
    if let Some(existing) = registry
        .workspaces
        .iter_mut()
        .find(|w| w.root_path == root_str)
    {
        scaffold_workspace_dir(&target_root, &existing.id, &clean_name)?;
        existing.last_opened_at = now;
        let cloned = existing.clone();
        registry.active_workspace_id = Some(cloned.id.clone());
        save_registry(app, &registry)?;
        return Ok((registry, cloned));
    }

    let id = format!("ws_{}", Utc::now().timestamp_millis());
    scaffold_workspace_dir(&target_root, &id, &clean_name)?;

    let entry = WorkspaceEntry {
        id: id.clone(),
        name: clean_name,
        slug,
        root_path: root_str,
        created_at: now.clone(),
        last_opened_at: now,
    };

    registry.workspaces.insert(0, entry.clone());
    registry.active_workspace_id = Some(id);
    save_registry(app, &registry)?;

    Ok((registry, entry))
}

pub fn resolve_active_workspace_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    ensure_active_workspace(app)
        .ok()
        .map(|(_, entry)| PathBuf::from(entry.root_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaffold_creates_expected_clean_structure_and_is_idempotent() {
        let root = std::env::temp_dir().join(format!(
            "xook_ws_test_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(1)
        ));
        scaffold_workspace_dir(&root, "ws_test", "Mi Negocio Real").expect("scaffold ok");

        for expected in [
            ".xook/workspace.json",
            ".xook/permissions.json",
            "empresa/perfil.json",
            "empresa/proveedores.json",
            "empresa/reglas/operacion.md",
            "datos/ventas",
            "datos/documentos",
            "memoria/hechos.md",
            "memoria/patrones.json",
            "memoria/decisiones.jsonl",
            "memoria/diario",
            "habilidades",
            "agente/proyectos",
            "agente/borradores",
            "agente/reportes",
            "agente/revisiones",
            "agente/ordenes",
            "agente/logs",
            "agente/notas-xox.md",
        ] {
            assert!(root.join(expected).exists(), "missing expected path: {expected}");
        }

        let perfil = fs::read_to_string(root.join("empresa/perfil.json")).unwrap();
        assert!(!perfil.contains("Café") && !perfil.contains("Matcha") && !perfil.contains("Distribuidora del Sur"));

        let custom_fact = "# Memoria custom\n- Dato real guardado por usuario\n";
        fs::write(root.join("memoria/hechos.md"), custom_fact).unwrap();
        scaffold_workspace_dir(&root, "ws_test", "Mi Negocio Real").expect("idempotent run ok");
        assert_eq!(fs::read_to_string(root.join("memoria/hechos.md")).unwrap(), custom_fact);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn self_heal_restores_deleted_or_zero_byte_core_files_from_shadow_backup() {
        let root = std::env::temp_dir().join(format!(
            "xook_heal_backup_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);

        scaffold_and_heal_workspace_dir(&root, "ws_bk", "Café Norte").expect("initial scaffold");

        let custom_profile = "{\"business_name\":\"Café Norte\",\"roles\":[\"Barista\",\"Gerente\"]}\n";
        let custom_suppliers = "[{\"id\":\"sup_1\",\"name\":\"Tostadores del Sur\"}]\n";
        let custom_facts = "# Hechos reales\n- Los domingos abre a las 9am.\n";
        fs::write(root.join("empresa/perfil.json"), custom_profile).unwrap();
        fs::write(root.join("empresa/proveedores.json"), custom_suppliers).unwrap();
        fs::write(root.join("memoria/hechos.md"), custom_facts).unwrap();
        snapshot_core_file(&root, "empresa/perfil.json");
        snapshot_core_file(&root, "empresa/proveedores.json");
        snapshot_core_file(&root, "memoria/hechos.md");

        // Simular eliminación/corrupción externa
        fs::remove_file(root.join("empresa/perfil.json")).unwrap();
        fs::write(root.join("empresa/proveedores.json"), "").unwrap();
        fs::write(root.join("memoria/hechos.md"), "   \n").unwrap();
        fs::remove_dir_all(root.join("datos/ventas")).unwrap();
        fs::remove_dir_all(root.join("datos/documentos")).unwrap();

        let healed =
            scaffold_and_heal_workspace_dir(&root, "ws_bk", "Café Norte").expect("heal ok");

        assert_eq!(
            fs::read_to_string(root.join("empresa/perfil.json")).unwrap(),
            custom_profile
        );
        assert_eq!(
            fs::read_to_string(root.join("empresa/proveedores.json")).unwrap(),
            custom_suppliers
        );
        assert_eq!(
            fs::read_to_string(root.join("memoria/hechos.md")).unwrap(),
            custom_facts
        );
        assert!(root.join("datos/ventas").is_dir());
        assert!(root.join("datos/documentos").is_dir());
        assert!(healed.iter().any(|h| h.contains("empresa/perfil.json")));
        assert!(healed.iter().any(|h| h.contains("empresa/proveedores.json")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn self_heal_falls_back_to_clean_template_when_no_backup_exists() {
        let root = std::env::temp_dir().join(format!(
            "xook_heal_tpl_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);

        scaffold_and_heal_workspace_dir(&root, "ws_tpl", "Panadería Sol").expect("initial scaffold");
        let _ = fs::remove_dir_all(root.join(".xook/backups"));
        fs::remove_file(root.join("empresa/proveedores.json")).unwrap();
        fs::write(root.join("empresa/perfil.json"), "{corrupto").unwrap();

        let healed =
            scaffold_and_heal_workspace_dir(&root, "ws_tpl", "Panadería Sol").expect("heal ok");

        let prov = fs::read_to_string(root.join("empresa/proveedores.json")).unwrap();
        assert!(is_valid_core_file_content("empresa/proveedores.json", &prov));
        let perfil = fs::read_to_string(root.join("empresa/perfil.json")).unwrap();
        assert!(is_valid_core_file_content("empresa/perfil.json", &perfil));
        assert!(healed.iter().any(|h| h.contains("empresa/proveedores.json")));
        assert!(healed.iter().any(|h| h.contains("empresa/perfil.json")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn user_profile_slot_and_backward_compatible_summary() {
        let root = std::env::temp_dir().join(format!(
            "xook_user_slot_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);

        scaffold_and_heal_workspace_dir(&root, "ws_slot", "Taller Creativo").expect("scaffold ok");
        let user_profile_path = root.join("habilidades/perfil-usuario.md");
        assert!(user_profile_path.is_file());
        let user_md = fs::read_to_string(&user_profile_path).unwrap();
        assert!(user_md.contains("## Gustos y Estilo"));
        assert!(user_md.contains("## Flujo de Trabajo Preferido"));
        assert!(user_md.contains("## Qué NO Hacer"));

        // Preserva compatibilidad al deserializar un perfil legado sin campos multi-ámbito
        let legacy_json = serde_json::json!({
            "company_name": "Café Legado",
            "agent_name": "Xox",
            "currency": "MXN",
            "stock_threshold_days": 5,
            "max_budget_per_order": 500.0,
            "preferred_suppliers": [],
            "business_rules": ["Regla 1"]
        });
        let parsed: WorkspaceProfileFile = serde_json::from_value(legacy_json).expect("legacy ok");
        assert!(parsed.domain_type.is_none());
        assert!(parsed.active_role.is_none());

        // Auto-curación si alguien borra habilidades/perfil-usuario.md
        fs::remove_file(&user_profile_path).unwrap();
        let healed = scaffold_and_heal_workspace_dir(&root, "ws_slot", "Taller Creativo").expect("heal ok");
        assert!(user_profile_path.is_file());
        assert!(healed.iter().any(|h| h.contains("habilidades/perfil-usuario.md")));

        let summary = read_business_summary(&root, "Fallback");
        assert_eq!(summary.domain_type.as_deref(), Some("general"));
        assert_eq!(summary.active_role.as_deref(), Some("Asistente Co-Constructor"));

        let _ = fs::remove_dir_all(&root);
    }
}

