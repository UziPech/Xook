use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, Position,
    RunEvent, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const QUICK_WINDOW_LABEL: &str = "quick";
const TRAY_ID: &str = "xook-tray";
const POS_STORE_FILENAME: &str = "quick-bar-pos.json";

const QUICK_WIDTH: f64 = 700.0;
const QUICK_HEIGHT: f64 = 435.0;
const CAPSULE_PAD_X: f64 = 36.0;
const CAPSULE_TOP_OFFSET: f64 = 20.0;
const CAPSULE_VISIBLE_BOTTOM: f64 = 112.0;
const FOCUS_GRACE_MS: u64 = 240;
const DISMISS_ANIM_MS: u64 = 160;
const RECENTER_DURATION_MS: u64 = 280;
const QUICK_IDLE_EMPTY_MS: u64 = 45_000;
const QUICK_IDLE_CONTENT_MS: u64 = 180_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct SavedQuickPos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy)]
struct DragAnchor {
    start_cursor_x: f64,
    start_cursor_y: f64,
    start_win_x: f64,
    start_win_y: f64,
}

#[derive(Debug, Clone, Copy)]
struct LogicalRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct SummonState {
    pub is_quitting: AtomicBool,
    last_quick_shown_ms: AtomicU64,
    summon_seq: AtomicU64,
    hidden_seq: AtomicU64,
    quick_dismissing: AtomicBool,
    quick_busy: AtomicBool,
    quick_has_content: AtomicBool,
    quick_ready: AtomicBool,
    want_quick_visible: AtomicBool,
    is_dragging: AtomicBool,
    recenter_seq: AtomicU64,
    custom_pos: Mutex<Option<SavedQuickPos>>,
    drag_anchor: Mutex<Option<DragAnchor>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickReadyResponse {
    pub visible: bool,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRecenterPayload {
    pub phase: &'static str,
    pub vx: f64,
    pub vy: f64,
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
    #[serde(default)]
    pub canvas: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainSummonPayload {
    pub seq: u64,
    pub prompt: Option<String>,
    pub auto_run: bool,
    pub response_text: Option<String>,
    pub canvas: Option<serde_json::Value>,
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

    app.state::<SummonState>()
        .quick_ready
        .store(false, Ordering::SeqCst);

    match WebviewWindowBuilder::new(
        app,
        QUICK_WINDOW_LABEL,
        WebviewUrl::App("index.html?mode=quick".into()),
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

fn quick_pos_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(POS_STORE_FILENAME))
}

fn load_saved_quick_pos<R: Runtime>(app: &AppHandle<R>) -> Option<SavedQuickPos> {
    let path = quick_pos_file_path(app)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedQuickPos>(&raw).ok()
}

fn persist_saved_quick_pos<R: Runtime>(app: &AppHandle<R>, pos: Option<SavedQuickPos>) {
    let Some(path) = quick_pos_file_path(app) else {
        return;
    };
    match pos {
        Some(p) => {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string(&p) {
                let _ = fs::write(path, json);
            }
        }
        None => {
            let _ = fs::remove_file(path);
        }
    }
}

fn monitor_work_areas<R: Runtime>(app: &AppHandle<R>) -> Vec<LogicalRect> {
    app.available_monitors()
        .ok()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let scale = m.scale_factor();
            let work = m.work_area();
            let pos = work.position.to_logical::<f64>(scale);
            let size = work.size.to_logical::<f64>(scale);
            LogicalRect {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
            }
        })
        .collect()
}

fn cursor_logical_pos<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let phys = app.cursor_position().ok()?;
    #[cfg(target_os = "macos")]
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    #[cfg(not(target_os = "macos"))]
    let scale = app
        .monitor_from_point(phys.x, phys.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let logical = phys.to_logical::<f64>(scale);
    Some((logical.x, logical.y))
}

fn quick_window_logical_pos<R: Runtime>(quick: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let phys = quick.outer_position().ok()?;
    let scale = quick.scale_factor().unwrap_or(1.0);
    let logical = phys.to_logical::<f64>(scale);
    Some((logical.x, logical.y))
}

fn rect_contains_point(rect: &LogicalRect, px: f64, py: f64) -> bool {
    px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h
}

fn dist_sq_to_rect(rect: &LogicalRect, px: f64, py: f64) -> f64 {
    let cx = px.clamp(rect.x, rect.x + rect.w);
    let cy = py.clamp(rect.y, rect.y + rect.h);
    let dx = px - cx;
    let dy = py - cy;
    dx * dx + dy * dy
}

fn clamp_quick_to_work_areas(
    x: f64,
    y: f64,
    cursor: Option<(f64, f64)>,
    work_areas: &[LogicalRect],
) -> (f64, f64) {
    if work_areas.is_empty() {
        return (x, y);
    }

    let ref_point = cursor.unwrap_or((x + QUICK_WIDTH * 0.5, y + 60.0));
    let mon = work_areas
        .iter()
        .find(|m| rect_contains_point(m, ref_point.0, ref_point.1))
        .or_else(|| {
            work_areas.iter().min_by(|a, b| {
                dist_sq_to_rect(a, ref_point.0, ref_point.1)
                    .total_cmp(&dist_sq_to_rect(b, ref_point.0, ref_point.1))
            })
        })
        .copied()
        .unwrap();

    // Solo limitamos un borde si no existe un monitor adyacente hacia ese lado.
    let cap_top = y + CAPSULE_TOP_OFFSET;
    let cap_bottom = y + CAPSULE_VISIBLE_BOTTOM;
    let cap_left = x + CAPSULE_PAD_X;
    let cap_right = x + QUICK_WIDTH - CAPSULE_PAD_X;

    let has_left = work_areas
        .iter()
        .any(|m| m.x < mon.x - 1.0 && cap_bottom > m.y && cap_top < m.y + m.h);
    let has_right = work_areas
        .iter()
        .any(|m| m.x + m.w > mon.x + mon.w + 1.0 && cap_bottom > m.y && cap_top < m.y + m.h);
    let has_top = work_areas
        .iter()
        .any(|m| m.y < mon.y - 1.0 && cap_right > m.x && cap_left < m.x + m.w);
    let has_bottom = work_areas
        .iter()
        .any(|m| m.y + m.h > mon.y + mon.h + 1.0 && cap_right > m.x && cap_left < m.x + m.w);

    let min_x = if has_left {
        f64::NEG_INFINITY
    } else {
        mon.x - CAPSULE_PAD_X
    };
    let max_x = if has_right {
        f64::INFINITY
    } else {
        mon.x + mon.w - (QUICK_WIDTH - CAPSULE_PAD_X)
    };
    let min_y = if has_top {
        f64::NEG_INFINITY
    } else {
        mon.y - CAPSULE_TOP_OFFSET
    };
    let max_y = if has_bottom {
        f64::INFINITY
    } else {
        mon.y + mon.h - CAPSULE_VISIBLE_BOTTOM
    };

    let cx = if min_x <= max_x {
        x.clamp(min_x, max_x)
    } else {
        mon.x + (mon.w - QUICK_WIDTH) * 0.5
    };
    let cy = if min_y <= max_y {
        y.clamp(min_y, max_y)
    } else {
        mon.y
    };

    (cx, cy)
}

fn default_quick_logical_pos<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let cursor = cursor_logical_pos(app);
    let areas = monitor_work_areas(app);
    let target_area = cursor
        .and_then(|(cx, cy)| areas.iter().find(|m| rect_contains_point(m, cx, cy)).copied())
        .or_else(|| {
            app.primary_monitor().ok().flatten().map(|m| {
                let scale = m.scale_factor();
                let work = m.work_area();
                let pos = work.position.to_logical::<f64>(scale);
                let size = work.size.to_logical::<f64>(scale);
                LogicalRect {
                    x: pos.x,
                    y: pos.y,
                    w: size.width,
                    h: size.height,
                }
            })
        })
        .or_else(|| areas.first().copied())?;

