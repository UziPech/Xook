import React, { useEffect, useId, useMemo, useRef } from "react";
import type { XoxDragMotion } from "./XoxStar";

interface QuickLiquidLayerProps {
  /** Telemetría de arrastre para que el líquido reaccione con inercia (slosh). */
  motionRef: React.RefObject<XoxDragMotion | null>;
  /** Desactiva el bucle rAF mientras la cápsula está oculta o saliendo. */
  active?: boolean;
  /** Aumenta sutilmente la corriente cuando Xox está procesando. */
  busy?: boolean;
  /** Indica arrastre o recentrado en curso. */
  dragging?: boolean;
}

type LiquidSpring = { x: number; v: number };

const VIEW_W = 620;
const VIEW_H = 140;
const WAVE_SAMPLES = 15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const stepSpring = (s: LiquidSpring, target: number, k: number, c: number, dt: number) => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};

interface WavePathOptions {
  baseY: number;
  tiltY: number;
  phase1: number;
  phase2: number;
  freq1: number;
  freq2: number;
  amp1: number;
  amp2: number;
}

const WAVE_X = new Float64Array(WAVE_SAMPLES + 1);
const WAVE_Y = new Float64Array(WAVE_SAMPLES + 1);
const CREST_SEGMENTS = new Array<string>(WAVE_SAMPLES + 1);

/**
 * Construye una onda orgánica C¹ (curvas cuadráticas por punto medio) y su relleno inferior
 * usando buffers reutilizables sin asignaciones de objetos por frame.
 */
