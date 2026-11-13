import React, { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  MessageSquare,
  Minus,
  Plus,
  Repeat,
  ShieldAlert,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";
import {
  MetricItem,
  MetricTone,
  TaskBlock,
  TaskCategory,
  TaskProposal,
  computeVerifiedDecision,
} from "./taskSchema";

interface TaskCardRendererProps {
  task: TaskProposal;
  onUpdateParam: (cardId: string, key: string, value: number | string | boolean) => void;
  onToggleChecklist: (cardId: string, itemId: string) => void;
  onApprove: (task: TaskProposal) => void;
  onDiscard: (task: TaskProposal) => void;
  onAskXox: (task: TaskProposal) => void;
}

const CATEGORY_META: Record<TaskCategory, { label: string }> = {
  abastecimiento: { label: "Abastecimiento" },
  agenda: { label: "Agenda" },
  reloj: { label: "Reloj" },
  nota: { label: "Nota" },
  optimizacion: { label: "Plan Xox" },
  regla: { label: "Regla" },
  boveda: { label: "Bóveda IA" },
};

function toneTextClass(tone?: MetricTone): string {
  switch (tone) {
    case "critical":
      return "text-rose-300";
    case "warning":
      return "text-amber-300";
    case "positive":
      return "text-emerald-300";
    default:
      return "text-zinc-100";
  }
}

function urgencyAccent(urgency: TaskProposal["urgency"]) {
  switch (urgency) {
    case "alta":
      return {
        cardClass: "xook-task-card--alta",
        dotClass: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]",
        label: "Crítica",
        labelClass: "text-rose-300",
      };
    case "media":
      return {
        cardClass: "xook-task-card--media",
        dotClass: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.65)]",
        label: "Media",
        labelClass: "text-amber-300",
      };
    case "baja":
      return {
        cardClass: "xook-task-card--baja",
        dotClass: "bg-emerald-400",
        label: "Baja",
        labelClass: "text-emerald-300",
      };
    default:
      return {
        cardClass: "xook-task-card--info",
        dotClass: "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.65)]",
        label: "Sugerencia",
        labelClass: "text-sky-300",
      };
  }
}

