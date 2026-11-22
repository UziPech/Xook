use super::macos_ax::{
    DesktopActionOutput, DesktopDisposition, DesktopFindOptions, DesktopSnapshotOptions,
    DesktopSnapshotOutput, find_elements, focus_desktop_window, list_desktop_windows,
    perform_coordinate_click, perform_press_key, perform_semantic_ref_action, perform_type_text,
    pick_target_window, snapshot_window,
};
use super::policy::{
    DesktopOperation, ParsedKeyCombo, desktop_app_capability_key, detect_high_risk_ui_target,
    detect_sensitive_window, is_blocked_key_combo, is_commit_key_combo,
    is_electron_or_chromium_app, parse_key_combo, policy_for,
};
use super::store::{DesktopControlState, DesktopWindowInfo, RefEntry};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowListOutput {
    pub ok: bool,
    pub accessibility_granted: bool,
    pub windows: Vec<DesktopWindowInfo>,
}

/// Plan validado previo al Guardián HITL para `desktop_act`.
pub struct PreparedDesktopAction {
    pub op: DesktopOperation,
    pub ref_entry: Option<RefEntry>,
    pub target_window: DesktopWindowInfo,
    pub capability_key: String,
    pub risk_level: &'static str,
    pub force_ask_once: bool,
    pub display_cmd: String,
    pub detail_preview: String,
    pub value: Option<String>,
    pub key_combo: Option<ParsedKeyCombo>,
    pub clear_first: bool,
    pub press_enter: bool,
    pub headed: bool,
    pub coord_xy: Option<(f64, f64)>,
}

pub struct DesktopActionParams<'a> {
    pub action: &'a str,
    pub ref_id: Option<&'a str>,
    pub value: Option<String>,
    pub key: Option<&'a str>,
    pub clear_first: bool,
    pub press_enter: bool,
    pub headed: bool,
    pub coord_xy: Option<(f64, f64)>,
    pub app_name: Option<&'a str>,
    pub window_id: Option<u32>,
}

pub fn list_windows_for_agent() -> DesktopWindowListOutput {
    let (accessibility_granted, windows) = list_desktop_windows();
    DesktopWindowListOutput {
        ok: true,
        accessibility_granted,
        windows,
    }
}

pub fn snapshot_for_agent<R: Runtime>(
    app: &AppHandle<R>,
    opts: &DesktopSnapshotOptions,
) -> DesktopSnapshotOutput {
    let state = app.state::<DesktopControlState>();
    snapshot_window(&state, opts)
}

pub fn find_for_agent<R: Runtime>(
    app: &AppHandle<R>,
    opts: &DesktopFindOptions,
) -> DesktopSnapshotOutput {
    let state = app.state::<DesktopControlState>();
    find_elements(&state, opts)
}

fn resolve_target_window(
    window_id: Option<u32>,
    app_name: Option<&str>,
) -> Result<DesktopWindowInfo, (String, DesktopDisposition)> {
    let (_, windows) = list_desktop_windows();
    let chosen = pick_target_window(&windows, window_id, app_name).ok_or_else(|| {
        (
            "No se encontró una ventana visible que coincida con el objetivo. Usa desktop_list_windows primero."
                .to_string(),
            DesktopDisposition::not_delivered(None),
        )
    })?;
    if let Some(reason) = chosen.sensitive_reason.clone() {
        return Err((reason, DesktopDisposition::not_delivered(None)));
    }
    Ok(chosen)
}

fn window_info_from_ref(entry: &RefEntry) -> DesktopWindowInfo {
    let (_, windows) = list_desktop_windows();
    if let Some(live) = windows
        .into_iter()
        .find(|w| w.window_id == entry.window_id || w.pid == entry.pid)
    {
        return live;
    }
    DesktopWindowInfo {
        window_id: entry.window_id,
        pid: entry.pid,
        app_name: entry.app_name.clone(),
        bundle_id: entry.bundle_id.clone(),
        title: entry.window_title.clone(),
        bounds: entry.bounds.unwrap_or_default(),
        is_sensitive: false,
        sensitive_reason: None,
    }
}

