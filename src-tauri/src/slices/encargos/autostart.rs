//! XOOK arranca al iniciar sesión cuando hay pendientes programados (decisión del 2026-11-23),
//! para que estén a tiempo aunque el usuario no abra la app.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Runtime};

pub fn ensure_enabled<R: Runtime>(app: &AppHandle<R>) {
    // En desarrollo el ejecutable es el de `target/debug`: registrarlo abriría una ventana vacía
    // al iniciar sesión, sin el servidor de la interfaz.
    if cfg!(debug_assertions) {
        return;
    }
    static CHECKED: AtomicBool = AtomicBool::new(false);
    if CHECKED.swap(true, Ordering::SeqCst) {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if !launcher.is_enabled().unwrap_or(false) {
        let _ = launcher.enable();
    }
}
