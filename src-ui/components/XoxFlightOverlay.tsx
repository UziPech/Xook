import React, { useLayoutEffect, useRef } from "react";
import {
  XoxStar,
  type XoxAccentPreset,
  type XoxDragMotion,
  type XoxState,
  type XoxTerminalFeed,
} from "./XoxStar";

export interface XoxFlightPoint {
  cx: number;
  cy: number;
  size: number;
}

export interface XoxFlightSpec {
  id: number;
  direction: "to-studio" | "from-studio";
  from: XoxFlightPoint;
  to: XoxFlightPoint;
}

interface XoxFlightOverlayProps {
  flight: XoxFlightSpec;
  xoxState: XoxState;
  accentPreset: XoxAccentPreset;
  terminal?: XoxTerminalFeed | null;
  onComplete: (flightId: number) => void;
}

const FLIGHT_DURATION_MS = 460;

/**
 * Capa flotante efímera (solo montada durante ~430 ms de desplazamiento) que traslada
 * a Xox sobre el borde entre Chat y Espacio de Xox sin congelar el SVG ni sus partículas
 * orbitales en WebKit/macOS (evita `will-change: transform` y `scale()`).
 */
export const XoxFlightOverlay: React.FC<XoxFlightOverlayProps> = ({
  flight,
  xoxState,
  accentPreset,
  terminal,
  onComplete,
}) => {
  const moverRef = useRef<HTMLDivElement>(null);
  const dragMotionRef = useRef<XoxDragMotion>({
    active: false,
    vx: 0,
    vy: 0,
    releaseVx: 0,
    releaseVy: 0,
  });
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useLayoutEffect(() => {
    const el = moverRef.current;
    if (!el) return;

    const { from, to, id } = flight;
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const dist = Math.hypot(dx, dy);
    const dir = dx >= 0 ? 1 : -1;

    // Arco suave y natural sin giro brusco
    const arcLift = Math.min(48, Math.max(18, dist * 0.13));
    const minSafeCy = 72;

    const setBox = (cx: number, cy: number, size: number) => {
      const s = Math.max(64, size);
      el.style.left = `${(cx - s / 2).toFixed(2)}px`;
      el.style.top = `${(cy - s / 2).toFixed(2)}px`;
      el.style.width = `${s.toFixed(2)}px`;
      el.style.height = `${s.toFixed(2)}px`;
    };

    setBox(from.cx, from.cy, from.size);

    dragMotionRef.current = {
      active: true,
      vx: dir * 720,
      vy: -190,
      releaseVx: dir * 680,
      releaseVy: 150,
    };

    let raf = 0;
    let finished = false;
    let prevCx = from.cx;
    let prevCy = from.cy;
    let smoothVx = dir * 640;
    let smoothVy = -160;
    const startTime = performance.now();
    let lastTime = startTime;

    const finish = () => {
      if (finished) return;
      finished = true;
      dragMotionRef.current.active = false;
      onCompleteRef.current(id);
    };

    const tick = (now: number) => {
      if (finished) return;
      const elapsed = now - startTime;
      const u = Math.min(1, Math.max(0, elapsed / FLIGHT_DURATION_MS));
      const dt = Math.max(0.004, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;

      // Ease-in-out cúbico suave con leve anticipación al inicio
      const p = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const anticEnv = u < 0.16 ? Math.sin((u / 0.16) * Math.PI) : 0;
      const anticShift = -dir * Math.min(12, Math.max(6, dist * 0.028)) * anticEnv;
      const anticDip = 6 * anticEnv;

      const cx = from.cx + dx * p + anticShift;
      const linearCy = from.cy + dy * p;
      const lift = Math.sin(p * Math.PI) * arcLift;
      const cy = Math.max(linearCy - lift + anticDip, minSafeCy);
      const size = from.size + (to.size - from.size) * p;

      const instVx = (cx - prevCx) / dt;
      const instVy = (cy - prevCy) / dt;
      prevCx = cx;
      prevCy = cy;

      const velAlpha = 1 - Math.exp(-16 * dt);
      smoothVx += (instVx - smoothVx) * velAlpha;
      smoothVy += (instVy - smoothVy) * velAlpha;

      setBox(cx, cy, size);

      // Alimenta mirada 3D, inclinación elástica, arrastre de puntas y remolino vivo de partículas
      if (u < 0.88) {
        const guidedVx = u < 0.16 ? dir * 720 : smoothVx * 1.15;
        dragMotionRef.current.active = true;
        dragMotionRef.current.vx = guidedVx;
        dragMotionRef.current.vy = smoothVy * 0.85;
        dragMotionRef.current.releaseVx = guidedVx;
        dragMotionRef.current.releaseVy = smoothVy * 0.85;
      } else if (dragMotionRef.current.active) {
        dragMotionRef.current.active = false;
      }

      if (u >= 1) {
        setBox(to.cx, to.cy, to.size);
        finish();
        return;
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    const safetyTimer = window.setTimeout(finish, FLIGHT_DURATION_MS + 100);

    return () => {
      window.clearTimeout(safetyTimer);
      if (raf) window.cancelAnimationFrame(raf);
      dragMotionRef.current.active = false;
    };
  }, [flight]);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[60] pointer-events-none overflow-hidden select-none"
    >
      {/* Sin will-change:transform ni scale() para mantener el SVG y sus partículas 100 % vivos en WKWebView */}
      <div
        ref={moverRef}
        data-xox-flight-mover
        style={{
          left: `${(flight.from.cx - flight.from.size / 2).toFixed(2)}px`,
          top: `${(flight.from.cy - flight.from.size / 2).toFixed(2)}px`,
          width: `${flight.from.size.toFixed(2)}px`,
          height: `${flight.from.size.toFixed(2)}px`,
        }}
        className="fixed"
      >
        <XoxStar
          state={xoxState}
          responsive
          hitArea="full"
          accentPreset={accentPreset}
          dragMotionRef={dragMotionRef}
          active
          terminal={terminal}
          className="w-full h-full"
        />
      </div>
    </div>
  );
};
