use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Runtime,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";
const TRAY_ID: &str = "xook-tray";

const QUICK_WIDTH: f64 = 700.0;
const QUICK_HEIGHT: f64 = 340.0;
const FOCUS_GRACE_MS: u64 = 240;
const DISMISS_ANIM_MS: u64 = 160;

#[derive(Default)]
pub struct SummonState {
    pub is_quitting: AtomicBool,
    last_quick_shown_ms: AtomicU64,
    summon_seq: AtomicU64,
    quick_dismissing: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSummonPayload {
    pub seq: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickTransferPayload {
    pub prompt: Option<String>,
    pub auto_run: bool,
    pub response_text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainSummonPayload {
    pub seq: u64,
    pub prompt: Option<String>,
    pub auto_run: bool,
    pub response_text: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn build_summon_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    {
        Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyX)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyX)
    }
}

/// Dibuja la silueta de Xox (estrella de 5 puntas redondeadas + ojos) como icono plantilla RGBA 44x44.
pub fn render_xox_tray_icon() -> Image<'static> {
    const SIZE: usize = 44;
    const CENTER: f32 = 22.0;
    const SCALE: f32 = 40.0 / 130.0;
    const SRC_CENTER: f32 = 120.0;

    // Geometría base fiel a XoxStar.tsx
    const PEAKS: [(f32, f32); 5] = [
        (-84.0, 65.0),
        (-12.0, 63.0),
        (60.0, 58.0),
        (124.0, 59.0),
        (198.0, 64.0),
    ];
    const VALLEYS: [(f32, f32); 5] = [
        (-48.0, 34.0),
        (24.0, 33.0),
        (92.0, 36.0),
        (161.0, 33.0),
        (236.0, 34.0),
    ];

    let mut anchors: Vec<(f32, f32, f32)> = Vec::with_capacity(10);
    for i in 0..5 {
        let (pa, pr) = PEAKS[i];
        let pr_rad = pa.to_radians();
        anchors.push((
            CENTER + pr * SCALE * pr_rad.cos(),
            CENTER + 0.5 + pr * SCALE * pr_rad.sin(),
            15.0 * SCALE,
        ));

        let (va, vr) = VALLEYS[i];
        let vr_rad = va.to_radians();
        anchors.push((
            CENTER + vr * SCALE * vr_rad.cos(),
            CENTER + 0.5 + vr * SCALE * vr_rad.sin(),
            13.0 * SCALE,
        ));
    }

    // Muestrea el contorno con esquinas cuadráticas redondeadas en un polígono denso
    let n = anchors.len();
    let mut poly: Vec<(f32, f32)> = Vec::with_capacity(n * 10);
    for i in 0..n {
        let p0 = anchors[(i + n - 1) % n];
        let p1 = anchors[i];
        let p2 = anchors[(i + 1) % n];

        let (d1x, d1y) = (p1.0 - p0.0, p1.1 - p0.1);
        let l1 = d1x.hypot(d1y).max(0.001);
        let (d2x, d2y) = (p2.0 - p1.0, p2.1 - p1.1);
        let l2 = d2x.hypot(d2y).max(0.001);

        let r = p1.2.min(l1 * 0.46).min(l2 * 0.46);
        let ax = p1.0 - (d1x / l1) * r;
        let ay = p1.1 - (d1y / l1) * r;
        let bx = p1.0 + (d2x / l2) * r;
        let by = p1.1 + (d2y / l2) * r;

        for step in 0..=8 {
            let t = step as f32 / 8.0;
            let inv = 1.0 - t;
            let x = inv * inv * ax + 2.0 * inv * t * p1.0 + t * t * bx;
            let y = inv * inv * ay + 2.0 * inv * t * p1.1 + t * t * by;
            poly.push((x, y));
        }
    }