/// Valida argumentos, resuelve la ref o ventana y determina el riesgo HITL exacto
/// ANTES de mostrar la tarjeta de permiso al usuario.
pub fn prepare_desktop_action<R: Runtime>(
    app: &AppHandle<R>,
    params: DesktopActionParams<'_>,
) -> Result<PreparedDesktopAction, (String, DesktopDisposition)> {
    let op = DesktopOperation::from_action_str(params.action)
        .map_err(|e| (e, DesktopDisposition::not_delivered(None)))?;
    let base_policy = policy_for(op);

    // 1. FocusWindow
    if op == DesktopOperation::FocusWindow {
        let chosen = resolve_target_window(params.window_id, params.app_name)?;
        let capability_key = desktop_app_capability_key(&chosen.bundle_id, &chosen.app_name);
        let display_cmd = format!(
            "desktop_ui: enfocar '{}' ({})",
            chosen.title, chosen.app_name
        );
        let detail_preview = format!(
            "Acción: Traer al frente ventana\nApp: {}\nVentana: {}",
            chosen.app_name, chosen.title
        );
        return Ok(PreparedDesktopAction {
            op,
            ref_entry: None,
            target_window: chosen,
            capability_key,
            risk_level: base_policy.base_risk_level,
            force_ask_once: !base_policy.allow_always_by_default,
            display_cmd,
            detail_preview,
            value: None,
            key_combo: None,
            clear_first: false,
            press_enter: false,
            headed: false,
            coord_xy: None,
        });
    }

    // 2. Resolver RefEntry si se pasó ref_id
    let raw_ref = params.ref_id.map(str::trim).filter(|s| !s.is_empty());
    let ref_entry = if let Some(rid) = raw_ref {
        let state = app.state::<DesktopControlState>();
        let entry = state
            .resolve_ref(rid)
            .map_err(|e| (e, DesktopDisposition::not_delivered(None)))?;
        if entry.is_secure {
            return Err((
                "Bloqueado por privacidad: no se permite operar sobre campos de contraseña."
                    .to_string(),
                DesktopDisposition::not_delivered(None),
            ));
        }
        if let Some(reason) =
            detect_sensitive_window(&entry.bundle_id, &entry.app_name, &entry.window_title)
        {
            return Err((reason, DesktopDisposition::not_delivered(None)));
        }
        Some(entry)
    } else {
        None
    };

    // 3. PressKey (puede operar sobre ventana enfocada o sobre un ref_id)
    if op == DesktopOperation::PressKey {
        let raw_key = params.key.unwrap_or("").trim();
        let combo = parse_key_combo(raw_key)
            .map_err(|e| (e, DesktopDisposition::not_delivered(None)))?;
        if is_blocked_key_combo(&combo) {
            return Err((
                format!(
                    "Bloqueado por Guardián Capa 1: el atajo '{}' está prohibido por seguridad.",
                    combo.display
                ),
                DesktopDisposition::not_delivered(None),
            ));
        }
        // Validar que el código de tecla exista antes de pedir permiso al usuario
        let _ = super::macos_ax::macos_key_code(&combo.key)
            .map_err(|e| (e, DesktopDisposition::not_delivered(None)))?;

        let target_window = match ref_entry.as_ref() {
            Some(e) => window_info_from_ref(e),
            None => resolve_target_window(params.window_id, params.app_name)?,
        };
        let is_commit = is_commit_key_combo(&combo);
        let capability_key =
            desktop_app_capability_key(&target_window.bundle_id, &target_window.app_name);
        let display_cmd = format!(
            "desktop_ui: presionar '{}' en {}",
            combo.display, target_window.app_name
        );
        let mut preview = format!(
            "Acción: Presionar tecla '{}'\nApp: {} · Ventana: {}",
            combo.display, target_window.app_name, target_window.title
        );
        if is_commit {
            preview.push_str("\nConfirmación obligatoria: esta tecla puede enviar o confirmar cambios.");
        }
        return Ok(PreparedDesktopAction {
            op,
            ref_entry,
            target_window,
            capability_key,
            risk_level: if is_commit { "high" } else { "medium" },
            force_ask_once: is_commit,
            display_cmd,
            detail_preview: preview,
            value: None,
            key_combo: Some(combo),
            clear_first: false,
            press_enter: false,
            headed: true,
            coord_xy: None,
        });
    }

    // 4. TypeText (escribe Unicode vía CGEvent; exige ref_id o coordenadas explícitas en Electron/Chromium)
    if op == DesktopOperation::TypeText {
        let text = params
            .value
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                (
                    "Falta 'value' con el texto a escribir para `action='type_text'`.".to_string(),
                    DesktopDisposition::not_delivered(None),
                )
            })?;
        let target_window = match ref_entry.as_ref() {
            Some(e) => window_info_from_ref(e),
            None => resolve_target_window(params.window_id, params.app_name)?,
        };
        if ref_entry.is_none() && params.coord_xy.is_none() {
            if is_electron_or_chromium_app(&target_window.bundle_id, &target_window.app_name) {
                return Err((
                    format!(
                        "BLOCKED_BLIND_TYPE: En apps Electron/Chromium ('{}') está prohibido usar `type_text` solo con `app_name` porque activar la ventana no enfoca el editor DOM. Ejecuta `desktop_find(app_name='{}', roles=['textarea','textfield'])` SIN query para obtener un `ref_id` verificado (`sN:@eM`), o pasa coordenadas físicas explícitas `(x, y)` dentro de la ventana.",
                        target_window.app_name, target_window.app_name
                    ),
                    DesktopDisposition::not_delivered(Some(
                        "Prohibido escribir a ciegas por app_name en apps Electron/Chromium.".to_string(),
                    )),
                ));
            }
        }
        if ref_entry.is_none() {
            if let Some((x, y)) = params.coord_xy {
                let b = target_window.bounds;
                if x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height {
                    return Err((
                        format!(
                            "Coordenadas ({x:.0}, {y:.0}) fuera de los límites de la ventana '{}' ({},{},{}x{}).",
                            target_window.title, b.x as i64, b.y as i64, b.width as i64, b.height as i64
                        ),
                        DesktopDisposition::not_delivered(None),
                    ));
                }
            }
        }
        let short_v: String = text.chars().take(120).collect();
        let high_risk_target = ref_entry
            .as_ref()
            .and_then(|e| detect_high_risk_ui_target(&e.name, &e.description));
        let uses_coords = ref_entry.is_none() && params.coord_xy.is_some();
        let force_ask = params.press_enter || high_risk_target.is_some() || uses_coords;
        let capability_key =
            desktop_app_capability_key(&target_window.bundle_id, &target_window.app_name);
        let verb = if params.press_enter {
            "Escribir y enviar (Enter)"
        } else {
            "Escribir texto"
        };
        let display_cmd = format!("desktop_ui: {verb} en {}", target_window.app_name);
        let mut preview = format!(
            "Acción: {verb}\nApp: {} · Ventana: {}\nTexto: \"{short_v}\"",
            target_window.app_name, target_window.title
        );
        if let Some(ref e) = ref_entry {
            if !e.name.is_empty() {
                preview.push_str(&format!("\nControl: {} «{}» ({})", e.role, e.name, e.ref_id));
            }
        } else if let Some((x, y)) = params.coord_xy {
            preview.push_str(&format!("\nDestino: clic físico en ({:.0}, {:.0}) antes de escribir", x, y));
        }
        if params.press_enter {
            preview.push_str("\nConfirmación obligatoria: enviará el texto con Enter.");
        }

        return Ok(PreparedDesktopAction {
            op,
            ref_entry,
            target_window,
            capability_key,
            risk_level: if force_ask { "high" } else { "medium" },
            force_ask_once: force_ask,
            display_cmd,
            detail_preview: preview,
            value: params.value,
            key_combo: None,
            clear_first: params.clear_first,
            press_enter: params.press_enter,
            headed: true,
            coord_xy: if uses_coords { params.coord_xy } else { None },
        });
    }

    // 5. Click por coordenadas explícitas dentro de la ventana objetivo (cuando no hay ref_id)
    if op == DesktopOperation::Click && ref_entry.is_none() {
        if let Some((x, y)) = params.coord_xy {
            let target_window = resolve_target_window(params.window_id, params.app_name)?;
            let capability_key =
                desktop_app_capability_key(&target_window.bundle_id, &target_window.app_name);
            let display_cmd = format!(
                "desktop_ui: clic en ({:.0}, {:.0}) dentro de {}",
                x, y, target_window.app_name
            );
            let detail_preview = format!(
                "Acción: Clic físico en coordenadas ({:.0}, {:.0})\nApp: {} · Ventana: {}\nConfirmación obligatoria: clic por coordenadas.",
                x, y, target_window.app_name, target_window.title
            );
            return Ok(PreparedDesktopAction {
                op,
                ref_entry: None,
                target_window,
                capability_key,
                risk_level: "high",
                force_ask_once: true,
                display_cmd,
                detail_preview,
                value: None,
                key_combo: None,
                clear_first: false,
                press_enter: false,
                headed: true,
                coord_xy: Some((x, y)),
            });
        }
    }

    // 6. Acciones basadas en ref_id (Click, SetValue, Focus, ScrollTo)
    let Some(entry) = ref_entry else {
        return Err((
            format!(
                "Falta 'ref_id' (ej. 's1:@e4') para la acción '{}'. Ejecuta desktop_find o desktop_snapshot primero.",
                op.as_str()
            ),
            DesktopDisposition::not_delivered(None),
        ));
    };

    if op == DesktopOperation::SetValue && params.value.is_none() {
        return Err((
            "Falta 'value' con el texto a escribir en el control.".to_string(),
            DesktopDisposition::not_delivered(None),
        ));
    }

    let high_risk_match = if matches!(op, DesktopOperation::Click | DesktopOperation::SetValue) {
        detect_high_risk_ui_target(&entry.name, &entry.description)
    } else {
        None
    };

    let risk_level = if high_risk_match.is_some() {
        "high"
    } else {
        base_policy.base_risk_level
    };
    let force_ask_once = high_risk_match.is_some() || !base_policy.allow_always_by_default;

    let label = if entry.name.is_empty() {
        format!("{} ({})", entry.role, entry.ref_id)
    } else {
        format!("{} «{}» ({})", entry.role, entry.name, entry.ref_id)
    };
    let target_window = window_info_from_ref(&entry);
    let capability_key = desktop_app_capability_key(&entry.bundle_id, &entry.app_name);
    let display_cmd = format!(
        "desktop_ui: {} {} en {}",
        op.human_verb_es(),
        label,
        entry.app_name
    );

    let mut preview = format!(
        "Acción: {} {}\nApp: {} · Ventana: {}",
        op.human_verb_es(),
        label,
        entry.app_name,
        entry.window_title
    );
    if let Some(ref v) = params.value {
        let short_v: String = v.chars().take(80).collect();
        preview.push_str(&format!("\nTexto: \"{short_v}\""));
    }
    if let Some(flag) = high_risk_match {
        preview.push_str(&format!(
            "\nConfirmación obligatoria: acción sensible detectada ('{flag}')."
        ));
    }

    Ok(PreparedDesktopAction {
        op,
        ref_entry: Some(entry),
        target_window,
        capability_key,
        risk_level,
        force_ask_once,
        display_cmd,
        detail_preview: preview,
        value: params.value,
        key_combo: None,
        clear_first: false,
        press_enter: false,
        headed: params.headed,
        coord_xy: None,
    })
}

