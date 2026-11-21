# Paquetes del Monorepo XOOK (`packages/`)

Workspace formal configurado con `npm workspaces` para compartir contratos tipados y herramientas de observabilidad del agente sin acoplar el frontend (`src-ui/`), el núcleo Rust (`src-tauri/`) ni el motor Python (`src-brain/`).

## Paquetes activos

| Paquete | Ruta | Propósito |
|---|---|---|
| `@xook/contracts` | `packages/contracts/` | Contratos compartidos y validadores en runtime: semántica de entrega (`deliverySemantics.ts`), escalera de autonomía y riesgo (`agentPolicy.ts`), checkpoints y memoria operativa por turno (`contextCheckpoint.ts`) y esquema aditivo v1 de trazas JSONL (`agentTrace.ts`). |
| `@xook/agent-inspector` | `packages/agent-inspector/` | Analizador y CLI en tiempo real para inspeccionar trazas `.xook/agent_traces/<session_id>.jsonl`: consumo de ventana de contexto, compactaciones (LLM vs fallback), tiempos y errores de herramientas, disposiciones de entrega y sub-agentes. |

## Comandos principales

```bash
# Validar tipos en src-ui y en todos los paquetes
npm run typecheck

# Correr pruebas unitarias co-localizadas de los paquetes TS
npm run test:packages

# Correr pruebas unitarias co-localizadas del motor Python
npm run test:brain

# Analizar la última sesión agéntica registrada en un workspace
npm run agent:inspect -- /ruta/al/workspace

# Listar sesiones o seguir en vivo lo que hace Xox
npm run agent:inspect -- /ruta/al/workspace --list
npm run agent:inspect -- /ruta/al/workspace --watch
npm run agent:inspect -- /ruta/al/workspace --json
```

## Convenciones de frontera

- `packages/contracts` no tiene dependencias de runtime ni acoplamiento a React, Tauri o Node.
- Cada archivo de contrato lleva su prueba unitaria al lado (`*.test.ts`).
- Las trazas en `.xook/agent_traces/` son JSONL aditivo, con redacción automática de secretos y tope de tamaño por archivo (2 MB) y cantidad (40 sesiones). Nunca guardan capturas crudas ni claves de bóveda.
