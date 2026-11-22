//! Almacén efímero en RAM para snapshots de accesibilidad, RefMaps y recibos idempotentes.
//!
//! Cero persistencia en disco por defecto (alineado a privacidad en AGENTS.md).

use super::policy::validate_qualified_ref;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_RETAINED_SNAPSHOTS: usize = 16;
const MAX_RETAINED_RECEIPTS: usize = 64;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowInfo {
    pub window_id: u32,
    pub pid: i32,
    pub app_name: String,
    pub bundle_id: String,
    pub title: String,
    pub bounds: DesktopBounds,
    pub is_sensitive: bool,
    pub sensitive_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUiNode {
    pub ref_id: Option<String>,
    pub role: String,
    pub name: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    pub identifier: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub is_secure: bool,
    pub actions: Vec<String>,
    pub bounds: Option<DesktopBounds>,
    pub depth: usize,
}

#[derive(Debug, Clone)]
pub struct RefEntry {
    pub ref_id: String,
    #[allow(dead_code)]
    pub snapshot_id: String,
    pub pid: i32,
    pub window_id: u32,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub role: String,
    #[allow(dead_code)]
    pub raw_role: String,
    pub name: String,
    pub description: String,
    pub identifier: String,
    #[allow(dead_code)]
    pub actions: Vec<String>,
    pub bounds: Option<DesktopBounds>,
    pub is_secure: bool,
    /// Token opaco nativo de macOS (`_AXUIElementRemoteTokenCreate`) cuando está disponible.
    pub remote_token: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
struct StoredSnapshot {
    id: String,
    refs: HashMap<String, RefEntry>,
}

#[derive(Default)]
struct DesktopSessionInner {
    next_snapshot_seq: u64,
    snapshots: VecDeque<StoredSnapshot>,
    receipt_order: VecDeque<String>,
    receipts: HashMap<String, serde_json::Value>,
}

#[derive(Default)]
pub struct DesktopControlState {
    inner: Mutex<DesktopSessionInner>,
}

impl DesktopControlState {
    /// Reserva un nuevo `snapshot_id` (`s1`, `s2`, ...) antes de asignar refs.
    pub fn allocate_snapshot_id(&self) -> Result<String, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Estado interno de escritorio no disponible.".to_string())?;
        guard.next_snapshot_seq = guard.next_snapshot_seq.saturating_add(1);
        Ok(format!("s{}", guard.next_snapshot_seq))
    }

    pub fn save_snapshot(&self, snapshot_id: String, refs: Vec<RefEntry>) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Estado interno de escritorio no disponible.".to_string())?;
        let mut map = HashMap::with_capacity(refs.len());
        for entry in refs {
            map.insert(entry.ref_id.clone(), entry);
        }
        guard.snapshots.push_back(StoredSnapshot {
            id: snapshot_id,
            refs: map,
        });
        while guard.snapshots.len() > MAX_RETAINED_SNAPSHOTS {
            guard.snapshots.pop_front();
        }
        Ok(())
    }

    pub fn resolve_ref(&self, raw_ref: &str) -> Result<RefEntry, String> {
        let (snap_id, qualified) = validate_qualified_ref(raw_ref)?;
        let guard = self
            .inner
            .lock()
            .map_err(|_| "Estado interno de escritorio no disponible.".to_string())?;
        let Some(snapshot) = guard.snapshots.iter().find(|s| s.id == snap_id) else {
            return Err(format!(
                "STALE_REF: El snapshot '{snap_id}' ya expiró o no existe. Ejecuta desktop_snapshot de nuevo para obtener referencias actualizadas."
            ));
        };
        snapshot.refs.get(&qualified).cloned().ok_or_else(|| {
            format!(
                "STALE_REF: La referencia '{qualified}' no existe en el snapshot '{snap_id}'. Ejecuta desktop_snapshot para actualizar."
            )
        })
    }

    pub fn get_receipt(&self, client_request_id: &str) -> Option<serde_json::Value> {
        let key = client_request_id.trim();
        if key.is_empty() {
            return None;
        }
        let guard = self.inner.lock().ok()?;
        guard.receipts.get(key).cloned()
    }

    pub fn save_receipt(&self, client_request_id: &str, response: serde_json::Value) {
        let key = client_request_id.trim();
        if key.is_empty() {
            return;
        }
        if let Ok(mut guard) = self.inner.lock() {
            if !guard.receipts.contains_key(key) {
                guard.receipt_order.push_back(key.to_string());
            }
            guard.receipts.insert(key.to_string(), response);
            while guard.receipt_order.len() > MAX_RETAINED_RECEIPTS {
                if let Some(oldest) = guard.receipt_order.pop_front() {
                    guard.receipts.remove(&oldest);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ref(snap: &str, idx: usize) -> RefEntry {
        RefEntry {
            ref_id: format!("{snap}:@e{idx}"),
            snapshot_id: snap.to_string(),
            pid: 1234,
            window_id: 99,
            app_name: "Finder".to_string(),
            bundle_id: "com.apple.finder".to_string(),
            window_title: "Documentos".to_string(),
            role: "button".to_string(),
            raw_role: "AXButton".to_string(),
            name: "Guardar".to_string(),
            description: String::new(),
            identifier: "save-btn".to_string(),
            actions: vec!["click".to_string()],
            bounds: None,
            is_secure: false,
            remote_token: None,
        }
    }

    #[test]
    fn saves_resolves_and_evicts_old_snapshots() {
        let state = DesktopControlState::default();
        let s1 = state.allocate_snapshot_id().unwrap();
        assert_eq!(s1, "s1");
        state.save_snapshot(s1.clone(), vec![sample_ref(&s1, 1)]).unwrap();
        let found = state.resolve_ref("s1:@e1").unwrap();
        assert_eq!(found.name, "Guardar");
        assert!(state.resolve_ref("@e1").is_err());

        for _ in 0..MAX_RETAINED_SNAPSHOTS {
            let sid = state.allocate_snapshot_id().unwrap();
            state.save_snapshot(sid.clone(), vec![sample_ref(&sid, 1)]).unwrap();
        }
        let evicted = state.resolve_ref("s1:@e1").unwrap_err();
        assert!(evicted.contains("STALE_REF"));
    }

    #[test]
    fn stores_idempotency_receipts_bounded() {
        let state = DesktopControlState::default();
        state.save_receipt("req_1", serde_json::json!({ "ok": true, "replayed": true }));
        let got = state.get_receipt("req_1").unwrap();
        assert_eq!(got["ok"], true);
        assert!(state.get_receipt("req_missing").is_none());
    }
}