pub fn execute_prepared_desktop_action(prepared: &PreparedDesktopAction) -> DesktopActionOutput {
    match prepared.op {
        DesktopOperation::FocusWindow => focus_desktop_window(
            Some(prepared.target_window.window_id),
            Some(&prepared.target_window.app_name),
        ),
        DesktopOperation::TypeText => perform_type_text(
            prepared.ref_entry.as_ref(),
            &prepared.target_window,
            prepared.coord_xy,
            prepared.value.as_deref().unwrap_or(""),
            prepared.clear_first,
            prepared.press_enter,
        ),
        DesktopOperation::PressKey => match prepared.key_combo.as_ref() {
            Some(combo) => perform_press_key(
                prepared.ref_entry.as_ref(),
                &prepared.target_window,
                combo,
            ),
            None => DesktopActionOutput {
                ok: false,
                action: prepared.op.as_str().to_string(),
                ref_id: None,
                app_name: prepared.target_window.app_name.clone(),
                bundle_id: prepared.target_window.bundle_id.clone(),
                window_title: prepared.target_window.title.clone(),
                mechanism: "physical_cgevent".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::not_delivered(None),
                error: Some("Falta la tecla a presionar.".to_string()),
            },
        },
        DesktopOperation::Click if prepared.ref_entry.is_none() => {
            if let Some((x, y)) = prepared.coord_xy {
                perform_coordinate_click(&prepared.target_window, x, y)
            } else {
                DesktopActionOutput {
                    ok: false,
                    action: DesktopOperation::Click.as_str().to_string(),
                    ref_id: None,
                    app_name: prepared.target_window.app_name.clone(),
                    bundle_id: prepared.target_window.bundle_id.clone(),
                    window_title: prepared.target_window.title.clone(),
                    mechanism: "physical_cgevent".to_string(),
                    summary: String::new(),
                    post_value: None,
                    disposition: DesktopDisposition::not_delivered(None),
                    error: Some("Falta ref_id o coordenadas (x, y) para hacer clic.".to_string()),
                }
            }
        }
        _ => match prepared.ref_entry.as_ref() {
            Some(entry) => perform_semantic_ref_action(
                entry,
                prepared.op,
                prepared.value.as_deref(),
                prepared.headed,
            ),
            None => DesktopActionOutput {
                ok: false,
                action: prepared.op.as_str().to_string(),
                ref_id: None,
                app_name: prepared.target_window.app_name.clone(),
                bundle_id: prepared.target_window.bundle_id.clone(),
                window_title: prepared.target_window.title.clone(),
                mechanism: "semantic_ax".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::not_delivered(None),
                error: Some("Falta referencia de elemento para ejecutar la acción.".to_string()),
            },
        },
    }
}

