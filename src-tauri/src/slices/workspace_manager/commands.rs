use super::registry::{
    WorkspaceBusinessSummary, WorkspaceEntry, WorkspacePatternItem, WorkspaceRegistry,
    create_workspace_entry, default_workspaces_base_dir, ensure_active_workspace, load_registry,
    read_business_summary, read_permissions_rule_count, read_workspace_patterns, save_registry,
    scaffold_workspace_dir,
};
use super::sandbox::{WorkspaceZone, resolve_inside_workspace, write_string_atomic};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

const MAX_READ_BYTES: u64 = 512 * 1024;
const MAX_TREE_ENTRIES: usize = 600;
const VISIBLE_ROOT_ZONES: [&str; 5] = ["empresa", "datos", "memoria", "habilidades", "agente"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNodeEntry {
    pub relative_path: String,
    pub parent_path: String,
    pub name: String,
    pub kind: String, // "dir" | "file"
    pub zone: String,
    pub write_policy: String, // "autonomous" | "hitl" | "system"
    pub depth: usize,
    pub size_bytes: u64,
    pub modified_at: String,
    pub editable: bool,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOverview {
    pub active: WorkspaceEntry,
    pub workspaces: Vec<WorkspaceEntry>,
    pub default_base_dir: String,
    pub entries: Vec<WorkspaceNodeEntry>,
    pub profile: WorkspaceBusinessSummary,
    pub patterns: Vec<WorkspacePatternItem>,
    pub permissions_rule_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub relative_path: String,
    pub name: String,
    pub zone: String,
    pub content: String,
    pub editable: bool,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspacePayload {
    pub name: String,
    pub custom_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRecordPayload {
    pub card_id: String,
    pub title: Option<String>,
    pub decision: String,
    pub adjusted_qty: Option<i32>,
    pub notes: Option<String>,
}

fn is_text_editable(ext: &str) -> bool {
    matches!(
        ext,
        "md" | "txt" | "json" | "jsonl" | "csv" | "yaml" | "yml" | "tsv" | "log"
    )
}

fn format_modified_time(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default()
}

fn collect_zone_entries(
    root: &Path,
    current_dir: &Path,
    depth: usize,
    out: &mut Vec<WorkspaceNodeEntry>,
) {
    if out.len() >= MAX_TREE_ENTRIES {
        return;
    }

    let Ok(read_dir) = fs::read_dir(current_dir) else {
        return;
    };

    let mut children: Vec<PathBuf> = read_dir
        .filter_map(|e| e.ok().map(|item| item.path()))
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            !name.starts_with('.') && !name.contains(".tmp.")
        })
        .collect();

    children.sort_by(|a, b| {
        let a_dir = a.is_dir();
        let b_dir = b.is_dir();
        match (a_dir, b_dir) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            _ => a
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .cmp(&b.file_name().map(|s| s.to_string_lossy().to_lowercase())),
        }
    });

    for path in children {
        if out.len() >= MAX_TREE_ENTRIES {
            break;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let parent_str = rel
            .parent()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let zone_enum = super::sandbox::zone_from_rel_path(rel);
        let zone = zone_enum.as_str().to_string();
        let write_policy = if zone_enum.is_protected_system() {
            "system".to_string()
        } else if zone_enum.is_agent_autonomous() {
            "autonomous".to_string()
        } else {
            "hitl".to_string()
        };
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let is_dir = meta.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
        };

        out.push(WorkspaceNodeEntry {
            relative_path: rel_str,
            parent_path: parent_str,
            name,
            kind: if is_dir { "dir".to_string() } else { "file".to_string() },
            zone,
            write_policy,
            depth,
            size_bytes: if is_dir { 0 } else { meta.len() },
            modified_at: format_modified_time(&meta),
            editable: !is_dir && is_text_editable(&ext),
            extension: ext,
        });

        if is_dir {
            collect_zone_entries(root, &path, depth + 1, out);
        }
    }
}

fn build_overview<R: Runtime>(
    app: &AppHandle<R>,
    registry: WorkspaceRegistry,
    active: WorkspaceEntry,
) -> WorkspaceOverview {
    let root = PathBuf::from(&active.root_path);
    let mut entries = Vec::new();

    for zone_dir in VISIBLE_ROOT_ZONES {
        let dir_path = root.join(zone_dir);
        if dir_path.is_dir() {
            let modified_at = fs::metadata(&dir_path)
                .map(|m| format_modified_time(&m))
                .unwrap_or_default();
            let zone_enum = super::sandbox::zone_from_rel_path(Path::new(zone_dir));
            entries.push(WorkspaceNodeEntry {
                relative_path: zone_dir.to_string(),
                parent_path: String::new(),
                name: zone_dir.to_string(),
                kind: "dir".to_string(),
                zone: zone_dir.to_string(),
                write_policy: if zone_enum.is_agent_autonomous() {
                    "autonomous".to_string()
                } else {
                    "hitl".to_string()
                },
                depth: 0,
                size_bytes: 0,
                modified_at,
                editable: false,
                extension: String::new(),
            });
            collect_zone_entries(&root, &dir_path, 1, &mut entries);
        }
    }

    let default_base_dir = default_workspaces_base_dir(app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    WorkspaceOverview {
        profile: read_business_summary(&root, &active.name),
        patterns: read_workspace_patterns(&root),
        permissions_rule_count: read_permissions_rule_count(&root),
        active,
        workspaces: registry.workspaces,
        default_base_dir,
        entries,
    }
}

#[tauri::command]
pub fn get_workspace_overview<R: Runtime>(app: AppHandle<R>) -> Result<WorkspaceOverview, String> {
    let (registry, active) = ensure_active_workspace(&app)?;
    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn create_workspace<R: Runtime>(
    app: AppHandle<R>,
    payload: CreateWorkspacePayload,
) -> Result<WorkspaceOverview, String> {
    let (registry, active) = create_workspace_entry(&app, payload.name, payload.custom_path)?;
    let root = PathBuf::from(&active.root_path);
    let _ = crate::slices::task_ledger::migrations::open_workspace_db(&root);
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "workspace_created",
        ".xook/workspace.json",
        ".xook",
        Some(&active.name),
    );
    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn switch_workspace<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
) -> Result<WorkspaceOverview, String> {
    let mut registry = load_registry(&app);
    let Some(pos) = registry.workspaces.iter().position(|w| w.id == workspace_id) else {
        return Err("No se encontró el espacio de trabajo solicitado.".to_string());
    };

    let root = PathBuf::from(&registry.workspaces[pos].root_path);
    let id = registry.workspaces[pos].id.clone();
    let name = registry.workspaces[pos].name.clone();
    scaffold_workspace_dir(&root, &id, &name)?;

    registry.workspaces[pos].last_opened_at = Utc::now().to_rfc3339();
    registry.active_workspace_id = Some(id);
    let active = registry.workspaces[pos].clone();
    save_registry(&app, &registry)?;

    let _ = crate::slices::task_ledger::migrations::open_workspace_db(&root);
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "workspace_switched",
        ".xook/workspace.json",
        ".xook",
        Some(&active.name),
    );

    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn rename_workspace<R: Runtime>(
    app: AppHandle<R>,
    workspace_id: String,
    new_name: String,
) -> Result<WorkspaceOverview, String> {
    let trimmed = new_name.trim().to_string();
    if trimmed.is_empty() {
        return Err("El nombre del espacio de trabajo no puede quedar vacío.".to_string());
    }

    let mut registry = load_registry(&app);
    let Some(pos) = registry.workspaces.iter().position(|w| w.id == workspace_id) else {
        return Err("No se encontró el espacio de trabajo.".to_string());
    };

    registry.workspaces[pos].name = trimmed.clone();
    let root = PathBuf::from(&registry.workspaces[pos].root_path);
    let active = registry.workspaces[pos].clone();
    save_registry(&app, &registry)?;

    let manifest_path = root.join(".xook/workspace.json");
    if let Ok(raw) = fs::read_to_string(&manifest_path) {
        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(obj) = val.as_object_mut() {
                obj.insert("name".to_string(), serde_json::Value::String(trimmed.clone()));
                obj.insert(
                    "updatedAt".to_string(),
                    serde_json::Value::String(Utc::now().to_rfc3339()),
                );
                let _ = write_string_atomic(
                    &manifest_path,
                    &serde_json::to_string_pretty(&val).unwrap_or_default(),
                );
            }
        }
    }

    let profile_path = root.join("empresa/perfil.json");
    if let Ok(raw) = fs::read_to_string(&profile_path) {
        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(obj) = val.as_object_mut() {
                obj.insert("company_name".to_string(), serde_json::Value::String(trimmed));
                let _ = write_string_atomic(
                    &profile_path,
                    &serde_json::to_string_pretty(&val).unwrap_or_default(),
                );
            }
        }
    }

    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn read_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<WorkspaceFileContent, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (target, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;

    if zone == WorkspaceZone::Meta {
        return Err("Los archivos internos del sistema no se abren desde el editor.".to_string());
    }
    if !target.is_file() {
        return Err("La ruta seleccionada no es un archivo legible.".to_string());
    }

    let meta = fs::metadata(&target).map_err(|e| format!("Error leyendo metadatos: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err("El archivo supera el límite de 512 KB para vista previa directa.".to_string());
    }

    let content = fs::read_to_string(&target)
        .map_err(|_| "Este archivo no es texto UTF-8 legible en vista previa.".to_string())?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    Ok(WorkspaceFileContent {
        relative_path: clean_rel.to_string_lossy().replace('\\', "/"),
        name,
        zone: zone.as_str().to_string(),
        content,
        editable: is_text_editable(&ext),
        size_bytes: meta.len(),
        modified_at: format_modified_time(&meta),
    })
}

#[tauri::command]
pub fn save_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
    content: String,
) -> Result<WorkspaceOverview, String> {
    let (registry, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (target, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;

    if zone.is_protected_system() {
        return Err("No está permitido escribir fuera de las zonas del espacio de trabajo.".to_string());
    }

    write_string_atomic(&target, &content)?;
    let rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "file_saved",
        &rel_str,
        zone.as_str(),
        Some(&format!("{} bytes", content.len())),
    );
    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn create_workspace_folder<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<WorkspaceOverview, String> {
    let (registry, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (target, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;

    if zone.is_protected_system() {
        return Err("Crea carpetas únicamente dentro de empresa, datos, memoria, habilidades o agente.".to_string());
    }

    fs::create_dir_all(&target)
        .map_err(|e| format!("No se pudo crear la carpeta solicitada: {e}"))?;
    let rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "folder_created",
        &rel_str,
        zone.as_str(),
        None,
    );
    Ok(build_overview(&app, registry, active))
}

#[tauri::command]
pub fn open_workspace_folder<R: Runtime>(
    app: AppHandle<R>,
    relative_path: Option<String>,
) -> Result<(), String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);

    let target = match relative_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(rel) => {
            let (resolved, _, _) = resolve_inside_workspace(&root, rel, true)?;
            if resolved.is_file() {
                resolved.parent().unwrap_or(&root).to_path_buf()
            } else {
                resolved
            }
        }
        None => root,
    };

    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|e| format!("No se pudo abrir la carpeta en el explorador del sistema: {e}"))
}

