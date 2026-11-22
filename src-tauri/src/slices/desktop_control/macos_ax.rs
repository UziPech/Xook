//! Backend nativo de macOS para observación de Árbol de Accesibilidad, búsqueda profunda (`desktop_find`),
//! acciones semánticas headless y fallback físico seguro `CGEvent` (clic, escritura Unicode y teclas).
//!
//! Disciplina Zero-Trust y RAII (`OwnedCF`), cero `unwrap()`/`expect()` en FFI, timeout por elemento,
//! salto de Web Wrappers transparentes, espera real tras activar accesibilidad Chromium/Electron,
//! `INPUT_LEASE` de exclusividad, `ReleaseGuard` para teclado/ratón y verificación de app en primer plano
//! (inspirado en hallazgos macOS de vercel-labs/agent-desktop, Apache-2.0).

use super::policy::{
    DesktopOperation, ParsedKeyCombo, detect_sensitive_window, is_blocked_key_combo,
    is_electron_or_chromium_app, is_excluded_self_or_system, redact_ui_text,
};
use super::store::{DesktopBounds, DesktopControlState, DesktopUiNode, DesktopWindowInfo, RefEntry};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshotOptions {
    pub app_name: Option<String>,
    pub window_id: Option<u32>,
    pub root_ref: Option<String>,
    pub max_depth: usize,
    pub max_nodes: usize,
    pub interactive_only: bool,
}

