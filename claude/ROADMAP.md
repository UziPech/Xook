# Roadmap — XOOK como agente personal proactivo

Creado: 2026-11-21 · Última actualización: 2026-11-23

## Visión

Un agente que **vive en el equipo del usuario, aprende cómo trabaja y actúa antes de que se lo pidan**, siempre dentro de una escalera de autonomía que el usuario controla. Primero para una persona; después, para equipos y organizaciones, sin cambiar de arquitectura.

Tres capacidades definen al producto. Todo lo demás es soporte:

1. **Recordar** — memoria que crece, se consolida y el usuario puede ver y corregir.
2. **Anticipar** — disparadores (tiempo, eventos, contexto de pantalla) que generan sugerencias o acciones.
3. **Adaptarse** — detectar rutinas repetidas y convertirlas en skills propuestas.

## Escalera de autonomía (transversal a todas las fases)

Cada tipo de acción tiene un nivel máximo permitido (`locked` como techo, idea tomada de `t3code`):

| Nivel | Nombre | Qué hace el agente |
|---|---|---|
| 0 | Observar | Registra contexto, no dice nada |
| 1 | Sugerir | Muestra una tarjeta en la bandeja de sugerencias |
| 2 | Preparar | Deja el trabajo listo (borrador, diff, orden) esperando aprobación |
| 3 | Ejecutar con aviso | Ejecuta y notifica, con opción de deshacer |
| 4 | Ejecutar en silencio | Solo para acciones reversibles y de bajo riesgo que el usuario promovió explícitamente |

Las mutaciones destructivas, de dinero o hacia fuera del equipo nunca pasan del nivel 2.

---

## Fase 0 — Cimientos

**Objetivo:** que agregar features deje de ser caro.

Entregables:

