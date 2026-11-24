//! Ejecutor de pendientes: el programador lo llama en cada vuelta (cada 30 s) y, cuando llega
//! la hora, despierta a Xox en segundo plano con el permiso acotado del pendiente.
//! Diseño: claude/diseno-encargos.md.

use super::grant::{self, EncargoGrant};
use super::store::{self, EncargoDto};
use crate::slices::task_ledger::migrations::open_workspace_db;
use crate::slices::workspace_manager::sandbox::{resolve_inside_workspace, write_string_atomic};
use chrono::{DateTime, Duration as ChronoDuration, Local, Utc};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Runtime};

pub const ENCARGOS_UPDATED_EVENT: &str = "encargos:updated";
pub const ENCARGO_FINISHED_EVENT: &str = "encargos:finished";

/// Si la hora pasó hace más de esto (app cerrada, Mac dormida), el pendiente queda `perdido`
/// y se le pregunta al usuario en vez de hacerlo tarde sin avisar.
const GRACE_MINUTES: i64 = 15;
/// Con un pendiente que usa otra app dentro de este margen, la Mac no se duerme por inactividad.
const KEEP_AWAKE_MINUTES: i64 = 60;
/// Minutos antes de la hora en que se ensaya el pendiente.
const REHEARSAL_MINUTES: i64 = 10;

/// Un pendiente a la vez: el control del escritorio no se comparte.
static RUNNING: AtomicBool = AtomicBool::new(false);

fn emit_updated<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(ENCARGOS_UPDATED_EVENT, json!({}));
}

/// Una vuelta del programador sobre el espacio de trabajo activo.
pub fn tick<R: Runtime>(app: &AppHandle<R>, root: &Path, conn: &Connection, now: DateTime<Utc>) {
    if !RUNNING.load(Ordering::SeqCst) && store::close_interrupted(conn, now) > 0 {
        emit_updated(app);
    }

    let due = store::due_encargos(conn, now).unwrap_or_default();
    for encargo in due {
        let at = encargo
            .next_run_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(now);
        if at < now - ChronoDuration::minutes(GRACE_MINUTES) {
            let _ = store::set_status(conn, &encargo.id, "perdido", now);
            notify(
                &format!("Se pasó la hora de «{}»", encargo.name),
                "Ábrelo en Pendientes si quieres que Xox lo haga ahora.",
            );
            emit_updated(app);
            continue;
        }
        if encargo.target_app.is_some() && screen_locked() {
            // Con la sesión bloqueada no se puede usar otra app; se reintenta en la siguiente vuelta.
            continue;
        }
        if RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            break;
        }
        match store::start_run(conn, &encargo.id, now) {
            Ok(run_id) => {
                emit_updated(app);
                let app_bg = app.clone();
                let root_bg = root.to_path_buf();
                tauri::async_runtime::spawn(async move {
                    run(app_bg, root_bg, encargo, run_id).await;
                });
            }
            Err(_) => RUNNING.store(false, Ordering::SeqCst),
        }
        break;
    }

    rehearse_upcoming(root, conn, now);
    if let Some(at) =
        store::next_desktop_run_within(conn, now, ChronoDuration::minutes(KEEP_AWAKE_MINUTES))
    {
        keep_awake_until(at + ChronoDuration::minutes(30), now);
    }
    if store::has_scheduled(conn) {
        super::autostart::ensure_enabled(app);
    }
}

/// Ensayo: unos minutos antes, revisa lo que haría fallar el pendiente y avisa mientras hay margen.
fn rehearse_upcoming(root: &Path, conn: &Connection, now: DateTime<Utc>) {
    use std::collections::HashSet;
    use std::sync::Mutex;
    static REHEARSED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

    let upcoming =
        store::scheduled_between(conn, now, now + ChronoDuration::minutes(REHEARSAL_MINUTES))
            .unwrap_or_default();
    for encargo in upcoming {
        // Una vez por ocasión: un pendiente que se repite se ensaya cada vez.
        let key = format!(
            "{}@{}",
            encargo.id,
            encargo.next_run_at.as_deref().unwrap_or("")
        );
        let first_time = REHEARSED
            .lock()
            .map(|mut seen| seen.get_or_insert_with(HashSet::new).insert(key))
            .unwrap_or(false);
        if !first_time {
            continue;
        }
        let problems = rehearsal_problems(root, &encargo, app_installed, screen_locked());
        if !problems.is_empty() {
            let at = encargo
                .next_run_at
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Local).format("%H:%M").to_string())
                .unwrap_or_default();
            notify(
                &format!("«{}» a las {at}", encargo.name),
                &problems.join(" "),
            );
        }
    }
}

