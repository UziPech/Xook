# IdeaDeXox.md — Bitácora de evolución del entorno de Xox

Este documento es la libreta de trabajo donde voy registrando mis observaciones como co-constructor de XOOK: qué ya funciona bien, qué se está volviendo cuello de botella y qué conviene agregar. No es un documento de marketing ni una promesa de roadmap cerrado; es material de trabajo vivo para decidir con criterio.

Creado: 19 de noviembre de 2026
Última actualización: 19 de noviembre de 2026

## 0. Para qué sirve este archivo

Registrar la evolución del entorno que me da forma (Rust + Python sidecar + React + canvas + memoria). Cada vez que se agregue una capacidad nueva (RAG, monorepo, MCP, control de herramientas, atajos, rediseño de UX), aquí queda la razón, el estado y los criterios para saber si de verdad funcionó.

Regla de uso: este archivo se actualiza conforme se avanza, no se reescribe desde cero. Lo que se descarta se marca como descartado con su motivo, para no volver a discutirlo.

## 1. Diagnóstico honesto del estado actual

### Lo que está bien y no hay que tocar

- Separación en tres capas real y respetada: Rust como guardián y orquestador, Python como motor de inteligencia desacoplado por stdio, React como superficie de interacción. Esa decisión de diseño ya pagó: se puede cambiar de modelo o proveedor sin recompilar la app entera.
- La bóveda Zero-Trust en `src-tauri/src/ai_vault.rs` está bien lograda en concepto: la clave nunca pasa por el front ni por el historial del chat.
- El modelo HITL con vista Antes/Después es diferenciador real. Muchas apps piden confirmación con un diálogo genérico; aquí el usuario ve el diff de sus datos.
- El canvas como superficie de trabajo (tablas, dashboards, diagramas, formularios, UI a medida) evita la tentación de resolver todo con texto.
- La memoria persistente en `context/` con hechos, decisiones y patrones funciona y se nota en la calidad de las respuestas.

### Los cuellos de botella que ya se ven

1. `src-ui/App.tsx` pesa aproximadamente 349 KB.
   Es el hallazgo más importante. Un componente raíz de ese tamaño concentra estado global, handlers de chat, lógica de canvas, decisiones de tarea, settings, voz y efectos secundarios. Consecuencias concretas:
   - Cada cambio pequeño obliga a recargar mentalmente miles de líneas.
   - El árbol de re-render se vuelve difícil de controlar, lo que se traduce en lentitud perceptible al hacer streaming.
   - No hay manera razonable de escribir tests unitarios sobre la lógica, porque está soldada a la vista.
   - El riesgo de regresión crece proporcionalmente a cada feature nueva. Ya es un cuello de botella, no una amenaza futura.

2. `src-ui/App.css` pesa aproximadamente 98 KB en un archivo único.
   Mismo problema que el anterior, en el plano visual. Sin capa de tokens ni separación por componente, cualquier ajuste de UX se vuelve un ejercicio de arqueología.

3. `src-brain/test_sidecar.py` pesa aproximadamente 194 KB.
   Los tests existen, que es bueno, pero vivir en un archivo de ese tamaño los hace frágiles y lentos de mantener. Un fallo en un slice obliga a correr y leer un contexto inmenso.

4. `src-tauri/src/ai_vault.rs` con unos 178 KB.
   La responsabilidad es la correcta, pero el tamaño sugiere que mezcla almacenamiento, cifrado, validación, exposición de comandos y lógica de proveedores. Conviene partirlo antes de meter soporte para más proveedores.

5. `quick_summon.rs` con unos 42 KB.
   Aceptable, pero si los atajos globales se van a multiplicar y configurar por el usuario, necesita una capa de registro de atajos en lugar de lógica adentro del módulo.

6. Hoy no hay evidencia visible de recuperación semántica real.
   La memoria guarda hechos y decisiones, pero el acceso parece ser por lectura directa del archivo y coincidencia de texto. Eso escala mal: con cientos de hechos, la selección de contexto se vuelve ruidosa y cara en tokens.