#[tauri::command]
pub fn desktop_list_windows_cmd() -> DesktopWindowListOutput {
    list_windows_for_agent()
}

#[tauri::command]
pub fn desktop_snapshot_cmd<R: Runtime>(
    app: AppHandle<R>,
    app_name: Option<String>,
    window_id: Option<u32>,
    root_ref: Option<String>,
    interactive_only: Option<bool>,
) -> DesktopSnapshotOutput {
    let opts = DesktopSnapshotOptions {
        app_name,
        window_id,
        root_ref,
        interactive_only: interactive_only.unwrap_or(false),
        ..Default::default()
    };
    snapshot_for_agent(&app, &opts)
}

#[tauri::command]
pub fn desktop_find_cmd<R: Runtime>(
    app: AppHandle<R>,
    app_name: Option<String>,
    window_id: Option<u32>,
    root_ref: Option<String>,
    query: Option<String>,
    roles: Option<Vec<String>>,
    limit: Option<usize>,
    max_nodes: Option<usize>,
) -> DesktopSnapshotOutput {
    let opts = DesktopFindOptions {
        app_name,
        window_id,
        root_ref,
        query: query.unwrap_or_default(),
        roles: roles.unwrap_or_default(),
        limit: limit.unwrap_or(25),
        max_nodes: max_nodes.unwrap_or(2400),
    };
    find_for_agent(&app, &opts)
}