- [x] Commitear el trabajo pendiente en bloques temáticos (contratos, memoria, PDF, UI, brain). *(2026-11-22, PR #1: cuatro commits de Antigravity, verificados en un árbol limpio)*
- [ ] Partir `src-ui/App.tsx` en stores por dominio: chat, canvas, ledger, workspace, ajustes, voz, contexto de pantalla, atajos.
- [x] Reescribir `Readme.md` y `ARCHITECTURE.md` con la visión actual. *(2026-11-21)*
- [ ] Subir el sidecar de Python 3.9 a 3.11+ (3.9 está fuera de soporte).
- [ ] **Capa de proveedores agnóstica.** *(En curso; detalle en [diseno-capa-proveedores.md](diseno-capa-proveedores.md). Hecho: red de seguridad con tests de caracterización, una sola llamada al proveedor en el cliente y en las evals, las reglas de cada proveedor en un solo lugar, la URL propia de OpenRouter respetada en todos los caminos y el razonamiento de DeepSeek reenviado completo. Falta: paquete `providers/`, proveedor local y unificar los dos loops.)* `openrouter_client.py` (8k líneas) mezcla el loop del agente con detalles de cada proveedor, como los casos especiales de `reasoning_content` de DeepSeek. Separarlo en un **núcleo del agente** que solo habla un formato interno, más **adaptadores delgados por proveedor** (OpenRouter, DeepSeek, Groq, Gemini, OpenAI, Anthropic, y local vía Ollama/LM Studio).
- [ ] **Degradación elegante por capacidades.** Usar la matriz que ya existe en `provider_registry.py` para que el núcleo decida: si el modelo no soporta salida estructurada, validar y reparar el JSON; si no soporta visión, mandar texto de pantalla en lugar de la imagen; si no hace bien el tool calling, cargar menos herramientas por ronda.
- [x] **Evals por proveedor** (lo mismo que `t3code/evals`): un set fijo de tareas reales (herramientas, memoria, edición de archivos) que se corre contra cada modelo configurado. Así se muestra al usuario qué modelos funcionan bien con XOOK y cuáles no. *(2026-11-21: `slices/provider_evals/`, 18 casos sobre las herramientas reales. Las claves llegan solo de la bóveda, por stdin. Punto de entrada: comando `run_provider_evals` + sección plegable en Ajustes → Proveedores. Falta la primera corrida real.)*
- [x] **Bóveda de verdad.** *(2026-11-21)* Las claves viven en el Llavero de macOS (`slices/secret_store`, crate `security-framework`, un solo ítem `com.xook.app` / `ai-provider-keys`). `ai-vault.json` guarda solo la configuración no secreta. Las claves en texto plano se migran solas al primer arranque, y el archivo se limpia solo después de que el Llavero confirma la escritura.
- [x] **Bóveda multiplataforma.** *(2026-11-22)* Windows: Administrador de credenciales. Linux: Secret Service (GNOME Keyring / KWallet). Sin almacén seguro: solo en memoria durante la sesión, nunca en texto plano. El pie de Ajustes dice dónde quedan las claves. Verificado: en CI compila y pasan sus tests (con backend falso) en Windows y Linux reales; la escritura en el almacén real solo se probó en macOS, a mano.
- [x] **Matriz de capacidades del sistema** *(2026-11-22)*: `agent_tools/system_capabilities.py`. Fuera de macOS, el agente, los subagentes y las evals no ven las herramientas de escritorio, pantalla, Notas/Calendario ni apertura de apps.
- [ ] **Prompt del sistema según el SO.** El prompt de `openrouter_client.py` habla de "Calendario de Mac" y manda usar `open_desktop_app`; fuera de macOS debe omitir esas instrucciones.
- [x] **CI en macOS, Windows y Linux** *(2026-11-22, `.github/workflows/ci.yml`; primera corrida en el PR #1: interfaz, todo macOS y Rust en Linux pasaron; salieron una regresión mía en un test de herramientas de escritorio, ya corregida, y un test de la política de comandos que en Windows asume rutas POSIX, ignorado ahí)*. Interfaz (typecheck, tests de paquetes, build) en Linux; cerebro Python 3.11 y núcleo Rust (`cargo test --locked`) en los tres sistemas. Para que funcione, `Cargo.lock` dejó de ignorarse y se versiona. Al probarlo en un árbol limpio apareció un defecto previo: `npm ci` fallaba porque `package-lock.json` no incluía los workspaces `@xook/*`; ya está sincronizado.
- [x] **Python en modo UTF-8 en todos los sistemas** *(2026-11-22)*: `ai_vault::python_command` fija `PYTHONUTF8=1` y `PYTHONIOENCODING=utf-8` en los 5 lugares donde Rust lanza Python. Sin esto, en Windows el sidecar se caía con "Á" o "Í" (verificado simulando cp1252). Lo cubre un test que hace el viaje real por el pipe.
- [ ] **Política de comandos en Windows.** `command_runner/policy.rs` analiza los comandos con reglas POSIX (fuera de comillas, `\` descarta la barra) mientras el ejecutor usa `cmd /C` en Windows. Revisado el 2026-11-22 (salidas `Allow` de `evaluate_command`): no encontré un desvío de seguridad. Un comando sin operadores de shell se ejecuta directo con los argumentos ya analizados, así que política y proceso ven lo mismo; uno con pipes, `&&` o redirecciones, que es el único que recibe el texto original en `cmd`, nunca queda auto-permitido y siempre pide confirmación. El efecto en Windows es funcional: `..\x` se lee como `..x` y las rutas `C:\…` se rechazan, por eso el test `external_paths_and_anti_injection_guards_work` queda ignorado ahí. Falta tratar `\` como separador en Windows y revisar aparte `run_custom_script`, que no se analizó.
- [ ] **Probar el almacén real en Windows y Linux dentro de CI.** El código del Administrador de credenciales y del Secret Service ya compila y pasa sus tests con un backend falso en runners reales, pero ningún test escribe en el almacén de verdad (en macOS solo se probó a mano).
- [ ] **Suite heredada `src-brain/test_sidecar.py` en los tres sistemas.** Son 22 tests en un script (no unittest) que el CI corre solo en macOS, porque varios dan por hecho las herramientas nativas de Mac (p. ej. `list_desktop_apps`). Hay que volverlos conscientes de `system_capabilities`. Ya demostró su valor: encontró un esquema vacío en `office_generate` que la suite de CI no veía. Ojo: escribe decisiones de prueba en `context/memory/memory_store.json`, que está versionado; correrla localmente ensucia el repo (`git checkout -- context/memory/memory_store.json` lo deja como estaba). Conviene que use un directorio temporal.
- [ ] Código muerto: `src-brain/slices/inventory_advisor/schemas.py` importa `pydantic`, que no está instalado; nadie lo importa.
- [ ] **Empaquetado multiplataforma.** Hoy el sidecar usa el `.venv` local. Para distribuir hay que incluir Python dentro de la app en cada sistema.
- [x] **Quitar el fallback a variables de entorno** en `resolve_provider_key`. *(2026-11-21)*
- [ ] Ajustar el texto "bóveda local (0600)" de `configure_ai_vault` en `openrouter_client.py` para que diga "almacén seguro del sistema".
- [ ] Modo navegador (`npm run dev` sin Tauri): `aiClient.ts` guarda las claves en `localStorage` (`readBrowserVault`). Decidir si se elimina ese modo para claves o se limita a desarrollo.

Criterio de salida: `App.tsx` por debajo de 1.500 líneas, y el mismo set de evals pasando en al menos tres proveedores distintos sin cambiar el núcleo.

## Fase 1 — Memoria que aprende

**Objetivo:** que el agente recuerde semanas de trabajo sin inflar el contexto.

Entregables:

- [x] **Memoria de inicio por niveles** *(Antigravity, 2026-11-22, PR #1)*: L0 (identidad y recuerdos fijados, siempre en el prompt), L1 (se activa cuando la consulta coincide) y L2 (latente, solo un índice de una línea), en `@xook/contracts` (`memoryGraph`) y en `user_memory.select_startup_user_memory_block`. Reduce lo que entra al prompt en cada turno.
- [ ] Migrar la memoria de JSON (tope de 120 hechos) a SQLite en `.xook/xook.db` con `sqlite-vec` (licencia MIT/Apache-2.0) para búsqueda semántica local.
- [ ] Tres tipos de memoria: **hechos** (quién es, preferencias), **episodios** (qué pasó y cuándo) y **procedimientos** (cómo hace las cosas).
- [ ] Decaimiento temporal y consolidación: los episodios viejos se resumen en hechos y procedimientos.
- [ ] Vista editable de lo que el agente "cree" del usuario, con borrar, corregir y fijar. Ya existe `MemoryGraphView` en Xox Studio (grafo compacto o amplio y un editor de notas con enlaces); falta revisar qué cubre de borrar, corregir y fijar.
- [ ] Sesiones largas: extender la compactación propia de `context_manager.py` y agregar limpieza de resultados viejos de herramientas, ambas del lado de XOOK para que funcionen con cualquier modelo.
- [ ] Embeddings locales (modelo pequeño en ONNX, que ya está en el venv) para no depender de la API de embeddings de un proveedor.

Implementación propia: las herramientas de memoria ya existen (`memory_search`, `memory_record_fact`); se mejora el almacén, no el contrato. Prompts ordenados con lo estable al inicio para aprovechar el caché de prefijo que ofrecen DeepSeek, OpenAI, Anthropic y otros.

Criterio de salida: un eval de recuerdo (preguntas sobre hechos de hace 2+ semanas) con al menos 85 % de aciertos, y costo por turno estable en sesiones largas.

## Fase 2 — Proactividad v1

**Objetivo:** que el agente hable primero cuando vale la pena, y calle cuando no.

Entregables:

- [ ] Motor de disparadores sobre `slices/scheduler` y `slices/screen_context`: tiempo (cron), archivos (`notify`), calendario/notas y contexto de pantalla deduplicado.
- [ ] **Triage barato:** cada disparador pasa por un modelo pequeño (configurable: uno local, o uno barato vía API) que decide entre "ignorar", "sugerir" o "preparar" antes de despertar al modelo principal.
- [ ] **Bandeja de sugerencias** en la UI: tarjetas con aceptar / posponer / "no vuelvas a sugerir esto". Cada respuesta del usuario alimenta la memoria de decisiones.
- [ ] Primera rutina de punta a punta: **brief matutino** (pendientes, agenda, lo que quedó a medias ayer).
- [ ] Consolidación nocturna de memoria en segundo plano, con el modelo más barato configurado o uno local.
- [ ] Presupuesto de interrupciones: máximo de sugerencias por hora, y silencio durante foco o reuniones.
- [ ] Presupuesto de gasto: tope diario de tokens/dinero para el trabajo proactivo, visible en ajustes.

Roles de modelo configurables: **triage** (barato o local), **principal** (el que elige el usuario) y **fondo** (consolidación). Cualquier proveedor puede ocupar cualquier rol.

Criterio de salida: tasa de aceptación de sugerencias por encima del 40 % y menos de 1 sugerencia descartada por hora.

## Fase 3 — Adaptación al flujo real

**Objetivo:** que el agente descubra cómo trabaja el usuario y lo automatice.

Entregables:

- [ ] Detector de rutinas: secuencias repetidas en `task_ledger` y en el contexto de pantalla ("cada viernes exporta X, lo pega en Y y lo manda a Z").
- [ ] Propuesta automática de skills a partir de esas rutinas, en formato `SKILL.md` (estándar abierto, no atado a un proveedor), sobre el `skills_hub` actual.
- [ ] Promoción en la escalera de autonomía: una skill que se aprueba N veces sin cambios puede subir un nivel, pero solo si el usuario lo confirma.
- [ ] Evals por skill (idea de `t3code/evals`).

Patrón planificador/ejecutor propio: un modelo fuerte arma el plan una vez y uno barato ejecuta los pasos. Funciona con cualquier par de proveedores.

Criterio de salida: al menos 3 rutinas reales del usuario convertidas en skills que se usen cada semana.

## Fase 4 — De persona a organización

**Objetivo:** el mismo agente, compartido por un equipo, sin mezclar lo privado con lo común.

Entregables:

- [ ] Ámbitos de memoria: personal, equipo y organización, con reglas explícitas de qué sube de un ámbito a otro.
- [ ] Roles y políticas por organización sobre la escalera de autonomía.
- [ ] Conectores a herramientas de la organización vía MCP, con permiso por servidor y por herramienta, y log de auditoría inmutable.
- [ ] XOOK como servidor MCP (modo desarrollador), derivado del catálogo de herramientas existente.

MCP como protocolo abierto del lado de XOOK (cliente y servidor propios), no como feature de un proveedor. Citas a documentos generadas por XOOK (fragmento + página) para que funcionen con cualquier modelo.

Criterio de salida: dos usuarios compartiendo un workspace sin fugas entre memorias personales, verificado por tests.

## Línea transversal — Agente de uso cotidiano

**Objetivo:** que Xox se comporte como agente y no como un chat: que no se rinda a mitad de una tarea, que vea internet, que revise su trabajo antes de entregarlo y que se conecte a sistemas sin depender de MCP.

- [x] **Presupuesto por tarea en vez de 12 rondas fijas** *(2026-11-23, `ai_service/agent_loop_policy.py`)*. El loop sigue mientras queden rondas, tiempo y tokens: perfil `standard` (24 rondas, 5 min) y `extended` para `deep_analysis` (60 rondas, 15 min, subagentes con 10 rondas). Si el modelo repite 3 veces la misma ronda, se da por atascado. La ronda final va sin herramientas y le pide entregar lo que tiene y decir qué quedó pendiente; la interfaz muestra el motivo del cierre como un paso más.
- [x] **Verificación antes de entregar** *(2026-11-23)*. El resultado de `office_generate`, `pdf_generate`, `workspace_write_file` y `workspace_edit_file` le pide al modelo comparar lo producido con cada instrucción del usuario, incluido lo que pidió no incluir, antes de responder.
- [ ] Presupuesto visible y configurable en Ajustes (se une al "presupuesto de gasto" de la Fase 2).
- [ ] `web_search` y `web_fetch` propios de XOOK (sin depender de la búsqueda nativa del proveedor), con miniaturas de las fuentes en el chat.
- [ ] Modo investigación: plan, subagentes en paralelo, notas en archivo y síntesis con citas, como tarea de fondo que se puede retomar.
- [ ] Modo código para documentos e integraciones sin MCP. Investigación y plan en [investigacion-code-mode.md](investigacion-code-mode.md).

---

## Principio: la inteligencia vive en XOOK, no en el proveedor

Memoria, disparadores, política de herramientas, escalera de autonomía, compactación y skills se implementan del lado de XOOK. El modelo es una pieza intercambiable. Las ventajas de un proveedor concreto (caché de prefijo, razonamiento, salida estructurada nativa) se aprovechan cuando están, pero **ninguna feature depende de ellas**.

| Capacidad | Dónde vive | Si el modelo no la soporta |
|---|---|---|
| Memoria y recuperación | XOOK (SQLite + embeddings locales) | No aplica: es independiente del modelo |
| Compactación de sesiones | XOOK (`context_manager.py`) | No aplica |
| Carga diferida de herramientas | XOOK (`tool_catalog.py`, `tool_search`) | No aplica |
| Salida estructurada | Nativa si existe | Validar contra el schema y pedir reparación |
| Visión | Nativa si existe | Texto de pantalla por accesibilidad/OCR |
| Razonamiento | Nativo si existe | Paso de planificación explícito en el prompt |
| Caché de prefijo | Del proveedor | Prompts igual de ordenados; solo cuesta más |
| Control del escritorio | XOOK (AX + CGEvent) | No aplica |
| Encadenar herramientas y filtrar datos | XOOK (modo código, propuesta en [investigacion-code-mode.md](investigacion-code-mode.md)) | Tool calling clásico, ronda por ronda |

Nota honesta: el harness reduce mucho la diferencia entre modelos, pero no la elimina. La fiabilidad del tool calling sí varía entre proveedores. Por eso las evals de la Fase 0 existen: le dicen al usuario con datos qué modelo rinde con XOOK, en vez de prometer que todos rinden igual.

## Decisiones abiertas

- Stack de estado del frontend para partir `App.tsx` (Zustand por dominio, según el `Readme` original).
- ¿Qué datos de contexto de pantalla puede usar el triage proactivo, y cuáles nunca?