    // Coordenadas de los ojos dentro de la silueta
    let eye_left_x = CENTER - 8.5 * (SCALE * 1.15);
    let eye_right_x = CENTER + 8.5 * (SCALE * 1.15);
    let eye_y = CENTER + 0.5 - 3.0 * SCALE;
    let eye_rx = 1.85_f32;
    let eye_ry = 2.85_f32;
    let _ = SRC_CENTER;

    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    for py in 0..SIZE {
        for px in 0..SIZE {
            let x = px as f32 + 0.5;
            let y = py as f32 + 0.5;

            let sd_star = signed_distance_polygon(x, y, &poly);
            let star_alpha = smoothstep(0.85, -0.85, sd_star);

            // Recorte de ojos para mantener la expresión reconocible de Xox
            let dl = (((x - eye_left_x) / eye_rx).powi(2) + ((y - eye_y) / eye_ry).powi(2)).sqrt() - 1.0;
            let dr = (((x - eye_right_x) / eye_rx).powi(2) + ((y - eye_y) / eye_ry).powi(2)).sqrt() - 1.0;
            let eye_l_alpha = smoothstep(-0.35, 0.35, dl);
            let eye_r_alpha = smoothstep(-0.35, 0.35, dr);

            let alpha = (star_alpha * eye_l_alpha * eye_r_alpha).clamp(0.0, 1.0);
            let idx = (py * SIZE + px) * 4;
            rgba[idx] = 255;
            rgba[idx + 1] = 255;
            rgba[idx + 2] = 255;
            rgba[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn signed_distance_polygon(px: f32, py: f32, poly: &[(f32, f32)]) -> f32 {
    let mut min_dist_sq = f32::MAX;
    let mut inside = false;
    let len = poly.len();

    for i in 0..len {
        let a = poly[i];
        let b = poly[(i + 1) % len];

        let ex = b.0 - a.0;
        let ey = b.1 - a.1;
        let wx = px - a.0;
        let wy = py - a.1;
        let denom = (ex * ex + ey * ey).max(1e-6);
        let t = ((wx * ex + wy * ey) / denom).clamp(0.0, 1.0);
        let dx = wx - ex * t;
        let dy = wy - ey * t;
        let d2 = dx * dx + dy * dy;
        if d2 < min_dist_sq {
            min_dist_sq = d2;
        }

        let cond_y = (a.1 > py) != (b.1 > py);
        if cond_y {
            let intersect_x = (b.0 - a.0) * (py - a.1) / (b.1 - a.1) + a.0;
            if px < intersect_x {
                inside = !inside;
            }
        }
    }

    let dist = min_dist_sq.sqrt();
    if inside { -dist } else { dist }
}

fn ensure_quick_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    if let Some(win) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        return Some(win);
    }

    match WebviewWindowBuilder::new(
        app,
        QUICK_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Xox Quick Bar")
    .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .focused(false)
    .initialization_script("window.__XOOK_WINDOW_MODE__ = 'quick';")
    .build()
    {
        Ok(win) => Some(win),
        Err(err) => {
            eprintln!("⚠️ [XOOK Quick Bar] No se pudo crear la ventana flotante: {err}");
            None
        }
    }
}

fn position_quick_on_active_monitor<R: Runtime>(app: &AppHandle<R>, quick: &WebviewWindow<R>) {
    // Buscamos el monitor donde está el cursor comparando coordenadas físicas para evitar discrepancias de escala Retina.
    let target_monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| {
            app.available_monitors().ok()?.into_iter().find(|m| {
                let pos = m.position();
                let size = m.size();
                cursor.x >= pos.x as f64
                    && cursor.x < pos.x as f64 + size.width as f64
                    && cursor.y >= pos.y as f64
                    && cursor.y < pos.y as f64 + size.height as f64
            })
        })
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = target_monitor {
        let work = monitor.work_area();
        let scale = monitor.scale_factor();
        let win_size = quick
            .outer_size()
            .unwrap_or_else(|_| {
                PhysicalSize::new(
                    (QUICK_WIDTH * scale).round() as u32,
                    (QUICK_HEIGHT * scale).round() as u32,
                )
            });

        let x = work.position.x + ((work.size.width as i32 - win_size.width as i32) / 2);
        let y = work.position.y + ((work.size.height as f64 * 0.16).round() as i32);
        let _ = quick.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    } else {
        let _ = quick.center();
    }
}

pub fn show_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let Some(quick) = ensure_quick_window(app) else {
        return;
    };

    let state = app.state::<SummonState>();
    state.quick_dismissing.store(false, Ordering::SeqCst);
    let seq = state.summon_seq.fetch_add(1, Ordering::SeqCst) + 1;
    state.last_quick_shown_ms.store(now_ms(), Ordering::SeqCst);

    position_quick_on_active_monitor(app, &quick);
    let _ = quick.show();
    let _ = quick.set_focus();

    let _ = app.emit_to(
        QUICK_WINDOW_LABEL,
        "quick:summon",
        QuickSummonPayload { seq },
    );
}

pub fn request_dismiss_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
        return;
    };
    if !quick.is_visible().unwrap_or(false) {
        return;
    }

    let state = app.state::<SummonState>();
    if state.quick_dismissing.swap(true, Ordering::SeqCst) {
        return;
    }

    let seq = state.summon_seq.load(Ordering::SeqCst);
    let _ = app.emit_to(
        QUICK_WINDOW_LABEL,
        "quick:dismiss",
        QuickSummonPayload { seq },
    );

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(DISMISS_ANIM_MS)).await;
        let state = handle.state::<SummonState>();
        if state.summon_seq.load(Ordering::SeqCst) == seq
            && state.quick_dismissing.swap(false, Ordering::SeqCst)
        {
            if let Some(win) = handle.get_webview_window(QUICK_WINDOW_LABEL) {
                let _ = win.hide();
            }
        }
    });
}

pub fn hide_quick_bar_now<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SummonState>();
    state.quick_dismissing.store(false, Ordering::SeqCst);
    state.summon_seq.fetch_add(1, Ordering::SeqCst);

    if let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        let _ = quick.hide();
    }
}

pub fn toggle_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    if let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        if quick.is_visible().unwrap_or(false) {
            let state = app.state::<SummonState>();
            if state.quick_dismissing.load(Ordering::SeqCst) {
                show_quick_bar(app);
            } else {
                request_dismiss_quick_bar(app);
            }
            return;
        }
    }
    show_quick_bar(app);
}