    let x = target_area.x + (target_area.w - QUICK_WIDTH) * 0.5;
    let y = target_area.y + target_area.h * 0.16;
    Some((x, y))
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

fn position_quick_for_summon<R: Runtime>(app: &AppHandle<R>, quick: &WebviewWindow<R>) {
    let saved = app
        .state::<SummonState>()
        .custom_pos
        .lock()
        .ok()
        .and_then(|g| *g);

    if let Some(pos) = saved {
        let areas = monitor_work_areas(app);
        let center_x = pos.x + QUICK_WIDTH * 0.5;
        let center_y = pos.y + 60.0;
        if areas.iter().any(|m| rect_contains_point(m, center_x, center_y)) {
            let (cx, cy) = clamp_quick_to_work_areas(pos.x, pos.y, None, &areas);
            let _ = quick.set_position(Position::Logical(LogicalPosition::new(cx, cy)));
            return;
        }
    }

    position_quick_on_active_monitor(app, quick);
}

fn schedule_quick_hibernation<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SummonState>();
    let hseq = state.hidden_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let delay_ms = if state.quick_has_content.load(Ordering::SeqCst) {
        QUICK_IDLE_CONTENT_MS
    } else {
        QUICK_IDLE_EMPTY_MS
    };

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        let state = handle.state::<SummonState>();
        if state.is_quitting.load(Ordering::SeqCst)
            || state.hidden_seq.load(Ordering::SeqCst) != hseq
            || state.want_quick_visible.load(Ordering::SeqCst)
            || state.quick_busy.load(Ordering::SeqCst)
        {
            return;
        }
        if let Some(win) = handle.get_webview_window(QUICK_WINDOW_LABEL) {
            if !win.is_visible().unwrap_or(false) {
                state.quick_ready.store(false, Ordering::SeqCst);
                let _ = win.destroy();
            }
        }
    });
}

