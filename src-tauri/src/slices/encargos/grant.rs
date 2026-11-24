//! Permiso acotado de un pendiente mientras Xox lo ejecuta en segundo plano.
//!
//! Vale para un pendiente, una app y una acción final, y solo mientras dura la ejecución
//! (se registra al empezar y se retira al terminar). Diseño: claude/diseno-encargos.md.

use crate::slices::desktop_control::policy::fold_ascii_spanish;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Antes del último clic, Xox tiene que haber mirado la pantalla después de su última acción
/// y hace menos de 2 minutos.
const VERIFY_WINDOW_MS: i64 = 120_000;

/// Ventanas del sistema que abren las apps para elegir un archivo (adjuntar).
const FILE_DIALOG_APPS: &[&str] = &["open and save panel service", "openandsavepanelservice"];

#[derive(Debug, Clone)]
pub struct EncargoGrant {
    pub target_app: Option<String>,
    pub may_finish: bool,
    pub final_action: Option<String>,
    pub last_observed_ms: i64,
    pub last_action_ms: i64,
    pub final_used: bool,
    /// Lo que el permiso no dejó hacer, para el informe.
    pub blocked: Vec<String>,
}

impl EncargoGrant {
    pub fn new(target_app: Option<&str>, may_finish: bool, final_action: Option<&str>) -> Self {
        Self {
            target_app: target_app.map(str::to_string),
            may_finish,
            final_action: final_action.map(str::to_string),
            last_observed_ms: 0,
            last_action_ms: 0,
            final_used: false,
            blocked: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantVerdict {
    Allow,
    AllowFinal,
    Deny(String),
}

fn grants() -> &'static Mutex<HashMap<String, EncargoGrant>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, EncargoGrant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fold_words(raw: &str) -> String {
    fold_ascii_spanish(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn app_matches(target: &str, app_name: &str) -> bool {
    let t = fold_words(target);
    let a = fold_words(app_name);
    if t.is_empty() || a.is_empty() {
        return false;
    }
    a.contains(&t) || t.contains(&a) || FILE_DIALOG_APPS.iter().any(|d| a.contains(d))
}

/// Decide una acción de escritorio dentro del permiso del pendiente.
pub fn decide_action(
    grant: &EncargoGrant,
    app_name: &str,
    commit_phrase: Option<&str>,
    uses_coords: bool,
    now_ms: i64,
) -> GrantVerdict {
    let Some(target) = grant.target_app.as_deref() else {
        return GrantVerdict::Deny("Este pendiente no incluye usar otras apps.".to_string());
    };
    if !app_matches(target, app_name) {
        return GrantVerdict::Deny(format!(
            "Este pendiente solo puede usar {target}, no {app_name}."
        ));
    }
    if uses_coords {
        return GrantVerdict::Deny(
            "En un pendiente solo pulso controles encontrados con desktop_find, no coordenadas."
                .to_string(),
        );
    }
    let Some(phrase) = commit_phrase else {
        return GrantVerdict::Allow;
    };
    if !grant.may_finish {
        return GrantVerdict::Deny(format!(
            "La instrucción pide dejarlo listo, sin «{phrase}». Me detengo antes de ese clic."
        ));
    }
    if grant.final_used {
        return GrantVerdict::Deny(
            "Ya di el último clic de este pendiente; no doy otro.".to_string(),
        );
    }
    let final_action = grant.final_action.as_deref().unwrap_or("");
    let final_folded = format!(" {} ", fold_words(final_action));
    if !final_folded.contains(&format!(" {} ", fold_words(phrase))) {
        return GrantVerdict::Deny(format!(
            "Este pendiente solo autoriza «{final_action}», no «{phrase}»."
        ));
    }
    if grant.last_observed_ms <= grant.last_action_ms
        || now_ms - grant.last_observed_ms > VERIFY_WINDOW_MS
    {
        return GrantVerdict::Deny(
            "Antes del último clic tengo que comprobar la pantalla con desktop_find o desktop_snapshot \
             (que lo adjuntado sea lo correcto). Hazlo y vuelve a intentarlo."
                .to_string(),
        );
    }
    GrantVerdict::AllowFinal
}

pub fn decide_open_app(grant: &EncargoGrant, app_name: &str) -> GrantVerdict {
    match grant.target_app.as_deref() {
        Some(target) if app_matches(target, app_name) => GrantVerdict::Allow,
        Some(target) => GrantVerdict::Deny(format!(
            "Este pendiente solo puede usar {target}, no {app_name}."
        )),
        None => GrantVerdict::Deny("Este pendiente no incluye usar otras apps.".to_string()),
    }
}

pub fn register(stream_id: &str, grant: EncargoGrant) {
    if let Ok(mut map) = grants().lock() {
        map.insert(stream_id.to_string(), grant);
    }
}

pub fn take(stream_id: &str) -> Option<EncargoGrant> {
    grants()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(stream_id))
}

pub fn note_observation(stream_id: &str, now_ms: i64) {
    if let Ok(mut map) = grants().lock() {
        if let Some(g) = map.get_mut(stream_id) {
            g.last_observed_ms = now_ms;
        }
    }
}

fn record(g: &mut EncargoGrant, verdict: &GrantVerdict, now_ms: i64) {
    match verdict {
        GrantVerdict::Allow => g.last_action_ms = now_ms,
        GrantVerdict::AllowFinal => {
            g.last_action_ms = now_ms;
            g.final_used = true;
        }
        GrantVerdict::Deny(reason) => g.blocked.push(reason.clone()),
    }
}

/// Aplica el permiso del pendiente que corre en `stream_id`.
/// `None` si ese stream no ejecuta un pendiente (el chat normal sigue su flujo de permisos).
pub fn check_action(
    stream_id: &str,
    app_name: &str,
    commit_phrase: Option<&str>,
    uses_coords: bool,
    now_ms: i64,
) -> Option<GrantVerdict> {
    let mut map = grants().lock().ok()?;
    let g = map.get_mut(stream_id)?;
    let verdict = decide_action(g, app_name, commit_phrase, uses_coords, now_ms);
    record(g, &verdict, now_ms);
    Some(verdict)
}

pub fn check_open_app(stream_id: &str, app_name: &str, now_ms: i64) -> Option<GrantVerdict> {
    let mut map = grants().lock().ok()?;
    let g = map.get_mut(stream_id)?;
    let verdict = decide_open_app(g, app_name);
    record(g, &verdict, now_ms);
    Some(verdict)
}

/// Si el último clic no se pudo dar (el botón cambió, por ejemplo), se puede volver a intentar.
pub fn release_final(stream_id: &str) {
    if let Ok(mut map) = grants().lock() {
        if let Some(g) = map.get_mut(stream_id) {
            g.final_used = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn teams_grant(may_finish: bool) -> EncargoGrant {
        EncargoGrant::new(
            Some("Microsoft Teams"),
            may_finish,
            may_finish.then_some("Entregar · Práctica 3"),
        )
    }

    #[test]
    fn only_the_target_app_and_file_dialogs_are_allowed() {
        let g = teams_grant(true);
        assert_eq!(
            decide_action(&g, "Microsoft Teams", None, false, 1),
            GrantVerdict::Allow
        );
        assert_eq!(
            decide_action(&g, "Teams", None, false, 1),
            GrantVerdict::Allow
        );
        assert_eq!(
            decide_action(&g, "Open and Save Panel Service", None, false, 1),
            GrantVerdict::Allow
        );
        assert!(matches!(
            decide_action(&g, "Mail", None, false, 1),
            GrantVerdict::Deny(_)
        ));
        assert!(matches!(
            decide_action(&g, "Teams", None, true, 1),
            GrantVerdict::Deny(_)
        ));

        let no_app = EncargoGrant::new(None, false, None);
        assert!(matches!(
            decide_action(&no_app, "Teams", None, false, 1),
            GrantVerdict::Deny(_)
        ));
        assert!(matches!(
            decide_open_app(&no_app, "Teams"),
            GrantVerdict::Deny(_)
        ));
        assert_eq!(decide_open_app(&g, "Microsoft Teams"), GrantVerdict::Allow);
    }

    #[test]
    fn final_click_needs_permission_matching_phrase_and_a_fresh_look() {
        let mut g = teams_grant(true);
        g.last_action_ms = 1_000;
        // Sin mirar la pantalla después de adjuntar: no.
        assert!(matches!(
            decide_action(&g, "Teams", Some("entregar"), false, 2_000),
            GrantVerdict::Deny(_)
        ));
        g.last_observed_ms = 1_500;
        assert_eq!(
            decide_action(&g, "Teams", Some("entregar"), false, 2_000),
            GrantVerdict::AllowFinal
        );
        // Otro botón de compromiso que no es el autorizado: no.
        assert!(matches!(
            decide_action(&g, "Teams", Some("enviar"), false, 2_000),
            GrantVerdict::Deny(_)
        ));
        // La observación caducó.
        assert!(matches!(
            decide_action(
                &g,
                "Teams",
                Some("entregar"),
                false,
                1_500 + VERIFY_WINDOW_MS + 1
            ),
            GrantVerdict::Deny(_)
        ));
        // Sin permiso para terminar: nunca.
        let mut ready_only = teams_grant(false);
        ready_only.last_observed_ms = 5;
        assert!(matches!(
            decide_action(&ready_only, "Teams", Some("entregar"), false, 6),
            GrantVerdict::Deny(_)
        ));
    }

    #[test]
    fn final_click_is_single_use_unless_it_failed() {
        let stream = "encargo_test_single_use";
        let mut g = teams_grant(true);
        g.last_observed_ms = 10;
        register(stream, g);

        assert_eq!(
            check_action(stream, "Teams", Some("entregar"), false, 20),
            Some(GrantVerdict::AllowFinal)
        );
        assert!(matches!(
            check_action(stream, "Teams", Some("entregar"), false, 30),
            Some(GrantVerdict::Deny(_))
        ));
        release_final(stream);
        note_observation(stream, 40);
        assert_eq!(
            check_action(stream, "Teams", Some("entregar"), false, 50),
            Some(GrantVerdict::AllowFinal)
        );

        let done = take(stream).unwrap();
        assert!(done.final_used);
        assert_eq!(done.blocked.len(), 1);
        assert!(check_action(stream, "Teams", None, false, 60).is_none());
    }
}
