import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCcw,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import {
  CanvasInteractiveAction,
  CanvasInteractiveComputed,
  CanvasInteractiveControl,
  CanvasInteractiveSpec,
} from "../canvasSchema";
import { evaluateSafeFormula, formatComputedValue } from "../safeFormulaEval";

export interface InteractiveCanvasViewProps {
  spec: CanvasInteractiveSpec;
  onUpdateSpec: (next: CanvasInteractiveSpec) => void;
  onAction?: (action: { prompt: string; actionLabel?: string }) => void;
  isDark?: boolean;
}

function getToneCardClasses(
  tone: CanvasInteractiveComputed["tone"],
  isDark: boolean,
): { border: string; value: string; badge: string } {
  switch (tone) {
    case "success":
      return isDark
        ? {
            border: "border-emerald-500/30 bg-emerald-500/[0.06]",
            value: "text-emerald-300",
            badge: "bg-emerald-500/15 text-emerald-300",
          }
        : {
            border: "border-emerald-300 bg-emerald-50/70",
            value: "text-emerald-700",
            badge: "bg-emerald-100 text-emerald-700",
          };
    case "warning":
      return isDark
        ? {
            border: "border-amber-500/30 bg-amber-500/[0.06]",
            value: "text-amber-300",
            badge: "bg-amber-500/15 text-amber-300",
          }
        : {
            border: "border-amber-300 bg-amber-50/70",
            value: "text-amber-700",
            badge: "bg-amber-100 text-amber-700",
          };
    case "critical":
      return isDark
        ? {
            border: "border-rose-500/30 bg-rose-500/[0.06]",
            value: "text-rose-300",
            badge: "bg-rose-500/15 text-rose-300",
          }
        : {
            border: "border-rose-300 bg-rose-50/70",
            value: "text-rose-700",
            badge: "bg-rose-100 text-rose-700",
          };
    case "accent":
      return isDark
        ? {
            border: "border-white/18 bg-white/[0.045]",
            value: "text-white",
            badge: "bg-white/12 text-zinc-100",
          }
        : {
            border: "border-zinc-300 bg-zinc-100",
            value: "text-zinc-900",
            badge: "bg-zinc-200 text-zinc-800",
          };
    default:
      return isDark
        ? {
            border: "border-white/10 bg-white/[0.03]",
            value: "text-zinc-100",
            badge: "bg-white/10 text-zinc-300",
          }
        : {
            border: "border-zinc-200 bg-zinc-50/70",
            value: "text-zinc-900",
            badge: "bg-zinc-200/70 text-zinc-700",
          };
  }
}

function parseKanbanMap(
  rawValue: unknown,
  items: CanvasInteractiveControl["items"],
  columns: { id: string; label: string }[],
): Record<string, string> {
  const defaultCol = columns[0]?.id ?? "pendiente";
  const colLookup = new Map<string, string>();
  for (const c of columns) {
    colLookup.set(c.id.toLowerCase(), c.id);
    colLookup.set(c.label.trim().toLowerCase(), c.id);
  }
  const map: Record<string, string> = {};

  let sourceObj: Record<string, unknown> | null = null;
  if (typeof rawValue === "string" && rawValue.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        sourceObj = parsed as Record<string, unknown>;
      }
    } catch {
      sourceObj = null;
    }
  } else if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    sourceObj = rawValue as Record<string, unknown>;
  }

  for (const item of items ?? []) {
    const candidate = sourceObj?.[item.id] ?? item.column ?? defaultCol;
    const normalizedKey = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
    const resolved = (normalizedKey && colLookup.get(normalizedKey)) || defaultCol;
    map[item.id] = resolved;
  }
  return map;
}

