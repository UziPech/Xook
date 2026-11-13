# Reglas del Proyecto XOOK

## 1. Higiene y Peso del Workspace (Obligatorio)
- Mantén `src-tauri/Cargo.toml` con `[profile.dev]` ligero (`debug = "line-tables-only"`, `split-debuginfo = "unpacked"`) y `[profile.dev.package."*"]` con `debug = 0` para evitar que `src-tauri/target/debug/` vuelva a inflarse con gigabytes de símbolos DWARF.
- No restaures `staticlib` ni `cdylib` en `crate-type` de `src-tauri/Cargo.toml` salvo que se agregue explícitamente soporte móvil (iOS/Android); el target desktop solo requiere `["rlib"]`.
- Al terminar ciclos largos de compilación, cambios de dependencias en `Cargo.toml`, o si `src-tauri/target/` supera **3 GB**, ejecuta `npm run clean:workspace -- --auto` (o `npm run clean:rust` / `npm run clean:all` para limpieza total).
- Nunca subas ni dejes en el repositorio artefactos temporales, `.dmg`/`.app`, archivos `.DS_Store`, `__pycache__`, ni capturas de pantalla crudas.

## 2. Política de Dependencias y Privacidad (Alineada a `ARCHITECTURE.md`)
- Cualquier librería o herramienta open source nueva debe tener licencia permisiva (**MIT, Apache-2.0 o BSD**). Evita dependencias copyleft o licencias source-available/comerciales.
- Prioriza capacidades nativas ligeras del sistema antes de agregar runtimes pesados de ML/Python.
- Para la lectura de pantalla en tiempo real y la memoria del agente:
  - **Cero persistencia de screenshots crudos en disco** por defecto; conserva solo texto/contexto deduplicado e indexado en SQLite (`.xook/xook.db`) y frames temporales únicamente en memoria RAM cuando se envíen a un modelo multimodal.
  - Excluye la ventana de la `QuickBar` (`quick`) y protege campos/apps sensibles antes de capturar o indexar contexto visual.

