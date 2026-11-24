import React, { useEffect, useId, useMemo, useRef } from "react";
import {
  SUBAGENT_GLASS_PALETTE,
  SUBAGENT_SHAPE_GEOMETRY,
  type SubagentDesign,
} from "../features/ai-service/agentModeTypes";

export type XoxState =
  | "idle"
  | "thinking"
  | "success"
  | "talking"
  | "alert"
  | "reading"
  | "syncing"
  | "coding";

/** Actividad de código/terminal que Xox muestra en la pantalla de su laptop. */
export interface XoxTerminalFeed {
  /** Incrementar en cada evento para que Xox reaccione aunque el contenido se repita. */
  seq: number;
  mode: "edit" | "terminal";
  status: "running" | "ok" | "error";
  command?: string;
  outputLines?: string[];
}

export interface XoxDragMotion {
  active: boolean;
  vx: number;
  vy: number;
  releaseVx: number;
  releaseVy: number;
}

export type XoxAccentPreset = "classic" | "violet" | "emerald" | "amber" | "rose";

export interface XoxAccentSpec {
  label: string;
  mid: string;
  rim: string;
  /** Borde secundario análogo (~18°–22° en OKLCH) para refracción de vidrio armónica. */
  rim2: string;
  tint: string;
  /** Tono inferior del cuerpo translúcido (si se omite, hereda `glow`). Permite degradados bicolores como el aura del input. */
  bodyLower?: string;
  glow: string;
  /** Tono profundo en la misma familia para el núcleo en `thinking`. */
  deep: string;
  /** Tono cromático equilibrado para el núcleo en reposo (evita blanco puro detrás de los ojos). */
  idleCore: string;
  /** Acento secundario armónico para anillos, chispas y sincronización. */
  accessory: string;
  /** Acento brillante de la familia (sombra interna de la boca al hablar). */
  pupil: string;
  /** Tono de pupila/iris calibrado para mantener expresión nítida sobre esclerótica blanca. */
  eye: string;
  /** Aura y tono medio al celebrar (`success`), manteniendo armonía sin choques. */
  celebrateMid: string;
  celebrateGlow: string;
  /** Rubor orgánico en mejillas calibrado en OKLCH para no ensuciarse sobre cada base. */
  blush: string;
  blushCore: string;
}

export const XOX_ACCENT_PRESETS: Record<XoxAccentPreset, XoxAccentSpec> = {
  // Identidad principal XOOK: aurora bicolor del input del chat (lavanda-violeta arriba-izq → azul zafiro/pizarra abajo-der)
  classic: {
    label: "Estelar",
    mid: "#9488F0",
    rim: "#B09EF8",
    rim2: "#729CE0",
    tint: "#A48EF4",
    bodyLower: "#5C84CC",
    glow: "#846CE8",
    deep: "#4E7EB0",
    idleCore: "#646ED6",
    accessory: "#7C96FF",
    pupil: "#846CE8",
    eye: "#90AAFF",
    celebrateMid: "#C4BAFC",
    celebrateGlow: "#8B9CFF",
    blush: "#C4B5FD",
    blushCore: "#EDE9FE",
  },
  violet: {
    label: "Violeta",
    mid: "#C4B5FD",
    rim: "#DDD6FE",
    rim2: "#D8B4FE",
    tint: "#EDE9FE",
    bodyLower: "#8B6FE8",
    glow: "#A78BFA",
    deep: "#7E6CDA",
    idleCore: "#7569CE",
    accessory: "#EAB7FF",
    pupil: "#C084FC",
    eye: "#90AAFF",
    celebrateMid: "#E9D5FF",
    celebrateGlow: "#D29BFF",
    blush: "#E9D5FF",
    blushCore: "#FAF5FF",
  },
  emerald: {
    label: "Esmeralda",
    mid: "#6EE7B7",
    rim: "#A7F3D0",
    rim2: "#80DFCD",
    tint: "#D1FAE5",
    bodyLower: "#149E88",
    glow: "#34D399",
    deep: "#08B16F",
    idleCore: "#09976A",
    accessory: "#70E6CB",
    pupil: "#34D399",
    eye: "#7DD3FC",
    celebrateMid: "#A7F3D0",
    celebrateGlow: "#38D6B2",
    blush: "#99F6E4",
    blushCore: "#CCFBF1",
  },
  amber: {
    label: "Ámbar",
    mid: "#FCD34D",
    rim: "#FDE68A",
    rim2: "#F9BC8B",
    tint: "#FEF3C7",
    bodyLower: "#D97724",
    glow: "#FBBF24",
    deep: "#C98508",
    idleCore: "#B5720D",
    accessory: "#E6CD72",
    pupil: "#F59E0B",
    eye: "#7DD3FC",
    celebrateMid: "#FEF08A",
    celebrateGlow: "#FBBF24",
    blush: "#FDBA74",
    blushCore: "#FFEDD5",
  },
  rose: {
    label: "Coral",
    mid: "#FDA4AF",
    rim: "#FECDD3",
    rim2: "#FAB1D5",
    tint: "#FFE4E6",
    bodyLower: "#E05A8A",
    glow: "#FB7185",
    deep: "#D94D72",
    idleCore: "#C14E66",
    accessory: "#FFBAAE",
    pupil: "#FB7185",
    eye: "#7DD3FC",
    celebrateMid: "#FECDD3",
    celebrateGlow: "#FB8498",
    blush: "#FECDD3",
    blushCore: "#FFF1F2",
  },
};

export function resolveXoxAccentPreset(raw?: string | null): XoxAccentPreset {
  const clean = (raw || "").trim().toLowerCase();
  return clean in XOX_ACCENT_PRESETS ? (clean as XoxAccentPreset) : "classic";
}

function hexAlphaRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return `rgba(186, 230, 253, ${alpha})`;
  const n = parseInt(clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Variables CSS para que la burbuja Liquid Glass armonice con el aura elegida de Xox. */
export function getXoxBubbleVars(accentPreset?: string | null): React.CSSProperties {
  const spec = XOX_ACCENT_PRESETS[resolveXoxAccentPreset(accentPreset)];
  return {
    "--xox-bubble-tint": hexAlphaRgba(spec.accessory, 0.16),
    "--xox-bubble-rim": hexAlphaRgba(spec.rim, 0.14),
    "--xox-bubble-glow": hexAlphaRgba(spec.glow, 0.28),
    "--xox-bubble-edge": hexAlphaRgba(spec.mid, 0.36),
  } as React.CSSProperties;
}

/**
 * Variables CSS semánticas para el fondo cósmico estilo Gemini (tanto cuando está Xox
 * como cuando no está). En el preset predeterminado (`classic` / Estelar) conserva
 * intacto el azul cobalto/índigo profundo de Gemini; en otros presets mezcla en `oklab`.
 */
export function getXoxCosmosVars(accentPreset?: string | null): React.CSSProperties {
  const preset = resolveXoxAccentPreset(accentPreset);
  const spec = XOX_ACCENT_PRESETS[preset];
  if (preset === "classic") {
    return {
      "--xox-cosmos-bloom": "var(--ref-gemini-bloom-core)",
      "--xox-cosmos-bloom-warm": "var(--ref-gemini-bloom-warm)",
      "--xox-cosmos-corona": "var(--ref-gemini-corona)",
      "--xox-cosmos-halo": "var(--ref-gemini-halo)",
      "--xox-cosmos-whisper": spec.glow,
      "--xox-input-accent": spec.glow,
      "--xox-input-rim": spec.rim,
      "--xox-input-mid": spec.mid,
      "--xox-cosmos-border": "color-mix(in oklab, var(--ref-gemini-bloom-core) 58%, rgba(255, 255, 255, 0.16))",
    } as React.CSSProperties;
  }
  return {
    "--xox-cosmos-bloom": `color-mix(in oklab, var(--ref-gemini-bloom-core) 64%, ${spec.deep})`,
    "--xox-cosmos-bloom-warm": `color-mix(in oklab, var(--ref-gemini-bloom-warm) 60%, ${spec.glow})`,
    "--xox-cosmos-corona": `color-mix(in oklab, var(--ref-gemini-corona) 68%, ${spec.deep})`,
    "--xox-cosmos-halo": `color-mix(in oklab, var(--ref-gemini-halo) 74%, ${spec.deep})`,
    "--xox-cosmos-whisper": spec.glow,
    "--xox-input-accent": spec.glow,
    "--xox-input-rim": spec.rim,
    "--xox-input-mid": spec.mid,
    "--xox-cosmos-border": `color-mix(in oklab, ${spec.glow} 38%, rgba(255, 255, 255, 0.14))`,
  } as React.CSSProperties;
}

export interface XoxSubagentOrbitItem {
  id: string;
  name: string;
  design?: "star" | "prism" | "orbit" | "shield";
  status: "pending" | "running" | "done" | "error";
}

interface XoxStarProps {
  state?: XoxState;
  /** Tamaño total del lienzo (incluye el aura). La estrella ocupa ~55%. */
  size?: number;
  /** Si es true, toma su tamaño de las clases CSS (ej. utilidades @container / responsive). */
  responsive?: boolean;
  className?: string;
  onClick?: () => void;
  /** Incrementar para disparar el salto y destello estelar de aparición. */
  summonTrigger?: number;
  /** Telemetría opcional de arrastre para que Xox reaccione físicamente al mover la barra. */
  dragMotionRef?: React.RefObject<XoxDragMotion | null>;
  /** Refuerza silueta y cuerpo sobre fondos líquidos o transparentes (ej. Quick Bar). */
  glassContrast?: boolean;
  /** Pausa el bucle de animación y listeners cuando la ventana está oculta para ahorrar RAM/CPU. */
  active?: boolean;
  /** "star" limita hover/clic estrictamente al cuerpo de la estrella sin capturar márgenes transparentes. */
  hitArea?: "full" | "star";
  /** Color visual de aura de Xox en reposo/habla. */
  accentPreset?: XoxAccentPreset | string;
  /** Incrementar para disparar un impulso físico de deslizamiento lateral. */
  glideTrigger?: number;
  /** Dirección del impulso lateral ("right" = se desliza hacia la derecha, "left" = hacia la izquierda). */
  glideDir?: "right" | "left";
  /** Satélites orbitales opcionales representando sub-agentes trabajando con Xox. */
  subagents?: XoxSubagentOrbitItem[];
  /** Edición de código / respuesta de terminal que Xox revisa en su laptop (estado `coding`). */
  terminal?: XoxTerminalFeed | null;
  /** "greet" hace un saltito alegre + saludo con la punta en lugar del giro 360° (ideal cuando Xox habla al clic). */
  clickBehavior?: "spin" | "greet";
}

/**
 * Xox — Mascota digital de XOOK.
 *
 * Estrella de 5 picos redondeados con cuerpo translúcido. Toda la animación es
 * procedural (requestAnimationFrame + resortes) y se aplica sobre atributos SVG:
 * NO usa filtros CSS, backdrop-filter ni transformaciones 3D CSS, que en WebKit
 * (Tauri/macOS) generan capas de GPU opacas => "recuadro negro".
 *
 * Principios de animación aplicados:
 *  - Anticipación + overshoot en el giro (wind-up antes de la pirueta).
 *  - Squash & stretch en saltos y aterrizajes (preservando volumen).
 *  - Follow-through: las puntas se arrastran detrás del giro (cuerpo "gelatina").
 *  - Acción secundaria: respiración, ondulación de picos, chispas en órbita,
 *    parpadeo irregular, miradas aleatorias y saludo con un brazo.
 *  - Falso 3D: al mirar a los lados el cuerpo se comprime y la cara se desplaza.
 */

const C = 120; // centro del viewBox 240x240
const XOX_SVG_REV = "lg8"; // garantiza recarga limpia de <defs>/<clipPath> en WebKit SVGResourcesCache

// Continuidad de fase compartida (Chat <-> Vuelo <-> Espacio de Xox) para que ni Xox ni sus partículas salten al relevo
const sharedXoxPhase = {
  t: 0,
  starPhase: 0,
  sparkPhase: 0,
  updatedAt: 0,
};

function syncSharedPhase(a: { t: number; starPhase: number; sparkPhase: number }) {
  if (sharedXoxPhase.updatedAt <= 0) return;
  const elapsed = Math.min(Math.max(0, (performance.now() - sharedXoxPhase.updatedAt) / 1000), 0.25);
  const nextT = sharedXoxPhase.t + elapsed;
  if (nextT > a.t) {
    a.t = nextT;
    a.starPhase = sharedXoxPhase.starPhase + elapsed;
    a.sparkPhase = sharedXoxPhase.sparkPhase + elapsed;
  }
}

// Geometría base ligeramente asimétrica (ángulo en grados, radio)
const PEAKS = [
  { a: -84, r: 65 },
  { a: -12, r: 63 },
  { a: 60, r: 58 },
  { a: 124, r: 59 },
  { a: 198, r: 64 },
];
const VALLEYS = [
  { a: -48, r: 34 },
  { a: 24, r: 33 },
  { a: 92, r: 36 },
  { a: 161, r: 33 },
  { a: 236, r: 34 },
];
const PEAK_ROUND = 17.6;
const VALLEY_ROUND = 15.2;

export interface XoxResolvedColors {
  bodyTint: string;
  bodyGlow: string;
  rim1: string;
  rim2: string;
  core: string;
  mid: string;
  glow: string;
  pupil: string;
  eye: string;
  accessory: string;
  blush: string;
  blushCore: string;
}

/**
 * Resuelve la paleta completa de Xox combinando el aura elegida y el estado actual
 * sin mezclar matices opuestos (p. ej. verde sobre azul/violeta en `success`).
 * `alert` conserva el rojo semántico intacto.
 */
export function resolveXoxStateColors(
  accent: XoxAccentPreset | string | undefined,
  state: XoxState
): XoxResolvedColors {
  const spec = XOX_ACCENT_PRESETS[resolveXoxAccentPreset(accent)];
  if (state === "alert") {
    return {
      bodyTint: "#FEE2E2",
      bodyGlow: "#EF4444",
      rim1: "#FECACA",
      rim2: "#F87171",
      core: "#EF4444",
      mid: "#B91C1C",
      glow: "#EF4444",
      pupil: "#FCA5A5",
      eye: "#FBD5D5",
      accessory: "#F87171",
      blush: spec.blush,
      blushCore: spec.blushCore,
    };
  }
  if (state === "thinking") {
    return {
      bodyTint: spec.tint,
      bodyGlow: spec.bodyLower ?? spec.glow,
      rim1: spec.rim,
      rim2: spec.rim2,
      core: spec.glow,
      mid: spec.deep,
      glow: spec.glow,
      pupil: spec.pupil,
      eye: spec.eye,
      accessory: spec.accessory,
      blush: spec.blush,
      blushCore: spec.blushCore,
    };
  }
  if (state === "success") {
    return {
      bodyTint: spec.tint,
      bodyGlow: spec.celebrateGlow,
      rim1: spec.rim,
      rim2: spec.accessory,
      core: spec.celebrateGlow,
      mid: spec.deep,
      glow: spec.celebrateGlow,
      pupil: spec.pupil,
      eye: spec.eye,
      accessory: spec.accessory,
      blush: spec.blush,
      blushCore: spec.blushCore,
    };
  }
  if (state === "syncing" || state === "coding") {
    return {
      bodyTint: spec.tint,
      bodyGlow: spec.bodyLower ?? spec.glow,
      rim1: spec.rim,
      rim2: state === "coding" ? spec.accessory : spec.rim2,
      core: spec.glow,
      mid: spec.deep,
      glow: spec.accessory,
      pupil: spec.pupil,
      eye: spec.eye,
      accessory: spec.accessory,
      blush: spec.blush,
      blushCore: spec.blushCore,
    };
  }
  return {
    bodyTint: spec.tint,
    bodyGlow: spec.bodyLower ?? spec.glow,
    rim1: spec.rim,
    rim2: spec.rim2,
    core: spec.idleCore,
    mid: spec.deep,
    glow: spec.glow,
    pupil: spec.pupil,
    eye: spec.eye,
    accessory: spec.accessory,
    blush: spec.blush,
    blushCore: spec.blushCore,
  };
}

type Spring = { x: number; v: number };
const step = (s: Spring, target: number, k: number, c: number, dt: number) => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const toRad = (d: number) => (d * Math.PI) / 180;

/**
 * Expresiones de enfoque sostenidas ("inspector"). Cada fase mantiene UNA pose firme;
 * el cambio entre poses ocurre oculto detrás de un parpadeo para que nunca se vea un salto.
 * s* = entrecerrado del ojo (negativo = abierto/zoom), p* = escala de pupila,
 * mouth = boca paramétrica (semiancho, altura base, curvatura, inclinación de comisura derecha).
 */
type FocusExpr = "none" | "editL" | "editR" | "run" | "ok" | "err" | "lens";
type FocusPose = {
  sL: number;
  sR: number;
  pL: number;
  pR: number;
  mouth: { w: number; y: number; bend: number; tilt: number; shift: number };
};
const FOCUS_POSES: Record<FocusExpr, FocusPose> = {
  none: { sL: 0, sR: 0, pL: 1, pR: 1, mouth: { w: 2.6, y: 7.2, bend: 0.4, tilt: 0, shift: 0 } },
  // Editando: un ojo entrecerrado analizando y el otro ligeramente abierto (mirada de inspector).
  // La comisura del lado del ojo entrecerrado se eleva un poco: gesto de concentración firme.
  editL: { sL: 0.36, sR: -0.08, pL: 0.9, pR: 1.12, mouth: { w: 2.6, y: 7.2, bend: 0.45, tilt: -0.95, shift: -0.35 } },
  editR: { sL: -0.08, sR: 0.36, pL: 1.12, pR: 0.9, mouth: { w: 2.6, y: 7.2, bend: 0.45, tilt: 0.95, shift: 0.35 } },
  // Terminal ejecutando: ambos ojos atentos, boca pequeña de expectativa.
  run: { sL: 0.1, sR: 0.1, pL: 1.04, pR: 1.04, mouth: { w: 2.0, y: 7.4, bend: -0.8, tilt: 0, shift: 0 } },
  // "¡Ajá!": ojos grandes con pupilas brillantes y sonrisa cálida.
  ok: { sL: -0.16, sR: -0.16, pL: 1.24, pR: 1.24, mouth: { w: 3.8, y: 6.3, bend: 3.9, tilt: 0, shift: 0 } },
  // Error: ojos abiertos con pupilas contraídas y boca invertida.
  err: { sL: -0.12, sR: -0.12, pL: 0.86, pR: 0.86, mouth: { w: 3.0, y: 8.0, bend: -2.4, tilt: 0, shift: 0 } },
  // Lupa: el ojo detrás del cristal se abre grande (curioso) y el otro se entrecierra; boquita de "mmm" del lado libre.
  lens: { sL: 0.34, sR: -0.14, pL: 0.9, pR: 1.2, mouth: { w: 2.0, y: 7.4, bend: 0.5, tilt: -0.7, shift: -1.6 } },
};
// Pose de lupa recalculada cada frame según el ojo que queda bajo el cristal
const LIVE_LENS_POSE: FocusPose = { ...FOCUS_POSES.lens, mouth: { ...FOCUS_POSES.lens.mouth } };
// Aumento de la lupa (estado `reading`) y radio del cristal en unidades del viewBox
const LENS_MAG = 1.6;
const LENS_R = 10;
// Anillo de sincronización: radio, aplanado de perspectiva e inclinación (grados)
const SYNC_R = 92;
const SYNC_FLAT = 0.34;
const SYNC_TILT = -14;
// Barrido de la lupa de un ojo al otro (segundos por ida y vuelta)
const LENS_SCAN_PERIOD = 2.8;
// Frase completa del festejo ("happy"): anticipación → gran salto alegre → rebote asimétrico → bailecito rítmico
const HAPPY_CYCLE = 2.2;
// Destellos del festejo (ángulos en grados, distribuidos orgánicamente alrededor de la gota estelar)
const CHEER_SPARKLES = [-102, -52, -12, 34, 146, 186, 224, 260];
const SPARKLE_PATH = "M 0 -5.2 Q 0.78 -0.78 5.2 0 Q 0.78 0.78 0 5.2 Q -0.78 0.78 -5.2 0 Q -0.78 -0.78 0 -5.2 Z";
// Reflejo especular curvo en media luna inscrito dentro de la cúpula (óptica húmeda de gota sin tocar el borde)
const CRESCENT_SPEC_PATH = "M -9.8 2.4 Q -0.8 -3.5 9.6 1.2 Q 0.4 -0.9 -9.8 2.4 Z";
// Parpadeo natural: cierre rápido, apertura algo más lenta
const BLINK_CLOSE = 0.065;
const BLINK_OPEN = 0.12;
const smooth01 = (e0: number, e1: number, x: number) => {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};

interface HappyChoreoPose {
  /** Desplazamiento vertical en unidades SVG (< 0 sube, > 0 agacha al preparar/aterrizar). */
  jumpY: number;
  /** Velocidad vertical aproximada para inercia/overlap de brazos y carita. */
  jumpVel: number;
  /** Deformación preservando volumen (< 0 squash ancho/bajo, > 0 stretch vertical). */
  deform: number;
  /** Inclinación alegre en grados (con asimetría deliberada entre saltos). */
  tiltDeg: number;
  /** Desplazamiento lateral suave acompañando el arco de cada salto o balanceo. */
  shiftX: number;
  /** Elevación simétrica de las puntas-brazo (0..1.1). */
  armRaise: number;
  /** Asimetría rítmica de brazos (> 0 alza más el derecho, < 0 alza más el izquierdo). */
  armAsym: number;
  /** Apertura alegre de la sonrisa (0.28..0.56). */
  mouthJoy: number;
  /** Elevación expresiva del rostro en el clímax (< 0 mira arriba radiante, > 0 acompaña compresión). */
  faceLift: number;
  /** Fracción del ciclo actual (0..2.2s) para sincronizar destellos escalonados. */
  cycleTime: number;
}

const HAPPY_POSE_OUT: HappyChoreoPose = {
  jumpY: 0,
  jumpVel: 0,
  deform: 0,
  tiltDeg: 0,
  shiftX: 0,
  armRaise: 0,
  armAsym: 0,
  mouthJoy: 0.34,
  faceLift: 0,
  cycleTime: 0,
};

/**
 * Evaluador determinista por fases semánticas (Principios Disney: anticipación con anclaje de pies,
 * stretch de despegue, hang-time flotante en el ápice, aterrizaje gelatinoso, rebote asimétrico y meneo feliz).
 */
function evalHappyChoreo(elapsed: number, reduce: boolean): HappyChoreoPose {
  const out = HAPPY_POSE_OUT;
  if (reduce) {
    out.jumpY = -3.5;
    out.jumpVel = 0;
    out.deform = 0;
    out.tiltDeg = 2.2;
    out.shiftX = 0;
    out.armRaise = 0.86;
    out.armAsym = 0;
    out.mouthJoy = 0.38;
    out.faceLift = -1.2;
    out.cycleTime = 0;
    return out;
  }

  const u = ((elapsed % HAPPY_CYCLE) + HAPPY_CYCLE) % HAPPY_CYCLE;
  out.cycleTime = u;

  if (u < 0.13) {
    // Fase 1: Anticipación — se agacha blandito tomando impulso antes de saltar
    const p = u / 0.13;
    const e = Math.sin(p * Math.PI * 0.5);
    out.jumpY = 4.2 * e;
    out.jumpVel = 32 * Math.cos(p * Math.PI * 0.5);
    out.deform = -0.135 * e;
    out.tiltDeg = -2.4 * e;
    out.shiftX = -1.1 * e;
    out.armRaise = 0.34 * e;
    out.armAsym = 0;
    out.mouthJoy = 0.30 + 0.08 * e;
    out.faceLift = 1.1 * e;
    return out;
  }

  if (u < 0.64) {
    // Fase 2: Gran salto radiante con hang-time flotante en el ápice
    const p = (u - 0.13) / 0.51;
    const apexP = 0.44;
    if (p <= apexP) {
      const q = p / apexP;
      const h = 1 - Math.pow(1 - q, 2.35);
      out.jumpY = lerp(4.2, -23.5, h);
      out.jumpVel = -145 * Math.pow(1 - q, 1.35);
    } else {
      const q = (p - apexP) / (1 - apexP);
      const h = Math.pow(q, 2.05);
      out.jumpY = lerp(-23.5, 0, h);
      out.jumpVel = 135 * q;
    }
    const launchStretch = Math.sin(clamp(p / 0.34, 0, 1) * Math.PI) * 0.125;
    const crouchRelease = (1 - smooth01(0, 0.14, p)) * -0.135;
    const preLandStretch = smooth01(0.76, 1.0, p) * 0.055;
    out.deform = crouchRelease + launchStretch + preLandStretch;
    const arc = Math.sin(p * Math.PI);
    out.tiltDeg = lerp(-2.4, 0, smooth01(0, 0.18, p)) + 7.2 * arc;
    out.shiftX = lerp(-1.1, 0, smooth01(0, 0.18, p)) + 3.1 * arc;
    out.armRaise = lerp(0.34, 1.05, smooth01(0.02, 0.36, p)) - 0.08 * smooth01(0.75, 1.0, p);
    out.armAsym = 0.28 * arc;
    out.mouthJoy = 0.36 + 0.18 * arc;
    out.faceLift = -2.6 * arc;
    return out;
  }

  if (u < 0.76) {
    // Fase 3a: Aterrizaje acolchado de gota líquida
    const p = (u - 0.64) / 0.12;
    const c = Math.sin(p * Math.PI);
    out.jumpY = 3.6 * c;
    out.jumpVel = 45 * Math.cos(p * Math.PI);
    out.deform = -0.145 * c;
    out.tiltDeg = lerp(1.6, -1.8, smooth01(0, 1, p));
    out.shiftX = lerp(1.4, -0.6, smooth01(0, 1, p));
    out.armRaise = 0.94 - 0.18 * c;
    out.armAsym = 0;
    out.mouthJoy = 0.38;
    out.faceLift = 1.3 * c;
    return out;
  }

  if (u < 1.12) {
    // Fase 3b: Segundo saltito juguetón inclinado al lado opuesto (asimetría viva)
    const p = (u - 0.76) / 0.36;
    const apexP = 0.46;
    if (p <= apexP) {
      const q = p / apexP;
      out.jumpY = -13.2 * (1 - Math.pow(1 - q, 2.2));
      out.jumpVel = -92 * Math.pow(1 - q, 1.2);
    } else {
      const q = (p - apexP) / (1 - apexP);
      out.jumpY = -13.2 * (1 - Math.pow(q, 2.0));
      out.jumpVel = 88 * q;
    }
    const arc = Math.sin(p * Math.PI);
    out.deform = 0.075 * Math.sin(clamp(p / 0.4, 0, 1) * Math.PI) + 0.035 * smooth01(0.78, 1.0, p);
    out.tiltDeg = -6.2 * arc;
    out.shiftX = -2.8 * arc;
    out.armRaise = 0.96 + 0.06 * arc;
    out.armAsym = -0.34 * arc;
    out.mouthJoy = 0.35 + 0.13 * arc;
    out.faceLift = -1.8 * arc;
    return out;
  }

  if (u < 1.26) {
    // Fase 3c: Asentamiento suave antes del bailecito
    const p = (u - 1.12) / 0.14;
    const c = Math.sin(p * Math.PI);
    out.jumpY = 2.2 * c;
    out.jumpVel = 24 * Math.cos(p * Math.PI);
    out.deform = -0.085 * c;
    out.tiltDeg = 0;
    out.shiftX = 0;
    out.armRaise = lerp(0.92, 0.80, smooth01(0, 1, p));
    out.armAsym = 0;
    out.mouthJoy = 0.34;
    out.faceLift = 0.8 * c;
    return out;
  }

  // Fase 4: Meneo alegre rítmico ("¡yei, yei!") con brazos alternados sin deformación de paralelogramo
  const p = (u - 1.26) / (HAPPY_CYCLE - 1.26);
  const env = smooth01(0, 0.15, p) * (1 - smooth01(0.85, 1.0, p));
  const th = p * Math.PI * 2;
  const sinTh = Math.sin(th);
  const absSin = Math.abs(sinTh);
  out.jumpY = -3.8 * absSin * env;
  out.jumpVel = -26 * Math.sin(th * 2) * env;
  out.deform = -0.045 * Math.cos(th * 2) * env;
  out.tiltDeg = 5.6 * sinTh * env;
  out.shiftX = 2.5 * sinTh * env;
  out.armRaise = lerp(0.80, 0.0, smooth01(0.86, 1.0, p)) + 0.13 * absSin * env;
  out.armAsym = 0.56 * sinTh * env;
  out.mouthJoy = 0.32 + 0.09 * absSin * env;
  out.faceLift = -1.15 * absSin * env;
  return out;
}

type OklabTriple = [number, number, number];
const srgbChannelToLin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const linToSrgbByte = (x: number): number => {
  const cl = clamp(x, 0, 1);
  const s = cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055;
  return Math.round(clamp(s * 255, 0, 255));
};
function hexToOklab(hex: string): OklabTriple {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return [1, 0, 0];
  const n = parseInt(clean, 16);
  if (!Number.isFinite(n)) return [1, 0, 0];
  const r = srgbChannelToLin((n >> 16) & 255);
  const g = srgbChannelToLin((n >> 8) & 255);
  const b = srgbChannelToLin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToRgbCss(lab: OklabTriple): string {
  const [L, a, b] = lab;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = linToSrgbByte(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linToSrgbByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = linToSrgbByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return `rgb(${r},${g},${bl})`;
}
/** Interpolación perceptual en OKLab para transiciones vívidas sin medios tonos grisáceos. */
function stepOklab(cur: OklabTriple, target: OklabTriple, alpha: number): string {
  cur[0] += (target[0] - cur[0]) * alpha;
  cur[1] += (target[1] - cur[1]) * alpha;
  cur[2] += (target[2] - cur[2]) * alpha;
  return oklabToRgbCss(cur);
}

type ColorSlotKey = keyof XoxResolvedColors;
type OklabColorMap = Record<ColorSlotKey, OklabTriple>;
function toOklabColorMap(colors: XoxResolvedColors): OklabColorMap {
  return {
    bodyTint: hexToOklab(colors.bodyTint),
    bodyGlow: hexToOklab(colors.bodyGlow),
    rim1: hexToOklab(colors.rim1),
    rim2: hexToOklab(colors.rim2),
    core: hexToOklab(colors.core),
    mid: hexToOklab(colors.mid),
    glow: hexToOklab(colors.glow),
    pupil: hexToOklab(colors.pupil),
    eye: hexToOklab(colors.eye),
    accessory: hexToOklab(colors.accessory),
    blush: hexToOklab(colors.blush),
    blushCore: hexToOklab(colors.blushCore),
  };
}

const STAR_PTS: number[][] = Array.from({ length: 10 }, () => [0, 0]);
const STAR_RADII: number[] = new Array(10).fill(PEAK_ROUND);
const PATH_SEGMENTS: string[] = new Array(11);
const PEAK_APEXES: [number, number][] = Array.from({ length: 5 }, () => [C, C]);

/** Polígono con esquinas redondeadas (curvas cuadráticas en cada vértice sin reasignar buffers). */
function roundedPath(pts: number[][], radii: number[]): string {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1x = p1[0] - p0[0];
    const d1y = p1[1] - p0[1];
    const l1 = Math.hypot(d1x, d1y);
    const d2x = p2[0] - p1[0];
    const d2y = p2[1] - p1[1];
    const l2 = Math.hypot(d2x, d2y);
    const r = Math.min(radii[i], l1 * 0.475, l2 * 0.475);
    const ax = p1[0] - (d1x / l1) * r;
    const ay = p1[1] - (d1y / l1) * r;
    const bx = p1[0] + (d2x / l2) * r;
    const by = p1[1] + (d2y / l2) * r;
    if ((i & 1) === 0) {
      const idx = i >> 1;
      PEAK_APEXES[idx][0] = 0.25 * ax + 0.5 * p1[0] + 0.25 * bx;
      PEAK_APEXES[idx][1] = 0.25 * ay + 0.5 * p1[1] + 0.25 * by;
    }
    PATH_SEGMENTS[i] = `${i === 0 ? "M" : "L"}${ax.toFixed(2)} ${ay.toFixed(2)}Q${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
  }
  PATH_SEGMENTS[n] = "Z";
  return PATH_SEGMENTS.join("");
}

interface ShapeParams {
  /** Fase acumulada (dt * velocidad): cambiar de velocidad no provoca saltos de forma. */
  phase: number;
  amp: number;
  lag: number; // grados que las puntas se arrastran tras el giro
  reach: number; // estiramiento extra de las puntas (hover)
  wave: number; // fase del saludo (-1 = sin saludo)
  cheer?: number; // 0..1 festejo: las puntas laterales superiores se alzan como brazos
  armFlap?: number; // grados extra de los brazos por inercia del salto (+ = flotan arriba al caer)
  armAsym?: number; // asimetría rítmica entre brazo derecho e izquierdo al festejar
  airborne?: number; // 0..1 en el aire: las patitas apuntan suavemente hacia abajo
}

// Giro de cada punta (grados) en el frame actual; los valles vecinos acompañan a la mitad
const PEAK_TURN: number[] = [0, 0, 0, 0, 0];

function buildStar({
  phase,
  amp,
  lag,
  reach,
  wave,
  cheer = 0,
  armFlap = 0,
  armAsym = 0,
  airborne = 0,
}: ShapeParams): string {
  // Festejo "¡yei!": las puntas 1 (derecha) y 4 (izquierda) se alzan con inercia orgánica;
  // en el aire las patitas 2 y 3 apuntan ligeramente hacia abajo con ligereza flotante
  PEAK_TURN[0] = -2.2 * armAsym * cheer;
  PEAK_TURN[1] = -(19.5 * cheer + 7.5 * armAsym + armFlap * cheer);
  PEAK_TURN[2] = 6.2 * airborne * cheer;
  PEAK_TURN[3] = -6.2 * airborne * cheer;
  PEAK_TURN[4] = 19.5 * cheer - 7.5 * armAsym + armFlap * cheer;
  for (let i = 0; i < 5; i++) {
    let pa = PEAKS[i].a + lag + PEAK_TURN[i] + 2.0 * amp * Math.sin(phase * 1.1 + i * 2.1);
    let pr = PEAKS[i].r * (1 + 0.032 * amp * Math.sin(phase * 1.6 + i * 1.35) + reach);
    if (i === 1 || i === 4) pr *= 1 + 0.055 * cheer;

    // Saludo con la punta superior derecha (sin agregar brazos ni manos)
    if (i === 1 && wave >= 0 && wave < 1.3) {
      const env = Math.sin((wave / 1.3) * Math.PI);
      pa += Math.sin(wave * 13) * 14 * env * amp;
      pr *= 1 + 0.06 * env;
    }

    const pIdx = i * 2;
    STAR_PTS[pIdx][0] = C + pr * Math.cos(toRad(pa));
    STAR_PTS[pIdx][1] = C + pr * Math.sin(toRad(pa));
    STAR_RADII[pIdx] = PEAK_ROUND;

    // El valle i queda entre la punta i y la i+1: acompaña la mitad del giro de ambas (sin pellizcos)
    const va = VALLEYS[i].a + lag * 0.4 + 0.5 * (PEAK_TURN[i] + PEAK_TURN[(i + 1) % 5]);
    const vr = VALLEYS[i].r * (1 + 0.045 * amp * Math.sin(phase * 2 + i * 0.9 + 1));
    const vIdx = pIdx + 1;
    STAR_PTS[vIdx][0] = C + vr * Math.cos(toRad(va));
    STAR_PTS[vIdx][1] = C + vr * Math.sin(toRad(va));
    STAR_RADII[vIdx] = VALLEY_ROUND;
  }
  return roundedPath(STAR_PTS, STAR_RADII);
}

function calcTalkMouthTop(cy: number, openAmt: number, smileLift: number) {
  const yCorner = cy - smileLift * 0.85;
  // Con sonrisa cálida (vocales abiertas o pausa) las comisuras suben; con vocales redondas se arquea en "o"
  const yTopCtrl = cy - 0.95 - openAmt * 0.55 + smileLift * 0.72;
  return { yCorner, yTopCtrl };
}

/** Construye una boca orgánica articulada (labio superior curvado en sonrisa + mandíbula suave). */
function buildOrganicTalkMouthPath(cx: number, cy: number, halfW: number, openAmt: number, smileLift: number): string {
  const xL = (cx - halfW).toFixed(2);
  const xR = (cx + halfW).toFixed(2);
  const { yCorner, yTopCtrl } = calcTalkMouthTop(cy, openAmt, smileLift);
  const yBotCtrl = (cy + 1.55 + openAmt * 6.2).toFixed(2);
  const xCtrl = (halfW * 0.7).toFixed(2);
  const xLCtrl = (cx - Number(xCtrl)).toFixed(2);
  const xRCtrl = (cx + Number(xCtrl)).toFixed(2);
  return `M ${xL} ${yCorner.toFixed(2)} Q ${cx.toFixed(2)} ${yTopCtrl.toFixed(2)} ${xR} ${yCorner.toFixed(2)} C ${xRCtrl} ${yBotCtrl} ${xLCtrl} ${yBotCtrl} ${xL} ${yCorner.toFixed(2)} Z`;
}

export const XoxStar: React.FC<XoxStarProps> = ({
  state = "idle",
  size = 150,
  responsive = false,
  className = "",
  onClick,
  summonTrigger,
  dragMotionRef,
  glassContrast = false,
  active = true,
  hitArea = "full",
  accentPreset = "classic",
  glideTrigger,
  glideDir = "right",
  subagents,
  terminal,
  clickBehavior = "spin",
}) => {
  const uid = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-${XOX_SVG_REV}`;
  const ids = {
    body: `xox-body-${uid}`,
    bodyClip: `xox-body-clip-${uid}`,
    rim: `xox-rim-${uid}`,
    meniscus: `xox-meniscus-${uid}`,
    refractCrease: `xox-refract-crease-${uid}`,
    bevel: `xox-bevel-${uid}`,
    bounce: `xox-bounce-${uid}`,
    liquidA: `xox-liq-a-${uid}`,
    liquidB: `xox-liq-b-${uid}`,
    liquidC: `xox-liq-c-${uid}`,
    gloss: `xox-gloss-${uid}`,
    glossSpec: `xox-gloss-spec-${uid}`,
    eyeFill: `xox-eye-fill-${uid}`,
    core: `xox-core-${uid}`,
    glow: `xox-glow-${uid}`,
    cradle: `xox-cradle-${uid}`,
    blush: `xox-blush-${uid}`,
    mouthClip: `xox-mouth-clip-${uid}`,
    laptopScreen: `xox-lap-scr-${uid}`,
    features: `xox-features-${uid}`,
    lensClip: `xox-lens-clip-${uid}`,
    lensBack: `xox-lens-back-${uid}`,
    lensEdge: `xox-lens-edge-${uid}`,
    lensRim: `xox-lens-rim-${uid}`,
    lensHandle: `xox-lens-handle-${uid}`,
    syncSpin: `xox-sync-spin-${uid}`,
    syncArc: `xox-sync-arc-${uid}`,
    syncFront: `xox-sync-front-${uid}`,
    syncHead: `xox-sync-head-${uid}`,
    screenLight: `xox-screen-light-${uid}`,
  };
  const resolvedAccent = resolveXoxAccentPreset(accentPreset);
  const currentColors = resolveXoxStateColors(resolvedAccent, state);
  const initialColors = useMemo(() => currentColors, []);

  // Refs a nodos SVG animados por rAF
  const wrapRef = useRef<HTMLDivElement>(null);
  const cradleRef = useRef<SVGCircleElement>(null);
  const summonSilhouetteRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGEllipseElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const yawRef = useRef<SVGGElement>(null);
  const starUnderlayRef = useRef<SVGPathElement>(null);
  const starRef = useRef<SVGPathElement>(null);
  const starRimRef = useRef<SVGPathElement>(null);
  const starMeniscusRef = useRef<SVGPathElement>(null);
  const starRefractCreaseRef = useRef<SVGPathElement>(null);
  const starBevelRef = useRef<SVGPathElement>(null);
  const starBounceRef = useRef<SVGPathElement>(null);
  const starClipPathRef = useRef<SVGPathElement>(null);
  const rimGradRef = useRef<SVGLinearGradientElement>(null);
  const liquidARef = useRef<SVGEllipseElement>(null);
  const liquidBRef = useRef<SVGEllipseElement>(null);
  const liquidCRef = useRef<SVGEllipseElement>(null);
  const glossTopRef = useRef<SVGEllipseElement>(null);
  const glossSpecRef = useRef<SVGPathElement>(null);
  const glossPinRef = useRef<SVGEllipseElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const eyeOpenLRef = useRef<SVGGElement>(null);
  const eyeOpenRRef = useRef<SVGGElement>(null);
  const eyeScleraLRef = useRef<SVGEllipseElement>(null);
  const eyeScleraRRef = useRef<SVGEllipseElement>(null);
  const eyeHappyLRef = useRef<SVGPathElement>(null);
  const eyeHappyRRef = useRef<SVGPathElement>(null);
  const cheekLRef = useRef<SVGGElement>(null);
  const cheekRRef = useRef<SVGGElement>(null);
  const cheekLCoreRef = useRef<SVGEllipseElement>(null);
  const cheekRCoreRef = useRef<SVGEllipseElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const talkMouthGroupRef = useRef<SVGGElement>(null);
  const talkMouthPathRef = useRef<SVGPathElement>(null);
  const talkMouthClipPathRef = useRef<SVGPathElement>(null);
  const talkInnerShadeRef = useRef<SVGEllipseElement>(null);
  const talkTongueRef = useRef<SVGEllipseElement>(null);
  const talkUpperLipRef = useRef<SVGPathElement>(null);
  const talkWaveRef = useRef<SVGGElement>(null);
  const talkWave1Ref = useRef<SVGPathElement>(null);
  const talkWave2Ref = useRef<SVGPathElement>(null);
  const talkWave3Ref = useRef<SVGPathElement>(null);
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([]);
  const subagentSatRefs = useRef<(SVGGElement | null)[]>([]);
  const subagentsRef = useRef<XoxSubagentOrbitItem[] | undefined>(subagents);
  subagentsRef.current = subagents;
  const terminalRef = useRef<XoxTerminalFeed | null | undefined>(terminal);
  terminalRef.current = terminal;
  // Anillo de sincronización: mitad trasera (detrás del cristal) y delantera (frente al cuerpo)
  const syncBackRef = useRef<SVGGElement>(null);
  const syncFrontRef = useRef<SVGGElement>(null);
  const syncSpinRef = useRef<SVGGElement>(null);
  const syncRingRefs = useRef<(SVGGElement | null)[]>([]);
  const syncHeadRefs = useRef<(SVGGElement | null)[]>([]);
  // Lupa de cristal: el grupo interno re-dibuja el ojo derecho aumentado
  const lensMagRef = useRef<SVGGElement>(null);
  const lensFerruleRef = useRef<SVGRectElement>(null);
  const cheerSparkRefs = useRef<(SVGPathElement | null)[]>([]);
  const screenLightRef = useRef<SVGEllipseElement>(null);
  const tongueRef = useRef<SVGPathElement>(null);
  const sweatRef = useRef<SVGGElement>(null);
  // Refs de la mini-laptop flotante (edición de código + terminal sin brazos)
  const laptopRef = useRef<SVGGElement>(null);
  const laptopLidRef = useRef<SVGGElement>(null);
  const laptopBaseRimRef = useRef<SVGPathElement>(null);
  const laptopScreenRimRef = useRef<SVGRectElement>(null);
  const laptopScreenGlowRef = useRef<SVGEllipseElement>(null);
  const laptopCodeGroupRef = useRef<SVGGElement>(null);
  const laptopTermGroupRef = useRef<SVGGElement>(null);
  const laptopActiveLineRef = useRef<SVGRectElement>(null);
  const laptopCodeLineRefs = useRef<(SVGRectElement | null)[]>([]);
  const laptopCodeSecRefs = useRef<(SVGRectElement | null)[]>([]);
  const laptopCaretRef = useRef<SVGRectElement>(null);
  const laptopTermCmdRef = useRef<SVGRectElement>(null);
  const laptopTermOutRefs = useRef<(SVGRectElement | null)[]>([]);
  const laptopTermBadgeRef = useRef<SVGCircleElement>(null);
  const laptopTermCheckRef = useRef<SVGPathElement>(null);
  const laptopKeyGlowRefs = useRef<(SVGRectElement | null)[]>([]);
  const stopRefs = useRef<{
    bodyTint: SVGStopElement | null;
    bodyGlow: SVGStopElement | null;
    bodyMid: SVGStopElement | null;
    bodyRimEnd: SVGStopElement | null;
    rim1: SVGStopElement | null;
    rimMid: SVGStopElement | null;
    rim2: SVGStopElement | null;
    meniscus1: SVGStopElement | null;
    meniscusMid: SVGStopElement | null;
    meniscus2: SVGStopElement | null;
    bevelTint: SVGStopElement | null;
    bounceTint: SVGStopElement | null;
    liquidA0: SVGStopElement | null;
    liquidA1: SVGStopElement | null;
    liquidA2: SVGStopElement | null;
    liquidB0: SVGStopElement | null;
    liquidB1: SVGStopElement | null;
    liquidB2: SVGStopElement | null;
    liquidC0: SVGStopElement | null;
    liquidC1: SVGStopElement | null;
    liquidC2: SVGStopElement | null;
    core0: SVGStopElement | null;
    core1: SVGStopElement | null;
    core2: SVGStopElement | null;
    core3: SVGStopElement | null;
    glow0: SVGStopElement | null;
    glow1: SVGStopElement | null;
    glow2: SVGStopElement | null;
    blush0: SVGStopElement | null;
    blush1: SVGStopElement | null;
    blush2: SVGStopElement | null;
    lensRim1: SVGStopElement | null;
    lensRim2: SVGStopElement | null;
    lensEdge: SVGStopElement | null;
    syncArc0: SVGStopElement | null;
    syncArc1: SVGStopElement | null;
    syncHead: SVGStopElement | null;
    screenLight: SVGStopElement | null;
  }>({
    bodyTint: null,
    bodyGlow: null,
    bodyMid: null,
    bodyRimEnd: null,
    rim1: null,
    rimMid: null,
    rim2: null,
    meniscus1: null,
    meniscusMid: null,
    meniscus2: null,
    bevelTint: null,
    bounceTint: null,
    liquidA0: null,
    liquidA1: null,
    liquidA2: null,
    liquidB0: null,
    liquidB1: null,
    liquidB2: null,
    liquidC0: null,
    liquidC1: null,
    liquidC2: null,
    core0: null,
    core1: null,
    core2: null,
    core3: null,
    glow0: null,
    glow1: null,
    glow2: null,
    blush0: null,
    blush1: null,
    blush2: null,
    lensRim1: null,
    lensRim2: null,
    lensEdge: null,
    syncArc0: null,
    syncArc1: null,
    syncHead: null,
    screenLight: null,
  });
  // Props (accesorios) que aparecen según el estado
  const lensRef = useRef<SVGGElement>(null);
  const bubbleRef = useRef<SVGGElement>(null);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const bangRef = useRef<SVGGElement>(null);

  const prevAccentRef = useRef<XoxAccentPreset>(resolvedAccent);
  const prevStateRef = useRef<XoxState>(state);
  const stateRef = useRef<XoxState>(state);
  const accentRef = useRef<XoxAccentPreset>(resolvedAccent);
  const hoverRef = useRef(false);
  const dragMotionPropRef = useRef(dragMotionRef);
  const glassContrastRef = useRef(glassContrast);
  glassContrastRef.current = glassContrast;

  const colorStateRef = useRef<{ cur: OklabColorMap; target: OklabColorMap }>({
    cur: toOklabColorMap(initialColors),
    target: toOklabColorMap(initialColors),
  });

  useEffect(() => {
    dragMotionPropRef.current = dragMotionRef;
  }, [dragMotionRef]);

  // Estado mutable compartido entre handlers y el loop de animación
  const anim = useRef({
    t: 0,
    starPhase: 0,
    sparkPhase: 0,
    bobPhase: 0,
    reduce: false,
    spinTarget: 0,
    windupUntil: 0,
    lastSpin: -10,
    squashKick: 0,
    jumpKick: 0,
    rotKick: 0,
    lookKickX: 0,
    landedAt: -10,
    waveStart: -10,
    summonAt: -10,
    colorMorphAt: -10,
    stateChangeAt: -10,
    talkStartedAt: 0,
    postTalkSmileUntil: -10,
    forceBlinkAt: -10,
    termPulseAt: -10,
    blushBoostUntil: -10,
    blushPeak: 0,
    blushKick: 0,
    cheerStartAt: -10,
    sparkleBurstAt: -10,
    sparkleScale: 1,
    syncAngle: 0,
    lookTX: 0,
    lookTY: 0,
    mouseTime: -1e9,
  });

  // Actualiza objetivos de color en OKLab y dispara ola de transformación al cambiar accentPreset
  useEffect(() => {
    accentRef.current = resolvedAccent;
    colorStateRef.current.target = toOklabColorMap(
      resolveXoxStateColors(resolvedAccent, state)
    );

    if (prevAccentRef.current !== resolvedAccent) {
      prevAccentRef.current = resolvedAccent;
      const a = anim.current;
      a.colorMorphAt = a.t;
      a.summonAt = a.t;
      if (!a.reduce) {
        a.squashKick += 2.3;
        a.jumpKick -= 65;
        a.waveStart = a.t;
        a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.35);
        a.blushPeak = Math.max(a.blushPeak, 0.52);
      }
    }
  }, [resolvedAccent, state]);

  const initialPath = useMemo(
    () => buildStar({ phase: 0, amp: 1, lag: 0, reach: 0, wave: -1 }),
    []
  );

  const triggerSpin = () => {
    const a = anim.current;
    if (a.t - a.lastSpin < 0.9) return;
    a.lastSpin = a.t;
    if (a.reduce) {
      a.jumpKick = -75;
      return;
    }
    a.windupUntil = a.t + 0.12; // anticipación compacta
    a.squashKick = 2.2;
  };

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    stateRef.current = state;
    const a = anim.current;

    // Coreografía de transición suave al cambiar entre CUALQUIER par de estados
    if (prev !== state) {
      a.stateChangeAt = a.t;
      if (state === "talking") {
        a.talkStartedAt = a.t;
        if (prev === "idle") {
          a.waveStart = a.t;
          a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.5);
          a.blushPeak = Math.max(a.blushPeak, 0.58);
        }
      } else if (prev === "talking" && state === "idle") {
        // Sonrisa cálida breve al terminar de hablar para despedir la frase con carisma
        a.postTalkSmileUntil = a.t + 0.9;
      }
      // Parpadeo puente al cambiar de expresión facial (ej. success <-> idle, thinking -> talking)
      if (prev === "success" || state === "success" || prev === "talking" || state === "talking" || prev === "coding" || state === "coding") {
        a.forceBlinkAt = a.t;
      }
      if (!a.reduce) {
        if (state === "idle" && prev === "success") {
          // Aterrizaje acolchado suave al cerrar el festejo y volver a Reposo
          a.squashKick += 0.95;
          a.jumpKick += 18;
        } else if (state === "talking") {
          // Impulso ligero y cercano al tomar la palabra
          a.squashKick += 1.05;
          a.jumpKick -= 44;
        } else if (state !== "success") {
          // Micro-anticipación orgánica al entrar a un nuevo estado
          a.squashKick += 1.15;
          a.jumpKick -= 26;
        }
      }
    }

    if (state === "success" && (prev !== "success" || a.cheerStartAt < 0)) {
      // Festejo: anticipación blandita → gran salto radiante → rebote asimétrico → meneo alegre
      a.windupUntil = 0;
      a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 2.2);
      a.blushPeak = 1;
      a.cheerStartAt = a.t;
      a.summonAt = a.t;
      a.sparkleBurstAt = a.t + 0.16;
      a.sparkleScale = 1;
      if (!a.reduce) a.blushKick += 1.6;
    }
  }, [state, active]);

  // Reacción física de Xox cuando la terminal devuelve resultado en modo coding
  useEffect(() => {
    if (!terminal) return;
    const a = anim.current;
    a.termPulseAt = a.t;
    if (!a.reduce && (terminal.status === "ok" || terminal.status === "error")) {
      a.squashKick += terminal.status === "ok" ? 1.35 : 1.75;
      a.jumpKick += terminal.status === "ok" ? -42 : 24;
      if (terminal.status === "ok") {
        a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.1);
        a.blushPeak = Math.max(a.blushPeak, 0.55);
      }
    }
  }, [terminal?.seq, terminal?.status]);

  // Coreografía de entrada al invocar con ⌘⇧X o al repetir gesto en Xox Studio
  useEffect(() => {
    if (!summonTrigger) return;
    const a = anim.current;
    a.summonAt = a.t;
    a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.6);
    a.blushPeak = Math.max(a.blushPeak, 0.58);
    if (stateRef.current === "success") {
      a.cheerStartAt = a.t;
      a.sparkleBurstAt = a.t + 0.16;
      a.sparkleScale = 1;
      return;
    }
    a.waveStart = a.t;
    if (a.reduce) {
      a.jumpKick = -60;
      return;
    }
    a.squashKick = 4.2;
    a.jumpKick = -195;
  }, [summonTrigger]);

  // Aterrizaje vivo y expresivo al llegar desde el vuelo Chat <-> Espacio de Xox (sin giro 360°)
  useEffect(() => {
    if (!glideTrigger) return;
    const a = anim.current;
    syncSharedPhase(a);
    const dir = glideDir === "right" ? 1 : -1;
    a.landedAt = a.t;
    a.summonAt = a.t;
    a.waveStart = a.t;
    a.postTalkSmileUntil = Math.max(a.postTalkSmileUntil, a.t + 1.25);
    a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.7);
    a.blushPeak = Math.max(a.blushPeak, 0.64);
    a.forceBlinkAt = a.t;
    if (a.reduce) return;
    // Aterrizaje con peso real: balanceo de frenado, rebote gelatinoso visible y desaceleración suave de chispas
    a.rotKick = dir * 175;
    a.lookKickX = dir * 3.0;
    a.squashKick = 4.0;
    a.jumpKick = 125;
  }, [glideTrigger, glideDir]);

  // Seguimiento global del cursor: Xox mira hacia donde esté el puntero solo cuando está activo
  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const a = anim.current;
      a.lookTX = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.35), -1, 1);
      a.lookTY = clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.35), -1, 1);
      a.mouseTime = performance.now();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active]);

  // Loop principal de animación (se detiene cuando está oculto)
  useEffect(() => {
    if (!active) return;
    const a = anim.current;
    syncSharedPhase(a);
    a.reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const A = a.reduce ? 0.35 : 1;

    const rot: Spring = { x: a.spinTarget, v: 0 };
    const lookX: Spring = { x: 0, v: 0 };
    const lookY: Spring = { x: 0, v: 0 };
    const jump: Spring = { x: 0, v: 0 };
    const squash: Spring = { x: 0, v: 0 };
    const hover: Spring = { x: 0, v: 0 };
    const blush: Spring = { x: 0, v: 0 };
    // Resortes continuos (0..1) por estado para transiciones suaves de ida y vuelta
    const initSt = stateRef.current;
    const wSuccess: Spring = { x: initSt === "success" ? 1 : 0, v: 0 };
    const popLens: Spring = { x: initSt === "reading" ? 1 : 0, v: 0 };
    const popBubble: Spring = { x: initSt === "thinking" ? 1 : 0, v: 0 };
    const popBang: Spring = { x: initSt === "alert" ? 1 : 0, v: 0 };
    const popSync: Spring = { x: initSt === "syncing" ? 1 : 0, v: 0 };
    const popTalk: Spring = { x: initSt === "talking" ? 1 : 0, v: 0 };
    const popLaptop: Spring = { x: initSt === "coding" ? 1 : 0, v: 0 };
    const lidOpen: Spring = { x: initSt === "coding" ? 1 : 0, v: 0 };
    const termModeBlend: Spring = { x: 0, v: 0 };
    const mouthOpenSpring: Spring = { x: 0, v: 0 };
    const mouthWidthSpring: Spring = { x: 3.8, v: 0 };
    const squintL: Spring = { x: 0, v: 0 };
    const squintR: Spring = { x: 0, v: 0 };
    const saccadeX: Spring = { x: 0, v: 0 };
    const saccadeY: Spring = { x: 0, v: 0 };
    // Boca paramétrica de enfoque (resortes críticamente amortiguados: sin rebote ni temblor)
    const editPose = FOCUS_POSES.editR.mouth;
    const focusMouthW: Spring = { x: editPose.w, v: 0 };
    const focusMouthY: Spring = { x: editPose.y, v: 0 };
    const focusMouthBend: Spring = { x: editPose.bend, v: 0 };
    const focusMouthTilt: Spring = { x: editPose.tilt, v: 0 };
    const focusMouthShift: Spring = { x: editPose.shift, v: 0 };
    // Festejo (brazos arriba con suavidad), lengüita de concentración y gota de sudor al fallar la terminal
    const cheerArms: Spring = { x: 0, v: 0 };
    const tongueOut: Spring = { x: 0, v: 0 };
    const sweatDrop: Spring = { x: 0, v: 0 };
    let sparklesShown = false;
    let syncShown = false;
    let lensShown = false;
    let prevTermOk = false;

    const setProp = (el: SVGElement | null, pop: number, transform: string) => {
      if (!el) return;
      const s = Math.max(pop, 0.0001);
      el.setAttribute("transform", transform.replace("$S", s.toFixed(4)));
      el.setAttribute("opacity", clamp(pop * 1.4, 0, 1).toFixed(3));
    };

    let raf = 0;
    let last = performance.now();
    let nextBlink = a.t + 1.6;
    let blinkStart = -10;
    let blinkHold = 0;
    let lastForceBlinkSeen =
      a.forceBlinkAt >= a.t - 0.05 ? a.forceBlinkAt - 1 : a.forceBlinkAt;
    let summonShown = false;
    summonSilhouetteRef.current?.setAttribute("display", "none");
    // Expresión de enfoque que se muestra actualmente; sólo cambia con los ojos cerrados
    let shownExpr: FocusExpr = "none";
    let exprSwapPending = false;
    // Ojo dominante del gesto de inspector (alterna con calma, siempre detrás de un parpadeo)
    let focusSide: 1 | -1 = 1;
    let nextFocusSwap = a.t + 7.5;
    const beginBlink = (at: number, hold: number, calm: boolean) => {
      blinkStart = at;
      blinkHold = hold;
      if (calm) {
        // Concentrado: parpadeos espaciados y sencillos (sin dobles parpadeos nerviosos)
        nextBlink = at + 3.8 + Math.random() * 3.2;
      } else {
        nextBlink = at + (Math.random() < 0.18 ? 0.32 : 2.6 + Math.random() * 3.4);
      }
    };
    let nextGlance = a.t + 0.55;
    let glance = { x: 0, y: 0 };
    let prevDragActive = false;

    const frame = (now: number) => {
      if (document.hidden) {
        raf = 0;
        return;
      }

      const st = stateRef.current;
      const dt = clamp((now - last) / 1000, 0, 1 / 20);
      last = now;
      a.t += dt;
      const t = a.t;
      const thinking = st === "thinking";
      const reading = st === "reading";
      const talking = st === "talking";
      const alerting = st === "alert";
      const syncing = st === "syncing";
      const coding = st === "coding";
      const succeeding = st === "success";

      // Pesos continuos de transición para que ningún estado cambie de golpe
      step(wSuccess, succeeding ? 1 : 0, 130, 16, dt);
      step(popLens, reading ? 1 : 0, 155, 14, dt);
      step(popBubble, thinking ? 1 : 0, 155, 14, dt);
      step(popBang, alerting ? 1 : 0, 220, 12, dt);
      step(popSync, syncing ? 1 : 0, 125, 14, dt);
      step(popTalk, talking ? 1 : 0, 175, 16, dt);
      step(popLaptop, coding ? 1 : 0, 150, 14.5, dt);
      // La tapa de la laptop se despliega al entrar en coding y se pliega al salir
      step(lidOpen, coding && popLaptop.x > 0.18 ? 1 : 0, 145, 13.5, dt);

      const wThink = clamp(popBubble.x, 0, 1);
      const wRead = clamp(popLens.x, 0, 1);
      const wTalk = clamp(popTalk.x, 0, 1);
      const wAlert = clamp(popBang.x, 0, 1);
      const wCode = clamp(popLaptop.x, 0, 1);
      const wSucc = clamp(wSuccess.x, 0, 1);

      // Coreografía determinista de festejo ("happy" / Feliz) con principios Disney
      const cheerElapsed = Math.max(0, t - Math.max(0, a.cheerStartAt));
      const happyPose = evalHappyChoreo(cheerElapsed, a.reduce);

      // Barrido de la lupa: -1 = ojo izquierdo, 1 = ojo derecho, con una pausa breve en cada extremo
      const scanTh = (t / LENS_SCAN_PERIOD) * Math.PI * 2;
      const scanTanh = Math.tanh(1.8 * Math.sin(scanTh));
      const lensScanU = a.reduce ? 0.9 : scanTanh / Math.tanh(1.8);
      const lensScanVel = a.reduce
        ? 0
        : (1.8 * Math.cos(scanTh) * (1 - scanTanh * scanTanh) * ((Math.PI * 2) / LENS_SCAN_PERIOD)) / Math.tanh(1.8);

      // --- Cadencia conversacional (frases con pausas breves de sonrisa y sílabas asimétricas) ---
      const talkT = Math.max(0, t - a.talkStartedAt);
      const phraseCycle = talkT % 2.45;
      // Dos ráfagas naturales de palabras separadas por un respiro breve (~0.26s) con sonrisa cálida
      const phraseEnv =
        phraseCycle < 1.12
          ? 0.85 + 0.15 * Math.sin((phraseCycle / 1.12) * Math.PI)
          : phraseCycle < 1.38
            ? 0.14
            : phraseCycle < 2.26
              ? 0.88 + 0.12 * Math.sin(((phraseCycle - 1.38) / 0.88) * Math.PI)
              : 0.18;
      const sylWave =
        0.52 +
        0.34 * Math.sin(talkT * 14.8 + 0.35) +
        0.22 * Math.sin(talkT * 9.3 + 1.1) +
        0.16 * Math.cos(talkT * 20.5);
      // Curva ligeramente asimétrica: vocales abiertas más legibles y cierres ágiles entre sílabas
      const shapedSyl = Math.pow(clamp(sylWave, 0, 1.08), 0.86);
      // Feliz: sonrisa abierta proporcionada y luminosa que se expande en el ápice del salto
      const targetMouthOpen = talking
        ? clamp(shapedSyl * phraseEnv, phraseEnv < 0.25 ? 0.06 : 0.18, 1.04) * wTalk
        : succeeding
          ? happyPose.mouthJoy * wSucc
          : 0;
      // Alternancia entre vocales amplias ("a/e") y vocales redondeadas ("o/u")
      const vowelRound = (0.5 + 0.5 * Math.sin(talkT * 5.2 + 0.9)) * smooth01(0.2, 0.75, phraseEnv);
      const targetHalfW = talking
        ? (4.9 - 1.35 * vowelRound + 0.45 * targetMouthOpen) * (0.74 + 0.26 * wTalk)
        : succeeding
          ? 3.85 + 0.95 * happyPose.mouthJoy
          : 3.6;

      step(mouthOpenSpring, targetMouthOpen, 290, 20, dt);
      step(mouthWidthSpring, targetHalfW, 230, 18.5, dt);

      const mOpen = clamp(mouthOpenSpring.x, 0, 1.12);
      const mHalfW = clamp(mouthWidthSpring.x, 2.7, 5.1);
      const talkEmphasis = wTalk * smooth01(0.28, 0.88, mOpen);
      const smileLift = lerp(
        0.48 + 0.74 * (1 - vowelRound) + 0.18 * (1 - smooth01(0.15, 0.55, mOpen)),
        1.42,
        wSucc * (1 - wTalk)
      );

      // En modo coding: determina si está editando código o viendo la respuesta de la terminal
      const tf = terminalRef.current;
      // Si no hay evento explícito (ej. catálogo de Xox Studio), alterna entre edición y terminal cada ~6.4s
      const autoCycle = t % 6.4;
      const isTermPhase = tf ? tf.mode === "terminal" : autoCycle >= 3.4;
      const isTermDoneOk = tf ? tf.status === "ok" : autoCycle >= 4.8;
      const isTermErr = tf ? tf.status === "error" : false;
      step(termModeBlend, isTermPhase ? 1 : 0, 140, 16, dt);
      const wTerm = clamp(termModeBlend.x, 0, 1);

      // --- Parpadeo natural (cierre rápido, apertura suave) --------------------
      const analyzeWeight = clamp(wCode + wRead * 0.9 + wThink * 0.35, 0, 1);
      const focused = analyzeWeight > 0.3;
      const blinkTotal = BLINK_CLOSE + blinkHold + BLINK_OPEN;
      const blinkBusy = t - blinkStart < blinkTotal;
      if (a.forceBlinkAt !== lastForceBlinkSeen) {
        // Parpadeo puente por cambio de estado; nunca reinicia un parpadeo en curso (evita el "tic" raro)
        lastForceBlinkSeen = a.forceBlinkAt;
        if (!blinkBusy) beginBlink(t, 0.04, focused);
      } else if (t > nextBlink && !blinkBusy) {
        beginBlink(t, 0, focused);
      }

      // --- Expresión de enfoque sostenida ("inspector") --------------------
      // Cada fase mantiene UNA pose firme. Al cambiar de fase, Xox parpadea y la nueva
      // expresión se aplica mientras los ojos están cerrados: nunca "se desinfla" a la vista.
      const editExpr: FocusExpr = focusSide > 0 ? "editR" : "editL";
      let wantedExpr: FocusExpr = "none";
      if (coding) {
        if (isTermPhase && isTermDoneOk) wantedExpr = "ok";
        else if (isTermPhase && isTermErr) wantedExpr = "err";
        else if (isTermPhase) wantedExpr = "run";
        else wantedExpr = editExpr;
      } else if (reading) {
        wantedExpr = "lens";
      } else if (thinking) {
        wantedExpr = editExpr;
      }
      // Alterna el ojo dominante de vez en cuando (sólo mientras edita/lee) para que siga vivo
      if (shownExpr === "editL" || shownExpr === "editR") {
        if (t > nextFocusSwap) {
          focusSide = focusSide > 0 ? -1 : 1;
          nextFocusSwap = t + 7 + Math.random() * 4;
        }
      } else {
        nextFocusSwap = Math.max(nextFocusSwap, t + 5);
      }

      if (wantedExpr !== shownExpr) {
        if (wantedExpr === "none" || analyzeWeight < 0.05) {
          // Entrando/saliendo del estado: la pose ya se funde con el peso del estado
          shownExpr = wantedExpr;
          exprSwapPending = false;
        } else {
          exprSwapPending = true;
          if (!(t - blinkStart < BLINK_CLOSE + blinkHold + BLINK_OPEN)) beginBlink(t, 0.05, true);
        }
      } else {
        exprSwapPending = false;
      }
      const btNow = t - blinkStart;
      const eyesShut = btNow >= BLINK_CLOSE * 0.85 && btNow <= BLINK_CLOSE + blinkHold + BLINK_OPEN * 0.2;
      if (exprSwapPending && eyesShut) {
        shownExpr = wantedExpr;
        exprSwapPending = false;
      }

      let pose = FOCUS_POSES[shownExpr];
      if (shownExpr === "lens") {
        // El ojo bajo la lupa se abre curioso y el otro se entrecierra; la boquita se va al lado libre
        const uR = Math.max(0, lensScanU);
        const uL = Math.max(0, -lensScanU);
        LIVE_LENS_POSE.sL = 0.34 * uR - 0.14 * uL;
        LIVE_LENS_POSE.sR = 0.34 * uL - 0.14 * uR;
        LIVE_LENS_POSE.pL = 1 + 0.2 * uL - 0.1 * uR;
        LIVE_LENS_POSE.pR = 1 + 0.2 * uR - 0.1 * uL;
        LIVE_LENS_POSE.mouth.tilt = -0.7 * lensScanU;
        LIVE_LENS_POSE.mouth.shift = -1.6 * lensScanU;
        pose = LIVE_LENS_POSE;
      }
      // Calidez ocular carismática al hablar (suaviza ligeramente los ojos en sílabas alegres con leve asimetría)
      const talkWarmthWeight = wTalk * (1 - analyzeWeight);
      const talkAsym = Math.sin(talkT * 1.45) * 0.045;
      const talkSquintL = talkWarmthWeight * (0.065 + 0.075 * talkEmphasis + Math.max(0, talkAsym));
      const talkSquintR = talkWarmthWeight * (0.065 + 0.075 * talkEmphasis + Math.max(0, -talkAsym));
      // Resortes críticamente amortiguados (c ≈ 2√k): llegan firmes a la pose sin rebotar
      step(squintL, pose.sL * analyzeWeight + talkSquintL, 300, 35, dt);
      step(squintR, pose.sR * analyzeWeight + talkSquintR, 300, 35, dt);

      // --- Lectura ocular coherente con el cursor del editor ---------------
      // Fijaciones discretas que avanzan con el texto que se escribe y un barrido de retorno
      // al saltar de línea (en vez de un temblor continuo de pupilas).
      const typeCycle = (t * 1.55) % 4;
      const typeRow = Math.floor(typeCycle);
      const typeFrac = typeCycle - typeRow;
      let rawSacX = 0;
      let rawSacY = 0;
      if (coding && shownExpr !== "none") {
        if (shownExpr === "editL" || shownExpr === "editR") {
          const caret = smooth01(0, 0.86, typeFrac);
          const fixation = Math.floor(caret * 4) / 4;
          rawSacX = -0.55 + fixation * 1.1;
          rawSacY = -0.3 + typeRow * 0.2;
        } else if (shownExpr === "run") {
          rawSacX = -0.15;
          rawSacY = 0.15;
        }
      }
      step(saccadeX, rawSacX * wCode, 260, 32, dt);
      step(saccadeY, rawSacY * wCode, 220, 30, dt);

      // Boca de enfoque: sólo se re-apunta cuando hay una pose activa (al salir se funde con wCode)
      if (shownExpr !== "none") {
        step(focusMouthW, pose.mouth.w, 260, 32, dt);
        step(focusMouthY, pose.mouth.y, 260, 32, dt);
        step(focusMouthBend, pose.mouth.bend, 260, 32, dt);
        step(focusMouthTilt, pose.mouth.tilt, 260, 32, dt);
        step(focusMouthShift, pose.mouth.shift, 220, 30, dt);
      }

      const dm = dragMotionPropRef.current?.current ?? null;
      const dragging = Boolean(dm?.active);
      if (dragging && !prevDragActive) {
        // Anticipación/despegue vivo al iniciar desplazamiento o arrastre
        a.waveStart = a.t;
        if (!a.reduce) {
          a.squashKick += 2.2;
          a.jumpKick -= 95;
        }
      } else if (!dragging && prevDragActive) {
        // Asentamiento con compresión proporcional al impulso de suelta
        const impact = clamp(
          Math.hypot(dm?.releaseVx ?? 0, dm?.releaseVy ?? 0) / 900,
          0.35,
          1.45
        );
        if (!a.reduce) {
          a.squashKick += 2.8 * impact;
          a.jumpKick += 68 * impact;
        }
      }
      prevDragActive = dragging;

      const dragNx = dragging && dm ? clamp(dm.vx / 900, -1, 1) : 0;
      const dragNy = dragging && dm ? clamp(dm.vy / 900, -1, 1) : 0;
      const dragSpeed = dragging ? Math.min(1.5, Math.hypot(dragNx, dragNy)) : 0;

      // --- Mirada ---------------------------------------------------------
      let tx: number;
      let ty: number;
      if (dragging) {
        tx = clamp(dragNx * 1.15, -1, 1);
        ty = clamp(dragNy * 0.95, -1, 1);
      } else if (succeeding) {
        // En Feliz mantiene mirada centrada y radiante siguiendo sutilmente el arco alegre
        tx = clamp(happyPose.shiftX * 0.09, -0.35, 0.35);
        ty = clamp(happyPose.faceLift * 0.12, -0.38, 0.22);
      } else if (thinking) {
        tx = 0.4 + 0.18 * Math.sin(t * 2.3);
        ty = -0.6 + 0.12 * Math.sin(t * 3.1);
      } else if (reading) {
        // La mirada acompaña a la lupa en su barrido de lado a lado
        tx = 0.42 * lensScanU;
        ty = 0.26 + 0.06 * Math.sin(t * 0.8);
      } else if (coding) {
        // Mira hacia la laptop (abajo a la derecha); la lectura fina la hacen las pupilas (sacadas)
        tx = 0.52 + 0.06 * Math.sin(t * 0.8);
        ty = isTermPhase ? (isTermDoneOk ? 0.18 : 0.36) : 0.4;
      } else if (alerting) {
        // Inquieto: mira nervioso de un lado a otro
        tx = 0.85 * Math.sin(t * 5.3) * Math.cos(t * 1.7);
        ty = 0.3 * Math.sin(t * 3.9);
      } else if (syncing) {
        // Sigue con la mirada a la flecha que recorre el anillo
        const headRad = toRad(a.syncAngle + 120);
        tx = 0.55 * Math.cos(headRad);
        ty = 0.08 + 0.3 * Math.sin(headRad);
      } else if (talking) {
        // Conversación atenta y cercana: si el cursor está activo lo sigue con calidez; si no, mantiene contacto visual vivo
        const talkGlanceX = 0.24 * Math.sin(talkT * 1.35) + 0.12 * Math.cos(talkT * 2.4);
        const talkGlanceY = -0.14 + 0.1 * Math.sin(talkT * 1.9);
        if (now - a.mouseTime < 3500) {
          tx = clamp(a.lookTX * 0.72 + talkGlanceX * 0.35, -0.85, 0.85);
          ty = clamp(a.lookTY * 0.65 + talkGlanceY * 0.4, -0.65, 0.55);
        } else {
          tx = talkGlanceX;
          ty = talkGlanceY;
        }
      } else if (now - a.mouseTime < 3500) {
        tx = a.lookTX;
        ty = a.lookTY;
      } else {
        if (t > nextGlance) {
          glance =
            Math.random() < 0.35
              ? { x: 0, y: 0 }
              : { x: (Math.random() * 2 - 1) * 0.8, y: (Math.random() * 2 - 1) * 0.5 };
          nextGlance = t + 1.4 + Math.random() * 2.2;
        }
        tx = glance.x;
        ty = glance.y;
      }
      step(lookX, tx, 85, 13.5, dt);
      step(lookY, ty, 85, 13.5, dt);

      // --- Giro con anticipación ------------------------------------------
      if (a.windupUntil && t >= a.windupUntil) {
        a.windupUntil = 0;
        a.spinTarget += 360;
        jump.v = -185 * A;
      }
      if (a.squashKick) {
        squash.v += a.squashKick;
        a.squashKick = 0;
      }
      if (a.jumpKick) {
        jump.v += a.jumpKick;
        a.jumpKick = 0;
      }
      if (a.rotKick) {
        rot.v += a.rotKick;
        a.rotKick = 0;
      }
      if (a.lookKickX) {
        lookX.v += a.lookKickX;
        a.lookKickX = 0;
      }
      if (a.blushKick) {
        blush.v += a.blushKick;
        a.blushKick = 0;
      }
      const interactiveBlush = hoverRef.current ? 0.62 : 0;
      const boostBlush = t <= a.blushBoostUntil ? a.blushPeak : 0;
      const dragBlush = dragging ? smooth01(0.15, 0.7, dragSpeed) * 0.52 : 0;
      const successBlush = wSucc * 0.92;
      const talkingBlush = wTalk * (0.4 + 0.16 * talkEmphasis);
      const codingOkBlush = wCode * (isTermPhase && isTermDoneOk ? 0.48 : 0);
      const blushTarget =
        (1 - wAlert) *
        clamp(Math.max(successBlush, boostBlush, interactiveBlush, dragBlush, talkingBlush, codingOkBlush), 0, 1);
      const blushRising = blushTarget > blush.x;
      const windup = a.windupUntil ? -18 : 0;

      // Balanceo mezclado continuamente (conservando la vibración clásica exacta en `alert`)
      const swayIdle = 3.4 * Math.sin(t * 0.85);
      const swayThink = 5.5 * Math.sin(t * 2.2);
      const swayRead = -3.8 * Math.sin(t * 1.6);
      const swayTalk = 5.6 * Math.sin(talkT * 1.55 + 0.25) + 1.8 * Math.sin(talkT * 3.85);
      // Inclinado hacia la laptop con cabeceos cortos al ritmo del tecleo
      const swayCode = 3.2 + 1.4 * Math.sin(t * 3.2);
      // En Feliz: inclinación en arco asimétrica sincronizada con cada salto y balanceo rítmico
      const swaySucc = happyPose.tiltDeg;
      const swaySync = 2.6 * Math.sin(toRad(a.syncAngle + 120));
      const wSync = clamp(popSync.x, 0, 1);
      const sway = alerting
        ? (3.4 * Math.sin(t * 0.85) + 3.2 * Math.sin(t * 23)) * A
        : (swayIdle * (1 - Math.max(wThink, wRead, wTalk, wCode, wSucc, wSync)) +
          swayThink * wThink +
          swayRead * wRead +
          swayTalk * wTalk +
          swayCode * wCode +
          swaySucc * wSucc +
          swaySync * wSync) *
        A;

      const landingPhase = (t - a.landedAt) / 0.95;
      const landingEnergy =
        landingPhase >= 0 && landingPhase <= 1 && !a.reduce
          ? Math.pow(1 - landingPhase, 1.75)
          : 0;
      const dragTilt = dragging ? -dragNx * 16 * A : 0;
      const subSteps = dt > 0.018 ? 2 : 1;
      const h = dt / subSteps;
      for (let sIdx = 0; sIdx < subSteps; sIdx += 1) {
        step(
          rot,
          a.spinTarget + windup + sway + lookX.x * 8 * (1 - 0.55 * wSucc) * A + dragTilt,
          alerting ? 160 : succeeding ? 145 : dragging ? 120 : 78,
          alerting ? 11 : succeeding ? 16 : dragging ? 13 : 13.5,
          h
        );

        // --- Salto + squash & stretch (solo en despegue y aterrizaje) -------
        const prevJump = jump.x;
        step(jump, 0, 88, 13.8, h);
        if (prevJump < 0 && jump.x >= 0 && jump.v > 65) squash.v += jump.v * 0.008;
        step(squash, 0, 220, 18, h);
        step(hover, hoverRef.current ? 1 : 0, 140, 18, h);
        step(
          blush,
          blushTarget,
          alerting ? 140 : blushRising ? 76 : 24,
          alerting ? 20 : blushRising ? 11.5 : 9.5,
          h
        );
      }

      const stretch = Math.min(Math.abs(jump.v) * 0.0005, 0.12);
      const talkBounce = wTalk * (mOpen - 0.34) * 0.036 * A;
      // Deformación de gota líquida en Feliz preservando volumen (sx * sy ≈ 1) y anclando las patitas al suelo
      const happyDef = happyPose.deform * wSucc * A;
      const happySy = 1 + happyDef;
      const happySx = 1 - happyDef * 0.86;
      const sy = (1 - squash.x * 0.45) * (1 + stretch + talkBounce) * happySy;
      const sx = (1 + squash.x * 0.4) * (1 - stretch * 0.55 - talkBounce * 0.72) * happySx;

      // Flotación vertical continua (conservando el pulso rápido exacto en `alert`)
      const bobIdle = 3.2 * Math.sin(t * 1.15);
      const bobThink = 4.5 * Math.sin(t * 2.4);
      const bobTalk = 2.1 * Math.sin(talkT * 2.35) - 2.3 * talkEmphasis;
      const bobCode = 2.4 * Math.sin(t * 2.8) + (isTermPhase && isTermDoneOk ? -2.2 * Math.abs(Math.sin(t * 4.5)) : 0);
      const activeBobWeight = clamp(wThink + wTalk + wCode + wSucc, 0, 1);
      const bob = alerting
        ? 2 * Math.sin(t * 9) * A
        : (bobIdle * (1 - activeBobWeight) +
          bobThink * wThink +
          bobTalk * wTalk +
          bobCode * wCode) *
        A;

      const totalJumpY = jump.x + happyPose.jumpY * wSucc;
      // Anclaje de contacto al suelo: cuando se agacha o aterriza (happyDef < 0), las patitas empujan el piso
      const footContactAnchor = happyDef < 0 ? -happyDef * 32 * smooth01(-6, 1, totalJumpY) : 0;
      const y = C + bob + totalJumpY + footContactAnchor;
      const shakeX = alerting ? 1.8 * Math.sin(t * 37) * A : happyPose.shiftX * wSucc * A;

      bodyRef.current?.setAttribute(
        "transform",
        `translate(${(C + shakeX).toFixed(2)} ${y.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) rotate(${rot.x.toFixed(2)}) translate(${-C} ${-C})`
      );

      // Falso 3D: el cuerpo se comprime al girar la cara hacia los lados
      const yaw = 1 - 0.1 * Math.abs(lookX.x);
      yawRef.current?.setAttribute(
        "transform",
        `translate(${(C - lookX.x * 2.5).toFixed(2)} ${C}) scale(${yaw.toFixed(4)} 1) translate(${-C} ${-C})`
      );

      // --- Cuerpo de gota líquida (follow-through vivo en las puntas y brazos expresivos) ---
      const starSpeed = alerting
        ? 3.2
        : 1 + 0.8 * wThink + 0.35 * wCode + 0.32 * wTalk + 0.25 * wSucc + dragSpeed * 1.45 + landingEnergy * 1.1;
      a.starPhase += dt * starSpeed;
      const starAmp =
        (alerting
          ? 2.1
          : 1 + 0.6 * wThink + 0.18 * wCode + 0.28 * wTalk + 0.22 * wSucc + dragSpeed * 0.95 + landingEnergy * 0.75) * A;
      const lag = clamp(-rot.v * 0.017 - dragNx * 13 * A, -18, 18);
      const airborne = smooth01(0, 11, -totalJumpY);
      step(cheerArms, happyPose.armRaise * wSucc, 185, 19, dt);
      const combinedVelY = jump.v + happyPose.jumpVel * wSucc;
      const armFlap = clamp(combinedVelY * 0.042, -7.5, 8.5) * A;
      const starPath = buildStar({
        phase: a.starPhase,
        amp: starAmp,
        lag,
        reach: hover.x * 0.028 + wSucc * 0.022 * airborne + talkEmphasis * 0.018 + dragSpeed * 0.032 + landingEnergy * 0.024,
        wave: t - a.waveStart,
        cheer: clamp(cheerArms.x, 0, 1.12) * A,
        armFlap,
        armAsym: happyPose.armAsym * wSucc * A,
        airborne,
      });
      starRef.current?.setAttribute("d", starPath);
      starRimRef.current?.setAttribute("d", starPath);
      starMeniscusRef.current?.setAttribute("d", starPath);
      starRefractCreaseRef.current?.setAttribute("d", starPath);
      starBevelRef.current?.setAttribute("d", starPath);
      starBounceRef.current?.setAttribute("d", starPath);
      starUnderlayRef.current?.setAttribute("d", starPath);
      starClipPathRef.current?.setAttribute("d", starPath);

      // Óptica Liquid Glass cristalina: centro transparente profundo y refracción cromática concentrada hacia la curvatura
      const sloshSquash = clamp(squash.x * 0.4 - happyDef, -0.18, 0.26);
      if (liquidARef.current) {
        const ax = 86 + (7.5 * Math.sin(t * 0.52) - lookX.x * 5.2 - shakeX * 0.35) * A;
        const ay = 78 + (5.8 * Math.cos(t * 0.43) - lookY.x * 4.0) * A;
        const arx = 48 + 4.0 * Math.sin(t * 0.64) * A + sloshSquash * 14;
        const ary = 36 + 3.2 * Math.cos(t * 0.58) * A - sloshSquash * 8;
        liquidARef.current.setAttribute("cx", ax.toFixed(2));
        liquidARef.current.setAttribute("cy", ay.toFixed(2));
        liquidARef.current.setAttribute("rx", arx.toFixed(2));
        liquidARef.current.setAttribute("ry", ary.toFixed(2));
      }
      if (liquidBRef.current) {
        const bx = 146 + (8.5 * Math.cos(t * 0.47 + 1.2) + lookX.x * 5.0 + shakeX * 0.45) * A;
        const by = 156 + (6.2 * Math.sin(t * 0.41 + 0.7) + lookY.x * 3.8 + sloshSquash * 10) * A;
        const brx = 52 + 4.5 * Math.cos(t * 0.61) * A + sloshSquash * 20;
        const bry = 40 + 3.6 * Math.sin(t * 0.55) * A - sloshSquash * 9;
        liquidBRef.current.setAttribute("cx", bx.toFixed(2));
        liquidBRef.current.setAttribute("cy", by.toFixed(2));
        liquidBRef.current.setAttribute("rx", brx.toFixed(2));
        liquidBRef.current.setAttribute("ry", bry.toFixed(2));
      }
      if (liquidCRef.current) {
        // Cáustica cromática inferior sin blanco lechoso (se mece y ensancha al comprimir)
        const cx = 128 + (10.5 * Math.sin(t * 0.42 + 1.8) + lookX.x * 4.4 + shakeX * 0.5) * A;
        const cy = 164 + (4.8 * Math.cos(t * 0.48 + 0.5) + sloshSquash * 8) * A;
        const crx = 36 + 4.0 * Math.sin(t * 0.7) * A + sloshSquash * 18 + wSucc * 3;
        const cry = 16 + 2.2 * Math.cos(t * 0.6) * A - sloshSquash * 4;
        liquidCRef.current.setAttribute("cx", cx.toFixed(2));
        liquidCRef.current.setAttribute("cy", cy.toFixed(2));
        liquidCRef.current.setAttribute("rx", crx.toFixed(2));
        liquidCRef.current.setAttribute("ry", cry.toFixed(2));
        liquidCRef.current.setAttribute("transform", `rotate(${(-10 + 7 * Math.sin(t * 0.33) * A).toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})`);
      }
      if (rimGradRef.current) {
        const rimDriftX = 12 * Math.sin(t * 0.6) * A;
        const rimDriftY = 10 * Math.cos(t * 0.48) * A;
        rimGradRef.current.setAttribute("x1", (56 + rimDriftX).toFixed(1));
        rimGradRef.current.setAttribute("y1", (46 + rimDriftY).toFixed(1));
        rimGradRef.current.setAttribute("x2", (184 - rimDriftX * 0.85).toFixed(1));
        rimGradRef.current.setAttribute("y2", (194 - rimDriftY * 0.85).toFixed(1));
      }
      // Reflejo especular húmedo inscrito dentro de la frente convexa (nunca cortado por los valles)
      const specShiftX = (-lookX.x * 3.0 - rot.x * 0.06 + 1.5 * Math.sin(t * 0.65)) * A;
      const specShiftY = (-lookY.x * 2.0 + 1.2 * Math.cos(t * 0.55)) * A;
      if (glossTopRef.current) {
        const gx = 108.0 + specShiftX;
        const gy = 96.0 + specShiftY;
        glossTopRef.current.setAttribute("cx", gx.toFixed(2));
        glossTopRef.current.setAttribute("cy", gy.toFixed(2));
        glossTopRef.current.setAttribute("transform", `rotate(-32 ${gx.toFixed(2)} ${gy.toFixed(2)})`);
      }
      if (glossSpecRef.current) {
        const sx2 = 108.5 + specShiftX * 1.08;
        const sy2 = 95.2 + specShiftY * 1.08;
        glossSpecRef.current.setAttribute("transform", `translate(${sx2.toFixed(2)} ${sy2.toFixed(2)}) rotate(-32)`);
      }
      if (glossPinRef.current) {
        const px2 = 98.8 + specShiftX * 1.04;
        const py2 = 106.0 + specShiftY * 1.04;
        glossPinRef.current.setAttribute("cx", px2.toFixed(2));
        glossPinRef.current.setAttribute("cy", py2.toFixed(2));
        glossPinRef.current.setAttribute("transform", `rotate(-40 ${px2.toFixed(2)} ${py2.toFixed(2)})`);
      }

      // --- Núcleo profundo y halo atmosférico discreto (preservan transparencia oscura de cristal puro) ---
      const coreBase = 35 + 1.8 * Math.sin(t * 2);
      const coreThink = 40 + 3.0 * Math.sin(t * 6);
      const coreTalk = 36.5 + 2.8 * mOpen;
      const coreCode = 38 + 2.0 * Math.sin(t * 5.2);
      const coreSucc = 40 + 3.5 * airborne;
      const coreR = alerting
        ? 36 + 3.0 * Math.sin(t * 9)
        : coreBase * (1 - clamp(wThink + wTalk + wCode + wSucc, 0, 1)) +
        coreThink * wThink +
        coreTalk * wTalk +
        coreCode * wCode +
        coreSucc * wSucc;
      coreRef.current?.setAttribute("r", coreR.toFixed(2));

      const isGlassContrast = glassContrastRef.current;
      const corePeakBase = isGlassContrast ? 0.20 : 0.095;
      // Pulso del núcleo cada vez que una flecha del anillo cruza por delante (dato recibido)
      const syncPulse =
        wSync *
        Math.max(
          Math.pow(Math.max(0, Math.sin(toRad(a.syncAngle + 120))), 14),
          Math.pow(Math.max(0, Math.sin(toRad(a.syncAngle + 300))), 14)
        );
      const corePeakOp = clamp(
        corePeakBase +
        wThink * (0.12 + 0.035 * Math.sin(t * 6)) +
        wTalk * 0.045 +
        wCode * 0.05 +
        wSucc * (0.10 + 0.04 * airborne) +
        wAlert * 0.14 +
        syncPulse * 0.10 +
        hover.x * 0.03,
        0.08,
        isGlassContrast ? 0.42 : 0.30
      );
      const coreMidOp = corePeakOp * 0.48;
      const coreOuterOp = corePeakOp * 0.14;

      const summonPhase = (t - a.summonAt) / 0.62;
      const summonActive = summonPhase >= 0 && summonPhase <= 1 && !a.reduce;
      const colorMorphPhase = (t - a.colorMorphAt) / 0.72;
      const colorMorphActive = colorMorphPhase >= 0 && colorMorphPhase <= 1;

      // Interpolación perceptual en OKLab sobre stops, accesorios y sonrojo
      const cs = colorStateRef.current;
      const colorAlpha = a.reduce ? 1 : 1 - Math.exp(-8.5 * dt);
      const cBodyTint = stepOklab(cs.cur.bodyTint, cs.target.bodyTint, colorAlpha);
      const cBodyGlow = stepOklab(cs.cur.bodyGlow, cs.target.bodyGlow, colorAlpha);
      const cRim1 = stepOklab(cs.cur.rim1, cs.target.rim1, colorAlpha);
      const cRim2 = stepOklab(cs.cur.rim2, cs.target.rim2, colorAlpha);
      const cCore = stepOklab(cs.cur.core, cs.target.core, colorAlpha);
      const cMid = stepOklab(cs.cur.mid, cs.target.mid, colorAlpha);
      const cGlow = stepOklab(cs.cur.glow, cs.target.glow, colorAlpha);
      const cPupil = stepOklab(cs.cur.pupil, cs.target.pupil, colorAlpha);
      stepOklab(cs.cur.eye, cs.target.eye, colorAlpha);
      const cAccessory = stepOklab(cs.cur.accessory, cs.target.accessory, colorAlpha);
      const cBlush = stepOklab(cs.cur.blush, cs.target.blush, colorAlpha);
      const cBlushCore = stepOklab(cs.cur.blushCore, cs.target.blushCore, colorAlpha);

      const sr = stopRefs.current;
      sr.bodyTint?.setAttribute("stop-color", cBodyTint);
      sr.bodyGlow?.setAttribute("stop-color", cBodyGlow);
      sr.bodyMid?.setAttribute("stop-color", cMid);
      sr.bodyRimEnd?.setAttribute("stop-color", cRim2);
      sr.rim1?.setAttribute("stop-color", cRim1);
      sr.rimMid?.setAttribute("stop-color", cRim2);
      sr.rim2?.setAttribute("stop-color", cRim2);
      sr.meniscus1?.setAttribute("stop-color", cRim1);
      sr.meniscusMid?.setAttribute("stop-color", cBodyGlow);
      sr.meniscus2?.setAttribute("stop-color", cRim2);
      sr.bevelTint?.setAttribute("stop-color", cRim1);
      sr.bounceTint?.setAttribute("stop-color", cRim2);
      sr.liquidA0?.setAttribute("stop-color", cBodyTint);
      sr.liquidA1?.setAttribute("stop-color", cRim1);
      sr.liquidA2?.setAttribute("stop-color", cGlow);
      sr.liquidB0?.setAttribute("stop-color", cBodyGlow);
      sr.liquidB1?.setAttribute("stop-color", cGlow);
      sr.liquidB2?.setAttribute("stop-color", cMid);
      sr.liquidC0?.setAttribute("stop-color", cRim1);
      sr.liquidC1?.setAttribute("stop-color", cAccessory);
      sr.liquidC2?.setAttribute("stop-color", cBodyGlow);
      sr.core0?.setAttribute("stop-color", cCore);
      sr.core0?.setAttribute("stop-opacity", corePeakOp.toFixed(3));
      sr.core1?.setAttribute("stop-color", cGlow);
      sr.core1?.setAttribute("stop-opacity", coreMidOp.toFixed(3));
      sr.core2?.setAttribute("stop-color", cMid);
      sr.core2?.setAttribute("stop-opacity", coreOuterOp.toFixed(3));
      sr.core3?.setAttribute("stop-color", cMid);
      sr.glow0?.setAttribute("stop-color", cGlow);
      sr.glow1?.setAttribute("stop-color", cBodyGlow);
      sr.glow2?.setAttribute("stop-color", cGlow);
      sr.blush0?.setAttribute("stop-color", cBlush);
      sr.blush1?.setAttribute("stop-color", cBlush);
      sr.blush2?.setAttribute("stop-color", cBlush);
      cheekLCoreRef.current?.setAttribute("fill", cBlushCore);
      cheekRCoreRef.current?.setAttribute("fill", cBlushCore);
      ringRef.current?.setAttribute("stroke", cAccessory);
      talkWave1Ref.current?.setAttribute("stroke", cRim1);
      talkWave2Ref.current?.setAttribute("stroke", cGlow);
      talkWave3Ref.current?.setAttribute("stroke", cAccessory);
      talkInnerShadeRef.current?.setAttribute("fill", cPupil);
      talkTongueRef.current?.setAttribute("fill", "#FBCFE8");
      if (popLens.x > 0.002) {
        sr.lensRim1?.setAttribute("stop-color", cRim1);
        sr.lensRim2?.setAttribute("stop-color", cRim2);
        sr.lensEdge?.setAttribute("stop-color", cRim1);
        lensFerruleRef.current?.setAttribute("fill", cRim1);
      }
      if (popSync.x > 0.002) {
        sr.syncArc0?.setAttribute("stop-color", cAccessory);
        sr.syncArc1?.setAttribute("stop-color", cRim1);
        sr.syncHead?.setAttribute("stop-color", cAccessory);
      }
      laptopBaseRimRef.current?.setAttribute("stroke", cRim1);
      laptopScreenRimRef.current?.setAttribute("stroke", cAccessory);

      if (cradleRef.current) {
        cradleRef.current.setAttribute("transform", `translate(0 ${(bob + totalJumpY).toFixed(2)})`);
      }

      // --- Silueta estelar expansiva al aparecer / cambiar aura (dentro de yawRef: hereda la pose exacta) ---
      if (summonSilhouetteRef.current) {
        if (summonActive) {
          const ease = 1 - Math.pow(1 - summonPhase, 3.2);
          const fadeIn = Math.min(summonPhase / 0.1, 1);
          const fadeOut = Math.pow(1 - summonPhase, 1.65);
          const env = fadeIn * fadeOut;
          const scale = 1.01 + 0.31 * ease;
          const offset = (C * (1 - scale)).toFixed(2);

          if (!summonShown) {
            summonSilhouetteRef.current.setAttribute("display", "inline");
            summonShown = true;
          }
          summonSilhouetteRef.current.setAttribute("d", starPath);
          summonSilhouetteRef.current.setAttribute(
            "transform",
            `translate(${offset} ${offset}) scale(${scale.toFixed(4)})`
          );
          summonSilhouetteRef.current.setAttribute("fill", cGlow);
          summonSilhouetteRef.current.setAttribute("fill-opacity", (0.13 * env).toFixed(3));
          summonSilhouetteRef.current.setAttribute("stroke-opacity", (0.85 * env).toFixed(3));
          summonSilhouetteRef.current.setAttribute(
            "stroke-width",
            ((1.85 - 1.15 * ease) / scale).toFixed(2)
          );
        } else if (summonShown) {
          summonSilhouetteRef.current.setAttribute("display", "none");
          summonShown = false;
        }
      }
      // Anillo de datos orbital: transición suave con wThink (escala + opacidad)
      if (ringRef.current) {
        const ringScale = 0.72 + 0.28 * popBubble.x;
        ringRef.current.setAttribute(
          "transform",
          `translate(${C} ${y.toFixed(2)}) rotate(-18) scale(${ringScale.toFixed(3)})`
        );
        ringRef.current.setAttribute("stroke-dashoffset", (-t * 40).toFixed(1));
        ringRef.current.setAttribute("opacity", (clamp(wThink, 0, 1) * 0.72).toFixed(3));
      }

      // --- Accesorios por estado (aparecen y desaparecen con transición elástica) ---
      // Burbuja de pensamiento con tres puntos que rebotan en secuencia
      setProp(
        bubbleRef.current,
        popBubble.x,
        `translate(150 ${(58 + bob * 0.6).toFixed(2)}) scale($S)`
      );
      dotRefs.current.forEach((el, i) => {
        if (!el) return;
        const k = Math.max(0, Math.sin(t * 6 - i * 0.9));
        el.setAttribute("cy", (-21 - 4.5 * k).toFixed(2));
        el.setAttribute("opacity", (0.45 + 0.55 * k).toFixed(3));
      });

      // Signo de alerta que late
      setProp(
        bangRef.current,
        popBang.x,
        `translate(172 ${(52 + bob).toFixed(2)}) rotate(${(8 * Math.sin(t * 14)).toFixed(1)}) scale(${(
          1 + 0.12 * Math.sin(t * 9)
        ).toFixed(3)}) scale($S)`
      );

      // Anillo planetario de sincronización: gira inclinado alrededor de la cintura de Xox.
      // La mitad trasera se ve a través del cristal y la delantera pasa por encima del cuerpo.
      if (popSync.x > 0.002) {
        a.syncAngle += dt * (a.reduce ? 55 : 132);
        const s = Math.max(popSync.x, 0.0001);
        const ringY = y + 8;
        const ringT = `translate(${C} ${ringY.toFixed(2)}) rotate(${SYNC_TILT}) scale(${s.toFixed(4)} ${(s * SYNC_FLAT).toFixed(4)})`;
        const ringOp = clamp(popSync.x * 1.4, 0, 1);
        syncRingRefs.current[0]?.setAttribute("transform", ringT);
        syncRingRefs.current[1]?.setAttribute("transform", ringT);
        // La mitad trasera queda más tenue: está lejos y se ve a través del cristal
        syncBackRef.current?.setAttribute("opacity", (ringOp * 0.5).toFixed(3));
        syncFrontRef.current?.setAttribute("opacity", ringOp.toFixed(3));
        syncSpinRef.current?.setAttribute("transform", `rotate(${(a.syncAngle % 360).toFixed(2)})`);
        // Puntas de flecha calculadas en espacio de pantalla para que la perspectiva no las aplaste
        const cosT = Math.cos(toRad(SYNC_TILT));
        const sinT = Math.sin(toRad(SYNC_TILT));
        for (let k = 0; k < 2; k++) {
          const phi = toRad(a.syncAngle + 120 + k * 180);
          const lx = SYNC_R * Math.cos(phi) * s;
          const ly = SYNC_R * Math.sin(phi) * s * SYNC_FLAT;
          const dx0 = -Math.sin(phi);
          const dy0 = Math.cos(phi) * SYNC_FLAT;
          const ang = (Math.atan2(dx0 * sinT + dy0 * cosT, dx0 * cosT - dy0 * sinT) * 180) / Math.PI;
          const depth = 0.5 + 0.5 * Math.sin(phi);
          const hs = s * (0.8 + 0.32 * depth);
          const tr = `translate(${(C + lx * cosT - ly * sinT).toFixed(2)} ${(ringY + lx * sinT + ly * cosT).toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${hs.toFixed(3)})`;
          const inFront = Math.sin(phi) > 0;
          syncHeadRefs.current[k]?.setAttribute("transform", tr);
          syncHeadRefs.current[k]?.setAttribute("opacity", inFront ? "0" : "0.8");
          syncHeadRefs.current[k + 2]?.setAttribute("transform", tr);
          syncHeadRefs.current[k + 2]?.setAttribute("opacity", inFront ? "1" : "0");
        }
        if (!syncShown) {
          syncBackRef.current?.setAttribute("display", "inline");
          syncFrontRef.current?.setAttribute("display", "inline");
          syncShown = true;
        }
      } else if (syncShown) {
        syncBackRef.current?.setAttribute("display", "none");
        syncFrontRef.current?.setAttribute("display", "none");
        syncShown = false;
      }

      // --- Mini-laptop flotante abajo a la derecha, de cara a Xox y sin taparle el rostro ---
      if (laptopRef.current) {
        const lapPop = Math.max(popLaptop.x, 0.0001) * 0.92;
        const lapX = C + 46 + 1.6 * Math.sin(t * 0.9) * A;
        const lapHoverY = y + 40 + (1 - clamp(popLaptop.x, 0, 1)) * 14 + 1.8 * Math.sin(t * 2.2) * A;
        const lapRot = -6 + 1.2 * Math.sin(t * 1.7) * A;
        laptopRef.current.setAttribute(
          "transform",
          `translate(${lapX.toFixed(2)} ${lapHoverY.toFixed(2)}) rotate(${lapRot.toFixed(2)}) scale(${lapPop.toFixed(4)})`
        );
        laptopRef.current.setAttribute("opacity", clamp(popLaptop.x * 1.35, 0, 1).toFixed(3));
      }
      if (laptopLidRef.current) {
        // Pantalla en perspectiva 3/4 fija, girada hacia Xox
        const lidSy = Math.max(0.06, lidOpen.x);
        const lidSkew = -9 + (1 - clamp(lidOpen.x, 0, 1)) * 14;
        laptopLidRef.current.setAttribute(
          "transform",
          `skewX(${lidSkew.toFixed(1)}) scale(1 ${lidSy.toFixed(3)})`
        );
      }
      if (wCode > 0.01) {
        // Alternancia suave entre vista de editor de código y vista de consola/terminal
        laptopCodeGroupRef.current?.setAttribute("opacity", (1 - wTerm).toFixed(3));
        laptopTermGroupRef.current?.setAttribute("opacity", wTerm.toFixed(3));

        // Destello telequinético en las teclas de la base mientras Xox programa
        laptopKeyGlowRefs.current.forEach((kEl, idx) => {
          if (!kEl) return;
          const activeKey = (Math.floor(t * 13) + idx * 2) % 7 === 0;
          kEl.setAttribute("opacity", activeKey ? "0.95" : "0.28");
          kEl.setAttribute("fill", activeKey ? cAccessory : "#94A3B8");
        });

        // La luz de la pantalla baña el cristal por abajo a la derecha (verde al pasar, rojo al fallar)
        const termOkNow = isTermPhase && isTermDoneOk;
        if (screenLightRef.current) {
          const flicker = 0.5 + 0.5 * Math.sin(t * 13) * Math.sin(t * 7.3);
          screenLightRef.current.setAttribute("opacity", (wCode * (0.62 + 0.18 * flicker + (termOkNow || isTermErr ? 0.2 : 0))).toFixed(3));
          sr.screenLight?.setAttribute("stop-color", isTermErr && isTermPhase ? "#F87171" : termOkNow ? "#6EE7B7" : cAccessory);
        }
        // "¡Ajá!": destellitos discretos cuando la terminal pasa
        if (termOkNow && !prevTermOk) {
          a.sparkleBurstAt = t;
          a.sparkleScale = 0.55;
        }
        prevTermOk = termOkNow;

        // Animación de escritura de líneas de código, barra de línea activa y cursor parpadeante
        const typeCycle = (t * 1.55) % 4;
        const activeRow = Math.floor(typeCycle);
        const rowFrac = typeCycle - activeRow;
        const primaryWidths = [9.5, 7.5, 11.0, 8.5];
        const secondaryWidths = [13.5, 11.0, 9.5, 12.0];
        const rowIndents = [-14.5, -11.0, -11.0, -14.5];
        const rowYs = [-21.6, -16.8, -12.0, -7.2];

        if (laptopActiveLineRef.current) {
          laptopActiveLineRef.current.setAttribute("y", (rowYs[activeRow] - 1.1).toFixed(2));
        }

        laptopCodeLineRefs.current.forEach((lineEl, rIdx) => {
          if (!lineEl) return;
          const pMax = primaryWidths[rIdx] ?? 9;
          const sMax = secondaryWidths[rIdx] ?? 11;
          const totalMax = pMax + 1.6 + sMax;
          const progress =
            rIdx < activeRow
              ? 1
              : rIdx === activeRow
                ? smooth01(0, 0.86, rowFrac)
                : 0.22;
          const curTotal = totalMax * progress;
          const pW = clamp(curTotal, 2.2, pMax);
          const sW = clamp(curTotal - pMax - 1.6, 0, sMax);
          lineEl.setAttribute("width", pW.toFixed(2));
          lineEl.setAttribute("opacity", rIdx <= activeRow ? "0.95" : "0.28");
          const secEl = laptopCodeSecRefs.current[rIdx];
          if (secEl) {
            secEl.setAttribute("x", (rowIndents[rIdx] + pMax + 1.6).toFixed(2));
            secEl.setAttribute("width", sW.toFixed(2));
            secEl.setAttribute("opacity", sW > 0.4 && rIdx <= activeRow ? "0.88" : "0");
          }
        });
        if (laptopCaretRef.current) {
          const rIdx = clamp(activeRow, 0, 3);
          const pMax = primaryWidths[rIdx] ?? 9;
          const sMax = secondaryWidths[rIdx] ?? 11;
          const curTotal = (pMax + 1.6 + sMax) * smooth01(0, 0.86, rowFrac);
          laptopCaretRef.current.setAttribute("x", (rowIndents[rIdx] + curTotal + 0.9).toFixed(2));
          laptopCaretRef.current.setAttribute("y", (rowYs[rIdx] - 0.5).toFixed(2));
          laptopCaretRef.current.setAttribute(
            "opacity",
            Math.sin(t * 16) > -0.2 ? "0.98" : "0.15"
          );
          laptopCaretRef.current.setAttribute("fill", "#FFFFFF");
        }

        // Animación de terminal: comando escribiéndose + líneas de respuesta + badge de estado
        const termLocalT = tf ? clamp(t - a.termPulseAt, 0, 3) : Math.max(0, autoCycle - 3.4);
        const cmdProgress = smooth01(0, 0.65, termLocalT);
        laptopTermCmdRef.current?.setAttribute("width", (4 + 20 * cmdProgress).toFixed(2));
        laptopTermCmdRef.current?.setAttribute("fill", "#FFFFFF");

        const outWidths = [25, 19, 22];
        laptopTermOutRefs.current.forEach((oEl, idx) => {
          if (!oEl) return;
          const appear = smooth01(0.5 + idx * 0.26, 0.86 + idx * 0.26, termLocalT);
          oEl.setAttribute("width", (outWidths[idx] * appear).toFixed(2));
          oEl.setAttribute("opacity", (0.9 * appear).toFixed(3));
          oEl.setAttribute(
            "fill",
            isTermErr && idx === 2
              ? "#FCA5A5"
              : isTermDoneOk && idx === 2
                ? "#6EE7B7"
                : idx === 0
                  ? cRim1
                  : "#CBD5E1"
          );
        });

        if (laptopTermBadgeRef.current && laptopTermCheckRef.current) {
          const badgePop = isTermDoneOk || isTermErr ? smooth01(1.2, 1.55, termLocalT) : 0;
          laptopTermBadgeRef.current.setAttribute(
            "fill",
            isTermErr ? "#EF4444" : "#10B981"
          );
          laptopTermBadgeRef.current.setAttribute("opacity", badgePop.toFixed(3));
          laptopTermCheckRef.current.setAttribute("opacity", badgePop.toFixed(3));
        }
      } else {
        screenLightRef.current?.setAttribute("opacity", "0");
        prevTermOk = false;
      }

      // --- Rostro: mirada, pupila viva ("ojo dentro del ojo") y gestos coherentes ---
      const bt = t - blinkStart;
      let blink = 0;
      if (bt >= 0) {
        if (bt < BLINK_CLOSE) blink = smooth01(0, BLINK_CLOSE, bt);
        else if (bt < BLINK_CLOSE + blinkHold) blink = 1;
        else if (bt < BLINK_CLOSE + blinkHold + BLINK_OPEN) {
          blink = 1 - smooth01(0, BLINK_OPEN, bt - BLINK_CLOSE - blinkHold);
        }
      }

      // La carita se rezaga un pelín respecto al cuerpo en los saltos y sigue las líneas al programar
      const combinedJumpVel = jump.v + happyPose.jumpVel * wSucc;
      const faceLag = clamp(-combinedJumpVel * 0.006, -1.7, 1.7) * A;
      const happyFaceY = happyPose.faceLift * wSucc * A;
      faceRef.current?.setAttribute(
        "transform",
        `translate(${(lookX.x * 9 + saccadeX.x * 1.35).toFixed(2)} ${(lookY.x * 6 + saccadeY.x * 0.95 - hover.x * 1.5 + faceLag + happyFaceY).toFixed(2)})`
      );
      const sep = 8 * (1 - 0.22 * Math.abs(lookX.x));
      const eyeAlertScale = 1 + 0.15 * wAlert;
      const blinkScaleY = (1 - 0.92 * blink) * (1 + hover.x * 0.08) * eyeAlertScale;
      const lsx = (1 - Math.max(0, -lookX.x) * 0.3) * (1 + hover.x * 0.06);
      const rsx = (1 - Math.max(0, lookX.x) * 0.3) * (1 + hover.x * 0.06);
      eyeLRef.current?.setAttribute(
        "transform",
        `translate(${(C - sep).toFixed(2)} ${C - 3}) scale(${lsx.toFixed(3)} ${blinkScaleY.toFixed(3)})`
      );
      eyeRRef.current?.setAttribute(
        "transform",
        `translate(${(C + sep).toFixed(2)} ${C - 3}) scale(${rsx.toFixed(3)} ${blinkScaleY.toFixed(3)})`
      );

      // Lupa de cristal que barre de un ojo al otro: dentro del lente se re-dibuja la carita aumentada
      if (lensRef.current) {
        if (popLens.x > 0.002) {
          const settle = 1 - clamp(popLens.x, 0, 1);
          // Arco de péndulo: baja un poco al cruzar por el centro, como llevada a mano
          const lx = C + lensScanU * (sep + 0.3) + settle * 8;
          const ly = C - 3.4 + 1.6 * (1 - lensScanU * lensScanU) + 0.4 * Math.cos(t * 2.1) * A + settle * 14;
          // Por inercia el lente se queda atrás y el mango se adelanta en la dirección del barrido
          const lensTilt = clamp(-lensScanVel * 3.2, -10, 10) * A + settle * 25;
          lensRef.current.setAttribute(
            "transform",
            `translate(${lx.toFixed(2)} ${ly.toFixed(2)}) rotate(${lensTilt.toFixed(1)}) scale(${Math.max(popLens.x, 0.0001).toFixed(4)})`
          );
          lensRef.current.setAttribute("opacity", clamp(popLens.x * 1.6, 0, 1).toFixed(3));
          lensMagRef.current?.setAttribute(
            "transform",
            `rotate(${(-lensTilt).toFixed(1)}) scale(${LENS_MAG}) translate(${(-lx).toFixed(2)} ${(-ly).toFixed(2)})`
          );
          if (!lensShown) {
            lensRef.current.setAttribute("display", "inline");
            lensShown = true;
          }
        } else if (lensShown) {
          lensRef.current.setAttribute("display", "none");
          lensShown = false;
        }
      }

      // Ojos limpios de cristal luminoso sin pupila (cápsulas expresivas con squint suave)
      const rxL = clamp(3.45 - squintL.x * 0.3, 3.05, 4.0);
      const ryL = clamp(5.25 * (1 - squintL.x), 3.0, 6.2);
      const rxR = clamp(3.45 - squintR.x * 0.3, 3.05, 4.0);
      const ryR = clamp(5.25 * (1 - squintR.x), 3.0, 6.2);

      eyeScleraLRef.current?.setAttribute("rx", rxL.toFixed(2));
      eyeScleraLRef.current?.setAttribute("ry", ryL.toFixed(2));
      eyeScleraRRef.current?.setAttribute("rx", rxR.toFixed(2));
      eyeScleraRRef.current?.setAttribute("ry", ryR.toFixed(2));

      // Transición continua entre ojos abiertos y arcos felices cálidos (◠ ◠)
      const openEyeOp = clamp(1 - smooth01(0.14, 0.66, wSucc), 0, 1);
      const openEyeSquashY = Math.max(0.18, 1 - 0.78 * wSucc);
      const happyEyeOp = clamp(smooth01(0.12, 0.68, wSucc), 0, 1);
      // Los arcos felices se redondean más en el ápice del salto y se acolchan suavemente al aterrizar
      const happyCushion = clamp(-happyDef * 6, 0, 1.1) * wSucc;
      const ctrlYInner = -0.8 - (4.5 + 0.9 * airborne - 1.1 * happyCushion) * wSucc;
      const ctrlYOuter = -0.6 - (4.2 + 0.8 * airborne - 1.0 * happyCushion) * wSucc;
      const innerEndY = 1.35 - 0.9 * (1 - wSucc);
      const outerEndY = 1.9 - 1.1 * (1 - wSucc);
      const happyArcLD = `M -4.35 ${outerEndY.toFixed(2)} C -2.35 ${ctrlYOuter.toFixed(2)} 2.15 ${ctrlYInner.toFixed(2)} 4.15 ${innerEndY.toFixed(2)}`;
      const happyArcRD = `M -4.15 ${innerEndY.toFixed(2)} C -2.15 ${ctrlYInner.toFixed(2)} 2.35 ${ctrlYOuter.toFixed(2)} 4.35 ${outerEndY.toFixed(2)}`;

      eyeOpenLRef.current?.setAttribute("opacity", openEyeOp.toFixed(3));
      eyeOpenLRef.current?.setAttribute("transform", `scale(1 ${openEyeSquashY.toFixed(3)})`);
      eyeOpenRRef.current?.setAttribute("opacity", openEyeOp.toFixed(3));
      eyeOpenRRef.current?.setAttribute("transform", `scale(1 ${openEyeSquashY.toFixed(3)})`);
      eyeHappyLRef.current?.setAttribute("d", happyArcLD);
      eyeHappyLRef.current?.setAttribute("opacity", happyEyeOp.toFixed(3));
      eyeHappyRRef.current?.setAttribute("d", happyArcRD);
      eyeHappyRRef.current?.setAttribute("opacity", happyEyeOp.toFixed(3));

      // --- Boca coherente con cada fase: una sola curva paramétrica que se transforma con resortes ---
      // (concentrada al editar, expectante en terminal, sonriente al terminar o tras despedir un saludo)
      const codingMouthWeight = wCode * 0.92;
      const postTalkSmile =
        t < a.postTalkSmileUntil
          ? (1 - smooth01(a.postTalkSmileUntil - 0.45, a.postTalkSmileUntil, t)) * 0.9
          : 0;
      const dragSmile = dragging ? smooth01(0.15, 0.65, dragSpeed) * 0.72 : 0;
      // Hablar y festejar usan la boca abierta; la línea se desvanece mientras tanto
      const openMouthW = clamp(Math.max(wTalk, wSucc), 0, 1);
      const smileTargetWeight =
        Math.max(hover.x * 0.85, codingMouthWeight, wRead * 0.9, wSync * 0.6, postTalkSmile, dragSmile) *
        (1 - openMouthW);
      if (mouthRef.current) {
        // Boca genérica (hover / celebración), expresada en los mismos parámetros
        const genW = 3.0 + 1.5 * wSucc;
        const genY = 6.5 - 0.5 * wSucc;
        const genBend = 2.5 + 2.6 * wSucc;
        const wm = smooth01(0.1, 0.6, wCode + wRead) * (1 - smooth01(0.1, 0.5, wSucc));
        const mW = lerp(genW, focusMouthW.x, wm);
        const mY = C + lerp(genY, focusMouthY.x, wm);
        const mBend = lerp(genBend, focusMouthBend.x, wm);
        const mTilt = focusMouthTilt.x * wm;
        const mX = C + focusMouthShift.x * wm;
        const yL = mY + mTilt * 0.5;
        const yR = mY - mTilt * 0.5;
        const ctrlY = mY + mBend;
        // Cúbica equivalente a la cuadrática clásica, permitiendo comisuras asimétricas
        const c1y = yL / 3 + (ctrlY * 2) / 3;
        const c2y = yR / 3 + (ctrlY * 2) / 3;
        mouthRef.current.setAttribute(
          "d",
          `M ${(mX - mW).toFixed(2)} ${yL.toFixed(2)} C ${(mX - mW / 3).toFixed(2)} ${c1y.toFixed(2)} ${(mX + mW / 3).toFixed(2)} ${c2y.toFixed(2)} ${(mX + mW).toFixed(2)} ${yR.toFixed(2)}`
        );
        mouthRef.current.setAttribute("opacity", clamp(smileTargetWeight, 0, 0.94).toFixed(3));

        // Lengüita de concentración asomando por la comisura baja mientras edita código
        const editingCode = coding && (shownExpr === "editL" || shownExpr === "editR");
        step(tongueOut, editingCode ? 1 : 0, 120, 16, dt);
        if (tongueRef.current) {
          const tw = clamp(tongueOut.x, 0, 1) * wm;
          if (tw > 0.01) {
            const side = mTilt >= 0 ? -1 : 1;
            const tipX = mX + side * mW * 0.62;
            const tipY = (side > 0 ? yR : yL) + 0.15;
            tongueRef.current.setAttribute(
              "transform",
              `translate(${tipX.toFixed(2)} ${tipY.toFixed(2)}) rotate(${(side * 14 + 7 * Math.sin(t * 3.1) * A).toFixed(1)}) scale(${(0.6 + 0.4 * tw).toFixed(3)} ${tw.toFixed(3)})`
            );
            tongueRef.current.setAttribute("opacity", clamp(tw * 1.3, 0, 1).toFixed(3));
          } else {
            tongueRef.current.setAttribute("opacity", "0");
          }
        }
      }

      // Gota de sudor "¡ups!" cuando la terminal devuelve error
      step(sweatDrop, coding && isTermPhase && isTermErr ? 1 : 0, 140, 15, dt);
      if (sweatRef.current) {
        const sw = clamp(sweatDrop.x, 0, 1.15);
        if (sw > 0.01) {
          const slide = ((t * 0.7) % 1) * 3.2 * A;
          sweatRef.current.setAttribute(
            "transform",
            `translate(${(C + 21).toFixed(2)} ${(C - 15 + slide).toFixed(2)}) scale(${sw.toFixed(3)})`
          );
          sweatRef.current.setAttribute("opacity", clamp(sw * 1.2, 0, 0.95).toFixed(3));
        } else {
          sweatRef.current.setAttribute("opacity", "0");
        }
      }

      // --- Boca blanca luminosa al hablar (sílabas vivas) o sonrisa radiante limpia al festejar ---
      if (talkMouthGroupRef.current) {
        if (openMouthW > 0.01) {
          const happyPure = wSucc * (1 - wTalk);
          const mouthCy = C + 6.4 - 0.4 * happyPure;
          const mouthD = buildOrganicTalkMouthPath(C, mouthCy, mHalfW, mOpen, smileLift);
          talkMouthPathRef.current?.setAttribute("d", mouthD);
          talkMouthClipPathRef.current?.setAttribute("d", mouthD);
          // Borde superior luminoso en sonrisa cálida
          const xL = (C - mHalfW).toFixed(2);
          const xR = (C + mHalfW).toFixed(2);
          const { yCorner, yTopCtrl } = calcTalkMouthTop(mouthCy, mOpen, smileLift);
          talkUpperLipRef.current?.setAttribute(
            "d",
            `M ${xL} ${yCorner.toFixed(2)} Q ${C} ${yTopCtrl.toFixed(2)} ${xR} ${yCorner.toFixed(2)}`
          );
          // En Feliz mantiene una sonrisa limpia con sutil rubor rosado inferior (sin mancha oscura interna)
          talkInnerShadeRef.current?.setAttribute("cy", (mouthCy + 1.4 + mOpen * 2.2).toFixed(2));
          talkInnerShadeRef.current?.setAttribute("rx", (mHalfW * 0.80).toFixed(2));
          talkInnerShadeRef.current?.setAttribute("ry", (1.1 + mOpen * 2.4).toFixed(2));
          talkInnerShadeRef.current?.setAttribute("opacity", (0.28 * (1 - 0.78 * happyPure)).toFixed(3));
          talkTongueRef.current?.setAttribute("cy", (mouthCy + 2.8 + mOpen * 3.6).toFixed(2));
          talkTongueRef.current?.setAttribute("rx", (mHalfW * 0.60).toFixed(2));
          talkTongueRef.current?.setAttribute("ry", (1.0 + mOpen * 1.65).toFixed(2));
          talkTongueRef.current?.setAttribute("opacity", lerp(0.72, 0.44, happyPure).toFixed(3));
          talkMouthGroupRef.current.setAttribute("opacity", clamp(openMouthW * 1.08, 0, 1).toFixed(3));
        } else {
          talkMouthGroupRef.current.setAttribute("opacity", "0");
        }
      }

      if (talkWaveRef.current) {
        const waveEnergy = clamp(mOpen * 1.15, 0, 1);
        const waveScale = Math.max(wTalk * (0.86 + 0.2 * waveEnergy), 0.0001);
        talkWaveRef.current.setAttribute(
          "transform",
          `translate(${(C + 68).toFixed(2)} ${(y - 8 + 1.8 * Math.sin(t * 6.5)).toFixed(2)}) scale(${waveScale.toFixed(4)})`
        );
        talkWaveRef.current.setAttribute(
          "opacity",
          (wTalk * (0.26 + 0.74 * waveEnergy)).toFixed(3)
        );
        // Propagación escalonada en las 3 ondas de voz
        const w1 = 0.5 + 0.5 * Math.sin(t * 14);
        const w2 = 0.5 + 0.5 * Math.sin(t * 14 - 1.1);
        const w3 = 0.5 + 0.5 * Math.sin(t * 14 - 2.2);
        talkWave1Ref.current?.setAttribute("opacity", (0.55 + 0.45 * w1).toFixed(3));
        talkWave2Ref.current?.setAttribute("opacity", (0.35 + 0.5 * w2).toFixed(3));
        talkWave3Ref.current?.setAttribute("opacity", (0.2 + 0.45 * w3).toFixed(3));
      }

      // Mejillas con sonrojo orgánico (expansión cálida, elevación y pulso suave)
      const bAmt = clamp(blush.x, 0, 1.15);
      const bNorm = clamp(bAmt, 0, 1);
      const blushBreath = bAmt > 0.3 && !a.reduce ? 1 + 0.045 * Math.sin(t * 6.4) : 1;
      const cheekSep = 14.2 * (1 - 0.14 * Math.abs(lookX.x)) + 0.7 * bNorm;
      const cheekY = C + 5.2 - 1.5 * bNorm;
      const cheekSxBase = (0.72 + 0.30 * bAmt) * blushBreath;
      const cheekSy = (0.68 + 0.30 * bAmt) * blushBreath;
      const cheekOpacity = bNorm <= 0.01 ? "0" : clamp(bNorm * 0.66, 0, 0.68).toFixed(3);
      cheekLRef.current?.setAttribute(
        "transform",
        `translate(${(C - cheekSep).toFixed(2)} ${cheekY.toFixed(2)}) scale(${(cheekSxBase * lsx).toFixed(3)} ${cheekSy.toFixed(3)})`
      );
      cheekLRef.current?.setAttribute("opacity", cheekOpacity);
      cheekRRef.current?.setAttribute(
        "transform",
        `translate(${(C + cheekSep).toFixed(2)} ${cheekY.toFixed(2)}) scale(${(cheekSxBase * rsx).toFixed(3)} ${cheekSy.toFixed(3)})`
      );
      cheekRRef.current?.setAttribute("opacity", cheekOpacity);

      // --- Chispas en órbita elíptica continua (vivas durante el vuelo y desaceleran con suavidad al aterrizar) ---
      const colorOrbitBoost =
        colorMorphActive && !a.reduce ? 1.8 * Math.sin(colorMorphPhase * Math.PI) : 0;
      const orbitBoost =
        1 +
        1.2 * wThink +
        0.45 * wTalk +
        0.55 * wCode +
        (dragging ? dragSpeed * 4.2 : 0) +
        landingEnergy * 3.0 +
        colorOrbitBoost;
      a.sparkPhase += dt * orbitBoost;
      sparkRefs.current.forEach((el, i) => {
        if (!el) return;
        const ang = a.sparkPhase * (0.35 + i * 0.12) + i * 2.094;
        const radius =
          92 +
          5 * Math.sin(t * 1.3 + i) +
          (dragging ? 7 * dragSpeed : 0) +
          landingEnergy * 5 +
          (colorMorphActive && !a.reduce ? 6 * Math.sin(colorMorphPhase * Math.PI) : 0);
        const trailX = dragging ? -dragNx * (14 + i * 5) * A : 0;
        const trailY = dragging ? -dragNy * (9 + i * 4) * A : 0;
        const depth = 0.5 + 0.5 * Math.sin(ang); // 0 = atrás, 1 = adelante
        const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        const sparkOp = clamp(
          (0.2 + 0.6 * twinkle) * (0.45 + 0.55 * depth) + (dragging ? 0.22 * dragSpeed : 0) + landingEnergy * 0.16,
          0,
          0.98
        );
        el.setAttribute("cx", (C + Math.cos(ang) * radius + trailX).toFixed(2));
        el.setAttribute("cy", (C + bob * 0.5 + totalJumpY * 0.35 + Math.sin(ang) * radius * 0.5 + trailY).toFixed(2));
        el.setAttribute("opacity", sparkOp.toFixed(3));
        el.setAttribute("r", (1.2 + 0.9 * depth + landingEnergy * 0.35).toFixed(2));
        el.setAttribute("fill", i === 1 ? cAccessory : i === 2 ? cRim1 : "#FFFFFF");
      });

      // --- Destellos prismáticos escalonados de festejo (dos oleadas rítmicas en `success` + ráfaga en terminal ok) ---
      const extBurstP = (t - a.sparkleBurstAt) / 1.05;
      const hasExtBurst = !succeeding && extBurstP >= 0 && extBurstP <= 1;
      if ((wSucc > 0.04 || hasExtBurst) && !a.reduce) {
        const uCycle = happyPose.cycleTime;
        cheerSparkRefs.current.forEach((el, i) => {
          if (!el) return;
          let localP = -1;
          let waveScale = 1;
          if (wSucc > 0.04) {
            // Oleada 1: brota escalonada durante el gran salto; Oleada 2: centellea suave en el rebote y bailecito
            const stagger = (i % 4) * 0.045 + (i >= 4 ? 0.022 : 0);
            const p1 = (uCycle - (0.14 + stagger)) / 0.88;
            const p2 = i % 2 === 0 ? (uCycle - (0.82 + stagger * 1.1)) / 0.86 : -1;
            if (p1 >= 0 && p1 <= 1) {
              localP = p1;
              waveScale = wSucc;
            } else if (p2 >= 0 && p2 <= 1) {
              localP = p2;
              waveScale = wSucc * 0.72;
            }
          } else if (hasExtBurst) {
            localP = clamp((extBurstP - (i % 3) * 0.04) / 0.92, 0, 1);
            waveScale = a.sparkleScale;
          }

          if (localP > 0 && localP < 1) {
            const reachOut = 1 - Math.pow(1 - localP, 2.7);
            const ang = toRad(CHEER_SPARKLES[i] + 6 * Math.sin(i * 2.1 + localP * 2.4));
            const dist = (52 + (i % 2 === 0 ? 40 : 28) * reachOut) * (0.8 + 0.2 * waveScale);
            const floatUp = -9.5 * reachOut;
            const life = Math.sin(Math.PI * Math.pow(localP, 0.65));
            const s = life * (i % 2 === 0 ? 1.08 : 0.76) * waveScale;
            el.setAttribute(
              "transform",
              `translate(${(C + Math.cos(ang) * dist).toFixed(2)} ${(y + Math.sin(ang) * dist * 0.9 + floatUp).toFixed(2)}) rotate(${(localP * 92 + i * 22).toFixed(1)}) scale(${Math.max(s, 0.0001).toFixed(3)})`
            );
            el.setAttribute("opacity", clamp(life * 1.28, 0, 1).toFixed(3));
            el.setAttribute("fill", i % 3 === 0 ? "#FFFFFF" : i % 3 === 1 ? cAccessory : cRim1);
          } else {
            el.setAttribute("opacity", "0");
          }
        });
        sparklesShown = true;
      } else if (sparklesShown) {
        cheerSparkRefs.current.forEach((el) => el?.setAttribute("opacity", "0"));
        sparklesShown = false;
      }

      // Comparte fase viva para relevos sin cortes entre Chat <-> Vuelo <-> Espacio de Xox
      sharedXoxPhase.t = t;
      sharedXoxPhase.starPhase = a.starPhase;
      sharedXoxPhase.sparkPhase = a.sparkPhase;
      sharedXoxPhase.updatedAt = now;

      // --- Satélites orbitales de sub-agentes activos (mini-Xox pequeños con cristal nítido) ---
      const currentSubs = subagentsRef.current ?? [];
      if (currentSubs.length > 0) {
        const satTotal = Math.min(currentSubs.length, 6);
        const anyRunning = currentSubs.some((s) => s.status === "running");
        const satSpeed = anyRunning ? 0.68 : 0.24;
        subagentSatRefs.current.forEach((el, i) => {
          if (!el || i >= satTotal) return;
          const sat = currentSubs[i];
          const isRunning = sat.status === "running";
          const isDone = sat.status === "done";
          const ang = (a.reduce ? 0 : t * satSpeed) + (i / satTotal) * Math.PI * 2;
          const rx = 98;
          const ry = 52;
          const sx = C + Math.cos(ang) * rx;
          const sy = C + bob * 0.42 + Math.sin(ang) * ry;
          const depth = 0.5 + 0.5 * Math.sin(ang);
          const pulse = isRunning && !a.reduce ? 1 + 0.12 * Math.sin(t * 6.2 + i) : 1;
          const satScale = (0.76 + 0.24 * depth) * pulse;
          const satOp = isDone
            ? 0.80 + 0.20 * depth
            : isRunning
              ? 0.90 + 0.10 * depth
              : 0.68 + 0.26 * depth;
          el.setAttribute(
            "transform",
            `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${satScale.toFixed(3)})`
          );
          el.setAttribute("opacity", satOp.toFixed(3));
        });
      }

      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (!document.hidden && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    raf = requestAnimationFrame(frame);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
      summonSilhouetteRef.current?.setAttribute("display", "none");
    };
  }, [active]);

  const handleActivate = () => {
    const a = anim.current;
    if (clickBehavior === "greet") {
      // Saludo carismático: impulso alegre + ola con la punta superior derecha + rubor cálido (sin giro 360° al hablar)
      const isIdleNow = stateRef.current === "idle";
      a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 2.8);
      a.blushPeak = Math.max(a.blushPeak, 0.78);
      a.waveStart = a.t;
      if (!a.reduce) {
        a.squashKick += isIdleNow ? 2.1 : 1.0;
        a.jumpKick -= isIdleNow ? 112 : 45;
        a.blushKick += 1.15;
      }
    } else {
      a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 2.6);
      a.blushPeak = 1;
      if (!a.reduce) a.blushKick += 1.6;
      triggerSpin();
    }
    onClick?.();
  };

  const triggerWave = () => {
    hoverRef.current = true;
    const a = anim.current;
    if (a.t - a.waveStart > 4) a.waveStart = a.t; // saluda con la punta estelar
  };

  const starOnlyHit = hitArea === "star";

  return (
    <div
      ref={wrapRef}
      role={starOnlyHit ? undefined : "button"}
      tabIndex={starOnlyHit ? undefined : 0}
      aria-label={starOnlyHit ? undefined : "Xox, copiloto estelar. Haz clic para saludar."}
      title={starOnlyHit ? undefined : "Xox · Copiloto Estelar"}
      onClick={starOnlyHit ? undefined : handleActivate}
      onKeyDown={
        starOnlyHit
          ? undefined
          : (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleActivate();
            }
          }
      }
      onPointerEnter={starOnlyHit ? undefined : triggerWave}
      onPointerLeave={
        starOnlyHit
          ? undefined
          : () => {
            hoverRef.current = false;
          }
      }
      className={`relative inline-block select-none ${starOnlyHit
        ? "pointer-events-none"
        : "rounded-full cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-indigo-300/45"
        } ${className}`}
      style={responsive ? undefined : { width: size, height: size }}
    >
      {starOnlyHit && (
        <button
          type="button"
          aria-label="Xox, copiloto estelar. Haz clic para saludar."
          onClick={handleActivate}
          onPointerEnter={triggerWave}
          onPointerLeave={() => {
            hoverRef.current = false;
          }}
          className="appearance-none pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[56%] h-[56%] rounded-full cursor-pointer bg-transparent border-0 p-0 outline-none focus-visible:ring-1 focus-visible:ring-indigo-300/45 z-10"
        />
      )}
      <svg
        key={XOX_SVG_REV}
        viewBox="0 0 240 240"
        width={responsive ? undefined : size}
        height={responsive ? undefined : size}
        className={responsive ? "w-full h-full block" : undefined}
        aria-hidden="true"
      >
        <defs>
          {/* Cuerpo de cristal líquido ultra-transparente: centro limpio sobre negro y refracción sólo en las curvas */}
          <linearGradient id={ids.body} x1="60" y1="48" x2="180" y2="192" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.26" : "0.13"} />
            <stop ref={(el) => { stopRefs.current.bodyTint = el; }} offset="19%" stopColor={initialColors.bodyTint} stopOpacity={glassContrast ? "0.14" : "0.065"} />
            <stop
              ref={(el) => { stopRefs.current.bodyMid = glassContrast ? null : el; }}
              offset="50%"
              stopColor={glassContrast ? "#050814" : initialColors.mid}
              stopOpacity={glassContrast ? "0.18" : "0.025"}
            />
            <stop ref={(el) => { stopRefs.current.bodyGlow = el; }} offset="82%" stopColor={initialColors.bodyGlow} stopOpacity={glassContrast ? "0.17" : "0.085"} />
            <stop ref={(el) => { stopRefs.current.bodyRimEnd = el; }} offset="100%" stopColor={initialColors.rim2} stopOpacity={glassContrast ? "0.26" : "0.16"} />
          </linearGradient>
          {/* Filo Fresnel nítido de cristal pulido: destello húmedo arriba-izq y rebote óptico abajo-der */}
          <linearGradient ref={rimGradRef} id={ids.rim} x1="56" y1="46" x2="184" y2="194" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.98" : "0.93"} />
            <stop ref={(el) => { stopRefs.current.rim1 = el; }} offset="22%" stopColor={initialColors.rim1} stopOpacity={glassContrast ? "0.66" : "0.50"} />
            <stop ref={(el) => { stopRefs.current.rimMid = el; }} offset="52%" stopColor={initialColors.rim2} stopOpacity={glassContrast ? "0.34" : "0.22"} />
            <stop ref={(el) => { stopRefs.current.rim2 = el; }} offset="80%" stopColor={initialColors.rim2} stopOpacity={glassContrast ? "0.64" : "0.48"} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.80" : "0.68"} />
          </linearGradient>
          {/* Menisco interno sutil por tensión superficial (sin velar ni blanquear el cristal) */}
          <linearGradient id={ids.meniscus} x1="58" y1="48" x2="182" y2="192" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.65" />
            <stop ref={(el) => { stopRefs.current.meniscus1 = el; }} offset="26%" stopColor={initialColors.rim1} stopOpacity="0.44" />
            <stop ref={(el) => { stopRefs.current.meniscusMid = el; }} offset="54%" stopColor={initialColors.bodyGlow} stopOpacity="0.10" />
            <stop ref={(el) => { stopRefs.current.meniscus2 = el; }} offset="82%" stopColor={initialColors.rim2} stopOpacity="0.46" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.52" />
          </linearGradient>
          {/* Surco oscuro fino de refracción pegado al borde (espesor de vidrio limpio sin doble línea pesada) */}
          <linearGradient id={ids.refractCrease} x1="58" y1="50" x2="182" y2="190" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#040714" stopOpacity="0.14" />
            <stop offset="35%" stopColor="#030612" stopOpacity="0.38" />
            <stop offset="70%" stopColor="#030612" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#040714" stopOpacity="0.16" />
          </linearGradient>
          {/* Bisel cristalino húmedo arriba-izquierda */}
          <linearGradient id={ids.bevel} x1="56" y1="46" x2="148" y2="146" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop ref={(el) => { stopRefs.current.bevelTint = el; }} offset="34%" stopColor={initialColors.rim1} stopOpacity="0.38" />
            <stop offset="68%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          {/* Rebote Fresnel interno abajo-derecha */}
          <linearGradient id={ids.bounce} x1="186" y1="194" x2="94" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.80" />
            <stop ref={(el) => { stopRefs.current.bounceTint = el; }} offset="36%" stopColor={initialColors.rim2} stopOpacity="0.42" />
            <stop offset="68%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          {/* Cáusticas líquidas saturadas y transparentes (cero blanco lechoso en el interior) */}
          <radialGradient id={ids.liquidA} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.liquidA0 = el; }} offset="0%" stopColor={initialColors.bodyTint} stopOpacity={glassContrast ? "0.24" : "0.14"} />
            <stop ref={(el) => { stopRefs.current.liquidA1 = el; }} offset="50%" stopColor={initialColors.rim1} stopOpacity={glassContrast ? "0.10" : "0.055"} />
            <stop ref={(el) => { stopRefs.current.liquidA2 = el; }} offset="100%" stopColor={initialColors.glow} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ids.liquidB} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.liquidB0 = el; }} offset="0%" stopColor={initialColors.bodyGlow} stopOpacity={glassContrast ? "0.30" : "0.20"} />
            <stop ref={(el) => { stopRefs.current.liquidB1 = el; }} offset="52%" stopColor={initialColors.glow} stopOpacity={glassContrast ? "0.13" : "0.08"} />
            <stop ref={(el) => { stopRefs.current.liquidB2 = el; }} offset="100%" stopColor={initialColors.mid} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ids.liquidC} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.liquidC0 = el; }} offset="0%" stopColor={initialColors.rim1} stopOpacity={glassContrast ? "0.22" : "0.16"} />
            <stop ref={(el) => { stopRefs.current.liquidC1 = el; }} offset="52%" stopColor={initialColors.accessory} stopOpacity={glassContrast ? "0.11" : "0.075"} />
            <stop ref={(el) => { stopRefs.current.liquidC2 = el; }} offset="100%" stopColor={initialColors.bodyGlow} stopOpacity="0" />
          </radialGradient>
          {/* Brillo húmedo de agua: velo mínimo + media luna especular concentrada */}
          <radialGradient id={ids.gloss} cx="50%" cy="50%" fx="45%" fy="40%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.15" />
            <stop offset="40%" stopColor="#FFFFFF" stopOpacity="0.055" />
            <stop offset="75%" stopColor="#FFFFFF" stopOpacity="0.012" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={ids.glossSpec} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.44" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.08" />
          </linearGradient>
          {/* Cápsula ocular blanca limpia estilo Liquid Glass (sin pupila) */}
          <linearGradient id={ids.eyeFill} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="100%" stopColor="#EEF2FF" stopOpacity="0.96" />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.core0 = el; }} offset="0%" stopColor={initialColors.core} stopOpacity={glassContrast ? "0.20" : "0.095"} />
            <stop ref={(el) => { stopRefs.current.core1 = el; }} offset="44%" stopColor={initialColors.glow} stopOpacity={glassContrast ? "0.10" : "0.048"} />
            <stop ref={(el) => { stopRefs.current.core2 = el; }} offset="78%" stopColor={initialColors.mid} stopOpacity={glassContrast ? "0.03" : "0.014"} />
            <stop ref={(el) => { stopRefs.current.core3 = el; }} offset="100%" stopColor={initialColors.mid} stopOpacity="0" />
          </radialGradient>
          {/* Halo atmosférico discreto para no levantar velo gris detrás de la gota transparente */}
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.glow0 = el; }} offset="0%" stopColor={initialColors.glow} stopOpacity="0.12" />
            <stop ref={(el) => { stopRefs.current.glow1 = el; }} offset="48%" stopColor={initialColors.bodyGlow} stopOpacity="0.042" />
            <stop ref={(el) => { stopRefs.current.glow2 = el; }} offset="100%" stopColor={initialColors.glow} stopOpacity="0" />
          </radialGradient>
          {/* Sonrojo orgánico difuminado sin bordes duros ni exceso de rojez */}
          <radialGradient id={ids.blush} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.blush0 = el; }} offset="0%" stopColor={initialColors.blush} stopOpacity="0.62" />
            <stop ref={(el) => { stopRefs.current.blush1 = el; }} offset="50%" stopColor={initialColors.blush} stopOpacity="0.24" />
            <stop ref={(el) => { stopRefs.current.blush2 = el; }} offset="100%" stopColor={initialColors.blush} stopOpacity="0" />
          </radialGradient>
          {/* Luz de la pantalla de la laptop reflejada en el cristal (programando) */}
          <radialGradient id={ids.screenLight} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.screenLight = el; }} offset="0%" stopColor={initialColors.accessory} stopOpacity="0.5" />
            <stop offset="55%" stopColor={initialColors.accessory} stopOpacity="0.14" />
            <stop offset="100%" stopColor={initialColors.accessory} stopOpacity="0" />
          </radialGradient>
          {/* Lupa de cristal: fondo del lente, refracción en el borde, aro y mango */}
          <radialGradient id={ids.lensBack} cx="42%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#1E2654" stopOpacity="0.96" />
            <stop offset="100%" stopColor="#0A0E28" stopOpacity="0.97" />
          </radialGradient>
          <radialGradient id={ids.lensEdge} cx="50%" cy="50%" r="50%">
            <stop offset="62%" stopColor={initialColors.rim1} stopOpacity="0" />
            <stop ref={(el) => { stopRefs.current.lensEdge = el; }} offset="100%" stopColor={initialColors.rim1} stopOpacity="0.42" />
          </radialGradient>
          <linearGradient id={ids.lensRim} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop ref={(el) => { stopRefs.current.lensRim1 = el; }} offset="38%" stopColor={initialColors.rim1} stopOpacity="0.95" />
            <stop ref={(el) => { stopRefs.current.lensRim2 = el; }} offset="100%" stopColor={initialColors.rim2} stopOpacity="1" />
          </linearGradient>
          <linearGradient id={ids.lensHandle} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F4F2FF" />
            <stop offset="45%" stopColor={currentColors.rim1} />
            <stop offset="100%" stopColor={currentColors.mid} />
          </linearGradient>
          <clipPath id={ids.lensClip}>
            <circle cx="0" cy="0" r={LENS_R - 0.4} />
          </clipPath>
          {/* Anillo de sincronización: estela que se aviva hacia la punta de cada flecha */}
          <linearGradient id={ids.syncArc} x1={SYNC_R} y1="0" x2={SYNC_R * Math.cos(toRad(120))} y2={SYNC_R * Math.sin(toRad(120))} gradientUnits="userSpaceOnUse">
            <stop ref={(el) => { stopRefs.current.syncArc0 = el; }} offset="0%" stopColor={initialColors.accessory} stopOpacity="0" />
            <stop offset="55%" stopColor={initialColors.accessory} stopOpacity="0.5" />
            <stop ref={(el) => { stopRefs.current.syncArc1 = el; }} offset="100%" stopColor={initialColors.rim1} stopOpacity="1" />
          </linearGradient>
          <radialGradient id={ids.syncHead} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop ref={(el) => { stopRefs.current.syncHead = el; }} offset="42%" stopColor={initialColors.accessory} stopOpacity="0.5" />
            <stop offset="100%" stopColor={initialColors.accessory} stopOpacity="0" />
          </radialGradient>
          {/* Mitad delantera del anillo (en coordenadas del anillo antes de aplastarlo) */}
          <clipPath id={ids.syncFront}>
            <rect x={-SYNC_R - 20} y="0" width={SYNC_R * 2 + 40} height={SYNC_R + 20} />
          </clipPath>
          <clipPath id={ids.bodyClip}>
            <path ref={starClipPathRef} d={initialPath} />
          </clipPath>
          <clipPath id={ids.mouthClip}>
            <path
              ref={talkMouthClipPathRef}
              d={buildOrganicTalkMouthPath(C, C + 7.2, 3.6, 0.2, 0.6)}
            />
          </clipPath>
          {glassContrast && (
            <radialGradient id={ids.cradle} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#050914" stopOpacity="0.56" />
              <stop offset="58%" stopColor="#070C1A" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#070C1A" stopOpacity="0" />
            </radialGradient>
          )}
          {/* Gradientes de cristal translúcido para los mini-Xox en órbita (idéntica receta física que Xox) */}
          {(["star", "orbit", "prism", "shield"] as const).map((d) => {
            const p = SUBAGENT_GLASS_PALETTE[d];
            return (
              <React.Fragment key={d}>
                <linearGradient
                  id={`sat-body-${d}-${uid}`}
                  x1="2"
                  y1="2"
                  x2="18"
                  y2="18"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.34" />
                  <stop offset="42%" stopColor={p.tintHex} stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.22" />
                </linearGradient>
                <radialGradient id={`sat-core-${d}-${uid}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
                  <stop offset="45%" stopColor={p.tintHex} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={p.tintHex} stopOpacity="0" />
                </radialGradient>
              </React.Fragment>
            );
          })}
        </defs>

        {/* Cojín sutil oscuro en Quick Bar para separar a Xox de fondos claros u olas brillantes */}
        {glassContrast && (
          <circle ref={cradleRef} cx={C} cy={C} r="84" fill={`url(#${ids.cradle})`} />
        )}

        {/* Chispas en órbita */}
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            ref={(el) => {
              sparkRefs.current[i] = el;
            }}
            cx={C}
            cy={C}
            r="1.5"
            fill={i === 1 ? initialColors.accessory : i === 2 ? initialColors.rim1 : "#FFFFFF"}
            opacity="0"
          />
        ))}

        {/* Constelación de Sub-Agentes en Órbita (mini-Xox translúcidos) */}
        {subagents && subagents.length > 0 && (
          <>
            <ellipse
              cx={C}
              cy={C}
              rx="98"
              ry="52"
              fill="none"
              stroke="rgba(255,255,255,0.105)"
              strokeWidth="0.75"
              strokeDasharray="2.5 4.5"
            />
            {subagents.slice(0, 6).map((sat, idx) => {
              const design: SubagentDesign =
                sat.design && sat.design in SUBAGENT_GLASS_PALETTE
                  ? (sat.design as SubagentDesign)
                  : "orbit";
              const pal = SUBAGENT_GLASS_PALETTE[design];
              const geom = SUBAGENT_SHAPE_GEOMETRY[design];
              const isRunning = sat.status === "running";
              const rimStroke = isRunning ? "#FFFFFF" : pal.stroke;
              return (
                <g
                  key={sat.id}
                  ref={(el) => {
                    subagentSatRefs.current[idx] = el;
                  }}
                  transform={`translate(${C} ${C})`}
                  opacity="0"
                >
                  <g transform="translate(-10 -10)">
                    <path
                      d={geom.path}
                      fill={`url(#sat-body-${design}-${uid})`}
                      stroke={rimStroke}
                      strokeOpacity={isRunning ? "0.96" : "0.86"}
                      strokeWidth={isRunning ? "1.3" : "1.18"}
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="10"
                      cy={geom.eyeY}
                      r="5.2"
                      fill={`url(#sat-core-${design}-${uid})`}
                    />
                    {geom.ring && (
                      <path
                        d={geom.ring}
                        fill="none"
                        stroke={rimStroke}
                        strokeOpacity={isRunning ? "0.92" : "0.78"}
                        strokeWidth="1.05"
                        strokeLinecap="round"
                      />
                    )}
                    <ellipse
                      cx={geom.sheen.cx}
                      cy={geom.sheen.cy}
                      rx={geom.sheen.rx}
                      ry={geom.sheen.ry}
                      transform={`rotate(${geom.sheen.rot} ${geom.sheen.cx} ${geom.sheen.cy})`}
                      fill="#FFFFFF"
                      opacity="0.26"
                    />
                    <ellipse cx="8.5" cy={geom.eyeY} rx="0.92" ry="1.42" fill="#FFFFFF" fillOpacity="0.98" />
                    <ellipse cx="11.5" cy={geom.eyeY} rx="0.92" ry="1.42" fill="#FFFFFF" fillOpacity="0.98" />
                  </g>
                </g>
              );
            })}
          </>
        )}

        {/* Anillo de datos al pensar (siempre montado para animar su entrada/salida con suavidad) */}
        <ellipse
          ref={ringRef}
          cx="0"
          cy="0"
          rx="86"
          ry="28"
          transform={`translate(${C} ${C}) rotate(-18) scale(0.72)`}
          fill="none"
          stroke={currentColors.accessory}
          strokeWidth="1.2"
          strokeDasharray="5 7"
          strokeLinecap="round"
          opacity="0"
        />

        {/* Anillo de sincronización — mitad trasera: pasa detrás del cuerpo y se ve a través del cristal */}
        <g ref={syncBackRef} display="none" opacity="0">
          <g
            ref={(el) => {
              syncRingRefs.current[0] = el;
            }}
            transform={`translate(${C} ${C + 8}) rotate(${SYNC_TILT}) scale(1 ${SYNC_FLAT})`}
          >
            <g ref={syncSpinRef} id={ids.syncSpin}>
              <circle
                r={SYNC_R}
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity="0.2"
                strokeWidth="1.1"
                strokeDasharray="0.5 7"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {[0, 180].map((deg) => (
                <path
                  key={deg}
                  transform={`rotate(${deg})`}
                  d={`M ${SYNC_R} 0 A ${SYNC_R} ${SYNC_R} 0 0 1 ${(SYNC_R * Math.cos(toRad(120))).toFixed(2)} ${(SYNC_R * Math.sin(toRad(120))).toFixed(2)}`}
                  fill="none"
                  stroke={`url(#${ids.syncArc})`}
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </g>
          {[0, 1].map((k) => (
            <g
              key={k}
              ref={(el) => {
                syncHeadRefs.current[k] = el;
              }}
              opacity="0"
            >
              <circle r="5" fill={`url(#${ids.syncHead})`} />
              <path d="M -3 -3.6 L 1.6 0 L -3 3.6" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>

        {/* Cuerpo */}
        <g ref={bodyRef}>
          <g ref={yawRef}>
            {/* Silueta estelar expansiva al aparecer / cambiar aura (hereda exactamente pose, rotación y yaw 3D) */}
            <path
              ref={summonSilhouetteRef}
              d={initialPath}
              fill={initialColors.glow}
              fillOpacity="0"
              stroke={state === "alert" ? "#F87171" : `url(#${ids.rim})`}
              strokeWidth="1.6"
              strokeLinejoin="round"
              display="none"
              pointerEvents="none"
            />
            {glassContrast && (
              <path
                ref={starUnderlayRef}
                d={initialPath}
                fill="rgba(5, 10, 22, 0.28)"
                stroke="rgba(4, 8, 18, 0.62)"
                strokeWidth="4.2"
                strokeLinejoin="round"
              />
            )}
            <path
              ref={starRef}
              d={initialPath}
              fill={state === "alert" ? "rgba(239,68,68,0.22)" : `url(#${ids.body})`}
            />
            {/* Capas ópticas internas de gota Liquid Glass recortadas a la silueta */}
            <g clipPath={`url(#${ids.bodyClip})`}>
              <ellipse
                ref={liquidARef}
                cx="86"
                cy="78"
                rx="48"
                ry="36"
                fill={`url(#${ids.liquidA})`}
              />
              <ellipse
                ref={liquidBRef}
                cx="146"
                cy="156"
                rx="52"
                ry="40"
                fill={`url(#${ids.liquidB})`}
              />
              <ellipse
                ref={liquidCRef}
                cx="128"
                cy="164"
                rx="36"
                ry="16"
                transform="rotate(-10 128 164)"
                fill={`url(#${ids.liquidC})`}
              />
              {/* Núcleo cromático profundo y transparente */}
              <circle
                ref={coreRef}
                cx={C}
                cy={C + 1.5}
                r="35"
                fill={`url(#${ids.core})`}
              />
              {/* Luz de la pantalla de la laptop reflejada en el cristal (sólo programando) */}
              <ellipse
                ref={screenLightRef}
                cx="168"
                cy="162"
                rx="54"
                ry="42"
                fill={`url(#${ids.screenLight})`}
                opacity="0"
              />
              {/* Menisco perimetral delicado por tensión superficial */}
              <path
                ref={starMeniscusRef}
                d={initialPath}
                fill="none"
                stroke={`url(#${ids.meniscus})`}
                strokeWidth="4.4"
                strokeOpacity={glassContrast ? "0.18" : "0.11"}
                strokeLinejoin="round"
              />
              {/* Surco oscuro fino de refracción pegado al filo exterior */}
              <path
                ref={starRefractCreaseRef}
                d={initialPath}
                transform={`translate(${(C * 0.017).toFixed(2)} ${(C * 0.017).toFixed(2)}) scale(0.983)`}
                fill="none"
                stroke={`url(#${ids.refractCrease})`}
                strokeWidth="1.05"
                strokeLinejoin="round"
              />
              {/* Bisel especular húmedo arriba-izquierda */}
              <path
                ref={starBevelRef}
                d={initialPath}
                transform="translate(0.7 1.0)"
                fill="none"
                stroke={`url(#${ids.bevel})`}
                strokeWidth="1.15"
                strokeOpacity={glassContrast ? "0.52" : "0.42"}
                strokeLinejoin="round"
              />
              {/* Rebote Fresnel interno abajo-derecha siguiendo la curva exacta del pie */}
              <path
                ref={starBounceRef}
                d={initialPath}
                transform="translate(-0.68 -0.95)"
                fill="none"
                stroke={`url(#${ids.bounce})`}
                strokeWidth="1.1"
                strokeOpacity={glassContrast ? "0.46" : "0.36"}
                strokeLinejoin="round"
              />
              {/* Reflejos húmedos de agua inscritos 100 % dentro de la frente convexa */}
              <ellipse
                ref={glossTopRef}
                cx="108"
                cy="96"
                rx="20"
                ry="7.5"
                transform="rotate(-32 108 96)"
                fill={`url(#${ids.gloss})`}
              />
              <path
                ref={glossSpecRef}
                d={CRESCENT_SPEC_PATH}
                transform="translate(108.5 95.2) rotate(-32)"
                fill={`url(#${ids.glossSpec})`}
              />
              <ellipse
                ref={glossPinRef}
                cx="98.8"
                cy="106.0"
                rx="1.85"
                ry="0.95"
                transform="rotate(-40 98.8 106.0)"
                fill="#FFFFFF"
                opacity="0.58"
              />
            </g>
            {/* Filo exterior Fresnel fino dibujado encima del recorte interno para máxima nitidez óptica */}
            <path
              ref={starRimRef}
              d={initialPath}
              fill="none"
              stroke={state === "alert" ? "#F87171" : `url(#${ids.rim})`}
              strokeWidth={glassContrast ? "1.2" : "0.88"}
              strokeLinejoin="round"
            />
          </g>

          {/* Rostro */}
          <g ref={faceRef}>
            {/* Rasgos de la carita: la lupa los vuelve a dibujar aumentados con <use> */}
            <g id={ids.features}>
              {/* Mejillas con sonrojo orgánico (detrás de ojos y boca para mantener contraste nítido) */}
              <g ref={cheekLRef} opacity="0" transform={`translate(${C - 14.5} ${C + 5.2}) scale(0.72 0.68)`}>
                <ellipse cx="0" cy="0" rx="8.2" ry="4.7" transform="rotate(-9)" fill={`url(#${ids.blush})`} />
                <ellipse ref={cheekLCoreRef} cx="0" cy="-0.2" rx="3.8" ry="2.0" transform="rotate(-9)" fill={initialColors.blushCore} opacity="0.22" />
              </g>
              <g ref={cheekRRef} opacity="0" transform={`translate(${C + 14.5} ${C + 5.2}) scale(0.72 0.68)`}>
                <ellipse cx="0" cy="0" rx="8.2" ry="4.7" transform="rotate(9)" fill={`url(#${ids.blush})`} />
                <ellipse ref={cheekRCoreRef} cx="0" cy="-0.2" rx="3.8" ry="2.0" transform="rotate(9)" fill={initialColors.blushCore} opacity="0.22" />
              </g>

              {/* Ojo izquierdo limpio sin pupila */}
              <g ref={eyeLRef} transform={`translate(${C - 8} ${C - 3})`}>
                <g ref={eyeOpenLRef}>
                  <ellipse
                    ref={eyeScleraLRef}
                    cx="0"
                    cy="0"
                    rx="3.45"
                    ry="5.25"
                    fill={`url(#${ids.eyeFill})`}
                    stroke="rgba(6, 10, 24, 0.24)"
                    strokeWidth="0.95"
                    paintOrder="stroke"
                  />
                </g>
                <path
                  ref={eyeHappyLRef}
                  d="M -4.35 1.9 C -2.35 -4.8 2.15 -5.2 4.15 1.35"
                  stroke="#FFFFFF"
                  strokeWidth="2.35"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0"
                />
              </g>
              {/* Ojo derecho limpio sin pupila */}
              <g ref={eyeRRef} transform={`translate(${C + 8} ${C - 3})`}>
                <g ref={eyeOpenRRef}>
                  <ellipse
                    ref={eyeScleraRRef}
                    cx="0"
                    cy="0"
                    rx="3.45"
                    ry="5.25"
                    fill={`url(#${ids.eyeFill})`}
                    stroke="rgba(6, 10, 24, 0.24)"
                    strokeWidth="0.95"
                    paintOrder="stroke"
                  />
                </g>
                <path
                  ref={eyeHappyRRef}
                  d="M -4.15 1.35 C -2.15 -5.2 2.35 -4.8 4.35 1.9"
                  stroke="#FFFFFF"
                  strokeWidth="2.35"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0"
                />
              </g>

              {/* Lengüita de concentración (programando); queda bajo la línea de la boca */}
              <path
                ref={tongueRef}
                d="M -1.7 -0.3 C -1.7 3 1.7 3 1.7 -0.3 Z"
                fill="#FF9EC4"
                opacity="0"
              />
              {/* Boca de sonrisa / concentración (hover / lectura / programación) */}
              <path
                ref={mouthRef}
                d={`M ${C - 3} ${C + 6.5} Q ${C} ${C + 9} ${C + 3} ${C + 6.5}`}
                stroke="#FFFFFF"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
                opacity="0"
              />
              {/* Boca blanca luminosa con tonalidades internas al hablar */}
              <g ref={talkMouthGroupRef} opacity="0">
                <path
                  ref={talkMouthPathRef}
                  d={buildOrganicTalkMouthPath(C, C + 6.8, 3.8, 0.4, 0.7)}
                  fill="#FFFFFF"
                  opacity="0.96"
                />
                <g clipPath={`url(#${ids.mouthClip})`}>
                  <ellipse
                    ref={talkInnerShadeRef}
                    cx={C}
                    cy={C + 8.8}
                    rx="3.0"
                    ry="2.2"
                    fill={initialColors.pupil}
                    opacity="0.38"
                  />
                  <ellipse
                    ref={talkTongueRef}
                    cx={C}
                    cy={C + 10.6}
                    rx="2.4"
                    ry="1.6"
                    fill="#FCC6D9"
                    opacity="0.78"
                  />
                </g>
                <path
                  ref={talkUpperLipRef}
                  d={`M ${C - 3.8} ${C + 6.4} Q ${C} ${C + 5.8} ${C + 3.8} ${C + 6.4}`}
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  opacity="0.98"
                />
              </g>

              {/* Gota de sudor "¡ups!" cuando la terminal falla */}
              <g ref={sweatRef} opacity="0" transform={`translate(${C + 21} ${C - 15}) scale(0.0001)`}>
                <path
                  d="M 0 -4.6 C 1.9 -1.7 3.2 0.2 3.2 1.7 A 3.2 3.2 0 0 1 -3.2 1.7 C -3.2 0.2 -1.9 -1.7 0 -4.6 Z"
                  fill="#BFE3FF"
                  fillOpacity="0.92"
                  stroke="#FFFFFF"
                  strokeOpacity="0.7"
                  strokeWidth="0.6"
                />
                <ellipse cx="-1.1" cy="1.1" rx="0.7" ry="1.1" fill="#FFFFFF" opacity="0.85" />
              </g>
            </g>

            {/* Lupa de cristal (leyendo): barre de un ojo al otro y aumenta lo que queda debajo, como de detective */}
            <g ref={lensRef} display="none" opacity="0" transform={`translate(${C + 9.4} ${C - 3.6}) scale(0.0001)`}>
              <g transform="rotate(52)">
                <rect x={LENS_R + 3.2} y="-2.2" width="12.5" height="4.4" rx="2.2" fill={`url(#${ids.lensHandle})`} />
                <rect x={LENS_R + 4.2} y="-1.3" width="9.5" height="0.9" rx="0.45" fill="#FFFFFF" opacity="0.55" />
                <rect ref={lensFerruleRef} x={LENS_R + 0.4} y="-2.9" width="3.6" height="5.8" rx="1.2" fill={initialColors.rim1} />
              </g>
              {/* Fondo del lente: tapa la carita real para que solo se vea la aumentada */}
              <circle r={LENS_R} fill={`url(#${ids.lensBack})`} />
              <g clipPath={`url(#${ids.lensClip})`}>
                <g ref={lensMagRef}>
                  <use href={`#${ids.features}`} />
                </g>
              </g>
              <circle r={LENS_R} fill={`url(#${ids.lensEdge})`} />
              <path
                d={`M ${(-LENS_R * 0.68 * 0.94).toFixed(2)} ${(-LENS_R * 0.68 * 0.34).toFixed(2)} A ${LENS_R * 0.68} ${LENS_R * 0.68} 0 0 1 ${(-LENS_R * 0.68 * 0.34).toFixed(2)} ${(-LENS_R * 0.68 * 0.94).toFixed(2)}`}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity="0.85"
              />
              <circle cx={LENS_R * 0.42} cy={LENS_R * 0.5} r="0.85" fill="#FFFFFF" opacity="0.5" />
              <circle r={LENS_R} fill="none" stroke={`url(#${ids.lensRim})`} strokeWidth="2.3" />
              <circle r={LENS_R - 1.35} fill="none" stroke="rgba(6, 10, 24, 0.45)" strokeWidth="0.6" />
            </g>
          </g>
        </g>

        {/* Anillo de sincronización — mitad delantera: pasa frente al cuerpo */}
        <g ref={syncFrontRef} display="none" opacity="0">
          <g
            ref={(el) => {
              syncRingRefs.current[1] = el;
            }}
            transform={`translate(${C} ${C + 8}) rotate(${SYNC_TILT}) scale(1 ${SYNC_FLAT})`}
            clipPath={`url(#${ids.syncFront})`}
          >
            <use href={`#${ids.syncSpin}`} />
          </g>
          {[2, 3].map((k) => (
            <g
              key={k}
              ref={(el) => {
                syncHeadRefs.current[k] = el;
              }}
              opacity="0"
            >
              <circle r="5" fill={`url(#${ids.syncHead})`} />
              <path d="M -3 -3.6 L 1.6 0 L -3 3.6" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
        </g>

        {/* Ondas armónicas de voz al hablar (talking) */}
        <g ref={talkWaveRef} opacity="0" transform={`translate(${C + 68} ${C - 8}) scale(0.0001)`}>
          <path
            ref={talkWave1Ref}
            d="M 0 -6.5 Q 5.5 0 0 6.5"
            fill="none"
            stroke={initialColors.rim1}
            strokeWidth="2.0"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            ref={talkWave2Ref}
            d="M 6 -11.5 Q 14 0 6 11.5"
            fill="none"
            stroke={initialColors.glow}
            strokeWidth="1.75"
            strokeLinecap="round"
            opacity="0.65"
          />
          <path
            ref={talkWave3Ref}
            d="M 12 -16 Q 22 0 12 16"
            fill="none"
            stroke={initialColors.accessory}
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.4"
          />
        </g>

        {/* Mini-laptop holográfica abajo a la derecha en perspectiva 3/4 (edición de código + terminal, sin brazos) */}
        <g ref={laptopRef} opacity="0" transform={`translate(${C + 58} ${C + 20}) scale(0.0001)`}>
          {/* Resplandor difuminado con gradiente radial (sin bordes duros) */}
          <ellipse
            ref={laptopScreenGlowRef}
            cx="0"
            cy="-12"
            rx="34"
            ry="24"
            fill={`url(#${ids.glow})`}
            opacity="0.65"
          />

          {/* Tapa / Pantalla desplegable desde la bisagra (y=0) */}
          <g ref={laptopLidRef}>
            {/* Carcasa exterior y bisel de cristal oscuro */}
            <rect
              ref={laptopScreenRimRef}
              x="-22"
              y="-31"
              width="44"
              height="30"
              rx="4.4"
              fill="#070B14"
              fillOpacity="0.96"
              stroke={initialColors.accessory}
              strokeWidth="1.25"
            />
            <rect
              x="-20.6"
              y="-29.6"
              width="41.2"
              height="27.2"
              rx="3.4"
              fill="none"
              stroke="#FFFFFF"
              strokeOpacity="0.14"
              strokeWidth="0.6"
            />
            {/* Reflejo diagonal de cristal en la pantalla */}
            <path
              d="M -20 -29 L -5 -29 L -15 -2.5 L -20 -2.5 Z"
              fill="#FFFFFF"
              opacity="0.045"
            />
            {/* Barra superior del IDE + notch central */}
            <rect x="-5" y="-30.4" width="10" height="1.8" rx="0.9" fill="#111827" />
            <circle cx="-16.8" cy="-26.8" r="1.05" fill="#F87171" opacity="0.9" />
            <circle cx="-13.6" cy="-26.8" r="1.05" fill="#FBBF24" opacity="0.9" />
            <circle cx="-10.4" cy="-26.8" r="1.05" fill="#34D399" opacity="0.9" />
            <rect x="-5.5" y="-27.8" width="14" height="2.0" rx="1.0" fill="#FFFFFF" opacity="0.10" />
            <line x1="-20" y1="-24.0" x2="20" y2="-24.0" stroke="#FFFFFF" strokeOpacity="0.10" strokeWidth="0.7" />

            {/* Vista 1: Editor de código multi-token con barra de línea activa y cursor */}
            <g ref={laptopCodeGroupRef}>
              {/* Resaltado de la línea activa */}
              <rect
                ref={laptopActiveLineRef}
                x="-19.5"
                y="-22.7"
                width="39"
                height="4.0"
                rx="1.2"
                fill="#FFFFFF"
                opacity="0.06"
              />
              {/* Columna de números de línea */}
              {[-21.6, -16.8, -12.0, -7.2].map((ry, idx) => (
                <rect
                  key={`ln-${idx}`}
                  x="-18.2"
                  y={ry}
                  width="1.8"
                  height="1.8"
                  rx="0.6"
                  fill="#64748B"
                  opacity="0.45"
                />
              ))}
              {/* Tokens de sintaxis (primario + secundario por fila) */}
              {[
                { y: -21.6, x: -14.5, c1: "#38BDF8", c2: "#E2E8F0" },
                { y: -16.8, x: -11.0, c1: "#C084FC", c2: "#6EE7B7" },
                { y: -12.0, x: -11.0, c1: "#34D399", c2: "#FDE68A" },
                { y: -7.2, x: -14.5, c1: "#F472B6", c2: "#93C5FD" },
              ].map((row, idx) => (
                <React.Fragment key={idx}>
                  <rect
                    ref={(el) => {
                      laptopCodeLineRefs.current[idx] = el;
                    }}
                    x={row.x}
                    y={row.y}
                    width="9"
                    height="2.1"
                    rx="1.05"
                    fill={row.c1}
                    opacity="0.92"
                  />
                  <rect
                    ref={(el) => {
                      laptopCodeSecRefs.current[idx] = el;
                    }}
                    x={row.x + 10.6}
                    y={row.y}
                    width="11"
                    height="2.1"
                    rx="1.05"
                    fill={row.c2}
                    opacity="0.85"
                  />
                </React.Fragment>
              ))}
              <rect
                ref={laptopCaretRef}
                x="4"
                y="-17.2"
                width="1.4"
                height="3.1"
                rx="0.6"
                fill="#FFFFFF"
              />
            </g>

            {/* Vista 2: Consola / Terminal ejecutando comando y mostrando respuesta */}
            <g ref={laptopTermGroupRef} opacity="0">
              {/* Fondo sutil de panel de terminal */}
              <rect x="-19.2" y="-22.6" width="38.4" height="19.6" rx="2.4" fill="#030712" fillOpacity="0.65" />
              {/* Prompt `>_` */}
              <path
                d="M -16.8 -20.0 L -14.5 -18.7 L -16.8 -17.4"
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                ref={laptopTermCmdRef}
                x="-12.2"
                y="-19.7"
                width="18"
                height="2.0"
                rx="1.0"
                fill="#FFFFFF"
              />
              {/* Líneas de respuesta de la terminal (stdout) */}
              {[-14.6, -10.6, -6.6].map((ry, idx) => (
                <rect
                  key={idx}
                  ref={(el) => {
                    laptopTermOutRefs.current[idx] = el;
                  }}
                  x="-16.8"
                  y={ry}
                  width="18"
                  height="1.85"
                  rx="0.9"
                  fill="#CBD5E1"
                  opacity="0.85"
                />
              ))}
              {/* Badge de estado de salida de la terminal (✓ ok / ! error) */}
              <circle
                ref={laptopTermBadgeRef}
                cx="14.5"
                cy="-7.5"
                r="3.8"
                fill="#10B981"
                opacity="0"
              />
              <path
                ref={laptopTermCheckRef}
                d="M 12.8 -7.5 L 14.1 -6.2 L 16.4 -8.8"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0"
              />
            </g>
          </g>

          {/* Base del teclado en perspectiva 3/4 con 2 hileras de teclas y trackpad */}
          <path
            ref={laptopBaseRimRef}
            d="M -22.5 0 L 22.5 0 L 28.5 7.4 Q 29.2 9.0 26.8 9.0 L -24.5 9.0 Q -26.8 9.0 -26.0 7.4 Z"
            fill="#0F172A"
            fillOpacity="0.96"
            stroke={initialColors.rim1}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          {/* Bisagra oscura central */}
          <rect x="-15" y="-0.6" width="30" height="1.3" rx="0.65" fill="#020617" opacity="0.85" />
          {/* Teclas iluminadas por telequinesis */}
          {[
            { x: -18.5, y: 1.6, w: 4.4 },
            { x: -12.5, y: 1.6, w: 4.4 },
            { x: -6.5, y: 1.6, w: 4.4 },
            { x: -0.5, y: 1.6, w: 4.4 },
            { x: 5.5, y: 1.6, w: 4.4 },
            { x: 11.5, y: 1.6, w: 4.4 },
            { x: -7.5, y: 4.0, w: 14.0 },
          ].map((k, idx) => (
            <rect
              key={idx}
              ref={(el) => {
                laptopKeyGlowRefs.current[idx] = el;
              }}
              x={k.x}
              y={k.y}
              width={k.w}
              height="1.7"
              rx="0.65"
              fill="#94A3B8"
              opacity="0.3"
            />
          ))}
          {/* Trackpad frontal sutil */}
          <rect x="-5.5" y="6.3" width="11" height="1.6" rx="0.7" fill="#FFFFFF" opacity="0.24" />
        </g>

        {/* Burbuja de pensamiento "..." */}
        <g ref={bubbleRef} opacity="0" transform="translate(150 58) scale(0.0001)">
          <circle cx="2" cy="-2" r="2.2" fill="rgba(255,255,255,0.22)" />
          <circle cx="8" cy="-8" r="3.4" fill="rgba(255,255,255,0.28)" />
          <rect x="12" y="-36" width="46" height="26" rx="13" fill="rgba(24,30,38,0.92)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              ref={(el) => {
                dotRefs.current[i] = el;
              }}
              cx={25 + i * 10}
              cy="-21"
              r="2.6"
              fill="#E5E7EB"
            />
          ))}
        </g>

        {/* Signo de alerta */}
        <g ref={bangRef} opacity="0" transform="translate(172 52) scale(0.0001)">
          <circle cx="0" cy="0" r="10" fill="#DC2626" stroke="#FCA5A5" strokeWidth="1.2" />
          <line x1="0" y1="-5" x2="0" y2="1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="0" cy="5" r="1.3" fill="#FFFFFF" />
        </g>

        {/* Destellos de festejo (brotan alrededor del cuerpo al celebrar) */}
        {CHEER_SPARKLES.map((_, i) => (
          <path
            key={i}
            ref={(el) => {
              cheerSparkRefs.current[i] = el;
            }}
            d={SPARKLE_PATH}
            fill="#FFFFFF"
            opacity="0"
            transform={`translate(${C} ${C}) scale(0.0001)`}
          />
        ))}
      </svg>
    </div>
  );
};

function ellipseCutoutPath(cx: number, cy: number, rx: number, ry: number): string {
  const x0 = (cx - rx).toFixed(2);
  const x1 = (cx + rx).toFixed(2);
  const cyStr = cy.toFixed(2);
  const rxStr = rx.toFixed(2);
  const ryStr = ry.toFixed(2);
  return `M${x0} ${cyStr}A${rxStr} ${ryStr} 0 1 0 ${x1} ${cyStr}A${rxStr} ${ryStr} 0 1 0 ${x0} ${cyStr}Z`;
}

export const XOX_SILHOUETTE_PATH =
  buildStar({ phase: 0, amp: 0, lag: 0, reach: 0, wave: -1 }) +
  ellipseCutoutPath(C - 8.5 * 1.15, C - 3, 6.0, 9.2) +
  ellipseCutoutPath(C + 8.5 * 1.15, C - 3, 6.0, 9.2);

export interface XoxSilhouetteIconProps {
  className?: string;
  style?: React.CSSProperties;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
}

/**
 * Silueta sólida de Xox (misma geometría que el ícono de la barra de menú de macOS)
 * para botones de acceso rápido y chips de personalización.
 */
export const XoxSilhouetteIcon: React.FC<XoxSilhouetteIconProps> = ({
  className = "w-4 h-4",
  style,
  x,
  y,
  width,
  height,
}) => (
  <svg
    viewBox="56 54 128 122"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    x={x}
    y={y}
    width={width}
    height={height}
    className={className}
    style={style}
    aria-hidden="true"
  >
    <path
      d={XOX_SILHOUETTE_PATH}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
    />
  </svg>
);