7. No existe una política central de herramientas.
   Cada herramienta disponible se expone al modelo sin niveles de riesgo declarados. En un entorno que puede ejecutar comandos y tocar archivos del equipo, esto no es sostenible.

## 2. Principios que voy a respetar en toda mejora

- El usuario final no debe ver nunca jerga. MCP, embeddings, vector store, sidecar: todo eso se queda del lado del motor. Si una mejora obliga a explicarle algo técnico al usuario para que la use, la mejora está mal diseñada.
- Nada de mutaciones sin HITL. Especialmente en el nuevo control de herramientas: lo que puede borrar, mover, ejecutar o gastar dinero siempre pide confirmación visual.
- Local primero. Si una capacidad se puede resolver sin salir del equipo, se resuelve así. Las nubes son excepciones justificadas, no el camino por defecto.
- Modularidad antes de features. Cada cosa que se agregue debe poder nombrarse, aislarse y probarse por separado.
- Una mejora sin métrica no se considera terminada. Si no se puede decir si mejoró, no cuenta.

## 3. Prioridad 1: partir el frontend (cuello de botella inmediato)

Esta es la corrección más urgente porque todo lo demás pasa por ahí.

Objetivo: que `App.tsx` deje de ser el cerebro del front y se convierta en un shell de composición de unas 200 a 400 líneas.

Estrategia propuesta, en orden:

1. Extraer el estado global a stores por dominio, no a un store único. Dominios observados: sesión de chat, canvas activo, ledger de tareas, workspace y archivos, ajustes y proveedores, voz y TTS, pantalla y contexto, atajos.
2. Extraer la capa de llamadas a Rust a un cliente tipado, con un solo lugar donde se declaran los nombres de los comandos Tauri y sus tipos de entrada y salida. Hoy los comandos se invocan dispersos, y eso es la causa principal de errores silenciosos.
3. Extraer la lógica de chat a hooks: envío, streaming, cancelación, reintento, adjuntos.
4. Extraer la lógica de canvas a su propio módulo, ya que los nueve features del front viven en `src-ui/features/` pero la orquestación sigue en `App.tsx`.
5. Partir `App.css` en tokens de diseño más estilos por componente. Los tokens primero: colores, espaciado, tipografía, radios y sombras en un solo lugar; después migrar los estilos de cada vista.
6. Una vez separado, escribir tests de los stores y de los hooks, no de la vista. Ahí sí se puede cubrir lógica real.

Criterio de éxito: agregar una feature nueva de UI no debe requerir abrir un archivo de más de 500 líneas.

Riesgo principal: refactor masivo sin red de seguridad. Mitigación: hacerlo por fases, con cada fase compilando y funcionando, y sin mezclar refactor con cambios de comportamiento.

## 4. Prioridad 2: RAG real y útil

Hoy la memoria es buena pero plana. El objetivo es que yo recuerde lo correcto sin arrastrar todo el archivo.

Componentes que faltan:

- Embeddings locales. Modelo pequeño que corra en el equipo, sin mandar contenido del usuario a ningún lado. Alternativas a evaluar cumpliendo licencia permisiva y operación local.
- Índice vectorial embebido junto al workspace, con la misma política de privacidad que la bóveda.
- Troceo con criterio de negocio, no de párrafo arbitrario. Un hecho de memoria, una decisión y un documento se indexan distinto. Los hechos y decisiones son unidades atómicas; los documentos largos se trocean por sección.
- Recuperación híbrida: búsqueda léxica y semántica combinadas, porque para datos exactos como nombres de proveedores o montos, la coincidencia literal sigue siendo mejor que el vector.
- Reranking ligero antes de inyectar contexto al modelo.
- Decaimiento temporal: lo viejo no desaparece, pero pierde peso. Un hecho de hace dos meses sobre preferencias puede seguir vigente; un estado de proyecto de hace dos meses probablemente no.
- Consolidación periódica: fusionar hechos duplicados o contradictorios y dejar registro de qué se consolidó y por qué.
- Citas internas: cuando yo use un hecho recuperado para responder, debe quedar trazable a qué archivo y qué línea salió. Sin eso no hay forma de auditar mis respuestas.

