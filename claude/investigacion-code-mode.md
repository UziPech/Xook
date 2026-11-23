# Investigación — Modo código (Code Mode) para XOOK

Estado: **propuesta**, sin código todavía. Investigado el 2026-11-23.

## Qué es

En vez de que el modelo llame herramientas una por una (cada llamada es una ronda, y cada resultado pasa completo por el contexto), el modelo **escribe un script** que llama a las herramientas como si fueran una librería. El script corre aislado y solo lo que imprime vuelve al modelo.

La idea se apoya en algo simple: los modelos vieron muchísimo más código real que ejemplos de tool calling. Encadenar, filtrar, repetir y manejar errores en código les sale mejor que hacerlo ronda por ronda.

## Fuentes

| Fuente | Fecha | Qué aporta |
|---|---|---|
| [Cloudflare — Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode/) | 2025-09-26 | La idea original: convertir los esquemas MCP en una API TypeScript y dar al modelo una sola herramienta que ejecuta código. Sin cifras de ahorro. |
| [Cloudflare — Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/) | 2026-02-20 | Solo dos herramientas, `search` y `execute`, ambas reciben código. La especificación (2.500 endpoints) nunca entra al contexto: el modelo la consulta con código. ~1,17 M tokens → ~1.000 (99,9 %). |
| [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | 2025-11-04 | Herramientas como archivos (`servers/<servidor>/<herramienta>.ts`) que el agente lista y lee solo si los necesita. Filtrar datos dentro del sandbox, tokenizar datos personales, guardar scripts que funcionan como skills. 150.000 → 2.000 tokens (98,7 %) en un caso. |
| [AIMultiple — benchmark independiente](https://aimultiple.com/code-execution-with-mcp) | — | Ahorro medido más modesto: ~78 % de tokens de entrada. Es la cifra más realista para planear. |
| [Nordic APIs — MCP vs UTCP](https://nordicapis.com/model-context-protocol-mcp-vs-universal-tool-calling-protocol-utcp/) | — | UTCP: un "manual" JSON que describe cómo llamar a una herramienta por su interfaz nativa (HTTP, CLI, gRPC), sin servidor intermedio. |

### Código abierto disponible

| Repo | Licencia | Uso permitido en XOOK |
|---|---|---|
| [cloudflare/agents](https://github.com/cloudflare/agents) (`packages/codemode`) | MIT | Leer como referencia. Su sandbox depende de Workers (V8), no sirve tal cual en el sidecar de Python. |
| [universal-tool-calling-protocol/python-utcp](https://github.com/universal-tool-calling-protocol/python-utcp) y `code-mode` | **MPL-2.0** | **No como dependencia**: MPL-2.0 es copyleft débil y `AGENTS.md` solo admite MIT, Apache-2.0 o BSD. Se puede leer la idea del "manual", no copiar código. |

No encontré una implementación de Code Mode en Python con licencia permisiva. Habría que escribirla, aunque es poco código.

## Por qué encaja con XOOK

1. **Agnóstico de proveedor.** Es una sola herramienta con un parámetro `code` de tipo texto. Funciona con cualquier modelo que haga tool calling, y en uno que no lo haga se puede pedir un bloque de código en la respuesta. Va con el principio del roadmap: la inteligencia vive en XOOK.
2. **Ya existe la mitad.** `tool_search` hace la carga diferida (el punto de Anthropic sobre no cargar todo). `run_custom_script` ya ejecuta Python y Node bajo el Guardián. Falta el puente: que el script pueda llamar herramientas de XOOK.
3. **Integraciones sin MCP.** Una API HTTP o una CLI se describe con un manual corto (idea de UTCP) y el agente la usa desde código. Solo cuesta tokens cuando se consulta.
4. **Investigación profunda.** Los resultados de búsqueda y las páginas leídas se filtran dentro del script. Al modelo le llega el resumen, no 50 páginas crudas. Esto ataca directo el tope de `MAX_AGENT_STEPS = 12`: un script hace en una ronda lo que hoy toma diez.

## Aplicación a la generación de documentos

Es el mejor primer caso, por tres razones medibles en el código actual:

- **Tokens.** El esquema de `pdf_generate` ocupa ~19.400 caracteres (≈5.000 tokens) y el de `office_generate` ~7.800 (≈2.000). Se pagan en cada ronda en que el grupo `documents_pdf` está cargado, aunque el documento sea de una página.
- **"No agregues esto".** Hoy el documento sale de un JSON enorme que el modelo regenera completo en cada corrección, y ahí reaparece lo que el usuario pidió quitar. Con un script, la corrección es borrar una línea y volver a correrlo.
- **Repetible.** El script se guarda junto al documento. "Hazlo igual que el del mes pasado" es volver a correr el script con otros datos, y si se usa seguido se convierte en skill (Fase 3).

API propuesta, envolviendo los motores que ya existen (`pdf_engine/generator.py` y `office_generator.py`, sin dependencias nuevas):

```python
from xook import docs, workspace

ventas = workspace.read_table("agente/datos/ventas.xlsx")
pendientes = [f for f in ventas if f["Estado"] == "pendiente"]  # el filtro corre aquí, no en el modelo

doc = docs.new("docx", title="Pendientes de noviembre", design_skill="membrete-empresa")
doc.heading("Resumen")
doc.paragraph(f"{len(pendientes)} facturas pendientes.")
doc.table(pendientes, columns=["Cliente", "Monto", "Vence"])
# Sin sección de gráficas: el usuario pidió no incluirla.
print(doc.save("agente/reportes/pendientes-nov.docx"))
```

Las restricciones del usuario quedan escritas en el propio script (como comentario o como `assert`), y el paso de verificación propuesto antes ("releer y revisar cada restricción") se vuelve más fácil de cumplir.

## Diseño para el sidecar de Python

```text
src-brain/slices/code_mode/
├── runner.py      # lanza el subproceso aislado, límites de tiempo y memoria, recoge stdout
├── bridge.py      # RPC por stdin/stdout: el script pide "workspace.read", el host lo ejecuta
├── stubs.py       # genera el módulo `xook` (archivos .pyi con docstrings) desde tool_catalog
└── docs_api.py    # `xook.docs`, encima de pdf_engine
```

Reglas, tomadas de Cloudflare y Anthropic:

- **Sin claves dentro del script.** El script no ve la bóveda ni variables de entorno. Cada llamada a `xook.*` viaja al host, que aplica la misma política, la misma escalera de autonomía y la misma confirmación humana que una llamada directa. Una escritura protegida sigue pidiendo aprobación.
- **Sin red por defecto.** El acceso a internet pasa por `xook.web.*`, que el host controla, nunca por `requests` o `urllib` directo.
- **Aislamiento real, no solo regex.** Hoy `_validate_custom_script_safety` filtra patrones con expresiones regulares, y eso no es un sandbox. Hace falta aislar el proceso a nivel del sistema operativo: perfil de Seatbelt (`sandbox-exec`) en macOS, Landlock en Linux, token restringido en Windows. Este es el trabajo más delicado del plan.
- **Descubrimiento progresivo.** `xook.tools.search("pdf")` devuelve firmas cortas. El catálogo completo nunca entra al prompt.
- **Datos sensibles.** A futuro, tokenizar correos o teléfonos en el host (`[EMAIL_1]`) para que no pasen por el modelo, como describe Anthropic.

## Riesgos

- **Modelos pequeños escriben mal código.** El modo clásico se conserva como respaldo, y las evals de proveedores deciden por modelo cuál usar. Es la misma lógica de "degradación elegante" de la Fase 0.
- **Ejecutar código del modelo** suma superficie de ataque. Por eso el aislamiento del sistema operativo va antes de habilitar escrituras.
- **Las cifras de 98–99 % son de los autores.** Para planear conviene asumir el ~78 % del benchmark independiente y medir el nuestro.

## Plan propuesto

1. **Prototipo de solo lectura.** `code_mode` con el puente RPC y stubs de `workspace_read`, `workspace_search` y `memory_search`. Sin escrituras.
2. **`xook.docs`** sobre los motores existentes. Primer caso real: generar un `.docx` o un PDF desde un script.
3. **Evals comparativas** en `slices/provider_evals/`: las mismas tareas en modo clásico y en modo código, midiendo tokens por tarea y tasa de éxito en al menos tres proveedores.
4. **Aislamiento del sistema operativo** y, después, escrituras a través del puente con confirmación humana.
5. **Manuales de integración** (idea de UTCP, implementación propia) para APIs y CLIs sin MCP.

Criterio de salida: en las evals, el modo código usa al menos 50 % menos tokens en tareas de documentos e investigación, sin bajar la tasa de éxito, en al menos tres proveedores.
