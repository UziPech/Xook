use crate::slices::command_runner::policy::{PolicyVerdict, load_permissions};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostFsOperation {
    List,
    Read,
    Search,
    Write,
    Edit,
    Mkdir,
}

impl HostFsOperation {
    pub fn is_write(&self) -> bool {
        matches!(self, Self::Write | Self::Edit | Self::Mkdir)
    }

    pub fn scope_kind(&self) -> &'static str {
        if self.is_write() {
            "ext_write"
        } else {
            "ext_read"
        }
    }

    pub fn risk_level(&self) -> &'static str {
        match self {
            Self::List | Self::Read | Self::Search => "low",
            Self::Write | Self::Edit | Self::Mkdir => "medium",
        }
    }
}

#[derive(Debug, Clone)]
pub struct HostFsEvaluation {
    pub verdict: PolicyVerdict,
    pub canonical_path: PathBuf,
    pub inside_workspace: bool,
    pub scope_dir: PathBuf,
    pub scope_kind: String,
    pub allow_always_allowed: bool,
    pub risk_level: String,
    pub matched_rule: Option<String>,
}

pub fn resolve_user_home() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .and_then(|p| fs::canonicalize(&p).ok().or(Some(p)))
}

pub fn is_explicit_host_path(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == "~"
        || trimmed.starts_with("~/")
        || trimmed.starts_with("~\\")
        || trimmed.starts_with("$HOME")
        || trimmed.starts_with("${HOME}")
        || trimmed.to_ascii_uppercase().starts_with("%USERPROFILE%")
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
    {
        return true;
    }
    let bytes = trimmed.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

pub fn expand_raw_host_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("La ruta no puede estar vacía.".to_string());
    }
    if trimmed.contains('\0') {
        return Err("La ruta contiene caracteres inválidos.".to_string());
    }

    let expanded = if trimmed == "~" {
        resolve_user_home().ok_or_else(|| "No se pudo resolver la carpeta HOME del usuario.".to_string())?
    } else if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        let home = resolve_user_home()
            .ok_or_else(|| "No se pudo resolver la carpeta HOME del usuario.".to_string())?;
        home.join(rest)
    } else if trimmed == "$HOME" || trimmed == "${HOME}" {
        resolve_user_home().ok_or_else(|| "No se pudo resolver $HOME.".to_string())?
    } else if let Some(rest) = trimmed
        .strip_prefix("$HOME/")
        .or_else(|| trimmed.strip_prefix("$HOME\\"))
        .or_else(|| trimmed.strip_prefix("${HOME}/"))
        .or_else(|| trimmed.strip_prefix("${HOME}\\"))
    {
        let home = resolve_user_home().ok_or_else(|| "No se pudo resolver $HOME.".to_string())?;
        home.join(rest)
    } else if trimmed.len() >= 13 && trimmed[..13].eq_ignore_ascii_case("%USERPROFILE%") {
        let home = resolve_user_home().ok_or_else(|| "No se pudo resolver %USERPROFILE%.".to_string())?;
        let rest = trimmed[13..].trim_start_matches(['/', '\\']);
        if rest.is_empty() { home } else { home.join(rest) }
    } else {
        PathBuf::from(trimmed)
    };

    if !expanded.is_absolute() {
        return Err("La ruta externa debe ser absoluta o iniciar con '~/'.".to_string());
    }

    Ok(expanded)
}