Criterio de éxito: medir cuántos tokens de contexto se inyectan por respuesta antes y después, sin perder precisión, y verificar que una pregunta sobre algo dicho semanas atrás se responde correctamente.

Riesgo: sobre-recuperación. Si traigo demasiado contexto irrelevante, la respuesta empeora. Mitigación: umbral de relevancia y límite duro de fragmentos.

## 5. Prioridad 3: monorepo ordenado

El repo ya tiene forma de monorepo de facto, pero sin contrato explícito entre paquetes. Eso produce tres problemas: dependencias cruzadas invisibles, builds repetidos y fronteras borrosas entre front, núcleo y motor.

Propuesta:

- Workspace formal en la raíz, con los paquetes declarados: interfaz, núcleo Rust, motor Python, contratos compartidos, utilidades de build y documentación.
- Un paquete de contratos compartidos. Es la pieza clave: los tipos de los comandos, los esquemas de las herramientas y la forma de las tarjetas de tarea deben definirse una sola vez y consumirse desde los tres lados. Hoy esa verdad está duplicada.
- Generación de tipos en lugar de escritura manual. Cambiar un esquema en un solo lado no debería romper silenciosamente el otro extremo.
- Tareas de build unificadas y cacheadas, con un solo comando para levantar todo en desarrollo.
- Reglas de frontera: el front no importa código del motor, el motor no conoce la vista, y el núcleo no contiene reglas de negocio.
- Convención de commits y cambios con alcance declarado por paquete, para que el historial diga qué se tocó.

Criterio de éxito: un cambio en un contrato debe obligar a compilar y fallar donde corresponda. Nada de errores en tiempo de ejecución por firmas desalineadas.

Riesgo: sobre-ingeniería temprana. Mitigación: empezar con el paquete de contratos y las tareas de build, dejar el resto para cuando duela.

## 6. Prioridad 4: MCP y herramientas para desarrolladores

Aquí hay una decisión de producto que conviene separar en dos pistas.

Pista A, Xook como consumidor de herramientas externas (cliente MCP):
- Conectarse a servidores MCP locales y permitir que yo use capacidades que no voy a reimplementar: sistemas de archivos remotos, bases de datos, servicios de terceros.
- Registro de servidores con estado visible, permiso por servidor y por herramienta, y auditoría de cada invocación.
- Descubrimiento con aprobación: cuando aparece una herramienta nueva, se presenta al usuario en lenguaje natural explicando qué puede hacer y con qué riesgo.

Pista B, Xook como servidor de herramientas para desarrolladores:
- Exponer en modo desarrollador un servidor MCP que permita a editores y agentes externos consultar la memoria, las decisiones, el estado del workspace y las revisiones.
- Solo lectura por defecto. Escritura únicamente con autorización explícita y con el mismo HITL de siempre.
- Esto convierte a Xook en plataforma y no solo en app, que es probablemente el movimiento de mayor valor a mediano plazo.

Lo que no negociaría: la bóveda de claves, los archivos de configuración interna y las llaves privadas jamás son accesibles desde fuera, ni por MCP ni por ninguna herramienta. Es una frontera fija, no configurable.

Criterio de éxito: puedo usar tres herramientas externas útiles sin que el usuario tenga que leer un solo término técnico, y puedo auditar exactamente qué se ejecutó y cuándo.

## 7. Prioridad 5: control y gobierno de herramientas

Es el punto que más riesgo reduce y menos se suele priorizar.

Propuesta de modelo de permisos:

