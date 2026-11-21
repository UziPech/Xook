# Auditoría de código — 19 de noviembre de 2026

Documento de revisión técnica del repositorio XOOK. Solo lectura: no se modificó ninguna línea de código para producir este reporte.

---

## 1. Alcance y método

Revisión hecha sobre los archivos reales del repositorio en `/Users/uzielcastillo/Development/Xook`, no de memoria.

Herramientas usadas:

- Lectura directa de archivos `.rs` del proyecto.
- Conteo programático de patrones (`unsafe`, `Result<`, `Option<`, `unwrap()`, `expect()`).
- Trazado de llamadas para verificar rutas reales de producción versus rutas de test.
- Compilación, linter y tests (resultados de la sesión del 19 de noviembre, ver sección 6).

Archivos revisados a fondo:

| Archivo | Líneas |
|---|---|
| `src-tauri/src/ai_vault.rs` | 4,891 |
| `src-tauri/src/slices/window_assist/commands.rs` | 767 |
| `src-tauri/src/slices/window_assist/macos_ax.rs` | 887 |
| `src-tauri/src/slices/window_assist/mod.rs` | 5 |
| `src-tauri/src/slices/host_fs/actions.rs` | 473 |

---

## 2. Lo que está bien y conviene no tocar

Esto no es cortesía, está verificado.

**Cero `unwrap()`, cero `expect()`, cero `panic!` en 1,660 líneas de Rust con FFI de macOS.** El conteo da 0 en los tres archivos de `window_assist`. En código que habla con APIs de sistema eso es disciplina real, no suerte.

**Manejo correcto de memoria en el FFI.** `macos_ax.rs` usa un wrapper RAII (`OwnedCF`) sobre los punteros de Core Foundation: cada `CFRetain` va emparejado con su liberación. Es el patrón que normalmente se olvida y produce fugas silenciosas.

**La política de seguridad no es decorativa.** Verificado por trazado de llamadas:

- Producción pasa por `evaluate_command_with_config` (`ai_vault.rs:1275`), la función real, no por el envoltorio de test.
- Los tres veredictos (`Deny`, `Allow`, `Ask`) se manejan explícitamente en cuatro rutas distintas.
- Existe un fail-safe: si no hay workspace, un `Allow` se degrada a `Ask` (`ai_vault.rs:2605-2608`). Falla del lado seguro.

**`prepare_host_edit` valida bien.** Devuelve `Err` limpio en los cuatro casos peligrosos: `old_text` vacío, archivo inexistente, archivo no UTF-8, y fragmento no encontrado o ambiguo (`actions.rs:377-393`).

**Consistencia en el límite Rust → TypeScript.** `#[serde(rename_all = "camelCase")]` aplicado de forma uniforme en los structs de comando.

---

## 3. Hallazgo 1 — Edición de archivos: frágil, pero no destructiva

**Ubicación:** `src-tauri/src/ai_vault.rs:3079-3142`, función `handle_host_fs_edit_rpc`.

### El código

```rust
// Pre-checar Capa 1 ANTES de abrir el archivo para generar vista previa del parche
let mut prepared_patch: Option<(String, String)> = None;
if let Ok(pre_eval) = evaluate_host_fs_access(ws_ref, app_cfg_dir.as_deref(), raw_path, HostFsOperation::Edit) {
    if !matches!(pre_eval.verdict, PolicyVerdict::Deny(_)) {
        match prepare_host_edit(&pre_eval.canonical_path, old_text, new_text, replace_all) {
            Ok(pair) => prepared_patch = Some(pair),
            Err(err) => {
                return serde_json::json!({ "ok": false, "error": err });
            }
        }
    }
}

let preview = prepared_patch.as_ref().map(|(_, p)| p.clone());
let updated_content = prepared_patch.map(|(u, _)| u).unwrap_or_default();
```

### Qué ocurre

Si `evaluate_host_fs_access` devuelve `Err`, el `if let Ok(...)` se traga el error. `prepared_patch` queda en `None` y `updated_content` en `""` (cadena vacía) por el `unwrap_or_default()`.

El string vacío se captura después en el closure que escribe:

```rust
|canon| {
    let mut val = write_host_file_atomic(canon, &updated_content)?;
```

### Corrección a una alarma preliminar

En una revisión anterior señalé que esto podría escribir un archivo vacío y provocar pérdida de datos. **Esa conclusión era incorrecta y la retiro aquí.**

`run_host_fs_gated_action` vuelve a evaluar el acceso de forma independiente (`ai_vault.rs:2595-2604`) y, si esa segunda evaluación falla, retorna error **antes** de invocar el closure de escritura:

```rust
let mut host_eval = match evaluate_host_fs_access(ws_ref, app_cfg_dir.as_deref(), raw_path, op) {
    Ok(ev) => ev,
    Err(err) => {
        return serde_json::json!({
            "ok": false,
            "status": "error",
            "error": err,
        });
    }
};
```

