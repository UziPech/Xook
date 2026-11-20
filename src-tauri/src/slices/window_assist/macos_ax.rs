#![cfg(target_os = "macos")]

use super::commands::{CompanionWindowCandidate, WindowRect};
use objc2::rc::Retained;
use objc2::{ClassType, msg_send};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
};
use std::collections::HashSet;
use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr;

fn running_app_for_pid(pid: i32) -> Option<Retained<NSRunningApplication>> {
    unsafe { msg_send![NSRunningApplication::class(), runningApplicationWithProcessIdentifier: pid] }
}

type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFNumberRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFTypeID = usize;
type CFIndex = isize;
type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = i32;
type CGWindowID = u32;
type CGWindowListOption = u32;

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_CF_NUMBER_SINT32_TYPE: i32 = 3;
const K_CF_NUMBER_SINT64_TYPE: i32 = 4;
const K_CF_NUMBER_FLOAT64_TYPE: i32 = 6;

const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: CGWindowListOption = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: CGWindowListOption = 1 << 4;
const K_CG_NULL_WINDOW_ID: CGWindowID = 0;

const K_AX_ERROR_SUCCESS: AXError = 0;
const K_AX_VALUE_CGPOINT_TYPE: u32 = 1;
const K_AX_VALUE_CGSIZE_TYPE: u32 = 2;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: CFBooleanRef;
    static kCFBooleanFalse: CFBooleanRef;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;

    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;

    fn CFStringGetTypeID() -> CFTypeID;
    fn CFBooleanGetTypeID() -> CFTypeID;
    fn CFNumberGetTypeID() -> CFTypeID;
    fn CFArrayGetTypeID() -> CFTypeID;
    fn CFDictionaryGetTypeID() -> CFTypeID;

    fn CFStringCreateWithCString(
        alloc: CFTypeRef,
        c_str: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFStringGetLength(the_string: CFStringRef) -> CFIndex;
    fn CFStringGetMaximumSizeForEncoding(length: CFIndex, encoding: u32) -> CFIndex;
    fn CFStringGetCString(
        the_string: CFStringRef,
        buffer: *mut c_char,
        buffer_size: CFIndex,
        encoding: u32,
    ) -> bool;

    fn CFBooleanGetValue(boolean: CFBooleanRef) -> bool;
    fn CFNumberGetValue(number: CFNumberRef, the_type: i32, value_ptr: *mut c_void) -> bool;

    fn CFArrayGetCount(the_array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(the_array: CFArrayRef, idx: CFIndex) -> CFTypeRef;

    fn CFDictionaryGetValue(the_dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    fn CFDictionaryCreate(
        allocator: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        num_values: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(
        option: CGWindowListOption,
        relative_to_window: CGWindowID,
    ) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;

    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXValueGetTypeID() -> CFTypeID;
    fn AXValueCreate(the_type: u32, value_ptr: *const c_void) -> AXValueRef;
    fn AXValueGetValue(value: AXValueRef, the_type: u32, value_ptr: *mut c_void) -> bool;
}

struct OwnedCF(CFTypeRef);

impl OwnedCF {
    fn new(ptr: CFTypeRef) -> Option<Self> {
        if ptr.is_null() {
            None
        } else {
            Some(Self(ptr))
        }
    }

    fn as_ptr(&self) -> CFTypeRef {
        self.0
    }
}

impl Drop for OwnedCF {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

fn cf_str(s: &str) -> Option<OwnedCF> {
    let c = CString::new(s).ok()?;
    let ptr = unsafe { CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8) };
    OwnedCF::new(ptr)
}

unsafe fn cf_string_to_rust(raw: CFTypeRef) -> Option<String> {
    if raw.is_null() {
        return None;
    }
    if unsafe { CFGetTypeID(raw) != CFStringGetTypeID() } {
        return None;
    }
    let len = unsafe { CFStringGetLength(raw) };
    let max_size = unsafe { CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) } + 1;
    let mut buf = vec![0u8; max_size.max(1) as usize];
    let ok = unsafe {
        CFStringGetCString(
            raw,
            buf.as_mut_ptr() as *mut c_char,
            buf.len() as CFIndex,
            K_CF_STRING_ENCODING_UTF8,
        )
    };
    if !ok {
        return None;
    }
    let cstr = unsafe { CStr::from_ptr(buf.as_ptr() as *const c_char) };
    Some(cstr.to_string_lossy().into_owned())
}

unsafe fn cf_dict_get_str(dict: CFDictionaryRef, key: &str) -> Option<String> {
    let k = cf_str(key)?;
    let val = unsafe { CFDictionaryGetValue(dict, k.as_ptr()) };
    unsafe { cf_string_to_rust(val) }
}

unsafe fn cf_dict_get_i32(dict: CFDictionaryRef, key: &str) -> Option<i32> {
    let k = cf_str(key)?;
    let val = unsafe { CFDictionaryGetValue(dict, k.as_ptr()) };
    if val.is_null() || unsafe { CFGetTypeID(val) != CFNumberGetTypeID() } {
        return None;
    }
    let mut out: i32 = 0;
    if unsafe { CFNumberGetValue(val, K_CF_NUMBER_SINT32_TYPE, &mut out as *mut i32 as *mut c_void) }
    {
        return Some(out);
    }
    let mut out64: i64 = 0;
    if unsafe {
        CFNumberGetValue(
            val,
            K_CF_NUMBER_SINT64_TYPE,
            &mut out64 as *mut i64 as *mut c_void,
        )
    } {
        return Some(out64 as i32);
    }
    None
}

unsafe fn cf_dict_get_f64(dict: CFDictionaryRef, key: &str) -> Option<f64> {
    let k = cf_str(key)?;
    let val = unsafe { CFDictionaryGetValue(dict, k.as_ptr()) };
    if val.is_null() || unsafe { CFGetTypeID(val) != CFNumberGetTypeID() } {
        return None;
    }
    let mut out: f64 = 0.0;
    if unsafe {
        CFNumberGetValue(
            val,
            K_CF_NUMBER_FLOAT64_TYPE,
            &mut out as *mut f64 as *mut c_void,
        )
    } {
        Some(out)
    } else {
        None
    }
}

unsafe fn cf_dict_get_rect(dict: CFDictionaryRef, key: &str) -> Option<CGRect> {
    let k = cf_str(key)?;
    let val = unsafe { CFDictionaryGetValue(dict, k.as_ptr()) };
    if val.is_null() || unsafe { CFGetTypeID(val) != CFDictionaryGetTypeID() } {
        return None;
    }
    let mut rect = CGRect::default();
    if unsafe { CGRectMakeWithDictionaryRepresentation(val, &mut rect) } {
        Some(rect)
    } else {
        None
    }
}

unsafe fn ax_copy_attr(el: AXUIElementRef, attr: &str) -> Option<OwnedCF> {
    let key = cf_str(attr)?;
    let mut out: CFTypeRef = ptr::null();
    let err = unsafe { AXUIElementCopyAttributeValue(el, key.as_ptr(), &mut out) };
    if err == K_AX_ERROR_SUCCESS {
        OwnedCF::new(out)
    } else {
        None
    }
}

unsafe fn ax_read_string(el: AXUIElementRef, attr: &str) -> Option<String> {
    let owned = unsafe { ax_copy_attr(el, attr)? };
    unsafe { cf_string_to_rust(owned.as_ptr()) }
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

unsafe fn ax_read_bool(el: AXUIElementRef, attr: &str) -> Option<bool> {
    let owned = unsafe { ax_copy_attr(el, attr)? };
    let ptr = owned.as_ptr();
    let tid = unsafe { CFGetTypeID(ptr) };
    if tid == unsafe { CFBooleanGetTypeID() } {
        return Some(unsafe { CFBooleanGetValue(ptr) });
    }
    if tid == unsafe { CFNumberGetTypeID() } {
        let mut n: i32 = 0;
        if unsafe { CFNumberGetValue(ptr, K_CF_NUMBER_SINT32_TYPE, &mut n as *mut i32 as *mut c_void) }
        {
            return Some(n != 0);
        }
    }
    None
}

unsafe fn ax_read_frame(el: AXUIElementRef) -> Option<WindowRect> {
    let pos_cf = unsafe { ax_copy_attr(el, "AXPosition")? };
    let size_cf = unsafe { ax_copy_attr(el, "AXSize")? };
    let ax_tid = unsafe { AXValueGetTypeID() };
    if unsafe { CFGetTypeID(pos_cf.as_ptr()) != ax_tid || CFGetTypeID(size_cf.as_ptr()) != ax_tid } {
        return None;
    }
    let mut pt = CGPoint::default();
    let mut sz = CGSize::default();
    let ok_p = unsafe {
        AXValueGetValue(
            pos_cf.as_ptr(),
            K_AX_VALUE_CGPOINT_TYPE,
            &mut pt as *mut CGPoint as *mut c_void,
        )
    };
    let ok_s = unsafe {
        AXValueGetValue(
            size_cf.as_ptr(),
            K_AX_VALUE_CGSIZE_TYPE,
            &mut sz as *mut CGSize as *mut c_void,
        )
    };
    if ok_p && ok_s {
        Some(WindowRect {
            x: pt.x,
            y: pt.y,
            width: sz.width,
            height: sz.height,
        })
    } else {
        None
    }
}

unsafe fn ax_set_bool(el: AXUIElementRef, attr: &str, value: bool) -> AXError {
    let Some(key) = cf_str(attr) else {
        return -1;
    };
    let cf_val = unsafe { if value { kCFBooleanTrue } else { kCFBooleanFalse } };
    unsafe { AXUIElementSetAttributeValue(el, key.as_ptr(), cf_val) }
}

unsafe fn ax_set_position(el: AXUIElementRef, x: f64, y: f64) -> AXError {
    let Some(key) = cf_str("AXPosition") else {
        return -1;
    };
    let pt = CGPoint { x, y };
    let Some(val) = OwnedCF::new(unsafe {
        AXValueCreate(K_AX_VALUE_CGPOINT_TYPE, &pt as *const CGPoint as *const c_void)
    }) else {
        return -1;
    };
    unsafe { AXUIElementSetAttributeValue(el, key.as_ptr(), val.as_ptr()) }
}

unsafe fn ax_set_size(el: AXUIElementRef, width: f64, height: f64) -> AXError {
    let Some(key) = cf_str("AXSize") else {
        return -1;
    };
    let sz = CGSize { width, height };
    let Some(val) = OwnedCF::new(unsafe {
        AXValueCreate(K_AX_VALUE_CGSIZE_TYPE, &sz as *const CGSize as *const c_void)
    }) else {
        return -1;
    };
    unsafe { AXUIElementSetAttributeValue(el, key.as_ptr(), val.as_ptr()) }
}

unsafe fn ax_perform_action(el: AXUIElementRef, action: &str) -> AXError {
    let Some(key) = cf_str(action) else {
        return -1;
    };
    unsafe { AXUIElementPerformAction(el, key.as_ptr()) }
}

pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn request_accessibility_trusted() -> bool {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt as CFTypeRef];
        let values = [kCFBooleanTrue as CFTypeRef];
        let Some(dict) = OwnedCF::new(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        )) else {
            return AXIsProcessTrusted();
        };
        AXIsProcessTrustedWithOptions(dict.as_ptr())
    }
}