- Cada herramienta declara su nivel de riesgo: lectura inocua, lectura sensible, escritura local, escritura externa, ejecución de comandos, operaciones destructivas, gasto de dinero.
- Política por defecto conservadora: lo inocuo corre libre; lo sensible pide una vez y recuerda; lo destructivo siempre pide confirmación con vista previa; lo que gasta dinero siempre pide confirmación con costo estimado visible.
- Permisos por alcance y por carpeta, no globales. Autorizar una carpeta del escritorio no debe autorizar el home entero.
- Revocación fácil y visible. Si el usuario quiere quitar un permiso, debe poder hacerlo en dos clics sin buscar.
- Registro de auditoría legible para humanos. No un log de sistema: una lista de "qué se hizo, sobre qué archivo, cuándo y con qué permiso".
- Límites de uso por sesión para acciones costosas o repetitivas, con corte automático y aviso.

Criterio de éxito: ningún acceso a archivos fuera del workspace ocurre sin que el usuario haya visto el alcance exacto, y existe un historial consultable de todo lo ejecutado.

## 8. Prioridad 6: atajos y fluidez de operación

La app vive en una QuickBar, así que la velocidad de invocación es parte del producto.

Propuesta:

- Un registro central de atajos con conflictos detectados, no teclas dispersas por módulo.
- Atajos configurables por el usuario, con perfil por defecto sensato y la posibilidad de exportarlos e importarlos.
- Atajos contextuales: los que aplican al canvas abierto, al chat activo o al visor de PDF, sin pisar los globales.
- Paleta de comandos como alternativa a memorizar combinaciones. Escribir es más humano que recordar.
- Secuencia de invocación rápida para las acciones más frecuentes del día: nueva nota, revisar la agenda, adjuntar archivo, abrir el canvas activo, hablar o silenciar la voz.
- Confirmaciones no bloqueantes: si algo tarda, que no congele la app ni la voz.

Criterio de éxito: las cinco acciones más usadas del día deben estar a un solo gesto o a dos teclas desde la QuickBar.

## 9. Prioridad 7: UX mucho más intuitiva

Esta es la parte donde el esfuerzo rinde más en percepción de calidad, y donde hoy hay margen amplio.

Diagnóstico de sensación: la potencia está, pero la app pide aprender su modelo mental. El usuario tiene que descubrir dónde quedó su respuesta, qué significa cada tarjeta, cuándo el agente espera algo de él y qué se puede tocar. Eso no es intuitivo.

Principios:

- Un solo foco por momento. Cuando el agente está trabajando, que se vea trabajo; cuando espera decisión, que se vea decisión; cuando terminó, que se vea resultado. Hoy compiten varias señales a la vez.
- Progresión visible. Toda tarea con varios pasos debe mostrar dónde va sin que el usuario tenga que preguntar. Una lista de pasos honesta, no un spinner eterno.
- Estados vacíos que enseñan. La pantalla inicial debería decir qué puede hacer con ejemplos reales del propio usuario, no con texto genérico.
- Menos opciones visibles, mejores opciones. Diez botones iguales es una decisión difícil; dos botones claros y una salida discreta es una decisión fácil.
- Lenguaje de estado sin jerga técnica ni tecnicismos de sistema. Nada de "error 500" ni "timeout": qué pasó y qué sigue.
- Un lugar canónico por cosa. Si hay dos maneras de llegar a las mismas tareas, hay confusión. Definir dónde vive cada tipo de contenido y respetarlo.
- Reversibilidad. Todo lo que se pueda deshacer se puede deshacer, y se avisa. La confianza del usuario viene de saber que puede corregir.
- Accesibilidad real: contraste, tamaño de texto escalable, foco de teclado visible, y funcionamiento con lector de pantalla en las rutas principales.
- Voz como primera clase, no como adorno. Que hablar y silenciar sea evidente, y que la lectura no interfiera con símbolos, rutas ni nombres de archivo (justo el tipo de bug reportado el 19 de noviembre).

