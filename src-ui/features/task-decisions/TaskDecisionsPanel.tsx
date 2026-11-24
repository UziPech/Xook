import React, { useCallback, useEffect, useState } from "react";
import type { ReviewRun } from "./ledgerApi";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Plus,
  Repeat,
  StickyNote,
  XCircle,
} from "lucide-react";
import { AgendaItem, TaskHistoryItem, TaskProposal } from "./taskSchema";
import { TaskCardRenderer } from "./TaskCardRenderer";
import { AgendaItemCard } from "./AgendaItemCard";
import { JellyPillTrack } from "../../components/JellyPillTrack";
import { EncargoCard } from "../encargos/EncargoCard";
import {
  listEncargos,
  removeEncargo,
  runEncargoNow,
  subscribeEncargos,
  type Encargo,
} from "../encargos/encargosApi";

export type TaskPanelTab = "pending" | "agenda" | "completed";

export interface ScheduledEventInput {
  title: string;
  dateIso: string;
  time24: string;
  recurrence?: string;
  autoScheduled: boolean;
  notes?: string;
}

interface TaskDecisionsPanelProps {
  width: number;
  tasks: TaskProposal[];
  agendaItems: AgendaItem[];
  historyItems: TaskHistoryItem[];
  maxBudgetLimit?: number;
  currency?: string;
  activeTab: TaskPanelTab;
  onTabChange: (tab: TaskPanelTab) => void;
  onUpdateParam: (cardId: string, key: string, value: number | string | boolean) => void;
  onToggleTaskChecklist: (cardId: string, itemId: string) => void;
  onApproveTask: (task: TaskProposal) => void;
  onDiscardTask: (task: TaskProposal) => void;
  onAskXox: (task: TaskProposal) => void;
  onToggleTimer: (id: string) => void;
  onResetTimer: (id: string) => void;
  onCompleteAgendaItem: (item: AgendaItem) => void;
  onRemoveAgendaItem: (id: string) => void;
  onToggleAgendaChecklist: (agendaId: string, itemId: string) => void;
  onToggleAgendaAuto: (id: string) => void;
  onCreateQuickTimer: (title: string, minutes: number) => void;
  onCreateQuickNote: (title: string, content: string) => void;
  onCreateScheduledEvent: (input: ScheduledEventInput) => void;
  onTriggerXoxReconstruct: () => void;
  inventoryCount?: number;
  latestReview?: ReviewRun | null;
  isReviewRunning?: boolean;
  onRunBusinessReview?: () => void;
  onImportInventoryFile?: (filename: string, content: string) => Promise<void> | void;
}