pub fn show_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let Some(quick) = ensure_quick_window(app) else {
        return;
    };

    let state = app.state::<SummonState>();
    state.quick_dismissing.store(false, Ordering::SeqCst);
    state.is_dragging.store(false, Ordering::SeqCst);
    state.want_quick_visible.store(true, Ordering::SeqCst);
    state.hidden_seq.fetch_add(1, Ordering::SeqCst);
    state.recenter_seq.fetch_add(1, Ordering::SeqCst);
    let seq = state.summon_seq.fetch_add(1, Ordering::SeqCst) + 1;

    position_quick_for_summon(app, &quick);

    if state.quick_ready.load(Ordering::SeqCst) {
        state.last_quick_shown_ms.store(now_ms(), Ordering::SeqCst);
        let _ = quick.show();
        let _ = quick.set_focus();

        let _ = app.emit_to(
            QUICK_WINDOW_LABEL,
            "quick:summon",
            QuickSummonPayload { seq },
        );
    }
}

pub fn request_dismiss_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SummonState>();
    state.want_quick_visible.store(false, Ordering::SeqCst);

    let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
        return;
    };
    if !quick.is_visible().unwrap_or(false) {
        schedule_quick_hibernation(app);
        return;
    }

    if state.quick_dismissing.swap(true, Ordering::SeqCst) {
        return;
    }
    state.is_dragging.store(false, Ordering::SeqCst);
    state.recenter_seq.fetch_add(1, Ordering::SeqCst);

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
                let _ = handle.emit_to(
                    QUICK_WINDOW_LABEL,
                    "quick:hidden",
                    QuickSummonPayload { seq },
                );
                schedule_quick_hibernation(&handle);
            }
        }
    });
}