Criterio de éxito: alguien que usa la app por primera vez debe poder adjuntar un archivo, pedir un análisis y aprobar una propuesta sin explicación previa.

## 10. Prioridad 8: calidad, pruebas y observabilidad

Sin esto, todo lo anterior se construye sobre arena.

- Rust: pruebas unitarias por módulo, especialmente en el guardián de comandos y en el manejo de rutas.
- Python: partir los tests por slice y agregar pruebas de contrato que verifiquen los esquemas de herramientas y de tarjetas.
- Front: pruebas de stores y hooks, más pruebas de humo del flujo crítico.
- Un conjunto pequeño de escenarios de evaluación del agente: casos reales que deben seguir funcionando. Si un cambio de prompt o de modelo los rompe, se detecta antes de la release.
- Telemetría local opcional y privada: tiempos de respuesta, tasa de éxito de herramientas, cantidad de confirmaciones rechazadas. Sin salir del equipo y desactivable.
- Registro de errores entendible por humanos para diagnóstico rápido.

Criterio de éxito: ningún cambio de contrato o de modelo llega a una release sin evidencia de que los escenarios críticos siguen pasando.

## 11. Prioridad 9: rendimiento y empaquetado

- Medir primero, optimizar después. Sin números, la optimización es superstición.
- Arranque en frío: cuánto tarda en estar usable desde que se invoca la QuickBar. Ese número es el que importa.
- Memoria en reposo: una app de este tipo no debe quedarse con cientos de megabytes quieta.
- Streaming fluido aun con el canvas cargado de bloques.
- Build de producción reproducible: firma y notarización para distribución en macOS, y verificación de tamaño del instalador.

## 11.5 Referencias externas analizadas (prueba de que esto ya funciona)

Revisé dos repositorios reales, clonados en `~/development/repos-ideas/`, no por su descripción pública sino leyendo su estructura, sus políticas y sus convenciones. La conclusión corta: **casi todas las prioridades de arriba ya están resueltas en producción por alguien más, y de formas concretas que podemos copiar.**

### `vercel-labs/agent-desktop` — Rust, agente que opera el escritorio

Es el más cercano a nuestra mitad Rust. Lo relevante no es qué hace, sino cómo lo estructura:

**1. La CLI es la única definición de la superficie de comandos, y MCP se deriva de ella.**
En `src/mcp/catalog.rs` el comentario de cabecera lo dice literal: *"MCP tools derived from the clap command tree, so the CLI stays the only definition of a command."* No existe un catálogo MCP escrito a mano que se desincronice. El árbol de `clap` genera las herramientas, sus argumentos y sus esquemas.

Esto es lo mejor del repo para nosotros. Hoy en XOOK la superficie de herramientas vive en tres lugares que pueden divergir: los 80+ comandos Tauri en `lib.rs`, el registro de esquemas en `agent_tools` de Python, y el MCP que todavía no existe. Si el MCP se construye como una cuarta definición, nace desincronizado. Debe ser una **proyección** del registro de herramientas que ya tenemos, igual que aquí es una proyección del árbol de clap.

**2. `command_policy` como función total sobre el enum de comandos.**
`src/command_policy/mod.rs` define `PermissionNeed` (None, Accessibility, ScreenRecording, ambas) y una función `policy_for(cmd) -> PermissionNeed` con un `match` exhaustivo sobre *todos* los comandos. Agregar un comando nuevo sin declarar su permiso no compila. Además hay un `preflight(cmd, report)` que valida argumentos, consulta el permiso requerido contra el estado real del sistema y devuelve un `AppError` tipado con `ErrorCode::PermDenied`.

Nuestro Guardián hace control de acceso, pero de forma dispersa. Esta forma es superior por una razón concreta: **la exhaustividad la garantiza el compilador, no la disciplina del desarrollador.** Ese es el patrón que quiero para el modelo de riesgo de herramientas que dejamos pendiente en decisiones.