function buildFluidWavePaths({
  baseY,
  tiltY,
  phase1,
  phase2,
  freq1,
  freq2,
  amp1,
  amp2,
}: WavePathOptions): { fillPath: string; crestPath: string } {
  const startX = -20;
  const endX = VIEW_W + 20;
  const span = endX - startX;

  for (let i = 0; i <= WAVE_SAMPLES; i++) {
    const u = i / WAVE_SAMPLES;
    WAVE_X[i] = startX + u * span;
    const slopeOffset = (u - 0.5) * 2 * tiltY;
    WAVE_Y[i] =
      baseY +
      slopeOffset +
      amp1 * Math.sin(u * freq1 * Math.PI * 2 + phase1) +
      amp2 * Math.cos(u * freq2 * Math.PI * 2 - phase2);
  }

  CREST_SEGMENTS[0] = `M ${WAVE_X[0].toFixed(1)} ${WAVE_Y[0].toFixed(1)}`;
  for (let i = 1; i < WAVE_SAMPLES; i++) {
    const midX = (WAVE_X[i] + WAVE_X[i + 1]) * 0.5;
    const midY = (WAVE_Y[i] + WAVE_Y[i + 1]) * 0.5;
    CREST_SEGMENTS[i] = ` Q ${WAVE_X[i].toFixed(1)} ${WAVE_Y[i].toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  CREST_SEGMENTS[WAVE_SAMPLES] = ` L ${WAVE_X[WAVE_SAMPLES].toFixed(1)} ${WAVE_Y[WAVE_SAMPLES].toFixed(1)}`;

  const crestPath = CREST_SEGMENTS.join("");
  const fillPath = `${crestPath} L ${endX} ${VIEW_H + 40} L ${startX} ${VIEW_H + 40} Z`;
  return { fillPath, crestPath };
}

/**
 * Capa de líquido vivo y óptica Liquid Glass dentro de la cápsula Quick Bar.
 *
 * Usa únicamente trazos SVG, gradientes multi-stop y transformaciones 2D (sin CSS filter,
 * feGaussianBlur ni backdrop-filter) para mantener total transparencia sin capas negras en WKWebView.
 */
export const QuickLiquidLayer: React.FC<QuickLiquidLayerProps> = ({
  motionRef,
  active = true,
  busy = false,
  dragging = false,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = useMemo(
    () => ({
      meniscus: `ql-meniscus-${uid}`,
      waveA: `ql-wave-a-${uid}`,
      waveB: `ql-wave-b-${uid}`,
      crestA: `ql-crest-a-${uid}`,
      causticLine: `ql-caustic-line-${uid}`,
      poolCyan: `ql-pool-cyan-${uid}`,
      poolAqua: `ql-pool-aqua-${uid}`,
      poolViolet: `ql-pool-violet-${uid}`,
      poolMagenta: `ql-pool-magenta-${uid}`,
      glare: `ql-glare-${uid}`,
    }),
    [uid]
  );

  const stateFlagsRef = useRef({ active, busy, dragging });
  stateFlagsRef.current = { active, busy, dragging };

  const poolCyanRef = useRef<SVGEllipseElement>(null);
  const poolAquaRef = useRef<SVGEllipseElement>(null);
  const poolVioletRef = useRef<SVGEllipseElement>(null);
  const poolMagentaRef = useRef<SVGEllipseElement>(null);
  const waveBFillRef = useRef<SVGPathElement>(null);
  const waveAFillRef = useRef<SVGPathElement>(null);
  const waveACrestRef = useRef<SVGPathElement>(null);
  const causticLineRef = useRef<SVGPathElement>(null);
  const glareRef = useRef<SVGRectElement>(null);

  const initialGeometry = useMemo(() => {
    const waveA = buildFluidWavePaths({
      baseY: 76,
      tiltY: 0,
      phase1: 0.4,
      phase2: 1.1,
      freq1: 1.35,
      freq2: 2.2,
      amp1: 11,
      amp2: 5,
    });
    const waveB = buildFluidWavePaths({
      baseY: 54,
      tiltY: 0,
      phase1: 2.1,
      phase2: 0.6,
      freq1: 1.1,
      freq2: 1.9,
      amp1: 12,
      amp2: 5.5,
    });
    const caustic = buildFluidWavePaths({
      baseY: 34,
      tiltY: 0,
      phase1: 1.3,
      phase2: 2.4,
      freq1: 1.6,
      freq2: 2.7,
      amp1: 7,
      amp2: 3.5,
    });
    return { waveA, waveB, caustic };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mediaQuery?.matches || !active) return;

    let rafId = 0;
    let lastTime = performance.now();
    let lastDrawTime = 0;
    let t = 0;
    let phaseA = 0.4;
    let phaseB = 2.1;
    let phaseCaustic = 1.3;

    // Resortes subamortiguados para el oleaje interno (slosh) al mover/soltar la barra
    const sloshX: LiquidSpring = { x: 0, v: 0 };
    const sloshY: LiquidSpring = { x: 0, v: 0 };
    const tiltSpring: LiquidSpring = { x: 0, v: 0 };
    const energySpring: LiquidSpring = { x: 0, v: 0 };

    const tick = (now: number) => {
      if (document.hidden || !stateFlagsRef.current.active) {
        rafId = 0;
        return;
      }

      const flags = stateFlagsRef.current;
      const isCalmIdle =
        !flags.dragging &&
        !flags.busy &&
        Math.abs(sloshX.v) < 1.2 &&
        Math.abs(sloshY.v) < 1.2 &&
        Math.abs(tiltSpring.v) < 0.8 &&
        Math.abs(energySpring.x) < 0.04;

      if (isCalmIdle && lastDrawTime > 0 && now - lastDrawTime < 36) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastDrawTime = now;

      const dt = Math.min(Math.max((now - lastTime) / 1000, 1 / 240), 1 / 20);
      lastTime = now;
      t += dt;

      const motion = motionRef.current;
      const vx = motion && motion.active ? motion.vx : 0;
      const vy = motion && motion.active ? motion.vy : 0;
      const speed = Math.hypot(vx, vy);

      const targetSloshX = clamp(-vx * 0.055, -56, 56);
      const targetSloshY = clamp(-vy * 0.036, -24, 24);
      const targetTilt = clamp(-vx * 0.015, -18, 18);
      const targetEnergy = clamp(
        speed / 720 + (flags.dragging ? 0.28 : 0) + (flags.busy ? 0.42 : 0),
        0,
        1.15
      );

      // Baja amortiguación para permitir 2-3 vaivenes naturales del líquido tras soltar
      stepSpring(sloshX, targetSloshX, 58, 5.1, dt);
      stepSpring(sloshY, targetSloshY, 68, 5.6, dt);
      stepSpring(tiltSpring, targetTilt, 62, 4.9, dt);
      stepSpring(energySpring, targetEnergy, 42, 10.5, dt);

      const e = Math.max(0, energySpring.x);
      const flowSpeed = 1 + e * 1.45;
      phaseA += dt * 1.05 * flowSpeed + (sloshX.v * dt) * 0.003;
      phaseB -= dt * 0.82 * flowSpeed - (sloshX.v * dt) * 0.0025;
      phaseCaustic += dt * 1.38 * flowSpeed;

      // 1. Gotas/pozos líquidos flotando e inclinándose por inercia
      if (poolCyanRef.current) {
        const cx = 148 + 74 * Math.sin(t * 0.44 + 0.3) + sloshX.x * 0.85;
        const cy = 72 + 22 * Math.cos(t * 0.58) + sloshY.x * 0.72;
        const rx = 148 + 20 * Math.sin(t * 0.7) + Math.abs(sloshX.x) * 0.35;
        const ry = 56 + 9 * Math.cos(t * 0.63);
        poolCyanRef.current.setAttribute("cx", cx.toFixed(1));
        poolCyanRef.current.setAttribute("cy", cy.toFixed(1));
        poolCyanRef.current.setAttribute("rx", rx.toFixed(1));
        poolCyanRef.current.setAttribute("ry", ry.toFixed(1));
        poolCyanRef.current.setAttribute("opacity", (0.72 + e * 0.24).toFixed(3));
      }

      if (poolAquaRef.current) {
        const cx = 330 + 96 * Math.cos(t * 0.37 + 1.2) + sloshX.x * 0.95;
        const cy = 66 + 24 * Math.sin(t * 0.51 + 0.8) + sloshY.x * 0.8;
        const rx = 165 + 22 * Math.cos(t * 0.55) + Math.abs(sloshX.x) * 0.28;
        const ry = 58 + 10 * Math.sin(t * 0.49);
        poolAquaRef.current.setAttribute("cx", cx.toFixed(1));
        poolAquaRef.current.setAttribute("cy", cy.toFixed(1));
        poolAquaRef.current.setAttribute("rx", rx.toFixed(1));
        poolAquaRef.current.setAttribute("ry", ry.toFixed(1));
        poolAquaRef.current.setAttribute("opacity", (0.64 + e * 0.26).toFixed(3));
      }

      if (poolVioletRef.current) {
        const cx = 486 + 70 * Math.sin(t * 0.49 + 2.4) + sloshX.x * 0.75;
        const cy = 76 + 20 * Math.cos(t * 0.62 + 1.5) + sloshY.x * 0.68;
        const rx = 142 + 18 * Math.sin(t * 0.68 + 1.0);
        const ry = 54 + 8 * Math.cos(t * 0.54);
        poolVioletRef.current.setAttribute("cx", cx.toFixed(1));
        poolVioletRef.current.setAttribute("cy", cy.toFixed(1));
        poolVioletRef.current.setAttribute("rx", rx.toFixed(1));
        poolVioletRef.current.setAttribute("ry", ry.toFixed(1));
        poolVioletRef.current.setAttribute("opacity", (0.62 + e * 0.24).toFixed(3));
      }

      if (poolMagentaRef.current) {
        const cx = 372 + 112 * Math.sin(t * 0.34 + 3.6) + sloshX.x * 0.88;
        const cy = 58 + 20 * Math.cos(t * 0.46 + 0.5) + sloshY.x * 0.76;
        const rx = 118 + 16 * Math.cos(t * 0.52 + 0.4);
        const ry = 46 + 7 * Math.sin(t * 0.43);
        poolMagentaRef.current.setAttribute("cx", cx.toFixed(1));
        poolMagentaRef.current.setAttribute("cy", cy.toFixed(1));
        poolMagentaRef.current.setAttribute("rx", rx.toFixed(1));
        poolMagentaRef.current.setAttribute("ry", ry.toFixed(1));
        poolMagentaRef.current.setAttribute("opacity", (0.58 + e * 0.24).toFixed(3));
      }

      // 2. Corrientes de onda líquida con cresta cáustica
      const sloshWaveAmp = 1 + e * 0.68 + Math.min(0.45, Math.abs(tiltSpring.v) * 0.005);
      const liftY = clamp(sloshY.x * 0.42, -12, 12);

      const waveB = buildFluidWavePaths({
        baseY: 54 + liftY * 0.7 + 4.5 * Math.sin(t * 0.6),
        tiltY: tiltSpring.x * 0.74,
        phase1: phaseB,
        phase2: phaseA * 0.85,
        freq1: 1.1,
        freq2: 1.9,
        amp1: 12 * sloshWaveAmp,
        amp2: 5.5 * sloshWaveAmp,
      });

      if (waveBFillRef.current) {
        waveBFillRef.current.setAttribute("d", waveB.fillPath);
        waveBFillRef.current.setAttribute("opacity", (0.64 + e * 0.24).toFixed(3));
      }

      const waveA = buildFluidWavePaths({
        baseY: 76 + liftY + 4 * Math.cos(t * 0.75),
        tiltY: tiltSpring.x,
        phase1: phaseA,
        phase2: phaseB * 1.1,
        freq1: 1.35,
        freq2: 2.2,
        amp1: 11 * sloshWaveAmp,
        amp2: 5 * sloshWaveAmp,
      });

      if (waveAFillRef.current) {
        waveAFillRef.current.setAttribute("d", waveA.fillPath);
        waveAFillRef.current.setAttribute("opacity", (0.72 + e * 0.22).toFixed(3));
      }
      if (waveACrestRef.current) {
        waveACrestRef.current.setAttribute("d", waveA.crestPath);
        waveACrestRef.current.setAttribute("opacity", (0.54 + e * 0.34).toFixed(3));
      }

      // 3. Filamento cáustico superior
      const caustic = buildFluidWavePaths({
        baseY: 34 + liftY * 0.45 + 3 * Math.sin(t * 0.9),
        tiltY: -tiltSpring.x * 0.45,
        phase1: phaseCaustic,
        phase2: phaseA * 1.3,
        freq1: 1.6,
        freq2: 2.7,
        amp1: 7 * (0.9 + e * 0.55),
        amp2: 3.5 * (0.9 + e * 0.55),
      });
      if (causticLineRef.current) {
        causticLineRef.current.setAttribute("d", caustic.crestPath);
        causticLineRef.current.setAttribute("opacity", (0.34 + e * 0.32).toFixed(3));
      }

      // 4. Reflejo especular deslizante sobre el menisco superior del cristal
      if (glareRef.current) {
        const glareX = 220 + 135 * Math.sin(t * 0.32) - clamp(sloshX.x * 2.1, -120, 120);
        glareRef.current.setAttribute(
          "transform",
          `translate(${glareX.toFixed(1)} 0) skewX(-24)`
        );
        glareRef.current.setAttribute("opacity", (0.34 + e * 0.32).toFixed(3));
      }

      rafId = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (!document.hidden && !rafId && stateFlagsRef.current.active) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    rafId = requestAnimationFrame(tick);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [active, motionRef]);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="quick-liquid-canvas absolute inset-0 w-full h-full pointer-events-none"
    >
      <defs>
        {/* Reflejo curvo superior/inferior del vidrio */}
        <linearGradient id={ids.meniscus} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="22%" stopColor="#E0F2FE" stopOpacity="0.05" />
          <stop offset="48%" stopColor="#E0F2FE" stopOpacity="0" />
          <stop offset="86%" stopColor="#7DD3FC" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#BAE6FD" stopOpacity="0.09" />
        </linearGradient>

        {/* Gradientes líquidos multi-stop puros (funden a su propio matiz con opacidad 0) */}
        <radialGradient id={ids.poolCyan} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.28" />
          <stop offset="42%" stopColor="#38BDF8" stopOpacity="0.12" />
          <stop offset="76%" stopColor="#38BDF8" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={ids.poolAqua} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5EEAD4" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#2DD4BF" stopOpacity="0.09" />
          <stop offset="78%" stopColor="#2DD4BF" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#2DD4BF" stopOpacity="0" />
        </radialGradient>

        <radialGradient id={ids.poolViolet} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.20" />
          <stop offset="45%" stopColor="#818CF8" stopOpacity="0.08" />
          <stop offset="78%" stopColor="#7DD3FC" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
        </radialGradient>

        {/* Matiz sutil de aurora boreal (rojo-coral / magenta tenue) */}
        <radialGradient id={ids.poolMagenta} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FB7185" stopOpacity="0.14" />
          <stop offset="42%" stopColor="#F472B6" stopOpacity="0.08" />
          <stop offset="76%" stopColor="#E879F9" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#E879F9" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={ids.waveB} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34D399" stopOpacity="0.14" />
          <stop offset="38%" stopColor="#38BDF8" stopOpacity="0.11" />
          <stop offset="72%" stopColor="#F472B6" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.14" />
        </linearGradient>

        <linearGradient id={ids.waveA} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E0F2FE" stopOpacity="0.16" />
          <stop offset="40%" stopColor="#7DD3FC" stopOpacity="0.15" />
          <stop offset="74%" stopColor="#C084FC" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#FB7185" stopOpacity="0.08" />
        </linearGradient>

        <linearGradient id={ids.crestA} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.04" />
          <stop offset="16%" stopColor="#E0F2FE" stopOpacity="0.48" />
          <stop offset="56%" stopColor="#BAE6FD" stopOpacity="0.46" />
          <stop offset="80%" stopColor="#FBCFE8" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.08" />
        </linearGradient>

        <linearGradient id={ids.causticLine} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="18%" stopColor="#E0F2FE" stopOpacity="0.28" />
          <stop offset="54%" stopColor="#5EEAD4" stopOpacity="0.26" />
          <stop offset="78%" stopColor="#F9A8D4" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        <linearGradient id={ids.glare} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="55%" stopColor="#E0F2FE" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 1. Brillo de lente Liquid Glass */}
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${ids.meniscus})`} />

      {/* 2. Pozos líquidos flotando en corrientes internas */}
      <ellipse
        ref={poolCyanRef}
        cx="148"
        cy="72"
        rx="148"
        ry="56"
        fill={`url(#${ids.poolCyan})`}
        opacity="0.72"
      />
      <ellipse
        ref={poolAquaRef}
        cx="330"
        cy="66"
        rx="165"
        ry="58"
        fill={`url(#${ids.poolAqua})`}
        opacity="0.64"
      />
      <ellipse
        ref={poolVioletRef}
        cx="486"
        cy="76"
        rx="142"
        ry="54"
        fill={`url(#${ids.poolViolet})`}
        opacity="0.62"
      />
      <ellipse
        ref={poolMagentaRef}
        cx="372"
        cy="58"
        rx="118"
        ry="46"
        fill={`url(#${ids.poolMagenta})`}
        opacity="0.58"
      />

      {/* 3. Onda líquida trasera + principal + cresta cáustica */}
      <path
        ref={waveBFillRef}
        d={initialGeometry.waveB.fillPath}
        fill={`url(#${ids.waveB})`}
        opacity="0.64"
      />
      <path
        ref={waveAFillRef}
        d={initialGeometry.waveA.fillPath}
        fill={`url(#${ids.waveA})`}
        opacity="0.72"
      />
      <path
        ref={waveACrestRef}
        d={initialGeometry.waveA.crestPath}
        fill="none"
        stroke={`url(#${ids.crestA})`}
        strokeWidth="1.25"
        opacity="0.54"
      />

      {/* 4. Filamento cáustico superior */}
      <path
        ref={causticLineRef}
        d={initialGeometry.caustic.crestPath}
        fill="none"
        stroke={`url(#${ids.causticLine})`}
        strokeWidth="1"
        opacity="0.34"
      />

      {/* 5. Destello especular dinámico sobre la superficie vítrea */}
      <rect
        ref={glareRef}
        x="0"
        y="-10"
        width="170"
        height={VIEW_H + 20}
        transform="translate(220 0) skewX(-24)"
        fill={`url(#${ids.glare})`}
        opacity="0.34"
      />
    </svg>
  );
};