pub fn rehearsal_problems(
    root: &Path,
    encargo: &EncargoDto,
    is_installed: impl Fn(&str) -> bool,
    locked: bool,
) -> Vec<String> {
    let mut problems = Vec::new();
    for file in &encargo.files {
        let exists = resolve_inside_workspace(root, file, false)
            .map(|(abs, _, _)| abs.is_file())
            .unwrap_or(false);
        if !exists {
            let name = file.rsplit('/').next().unwrap_or(file);
            problems.push(format!("No encuentro el archivo {name}."));
        }
    }
    if let Some(app) = encargo.target_app.as_deref() {
        if !is_installed(app) {
            problems.push(format!("{app} no está instalada en este equipo."));
        }
        if locked {
            problems.push(format!(
                "La sesión está bloqueada: desbloquéala para que Xox pueda usar {app}."
            ));
        }
    }
    problems
}

fn app_installed(app: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        use crate::slices::app_launcher::resolver::{
            AppResolution, discover_installed_apps, resolve_app_in_catalog,
        };
        matches!(
            resolve_app_in_catalog(&discover_installed_apps(), app),
            AppResolution::Resolved { .. } | AppResolution::Ambiguous { .. }
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Fuera de macOS los pendientes no usan otras apps (se rechazan al crearlos).
        let _ = app;
        true
    }
}

/// Ruta de la ruta aprendida en una app (`memoria/procedimientos/<app>.md`).
pub fn procedure_rel_path(target_app: &str) -> String {
    let slug = crate::slices::desktop_control::policy::fold_ascii_spanish(target_app)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    format!("memoria/procedimientos/{slug}.md")
}

fn read_rel(root: &Path, rel: &str) -> Option<String> {
    let (abs, _, _) = resolve_inside_workspace(root, rel, false).ok()?;
    fs::read_to_string(abs).ok()
}

pub fn build_run_message(
    encargo: &EncargoDto,
    procedure: Option<&str>,
    now: DateTime<Utc>,
) -> String {
    let scheduled = encargo
        .next_run_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Local).format("%H:%M").to_string())
        .unwrap_or_else(|| "ahora".to_string());
    let mut msg = format!(
        "Ejecuta ahora el pendiente «{}» (programado para las {scheduled}; son las {}).\n\n\
         Instrucción del usuario:\n> {}\n",
        encargo.name,
        now.with_timezone(&Local).format("%H:%M"),
        encargo.instruction.replace('\n', "\n> "),
    );
    if !encargo.steps.is_empty() {
        msg.push_str("\nPasos previstos:\n");
        for (i, step) in encargo.steps.iter().enumerate() {
            msg.push_str(&format!("{}. {step}\n", i + 1));
        }
    }
    match encargo.target_app.as_deref() {
        Some(app) => msg.push_str(&format!("\nApp: {app}. Abre o usa solo esta app.\n")),
        None => msg.push_str("\nNo uses otras apps: este pendiente no lo permite.\n"),
    }
    if !encargo.files.is_empty() {
        msg.push_str("\nArchivos (dentro del espacio de trabajo):\n");
        for f in &encargo.files {
            msg.push_str(&format!("- {f}\n"));
        }
    }
    if encargo.may_finish {
        msg.push_str(&format!(
            "\nAl final: da el último clic «{}», después de comprobar la pantalla.\n",
            encargo.final_action.as_deref().unwrap_or("")
        ));
    } else {
        msg.push_str(
            "\nAl final: déjalo listo y NO des el último clic (Entregar, Enviar, Publicar).\n",
        );
    }
    if let Some(app) = encargo.target_app.as_deref() {
        let rel = procedure_rel_path(app);
        match procedure {
            Some(text) if !text.trim().is_empty() => msg.push_str(&format!(
                "\nRuta aprendida en {app} ({rel}):\n{}\n",
                text.trim()
            )),
            _ => msg.push_str(&format!(
                "\nTodavía no hay ruta aprendida en {app}. Si sale bien, guárdala en {rel}.\n"
            )),
        }
    }
    msg
}