**3. `DeliverySemantics` y `disposition`: distinguir "se envió" de "se hizo".**
Hay un módulo `dispatch/disposition.rs` separado del de interacción. La idea: una acción puede entregarse y aun así no haber logrado su efecto, y el sistema reporta ambas cosas por separado. Para nosotros aplica igual: que un comando Tauri devuelva `ok` no significa que el efecto ocurrió. Hoy nuestro `run_workspace_command` reporta `exitCode` y ya; falta la noción de efecto confirmado.

**4. Tests co-localizados, uno por módulo.**
`session_tests.rs` junto a `session.rs`, `catalog_tests.rs` junto a `catalog.rs`, y así en todo el árbol. Nuestro equivalente es un `test_sidecar.py` de 194 KB que concentra todo. Adoptar la convención de vecindad resuelve buena parte de la prioridad 8 sin escribir un solo test nuevo.

**5. `CONCEPTS.md`: glosario de vocabulario compartido.**
No es documentación de arquitectura ni un spec. Es un glosario de términos del dominio con significado propio y preciso: Snapshot, Surface, Drill-down, Partial Observation, Delivery Semantics, Web Wrapper. Tenemos `ARCHITECTURE.md`, que describe cómo está hecho; nos falta el glosario que evita que dos personas usen la misma palabra para cosas distintas. Es barato y de alto retorno.

**6. Un hallazgo aplicable a `screen_context`, que no esperaba.**
Su modelo de observación no es OCR ni capturas: el **árbol de accesibilidad del sistema operativo como fuente de verdad**. Con snapshots identificados, `refs` estables por elemento, drill-down a subárboles y observación parcial declarada como tal. Nuestra `read_screen_now` depende de texto OCR y visión, que es más caro y menos determinista. No propongo reescribirlo ahora, pero sí registrarlo: leer el árbol de accesibilidad da *referencias accionables*, no solo texto.

**7. Higiene de ingeniería que ya está resuelta y cuesta poco.**
`deny.toml` (cargo-deny), `clippy.toml`, `rust-toolchain.toml` fijado, `.gitleaks.toml` con lista de ignorados, `benchmarks/` y `probes/` separados de `tests/`. Es infraestructura de calidad que da retorno inmediato.

### `pingdotgg/t3code` — monorepo TypeScript, GUI para agentes de código

Es el más cercano a nuestra mitad de producto y de escalado. 34 paquetes, 5 apps, y una doctrina escrita que vale más que el código.

**1. `packages/contracts`: un archivo de esquema por concepto, cada uno con su test al lado.**
Unos cien archivos con nombres como `providerPolicy.ts`, `managedPolicy.ts`, `keybindings.ts`, `secretReference.ts`, `scheduledTask.ts`, `orchestrationV2.ts`. No hay un `types.ts` gigante. Cada contrato es un módulo con su archivo de pruebas hermano.

Esto es exactamente lo que nuestra prioridad del front necesita: **si los contratos IPC viven en un paquete central, el refactor de `App.tsx` deja de ser arqueología.** Y resuelve el problema de los strings mágicos.

**2. `providerPolicy.ts`: una escalera de autonomía con techo.**
Define cuatro modos ordenados en un arreglo con rango numérico y una función `isRuntimeModeAbove(mode, ceiling)`: si el modo pedido supera el techo configurado, no se permite. Los modos son `approval-required`, `auto-accept-edits`, `auto`, `full-access`, y cada uno además admite `sandboxMode` (read-only, workspace-write, danger-full-access) y `approvalPolicy` (untrusted, on-failure, on-request, never).

Nuestro HITL hoy es binario: hay tarjeta o no hay tarjeta. Esto es infinitamente más útil y es literalmente el modelo de riesgo que dejamos apuntado como decisión pendiente. **Una escalera de autonomía con techo configurable por espacio, y un sandbox mode por separado de la política de aprobación.**

