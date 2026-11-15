import React, { useEffect, useLayoutEffect, useRef } from "react";

export interface JellyPillTrackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Identificador de la opción activa; al cambiar dispara el deslizamiento tipo gelatina. */
  activeKey: string | number;
  /** Selector CSS del elemento activo dentro del contenedor. */
  activeSelector?: string;
  /** Radio de borde de la píldora activa (p. ej. "6px", "8px", "9999px"). */
  pillRadius?: string;
  /** Variante visual de la píldora ("glass" por defecto, "quick" para modales y QuickBar). */
  variant?: "glass" | "quick";
}

interface TargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TrackBounds {
  minLeft: number;
  maxRight: number;
}

interface JellyPhysicsState {
  initialized: boolean;
  lastActiveKey: string | number;
  left: number;
  right: number;
  vLeft: number;
  vRight: number;
  startLeft: number;
  startRight: number;
  targetLeft: number;
  targetRight: number;
  top: number;
  height: number;
  boundMinLeft: number;
  boundMaxRight: number;
  squash: number;
  vSquash: number;
  slosh: number;
  vSlosh: number;
  direction: -1 | 0 | 1;
}

const DEFAULT_ACTIVE_SELECTOR =
  '[data-jelly-active="true"], [aria-selected="true"], [aria-pressed="true"]';

const SUBSTEP_SEC = 1 / 240;
const MAX_FRAME_DT_SEC = 1 / 20;

// Constantes del resorte asimétrico: borde delantero rápido, borde trasero con inercia elástica
const K_LEAD = 580;
const C_LEAD = 35;
const K_TRAIL = 260;
const C_TRAIL = 22.5;
const K_NEUTRAL = 440;
const C_NEUTRAL = 29;

// Osciladores secundarios subamortiguados para el rebote gelatinoso (squash & slosh)
const K_SQUASH = 440;
const C_SQUASH = 13.8;
const K_SLOSH = 360;
const C_SLOSH = 12.6;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function getTargetRect(target: HTMLElement, track: HTMLElement): TargetRect | null {
  const width = target.offsetWidth;
  const height = target.offsetHeight;
  if (width <= 0 || height <= 0) return null;

  if (target.offsetParent === track) {
    return {
      left: target.offsetLeft,
      top: target.offsetTop,
      width,
      height,
    };
  }

  let left = 0;
  let top = 0;
  let cur: HTMLElement | null = target;
  while (cur && cur !== track) {
    left += cur.offsetLeft;
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  if (cur === track) {
    return { left, top, width, height };
  }

  const trackRect = track.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scaleX = track.offsetWidth > 0 ? trackRect.width / track.offsetWidth : 1;
  const scaleY = track.offsetHeight > 0 ? trackRect.height / track.offsetHeight : 1;
  return {
    left: (targetRect.left - trackRect.left) / scaleX - track.clientLeft + track.scrollLeft,
    top: (targetRect.top - trackRect.top) / scaleY - track.clientTop + track.scrollTop,
    width,
    height,
  };
}

function getTrackBounds(track: HTMLElement, fallbackRect: TargetRect): TrackBounds {
  const items = track.querySelectorAll<HTMLElement>(':scope > button, :scope > [role="tab"]');
  if (items.length === 0) {
    return {
      minLeft: fallbackRect.left,
      maxRight: fallbackRect.left + fallbackRect.width,
    };
  }
  let minLeft = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    if (item.offsetWidth <= 0) continue;
    minLeft = Math.min(minLeft, item.offsetLeft);
    maxRight = Math.max(maxRight, item.offsetLeft + item.offsetWidth);
  }
  if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight)) {
    return {
      minLeft: fallbackRect.left,
      maxRight: fallbackRect.left + fallbackRect.width,
    };
  }
  return { minLeft, maxRight };
}

function applyThumbIdleStyles(thumb: HTMLElement, s: JellyPhysicsState) {
  const width = Math.max(12, s.targetRight - s.targetLeft);
  thumb.style.opacity = "1";
  thumb.style.width = `${width.toFixed(2)}px`;
  thumb.style.height = `${s.height.toFixed(2)}px`;
  thumb.style.transform = `translate3d(${s.targetLeft.toFixed(2)}px, ${s.top.toFixed(2)}px, 0)`;
  thumb.style.setProperty("--jelly-glint-x", "0px");
  thumb.style.willChange = "auto";
}

