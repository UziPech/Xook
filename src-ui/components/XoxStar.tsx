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
  | "syncing";

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
  /** Brillo especular dentro de los ojos. */
  pupil: string;
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
    celebrateMid: "#BAE6FD",
    celebrateGlow: "#4BE2F0",
    blush: "#F6AFCD",
    blushCore: "#FCC6D9",
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
    celebrateMid: "#E9D5FF",
    celebrateGlow: "#E9B2FF",
    blush: "#ECB1E3",
    blushCore: "#F6C7E7",
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
    celebrateMid: "#A7F3D0",
    celebrateGlow: "#5FE5C7",
    blush: "#FFC0A8",
    blushCore: "#FDD4BE",
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
    celebrateMid: "#FEF08A",
    celebrateGlow: "#E5C964",
    blush: "#FFB299",
    blushCore: "#FFCAB2",
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
    celebrateMid: "#FECDD3",
    celebrateGlow: "#FFB5A9",
    blush: "#FFBFB0",
    blushCore: "#FFD7C8",
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
      accessory: spec.accessory,
      blush: spec.blush,
      blushCore: spec.blushCore,
    };
  }
  if (state === "syncing") {
    return {
      bodyTint: spec.tint,
      bodyGlow: spec.glow,
      rim1: spec.rim,
      rim2: spec.rim2,
      core: "#FFFFFF",
      mid: spec.mid,
      glow: spec.accessory,
      pupil: spec.pupil,
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
const toRad = (d: number) => (d * Math.PI) / 180;

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
  t: number;
  amp: number;
  speed: number;
  lag: number; // grados que las puntas se arrastran tras el giro
  reach: number; // estiramiento extra de las puntas (hover)
  wave: number; // fase del saludo (-1 = sin saludo)
}

function buildStar({ t, amp, speed, lag, reach, wave }: ShapeParams): string {
  for (let i = 0; i < 5; i++) {
    let pa = PEAKS[i].a + lag + 2.2 * amp * Math.sin(t * 1.1 * speed + i * 2.1);
    let pr = PEAKS[i].r * (1 + 0.035 * amp * Math.sin(t * 1.6 * speed + i * 1.35) + reach);

    // Saludo con el brazo superior derecho
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
    const vr = VALLEYS[i].r * (1 + 0.045 * amp * Math.sin(t * 2 * speed + i * 0.9 + 1));
    const vIdx = pIdx + 1;
    STAR_PTS[vIdx][0] = C + vr * Math.cos(toRad(va));
    STAR_PTS[vIdx][1] = C + vr * Math.sin(toRad(va));
    STAR_RADII[vIdx] = VALLEY_ROUND;
  }
  return roundedPath(STAR_PTS, STAR_RADII);
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
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-body-${uid}`,
    rim: `xox-rim-${uid}`,
    core: `xox-core-${uid}`,
    glow: `xox-glow-${uid}`,
    cradle: `xox-cradle-${uid}`,
    blush: `xox-blush-${uid}`,
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
  const pupilLRef = useRef<SVGCircleElement>(null);
  const pupilRRef = useRef<SVGCircleElement>(null);
  const cheekLRef = useRef<SVGGElement>(null);
  const cheekRRef = useRef<SVGGElement>(null);
  const cheekLCoreRef = useRef<SVGEllipseElement>(null);
  const cheekRCoreRef = useRef<SVGEllipseElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const talkMouthRef = useRef<SVGEllipseElement>(null);
  const talkWaveRef = useRef<SVGGElement>(null);
  const talkWave1Ref = useRef<SVGPathElement>(null);
  const talkWave2Ref = useRef<SVGPathElement>(null);
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([]);
  const subagentSatRefs = useRef<(SVGGElement | null)[]>([]);
  const subagentsRef = useRef<XoxSubagentOrbitItem[] | undefined>(subagents);
  subagentsRef.current = subagents;
  const syncPathRefs = useRef<(SVGPathElement | null)[]>([]);
  const syncArrowRefs = useRef<(SVGPolygonElement | null)[]>([]);
  const lensHandleRef = useRef<SVGLineElement>(null);
  const lensRingRef = useRef<SVGCircleElement>(null);
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
    reduce: false,
    spinTarget: 0,
    windupUntil: 0,
    lastSpin: -10,
    squashKick: 0,
    jumpKick: 0,
    waveStart: -10,
    summonAt: -10,
    colorMorphAt: -10,
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
    () => buildStar({ t: 0, amp: 1, speed: 1, lag: 0, reach: 0, wave: -1 }),
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
    stateRef.current = state;
    if (state === "success") {
      const a = anim.current;
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
    // Resortes de aparición (pop con overshoot) de cada accesorio
    const popLens: Spring = { x: 0, v: 0 };
    const popBubble: Spring = { x: 0, v: 0 };
    const popBang: Spring = { x: 0, v: 0 };
    const popSync: Spring = { x: 0, v: 0 };
    const popTalk: Spring = { x: 0, v: 0 };
    const setProp = (el: SVGElement | null, pop: number, transform: string) => {
      if (!el) return;
      const s = Math.max(pop, 0.0001);
      el.setAttribute("transform", transform.replace("$S", s.toFixed(4)));
      el.setAttribute("opacity", clamp(pop * 1.4, 0, 1).toFixed(3));
    };

    let raf = 0;
    let last = performance.now();
    let nextBlink = a.t + 1.6;
    let blinkStart = -1;
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
      step(lookX, tx, 90, 13, dt);
      step(lookY, ty, 90, 13, dt);

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
      const successBlush = st === "success" ? 0.96 : 0;
      const blushTarget = alerting
        ? 0
        : clamp(Math.max(successBlush, boostBlush, interactiveBlush), 0, 1);
      const blushRising = blushTarget > blush.x;
      const windup = a.windupUntil ? -18 : 0;
      const sway =
        (thinking
          ? 5.5 * Math.sin(t * 2.2)
          : talking
          ? 4.4 * Math.sin(t * 3.1)
          : 3.4 * Math.sin(t * 0.85) + (alerting ? 3.2 * Math.sin(t * 23) : 0)) * A;
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
      const bob = (
        thinking
          ? 4.5 * Math.sin(t * 2.4)
          : talking
          ? 2.8 * Math.sin(t * 6.4) + 1.8 * Math.sin(t * 2.0)
          : alerting
          ? 2 * Math.sin(t * 9)
          : 3.2 * Math.sin(t * 1.15)
      ) * A;
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

      // --- Cuerpo gelatinoso (follow-through en las puntas) ---------------
      const lag = clamp(-rot.v * 0.014, -14, 14);
      const starPath = buildStar({
        t,
        amp: (thinking ? 1.6 : alerting ? 2.1 : 1) * A,
        speed: thinking ? 1.8 : alerting ? 3.2 : 1,
        lag,
        reach: hover.x * 0.03,
        wave: t - a.waveStart,
      });
      starRef.current?.setAttribute("d", starPath);
      starUnderlayRef.current?.setAttribute("d", starPath);

      // --- Núcleo y aura --------------------------------------------------
      coreRef.current?.setAttribute(
        "r",
        (thinking
          ? 19 + 3 * Math.sin(t * 6)
          : talking
          ? 15.5 + 2.5 * Math.abs(Math.sin(t * 9.5))
          : alerting
          ? 16 + 3 * Math.sin(t * 9)
          : 14 + 1.2 * Math.sin(t * 2)
        ).toFixed(2)
      );
      const summonPhase = (t - a.summonAt) / 0.65;
      const summonActive = summonPhase >= 0 && summonPhase <= 1 && !a.reduce;
      const colorMorphPhase = (t - a.colorMorphAt) / 0.72;
      const colorMorphActive = colorMorphPhase >= 0 && colorMorphPhase <= 1;

      // Interpolación perceptual en OKLab sobre stops, accesorios, pupilas y sonrojo
      const cs = colorStateRef.current;
      const colorAlpha = a.reduce ? 1 : 1 - Math.exp(-9.5 * dt);
      const cBodyTint = stepOklab(cs.cur.bodyTint, cs.target.bodyTint, colorAlpha);
      const cBodyGlow = stepOklab(cs.cur.bodyGlow, cs.target.bodyGlow, colorAlpha);
      const cRim1 = stepOklab(cs.cur.rim1, cs.target.rim1, colorAlpha);
      const cRim2 = stepOklab(cs.cur.rim2, cs.target.rim2, colorAlpha);
      const cCore = stepOklab(cs.cur.core, cs.target.core, colorAlpha);
      const cMid = stepOklab(cs.cur.mid, cs.target.mid, colorAlpha);
      const cGlow = stepOklab(cs.cur.glow, cs.target.glow, colorAlpha);
      const cPupil = stepOklab(cs.cur.pupil, cs.target.pupil, colorAlpha);
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
      pupilLRef.current?.setAttribute("fill", cPupil);
      pupilRRef.current?.setAttribute("fill", cPupil);
      ringRef.current?.setAttribute("stroke", cAccessory);
      talkWave1Ref.current?.setAttribute("stroke", cRim1);
      talkWave2Ref.current?.setAttribute("stroke", cGlow);
      syncPathRefs.current.forEach((p) => p?.setAttribute("stroke", cAccessory));
      syncArrowRefs.current.forEach((p) => p?.setAttribute("fill", cAccessory));
      lensHandleRef.current?.setAttribute("stroke", cRim1);
      lensRingRef.current?.setAttribute("stroke", cBodyTint);
      lensRingRef.current?.setAttribute("fill", cRim1);
      summonRingRef.current?.setAttribute("stroke", cGlow);

      if (cradleRef.current) {
        cradleRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
      }

      if (glowRef.current) {
        const summonBoost = summonActive ? 0.38 * (1 - summonPhase) : 0;
        const colorBoost = colorMorphActive && !a.reduce ? 0.25 * Math.sin(colorMorphPhase * Math.PI) : 0;
        glowRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
        glowRef.current.setAttribute(
          "opacity",
          clamp(
            (thinking
              ? 0.85 + 0.15 * Math.sin(t * 5)
              : alerting
              ? 0.75 + 0.25 * Math.sin(t * 8)
              : 0.55 + 0.3 * hover.x) + summonBoost + colorBoost,
            0,
            1
          ).toFixed(3)
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
      if (ringRef.current) {
        ringRef.current.setAttribute(
          "transform",
          `translate(${C} ${y.toFixed(2)}) rotate(-18)`
        );
        ringRef.current.setAttribute("stroke-dashoffset", (-t * 40).toFixed(1));
      }

      // --- Accesorios por estado (aparecen con pop elástico) ---------------
      step(popLens, reading ? 1 : 0, 170, 13, dt);
      step(popBubble, thinking ? 1 : 0, 170, 13, dt);
      step(popBang, alerting ? 1 : 0, 220, 12, dt);
      step(popSync, syncing ? 1 : 0, 120, 14, dt);
      step(popTalk, talking ? 1 : 0, 220, 16, dt);

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

      // --- Rostro: mirada, parpadeo, perspectiva --------------------------
      if (t > nextBlink) {
        blinkStart = t;
        nextBlink = t + (Math.random() < 0.2 ? 0.28 : 2.8 + Math.random() * 3.5);
      }
      const bt = t - blinkStart;
      const blink = bt >= 0 && bt < 0.15 ? Math.sin((bt / 0.15) * Math.PI) : 0;

      faceRef.current?.setAttribute(
        "transform",
        `translate(${(lookX.x * 9).toFixed(2)} ${(lookY.x * 6 - hover.x * 1.5).toFixed(2)})`
      );
      const sep = 8 * (1 - 0.22 * Math.abs(lookX.x));
      const eyeSY = (1 - 0.9 * blink) * (1 + hover.x * 0.08) * (st === "alert" ? 1.15 : 1);
      const lsx = (1 - Math.max(0, -lookX.x) * 0.3) * (1 + hover.x * 0.06);
      const rsx = (1 - Math.max(0, lookX.x) * 0.3) * (1 + hover.x * 0.06);
      eyeLRef.current?.setAttribute(
        "transform",
        `translate(${(C - sep).toFixed(2)} ${C - 3}) scale(${lsx.toFixed(3)} ${eyeSY.toFixed(3)})`
      );
      eyeRRef.current?.setAttribute(
        "transform",
        `translate(${(C + sep).toFixed(2)} ${C - 3}) scale(${rsx.toFixed(3)} ${eyeSY.toFixed(3)})`
      );
      const talkWeight = clamp(popTalk.x, 0, 1);
      const talkCadence = talking || talkWeight > 0.02
        ? Math.pow(0.5 + 0.5 * Math.sin(t * 14.5) * Math.cos(t * 6.1), 1.25)
        : 0;
      mouthRef.current?.setAttribute(
        "opacity",
        (Math.max(hover.x, st === "success" ? 1 : 0) * (1 - talkWeight) * 0.85).toFixed(3)
      );

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

      if (talkMouthRef.current) {
        const rx = 4.8 - 1.2 * talkCadence;
        const ry = 1.35 + 3.45 * talkCadence;
        talkMouthRef.current.setAttribute("rx", rx.toFixed(2));
        talkMouthRef.current.setAttribute("ry", ry.toFixed(2));
        talkMouthRef.current.setAttribute("opacity", (talkWeight * 0.96).toFixed(3));
      }
      if (talkWaveRef.current) {
        const waveScale = Math.max(popTalk.x * (0.92 + 0.14 * talkCadence), 0.0001);
        talkWaveRef.current.setAttribute(
          "transform",
          `translate(${(C + 68).toFixed(2)} ${(y - 8 + 2 * Math.sin(t * 7)).toFixed(2)}) scale(${waveScale.toFixed(4)})`
        );
        talkWaveRef.current.setAttribute(
          "opacity",
          (talkWeight * (0.55 + 0.45 * talkCadence)).toFixed(3)
        );
      }

      // --- Chispas en órbita elíptica (profundidad por opacidad + color morph) ---
      const colorOrbitBoost =
        colorMorphActive && !a.reduce ? 1.8 * Math.sin(colorMorphPhase * Math.PI) : 0;
      const orbitBoost =
        (thinking ? 2.2 : talking ? 1.45 : dragging ? 1 + dragSpeed * 1.4 : 1) + colorOrbitBoost;
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
    if (a.t - a.waveStart > 4) a.waveStart = a.t; // saluda con el brazo
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
          {/* Aura dibujada dentro del SVG: se desvanece a 0 antes del borde */}
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.glow0 = el; }} offset="0%" stopColor={initialColors.glow} stopOpacity="0.32" />
            <stop ref={(el) => { stopRefs.current.glow1 = el; }} offset="45%" stopColor={initialColors.glow} stopOpacity="0.10" />
            <stop ref={(el) => { stopRefs.current.glow2 = el; }} offset="100%" stopColor={initialColors.glow} stopOpacity="0" />
          </radialGradient>
          {/* Sonrojo orgánico difuminado sin bordes duros ni exceso de rojez */}
          <radialGradient id={ids.blush} cx="50%" cy="50%" r="50%">
            <stop ref={(el) => { stopRefs.current.blush0 = el; }} offset="0%" stopColor={initialColors.blush} stopOpacity="0.62" />
            <stop ref={(el) => { stopRefs.current.blush1 = el; }} offset="50%" stopColor={initialColors.blush} stopOpacity="0.24" />
            <stop ref={(el) => { stopRefs.current.blush2 = el; }} offset="100%" stopColor={initialColors.blush} stopOpacity="0" />
          </radialGradient>
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
        <circle ref={glowRef} cx={C} cy={C} r="105" fill={`url(#${ids.glow})`} opacity="0.55" />

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

        {/* Anillo de datos al pensar */}
        {state === "thinking" && (
          <ellipse
            ref={ringRef}
            cx="0"
            cy="0"
            rx="86"
            ry="28"
            transform={`translate(${C} ${C}) rotate(-18)`}
            fill="none"
            stroke={currentColors.accessory}
            strokeWidth="1.2"
            strokeDasharray="5 7"
            strokeLinecap="round"
            opacity="0.7"
          />
        )}

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

            <g ref={eyeLRef} transform={`translate(${C - 8} ${C - 3})`}>
              {state === "success" ? (
                <path d="M -4.5 1.5 Q 0 -5 4.5 1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              ) : (
                <>
                  <ellipse cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                  <circle ref={pupilLRef} cx="1.3" cy="-1.9" r="1.15" fill={currentColors.pupil} />
                </>
              )}
            </g>
            <g ref={eyeRRef} transform={`translate(${C + 8} ${C - 3})`}>
              {state === "success" ? (
                <path d="M -4.5 1.5 Q 0 -5 4.5 1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              ) : (
                <>
                  <ellipse cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                  <circle ref={pupilRRef} cx="1.3" cy="-1.9" r="1.15" fill={currentColors.pupil} />
                </>
              )}
            </g>

            {/* Boca: aparece al hacer hover o al celebrar */}
            <path
              ref={mouthRef}
              d={state === "success" ? `M ${C - 4.5} ${C + 6} Q ${C} ${C + 11} ${C + 4.5} ${C + 6}` : `M ${C - 3} ${C + 6.5} Q ${C} ${C + 9} ${C + 3} ${C + 6.5}`}
              stroke="#FFFFFF"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
              opacity="0"
            />
            {/* Boca articulada al hablar en vivo */}
            <ellipse
              ref={talkMouthRef}
              cx={C}
              cy={C + 8.5}
              rx="4.6"
              ry="2.6"
              fill="#0B1324"
              stroke="#FFFFFF"
              strokeWidth="1.35"
              opacity="0"
            />
          </g>
        </g>

        {/* Ondas discretas de voz al hablar (talking) */}
        <g ref={talkWaveRef} opacity="0" transform={`translate(${C + 68} ${C - 8}) scale(0.0001)`}>
          <path
            ref={talkWave1Ref}
            d="M 0 -7 Q 6 0 0 7"
            fill="none"
            stroke={initialColors.rim1}
            strokeWidth="2.1"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            ref={talkWave2Ref}
            d="M 6.5 -12 Q 15 0 6.5 12"
            fill="none"
            stroke={initialColors.glow}
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.65"
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
  buildStar({ t: 0, amp: 0, speed: 1, lag: 0, reach: 0, wave: -1 }) +
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
