<p align="center">
  <img src=".github/xox-pixel.svg" width="164" alt="Xox — Mascota pixel art de XOOK" />
</p>

# XOOK — Agente personal proactivo
> **Significado:** del maya *Xook* (leer, contar, estudiar / tiburón).
> **Concepto:** un agente de escritorio que vive en el equipo del usuario, aprende cómo trabaja y actúa antes de que se lo pidan, siempre dentro de los límites que el usuario controla. Primero para una persona; después, para equipos y organizaciones.

---

## 1. Principios

1. **Local primero.** La memoria, el contexto de pantalla y los archivos se quedan en el equipo. Ningún screenshot crudo se guarda en disco.
2. **Cualquier proveedor de IA.** OpenRouter, DeepSeek, Groq, Gemini, OpenAI, Anthropic o modelos locales. La inteligencia (memoria, herramientas, políticas, proactividad) vive en XOOK; el modelo es una pieza intercambiable.
3. **Escalera de autonomía.** Observar → sugerir → preparar → ejecutar con aviso → ejecutar en silencio. Lo destructivo, lo que cuesta dinero y lo que sale del equipo nunca pasa de "preparar": el usuario ve el antes/después y aprueba.
4. **Vertical slices.** El código se organiza por capacidad de punta a punta (UI → Rust → Python), no por capas técnicas.
5. **Sin jerga para el usuario.** MCP, embeddings, sidecar o tokens nunca aparecen en la interfaz.

## 2. Stack

| Capa | Tecnología | Rol |
|---|---|---|
| Shell de escritorio | Tauri v2 | Ventanas (`main`, `quick`, `document`), bandeja, atajos globales |
| Interfaz | React 19 + TypeScript + Tailwind 4 | Chat, canvas, Xox Studio, tarjetas de aprobación |
| Núcleo y guardián | Rust (`tokio`, `rusqlite`, `notify`, `objc2`) | Bóveda de claves, política de comandos, control del escritorio por accesibilidad, scheduler, contexto de pantalla |
| Cerebro | Python (sidecar por stdio, sin frameworks de LLM) | Loop del agente, proveedores de IA, herramientas, memoria, motor de documentos |
| Contratos | `packages/contracts` (TypeScript) | Tipos compartidos entre las tres capas |

## 3. Comandos

```bash
npm run tauri dev          # app en modo desarrollo
npm run typecheck          # tipos de la UI y de los paquetes
npm run test:packages      # tests de packages/
npm run test:brain         # tests del sidecar de Python
npm run clean:all          # limpieza total de artefactos
```

## 4. Dónde está cada cosa

- [ARCHITECTURE.md](ARCHITECTURE.md): mapa de directorios y responsabilidades.
- [AGENTS.md](AGENTS.md): reglas obligatorias del repo (peso del workspace, dependencias, privacidad, referencias).
- [claude/ROADMAP.md](claude/ROADMAP.md): fases del producto y criterios de salida.
- [claude/DECISIONES.md](claude/DECISIONES.md): decisiones tomadas y lo que se descartó.