fn is_excluded_app(pid: i32, bundle_id: &str, owner_name: &str, title: &str) -> bool {
    if pid == std::process::id() as i32 {
        return true;
    }
    let lb = bundle_id.to_ascii_lowercase();
    let lo = owner_name.to_ascii_lowercase();
    let lt = title.to_ascii_lowercase();

    if lb == "com.xook.app"
        || lb == "com.apple.controlcenter"
        || lb == "com.apple.notificationcenterui"
        || lb == "com.apple.dock"
        || lb == "com.apple.spotlight"
        || lb == "com.apple.windowmanager"
        || lb == "com.apple.loginwindow"
        || lb == "com.apple.screencaptureui"
        || lb == "com.apple.systemuiserver"
        || lb == "com.apple.wallpaper.agent"
    {
        return true;
    }
    if lo == "xook"
        || lo == "window server"
        || lo == "dock"
        || lo == "control center"
        || lo == "notification center"
        || lo == "spotlight"
        || lo == "wallpaper"
        || lo == "systemuiserver"
        || lo == "windowmanager"
    {
        return true;
    }
    if lt == "xox quick bar" {
        return true;
    }
    false
}

pub fn list_visible_companion_windows() -> (bool, Vec<CompanionWindowCandidate>) {
    let trusted = is_accessibility_trusted();
    let Some(arr) = OwnedCF::new(unsafe {
        CGWindowListCopyWindowInfo(
            K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS,
            K_CG_NULL_WINDOW_ID,
        )
    }) else {
        return (trusted, Vec::new());
    };

    let count = unsafe { CFArrayGetCount(arr.as_ptr()) };
    let mut results = Vec::new();
    let mut seen_ids = HashSet::new();

    for idx in 0..count {
        let item = unsafe { CFArrayGetValueAtIndex(arr.as_ptr(), idx) };
        if item.is_null() || unsafe { CFGetTypeID(item) != CFDictionaryGetTypeID() } {
            continue;
        }

        let Some(pid) = (unsafe { cf_dict_get_i32(item, "kCGWindowOwnerPID") }) else {
            continue;
        };
        let layer = unsafe { cf_dict_get_i32(item, "kCGWindowLayer") }.unwrap_or(0);
        if layer != 0 {
            continue;
        }
        let alpha = unsafe { cf_dict_get_f64(item, "kCGWindowAlpha") }.unwrap_or(1.0);
        if alpha <= 0.05 {
            continue;
        }

        let title = unsafe { cf_dict_get_str(item, "kCGWindowName") }
            .unwrap_or_default()
            .trim()
            .to_string();
        let owner_name = unsafe { cf_dict_get_str(item, "kCGWindowOwnerName") }
            .unwrap_or_default()
            .trim()
            .to_string();

        let running = running_app_for_pid(pid);
        let Some(app) = running else {
            continue;
        };
        if app.activationPolicy() != NSApplicationActivationPolicy::Regular {
            continue;
        }

        let bundle_id = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let localized = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_default();

        if is_excluded_app(pid, &bundle_id, &owner_name, &title) {
            continue;
        }

        let Some(bounds) = (unsafe { cf_dict_get_rect(item, "kCGWindowBounds") }) else {
            continue;
        };
        if bounds.size.width < 180.0 || bounds.size.height < 120.0 {
            continue;
        }

        let wid = unsafe { cf_dict_get_i32(item, "kCGWindowNumber") }.unwrap_or(0) as u32;
        if wid != 0 && !seen_ids.insert(wid) {
            continue;
        }

        let app_name = if !owner_name.is_empty() {
            owner_name
        } else {
            localized
        };
        if app_name.is_empty() {
            continue;
        }

        results.push(CompanionWindowCandidate {
            window_id: wid,
            pid,
            app_name,
            bundle_id,
            title,
            x: bounds.origin.x,
            y: bounds.origin.y,
            width: bounds.size.width,
            height: bounds.size.height,
        });

        if results.len() >= 12 {
            break;
        }
    }

    (trusted, results)
}

