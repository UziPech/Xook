#[cfg(target_os = "macos")]
use super::macos_ax;
use crate::quick_summon::MAIN_WINDOW_LABEL;
use crate::slices::screen_context::helper;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Runtime, Size, WebviewWindow,
};

pub const MIN_XOOK_ASSIST_WIDTH: f64 = 360.0;
pub const MIN_COMPANION_WIDTH: f64 = 380.0;
pub const SPLIT_GAP_PX: f64 = 0.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionWindowCandidate {
    pub window_id: u32,
    pub pid: i32,
    pub app_name: String,
    pub bundle_id: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionWindowListResponse {
    pub ok: bool,
    pub accessibility_granted: bool,
    pub windows: Vec<CompanionWindowCandidate>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedCompanionInfo {
    pub pid: i32,
    pub window_id: Option<u32>,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub tiled_ok: bool,
    pub saved_frame: Option<WindowRect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistWindowStatus {
    pub active: bool,
    pub preset: String,
    pub side: String,
    pub split_companion: bool,
    pub always_on_top: bool,
    pub accessibility_granted: bool,
    pub xook_width: f64,
    pub xook_height: f64,
    pub monitor_width: f64,
    pub monitor_height: f64,
    pub width_percent: u32,
    pub companion: Option<PairedCompanionInfo>,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAssistLayoutPayload {
    pub preset: Option<String>,
    pub side: Option<String>,
    pub custom_width: Option<f64>,
    pub split_companion: Option<bool>,
    pub target_pid: Option<i32>,
    pub target_window_id: Option<u32>,
    pub target_title: Option<String>,
    pub always_on_top: Option<bool>,
}

#[derive(Debug, Clone)]
struct InnerAssistState {
    active: bool,
    preset: String,
    side: String,
    split_companion: bool,
    always_on_top: bool,
    accessibility_granted: bool,
    saved_xook_frame: Option<WindowRect>,
    companion: Option<PairedCompanionInfo>,
    last_notice: Option<String>,
}

impl Default for InnerAssistState {
    fn default() -> Self {
        Self {
            active: false,
            preset: "balanced".to_string(),
            side: "right".to_string(),
            split_companion: true,
            always_on_top: false,
            accessibility_granted: false,
            saved_xook_frame: None,
            companion: None,
            last_notice: None,
        }
    }
}

#[derive(Default)]
pub struct AssistDockState {
    inner: Mutex<InnerAssistState>,
}

fn normalize_preset(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("compact") => "compact".to_string(),
        Some("wide") => "wide".to_string(),
        Some("half") => "half".to_string(),
        Some("custom") => "custom".to_string(),
        _ => "balanced".to_string(),
    }
}

fn normalize_side(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("left") => "left".to_string(),
        _ => "right".to_string(),
    }
}

/// Calcula los rectángulos lógicos de Xook y la ventana acompañante dentro del `work_area`
/// dejando un canal limpio (`SPLIT_GAP_PX`) para evitar solapamientos visuales y facilitar el escalado manual.
pub fn compute_split_rects(
    work_area: WindowRect,
    preset: &str,
    side: &str,
    custom_width: Option<f64>,
) -> (WindowRect, WindowRect) {
    let usable_w = (work_area.width - SPLIT_GAP_PX).max(MIN_XOOK_ASSIST_WIDTH + 200.0);
    let max_xook_w = (usable_w - MIN_COMPANION_WIDTH).max(MIN_XOOK_ASSIST_WIDTH);

    let desired_w = match preset {
        "compact" => (usable_w * 0.26).round().clamp(360.0, 410.0),
        "balanced" => (usable_w * 0.32).round().clamp(420.0, 480.0),
        "wide" => (usable_w * 0.42).round().clamp(540.0, 660.0),
        "half" => (usable_w * 0.50).round().max(MIN_XOOK_ASSIST_WIDTH),
        "custom" => custom_width
            .unwrap_or_else(|| (usable_w * 0.32).round())
            .round()
            .clamp(MIN_XOOK_ASSIST_WIDTH, max_xook_w),
        _ => (usable_w * 0.32).round().clamp(420.0, 480.0),
    };

    let xook_w = if preset == "half" {
        desired_w
            .min((usable_w * 0.5).round())
            .max(MIN_XOOK_ASSIST_WIDTH)
    } else {
        desired_w.clamp(MIN_XOOK_ASSIST_WIDTH, max_xook_w)
    };
    let companion_w = (usable_w - xook_w).max(200.0);

    if side == "left" {
        let xook = WindowRect {
            x: work_area.x.round(),
            y: work_area.y.round(),
            width: xook_w.round(),
            height: work_area.height.round(),
        };
        let companion = WindowRect {
            x: (work_area.x + xook_w + SPLIT_GAP_PX).round(),
            y: work_area.y.round(),
            width: companion_w.round(),
            height: work_area.height.round(),
        };
        (xook, companion)
    } else {
        let companion = WindowRect {
            x: work_area.x.round(),
            y: work_area.y.round(),
            width: companion_w.round(),
            height: work_area.height.round(),
        };
        let xook = WindowRect {
            x: (work_area.x + companion_w + SPLIT_GAP_PX).round(),
            y: work_area.y.round(),
            width: xook_w.round(),
            height: work_area.height.round(),
        };
        (xook, companion)
    }
}

fn current_main_work_area<R: Runtime>(win: &WebviewWindow<R>) -> Result<WindowRect, String> {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())
        .ok_or_else(|| "No se pudo detectar el monitor activo de Xook.".to_string())?;
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    let pos = wa.position.to_logical::<f64>(scale);
    let size = wa.size.to_logical::<f64>(scale);
    Ok(WindowRect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

fn current_window_logical_rect<R: Runtime>(win: &WebviewWindow<R>) -> Option<WindowRect> {
    let scale = win.scale_factor().ok().unwrap_or(1.0);
    let pos = win.outer_position().ok()?.to_logical::<f64>(scale);
    let size = win.outer_size().ok()?.to_logical::<f64>(scale);
    Some(WindowRect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

fn build_status<R: Runtime>(
    win: &WebviewWindow<R>,
    inner: &InnerAssistState,
) -> AssistWindowStatus {
    let rect = current_window_logical_rect(win).unwrap_or(WindowRect {
        x: 0.0,
        y: 0.0,
        width: 1200.0,
        height: 800.0,
    });
    let wa = current_main_work_area(win).unwrap_or(WindowRect {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    });
    let pct = if wa.width > 0.0 {
        ((rect.width / wa.width) * 100.0).round().clamp(1.0, 100.0) as u32
    } else {
        0
    };

    AssistWindowStatus {
        active: inner.active,
        preset: inner.preset.clone(),
        side: inner.side.clone(),
        split_companion: inner.split_companion,
        always_on_top: inner.always_on_top,
        accessibility_granted: inner.accessibility_granted,
        xook_width: rect.width.round(),
        xook_height: rect.height.round(),
        monitor_width: wa.width.round(),
        monitor_height: wa.height.round(),
        width_percent: pct,
        companion: inner.companion.clone(),
        notice: inner.last_notice.clone(),
    }
}

#[cfg(target_os = "macos")]
fn platform_list_windows() -> (bool, Vec<CompanionWindowCandidate>, Option<String>) {
    let (trusted, windows) = macos_ax::list_visible_companion_windows();
    (trusted, windows, None)
}

#[cfg(not(target_os = "macos"))]
fn platform_list_windows() -> (bool, Vec<CompanionWindowCandidate>, Option<String>) {
    (
        false,
        Vec::new(),
        Some("La división automática con otras apps está optimizada para macOS.".to_string()),
    )
}

fn apply_xook_rect<R: Runtime>(win: &WebviewWindow<R>, rect: WindowRect) -> Result<(), String> {
    if win.is_fullscreen().unwrap_or(false) {
        let _ = win.set_fullscreen(false);
    }
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    win.set_size(Size::Logical(LogicalSize::new(rect.width, rect.height)))
        .map_err(|e| format!("No se pudo ajustar el tamaño de Xook: {e}"))?;
    win.set_position(Position::Logical(LogicalPosition::new(rect.x, rect.y)))
        .map_err(|e| format!("No se pudo mover la ventana de Xook: {e}"))?;
    let _ = win.set_size(Size::Logical(LogicalSize::new(rect.width, rect.height)));
    Ok(())
}

#[tauri::command]
pub async fn get_assist_window_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AssistWindowStatus, String> {
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Ventana principal de Xook no disponible.".to_string())?;

    #[cfg(target_os = "macos")]
    let ax_granted = macos_ax::is_accessibility_trusted();
    #[cfg(not(target_os = "macos"))]
    let ax_granted = false;

    let state = app.state::<AssistDockState>();
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
    guard.accessibility_granted = ax_granted;
    Ok(build_status(&main, &guard))
}

#[tauri::command]
pub async fn list_companion_windows<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CompanionWindowListResponse, String> {
    let (trusted, windows, error) = platform_list_windows();
    let state = app.state::<AssistDockState>();
    if let Ok(mut guard) = state.inner.lock() {
        guard.accessibility_granted = trusted;
    }
    Ok(CompanionWindowListResponse {
        ok: true,
        accessibility_granted: trusted,
        windows,
        error,
    })
}

#[tauri::command]
pub async fn apply_assist_layout<R: Runtime>(
    app: AppHandle<R>,
    payload: ApplyAssistLayoutPayload,
) -> Result<AssistWindowStatus, String> {
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let main = app_clone
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "Ventana principal de Xook no disponible.".to_string())?;

        let wa = current_main_work_area(&main)?;
        let current_xook_rect = current_window_logical_rect(&main);

        let (preset, side, split_companion, always_on_top, existing_companion) = {
            let state = app_clone.state::<AssistDockState>();
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;

            if !guard.active {
                guard.saved_xook_frame = current_xook_rect;
            }

            let next_preset = match payload.preset.as_deref() {
                Some(raw) => normalize_preset(Some(raw)),
                None => guard.preset.clone(),
            };
            let next_side = match payload.side.as_deref() {
                Some(raw) => normalize_side(Some(raw)),
                None => guard.side.clone(),
            };
            let next_split = payload.split_companion.unwrap_or(guard.split_companion);
            let next_pin = payload.always_on_top.unwrap_or(guard.always_on_top);

            (
                next_preset,
                next_side,
                next_split,
                next_pin,
                guard.companion.clone(),
            )
        };

        let custom_w = payload
            .custom_width
            .or_else(|| current_xook_rect.map(|r| r.width));
        let (mut xook_rect, companion_rect) = compute_split_rects(wa, &preset, &side, custom_w);

        let mut next_companion: Option<PairedCompanionInfo> = existing_companion.clone();
        #[allow(unused_assignments)]
        let mut ax_granted = false;
        let mut notice: Option<String> = None;

        #[cfg(target_os = "macos")]
        {
            if split_companion {
                let wanted_pid = payload
                    .target_pid
                    .or_else(|| existing_companion.as_ref().map(|c| c.pid));
                let wanted_wid = if payload.target_pid.is_some() {
                    payload.target_window_id
                } else {
                    payload
                        .target_window_id
                        .or_else(|| existing_companion.as_ref().and_then(|c| c.window_id))
                };
                let wanted_title = if payload.target_pid.is_some() {
                    payload.target_title.as_deref()
                } else {
                    payload
                        .target_title
                        .as_deref()
                        .or_else(|| existing_companion.as_ref().map(|c| c.window_title.as_str()))
                };

                let tile = macos_ax::tile_companion_window(
                    wanted_pid,
                    wanted_wid,
                    wanted_title,
                    companion_rect,
                );
                ax_granted = tile.accessibility_granted;

                if tile.ok {
                    if let Some(pid) = tile.pid {
                        let same_companion = existing_companion
                            .as_ref()
                            .map(|c| c.pid == pid && c.window_id == tile.window_id)
                            .unwrap_or(false);
                        let preserved_frame = if same_companion {
                            existing_companion.as_ref().and_then(|c| c.saved_frame)
                        } else {
                            tile.prev_frame
                        };

                        // Si la app acompañante impuso un ancho mínimo mayor al reservado,
                        // reacomodamos Xook para que NUNCA se solapen.
                        if let Some(applied) = tile.applied_frame {
                            if applied.width > companion_rect.width + 6.0 {
                                let remaining_for_xook = wa.width - applied.width - SPLIT_GAP_PX;
                                if remaining_for_xook >= MIN_XOOK_ASSIST_WIDTH {
                                    if side == "right" {
                                        xook_rect.x = (applied.x + applied.width + SPLIT_GAP_PX).round();
                                        xook_rect.width = (wa.x + wa.width - xook_rect.x)
                                            .round()
                                            .max(MIN_XOOK_ASSIST_WIDTH);
                                    } else {
                                        let shifted_comp_x =
                                            (wa.x + wa.width - applied.width).round();
                                        let shifted_rect = WindowRect {
                                            x: shifted_comp_x,
                                            y: companion_rect.y,
                                            width: applied.width,
                                            height: companion_rect.height,
                                        };
                                        let _ = macos_ax::tile_companion_window(
                                            Some(pid),
                                            tile.window_id,
                                            Some(tile.window_title.as_str()),
                                            shifted_rect,
                                        );
                                        xook_rect.x = wa.x.round();
                                        xook_rect.width =
                                            remaining_for_xook.round().max(MIN_XOOK_ASSIST_WIDTH);
                                    }
                                } else {
                                    notice = Some(format!(
                                        "{} exige un ancho mínimo mayor al disponible; reduce el ancho o cierra paneles internos de esa app.",
                                        tile.app_name
                                    ));
                                }
                            }
                        }

                        next_companion = Some(PairedCompanionInfo {
                            pid,
                            window_id: tile.window_id,
                            app_name: tile.app_name,
                            bundle_id: tile.bundle_id,
                            window_title: tile.window_title,
                            tiled_ok: true,
                            saved_frame: preserved_frame,
                        });
                    }
                } else {
                    notice = tile.error;
                    if let Some(pid) = tile.pid {
                        if !tile.app_name.is_empty() {
                            next_companion = Some(PairedCompanionInfo {
                                pid,
                                window_id: tile.window_id,
                                app_name: tile.app_name,
                                bundle_id: tile.bundle_id,
                                window_title: tile.window_title,
                                tiled_ok: false,
                                saved_frame: existing_companion
                                    .as_ref()
                                    .filter(|c| c.pid == pid)
                                    .and_then(|c| c.saved_frame),
                            });
                        }
                    }
                }
            } else {
                ax_granted = macos_ax::is_accessibility_trusted();
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            if split_companion {
                notice = Some("La división automática con otras apps requiere macOS.".to_string());
            }
        }

        apply_xook_rect(&main, xook_rect)?;
        let _ = main.set_always_on_top(always_on_top);
        let _ = main.show();
        let _ = main.set_focus();

        let state = app_clone.state::<AssistDockState>();
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
        guard.active = true;
        guard.preset = preset;
        guard.side = side;
        guard.split_companion = split_companion;
        guard.always_on_top = always_on_top;
        guard.accessibility_granted = ax_granted;
        guard.companion = next_companion;
        guard.last_notice = notice;

        Ok(build_status(&main, &guard))
    })
    .await
    .map_err(|e| format!("Error aplicando Modo Asistencia: {e}"))?
}

#[tauri::command]
pub async fn rebalance_assist_split<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AssistWindowStatus, String> {
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Ventana principal de Xook no disponible.".to_string())?;
    let current_w = current_window_logical_rect(&main).map(|r| r.width);

    let (side, always_on_top, companion) = {
        let state = app.state::<AssistDockState>();
        let guard = state
            .inner
            .lock()
            .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
        (
            guard.side.clone(),
            guard.always_on_top,
            guard.companion.clone(),
        )
    };

    apply_assist_layout(
        app,
        ApplyAssistLayoutPayload {
            preset: Some("custom".to_string()),
            side: Some(side),
            custom_width: current_w,
            split_companion: Some(true),
            target_pid: companion.as_ref().map(|c| c.pid),
            target_window_id: companion.as_ref().and_then(|c| c.window_id),
            target_title: companion.as_ref().map(|c| c.window_title.clone()),
            always_on_top: Some(always_on_top),
        },
    )
    .await
}

#[tauri::command]
pub async fn set_assist_always_on_top<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AssistWindowStatus, String> {
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Ventana principal de Xook no disponible.".to_string())?;
    main.set_always_on_top(enabled)
        .map_err(|e| format!("No se pudo cambiar 'Siempre visible': {e}"))?;

    let state = app.state::<AssistDockState>();
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
    guard.always_on_top = enabled;
    Ok(build_status(&main, &guard))
}

#[tauri::command]
pub async fn exit_assist_layout<R: Runtime>(
    app: AppHandle<R>,
    restore_companion: Option<bool>,
) -> Result<AssistWindowStatus, String> {
    let app_clone = app.clone();
    let should_restore_companion = restore_companion.unwrap_or(true);
    tokio::task::spawn_blocking(move || {
        let main = app_clone
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "Ventana principal de Xook no disponible.".to_string())?;

        let (saved_xook, companion) = {
            let state = app_clone.state::<AssistDockState>();
            let guard = state
                .inner
                .lock()
                .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
            (guard.saved_xook_frame, guard.companion.clone())
        };

        let _ = main.set_always_on_top(false);

        #[cfg(target_os = "macos")]
        if should_restore_companion {
            if let Some(ref comp) = companion {
                if let Some(prev) = comp.saved_frame {
                    let _ = macos_ax::restore_companion_window(
                        comp.pid,
                        comp.window_id,
                        Some(comp.window_title.as_str()),
                        prev,
                    );
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (should_restore_companion, companion);

        if let Some(prev) = saved_xook {
            let _ = apply_xook_rect(&main, prev);
        } else if let Ok(wa) = current_main_work_area(&main) {
            let w = 1200.0_f64.min(wa.width - 40.0).max(760.0);
            let h = 800.0_f64.min(wa.height - 40.0).max(560.0);
            let centered = WindowRect {
                x: wa.x + (wa.width - w) * 0.5,
                y: wa.y + (wa.height - h) * 0.5,
                width: w,
                height: h,
            };
            let _ = apply_xook_rect(&main, centered);
        }
        let _ = main.set_focus();

        let state = app_clone.state::<AssistDockState>();
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "Estado de Modo Asistencia envenenado.".to_string())?;
        guard.active = false;
        guard.always_on_top = false;
        guard.saved_xook_frame = None;
        guard.companion = None;
        guard.last_notice = None;
        Ok(build_status(&main, &guard))
    })
    .await
    .map_err(|e| format!("Error saliendo de Modo Asistencia: {e}"))?
}

#[tauri::command]
pub async fn request_accessibility_permission_cmd<R: Runtime>(
    app: AppHandle<R>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let trusted = macos_ax::request_accessibility_trusted();
        let state = app.state::<AssistDockState>();
        if let Ok(mut guard) = state.inner.lock() {
            guard.accessibility_granted = trusted;
            if trusted {
                guard.last_notice = None;
            }
        }
        Ok(trusted)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub fn open_accessibility_settings_cmd() -> Result<(), String> {
    helper::open_macos_accessibility_settings()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_balanced_preset_is_under_half_width_with_clean_gap() {
        let wa = WindowRect {
            x: 0.0,
            y: 34.0,
            width: 1470.0,
            height: 850.0,
        };
        let (xook, comp) = compute_split_rects(wa, "balanced", "right", None);
        assert!(xook.width < wa.width * 0.5, "balanced should stay below 50%");
        assert_eq!(comp.x, 0.0);
        assert_eq!(xook.x, comp.x + comp.width + SPLIT_GAP_PX);
        assert_eq!(comp.width + SPLIT_GAP_PX + xook.width, wa.width);
        assert_eq!(xook.height, 850.0);
        assert_eq!(comp.height, 850.0);
    }

    #[test]
    fn compact_wide_and_half_presets_partition_work_area_without_overlap() {
        let wa = WindowRect {
            x: 0.0,
            y: 25.0,
            width: 1440.0,
            height: 805.0,
        };

        let (xc, cc) = compute_split_rects(wa, "compact", "right", None);
        assert_eq!(xc.width + SPLIT_GAP_PX + cc.width, wa.width);
        assert_eq!(xc.x, cc.x + cc.width + SPLIT_GAP_PX);
        assert!(xc.width >= 360.0 && xc.width <= 410.0);

        let (xw, cw) = compute_split_rects(wa, "wide", "left", None);
        assert_eq!(xw.width + SPLIT_GAP_PX + cw.width, wa.width);
        assert_eq!(xw.x, 0.0);
        assert_eq!(cw.x, xw.width + SPLIT_GAP_PX);
        assert!(xw.width < wa.width * 0.5);

        let (xh, ch) = compute_split_rects(wa, "half", "right", None);
        assert_eq!(xh.width + SPLIT_GAP_PX + ch.width, wa.width);
        assert_eq!(xh.x, ch.width + SPLIT_GAP_PX);
    }

    #[test]
    fn custom_width_respects_min_xook_and_companion_bounds() {
        let wa = WindowRect {
            x: 0.0,
            y: 25.0,
            width: 1280.0,
            height: 750.0,
        };
        let (x_small, c_small) = compute_split_rects(wa, "custom", "right", Some(200.0));
        assert_eq!(x_small.width, MIN_XOOK_ASSIST_WIDTH);
        assert_eq!(
            c_small.width + SPLIT_GAP_PX + x_small.width,
            wa.width
        );

        let (x_mid, c_mid) = compute_split_rects(wa, "custom", "left", Some(520.0));
        assert_eq!(x_mid.width, 520.0);
        assert_eq!(c_mid.x, 520.0 + SPLIT_GAP_PX);
        assert_eq!(x_mid.width + SPLIT_GAP_PX + c_mid.width, wa.width);
    }
}
