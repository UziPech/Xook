//! Secretos de XOOK en el almacén seguro del sistema operativo.
//!
//! | Sistema | Almacén |
//! |---|---|
//! | macOS   | Llavero (`security-framework`) |
//! | Windows | Administrador de credenciales (`windows-native-keyring-store`) |
//! | Linux   | Secret Service: GNOME Keyring / KWallet (`zbus-secret-service-keyring-store`) |
//!
//! Todas las claves de proveedores viven en un solo ítem (`com.xook.app` / `ai-provider-keys`)
//! como JSON `{proveedor: clave}`: se escriben de una vez, y en macOS una build de desarrollo
//! sin firmar pide acceso a lo más una vez por arranque.
//!
//! Si no hay almacén seguro (Linux sin keyring, acceso denegado), las claves viven **solo en
//! memoria durante la sesión**. Nunca se escriben en texto plano, y nunca se escribe encima de
//! un ítem que no se pudo leer.

use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

pub type SecretMap = BTreeMap<String, String>;

const SERVICE: &str = "com.xook.app";
const ACCOUNT: &str = "ai-provider-keys";

/// Dónde están quedando las claves. Se muestra en Ajustes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StorageStatus {
    Secure { backend: &'static str },
    SessionOnly { reason: String },
}

trait Backend: Send + Sync {
    fn name(&self) -> &'static str;
    fn read(&self) -> Result<SecretMap, String>;
    fn write(&self, secrets: &SecretMap) -> Result<(), String>;
}

enum State {
    Unread,
    Secure(SecretMap),
    /// La lectura falló. No se reintenta en cada turno del chat (en macOS eso sería un aviso
    /// del Llavero por turno); se reintenta al volver a abrir XOOK.
    SessionOnly { reason: String, secrets: SecretMap },
}

struct SecretStore {
    backend: Box<dyn Backend>,
    state: Mutex<State>,
}

impl SecretStore {
    fn new(backend: Box<dyn Backend>) -> Self {
        Self { backend, state: Mutex::new(State::Unread) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        // Un pánico con el candado tomado no deja el estado a medias: se recupera tal cual.
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn ensure_read(&self, state: &mut State) {
        if matches!(state, State::Unread) {
            *state = match self.backend.read() {
                Ok(map) => State::Secure(map),
                Err(reason) => {
                    eprintln!("[secret_store] {reason}");
                    State::SessionOnly { reason, secrets: SecretMap::new() }
                }
            };
        }
    }

    /// Devuelve las claves y si están guardadas de forma persistente.
    fn load(&self) -> (SecretMap, bool) {
        let mut state = self.lock();
        self.ensure_read(&mut state);
        match &*state {
            State::Secure(map) => (map.clone(), true),
            State::SessionOnly { secrets, .. } => (secrets.clone(), false),
            State::Unread => unreachable!("ensure_read siempre sale de Unread"),
        }
    }

    /// Guarda el mapa completo. `Ok(true)` = persistido en el almacén seguro;
    /// `Ok(false)` = solo en memoria para esta sesión.
    fn save(&self, secrets: &SecretMap) -> Result<bool, String> {
        let mut state = self.lock();
        self.ensure_read(&mut state);
        match &mut *state {
            State::Secure(current) => {
                if current != secrets {
                    self.backend.write(secrets)?;
                    *current = secrets.clone();
                }
                Ok(true)
            }
            State::SessionOnly { secrets: session, .. } => {
                *session = secrets.clone();
                Ok(false)
            }
            State::Unread => unreachable!("ensure_read siempre sale de Unread"),
        }
    }

    fn status(&self) -> StorageStatus {
        let mut state = self.lock();
        self.ensure_read(&mut state);
        match &*state {
            State::SessionOnly { reason, .. } => StorageStatus::SessionOnly { reason: reason.clone() },
            _ => StorageStatus::Secure { backend: self.backend.name() },
        }
    }
}

fn global() -> &'static SecretStore {
    static STORE: OnceLock<SecretStore> = OnceLock::new();
    STORE.get_or_init(|| SecretStore::new(platform::native_backend()))
}

pub fn load() -> (SecretMap, bool) {
    global().load()
}

pub fn save(secrets: &SecretMap) -> Result<bool, String> {
    global().save(secrets)
}

pub fn status() -> StorageStatus {
    global().status()
}

fn parse_item(bytes: &[u8]) -> Result<SecretMap, String> {
    serde_json::from_slice(bytes)
        .map_err(|e| format!("El ítem de XOOK en el almacén seguro tiene un formato inesperado: {e}"))
}

fn serialize_item(secrets: &SecretMap) -> Result<Vec<u8>, String> {
    serde_json::to_vec(secrets).map_err(|e| format!("No se pudieron serializar las claves: {e}"))
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{ACCOUNT, Backend, SERVICE, SecretMap, parse_item, serialize_item};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    pub(super) struct Keychain {
        pub(super) account: &'static str,
    }

    impl Backend for Keychain {
        fn name(&self) -> &'static str {
            "keychain"
        }

        fn read(&self) -> Result<SecretMap, String> {
            match get_generic_password(SERVICE, self.account) {
                Ok(bytes) => parse_item(&bytes),
                Err(err) if err.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(SecretMap::new()),
                Err(err) => Err(format!("No se pudo leer el Llavero de macOS: {err}")),
            }
        }

        fn write(&self, secrets: &SecretMap) -> Result<(), String> {
            if secrets.is_empty() {
                return match delete_generic_password(SERVICE, self.account) {
                    Err(err) if err.code() != ERR_SEC_ITEM_NOT_FOUND => {
                        Err(format!("No se pudo limpiar el Llavero de macOS: {err}"))
                    }
                    _ => Ok(()),
                };
            }
            set_generic_password(SERVICE, self.account, &serialize_item(secrets)?)
                .map_err(|e| format!("No se pudo guardar en el Llavero de macOS: {e}"))
        }
    }