Para que el archivo se escribiera vacío haría falta que la primera llamada fallara con `Err` y la segunda tuviera éxito, con argumentos idénticos. Eso exige que el archivo cambie de estado inválido a válido en el intervalo entre ambas llamadas, es decir, una condición de carrera de microsegundos. No es un camino alcanzable en operación normal.

### Riesgo real

**Bajo en impacto, medio en mantenibilidad.** No es un bug de pérdida de datos: es una fragilidad estructural.

- El cálculo del contenido a escribir depende de una variable mutable opcional, cuando eso debería decidirse una sola vez y de forma explícita.
- La duplicación de `evaluate_host_fs_access` (dos llamadas con los mismos argumentos) es lo que crea la ventana, aunque sea estrecha.
- Un lector futuro no puede saber, leyendo solo este bloque, si el string vacío puede llegar al disco. Hay que leer otras 50 líneas en otra función para descubrirlo.

### Sugerencia

No requiere urgencia. Cuando se toque, la forma limpia es no permitir que el contenido vacío viva en el mismo tipo que el contenido válido: o el parche existe y se escribe, o la función retorna antes. Una guarda explícita del tipo `let Some((updated, preview)) = prepared_patch else { return error }` elimina la clase de error completa y hace el flujo obvio de un vistazo.

---

## 4. Hallazgo 2 — Constante sin calibrar con documentación que promete más de lo que cumple

**Ubicación:** `src-tauri/src/slices/window_assist/commands.rs:13` y línea de comentario 142.

```rust
pub const SPLIT_GAP_PX: f64 = 0.0;
```

Y el comentario que la describe:

```rust
/// Calcula los rectángulos lógicos... dejando un canal limpio (`SPLIT_GAP_PX`)
/// para evitar solapamientos visuales y facilitar el escalado manual.
```

### Corrección a otra alarma preliminar

En una revisión anterior afirmé que esta constante era "código muerto con documentación que miente". **También era incorrecto.**

Está efectivamente usada en 8 puntos reales del cálculo (líneas 149, 181, 195, 444, 447, 706-765) y en 10 aserciones de test. No es código muerto.

### El problema verdadero

Es más simple y menos grave de lo que dije: **vale `0.0`**. La documentación promete "un canal limpio para evitar solapamientos visuales" y el canal mide cero píxeles. La constante existe, se usa de forma consistente, y su valor anula el propósito que su comentario declara.

Consecuencia práctica: las ventanas quedan pegadas al borde, sin separación visual, aunque el diseño documentado asuma que hay una.

### Riesgo real

**Estético y de expectativa.** No rompe nada, y hay un test que pasa precisamente porque asume `0.0` (`default_balanced_preset_is_under_half_width_with_clean_gap`, línea 706). Pero el test está validando la aritmética con ese valor, no el comportamiento visual deseado.

### Sugerencia

Es una decisión de producto, no un bug: o se calibra el valor (por ejemplo 8-12 px para una separación perceptible) ajustando el test, o se corrige el comentario para que no prometa un canal que no existe. Lo que no conviene es dejarlo así, porque documenta una intención que el código contradice.

---

## 5. Hallazgo 3 — El FFI no distingue tipos de fallo

**Ubicación:** `src-tauri/src/slices/window_assist/macos_ax.rs` (887 líneas).

Métricas verificadas por conteo directo sobre el archivo:

| Métrica | Valor |
|---|---|
| Bloques `unsafe` | 100 |
| Firmas que devuelven `Result<` | 0 |
| Firmas que devuelven `Option<` | 30 |
| `.unwrap()` | 0 |
| `.expect(` | 0 |

### Qué significa

Todo el núcleo de acceso a macOS comunica el fallo por `None`. Eso significa que "no hay ventana activa en este momento" y "la llamada a Accessibility API fue rechazada o falló" producen exactamente el mismo resultado para quien consume la función. `commands.rs` sí usa `Result` (10 apariciones), de modo que la asimetría está entre capas.

### Riesgo real

**Ceguera diagnóstica, no inestabilidad.** El código no rompe. El problema es de soporte: si un usuario reporta "el asistente no detecta mis ventanas", no hay información en ninguna parte que distinga si falta el permiso de Accesibilidad en macOS, si la ventana activa es de una app con protección, o si la API simplemente no respondió. La causa más frecuente en este dominio —permisos de Accesibilidad no concedidos— es indistinguible de las demás.

### Sugerencia

No hay que reescribir el FFI. Basta con que las funciones de entrada (las que consume `commands.rs`, no los helpers internos) devuelvan un error tipado con dos o tres categorías: permiso denegado, sin ventana objetivo, fallo de sistema. Con eso, un mensaje de error útil se vuelve posible sin tocar los 100 bloques `unsafe`.

---

## 6. Hallazgo 4 y 5 — Menores

### Firmas con demasiados parámetros