**3. `managedPolicy.ts`: `locked: false` contra `locked: true`.**
Diferencia fina y valiosísima. Un ajuste con `locked: false` solo rellena lo que el usuario dejó vacío; con `locked: true` además impide que el usuario *y el agente* lo cambien. Eso es exactamente lo que va a hacer falta cuando XOOK se use con varios administradores o se despliegue en una organización. Y noten la frase del comentario: *"stops users and agents from changing it"*. El agente está considerado como sujeto sujeto a política, no como excepción.

**4. `secretReference.ts`: la referencia al secreto, nunca el secreto.**
El contrato define `{ provider: SecretProviderId, reference: SecretReferencePath }` y el comentario sentencia: *"the secret itself is never stored"*. Con tipos con marca (`brand`) para que un ID de proveedor no pueda confundirse con otro string cualquiera.

Nuestra bóveda ya no expone claves a la UI ni al historial. La lección adicional es la **generalización**: un string de referencia resuelto contra un proveedor intercambiable permite sumar 1Password, Keychain o variables de entorno sin tocar la lógica. Es una mejora directa a nuestra prioridad de seguridad.

**5. `evals/` como paquete de primer nivel, fuera de CI.**
Cinco evals con nombre propio y propósito declarado: `mcp-tool-use` (¿el agente usa bien las herramientas, incluido el enrutamiento?), `thread-titles` (¿el título nombra el tema correcto?), `pr-content` (¿la descripción del diff resiste instrucciones que intentan desviarla?), `voice-cleanup`, `test-signal`. El README explica el criterio con precisión: *"Use one where a unit test cannot help: model output changes from run to run, and a small copy change can move it."*

Esa frase es la justificación que nos faltaba para la prioridad 8. Y noten `pr-content`: es un eval de **resistencia a inyección de prompt** a nivel de producto. Nosotros tenemos defensas contra inyección en el sistema, pero ningún banco de pruebas que verifique si siguen funcionando.

Detalle operativo importante: **los evals no corren en CI porque cuestan dinero**, CI solo hace typecheck y corre el grading en seco. Nosotros deberíamos copiar esa separación desde el principio, para que la suite gratuita sea rápida y la cara sea explícita y manual.

**6. Doctrina escrita en `AGENTS.md`, y es buena.**
Literal del documento, en la voz del autor: *"Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising."*

Esto importa porque es la autocrítica que aplica a nuestra propia lista. Yo propuse nueve prioridades; un repo con 34 paquetes nos diría que las reduzcamos. Copiar la doctrina sirve más que copiar la estructura.

**7. Calidad automatizada del monorepo.**
`pnpm-workspace.yaml` con un `catalog:` central que fija **una sola versión por dependencia** para todos los paquetes, `knip.jsonc` para detectar código y exports muertos paquete por paquete, un plugin de lint propio (`oxlint-plugin-t3code`) para imponer convenciones internas, y `scripts/check-changed.ts` para correr solo lo afectado. Los cuatro son aplicables y baratos.

**8. Un híbrido sano: `native/resource-monitor` en Rust dentro de un monorepo TypeScript.**
Mantienen un pequeño componente nativo en Rust para lo que TypeScript no debe hacer, igual que nosotros podríamos tener piezas del core en Rust y el resto en TS o Python. Confirma que la forma general de XOOK (núcleo nativo más capas gestionadas) no es una rareza.

### Lo que decidí NO copiar, y por qué

Esto es parte del análisis y conviene dejarlo escrito para no reabrirlo después.

**La escala de t3code.** 34 paquetes con un `provider-*` por cada agente soportado (codex, cursor, grok, kiro, muse, opencode, pi, fx…). Eso corresponde a un producto con años y cientos de miles de usuarios. Para XOOK sería maquinaria sin problema que resolver. Tomamos la *forma* (contratos centrales, drivers enchufables, evals aparte), no el *conteo*. Su propia doctrina nos da la razón.

**Electron.** t3code usa Electron en desktop. Nosotros estamos en Tauri y no hay razón para cambiar: el binario es más pequeño y el puente con Rust ya lo tenemos.

