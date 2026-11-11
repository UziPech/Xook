# 📂 Directorio de Contexto de Negocio (`/context`)

Este directorio aísla el conocimiento operativo, la memoria de largo plazo y el contexto de la empresa para que el motor de IA actúe como un asistente experto sin requerir que el usuario final ingrese tecnicismos.

## Estructura

- **`business-profiles/`**: Información sobre la empresa o negocio (catálogo base, reglas de negocio, políticas de devolución, límites de gasto autorizados, roles de usuarios).
- **`memory/`**: Capa de persistencia y Machine Learning / Memoria adaptativa (preferencias aprendidas del usuario, historial de decisiones aprobadas/rechazadas, embeddings o base de datos vectorial local).
- **`schemas/`**: Diccionarios de datos y definiciones simples de entidades de negocio (Clientes, Proveedores, Facturas, Productos) comprensibles por usuarios no técnicos.

## Reglas de Aislamiento
1. Ningún archivo en `/context` debe requerir sintaxis de código para ser leído por un humano. Se favorecen formatos Markdown, YAML o JSON descriptivo.
2. La memoria adaptativa (`memory/`) se actualiza conforme el administrador interactúa y aprueba/rechaza acciones, permitiendo que el sistema aprenda patrones de trabajo.

