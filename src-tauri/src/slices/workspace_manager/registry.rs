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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBusinessSummary {
    pub company_name: String,
    pub agent_name: String,
    pub currency: String,
    pub stock_threshold_days: u32,
    pub max_budget_per_order: f64,
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

/// Crea de forma idempotente la estructura real de carpetas y archivos base de un espacio de trabajo.
/// Nunca sobrescribe archivos que ya existan para proteger cambios del usuario o del agente.
pub fn scaffold_workspace_dir(
    root: &Path,
    workspace_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let dirs = [
        ".xook",
        "empresa",
        "empresa/reglas",
        "datos",
        "datos/ventas",
        "datos/documentos",
        "memoria",
        "memoria/diario",
        "habilidades",
        "agente",
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

    let manifest_path = root.join(".xook/workspace.json");
    if !manifest_path.exists() {
        let manifest = WorkspaceManifest {
            id: workspace_id.to_string(),
            name: clean_name.clone(),
            schema_version: 1,
            agent_name: "Xox".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Error generando workspace.json: {e}"))?;
        write_string_atomic(&manifest_path, &json)?;
    }

    let permissions_path = root.join(".xook/permissions.json");
    if !permissions_path.exists() {
        let permissions = WorkspacePermissionsConfig {
            version: 1,
            default_policy: "ask".to_string(),
            rules: Vec::new(),
            updated_at: now.clone(),
        };
        let json = serde_json::to_string_pretty(&permissions)
            .map_err(|e| format!("Error generando permissions.json: {e}"))?;
        write_string_atomic(&permissions_path, &json)?;
    }

    let profile_path = root.join("empresa/perfil.json");
    if !profile_path.exists() {
        let profile = WorkspaceProfileFile {
            company_name: clean_name.clone(),
            agent_name: "Xox".to_string(),
            currency: "MXN".to_string(),
            stock_threshold_days: 7,
            max_budget_per_order: DEFAULT_WORKSPACE_BUDGET,
            preferred_suppliers: Vec::new(),
            business_rules: vec![
                "Nunca ejecutar compras, borrados ni cambios de reglas sin autorización visual HITL.".to_string(),
                "Basar cada revisión únicamente en archivos y registros reales de este espacio de trabajo.".to_string(),
            ],
        };
        let json = serde_json::to_string_pretty(&profile)
            .map_err(|e| format!("Error generando empresa/perfil.json: {e}"))?;
        write_string_atomic(&profile_path, &json)?;
    }

    let suppliers_path = root.join("empresa/proveedores.json");
    if !suppliers_path.exists() {
        write_string_atomic(&suppliers_path, "[]\n")?;
    }

    let rules_path = root.join("empresa/reglas/operacion.md");
    if !rules_path.exists() {
        let content = format!(
            "# Reglas de Operación — {clean_name}\n\n\
             Define aquí políticas de compras, topes de autorización, horarios o acuerdos con proveedores.\n\n\
             - Toda modificación propuesta por **Xox** sobre `empresa/` o `datos/` requerirá tu aprobación visual.\n"
        );
        write_string_atomic(&rules_path, &content)?;
    }

    let facts_path = root.join("memoria/hechos.md");
    if !facts_path.exists() {
        let content = format!(
            "# Memoria Viva — {clean_name}\n\n\
             Este archivo guarda hechos reales y acuerdos confirmados del negocio.\n"
        );
        write_string_atomic(&facts_path, &content)?;
    }

    let patterns_path = root.join("memoria/patrones.json");
    if !patterns_path.exists() {
        let patterns_json = serde_json::json!({
            "patterns": [],
            "updated_at": now,
        });
        write_string_atomic(
            &patterns_path,
            &serde_json::to_string_pretty(&patterns_json).unwrap_or_default(),
        )?;
    }

    let decisions_path = root.join("memoria/decisiones.jsonl");
    if !decisions_path.exists() {
        write_string_atomic(&decisions_path, "")?;
    }

    let agent_note_path = root.join("agente/notas-xox.md");
    if !agent_note_path.exists() {
        let content = format!(
            "# Espacio de Trabajo de Xox ({clean_name})\n\n\
             Aquí **Xox** organiza sus subcarpetas y entregables:\n\
             - `proyectos/`: análisis por tema o mes.\n\
             - `borradores/`: propuestas pendientes de tu aprobación HITL.\n\
             - `reportes/`: resúmenes y tablas exportadas.\n\
             - `revisiones/`: historial legible de revisiones reales.\n\
             - `ordenes/`: órdenes aprobadas.\n\
             - `logs/`: bitácoras de comandos ejecutados con permiso.\n"
        );
        write_string_atomic(&agent_note_path, &content)?;
    }

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

            return WorkspaceBusinessSummary {
                company_name,
                agent_name,
                currency,
                stock_threshold_days,
                max_budget_per_order,
            };
        }
    }

    WorkspaceBusinessSummary {
        company_name: fallback_name.to_string(),
        agent_name: "Xox".to_string(),
        currency: "MXN".to_string(),
        stock_threshold_days: 7,
        max_budget_per_order: DEFAULT_WORKSPACE_BUDGET,
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
            scaffold_workspace_dir(&root, &ws_id, &ws_name)?;
            registry.workspaces[pos].last_opened_at = now;
            let active = registry.workspaces[pos].clone();
            save_registry(app, &registry)?;
            return Ok((registry, active));
        }
    }

    if let Some(first) = registry.workspaces.first().cloned() {
        let root = PathBuf::from(&first.root_path);
        scaffold_workspace_dir(&root, &first.id, &first.name)?;
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
}