function applyThumbDynamicStyles(thumb: HTMLElement, s: JellyPhysicsState) {
  const width = Math.max(12, s.right - s.left);
  const squash = clamp(s.squash, -0.14, 0.16);
  // Conserva el área aparente al estirarse lateralmente (squash & stretch)
  const scaleX = 1 + squash * 0.55;
  const scaleY = clamp(1 / (1 + squash * 0.85), 0.87, 1.11);
  const skewDeg = clamp(-s.slosh * 0.78, -4.6, 4.6);
  const glintPx = clamp(s.slosh * 2.4, -14, 14);

  thumb.style.opacity = "1";
  thumb.style.width = `${width.toFixed(2)}px`;
  thumb.style.height = `${s.height.toFixed(2)}px`;
  thumb.style.transform = `translate3d(${s.left.toFixed(2)}px, ${s.top.toFixed(2)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}) skewX(${skewDeg.toFixed(2)}deg)`;
  thumb.style.setProperty("--jelly-glint-x", `${glintPx.toFixed(2)}px`);
}

function snapStateToRect(s: JellyPhysicsState, rect: TargetRect, bounds: TrackBounds) {
  s.left = rect.left;
  s.right = rect.left + rect.width;
  s.vLeft = 0;
  s.vRight = 0;
  s.startLeft = s.left;
  s.startRight = s.right;
  s.targetLeft = s.left;
  s.targetRight = s.right;
  s.top = rect.top;
  s.height = rect.height;
  s.boundMinLeft = bounds.minLeft;
  s.boundMaxRight = bounds.maxRight;
  s.squash = 0;
  s.vSquash = 0;
  s.slosh = 0;
  s.vSlosh = 0;
  s.direction = 0;
}

function stepPhysicsSubstep(s: JellyPhysicsState, h: number) {
  const kLeft = s.direction === -1 ? K_LEAD : s.direction === 1 ? K_TRAIL : K_NEUTRAL;
  const cLeft = s.direction === -1 ? C_LEAD : s.direction === 1 ? C_TRAIL : C_NEUTRAL;
  const kRight = s.direction === 1 ? K_LEAD : s.direction === -1 ? K_TRAIL : K_NEUTRAL;
  const cRight = s.direction === 1 ? C_LEAD : s.direction === -1 ? C_TRAIL : C_NEUTRAL;

  const aLeft = kLeft * (s.targetLeft - s.left) - cLeft * s.vLeft;
  const aRight = kRight * (s.targetRight - s.right) - cRight * s.vRight;

  s.vLeft += aLeft * h;
  s.left += s.vLeft * h;
  s.vRight += aRight * h;
  s.right += s.vRight * h;

  // Amortiguación suave contra los bordes externos del track para comprimir el impacto sin desbordar
  const minAllowedLeft = s.boundMinLeft - 1.5;
  const maxAllowedRight = s.boundMaxRight + 1.5;
  if (s.left < minAllowedLeft) {
    s.left = minAllowedLeft;
    if (s.vLeft < 0) s.vLeft = -s.vLeft * 0.25;
  }
  if (s.right > maxAllowedRight) {
    s.right = maxAllowedRight;
    if (s.vRight > 0) s.vRight = -s.vRight * 0.25;
  }
  if (s.right - s.left < 12) {
    const mid = (s.left + s.right) * 0.5;
    s.left = mid - 6;
    s.right = mid + 6;
  }

  const startCenter = (s.startLeft + s.startRight) * 0.5;
  const targetCenter = (s.targetLeft + s.targetRight) * 0.5;
  const currCenter = (s.left + s.right) * 0.5;
  const span = targetCenter - startCenter;
  const u = Math.abs(span) > 0.5 ? clamp((currCenter - startCenter) / span, 0, 1) : 1;

  const startW = s.startRight - s.startLeft;
  const targetW = s.targetRight - s.targetLeft;
  const expectedW = startW + (targetW - startW) * u;
  const currW = s.right - s.left;

  const edgeStretch =
    expectedW > 1 ? clamp((currW - expectedW) / expectedW, -0.35, 0.35) : 0;
  const widthRate = (s.vRight - s.vLeft) / Math.max(targetW, 32);
  const targetSquash = clamp(edgeStretch * 0.48 + widthRate * 0.022, -0.15, 0.16);

  const aSquash = K_SQUASH * (targetSquash - s.squash) - C_SQUASH * s.vSquash;
  s.vSquash += aSquash * h;
  s.squash += s.vSquash * h;

  const aCenter = (aLeft + aRight) * 0.5;
  const normAccel = clamp(aCenter / Math.max(targetW, 48), -180, 180);
  const targetSlosh = clamp(-normAccel * 0.036, -5.8, 5.8);

  const aSlosh = K_SLOSH * (targetSlosh - s.slosh) - C_SLOSH * s.vSlosh;
  s.vSlosh += aSlosh * h;
  s.slosh += s.vSlosh * h;
}