unsafe fn find_best_ax_window(
    app_el: AXUIElementRef,
    preferred_title: Option<&str>,
    preferred_bounds: Option<WindowRect>,
) -> Option<OwnedCF> {
    let mut candidates: Vec<OwnedCF> = Vec::new();

    if let Some(arr) = unsafe { ax_copy_attr(app_el, "AXWindows") } {
        if unsafe { CFGetTypeID(arr.as_ptr()) == CFArrayGetTypeID() } {
            let count = unsafe { CFArrayGetCount(arr.as_ptr()) };
            for idx in 0..count {
                let raw = unsafe { CFArrayGetValueAtIndex(arr.as_ptr(), idx) };
                if !raw.is_null() {
                    if let Some(retained) = OwnedCF::new(unsafe { CFRetain(raw) }) {
                        candidates.push(retained);
                    }
                }
            }
        }
    }

    if candidates.is_empty() {
        if let Some(fw) = unsafe { ax_copy_attr(app_el, "AXFocusedWindow") } {
            candidates.push(fw);
        }
    }
    if candidates.is_empty() {
        if let Some(mw) = unsafe { ax_copy_attr(app_el, "AXMainWindow") } {
            candidates.push(mw);
        }
    }

    if candidates.is_empty() {
        return None;
    }

    let wanted_title = preferred_title.unwrap_or("").trim();
    let mut best_idx: usize = 0;
    let mut best_score = f64::INFINITY;

    for (idx, win) in candidates.iter().enumerate() {
        let subrole = unsafe { ax_read_string(win.as_ptr(), "AXSubrole") }.unwrap_or_default();
        let minimized = unsafe { ax_read_bool(win.as_ptr(), "AXMinimized") }.unwrap_or(false);
        let frame = unsafe { ax_read_frame(win.as_ptr()) };

        if let Some(f) = frame {
            if (f.width < 120.0 || f.height < 80.0) && !minimized {
                continue;
            }
        }

        let mut score = 0.0;
        if !subrole.is_empty() && subrole != "AXStandardWindow" {
            score += 400.0;
        }
        if minimized {
            score += 250.0;
        }
        if !wanted_title.is_empty() {
            let ax_title = unsafe { ax_read_string(win.as_ptr(), "AXTitle") }.unwrap_or_default();
            if ax_title == wanted_title {
                score -= 200.0;
            } else if !ax_title.is_empty()
                && (ax_title.contains(wanted_title) || wanted_title.contains(&ax_title))
            {
                score -= 80.0;
            }
        }
        if let (Some(target), Some(f)) = (preferred_bounds, frame) {
            let dist = (f.x - target.x).abs()
                + (f.y - target.y).abs()
                + (f.width - target.width).abs()
                + (f.height - target.height).abs();
            score += dist * 0.15;
        }

        if score < best_score {
            best_score = score;
            best_idx = idx;
        }
    }

    Some(candidates.swap_remove(best_idx))
}

