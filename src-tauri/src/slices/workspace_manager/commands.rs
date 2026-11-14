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
use tauri::{AppHandle, Emitter, Manager, Runtime};

const MAX_READ_BYTES: u64 = 512 * 1024;
const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachmentResult {
    pub relative_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBinaryPreview {
    pub relative_path: String,
    pub name: String,
    pub kind: String, // "image" | "pdf" | "binary"
    pub mime_type: String,
    pub size_bytes: u64,
    pub data_url: Option<String>,
    pub pdf_summary: Option<serde_json::Value>,
    pub openable: bool,
}

fn guess_mime_from_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ppt" => "application/vnd.ms-powerpoint",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls" => "application/vnd.ms-excel",
        "rtf" => "application/rtf",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "json" => "application/json",
        "md" => "text/markdown",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn sanitize_attachment_filename(raw: &str) -> String {
    let base = raw
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.');
    if base.is_empty() {
        return "adjunto.bin".to_string();
    }

    let (stem_raw, ext_raw) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() && e.len() <= 12 => (s, e),
        _ => (base, ""),
    };

    let clean_stem: String = stem_raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else if c.is_whitespace() {
                '_'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .chars()
        .take(96)
        .collect();

    let clean_ext: String = ext_raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();

    let safe_stem = if clean_stem.is_empty() {
        "adjunto".to_string()
    } else {
        clean_stem
    };

    if clean_ext.is_empty() {
        safe_stem
    } else {
        format!("{safe_stem}.{clean_ext}")
    }
}

fn write_bytes_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo preparar la carpeta destino: {e}"))?;
    }
    let tmp_name = format!(
        ".{}.tmp.{}",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("xook_file"),
        std::process::id()
    );
    let tmp_path = target.with_file_name(tmp_name);
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp_path)
            .map_err(|e| format!("No se pudo crear archivo temporal: {e}"))?;
        f.write_all(bytes)
            .map_err(|e| format!("No se pudo escribir archivo: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("No se pudo sincronizar archivo: {e}"))?;
    }
    fs::rename(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("No se pudo mover archivo final: {e}")
    })
}

fn decode_base64_clean(input: &str) -> Result<Vec<u8>, String> {
    let trimmed = input.trim();
    let payload = if let Some(rest) = trimmed.strip_prefix("data:") {
        if let Some((_, b64)) = rest.split_once(";base64,") {
            b64
        } else {
            return Err("Encabezado data URL sin base64.".to_string());
        }
    } else {
        trimmed
    };

    let filtered: Vec<u8> = payload
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if filtered.is_empty() {
        return Ok(Vec::new());
    }
    if filtered.len() % 4 != 0 {
        return Err("Longitud base64 inválida.".to_string());
    }

    fn val(b: u8) -> Result<u8, String> {
        match b {
            b'A'..=b'Z' => Ok(b - b'A'),
            b'a'..=b'z' => Ok(b - b'a' + 26),
            b'0'..=b'9' => Ok(b - b'0' + 52),
            b'+' | b'-' => Ok(62),
            b'/' | b'_' => Ok(63),
            _ => Err(format!("Carácter base64 inválido: {}", b as char)),
        }
    }

    let mut out = Vec::with_capacity((filtered.len() / 4) * 3);
    for (idx, chunk) in filtered.chunks_exact(4).enumerate() {
        let is_last = (idx + 1) * 4 == filtered.len();
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        if chunk[2] == b'=' {
            if !is_last || chunk[3] != b'=' {
                return Err("Padding base64 inválido.".to_string());
            }
            out.push((a << 2) | (b >> 4));
            break;
        }
        let c = val(chunk[2])?;
        if chunk[3] == b'=' {
            if !is_last {
                return Err("Padding base64 inválido.".to_string());
            }
            out.push((a << 2) | (b >> 4));
            out.push((b << 4) | (c >> 2));
            break;
        }
        let d = val(chunk[3])?;
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
        out.push((c << 6) | d);
    }
    Ok(out)
}