/// Resuelve symlinks hasta el ancestro existente más cercano, rechazando componentes `..` en el tramo pendiente.
pub fn canonicalize_with_ancestor(target: &Path) -> Result<(PathBuf, bool), String> {
    if target.exists() {
        let canon = fs::canonicalize(target)
            .map_err(|e| format!("No se pudo resolver la ruta '{}': {e}", target.display()))?;
        return Ok((canon, true));
    }

    let mut pending_parts: Vec<std::ffi::OsString> = Vec::new();
    let mut cursor = target.to_path_buf();
    loop {
        if cursor.exists() {
            let canon_ancestor = fs::canonicalize(&cursor)
                .map_err(|e| format!("No se pudo verificar el directorio padre: {e}"))?;
            let mut full = canon_ancestor;
            for part in pending_parts.iter().rev() {
                full.push(part);
            }
            return Ok((full, false));
        }

        let Some(name) = cursor.file_name().map(|s| s.to_os_string()) else {
            return Err("No se encontró un directorio base válido para la ruta.".to_string());
        };
        let name_str = name.to_string_lossy();
        if name_str == ".." {
            return Err("Acceso denegado: no se permite navegación '..' sobre rutas no existentes.".to_string());
        }
        if name_str != "." {
            pending_parts.push(name);
        }

        let Some(parent) = cursor.parent() else {
            return Err("No se encontró una raíz válida para la ruta.".to_string());
        };
        cursor = parent.to_path_buf();
    }
}

fn is_safe_env_template(file_name_lower: &str) -> bool {
    matches!(
        file_name_lower,
        ".env.example" | ".env.sample" | ".env.template" | ".env.dist"
    )
}

/// Capa 1 inmutable: bloquea credenciales, llaves privadas, bóveda XOOK, sesiones de navegador y rutas críticas del sistema.
/// Ninguna regla `allow` o aprobación de `$HOME` puede anular esta lista negra.
pub fn is_forbidden_secret_path(
    canonical_path: &Path,
    app_config_dir: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Option<&'static str> {
    if let Some(cfg_dir) = app_config_dir {
        let canon_cfg = fs::canonicalize(cfg_dir).unwrap_or_else(|_| cfg_dir.to_path_buf());
        if canonical_path == canon_cfg || canonical_path.starts_with(&canon_cfg) {
            return Some("configuración interna y bóveda de XOOK");
        }
    }

    if let Some(ws_root) = workspace_root {
        let canon_ws = fs::canonicalize(ws_root).unwrap_or_else(|_| ws_root.to_path_buf());
        let xook_dir = canon_ws.join(".xook");
        if canonical_path == xook_dir || canonical_path.starts_with(&xook_dir) {
            return Some("carpeta interna protegida .xook");
        }
    }

    let mut lower_parts: Vec<String> = Vec::new();
    for comp in canonical_path.components() {
        if let Component::Normal(os_str) = comp {
            lower_parts.push(os_str.to_string_lossy().to_ascii_lowercase());
        }
    }

    for part in &lower_parts {
        if matches!(
            part.as_str(),
            ".xook"
                | ".ssh"
                | ".gnupg"
                | ".gpg"
                | ".aws"
                | ".azure"
                | ".kube"
                | ".docker"
                | ".npmrc"
                | ".pypirc"
                | ".netrc"
                | ".git-credentials"
                | ".zsh_history"
                | ".bash_history"
                | ".sh_history"
                | ".python_history"
                | ".node_repl_history"
                | ".lesshst"
                | ".sqlite_history"
                | "authorized_keys"
                | "known_hosts"
                | "id_rsa"
                | "id_ed25519"
                | "id_ecdsa"
                | "id_dsa"
                | "ai-vault.json"
                | "workspaces.json"
                | "permissions.json"
                | "xook.db"
                | "credentials.json"
                | "secrets.json"
                | "secrets.yaml"
                | "secrets.yml"
                | "token.json"
                | "cookies.sqlite"
                | "login data"
                | "web data"
                | "local state"
        ) {
            return Some("credenciales, llaves o configuración sensible");
        }

        if (part == ".env" || part.starts_with(".env.")) && !is_safe_env_template(part) {
            return Some("archivo de variables de entorno (.env)");
        }

        if part.ends_with(".pem")
            || part.ends_with(".key")
            || part.ends_with(".p12")
            || part.ends_with(".pfx")
            || part.ends_with(".jks")
            || part.ends_with(".keystore")
            || part.ends_with(".kdbx")
            || part.ends_with(".1pif")
            || part.starts_with("service-account") && part.ends_with(".json")
        {
            return Some("llave privada o almacén de contraseñas");
        }
    }

    let norm_lower = canonical_path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();

    for protected_subpath in [
        "/.config/gcloud",
        "/.config/gh",
        "/.config/google-chrome",
        "/.config/chromium",
        "/.mozilla/firefox",
        "/.local/share/keyrings",
        "/.local/share/kwalletd",
        "/library/keychains",
        "/library/cookies",
        "/library/safari",
        "/library/messages",
        "/library/mail",
        "/library/accounts",
        "/library/calendars",
        "/library/application support/google/chrome",
        "/library/application support/bravesoftware",
        "/library/application support/firefox",
        "/library/application support/microsoft edge",
        "/library/application support/1password",
        "/library/application support/bitwarden",
        "/library/application support/xook",
        "/library/application support/com.xook.app",
        "/appdata/local/google/chrome/user data",
        "/appdata/roaming/mozilla/firefox",
        "/appdata/local/microsoft/edge/user data",
        "/appdata/local/1password",
        "/windows/system32/config",
        "/etc/shadow",
        "/etc/sudoers",
        "/etc/master.passwd",
        "/etc/passwd",
        "/private/etc/shadow",
        "/private/etc/sudoers",
        "/private/etc/master.passwd",
        "/private/etc/passwd",
    ] {
        if norm_lower.contains(protected_subpath) {
            return Some("almacén privado del sistema o navegador");
        }
    }

    if norm_lower == "/system"
        || norm_lower.starts_with("/system/")
        || norm_lower == "/proc"
        || norm_lower.starts_with("/proc/")
        || norm_lower == "/dev"
        || norm_lower.starts_with("/dev/")
    {
        return Some("ruta crítica del sistema operativo");
    }

    None
}

