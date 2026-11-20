import React, { useEffect, useId, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ExternalLink,
  Loader2,
  Maximize2,
  Pin,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import {
  ASSIST_PRESET_OPTIONS,
  type ApplyAssistLayoutPayload,
  type AssistPresetId,
  type AssistSide,
  type AssistWindowStatus,
  type CompanionWindowCandidate,
} from "../features/window-assist/windowAssistApi";

interface AssistDockMenuProps {
  status: AssistWindowStatus;
  viewportWidth: number;
  companions: CompanionWindowCandidate[];
  loadingCompanions: boolean;
  busy: boolean;
  onRefreshCompanions: () => void;
  onApplyLayout: (payload: ApplyAssistLayoutPayload) => Promise<void> | void;
  onRebalanceSplit: () => Promise<void> | void;
  onToggleAlwaysOnTop: (enabled: boolean) => Promise<void> | void;
  onExitAssist: () => Promise<void> | void;
  onRequestAccessibility: () => Promise<void> | void;
  onOpenAccessibilitySettings: () => Promise<void> | void;
}

/**
 * Ilustración SVG monocroma de pantalla Mac dividida en dos ventanas pegadas borde a borde
 * (app acompañante neutra + carril de Xook con la silueta de Xox).
 */
const ScreenSplitIllustration: React.FC<{
  ratioPercent: number;
  side: AssistSide;
  selected: boolean;
}> = ({ ratioPercent, side, selected }) => {
  const workX = 6;
  const workY = 12;
  const workW = 104;
  const workH = 44;
  const divider = 1.5;

  const usableW = workW - divider;
  const xookW = Math.max(22, Math.min(usableW - 34, Math.round((usableW * ratioPercent) / 100)));
  const appW = usableW - xookW;

  const xookX = side === "left" ? workX : workX + appW + divider;
  const appX = side === "left" ? workX + xookW + divider : workX;

  const xookCenterX = xookX + xookW / 2;
  const xookCenterY = workY + workH * 0.44;
  const starScale = xookW < 30 ? 0.54 : 0.66;

  return (
    <svg
      viewBox="0 0 116 68"
      aria-hidden="true"
      className="w-full h-[56px] block select-none"
    >
      {/* Marco de pantalla Mac */}
      <rect
        x="1.5"
        y="1.5"
        width="113"
        height="65"
        rx="8"
        fill="#090a0e"
        stroke={selected ? "rgba(255, 255, 255, 0.42)" : "rgba(255, 255, 255, 0.13)"}
        strokeWidth="1.15"
      />

      {/* Barra de menú superior macOS */}
      <line
        x1="2.5"
        y1="8.5"
        x2="113.5"
        y2="8.5"
        stroke="rgba(255, 255, 255, 0.08)"
        strokeWidth="0.9"
      />
      <circle cx="8" cy="5.2" r="1.15" fill="rgba(255, 255, 255, 0.34)" />
      <rect x="97" y="4.2" width="11" height="2" rx="1" fill="rgba(255, 255, 255, 0.22)" />

      {/* Ventana de la app acompañante */}
      <rect
        x={appX}
        y={workY}
        width={appW}
        height={workH}
        rx="3.5"
        fill="rgba(255, 255, 255, 0.045)"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth="0.9"
      />
      <circle cx={appX + 4.2} cy={workY + 4.2} r="0.95" fill="rgba(255, 255, 255, 0.28)" />
      <circle cx={appX + 7.2} cy={workY + 4.2} r="0.95" fill="rgba(255, 255, 255, 0.2)" />
      <circle cx={appX + 10.2} cy={workY + 4.2} r="0.95" fill="rgba(255, 255, 255, 0.16)" />
      <rect
        x={appX + 4.5}
        y={workY + 10.5}
        width={Math.max(12, appW * 0.56)}
        height="2.2"
        rx="1.1"
        fill="rgba(255, 255, 255, 0.18)"
      />
      <rect
        x={appX + 4.5}
        y={workY + 15.8}
        width={Math.max(16, appW * 0.72)}
        height="1.9"
        rx="0.95"
        fill="rgba(255, 255, 255, 0.11)"
      />
      <rect
        x={appX + 4.5}
        y={workY + 20.6}
        width={Math.max(14, appW * 0.6)}
        height="1.9"
        rx="0.95"
        fill="rgba(255, 255, 255, 0.09)"
      />
      <rect
        x={appX + 4.5}
        y={workY + 28}
        width={Math.max(18, appW - 9)}
        height="11"
        rx="2.5"
        fill="rgba(255, 255, 255, 0.035)"
        stroke="rgba(255, 255, 255, 0.07)"
        strokeWidth="0.7"
      />

      {/* Ventana de Xook (monocromo luminoso neutro) */}
      <rect
        x={xookX}
        y={workY}
        width={xookW}
        height={workH}
        rx="3.5"
        fill={selected ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.1)"}
        stroke={selected ? "rgba(255, 255, 255, 0.78)" : "rgba(255, 255, 255, 0.36)"}
        strokeWidth="1"
      />
      <g transform={`translate(${xookCenterX}, ${xookCenterY}) scale(${starScale})`}>
        <path
          d="M 0 -9.5 C 2.3 -9.5 3.1 -4.4 5.1 -3.1 C 7.1 -1.8 10.2 -2.1 10.6 -0.2 C 11 1.7 6.9 3.6 6.4 5.7 C 5.9 7.8 7.1 10.1 5.3 10.9 C 3.5 11.7 1.7 8.4 0 8.4 C -1.7 8.4 -3.5 11.7 -5.3 10.9 C -7.1 10.1 -5.9 7.8 -6.4 5.7 C -6.9 3.6 -11 1.7 -10.6 -0.2 C -10.2 -2.1 -7.1 -1.8 -5.1 -3.1 C -3.1 -4.4 -2.3 -9.5 0 -9.5 Z"
          fill={selected ? "#FFFFFF" : "rgba(244, 244, 245, 0.84)"}
        />
      </g>
      <rect
        x={xookX + 3.5}
        y={workY + workH - 8.5}
        width={Math.max(12, xookW - 7)}
        height="4.2"
        rx="2.1"
        fill={selected ? "rgba(255, 255, 255, 0.34)" : "rgba(255, 255, 255, 0.18)"}
      />

      {/* Dock discreto */}
      <rect
        x="43"
        y="60"
        width="30"
        height="2.8"
        rx="1.4"
        fill="rgba(255, 255, 255, 0.16)"
      />
    </svg>
  );
};

/** Icono sutil de ventana dividida para la cabecera (sin punto llamativo; rellena suavemente el lado activo) */
const SplitTriggerIcon: React.FC<{ active: boolean; side: AssistSide }> = ({ active, side }) => (
  <svg
    viewBox="0 0 18 18"
    fill="none"
    aria-hidden="true"
    className="w-4 h-4 shrink-0"
  >
    <rect
      x="2.25"
      y="3"
      width="13.5"
      height="12"
      rx="2.2"
      stroke="currentColor"
      strokeWidth="1.45"
    />
    {active && (
      <rect
        x={side === "left" ? "3.2" : "9.5"}
        y="3.9"
        width="5.3"
        height="10.2"
        rx="1.2"
        fill="currentColor"
        fillOpacity="0.28"
      />
    )}
    <line
      x1="9"
      y1="3.4"
      x2="9"
      y2="14.6"
      stroke="currentColor"
      strokeWidth="1.35"
    />
  </svg>
);

/** Mini icono SVG monocromo para elegir lado izquierdo o derecho */
const SideIconSvg: React.FC<{ side: AssistSide; active: boolean }> = ({ side, active }) => (
  <svg viewBox="0 0 22 14" aria-hidden="true" className="w-[17px] h-[11px] shrink-0">
    <rect
      x="0.75"
      y="0.75"
      width="20.5"
      height="12.5"
      rx="2.5"
      fill="none"
      stroke={active ? "rgba(255,255,255,0.68)" : "rgba(255,255,255,0.28)"}
      strokeWidth="1.1"
    />
    <rect
      x={side === "left" ? "2.3" : "12.7"}
      y="2.3"
      width="7"
      height="9.4"
      rx="1.2"
      fill={active ? "#FFFFFF" : "rgba(255,255,255,0.34)"}
    />
  </svg>
);

export const AssistDockMenu: React.FC<AssistDockMenuProps> = ({
  status,
  viewportWidth,
  companions,
  loadingCompanions,
  busy,
  onRefreshCompanions,
  onApplyLayout,
  onRebalanceSplit,
  onToggleAlwaysOnTop,
  onExitAssist,
  onRequestAccessibility,
  onOpenAccessibilitySettings,
}) => {
  const reactId = useId();
  const safeId = reactId.replace(/:/g, "");
  const popoverId = `xook-assist-popover-${safeId}`;
  const anchorName = `--xook-assist-trigger-${safeId}`;
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const onToggle = (ev: Event) => {
      const nextOpen = (ev as ToggleEvent).newState === "open";
      setIsOpen(nextOpen);
      if (nextOpen) {
        onRefreshCompanions();
      }
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [onRefreshCompanions]);

  const closePopover = () => {
    const el = popoverRef.current as (HTMLDivElement & { hidePopover?: () => void }) | null;
    try {
      el?.hidePopover?.();
    } catch {
      // Ignora si el popover ya estaba cerrado
    }
  };

  const detectedPrimary = companions[0] ?? null;
  const activeCompanionName =
    status.companion?.appName || detectedPrimary?.appName || null;

  const isManuallyScaled =
    status.active &&
    (status.preset === "custom" || Math.abs(viewportWidth - status.xookWidth) > 14);

  const handleSelectPreset = async (preset: Exclude<AssistPresetId, "custom">) => {
    await onApplyLayout({
      preset,
      side: status.side,
      splitCompanion: true,
      targetPid: status.companion?.pid ?? detectedPrimary?.pid,
      targetWindowId: status.companion?.windowId ?? detectedPrimary?.windowId,
      targetTitle: status.companion?.windowTitle ?? detectedPrimary?.title,
      alwaysOnTop: status.alwaysOnTop,
    });
  };

  const handleSelectSide = async (side: AssistSide) => {
    await onApplyLayout({
      preset: status.active ? status.preset : "balanced",
      side,
      customWidth: status.preset === "custom" ? viewportWidth : undefined,
      splitCompanion: true,
      alwaysOnTop: status.alwaysOnTop,
    });
  };

  const handleSelectCompanion = async (win: CompanionWindowCandidate) => {
    await onApplyLayout({
      preset: status.active ? status.preset : "balanced",
      side: status.side,
      customWidth: status.preset === "custom" ? viewportWidth : undefined,
      splitCompanion: true,
      targetPid: win.pid,
      targetWindowId: win.windowId,
      targetTitle: win.title,
      alwaysOnTop: status.alwaysOnTop,
    });
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        popoverTarget={popoverId}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        aria-label={
          status.active
            ? activeCompanionName
              ? `Pantalla dividida con ${activeCompanionName}`
              : "Pantalla dividida activa"
            : "Dividir pantalla en 2 ventanas"
        }
        title={
          status.active
            ? activeCompanionName
              ? `Dividido con ${activeCompanionName} · Clic para ajustar o salir`
              : "Pantalla dividida activa · Clic para ajustar o salir"
            : "Dividir pantalla con otra app (⌘⌥→)"
        }
        style={{ anchorName } as React.CSSProperties}
        className={`shrink-0 min-h-[28px] px-2 sm:px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-1.5 transition-colors cursor-pointer ${
          isOpen
            ? "bg-white/[0.06] text-zinc-100"
            : status.active
              ? "bg-white/[0.04] text-zinc-200 hover:bg-white/[0.065] hover:text-white"
              : "bg-transparent text-zinc-400/85 hover:text-zinc-200 hover:bg-white/[0.04]"
        }`}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300 shrink-0" aria-hidden="true" />
        ) : (
          <SplitTriggerIcon active={status.active} side={status.side} />
        )}
        <span className="text-[11px] font-medium hidden sm:inline">Dividir</span>
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        aria-label="Opciones de pantalla dividida"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ positionAnchor: anchorName } as React.CSSProperties}
        className="xook-assist-popover w-[min(308px,calc(100vw-16px))] p-2.5 rounded-2xl text-left text-zinc-100"
      >
        <div className="space-y-2.5">
          {/* Fila 1: Cabecera + acción principal compartiendo la misma línea */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.08]">
            <div className="min-w-0">
              <span className="block text-xs font-semibold text-white truncate">
                {status.active && activeCompanionName
                  ? `Con ${activeCompanionName}`
                  : "Pantalla dividida"}
              </span>
              <span className="block text-[10px] text-zinc-400 truncate">
                {status.active
                  ? "Elige proporción o arrastra el borde"
                  : "Toca una vista para acoplar ambas apps"}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {status.active && isManuallyScaled && status.accessibilityGranted && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRebalanceSplit()}
                  title="Ajusta la otra ventana al ancho actual de Xook"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.14] text-[10.5px] font-medium text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
                  <span>Ajustar</span>
                </button>
              )}
              {status.active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await onExitAssist();
                    closePopover();
                  }}
                  title="Restaurar ambas ventanas a su tamaño anterior (⌘⌥↑)"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[10.5px] font-medium text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Maximize2 className="w-3 h-3" aria-hidden="true" />
                  <span>Salir</span>
                </button>
              )}
            </div>
          </div>

          {/* Aviso de Accesibilidad en macOS solo si falta el permiso */}
          {!status.accessibilityGranted && (
            <div className="rounded-xl border border-white/[0.14] bg-white/[0.04] p-2 space-y-1.5">
              <p className="text-[10.5px] text-zinc-200 leading-snug">
                Activa <strong>Accesibilidad</strong> en macOS para que Xook ajuste también la otra ventana sin taparse.
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void onRequestAccessibility()}
                  className="px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[10.5px] font-semibold cursor-pointer transition-colors"
                >
                  Permitir
                </button>
                <button
                  type="button"
                  onClick={() => void onOpenAccessibilitySettings()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-[10.5px] text-zinc-200 cursor-pointer transition-colors"
                >
                  <span>Ajustes</span>
                  <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* Fila 2: 4 pantallas SVG monocromas (2×2) */}
          <div className="grid grid-cols-2 gap-1.5">
            {ASSIST_PRESET_OPTIONS.map((opt) => {
              const isSelected = status.active && !isManuallyScaled && status.preset === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSelectPreset(opt.id)}
                  title={opt.hint}
                  className={`p-1.5 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                    isSelected
                      ? "bg-white/[0.09] border-white/[0.34] text-white"
                      : "bg-white/[0.02] hover:bg-white/[0.06] border-white/[0.08] text-zinc-300 hover:text-white"
                  }`}
                >
                  <ScreenSplitIllustration
                    ratioPercent={opt.ratioPercent}
                    side={status.side}
                    selected={isSelected}
                  />
                  <div className="flex items-center justify-between gap-1 px-1 pt-1.5 pb-0.5">
                    <span className="text-[11px] font-medium truncate">{opt.label}</span>
                    {isSelected && (
                      <Check className="w-3 h-3 text-white shrink-0" aria-hidden="true" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Fila 3: Posición (Izq/Der) + Fijar encima compartiendo una sola línea */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="inline-flex items-center p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSelectSide("left")}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                  status.side === "left"
                    ? "bg-white/[0.14] text-white font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <SideIconSvg side="left" active={status.side === "left"} />
                <span>Izq</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSelectSide("right")}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                  status.side === "right"
                    ? "bg-white/[0.14] text-white font-medium"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <SideIconSvg side="right" active={status.side === "right"} />
                <span>Der</span>
              </button>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={status.alwaysOnTop}
              disabled={busy}
              onClick={() => void onToggleAlwaysOnTop(!status.alwaysOnTop)}
              title="Mantener Xook siempre encima de otras ventanas"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors cursor-pointer ${
                status.alwaysOnTop
                  ? "bg-white/[0.14] border-white/[0.28] text-white font-medium"
                  : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
              }`}
            >
              <Pin className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Encima</span>
            </button>
          </div>

          {/* Fila 4: Selector compacto de app acompañante */}
          <div className="space-y-1 pt-1.5 border-t border-white/[0.07]">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Ventana acompañante
              </span>
              <button
                type="button"
                onClick={onRefreshCompanions}
                disabled={loadingCompanions}
                aria-label="Actualizar ventanas abiertas"
                title="Actualizar ventanas abiertas"
                className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/[0.07] cursor-pointer transition-colors"
              >
                <RefreshCw
                  className={`w-3 h-3 ${loadingCompanions ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {companions.length === 0 ? (
              <p className="px-2 py-1 text-[10.5px] text-zinc-500">
                {loadingCompanions
                  ? "Buscando ventanas…"
                  : "Abre otra app para compartir pantalla."}
              </p>
            ) : (
              <div className="max-h-28 overflow-y-auto space-y-0.5 pr-0.5">
                {companions.slice(0, 5).map((win) => {
                  const isPaired =
                    status.active &&
                    status.companion?.pid === win.pid &&
                    (!status.companion.windowId || status.companion.windowId === win.windowId);
                  return (
                    <button
                      key={`${win.pid}-${win.windowId}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSelectCompanion(win)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        isPaired
                          ? "bg-white/[0.09] border-white/[0.16] text-white"
                          : "bg-transparent hover:bg-white/[0.05] border-transparent text-zinc-300"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <AppWindow
                          className="w-3.5 h-3.5 text-zinc-400 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-medium text-white truncate">
                            {win.appName}
                          </span>
                          {win.title && win.title !== win.appName && (
                            <span className="block text-[10px] text-zinc-500 truncate">
                              {win.title}
                            </span>
                          )}
                        </span>
                      </span>
                      {isPaired && (
                        <Check className="w-3.5 h-3.5 text-white shrink-0" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {status.notice && status.accessibilityGranted && (
            <p className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[10.5px] text-zinc-300 leading-snug">
              {status.notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
