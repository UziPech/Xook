import { useEffect, useRef, useState } from "react";

export function useAnimatedPresence(
  isOpen: boolean,
  durationMs: number
): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    clearTimers();
    if (isOpen) {
      setMounted(true);
      if (reducedMotion) {
        setVisible(true);
      } else {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = window.requestAnimationFrame(() => {
            setVisible(true);
          });
        });
      }
    } else {
      setVisible(false);
      if (reducedMotion) {
        setMounted(false);
      } else {
        timerRef.current = window.setTimeout(() => {
          setMounted(false);
        }, durationMs);
      }
    }

    return clearTimers;
  }, [isOpen, durationMs]);

  return { mounted, visible };
}