/// `hecho` solo si Xox lo declara y, cuando tenía permiso para el último clic, de verdad lo dio.
pub fn decide_outcome(
    reply: &str,
    error: Option<&str>,
    encargo: &EncargoDto,
    grant: Option<&EncargoGrant>,
) -> &'static str {
    if error.is_some() {
        return "detenido";
    }
    let last = reply
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| crate::slices::desktop_control::policy::fold_ascii_spanish(l))
        .unwrap_or_default();
    let declared_done = last.contains("resultado") && last.contains("hecho");
    let final_ok = !encargo.may_finish
        || encargo.target_app.is_none()
        || grant.map(|g| g.final_used).unwrap_or(false);
    if declared_done && final_ok {
        "hecho"
    } else {
        "detenido"
    }
}

fn step_lines(result: Option<&Value>) -> Vec<String> {
    result
        .and_then(|r| r.get("steps"))
        .and_then(|s| s.as_array())
        .map(|steps| {
            steps
                .iter()
                .filter_map(|s| {
                    let label = s.get("label").and_then(|v| v.as_str())?.trim();
                    let detail = s
                        .get("detail")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    let status = s.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    let mut line = label.to_string();
                    if !detail.is_empty() {
                        let short: String = detail.chars().take(160).collect();
                        line.push_str(&format!(" — {short}"));
                    }
                    if status == "error" {
                        line.push_str(" (falló)");
                    }
                    Some(line)
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn render_report(
    encargo: &EncargoDto,
    started: DateTime<Utc>,
    finished: DateTime<Utc>,
    outcome: &str,
    reply: &str,
    error: Option<&str>,
    grant: Option<&EncargoGrant>,
    steps: &[String],
) -> String {
    let headline = if outcome == "hecho" {
        "Hecho"
    } else {
        "Me detuve"
    };
    let mut md = format!(
        "# {} · {headline}\n\n- **Empezó:** {}\n- **Terminó:** {}\n",
        encargo.name,
        started.with_timezone(&Local).format("%Y-%m-%d %H:%M"),
        finished.with_timezone(&Local).format("%H:%M"),
    );
    if encargo.may_finish {
        let given = grant.map(|g| g.final_used).unwrap_or(false);
        md.push_str(&format!(
            "- **Último clic ({}):** {}\n",
            encargo.final_action.as_deref().unwrap_or("acción final"),
            if given { "dado" } else { "no se dio" }
        ));
    }
    md.push_str("\n## Lo que dice Xox\n\n");
    if let Some(err) = error {
        md.push_str(&format!("No pude terminar: {err}\n"));
    } else if reply.trim().is_empty() {
        md.push_str("Xox no dejó un informe.\n");
    } else {
        md.push_str(reply.trim());
        md.push('\n');
    }
    if let Some(g) = grant.filter(|g| !g.blocked.is_empty()) {
        md.push_str("\n## Lo que el permiso del pendiente no dejó hacer\n\n");
        for b in &g.blocked {
            md.push_str(&format!("- {b}\n"));
        }
    }
    if !steps.is_empty() {
        md.push_str("\n## Pasos\n\n");
        for s in steps {
            md.push_str(&format!("- {s}\n"));
        }
    }
    md
}

async fn run<R: Runtime>(app: AppHandle<R>, root: PathBuf, encargo: EncargoDto, run_id: String) {
    let started = Utc::now();
    let stream_id = format!("encargo_{}_{}", encargo.id, started.timestamp_millis());
    grant::register(
        &stream_id,
        EncargoGrant::new(
            encargo.target_app.as_deref(),
            encargo.may_finish,
            encargo.final_action.as_deref(),
        ),
    );

    let procedure_rel = encargo.target_app.as_deref().map(procedure_rel_path);
    let procedure = procedure_rel
        .as_deref()
        .and_then(|rel| read_rel(&root, rel));
    let message = build_run_message(&encargo, procedure.as_deref(), started);

    let outcome_result = match serde_json::from_value::<crate::ai_vault::XoxChatRequest>(json!({
        "message": message,
        "history": [],
        "streamId": stream_id,
        "sessionId": format!("encargo_{}", encargo.id),
    })) {
        Ok(mut payload) => {
            payload.encargo_run = Some(json!({
                "id": encargo.id,
                "name": encargo.name,
                "folder": encargo.folder,
                "targetApp": encargo.target_app,
                "mayFinish": encargo.may_finish,
                "finalAction": encargo.final_action,
                "procedurePath": procedure_rel,
            }));
            crate::ai_vault::run_xox_chat_stream(app.clone(), payload).await
        }
        Err(e) => Err(format!("No se pudo preparar la ejecución: {e}")),
    };

    let grant_state = grant::take(&stream_id);
    let finished = Utc::now();
    let (reply, error, result) = match &outcome_result {
        Ok(v) => (
            v.get("reply")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string(),
            None,
            Some(v),
        ),
        Err(e) => (String::new(), Some(e.clone()), None),
    };
    let outcome = decide_outcome(&reply, error.as_deref(), &encargo, grant_state.as_ref());
    let steps = step_lines(result);
    let report = render_report(
        &encargo,
        started,
        finished,
        outcome,
        &reply,
        error.as_deref(),
        grant_state.as_ref(),
        &steps,
    );
    let report_rel = format!(
        "{}/informe-{}.md",
        encargo.folder,
        started.with_timezone(&Local).format("%Y-%m-%d-%H%M")
    );
    let report_saved = resolve_inside_workspace(&root, &report_rel, false)
        .and_then(|(abs, _, _)| write_string_atomic(&abs, &report))
        .is_ok();

    if let Ok(conn) = open_workspace_db(&root) {
        let _ = store::finish_run(
            &conn,
            &encargo,
            &run_id,
            outcome,
            report_saved.then_some(report_rel.as_str()),
            &steps,
            finished,
        );
    }
    RUNNING.store(false, Ordering::SeqCst);

    let _ = app.emit(
        ENCARGO_FINISHED_EVENT,
        json!({
            "id": encargo.id,
            "name": encargo.name,
            "outcome": outcome,
            "reportPath": report_saved.then_some(report_rel),
        }),
    );
    emit_updated(&app);
    if outcome == "hecho" {
        notify(
            &format!("Listo: «{}»", encargo.name),
            "Xox terminó el pendiente. El informe está en Pendientes.",
        );
    } else {
        notify(
            &format!("Xox se detuvo en «{}»", encargo.name),
            "Abre el informe en Pendientes para ver qué falta.",
        );
    }
}

/// Aviso del sistema. En macOS con `osascript`; en los demás sistemas basta el aviso de la app.
fn notify(title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display notification \"{}\" with title \"XOOK\" subtitle \"{}\"",
            esc(body),
            esc(title)
        );
        let _ = std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (title, body);
    }
}

/// Evita que la Mac se duerma por inactividad hasta `until` (`caffeinate -i`).
fn keep_awake_until(until: DateTime<Utc>, now: DateTime<Utc>) {
    #[cfg(target_os = "macos")]
    {
        use std::process::Child;
        use std::sync::Mutex;
        static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);

        let Ok(mut slot) = CAFFEINATE.lock() else {
            return;
        };
        if let Some(child) = slot.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return;
            }
        }
        let secs = (until - now).num_seconds().clamp(60, 3 * 3600);
        *slot = std::process::Command::new("/usr/bin/caffeinate")
            .arg("-i")
            .arg("-t")
            .arg(secs.to_string())
            .spawn()
            .ok();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (until, now);
    }
}

