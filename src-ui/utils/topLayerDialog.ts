let supportsDisplayTransition: boolean | undefined;

/**
 * Detecta soporte real de transición discreta de `display` (evita falsos positivos en Firefox).
 */
export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }

  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

export function supportsTopLayerExit(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      window.CSS?.supports?.("overlay", "auto") &&
      canTransitionDisplay()
  );
}

export async function waitTopLayerAnimations(
  element: HTMLElement,
  timeoutMs = 500
): Promise<void> {
  const animations = element.getAnimations({ subtree: true });
  if (animations.length === 0) return;
  await Promise.race([
    Promise.allSettled(animations.map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