function localDateInputValue(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultTimeInputValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const SECTION_TITLE = "text-[11px] font-medium text-zinc-400";
const CHIP_ON = "bg-zinc-100 border-zinc-100 text-zinc-900";
const CHIP_OFF = "border-white/[0.1] text-zinc-300 hover:text-zinc-100";

// Primero lo que pide atención, luego lo que corre y después por hora.
const ENCARGO_ORDER: Record<string, number> = { perdido: 0, detenido: 0, en_curso: 1, programado: 2 };

/**
 * Columna Pendientes: lo que espera tu OK, lo que viene (pendientes que Xox hará solo y
 * recordatorios) y, plegado, lo hecho. Diseño: claude/diseno-encargos.md.
 */
export const TaskDecisionsPanel: React.FC<TaskDecisionsPanelProps> = ({
  width,
  tasks,
  agendaItems,
  historyItems,
  maxBudgetLimit = 25000,
  onUpdateParam,
  onToggleTaskChecklist,
  onApproveTask,
  onDiscardTask,
  onAskXox,
  onToggleTimer,
  onResetTimer,
  onCompleteAgendaItem,
  onRemoveAgendaItem,
  onToggleAgendaChecklist,
  onToggleAgendaAuto,
  onCreateQuickTimer,
  onCreateQuickNote,
  onCreateScheduledEvent,
}) => {
  const [showQuickCreator, setShowQuickCreator] = useState<boolean>(false);
  const [creatorKind, setCreatorKind] = useState<"schedule" | "timer" | "note">("schedule");
  const [quickTitle, setQuickTitle] = useState<string>("");
  const [quickMinutes, setQuickMinutes] = useState<number>(15);
  const [quickNoteBody, setQuickNoteBody] = useState<string>("");
  const [schedDate, setSchedDate] = useState<string>(() => localDateInputValue(0));
  const [schedTime, setSchedTime] = useState<string>(() => defaultTimeInputValue());
  const [schedRecurrence, setSchedRecurrence] = useState<string>("Una vez");
  const [schedAuto, setSchedAuto] = useState<boolean>(false);
  const [schedNotes, setSchedNotes] = useState<string>("");
  const [encargos, setEncargos] = useState<Encargo[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const refreshEncargos = useCallback(() => {
    listEncargos()
      .then(setEncargos)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshEncargos();
    return subscribeEncargos(refreshEncargos);
  }, [refreshEncargos]);

  const hasTimedItems =
    encargos.length > 0 ||
    agendaItems.some((item) => item.kind !== "note" && item.kind !== "timer" && Boolean(item.nextRunAt));
  useEffect(() => {
    if (!hasTimedItems) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [hasTimedItems]);

  const effectiveBudgetLimit = maxBudgetLimit > 0 ? maxBudgetLimit : 25000;
  const upcoming = encargos
    .filter((e) => e.status !== "hecho")
    .sort(
      (a, b) =>
        (ENCARGO_ORDER[a.status] ?? 3) - (ENCARGO_ORDER[b.status] ?? 3) ||
        (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? "")
    );
  const doneEncargos = encargos.filter((e) => e.status === "hecho");
  const doneCount = doneEncargos.length + historyItems.length;
  const now = new Date(nowTick);

  const handleRunNow = (encargo: Encargo) => {
    void runEncargoNow(encargo.id).then(refreshEncargos);
  };
  const handleRemove = (encargo: Encargo) => {
    void removeEncargo(encargo.id).then(refreshEncargos);
  };

  const openCreatorWithMode = (mode: "schedule" | "timer" | "note") => {
    setCreatorKind(mode);
    if (mode === "schedule") {
      setSchedDate(localDateInputValue(0));
      setSchedTime(defaultTimeInputValue());
    }
    setShowQuickCreator(true);
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (creatorKind === "schedule") {
      const label = quickTitle.trim() || "Recordatorio";
      onCreateScheduledEvent({
        title: label,
        dateIso: schedDate || localDateInputValue(0),
        time24: schedTime || defaultTimeInputValue(),
        recurrence: schedRecurrence !== "Una vez" ? schedRecurrence : undefined,
        autoScheduled: schedAuto,
        notes: schedNotes.trim() || undefined,
      });
      setQuickTitle("");
      setSchedNotes("");
      setSchedAuto(false);
      setSchedRecurrence("Una vez");
      setShowQuickCreator(false);
      return;
    }

    if (creatorKind === "timer") {
      const safeMins = Math.max(1, Math.min(1440, Number(quickMinutes) || 15));
      const label = quickTitle.trim() || `Reloj de ${safeMins} min`;
      onCreateQuickTimer(label, safeMins);
      setQuickTitle("");
      setShowQuickCreator(false);
      return;
    }

    const body = quickNoteBody.trim();
    const title = quickTitle.trim() || (body ? body.slice(0, 36) : "Nota rápida");
    if (!body && !quickTitle.trim()) return;
    onCreateQuickNote(title, body || title);
    setQuickTitle("");
    setQuickNoteBody("");
    setShowQuickCreator(false);
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className="h-full bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
    >
      <div className="px-3.5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#0a0b10]">
        <h3 className="text-[13px] font-semibold text-zinc-100">Pendientes</h3>
        <button
          type="button"
          onClick={() => (showQuickCreator ? setShowQuickCreator(false) : openCreatorWithMode(creatorKind))}
          aria-expanded={showQuickCreator}
          title="Agregar un recordatorio, un reloj o una nota"
          className={`min-h-8 px-2.5 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
            showQuickCreator
              ? "bg-zinc-100 border-zinc-100 text-zinc-900"
              : "bg-zinc-900 border-white/[0.08] text-zinc-200 hover:text-white hover:bg-zinc-800"
          }`}
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          <span>Agregar</span>
        </button>
      </div>

      {showQuickCreator && (
        <form
          onSubmit={handleQuickSubmit}
          className="panel-fade-in p-3 border-b border-white/[0.06] bg-zinc-950 space-y-2.5"
        >
          <JellyPillTrack
            activeKey={creatorKind}
            role="group"
            aria-label="Qué agregar"
            pillRadius="9999px"
            className="grid grid-cols-3 gap-1 p-1 rounded-full"
          >
            {(
              [
                ["schedule", "Recordatorio", CalendarClock],
                ["timer", "Reloj", Clock],
                ["note", "Nota", StickyNote],
              ] as const
            ).map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={creatorKind === kind}
                onClick={() => setCreatorKind(kind)}
                className={`xook-jelly-tab min-h-8 rounded-full text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
                  creatorKind === kind ? "text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </JellyPillTrack>

          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            aria-label="Título"
            placeholder={
              creatorKind === "schedule"
                ? "Ej. Llamar al proveedor"
                : creatorKind === "timer"
                ? "Ej. Confirmar entrega en 15 min"
                : "Título de la nota"
            }
            className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-white/25 select-text"
          />

          {creatorKind === "schedule" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                {[
                  ["Hoy", 0],
                  ["Mañana", 1],
                ].map(([label, offset]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSchedDate(localDateInputValue(Number(offset)))}
                    className={`min-h-8 px-2.5 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                      schedDate === localDateInputValue(Number(offset)) ? CHIP_ON : CHIP_OFF
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  aria-label="Fecha"
                  className="flex-1 min-w-0 min-h-8 px-2 rounded-lg bg-black border border-white/[0.08] text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-white/25"
                />
                <input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  aria-label="Hora"
                  className="w-[82px] min-h-8 px-2 rounded-lg bg-black border border-white/[0.08] text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {["Una vez", "Diario", "Semanal", "Mensual"].map((rep) => (
                    <button
                      key={rep}
                      type="button"
                      onClick={() => setSchedRecurrence(rep)}
                      aria-pressed={schedRecurrence === rep}
                      className={`min-h-8 px-2.5 rounded-full text-[11px] border transition-colors cursor-pointer ${
                        schedRecurrence === rep ? CHIP_ON : CHIP_OFF
                      }`}
                    >
                      {rep}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSchedAuto((v) => !v)}
                  aria-pressed={schedAuto}
                  title="Repetir el recordatorio cuando venza"
                  className={`inline-flex items-center gap-1 min-h-8 px-2.5 rounded-full text-[11px] border transition-colors cursor-pointer shrink-0 ${
                    schedAuto ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  <Repeat className="w-2.5 h-2.5" aria-hidden="true" />
                  <span>Repetir</span>
                </button>
              </div>

              <input
                type="text"
                value={schedNotes}
                onChange={(e) => setSchedNotes(e.target.value)}
                aria-label="Detalle"
                placeholder="Detalle opcional"
                className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/[0.08] text-[11px] text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-white/25 select-text"
              />
            </div>
          ) : creatorKind === "timer" ? (
            <div className="flex items-center justify-between gap-1.5">
              {[5, 15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setQuickMinutes(m)}
                  aria-pressed={quickMinutes === m}
                  className={`flex-1 min-h-8 rounded-lg text-[11px] font-mono border transition-colors cursor-pointer ${
                    quickMinutes === m ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  {m} min
                </button>
              ))}
              <label className="flex items-center gap-1 min-h-8 px-2 rounded-lg bg-black border border-white/[0.08] text-[11px] text-zinc-400">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={quickMinutes}
                  aria-label="Minutos"
                  onChange={(e) =>
                    setQuickMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))
                  }
                  className="w-10 bg-transparent text-zinc-100 font-mono text-center focus:outline-none"
                />
                <span>min</span>
              </label>
            </div>
          ) : (
            <textarea
              rows={2}
              value={quickNoteBody}
              onChange={(e) => setQuickNoteBody(e.target.value)}
              aria-label="Nota"
              placeholder="Escribe la nota"
              className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-white/25 resize-none select-text"
            />
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              className="xook-approve-btn flex-1 min-h-8 px-3 rounded-lg text-[11px] font-semibold cursor-pointer"
            >
              {creatorKind === "schedule"
                ? "Guardar recordatorio"
                : creatorKind === "timer"
                ? `Iniciar reloj de ${quickMinutes} min`
                : "Guardar nota"}
            </button>
            <button
              type="button"
              onClick={() => setShowQuickCreator(false)}
              className="min-h-8 px-3 rounded-lg text-[11px] text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-white/[0.08] cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 p-3 overflow-y-auto space-y-4">
        {tasks.length > 0 && (
          <section aria-labelledby="pendientes-ok" className="space-y-2.5">
            <h4 id="pendientes-ok" className={SECTION_TITLE}>
              Esperan tu OK · {tasks.length}
            </h4>
            {tasks.map((task) => (
              <TaskCardRenderer
                key={task.cardId}
                task={task}
                workspaceBudgetLimit={effectiveBudgetLimit}
                onUpdateParam={onUpdateParam}
                onToggleChecklist={onToggleTaskChecklist}
                onApprove={onApproveTask}
                onDiscard={onDiscardTask}
                onAskXox={onAskXox}
              />
            ))}
          </section>
        )}

        <section aria-labelledby="pendientes-proximos" className="space-y-2.5">
          <h4 id="pendientes-proximos" className={SECTION_TITLE}>
            Próximos
          </h4>
          {upcoming.length === 0 && agendaItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.12] p-4 text-center space-y-2">
              <CalendarClock className="w-7 h-7 text-zinc-500 mx-auto" aria-hidden="true" />
              <p className="text-xs text-zinc-100 font-medium">Nada programado</p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Para que Xox haga algo por ti a una hora, díselo en el chat: «entrega el PDF a las 4 en
                Teams». Para que solo te avise, usa Agregar.
              </p>
            </div>
          ) : (
            <>
              {upcoming.map((encargo) => (
                <EncargoCard
                  key={encargo.id}
                  encargo={encargo}
                  now={now}
                  onRunNow={handleRunNow}
                  onRemove={handleRemove}
                />
              ))}
              {agendaItems.map((item) => (
                <AgendaItemCard
                  key={item.id}
                  item={item}
                  nowTick={nowTick}
                  onToggleTimer={onToggleTimer}
                  onResetTimer={onResetTimer}
                  onCompleteAgendaItem={onCompleteAgendaItem}
                  onRemoveAgendaItem={onRemoveAgendaItem}
                  onToggleAgendaChecklist={onToggleAgendaChecklist}
                  onToggleAgendaAuto={onToggleAgendaAuto}
                />
              ))}
            </>
          )}
        </section>

        {doneCount > 0 && (
          <section className="space-y-2.5">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="w-full min-h-8 flex items-center justify-between rounded-lg px-1 hover:bg-zinc-900 cursor-pointer"
            >
              <span className={SECTION_TITLE}>Hechos · {doneCount}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${showDone ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {showDone && (
              <>
                {doneEncargos.map((encargo) => (
                  <EncargoCard
                    key={encargo.id}
                    encargo={encargo}
                    now={now}
                    onRunNow={handleRunNow}
                    onRemove={handleRemove}
                  />
                ))}
                {historyItems.slice(0, 30).map((entry) => {
                  const isRejected = entry.decision === "rejected";
                  const badgeLabel = isRejected
                    ? "Descartada"
                    : entry.decision === "adjusted"
                    ? "Ajustada y aprobada"
                    : entry.decision === "completed"
                    ? "Completada"
                    : "Aprobada";
                  return (
                    <article
                      key={entry.id}
                      className="rounded-2xl border border-white/[0.06] bg-zinc-950 p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-300">
                          {isRejected ? (
                            <XCircle className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" aria-hidden="true" />
                          )}
                          {badgeLabel}
                        </span>
                        <span className="text-[10.5px] text-zinc-400">{entry.timestampLabel}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="text-xs font-semibold text-zinc-100">{entry.title}</h4>
                        {entry.amountLabel && (
                          <span className="text-[11px] font-mono text-zinc-200 shrink-0">
                            {entry.amountLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">{entry.summary}</p>
                    </article>
                  );
                })}
              </>
            )}
          </section>
        )}
      </div>
    </aside>
  );
};