pub fn show_main_workspace<R: Runtime>(
    app: &AppHandle<R>,
    transfer: Option<QuickTransferPayload>,
) {
    hide_quick_bar_now(app);

    let state = app.state::<SummonState>();
    let seq = state.summon_seq.fetch_add(1, Ordering::SeqCst) + 1;

    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }

    let payload = match transfer {
        Some(t) => MainSummonPayload {
            seq,
            prompt: t.prompt,
            auto_run: t.auto_run,
            response_text: t.response_text,
        },
        None => MainSummonPayload {
            seq,
            prompt: None,
            auto_run: false,
            response_text: None,
        },
    };
    let _ = app.emit_to(MAIN_WINDOW_LABEL, "main:summon", payload);
}

#[tauri::command]
pub fn hide_quick_bar(app: AppHandle) {
    hide_quick_bar_now(&app);
}

#[tauri::command]
pub fn toggle_quick_bar_cmd(app: AppHandle) {
    toggle_quick_bar(&app);
}

#[tauri::command]
pub fn open_main_workspace(app: AppHandle, payload: Option<QuickTransferPayload>) {
    show_main_workspace(&app, payload);
}

pub fn setup_quick_summon<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // 1. Pre-creamos la ventana flotante oculta para que aparezca en <15ms al invocar ⌘⇧X
    let _ = ensure_quick_window(app);

    // 2. Registramos el atajo global ⌘ + ⇧ + X (Ctrl + Shift + X fuera de macOS)
    let summon_shortcut = build_summon_shortcut();
    if let Err(err) = app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app_handle, shortcut, event| {
                if shortcut == &summon_shortcut && event.state() == ShortcutState::Pressed {
                    toggle_quick_bar(app_handle);
                }
            })
            .build(),
    ) {
        eprintln!("⚠️ [XOOK] No se pudo inicializar global-shortcut: {err}");
    } else if let Err(err) = app.global_shortcut().register(summon_shortcut) {
        eprintln!("⚠️ [XOOK] No se pudo registrar ⌘+⇧+X (posible conflicto con otra app): {err}");
    }

    // 3. Icono de Xox en la barra de menú de macOS para vivir en segundo plano
    let shortcut_hint = if cfg!(target_os = "macos") {
        "⌘⇧X"
    } else {
        "Ctrl+Shift+X"
    };

    let summon_item = MenuItem::with_id(
        app,
        "summon_quick",
        format!("Invocar Xox Quick Bar ({shortcut_hint})"),
        true,
        None::<&str>,
    )?;
    let open_main_item = MenuItem::with_id(
        app,
        "open_main",
        "Abrir XOOK Workspace",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir de XOOK", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&summon_item, &open_main_item, &separator, &quit_item])?;
    let tray_icon = render_xox_tray_icon();

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .tooltip("XOOK · Copiloto Xox (⌘⇧X)")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "summon_quick" => show_quick_bar(app_handle),
            "open_main" => show_main_workspace(app_handle, None),
            "quit" => {
                app_handle
                    .state::<SummonState>()
                    .is_quitting
                    .store(true, Ordering::SeqCst);
                app_handle.exit(0);
            }
            _ => {}
        });

    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder.icon_as_template(true);
    }

    tray_builder.build(app)?;

    Ok(())
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    let state = app.state::<SummonState>();

    match window.label() {
        MAIN_WINDOW_LABEL => {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !state.is_quitting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        }
        QUICK_WINDOW_LABEL => match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !state.is_quitting.load(Ordering::SeqCst) {
                    api.prevent_close();
                    hide_quick_bar_now(app);
                }
            }
            WindowEvent::Focused(false) => {
                let shown_at = state.last_quick_shown_ms.load(Ordering::SeqCst);
                if now_ms().saturating_sub(shown_at) >= FOCUS_GRACE_MS {
                    request_dismiss_quick_bar(app);
                }
            }
            _ => {}
        },
        _ => {}
    }
}

pub fn handle_run_event<R: Runtime>(app_handle: &AppHandle<R>, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { code, .. } => {
            if code.is_none() {
                app_handle
                    .state::<SummonState>()
                    .is_quitting
                    .store(true, Ordering::SeqCst);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            let main_visible = app_handle
                .get_webview_window(MAIN_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if !has_visible_windows || !main_visible {
                show_main_workspace(app_handle, None);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xox_tray_icon_has_expected_dimensions_and_silhouette() {
        let icon = render_xox_tray_icon();
        assert_eq!(icon.width(), 44);
        assert_eq!(icon.height(), 44);
        let rgba = icon.rgba();
        assert_eq!(rgba.len(), 44 * 44 * 4);

        // El borde exterior debe ser transparente y la estrella debe tener píxeles opacos
        assert_eq!(rgba[3], 0);
        let opaque_pixels = rgba.chunks_exact(4).filter(|px| px[3] > 200).count();
        assert!(opaque_pixels > 200, "se esperaban píxeles opacos de Xox, hubo {opaque_pixels}");
    }
}