pub fn append_decision_jsonl(
    workspace_root: &Path,
    workspace_id: &str,
    card_id: &str,
    title: Option<&str>,
    decision: &str,
    adjusted_qty: Option<f64>,
    notes: Option<&str>,
) -> Result<(), String> {
    let memoria_dir = workspace_root.join("memoria");
    fs::create_dir_all(&memoria_dir)
        .map_err(|e| format!("No se pudo preparar la carpeta memoria/: {e}"))?;
    let decisions_path = memoria_dir.join("decisiones.jsonl");

    let entry = serde_json::json!({
        "timestamp": Utc::now().to_rfc3339(),
        "workspace_id": workspace_id,
        "card_id": card_id,
        "title": title,
        "decision": decision,
        "adjusted_qty": adjusted_qty,
        "notes": notes,
    });

    let line = format!(
        "{}\n",
        serde_json::to_string(&entry)
            .map_err(|e| format!("Error serializando decisión: {e}"))?
    );

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&decisions_path)
        .map_err(|e| format!("No se pudo abrir memoria/decisiones.jsonl: {e}"))?;
    file.write_all(line.as_bytes())
        .map_err(|e| format!("No se pudo registrar decisión en memoria: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn record_workspace_decision<R: Runtime>(
    app: AppHandle<R>,
    payload: DecisionRecordPayload,
) -> Result<String, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    append_decision_jsonl(
        &root,
        &active.id,
        &payload.card_id,
        payload.title.as_deref(),
        &payload.decision,
        payload.adjusted_qty.map(f64::from),
        payload.notes.as_deref(),
    )?;

    Ok(format!(
        "Decisión '{}' registrada en el espacio de trabajo '{}'.",
        payload.card_id, active.name
    ))
}
