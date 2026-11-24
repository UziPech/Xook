import React from "react";
import { CalendarClock, Check, Pause, Play, Repeat, RotateCcw, StickyNote, Trash2 } from "lucide-react";
import { AgendaItem, formatCountdown, formatRelativeTarget } from "./taskSchema";

interface AgendaItemCardProps {
  item: AgendaItem;
  nowTick: number;
  onToggleTimer: (id: string) => void;
  onResetTimer: (id: string) => void;
  onCompleteAgendaItem: (item: AgendaItem) => void;
  onRemoveAgendaItem: (id: string) => void;
  onToggleAgendaChecklist: (agendaId: string, itemId: string) => void;
  onToggleAgendaAuto: (id: string) => void;
}

const ICON_BUTTON =
  "inline-flex items-center justify-center w-8 h-8 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer transition-colors";

/** Recordatorio, reloj o nota de la columna Pendientes: avisan, pero no los ejecuta Xox. */
export const AgendaItemCard: React.FC<AgendaItemCardProps> = ({
  item,
  nowTick,
  onToggleTimer,
  onResetTimer,
  onCompleteAgendaItem,
  onRemoveAgendaItem,
  onToggleAgendaChecklist,
  onToggleAgendaAuto,
}) => {
  if (item.kind === "timer") {
    const rem = item.remainingSeconds ?? item.durationSeconds ?? 0;
    const total = item.durationSeconds ?? 1;
    const progress = Math.min(100, Math.max(0, Math.round(((total - rem) / total) * 100)));
    const finished = rem === 0;

    return (
      <article className="rounded-2xl border border-white/[0.08] bg-zinc-900 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-300">
            {item.isRunning && (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-100 motion-safe:animate-pulse" aria-hidden="true" />
            )}
            {finished ? "Tiempo cumplido" : item.isRunning ? "Reloj en curso" : "Reloj listo"}
          </span>
          <span className="text-[10.5px] text-zinc-400">{item.createdAtLabel}</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-[13px] font-semibold text-white leading-snug">{item.title}</h4>
            {item.subtitle && <p className="text-[11px] text-zinc-400 mt-0.5">{item.subtitle}</p>}
          </div>
          <div
            className={`text-lg font-mono font-semibold tabular-nums shrink-0 ${
              finished || item.isRunning ? "text-white" : "text-zinc-300"
            }`}
          >
            {formatCountdown(rem)}
          </div>
        </div>

        <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-zinc-300 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {!finished ? (
            <button
              type="button"
              onClick={() => onToggleTimer(item.id)}
              className="xook-approve-btn flex-1 min-h-8 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {item.isRunning ? (
                <>
                  <Pause className="w-3 h-3" aria-hidden="true" />
                  <span>Pausar</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" aria-hidden="true" />
                  <span>{rem < total ? "Reanudar" : "Iniciar"}</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCompleteAgendaItem(item)}
              className="xook-approve-btn flex-1 min-h-8 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Marcar hecho</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onResetTimer(item.id)}
            title="Reiniciar reloj"
            aria-label="Reiniciar reloj"
            className={ICON_BUTTON}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onRemoveAgendaItem(item.id)}
            title="Quitar reloj"
            aria-label="Quitar reloj"
            className={ICON_BUTTON}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  }

  const rel = item.kind !== "note" ? formatRelativeTarget(item.nextRunAt, nowTick) : null;

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-zinc-900 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-300 shrink-0 pt-0.5">
          {item.kind === "note" ? (
            <StickyNote className="w-3 h-3" aria-hidden="true" />
          ) : (
            <CalendarClock className="w-3 h-3" aria-hidden="true" />
          )}
          <span>{item.kind === "note" ? "Nota" : "Recordatorio"}</span>
        </span>

        <div className="flex flex-wrap items-center justify-end gap-1 min-w-0">
          {item.recurrence && (
            <span className="text-[10.5px] text-zinc-300 px-1.5 py-0.5 rounded border border-white/[0.12]">
              {item.recurrence}
            </span>
          )}
          {rel && (
            <span
              className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded border tabular-nums ${
                rel.isDue
                  ? "bg-zinc-100 text-zinc-900 border-zinc-100"
                  : "text-zinc-300 border-white/[0.12]"
              }`}
            >
              {rel.label}
            </span>
          )}
          <span className="text-[10.5px] font-mono text-zinc-400 px-1.5 py-0.5 rounded border border-white/[0.08]">
            {item.timeLabel}
          </span>
        </div>
      </div>

      <div>
        <h4 className="text-[13px] font-semibold text-white leading-snug">{item.title}</h4>
        {item.subtitle && (
          <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{item.subtitle}</p>
        )}
        {item.noteContent && (
          <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">{item.noteContent}</p>
        )}
      </div>

      {item.checklist && item.checklist.length > 0 && (
        <div className="space-y-1 pt-0.5 border-t border-white/[0.06]">
          {item.checklist.map((chk) => (
            <button
              key={chk.id}
              type="button"
              onClick={() => onToggleAgendaChecklist(item.id, chk.id)}
              aria-pressed={chk.done}
              className="w-full min-h-8 flex items-start gap-2 py-1 px-1 rounded-lg hover:bg-zinc-800 text-left cursor-pointer"
            >
              <span
                className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                  chk.done ? "bg-zinc-100 border-zinc-100 text-zinc-900" : "border-white/25"
                }`}
              >
                {chk.done && <Check className="w-2.5 h-2.5" aria-hidden="true" />}
              </span>
              <span
                className={`text-[11px] leading-snug ${
                  chk.done ? "line-through text-zinc-400" : "text-zinc-200"
                }`}
              >
                {chk.label}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
        {item.kind !== "note" ? (
          <button
            type="button"
            onClick={() => onToggleAgendaAuto(item.id)}
            aria-pressed={Boolean(item.autoScheduled)}
            title="Repetir el recordatorio cuando venza"
            className={`inline-flex items-center gap-1 min-h-8 px-2.5 rounded-full text-[10.5px] border cursor-pointer transition-colors ${
              item.autoScheduled
                ? "bg-zinc-100 border-zinc-100 text-zinc-900"
                : "border-white/[0.1] text-zinc-300 hover:text-zinc-100"
            }`}
          >
            <Repeat className="w-2.5 h-2.5" aria-hidden="true" />
            <span>Repetir</span>
          </button>
        ) : (
          <div className="flex flex-wrap gap-1">
            {item.tags?.map((tag) => (
              <span key={tag} className="text-[10.5px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onCompleteAgendaItem(item)}
            className="min-h-8 px-2.5 rounded-xl text-[11px] font-medium text-zinc-100 border border-white/[0.15] hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            Completar
          </button>
          <button
            type="button"
            onClick={() => onRemoveAgendaItem(item.id)}
            title="Quitar"
            aria-label={`Quitar «${item.title}»`}
            className={ICON_BUTTON}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
