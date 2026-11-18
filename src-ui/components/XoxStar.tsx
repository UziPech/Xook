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
  glow: string;
  /** Tono profundo en la misma familia para el núcleo en `thinking`. */
  deep: string;
  /** Acento secundario armónico para anillos, chispas y sincronización. */
  accessory: string;
  /** Acento brillante de la familia (sombra interna de la boca al hablar). */
  pupil: string;
  /** Tono de pupila/iris: azul muy clarito y discreto (común a todas las auras). */
  eye: string;
  /** Aura y tono medio al celebrar (`success`), manteniendo armonía sin choques. */
  celebrateMid: string;
  celebrateGlow: string;
  /** Rubor orgánico en mejillas calibrado en OKLCH para no ensuciarse sobre cada base. */
  blush: string;
  blushCore: string;
}

export const XOX_ACCENT_PRESETS: Record<XoxAccentPreset, XoxAccentSpec> = {
  classic: {
    label: "Estelar",
    mid: "#7DD3FC",
    rim: "#BAE6FD",
    rim2: "#A4CFFF",
    tint: "#E0F2FE",
    glow: "#38BDF8",
    deep: "#0EA5E9",
    accessory: "#61E4F0",
    pupil: "#38BDF8",
    eye: "#BAE6FD",
    celebrateMid: "#BAE6FD",
    celebrateGlow: "#4BE2F0",
    blush: "#BAE6FD",
    blushCore: "#E0F2FE",
  },
  violet: {
    label: "Violeta",
    mid: "#C4B5FD",
    rim: "#DDD6FE",
    rim2: "#B8C8FF",
    tint: "#EDE9FE",
    glow: "#A78BFA",
    deep: "#7E6CDA",
    accessory: "#EAB7FF",
    pupil: "#C084FC",
    eye: "#BAE6FD",
    celebrateMid: "#E9D5FF",
    celebrateGlow: "#E9B2FF",
    blush: "#BAE6FD",
    blushCore: "#E0F2FE",
  },
  emerald: {
    label: "Esmeralda",
    mid: "#6EE7B7",
    rim: "#A7F3D0",
    rim2: "#80DFCD",
    tint: "#D1FAE5",
    glow: "#34D399",
    deep: "#08B16F",
    accessory: "#70E6CB",
    pupil: "#34D399",
    eye: "#BAE6FD",
    celebrateMid: "#A7F3D0",
    celebrateGlow: "#5FE5C7",
    blush: "#BAE6FD",
    blushCore: "#E0F2FE",
  },
  amber: {
    label: "Ámbar",
    mid: "#FCD34D",
    rim: "#FDE68A",
    rim2: "#F9BC8B",
    tint: "#FEF3C7",
    glow: "#FBBF24",
    deep: "#DE9D00",
    accessory: "#E6CD72",
    pupil: "#F59E0B",
    eye: "#BAE6FD",
    celebrateMid: "#FEF08A",
    celebrateGlow: "#E5C964",
    blush: "#BAE6FD",
    blushCore: "#E0F2FE",
  },
  rose: {
    label: "Coral",
    mid: "#FDA4AF",
    rim: "#FECDD3",
    rim2: "#FAB1D5",
    tint: "#FFE4E6",
    glow: "#FB7185",
    deep: "#D94D72",
    accessory: "#FFBAAE",
    pupil: "#FB7185",
    eye: "#BAE6FD",
    celebrateMid: "#FECDD3",
    celebrateGlow: "#FFB5A9",
    blush: "#BAE6FD",
    blushCore: "#E0F2FE",
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
  if (preset === "classic") {
    return {
      "--xox-cosmos-bloom": "var(--ref-gemini-bloom-core)",
      "--xox-cosmos-bloom-warm": "var(--ref-gemini-bloom-warm)",
      "--xox-cosmos-corona": "var(--ref-gemini-corona)",
      "--xox-cosmos-halo": "var(--ref-gemini-halo)",
      "--xox-cosmos-border": "color-mix(in oklab, var(--ref-gemini-bloom-core) 58%, rgba(255, 255, 255, 0.16))",
    } as React.CSSProperties;
  }
  const spec = XOX_ACCENT_PRESETS[preset];
  return {
    "--xox-cosmos-bloom": `color-mix(in oklab, var(--ref-gemini-bloom-core) 64%, ${spec.deep})`,
    "--xox-cosmos-bloom-warm": `color-mix(in oklab, var(--ref-gemini-bloom-warm) 60%, ${spec.glow})`,
    "--xox-cosmos-corona": `color-mix(in oklab, var(--ref-gemini-corona) 68%, ${spec.deep})`,
    "--xox-cosmos-halo": `color-mix(in oklab, var(--ref-gemini-halo) 74%, ${spec.deep})`,
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
const PEAK_ROUND = 15;
const VALLEY_ROUND = 13;

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
      core: "#FCA5A5",
      mid: "#DC2626",
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
      bodyGlow: spec.glow,
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
      core: "#FFFFFF",
      mid: spec.celebrateMid,
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
      bodyGlow: spec.glow,
      rim1: spec.rim,
      rim2: state === "coding" ? spec.accessory : spec.rim2,
      core: "#FFFFFF",
      mid: spec.mid,
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
    bodyGlow: spec.glow,
    rim1: spec.rim,
    rim2: spec.rim2,
    core: "#FFFFFF",
    mid: spec.mid,
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
type FocusExpr = "none" | "editL" | "editR" | "run" | "ok" | "err";
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
};
// Parpadeo natural: cierre rápido, apertura algo más lenta
const BLINK_CLOSE = 0.065;
const BLINK_OPEN = 0.12;
const smooth01 = (e0: number, e1: number, x: number) => {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};

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
    const r = Math.min(radii[i], l1 * 0.46, l2 * 0.46);
    const ax = p1[0] - (d1x / l1) * r;
    const ay = p1[1] - (d1y / l1) * r;
    const bx = p1[0] + (d2x / l2) * r;
    const by = p1[1] + (d2y / l2) * r;
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
}

function buildStar({ phase, amp, lag, reach, wave }: ShapeParams): string {
  for (let i = 0; i < 5; i++) {
    let pa = PEAKS[i].a + lag + 2.2 * amp * Math.sin(phase * 1.1 + i * 2.1);
    let pr = PEAKS[i].r * (1 + 0.035 * amp * Math.sin(phase * 1.6 + i * 1.35) + reach);

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

    const va = VALLEYS[i].a + lag * 0.4;
    const vr = VALLEYS[i].r * (1 + 0.045 * amp * Math.sin(phase * 2 + i * 0.9 + 1));
    const vIdx = pIdx + 1;
    STAR_PTS[vIdx][0] = C + vr * Math.cos(toRad(va));
    STAR_PTS[vIdx][1] = C + vr * Math.sin(toRad(va));
    STAR_RADII[vIdx] = VALLEY_ROUND;
  }
  return roundedPath(STAR_PTS, STAR_RADII);
}

/** Construye una boca orgánica articulada (labio superior curvado en sonrisa + mandíbula suave). */
function buildOrganicTalkMouthPath(cx: number, cy: number, halfW: number, openAmt: number, smileLift: number): string {
  const xL = (cx - halfW).toFixed(2);
  const xR = (cx + halfW).toFixed(2);
  const yCorner = (cy - smileLift * 0.7).toFixed(2);
  const yTopCtrl = (cy - 1.15 - openAmt * 1.1 + smileLift * 0.25).toFixed(2);
  const yBotCtrl = (cy + 1.85 + openAmt * 6.4).toFixed(2);
  const xCtrl = (halfW * 0.72).toFixed(2);
  const xLCtrl = (cx - Number(xCtrl)).toFixed(2);
  const xRCtrl = (cx + Number(xCtrl)).toFixed(2);
  return `M ${xL} ${yCorner} Q ${cx.toFixed(2)} ${yTopCtrl} ${xR} ${yCorner} C ${xRCtrl} ${yBotCtrl} ${xLCtrl} ${yBotCtrl} ${xL} ${yCorner} Z`;
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
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-body-${uid}`,
    rim: `xox-rim-${uid}`,
    core: `xox-core-${uid}`,
    glow: `xox-glow-${uid}`,
    cradle: `xox-cradle-${uid}`,
    blush: `xox-blush-${uid}`,
    mouthClip: `xox-mouth-clip-${uid}`,
    eyeClipL: `xox-eye-clip-l-${uid}`,
    eyeClipR: `xox-eye-clip-r-${uid}`,
    laptopScreen: `xox-lap-scr-${uid}`,
  };
  const resolvedAccent = resolveXoxAccentPreset(accentPreset);
  const currentColors = resolveXoxStateColors(resolvedAccent, state);
  const initialColors = useMemo(() => currentColors, []);

  // Refs a nodos SVG animados por rAF
  const wrapRef = useRef<HTMLDivElement>(null);
  const cradleRef = useRef<SVGCircleElement>(null);
  const glowRef = useRef<SVGCircleElement>(null);
  const summonRingRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<SVGEllipseElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const yawRef = useRef<SVGGElement>(null);
  const starUnderlayRef = useRef<SVGPathElement>(null);
  const starRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const eyeOpenLRef = useRef<SVGGElement>(null);
  const eyeOpenRRef = useRef<SVGGElement>(null);
  const eyeScleraLRef = useRef<SVGEllipseElement>(null);
  const eyeScleraRRef = useRef<SVGEllipseElement>(null);
  const eyeClipEllipseLRef = useRef<SVGEllipseElement>(null);
  const eyeClipEllipseRRef = useRef<SVGEllipseElement>(null);
  const irisLRef = useRef<SVGCircleElement>(null);
  const irisRRef = useRef<SVGCircleElement>(null);
  const pupilLRef = useRef<SVGCircleElement>(null);
  const pupilRRef = useRef<SVGCircleElement>(null);
  const glintLRef = useRef<SVGCircleElement>(null);
  const glintRRef = useRef<SVGCircleElement>(null);
  const lidShadeLRef = useRef<SVGRectElement>(null);
  const lidShadeRRef = useRef<SVGRectElement>(null);
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
  const syncPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const syncArrowRefs = useRef<(SVGPolygonElement | null)[]>([]);
  const lensHandleRef = useRef<SVGLineElement>(null);
  const lensRingRef = useRef<SVGCircleElement>(null);
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
    rim1: SVGStopElement | null;
    rim2: SVGStopElement | null;
    core0: SVGStopElement | null;
    core1: SVGStopElement | null;
    core2: SVGStopElement | null;
    glow0: SVGStopElement | null;
    glow1: SVGStopElement | null;
    glow2: SVGStopElement | null;
    blush0: SVGStopElement | null;
    blush1: SVGStopElement | null;
    blush2: SVGStopElement | null;
  }>({
    bodyTint: null,
    bodyGlow: null,
    rim1: null,
    rim2: null,
    core0: null,
    core1: null,
    core2: null,
    glow0: null,
    glow1: null,
    glow2: null,
    blush0: null,
    blush1: null,
    blush2: null,
  });
  // Props (accesorios) que aparecen según el estado
  const lensRef = useRef<SVGGElement>(null);
  const bubbleRef = useRef<SVGGElement>(null);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const bangRef = useRef<SVGGElement>(null);
  const syncRef = useRef<SVGGElement>(null);

  const prevAccentRef = useRef<XoxAccentPreset>(resolvedAccent);
  const prevStateRef = useRef<XoxState>(state);
  const stateRef = useRef<XoxState>(state);
  const accentRef = useRef<XoxAccentPreset>(resolvedAccent);
  const hoverRef = useRef(false);
  const dragMotionPropRef = useRef(dragMotionRef);

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
    bobPhase: 0,
    reduce: false,
    spinTarget: 0,
    windupUntil: 0,
    lastSpin: -10,
    squashKick: 0,
    jumpKick: 0,
    waveStart: -10,
    summonAt: -10,
    colorMorphAt: -10,
    stateChangeAt: -10,
    forceBlinkAt: -10,
    termPulseAt: -10,
    blushBoostUntil: -10,
    blushPeak: 0,
    blushKick: 0,
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
      // Parpadeo puente al cambiar de expresión facial (ej. success <-> idle, thinking -> talking)
      if (prev === "success" || state === "success" || prev === "talking" || state === "talking" || prev === "coding" || state === "coding") {
        a.forceBlinkAt = a.t;
      }
      if (!a.reduce) {
        if (state === "idle" && prev === "success") {
          // Aterrizaje acolchado al pasar de Feliz a Reposo
          a.squashKick += 1.45;
          a.jumpKick += 28;
        } else if (state !== "success") {
          // Micro-anticipación orgánica al entrar a un nuevo estado
          a.squashKick += 1.15;
          a.jumpKick -= 26;
        }
      }
    }

    if (state === "success") {
      a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.4);
      a.blushPeak = 1;
      if (!a.reduce) a.blushKick += 1.6;
      triggerSpin();
    }
    // Sincronizando: pirueta repetida mientras dure el estado y la vista esté activa
    if (state === "syncing" && active) {
      triggerSpin();
      const id = window.setInterval(triggerSpin, 2200);
      return () => window.clearInterval(id);
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

  // Coreografía de entrada al invocar con ⌘⇧X (micro-salto, saludo y pulso estelar)
  useEffect(() => {
    if (!summonTrigger) return;
    const a = anim.current;
    a.summonAt = a.t;
    a.waveStart = a.t;
    a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.6);
    a.blushPeak = Math.max(a.blushPeak, 0.58);
    if (a.reduce) {
      a.jumpKick = -60;
      return;
    }
    a.squashKick = 4.2;
    a.jumpKick = -195;
  }, [summonTrigger]);

  // Impulso lateral cuando Xox se desliza hacia o desde la ventana de su espacio
  useEffect(() => {
    if (!glideTrigger) return;
    const a = anim.current;
    a.summonAt = a.t;
    a.waveStart = a.t;
    a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 1.45);
    a.blushPeak = Math.max(a.blushPeak, 0.52);
    if (a.reduce) return;
    a.squashKick = glideDir === "right" ? -2.8 : 2.8;
    a.jumpKick = -85;
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
    const pupilScaleL: Spring = { x: 1, v: 0 };
    const pupilScaleR: Spring = { x: 1, v: 0 };
    const saccadeX: Spring = { x: 0, v: 0 };
    const saccadeY: Spring = { x: 0, v: 0 };
    // Boca paramétrica de enfoque (resortes críticamente amortiguados: sin rebote ni temblor)
    const editPose = FOCUS_POSES.editR.mouth;
    const focusMouthW: Spring = { x: editPose.w, v: 0 };
    const focusMouthY: Spring = { x: editPose.y, v: 0 };
    const focusMouthBend: Spring = { x: editPose.bend, v: 0 };
    const focusMouthTilt: Spring = { x: editPose.tilt, v: 0 };
    const focusMouthShift: Spring = { x: editPose.shift, v: 0 };

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
    let lastForceBlinkSeen = a.forceBlinkAt;
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
    let nextGlance = a.t + 2;
    let glance = { x: 0, y: 0 };
    let prevDragActive = false;

    const frame = (now: number) => {
      if (document.hidden) {
        raf = 0;
        return;
      }

      const st = stateRef.current;
      const dt = Math.min((now - last) / 1000, 1 / 20);
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

      // En modo coding: determina si está editando código o viendo la respuesta de la terminal
      const tf = terminalRef.current;
      // Si no hay evento explícito (ej. catálogo de Xox Studio), alterna entre edición y terminal cada ~6.4s
      const autoCycle = t % 6.4;
      const isTermPhase = tf ? tf.mode === "terminal" : autoCycle >= 3.4;
      const isTermDoneOk = tf ? tf.status === "ok" : autoCycle >= 4.8;
      const isTermErr = tf ? tf.status === "error" : false;
      step(termModeBlend, isTermPhase ? 1 : 0, 140, 16, dt);
      const wTerm = clamp(termModeBlend.x, 0, 1);

      // Trayectoria lateral de la laptop: pasa suavemente de un lado a otro frente a Xox
      const lapSideWave = Math.sin(t * 0.92);

      // --- Parpadeo natural (cierre rápido, apertura suave) --------------------
      const analyzeWeight = clamp(wCode + wRead * 0.55 + wThink * 0.35, 0, 1);
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
      } else if (reading || thinking) {
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

      const pose = FOCUS_POSES[shownExpr];
      // Resortes críticamente amortiguados (c ≈ 2√k): llegan firmes a la pose sin rebotar
      step(squintL, pose.sL * analyzeWeight, 300, 35, dt);
      step(squintR, pose.sR * analyzeWeight, 300, 35, dt);
      step(pupilScaleL, 1 + (pose.pL - 1) * analyzeWeight, 260, 32, dt);
      step(pupilScaleR, 1 + (pose.pR - 1) * analyzeWeight, 260, 32, dt);

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
        // Anticipación/despegue suave al agarrar la Quick Bar
        if (!a.reduce) {
          a.squashKick += 1.6;
          a.jumpKick -= 70;
        }
      } else if (!dragging && prevDragActive) {
        // Asentamiento con compresión proporcional al impulso de suelta
        const impact = clamp(
          Math.hypot(dm?.releaseVx ?? 0, dm?.releaseVy ?? 0) / 900,
          0.3,
          1.35
        );
        if (!a.reduce) {
          a.squashKick += 2.4 * impact;
          a.jumpKick += 55 * impact;
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
      } else if (thinking) {
        tx = 0.4 + 0.18 * Math.sin(t * 2.3);
        ty = -0.6 + 0.12 * Math.sin(t * 3.1);
      } else if (reading) {
        // Sigue la lupa mientras escanea
        tx = Math.sin(t * 1.6) * 0.9;
        ty = 0.45;
      } else if (coding) {
        // Sigue a la laptop con la cabeza; la lectura fina la hacen las pupilas (sacadas de lectura)
        tx = clamp(lapSideWave * 0.82, -0.95, 0.95);
        ty = isTermPhase ? (isTermDoneOk ? 0.16 : 0.3) : 0.24;
      } else if (alerting) {
        // Inquieto: mira nervioso de un lado a otro
        tx = 0.85 * Math.sin(t * 5.3) * Math.cos(t * 1.7);
        ty = 0.3 * Math.sin(t * 3.9);
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
      if (a.blushKick) {
        blush.v += a.blushKick;
        a.blushKick = 0;
      }
      const interactiveBlush = hoverRef.current ? 0.62 : 0;
      const boostBlush = t <= a.blushBoostUntil ? a.blushPeak : 0;
      const successBlush = wSucc * 0.96;
      const codingOkBlush = wCode * (isTermPhase && isTermDoneOk ? 0.48 : 0);
      const blushTarget =
        (1 - wAlert) *
        clamp(Math.max(successBlush, boostBlush, interactiveBlush, codingOkBlush), 0, 1);
      const blushRising = blushTarget > blush.x;
      const windup = a.windupUntil ? -18 : 0;

      // Balanceo mezclado continuamente (conservando la vibración clásica exacta en `alert`)
      const swayIdle = 3.4 * Math.sin(t * 0.85);
      const swayThink = 5.5 * Math.sin(t * 2.2);
      const swayRead = -3.8 * Math.sin(t * 1.6);
      const swayTalk = 4.2 * Math.sin(t * 3.1) + 1.4 * Math.cos(t * 5.2);
      const swayCode = 5.0 * lapSideWave + 1.6 * Math.sin(t * 3.2);
      const sway = alerting
        ? (3.4 * Math.sin(t * 0.85) + 3.2 * Math.sin(t * 23)) * A
        : (swayIdle * (1 - Math.max(wThink, wRead, wTalk, wCode)) +
            swayThink * wThink +
            swayRead * wRead +
            swayTalk * wTalk +
            swayCode * wCode) *
          A;

      const dragTilt = dragging ? -dragNx * 14 * A : 0;
      const subSteps = dt > 0.018 ? 2 : 1;
      const h = dt / subSteps;
      for (let sIdx = 0; sIdx < subSteps; sIdx += 1) {
        step(
          rot,
          a.spinTarget + windup + sway + lookX.x * 8 * A + dragTilt,
          alerting ? 160 : dragging ? 110 : 78,
          alerting ? 11 : dragging ? 14 : 14,
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
      const sy = (1 - squash.x * 0.45) * (1 + stretch);
      const sx = (1 + squash.x * 0.4) * (1 - stretch * 0.55);

      // Flotación vertical continua (conservando el pulso rápido exacto en `alert`)
      const bobIdle = 3.2 * Math.sin(t * 1.15);
      const bobThink = 4.5 * Math.sin(t * 2.4);
      const bobTalk = 2.4 * Math.sin(t * 5.8) + 1.8 * Math.sin(t * 2.0);
      const bobCode = 2.4 * Math.sin(t * 2.8) + (isTermPhase && isTermDoneOk ? -2.2 * Math.abs(Math.sin(t * 4.5)) : 0);
      const activeBobWeight = clamp(wThink + wTalk + wCode, 0, 1);
      const bob = alerting
        ? 2 * Math.sin(t * 9) * A
        : (bobIdle * (1 - activeBobWeight) +
            bobThink * wThink +
            bobTalk * wTalk +
            bobCode * wCode) *
          A;

      const y = C + bob + jump.x;
      const shakeX = alerting ? 1.8 * Math.sin(t * 37) * A : 0;

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

      // --- Cuerpo gelatinoso (follow-through en las puntas, estrella pura sin brazos) ---
      const starSpeed = alerting ? 3.2 : 1 + 0.8 * wThink + 0.35 * wCode + 0.25 * wTalk;
      a.starPhase += dt * starSpeed;
      const starAmp = (alerting ? 2.1 : 1 + 0.6 * wThink + 0.18 * wCode) * A;
      const lag = clamp(-rot.v * 0.014, -14, 14);
      const starPath = buildStar({
        phase: a.starPhase,
        amp: starAmp,
        lag,
        reach: hover.x * 0.03 + wSucc * 0.02,
        wave: t - a.waveStart,
      });
      starRef.current?.setAttribute("d", starPath);
      starUnderlayRef.current?.setAttribute("d", starPath);

      // --- Núcleo y aura (mezclados suavemente) ---------------------------
      const coreBase = 14 + 1.2 * Math.sin(t * 2);
      const coreThink = 19 + 3 * Math.sin(t * 6);
      const coreTalk = 15.5 + 2.2 * Math.abs(Math.sin(t * 8.5));
      const coreCode = 16.5 + 2.0 * Math.sin(t * 5.2);
      const coreR = alerting
        ? 16 + 3 * Math.sin(t * 9)
        : coreBase * (1 - clamp(wThink + wTalk + wCode, 0, 1)) +
          coreThink * wThink +
          coreTalk * wTalk +
          coreCode * wCode;
      coreRef.current?.setAttribute("r", coreR.toFixed(2));

      const summonPhase = (t - a.summonAt) / 0.65;
      const summonActive = summonPhase >= 0 && summonPhase <= 1 && !a.reduce;
      const colorMorphPhase = (t - a.colorMorphAt) / 0.72;
      const colorMorphActive = colorMorphPhase >= 0 && colorMorphPhase <= 1;

      // Interpolación perceptual en OKLab sobre stops, accesorios, pupilas y sonrojo
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
      const cEye = stepOklab(cs.cur.eye, cs.target.eye, colorAlpha);
      const cAccessory = stepOklab(cs.cur.accessory, cs.target.accessory, colorAlpha);
      const cBlush = stepOklab(cs.cur.blush, cs.target.blush, colorAlpha);
      const cBlushCore = stepOklab(cs.cur.blushCore, cs.target.blushCore, colorAlpha);

      const sr = stopRefs.current;
      sr.bodyTint?.setAttribute("stop-color", cBodyTint);
      sr.bodyGlow?.setAttribute("stop-color", cBodyGlow);
      sr.rim1?.setAttribute("stop-color", cRim1);
      sr.rim2?.setAttribute("stop-color", cRim2);
      sr.core0?.setAttribute("stop-color", cCore);
      sr.core1?.setAttribute("stop-color", cMid);
      sr.core2?.setAttribute("stop-color", cMid);
      sr.glow0?.setAttribute("stop-color", cGlow);
      sr.glow1?.setAttribute("stop-color", cGlow);
      sr.glow2?.setAttribute("stop-color", cGlow);
      sr.blush0?.setAttribute("stop-color", cBlush);
      sr.blush1?.setAttribute("stop-color", cBlush);
      sr.blush2?.setAttribute("stop-color", cBlush);
      cheekLCoreRef.current?.setAttribute("fill", cBlushCore);
      cheekRCoreRef.current?.setAttribute("fill", cBlushCore);
      // Pupilas discretas: azul muy clarito (no el acento neón)
      pupilLRef.current?.setAttribute("fill", cEye);
      pupilRRef.current?.setAttribute("fill", cEye);
      irisLRef.current?.setAttribute("fill", cEye);
      irisRRef.current?.setAttribute("fill", cEye);
      lidShadeLRef.current?.setAttribute("fill", cEye);
      lidShadeRRef.current?.setAttribute("fill", cEye);
      ringRef.current?.setAttribute("stroke", cAccessory);
      talkWave1Ref.current?.setAttribute("stroke", cRim1);
      talkWave2Ref.current?.setAttribute("stroke", cGlow);
      talkWave3Ref.current?.setAttribute("stroke", cAccessory);
      talkInnerShadeRef.current?.setAttribute("fill", cPupil);
      talkTongueRef.current?.setAttribute("fill", "#FCC6D9");
      syncPathRefs.current.forEach((p) => p?.setAttribute("stroke", cAccessory));
      syncArrowRefs.current.forEach((p) => p?.setAttribute("fill", cAccessory));
      lensHandleRef.current?.setAttribute("stroke", cRim1);
      lensRingRef.current?.setAttribute("stroke", cBodyTint);
      lensRingRef.current?.setAttribute("fill", cRim1);
      summonRingRef.current?.setAttribute("stroke", cGlow);
      laptopBaseRimRef.current?.setAttribute("stroke", cRim1);
      laptopScreenRimRef.current?.setAttribute("stroke", cAccessory);

      if (cradleRef.current) {
        cradleRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
      }

      if (glowRef.current) {
        const summonBoost = summonActive ? 0.38 * (1 - summonPhase) : 0;
        const colorBoost = colorMorphActive && !a.reduce ? 0.25 * Math.sin(colorMorphPhase * Math.PI) : 0;
        glowRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
        const baseGlowOp =
          0.55 +
          0.3 * hover.x +
          wThink * (0.3 + 0.15 * Math.sin(t * 5)) +
          wAlert * (0.2 + 0.25 * Math.sin(t * 8)) +
          wCode * (0.18 + 0.1 * Math.sin(t * 4));
        glowRef.current.setAttribute(
          "opacity",
          clamp(baseGlowOp + summonBoost + colorBoost, 0, 1).toFixed(3)
        );
      }
      if (summonRingRef.current) {
        if (summonActive) {
          const ease = 1 - Math.pow(1 - summonPhase, 3);
          summonRingRef.current.setAttribute("cy", y.toFixed(2));
          summonRingRef.current.setAttribute("r", (34 + 70 * ease).toFixed(2));
          summonRingRef.current.setAttribute("stroke-width", (2.4 - 1.9 * ease).toFixed(2));
          summonRingRef.current.setAttribute("opacity", (0.72 * Math.pow(1 - summonPhase, 1.5)).toFixed(3));
        } else {
          summonRingRef.current.setAttribute("opacity", "0");
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
      // Lupa: barrido horizontal sobre el cuerpo con leve cabeceo
      setProp(
        lensRef.current,
        popLens.x,
        `translate(${(C + 56 * Math.sin(t * 1.6)).toFixed(2)} ${(y + 38 + 3 * Math.sin(t * 3.2)).toFixed(2)}) rotate(${(-12 + 6 * Math.sin(t * 1.6)).toFixed(1)}) scale($S)`
      );

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

      // Aro de sincronización: dos flechas circulares girando
      setProp(
        syncRef.current,
        popSync.x,
        `translate(${C} ${y.toFixed(2)}) rotate(${(t * 140).toFixed(1)}) scale($S)`
      );

      // --- Mini-Laptop flotante que pasa de un lado a otro frente a Xox ---
      if (laptopRef.current) {
        const lapPop = Math.max(popLaptop.x, 0.0001);
        const lapX = C + 54 * lapSideWave;
        const lapArcY = 7 * Math.cos(t * 0.92 * 2);
        const lapHoverY = y + 26 + lapArcY + (1 - clamp(popLaptop.x, 0, 1)) * 16 + 2.0 * Math.sin(t * 3.4);
        const lapRot = -7.5 * lapSideWave + 1.6 * Math.sin(t * 2.6);
        laptopRef.current.setAttribute(
          "transform",
          `translate(${lapX.toFixed(2)} ${lapHoverY.toFixed(2)}) rotate(${lapRot.toFixed(2)}) scale(${lapPop.toFixed(4)})`
        );
        laptopRef.current.setAttribute("opacity", clamp(popLaptop.x * 1.35, 0, 1).toFixed(3));
      }
      if (laptopLidRef.current) {
        // La pantalla pivota su perspectiva 3/4 según el lado por el que viaja la laptop
        const lidSy = Math.max(0.06, lidOpen.x);
        const lidSkew = -6.5 * lapSideWave + (1 - clamp(lidOpen.x, 0, 1)) * 14;
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

      faceRef.current?.setAttribute(
        "transform",
        `translate(${(lookX.x * 9).toFixed(2)} ${(lookY.x * 6 - hover.x * 1.5).toFixed(2)})`
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

      // Geometría independiente de la esclerótica blanca vs. la pupila redonda ("el ojo dentro del ojo")
      // Así al entrecerrar un ojo para analizar, la pupila NO se aplasta y se ve enfocando por dentro
      const rxL = clamp(3.4 - squintL.x * 0.35, 3.0, 3.95);
      const ryL = clamp(5.2 * (1 - squintL.x), 3.0, 6.15);
      const rxR = clamp(3.4 - squintR.x * 0.35, 3.0, 3.95);
      const ryR = clamp(5.2 * (1 - squintR.x), 3.0, 6.15);

      eyeScleraLRef.current?.setAttribute("rx", rxL.toFixed(2));
      eyeScleraLRef.current?.setAttribute("ry", ryL.toFixed(2));
      eyeClipEllipseLRef.current?.setAttribute("rx", rxL.toFixed(2));
      eyeClipEllipseLRef.current?.setAttribute("ry", ryL.toFixed(2));

      eyeScleraRRef.current?.setAttribute("rx", rxR.toFixed(2));
      eyeScleraRRef.current?.setAttribute("ry", ryR.toFixed(2));
      eyeClipEllipseRRef.current?.setAttribute("rx", rxR.toFixed(2));
      eyeClipEllipseRRef.current?.setAttribute("ry", ryR.toFixed(2));

      // Sombra interna de párpado superior recortada dentro del ojo cuando ese ojo entrecierra analizando
      const lidDropL = clamp(squintL.x * 4.2, 0, 2.2);
      const lidDropR = clamp(squintR.x * 4.2, 0, 2.2);
      lidShadeLRef.current?.setAttribute("y", (-ryL - 2.6 + lidDropL).toFixed(2));
      lidShadeLRef.current?.setAttribute("opacity", clamp(squintL.x * 0.7, 0, 0.26).toFixed(3));
      lidShadeRRef.current?.setAttribute("y", (-ryR - 2.6 + lidDropR).toFixed(2));
      lidShadeRRef.current?.setAttribute("opacity", clamp(squintR.x * 0.7, 0, 0.26).toFixed(3));

      // Movimiento vivo de iris, pupila y brillo especular (con sacadas de análisis y zoom por ojo)
      const pupX = clamp(0.45 + lookX.x * 1.25 + saccadeX.x * 0.95, -1.65, 1.85);
      const pupY = clamp(-1.1 + lookY.x * 1.45 + saccadeY.x * 0.85, -2.5, 1.65);
      const pupRL = (1.18 * pupilScaleL.x).toFixed(2);
      const pupRR = (1.18 * pupilScaleR.x).toFixed(2);
      const irisRL = (1.92 * pupilScaleL.x).toFixed(2);
      const irisRR = (1.92 * pupilScaleR.x).toFixed(2);

      irisLRef.current?.setAttribute("cx", pupX.toFixed(2));
      irisLRef.current?.setAttribute("cy", pupY.toFixed(2));
      irisLRef.current?.setAttribute("r", irisRL);
      pupilLRef.current?.setAttribute("cx", pupX.toFixed(2));
      pupilLRef.current?.setAttribute("cy", pupY.toFixed(2));
      pupilLRef.current?.setAttribute("r", pupRL);
      glintLRef.current?.setAttribute("cx", (pupX - 0.48).toFixed(2));
      glintLRef.current?.setAttribute("cy", (pupY - 0.52).toFixed(2));

      irisRRef.current?.setAttribute("cx", pupX.toFixed(2));
      irisRRef.current?.setAttribute("cy", pupY.toFixed(2));
      irisRRef.current?.setAttribute("r", irisRR);
      pupilRRef.current?.setAttribute("cx", pupX.toFixed(2));
      pupilRRef.current?.setAttribute("cy", pupY.toFixed(2));
      pupilRRef.current?.setAttribute("r", pupRR);
      glintRRef.current?.setAttribute("cx", (pupX - 0.48).toFixed(2));
      glintRRef.current?.setAttribute("cy", (pupY - 0.52).toFixed(2));

      // Transición continua entre ojos abiertos y ojos felices (^^) sin corte brusco
      const openEyeOp = clamp(1 - smooth01(0.18, 0.72, wSucc), 0, 1);
      const openEyeSquashY = Math.max(0.18, 1 - 0.75 * wSucc);
      const happyEyeOp = clamp(smooth01(0.15, 0.75, wSucc), 0, 1);
      const arcPeakY = -0.8 - 4.2 * wSucc;
      const arcEndY = 1.5 - 1.1 * (1 - wSucc);
      const happyArcD = `M -4.5 ${arcEndY.toFixed(2)} Q 0 ${arcPeakY.toFixed(2)} 4.5 ${arcEndY.toFixed(2)}`;

      eyeOpenLRef.current?.setAttribute("opacity", openEyeOp.toFixed(3));
      eyeOpenLRef.current?.setAttribute("transform", `scale(1 ${openEyeSquashY.toFixed(3)})`);
      eyeOpenRRef.current?.setAttribute("opacity", openEyeOp.toFixed(3));
      eyeOpenRRef.current?.setAttribute("transform", `scale(1 ${openEyeSquashY.toFixed(3)})`);
      eyeHappyLRef.current?.setAttribute("d", happyArcD);
      eyeHappyLRef.current?.setAttribute("opacity", happyEyeOp.toFixed(3));
      eyeHappyRRef.current?.setAttribute("d", happyArcD);
      eyeHappyRRef.current?.setAttribute("opacity", happyEyeOp.toFixed(3));

      // --- Boca coherente con cada fase: una sola curva paramétrica que se transforma con resortes ---
      // (concentrada al editar, expectante en terminal, sonriente al terminar) sin saltos ni temblor.
      const codingMouthWeight = wCode * 0.92;
      const smileTargetWeight = Math.max(hover.x * 0.85, wSucc, codingMouthWeight) * (1 - wTalk);
      if (mouthRef.current) {
        // Boca genérica (hover / celebración), expresada en los mismos parámetros
        const genW = 3.0 + 1.5 * wSucc;
        const genY = 6.5 - 0.5 * wSucc;
        const genBend = 2.5 + 2.6 * wSucc;
        const wm = smooth01(0.1, 0.6, wCode) * (1 - smooth01(0.1, 0.5, wSucc));
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
      }

      // --- Boca blanca luminosa con tonalidades al hablar (sílabas vivas y expresivas) ---
      // Envolvente de frase suave que nunca aplasta la boca a una sola línea
      const phraseWave = 0.65 + 0.35 * Math.sin(t * 2.9) * Math.cos(t * 1.3);
      const rawSyllable =
        0.58 +
        0.34 * Math.sin(t * 15.6) +
        0.24 * Math.sin(t * 9.8 + 0.7) +
        0.18 * Math.cos(t * 22.0);
      const targetMouthOpen = talking ? clamp(rawSyllable * phraseWave, 0.22, 1.05) * wTalk : 0;
      // Alternancia entre vocales amplias ("a/e") y vocales redondeadas ("o/u")
      const vowelRound = 0.5 + 0.5 * Math.sin(t * 5.8 + 1.1);
      const targetHalfW = talking
        ? (4.8 - 1.25 * vowelRound + 0.55 * targetMouthOpen) * (0.72 + 0.28 * wTalk)
        : 3.6;

      step(mouthOpenSpring, targetMouthOpen, 280, 19, dt);
      step(mouthWidthSpring, targetHalfW, 220, 18, dt);

      const mOpen = clamp(mouthOpenSpring.x, 0, 1.12);
      const mHalfW = clamp(mouthWidthSpring.x, 2.7, 5.5);
      const smileLift = 0.65 + 0.4 * (1 - vowelRound);

      if (talkMouthGroupRef.current) {
        if (wTalk > 0.01) {
          const mouthCy = C + 6.8;
          const mouthD = buildOrganicTalkMouthPath(C, mouthCy, mHalfW, mOpen, smileLift);
          talkMouthPathRef.current?.setAttribute("d", mouthD);
          talkMouthClipPathRef.current?.setAttribute("d", mouthD);
          // Borde superior luminoso en sonrisa
          const xL = (C - mHalfW).toFixed(2);
          const xR = (C + mHalfW).toFixed(2);
          const yCorner = (mouthCy - smileLift * 0.7).toFixed(2);
          const yTopCtrl = (mouthCy - 1.15 - mOpen * 1.1 + smileLift * 0.25).toFixed(2);
          talkUpperLipRef.current?.setAttribute(
            "d",
            `M ${xL} ${yCorner} Q ${C} ${yTopCtrl} ${xR} ${yCorner}`
          );
          // Tonalidad media celeste/acento e interior cálido sobre la base blanca de la boca
          talkInnerShadeRef.current?.setAttribute("cy", (mouthCy + 1.4 + mOpen * 2.2).toFixed(2));
          talkInnerShadeRef.current?.setAttribute("rx", (mHalfW * 0.82).toFixed(2));
          talkInnerShadeRef.current?.setAttribute("ry", (1.2 + mOpen * 2.6).toFixed(2));
          talkTongueRef.current?.setAttribute("cy", (mouthCy + 3.0 + mOpen * 3.8).toFixed(2));
          talkTongueRef.current?.setAttribute("rx", (mHalfW * 0.64).toFixed(2));
          talkTongueRef.current?.setAttribute("ry", (1.1 + mOpen * 1.8).toFixed(2));
          talkMouthGroupRef.current.setAttribute("opacity", clamp(wTalk * 1.08, 0, 1).toFixed(3));
        } else {
          talkMouthGroupRef.current.setAttribute("opacity", "0");
        }
      }

      if (talkWaveRef.current) {
        const waveScale = Math.max(wTalk * (0.9 + 0.16 * mOpen), 0.0001);
        talkWaveRef.current.setAttribute(
          "transform",
          `translate(${(C + 68).toFixed(2)} ${(y - 8 + 2 * Math.sin(t * 7)).toFixed(2)}) scale(${waveScale.toFixed(4)})`
        );
        talkWaveRef.current.setAttribute(
          "opacity",
          (wTalk * (0.45 + 0.55 * mOpen)).toFixed(3)
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

      // --- Chispas en órbita elíptica (profundidad por opacidad + color morph) ---
      const colorOrbitBoost =
        colorMorphActive && !a.reduce ? 1.8 * Math.sin(colorMorphPhase * Math.PI) : 0;
      const orbitBoost =
        1 + 1.2 * wThink + 0.45 * wTalk + 0.55 * wCode + (dragging ? dragSpeed * 1.4 : 0) + colorOrbitBoost;
      sparkRefs.current.forEach((el, i) => {
        if (!el) return;
        const ang = t * (0.35 + i * 0.12) * orbitBoost + i * 2.094;
        const radius = 92 + 5 * Math.sin(t * 1.3 + i) + (colorMorphActive && !a.reduce ? 6 * Math.sin(colorMorphPhase * Math.PI) : 0);
        const depth = 0.5 + 0.5 * Math.sin(ang); // 0 = atrás, 1 = adelante
        const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        el.setAttribute("cx", (C + Math.cos(ang) * radius).toFixed(2));
        el.setAttribute("cy", (C + bob * 0.5 + Math.sin(ang) * radius * 0.5).toFixed(2));
        el.setAttribute("opacity", ((0.2 + 0.6 * twinkle) * (0.45 + 0.55 * depth)).toFixed(3));
        el.setAttribute("r", (1.2 + 0.9 * depth).toFixed(2));
        el.setAttribute("fill", i === 1 ? cAccessory : i === 2 ? cRim1 : "#FFFFFF");
      });

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
    };
  }, [active]);

  const handleActivate = () => {
    const a = anim.current;
    a.blushBoostUntil = Math.max(a.blushBoostUntil, a.t + 2.6);
    a.blushPeak = 1;
    if (!a.reduce) a.blushKick += 1.6;
    triggerSpin();
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
      className={`relative inline-block select-none rounded-full ${
        starOnlyHit
          ? "pointer-events-none"
          : "cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40"
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
          className="pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[56%] h-[56%] rounded-full cursor-pointer bg-transparent border-0 p-0 outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/45 z-10"
        />
      )}
      <svg
        viewBox="0 0 240 240"
        width={responsive ? undefined : size}
        height={responsive ? undefined : size}
        className={responsive ? "w-full h-full block" : undefined}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={ids.body} x1="60" y1="50" x2="180" y2="190" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.44" : "0.30"} />
            <stop ref={(el) => { stopRefs.current.bodyTint = el; }} offset="35%" stopColor={initialColors.bodyTint} stopOpacity={glassContrast ? "0.26" : "0.14"} />
            <stop ref={(el) => { stopRefs.current.bodyGlow = el; }} offset="70%" stopColor={initialColors.bodyGlow} stopOpacity={glassContrast ? "0.18" : "0.08"} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.30" : "0.18"} />
          </linearGradient>
          <linearGradient id={ids.rim} x1="55" y1="45" x2="185" y2="195" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
            <stop ref={(el) => { stopRefs.current.rim1 = el; }} offset="40%" stopColor={initialColors.rim1} stopOpacity={glassContrast ? "0.86" : "0.5"} />
            <stop ref={(el) => { stopRefs.current.rim2 = el; }} offset="75%" stopColor={initialColors.rim2} stopOpacity={glassContrast ? "0.72" : "0.24"} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.94" : "0.7"} />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.core0 = el; }} offset="0%" stopColor={initialColors.core} stopOpacity={glassContrast ? "0.98" : "0.9"} />
            <stop ref={(el) => { stopRefs.current.core1 = el; }} offset="50%" stopColor={initialColors.mid} stopOpacity={glassContrast ? "0.42" : "0.3"} />
            <stop ref={(el) => { stopRefs.current.core2 = el; }} offset="100%" stopColor={initialColors.mid} stopOpacity="0" />
          </radialGradient>
          {/* Aura dibujada dentro del SVG: halo íntimo sutil para no teñir de cian el fondo cósmico */}
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.glow0 = el; }} offset="0%" stopColor={initialColors.glow} stopOpacity="0.15" />
            <stop ref={(el) => { stopRefs.current.glow1 = el; }} offset="45%" stopColor={initialColors.glow} stopOpacity="0.045" />
            <stop ref={(el) => { stopRefs.current.glow2 = el; }} offset="100%" stopColor={initialColors.glow} stopOpacity="0" />
          </radialGradient>
          {/* Sonrojo orgánico difuminado sin bordes duros ni exceso de rojez */}
          <radialGradient id={ids.blush} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.blush0 = el; }} offset="0%" stopColor={initialColors.blush} stopOpacity="0.62" />
            <stop ref={(el) => { stopRefs.current.blush1 = el; }} offset="50%" stopColor={initialColors.blush} stopOpacity="0.24" />
            <stop ref={(el) => { stopRefs.current.blush2 = el; }} offset="100%" stopColor={initialColors.blush} stopOpacity="0" />
          </radialGradient>
          <clipPath id={ids.mouthClip}>
            <path
              ref={talkMouthClipPathRef}
              d={buildOrganicTalkMouthPath(C, C + 7.2, 3.6, 0.2, 0.6)}
            />
          </clipPath>
          <clipPath id={ids.eyeClipL}>
            <ellipse ref={eyeClipEllipseLRef} cx="0" cy="0" rx="3.4" ry="5.2" />
          </clipPath>
          <clipPath id={ids.eyeClipR}>
            <ellipse ref={eyeClipEllipseRRef} cx="0" cy="0" rx="3.4" ry="5.2" />
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

        {/* Aura */}
        <circle ref={glowRef} cx={C} cy={C} r="84" fill={`url(#${ids.glow})`} opacity="0.55" />

        {/* Destello estelar al aparecer */}
        <circle
          ref={summonRingRef}
          cx={C}
          cy={C}
          r="34"
          fill="none"
          stroke={initialColors.glow}
          strokeWidth="2"
          opacity="0"
        />

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
                    <ellipse cx="8.5" cy={geom.eyeY} rx="0.92" ry="1.42" fill="#FFFFFF" fillOpacity="0.96" />
                    <ellipse cx="11.5" cy={geom.eyeY} rx="0.92" ry="1.42" fill="#FFFFFF" fillOpacity="0.96" />
                    <circle cx="8.7" cy={geom.eyeY - 0.35} r="0.28" fill={pal.tintHex} />
                    <circle cx="11.7" cy={geom.eyeY - 0.35} r="0.28" fill={pal.tintHex} />
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

        {/* Cuerpo */}
        <g ref={bodyRef}>
          <g ref={yawRef}>
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
              fill={state === "alert" ? "rgba(239,68,68,0.20)" : `url(#${ids.body})`}
              stroke={state === "alert" ? "#F87171" : `url(#${ids.rim})`}
              strokeWidth={glassContrast ? "2.05" : "1.6"}
              strokeLinejoin="round"
            />
            {/* Reflejo especular interno */}
            <ellipse
              cx="106"
              cy="92"
              rx="15"
              ry="5"
              transform="rotate(-32 106 92)"
              fill="#FFFFFF"
              opacity="0.13"
            />
          </g>

          {/* Núcleo de energía */}
          <circle ref={coreRef} cx={C} cy={C} r="14" fill={`url(#${ids.core})`} />

          {/* Rostro */}
          <g ref={faceRef}>
            {/* Mejillas con sonrojo orgánico (detrás de ojos y boca para mantener contraste nítido) */}
            <g ref={cheekLRef} opacity="0" transform={`translate(${C - 14.5} ${C + 5.2}) scale(0.72 0.68)`}>
              <ellipse cx="0" cy="0" rx="8.2" ry="4.7" transform="rotate(-9)" fill={`url(#${ids.blush})`} />
              <ellipse ref={cheekLCoreRef} cx="0" cy="-0.2" rx="3.8" ry="2.0" transform="rotate(-9)" fill={initialColors.blushCore} opacity="0.20" />
            </g>
            <g ref={cheekRRef} opacity="0" transform={`translate(${C + 14.5} ${C + 5.2}) scale(0.72 0.68)`}>
              <ellipse cx="0" cy="0" rx="8.2" ry="4.7" transform="rotate(9)" fill={`url(#${ids.blush})`} />
              <ellipse ref={cheekRCoreRef} cx="0" cy="-0.2" rx="3.8" ry="2.0" transform="rotate(9)" fill={initialColors.blushCore} opacity="0.20" />
            </g>

            {/* Ojo izquierdo: esclerótica con zoom/squint independiente + iris/pupila redonda recortada ("ojo dentro del ojo") */}
            <g ref={eyeLRef} transform={`translate(${C - 8} ${C - 3})`}>
              <g ref={eyeOpenLRef}>
                <ellipse ref={eyeScleraLRef} cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                <g clipPath={`url(#${ids.eyeClipL})`}>
                  <circle ref={irisLRef} cx="1.1" cy="-1.5" r="1.9" fill={currentColors.eye} opacity="0.35" />
                  <circle ref={pupilLRef} cx="1.1" cy="-1.5" r="1.18" fill={currentColors.eye} />
                  <circle ref={glintLRef} cx="0.65" cy="-2.0" r="0.4" fill="#FFFFFF" opacity="0.8" />
                  <rect ref={lidShadeLRef} x="-5" y="-7.5" width="10" height="3.2" fill={currentColors.eye} opacity="0" />
                </g>
              </g>
              <path
                ref={eyeHappyLRef}
                d="M -4.5 1.5 Q 0 -5 4.5 1.5"
                stroke="#FFFFFF"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
                opacity="0"
              />
            </g>
            {/* Ojo derecho: esclerótica con zoom/squint independiente + iris/pupila redonda recortada ("ojo dentro del ojo") */}
            <g ref={eyeRRef} transform={`translate(${C + 8} ${C - 3})`}>
              <g ref={eyeOpenRRef}>
                <ellipse ref={eyeScleraRRef} cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                <g clipPath={`url(#${ids.eyeClipR})`}>
                  <circle ref={irisRRef} cx="1.1" cy="-1.5" r="1.9" fill={currentColors.eye} opacity="0.35" />
                  <circle ref={pupilRRef} cx="1.1" cy="-1.5" r="1.18" fill={currentColors.eye} />
                  <circle ref={glintRRef} cx="0.65" cy="-2.0" r="0.4" fill="#FFFFFF" opacity="0.8" />
                  <rect ref={lidShadeRRef} x="-5" y="-7.5" width="10" height="3.2" fill={currentColors.eye} opacity="0" />
                </g>
              </g>
              <path
                ref={eyeHappyRRef}
                d="M -4.5 1.5 Q 0 -5 4.5 1.5"
                stroke="#FFFFFF"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
                opacity="0"
              />
            </g>

            {/* Boca de sonrisa / concentración (hover / celebración / programación) */}
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
          </g>
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

        {/* Aro de sincronización (dos flechas circulares) */}
        <g ref={syncRef} opacity="0" transform={`translate(${C} ${C}) scale(0.0001)`}>
          {[0, 180].map((deg, idx) => (
            <g key={deg} transform={`rotate(${deg})`}>
              <path
                ref={(el) => {
                  syncPathRefs.current[idx] = el;
                }}
                d="M 82 0 A 82 82 0 0 1 0 82"
                fill="none"
                stroke={initialColors.accessory}
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.85"
              />
              <polygon
                ref={(el) => {
                  syncArrowRefs.current[idx] = el;
                }}
                points="-7,82 2,77 2,87"
                fill={initialColors.accessory}
                opacity="0.95"
              />
            </g>
          ))}
        </g>

        {/* Lupa (leyendo) */}
        <g ref={lensRef} opacity="0" transform={`translate(${C} ${C + 38}) scale(0.0001)`}>
          <line ref={lensHandleRef} x1="9.5" y1="9.5" x2="22" y2="22" stroke={initialColors.rim1} strokeWidth="4.5" strokeLinecap="round" />
          <circle ref={lensRingRef} cx="0" cy="0" r="14" fill={initialColors.rim1} fillOpacity="0.14" stroke={initialColors.bodyTint} strokeWidth="2.6" />
          <path d="M -8 -4 A 9 9 0 0 1 -2 -9" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        </g>

        {/* Mini-Laptop holográfica lateral en perspectiva 3/4 (edición de código + terminal, sin brazos) */}
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

const XOX_SILHOUETTE_PATH =
  buildStar({ phase: 0, amp: 0, lag: 0, reach: 0, wave: -1 }) +
  ellipseCutoutPath(C - 8.5 * 1.15, C - 3, 6.0, 9.2) +
  ellipseCutoutPath(C + 8.5 * 1.15, C - 3, 6.0, 9.2);

export interface XoxSilhouetteIconProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Silueta sólida de Xox (misma geometría que el ícono de la barra de menú de macOS)
 * para botones de acceso rápido y chips de personalización.
 */
export const XoxSilhouetteIcon: React.FC<XoxSilhouetteIconProps> = ({
  className = "w-4 h-4",
  style,
}) => (
  <svg
    viewBox="56 54 128 122"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
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
