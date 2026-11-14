use super::guard::{canonicalize_with_ancestor, is_forbidden_secret_path};
use crate::slices::workspace_manager::sandbox::write_string_atomic;
use chrono::{DateTime, Utc};
use serde_json::json;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_LIST_ENTRIES: usize = 160;
const MAX_SEARCH_MATCHES_DEFAULT: usize = 40;
const MAX_WALK_FILES: usize = 2500;
const MAX_WALK_DEPTH: usize = 8;
const MAX_SEARCH_TEXT_BYTES: u64 = 512 * 1024;

fn should_skip_dir_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        ".git"
            | "node_modules"
            | "__pycache__"
            | ".venv"
            | "venv"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".cache"
            | ".trash"
            | "library"
    )
}

fn format_modified(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default()
}

pub fn list_host_directory(
    dir_abs: &Path,
    filter: Option<&str>,
    max_entries: Option<usize>,
    app_config_dir: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Result<serde_json::Value, String> {
    if dir_abs.is_file() {
        let meta = fs::metadata(dir_abs).map_err(|e| format!("Error leyendo archivo: {e}"))?;
        let name = dir_abs
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        return Ok(json!({
            "ok": true,
            "path": dir_abs.to_string_lossy().to_string(),
            "entries": [{
                "path": dir_abs.to_string_lossy().to_string(),
                "name": name,
                "kind": "file",
                "size_bytes": meta.len(),
                "modified_at": format_modified(&meta),
            }],
            "truncated": false,
        }));
    }
    if !dir_abs.is_dir() {
        return Err(format!("La ruta '{}' no existe o no es una carpeta.", dir_abs.display()));
    }

    let read_dir = fs::read_dir(dir_abs)
        .map_err(|e| format!("No se pudo leer la carpeta '{}': {e}", dir_abs.display()))?;
    let filter_low = filter
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());
    let cap = max_entries.unwrap_or(MAX_LIST_ENTRIES).clamp(1, 300);

    let mut items: Vec<(bool, String, PathBuf, fs::Metadata)> = Vec::new();
    for entry in read_dir.flatten() {
        let p = entry.path();
        let Some(name) = p.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if let Some(ref f) = filter_low {
            if !name.to_ascii_lowercase().contains(f) {
                continue;
            }
        }
        let Ok(sym_meta) = fs::symlink_metadata(&p) else {
            continue;
        };
        let canon = if sym_meta.file_type().is_symlink() {
            let Ok(c) = fs::canonicalize(&p) else {
                continue;
            };
            c
        } else {
            p.clone()
        };
        if is_forbidden_secret_path(&canon, app_config_dir, workspace_root).is_some() {
            continue;
        }
        let Ok(meta) = fs::metadata(&canon) else {
            continue;
        };
        items.push((meta.is_dir(), name, p, meta));
    }

    items.sort_by(|a, b| match (a.0, b.0) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.1.to_ascii_lowercase().cmp(&b.1.to_ascii_lowercase()),
    });

    let truncated = items.len() > cap;
    let entries: Vec<serde_json::Value> = items
        .into_iter()
        .take(cap)
        .map(|(is_dir, name, p, meta)| {
            let mut obj = json!({
                "path": p.to_string_lossy().to_string(),
                "name": name,
                "kind": if is_dir { "dir" } else { "file" },
                "modified_at": format_modified(&meta),
            });
            if !is_dir {
                obj["size_bytes"] = json!(meta.len());
            }
            obj
        })
        .collect();

    Ok(json!({
        "ok": true,
        "path": dir_abs.to_string_lossy().to_string(),
        "entries": entries,
        "truncated": truncated,
    }))
}