pub fn hide_quick_bar_now<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SummonState>();
    state.quick_dismissing.store(false, Ordering::SeqCst);
    state.want_quick_visible.store(false, Ordering::SeqCst);
    state.is_dragging.store(false, Ordering::SeqCst);
    state.recenter_seq.fetch_add(1, Ordering::SeqCst);
    let seq = state.summon_seq.fetch_add(1, Ordering::SeqCst) + 1;

    if let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        let _ = quick.hide();
        let _ = app.emit_to(
            QUICK_WINDOW_LABEL,
            "quick:hidden",
            QuickSummonPayload { seq },
        );
        schedule_quick_hibernation(app);
    }
}

pub fn toggle_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SummonState>();
    if let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) {
        let is_vis = quick.is_visible().unwrap_or(false);
        let booting_to_show =
            !state.quick_ready.load(Ordering::SeqCst) && state.want_quick_visible.load(Ordering::SeqCst);
        if is_vis || booting_to_show {
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
            canvas: t.canvas,
        },
        None => MainSummonPayload {
            seq,
            prompt: None,
            auto_run: false,
            response_text: None,
            canvas: None,
        },
    };
    let _ = app.emit_to(MAIN_WINDOW_LABEL, "main:summon", payload);
}

pub fn animate_recenter_quick_bar<R: Runtime>(app: &AppHandle<R>) {
    let Some(quick) = app.get_webview_window(QUICK_WINDOW_LABEL) else {
        return;
    };

    let state = app.state::<SummonState>();
    if let Ok(mut guard) = state.custom_pos.lock() {
        *guard = None;
    }
    persist_saved_quick_pos(app, None);

    let Some((target_x, target_y)) = default_quick_logical_pos(app) else {
        return;
    };
    let Some((start_x, start_y)) = quick_window_logical_pos(&quick) else {
        let _ = quick.set_position(Position::Logical(LogicalPosition::new(target_x, target_y)));
        return;
    };

    let dist = (target_x - start_x).hypot(target_y - start_y);
    if dist < 2.0 {
        let _ = quick.set_position(Position::Logical(LogicalPosition::new(target_x, target_y)));
        let _ = app.emit_to(
            QUICK_WINDOW_LABEL,
            "quick:recenter",
            QuickRecenterPayload {
                phase: "end",
                vx: 0.0,
                vy: 0.0,
            },
        );
        return;
    }

    let seq = state.recenter_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let total_ms = RECENTER_DURATION_MS as f64;
        let step_ms = 16u64;
        let started = now_ms();

        loop {
            let state = handle.state::<SummonState>();
            if state.recenter_seq.load(Ordering::SeqCst) != seq
                || state.is_dragging.load(Ordering::SeqCst)
            {
                return;
            }

            let elapsed = now_ms().saturating_sub(started) as f64;
            let raw_t = (elapsed / total_ms).clamp(0.0, 1.0);
            let ease = 1.0 - (1.0 - raw_t).powi(3);
            // Derivada analítica del easeOutCubic: 3 * (1 - t)^2 / duration_s
            let speed_factor = (3.0 * (1.0 - raw_t).powi(2)) / (total_ms / 1000.0);
            let vx = (target_x - start_x) * speed_factor;
            let vy = (target_y - start_y) * speed_factor;

            let cur_x = start_x + (target_x - start_x) * ease;
            let cur_y = start_y + (target_y - start_y) * ease;

            if let Some(win) = handle.get_webview_window(QUICK_WINDOW_LABEL) {
                let _ = win.set_position(Position::Logical(LogicalPosition::new(cur_x, cur_y)));
            }

            let phase = if raw_t >= 1.0 { "end" } else { "step" };
            let _ = handle.emit_to(
                QUICK_WINDOW_LABEL,
                "quick:recenter",
                QuickRecenterPayload { phase, vx, vy },
            );

            if raw_t >= 1.0 {
                return;
            }

            tokio::time::sleep(Duration::from_millis(step_ms)).await;
        }
    });
}

