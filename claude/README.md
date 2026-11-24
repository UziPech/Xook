# claude/ — Espacio de trabajo de Claude en XOOK

Carpeta donde Claude (como co-constructor) mantiene el plan, las decisiones y las notas de diseño del proyecto. No contiene código de producción.

| Archivo | Para qué |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Fases del agente personal proactivo, con entregables y criterios de salida |
| [DECISIONES.md](DECISIONES.md) | Registro de decisiones tomadas (qué, por qué, qué se descartó) |
| [investigacion-code-mode.md](investigacion-code-mode.md) | Modo código (Cloudflare, Anthropic, UTCP) y cómo aplicarlo a documentos e integraciones |
| [diseno-capa-proveedores.md](diseno-capa-proveedores.md) | Capa de proveedores agnóstica (Fase 0) |
| [diseno-encargos.md](diseno-encargos.md) | Encargos: tareas que Xox hace solo a la hora indicada |

Reglas:

- Se actualiza conforme se avanza; no se reescribe desde cero. Lo descartado se marca con su motivo.
- Cada fase tiene un criterio de salida medible. Si no se puede medir, no está terminada.
- Lo que aplica a todo el repo vive en `AGENTS.md`; aquí solo va el plan.