pub fn is_broad_or_sensitive_root(dir: &Path) -> bool {
    if dir.parent().is_none() {
        return true; // `/` o `C:\`
    }
    if let Some(home) = resolve_user_home() {
        if dir == home {
            return true;
        }
    }
    let norm = dir.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
    let trimmed = norm.trim_end_matches('/');
    matches!(
        trimmed,
        "/users"
            | "/home"
            | "/etc"
            | "/private/etc"
            | "/usr"
            | "/bin"
            | "/sbin"
            | "/var"
            | "/library"
            | "/applications"
            | "c:/users"
            | "c:/windows"
            | "c:/program files"
            | "c:/program files (x86)"
    ) || trimmed.starts_with("/etc/")
        || trimmed.starts_with("/private/etc/")
        || trimmed.starts_with("c:/windows/")
}

fn rule_matches_host_path(rule_pattern: &str, canonical_target: &Path) -> bool {
    let Ok(expanded) = expand_raw_host_path(rule_pattern) else {
        return false;
    };
    let rule_path = fs::canonicalize(&expanded).unwrap_or(expanded);
    canonical_target == rule_path || canonical_target.starts_with(&rule_path)
}

pub fn evaluate_host_fs_access(
    workspace_root: &Path,
    app_config_dir: Option<&Path>,
    raw_path: &str,
    op: HostFsOperation,
) -> Result<HostFsEvaluation, String> {
    let expanded = expand_raw_host_path(raw_path)?;
    let (canonical_path, existed) = canonicalize_with_ancestor(&expanded)?;
    let canonical_ws = fs::canonicalize(workspace_root).unwrap_or_else(|_| workspace_root.to_path_buf());

    if let Some(reason) = is_forbidden_secret_path(&canonical_path, app_config_dir, Some(&canonical_ws)) {
        return Ok(HostFsEvaluation {
            verdict: PolicyVerdict::Deny(format!(
                "Bloqueado por seguridad (Capa 1): acceso denegado a {reason}."
            )),
            canonical_path: canonical_path.clone(),
            inside_workspace: canonical_path.starts_with(&canonical_ws),
            scope_dir: canonical_path,
            scope_kind: op.scope_kind().to_string(),
            allow_always_allowed: false,
            risk_level: "blocked".to_string(),
            matched_rule: None,
        });
    }

    let inside_workspace = canonical_path == canonical_ws || canonical_path.starts_with(&canonical_ws);
    if inside_workspace {
        if let Ok(rel) = canonical_path.strip_prefix(&canonical_ws) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let zone = crate::slices::workspace_manager::sandbox::zone_from_rel_path(rel);
            let deny_reason: Option<(&str, String)> = if zone == crate::slices::workspace_manager::sandbox::WorkspaceZone::Meta {
                Some((
                    "workspace_meta_protected",
                    "Bloqueado: `.xook` es interno y no puede accederse directamente.".to_string(),
                ))
            } else if op.is_write() {
                if canonical_path == canonical_ws || zone.is_protected_system() {
                    Some((
                        "workspace_root_protected",
                        "Bloqueado: no está permitido sobrescribir o crear archivos en la raíz del espacio de trabajo."
                            .to_string(),
                    ))
                } else if zone.is_hitl_protected() {
                    Some((
                        "workspace_hitl_zone_protected",
                        format!(
                            "Bloqueado: `{rel_str}` pertenece a `{}` y solo puede modificarse mediante propuesta HITL o desde la app.",
                            zone.as_str()
                        ),
                    ))
                } else if let Some(kind) =
                    crate::slices::workspace_manager::sandbox::is_protected_workspace_rel_path(rel)
                {
                    Some((
                        "workspace_core_protected",
                        format!(
                            "Bloqueado: `{rel_str}` está protegido ({kind}) y no puede sobrescribirse directamente."
                        ),
                    ))
                } else {
                    None
                }
            } else {
                None
            };

            if let Some((rule_name, msg)) = deny_reason {
                return Ok(HostFsEvaluation {
                    verdict: PolicyVerdict::Deny(msg),
                    canonical_path: canonical_path.clone(),
                    inside_workspace: true,
                    scope_dir: canonical_ws,
                    scope_kind: op.scope_kind().to_string(),
                    allow_always_allowed: false,
                    risk_level: op.risk_level().to_string(),
                    matched_rule: Some(rule_name.to_string()),
                });
            }
        }

        return Ok(HostFsEvaluation {
            verdict: PolicyVerdict::Allow,
            canonical_path: canonical_path.clone(),
            inside_workspace: true,
            scope_dir: canonical_ws,
            scope_kind: op.scope_kind().to_string(),
            allow_always_allowed: false,
            risk_level: op.risk_level().to_string(),
            matched_rule: Some("workspace_active".to_string()),
        });
    }

    let is_dir_target = match op {
        HostFsOperation::List | HostFsOperation::Search | HostFsOperation::Mkdir => {
            if existed { canonical_path.is_dir() } else { true }
        }
        HostFsOperation::Read | HostFsOperation::Write | HostFsOperation::Edit => {
            existed && canonical_path.is_dir()
        }
    };

    let scope_dir = if is_dir_target {
        if existed {
            canonical_path.clone()
        } else {
            canonical_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| canonical_path.clone())
        }
    } else {
        canonical_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| canonical_path.clone())
    };

    // Nunca permitir guardar `AllowAlways` sobre `/`, `C:\`, `$HOME` o carpetas del sistema
    let allow_always_allowed = !is_broad_or_sensitive_root(&scope_dir);
    let scope_kind = op.scope_kind().to_string();
    let cfg = load_permissions(&canonical_ws);

    // `deny` sobre ext_read o ext_write tiene prioridad absoluta
    if let Some(deny_rule) = cfg.rules.iter().find(|r| {
        r.action == "deny"
            && matches!(r.scope.as_str(), "ext_read" | "ext_write")
            && (r.scope == "ext_read" || op.is_write())
            && rule_matches_host_path(&r.pattern, &canonical_path)
    }) {
        return Ok(HostFsEvaluation {
            verdict: PolicyVerdict::Deny(format!(
                "Acceso bloqueado por regla de permisos ('{}').",
                deny_rule.pattern
            )),
            canonical_path,
            inside_workspace: false,
            scope_dir,
            scope_kind,
            allow_always_allowed,
            risk_level: "blocked".to_string(),
            matched_rule: Some(deny_rule.pattern.clone()),
        });
    }

    // Reglas `allow` explícitas por carpeta (nunca aceptan raíces amplias aunque alguien editara el JSON)
    if let Some(allow_rule) = cfg.rules.iter().find(|r| {
        if r.action != "allow" {
            return false;
        }
        let scope_ok = if op.is_write() {
            r.scope == "ext_write"
        } else {
            r.scope == "ext_read" || r.scope == "ext_write"
        };
        if !scope_ok {
            return false;
        }
        let Ok(exp) = expand_raw_host_path(&r.pattern) else {
            return false;
        };
        let canon_rule = fs::canonicalize(&exp).unwrap_or(exp);
        if is_broad_or_sensitive_root(&canon_rule) {
            return false;
        }
        canonical_path == canon_rule || canonical_path.starts_with(&canon_rule)
    }) {
        return Ok(HostFsEvaluation {
            verdict: PolicyVerdict::Allow,
            canonical_path,
            inside_workspace: false,
            scope_dir,
            scope_kind,
            allow_always_allowed,
            risk_level: op.risk_level().to_string(),
            matched_rule: Some(allow_rule.pattern.clone()),
        });
    }

    if cfg.default_policy == "deny" {
        return Ok(HostFsEvaluation {
            verdict: PolicyVerdict::Deny(
                "Política estricta: las rutas fuera del espacio de trabajo requieren permiso explícito."
                    .to_string(),
            ),
            canonical_path,
            inside_workspace: false,
            scope_dir,
            scope_kind,
            allow_always_allowed,
            risk_level: op.risk_level().to_string(),
            matched_rule: None,
        });
    }

    Ok(HostFsEvaluation {
        verdict: PolicyVerdict::Ask,
        canonical_path,
        inside_workspace: false,
        scope_dir,
        scope_kind,
        allow_always_allowed,
        risk_level: op.risk_level().to_string(),
        matched_rule: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::command_runner::policy::add_or_update_rule;
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;
    use chrono::Utc;

    fn temp_dir_named(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "xook_host_fs_{label}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn blocks_secrets_and_vault_even_inside_allowed_parent() {
        let root = temp_dir_named("secrets");
        let ws = root.join("ws");
        let ext = root.join("ext");
        let cfg_dir = root.join("app_cfg");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(ext.join(".ssh")).unwrap();
        fs::create_dir_all(&cfg_dir).unwrap();
        scaffold_workspace_dir(&ws, "ws_h", "Host Test").unwrap();
        fs::write(ext.join(".ssh/id_rsa"), "SECRET").unwrap();
        fs::write(ext.join(".env"), "TOKEN=123").unwrap();
        fs::write(ext.join(".env.example"), "TOKEN=placeholder").unwrap();
        fs::write(cfg_dir.join("ai-vault.json"), "{}").unwrap();

        add_or_update_rule(
            &ws,
            &ext.to_string_lossy(),
            "allow",
            "ext_read",
            Some("Carpeta ext".to_string()),
        )
        .unwrap();

        let ssh_eval = evaluate_host_fs_access(
            &ws,
            Some(&cfg_dir),
            &ext.join(".ssh/id_rsa").to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert!(matches!(ssh_eval.verdict, PolicyVerdict::Deny(_)));

        let env_eval = evaluate_host_fs_access(
            &ws,
            Some(&cfg_dir),
            &ext.join(".env").to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert!(matches!(env_eval.verdict, PolicyVerdict::Deny(_)));

        let env_ex_eval = evaluate_host_fs_access(
            &ws,
            Some(&cfg_dir),
            &ext.join(".env.example").to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert_eq!(env_ex_eval.verdict, PolicyVerdict::Allow);

        let vault_eval = evaluate_host_fs_access(
            &ws,
            Some(&cfg_dir),
            &cfg_dir.join("ai-vault.json").to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert!(matches!(vault_eval.verdict, PolicyVerdict::Deny(_)));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn broad_home_and_root_disallow_allow_always_and_respect_ext_rules() {
        let root = temp_dir_named("rules");
        let ws = root.join("ws");
        let docs = root.join("docs");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&docs).unwrap();
        scaffold_workspace_dir(&ws, "ws_r", "Rules Test").unwrap();
        let file = docs.join("factura.txt");
        fs::write(&file, "hola").unwrap();

        let ask_read = evaluate_host_fs_access(
            &ws,
            None,
            &file.to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert_eq!(ask_read.verdict, PolicyVerdict::Ask);
        assert!(ask_read.allow_always_allowed);
        assert_eq!(ask_read.scope_dir, fs::canonicalize(&docs).unwrap());

        if let Some(home) = resolve_user_home() {
            let home_eval = evaluate_host_fs_access(
                &ws,
                None,
                &home.to_string_lossy(),
                HostFsOperation::List,
            )
            .unwrap();
            assert_eq!(home_eval.verdict, PolicyVerdict::Ask);
            assert!(!home_eval.allow_always_allowed);
        }

        add_or_update_rule(
            &ws,
            &docs.to_string_lossy(),
            "allow",
            "ext_read",
            Some("Docs".to_string()),
        )
        .unwrap();

        let allow_read = evaluate_host_fs_access(
            &ws,
            None,
            &file.to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert_eq!(allow_read.verdict, PolicyVerdict::Allow);

        // ext_read no autoriza escritura
        let ask_write = evaluate_host_fs_access(
            &ws,
            None,
            &file.to_string_lossy(),
            HostFsOperation::Write,
        )
        .unwrap();
        assert_eq!(ask_write.verdict, PolicyVerdict::Ask);

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_to_secret_is_blocked() {
        use std::os::unix::fs::symlink;

        let root = temp_dir_named("sym");
        let ws = root.join("ws");
        let ext = root.join("ext");
        let secret_dir = root.join(".ssh");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&ext).unwrap();
        fs::create_dir_all(&secret_dir).unwrap();
        scaffold_workspace_dir(&ws, "ws_sym", "Sym Test").unwrap();
        fs::write(secret_dir.join("id_ed25519"), "PRIVATE").unwrap();

        let link = ext.join("innocent_link");
        symlink(&secret_dir, &link).unwrap();

        add_or_update_rule(&ws, &ext.to_string_lossy(), "allow", "ext_read", None).unwrap();

        let res = evaluate_host_fs_access(
            &ws,
            None,
            &link.join("id_ed25519").to_string_lossy(),
            HostFsOperation::Read,
        )
        .unwrap();
        assert!(matches!(res.verdict, PolicyVerdict::Deny(_)));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn inside_workspace_writes_block_hitl_and_protected_core_paths() {
        let root = std::env::temp_dir().join(format!(
            "xook_guard_ws_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ws = root.join("ws");
        fs::create_dir_all(ws.join("empresa")).unwrap();
        fs::create_dir_all(ws.join("memoria")).unwrap();
        fs::create_dir_all(ws.join("agente/proyectos")).unwrap();
        fs::write(ws.join("empresa/perfil.json"), "{}").unwrap();
        fs::write(ws.join("memoria/decisiones.jsonl"), "").unwrap();

        let blocked_perfil = evaluate_host_fs_access(
            &ws,
            None,
            &ws.join("empresa/perfil.json").to_string_lossy(),
            HostFsOperation::Write,
        )
        .unwrap();
        assert!(matches!(blocked_perfil.verdict, PolicyVerdict::Deny(_)));

        let blocked_decisions = evaluate_host_fs_access(
            &ws,
            None,
            &ws.join("memoria/decisiones.jsonl").to_string_lossy(),
            HostFsOperation::Edit,
        )
        .unwrap();
        assert!(matches!(blocked_decisions.verdict, PolicyVerdict::Deny(_)));

        let allowed_custom = evaluate_host_fs_access(
            &ws,
            None,
            &ws.join("agente/proyectos/resumen.md").to_string_lossy(),
            HostFsOperation::Write,
        )
        .unwrap();
        assert_eq!(allowed_custom.verdict, PolicyVerdict::Allow);

        let _ = fs::remove_dir_all(&root);
    }
}
