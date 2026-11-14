use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceZone {
    Meta,
    Empresa,
    Datos,
    Memoria,
    Habilidades,
    Agente,
    Root,
}

impl WorkspaceZone {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkspaceZone::Meta => "meta",
            WorkspaceZone::Empresa => "empresa",
            WorkspaceZone::Datos => "datos",
            WorkspaceZone::Memoria => "memoria",
            WorkspaceZone::Habilidades => "habilidades",
            WorkspaceZone::Agente => "agente",
            WorkspaceZone::Root => "root",
        }
    }

    pub fn is_protected_system(&self) -> bool {
        matches!(self, WorkspaceZone::Meta | WorkspaceZone::Root)
    }

    pub fn is_agent_autonomous(&self) -> bool {
        matches!(self, WorkspaceZone::Memoria | WorkspaceZone::Agente)
    }

    pub fn is_hitl_protected(&self) -> bool {
        matches!(
            self,
            WorkspaceZone::Empresa | WorkspaceZone::Datos | WorkspaceZone::Habilidades
        )
    }
}

pub const PROTECTED_STRUCTURAL_DIRS: &[&str] = &[
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
    "agente/.papelera",
    "agente/.tmp_exports",
];

pub const PROTECTED_CORE_FILES: &[&str] = &[
    "empresa/perfil.json",
    "empresa/proveedores.json",
    "empresa/reglas/operacion.md",
    "memoria/hechos.md",
    "memoria/patrones.json",
    "memoria/decisiones.jsonl",
    "habilidades/perfil-usuario.md",
    "agente/notas-xox.md",
];

/// Indica si una ruta relativa dentro del workspace es estructural, interna, oculta o núcleo operativo
/// y por lo tanto NO debe eliminarse ni moverse fuera de su ubicación.
pub fn is_protected_workspace_rel_path(rel_path: &Path) -> Option<&'static str> {
    let mut parts: Vec<String> = Vec::new();
    for comp in rel_path.components() {
        if let Component::Normal(os_str) = comp {
            parts.push(os_str.to_string_lossy().to_ascii_lowercase());
        }
    }
    if parts.is_empty() {
        return Some("raíz del espacio de trabajo");
    }
    if parts[0] == ".xook" || parts[0].starts_with(".git") {
        return Some("carpeta interna protegida del sistema");
    }
    if parts.iter().any(|p| p.starts_with('.')) {
        return Some("archivo o carpeta oculta del sistema (dotfiles/papelera)");
    }
    if parts.iter().any(|p| p.contains(".tmp.")) {
        return Some("archivo temporal interno");
    }

    let joined = parts.join("/");
    if PROTECTED_STRUCTURAL_DIRS.contains(&joined.as_str()) {
        return Some("carpeta estructural obligatoria del espacio de trabajo");
    }
    if PROTECTED_CORE_FILES.contains(&joined.as_str()) {
        return Some("archivo núcleo de configuración, memoria o historial del negocio");
    }
    None
}

/// Igual que `is_protected_workspace_rel_path`, pero evaluando una ruta absoluta canonicalizada frente a `canonical_ws`.
#[allow(dead_code)]
pub fn is_protected_workspace_abs_path(canonical_target: &Path, canonical_ws: &Path) -> Option<&'static str> {
    if canonical_target == canonical_ws {
        return Some("raíz del espacio de trabajo");
    }
    let rel = canonical_target.strip_prefix(canonical_ws).ok()?;
    is_protected_workspace_rel_path(rel)
}

pub fn zone_from_rel_path(rel_path: &Path) -> WorkspaceZone {
    let Some(first) = rel_path.components().next() else {
        return WorkspaceZone::Root;
    };
    match first.as_os_str().to_str().unwrap_or("") {
        ".xook" => WorkspaceZone::Meta,
        "empresa" => WorkspaceZone::Empresa,
        "datos" => WorkspaceZone::Datos,
        "memoria" => WorkspaceZone::Memoria,
        "habilidades" => WorkspaceZone::Habilidades,
        "agente" => WorkspaceZone::Agente,
        _ => WorkspaceZone::Root,
    }
}

/// Normaliza una ruta relativa dentro del workspace rechazando escapes, rutas absolutas o bytes nulos.
pub fn normalize_rel_path(raw: &str, allow_root: bool) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err("La ruta contiene caracteres inválidos.".to_string());
    }
    let normalized_separators = raw.trim().replace('\\', "/");
    let trimmed = normalized_separators.trim_start_matches("./");

    if trimmed.is_empty() || trimmed == "." {
        if allow_root {
            return Ok(PathBuf::new());
        }
        return Err("Debes indicar una ruta válida dentro del espacio de trabajo.".to_string());
    }

    let candidate = Path::new(trimmed);
    let mut clean = PathBuf::new();

    for comp in candidate.components() {
        match comp {
            Component::Normal(part) => {
                let s = part.to_string_lossy();
                if s.starts_with(".xook") {
                    return Err("La carpeta interna del sistema está protegida.".to_string());
                }
                clean.push(part);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Acceso denegado: no se permite salir del espacio de trabajo (..).".to_string());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Acceso denegado: usa únicamente rutas relativas al espacio de trabajo.".to_string());
            }
        }
    }

    if clean.as_os_str().is_empty() && !allow_root {
        return Err("La ruta no puede quedar vacía.".to_string());
    }

    Ok(clean)
}