#[tauri::command]
pub fn quick_bar_ready(app: AppHandle) -> QuickReadyResponse {
    let state = app.state::<SummonState>();
    state.quick_ready.store(true, Ordering::SeqCst);
    let seq = state.summon_seq.load(Ordering::SeqCst);

    if state.want_quick_visible.load(Ordering::SeqCst) {
        if let Some(win) = app.get_webview_window(QUICK_WINDOW_LABEL) {
            position_quick_for_summon(&app, &win);
            state.last_quick_shown_ms.store(now_ms(), Ordering::SeqCst);
            let _ = win.show();
            let _ = win.set_focus();
            return QuickReadyResponse { visible: true, seq };
        }
    }

    QuickReadyResponse { visible: false, seq }
}

#[tauri::command]
pub fn set_quick_state(app: AppHandle, busy: bool, has_content: bool) {
    let state = app.state::<SummonState>();
    state.quick_busy.store(busy, Ordering::SeqCst);
    state.quick_has_content.store(has_content, Ordering::SeqCst);

    if !busy && !state.want_quick_visible.load(Ordering::SeqCst) {
        if let Some(win) = app.get_webview_window(QUICK_WINDOW_LABEL) {
            if !win.is_visible().unwrap_or(false) {
                schedule_quick_hibernation(&app);
            }
        }
    }
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

#[tauri::command]
pub fn begin_quick_drag(app: AppHandle) -> Result<(), String> {
    let quick = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| "Ventana Quick Bar no disponible".to_string())?;
    let (cx, cy) =
        cursor_logical_pos(&app).ok_or_else(|| "No se pudo leer posición del cursor".to_string())?;
    let (wx, wy) = quick_window_logical_pos(&quick)
        .ok_or_else(|| "No se pudo leer posición de la ventana".to_string())?;

    let state = app.state::<SummonState>();
    state.recenter_seq.fetch_add(1, Ordering::SeqCst);
    state.is_dragging.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = state.drag_anchor.lock() {
        *guard = Some(DragAnchor {
            start_cursor_x: cx,
            start_cursor_y: cy,
            start_win_x: wx,
            start_win_y: wy,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn step_quick_drag(app: AppHandle) -> Result<SavedQuickPos, String> {
    let quick = app
        .get_webview_window(QUICK_WINDOW_LABEL)
        .ok_or_else(|| "Ventana Quick Bar no disponible".to_string())?;
    let (cx, cy) =
        cursor_logical_pos(&app).ok_or_else(|| "No se pudo leer posición del cursor".to_string())?;

    let state = app.state::<SummonState>();
    let anchor = state
        .drag_anchor
        .lock()
        .map_err(|_| "Lock de arrastre envenenado".to_string())?
        .ok_or_else(|| "No hay arrastre activo".to_string())?;

    let raw_x = anchor.start_win_x + (cx - anchor.start_cursor_x);
    let raw_y = anchor.start_win_y + (cy - anchor.start_cursor_y);
    let areas = monitor_work_areas(&app);
    let (clamped_x, clamped_y) = clamp_quick_to_work_areas(raw_x, raw_y, Some((cx, cy)), &areas);

    let _ = quick.set_position(Position::Logical(LogicalPosition::new(clamped_x, clamped_y)));

    let pos = SavedQuickPos {
        x: clamped_x,
        y: clamped_y,
    };
    if let Ok(mut guard) = state.custom_pos.lock() {
        *guard = Some(pos);
    }
    Ok(pos)
}

#[tauri::command]
pub fn end_quick_drag(app: AppHandle) -> Result<SavedQuickPos, String> {
    let state = app.state::<SummonState>();
    state.is_dragging.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = state.drag_anchor.lock() {
        *guard = None;
    }

    let pos = state
        .custom_pos
        .lock()
        .ok()
        .and_then(|g| *g)
        .or_else(|| {
            let quick = app.get_webview_window(QUICK_WINDOW_LABEL)?;
            let (wx, wy) = quick_window_logical_pos(&quick)?;
            let areas = monitor_work_areas(&app);
            let (cx, cy) = clamp_quick_to_work_areas(wx, wy, None, &areas);
            Some(SavedQuickPos { x: cx, y: cy })
        })
        .unwrap_or(SavedQuickPos { x: 0.0, y: 0.0 });

    if let Ok(mut guard) = state.custom_pos.lock() {
        *guard = Some(pos);
    }
    persist_saved_quick_pos(&app, Some(pos));
    Ok(pos)
}

#[tauri::command]
pub fn reset_quick_position(app: AppHandle) {
    animate_recenter_quick_bar(&app);
}

pub fn setup_quick_summon<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // 0. Restauramos la última posición personalizada de la Quick Bar si existe
    if let Some(saved) = load_saved_quick_pos(app) {
        if let Ok(mut guard) = app.state::<SummonState>().custom_pos.lock() {
            *guard = Some(saved);
        }
    }

    // 1. Creamos la Quick Bar bajo demanda (en la primera invocación ⌘⇧X) y hibernamos tras inactividad
    // para evitar mantener un segundo proceso WebKit (~90-230 MB) residente mientras no se usa.

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
    let recenter_item = MenuItem::with_id(
        app,
        "reset_quick_pos",
        "Centrar Xox Quick Bar",
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

    let menu = Menu::with_items(
        app,
        &[
            &summon_item,
            &recenter_item,
            &open_main_item,
            &separator,
            &quit_item,
        ],
    )?;
    let tray_icon = render_xox_tray_icon();

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .tooltip("XOOK · Copiloto Xox (⌘⇧X)")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "summon_quick" => show_quick_bar(app_handle),
            "reset_quick_pos" => {
                show_quick_bar(app_handle);
                animate_recenter_quick_bar(app_handle);
            }
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
                if state.is_dragging.load(Ordering::SeqCst) {
                    return;
                }
                let shown_at = state.last_quick_shown_ms.load(Ordering::SeqCst);
                if now_ms().saturating_sub(shown_at) >= FOCUS_GRACE_MS {
                    request_dismiss_quick_bar(app);
                }
            }
            WindowEvent::Destroyed => {
                state.quick_ready.store(false, Ordering::SeqCst);
                state.want_quick_visible.store(false, Ordering::SeqCst);
                state.quick_dismissing.store(false, Ordering::SeqCst);
                state.is_dragging.store(false, Ordering::SeqCst);
            }
            _ => {}
        },
        _ => {}
    }
}

/// Selects the translucent Liquid Glass Dock icon variant in `tauri dev` when
/// macOS is using a Clear or Tinted icon appearance theme.
#[cfg(all(dev, target_os = "macos"))]
fn select_macos_dev_dock_icon_bytes(
    icon_theme: Option<&str>,
    interface_style: Option<&str>,
) -> Option<&'static [u8]> {
    let theme = icon_theme?.trim().to_ascii_lowercase();
    if !(theme.starts_with("clear") || theme.starts_with("tinted")) {
        return None;
    }

    let use_dark = if theme.ends_with("dark") {
        true
    } else if theme.ends_with("light") {
        false
    } else {
        interface_style
            .map(|style| style.trim().eq_ignore_ascii_case("Dark"))
            .unwrap_or(false)
    };

    if use_dark {
        Some(include_bytes!("../icons/dock-clear-dark.png"))
    } else {
        Some(include_bytes!("../icons/dock-clear-light.png"))
    }
}