/// Con la sesión bloqueada, la accesibilidad no puede usar otras apps.
fn screen_locked() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_session::screen_locked()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
mod macos_session {
    use std::ffi::{c_char, c_void};

    type CFTypeRef = *const c_void;
    const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFTypeRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
        fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFTypeRef;
        fn CFRelease(cf: CFTypeRef);
    }

    /// `CGSSessionScreenIsLocked` solo aparece en el diccionario de la sesión cuando está bloqueada.
    pub fn screen_locked() -> bool {
        unsafe {
            let dict = CGSessionCopyCurrentDictionary();
            if dict.is_null() {
                return false;
            }
            let key = CFStringCreateWithCString(
                std::ptr::null(),
                c"CGSSessionScreenIsLocked".as_ptr(),
                K_CF_STRING_ENCODING_UTF8,
            );
            let locked = !key.is_null() && CFDictionaryGetValue(dict, key) == kCFBooleanTrue;
            if !key.is_null() {
                CFRelease(key);
            }
            CFRelease(dict);
            locked
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encargo(may_finish: bool) -> EncargoDto {
        EncargoDto {
            id: "enc_1".to_string(),
            name: "Práctica 3".to_string(),
            instruction: "Entrega reporte.pdf a las 4 en Teams".to_string(),
            steps: vec!["Abrir Teams".to_string(), "Entregar".to_string()],
            files: vec!["agente/encargos/practica-3/archivos/reporte.pdf".to_string()],
            folder: "agente/encargos/practica-3".to_string(),
            next_run_at: Some(Utc::now().to_rfc3339()),
            recurrence: None,
            target_app: Some("Microsoft Teams".to_string()),
            may_finish,
            final_action: may_finish.then(|| "Entregar · Práctica 3".to_string()),
            status: "en_curso".to_string(),
            source_card_id: None,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn message_carries_instruction_files_final_click_and_procedure() {
        let msg = build_run_message(&encargo(true), Some("1. Tareas › Práctica 3"), Utc::now());
        assert!(msg.contains("> Entrega reporte.pdf a las 4 en Teams"));
        assert!(msg.contains("- agente/encargos/practica-3/archivos/reporte.pdf"));
        assert!(msg.contains("da el último clic «Entregar · Práctica 3»"));
        assert!(msg.contains("memoria/procedimientos/microsoft-teams.md"));
        assert!(msg.contains("1. Tareas › Práctica 3"));

        let ready = build_run_message(&encargo(false), None, Utc::now());
        assert!(ready.contains("NO des el último clic"));
        assert!(ready.contains("Todavía no hay ruta aprendida"));
    }

    #[test]
    fn outcome_requires_declaration_and_the_real_final_click() {
        let enc = encargo(true);
        let mut g = EncargoGrant::new(Some("Microsoft Teams"), true, Some("Entregar"));
        let reply = "Adjunté el PDF y lo entregué.\n\nRESULTADO: hecho";
        assert_eq!(decide_outcome(reply, None, &enc, Some(&g)), "detenido");
        g.final_used = true;
        assert_eq!(decide_outcome(reply, None, &enc, Some(&g)), "hecho");
        assert_eq!(
            decide_outcome(
                "RESULTADO: detenido — no encontré la actividad",
                None,
                &enc,
                Some(&g)
            ),
            "detenido"
        );
        assert_eq!(
            decide_outcome(reply, Some("sin clave"), &enc, Some(&g)),
            "detenido"
        );
        // Sin permiso para terminar, basta con la declaración.
        assert_eq!(decide_outcome(reply, None, &encargo(false), None), "hecho");
    }

    #[test]
    fn report_lists_reply_blocked_actions_and_steps() {
        let enc = encargo(true);
        let mut g = EncargoGrant::new(Some("Microsoft Teams"), true, Some("Entregar"));
        g.blocked
            .push("Este pendiente solo autoriza «Entregar», no «enviar».".to_string());
        let md = render_report(
            &enc,
            Utc::now(),
            Utc::now(),
            "detenido",
            "No encontré la actividad.\nRESULTADO: detenido",
            None,
            Some(&g),
            &["Abrir Teams".to_string()],
        );
        assert!(md.starts_with("# Práctica 3 · Me detuve"));
        assert!(md.contains("**Último clic (Entregar · Práctica 3):** no se dio"));
        assert!(md.contains("no «enviar»"));
        assert!(md.contains("- Abrir Teams"));
    }

    #[test]
    fn rehearsal_reports_missing_file_app_and_locked_session() {
        let root = std::env::temp_dir().join(format!(
            "xook_rehearsal_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let folder = root.join("agente/encargos/practica-3/archivos");
        fs::create_dir_all(&folder).unwrap();
        let enc = encargo(true);

        let problems = rehearsal_problems(&root, &enc, |_| false, true);
        assert_eq!(problems.len(), 3);
        assert!(problems[0].contains("reporte.pdf"));
        assert!(problems[1].contains("no está instalada"));
        assert!(problems[2].contains("bloqueada"));

        fs::write(folder.join("reporte.pdf"), b"%PDF").unwrap();
        assert!(rehearsal_problems(&root, &enc, |_| true, false).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn procedure_path_is_a_stable_slug() {
        assert_eq!(
            procedure_rel_path("Microsoft Teams (work or school)"),
            "memoria/procedimientos/microsoft-teams-work-or-school.md"
        );
    }
}