#[derive(Debug, Clone)]
pub struct NativeTileOutcome {
    pub ok: bool,
    pub accessibility_granted: bool,
    pub pid: Option<i32>,
    pub window_id: Option<u32>,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub prev_frame: Option<WindowRect>,
    pub applied_frame: Option<WindowRect>,
    pub error: Option<String>,
}

fn apply_ax_frame(
    pid: i32,
    preferred_title: Option<&str>,
    preferred_bounds: Option<WindowRect>,
    target_rect: WindowRect,
    raise_and_activate: bool,
) -> (bool, Option<WindowRect>, Option<WindowRect>, String, Option<String>) {
    let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(pid) }) else {
        return (
            false,
            None,
            None,
            preferred_title.unwrap_or("").to_string(),
            Some("No se pudo conectar con la ventana seleccionada.".to_string()),
        );
    };

    let Some(ax_win) = (unsafe {
        find_best_ax_window(app_el.as_ptr(), preferred_title, preferred_bounds)
    }) else {
        return (
            false,
            None,
            None,
            preferred_title.unwrap_or("").to_string(),
            Some("No se encontró una ventana redimensionable en la app seleccionada.".to_string()),
        );
    };

    let resolved_title = unsafe { ax_read_string(ax_win.as_ptr(), "AXTitle") }
        .unwrap_or_else(|| preferred_title.unwrap_or("").to_string());

    if unsafe { ax_read_bool(ax_win.as_ptr(), "AXFullScreen") }.unwrap_or(false) {
        return (
            false,
            unsafe { ax_read_frame(ax_win.as_ptr()) },
            None,
            resolved_title,
            Some(
                "La app acompañante está en pantalla completa nativa de macOS. Sal de pantalla completa para dividirla."
                    .to_string(),
            ),
        );
    }

    let prev_frame = unsafe { ax_read_frame(ax_win.as_ptr()) }.or(preferred_bounds);

    if unsafe { ax_read_bool(ax_win.as_ptr(), "AXMinimized") }.unwrap_or(false) {
        unsafe { ax_set_bool(ax_win.as_ptr(), "AXMinimized", false) };
    }

    // Evita rezago de animación en apps Electron/Chromium (Antigravity, VS Code, Chrome)
    let was_enhanced =
        unsafe { ax_read_bool(app_el.as_ptr(), "AXEnhancedUserInterface") }.unwrap_or(false);
    if was_enhanced {
        unsafe { ax_set_bool(app_el.as_ptr(), "AXEnhancedUserInterface", false) };
    }

    let x = target_rect.x.round();
    let y = target_rect.y.round();
    let w = target_rect.width.round().max(240.0);
    let h = target_rect.height.round().max(200.0);

    let err_pos1 = unsafe { ax_set_position(ax_win.as_ptr(), x, y) };
    let err_size1 = unsafe { ax_set_size(ax_win.as_ptr(), w, h) };
    let err_pos2 = unsafe { ax_set_position(ax_win.as_ptr(), x, y) };
    let _ = unsafe { ax_set_size(ax_win.as_ptr(), w, h) };

    if was_enhanced {
        unsafe { ax_set_bool(app_el.as_ptr(), "AXEnhancedUserInterface", true) };
    }

    if raise_and_activate {
        unsafe { ax_perform_action(ax_win.as_ptr(), "AXRaise") };
        if let Some(app) = running_app_for_pid(pid) {
            #[allow(deprecated)]
            let _ = app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        }
    }

    let applied_frame = unsafe { ax_read_frame(ax_win.as_ptr()) };
    let ok = (err_pos1 == K_AX_ERROR_SUCCESS || err_pos2 == K_AX_ERROR_SUCCESS)
        && err_size1 == K_AX_ERROR_SUCCESS;

    if !ok {
        return (
            false,
            prev_frame,
            applied_frame,
            resolved_title,
            Some("Esta app no permitió ajustar su posición o tamaño automáticamente.".to_string()),
        );
    }

    (true, prev_frame, applied_frame, resolved_title, None)
}

