import React, { useEffect, useId, useMemo, useRef } from "react";

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

const PALETTE: Record<XoxState, { core: string; mid: string; glow: string }> = {
  idle: { core: "#FFFFFF", mid: "#7DD3FC", glow: "#7DD3FC" },
  talking: { core: "#FFFFFF", mid: "#7DD3FC", glow: "#7DD3FC" },
  thinking: { core: "#38BDF8", mid: "#0284C7", glow: "#38BDF8" },
  success: { core: "#34D399", mid: "#059669", glow: "#34D399" },
  alert: { core: "#FCA5A5", mid: "#DC2626", glow: "#EF4444" },
  reading: { core: "#FFFFFF", mid: "#7DD3FC", glow: "#7DD3FC" },
  syncing: { core: "#FFFFFF", mid: "#2DD4BF", glow: "#2DD4BF" },
};

type Spring = { x: number; v: number };
const step = (s: Spring, target: number, k: number, c: number, dt: number) => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toRad = (d: number) => (d * Math.PI) / 180;

/** Polígono con esquinas redondeadas (curvas cuadráticas en cada vértice). */
function roundedPath(pts: number[][], radii: number[]): string {
  const n = pts.length;
  let d = "";
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
    d += `${i === 0 ? "M" : "L"}${ax.toFixed(2)} ${ay.toFixed(2)}Q${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
  }
  return d + "Z";
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
  const pts: number[][] = [];
  const radii: number[] = [];
  for (let i = 0; i < 5; i++) {
    let pa = PEAKS[i].a + lag + 2.2 * amp * Math.sin(t * 1.1 * speed + i * 2.1);
    let pr = PEAKS[i].r * (1 + 0.035 * amp * Math.sin(t * 1.6 * speed + i * 1.35) + reach);

    // Saludo con el brazo superior derecho
    if (i === 1 && wave >= 0 && wave < 1.3) {
      const env = Math.sin((wave / 1.3) * Math.PI);
      pa += Math.sin(wave * 13) * 14 * env * amp;
      pr *= 1 + 0.06 * env;
    }

    pts.push([C + pr * Math.cos(toRad(pa)), C + pr * Math.sin(toRad(pa))]);
    radii.push(PEAK_ROUND);

    const va = VALLEYS[i].a + lag * 0.4;
    const vr = VALLEYS[i].r * (1 + 0.045 * amp * Math.sin(t * 2 * speed + i * 0.9 + 1));
    pts.push([C + vr * Math.cos(toRad(va)), C + vr * Math.sin(toRad(va))]);
    radii.push(VALLEY_ROUND);
  }
  return roundedPath(pts, radii);
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
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-body-${uid}`,
    rim: `xox-rim-${uid}`,
    core: `xox-core-${uid}`,
    glow: `xox-glow-${uid}`,
    cradle: `xox-cradle-${uid}`,
  };
  const palette = PALETTE[state];

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
  const mouthRef = useRef<SVGPathElement>(null);
  const talkMouthRef = useRef<SVGEllipseElement>(null);
  const talkWaveRef = useRef<SVGGElement>(null);
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([]);
  // Props (accesorios) que aparecen según el estado
  const lensRef = useRef<SVGGElement>(null);
  const bubbleRef = useRef<SVGGElement>(null);
  const dotRefs = useRef<(SVGCircleElement | null)[]>([]);
  const bangRef = useRef<SVGGElement>(null);
  const syncRef = useRef<SVGGElement>(null);

  const stateRef = useRef<XoxState>(state);
  const hoverRef = useRef(false);
  const dragMotionPropRef = useRef(dragMotionRef);

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
    lookTX: 0,
    lookTY: 0,
    mouseTime: -1e9,
  });

  const initialPath = useMemo(
    () => buildStar({ t: 0, amp: 1, speed: 1, lag: 0, reach: 0, wave: -1 }),
    []
  );

  const triggerSpin = () => {
    const a = anim.current;
    if (a.t - a.lastSpin < 0.9) return;
    a.lastSpin = a.t;
    if (a.reduce) {
      a.jumpKick = -110;
      return;
    }
    a.windupUntil = a.t + 0.16; // anticipación
    a.squashKick = 3.5;
  };

  useEffect(() => {
    stateRef.current = state;
    if (state === "success") triggerSpin();
    // Sincronizando: pirueta repetida mientras dure el estado
    if (state === "syncing") {
      triggerSpin();
      const id = window.setInterval(triggerSpin, 2200);
      return () => window.clearInterval(id);
    }
  }, [state]);

  // Coreografía de entrada al invocar con ⌘⇧X (micro-salto, saludo y pulso estelar)
  useEffect(() => {
    if (!summonTrigger) return;
    const a = anim.current;
    a.summonAt = a.t;
    a.waveStart = a.t;
    if (a.reduce) {
      a.jumpKick = -60;
      return;
    }
    a.squashKick = 4.2;
    a.jumpKick = -195;
  }, [summonTrigger]);

  // Seguimiento global del cursor: Xox mira hacia donde esté el puntero
  useEffect(() => {
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
  }, []);

  // Loop principal de animación
  useEffect(() => {
    const a = anim.current;
    a.reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const A = a.reduce ? 0.35 : 1;

    const rot: Spring = { x: 0, v: 0 };
    const lookX: Spring = { x: 0, v: 0 };
    const lookY: Spring = { x: 0, v: 0 };
    const jump: Spring = { x: 0, v: 0 };
    const squash: Spring = { x: 0, v: 0 };
    const hover: Spring = { x: 0, v: 0 };
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
    let nextBlink = 1.6;
    let blinkStart = -1;
    let nextGlance = 2;
    let glance = { x: 0, y: 0 };
    let prevDragActive = false;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      a.t += dt;
      const t = a.t;
      const st = stateRef.current;
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
        jump.v = -260 * A;
      }
      if (a.squashKick) {
        squash.v += a.squashKick;
        a.squashKick = 0;
      }
      if (a.jumpKick) {
        jump.v += a.jumpKick;
        a.jumpKick = 0;
      }
      const windup = a.windupUntil ? -26 : 0;
      const sway =
        (thinking
          ? 6 * Math.sin(t * 2.2)
          : talking
          ? 4.8 * Math.sin(t * 3.1)
          : 4 * Math.sin(t * 0.9) + (alerting ? 3.2 * Math.sin(t * 23) : 0)) * A;
      const dragTilt = dragging ? -dragNx * 14 * A : 0;
      step(
        rot,
        a.spinTarget + windup + sway + lookX.x * 8 * A + dragTilt,
        alerting ? 160 : dragging ? 110 : 70,
        alerting ? 9 : dragging ? 13 : 12,
        dt
      );

      // --- Salto + squash & stretch ---------------------------------------
      const prevJump = jump.x;
      step(jump, 0, 55, 6.5, dt);
      if (prevJump < 0 && jump.x >= 0 && jump.v > 80) squash.v += jump.v * 0.012; // aterrizaje
      step(squash, 0, 260, 11, dt);
      step(hover, hoverRef.current ? 1 : 0, 120, 16, dt);

      const breath = 0.018 * A * Math.sin(t * 2.4);
      const stretch = Math.min(Math.abs(jump.v) * 0.00055, 0.14);
      const sy = (1 - squash.x * 0.5) * (1 + stretch) * (1 + breath);
      const sx = (1 + squash.x * 0.45) * (1 - stretch * 0.6) * (1 - breath);
      const bob = (
        thinking
          ? 5 * Math.sin(t * 2.6)
          : talking
          ? 3.2 * Math.sin(t * 6.8) + 2.2 * Math.sin(t * 2.1)
          : alerting
          ? 2 * Math.sin(t * 9)
          : 4 * Math.sin(t * 1.3)
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

      if (cradleRef.current) {
        cradleRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
      }

      if (glowRef.current) {
        const summonBoost = summonActive ? 0.4 * (1 - summonPhase) : 0;
        glowRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
        glowRef.current.setAttribute(
          "opacity",
          clamp(
            (thinking
              ? 0.85 + 0.15 * Math.sin(t * 5)
              : alerting
              ? 0.75 + 0.25 * Math.sin(t * 8)
              : 0.55 + 0.3 * hover.x) + summonBoost,
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

      // --- Chispas en órbita elíptica (profundidad por opacidad) ----------
      const orbitBoost = thinking ? 2.2 : talking ? 1.45 : dragging ? 1 + dragSpeed * 1.4 : 1;
      sparkRefs.current.forEach((el, i) => {
        if (!el) return;
        const ang = t * (0.35 + i * 0.12) * orbitBoost + i * 2.094;
        const radius = 92 + 5 * Math.sin(t * 1.3 + i);
        const depth = 0.5 + 0.5 * Math.sin(ang); // 0 = atrás, 1 = adelante
        const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        el.setAttribute("cx", (C + Math.cos(ang) * radius).toFixed(2));
        el.setAttribute("cy", (C + bob * 0.5 + Math.sin(ang) * radius * 0.5).toFixed(2));
        el.setAttribute("opacity", ((0.2 + 0.6 * twinkle) * (0.45 + 0.55 * depth)).toFixed(3));
        el.setAttribute("r", (1.2 + 0.9 * depth).toFixed(2));
      });

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleActivate = () => {
    triggerSpin();
    onClick?.();
  };

  return (
    <div
      ref={wrapRef}
      role="button"
      tabIndex={0}
      aria-label="Xox, copiloto estelar. Haz clic para saludar."
      title="Xox · Copiloto Estelar"
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate();
        }
      }}
      onPointerEnter={() => {
        hoverRef.current = true;
        const a = anim.current;
        if (a.t - a.waveStart > 4) a.waveStart = a.t; // saluda con el brazo
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
      className={`relative inline-block cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40 rounded-full ${className}`}
      style={responsive ? undefined : { width: size, height: size }}
    >
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
            <stop offset="35%" stopColor="#E0F2FE" stopOpacity={glassContrast ? "0.26" : "0.14"} />
            <stop offset="70%" stopColor="#38BDF8" stopOpacity={glassContrast ? "0.18" : "0.08"} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.30" : "0.18"} />
          </linearGradient>
          <linearGradient id={ids.rim} x1="55" y1="45" x2="185" y2="195" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
            <stop offset="40%" stopColor="#BAE6FD" stopOpacity={glassContrast ? "0.86" : "0.5"} />
            <stop offset="75%" stopColor="#7DD3FC" stopOpacity={glassContrast ? "0.72" : "0.2"} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity={glassContrast ? "0.94" : "0.7"} />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.core} stopOpacity={glassContrast ? "0.98" : "0.9"} />
            <stop offset="50%" stopColor={palette.mid} stopOpacity={glassContrast ? "0.42" : "0.3"} />
            <stop offset="100%" stopColor={palette.mid} stopOpacity="0" />
          </radialGradient>
          {/* Aura dibujada dentro del SVG: se desvanece a 0 antes del borde */}
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.glow} stopOpacity="0.32" />
            <stop offset="45%" stopColor={palette.glow} stopOpacity="0.10" />
            <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
          </radialGradient>
          {glassContrast && (
            <radialGradient id={ids.cradle} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#050914" stopOpacity="0.56" />
              <stop offset="58%" stopColor="#070C1A" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#070C1A" stopOpacity="0" />
            </radialGradient>
          )}
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
          stroke={palette.glow}
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
            fill={i === 1 ? "#38BDF8" : i === 2 ? "#BAE6FD" : "#FFFFFF"}
            opacity="0"
          />
        ))}

        {/* Anillo de datos al pensar */}
        {state === "thinking" && (
          <ellipse
            ref={ringRef}
            cx="0"
            cy="0"
            rx="86"
            ry="28"
            fill="none"
            stroke="#38BDF8"
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
            <g ref={eyeLRef} transform={`translate(${C - 8} ${C - 3})`}>
              {state === "success" ? (
                <path d="M -4.5 1.5 Q 0 -5 4.5 1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              ) : (
                <>
                  <ellipse cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                  <circle cx="1.3" cy="-1.9" r="1.15" fill="#38BDF8" />
                </>
              )}
            </g>
            <g ref={eyeRRef} transform={`translate(${C + 8} ${C - 3})`}>
              {state === "success" ? (
                <path d="M -4.5 1.5 Q 0 -5 4.5 1.5" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              ) : (
                <>
                  <ellipse cx="0" cy="0" rx="3.4" ry="5.2" fill="#FFFFFF" opacity="0.96" />
                  <circle cx="1.3" cy="-1.9" r="1.15" fill="#38BDF8" />
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

            {/* Mejillas */}
            <circle cx={C - 15} cy={C + 5} r="3" fill="#38BDF8" opacity="0.25" />
            <circle cx={C + 15} cy={C + 5} r="3" fill="#38BDF8" opacity="0.25" />
          </g>
        </g>

        {/* Ondas discretas de voz al hablar (talking) */}
        <g ref={talkWaveRef} opacity="0" transform={`translate(${C + 68} ${C - 8}) scale(0.0001)`}>
          <path
            d="M 0 -7 Q 6 0 0 7"
            fill="none"
            stroke="#BAE6FD"
            strokeWidth="2.1"
            strokeLinecap="round"
            opacity="0.9"
          />
          <path
            d="M 6.5 -12 Q 15 0 6.5 12"
            fill="none"
            stroke="#38BDF8"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.65"
          />
        </g>

        {/* Aro de sincronización (dos flechas circulares) */}
        <g ref={syncRef} opacity="0" transform={`translate(${C} ${C}) scale(0.0001)`}>
          {[0, 180].map((deg) => (
            <g key={deg} transform={`rotate(${deg})`}>
              <path d="M 82 0 A 82 82 0 0 1 0 82" fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
              <polygon points="-7,82 2,77 2,87" fill="#2DD4BF" opacity="0.95" />
            </g>
          ))}
        </g>

        {/* Lupa (leyendo) */}
        <g ref={lensRef} opacity="0" transform={`translate(${C} ${C + 38}) scale(0.0001)`}>
          <line x1="9.5" y1="9.5" x2="22" y2="22" stroke="#BAE6FD" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="0" cy="0" r="14" fill="rgba(125,211,252,0.14)" stroke="#E0F2FE" strokeWidth="2.6" />
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
