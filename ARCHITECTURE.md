# 🏗️ Arquitectura del Sistema XOOK

## 1. Filosofía de Diseño: Enfoque al Usuario Final (Zero-Jargon)
XOOK está diseñado para administradores, contadores, gerentes de operaciones y personal de negocio, **no para ingenieros de software**.

- **Sin tecnicismos expuestos:** Términos como *MCP, GraphQL, Endpoints, JSON, Prompts* o *Sidecars* permanecen 100% aislados en el motor interno.
- **Acciones en lenguaje natural:** Las interacciones se presentan como tarjetas de trabajo comprensibles (ej. *"Se detectó quiebre de stock en 3 productos. ¿Deseas generar la orden de compra preliminar?"*).
- **Aprobación Visual (HITL) Clara:** El usuario ve exactamente qué va a cambiar en sus datos (un *diff* visual simple: Antes / Después) antes de autorizar cualquier mutación.

---

## 2. Mapa de Directorios y Responsabilidades

```text
xook/
├── context/                      # 🧠 CONOCIMIENTO Y MEMORIA EMPRESARIAL
│   ├── business-profiles/       # Políticas, catálogos base, reglas de la empresa
│   ├── memory/                  # Capa de Machine Learning y Memoria Adaptativa
│   └── schemas/                 # Entidades de negocio en lenguaje humano
│
├── skills/                       # 🎯 HABILIDADES MODULARES DEL AGENTE
│   ├── templates/               # Estructura base para crear nuevas habilidades
│   └── [skill-name]/            # Habilidades de negocio (ej. auditar-stock, conciliar-ventas)
│
├── src-ui/                       # 🖥️ EXPERIENCIA DE USUARIO (Frontend Desktop)
│   └── (React + TypeScript + Tailwind + Zustand sobre Tauri v2)
│
├── src-tauri/                    # 🛡️ MOTOR DE SEGURIDAD Y GUARDIÁN (Rust)
│   └── (Zero-Trust interceptor, bóveda SQLite, proxy local de red)
│
└── src-brain/                    # 🤖 MOTOR DE INTELIGENCIA Y MACHINE LEARNING (Python)
    └── (Orquestación LLM, generación de embeddings, aprendizaje continuo)
```

---

## 3. Capa de Machine Learning y Memoria Adaptativa (`/context/memory`)
Para que el usuario no tenga que repetir contexto continuamente, XOOK incorpora una capa de memoria local que aprende:
1. **Preferencias del Administrador:** Horarios de reporte preferidos, proveedores favoritos, umbrales de tolerancia de precios.
2. **Historial de Decisiones:** Qué sugerencias fueron aceptadas o rechazadas para ajustar recomendaciones futuras.
3. **Búsqueda Semántica Local:** Vector store embebido ligero (ej. `LanceDB` o `sqlite-vec`) que no requiere servicios en la nube externos para recordar datos de la empresa.

---

## 4. Política de Adopción de Componentes de Código Abierto (Open Source)
Cualquier alternativa o biblioteca open-source se evalúa bajo los siguientes filtros antes de agregarse:
- **Licencia Permisiva:** MIT, Apache 2.0 o BSD.
- **Seguridad y Privacidad:** Capacidad de operar 100% en local sin filtración de datos empresariales.
- **Mantenibilidad y Ligereza:** Sin dependencias excesivas que compliquen la distribución del ejecutable de escritorio.