Clippy marca tres funciones con 9, 10 y 11 parámetros. Una de ellas es `run_host_fs_gated_action` (`ai_vault.rs:2546-2557`), con 10 argumentos posicionales, tres de los cuales son `String` seguidos (`purpose`, `display_cmd`, `detail_preview`). Tres strings consecutivos en una llamada es donde un intercambio de posición pasa desapercibido en revisión y compila sin queja.

Sugerencia: agrupar en un struct descriptivo cuando se toque esa zona. No antes.

### Warnings de Clippy

113 en total, de los cuales 78 son "collapsible if" (ruido mecánico sin riesgo). El dato relevante: **solo 9 de los 113 están en `window_assist`**; los otros 104 son deuda previa del repositorio, no del trabajo reciente.

### Verificación de compilación

Resultados obtenidos en la sesión del 19 de noviembre:

| Verificación | Resultado |
|---|---|
| `cargo check` | Compila, 0 errores, 2 warnings |
| `tsc --noEmit` | 0 errores de tipos (salida vacía) |
| `cargo test --lib window_assist` | 4 de 4 pasan |

Los cuatro tests incluyen validación del cálculo de presets (`compact_wide_and_half_presets_partition_work_area_without_overlap`) y del FFI (`lists_visible_windows_in_process_cleanly`).

Nota de honestidad: estas tres verificaciones se ejecutaron **después** de subir los cambios, no antes. Ver sección 8.

---

## 7. Resumen de hallazgos

| # | Hallazgo | Ubicación | Impacto | Urgencia |
|---|---|---|---|---|
| 1 | Contenido a escribir depende de un `Option` mutable con `unwrap_or_default()` | `ai_vault.rs:3109-3135` | Fragilidad, no pérdida de datos | Baja |
| 2 | `SPLIT_GAP_PX = 0.0` con comentario que promete un canal | `commands.rs:13` | Visual / expectativa | Baja |
| 3 | FFI comunica todo por `Option`, sin distinguir fallos | `macos_ax.rs` | Diagnóstico / soporte | Media |
| 4 | Firmas con 10-11 parámetros posicionales | `ai_vault.rs:2546` | Mantenibilidad | Baja |
| 5 | 113 warnings de Clippy (9 propios, 104 heredados) | varios | Ruido | Baja |

**Ninguno de estos hallazgos justifica una intervención urgente.** El código compila, pasa tipos y pasa tests. La seguridad de Capa 1 está bien construida y verificada por trazado de rutas reales.

---

## 8. Errores de este propio proceso de auditoría

Se documentan porque afectan la confiabilidad de lo que se reportó antes, no porque sean anecdóticos.

**Primer error: opinar de vista sin rastrear usos.** Afirmé que `SPLIT_GAP_PX` era código muerto. Falso: aparece en 18 puntos reales. La conclusión correcta era mucho más modesta (valor sin calibrar).

**Segundo error: conclusión alarmista sin leer la segunda capa.** Afirmé que un fallo en la pre-evaluación podría vaciar un archivo. Falso: `run_host_fs_gated_action` re-evalúa y aborta antes de escribir. El riesgo requiere una carrera de microsegundos.

Ambos errores tienen la misma raíz: se emitió juicio antes de agotar el trazado. En un reporte de auditoría, un falso positivo es tan dañino como un falso negativo, porque consume tiempo de quien lo lee y erosiona la confianza en los hallazgos que sí son válidos.

**Tercer error, de proceso de desarrollo.** Los 6,878 insertions se subieron sin correr `cargo check` ni `tsc` con antelación. El build resultó sano, pero se supo después del push. La verificación debe preceder al commit, no seguirlo.

---

## 9. Qué NO cubre este reporte

Para que no se lea más de lo que es:

- **No se revisó el frontend en detalle.** Solo se verificó que tipa sin errores. No hay auditoría de componentes, estado ni accesibilidad.
- **No se ejecutó la aplicación.** Todo es análisis estático más tests unitarios. Ningún flujo se validó en ejecución real con macOS concediendo o negando permisos.
- **No se auditó el resto del repositorio.** `ai_vault.rs` es grande y se revisó focalizadamente en las rutas de edición de archivos y de política, no línea por línea.
- **No hay análisis de dependencias ni de superficie de red.**
- **Los conteos son estáticos.** Cien apariciones de `unsafe` no implican cien riesgos: muchos son `msg_send!` de una línea envueltos correctamente.

---

## 10. Orden recomendado para la siguiente sesión

1. **Hallazgo 3 primero** (FFI con errores tipados en las funciones de entrada). Es el único con impacto real de soporte, y se resuelve sin tocar los bloques `unsafe`.
2. **Hallazgo 1** con una guarda temprana. Cambio pequeño, elimina una clase entera de duda.
3. **Hallazgo 2** como decisión de producto: calibrar el valor o corregir el comentario.
4. **Hallazgos 4 y 5** cuando se toque cada zona por otro motivo. No merecen una tarea propia.

---

*Reporte generado en modo solo lectura. Ningún archivo del repositorio fue modificado durante la auditoría.*
