# Arquitectura de XOOK

## 1. Filosofía de diseño

XOOK es un agente personal para cualquier persona que trabaja en una computadora: no hace falta ser ingeniero para usarlo.

- **Sin tecnicismos expuestos.** Términos como *MCP, endpoints, JSON, prompts, embeddings* o *sidecar* se quedan dentro del motor.
- **Acciones en lenguaje natural.** El agente habla con tarjetas comprensibles (*"Mañana vence el pago de la luz. ¿Te preparo el recordatorio?"*).
- **Aprobación visual clara.** Antes de cualquier cambio el usuario ve qué va a cambiar (antes/después) y decide.
- **Agnóstico de proveedor.** Ninguna capacidad depende de un proveedor de IA concreto. Si un modelo no soporta algo (visión, salida estructurada, razonamiento), XOOK degrada con elegancia en lugar de fallar.

## 2. Las tres capas

```text
┌──────────────────────────────────────────────────────────────┐
│ src-ui/  (React)            superficie: chat, canvas, studio │
└───────────────▲───────────────────────────────▲──────────────┘
                │ IPC Tauri                     │ eventos
┌───────────────┴───────────────────────────────┴──────────────┐
│ src-tauri/  (Rust)   guardián: bóveda, políticas, escritorio │
└───────────────▲──────────────────────────────────────────────┘
                │ JSON-RPC por stdio
┌───────────────┴──────────────────────────────────────────────┐
│ src-brain/  (Python)  cerebro: loop del agente, proveedores, │
│                       herramientas, memoria, documentos      │
└──────────────────────────────────────────────────────────────┘
```

Las claves de API viven solo en la bóveda de Rust (`ai_vault.rs`); nunca pasan por la UI ni por el historial del chat. Toda acción que muta datos pasa por la política de Rust (`Deny` / `Ask` / `Allow`) antes de ejecutarse.

## 3. Mapa de directorios

```text
xook/
├── src-ui/
│   ├── App.tsx                  # raíz (en proceso de partirse en stores por dominio)
│   ├── components/              # piezas compartidas: QuickBar, Xox, menús, overlays
│   └── features/                # slices: ai-service, canvas, pdf-viewer, settings,
│                                #   task-decisions, tts-voice, window-assist,
│                                #   workspace-store, xox-studio
│
├── src-tauri/src/
│   ├── ai_vault.rs              # bóveda de claves y puente con el sidecar
│   ├── quick_summon.rs          # atajos globales y ventana QuickBar
│   ├── workspace_store.rs       # perfil y memoria del usuario en disco
│   └── slices/
│       ├── command_runner/      # política de comandos (Deny/Ask/Allow)
│       ├── desktop_control/     # control de otras apps por accesibilidad + CGEvent
│       ├── window_assist/       # lectura de ventanas por accesibilidad
│       ├── screen_context/      # contexto de pantalla deduplicado (sin screenshots en disco)
│       ├── scheduler/           # agenda, temporizadores, revisiones programadas
│       ├── task_ledger/         # tareas, decisiones y revisiones en SQLite
│       ├── host_fs/             # acceso a archivos fuera del workspace, con política
│       ├── workspace_manager/   # registro de workspaces
│       └── app_launcher/, env_actions/, tts_voice/, xox_studio/
│
├── src-brain/
│   ├── main_sidecar.py          # servidor JSON-RPC por stdio
│   └── slices/
│       ├── ai_service/          # loop del agente, proveedores, contexto, trazas
│       ├── agent_tools/         # catálogo de herramientas, memoria de usuario, skills
│       ├── pdf_engine/          # lectura, inspección y generación de PDF/Office
│       ├── provider_evals/      # evals de tool calling por proveedor
│       └── task_ui/, tts_service/, inventory_advisor/
│
├── packages/
│   ├── contracts/               # tipos compartidos (políticas, trazas, memoria, timeline)
│   └── agent-inspector/         # análisis de trazas del agente
│
├── skills/                      # skills en formato SKILL.md
├── context/                     # perfiles y esquemas base
├── referencias/                 # repos open source de consulta (no son dependencias)
└── claude/                      # roadmap, decisiones y diseños
```

## 4. Proveedores de IA

`src-brain/slices/ai_service/provider_registry.py` declara cada proveedor y, por modelo, sus capacidades (`supports_tools`, `supports_reasoning`, `supports_structured`, `supports_vision`). También declara la cadena de failover entre proveedores. El diseño para separar el loop del agente de los adaptadores por proveedor está en [claude/diseno-capa-proveedores.md](claude/diseno-capa-proveedores.md).

## 5. Memoria

Hoy: perfil y hechos del usuario en JSON con deduplicación y filtro de secretos (`agent_tools/user_memory.py`, `workspace_store.rs`). Siguiente paso (Fase 1 del roadmap): SQLite con `sqlite-vec` y embeddings locales, tres tipos de memoria (hechos, episodios, procedimientos), decaimiento temporal y una vista donde el usuario corrige lo que el agente cree de él.

## 6. Política de componentes open source

Toda dependencia nueva pasa estos filtros (detalle en `AGENTS.md`):

- **Licencia permisiva:** MIT, Apache-2.0 o BSD.
- **Privacidad:** capaz de operar 100 % en local.
- **Ligereza:** primero capacidades nativas del sistema; sin runtimes pesados si se pueden evitar.