fn encode_base64_std(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = *chunk.get(1).unwrap_or(&0) as usize;
        let b2 = *chunk.get(2).unwrap_or(&0) as usize;

        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[b2 & 0x3f] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[tauri::command]
pub fn stage_workspace_attachment<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    data_base64: String,
    sub_dir: Option<String>,
) -> Result<StagedAttachmentResult, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);

    let bytes = decode_base64_clean(&data_base64)?;
    if bytes.is_empty() {
        return Err("El archivo adjunto está vacío.".to_string());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "El archivo adjunto supera el límite permitido ({} MB).",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }

    let safe_name = sanitize_attachment_filename(&file_name);
    let folder_raw = sub_dir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("agente/adjuntos");
    let (_, clean_folder_rel, folder_zone) = resolve_inside_workspace(&root, folder_raw, false)?;
    if !matches!(folder_zone, WorkspaceZone::Agente) {
        return Err("Los adjuntos del chat solo pueden guardarse dentro de 'agente/'.".to_string());
    }
    let folder_str = clean_folder_rel.to_string_lossy().replace('\\', "/");

    let (stem, ext) = match safe_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (safe_name.clone(), String::new()),
    };

    let mut chosen_name = safe_name.clone();
    let mut final_rel = format!("{folder_str}/{chosen_name}");
    let (mut target_abs, _, _) = resolve_inside_workspace(&root, &final_rel, false)?;

    let mut reused_existing = false;
    if target_abs.exists() {
        if fs::read(&target_abs).map(|prev| prev == bytes).unwrap_or(false) {
            reused_existing = true;
        } else {
            let mut found = false;
            for idx in 2..=99 {
                let candidate_name = format!("{stem}_{idx}{ext}");
                let candidate_rel = format!("{folder_str}/{candidate_name}");
                let (cand_abs, _, _) = resolve_inside_workspace(&root, &candidate_rel, false)?;
                if !cand_abs.exists() {
                    chosen_name = candidate_name;
                    final_rel = candidate_rel;
                    target_abs = cand_abs;
                    found = true;
                    break;
                }
            }
            if !found {
                let stamp = Utc::now().format("%H%M%S").to_string();
                chosen_name = format!("{stem}_{stamp}{ext}");
                final_rel = format!("{folder_str}/{chosen_name}");
                let (cand_abs, _, _) = resolve_inside_workspace(&root, &final_rel, false)?;
                target_abs = cand_abs;
            }
        }
    }

    if !reused_existing {
        write_bytes_atomic(&target_abs, &bytes)?;
        let _ = app.emit(
            crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
            serde_json::json!({ "path": final_rel, "action": "stage_attachment" }),
        );
    }

    let ext_only = ext.trim_start_matches('.');
    Ok(StagedAttachmentResult {
        relative_path: final_rel,
        file_name: chosen_name,
        size_bytes: bytes.len() as u64,
        mime_type: guess_mime_from_ext(ext_only).to_string(),
    })
}

#[tauri::command]
pub fn open_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<(), String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, _, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No es posible abrir archivos internos del sistema.".to_string());
    }
    if !resolved.exists() {
        return Err(format!("No se encontró el archivo '{relative_path}'."));
    }

    tauri_plugin_opener::open_path(&resolved, None::<&str>)
        .map_err(|e| format!("No se pudo abrir el archivo en tu visor del sistema: {e}"))
}

#[tauri::command]
pub async fn read_workspace_binary_preview<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<WorkspaceBinaryPreview, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido leer rutas reservadas del sistema.".to_string());
    }
    if !resolved.is_file() {
        return Err(format!("Archivo no encontrado: {relative_path}"));
    }

    let meta = fs::metadata(&resolved)
        .map_err(|e| format!("No se pudieron leer metadatos del archivo: {e}"))?;
    let size_bytes = meta.len();
    let name = resolved
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "archivo".to_string());
    let ext = resolved
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let clean_rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    let mime_type = guess_mime_from_ext(&ext).to_string();

    if matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "svg"
    ) {
        let data_url = if size_bytes <= MAX_PREVIEW_IMAGE_BYTES {
            let raw_bytes = fs::read(&resolved)
                .map_err(|e| format!("No se pudo leer la imagen: {e}"))?;
            let encoded = encode_base64_std(&raw_bytes);
            Some(format!("data:{mime_type};base64,{encoded}"))
        } else {
            None
        };
        return Ok(WorkspaceBinaryPreview {
            relative_path: clean_rel_str,
            name,
            kind: "image".to_string(),
            mime_type,
            size_bytes,
            data_url,
            pdf_summary: None,
            openable: true,
        });
    }

    if ext == "pdf" {
        let app_clone = app.clone();
        let root_str = root.to_string_lossy().to_string();
        let rel_for_py = clean_rel_str.clone();
        let summary_opt = tauri::async_runtime::spawn_blocking(move || {
            let script = crate::ai_vault::find_sidecar_script(&app_clone).ok()?;
            crate::ai_vault::call_python_sidecar(
                &script,
                "inspect_pdf",
                serde_json::json!({
                    "workspace_root": root_str,
                    "path": rel_for_py,
                    "summary_only": true,
                }),
            )
            .ok()
        })
        .await
        .ok()
        .flatten();

        return Ok(WorkspaceBinaryPreview {
            relative_path: clean_rel_str,
            name,
            kind: "pdf".to_string(),
            mime_type,
            size_bytes,
            data_url: None,
            pdf_summary: summary_opt,
            openable: true,
        });
    }

    if matches!(
        ext.as_str(),
        "docx" | "doc" | "pptx" | "ppt" | "xlsx" | "xls" | "rtf" | "odt" | "ods" | "odp"
    ) {
        let app_clone = app.clone();
        let root_str = root.to_string_lossy().to_string();
        let rel_for_py = clean_rel_str.clone();
        let office_doc = tauri::async_runtime::spawn_blocking(move || {
            let script = crate::ai_vault::find_sidecar_script(&app_clone).ok()?;
            crate::ai_vault::call_python_sidecar(
                &script,
                "read_universal_document",
                serde_json::json!({
                    "workspace_root": root_str,
                    "path": rel_for_py,
                }),
            )
            .ok()
        })
        .await
        .ok()
        .flatten();

        return Ok(WorkspaceBinaryPreview {
            relative_path: clean_rel_str,
            name,
            kind: "office".to_string(),
            mime_type,
            size_bytes,
            data_url: None,
            pdf_summary: office_doc,
            openable: true,
        });
    }

    Ok(WorkspaceBinaryPreview {
        relative_path: clean_rel_str,
        name,
        kind: "binary".to_string(),
        mime_type,
        size_bytes,
        data_url: None,
        pdf_summary: None,
        openable: true,
    })
}

