import React, { useEffect, useId, useMemo, useRef } from "react";

export type XoxState = "idle" | "thinking" | "success" | "talking" | "alert";

interface XoxStarProps {
  state?: XoxState;
  /** Tamaño total del lienzo (incluye el aura). La estrella ocupa ~55%. */
  size?: number;
  className?: string;
  onClick?: () => void;
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
  alert: { core: "#FBBF24", mid: "#D97706", glow: "#FBBF24" },
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
  className = "",
  onClick,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-body-${uid}`,
    rim: `xox-rim-${uid}`,
    core: `xox-core-${uid}`,
    glow: `xox-glow-${uid}`,
  };
  const palette = PALETTE[state];

  // Refs a nodos SVG animados por rAF
  const wrapRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<SVGEllipseElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const yawRef = useRef<SVGGElement>(null);
  const starRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGCircleElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGGElement>(null);
  const eyeRRef = useRef<SVGGElement>(null);
  const mouthRef = useRef<SVGPathElement>(null);
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([]);

  const stateRef = useRef<XoxState>(state);
  const hoverRef = useRef(false);

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
  }, [state]);

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

    let raf = 0;
    let last = performance.now();
    let nextBlink = 1.6;
    let blinkStart = -1;
    let nextGlance = 2;
    let glance = { x: 0, y: 0 };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      a.t += dt;
      const t = a.t;
      const st = stateRef.current;
      const thinking = st === "thinking";

      // --- Mirada ---------------------------------------------------------
      let tx: number;
      let ty: number;
      if (thinking) {
        tx = 0.4 + 0.18 * Math.sin(t * 2.3);
        ty = -0.6 + 0.12 * Math.sin(t * 3.1);
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
      const sway = (thinking ? 6 * Math.sin(t * 2.2) : 4 * Math.sin(t * 0.9)) * A;
      step(rot, a.spinTarget + windup + sway + lookX.x * 8 * A, 70, 12, dt);

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
      const bob = (thinking ? 5 * Math.sin(t * 2.6) : 4 * Math.sin(t * 1.3)) * A;
      const y = C + bob + jump.x;

      bodyRef.current?.setAttribute(
        "transform",
        `translate(${C} ${y.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) rotate(${rot.x.toFixed(2)}) translate(${-C} ${-C})`
      );

      // Falso 3D: el cuerpo se comprime al girar la cara hacia los lados
      const yaw = 1 - 0.1 * Math.abs(lookX.x);
      yawRef.current?.setAttribute(
        "transform",
        `translate(${(C - lookX.x * 2.5).toFixed(2)} ${C}) scale(${yaw.toFixed(4)} 1) translate(${-C} ${-C})`
      );

      // --- Cuerpo gelatinoso (follow-through en las puntas) ---------------
      const lag = clamp(-rot.v * 0.014, -14, 14);
      starRef.current?.setAttribute(
        "d",
        buildStar({
          t,
          amp: (thinking ? 1.6 : 1) * A,
          speed: thinking ? 1.8 : 1,
          lag,
          reach: hover.x * 0.03,
          wave: t - a.waveStart,
        })
      );

      // --- Núcleo y aura --------------------------------------------------
      coreRef.current?.setAttribute(
        "r",
        (thinking ? 19 + 3 * Math.sin(t * 6) : 14 + 1.2 * Math.sin(t * 2)).toFixed(2)
      );
      if (glowRef.current) {
        glowRef.current.setAttribute("transform", `translate(0 ${(bob + jump.x).toFixed(2)})`);
        glowRef.current.setAttribute(
          "opacity",
          (thinking ? 0.85 + 0.15 * Math.sin(t * 5) : 0.55 + 0.3 * hover.x).toFixed(3)
        );
      }
      if (ringRef.current) {
        ringRef.current.setAttribute(
          "transform",
          `translate(${C} ${y.toFixed(2)}) rotate(-18)`
        );
        ringRef.current.setAttribute("stroke-dashoffset", (-t * 40).toFixed(1));
      }

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
      mouthRef.current?.setAttribute(
        "opacity",
        (Math.max(hover.x, st === "success" ? 1 : 0) * 0.85).toFixed(3)
      );

      // --- Chispas en órbita elíptica (profundidad por opacidad) ----------
      sparkRefs.current.forEach((el, i) => {
        if (!el) return;
        const ang = t * (0.35 + i * 0.12) * (thinking ? 2.2 : 1) + i * 2.094;
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
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 240 240" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={ids.body} x1="60" y1="50" x2="180" y2="190" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.30" />
            <stop offset="35%" stopColor="#E0F2FE" stopOpacity="0.14" />
            <stop offset="70%" stopColor="#38BDF8" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id={ids.rim} x1="55" y1="45" x2="185" y2="195" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="40%" stopColor="#BAE6FD" stopOpacity="0.5" />
            <stop offset="75%" stopColor="#38BDF8" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.7" />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.core} stopOpacity="0.9" />
            <stop offset="50%" stopColor={palette.mid} stopOpacity="0.3" />
            <stop offset="100%" stopColor={palette.mid} stopOpacity="0" />
          </radialGradient>
          {/* Aura dibujada dentro del SVG: se desvanece a 0 antes del borde */}
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.glow} stopOpacity="0.32" />
            <stop offset="45%" stopColor={palette.glow} stopOpacity="0.10" />
            <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Aura */}
        <circle ref={glowRef} cx={C} cy={C} r="105" fill={`url(#${ids.glow})`} opacity="0.55" />

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
            <path
              ref={starRef}
              d={initialPath}
              fill={`url(#${ids.body})`}
              stroke={`url(#${ids.rim})`}
              strokeWidth="1.6"
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

            {/* Mejillas */}
            <circle cx={C - 15} cy={C + 5} r="3" fill="#38BDF8" opacity="0.25" />
            <circle cx={C + 15} cy={C + 5} r="3" fill="#38BDF8" opacity="0.25" />
          </g>
        </g>
      </svg>
    </div>
  );
};