function isPhysicsSettled(s: JellyPhysicsState): boolean {
  return (
    Math.abs(s.targetLeft - s.left) < 0.12 &&
    Math.abs(s.targetRight - s.right) < 0.12 &&
    Math.abs(s.vLeft) < 0.4 &&
    Math.abs(s.vRight) < 0.4 &&
    Math.abs(s.squash) < 0.003 &&
    Math.abs(s.vSquash) < 0.02 &&
    Math.abs(s.slosh) < 0.03 &&
    Math.abs(s.vSlosh) < 0.12
  );
}

/**
 * Contenedor de píldoras segmentadas con indicador Liquid Glass que se desliza
 * lateralmente con física elástica tipo gelatina (estiramiento direccional,
 * compresión al impactar y asentamiento subamortiguado).
 */
export const JellyPillTrack = React.forwardRef<HTMLDivElement, JellyPillTrackProps>(
  function JellyPillTrack(
    {
      activeKey,
      activeSelector = DEFAULT_ACTIVE_SELECTOR,
      pillRadius = "0.4375rem",
      variant = "glass",
      className = "",
      style,
      children,
      ...rest
    },
    forwardedRef
  ) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const thumbRef = useRef<HTMLSpanElement | null>(null);
    const rafRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const reducedMotionRef = useRef<boolean>(false);
    const activeKeyRef = useRef(activeKey);
    activeKeyRef.current = activeKey;
    const activeSelectorRef = useRef(activeSelector);
    activeSelectorRef.current = activeSelector;

    const stateRef = useRef<JellyPhysicsState>({
      initialized: false,
      lastActiveKey: activeKey,
      left: 0,
      right: 0,
      vLeft: 0,
      vRight: 0,
      startLeft: 0,
      startRight: 0,
      targetLeft: 0,
      targetRight: 0,
      top: 0,
      height: 0,
      boundMinLeft: 0,
      boundMaxRight: 0,
      squash: 0,
      vSquash: 0,
      slosh: 0,
      vSlosh: 0,
      direction: 0,
    });

    const setRefs = (node: HTMLDivElement | null) => {
      trackRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };

    const stopLoop = () => {
      if (rafRef.current !== 0) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const startLoop = () => {
      const thumb = thumbRef.current;
      if (!thumb || rafRef.current !== 0) return;
      thumb.style.willChange = "transform, width";
      lastTimeRef.current = performance.now();

      const tick = (now: number) => {
        const currentThumb = thumbRef.current;
        if (!currentThumb || document.hidden || reducedMotionRef.current) {
          const s = stateRef.current;
          if (currentThumb && s.initialized) {
            snapStateToRect(
              s,
              {
                left: s.targetLeft,
                top: s.top,
                width: s.targetRight - s.targetLeft,
                height: s.height,
              },
              { minLeft: s.boundMinLeft, maxRight: s.boundMaxRight }
            );
            applyThumbIdleStyles(currentThumb, s);
          }
          rafRef.current = 0;
          return;
        }

        const dt = Math.min(Math.max((now - lastTimeRef.current) / 1000, 1 / 240), MAX_FRAME_DT_SEC);
        lastTimeRef.current = now;

        const s = stateRef.current;
        let remaining = dt;
        while (remaining > 0) {
          const h = Math.min(remaining, SUBSTEP_SEC);
          stepPhysicsSubstep(s, h);
          remaining -= h;
        }

        if (isPhysicsSettled(s)) {
          snapStateToRect(
            s,
            {
              left: s.targetLeft,
              top: s.top,
              width: s.targetRight - s.targetLeft,
              height: s.height,
            },
            { minLeft: s.boundMinLeft, maxRight: s.boundMaxRight }
          );
          applyThumbIdleStyles(currentThumb, s);
          rafRef.current = 0;
          return;
        }

        applyThumbDynamicStyles(currentThumb, s);
        rafRef.current = window.requestAnimationFrame(tick);
      };

      rafRef.current = window.requestAnimationFrame(tick);
    };

    const syncTarget = (isKeyChange: boolean) => {
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (!track || !thumb) return;

      const currentKey = activeKeyRef.current;
      const activeEl = track.querySelector<HTMLElement>(activeSelectorRef.current);
      const rect = activeEl ? getTargetRect(activeEl, track) : null;
      const s = stateRef.current;
      if (!rect) {
        s.lastActiveKey = currentKey;
        thumb.style.opacity = "0";
        stopLoop();
        return;
      }

      const bounds = getTrackBounds(track, rect);

      if (!s.initialized || reducedMotionRef.current) {
        s.initialized = true;
        s.lastActiveKey = currentKey;
        snapStateToRect(s, rect, bounds);
        applyThumbIdleStyles(thumb, s);
        stopLoop();
        return;
      }

      if (isKeyChange) {
        s.lastActiveKey = currentKey;
        s.startLeft = s.left;
        s.startRight = s.right;
        s.targetLeft = rect.left;
        s.targetRight = rect.left + rect.width;
        s.top = rect.top;
        s.height = rect.height;
        s.boundMinLeft = bounds.minLeft;
        s.boundMaxRight = bounds.maxRight;

        const currCenter = (s.left + s.right) * 0.5;
        const targetCenter = (s.targetLeft + s.targetRight) * 0.5;
        const deltaCenter = targetCenter - currCenter;
        s.direction = deltaCenter > 0.5 ? 1 : deltaCenter < -0.5 ? -1 : 0;

        startLoop();
      } else {
        // Cambio de tamaño del contenedor o del badge sin cambiar de pestaña:
        // actualiza sin disparar rebote artificial cuando está en reposo.
        s.lastActiveKey = currentKey;
        s.top = rect.top;
        s.height = rect.height;
        s.boundMinLeft = bounds.minLeft;
        s.boundMaxRight = bounds.maxRight;

        if (rafRef.current === 0) {
          snapStateToRect(s, rect, bounds);
          applyThumbIdleStyles(thumb, s);
        } else {
          s.targetLeft = rect.left;
          s.targetRight = rect.left + rect.width;
        }
      }
    };

    useEffect(() => {
      if (typeof window === "undefined" || !window.matchMedia) return;
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotionRef.current = mq.matches;
      const handleChange = (e: MediaQueryListEvent) => {
        reducedMotionRef.current = e.matches;
        if (e.matches) {
          syncTarget(false);
        }
      };
      mq.addEventListener("change", handleChange);
      return () => {
        mq.removeEventListener("change", handleChange);
        stopLoop();
      };
    }, []);

    useLayoutEffect(() => {
      const s = stateRef.current;
      const isKeyChange = s.initialized && s.lastActiveKey !== activeKey;
      syncTarget(isKeyChange);
    }, [activeKey, activeSelector]);

    useEffect(() => {
      const track = trackRef.current;
      if (!track || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(() => {
        syncTarget(false);
      });
      observer.observe(track);

      const items = track.querySelectorAll<HTMLElement>(':scope > button, :scope > [role="tab"]');
      items.forEach((item) => observer.observe(item));

      return () => observer.disconnect();
    }, [activeKey, activeSelector]);

    const thumbClass =
      variant === "quick"
        ? "xook-jelly-pill-thumb xook-jelly-pill-thumb--quick"
        : "xook-jelly-pill-thumb";

    return (
      <div
        ref={setRefs}
        className={`xook-jelly-track xook-jelly-track--${variant} relative isolate ${className}`.trim()}
        style={
          {
            "--jelly-radius": pillRadius,
            ...style,
          } as React.CSSProperties
        }
        {...rest}
      >
        <span ref={thumbRef} aria-hidden="true" className={thumbClass} style={{ opacity: 0 }} />
        {children}
      </div>
    );
  }
);
