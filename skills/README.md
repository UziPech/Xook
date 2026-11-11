# 🎯 Directorio de Habilidades Agénticas (`/skills`)

Este directorio contiene las habilidades modulares del sistema. Cada *Skill* representa una capacidad funcional orientada al trabajo productivo del usuario final (administrador, gerente, operador), ocultando toda la complejidad técnica de APIs o protocolos subyacentes.

## Filosofía
- El usuario final nunca ve configuraciones como "MCP", "Endpoints REST" o "Tokens".
- El usuario interactúa con capacidades de negocio: *"Analizar ventas semanales"*, *"Sugerir reabastecimiento de stock"*, *"Conciliar facturas vs pedidos"*.

## Estructura de un Skill
Cada habilidad se aísla en su propia subcarpeta:

```text
skills/
├── templates/                 # Plantillas base para nuevas habilidades
└── [nombre-habilidad]/
    ├── SKILL.md              # Instrucciones del agente en lenguaje claro
    ├── prompts/              # Prompts específicos y plantillas
    └── schema.json           # Contrato de datos de entrada/salida de negocio
```

## Reglas de Inclusión
- Antes de integrar bibliotecas o componentes de código abierto en este módulo, se auditan su licencia, seguridad y compatibilidad.