pub fn tile_companion_window(
    target_pid: Option<i32>,
    target_window_id: Option<u32>,
    target_title: Option<&str>,
    target_rect: WindowRect,
) -> NativeTileOutcome {
    let (trusted, visible) = list_visible_companion_windows();
    if !trusted {
        let top = target_window_id
            .and_then(|wid| visible.iter().find(|w| w.window_id == wid))
            .or_else(|| target_pid.and_then(|p| visible.iter().find(|w| w.pid == p)))
            .or_else(|| visible.first());
        return NativeTileOutcome {
            ok: false,
            accessibility_granted: false,
            pid: top.map(|w| w.pid).or(target_pid),
            window_id: top.map(|w| w.window_id).or(target_window_id),
            app_name: top.map(|w| w.app_name.clone()).unwrap_or_default(),
            bundle_id: top.map(|w| w.bundle_id.clone()).unwrap_or_default(),
            window_title: top.map(|w| w.title.clone()).unwrap_or_default(),
            prev_frame: None,
            applied_frame: None,
            error: Some(
                "Activa Accesibilidad para Xook en macOS para dividir automáticamente ambas pantallas."
                    .to_string(),
            ),
        };
    }

    let chosen = target_window_id
        .and_then(|wid| visible.iter().find(|w| w.window_id == wid))
        .or_else(|| target_pid.and_then(|p| visible.iter().find(|w| w.pid == p)))
        .or_else(|| visible.first());

    let Some(pid) = chosen.map(|c| c.pid).or(target_pid) else {
        return NativeTileOutcome {
            ok: false,
            accessibility_granted: true,
            pid: None,
            window_id: None,
            app_name: String::new(),
            bundle_id: String::new(),
            window_title: String::new(),
            prev_frame: None,
            applied_frame: None,
            error: Some("No hay otra ventana abierta visible para acoplar junto a Xook.".to_string()),
        };
    };

    let running = running_app_for_pid(pid);
    let app_name = chosen
        .map(|c| c.app_name.clone())
        .or_else(|| running.as_ref().and_then(|a| a.localizedName().map(|s| s.to_string())))
        .unwrap_or_else(|| "Aplicación".to_string());
    let bundle_id = chosen
        .map(|c| c.bundle_id.clone())
        .or_else(|| running.as_ref().and_then(|a| a.bundleIdentifier().map(|s| s.to_string())))
        .unwrap_or_default();
    let preferred_title = chosen
        .and_then(|c| if c.title.is_empty() { None } else { Some(c.title.as_str()) })
        .or(target_title);
    let preferred_bounds = chosen.map(|c| WindowRect {
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
    });

    let (ok, prev_frame, applied_frame, resolved_title, err) =
        apply_ax_frame(pid, preferred_title, preferred_bounds, target_rect, true);

    NativeTileOutcome {
        ok,
        accessibility_granted: true,
        pid: Some(pid),
        window_id: chosen.map(|c| c.window_id).or(target_window_id),
        app_name,
        bundle_id,
        window_title: resolved_title,
        prev_frame,
        applied_frame,
        error: err,
    }
}