export const TaskCardRenderer: React.FC<TaskCardRendererProps> = ({
  task,
  onUpdateParam,
  onToggleChecklist,
  onApprove,
  onDiscard,
  onAskXox,
}) => {
  const [expanded, setExpanded] = useState<boolean>(Boolean(task.defaultExpanded));
  const accent = urgencyAccent(task.urgency);
  const decision = computeVerifiedDecision(task);
  const categoryLabel = task.generatedBy ?? CATEGORY_META[task.category].label;

  // Resumen compacto cuando la tarjeta está colapsada
  const metricsBlock = task.blocks.find((b) => b.type === "metrics_strip");
  const scheduleBlock = task.blocks.find((b) => b.type === "schedule");
  const noteBlock = task.blocks.find((b) => b.type === "note");
  const checklistBlock = task.blocks.find((b) => b.type === "checklist");

  const renderMetricValue = (item: MetricItem) => {
    if (
      item.bindTotalFromParam &&
      typeof task.intent.unitPrice === "number" &&
      typeof task.paramValues[item.bindTotalFromParam] === "number"
    ) {
      const qty = Number(task.paramValues[item.bindTotalFromParam]);
      return `$${(qty * task.intent.unitPrice).toLocaleString()}`;
    }
    if (
      item.label.toLowerCase().includes("sugerido") &&
      task.intent.quantityParamKey &&
      typeof task.paramValues[task.intent.quantityParamKey] === "number"
    ) {
      return `+${task.paramValues[task.intent.quantityParamKey]} un.`;
    }
    return item.value;
  };

  const renderBlock = (block: TaskBlock, index: number) => {
    switch (block.type) {
      case "metrics_strip": {
        const cols =
          block.items.length === 2 ? "grid-cols-2" : "grid-cols-3";
        return (
          <div
            key={`blk_${index}`}
            className={`grid ${cols} divide-x divide-white/[0.06] rounded-xl bg-white/[0.025] border border-white/[0.06] py-2`}
          >
            {block.items.map((item, i) => (
              <div key={i} className="px-2.5 min-w-0">
                <div className="text-[9.5px] uppercase tracking-wider text-zinc-500 truncate">
                  {item.label}
                </div>
                <div
                  className={`text-[12.5px] font-semibold font-mono tabular-nums mt-0.5 truncate ${toneTextClass(
                    item.tone
                  )}`}
                >
                  {renderMetricValue(item)}
                  {item.sub && (
                    <span className="text-[10px] font-normal text-zinc-400 ml-1">
                      {item.sub}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "coverage_bar": {
        const barGradient =
          block.tone === "critical"
            ? "from-rose-500/85 to-rose-400"
            : block.tone === "warning"
            ? "from-amber-500/85 to-amber-300"
            : block.tone === "ok"
            ? "from-emerald-500/85 to-emerald-300"
            : "from-sky-500/85 to-cyan-300";

        return (
          <div key={`blk_${index}`} className="space-y-1.5">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-zinc-300 font-medium">{block.currentLabel}</span>
              <span className="text-zinc-500 font-mono">{block.targetLabel}</span>
            </div>
            <div className="relative h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-300`}
                style={{ width: `${Math.min(100, Math.max(6, block.ratio))}%` }}
              />
              {typeof block.markerRatio === "number" && (
                <div
                  title={block.targetLabel}
                  className="absolute inset-y-0 w-[2px] bg-white/85 shadow-[0_0_6px_rgba(255,255,255,0.8)]"
                  style={{ left: `${Math.min(98, Math.max(2, block.markerRatio))}%` }}
                />
              )}
            </div>
            {block.caption && (
              <p className="text-[10.5px] text-zinc-400 leading-snug">{block.caption}</p>
            )}
          </div>
        );
      }

      case "schedule": {
        const autoActive =
          typeof task.paramValues.auto_schedule === "boolean"
            ? task.paramValues.auto_schedule
            : Boolean(block.autoSchedule);
        const liveMinutes =
          typeof task.paramValues.duration_min === "number"
            ? task.paramValues.duration_min
            : null;
        const displayTime =
          block.mode === "timer" && liveMinutes !== null
            ? `${String(liveMinutes).padStart(2, "0")}:00`
            : typeof task.paramValues.window_slot === "string"
            ? `${task.paramValues.window_slot} hrs`
            : block.timeLabel;

        return (
          <div
            key={`blk_${index}`}
            className="rounded-xl bg-sky-500/[0.05] border border-sky-400/[0.14] p-2.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-sky-400/10 border border-sky-300/20 flex items-center justify-center shrink-0">
                  {block.mode === "timer" ? (
                    <Clock className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <CalendarClock className="w-3.5 h-3.5 text-sky-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold font-mono tabular-nums text-sky-100">
                    {displayTime}
                  </div>
                  <div className="text-[10.5px] text-zinc-400 truncate">
                    {[block.dateLabel, block.recurrence].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>

              {(block.mode === "auto" || block.autoTriggerLabel || block.autoSchedule !== undefined) && (
                <button
                  type="button"
                  onClick={() => onUpdateParam(task.cardId, "auto_schedule", !autoActive)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-colors cursor-pointer shrink-0 ${
                    autoActive
                      ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                      : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Repeat className="w-2.5 h-2.5" />
                  <span>{autoActive ? "Auto-agenda ON" : "Auto-agendar"}</span>
                </button>
              )}
            </div>

            {block.autoTriggerLabel && (
              <div className="text-[10.5px] text-sky-200/80 pl-9 leading-snug">
                {block.autoTriggerLabel}
              </div>
            )}
          </div>
        );
      }

      case "checklist": {
        return (
          <div key={`blk_${index}`} className="space-y-1.5">
            {block.title && (
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                {block.title}
              </div>
            )}
            <div className="space-y-1">
              {block.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onToggleChecklist(task.cardId, item.id)}
                  className="w-full flex items-start gap-2 py-1 px-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors cursor-pointer group"
                >
                  <span
                    className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 transition-colors ${
                      item.done
                        ? "bg-emerald-400/20 border-emerald-400/50 text-emerald-300"
                        : "border-white/20 bg-white/[0.02] group-hover:border-white/40"
                    }`}
                  >
                    {item.done && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span
                    className={`text-[11.5px] leading-snug ${
                      item.done ? "line-through text-zinc-500" : "text-zinc-200"
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      }

      case "note": {
        return (
          <div
            key={`blk_${index}`}
            className="space-y-2 py-1 border-y border-white/[0.05]"
          >
            <div className="flex items-start gap-2 text-[11.5px] text-zinc-200 leading-relaxed">
              <StickyNote className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
              <p>{block.content}</p>
            </div>
            {block.tags && block.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pl-5">
                {block.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-zinc-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      }

      case "comparison": {
        return (
          <div
            key={`blk_${index}`}
            className="space-y-1.5 py-1.5 border-y border-white/[0.05]"
          >
            {block.rows.map((row, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-zinc-400 shrink-0">{row.label}</span>
                <div className="flex items-center gap-1.5 min-w-0 font-mono">
                  <span className="text-zinc-500 line-through truncate">{row.before}</span>
                  <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" />
                  <span className={`font-medium truncate ${toneTextClass(row.tone ?? "positive")}`}>
                    {row.after}
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "kv_list": {
        return (
          <div
            key={`blk_${index}`}
            className="divide-y divide-white/[0.05] border-y border-white/[0.05]"
          >
            {block.rows.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 py-1.5 text-[11px]"
              >
                <span className="text-zinc-400 truncate">{row.label}</span>
                <div className="text-right min-w-0">
                  <span className="text-zinc-200 font-medium truncate block">
                    {row.value}
                  </span>
                  {row.subtle && (
                    <span className="text-[10px] text-zinc-500 font-mono block">
                      {row.subtle}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case "param_control": {
        if (block.kind === "stepper") {
          const val = Number(task.paramValues[block.key] ?? block.value);
          const min = block.min ?? 1;
          const max = block.max ?? 9999;
          const step = block.step ?? 1;
          const subtotal =
            typeof block.unitPrice === "number" ? val * block.unitPrice : null;

          return (
            <div
              key={`blk_${index}`}
              className="flex items-center justify-between gap-2 py-1"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-zinc-300 font-medium">{block.label}</div>
                {subtotal !== null && (
                  <div className="text-[10px] font-mono text-zinc-500">
                    ${block.unitPrice}/un. · Subtotal ${subtotal.toLocaleString()} {block.currency ?? "MXN"}
                  </div>
                )}
              </div>

              <div className="inline-flex items-center rounded-xl bg-white/[0.04] border border-white/[0.08] p-0.5 shrink-0">
                <button
                  type="button"
                  aria-label={`Disminuir ${block.label}`}
                  disabled={val <= min}
                  onClick={() =>
                    onUpdateParam(task.cardId, block.key, Math.max(min, val - step))
                  }
                  className="xook-stepper-btn w-6 h-6 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="px-2.5 text-xs font-mono font-semibold tabular-nums text-white min-w-[56px] text-center">
                  {val} {block.unit ?? ""}
                </span>
                <button
                  type="button"
                  aria-label={`Aumentar ${block.label}`}
                  disabled={val >= max}
                  onClick={() =>
                    onUpdateParam(task.cardId, block.key, Math.min(max, val + step))
                  }
                  className="xook-stepper-btn w-6 h-6 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        }

        if (block.kind === "select" && block.options) {
          const selected = String(task.paramValues[block.key] ?? block.value);
          return (
            <div key={`blk_${index}`} className="space-y-1.5">
              <div className="text-[10.5px] text-zinc-400">{block.label}</div>
              <div className="grid grid-cols-3 gap-1">
                {block.options.map((opt) => {
                  const isActive = selected === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdateParam(task.cardId, block.key, opt.value)}
                      className={`py-1.5 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                        isActive
                          ? "bg-white/[0.11] border-white/25 text-white shadow-sm"
                          : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="block text-[11px] font-mono font-medium">
                        {opt.label}
                      </span>
                      {opt.hint && (
                        <span className="block text-[9.5px] text-zinc-500 truncate">
                          {opt.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }

        return null;
      }

      case "insight": {
        return (
          <div
            key={`blk_${index}`}
            className="flex items-start gap-2 pl-2.5 border-l-2 border-sky-400/40 text-[11px] text-zinc-300 leading-relaxed"
          >
            <Sparkles className="w-3 h-3 text-sky-300 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-0.5">
              <p>{block.text}</p>
              {(block.source || typeof block.confidence === "number") && (
                <div className="text-[10px] font-mono text-zinc-500">
                  {[
                    block.source,
                    typeof block.confidence === "number"
                      ? `Confianza ${Math.round(block.confidence * 100)}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <article
      className={`xook-task-card ${accent.cardClass} rounded-2xl p-3.5 transition-all duration-200`}
    >
      {/* Cabecera interactiva: clic para expandir/contraer */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full text-left cursor-pointer group focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accent.dotClass}`} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent.labelClass}`}>
              {accent.label}
            </span>
            <span className="text-zinc-600 text-[10px]">·</span>
            <span className="text-[10.5px] text-zinc-400 truncate">{categoryLabel}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {(task.statusChip ||
              (task.category === "reloj" && typeof task.paramValues.duration_min === "number")) && (
              <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-zinc-300">
                {task.category === "reloj" && typeof task.paramValues.duration_min === "number"
                  ? `${task.paramValues.duration_min} min`
                  : typeof task.paramValues.window_slot === "string"
                  ? `Mar y Mié · ${task.paramValues.window_slot}`
                  : task.statusChip}
              </span>
            )}
            <ChevronDown
              className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </div>
        </div>

        <h4 className="text-[13px] font-semibold text-white tracking-tight mt-2 leading-snug">
          {task.title}
        </h4>

        {task.subtitle && (
          <p
            className={`text-[11px] text-zinc-400 mt-1 leading-relaxed ${
              expanded ? "" : "line-clamp-1"
            }`}
          >
            {task.subtitle}
          </p>
        )}
      </button>

      {/* Vista compacta cuando está contraída */}
      {!expanded && (
        <div className="mt-2.5 space-y-2.5">
          {metricsBlock?.type === "metrics_strip" && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.025] border border-white/[0.05] text-[11px] font-mono tabular-nums">
              {metricsBlock.items.map((item, i) => (
                <div key={i} className="truncate">
                  <span className="text-zinc-500 font-sans text-[10px] mr-1">
                    {item.label.split(" ")[0]}:
                  </span>
                  <span className={`font-semibold ${toneTextClass(item.tone)}`}>
                    {renderMetricValue(item)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!metricsBlock && scheduleBlock?.type === "schedule" && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-sky-500/[0.04] border border-sky-400/[0.12] text-[11px]">
              <span className="flex items-center gap-1.5 text-sky-200 font-mono">
                <CalendarClock className="w-3.5 h-3.5 text-sky-300" />
                {scheduleBlock.timeLabel}
              </span>
              <span className="text-zinc-400 truncate">
                {scheduleBlock.dateLabel ?? scheduleBlock.recurrence ?? "Programada"}
              </span>
            </div>
          )}

          {!metricsBlock && !scheduleBlock && noteBlock?.type === "note" && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.025] border border-white/[0.05] text-[11px] text-zinc-300">
              <span className="truncate">{noteBlock.content}</span>
              {checklistBlock?.type === "checklist" && (
                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                  {checklistBlock.items.filter((i) => i.done).length}/
                  {checklistBlock.items.length}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="px-2.5 py-1.5 rounded-xl text-[11px] text-zinc-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-colors cursor-pointer"
            >
              Ver / Ajustar
            </button>
            <button
              type="button"
              disabled={decision.exceedsBudget}
              onClick={() => onApprove(task)}
              className="xook-approve-btn flex-1 py-1.5 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="truncate">{decision.buttonLabel}</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => onDiscard(task)}
              title="Descartar propuesta"
              aria-label="Descartar propuesta"
              className="p-1.5 rounded-xl text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Vista expandida con todos los bloques declarativos */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {task.blocks.map((blk, i) => renderBlock(blk, i))}

          {decision.exceedsBudget && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-200">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              <span>
                Supera el límite por orden (${(task.intent.maxBudgetLimit ?? 50000).toLocaleString()}{" "}
                {decision.currency}). Ajusta la cantidad para aprobar.
              </span>
            </div>
          )}

          {/* Barra de firma HITL */}
          <div className="pt-1 flex items-center gap-1.5">
            <button
              type="button"
              disabled={decision.exceedsBudget}
              onClick={() => onApprove(task)}
              className="xook-approve-btn flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="truncate">{decision.buttonLabel}</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onDiscard(task)}
              className="px-2.5 py-2 rounded-xl text-xs text-zinc-400 hover:text-rose-200 bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.06] hover:border-rose-500/25 transition-colors cursor-pointer"
            >
              Descartar
            </button>

            <button
              type="button"
              onClick={() => onAskXox(task)}
              title="Consultar con Xox en el chat"
              aria-label="Consultar con Xox en el chat"
              className="p-2 rounded-xl text-zinc-400 hover:text-sky-200 bg-white/[0.03] hover:bg-sky-500/10 border border-white/[0.06] hover:border-sky-400/25 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </article>
  );
};
