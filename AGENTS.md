# Reglas del Proyecto XOOK

## 1. Higiene y Peso del Workspace (Obligatorio)
- Mantén `src-tauri/Cargo.toml` con `[profile.dev]` ligero (`debug = "line-tables-only"`, `split-debuginfo = "unpacked"`) y `[profile.dev.package."*"]` con `debug = 0` para evitar que `src-tauri/target/debug/` vuelva a inflarse con gigabytes de símbolos DWARF.
- No restaures `staticlib` ni `cdylib` en `crate-type` de `src-tauri/Cargo.toml` salvo que se agregue explícitamente soporte móvil (iOS/Android); el target desktop solo requiere `["rlib"]`.
- Al terminar ciclos largos de compilación, cambios de dependencias en `Cargo.toml`, o si `src-tauri/target/` supera **3 GB**, ejecuta `npm run clean:workspace -- --auto` (o `npm run clean:rust` / `npm run clean:all` para limpieza total).
- Nunca subas ni dejes en el repositorio artefactos temporales, `.dmg`/`.app`, archivos `.DS_Store`, `__pycache__`, ni capturas de pantalla crudas.

## 2. Política de Dependencias y Privacidad (Alineada a `ARCHITECTURE.md`)
- Cualquier librería o herramienta open source nueva debe tener licencia permisiva (**MIT, Apache-2.0 o BSD**). Evita dependencias copyleft o licencias source-available/comerciales.
- Prioriza capacidades nativas ligeras del sistema antes de agregar runtimes pesados de ML/Python.
- Para la lectura de pantalla en tiempo real y la memoria del agente:
  - **Cero persistencia de screenshots crudos en disco** por defecto; conserva solo texto/contexto deduplicado e indexado en SQLite (`.xook/xook.db`) y frames temporales únicamente en memoria RAM cuando se envíen a un modelo multimodal.
  - Excluye la ventana de la `QuickBar` (`quick`) y protege campos/apps sensibles antes de capturar o indexar contexto visual.

## 3. Referencias Externas (`referencias/`)

- Los proyectos open source de consulta viven clonados en `referencias/` y **no son dependencias**: no se importan, no se compilan, no se despliegan. Se leen.
- **Antes de diseñar algo que ya existe resuelto en la industria**, consulta `referencias/README.md` (índice versionado) y lee el código real del clone. No te quedes con el resumen.
- Los clones están en `.gitignore`; solo el índice `referencias/README.md` se versiona. Nunca hagas `git add` de los clones ni los agregues a `package.json` / `Cargo.toml`.
- Al incorporar código literal, respeta la licencia y deja nota del origen.

Referencias activas:

| Repo | Licencia | Aporta |
|---|---|---|
| https://github.com/vercel-labs/agent-desktop | Apache-2.0 | Lectura por árbol de accesibilidad, `command_policy` exhaustivo, catálogo MCP derivado |
| https://github.com/pingdotgg/t3code | MIT | Escalera de autonomía, `locked` en políticas, paquete de contratos, `evals` |

## 4. Diseño de interfaz

XOOK lo usan personas que no saben qué es un agente. Cada pantalla debe decir qué hacer sin que nadie la explique.

**Color y superficies**
- Nada de degradados ni de fondos con tinte de color translúcido (por ejemplo, ámbar al 5 % sobre negro). Superficies sólidas en grises.
- Para resaltar algo, invierte (fondo claro, texto oscuro) en lugar de teñirlo.
- Un solo color de acento, plano, y solo en la parte de un ícono que indica la acción.
- Texto con contraste de al menos 4.5:1 sobre su fondo. Sobre el negro de la app, el gris más oscuro para texto es `zinc-400`; `zinc-500` solo para íconos o bordes.

**Qué va dónde**
- Lo frecuente primero. El lateral sirve para conversar: nuevo chat, buscador, proyecto y recientes. La configuración vive en páginas aparte, no en formularios abiertos en el lateral.
- Un dato, un lugar. No repitas el nombre del proyecto ni el de Xox, ni el mismo ajuste, en dos sitios.
- Una palabra, un significado. Si "Proveedores" son los modelos de IA, los del negocio necesitan otro nombre en pantalla.
- Los avisos aparecen solo cuando hace falta actuar (por ejemplo, "Esta conversación ya es larga") y dicen qué hacer con un botón.

**Lenguaje**
- Sin jerga en pantalla: nada de "API", "tokens", "1M in", "RPM", "contexto", "compactar" ni "skills" en los textos principales. Di lo que significa para la persona ("$0.82 de saldo", "Resumir y seguir").
- El detalle técnico va en el `title` o en Ajustes.
- Nada de texto cortado en elementos principales. Si no cabe, reescríbelo más corto o muévelo.

**Íconos**
- Línea fina (`stroke-width` 1.6) en gris claro. La parte que se mueve es la acción: el + que late en "Nuevo chat", las líneas que se juntan en "Resumir".
- Se animan al pasar el mouse o con foco, o siempre en un aviso que pide actuar. Nunca en bucle sin motivo. Respeta `prefers-reduced-motion`.
- Un ícono sin texto lleva `aria-label` y `title`. Nada de puntos de color sin explicación.
- Carpetas: estilo Finder pero más redondeadas, en colores planos de dos tonos (`FolderGlyph`).
- Los íconos reutilizables viven en `src-ui/features/sidebar/guideIcons.tsx` y `FolderGlyph.tsx`.

**Edición**
- Se guarda solo; evita los botones de "Guardar cambios".
- Elegir antes que escribir: opciones que se tocan (chips) en vez de selects o campos con valores técnicos.
- Reglas e instrucciones como frases cortas con su etiqueta (Siempre, Nunca, Prefiero), con ejemplos en los textos de ayuda.
- Ofrece también la vía de conversación: "Para que recuerde algo, díselo en el chat".

**Código**
- Cada componente nuevo va en su propio archivo bajo `src-ui/features/<área>/`. En `App.tsx` solo entra la línea que lo integra.
- Botones reales (`<button>`, `<a>`), nunca `div` con `onClick`. Objetivos de clic de al menos 32 px en escritorio.
- El prototipo de referencia del lateral y la página del proyecto está en https://claude.ai/artifact/TUuQaVjuLkL9M3iu5LFR9s (privado del dueño del repo).