/// Applies the frosted glass Dock icon in unbundled macOS `tauri dev` runs so
/// ClearLight/ClearDark Dock themes match the native Liquid Glass environment
/// (Tauri's `setApplicationIconImage` bypasses `IconServices` icon styling).
#[cfg(all(dev, target_os = "macos"))]
fn apply_macos_dev_dock_icon() {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{NSData, NSString, NSUserDefaults};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let defaults = NSUserDefaults::standardUserDefaults();
    let theme_key = NSString::from_str("AppleIconAppearanceTheme");
    let style_key = NSString::from_str("AppleInterfaceStyle");
    let icon_theme = defaults.stringForKey(&theme_key).map(|s| s.to_string());
    let interface_style = defaults.stringForKey(&style_key).map(|s| s.to_string());

    let Some(bytes) = select_macos_dev_dock_icon_bytes(
        icon_theme.as_deref(),
        interface_style.as_deref(),
    ) else {
        return;
    };

    let data = NSData::with_bytes(bytes);
    if let Some(app_icon) = NSImage::initWithData(NSImage::alloc(), &data) {
        let app = NSApplication::sharedApplication(mtm);
        unsafe { app.setApplicationIconImage(Some(&app_icon)) };
    }
}

#[cfg(all(test, dev, target_os = "macos"))]
mod dev_dock_icon_tests {
    use super::select_macos_dev_dock_icon_bytes;