pub fn restore_companion_window(
    pid: i32,
    window_id: Option<u32>,
    title: Option<&str>,
    rect: WindowRect,
) -> NativeTileOutcome {
    if !is_accessibility_trusted() {
        return NativeTileOutcome {
            ok: false,
            accessibility_granted: false,
            pid: Some(pid),
            window_id,
            app_name: String::new(),
            bundle_id: String::new(),
            window_title: String::new(),
            prev_frame: None,
            applied_frame: None,
            error: Some("Permiso de Accesibilidad no concedido.".to_string()),
        };
    }

    let Some(app) = running_app_for_pid(pid) else {
        return NativeTileOutcome {
            ok: false,
            accessibility_granted: true,
            pid: Some(pid),
            window_id,
            app_name: String::new(),
            bundle_id: String::new(),
            window_title: String::new(),
            prev_frame: None,
            applied_frame: None,
            error: None,
        };
    };

    let (ok, _, applied_frame, resolved_title, err) =
        apply_ax_frame(pid, title, None, rect, false);

    NativeTileOutcome {
        ok,
        accessibility_granted: true,
        pid: Some(pid),
        window_id,
        app_name: app.localizedName().map(|s| s.to_string()).unwrap_or_default(),
        bundle_id: app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default(),
        window_title: resolved_title,
        prev_frame: None,
        applied_frame,
        error: err,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_visible_windows_in_process_cleanly() {
        let (_trusted, wins) = list_visible_companion_windows();
        // No debe incluirse nunca a Xook ni a procesos del sistema en la lista de acompañantes
        assert!(
            wins.iter()
                .all(|w| !w.app_name.eq_ignore_ascii_case("xook") && w.bundle_id != "com.xook.app")
        );
    }
}