function formatStateValueForPrompt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const InteractiveCanvasView: React.FC<InteractiveCanvasViewProps> = ({
  spec,
  onUpdateSpec,
  onAction,
  isDark = true,
}) => {
  const instanceUid = useId();
  const initialSnapshotRef = useRef<string>(JSON.stringify(spec.state ?? {}));
  const lastControlsSigRef = useRef<string>(
    spec.controls.map((c) => `${c.id}:${c.stateKey}:${c.type}`).join("|"),
  );

  // Actualiza snapshot base si el agente reemplazó la estructura de controles
  useEffect(() => {
    const sig = spec.controls.map((c) => `${c.id}:${c.stateKey}:${c.type}`).join("|");
    if (sig !== lastControlsSigRef.current) {
      lastControlsSigRef.current = sig;
      initialSnapshotRef.current = JSON.stringify(spec.state ?? {});
    }
  }, [spec.controls, spec.state]);

  const tabs = spec.tabs ?? [];
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id ?? "");

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    } else if (tabs.length === 0 && activeTabId) {
      setActiveTabId("");
    }
  }, [tabs, activeTabId]);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const state = spec.state ?? {};

  const isConditionTruthy = (expr: string | undefined): boolean => {
    if (!expr || !expr.trim()) return true;
    const res = evaluateSafeFormula(expr, state);
    if (res.error) return true;
    return Boolean(res.value);
  };

  const resolveEffectiveMetricTone = (
    comp: CanvasInteractiveComputed,
    rawVal: unknown,
  ): CanvasInteractiveComputed["tone"] => {
    const num = typeof rawVal === "number" && Number.isFinite(rawVal) ? rawVal : null;
    const labelLow = `${comp.label} ${comp.caption ?? ""}`.toLowerCase();
    const isProfitOrGoalMetric =
      /(utilidad|ganancia|margen|neto|rentabilidad|roi|avance|ahorro|flujo|saldo|beneficio|resultado)/i.test(
        labelLow,
      );
    if (num !== null) {
      if (num < 0 && (comp.tone === "success" || comp.tone === "accent" || isProfitOrGoalMetric)) {
        return "critical";
      }
      if (num > 0 && comp.tone === "critical" && isProfitOrGoalMetric) {
        return "success";
      }
      if (num === 0 && comp.tone === "success" && isProfitOrGoalMetric) {
        return "neutral";
      }
    }
    return comp.tone;
  };

  const computedEvaluated = useMemo(() => {
    return (spec.computed ?? [])
      .filter((comp) => isConditionTruthy(comp.visibleWhen))
      .map((comp) => {
        const res = evaluateSafeFormula(comp.expr, state);
        const effectiveTone = resolveEffectiveMetricTone(comp, res.value);
        return {
          comp,
          res,
          effectiveTone,
          formatted: res.error
            ? "Error"
            : formatComputedValue(res.value, comp.format, comp.unit),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.computed, state]);

  const updateStateValue = (stateKey: string, nextValue: unknown) => {
    onUpdateSpec({
      ...spec,
      state: {
        ...state,
        [stateKey]: nextValue,
      },
      submitted: false,
    });
  };

  const handleReset = () => {
    try {
      const parsed = JSON.parse(initialSnapshotRef.current);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        onUpdateSpec({
          ...spec,
          state: parsed as Record<string, unknown>,
          submitted: false,
          submittedAt: undefined,
        });
      }
    } catch {
      // Fallback: conservar estado actual si snapshot falló
    }
  };

  const buildActionPrompt = (act?: CanvasInteractiveAction): string => {
    if (act?.promptTemplate) {
      let prompt = act.promptTemplate;
      for (const [k, v] of Object.entries(state)) {
        prompt = prompt.split(`{${k}}`).join(formatStateValueForPrompt(v));
      }
      return prompt;
    }

    const stateSummary = spec.controls
      .map((c) => {
        const val = state[c.stateKey];
        if (c.type === "checklist" && c.items) {
          const checkedSet = new Set(Array.isArray(val) ? val.map(String) : []);
          const done = checkedSet.size;
          const total = c.items.length;
          return `- ${c.label}: ${done}/${total} marcados (${
            c.items
              .filter((it) => checkedSet.has(it.id))
              .map((it) => it.label)
              .join(", ") || "ninguno"
          })`;
        }
        return `- ${c.label}: ${c.prefix ?? ""}${formatStateValueForPrompt(val)}${
          c.unit ? ` ${c.unit}` : ""
        }`;
      })
      .join("\n");

    const computedSummary = computedEvaluated
      .map((entry) => `- ${entry.comp.label}: ${entry.formatted}`)
      .join("\n");

    return [
      act?.label
        ? `Acción solicitada desde la interfaz interactiva: "${act.label}".`
        : "Te comparto el estado actual ajustado en la interfaz interactiva:",
      stateSummary ? `\nValores actuales:\n${stateSummary}` : "",
      computedSummary ? `\nResultados calculados:\n${computedSummary}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const handleSendAction = (act?: CanvasInteractiveAction) => {
    const prompt = buildActionPrompt(act);
    onUpdateSpec({
      ...spec,
      submitted: true,
      submittedAt: new Date().toISOString(),
    });
    onAction?.({ prompt, actionLabel: act?.label });
  };

  const renderComputedGrid = (
    items: Array<{
      comp: CanvasInteractiveComputed;
      res: { value: unknown; error?: string };
      effectiveTone: CanvasInteractiveComputed["tone"];
      formatted: string;
    }>,
  ) => {
    if (items.length === 0) return null;

    // Si hay <= 3 métricas, mostrarlas como tarjetas principales limpias
    if (items.length <= 3) {
      return (
        <div className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @2xl:grid-cols-3">
          {items.map(({ comp, res, effectiveTone, formatted }) => {
            const tone = getToneCardClasses(effectiveTone, isDark);
            return (
              <div
                key={comp.id}
                className={`rounded-xl border px-4 py-3 transition-colors ${tone.border}`}
              >
                <span
                  className={`block text-[11px] font-semibold uppercase tracking-wider ${
                    isDark ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {comp.label}
                </span>
                <div className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${tone.value}`}>
                  {formatted}
                </div>
                {comp.caption && !res.error && (
                  <p
                    className={`mt-1 text-[11px] leading-snug ${
                      isDark ? "text-zinc-400" : "text-zinc-600"
                    }`}
                  >
                    {comp.caption}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // Con 4+ métricas: separar 1-3 métricas Hero protagonistas arriba y el resto en una cascada limpia de desglose
    const explicitHeroes = items.filter((it) => it.comp.role === "hero");
    const heroSet = new Set<string>();
    if (explicitHeroes.length > 0) {
      explicitHeroes.slice(0, 3).forEach((it) => heroSet.add(it.comp.id));
    } else {
      const heroRegex =
        /\b(utilidad|ganancia|margen|rendimiento|roi|punto\s+de\s+equilibrio|avance|meta|total\s+final|pago\s+mensual|ahorro)\b/i;
      items.forEach((it) => {
        if (heroSet.size < 3 && heroRegex.test(it.comp.label)) {
          heroSet.add(it.comp.id);
        }
      });
      if (heroSet.size === 0) {
        items.slice(-2).forEach((it) => heroSet.add(it.comp.id));
      }
    }

    const heroItems = items.filter((it) => heroSet.has(it.comp.id));
    const breakdownItems = items.filter((it) => !heroSet.has(it.comp.id));

    return (
      <div className="space-y-3">
        <div
          className={`grid grid-cols-1 gap-2.5 ${
            heroItems.length === 1
              ? ""
              : heroItems.length === 2
                ? "@md:grid-cols-2"
                : "@md:grid-cols-2 @2xl:grid-cols-3"
          }`}
        >
          {heroItems.map(({ comp, res, effectiveTone, formatted }) => {
            const tone = getToneCardClasses(effectiveTone, isDark);
            const numVal = typeof res.value === "number" && Number.isFinite(res.value) ? res.value : null;
            const showProgressBar =
              numVal !== null &&
              (comp.format === "percent" || /(avance|meta|margen|progreso)/i.test(comp.label));
            const pctClamped =
              numVal !== null ? Math.max(0, Math.min(100, Math.abs(numVal))) : 0;
            const barColor =
              effectiveTone === "critical"
                ? "bg-rose-400"
                : effectiveTone === "warning"
                  ? "bg-amber-400"
                  : effectiveTone === "success"
                    ? "bg-emerald-400"
                    : "bg-zinc-200";

            return (
              <div
                key={comp.id}
                className={`rounded-2xl border px-4 py-3.5 transition-colors ${tone.border}`}
              >
                <span
                  className={`block text-[10.5px] font-semibold uppercase tracking-[0.05em] ${
                    isDark ? "text-zinc-400" : "text-zinc-600"
                  }`}
                >
                  {comp.label}
                </span>
                <div className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${tone.value}`}>
                  {formatted}
                </div>
                {showProgressBar && (
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={`h-full rounded-full transition-all duration-200 ${barColor}`}
                      style={{ width: `${pctClamped}%` }}
                    />
                  </div>
                )}
                {comp.caption && !res.error && (
                  <p
                    className={`mt-1.5 text-[11px] leading-snug ${
                      isDark ? "text-zinc-400" : "text-zinc-600"
                    }`}
                  >
                    {comp.caption}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {breakdownItems.length > 0 && (
          <div
            className={`overflow-hidden rounded-xl border ${
              isDark ? "border-white/[0.08] bg-white/[0.02]" : "border-zinc-200 bg-zinc-50/70"
            }`}
          >
            <div
              className={`border-b px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] ${
                isDark ? "border-white/[0.06] text-zinc-400" : "border-zinc-200 text-zinc-500"
              }`}
            >
              Desglose del cálculo
            </div>
            <div className="divide-y divide-white/[0.05]">
              {breakdownItems.map(({ comp, res, effectiveTone, formatted }) => {
                const isInactiveZero =
                  res.value === 0 && Boolean(comp.caption && /solo\s+se|cuando|aplica/i.test(comp.caption));
                const valColor =
                  effectiveTone === "critical"
                    ? "text-rose-300"
                    : effectiveTone === "warning"
                      ? "text-amber-300"
                      : effectiveTone === "success"
                        ? "text-emerald-300"
                        : isDark
                          ? "text-zinc-100"
                          : "text-zinc-900";
                return (
                  <div
                    key={comp.id}
                    className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-opacity ${
                      isInactiveZero ? "opacity-50" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`font-medium ${isDark ? "text-zinc-300" : "text-zinc-700"}`}>
                        {comp.label}
                      </span>
                      {comp.caption && !res.error && (
                        <span className="ml-2 text-[11px] text-zinc-500">{comp.caption}</span>
                      )}
                    </div>
                    <span className={`shrink-0 font-mono text-[13px] font-semibold tabular-nums ${valColor}`}>
                      {formatted}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderControl = (ctrl: CanvasInteractiveControl) => {
    const rawVal = state[ctrl.stateKey];
    const inputBase = isDark
      ? "w-full rounded-lg border border-white/12 bg-black/35 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
      : "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none";
    const cardCls = isDark
      ? "rounded-xl border border-white/10 bg-white/[0.025] p-3.5"
      : "rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xs";

    if (ctrl.type === "slider") {
      const min = ctrl.min ?? 0;
      const max = ctrl.max ?? 100;
      const step = ctrl.step ?? (max - min <= 10 ? 0.5 : 1);
      const numVal = typeof rawVal === "number" ? rawVal : Number(rawVal ?? min) || min;

      return (
        <div key={ctrl.id} className={cardCls}>
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`${instanceUid}-${ctrl.id}`}
              className={`text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}
            >
              {ctrl.label}
            </label>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums ${
                isDark
                  ? "border-white/15 bg-white/[0.08] text-zinc-100"
                  : "border-zinc-300 bg-zinc-100 text-zinc-800"
              }`}
            >
              {ctrl.prefix ?? ""}
              {new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(numVal)}
              {ctrl.unit ? ` ${ctrl.unit}` : ""}
            </span>
          </div>
          <input
            id={`${instanceUid}-${ctrl.id}`}
            type="range"
            min={min}
            max={max}
            step={step}
            value={numVal}
            onChange={(e) => updateStateValue(ctrl.stateKey, Number(e.target.value))}
            className="mt-2.5 w-full cursor-pointer accent-zinc-200"
          />
          <div
            className={`mt-1 flex justify-between text-[10px] tabular-nums ${
              isDark ? "text-zinc-500" : "text-zinc-500"
            }`}
          >
            <span>
              {ctrl.prefix ?? ""}
              {min}
              {ctrl.unit ? ` ${ctrl.unit}` : ""}
            </span>
            <span>
              {ctrl.prefix ?? ""}
              {max}
              {ctrl.unit ? ` ${ctrl.unit}` : ""}
            </span>
          </div>
          {ctrl.helperText && (
            <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
        </div>
      );
    }

    if (ctrl.type === "number") {
      const numVal =
        typeof rawVal === "number"
          ? rawVal
          : Number(rawVal ?? ctrl.min ?? 0) || 0;
      const step = ctrl.step ?? 1;

      return (
        <div key={ctrl.id} className={cardCls}>
          <label
            htmlFor={`${instanceUid}-${ctrl.id}`}
            className={`block text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}
          >
            {ctrl.label}
          </label>
          <div className="mt-2 flex items-center gap-1.5">
            {ctrl.prefix && (
              <span className={`text-xs font-medium ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
                {ctrl.prefix}
              </span>
            )}
            <input
              id={`${instanceUid}-${ctrl.id}`}
              type="number"
              min={ctrl.min}
              max={ctrl.max}
              step={step}
              value={numVal}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                updateStateValue(ctrl.stateKey, Number.isFinite(parsed) ? parsed : 0);
              }}
              className={`${inputBase} tabular-nums`}
            />
            {ctrl.unit && (
              <span className={`shrink-0 text-xs ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
                {ctrl.unit}
              </span>
            )}
          </div>
          {ctrl.helperText && (
            <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
        </div>
      );
    }

    if (ctrl.type === "toggle") {
      const checked = Boolean(rawVal);
      return (
        <div key={ctrl.id} className={cardCls}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
                {ctrl.label}
              </div>
              {ctrl.helperText && (
                <p className={`mt-0.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
                  {ctrl.helperText}
                </p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              aria-label={ctrl.label}
              onClick={() => updateStateValue(ctrl.stateKey, !checked)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                checked
                  ? "border-white/30 bg-zinc-200"
                  : isDark
                    ? "border-white/15 bg-white/10"
                    : "border-zinc-300 bg-zinc-200"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                  checked ? "translate-x-5.5 bg-zinc-950" : "translate-x-1 bg-white"
                }`}
              />
            </button>
          </div>
        </div>
      );
    }

    if (
      ctrl.type === "segmented" ||
      (ctrl.type === "select" &&
        (ctrl.options?.length ?? 0) > 0 &&
        (ctrl.options?.length ?? 0) <= 4 &&
        (ctrl.options ?? []).every((o) => o.length <= 26))
    ) {
      const opts = ctrl.options ?? [];
      const selected = typeof rawVal === "string" ? rawVal : (opts[0] ?? "");
      return (
        <div key={ctrl.id} className={cardCls}>
          <div className={`text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
            {ctrl.label}
          </div>
          <div
            role="radiogroup"
            aria-label={ctrl.label}
            className={`mt-2 inline-flex max-w-full flex-wrap gap-1 rounded-lg border p-1 ${
              isDark ? "border-white/10 bg-black/30" : "border-zinc-200 bg-zinc-100"
            }`}
          >
            {opts.map((opt) => {
              const active = selected === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateStateValue(ctrl.stateKey, opt)}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    active
                      ? isDark
                        ? "border border-white/25 bg-white/[0.12] text-white shadow-xs"
                        : "border border-zinc-400 bg-white text-zinc-900 shadow-xs"
                      : isDark
                        ? "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                        : "text-zinc-600 hover:bg-white/70 hover:text-zinc-900"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {ctrl.helperText && (
            <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
        </div>
      );
    }

    if (ctrl.type === "select") {
      const opts = ctrl.options ?? [];
      const selected = typeof rawVal === "string" ? rawVal : (opts[0] ?? "");
      return (
        <div key={ctrl.id} className={cardCls}>
          <label
            htmlFor={`${instanceUid}-${ctrl.id}`}
            className={`block text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}
          >
            {ctrl.label}
          </label>
          <select
            id={`${instanceUid}-${ctrl.id}`}
            value={selected}
            onChange={(e) => updateStateValue(ctrl.stateKey, e.target.value)}
            className={`${inputBase} mt-2 cursor-pointer`}
          >
            {opts.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {ctrl.helperText && (
            <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
        </div>
      );
    }

    if (ctrl.type === "checklist") {
      const items = ctrl.items ?? [];
      const checkedIds = new Set(Array.isArray(rawVal) ? rawVal.map(String) : []);
      const toggleItem = (itemId: string) => {
        const next = new Set(checkedIds);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        updateStateValue(ctrl.stateKey, Array.from(next));
      };

      return (
        <div key={ctrl.id} className={`${cardCls} sm:col-span-2`}>
          <div className="flex items-center justify-between gap-2">
            <div className={`text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
              {ctrl.label}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                isDark ? "bg-white/10 text-zinc-300" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {checkedIds.size}/{items.length}
            </span>
          </div>
          {ctrl.helperText && (
            <p className={`mt-1 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
          <div className="mt-2.5 space-y-1.5">
            {items.map((item) => {
              const isChecked = checkedIds.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-pressed={isChecked}
                  className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isChecked
                      ? isDark
                        ? "border-emerald-500/35 bg-emerald-500/[0.08]"
                        : "border-emerald-300 bg-emerald-50/70"
                      : isDark
                        ? "border-white/8 bg-black/25 hover:border-white/20"
                        : "border-zinc-200 bg-zinc-50/60 hover:border-zinc-300"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      isChecked
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : isDark
                          ? "border-white/25 bg-black/30"
                          : "border-zinc-300 bg-white"
                    }`}
                  >
                    {isChecked && <Check className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs font-medium ${
                        isChecked
                          ? isDark
                            ? "text-zinc-300 line-through opacity-80"
                            : "text-zinc-600 line-through opacity-80"
                          : isDark
                            ? "text-zinc-100"
                            : "text-zinc-900"
                      }`}
                    >
                      {item.label}
                    </div>
                    {item.detail && (
                      <div
                        className={`mt-0.5 text-[11px] ${
                          isDark ? "text-zinc-400" : "text-zinc-600"
                        }`}
                      >
                        {item.detail}
                      </div>
                    )}
                  </div>
                  {item.badge && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        isDark ? "bg-white/10 text-zinc-300" : "bg-zinc-200/70 text-zinc-700"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (ctrl.type === "kanban") {
      const cols = ctrl.columns?.length
        ? ctrl.columns
        : [
            { id: "pendiente", label: "Pendiente" },
            { id: "en_curso", label: "En curso" },
            { id: "listo", label: "Listo" },
          ];
      const items = ctrl.items ?? [];
      const kmap = parseKanbanMap(rawVal, items, cols);

      const moveCard = (itemId: string, targetColId: string) => {
        const nextMap = { ...kmap, [itemId]: targetColId };
        updateStateValue(ctrl.stateKey, JSON.stringify(nextMap));
      };

      return (
        <div key={ctrl.id} className={`${cardCls} sm:col-span-2`}>
          <div className="flex items-center justify-between gap-2">
            <div className={`text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>
              {ctrl.label}
            </div>
            <span className={`text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {items.length} elementos
            </span>
          </div>
          {ctrl.helperText && (
            <p className={`mt-1 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
            {cols.map((col, colIdx) => {
              const colItems = items.filter((it) => kmap[it.id] === col.id);
              return (
                <div
                  key={col.id}
                  className={`rounded-lg border p-2.5 ${
                    isDark
                      ? "border-white/10 bg-black/30"
                      : "border-zinc-200 bg-zinc-50/90"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-semibold uppercase tracking-wide ${
                        isDark ? "text-zinc-300" : "text-zinc-700"
                      }`}
                    >
                      {col.label}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                        isDark ? "bg-white/10 text-zinc-400" : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {colItems.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {colItems.length === 0 ? (
                      <div
                        className={`rounded border border-dashed py-3 text-center text-[11px] ${
                          isDark ? "border-white/10 text-zinc-500" : "border-zinc-300 text-zinc-400"
                        }`}
                      >
                        Vacío
                      </div>
                    ) : (
                      colItems.map((it) => (
                        <div
                          key={it.id}
                          className={`rounded-lg border p-2.5 ${
                            isDark
                              ? "border-white/10 bg-white/[0.04]"
                              : "border-zinc-200 bg-white shadow-2xs"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={`text-xs font-medium ${
                                isDark ? "text-zinc-100" : "text-zinc-900"
                              }`}
                            >
                              {it.label}
                            </span>
                            {it.badge && (
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  isDark
                                    ? "bg-indigo-500/20 text-indigo-200"
                                    : "bg-indigo-50 text-indigo-700"
                                }`}
                              >
                                {it.badge}
                              </span>
                            )}
                          </div>
                          {it.detail && (
                            <p
                              className={`mt-1 text-[11px] leading-snug ${
                                isDark ? "text-zinc-400" : "text-zinc-600"
                              }`}
                            >
                              {it.detail}
                            </p>
                          )}
                          <div className="mt-2 flex items-center justify-end gap-1">
                            <button
                              type="button"
                              disabled={colIdx === 0}
                              onClick={() => moveCard(it.id, cols[colIdx - 1].id)}
                              title="Mover a columna anterior"
                              className={`rounded p-1 transition-colors disabled:opacity-30 ${
                                isDark
                                  ? "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                              }`}
                            >
                              <ArrowLeft className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              disabled={colIdx >= cols.length - 1}
                              onClick={() => moveCard(it.id, cols[colIdx + 1].id)}
                              title="Mover a siguiente columna"
                              className={`rounded p-1 transition-colors disabled:opacity-30 ${
                                isDark
                                  ? "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
                                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                              }`}
                            >
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (ctrl.type === "textarea") {
      const strVal = typeof rawVal === "string" ? rawVal : String(rawVal ?? "");
      return (
        <div key={ctrl.id} className={`${cardCls} sm:col-span-2`}>
          <label
            htmlFor={`${instanceUid}-${ctrl.id}`}
            className={`block text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}
          >
            {ctrl.label}
          </label>
          <textarea
            id={`${instanceUid}-${ctrl.id}`}
            rows={3}
            value={strVal}
            placeholder={ctrl.placeholder}
            onChange={(e) => updateStateValue(ctrl.stateKey, e.target.value)}
            className={`${inputBase} mt-2 resize-y`}
          />
          {ctrl.helperText && (
            <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
              {ctrl.helperText}
            </p>
          )}
        </div>
      );
    }

    // Default: text
    const strVal = typeof rawVal === "string" ? rawVal : String(rawVal ?? "");
    return (
      <div key={ctrl.id} className={cardCls}>
        <label
          htmlFor={`${instanceUid}-${ctrl.id}`}
          className={`block text-xs font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}
        >
          {ctrl.label}
        </label>
        <input
          id={`${instanceUid}-${ctrl.id}`}
          type="text"
          value={strVal}
          placeholder={ctrl.placeholder}
          onChange={(e) => updateStateValue(ctrl.stateKey, e.target.value)}
          className={`${inputBase} mt-2`}
        />
        {ctrl.helperText && (
          <p className={`mt-1.5 text-[11px] ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
            {ctrl.helperText}
          </p>
        )}
      </div>
    );
  };

  // Separación de KPIs globales (sin tabId) vs KPIs por pestaña
  const globalComputed = tabs.length > 0
    ? computedEvaluated.filter((entry) => !entry.comp.tabId)
    : computedEvaluated;

  const visibleControls = useMemo(
    () => spec.controls.filter((ctrl) => isConditionTruthy(ctrl.visibleWhen)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.controls, state],
  );

  const actions = spec.actions ?? [];
  const hasAnyControls = visibleControls.length > 0;
  const controlsGridClass =
    spec.layout === "grid" || spec.layout === "split" || spec.layout === "tabs" || visibleControls.length >= 4
      ? "grid grid-cols-1 gap-3 @lg:grid-cols-2"
      : "grid grid-cols-1 gap-3";
  const useSplitLayout =
    tabs.length === 0 &&
    hasAnyControls &&
    globalComputed.length > 0 &&
    (spec.layout === "split" || (visibleControls.length >= 4 && globalComputed.length >= 4));

  return (
    <div className="space-y-4">
      {spec.description && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed ${
            isDark
              ? "border-white/10 bg-white/[0.03] text-zinc-300"
              : "border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        >
          <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <span>{spec.description}</span>
        </div>
      )}

      {useSplitLayout ? (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-12 items-start">
          <div className="@3xl:col-span-6 order-1 @3xl:order-2 @3xl:sticky @3xl:top-2 space-y-3">
            {renderComputedGrid(globalComputed)}
          </div>
          <div className="@3xl:col-span-6 order-2 @3xl:order-1">
            <div className={controlsGridClass}>{visibleControls.map(renderControl)}</div>
          </div>
        </div>
      ) : (
        <>
          {globalComputed.length > 0 && renderComputedGrid(globalComputed)}

          {tabs.length > 0 ? (
            <div className="space-y-3">
              <div
                role="tablist"
                aria-label="Secciones interactivas"
                className={`flex flex-nowrap items-center gap-1 overflow-x-auto border-b pb-0.5 ${
                  isDark ? "border-white/10" : "border-zinc-200"
                }`}
              >
                {tabs.map((tab, tIdx) => {
                  const selected = activeTabId === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(el) => {
                        tabRefs.current[tIdx] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`${instanceUid}-tab-${tab.id}`}
                      aria-selected={selected}
                      aria-controls={`${instanceUid}-panel-${tab.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTabId(tab.id)}
                      onKeyDown={(e) => {
                        let nextIdx: number | null = null;
                        if (e.key === "ArrowRight") nextIdx = (tIdx + 1) % tabs.length;
                        else if (e.key === "ArrowLeft")
                          nextIdx = (tIdx - 1 + tabs.length) % tabs.length;
                        else if (e.key === "Home") nextIdx = 0;
                        else if (e.key === "End") nextIdx = tabs.length - 1;
                        if (nextIdx !== null) {
                          e.preventDefault();
                          const nextTab = tabs[nextIdx];
                          setActiveTabId(nextTab.id);
                          tabRefs.current[nextIdx]?.focus();
                        }
                      }}
                      className={`relative shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                        selected
                          ? isDark
                            ? "border-white/60 bg-white/[0.06] text-zinc-100"
                            : "border-zinc-800 bg-zinc-100 text-zinc-900"
                          : isDark
                            ? "border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
                            : "border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {tabs.map((tab, tIdx) => {
                const selected = activeTabId === tab.id;
                const tabComputed = computedEvaluated.filter(
                  (entry) => entry.comp.tabId === tab.id,
                );
                const tabControls = visibleControls.filter(
                  (ctrl) => ctrl.tabId === tab.id || (tIdx === 0 && !ctrl.tabId),
                );
                return (
                  <div
                    key={tab.id}
                    role="tabpanel"
                    id={`${instanceUid}-panel-${tab.id}`}
                    aria-labelledby={`${instanceUid}-tab-${tab.id}`}
                    hidden={!selected}
                    className="space-y-3"
                  >
                    {tab.description && (
                      <p className={`text-xs ${isDark ? "text-zinc-400" : "text-zinc-600"}`}>
                        {tab.description}
                      </p>
                    )}
                    {tabComputed.length > 0 && renderComputedGrid(tabComputed)}
                    {tabControls.length > 0 && (
                      <div className={controlsGridClass}>{tabControls.map(renderControl)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            hasAnyControls && (
              <div className={controlsGridClass}>{visibleControls.map(renderControl)}</div>
            )
          )}
        </>
      )}

      {(actions.length > 0 || hasAnyControls) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-t pt-3 ${
            isDark ? "border-white/10" : "border-zinc-200"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {actions.length > 0 ? (
              actions.map((act) => {
                if (act.action === "reset") {
                  return (
                    <button
                      key={act.id}
                      type="button"
                      onClick={handleReset}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isDark
                          ? "border-white/12 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {act.label}
                    </button>
                  );
                }
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => handleSendAction(act)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      act.style === "secondary"
                        ? isDark
                          ? "border-white/12 bg-white/[0.05] text-zinc-200 hover:bg-white/10"
                          : "border-zinc-300 bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                        : isDark
                          ? "border-white/22 bg-white/[0.11] text-white hover:bg-white/[0.16]"
                          : "border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800"
                    }`}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {act.label}
                  </button>
                );
              })
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleReset}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isDark
                      ? "border-white/12 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]"
                      : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reiniciar
                </button>
                {onAction && (
                  <button
                    type="button"
                    onClick={() => handleSendAction()}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      isDark
                        ? "border-white/22 bg-white/[0.11] text-white hover:bg-white/[0.16]"
                        : "border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800"
                    }`}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Enviar escenario a Xox
                  </button>
                )}
              </>
            )}
          </div>

          {spec.submitted && (
            <span
              className={`text-[11px] font-medium ${
                isDark ? "text-emerald-300" : "text-emerald-700"
              }`}
            >
              Enviado a Xox
            </span>
          )}
        </div>
      )}
    </div>
  );
};
