import React, { useState } from "react";
import {
  ChevronDown,
  ListChecks,
  X,
  AlertCircle,
} from "lucide-react";
import type { ChecklistState } from "../features/ai-service/agentModeTypes";
import { LiquidGlassBackdrop } from "./LiquidGlassBackdrop";

export const OpenCircleCheckSvg: React.FC<{
  status: "pending" | "in_progress" | "done" | "error";
  className?: string;
}> = ({ status, className = "w-4 h-4" }) => {
  if (status === "done") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className={`${className} xook-check-pop overflow-visible shrink-0`}
        aria-hidden="true"
      >
        {/* Arco circular abierto en la esquina superior derecha (no encierra por completo a la palomita) */}
        <path
          d="M 16.95 9.15 A 7 7 0 1 1 13.75 4.05"
          pathLength={100}
          stroke="rgba(255, 255, 255, 0.72)"
          strokeWidth="1.65"
          strokeLinecap="round"
          className="xook-check-arc"
        />
        {/* Palomita / trazo diagonal que sale limpiamente por la abertura del círculo */}
        <path
          d="M 6.2 10.3 L 9.1 13.3 L 18.1 4.1"
          pathLength={100}
          stroke="#FFFFFF"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="xook-check-tick"
        />
      </svg>
    );
  }

  if (status === "in_progress") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className={`${className} shrink-0`}
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="7"
          stroke="rgba(255, 255, 255, 0.14)"
          strokeWidth="1.5"
        />
        <path
          d="M 10 3 A 7 7 0 0 1 17 10"
          stroke="rgba(255, 255, 255, 0.85)"
          strokeWidth="1.65"
          strokeLinecap="round"
          className="xook-spinner-arc"
        />
        <circle
          cx="10"
          cy="10"
          r="2"
          fill="#FFFFFF"
          className="animate-pulse"
        />
      </svg>
    );
  }

  if (status === "error") {
    return <AlertCircle className={`${className} text-zinc-400 shrink-0`} />;
  }

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`${className} shrink-0`}
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth="1.45"
      />
    </svg>
  );
};

interface ChecklistCornerCardProps {
  checklist: ChecklistState;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  onToggleItem?: (itemId: string) => void;
  onClose?: () => void;
}

/**
 * Tarjeta de Checklist en la esquina derecha del espacio de trabajo.
 * Diseño monocromo neutro (sin gradientes de color).
 * Al completarse una tarea anima un círculo abierto con la palomita saliendo del arco y texto subrayado.
 */
export const ChecklistCornerCard: React.FC<ChecklistCornerCardProps> = ({
  checklist,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className = "",
  onToggleItem,
  onClose,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = (next: boolean) => {
    setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const total = checklist.items.length;
  const completedCount = checklist.items.filter((it) => it.status === "done").length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const allDone = total > 0 && completedCount === total;
  const anyInProgress = checklist.items.some((it) => it.status === "in_progress");

  if (collapsed) {
    return (
      <div
        className={`toast-in inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-full bg-[#090b10]/68 backdrop-blur-2xl border border-white/[0.09] shadow-xl select-none ${className}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expandir tarjeta de Checklist"
          className="inline-flex items-center gap-2 text-left cursor-pointer"
        >
          <OpenCircleCheckSvg
            status={allDone ? "done" : anyInProgress ? "in_progress" : "pending"}
            className="w-3.5 h-3.5"
          />
          <span className="text-[11px] font-medium text-white max-w-[140px] truncate">
            {checklist.title || "Checklist"}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
            {completedCount}/{total}
          </span>
          <ChevronDown className="w-3 h-3 text-zinc-400 -rotate-90" />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar checklist"
            className="w-5 h-5 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <aside
      aria-label={`Checklist: ${checklist.title}`}
      className={`toast-in w-[278px] sm:w-[294px] rounded-2xl bg-[#090b10]/68 backdrop-blur-2xl border border-white/[0.09] shadow-2xl overflow-hidden select-none ${className}`}
    >
      <LiquidGlassBackdrop variant="menu" />

      <div className="relative z-[1] p-3.5 space-y-2.5">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-zinc-200 shrink-0">
              <ListChecks className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-white truncate leading-tight">
                {checklist.title || "Lista de tareas"}
              </h3>
              <p className="text-[10px] font-mono text-zinc-400 tabular-nums">
                {completedCount}/{total} completadas · {pct}%
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Contraer checklist"
              aria-expanded={!collapsed}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <ChevronDown className="w-3.5 h-3.5 transition-transform duration-200" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title="Cerrar tarjeta de checklist"
                aria-label="Cerrar tarjeta de checklist"
                className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Barra de progreso monocroma limpia */}
        <div className="h-1 w-full rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full bg-zinc-200 transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Lista de tareas */}
        <div className="max-h-[min(62vh,460px)] overflow-y-auto space-y-1 pt-0.5">
            {checklist.items.map((item) => {
              const isDone = item.status === "done";
              const isInProgress = item.status === "in_progress";

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggleItem?.(item.id)}
                  title={
                    isDone
                      ? "Tarea completada (clic para reabrir)"
                      : "Clic para marcar como completada"
                  }
                  className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-all cursor-pointer border ${
                    isInProgress
                      ? "bg-white/[0.07] border-white/[0.15]"
                      : isDone
                        ? "xook-checklist-row-done border-transparent hover:bg-white/[0.05]"
                        : "bg-transparent border-transparent hover:bg-white/[0.04]"
                  }`}
                >
                  {/* Icono SVG personalizado: círculo abierto + palomita sobresaliendo al completarse */}
                  <span className="mt-0.5 shrink-0 flex items-center justify-center">
                    <OpenCircleCheckSvg status={item.status} className="w-4 h-4" />
                  </span>

                  {/* Texto de la tarea (subrayado al completarse) */}
                  <div className="flex-1 min-w-0">
                    <span
                      className={`block text-[11.5px] leading-snug transition-colors duration-200 ${
                        isDone
                          ? "underline decoration-zinc-400/75 underline-offset-[3px] text-zinc-400"
                          : isInProgress
                            ? "text-white font-medium"
                            : "text-zinc-200"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.assignee && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[9.5px] font-mono text-zinc-400">
                        <span>↳</span>
                        <span>{item.assignee}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
      </div>
    </aside>
  );
};