    pub(super) fn native_backend() -> Box<dyn Backend> {
        Box::new(Keychain { account: ACCOUNT })
    }
}

/// Windows y Linux comparten la API de `keyring-core`; solo cambia el almacén registrado.
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod platform {
    use super::{ACCOUNT, Backend, SERVICE, SecretMap, parse_item, serialize_item};
    use keyring_core::{Entry, Error};

    #[cfg(target_os = "windows")]
    const BACKEND_NAME: &str = "credential_manager";
    #[cfg(target_os = "linux")]
    const BACKEND_NAME: &str = "secret_service";

    pub(super) struct NativeKeyring {
        /// Error al registrar el almacén (p. ej. Linux sin servicio de llavero).
        init_error: Option<String>,
    }

    impl NativeKeyring {
        fn entry(&self) -> Result<Entry, String> {
            if let Some(err) = &self.init_error {
                return Err(err.clone());
            }
            Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Almacén seguro no disponible: {e}"))
        }
    }

    impl Backend for NativeKeyring {
        fn name(&self) -> &'static str {
            BACKEND_NAME
        }

        fn read(&self) -> Result<SecretMap, String> {
            match self.entry()?.get_secret() {
                Ok(bytes) => parse_item(&bytes),
                Err(Error::NoEntry) => Ok(SecretMap::new()),
                Err(err) => Err(format!("No se pudo leer el almacén seguro del sistema: {err}")),
            }
        }

        fn write(&self, secrets: &SecretMap) -> Result<(), String> {
            let entry = self.entry()?;
            if secrets.is_empty() {
                return match entry.delete_credential() {
                    Ok(()) | Err(Error::NoEntry) => Ok(()),
                    Err(err) => Err(format!("No se pudo limpiar el almacén seguro: {err}")),
                };
            }
            // `set_secret` guarda bytes UTF-8 tal cual; `set_password` en Windows los pasa a
            // UTF-16 y duplica el tamaño frente al límite de 2.560 bytes por credencial.
            entry
                .set_secret(&serialize_item(secrets)?)
                .map_err(|e| format!("No se pudo guardar en el almacén seguro: {e}"))
        }
    }

    pub(super) fn native_backend() -> Box<dyn Backend> {
        #[cfg(target_os = "windows")]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(target_os = "linux")]
        let store = zbus_secret_service_keyring_store::Store::new();

        let init_error = match store {
            Ok(store) => {
                keyring_core::set_default_store(store);
                None
            }
            Err(err) => Some(format!("El sistema no tiene un llavero disponible: {err}")),
        };
        Box::new(NativeKeyring { init_error })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod platform {
    use super::{Backend, SecretMap};

    struct Unsupported;

    impl Backend for Unsupported {
        fn name(&self) -> &'static str {
            "unsupported"
        }

        fn read(&self) -> Result<SecretMap, String> {
            Err("Este sistema no tiene un almacén seguro compatible.".to_string())
        }

        fn write(&self, _secrets: &SecretMap) -> Result<(), String> {
            Err("Este sistema no tiene un almacén seguro compatible.".to_string())
        }
    }

    pub(super) fn native_backend() -> Box<dyn Backend> {
        Box::new(Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    struct FakeState {
        item: Option<SecretMap>,
        fail_read: bool,
        writes: usize,
    }

    struct Fake(Arc<Mutex<FakeState>>);

    impl Backend for Fake {
        fn name(&self) -> &'static str {
            "fake"
        }

        fn read(&self) -> Result<SecretMap, String> {
            let s = self.0.lock().unwrap();
            if s.fail_read {
                return Err("sin llavero".to_string());
            }
            Ok(s.item.clone().unwrap_or_default())
        }

        fn write(&self, secrets: &SecretMap) -> Result<(), String> {
            let mut s = self.0.lock().unwrap();
            s.writes += 1;
            s.item = if secrets.is_empty() { None } else { Some(secrets.clone()) };
            Ok(())
        }
    }

    fn store_with(fake: FakeState) -> (SecretStore, Arc<Mutex<FakeState>>) {
        let shared = Arc::new(Mutex::new(fake));
        (SecretStore::new(Box::new(Fake(shared.clone()))), shared)
    }

    fn map(pairs: &[(&str, &str)]) -> SecretMap {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn secure_store_persists_and_skips_redundant_writes() {
        let (store, fake) = store_with(FakeState { item: Some(map(&[("groq", "gsk_a")])), ..Default::default() });
        assert_eq!(store.load(), (map(&[("groq", "gsk_a")]), true));

        assert_eq!(store.save(&map(&[("groq", "gsk_a")])), Ok(true));
        assert_eq!(fake.lock().unwrap().writes, 0, "sin cambios no se escribe");

        assert_eq!(store.save(&map(&[("groq", "gsk_a"), ("deepseek", "sk-b")])), Ok(true));
        assert_eq!(fake.lock().unwrap().item, Some(map(&[("groq", "gsk_a"), ("deepseek", "sk-b")])));
        assert_eq!(store.status(), StorageStatus::Secure { backend: "fake" });
    }

    #[test]
    fn unreadable_store_falls_back_to_session_and_never_writes() {
        let existing = map(&[("openrouter", "sk-or-existente")]);
        let (store, fake) = store_with(FakeState { item: Some(existing.clone()), fail_read: true, ..Default::default() });

        assert_eq!(store.load(), (SecretMap::new(), false));
        assert_eq!(store.save(&map(&[("deepseek", "sk-nueva")])), Ok(false));
        assert_eq!(store.load(), (map(&[("deepseek", "sk-nueva")]), false), "la clave vive en la sesión");

        let fake = fake.lock().unwrap();
        assert_eq!(fake.writes, 0, "nunca se escribe encima de un ítem que no se pudo leer");
        assert_eq!(fake.item, Some(existing));
        assert!(matches!(store.status(), StorageStatus::SessionOnly { .. }));
    }

    #[test]
    fn empty_map_clears_the_item() {
        let (store, fake) = store_with(FakeState { item: Some(map(&[("groq", "gsk_a")])), ..Default::default() });
        assert_eq!(store.save(&SecretMap::new()), Ok(true));
        assert_eq!(fake.lock().unwrap().item, None);
    }

    /// Toca el almacén real del sistema con un ítem propio de prueba y lo borra al final.
    /// Se corre a mano: `cargo test --lib secret_store -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn keychain_round_trip_with_selftest_item() {
        let keychain = platform::Keychain { account: "xook-selftest" };
        let _ = keychain.write(&SecretMap::new());
        assert_eq!(keychain.read().unwrap(), SecretMap::new(), "ítem inexistente = mapa vacío");

        let mut secrets = map(&[("deepseek", "sk-selftest-000000000000")]);
        keychain.write(&secrets).unwrap();
        assert_eq!(keychain.read().unwrap(), secrets);

        secrets.insert("groq".to_string(), "gsk_selftestselftest".to_string());
        keychain.write(&secrets).unwrap();
        assert_eq!(keychain.read().unwrap(), secrets, "escribir encima actualiza");

        keychain.write(&SecretMap::new()).unwrap();
        assert_eq!(keychain.read().unwrap(), SecretMap::new(), "mapa vacío borra el ítem");
    }
}
