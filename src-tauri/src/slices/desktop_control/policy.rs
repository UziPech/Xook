//! Política exhaustiva de operaciones de control de escritorio (Guardián Capa 1).
//!
//! Inspirado en `command_policy` y `blocked_combo` de vercel-labs/agent-desktop (Apache-2.0):
//! agregar un comando al enum `DesktopOperation` sin clasificar su permiso y riesgo
//! impide compilar, y los atajos peligrosos del sistema se bloquean canónicamente.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopOperation {
    ListWindows,
    Snapshot,
    Find,
    FocusWindow,
    Click,
    SetValue,
    TypeText,
    PressKey,
    Focus,
    ScrollTo,
}

impl DesktopOperation {
    pub fn from_action_str(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "click" | "press" => Ok(Self::Click),
            "set_value" | "set-value" | "write" => Ok(Self::SetValue),
            "type_text" | "type-text" | "type" => Ok(Self::TypeText),
            "press_key" | "press-key" | "key" | "hotkey" => Ok(Self::PressKey),
            "focus" => Ok(Self::Focus),
            "scroll_to" | "scroll-to" | "scroll" => Ok(Self::ScrollTo),
            "focus_window" | "focus-window" | "raise" => Ok(Self::FocusWindow),
            other => Err(format!(
                "Acción de escritorio desconocida '{other}'. Usa: click, set_value, type_text, press_key, focus, scroll_to o focus_window."
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ListWindows => "list_windows",
            Self::Snapshot => "snapshot",
            Self::Find => "find",
            Self::FocusWindow => "focus_window",
            Self::Click => "click",
            Self::SetValue => "set_value",
            Self::TypeText => "type_text",
            Self::PressKey => "press_key",
            Self::Focus => "focus",
            Self::ScrollTo => "scroll_to",
        }
    }

    pub fn human_verb_es(self) -> &'static str {
        match self {
            Self::ListWindows => "Listar ventanas",
            Self::Snapshot => "Inspeccionar controles",
            Self::Find => "Buscar controles",
            Self::FocusWindow => "Traer al frente ventana",
            Self::Click => "Hacer clic en",
            Self::SetValue => "Escribir valor en",
            Self::TypeText => "Escribir texto en",
            Self::PressKey => "Presionar tecla",
            Self::Focus => "Enfocar control",
            Self::ScrollTo => "Desplazar hasta",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopPermissionNeed {
    None,
    Accessibility,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopOpPolicy {
    pub permission: DesktopPermissionNeed,
    pub requires_hitl_gate: bool,
    pub base_risk_level: &'static str,
    pub allow_always_by_default: bool,
}

/// Función total sobre `DesktopOperation`: el compilador impide agregar operaciones sin política.
pub fn policy_for(op: DesktopOperation) -> DesktopOpPolicy {
    match op {
        DesktopOperation::ListWindows => DesktopOpPolicy {
            permission: DesktopPermissionNeed::None,
            requires_hitl_gate: false,
            base_risk_level: "low",
            allow_always_by_default: true,
        },
        DesktopOperation::Snapshot | DesktopOperation::Find => DesktopOpPolicy {
            permission: DesktopPermissionNeed::Accessibility,
            requires_hitl_gate: false,
            base_risk_level: "low",
            allow_always_by_default: true,
        },
        DesktopOperation::FocusWindow | DesktopOperation::Focus | DesktopOperation::ScrollTo => {
            DesktopOpPolicy {
                permission: DesktopPermissionNeed::Accessibility,
                requires_hitl_gate: true,
                base_risk_level: "low",
                allow_always_by_default: true,
            }
        }
        DesktopOperation::Click
        | DesktopOperation::SetValue
        | DesktopOperation::TypeText
        | DesktopOperation::PressKey => DesktopOpPolicy {
            permission: DesktopPermissionNeed::Accessibility,
            requires_hitl_gate: true,
            base_risk_level: "medium",
            allow_always_by_default: true,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedKeyCombo {
    pub modifiers: Vec<String>, // ordenados y únicos: "alt", "cmd", "ctrl", "shift"
    pub key: String,            // canónico: "return", "esc", "delete", "a", ...
    pub display: String,
}

const BLOCKED_COMBOS: &[(&[&str], &str)] = &[
    (&["cmd"], "q"),
    (&["cmd", "shift"], "q"),
    (&["alt", "cmd"], "esc"),
    (&["cmd", "ctrl"], "q"),
    (&["cmd", "shift"], "delete"),
];

pub fn parse_key_combo(raw: &str) -> Result<ParsedKeyCombo, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Falta 'key' con la tecla o atajo a presionar (ej. 'return', 'cmd+l', 'tab').".to_string());
    }
    let mut mods: Vec<String> = Vec::new();
    let mut key = String::new();
    for part in trimmed.split('+').map(|s| s.trim().to_ascii_lowercase()) {
        if part.is_empty() {
            continue;
        }
        match part.as_str() {
            "cmd" | "command" | "meta" | "super" => mods.push("cmd".to_string()),
            "ctrl" | "control" => mods.push("ctrl".to_string()),
            "alt" | "option" | "opt" => mods.push("alt".to_string()),
            "shift" => mods.push("shift".to_string()),
            other => {
                if !key.is_empty() {
                    return Err(format!(
                        "Atajo inválido '{trimmed}': indica una sola tecla principal junto a los modificadores."
                    ));
                }
                key = match other {
                    "enter" | "return" => "return".to_string(),
                    "escape" | "esc" => "esc".to_string(),
                    "backspace" | "delete" => "delete".to_string(),
                    "forwarddelete" | "del" => "forwarddelete".to_string(),
                    "spacebar" => "space".to_string(),
                    _ => other.to_string(),
                };
            }
        }
    }
    if key.is_empty() {
        return Err(format!("Falta una tecla principal válida en '{trimmed}'."));
    }
    mods.sort_unstable();
    mods.dedup();
    let mut display_parts = mods.clone();
    display_parts.push(key.clone());
    Ok(ParsedKeyCombo {
        modifiers: mods,
        key,
        display: display_parts.join("+"),
    })
}

/// Bloquea canónicamente combinaciones que cierran apps, fuerzan salida, bloquean sesión o vacían papelera
/// (incluyendo cualquier superset de modificadores).
pub fn is_blocked_key_combo(combo: &ParsedKeyCombo) -> bool {
    BLOCKED_COMBOS.iter().any(|(req_mods, req_key)| {
        *req_key == combo.key
            && req_mods
                .iter()
                .all(|m| combo.modifiers.iter().any(|cm| cm == m))
    })
}

/// Detecta teclas que suelen confirmar/enviar/eliminar contenido para exigir confirmación individual.
pub fn is_commit_key_combo(combo: &ParsedKeyCombo) -> bool {
    if combo.key == "return" && !combo.modifiers.iter().any(|m| m == "shift") {
        return true;
    }
    if combo.key == "delete" && combo.modifiers.iter().any(|m| m == "cmd") {
        return true;
    }
    false
}

/// Valida que una ref tenga el formato calificado estricto `s<N>:@e<M>`.
pub fn validate_qualified_ref(raw: &str) -> Result<(String, String), String> {
    let trimmed = raw.trim();
    let Some((snap, elem)) = trimmed.split_once(':') else {
        return Err(format!(
            "Referencia inválida '{trimmed}'. Usa una referencia calificada de un snapshot reciente (ej. 's1:@e3')."
        ));
    };
    let snap_num = snap
        .strip_prefix('s')
        .and_then(|d| d.parse::<u64>().ok())
        .filter(|&n| n >= 1);
    let elem_num = elem
        .strip_prefix("@e")
        .and_then(|d| d.parse::<u64>().ok())
        .filter(|&n| n >= 1);
    if snap_num.is_none() || elem_num.is_none() {
        return Err(format!(
            "Referencia mal formada '{trimmed}'. Formato esperado: 's<N>:@e<M>' (ej. 's2:@e7')."
        ));
    }
    Ok((snap.to_string(), trimmed.to_string()))
}

const SENSITIVE_BUNDLE_TOKENS: &[&str] = &[
    "com.apple.keychainaccess",
    "com.apple.passwords",
    "com.agilebits.onepassword",
    "com.1password.",
    "com.bitwarden.",
    "com.dashlane.",
    "com.lastpass.",
    "org.keepassx.",
    "org.keepassxc.",
    "me.proton.pass",
    "in.sinew.enpass",
    "com.nordpass.",
    "com.authy.",
    "com.twilio.authy",
];

const SENSITIVE_APP_NAMES: &[&str] = &[
    "1password",
    "bitwarden",
    "keychain access",
    "acceso a llaveros",
    "keepass",
    "lastpass",
    "dashlane",
    "proton pass",
    "enpass",
    "nordpass",
    "authy",
    "contraseñas",
    "passwords",
];

const SENSITIVE_TITLE_TOKENS: &[&str] = &[
    "inprivate",
    "incógnito",
    "incognito",
    "private browsing",
    "navegación privada",
    "password manager",
    "gestor de contraseñas",
    "recovery phrase",
    "seed phrase",
    "llave privada",
];

const EXCLUDED_SYSTEM_BUNDLES: &[&str] = &[
    "com.xook.app",
    "com.apple.controlcenter",
    "com.apple.notificationcenterui",
    "com.apple.dock",
    "com.apple.spotlight",
    "com.apple.windowmanager",
    "com.apple.loginwindow",
    "com.apple.screencaptureui",
    "com.apple.systemuiserver",
    "com.apple.wallpaper.agent",
];

const EXCLUDED_SYSTEM_OWNERS: &[&str] = &[
    "xook",
    "window server",
    "dock",
    "control center",
    "notification center",
    "spotlight",
    "wallpaper",
    "systemuiserver",
    "windowmanager",
    "loginwindow",
];

pub fn is_excluded_self_or_system(pid: i32, bundle_id: &str, app_name: &str, title: &str) -> bool {
    if pid == std::process::id() as i32 {
        return true;
    }
    let lb = bundle_id.trim().to_ascii_lowercase();
    let la = app_name.trim().to_ascii_lowercase();
    let lt = title.trim().to_ascii_lowercase();

    if EXCLUDED_SYSTEM_BUNDLES.contains(&lb.as_str()) {
        return true;
    }
    if EXCLUDED_SYSTEM_OWNERS.contains(&la.as_str()) {
        return true;
    }
    if lt == "xox quick bar" {
        return true;
    }
    false
}

const ELECTRON_CHROMIUM_TOKENS: &[&str] = &[
    "antigravity",
    "vscode",
    "com.microsoft.vscode",
    "cursor",
    "windsurf",
    "chrome",
    "chromium",
    "electron",
    "slack",
    "whatsapp",
    "discord",
    "notion",
    "figma",
    "brave",
    "company.thebrowser.",
    "msedge",
    "obsidian",
    "linear",
    "spotify",
    "teams",
    "postman",
    "com.todesktop.",
    "com.tinyspeck.",
    "com.hnc.discord",
    "net.whatsapp.",
];

/// Detecta si la app objetivo es Electron o Chromium, donde activar la ventana por `app_name`
/// no garantiza foco real en el editor DOM (`contenteditable`/ProseMirror/Monaco).
pub fn is_electron_or_chromium_app(bundle_id: &str, app_name: &str) -> bool {
    let b = bundle_id.trim().to_ascii_lowercase();
    let a = app_name.trim().to_ascii_lowercase();
    if b.is_empty() && a.is_empty() {
        return false;
    }
    if matches!(a.as_str(), "arc" | "code" | "edge" | "microsoft edge") {
        return true;
    }
    ELECTRON_CHROMIUM_TOKENS
        .iter()
        .any(|tok| b.contains(tok) || a.contains(tok))
}

/// Detecta apps de contraseñas o ventanas privadas protegidas en Capa 1.
pub fn detect_sensitive_window(bundle_id: &str, app_name: &str, title: &str) -> Option<String> {
    let b = bundle_id.trim().to_ascii_lowercase();
    let a = app_name.trim().to_ascii_lowercase();
    let t = title.trim().to_ascii_lowercase();

    if SENSITIVE_BUNDLE_TOKENS.iter().any(|tok| b.contains(tok)) {
        let label = if app_name.is_empty() { bundle_id } else { app_name };
        return Some(format!("App protegida de credenciales ({label})"));
    }
    if SENSITIVE_APP_NAMES.iter().any(|tok| a == *tok || a.contains(tok)) {
        return Some(format!("App de contraseñas o credenciales ({app_name})"));
    }
    if SENSITIVE_TITLE_TOKENS.iter().any(|tok| t.contains(tok)) {
        return Some(format!("Ventana privada o sensible ({title})"));
    }
    None
}

const HIGH_RISK_UI_PHRASES: &[&str] = &[
    "enviar",
    "send",
    "entregar",
    "turn in",
    "hand in",
    "submit",
    "eliminar",
    "borrar",
    "delete",
    "remove",
    "pagar",
    "pay",
    "comprar",
    "buy",
    "transferir",
    "transfer",
    "publicar",
    "publish",
    "confirmar pago",
    "autorizar pago",
    "cerrar sesion",
    "log out",
    "logout",
    "sign out",
    "vaciar papelera",
    "empty trash",
];

pub(crate) fn fold_ascii_spanish(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        let mapped = match ch {
            'á' | 'Á' | 'à' | 'À' => 'a',
            'é' | 'É' | 'è' | 'È' => 'e',
            'í' | 'Í' | 'ì' | 'Ì' => 'i',
            'ó' | 'Ó' | 'ò' | 'Ò' => 'o',
            'ú' | 'Ú' | 'ü' | 'Ü' => 'u',
            'ñ' | 'Ñ' => 'n',
            other => other.to_ascii_lowercase(),
        };
        if mapped.is_ascii_alphanumeric() {
            out.push(mapped);
        } else {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Evalúa si el elemento objetivo representa una acción de compromiso/destructiva
/// que jamás debe autorizarse automáticamente ni ofrecer "Permitir siempre".
pub fn detect_high_risk_ui_target(name: &str, description: &str) -> Option<&'static str> {
    let combined = format!("{} {}", fold_ascii_spanish(name), fold_ascii_spanish(description));
    let padded = format!(" {} ", combined.trim());
    for phrase in HIGH_RISK_UI_PHRASES {
        let needle = format!(" {phrase} ");
        if padded.contains(&needle) {
            return Some(*phrase);
        }
    }
    None
}

/// Construye la clave de permiso por aplicación (scope="capability") para `.xook/permissions.json`.
pub fn desktop_app_capability_key(bundle_id: &str, app_name: &str) -> String {
    let raw = if !bundle_id.trim().is_empty() {
        bundle_id.trim()
    } else {
        app_name.trim()
    };
    let clean: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    let suffix = clean.trim_matches('_');
    if suffix.is_empty() {
        "desktop_ui:unknown".to_string()
    } else {
        format!("desktop_ui:{suffix}")
    }
}

/// Redacta patrones obvios de secretos antes de devolver texto de UI al agente.
pub fn redact_ui_text(raw: &str) -> String {
    let mut out = raw.to_string();
    for prefix in [
        "sk-or-v1-",
        "sk-ant-",
        "sk-proj-",
        "sk-live-",
        "sk-test-",
        "ghp_",
        "gho_",
        "AIza",
        "AKIA",
    ] {
        while let Some(idx) = out.find(prefix) {
            let tail = &out[idx..];
            let token_len = tail
                .bytes()
                .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                .count();
            if token_len >= prefix.len() + 10 {
                out.replace_range(idx..idx + token_len, "[CLAVE_OCULTA]");
            } else {
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhaustive_policy_classifies_all_operations() {
        assert_eq!(
            policy_for(DesktopOperation::ListWindows).permission,
            DesktopPermissionNeed::None
        );
        assert!(!policy_for(DesktopOperation::Snapshot).requires_hitl_gate);
        assert!(!policy_for(DesktopOperation::Find).requires_hitl_gate);
        assert!(policy_for(DesktopOperation::Click).requires_hitl_gate);
        assert!(policy_for(DesktopOperation::TypeText).requires_hitl_gate);
        assert!(policy_for(DesktopOperation::PressKey).requires_hitl_gate);
    }

    #[test]
    fn blocked_key_combos_catch_aliases_and_supersets() {
        let quit = parse_key_combo("Command+Q").unwrap();
        assert!(is_blocked_key_combo(&quit));
        let force_quit = parse_key_combo("Option+Cmd+Escape").unwrap();
        assert!(is_blocked_key_combo(&force_quit));
        let superset = parse_key_combo("Ctrl+Shift+Cmd+Q").unwrap();
        assert!(is_blocked_key_combo(&superset));
        let trash = parse_key_combo("cmd+shift+backspace").unwrap();
        assert!(is_blocked_key_combo(&trash));

        let send = parse_key_combo("cmd+enter").unwrap();
        assert!(!is_blocked_key_combo(&send));
        assert!(is_commit_key_combo(&send));
        let newline = parse_key_combo("shift+return").unwrap();
        assert!(!is_commit_key_combo(&newline));
    }

    #[test]
    fn qualified_ref_validation_rejects_bare_refs() {
        assert_eq!(
            validate_qualified_ref("s1:@e4").unwrap(),
            ("s1".to_string(), "s1:@e4".to_string())
        );
        assert!(validate_qualified_ref("@e4").is_err());
        assert!(validate_qualified_ref("s0:@e1").is_err());
        assert!(validate_qualified_ref("s1:@e0").is_err());
        assert!(validate_qualified_ref("").is_err());
    }

    #[test]
    fn detects_sensitive_apps_and_private_windows() {
        assert!(detect_sensitive_window("com.agilebits.onepassword7", "1Password", "Vault").is_some());
        assert!(detect_sensitive_window("com.apple.Safari", "Safari", "Navegación privada — Banco").is_some());
        assert!(detect_sensitive_window("com.apple.finder", "Finder", "Documentos").is_none());
    }

    #[test]
    fn detects_high_risk_commit_and_destructive_labels() {
        assert!(detect_high_risk_ui_target("Enviar mensaje", "").is_some());
        assert!(detect_high_risk_ui_target("", "Delete selected invoice").is_some());
        assert!(detect_high_risk_ui_target("Cerrar sesión", "").is_some());
        assert!(detect_high_risk_ui_target("Guardar borrador", "Save draft").is_none());
        assert!(detect_high_risk_ui_target("Buscar", "Search").is_none());
    }

    #[test]
    fn detects_assignment_turn_in_buttons() {
        // Teams, Classroom y Moodle: entregar una tarea sale del equipo igual que enviar.
        assert!(detect_high_risk_ui_target("Entregar", "").is_some());
        assert!(detect_high_risk_ui_target("", "Turn in assignment").is_some());
        assert!(detect_high_risk_ui_target("Hand in", "").is_some());
        assert!(detect_high_risk_ui_target("Submit", "").is_some());
        assert!(detect_high_risk_ui_target("Enviar tarea", "").is_some());
        assert!(detect_high_risk_ui_target("Entregas", "Ver tareas entregadas").is_none());
        assert!(detect_high_risk_ui_target("Adjuntar", "Agregar archivo").is_none());
    }

    #[test]
    fn redacts_api_keys_from_ui_values() {
        let s = "Token activo: sk-or-v1-abcdef1234567890xyz listo";
        assert_eq!(redact_ui_text(s), "Token activo: [CLAVE_OCULTA] listo");
    }

    #[test]
    fn detects_electron_and_chromium_apps_accurately() {
        assert!(is_electron_or_chromium_app("com.google.antigravity", "Antigravity"));
        assert!(is_electron_or_chromium_app("com.microsoft.VSCode", "Code"));
        assert!(is_electron_or_chromium_app("com.tinyspeck.slackmacgap", "Slack"));
        assert!(is_electron_or_chromium_app("", "Cursor"));
        assert!(is_electron_or_chromium_app("com.google.Chrome", "Google Chrome"));
        assert!(!is_electron_or_chromium_app("com.apple.finder", "Finder"));
        assert!(!is_electron_or_chromium_app("com.apple.TextEdit", "TextEdit"));
        assert!(!is_electron_or_chromium_app("com.apple.Notes", "Notes"));
    }
}