    #[test]
    fn selects_clear_variants_by_macos_icon_theme() {
        let light = include_bytes!("../icons/dock-clear-light.png");
        let dark = include_bytes!("../icons/dock-clear-dark.png");

        assert_eq!(
            select_macos_dev_dock_icon_bytes(Some("ClearLight"), Some("Dark")),
            Some(light.as_slice())
        );
        assert_eq!(
            select_macos_dev_dock_icon_bytes(Some("ClearDark"), None),
            Some(dark.as_slice())
        );
        assert_eq!(
            select_macos_dev_dock_icon_bytes(Some("ClearAutomatic"), Some("Dark")),
            Some(dark.as_slice())
        );
        assert_eq!(
            select_macos_dev_dock_icon_bytes(Some("ClearAutomatic"), None),
            Some(light.as_slice())
        );
        assert_eq!(select_macos_dev_dock_icon_bytes(Some("RegularDark"), Some("Dark")), None);
        assert_eq!(select_macos_dev_dock_icon_bytes(None, Some("Dark")), None);
    }
}

pub fn handle_run_event<R: Runtime>(app_handle: &AppHandle<R>, event: RunEvent) {
    match event {
        #[cfg(all(dev, target_os = "macos"))]
        RunEvent::Ready => {
            apply_macos_dev_dock_icon();
        }
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
        assert!(
            opaque_pixels > 200,
            "se esperaban píxeles opacos de Xox, hubo {opaque_pixels}"
        );
    }

    #[test]
    fn clamp_keeps_visible_capsule_within_single_monitor() {
        let mon = [LogicalRect {
            x: 0.0,
            y: 25.0,
            w: 1440.0,
            h: 875.0,
        }];

        // Muy arriba y muy a la izquierda: se frena en el borde visible de la cápsula
        let (lx, ly) = clamp_quick_to_work_areas(-500.0, -200.0, Some((10.0, 30.0)), &mon);
        assert_eq!(lx, -CAPSULE_PAD_X);
        assert_eq!(ly, 25.0 - CAPSULE_TOP_OFFSET);

        // Muy abajo y muy a la derecha: la cápsula permanece accesible cerca del dock
        let (rx, ry) = clamp_quick_to_work_areas(2000.0, 1200.0, Some((1400.0, 880.0)), &mon);
        assert_eq!(rx, 1440.0 - (QUICK_WIDTH - CAPSULE_PAD_X));
        assert_eq!(ry, 25.0 + 875.0 - CAPSULE_VISIBLE_BOTTOM);
    }

    #[test]
    fn clamp_allows_crossing_seam_between_adjacent_monitors() {
        let monitors = [
            LogicalRect {
                x: 0.0,
                y: 25.0,
                w: 1440.0,
                h: 875.0,
            },
            LogicalRect {
                x: 1440.0,
                y: 0.0,
                w: 1920.0,
                h: 1080.0,
            },
        ];

        // Al cruzar del monitor izquierdo al derecho, no debe bloquearse en el borde 1440
        let (x, _y) = clamp_quick_to_work_areas(1200.0, 180.0, Some((1420.0, 220.0)), &monitors);
        assert_eq!(x, 1200.0);
    }
}

