# Referencias externas

Repositorios de terceros que se usan **únicamente como material de consulta** para el diseño de XOOK.
No forman parte del build, no son dependencias y **no deben importarse desde el código de XOOK**.

Esta carpeta está ignorada por git (ver `.gitignore`) porque pesa cientos de MB y su contenido no es nuestro.

## Cómo se usan

Un agente o desarrollador que vaya a construir algo en XOOK debe:

1. Identificar el problema concreto (p. ej. "necesito una política de autonomía para el agente").
2. Ir al repo y archivo que corresponda según la tabla de abajo.
3. Leer el patrón, entender **por qué** está resuelto así.
4. Escribir la versión propia de XOOK, adaptada a Tauri + Rust + React. **Nunca copiar código tal cual.**

Regla de licencias (ver `AGENTS.md`): ambas son permisivas y permiten inspiración e incluso reutilización
con atribución, pero la política del proyecto es que XOOK tenga implementación propia y comprensible.

## Catálogo

| Carpeta | Proyecto | Licencia | Qué es | Para qué sirve aquí |
|---|---|---|---|---|
| `agent-desktop/` | [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) | Apache-2.0 | CLI en Rust + capa MCP que permite a un agente **operar el escritorio** (ver, clicar, escribir) | Es la referencia más cercana a nuestra capa Rust. Modelo de observación por **árbol de accesibilidad** en vez de OCR, y políticas de comando verificadas por el compilador |
| `t3code/` | [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | MIT | GUI en TypeScript/Electron para **orquestar varios agentes de código** con hilos, diffs y aprobaciones | Es la referencia de **gobierno del agente**: escalera de autonomía, políticas bloqueadas, contratos compartidos y evals |

## Dónde mirar según lo que necesites

### Gobierno y permisos del agente

| Necesitas | Archivo de referencia |
|---|---|
| Escalera de autonomía (aprobar todo → acceso total) | `t3code/packages/contracts/src/providerPolicy.ts` |
| Políticas que ni el usuario ni el agente pueden sobrescribir | `t3code/` — busca `managedPolicy` |
| Referencias a secretos sin guardar el secreto | `t3code/packages/contracts/src/` — busca `secretReference` |
| Declaración de permisos por comando, exhaustiva | `agent-desktop/src/command_policy/` |
| Auditoría de licencias y advisories del árbol de dependencias | `agent-desktop/deny.toml` |

### Observación de pantalla y control de UI

| Necesitas | Archivo de referencia |
|---|---|
| Leer la UI sin OCR ni capturas (árbol de accesibilidad) | `agent-desktop/src/` — backends por plataforma |
| Referencias estables a elementos y drill-down a subárboles | `agent-desktop/src/` |

### Arquitectura y contratos

| Necesitas | Archivo de referencia |
|---|---|
| Un archivo de esquema por concepto, con su test al lado | `t3code/packages/contracts/src/` |
| Validación de los contratos entre front y back | `t3code/packages/contracts/` |
| Evals como paquete aparte del CI (porque cuestan dinero) | `t3code/` — busca `evals` |

## Advertencias

- **No copiar la escala de `t3code`.** Tiene decenas de paquetes y un adaptador por cada agente soportado, fruto de años de producto. Lo valioso ahí es la doctrina escrita, no el volumen.
- **No migrar a Electron.** `t3code` usa Electron; XOOK usa Tauri y no hay razón para cambiar (binario más chico y puente Rust ya resuelto).
- **`agent-desktop` sí es Rust**, así que sus decisiones de estructura de crates y su `deny.toml` son directamente aplicables.

## Actualizar una referencia

```bash
cd referencias/<carpeta>
git pull --depth 1
```

Si se requiere re-clonar desde cero, se hace con `--depth 1 --single-branch` para no traer el historial completo.

Los hallazgos ya sintetizados de estos dos repos están en `IdeaDeXox.md`, sección 11.5.