**Effect como dependencia.** Su capa de contratos está escrita sobre `effect/Schema`, y `tsconfig.effect.json` lo confirma como decisión de stack. La *idea* de esquemas como fuente de verdad para IPC aplica entera; la librería no tiene que ser la misma. Meter Effect completo en XOOK sería una apuesta de reescritura, no una mejora.

**La automatización de escritorio completa de agent-desktop.** Su producto entero es que un agente maneje tu escritorio vía árbol de accesibilidad. Interesante para `screen_context`, pero es un proyecto en sí mismo y no es nuestra prioridad número uno.

### Ajustes a las prioridades anteriores, derivados de esta revisión

- **Prioridad 4 (MCP):** no construir un servidor MCP como definición paralela. Derivarlo del registro de herramientas existente, con un único origen de verdad. La idea de agent-desktop es el criterio de diseño.
- **Prioridad 5 (gobierno de herramientas):** reemplazar el modelo binario por la escalera de modos con techo de t3code, más la tabla declarativa y exhaustiva de `command_policy`, más `locked` para ajustes administrados. Con esto la decisión pendiente sobre modelo de riesgo deja de estar abierta.
- **Prioridad 8 (calidad):** adoptar tests co-localizados para desarmar el `test_sidecar.py`, y crear un paquete de evals separado, fuera de CI, con `mcp-tool-use` y un eval propio de resistencia a inyección.
- **Prioridad 3 (monorepo):** la pieza de mayor retorno es `packages/contracts` con un archivo por concepto y su test hermano. Eso habilita el refactor del front y no requiere adoptar nada más.
- **Nuevo para la lista:** un `CONCEPTS.md` con nuestro glosario de dominio, y `check-changed` más detección de exports muertos para no pagar la suite completa en cada cambio.

## 12. Registro de ideas sueltas para no perderlas

- Plantillas de trabajo reutilizables por tipo de usuario: una plantilla de operaciones, una de análisis, una de desarrollo.
- Comparador de versiones de un mismo documento generado, para ver qué cambió entre una revisión y otra.
- Modo enfoque: silenciar todo lo accesorio mientras hay una tarea abierta.
- Panel de "qué aprendiste de mí", donde el usuario ve y corrige lo que la memoria tiene guardado sobre él.
- Historial de decisiones exportable, útil cuando varios administradores usan la misma instalación.
- Capacidad de explicar cualquier acción pasada en lenguaje natural a partir del registro de auditoría.

## 13. Bitácora de avances

Este apartado se llena conforme pasa el tiempo. No borrar entradas, solo agregar.

- 19 de noviembre de 2026: creado este documento. Se registra el diagnóstico inicial y se fija prioridad al refactor del frontend como cuello de botella número uno.
- 19 de noviembre de 2026: revisados `vercel-labs/agent-desktop` y `pingdotgg/t3code` clonados en `~/development/repos-ideas/`. Se agregó la sección 11.5 con hallazgos concretos. Cambios de criterio derivados: MCP se deriva del registro de herramientas existente y no se escribe aparte; el HITL binario se sustituye por una escalera de autonomía con techo; los tests se co-localizan por módulo; el paquete de evals queda fuera de CI. Se documentó también lo que se descartó (Electron, Effect, la escala de 34 paquetes) para no reabrir la discusión.

## 14. Decisiones pendientes

- Elegir el stack de estado del front antes de iniciar el refactor, para no hacerlo dos veces.
- Decidir si la recuperación semántica vive en Python o en Rust, y con qué almacén embebido.
- Definir si el monorepo se formaliza con un workspace completo o con un paquete de contratos compartidos más tareas de build.
- Definir el alcance inicial de MCP: si empezamos como consumidor, como servidor para desarrolladores, o ambos por separado.
- Acordar el modelo de riesgo de herramientas antes de conectar el primer servidor externo.