#[cfg(target_os = "macos")]
fn spotlight_filename_search(
    base_abs: &Path,
    query: &str,
    limit: usize,
    app_config_dir: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Vec<PathBuf> {
    let escaped = query.replace('\\', "\\\\").replace('\'', "\\'");
    let predicate = format!("kMDItemFSName == '*{escaped}*'cd");
    let Ok(output) = Command::new("/usr/bin/mdfind")
        .arg("-onlyin")
        .arg(base_abs)
        .arg(&predicate)
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut hits = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(trimmed);
        let Ok(canon) = fs::canonicalize(&candidate) else {
            continue;
        };
        if !canon.starts_with(base_abs) {
            continue;
        }
        if canon.components().any(|c| {
            c.as_os_str()
                .to_str()
                .map(should_skip_dir_name)
                .unwrap_or(false)
        }) {
            continue;
        }
        if is_forbidden_secret_path(&canon, app_config_dir, workspace_root).is_some() {
            continue;
        }
        hits.push(canon);
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

#[cfg(not(target_os = "macos"))]
fn spotlight_filename_search(
    _base_abs: &Path,
    _query: &str,
    _limit: usize,
    _app_config_dir: Option<&Path>,
    _workspace_root: Option<&Path>,
) -> Vec<PathBuf> {
    Vec::new()
}

pub fn search_host_files(
    base_abs: &Path,
    query: &str,
    mode: &str,
    max_results: Option<usize>,
    app_config_dir: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Result<serde_json::Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Falta el texto 'query' para buscar.".to_string());
    }
    if !base_abs.exists() {
        return Err(format!("La ruta '{}' no existe.", base_abs.display()));
    }

    let q_low = q.to_ascii_lowercase();
    let cap = max_results.unwrap_or(MAX_SEARCH_MATCHES_DEFAULT).clamp(1, 100);
    let mode_low = mode.trim().to_ascii_lowercase();
    let search_names = mode_low != "content";
    let search_content = mode_low != "name";

    let mut matches: Vec<serde_json::Value> = Vec::new();
    let mut seen_name_paths: HashSet<PathBuf> = HashSet::new();

    if search_names && base_abs.is_dir() {
        for hit in spotlight_filename_search(base_abs, q, cap, app_config_dir, workspace_root) {
            seen_name_paths.insert(hit.clone());
            matches.push(json!({
                "path": hit.to_string_lossy().to_string(),
                "kind": if hit.is_dir() { "dir" } else { "file" },
                "match_type": "filename",
            }));
        }
    }

    let mut visited_files: usize = 0;
    let mut truncated = matches.len() >= cap;

    let mut stack: Vec<(PathBuf, usize)> = vec![(base_abs.to_path_buf(), 0)];
    while let Some((curr, depth)) = stack.pop() {
        if matches.len() >= cap || visited_files >= MAX_WALK_FILES {
            truncated = true;
            break;
        }

        if curr.is_file() {
            visited_files += 1;
            if is_forbidden_secret_path(&curr, app_config_dir, workspace_root).is_some() {
                continue;
            }
            if search_names {
                if let Some(name) = curr.file_name().and_then(|n| n.to_str()) {
                    if name.to_ascii_lowercase().contains(&q_low) && seen_name_paths.insert(curr.clone()) {
                        matches.push(json!({
                            "path": curr.to_string_lossy().to_string(),
                            "kind": "file",
                            "match_type": "filename",
                        }));
                        if matches.len() >= cap {
                            truncated = true;
                            break;
                        }
                    }
                }
            }
            if search_content {
                let Ok(meta) = fs::metadata(&curr) else {
                    continue;
                };
                if meta.len() > MAX_SEARCH_TEXT_BYTES {
                    continue;
                }
                let Ok(bytes) = fs::read(&curr) else {
                    continue;
                };
                // Ignorar binarios con bytes NUL
                if bytes.iter().take(1024).any(|&b| b == 0) {
                    continue;
                }
                let text = String::from_utf8_lossy(&bytes);
                for (idx, line) in text.lines().enumerate() {
                    if line.to_ascii_lowercase().contains(&q_low) {
                        let snippet: String = line.trim().chars().take(220).collect();
                        matches.push(json!({
                            "path": curr.to_string_lossy().to_string(),
                            "kind": "file",
                            "match_type": "content",
                            "line": idx + 1,
                            "snippet": snippet,
                        }));
                        if matches.len() >= cap {
                            truncated = true;
                            break;
                        }
                    }
                }
            }
            continue;
        }

        if !curr.is_dir() || depth >= MAX_WALK_DEPTH {
            continue;
        }

        let Ok(rd) = fs::read_dir(&curr) else {
            continue;
        };
        let mut children: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        children.sort();

        for child in children.into_iter().rev() {
            let Ok(sym) = fs::symlink_metadata(&child) else {
                continue;
            };
            if sym.file_type().is_symlink() {
                continue;
            }
            let Some(name) = child.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if is_forbidden_secret_path(&child, app_config_dir, workspace_root).is_some() {
                continue;
            }
            if sym.is_dir() {
                if should_skip_dir_name(name) {
                    continue;
                }
                if search_names
                    && name.to_ascii_lowercase().contains(&q_low)
                    && seen_name_paths.insert(child.clone())
                {
                    matches.push(json!({
                        "path": child.to_string_lossy().to_string(),
                        "kind": "dir",
                        "match_type": "filename",
                    }));
                    if matches.len() >= cap {
                        truncated = true;
                        break;
                    }
                }
                stack.push((child, depth + 1));
            } else {
                stack.push((child, depth + 1));
            }
        }
    }

    Ok(json!({
        "ok": true,
        "base_path": base_abs.to_string_lossy().to_string(),
        "query": q,
        "truncated": truncated,
        "matches": matches,
    }))
}

pub fn prepare_host_edit(
    abs_path: &Path,
    old_text: &str,
    new_text: &str,
    replace_all: bool,
) -> Result<(String, String), String> {
    if old_text.is_empty() {
        return Err("Falta 'old_text' con el fragmento exacto a reemplazar.".to_string());
    }
    if !abs_path.is_file() {
        return Err(format!("Archivo no encontrado para editar: {}", abs_path.display()));
    }
    let current = fs::read_to_string(abs_path)
        .map_err(|e| format!("El archivo no es texto UTF-8 editable: {e}"))?;
    let count = current.matches(old_text).count();
    if count == 0 {
        return Err("No se encontró el fragmento 'old_text' dentro del archivo.".to_string());
    }
    if count > 1 && !replace_all {
        return Err(format!(
            "El fragmento 'old_text' aparece {count} veces. Agrega más contexto o usa replace_all=true."
        ));
    }
    let updated = if replace_all {
        current.replace(old_text, new_text)
    } else {
        current.replacen(old_text, new_text, 1)
    };

    let old_snip: String = old_text.trim().chars().take(120).collect();
    let new_snip: String = new_text.trim().chars().take(120).collect();
    let preview = format!(
        "Archivo: {}\nReemplazos: {}\n- Antes: {}\n+ Después: {}",
        abs_path.display(),
        if replace_all { count } else { 1 },
        old_snip.replace('\n', " "),
        new_snip.replace('\n', " ")
    );
    Ok((updated, preview))
}

pub fn write_host_file_atomic(abs_path: &Path, content: &str) -> Result<serde_json::Value, String> {
    let (canon, _) = canonicalize_with_ancestor(abs_path)?;
    write_string_atomic(&canon, content)?;
    Ok(json!({
        "ok": true,
        "path": canon.to_string_lossy().to_string(),
        "bytes_written": content.len(),
    }))
}

pub fn mkdir_host_dir(abs_path: &Path) -> Result<serde_json::Value, String> {
    let (canon, _) = canonicalize_with_ancestor(abs_path)?;
    fs::create_dir_all(&canon)
        .map_err(|e| format!("No se pudo crear la carpeta '{}': {e}", canon.display()))?;
    Ok(json!({
        "ok": true,
        "created_dir": canon.to_string_lossy().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn list_and_search_skip_secrets_and_edit_prepares_clean_patch() {
        let root = std::env::temp_dir().join(format!(
            "xook_host_act_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(root.join(".ssh")).unwrap();
        fs::create_dir_all(root.join("proyectos")).unwrap();
        fs::write(root.join(".ssh/id_rsa"), "PRIVATE KEY").unwrap();
        fs::write(root.join(".env"), "API_KEY=secret").unwrap();
        let note = root.join("proyectos/notas.md");
        fs::write(&note, "Hola mundo\nLinea clave de prueba\n").unwrap();

        let ls_res = list_host_directory(&root, None, None, None, None).unwrap();
        let names: Vec<&str> = ls_res["entries"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|e| e["name"].as_str())
            .collect();
        assert!(names.contains(&"proyectos"));
        assert!(!names.contains(&".ssh"));
        assert!(!names.contains(&".env"));

        let search_res = search_host_files(&root, "Linea clave", "auto", None, None, None).unwrap();
        let matches = search_res["matches"].as_array().unwrap();
        assert!(!matches.is_empty());
        assert!(matches.iter().any(|m| m["path"].as_str().unwrap().ends_with("notas.md")));

        let (updated, preview) =
            prepare_host_edit(&note, "Linea clave de prueba", "Linea actualizada", false).unwrap();
        assert!(updated.contains("Linea actualizada"));
        assert!(preview.contains("notas.md"));

        let _ = fs::remove_dir_all(&root);
    }
}