#[tauri::command]
pub async fn read_universal_document<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido leer rutas reservadas del sistema.".to_string());
    }
    if !resolved.is_file() {
        return Err(format!("Archivo no encontrado: {relative_path}"));
    }

    let script = crate::ai_vault::find_sidecar_script(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let clean_rel_str = clean_rel.to_string_lossy().replace('\\', "/");

    let res = tauri::async_runtime::spawn_blocking(move || {
        crate::ai_vault::call_python_sidecar(
            &script,
            "read_universal_document",
            serde_json::json!({
                "workspace_root": root_str,
                "path": clean_rel_str,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error interno al leer documento: {e}"))??;

    if res.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("No se pudo leer el documento.");
        return Err(msg.to_string());
    }

    Ok(res)
}

#[tauri::command]
pub async fn export_canvas_pdf<R: Runtime>(
    app: AppHandle<R>,
    spec: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let script = crate::ai_vault::find_sidecar_script(&app)?;

    let root_str = root.to_string_lossy().to_string();
    let res = tauri::async_runtime::spawn_blocking(move || {
        crate::ai_vault::call_python_sidecar(
            &script,
            "generate_pdf",
            serde_json::json!({
                "workspace_root": root_str,
                "spec": spec,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error interno al exportar PDF: {e}"))??;

    if res.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("No se pudo generar el PDF.");
        return Err(msg.to_string());
    }

    let rel_path = res
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("agente/reportes/")
        .to_string();
    let _ = app.emit(
        crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
        serde_json::json!({ "path": rel_path, "action": "create_pdf" }),
    );
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "pdf_exported",
        &rel_path,
        "agente",
        res.get("page_count")
            .and_then(|v| v.as_u64())
            .map(|p| format!("{p} página(s)"))
            .as_deref(),
    );

    Ok(res)
}

#[tauri::command]
pub async fn render_pdf_preview<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
    start_page: Option<u32>,
    max_pages: Option<u32>,
    scale: Option<f64>,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido leer rutas reservadas del sistema.".to_string());
    }
    if !resolved.is_file() {
        return Err(format!("Archivo PDF no encontrado: {relative_path}"));
    }
    let ext = resolved
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext != "pdf" {
        return Err(format!("El archivo no es un PDF válido: {relative_path}"));
    }

    let script = crate::ai_vault::find_sidecar_script(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let clean_rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    let s_page = start_page.unwrap_or(1).max(1);
    let m_pages = max_pages.unwrap_or(8).clamp(1, 24);
    let r_scale = scale.unwrap_or(1.65).clamp(0.75, 2.5);

    let res = tauri::async_runtime::spawn_blocking(move || {
        crate::ai_vault::call_python_sidecar(
            &script,
            "render_pdf_preview",
            serde_json::json!({
                "workspace_root": root_str,
                "path": clean_rel_str,
                "start_page": s_page,
                "max_pages": m_pages,
                "scale": r_scale,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error interno al renderizar vista previa del PDF: {e}"))??;

    if res.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("No se pudo renderizar la vista previa del PDF.");
        return Err(msg.to_string());
    }

    Ok(res)
}

#[tauri::command]
pub async fn load_pdf_editable_spec<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido leer rutas reservadas del sistema.".to_string());
    }
    if !resolved.is_file() {
        return Err(format!("Archivo PDF no encontrado: {relative_path}"));
    }

    let script = crate::ai_vault::find_sidecar_script(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let clean_rel_str = clean_rel.to_string_lossy().replace('\\', "/");

    let res = tauri::async_runtime::spawn_blocking(move || {
        crate::ai_vault::call_python_sidecar(
            &script,
            "load_pdf_editable_spec",
            serde_json::json!({
                "workspace_root": root_str,
                "path": clean_rel_str,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error interno al cargar estructura editable del PDF: {e}"))??;

    if res.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("No se pudo cargar la estructura editable del PDF.");
        return Err(msg.to_string());
    }

    Ok(res)
}

#[tauri::command]
pub async fn save_pdf_document<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (_resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido modificar rutas reservadas del sistema.".to_string());
    }

    let script = crate::ai_vault::find_sidecar_script(&app)?;
    let root_str = root.to_string_lossy().to_string();
    let clean_rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    let clean_rel_for_emit = clean_rel_str.clone();

    let res = tauri::async_runtime::spawn_blocking(move || {
        crate::ai_vault::call_python_sidecar(
            &script,
            "save_pdf_document",
            serde_json::json!({
                "workspace_root": root_str,
                "path": clean_rel_str,
                "payload": payload,
            }),
        )
    })
    .await
    .map_err(|e| format!("Error interno al guardar cambios en el PDF: {e}"))??;

    if res.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        let msg = res
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("No se pudieron guardar los cambios en el PDF.");
        return Err(msg.to_string());
    }

    let _ = app.emit(
        crate::slices::task_ledger::commands::WORKSPACE_UPDATED_EVENT,
        serde_json::json!({ "path": clean_rel_for_emit, "action": "update_pdf" }),
    );
    crate::slices::task_ledger::store::try_record_audit_event_for_root(
        &root,
        "user",
        "pdf_edited",
        &clean_rel_for_emit,
        zone.as_str(),
        res.get("page_count")
            .and_then(|v| v.as_u64())
            .map(|p| format!("{p} página(s)"))
            .as_deref(),
    );

    Ok(res)
}

#[tauri::command]
pub fn download_workspace_file<R: Runtime>(
    app: AppHandle<R>,
    relative_path: String,
    preferred_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let (_, active) = ensure_active_workspace(&app)?;
    let root = PathBuf::from(&active.root_path);
    let (resolved, clean_rel, zone) = resolve_inside_workspace(&root, &relative_path, false)?;
    if zone.is_protected_system() {
        return Err("No está permitido exportar rutas reservadas del sistema.".to_string());
    }
    if !resolved.is_file() {
        return Err(format!("Archivo no encontrado: {relative_path}"));
    }

    let downloads_dir = app
        .path()
        .download_dir()
        .ok()
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join("Downloads"))
        })
        .unwrap_or_else(|| root.clone());

    fs::create_dir_all(&downloads_dir)
        .map_err(|e| format!("No se pudo acceder a la carpeta de Descargas: {e}"))?;

    let raw_name = preferred_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            resolved
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "documento.pdf".to_string());

    let safe_name = sanitize_attachment_filename(&raw_name);
    let safe_path = Path::new(&safe_name);
    let stem = safe_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("documento");
    let ext = safe_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut dest_path = downloads_dir.join(&safe_name);
    let mut counter = 1u32;
    while dest_path.exists() && counter < 200 {
        let candidate = if ext.is_empty() {
            format!("{stem} ({counter})")
        } else {
            format!("{stem} ({counter}).{ext}")
        };
        dest_path = downloads_dir.join(candidate);
        counter += 1;
    }

    fs::copy(&resolved, &dest_path)
        .map_err(|e| format!("No se pudo copiar el archivo a Descargas: {e}"))?;

    let final_name = dest_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&safe_name)
        .to_string();
    let rel_str = clean_rel.to_string_lossy().replace('\\', "/");

    Ok(serde_json::json!({
        "ok": true,
        "path": rel_str,
        "filename": final_name,
        "downloadedPath": dest_path.to_string_lossy().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip_and_data_url() {
        let sample = b"XOOK PDF \x00\x01\xfe\xff Engine!";
        let encoded = encode_base64_std(sample);
        let decoded = decode_base64_clean(&encoded).expect("decode plain base64");
        assert_eq!(decoded, sample);

        let wrapped = format!("data:image/png;base64,{encoded}\n");
        let decoded_wrapped = decode_base64_clean(&wrapped).expect("decode data url");
        assert_eq!(decoded_wrapped, sample);
    }

    #[test]
    fn sanitize_attachment_name_prevents_traversal() {
        assert_eq!(
            sanitize_attachment_filename("../../Mi Reporte Final (v2).PDF"),
            "Mi_Reporte_Final__v2.pdf"
        );
        assert_eq!(sanitize_attachment_filename("..."), "adjunto.bin");
        assert_eq!(sanitize_attachment_filename("portada.PNG"), "portada.png");
    }
}
