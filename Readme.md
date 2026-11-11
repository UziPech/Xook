# 🦈 XOOK - Enterprise Agentic Orchestrator
> **Significado:** Del maya *Xook* (Leer, contar, estudiar / Tiburón).  
> **Concepto:** Middleware agéntico multiplataforma de acoplamiento cero (*Zero-Refactor*). Permite conectar modelos de IA a infraestructuras empresariales existentes (E-commerce, SaaS, ERPs, APIs REST/GraphQL) mediante autodescubrimiento de endpoints y control estricto de permisos (*Human-in-the-Loop*).

---

## 1. Principios Arquitectónicos

1. **Vertical Slice Architecture (VSA):** El código no se divide por capas técnicas globales, sino por **Features (Slices) de negocio** independientes de principio a fin (UI -> Rust Core -> Python Brain).
2. **Ports & Adapters (Hexagonal en Conectores):** El motor central de Xook desconoce si habla con Shopify, Mercado Libre, Supabase o un ERP a medida; solo interactúa mediante contratos estandarizados (MCP - Model Context Protocol).
3. **Zero-Trust Execution (RBAC & HITL):** Ninguna operación de mutación (`WRITE`, `UPDATE`, `DELETE`) se ejecuta automáticamente. El núcleo en Rust intercepta la intención del modelo y exige confirmación criptográfica/visual del usuario.

---

## 2. Stack Tecnológico e Infraestructura

| Componente | Tecnología Principal | Librerías / Crates Clave | Rol Técnico |
| :--- | :--- | :--- | :--- |
| **Desktop / Shell** | **Tauri v2** (o Electron) | `@tauri-apps/api`, IPC Bridge | Empaquetado nativo multiplataforma ligero sin incompatibilidades de SO. |
| **Frontend UI** | **React + TypeScript** | Tailwind CSS, Zustand | Interfaz modo oscuro brutalista, renderizado del avatar Xook y modales de auditoría. |
| **Core & Guard** | **Rust** | `tokio`, `reqwest`, `serde`, `sqlx` | Escáner de red/APIs (estilo `nmap`), proxy de seguridad, intercepción de permisos y bóveda SQLite. |
| **Agentic Brain** | **Python (Sidecar)** | `LiteLLM`, `Pydantic`, `MCP SDK` | Orquestación de LLMs (Cloud/Local), generación de JSON estructurado y análisis de datos. |

---

## 3. Estructura del Proyecto (Vertical Slice Architecture)

Cada **Slice** encapsula su propia lógica, contratos de datos, llamadas a modelos y componentes visuales:

```text
xook-workspace/
├── ARCHITECTURE.md
├── package.json
│
├── src-ui/                             # [FRONTEND - React + TypeScript]
│   └── features/                       # Vertical Slices en UI
│       ├── endpoint-discovery/         # Slice 1: Escaneo de APIs (Nmap style)
│       │   ├── DiscoveryScanner.tsx    # Componente visual del radar de Xook
│       │   ├── useDiscovery.ts         # Hook que invoca al comando de Rust
│       │   └── discovery.types.ts      # Interfaces TS del Slice
│       ├── inventory-shelf/            # Slice 2: Gestión de estante y productos
│       │   ├── ShelfApprovalModal.tsx  # Modal Human-in-the-Loop para autorizar cambios
│       │   └── useShelfAgent.ts
│       ├── sales-evaluator/            # Slice 3: Reportes y análisis de ventas
│       └── xook-avatar/                # Estado visual del personaje (Idle, Scanning, Guard)
│
├── src-tauri/                          # [CORE BACKEND - Rust]
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                     # Punto de entrada y registro de comandos IPC
│       ├── shared/                     # Infraestructura mínima compartida (SQLite, Sidecar IPC)
│       └── slices/                     # Vertical Slices en Rust
│           ├── discovery/
│           │   ├── command.rs          # #[tauri::command] expuesto a la UI
│           │   ├── scanner.rs          # Lógica asíncrona con reqwest/tokio
│           │   └── models.rs           # Structs serializables con Serde
│           ├── permission_guard/
│           │   ├── interceptor.rs      # Cortafuegos que congela acciones WRITE
│           │   └── audit_log.rs        # Registro inmutable de acciones aprobadas
│           └── connector_hub/          # Adaptadores para E-commerce / SaaS
│
└── src-brain/                          # [AGENTIC ENGINE - Python Sidecar]
    ├── pyproject.toml
    ├── main_sidecar.py                 # Listener stdio/socket para hablar con Rust
    └── slices/                         # Vertical Slices en el Motor de IA
        ├── sales_analysis/
        │   ├── agent.py                # Lógica de evaluación con LiteLLM
        │   └── schemas.py              # Objetos Pydantic de salida garantizada
        ├── catalog_mutation/
        │   ├── shelf_mutator.py        # Preparación de payloads para agregar productos
        │   └── schemas.py
        └── mcp_bridge/                 # Cliente universal Model Context Protocol