/// Verifica que un path existente o su ancestro más cercano canonicalicen dentro del root del workspace.
pub fn resolve_inside_workspace(root: &Path, raw_rel: &str, allow_root: bool) -> Result<(PathBuf, PathBuf, WorkspaceZone), String> {
    let rel = normalize_rel_path(raw_rel, allow_root)?;
    let canonical_root = fs::canonicalize(root)
        .map_err(|e| format!("No se pudo verificar la raíz del workspace: {e}"))?;

    let target = if rel.as_os_str().is_empty() {
        canonical_root.clone()
    } else {
        root.join(&rel)
    };

    if target.exists() {
        let canonical_target = fs::canonicalize(&target)
            .map_err(|e| format!("No se pudo resolver la ruta en el workspace: {e}"))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err("Acceso denegado: la ruta apunta fuera del espacio de trabajo.".to_string());
        }
        let zone = zone_from_rel_path(&rel);
        return Ok((canonical_target, rel, zone));
    }

    // Para archivos o carpetas por crear, verificar el ancestro existente más cercano contra symlink escapes.
    let mut ancestor = target.parent();
    while let Some(curr) = ancestor {
        if curr.exists() {
            let canonical_ancestor = fs::canonicalize(curr)
                .map_err(|e| format!("No se pudo validar el directorio padre: {e}"))?;
            if !canonical_ancestor.starts_with(&canonical_root) {
                return Err("Acceso denegado: el directorio destino sale del espacio de trabajo.".to_string());
            }
            let tail = target
                .strip_prefix(curr)
                .map_err(|_| "No se pudo construir la ruta relativa segura.".to_string())?;
            let zone = zone_from_rel_path(&rel);
            return Ok((canonical_ancestor.join(tail), rel, zone));
        }
        ancestor = curr.parent();
    }

    Err("No se encontró una carpeta base válida dentro del workspace.".to_string())
}

pub fn write_string_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "La ruta de destino no tiene directorio padre.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("No se pudo crear la carpeta destino: {e}"))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_name = format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    let tmp_path = parent.join(tmp_name);

    fs::write(&tmp_path, content).map_err(|e| format!("Error escribiendo archivo temporal: {e}"))?;
    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Error guardando archivo en disco: {err}"));
    }
    Ok(())
}

pub fn slugify_workspace_name(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;

    for ch in name.trim().chars() {
        let normalized = match ch {
            'á' | 'à' | 'ä' | 'â' | 'Á' | 'À' | 'Ä' | 'Â' => Some('a'),
            'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => Some('e'),
            'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => Some('i'),
            'ó' | 'ò' | 'ö' | 'ô' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => Some('o'),
            'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => Some('u'),
            'ñ' | 'Ñ' => Some('n'),
            c if c.is_ascii_alphanumeric() => Some(c.to_ascii_lowercase()),
            _ => None,
        };

        if let Some(c) = normalized {
            slug.push(c);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "xox".to_string()
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        assert!(normalize_rel_path("../secret.txt", false).is_err());
        assert!(normalize_rel_path("empresa/../../etc/passwd", false).is_err());
        assert!(normalize_rel_path("/etc/passwd", false).is_err());
        assert!(normalize_rel_path(".xook/workspace.json", false).is_err());
        assert!(normalize_rel_path("", false).is_err());
        assert!(normalize_rel_path(".", true).is_ok());
    }

    #[test]
    fn resolves_valid_paths_inside_temp_workspace() {
        let base = std::env::temp_dir().join(format!("xook_sbx_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(1)));
        fs::create_dir_all(base.join("agente")).expect("create test workspace");

        let (resolved, rel, zone) =
            resolve_inside_workspace(&base, "agente/proyectos/q4/notas.md", false)
                .expect("should allow nested agent path");
        assert_eq!(rel, PathBuf::from("agente/proyectos/q4/notas.md"));
        assert_eq!(zone, WorkspaceZone::Agente);
        assert!(resolved.ends_with("agente/proyectos/q4/notas.md"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn slugify_handles_accents_and_symbols() {
        assert_eq!(slugify_workspace_name("Café & Té S.A."), "cafe-te-s-a");
        assert_eq!(slugify_workspace_name("Xox"), "xox");
        assert_eq!(slugify_workspace_name("   "), "xox");
    }

    #[test]
    fn protected_paths_block_core_structure_but_allow_custom_files() {
        for protected in [
            "",
            ".xook/xook.db",
            "empresa",
            "empresa/perfil.json",
            "empresa/proveedores.json",
            "empresa/reglas",
            "empresa/reglas/operacion.md",
            "datos/ventas",
            "datos/documentos",
            "memoria/diario",
            "memoria/hechos.md",
            "memoria/patrones.json",
            "memoria/decisiones.jsonl",
            "agente/adjuntos",
            "agente/ordenes",
            "agente/notas-xox.md",
            "agente/.DS_Store",
            "agente/.papelera/viejo.txt",
        ] {
            assert!(
                is_protected_workspace_rel_path(Path::new(protected)).is_some(),
                "expected protected path: {protected}"
            );
        }

        for allowed in [
            "empresa/roles.md",
            "empresa/reglas/politica_cajeros.md",
            "datos/inventario.csv",
            "datos/ventas/enero.csv",
            "agente/adjuntos/tarea.pdf",
            "agente/reportes/reporte_q1.pdf",
            "agente/proyectos/demo.md",
            "habilidades/mi_skill.md",
        ] {
            assert!(
                is_protected_workspace_rel_path(Path::new(allowed)).is_none(),
                "expected custom path to be deletable/editable: {allowed}"
            );
        }
    }
}