impl Default for DesktopSnapshotOptions {
    fn default() -> Self {
        Self {
            app_name: None,
            window_id: None,
            root_ref: None,
            max_depth: 12,
            max_nodes: 320,
            interactive_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFindOptions {
    pub app_name: Option<String>,
    pub window_id: Option<u32>,
    pub root_ref: Option<String>,
    pub query: String,
    pub roles: Vec<String>,
    pub limit: usize,
    pub max_nodes: usize,
}

impl Default for DesktopFindOptions {
    fn default() -> Self {
        Self {
            app_name: None,
            window_id: None,
            root_ref: None,
            query: String::new(),
            roles: Vec::new(),
            limit: 25,
            max_nodes: 2400,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshotOutput {
    pub ok: bool,
    pub accessibility_granted: bool,
    pub blocked_sensitive: bool,
    pub sensitive_reason: Option<String>,
    pub snapshot_id: Option<String>,
    pub window: Option<DesktopWindowInfo>,
    pub complete: bool,
    pub truncated: bool,
    pub nodes_observed: usize,
    pub refs_allocated: usize,
    pub nodes: Vec<DesktopUiNode>,
    pub tree_text: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDisposition {
    pub delivery: String, // "not_delivered" | "delivered_unverified" | "delivered_verified" | "unknown"
    pub retry: String,    // "safe" | "verify_first" | "unsafe"
    pub verified: bool,
    pub reason: Option<String>,
}

impl DesktopDisposition {
    pub fn not_delivered(reason: Option<String>) -> Self {
        Self {
            delivery: "not_delivered".to_string(),
            retry: "safe".to_string(),
            verified: false,
            reason,
        }
    }

    pub fn delivered_verified(reason: Option<String>) -> Self {
        Self {
            delivery: "delivered_verified".to_string(),
            retry: "unsafe".to_string(),
            verified: true,
            reason,
        }
    }

    pub fn delivered_unverified(reason: Option<String>) -> Self {
        Self {
            delivery: "delivered_unverified".to_string(),
            retry: "verify_first".to_string(),
            verified: false,
            reason,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopActionOutput {
    pub ok: bool,
    pub action: String,
    pub ref_id: Option<String>,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub mechanism: String,
    pub summary: String,
    pub post_value: Option<String>,
    pub disposition: DesktopDisposition,
    pub error: Option<String>,
}

/// Normaliza un `AXRole` (+ `AXSubrole`, `AXRoleDescription` y flag editable) al vocabulario de XOOK.
pub fn normalize_ax_role_rich(
    role: &str,
    subrole: &str,
    role_desc: &str,
    editable: bool,
) -> &'static str {
    if role == "AXSecureTextField" || subrole == "AXSecureTextField" {
        return "password_field";
    }
    if subrole == "AXSwitch" {
        return "switch";
    }
    if subrole == "AXSearchField" {
        return "search_field";
    }
    if subrole == "AXTabButton" {
        return "tab";
    }
    if subrole == "AXTextArea" {
        return "textarea";
    }
    match role {
        "AXButton" => "button",
        "AXTextField" => "textfield",
        "AXTextArea" => "textarea",
        "AXCheckBox" => "checkbox",
        "AXRadioButton" => "radio",
        "AXPopUpButton" | "AXComboBox" | "AXMenuButton" => "combobox",
        "AXLink" => "link",
        "AXMenuItem" | "AXMenuBarItem" => "menuitem",
        "AXMenu" => "menu",
        "AXTabGroup" => "tablist",
        "AXSlider" => "slider",
        "AXStaticText" => "text",
        "AXHeading" => "heading",
        "AXTable" | "AXOutline" => "table",
        "AXRow" => "row",
        "AXCell" => "cell",
        "AXList" => "list",
        "AXWebArea" => "web_area",
        "AXWindow" => "window",
        "AXSheet" | "AXDialog" => "dialog",
        "AXPopover" => "popover",
        "AXToolbar" => "toolbar",
        "AXGroup" => {
            let rd = role_desc.to_ascii_lowercase();
            if editable
                || rd.contains("text entry")
                || rd.contains("textbox")
                || rd.contains("text box")
                || rd.contains("editor")
                || rd.contains("campo de texto")
            {
                "textarea"
            } else {
                "group"
            }
        }
        "AXScrollArea" => "scroll_area",
        "AXSplitGroup" => "split_group",
        "AXImage" => "image",
        "AXDisclosureTriangle" => "disclosure",
        "AXIncrementor" => "stepper",
        _ => {
            if editable {
                "textarea"
            } else {
                "element"
            }
        }
    }
}

#[cfg(test)]
pub fn normalize_ax_role(role: &str, subrole: &str) -> &'static str {
    normalize_ax_role_rich(role, subrole, "", false)
}

pub fn is_interactive_role(norm_role: &str) -> bool {
    matches!(
        norm_role,
        "button"
            | "textfield"
            | "textarea"
            | "search_field"
            | "password_field"
            | "checkbox"
            | "radio"
            | "switch"
            | "combobox"
            | "link"
            | "menuitem"
            | "tab"
            | "slider"
            | "disclosure"
            | "stepper"
    )
}

pub fn is_drillable_container_role(norm_role: &str) -> bool {
    matches!(
        norm_role,
        "web_area" | "dialog" | "popover" | "toolbar" | "tablist" | "table" | "list"
    )
}

pub fn is_transparent_wrapper_role(raw_role: &str) -> bool {
    matches!(
        raw_role,
        "AXGroup" | "AXScrollArea" | "AXSplitGroup" | "AXLayoutArea" | "AXGenericElement" | "AXUnknown"
    )
}

/// Mapea nombres canónicos de teclas a virtual key codes de macOS (`HIToolbox/Events.h`).
pub fn macos_key_code(canonical_key: &str) -> Result<u16, String> {
    let code = match canonical_key {
        "a" => 0,
        "b" => 11,
        "c" => 8,
        "d" => 2,
        "e" => 14,
        "f" => 3,
        "g" => 5,
        "h" => 4,
        "i" => 34,
        "j" => 38,
        "k" => 40,
        "l" => 37,
        "m" => 46,
        "n" => 45,
        "o" => 31,
        "p" => 35,
        "q" => 12,
        "r" => 15,
        "s" => 1,
        "t" => 17,
        "u" => 32,
        "v" => 9,
        "w" => 13,
        "x" => 7,
        "y" => 16,
        "z" => 6,
        "0" => 29,
        "1" => 18,
        "2" => 19,
        "3" => 20,
        "4" => 21,
        "5" => 23,
        "6" => 22,
        "7" => 26,
        "8" => 28,
        "9" => 25,
        "return" => 36,
        "esc" => 53,
        "tab" => 48,
        "space" => 49,
        "delete" => 51,
        "forwarddelete" => 117,
        "home" => 115,
        "end" => 119,
        "pageup" => 116,
        "pagedown" => 121,
        "left" => 123,
        "right" => 124,
        "down" => 125,
        "up" => 126,
        "f1" => 122,
        "f2" => 120,
        "f3" => 99,
        "f4" => 118,
        "f5" => 96,
        "f6" => 97,
        "f7" => 98,
        "f8" => 100,
        "f9" => 101,
        "f10" => 109,
        "f11" => 103,
        "f12" => 111,
        "," | "comma" => 43,
        "." | "period" => 47,
        "/" | "slash" => 44,
        ";" | "semicolon" => 41,
        "-" | "minus" => 27,
        "=" | "equal" => 24,
        "[" | "leftbracket" => 33,
        "]" | "rightbracket" => 30,
        other => {
            return Err(format!(
                "Tecla no soportada '{other}'. Usa: return, esc, tab, space, delete, left/right/up/down, a-z, 0-9 o f1-f12."
            ));
        }
    };
    Ok(code)
}

fn truncate_chars(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let prefix: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{prefix}…")
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use objc2::rc::Retained;
    use objc2::{ClassType, msg_send};
    use objc2_app_kit::{
        NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication,
    };
    use std::collections::HashSet;
    use std::ffi::{CStr, CString, c_char, c_void};
    use std::ptr;
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    type CFTypeRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFArrayRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFNumberRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFDataRef = *const c_void;
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

    // CGEvent constants
    const K_CG_EVENT_SOURCE_HID_SYSTEM_STATE: i32 = 1;
    const K_CG_HID_EVENT_TAP: u32 = 0;
    const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
    const K_CG_MOUSE_BUTTON_LEFT: u32 = 0;
    const K_CG_MOUSE_EVENT_CLICK_STATE: u32 = 1;

    const K_CG_EVENT_FLAG_SHIFT: u64 = 0x0002_0000;
    const K_CG_EVENT_FLAG_CONTROL: u64 = 0x0004_0000;
    const K_CG_EVENT_FLAG_ALTERNATE: u64 = 0x0008_0000;
    const K_CG_EVENT_FLAG_COMMAND: u64 = 0x0010_0000;

    const K_AX_ERROR_SUCCESS: AXError = 0;
    const K_AX_ERROR_INVALID_UI_ELEMENT: AXError = -25202;
    const K_AX_ERROR_CANNOT_COMPLETE: AXError = -25204;
    const K_AX_ERROR_API_DISABLED: AXError = -25211;
    const K_AX_VALUE_CGPOINT_TYPE: u32 = 1;
    const K_AX_VALUE_CGSIZE_TYPE: u32 = 2;

    const RTLD_DEFAULT: *mut c_void = -2_isize as *mut c_void;
    const RTLD_LAZY: i32 = 0x1;
    const APPLICATION_SERVICES_PATH: &CStr =
        c"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices";

    type TokenCreateFn = unsafe extern "C" fn(AXUIElementRef) -> CFDataRef;
    type TokenResolveFn = unsafe extern "C" fn(CFDataRef) -> AXUIElementRef;

    struct RemoteTokenSymbols {
        create: TokenCreateFn,
        resolve: TokenResolveFn,
    }

    /// Lease de exclusividad de input físico dentro del proceso (evita intercalar teclado/ratón).
    fn input_lease() -> &'static Mutex<()> {
        static LEASE: OnceLock<Mutex<()>> = OnceLock::new();
        LEASE.get_or_init(|| Mutex::new(()))
    }

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

    unsafe extern "C" {
        fn dlopen(filename: *const c_char, flag: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: CFBooleanRef;
        static kCFBooleanFalse: CFBooleanRef;

        fn CFRelease(cf: CFTypeRef);
        fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
        fn CFGetTypeID(cf: CFTypeRef) -> CFTypeID;
        fn CFEqual(cf1: CFTypeRef, cf2: CFTypeRef) -> bool;

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

        fn CFDataCreate(allocator: CFTypeRef, bytes: *const u8, length: CFIndex) -> CFDataRef;
        fn CFDataGetLength(the_data: CFDataRef) -> CFIndex;
        fn CFDataGetBytePtr(the_data: CFDataRef) -> *const u8;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCopyWindowInfo(
            option: CGWindowListOption,
            relative_to_window: CGWindowID,
        ) -> CFArrayRef;
        fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;

        fn CGEventSourceCreate(state_id: i32) -> CFTypeRef;
        fn CGEventCreateMouseEvent(
            source: CFTypeRef,
            mouse_type: u32,
            mouse_cursor_position: CGPoint,
            mouse_button: u32,
        ) -> CFTypeRef;
        fn CGEventCreateKeyboardEvent(
            source: CFTypeRef,
            virtual_key: u16,
            key_down: bool,
        ) -> CFTypeRef;
        fn CGEventKeyboardSetUnicodeString(
            event: CFTypeRef,
            string_length: usize,
            unicode_string: *const u16,
        );
        fn CGEventSetFlags(event: CFTypeRef, flags: u64);
        fn CGEventSetIntegerValueField(event: CFTypeRef, field: u32, value: i64);
        fn CGEventPost(tap: u32, event: CFTypeRef);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_in_seconds: f32) -> AXError;
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
        fn AXUIElementIsAttributeSettable(
            element: AXUIElementRef,
            attribute: CFStringRef,
            settable: *mut bool,
        ) -> AXError;
        fn AXUIElementCopyActionNames(
            element: AXUIElementRef,
            names: *mut CFArrayRef,
        ) -> AXError;
        fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
        fn AXValueGetTypeID() -> CFTypeID;
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

        fn retain(ptr: CFTypeRef) -> Option<Self> {
            if ptr.is_null() {
                None
            } else {
                Some(Self(unsafe { CFRetain(ptr) }))
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

    /// ReleaseGuard RAII: garantiza emitir el evento `up` si ocurre un aborto intermedio.
    struct EventReleaseGuard {
        up_event: Option<OwnedCF>,
    }

    impl EventReleaseGuard {
        fn new(up_event: OwnedCF) -> Self {
            Self {
                up_event: Some(up_event),
            }
        }

        fn post_now(&mut self) {
            if let Some(ev) = self.up_event.take() {
                unsafe { CGEventPost(K_CG_HID_EVENT_TAP, ev.as_ptr()) };
            }
        }
    }

    impl Drop for EventReleaseGuard {
        fn drop(&mut self) {
            self.post_now();
        }
    }

    fn running_app_for_pid(pid: i32) -> Option<Retained<NSRunningApplication>> {
        unsafe {
            msg_send![NSRunningApplication::class(), runningApplicationWithProcessIdentifier: pid]
        }
    }

    fn remote_token_symbols() -> Option<&'static RemoteTokenSymbols> {
        static SYMS: OnceLock<Option<RemoteTokenSymbols>> = OnceLock::new();
        SYMS.get_or_init(|| {
            let lookup = |handle: *mut c_void| -> Option<RemoteTokenSymbols> {
                let create_ptr =
                    unsafe { dlsym(handle, c"_AXUIElementRemoteTokenCreate".as_ptr()) };
                let resolve_ptr =
                    unsafe { dlsym(handle, c"_AXUIElementCreateWithRemoteToken".as_ptr()) };
                if create_ptr.is_null() || resolve_ptr.is_null() {
                    return None;
                }
                Some(RemoteTokenSymbols {
                    create: unsafe { std::mem::transmute::<*mut c_void, TokenCreateFn>(create_ptr) },
                    resolve: unsafe {
                        std::mem::transmute::<*mut c_void, TokenResolveFn>(resolve_ptr)
                    },
                })
            };
            lookup(RTLD_DEFAULT).or_else(|| {
                let handle = unsafe { dlopen(APPLICATION_SERVICES_PATH.as_ptr(), RTLD_LAZY) };
                if handle.is_null() {
                    None
                } else {
                    lookup(handle)
                }
            })
        })
        .as_ref()
    }

    fn capture_remote_token(el: AXUIElementRef) -> Option<Vec<u8>> {
        let syms = remote_token_symbols()?;
        let data = OwnedCF::new(unsafe { (syms.create)(el) })?;
        let len = unsafe { CFDataGetLength(data.as_ptr()) };
        if len <= 0 || len > 4096 {
            return None;
        }
        let ptr = unsafe { CFDataGetBytePtr(data.as_ptr()) };
        if ptr.is_null() {
            return None;
        }
        let slice = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
        Some(slice.to_vec())
    }

    fn resolve_remote_token(bytes: &[u8]) -> Option<OwnedCF> {
        let syms = remote_token_symbols()?;
        if bytes.is_empty() || bytes.len() > 4096 {
            return None;
        }
        let data = OwnedCF::new(unsafe {
            CFDataCreate(ptr::null(), bytes.as_ptr(), bytes.len() as CFIndex)
        })?;
        let raw_el = unsafe { (syms.resolve)(data.as_ptr()) };
        OwnedCF::new(raw_el)
    }

    fn cf_str(s: &str) -> Option<OwnedCF> {
        let c = CString::new(s).ok()?;
        OwnedCF::new(unsafe {
            CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8)
        })
    }

    unsafe fn cf_string_to_rust(raw: CFTypeRef) -> Option<String> {
        if raw.is_null() || unsafe { CFGetTypeID(raw) != CFStringGetTypeID() } {
            return None;
        }
        let len = unsafe { CFStringGetLength(raw) };
        let max_size =
            unsafe { CFStringGetMaximumSizeForEncoding(len, K_CF_STRING_ENCODING_UTF8) } + 1;
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
        if unsafe {
            CFNumberGetValue(
                val,
                K_CF_NUMBER_SINT32_TYPE,
                &mut out as *mut i32 as *mut c_void,
            )
        } {
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

    unsafe fn ax_read_value_display(el: AXUIElementRef) -> Option<String> {
        let owned = unsafe { ax_copy_attr(el, "AXValue")? };
        let ptr = owned.as_ptr();
        let tid = unsafe { CFGetTypeID(ptr) };
        if tid == unsafe { CFStringGetTypeID() } {
            return unsafe { cf_string_to_rust(ptr) }
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        if tid == unsafe { CFBooleanGetTypeID() } {
            return Some(if unsafe { CFBooleanGetValue(ptr) } {
                "true".to_string()
            } else {
                "false".to_string()
            });
        }
        if tid == unsafe { CFNumberGetTypeID() } {
            let mut n: f64 = 0.0;
            if unsafe {
                CFNumberGetValue(
                    ptr,
                    K_CF_NUMBER_FLOAT64_TYPE,
                    &mut n as *mut f64 as *mut c_void,
                )
            } {
                if (n - n.round()).abs() < 1e-9 {
                    return Some(format!("{}", n.round() as i64));
                }
                return Some(format!("{n:.2}"));
            }
        }
        None
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
            if unsafe {
                CFNumberGetValue(
                    ptr,
                    K_CF_NUMBER_SINT32_TYPE,
                    &mut n as *mut i32 as *mut c_void,
                )
            } {
                return Some(n != 0);
            }
        }
        None
    }

    unsafe fn ax_is_settable(el: AXUIElementRef, attr: &str) -> bool {
        let Some(key) = cf_str(attr) else {
            return false;
        };
        let mut settable = false;
        let err = unsafe { AXUIElementIsAttributeSettable(el, key.as_ptr(), &mut settable) };
        err == K_AX_ERROR_SUCCESS && settable
    }

    unsafe fn ax_set_bool(el: AXUIElementRef, attr: &str, val: bool) -> AXError {
        let Some(key) = cf_str(attr) else {
            return -1;
        };
        let cf_val = unsafe { if val { kCFBooleanTrue } else { kCFBooleanFalse } };
        unsafe { AXUIElementSetAttributeValue(el, key.as_ptr(), cf_val) }
    }

    unsafe fn ax_set_string(el: AXUIElementRef, attr: &str, val: &str) -> AXError {
        let Some(key) = cf_str(attr) else {
            return -1;
        };
        let Some(cf_val) = cf_str(val) else {
            return -1;
        };
        unsafe { AXUIElementSetAttributeValue(el, key.as_ptr(), cf_val.as_ptr()) }
    }

    unsafe fn ax_read_bounds(el: AXUIElementRef) -> Option<DesktopBounds> {
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
            Some(DesktopBounds {
                x: pt.x.round(),
                y: pt.y.round(),
                width: sz.width.round(),
                height: sz.height.round(),
            })
        } else {
            None
        }
    }

    unsafe fn ax_copy_action_names(el: AXUIElementRef) -> Vec<String> {
        let mut arr_ptr: CFArrayRef = ptr::null();
        let err = unsafe { AXUIElementCopyActionNames(el, &mut arr_ptr) };
        if err != K_AX_ERROR_SUCCESS {
            return Vec::new();
        }
        let Some(arr) = OwnedCF::new(arr_ptr) else {
            return Vec::new();
        };
        if unsafe { CFGetTypeID(arr.as_ptr()) != CFArrayGetTypeID() } {
            return Vec::new();
        }
        let count = unsafe { CFArrayGetCount(arr.as_ptr()) };
        let mut out = Vec::new();
        for i in 0..count.min(32) {
            let item = unsafe { CFArrayGetValueAtIndex(arr.as_ptr(), i) };
            if let Some(s) = unsafe { cf_string_to_rust(item) } {
                out.push(s);
            }
        }
        out
    }

    unsafe fn ax_children(el: AXUIElementRef, max_children: usize) -> Vec<OwnedCF> {
        let Some(arr) = (unsafe { ax_copy_attr(el, "AXChildren") }) else {
            return Vec::new();
        };
        if unsafe { CFGetTypeID(arr.as_ptr()) != CFArrayGetTypeID() } {
            return Vec::new();
        }
        let count = unsafe { CFArrayGetCount(arr.as_ptr()) };
        let limit = (count.max(0) as usize).min(max_children);
        let mut out = Vec::with_capacity(limit);
        for i in 0..limit {
            let raw = unsafe { CFArrayGetValueAtIndex(arr.as_ptr(), i as CFIndex) };
            if let Some(retained) = OwnedCF::retain(raw) {
                out.push(retained);
            }
        }
        out
    }

    fn cg_flags_for_modifiers(modifiers: &[String]) -> u64 {
        let mut flags: u64 = 0;
        for m in modifiers {
            match m.as_str() {
                "cmd" => flags |= K_CG_EVENT_FLAG_COMMAND,
                "shift" => flags |= K_CG_EVENT_FLAG_SHIFT,
                "alt" => flags |= K_CG_EVENT_FLAG_ALTERNATE,
                "ctrl" => flags |= K_CG_EVENT_FLAG_CONTROL,
                _ => {}
            }
        }
        flags
    }

    fn post_physical_click_at(x: f64, y: f64) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Coordenadas de clic inválidas.".to_string());
        }
        let source = OwnedCF::new(unsafe { CGEventSourceCreate(K_CG_EVENT_SOURCE_HID_SYSTEM_STATE) })
            .ok_or_else(|| "No se pudo inicializar CGEventSource para clic físico.".to_string())?;
        let pt = CGPoint { x, y };
        if let Some(move_ev) = OwnedCF::new(unsafe {
            CGEventCreateMouseEvent(
                source.as_ptr(),
                K_CG_EVENT_MOUSE_MOVED,
                pt,
                K_CG_MOUSE_BUTTON_LEFT,
            )
        }) {
            unsafe { CGEventPost(K_CG_HID_EVENT_TAP, move_ev.as_ptr()) };
            thread::sleep(Duration::from_millis(12));
        }
        let down = OwnedCF::new(unsafe {
            CGEventCreateMouseEvent(
                source.as_ptr(),
                K_CG_EVENT_LEFT_MOUSE_DOWN,
                pt,
                K_CG_MOUSE_BUTTON_LEFT,
            )
        })
        .ok_or_else(|| "No se pudo crear evento MouseDown.".to_string())?;
        let up = OwnedCF::new(unsafe {
            CGEventCreateMouseEvent(
                source.as_ptr(),
                K_CG_EVENT_LEFT_MOUSE_UP,
                pt,
                K_CG_MOUSE_BUTTON_LEFT,
            )
        })
        .ok_or_else(|| "No se pudo crear evento MouseUp.".to_string())?;

        unsafe {
            CGEventSetIntegerValueField(down.as_ptr(), K_CG_MOUSE_EVENT_CLICK_STATE, 1);
            CGEventSetIntegerValueField(up.as_ptr(), K_CG_MOUSE_EVENT_CLICK_STATE, 1);
        }

        let mut guard = EventReleaseGuard::new(up);
        unsafe { CGEventPost(K_CG_HID_EVENT_TAP, down.as_ptr()) };
        thread::sleep(Duration::from_millis(18));
        guard.post_now();
        thread::sleep(Duration::from_millis(25));
        Ok(())
    }

    fn post_physical_key(key_code: u16, flags: u64) -> Result<(), String> {
        let source = OwnedCF::new(unsafe { CGEventSourceCreate(K_CG_EVENT_SOURCE_HID_SYSTEM_STATE) })
            .ok_or_else(|| "No se pudo inicializar CGEventSource para teclado.".to_string())?;
        let down = OwnedCF::new(unsafe { CGEventCreateKeyboardEvent(source.as_ptr(), key_code, true) })
            .ok_or_else(|| "No se pudo crear evento KeyDown.".to_string())?;
        let up = OwnedCF::new(unsafe { CGEventCreateKeyboardEvent(source.as_ptr(), key_code, false) })
            .ok_or_else(|| "No se pudo crear evento KeyUp.".to_string())?;
        unsafe {
            CGEventSetFlags(down.as_ptr(), flags);
            CGEventSetFlags(up.as_ptr(), flags);
        }
        let mut guard = EventReleaseGuard::new(up);
        unsafe { CGEventPost(K_CG_HID_EVENT_TAP, down.as_ptr()) };
        thread::sleep(Duration::from_millis(10));
        guard.post_now();
        thread::sleep(Duration::from_millis(12));
        Ok(())
    }

    /// Envía texto Unicode por bloques de hasta 18 unidades UTF-16 sin partir pares subrogados;
    /// los saltos de línea `\n` se envían como Shift+Return para no disparar envío prematuro.
    fn post_unicode_text(text: &str, expected_pid: i32) -> Result<usize, String> {
        let source = OwnedCF::new(unsafe { CGEventSourceCreate(K_CG_EVENT_SOURCE_HID_SYSTEM_STATE) })
            .ok_or_else(|| "No se pudo inicializar CGEventSource para escritura Unicode.".to_string())?;
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        let lines: Vec<&str> = normalized.split('\n').collect();
        let mut chunks_sent = 0usize;

        for (line_idx, line) in lines.iter().enumerate() {
            if line_idx > 0 {
                ensure_app_still_active(expected_pid)?;
                post_physical_key(36, K_CG_EVENT_FLAG_SHIFT)?; // Shift+Return
                chunks_sent += 1;
            }
            let mut chunk: Vec<u16> = Vec::with_capacity(18);
            for ch in line.chars() {
                let mut enc = [0u16; 2];
                let units = ch.encode_utf16(&mut enc);
                if !chunk.is_empty() && chunk.len() + units.len() > 18 {
                    ensure_app_still_active(expected_pid)?;
                    send_utf16_chunk(&source, &chunk)?;
                    chunks_sent += 1;
                    chunk.clear();
                }
                chunk.extend_from_slice(units);
            }
            if !chunk.is_empty() {
                ensure_app_still_active(expected_pid)?;
                send_utf16_chunk(&source, &chunk)?;
                chunks_sent += 1;
            }
        }
        Ok(chunks_sent)
    }

    fn send_utf16_chunk(source: &OwnedCF, chunk: &[u16]) -> Result<(), String> {
        let down = OwnedCF::new(unsafe { CGEventCreateKeyboardEvent(source.as_ptr(), 0, true) })
            .ok_or_else(|| "No se pudo crear evento KeyDown Unicode.".to_string())?;
        let up = OwnedCF::new(unsafe { CGEventCreateKeyboardEvent(source.as_ptr(), 0, false) })
            .ok_or_else(|| "No se pudo crear evento KeyUp Unicode.".to_string())?;
        unsafe {
            CGEventSetFlags(down.as_ptr(), 0);
            CGEventSetFlags(up.as_ptr(), 0);
            CGEventKeyboardSetUnicodeString(down.as_ptr(), chunk.len(), chunk.as_ptr());
        }
        let mut guard = EventReleaseGuard::new(up);
        unsafe { CGEventPost(K_CG_HID_EVENT_TAP, down.as_ptr()) };
        thread::sleep(Duration::from_millis(8));
        guard.post_now();
        thread::sleep(Duration::from_millis(8));
        Ok(())
    }

    fn ensure_app_still_active(pid: i32) -> Result<(), String> {
        let Some(app) = running_app_for_pid(pid) else {
            return Err("La aplicación objetivo se cerró durante la operación.".to_string());
        };
        if !app.isActive() {
            return Err(
                "La aplicación objetivo perdió el foco del sistema antes de completar el envío de teclado; operación detenida por seguridad."
                    .to_string(),
            );
        }
        Ok(())
    }

    fn activate_window_and_wait(
        pid: i32,
        preferred_title: &str,
        preferred_bounds: DesktopBounds,
    ) -> Result<(), String> {
        if let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(pid) }) {
            unsafe { AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.5) };
            if let Some(win_el) =
                unsafe { find_best_ax_window(app_el.as_ptr(), preferred_title, preferred_bounds) }
            {
                if let Some(raise_key) = cf_str("AXRaise") {
                    let _ = unsafe { AXUIElementPerformAction(win_el.as_ptr(), raise_key.as_ptr()) };
                }
            }
        }
        let Some(app) = running_app_for_pid(pid) else {
            return Err("La aplicación objetivo ya no está ejecutándose.".to_string());
        };
        #[allow(deprecated)]
        let _ = app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);

        let wait_until = Instant::now() + Duration::from_millis(450);
        while Instant::now() < wait_until {
            if app.isActive() {
                thread::sleep(Duration::from_millis(35));
                return Ok(());
            }
            thread::sleep(Duration::from_millis(20));
        }
        if app.isActive() {
            Ok(())
        } else {
            Err("macOS no permitió activar al frente la aplicación objetivo.".to_string())
        }
    }

    fn check_focused_element_not_secure(pid: i32) -> Result<(), String> {
        let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(pid) }) else {
            return Ok(());
        };
        unsafe { AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.35) };
        if let Some(focused) = unsafe { ax_copy_attr(app_el.as_ptr(), "AXFocusedUIElement") } {
            let role = unsafe { ax_read_string(focused.as_ptr(), "AXRole") }.unwrap_or_default();
            let subrole =
                unsafe { ax_read_string(focused.as_ptr(), "AXSubrole") }.unwrap_or_default();
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" {
                return Err(
                    "Bloqueado por privacidad: el campo enfocado actualmente es un campo de contraseña (AXSecureTextField)."
                        .to_string(),
                );
            }
        }
        Ok(())
    }

    pub fn is_accessibility_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn list_desktop_windows() -> (bool, Vec<DesktopWindowInfo>) {
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

            let Some(app) = running_app_for_pid(pid) else {
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
            let app_name = if !owner_name.is_empty() {
                owner_name
            } else {
                localized
            };
            if app_name.is_empty() {
                continue;
            }

            if is_excluded_self_or_system(pid, &bundle_id, &app_name, &title) {
                continue;
            }

            let Some(bounds) = (unsafe { cf_dict_get_rect(item, "kCGWindowBounds") }) else {
                continue;
            };
            if bounds.size.width < 120.0 || bounds.size.height < 80.0 {
                continue;
            }

            let wid = unsafe { cf_dict_get_i32(item, "kCGWindowNumber") }.unwrap_or(0) as u32;
            if wid != 0 && !seen_ids.insert(wid) {
                continue;
            }

            let sensitive_reason = detect_sensitive_window(&bundle_id, &app_name, &title);
            let safe_title = if sensitive_reason.is_some() {
                "[Ventana protegida]".to_string()
            } else {
                redact_ui_text(&title)
            };

            results.push(DesktopWindowInfo {
                window_id: wid,
                pid,
                app_name,
                bundle_id,
                title: safe_title,
                bounds: DesktopBounds {
                    x: bounds.origin.x.round(),
                    y: bounds.origin.y.round(),
                    width: bounds.size.width.round(),
                    height: bounds.size.height.round(),
                },
                is_sensitive: sensitive_reason.is_some(),
                sensitive_reason,
            });

            if results.len() >= 20 {
                break;
            }
        }

        (trusted, results)
    }

    pub fn pick_target_window(
        windows: &[DesktopWindowInfo],
        window_id: Option<u32>,
        app_query: Option<&str>,
    ) -> Option<DesktopWindowInfo> {
        if let Some(wid) = window_id {
            if let Some(found) = windows.iter().find(|w| w.window_id == wid) {
                return Some(found.clone());
            }
        }
        if let Some(q_raw) = app_query.map(str::trim).filter(|s| !s.is_empty()) {
            let q = q_raw.to_ascii_lowercase();
            if let Some(exact) = windows.iter().find(|w| {
                w.app_name.to_ascii_lowercase() == q || w.bundle_id.to_ascii_lowercase() == q
            }) {
                return Some(exact.clone());
            }
            if let Some(partial) = windows.iter().find(|w| {
                w.app_name.to_ascii_lowercase().contains(&q)
                    || w.bundle_id.to_ascii_lowercase().contains(&q)
                    || w.title.to_ascii_lowercase().contains(&q)
            }) {
                return Some(partial.clone());
            }
            return None;
        }
        windows.first().cloned()
    }

    /// Habilita accesibilidad web en apps Electron/Chromium y espera brevemente a que
    /// el renderizador exponga su árbol DOM (en Chromium/Electron la activación es asíncrona).
    /// Intenta escribir el atributo directamente incluso si `AXUIElementIsAttributeSettable`
    /// responde falso/no-soportado, un comportamiento conocido en Electron/Chromium.
    unsafe fn ensure_renderer_accessibility(app_el: AXUIElementRef) {
        let mut toggled = false;
        for attr in ["AXManualAccessibility", "AXEnhancedUserInterface"] {
            let already = unsafe { ax_read_bool(app_el, attr) }.unwrap_or(false);
            if !already {
                if unsafe { ax_set_bool(app_el, attr, true) } == K_AX_ERROR_SUCCESS {
                    toggled = true;
                }
            }
        }
        if toggled {
            // Dar margen a Electron/Chromium para poblar AXWebArea y nodos hijos
            thread::sleep(Duration::from_millis(250));
        }
    }

    unsafe fn find_best_ax_window(
        app_el: AXUIElementRef,
        preferred_title: &str,
        preferred_bounds: DesktopBounds,
    ) -> Option<OwnedCF> {
        let mut candidates: Vec<OwnedCF> = Vec::new();
        if let Some(arr) = unsafe { ax_copy_attr(app_el, "AXWindows") } {
            if unsafe { CFGetTypeID(arr.as_ptr()) == CFArrayGetTypeID() } {
                let count = unsafe { CFArrayGetCount(arr.as_ptr()) };
                for idx in 0..count.min(20) {
                    let raw = unsafe { CFArrayGetValueAtIndex(arr.as_ptr(), idx) };
                    if let Some(ret) = OwnedCF::retain(raw) {
                        candidates.push(ret);
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

        let wanted = preferred_title.trim();
        let mut best_idx = 0usize;
        let mut best_score = f64::INFINITY;
        for (idx, win) in candidates.iter().enumerate() {
            let mut score = 0.0;
            let subrole = unsafe { ax_read_string(win.as_ptr(), "AXSubrole") }.unwrap_or_default();
            if !subrole.is_empty() && subrole != "AXStandardWindow" {
                score += 200.0;
            }
            if !wanted.is_empty() {
                let ax_title =
                    unsafe { ax_read_string(win.as_ptr(), "AXTitle") }.unwrap_or_default();
                if ax_title == wanted {
                    score -= 200.0;
                } else if !ax_title.is_empty()
                    && (ax_title.contains(wanted) || wanted.contains(&ax_title))
                {
                    score -= 80.0;
                }
            }
            if let Some(f) = unsafe { ax_read_bounds(win.as_ptr()) } {
                let dist = (f.x - preferred_bounds.x).abs()
                    + (f.y - preferred_bounds.y).abs()
                    + (f.width - preferred_bounds.width).abs()
                    + (f.height - preferred_bounds.height).abs();
                score += dist * 0.1;
            }
            if score < best_score {
                best_score = score;
                best_idx = idx;
            }
        }

        Some(candidates.swap_remove(best_idx))
    }

    fn compute_supported_actions(el: AXUIElementRef, norm_role: &str, is_secure: bool) -> Vec<String> {
        let mut actions = Vec::new();
        let raw_actions = unsafe { ax_copy_action_names(el) };
        let has_click_action = raw_actions
            .iter()
            .any(|a| matches!(a.as_str(), "AXPress" | "AXOpen" | "AXConfirm"));
        if has_click_action
            || matches!(
                norm_role,
                "button"
                    | "link"
                    | "menuitem"
                    | "tab"
                    | "checkbox"
                    | "radio"
                    | "switch"
                    | "disclosure"
                    | "textfield"
                    | "textarea"
                    | "search_field"
            )
        {
            actions.push("click".to_string());
        }
        if !is_secure {
            if matches!(
                norm_role,
                "textfield" | "textarea" | "search_field" | "combobox"
            ) {
                actions.push("type_text".to_string());
            }
            if unsafe { ax_is_settable(el, "AXValue") } {
                actions.push("set_value".to_string());
            }
        }
        if unsafe { ax_is_settable(el, "AXFocused") } {
            actions.push("focus".to_string());
        }
        if raw_actions.iter().any(|a| a == "AXScrollToVisible") {
            actions.push("scroll_to".to_string());
        }
        actions
    }

    fn element_accessible_name(el: AXUIElementRef, norm_role: &str, is_secure: bool) -> String {
        for attr in ["AXTitle", "AXDescription", "AXPlaceholderValue", "AXHelp"] {
            if let Some(txt) = unsafe { ax_read_string(el, attr) } {
                return redact_ui_text(&truncate_chars(&txt, 140));
            }
        }
        if !is_secure && matches!(norm_role, "text" | "heading" | "link" | "cell") {
            if let Some(val) = unsafe { ax_read_value_display(el) } {
                return redact_ui_text(&truncate_chars(&val, 140));
            }
        }
        String::new()
    }

    fn verify_process_matches(entry: &RefEntry) -> Result<(), String> {
        let Some(app) = running_app_for_pid(entry.pid) else {
            return Err(format!(
                "STALE_REF: La aplicación '{}' ya no está en ejecución. Ejecuta desktop_snapshot o desktop_find de nuevo.",
                entry.app_name
            ));
        };
        let live_bundle = app
            .bundleIdentifier()
            .map(|s| s.to_string())
            .unwrap_or_default();
        if !entry.bundle_id.is_empty()
            && !live_bundle.is_empty()
            && !live_bundle.eq_ignore_ascii_case(&entry.bundle_id)
        {
            return Err(format!(
                "STALE_REF: El proceso cambió de identidad ('{live_bundle}' vs '{}'). Refresca el snapshot.",
                entry.bundle_id
            ));
        }
        Ok(())
    }

    fn resolve_live_ax_element(entry: &RefEntry) -> Result<OwnedCF, String> {
        verify_process_matches(entry)?;

        // 1. Camino rápido y exacto: token remoto nativo de macOS (M1-1..M1-13)
        if let Some(ref tok) = entry.remote_token {
            if let Some(el) = resolve_remote_token(tok) {
                unsafe { AXUIElementSetMessagingTimeout(el.as_ptr(), 0.5) };
                if let Some(live_role) = unsafe { ax_read_string(el.as_ptr(), "AXRole") } {
                    let live_sub =
                        unsafe { ax_read_string(el.as_ptr(), "AXSubrole") }.unwrap_or_default();
                    let live_rd = unsafe { ax_read_string(el.as_ptr(), "AXRoleDescription") }
                        .unwrap_or_default();
                    let live_ed =
                        unsafe { ax_read_bool(el.as_ptr(), "AXEditable") }.unwrap_or(false);
                    if live_role == "AXSecureTextField" || live_sub == "AXSecureTextField" {
                        return Err(
                            "Bloqueado por privacidad: no se permite operar sobre campos de contraseña (AXSecureTextField)."
                                .to_string(),
                        );
                    }
                    let live_norm = normalize_ax_role_rich(&live_role, &live_sub, &live_rd, live_ed);
                    let id_ok = if entry.identifier.is_empty() {
                        true
                    } else {
                        let live_id = unsafe { ax_read_string(el.as_ptr(), "AXIdentifier") }
                            .or_else(|| unsafe { ax_read_string(el.as_ptr(), "AXDOMIdentifier") })
                            .unwrap_or_default();
                        live_id == entry.identifier
                    };
                    if live_norm == entry.role && id_ok {
                        return Ok(el);
                    }
                }
                return Err(format!(
                    "STALE_REF: El control '{}' ya desapareció o cambió en '{}'. Ejecuta desktop_find o desktop_snapshot para actualizar.",
                    entry.ref_id, entry.app_name
                ));
            }
        }

        // 2. Fallback estricto (sin token): búsqueda única dentro de la ventana objetivo
        let app_el = OwnedCF::new(unsafe { AXUIElementCreateApplication(entry.pid) })
            .ok_or_else(|| "No se pudo conectar al proceso de la aplicación objetivo.".to_string())?;
        unsafe { AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.5) };
        let fallback_bounds = entry.bounds.unwrap_or_default();
        let root_win =
            unsafe { find_best_ax_window(app_el.as_ptr(), &entry.window_title, fallback_bounds) }
                .ok_or_else(|| {
                    format!(
                        "STALE_REF: No se encontró la ventana '{}' de '{}'.",
                        entry.window_title, entry.app_name
                    )
                })?;

        let mut matches: Vec<OwnedCF> = Vec::new();
        let deadline = Instant::now() + Duration::from_millis(1400);
        let mut visited = 0usize;

        fn walk_find_exact(
            el: AXUIElementRef,
            entry: &RefEntry,
            depth: usize,
            visited: &mut usize,
            deadline: Instant,
            matches: &mut Vec<OwnedCF>,
        ) {
            if *visited >= 900 || depth > 42 || Instant::now() >= deadline || matches.len() >= 2 {
                return;
            }
            *visited += 1;
            let raw_role = unsafe { ax_read_string(el, "AXRole") }.unwrap_or_default();
            let subrole = unsafe { ax_read_string(el, "AXSubrole") }.unwrap_or_default();
            let role_desc = unsafe { ax_read_string(el, "AXRoleDescription") }.unwrap_or_default();
            let editable = unsafe { ax_read_bool(el, "AXEditable") }.unwrap_or(false);
            let is_secure = raw_role == "AXSecureTextField" || subrole == "AXSecureTextField";
            let norm = normalize_ax_role_rich(&raw_role, &subrole, &role_desc, editable);

            if !is_secure && norm == entry.role {
                let id = unsafe { ax_read_string(el, "AXIdentifier") }
                    .or_else(|| unsafe { ax_read_string(el, "AXDOMIdentifier") })
                    .unwrap_or_default();
                let name = element_accessible_name(el, norm, false);
                let desc = unsafe { ax_read_string(el, "AXDescription") }.unwrap_or_default();

                let id_match = entry.identifier.is_empty() || id == entry.identifier;
                let name_match = entry.name.is_empty() || name == entry.name;
                let desc_match = entry.description.is_empty() || desc == entry.description;
                let has_identity = !entry.identifier.is_empty()
                    || !entry.name.is_empty()
                    || !entry.description.is_empty();

                if has_identity && id_match && name_match && desc_match {
                    if let Some(ret) = OwnedCF::retain(el) {
                        matches.push(ret);
                    }
                }
            }

            for child in unsafe { ax_children(el, 80) } {
                walk_find_exact(child.as_ptr(), entry, depth + 1, visited, deadline, matches);
                if matches.len() >= 2 || Instant::now() >= deadline {
                    break;
                }
            }
        }

        walk_find_exact(root_win.as_ptr(), entry, 0, &mut visited, deadline, &mut matches);

        match matches.len() {
            1 => Ok(matches.remove(0)),
            0 => Err(format!(
                "STALE_REF: No se encontró el elemento '{}' en '{}'. Ejecuta desktop_find o desktop_snapshot de nuevo.",
                entry.ref_id, entry.app_name
            )),
            _ => Err(format!(
                "AMBIGUOUS_REF: Hay múltiples controles idénticos para '{}' en '{}'. Se abortó para evitar clic incorrecto.",
                entry.ref_id, entry.app_name
            )),
        }
    }

    fn format_node_line(
        indent: &str,
        norm_role: &str,
        ref_id: Option<&str>,
        is_secure: bool,
        name: &str,
        value: Option<&str>,
        enabled: bool,
        focused: bool,
        actions: &[String],
        bounds: Option<DesktopBounds>,
    ) -> String {
        let mut line = format!("{indent}- {norm_role}");
        if let Some(rid) = ref_id {
            line.push_str(&format!(" [{rid}]"));
        }
        if is_secure {
            line.push_str(" [campo_contraseña_protegido]");
        } else if !name.is_empty() {
            line.push_str(&format!(" \"{}\"", name.replace('"', "'")));
        }
        if let Some(v) = value {
            line.push_str(&format!(" = \"{}\"", v.replace('"', "'")));
        }
        if !enabled {
            line.push_str(" (deshabilitado)");
        }
        if focused {
            line.push_str(" (enfocado)");
        }
        if !actions.is_empty() && ref_id.is_some() {
            line.push_str(&format!(" {{{}}}", actions.join(",")));
        }
        if let Some(b) = bounds {
            if b.width > 0.0 && b.height > 0.0 {
                line.push_str(&format!(
                    " @({},{},{}x{})",
                    b.x as i64, b.y as i64, b.width as i64, b.height as i64
                ));
            }
        }
        line
    }

    pub fn snapshot_window(
        state: &DesktopControlState,
        opts: &DesktopSnapshotOptions,
    ) -> DesktopSnapshotOutput {
        let trusted = is_accessibility_trusted();
        if !trusted {
            return DesktopSnapshotOutput {
                ok: false,
                accessibility_granted: false,
                blocked_sensitive: false,
                sensitive_reason: None,
                snapshot_id: None,
                window: None,
                complete: false,
                truncated: false,
                nodes_observed: 0,
                refs_allocated: 0,
                nodes: Vec::new(),
                tree_text: String::new(),
                error: Some(
                    "XOOK necesita permiso de Accesibilidad en macOS (Ajustes del Sistema > Privacidad y Seguridad > Accesibilidad) para inspeccionar controles de otras aplicaciones."
                        .to_string(),
                ),
            };
        }

        let (target_window, drill_root): (DesktopWindowInfo, Option<OwnedCF>) =
            if let Some(ref root_ref) = opts.root_ref {
                let entry = match state.resolve_ref(root_ref) {
                    Ok(e) => e,
                    Err(err) => {
                        return DesktopSnapshotOutput {
                            ok: false,
                            accessibility_granted: true,
                            blocked_sensitive: false,
                            sensitive_reason: None,
                            snapshot_id: None,
                            window: None,
                            complete: false,
                            truncated: false,
                            nodes_observed: 0,
                            refs_allocated: 0,
                            nodes: Vec::new(),
                            tree_text: String::new(),
                            error: Some(err),
                        };
                    }
                };
                if let Some(reason) =
                    detect_sensitive_window(&entry.bundle_id, &entry.app_name, &entry.window_title)
                {
                    return DesktopSnapshotOutput {
                        ok: true,
                        accessibility_granted: true,
                        blocked_sensitive: true,
                        sensitive_reason: Some(reason),
                        snapshot_id: None,
                        window: None,
                        complete: true,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: None,
                    };
                }
                let live_el = match resolve_live_ax_element(&entry) {
                    Ok(el) => el,
                    Err(err) => {
                        return DesktopSnapshotOutput {
                            ok: false,
                            accessibility_granted: true,
                            blocked_sensitive: false,
                            sensitive_reason: None,
                            snapshot_id: None,
                            window: None,
                            complete: false,
                            truncated: false,
                            nodes_observed: 0,
                            refs_allocated: 0,
                            nodes: Vec::new(),
                            tree_text: String::new(),
                            error: Some(err),
                        };
                    }
                };
                let win_info = DesktopWindowInfo {
                    window_id: entry.window_id,
                    pid: entry.pid,
                    app_name: entry.app_name,
                    bundle_id: entry.bundle_id,
                    title: entry.window_title,
                    bounds: entry.bounds.unwrap_or_default(),
                    is_sensitive: false,
                    sensitive_reason: None,
                };
                (win_info, Some(live_el))
            } else {
                let (_, windows) = list_desktop_windows();
                let Some(chosen) =
                    pick_target_window(&windows, opts.window_id, opts.app_name.as_deref())
                else {
                    let msg = match opts.app_name.as_deref() {
                        Some(q) if !q.trim().is_empty() => format!(
                            "No se encontró ninguna ventana visible para '{q}'. Usa desktop_list_windows para ver las ventanas disponibles."
                        ),
                        _ => "No hay otra ventana visible abierta para inspeccionar.".to_string(),
                    };
                    return DesktopSnapshotOutput {
                        ok: false,
                        accessibility_granted: true,
                        blocked_sensitive: false,
                        sensitive_reason: None,
                        snapshot_id: None,
                        window: None,
                        complete: false,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: Some(msg),
                    };
                };
                if chosen.is_sensitive {
                    return DesktopSnapshotOutput {
                        ok: true,
                        accessibility_granted: true,
                        blocked_sensitive: true,
                        sensitive_reason: chosen.sensitive_reason.clone(),
                        snapshot_id: None,
                        window: Some(chosen),
                        complete: true,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: None,
                    };
                }
                (chosen, None)
            };

        let app_el_opt = OwnedCF::new(unsafe { AXUIElementCreateApplication(target_window.pid) });
        if let Some(ref app_el) = app_el_opt {
            unsafe {
                AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.5);
                ensure_renderer_accessibility(app_el.as_ptr());
            }
        }

        let root_el = if let Some(el) = drill_root {
            el
        } else {
            let Some(app_el) = app_el_opt else {
                return DesktopSnapshotOutput {
                    ok: false,
                    accessibility_granted: true,
                    blocked_sensitive: false,
                    sensitive_reason: None,
                    snapshot_id: None,
                    window: Some(target_window),
                    complete: false,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: Some(
                        "No se pudo conectar al árbol de accesibilidad de la aplicación."
                            .to_string(),
                    ),
                };
            };
            match unsafe {
                find_best_ax_window(app_el.as_ptr(), &target_window.title, target_window.bounds)
            } {
                Some(w) => w,
                None => app_el,
            }
        };

        let snapshot_id = match state.allocate_snapshot_id() {
            Ok(id) => id,
            Err(err) => {
                return DesktopSnapshotOutput {
                    ok: false,
                    accessibility_granted: true,
                    blocked_sensitive: false,
                    sensitive_reason: None,
                    snapshot_id: None,
                    window: Some(target_window),
                    complete: false,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: Some(err),
                };
            }
        };

        let max_depth = opts.max_depth.clamp(2, 20);
        let max_nodes = opts.max_nodes.clamp(40, 500);
        let max_raw_depth = 44usize;
        let deadline = Instant::now() + Duration::from_millis(2200);

        struct WalkCtx<'a> {
            snapshot_id: &'a str,
            window: &'a DesktopWindowInfo,
            max_depth: usize,
            max_nodes: usize,
            max_raw_depth: usize,
            interactive_only: bool,
            deadline: Instant,
            nodes_observed: usize,
            truncated: bool,
            next_ref_idx: usize,
            nodes: Vec<DesktopUiNode>,
            refs: Vec<RefEntry>,
            tree_lines: Vec<String>,
        }

        fn record_single_element(
            el: AXUIElementRef,
            logical_depth: usize,
            ctx: &mut WalkCtx<'_>,
            force_emit: bool,
        ) -> (bool, usize) {
            unsafe { AXUIElementSetMessagingTimeout(el, 0.35) };

            let raw_role = unsafe { ax_read_string(el, "AXRole") }.unwrap_or_default();
            let subrole = unsafe { ax_read_string(el, "AXSubrole") }.unwrap_or_default();
            let role_desc = unsafe { ax_read_string(el, "AXRoleDescription") }.unwrap_or_default();
            let editable = unsafe { ax_read_bool(el, "AXEditable") }.unwrap_or(false);
            let is_secure = raw_role == "AXSecureTextField" || subrole == "AXSecureTextField";
            let norm_role = normalize_ax_role_rich(&raw_role, &subrole, &role_desc, editable);
            let name = element_accessible_name(el, norm_role, is_secure);
            let description = unsafe { ax_read_string(el, "AXDescription") }
                .map(|s| redact_ui_text(&truncate_chars(&s, 140)))
                .unwrap_or_default();
            let identifier = unsafe { ax_read_string(el, "AXIdentifier") }
                .or_else(|| unsafe { ax_read_string(el, "AXDOMIdentifier") })
                .unwrap_or_default();
            let value = if is_secure {
                None
            } else {
                unsafe { ax_read_value_display(el) }
                    .map(|v| redact_ui_text(&truncate_chars(&v, 140)))
                    .filter(|v| v != &name)
            };
            let enabled = unsafe { ax_read_bool(el, "AXEnabled") }.unwrap_or(true);
            let focused = unsafe { ax_read_bool(el, "AXFocused") }.unwrap_or(false);
            let actions = compute_supported_actions(el, norm_role, is_secure);

            let has_primary_action = actions
                .iter()
                .any(|a| a == "click" || a == "set_value" || a == "type_text");
            let is_transparent = !force_emit
                && !editable
                && is_transparent_wrapper_role(&raw_role)
                && name.is_empty()
                && value.is_none()
                && identifier.is_empty()
                && !has_primary_action
                && !focused;

            let next_logical_depth = if is_transparent {
                logical_depth
            } else {
                logical_depth + 1
            };

            let actionable = is_interactive_role(norm_role) || has_primary_action || editable;
            let drillable = is_drillable_container_role(norm_role)
                || (norm_role == "group" && (!name.is_empty() || !identifier.is_empty()));

            let should_emit = if is_transparent {
                false
            } else if force_emit {
                true
            } else if ctx.interactive_only {
                actionable || matches!(norm_role, "window" | "dialog" | "web_area")
            } else {
                actionable
                    || drillable
                    || !name.is_empty()
                    || value.is_some()
                    || matches!(norm_role, "window" | "dialog" | "web_area" | "toolbar" | "table")
            };

            if should_emit {
                let bounds = unsafe { ax_read_bounds(el) };
                let ref_id = if (actionable || drillable || force_emit) && !is_secure {
                    ctx.next_ref_idx += 1;
                    let rid = format!("{}:@e{}", ctx.snapshot_id, ctx.next_ref_idx);
                    let token = capture_remote_token(el);
                    ctx.refs.push(RefEntry {
                        ref_id: rid.clone(),
                        snapshot_id: ctx.snapshot_id.to_string(),
                        pid: ctx.window.pid,
                        window_id: ctx.window.window_id,
                        app_name: ctx.window.app_name.clone(),
                        bundle_id: ctx.window.bundle_id.clone(),
                        window_title: ctx.window.title.clone(),
                        role: norm_role.to_string(),
                        raw_role: raw_role.clone(),
                        name: name.clone(),
                        description: description.clone(),
                        identifier: identifier.clone(),
                        actions: actions.clone(),
                        bounds,
                        is_secure,
                        remote_token: token,
                    });
                    Some(rid)
                } else {
                    None
                };

                let indent = "  ".repeat(logical_depth.min(6));
                ctx.tree_lines.push(format_node_line(
                    &indent,
                    norm_role,
                    ref_id.as_deref(),
                    is_secure,
                    &name,
                    value.as_deref(),
                    enabled,
                    focused,
                    &actions,
                    bounds,
                ));

                ctx.nodes.push(DesktopUiNode {
                    ref_id,
                    role: norm_role.to_string(),
                    name: if name.is_empty() { None } else { Some(name) },
                    value,
                    description: if description.is_empty() {
                        None
                    } else {
                        Some(description)
                    },
                    identifier: if identifier.is_empty() {
                        None
                    } else {
                        Some(identifier)
                    },
                    enabled,
                    focused,
                    is_secure,
                    actions,
                    bounds,
                    depth: logical_depth,
                });
            }

            (true, next_logical_depth)
        }

        fn walk_tree(el: AXUIElementRef, logical_depth: usize, raw_depth: usize, ctx: &mut WalkCtx<'_>) {
            if ctx.nodes_observed >= ctx.max_nodes
                || raw_depth > ctx.max_raw_depth
                || logical_depth > ctx.max_depth
                || Instant::now() >= ctx.deadline
            {
                ctx.truncated = true;
                return;
            }
            ctx.nodes_observed += 1;

            let (_, next_logical_depth) = record_single_element(el, logical_depth, ctx, false);
            if next_logical_depth > ctx.max_depth {
                return;
            }
            for child in unsafe { ax_children(el, 80) } {
                walk_tree(child.as_ptr(), next_logical_depth, raw_depth + 1, ctx);
                if ctx.nodes_observed >= ctx.max_nodes || Instant::now() >= ctx.deadline {
                    ctx.truncated = true;
                    break;
                }
            }
        }

        let mut ctx = WalkCtx {
            snapshot_id: &snapshot_id,
            window: &target_window,
            max_depth,
            max_nodes,
            max_raw_depth,
            interactive_only: opts.interactive_only,
            deadline,
            nodes_observed: 0,
            truncated: false,
            next_ref_idx: 0,
            nodes: Vec::new(),
            refs: Vec::new(),
            tree_lines: Vec::new(),
        };

        // Reportar primero el elemento enfocado actual si existe (súper útil en Electron/IDEs/chats)
        if opts.root_ref.is_none() {
            if let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(target_window.pid) }) {
                unsafe { AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.35) };
                if let Some(focused_el) = unsafe { ax_copy_attr(app_el.as_ptr(), "AXFocusedUIElement") } {
                    ctx.tree_lines.push("[Elemento enfocado actualmente]".to_string());
                    let _ = record_single_element(focused_el.as_ptr(), 0, &mut ctx, true);
                    ctx.tree_lines.push("[Árbol de la ventana]".to_string());
                }
            }
        }

        walk_tree(root_el.as_ptr(), 0, 0, &mut ctx);

        let WalkCtx {
            nodes_observed,
            truncated,
            nodes,
            refs,
            tree_lines,
            ..
        } = ctx;

        let refs_allocated = refs.len();
        let _ = state.save_snapshot(snapshot_id.clone(), refs);

        let header = format!(
            "Snapshot {} · App: {} ({}) · Ventana: \"{}\"{}",
            snapshot_id,
            target_window.app_name,
            target_window.bundle_id,
            target_window.title,
            if truncated {
                " [observación parcial — usa desktop_find para buscar controles específicos más profundo]"
            } else {
                ""
            }
        );
        let tree_text = if tree_lines.is_empty() {
            format!("{header}\n(Sin controles accesibles expuestos en esta vista)")
        } else {
            format!("{header}\n{}", tree_lines.join("\n"))
        };

        DesktopSnapshotOutput {
            ok: true,
            accessibility_granted: true,
            blocked_sensitive: false,
            sensitive_reason: None,
            snapshot_id: Some(snapshot_id),
            window: Some(target_window),
            complete: !truncated,
            truncated,
            nodes_observed,
            refs_allocated,
            nodes,
            tree_text,
            error: None,
        }
    }

    /// Búsqueda profunda rápida en Rust (hasta 1,800 nodos / profundidad 48) para localizar
    /// controles concretos (p. ej. el campo de mensaje o botón Enviar en Antigravity/Electron/Chrome)
    /// en una sola llamada, devolviendo referencias listas `sN:@eM`.
    pub fn find_elements(
        state: &DesktopControlState,
        opts: &DesktopFindOptions,
    ) -> DesktopSnapshotOutput {
        if !is_accessibility_trusted() {
            return DesktopSnapshotOutput {
                ok: false,
                accessibility_granted: false,
                blocked_sensitive: false,
                sensitive_reason: None,
                snapshot_id: None,
                window: None,
                complete: false,
                truncated: false,
                nodes_observed: 0,
                refs_allocated: 0,
                nodes: Vec::new(),
                tree_text: String::new(),
                error: Some(
                    "XOOK necesita permiso de Accesibilidad en macOS para buscar controles en otras apps."
                        .to_string(),
                ),
            };
        }

        let (chosen, root_el) = if let Some(ref raw_root) = opts.root_ref {
            let trimmed = raw_root.trim();
            if !trimmed.is_empty() {
                let entry = match state.resolve_ref(trimmed) {
                    Ok(e) => e,
                    Err(err) => {
                        return DesktopSnapshotOutput {
                            ok: false,
                            accessibility_granted: true,
                            blocked_sensitive: false,
                            sensitive_reason: None,
                            snapshot_id: None,
                            window: None,
                            complete: false,
                            truncated: false,
                            nodes_observed: 0,
                            refs_allocated: 0,
                            nodes: Vec::new(),
                            tree_text: String::new(),
                            error: Some(err),
                        };
                    }
                };
                if let Some(reason) =
                    detect_sensitive_window(&entry.bundle_id, &entry.app_name, &entry.window_title)
                {
                    return DesktopSnapshotOutput {
                        ok: true,
                        accessibility_granted: true,
                        blocked_sensitive: true,
                        sensitive_reason: Some(reason),
                        snapshot_id: None,
                        window: None,
                        complete: true,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: None,
                    };
                }
                let live_root = match resolve_live_ax_element(&entry) {
                    Ok(el) => el,
                    Err(err) => {
                        return DesktopSnapshotOutput {
                            ok: false,
                            accessibility_granted: true,
                            blocked_sensitive: false,
                            sensitive_reason: None,
                            snapshot_id: None,
                            window: None,
                            complete: false,
                            truncated: false,
                            nodes_observed: 0,
                            refs_allocated: 0,
                            nodes: Vec::new(),
                            tree_text: String::new(),
                            error: Some(err),
                        };
                    }
                };
                let (_, windows) = list_desktop_windows();
                let win_info = windows
                    .into_iter()
                    .find(|w| w.window_id == entry.window_id || w.pid == entry.pid)
                    .unwrap_or_else(|| DesktopWindowInfo {
                        window_id: entry.window_id,
                        pid: entry.pid,
                        app_name: entry.app_name.clone(),
                        bundle_id: entry.bundle_id.clone(),
                        title: entry.window_title.clone(),
                        bounds: entry.bounds.unwrap_or_default(),
                        is_sensitive: false,
                        sensitive_reason: None,
                    });
                (win_info, live_root)
            } else {
                let (_, windows) = list_desktop_windows();
                let Some(chosen) = pick_target_window(&windows, opts.window_id, opts.app_name.as_deref())
                else {
                    return DesktopSnapshotOutput {
                        ok: false,
                        accessibility_granted: true,
                        blocked_sensitive: false,
                        sensitive_reason: None,
                        snapshot_id: None,
                        window: None,
                        complete: false,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: Some(
                            "No se encontró la ventana objetivo. Usa desktop_list_windows para ver las abiertas."
                                .to_string(),
                        ),
                    };
                };
                if chosen.is_sensitive {
                    return DesktopSnapshotOutput {
                        ok: true,
                        accessibility_granted: true,
                        blocked_sensitive: true,
                        sensitive_reason: chosen.sensitive_reason.clone(),
                        snapshot_id: None,
                        window: Some(chosen),
                        complete: true,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: None,
                    };
                }
                let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(chosen.pid) }) else {
                    return DesktopSnapshotOutput {
                        ok: false,
                        accessibility_granted: true,
                        blocked_sensitive: false,
                        sensitive_reason: None,
                        snapshot_id: None,
                        window: Some(chosen),
                        complete: false,
                        truncated: false,
                        nodes_observed: 0,
                        refs_allocated: 0,
                        nodes: Vec::new(),
                        tree_text: String::new(),
                        error: Some("No se pudo conectar a la app objetivo.".to_string()),
                    };
                };
                unsafe {
                    AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.5);
                    ensure_renderer_accessibility(app_el.as_ptr());
                }
                let root_el = match unsafe { find_best_ax_window(app_el.as_ptr(), &chosen.title, chosen.bounds) } {
                    Some(w) => w,
                    None => OwnedCF::retain(app_el.as_ptr()).unwrap_or(app_el),
                };
                (chosen, root_el)
            }
        } else {
            let (_, windows) = list_desktop_windows();
            let Some(chosen) = pick_target_window(&windows, opts.window_id, opts.app_name.as_deref())
            else {
                return DesktopSnapshotOutput {
                    ok: false,
                    accessibility_granted: true,
                    blocked_sensitive: false,
                    sensitive_reason: None,
                    snapshot_id: None,
                    window: None,
                    complete: false,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: Some(
                        "No se encontró la ventana objetivo. Usa desktop_list_windows para ver las abiertas."
                            .to_string(),
                    ),
                };
            };
            if chosen.is_sensitive {
                return DesktopSnapshotOutput {
                    ok: true,
                    accessibility_granted: true,
                    blocked_sensitive: true,
                    sensitive_reason: chosen.sensitive_reason.clone(),
                    snapshot_id: None,
                    window: Some(chosen),
                    complete: true,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: None,
                };
            }
            let Some(app_el) = OwnedCF::new(unsafe { AXUIElementCreateApplication(chosen.pid) }) else {
                return DesktopSnapshotOutput {
                    ok: false,
                    accessibility_granted: true,
                    blocked_sensitive: false,
                    sensitive_reason: None,
                    snapshot_id: None,
                    window: Some(chosen),
                    complete: false,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: Some("No se pudo conectar a la app objetivo.".to_string()),
                };
            };
            unsafe {
                AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.5);
                ensure_renderer_accessibility(app_el.as_ptr());
            }
            let root_el = match unsafe { find_best_ax_window(app_el.as_ptr(), &chosen.title, chosen.bounds) } {
                Some(w) => w,
                None => OwnedCF::retain(app_el.as_ptr()).unwrap_or(app_el),
            };
            (chosen, root_el)
        };

        let snapshot_id = match state.allocate_snapshot_id() {
            Ok(id) => id,
            Err(err) => {
                return DesktopSnapshotOutput {
                    ok: false,
                    accessibility_granted: true,
                    blocked_sensitive: false,
                    sensitive_reason: None,
                    snapshot_id: None,
                    window: Some(chosen),
                    complete: false,
                    truncated: false,
                    nodes_observed: 0,
                    refs_allocated: 0,
                    nodes: Vec::new(),
                    tree_text: String::new(),
                    error: Some(err),
                };
            }
        };

        let query_tokens: Vec<String> = opts
            .query
            .to_ascii_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| s.len() >= 2)
            .map(str::to_string)
            .collect();
        let wanted_roles: Vec<String> = opts
            .roles
            .iter()
            .map(|r| r.trim().to_ascii_lowercase())
            .filter(|r| !r.is_empty())
            .collect();
        let text_roles_only = !wanted_roles.is_empty()
            && wanted_roles.iter().all(|r| {
                matches!(
                    r.as_str(),
                    "textarea" | "textfield" | "search_field" | "textbox" | "input" | "combobox"
                )
            });
        let limit = opts.limit.clamp(5, 40);
        let max_nodes = if opts.max_nodes == 0 {
            2400
        } else {
            opts.max_nodes.clamp(400, 6000)
        };
        let time_budget_ms: u64 = if max_nodes > 3200 {
            3800
        } else if max_nodes > 2200 {
            3000
        } else {
            2400
        };

        struct CandidateHit {
            score: i32,
            is_drill_container: bool,
            node: DesktopUiNode,
            entry: RefEntry,
        }

        struct SearchCtx<'a> {
            snapshot_id: &'a str,
            window: &'a DesktopWindowInfo,
            query_tokens: &'a [String],
            wanted_roles: &'a [String],
            text_roles_only: bool,
            max_nodes: usize,
            deadline: Instant,
            nodes_observed: usize,
            truncated: bool,
            hits: Vec<CandidateHit>,
            containers: Vec<CandidateHit>,
        }

        fn role_matches_filter(norm_role: &str, wanted_roles: &[String]) -> bool {
            wanted_roles.iter().any(|r| {
                r == norm_role
                    || (r == "textbox" && matches!(norm_role, "textfield" | "textarea" | "search_field"))
                    || (r == "input"
                        && matches!(norm_role, "textfield" | "textarea" | "search_field" | "combobox"))
            })
        }

        fn record_drill_container(
            el: AXUIElementRef,
            depth: usize,
            norm_role: &str,
            raw_role: &str,
            ctx: &mut SearchCtx<'_>,
        ) {
            if depth > 12 || ctx.containers.len() >= 10 {
                return;
            }
            if !matches!(norm_role, "web_area" | "split_group" | "dialog" | "scroll_area") {
                return;
            }
            let bounds = unsafe { ax_read_bounds(el) };
            // Ignorar contenedores minúsculos que no son paneles reales
            if let Some(b) = bounds {
                if b.width < 120.0 || b.height < 80.0 {
                    return;
                }
            }
            let name = element_accessible_name(el, norm_role, false);
            let token = capture_remote_token(el);
            let score = match norm_role {
                "web_area" => 100,
                "dialog" => 90,
                "split_group" => 75,
                "scroll_area" => 60,
                _ => 40,
            } + if !name.is_empty() { 10 } else { 0 };

            let entry = RefEntry {
                ref_id: String::new(),
                snapshot_id: ctx.snapshot_id.to_string(),
                pid: ctx.window.pid,
                window_id: ctx.window.window_id,
                app_name: ctx.window.app_name.clone(),
                bundle_id: ctx.window.bundle_id.clone(),
                window_title: ctx.window.title.clone(),
                role: norm_role.to_string(),
                raw_role: raw_role.to_string(),
                name: name.clone(),
                description: String::new(),
                identifier: String::new(),
                actions: Vec::new(),
                bounds,
                is_secure: false,
                remote_token: token,
            };
            let node = DesktopUiNode {
                ref_id: None,
                role: norm_role.to_string(),
                name: if name.is_empty() { None } else { Some(name) },
                value: None,
                description: Some("drill_container".to_string()),
                identifier: None,
                enabled: true,
                focused: false,
                is_secure: false,
                actions: Vec::new(),
                bounds,
                depth,
            };
            ctx.containers.push(CandidateHit {
                score,
                is_drill_container: true,
                node,
                entry,
            });
        }

        fn score_and_collect(el: AXUIElementRef, depth: usize, ctx: &mut SearchCtx<'_>, focused_bonus: bool) {
            unsafe { AXUIElementSetMessagingTimeout(el, 0.25) };
            // Fast path: 1 sola llamada IPC (AXRole) para descartar rápido nodos irrelevantes
            let raw_role = unsafe { ax_read_string(el, "AXRole") }.unwrap_or_default();
            if raw_role == "AXSecureTextField" {
                return;
            }

            if matches!(
                raw_role.as_str(),
                "AXWebArea" | "AXSplitGroup" | "AXScrollArea" | "AXSheet" | "AXDialog"
            ) {
                let quick_role = normalize_ax_role_rich(&raw_role, "", "", false);
                record_drill_container(el, depth, quick_role, &raw_role, ctx);
            }

            // Cuando solo buscamos campos de texto, saltar botones/textos estáticos/imágenes en 1 IPC
            if ctx.text_roles_only && !focused_bonus {
                let could_be_text = matches!(
                    raw_role.as_str(),
                    "AXTextArea"
                        | "AXTextField"
                        | "AXComboBox"
                        | "AXSearchField"
                        | "AXGroup"
                        | "AXGenericElement"
                        | "AXWebArea"
                        | "AXUnknown"
                );
                if !could_be_text {
                    return;
                }
            }

            let may_be_editable_container = matches!(
                raw_role.as_str(),
                "AXGroup" | "AXGenericElement" | "AXWebArea" | "AXUnknown" | "AXTextArea" | "AXTextField"
            );
            let editable = if may_be_editable_container {
                unsafe { ax_read_bool(el, "AXEditable") }.unwrap_or(false)
            } else {
                false
            };

            // Para AXGroup/AXWebArea buscando texto: si no es editable, revisar AXRoleDescription solo en AXGroup/AXGenericElement
            let role_desc = if editable
                || matches!(
                    raw_role.as_str(),
                    "AXGroup" | "AXGenericElement" | "AXTextArea" | "AXTextField" | "AXButton" | "AXUnknown"
                )
            {
                unsafe { ax_read_string(el, "AXRoleDescription") }.unwrap_or_default()
            } else {
                String::new()
            };

            let subrole = if matches!(
                raw_role.as_str(),
                "AXTextField" | "AXCheckBox" | "AXButton" | "AXGroup" | "AXWindow" | "AXUnknown"
            ) {
                unsafe { ax_read_string(el, "AXSubrole") }.unwrap_or_default()
            } else {
                String::new()
            };
            if subrole == "AXSecureTextField" {
                return;
            }

            let norm_role = normalize_ax_role_rich(&raw_role, &subrole, &role_desc, editable);
            if !ctx.wanted_roles.is_empty() && !focused_bonus {
                if !role_matches_filter(norm_role, ctx.wanted_roles) {
                    return;
                }
            } else if !is_interactive_role(norm_role) && !editable && !focused_bonus {
                return;
            }

            let name = element_accessible_name(el, norm_role, false);
            let description = unsafe { ax_read_string(el, "AXDescription") }
                .map(|s| redact_ui_text(&truncate_chars(&s, 140)))
                .unwrap_or_default();
            let identifier = unsafe { ax_read_string(el, "AXIdentifier") }
                .or_else(|| unsafe { ax_read_string(el, "AXDOMIdentifier") })
                .unwrap_or_default();

            let mut score: i32 = 0;
            let mut value: Option<String> = None;

            if !ctx.query_tokens.is_empty() {
                let name_low = name.to_ascii_lowercase();
                let desc_low = description.to_ascii_lowercase();
                let id_low = identifier.to_ascii_lowercase();
                let rd_low = role_desc.to_ascii_lowercase();
                let mut matched = 0i32;

                for tok in ctx.query_tokens {
                    if name_low.contains(tok) {
                        score += 25;
                        matched += 1;
                    } else if desc_low.contains(tok) || id_low.contains(tok) {
                        score += 18;
                        matched += 1;
                    } else if norm_role.contains(tok.as_str()) || rd_low.contains(tok) {
                        score += 10;
                        matched += 1;
                    }
                }
                if matched == 0 {
                    // Solo leer AXValue (IPC extra) si aún no hubo match por nombre/descripción/id
                    value = unsafe { ax_read_value_display(el) }
                        .map(|v| redact_ui_text(&truncate_chars(&v, 140)))
                        .filter(|v| v != &name);
                    if let Some(ref v) = value {
                        let v_low = v.to_ascii_lowercase();
                        for tok in ctx.query_tokens {
                            if v_low.contains(tok) {
                                score += 10;
                                matched += 1;
                            }
                        }
                    }
                }
                if matched == 0 && !focused_bonus {
                    return;
                }
            } else {
                // Sin query textual: priorizar controles de entrada y botones con nombre
                if matches!(norm_role, "textarea" | "textfield" | "search_field") {
                    score += 35;
                } else if matches!(norm_role, "button" | "link" | "combobox" | "tab") {
                    score += 20;
                } else {
                    score += 5;
                }
            }

            // Solo en los candidatos que ya pasaron rol + query leemos atributos secundarios (bounds, actions, token)
            if value.is_none() && matches!(norm_role, "textarea" | "textfield" | "search_field" | "combobox") {
                value = unsafe { ax_read_value_display(el) }
                    .map(|v| redact_ui_text(&truncate_chars(&v, 140)))
                    .filter(|v| v != &name);
            }
            let actions = compute_supported_actions(el, norm_role, false);
            let enabled = unsafe { ax_read_bool(el, "AXEnabled") }.unwrap_or(true);
            let focused = unsafe { ax_read_bool(el, "AXFocused") }.unwrap_or(false) || focused_bonus;

            if focused {
                score += 40;
            }
            if editable {
                score += 20;
            }
            if !name.is_empty() {
                score += 8;
            }
            if !enabled {
                score -= 10;
            }

            let bounds = unsafe { ax_read_bounds(el) };
            let token = capture_remote_token(el);

            let entry = RefEntry {
                ref_id: String::new(),
                snapshot_id: ctx.snapshot_id.to_string(),
                pid: ctx.window.pid,
                window_id: ctx.window.window_id,
                app_name: ctx.window.app_name.clone(),
                bundle_id: ctx.window.bundle_id.clone(),
                window_title: ctx.window.title.clone(),
                role: norm_role.to_string(),
                raw_role,
                name: name.clone(),
                description: description.clone(),
                identifier: identifier.clone(),
                actions: actions.clone(),
                bounds,
                is_secure: false,
                remote_token: token,
            };

            let node = DesktopUiNode {
                ref_id: None,
                role: norm_role.to_string(),
                name: if name.is_empty() { None } else { Some(name) },
                value,
                description: if description.is_empty() {
                    None
                } else {
                    Some(description)
                },
                identifier: if identifier.is_empty() {
                    None
                } else {
                    Some(identifier)
                },
                enabled,
                focused,
                is_secure: false,
                actions,
                bounds,
                depth,
            };

            ctx.hits.push(CandidateHit {
                score,
                is_drill_container: false,
                node,
                entry,
            });
        }

        // Recorrido BFS (por niveles) para visitar equitativamente paneles laterales, editores y chats
        // sin quedarse atrapado en un solo subárbol profundo del explorador de archivos en Electron/VS Code.
        fn walk_search_bfs(root: OwnedCF, ctx: &mut SearchCtx<'_>) {
            let mut queue: std::collections::VecDeque<(OwnedCF, usize)> =
                std::collections::VecDeque::with_capacity(256);
            queue.push_back((root, 0));

            while let Some((el, depth)) = queue.pop_front() {
                if ctx.nodes_observed >= ctx.max_nodes || Instant::now() >= ctx.deadline {
                    ctx.truncated = true;
                    break;
                }
                ctx.nodes_observed += 1;
                score_and_collect(el.as_ptr(), depth, ctx, false);

                if depth < 48 && ctx.nodes_observed < ctx.max_nodes && Instant::now() < ctx.deadline {
                    for child in unsafe { ax_children(el.as_ptr(), 100) } {
                        queue.push_back((child, depth + 1));
                    }
                } else if depth >= 48 {
                    ctx.truncated = true;
                }
            }
            if !queue.is_empty() {
                ctx.truncated = true;
            }
        }

        let mut ctx = SearchCtx {
            snapshot_id: &snapshot_id,
            window: &chosen,
            query_tokens: &query_tokens,
            wanted_roles: &wanted_roles,
            text_roles_only,
            max_nodes,
            deadline: Instant::now() + Duration::from_millis(time_budget_ms),
            nodes_observed: 0,
            truncated: false,
            hits: Vec::new(),
            containers: Vec::new(),
        };

        // Incluir el elemento enfocado actual como candidato prioritario
        if let Some(app_check) = OwnedCF::new(unsafe { AXUIElementCreateApplication(chosen.pid) }) {
            unsafe { AXUIElementSetMessagingTimeout(app_check.as_ptr(), 0.25) };
            if let Some(focused_el) = unsafe { ax_copy_attr(app_check.as_ptr(), "AXFocusedUIElement") } {
                score_and_collect(focused_el.as_ptr(), 0, &mut ctx, true);
            }
        }

        walk_search_bfs(root_el, &mut ctx);

        let SearchCtx {
            nodes_observed,
            truncated,
            mut hits,
            mut containers,
            ..
        } = ctx;

        hits.sort_by(|a, b| b.score.cmp(&a.score));

        // Si la búsqueda quedó truncada y hubo pocos/cero aciertos, exponer contenedores perforables (`root_ref`)
        if truncated && hits.len() < 3 && !containers.is_empty() {
            containers.sort_by(|a, b| b.score.cmp(&a.score));
            for c in containers.into_iter().take(4) {
                hits.push(c);
            }
        }

        // Deduplicar por token o por (role, name, bounds)
        let mut seen_keys = HashSet::new();
        let mut nodes = Vec::new();
        let mut refs = Vec::new();
        let mut lines = Vec::new();
        let mut idx = 0usize;
        let mut actionable_matches = 0usize;

        for mut hit in hits {
            let dedup_key = if let Some(ref tok) = hit.entry.remote_token {
                format!("tok:{tok:?}")
            } else {
                format!(
                    "{}|{}|{:?}",
                    hit.entry.role, hit.entry.name, hit.entry.bounds
                )
            };
            if !seen_keys.insert(dedup_key) {
                continue;
            }
            idx += 1;
            let rid = format!("{snapshot_id}:@e{idx}");
            hit.entry.ref_id = rid.clone();
            hit.node.ref_id = Some(rid.clone());
            let mut line = format_node_line(
                "",
                &hit.node.role,
                Some(&rid),
                false,
                hit.node.name.as_deref().unwrap_or(""),
                hit.node.value.as_deref(),
                hit.node.enabled,
                hit.node.focused,
                &hit.node.actions,
                hit.node.bounds,
            );
            if hit.is_drill_container {
                line.push_str(" [drill_container: usa como root_ref]");
            } else {
                actionable_matches += 1;
            }
            lines.push(line);
            refs.push(hit.entry);
            nodes.push(hit.node);
            if idx >= limit {
                break;
            }
        }

        let refs_allocated = refs.len();
        let _ = state.save_snapshot(snapshot_id.clone(), refs);

        let scan_note = if !truncated {
            ""
        } else if actionable_matches > 0 {
            " [coincidencias encontradas; recorrido parcial del árbol]"
        } else {
            " [recorrido incompleto sin coincidencias: usa root_ref o sube max_nodes]"
        };
        let header = format!(
            "Búsqueda {} · App: {} · Ventana: \"{}\" · {} coincidencias (de {} nodos revisados / tope {}){}",
            snapshot_id,
            chosen.app_name,
            chosen.title,
            actionable_matches,
            nodes_observed,
            max_nodes,
            scan_note,
        );
        let tree_text = if lines.is_empty() {
            format!(
                "{header}\n(Sin coincidencias para '{}'. Prueba SIN query usando roles=['textarea','textfield'] o sube max_nodes.)",
                opts.query
            )
        } else {
            format!("{header}\n{}", lines.join("\n"))
        };

        DesktopSnapshotOutput {
            ok: true,
            accessibility_granted: true,
            blocked_sensitive: false,
            sensitive_reason: None,
            snapshot_id: Some(snapshot_id),
            window: Some(chosen),
            complete: !truncated,
            truncated,
            nodes_observed,
            refs_allocated,
            nodes,
            tree_text,
            error: None,
        }
    }

    pub fn focus_desktop_window(
        window_id: Option<u32>,
        app_name: Option<&str>,
    ) -> DesktopActionOutput {
        if !is_accessibility_trusted() {
            return DesktopActionOutput {
                ok: false,
                action: DesktopOperation::FocusWindow.as_str().to_string(),
                ref_id: None,
                app_name: app_name.unwrap_or("").to_string(),
                bundle_id: String::new(),
                window_title: String::new(),
                mechanism: "semantic_ax".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::not_delivered(Some(
                    "Permiso de Accesibilidad no concedido.".to_string(),
                )),
                error: Some(
                    "XOOK necesita permiso de Accesibilidad en macOS para enfocar ventanas."
                        .to_string(),
                ),
            };
        }

        let (_, windows) = list_desktop_windows();
        let Some(chosen) = pick_target_window(&windows, window_id, app_name) else {
            return DesktopActionOutput {
                ok: false,
                action: DesktopOperation::FocusWindow.as_str().to_string(),
                ref_id: None,
                app_name: app_name.unwrap_or("").to_string(),
                bundle_id: String::new(),
                window_title: String::new(),
                mechanism: "semantic_ax".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::not_delivered(None),
                error: Some("No se encontró la ventana objetivo.".to_string()),
            };
        };

        if chosen.is_sensitive {
            return DesktopActionOutput {
                ok: false,
                action: DesktopOperation::FocusWindow.as_str().to_string(),
                ref_id: None,
                app_name: chosen.app_name,
                bundle_id: chosen.bundle_id,
                window_title: chosen.title,
                mechanism: "semantic_ax".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::not_delivered(chosen.sensitive_reason.clone()),
                error: Some(
                    chosen
                        .sensitive_reason
                        .unwrap_or_else(|| "Ventana sensible bloqueada por seguridad.".to_string()),
                ),
            };
        }

        match activate_window_and_wait(chosen.pid, &chosen.title, chosen.bounds) {
            Ok(()) => DesktopActionOutput {
                ok: true,
                action: DesktopOperation::FocusWindow.as_str().to_string(),
                ref_id: None,
                app_name: chosen.app_name.clone(),
                bundle_id: chosen.bundle_id,
                window_title: chosen.title.clone(),
                mechanism: "semantic_ax:AXRaise".to_string(),
                summary: format!("Se enfocó la ventana '{}' de {}.", chosen.title, chosen.app_name),
                post_value: None,
                disposition: DesktopDisposition::delivered_verified(None),
                error: None,
            },
            Err(err) => DesktopActionOutput {
                ok: false,
                action: DesktopOperation::FocusWindow.as_str().to_string(),
                ref_id: None,
                app_name: chosen.app_name,
                bundle_id: chosen.bundle_id,
                window_title: chosen.title,
                mechanism: "semantic_ax:AXRaise".to_string(),
                summary: String::new(),
                post_value: None,
                disposition: DesktopDisposition::delivered_unverified(Some(err.clone())),
                error: Some(err),
            },
        }
    }

    pub fn perform_coordinate_click(
        window: &DesktopWindowInfo,
        x: f64,
        y: f64,
    ) -> DesktopActionOutput {
        let base_fail = |err: String, disp: DesktopDisposition| DesktopActionOutput {
            ok: false,
            action: DesktopOperation::Click.as_str().to_string(),
            ref_id: None,
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "physical_cgevent:click".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: disp,
            error: Some(err),
        };

        if !is_accessibility_trusted() {
            return base_fail(
                "XOOK necesita permiso de Accesibilidad en macOS.".to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if window.is_sensitive {
            return base_fail(
                window
                    .sensitive_reason
                    .clone()
                    .unwrap_or_else(|| "Ventana sensible bloqueada.".to_string()),
                DesktopDisposition::not_delivered(None),
            );
        }
        let b = window.bounds;
        if x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height {
            return base_fail(
                format!(
                    "Coordenadas ({x:.0}, {y:.0}) fuera de los límites de la ventana '{}' ({},{},{}x{}).",
                    window.title, b.x as i64, b.y as i64, b.width as i64, b.height as i64
                ),
                DesktopDisposition::not_delivered(None),
            );
        }

        let _lease = match input_lease().lock() {
            Ok(g) => g,
            Err(_) => {
                return base_fail(
                    "No se pudo adquirir exclusividad de entrada física.".to_string(),
                    DesktopDisposition::not_delivered(None),
                );
            }
        };

        if let Err(err) = activate_window_and_wait(window.pid, &window.title, window.bounds) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }
        if let Err(err) = post_physical_click_at(x, y) {
            return base_fail(err, DesktopDisposition::delivered_unverified(None));
        }

        DesktopActionOutput {
            ok: true,
            action: DesktopOperation::Click.as_str().to_string(),
            ref_id: None,
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "physical_cgevent:click".to_string(),
            summary: format!("Clic físico en ({:.0}, {:.0}) dentro de {}.", x, y, window.app_name),
            post_value: None,
            disposition: DesktopDisposition::delivered_verified(None),
            error: None,
        }
    }

    pub fn perform_type_text(
        entry: Option<&RefEntry>,
        window: &DesktopWindowInfo,
        coord_xy: Option<(f64, f64)>,
        text: &str,
        clear_first: bool,
        press_enter: bool,
    ) -> DesktopActionOutput {
        let ref_id = entry.map(|e| e.ref_id.clone());
        let base_fail = |err: String, disp: DesktopDisposition| DesktopActionOutput {
            ok: false,
            action: DesktopOperation::TypeText.as_str().to_string(),
            ref_id: ref_id.clone(),
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "physical_cgevent:type_text".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: disp,
            error: Some(err),
        };

        if !is_accessibility_trusted() {
            return base_fail(
                "XOOK necesita permiso de Accesibilidad en macOS para escribir en otras apps."
                    .to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if window.is_sensitive {
            return base_fail(
                window
                    .sensitive_reason
                    .clone()
                    .unwrap_or_else(|| "Ventana sensible bloqueada.".to_string()),
                DesktopDisposition::not_delivered(None),
            );
        }
        if entry.is_none()
            && coord_xy.is_none()
            && is_electron_or_chromium_app(&window.bundle_id, &window.app_name)
        {
            return base_fail(
                format!(
                    "BLOCKED_BLIND_TYPE: En apps Electron/Chromium ('{}') está prohibido usar type_text solo con app_name. Usa desktop_find(app_name='{}', roles=['textarea','textfield']) SIN query para obtener un ref_id verificado (sN:@eM), o pasa coordenadas físicas explícitas (x, y).",
                    window.app_name, window.app_name
                ),
                DesktopDisposition::not_delivered(Some(
                    "type_text sin ref_id ni coordenadas bloqueado en app Electron/Chromium.".to_string(),
                )),
            );
        }
        if let Some((x, y)) = coord_xy {
            let b = window.bounds;
            if x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height {
                return base_fail(
                    format!(
                        "Coordenadas ({x:.0}, {y:.0}) fuera de los límites de la ventana '{}' ({},{},{}x{}).",
                        window.title, b.x as i64, b.y as i64, b.width as i64, b.height as i64
                    ),
                    DesktopDisposition::not_delivered(None),
                );
            }
        }
        if text.is_empty() {
            return base_fail(
                "El texto a escribir está vacío.".to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if text.chars().count() > 8000 {
            return base_fail(
                "El texto excede el límite seguro de 8000 caracteres por acción.".to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }

        let live_el_opt = if let Some(e) = entry {
            if e.is_secure {
                return base_fail(
                    "Bloqueado por privacidad: no se permite escribir en campos de contraseña."
                        .to_string(),
                    DesktopDisposition::not_delivered(None),
                );
            }
            match resolve_live_ax_element(e) {
                Ok(el) => Some(el),
                Err(err) => return base_fail(err, DesktopDisposition::not_delivered(None)),
            }
        } else {
            None
        };

        let _lease = match input_lease().lock() {
            Ok(g) => g,
            Err(_) => {
                return base_fail(
                    "No se pudo adquirir exclusividad de entrada física.".to_string(),
                    DesktopDisposition::not_delivered(None),
                );
            }
        };

        // 1. Traer al frente la ventana exacta de la app objetivo
        if let Err(err) = activate_window_and_wait(window.pid, &window.title, window.bounds) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }

        // 2. Enfocar el control objetivo (ref_id -> AXFocused + clic físico; o coordenadas explícitas (x, y))
        if let Some(ref el) = live_el_opt {
            let _ = unsafe { ax_set_bool(el.as_ptr(), "AXFocused", true) };
            thread::sleep(Duration::from_millis(25));
            let is_focused_now = if let Some(app_el) =
                OwnedCF::new(unsafe { AXUIElementCreateApplication(window.pid) })
            {
                unsafe { ax_copy_attr(app_el.as_ptr(), "AXFocusedUIElement") }
                    .map(|f| unsafe { CFEqual(f.as_ptr(), el.as_ptr()) })
                    .unwrap_or(false)
            } else {
                false
            };
            let is_rich_web_input = entry
                .map(|e| matches!(e.role.as_str(), "textarea" | "group" | "web_area"))
                .unwrap_or(false);
            if !is_focused_now || is_rich_web_input {
                if let Some(b) = unsafe { ax_read_bounds(el.as_ptr()) }
                    .or_else(|| entry.and_then(|e| e.bounds))
                {
                    if b.width > 2.0 && b.height > 2.0 {
                        let cx = b.x + b.width / 2.0;
                        let cy = b.y + b.height / 2.0;
                        let _ = post_physical_click_at(cx, cy);
                        thread::sleep(Duration::from_millis(65));
                    }
                }
            }
        } else if let Some((x, y)) = coord_xy {
            if let Err(err) = post_physical_click_at(x, y) {
                return base_fail(err, DesktopDisposition::not_delivered(None));
            }
            thread::sleep(Duration::from_millis(75));
        } else {
            // Sin ref_id ni coordenadas (solo permitido en apps nativas): verificar que exista un campo editable enfocado
            let has_editable_focus = if let Some(app_el) =
                OwnedCF::new(unsafe { AXUIElementCreateApplication(window.pid) })
            {
                unsafe { AXUIElementSetMessagingTimeout(app_el.as_ptr(), 0.3) };
                if let Some(focused) = unsafe { ax_copy_attr(app_el.as_ptr(), "AXFocusedUIElement") } {
                    let r = unsafe { ax_read_string(focused.as_ptr(), "AXRole") }.unwrap_or_default();
                    let ed = unsafe { ax_read_bool(focused.as_ptr(), "AXEditable") }.unwrap_or(false);
                    ed || matches!(
                        r.as_str(),
                        "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField"
                    )
                } else {
                    false
                }
            } else {
                false
            };
            if !has_editable_focus {
                return base_fail(
                    format!(
                        "BLOCKED_BLIND_TYPE: No hay un campo de texto enfocado en '{}'. Ejecuta desktop_find(app_name='{}', roles=['textarea','textfield']) para obtener un ref_id verificado (sN:@eM) o pasa coordenadas (x, y).",
                        window.app_name, window.app_name
                    ),
                    DesktopDisposition::not_delivered(Some(
                        "No se detectó foco real en un campo editable; texto no enviado.".to_string(),
                    )),
                );
            }
        }

        // 3. Re-verificar que el foco real NO esté en un campo de contraseña
        if let Err(err) = check_focused_element_not_secure(window.pid) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }
        if let Err(err) = ensure_app_still_active(window.pid) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }

        // 4. Limpiar si se pidió `clear: true`
        if clear_first {
            if let Err(err) = post_physical_key(0, K_CG_EVENT_FLAG_COMMAND) {
                return base_fail(err, DesktopDisposition::delivered_unverified(None));
            }
            thread::sleep(Duration::from_millis(20));
            if let Err(err) = post_physical_key(51, 0) {
                return base_fail(err, DesktopDisposition::delivered_unverified(None));
            }
            thread::sleep(Duration::from_millis(20));
        }

        // 5. Escribir texto Unicode por bloques seguros
        if let Err(err) = post_unicode_text(text, window.pid) {
            return base_fail(
                err,
                DesktopDisposition::delivered_unverified(Some(
                    "Parte del texto pudo haberse escrito; verifica con desktop_snapshot antes de reintentar."
                        .to_string(),
                )),
            );
        }

        // 6. Presionar Enter si se solicitó (ej. enviar mensaje en un chat)
        if press_enter {
            thread::sleep(Duration::from_millis(45));
            if let Err(err) = ensure_app_still_active(window.pid) {
                return base_fail(
                    err,
                    DesktopDisposition::delivered_unverified(Some(
                        "El texto se escribió pero se perdió el foco antes de presionar Enter."
                            .to_string(),
                    )),
                );
            }
            if let Err(err) = post_physical_key(36, 0) {
                return base_fail(
                    err,
                    DesktopDisposition::delivered_unverified(Some(
                        "El texto se escribió pero falló el evento Return.".to_string(),
                    )),
                );
            }
        }

        let post_val = live_el_opt
            .as_ref()
            .and_then(|el| unsafe { ax_read_value_display(el.as_ptr()) })
            .map(|v| redact_ui_text(&truncate_chars(&v, 140)));

        let action_note = if press_enter {
            format!("Texto escrito y enviado con Enter en {}.", window.app_name)
        } else {
            format!("Texto escrito en {}.", window.app_name)
        };

        DesktopActionOutput {
            ok: true,
            action: DesktopOperation::TypeText.as_str().to_string(),
            ref_id,
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: if press_enter {
                "physical_cgevent:type_text+return".to_string()
            } else {
                "physical_cgevent:type_text".to_string()
            },
            summary: action_note,
            post_value: post_val,
            disposition: DesktopDisposition::delivered_verified(None),
            error: None,
        }
    }

    pub fn perform_press_key(
        entry: Option<&RefEntry>,
        window: &DesktopWindowInfo,
        combo: &ParsedKeyCombo,
    ) -> DesktopActionOutput {
        let ref_id = entry.map(|e| e.ref_id.clone());
        let base_fail = |err: String, disp: DesktopDisposition| DesktopActionOutput {
            ok: false,
            action: DesktopOperation::PressKey.as_str().to_string(),
            ref_id: ref_id.clone(),
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: format!("physical_cgevent:key({})", combo.display),
            summary: String::new(),
            post_value: None,
            disposition: disp,
            error: Some(err),
        };

        if is_blocked_key_combo(combo) {
            return base_fail(
                format!(
                    "Bloqueado por Guardián Capa 1: el atajo '{}' está prohibido por seguridad.",
                    combo.display
                ),
                DesktopDisposition::not_delivered(None),
            );
        }
        if !is_accessibility_trusted() {
            return base_fail(
                "XOOK necesita permiso de Accesibilidad en macOS para enviar teclas.".to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if window.is_sensitive {
            return base_fail(
                window
                    .sensitive_reason
                    .clone()
                    .unwrap_or_else(|| "Ventana sensible bloqueada.".to_string()),
                DesktopDisposition::not_delivered(None),
            );
        }
        let key_code = match macos_key_code(&combo.key) {
            Ok(c) => c,
            Err(err) => return base_fail(err, DesktopDisposition::not_delivered(None)),
        };

        let live_el_opt = if let Some(e) = entry {
            match resolve_live_ax_element(e) {
                Ok(el) => Some(el),
                Err(err) => return base_fail(err, DesktopDisposition::not_delivered(None)),
            }
        } else {
            None
        };

        let _lease = match input_lease().lock() {
            Ok(g) => g,
            Err(_) => {
                return base_fail(
                    "No se pudo adquirir exclusividad de entrada física.".to_string(),
                    DesktopDisposition::not_delivered(None),
                );
            }
        };

        if let Err(err) = activate_window_and_wait(window.pid, &window.title, window.bounds) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }
        if let Some(ref el) = live_el_opt {
            let _ = unsafe { ax_set_bool(el.as_ptr(), "AXFocused", true) };
            thread::sleep(Duration::from_millis(25));
        }
        if let Err(err) = check_focused_element_not_secure(window.pid) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }
        if let Err(err) = ensure_app_still_active(window.pid) {
            return base_fail(err, DesktopDisposition::not_delivered(None));
        }

        let flags = cg_flags_for_modifiers(&combo.modifiers);
        if let Err(err) = post_physical_key(key_code, flags) {
            return base_fail(err, DesktopDisposition::delivered_unverified(None));
        }

        DesktopActionOutput {
            ok: true,
            action: DesktopOperation::PressKey.as_str().to_string(),
            ref_id,
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: format!("physical_cgevent:key({})", combo.display),
            summary: format!("Se presionó '{}' en {}.", combo.display, window.app_name),
            post_value: None,
            disposition: DesktopDisposition::delivered_verified(None),
            error: None,
        }
    }

    pub fn perform_semantic_ref_action(
        entry: &RefEntry,
        op: DesktopOperation,
        value: Option<&str>,
        prefer_headed: bool,
    ) -> DesktopActionOutput {
        let base_fail = |err: String, disp: DesktopDisposition| DesktopActionOutput {
            ok: false,
            action: op.as_str().to_string(),
            ref_id: Some(entry.ref_id.clone()),
            app_name: entry.app_name.clone(),
            bundle_id: entry.bundle_id.clone(),
            window_title: entry.window_title.clone(),
            mechanism: "semantic_ax".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: disp,
            error: Some(err),
        };

        if !is_accessibility_trusted() {
            return base_fail(
                "XOOK necesita permiso de Accesibilidad en macOS para operar controles de otras apps."
                    .to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if entry.is_secure {
            return base_fail(
                "Bloqueado por privacidad: no se permite operar sobre campos de contraseña."
                    .to_string(),
                DesktopDisposition::not_delivered(None),
            );
        }
        if let Some(reason) =
            detect_sensitive_window(&entry.bundle_id, &entry.app_name, &entry.window_title)
        {
            return base_fail(reason, DesktopDisposition::not_delivered(None));
        }

        let live_el = match resolve_live_ax_element(entry) {
            Ok(el) => el,
            Err(err) => return base_fail(err, DesktopDisposition::not_delivered(None)),
        };

        if let Some(false) = unsafe { ax_read_bool(live_el.as_ptr(), "AXEnabled") } {
            return base_fail(
                format!(
                    "NOT_ACTIONABLE: El control '{}' ({}) está deshabilitado actualmente.",
                    entry.name, entry.ref_id
                ),
                DesktopDisposition::not_delivered(None),
            );
        }

        let label = if entry.name.is_empty() {
            entry.role.clone()
        } else {
            format!("{} «{}»", entry.role, entry.name)
        };

        match op {
            DesktopOperation::Click => {
                let try_physical_click = |live_el_ptr: AXUIElementRef| -> DesktopActionOutput {
                    let Some(b) = unsafe { ax_read_bounds(live_el_ptr) }.or(entry.bounds) else {
                        return base_fail(
                            format!("El control {label} no tiene coordenadas visibles para clic físico."),
                            DesktopDisposition::not_delivered(None),
                        );
                    };
                    if b.width <= 1.0 || b.height <= 1.0 {
                        return base_fail(
                            format!("El control {label} tiene tamaño cero o está fuera de vista. Usa scroll_to primero."),
                            DesktopDisposition::not_delivered(None),
                        );
                    }
                    let _lease = match input_lease().lock() {
                        Ok(g) => g,
                        Err(_) => {
                            return base_fail(
                                "No se pudo adquirir exclusividad de entrada física.".to_string(),
                                DesktopDisposition::not_delivered(None),
                            );
                        }
                    };
                    if let Err(err) = activate_window_and_wait(entry.pid, &entry.window_title, b) {
                        return base_fail(err, DesktopDisposition::not_delivered(None));
                    }
                    let cx = b.x + b.width / 2.0;
                    let cy = b.y + b.height / 2.0;
                    if let Err(err) = post_physical_click_at(cx, cy) {
                        return base_fail(err, DesktopDisposition::delivered_unverified(None));
                    }
                    DesktopActionOutput {
                        ok: true,
                        action: op.as_str().to_string(),
                        ref_id: Some(entry.ref_id.clone()),
                        app_name: entry.app_name.clone(),
                        bundle_id: entry.bundle_id.clone(),
                        window_title: entry.window_title.clone(),
                        mechanism: "physical_cgevent:click".to_string(),
                        summary: format!("Se hizo clic en {label} de {}.", entry.app_name),
                        post_value: None,
                        disposition: DesktopDisposition::delivered_verified(None),
                        error: None,
                    }
                };

                // Si el llamador pidió `headed=true` o es un campo de texto/área web, el clic físico es el camino fiable
                if prefer_headed
                    || matches!(
                        entry.role.as_str(),
                        "textarea" | "textfield" | "search_field" | "web_area"
                    )
                {
                    return try_physical_click(live_el.as_ptr());
                }

                // Intento semántico headless primero; si la app no lo soporta, fallback físico controlado
                for ax_action in ["AXPress", "AXOpen", "AXConfirm"] {
                    let Some(act_key) = cf_str(ax_action) else {
                        continue;
                    };
                    let err = unsafe { AXUIElementPerformAction(live_el.as_ptr(), act_key.as_ptr()) };
                    if err == K_AX_ERROR_SUCCESS {
                        return DesktopActionOutput {
                            ok: true,
                            action: op.as_str().to_string(),
                            ref_id: Some(entry.ref_id.clone()),
                            app_name: entry.app_name.clone(),
                            bundle_id: entry.bundle_id.clone(),
                            window_title: entry.window_title.clone(),
                            mechanism: format!("semantic_ax:{ax_action}"),
                            summary: format!(
                                "Se activó {label} en {} (vía {ax_action}).",
                                entry.app_name
                            ),
                            post_value: None,
                            disposition: DesktopDisposition::delivered_verified(Some(format!(
                                "Acción semántica {ax_action} aceptada por {}.",
                                entry.app_name
                            ))),
                            error: None,
                        };
                    }
                    if err == K_AX_ERROR_CANNOT_COMPLETE {
                        return base_fail(
                            format!(
                                "La aplicación '{}' tardó demasiado al ejecutar {ax_action}. Verifica con desktop_snapshot antes de reintentar.",
                                entry.app_name
                            ),
                            DesktopDisposition::delivered_unverified(Some(
                                "Timeout durante mutación AX: el clic pudo haber aterrizado."
                                    .to_string(),
                            )),
                        );
                    }
                    if err == K_AX_ERROR_API_DISABLED {
                        return base_fail(
                            "La API de Accesibilidad de macOS no está habilitada para XOOK."
                                .to_string(),
                            DesktopDisposition::not_delivered(None),
                        );
                    }
                    if err == K_AX_ERROR_INVALID_UI_ELEMENT {
                        return base_fail(
                            format!(
                                "STALE_REF: El elemento '{}' desapareció justo antes del clic.",
                                entry.ref_id
                            ),
                            DesktopDisposition::not_delivered(None),
                        );
                    }
                }

                // Fallback físico automático cuando AXPress no está soportado (común en Electron/Web)
                try_physical_click(live_el.as_ptr())
            }
            DesktopOperation::SetValue => {
                let text = value.unwrap_or("");
                if !unsafe { ax_is_settable(live_el.as_ptr(), "AXValue") } {
                    return base_fail(
                        format!(
                            "El control {label} no admite AXValue directo (típico en Electron/React/web). Usa action='type_text' con este mismo ref_id."
                        ),
                        DesktopDisposition::not_delivered(None),
                    );
                }
                let err = unsafe { ax_set_string(live_el.as_ptr(), "AXValue", text) };
                if err != K_AX_ERROR_SUCCESS {
                    let disp = if err == K_AX_ERROR_CANNOT_COMPLETE {
                        DesktopDisposition::delivered_unverified(Some(
                            "Timeout al escribir AXValue; verifica el valor actual con desktop_snapshot."
                                .to_string(),
                        ))
                    } else {
                        DesktopDisposition::not_delivered(None)
                    };
                    return base_fail(
                        format!("No se pudo escribir el valor en {label} (AXError {err}). Prueba action='type_text'."),
                        disp,
                    );
                }
                let observed = unsafe { ax_read_value_display(live_el.as_ptr()) }
                    .map(|v| redact_ui_text(&truncate_chars(&v, 140)));
                let verified = observed.as_deref() == Some(text.trim()) || text.is_empty();
                let disp = if verified {
                    DesktopDisposition::delivered_verified(None)
                } else {
                    DesktopDisposition::delivered_unverified(Some(
                        "AXValue aceptó la escritura pero el valor leído difiere; si es una app Electron/web usa action='type_text'."
                            .to_string(),
                    ))
                };
                DesktopActionOutput {
                    ok: true,
                    action: op.as_str().to_string(),
                    ref_id: Some(entry.ref_id.clone()),
                    app_name: entry.app_name.clone(),
                    bundle_id: entry.bundle_id.clone(),
                    window_title: entry.window_title.clone(),
                    mechanism: "semantic_ax:AXValue".to_string(),
                    summary: format!("Valor actualizado en {label} de {}.", entry.app_name),
                    post_value: observed,
                    disposition: disp,
                    error: None,
                }
            }
            DesktopOperation::Focus => {
                if unsafe { ax_is_settable(live_el.as_ptr(), "AXFocused") }
                    && unsafe { ax_set_bool(live_el.as_ptr(), "AXFocused", true) }
                        == K_AX_ERROR_SUCCESS
                {
                    return DesktopActionOutput {
                        ok: true,
                        action: op.as_str().to_string(),
                        ref_id: Some(entry.ref_id.clone()),
                        app_name: entry.app_name.clone(),
                        bundle_id: entry.bundle_id.clone(),
                        window_title: entry.window_title.clone(),
                        mechanism: "semantic_ax:AXFocused".to_string(),
                        summary: format!("Se enfocó {label} en {}.", entry.app_name),
                        post_value: None,
                        disposition: DesktopDisposition::delivered_verified(None),
                        error: None,
                    };
                }
                base_fail(
                    format!("El control {label} no admite foco por accesibilidad; prueba click."),
                    DesktopDisposition::not_delivered(None),
                )
            }
            DesktopOperation::ScrollTo => {
                let Some(key) = cf_str("AXScrollToVisible") else {
                    return base_fail(
                        "Error interno preparando AXScrollToVisible.".to_string(),
                        DesktopDisposition::not_delivered(None),
                    );
                };
                let err = unsafe { AXUIElementPerformAction(live_el.as_ptr(), key.as_ptr()) };
                if err == K_AX_ERROR_SUCCESS {
                    DesktopActionOutput {
                        ok: true,
                        action: op.as_str().to_string(),
                        ref_id: Some(entry.ref_id.clone()),
                        app_name: entry.app_name.clone(),
                        bundle_id: entry.bundle_id.clone(),
                        window_title: entry.window_title.clone(),
                        mechanism: "semantic_ax:AXScrollToVisible".to_string(),
                        summary: format!("Se desplazó hasta {label} en {}.", entry.app_name),
                        post_value: None,
                        disposition: DesktopDisposition::delivered_verified(None),
                        error: None,
                    }
                } else {
                    base_fail(
                        format!("El control {label} no soporta AXScrollToVisible (AXError {err})."),
                        DesktopDisposition::not_delivered(None),
                    )
                }
            }
            DesktopOperation::ListWindows
            | DesktopOperation::Snapshot
            | DesktopOperation::Find
            | DesktopOperation::FocusWindow
            | DesktopOperation::TypeText
            | DesktopOperation::PressKey => base_fail(
                "Operación no válida para acción semántica simple.".to_string(),
                DesktopDisposition::not_delivered(None),
            ),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::*;

    pub fn list_desktop_windows() -> (bool, Vec<DesktopWindowInfo>) {
        (false, Vec::new())
    }

    pub fn pick_target_window(
        _windows: &[DesktopWindowInfo],
        _window_id: Option<u32>,
        _app_query: Option<&str>,
    ) -> Option<DesktopWindowInfo> {
        None
    }

    pub fn snapshot_window(
        _state: &DesktopControlState,
        _opts: &DesktopSnapshotOptions,
    ) -> DesktopSnapshotOutput {
        DesktopSnapshotOutput {
            ok: false,
            accessibility_granted: false,
            blocked_sensitive: false,
            sensitive_reason: None,
            snapshot_id: None,
            window: None,
            complete: false,
            truncated: false,
            nodes_observed: 0,
            refs_allocated: 0,
            nodes: Vec::new(),
            tree_text: String::new(),
            error: Some("La inspección de UI de escritorio está disponible actualmente en macOS.".to_string()),
        }
    }

    pub fn find_elements(
        _state: &DesktopControlState,
        _opts: &DesktopFindOptions,
    ) -> DesktopSnapshotOutput {
        snapshot_window(_state, &DesktopSnapshotOptions::default())
    }

    pub fn focus_desktop_window(
        _window_id: Option<u32>,
        app_name: Option<&str>,
    ) -> DesktopActionOutput {
        DesktopActionOutput {
            ok: false,
            action: DesktopOperation::FocusWindow.as_str().to_string(),
            ref_id: None,
            app_name: app_name.unwrap_or("").to_string(),
            bundle_id: String::new(),
            window_title: String::new(),
            mechanism: "unsupported".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: DesktopDisposition::not_delivered(None),
            error: Some("Disponible actualmente en macOS.".to_string()),
        }
    }

    pub fn perform_coordinate_click(
        window: &DesktopWindowInfo,
        _x: f64,
        _y: f64,
    ) -> DesktopActionOutput {
        DesktopActionOutput {
            ok: false,
            action: DesktopOperation::Click.as_str().to_string(),
            ref_id: None,
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "unsupported".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: DesktopDisposition::not_delivered(None),
            error: Some("Disponible actualmente en macOS.".to_string()),
        }
    }

    pub fn perform_type_text(
        entry: Option<&RefEntry>,
        window: &DesktopWindowInfo,
        _coord_xy: Option<(f64, f64)>,
        _text: &str,
        _clear_first: bool,
        _press_enter: bool,
    ) -> DesktopActionOutput {
        DesktopActionOutput {
            ok: false,
            action: DesktopOperation::TypeText.as_str().to_string(),
            ref_id: entry.map(|e| e.ref_id.clone()),
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "unsupported".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: DesktopDisposition::not_delivered(None),
            error: Some("Disponible actualmente en macOS.".to_string()),
        }
    }

    pub fn perform_press_key(
        entry: Option<&RefEntry>,
        window: &DesktopWindowInfo,
        _combo: &ParsedKeyCombo,
    ) -> DesktopActionOutput {
        DesktopActionOutput {
            ok: false,
            action: DesktopOperation::PressKey.as_str().to_string(),
            ref_id: entry.map(|e| e.ref_id.clone()),
            app_name: window.app_name.clone(),
            bundle_id: window.bundle_id.clone(),
            window_title: window.title.clone(),
            mechanism: "unsupported".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: DesktopDisposition::not_delivered(None),
            error: Some("Disponible actualmente en macOS.".to_string()),
        }
    }

    pub fn perform_semantic_ref_action(
        entry: &RefEntry,
        op: DesktopOperation,
        _value: Option<&str>,
        _prefer_headed: bool,
    ) -> DesktopActionOutput {
        DesktopActionOutput {
            ok: false,
            action: op.as_str().to_string(),
            ref_id: Some(entry.ref_id.clone()),
            app_name: entry.app_name.clone(),
            bundle_id: entry.bundle_id.clone(),
            window_title: entry.window_title.clone(),
            mechanism: "unsupported".to_string(),
            summary: String::new(),
            post_value: None,
            disposition: DesktopDisposition::not_delivered(None),
            error: Some("Disponible actualmente en macOS.".to_string()),
        }
    }
}

pub use imp::{
    find_elements, focus_desktop_window, list_desktop_windows, perform_coordinate_click,
    perform_press_key, perform_semantic_ref_action, perform_type_text, pick_target_window,
    snapshot_window,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_common_ax_roles_editable_and_secure_fields() {
        assert_eq!(normalize_ax_role("AXButton", ""), "button");
        assert_eq!(normalize_ax_role("AXTextField", "AXSearchField"), "search_field");
        assert_eq!(normalize_ax_role("AXTextField", "AXSecureTextField"), "password_field");
        assert_eq!(normalize_ax_role("AXCheckBox", "AXSwitch"), "switch");
        assert_eq!(
            normalize_ax_role_rich("AXGroup", "", "text entry area", false),
            "textarea"
        );
        assert_eq!(normalize_ax_role_rich("AXGroup", "", "", true), "textarea");
        assert!(is_interactive_role("textarea"));
        assert!(is_drillable_container_role("web_area"));
    }

    #[test]
    fn maps_macos_key_codes_for_common_keys() {
        assert_eq!(macos_key_code("return").unwrap(), 36);
        assert_eq!(macos_key_code("esc").unwrap(), 53);
        assert_eq!(macos_key_code("tab").unwrap(), 48);
        assert_eq!(macos_key_code("delete").unwrap(), 51);
        assert_eq!(macos_key_code("a").unwrap(), 0);
        assert!(macos_key_code("nonexistent_key").is_err());
    }

    #[test]
    fn lists_windows_cleanly_without_panicking() {
        let (_trusted, windows) = list_desktop_windows();
        assert!(windows.len() <= 20);
        let my_pid = std::process::id() as i32;
        assert!(windows.iter().all(|w| w.pid != my_pid));
    }
}
