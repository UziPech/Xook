import React, { useEffect, useState } from "react";
import { RefreshCw as ReviewRefreshIcon, Upload as ImportFileIcon } from "lucide-react";
import type { ReviewRun } from "./ledgerApi";
import {
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  ListTodo,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  AgendaItem,
  TaskHistoryItem,
  TaskProposal,
  computeVerifiedDecision,
  formatCountdown,
  formatRelativeTarget,
} from "./taskSchema";
import { TaskCardRenderer } from "./TaskCardRenderer";

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

function formatCompactLimit(limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return "$0";
  if (limit >= 1000 && limit % 1000 === 0) {
    return `$${limit / 1000}k`;
  }
  return `$${limit.toLocaleString()}`;
}

export const TaskDecisionsPanel: React.FC<TaskDecisionsPanelProps> = ({
  width,
  tasks,
  agendaItems,
  historyItems,
  maxBudgetLimit = 25000,
  currency = "MXN",
  activeTab,
  onTabChange,
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
  onTriggerXoxReconstruct,
  inventoryCount = 0,
  latestReview = null,
  isReviewRunning = false,
  onRunBusinessReview,
  onImportInventoryFile,
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
  const importFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleInventoryFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onImportInventoryFile) return;
    const text = await file.text();
    await onImportInventoryFile(file.name, text);
  };

  const openCreatorWithMode = (mode: "schedule" | "timer" | "note") => {
    setCreatorKind(mode);
    if (mode === "schedule") {
      setSchedDate(localDateInputValue(0));
      setSchedTime(defaultTimeInputValue());
    }
    setShowQuickCreator(true);
  };

  const runningTimer = agendaItems.find(
    (item) => item.kind === "timer" && item.isRunning
  );
  const hasRunningTimer = Boolean(runningTimer);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const hasScheduledTargets = agendaItems.some(
    (item) => item.kind !== "note" && item.kind !== "timer" && Boolean(item.nextRunAt)
  );
  useEffect(() => {
    if (!hasScheduledTargets) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [hasScheduledTargets]);

  // Suma determinística de montos verificados en cola HITL
  const effectiveBudgetLimit = maxBudgetLimit > 0 ? maxBudgetLimit : 25000;
  const pendingFinancialTotal = tasks.reduce((sum, task) => {
    const { verifiedCost } = computeVerifiedDecision(task, effectiveBudgetLimit);
    return sum + (verifiedCost ?? 0);
  }, 0);
  const financialTaskCount = tasks.filter(
    (t) => computeVerifiedDecision(t, effectiveBudgetLimit).verifiedCost !== null
  ).length;
  const budgetRatio = Math.min(100, Math.round((pendingFinancialTotal / effectiveBudgetLimit) * 100));

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (creatorKind === "schedule") {
      const label = quickTitle.trim() || "Recordatorio agendado";
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
      onTabChange("agenda");
      return;
    }

    if (creatorKind === "timer") {
      const safeMins = Math.max(1, Math.min(1440, Number(quickMinutes) || 15));
      const label = quickTitle.trim() || `Reloj de ${safeMins} min`;
      onCreateQuickTimer(label, safeMins);
      setQuickTitle("");
      setShowQuickCreator(false);
      onTabChange("agenda");
      return;
    }

    const body = quickNoteBody.trim();
    const title = quickTitle.trim() || (body ? body.slice(0, 36) : "Nota rápida");
    if (!body && !quickTitle.trim()) return;
    onCreateQuickNote(title, body || title);
    setQuickTitle("");
    setQuickNoteBody("");
    setShowQuickCreator(false);
    onTabChange("agenda");
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className="@container h-full bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
    >
      {/* Cabecera del Panel */}
      <div className="px-3.5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#0a0b10]">
        <div className="flex items-center gap-2 min-w-0">
          <ListTodo className="w-4 h-4 text-zinc-400 shrink-0" />
          <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-zinc-200 truncate">
            Tareas & Decisiones
          </h3>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {tasks.length >= 2 && (
            <button
              type="button"
              onClick={onTriggerXoxReconstruct}
              aria-label="Pedir a Xox reconstruir y agrupar órdenes"
              title="Pedir a Xox reconstruir y agrupar órdenes"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.07] transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (showQuickCreator) {
                setShowQuickCreator(false);
              } else {
                openCreatorWithMode(activeTab === "agenda" ? "schedule" : creatorKind);
              }
            }}
            aria-expanded={showQuickCreator}
            title="Agendar evento, iniciar reloj o fijar nota"
            className={`px-2 py-1 rounded-lg border text-[10.5px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
              showQuickCreator
                ? "bg-white/[0.12] border-white/25 text-white"
                : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.08]"
            }`}
          >
            <Plus className="w-3 h-3" />
            <span className="hidden @[290px]:inline">Agendar</span>
          </button>
          <span
            title="Modo Seguro HITL · Zero-Trust: ninguna mutación se ejecuta sin tu aprobación"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.1] text-[10px] font-mono text-zinc-300"
          >
            <ShieldCheck className="w-3 h-3 text-zinc-400" />
            <span>HITL</span>
          </span>
        </div>
      </div>

      {/* Creador rápido: Agendar · Reloj · Nota */}
      {showQuickCreator && (
        <form
          onSubmit={handleQuickSubmit}
          className="panel-fade-in p-3 border-b border-white/[0.06] bg-white/[0.02] space-y-2.5"
        >
          <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setCreatorKind("schedule")}
              className={`py-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                creatorKind === "schedule"
                  ? "bg-white/[0.1] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <CalendarClock className="w-3 h-3 text-zinc-300" />
              <span>Agendar</span>
            </button>
            <button
              type="button"
              onClick={() => setCreatorKind("timer")}
              className={`py-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                creatorKind === "timer"
                  ? "bg-white/[0.1] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Clock className="w-3 h-3 text-zinc-300" />
              <span>Reloj</span>
            </button>
            <button
              type="button"
              onClick={() => setCreatorKind("note")}
              className={`py-1 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                creatorKind === "note"
                  ? "bg-white/[0.1] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <StickyNote className="w-3 h-3 text-zinc-300" />
              <span>Nota</span>
            </button>
          </div>

          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder={
              creatorKind === "schedule"
                ? "Ej. Llamar al proveedor o corte de caja"
                : creatorKind === "timer"
                ? "Ej. Confirmar entrega en 15 min"
                : "Título de la nota o pendiente..."
            }
            className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 select-text"
          />

          {creatorKind === "schedule" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSchedDate(localDateInputValue(0))}
                  className={`px-2 py-1 rounded-lg text-[10.5px] border transition-colors cursor-pointer ${
                    schedDate === localDateInputValue(0)
                      ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                      : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setSchedDate(localDateInputValue(1))}
                  className={`px-2 py-1 rounded-lg text-[10.5px] border transition-colors cursor-pointer ${
                    schedDate === localDateInputValue(1)
                      ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                      : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Mañana
                </button>
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-black/50 border border-white/[0.08] text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-white/25"
                />
                <input
                  type="time"
                  value={schedTime}
                  onChange={(e) => setSchedTime(e.target.value)}
                  className="w-[82px] px-2 py-1 rounded-lg bg-black/50 border border-white/[0.08] text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {["Una vez", "Diario", "Semanal", "Mensual"].map((rep) => (
                    <button
                      key={rep}
                      type="button"
                      onClick={() => setSchedRecurrence(rep)}
                      className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors cursor-pointer ${
                        schedRecurrence === rep
                          ? "bg-white/[0.1] border-white/25 text-white"
                          : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {rep}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setSchedAuto((v) => !v)}
                  title="Auto-agendar recordatorios recurrentes con Xox"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors cursor-pointer shrink-0 ${
                    schedAuto
                      ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                      : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Repeat className="w-2.5 h-2.5" />
                  <span>Auto</span>
                </button>
              </div>

              <input
                type="text"
                value={schedNotes}
                onChange={(e) => setSchedNotes(e.target.value)}
                placeholder="Detalle opcional (ej. proveedor, monto o nota)..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/[0.08] text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 select-text"
              />
            </div>
          ) : creatorKind === "timer" ? (
            <div className="flex items-center justify-between gap-1.5">
              {[5, 15, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setQuickMinutes(m)}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-mono border transition-colors cursor-pointer ${
                    quickMinutes === m
                      ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                      : "bg-white/[0.02] border-white/[0.06] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {m}m
                </button>
              ))}
              <label className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/50 border border-white/[0.08] text-[11px] text-zinc-400">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={quickMinutes}
                  onChange={(e) =>
                    setQuickMinutes(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))
                  }
                  className="w-10 bg-transparent text-zinc-100 font-mono text-center focus:outline-none"
                />
                <span>m</span>
              </label>
            </div>
          ) : (
            <textarea
              rows={2}
              value={quickNoteBody}
              onChange={(e) => setQuickNoteBody(e.target.value)}
              placeholder="Escribe el detalle o pendiente..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 resize-none select-text"
            />
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              className="xook-approve-btn flex-1 py-1.5 px-3 rounded-lg text-[11px] font-semibold cursor-pointer"
            >
              {creatorKind === "schedule"
                ? "Guardar en Agenda"
                : creatorKind === "timer"
                ? `Iniciar reloj (${quickMinutes}m)`
                : "Guardar nota"}
            </button>
            <button
              type="button"
              onClick={() => setShowQuickCreator(false)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 bg-white/[0.03] border border-white/[0.06] cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Selector de Pestañas: Por aceptar · Agenda · Hechas */}
      <div className="p-2 border-b border-white/[0.06] bg-black/40 grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => onTabChange("pending")}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === "pending"
              ? "bg-white/[0.1] text-white shadow-sm border border-white/15"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
          }`}
        >
          <Clock className="w-3 h-3 hidden @[315px]:inline shrink-0" />
          <span className="truncate">Por aceptar</span>
          <span className="text-[10px] font-mono tabular-nums px-1.5 rounded-full bg-white/[0.08] text-zinc-200">
            {tasks.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("agenda")}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === "agenda"
              ? "bg-white/[0.1] text-white shadow-sm border border-white/15"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
          }`}
        >
          <CalendarClock className="w-3 h-3 text-zinc-400 hidden @[315px]:inline shrink-0" />
          <span className="truncate">Agenda</span>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono tabular-nums px-1.5 rounded-full bg-white/[0.08] text-zinc-200">
            {hasRunningTimer && (
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-200 animate-pulse" />
            )}
            {agendaItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange("completed")}
          className={`py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
            activeTab === "completed"
              ? "bg-white/[0.1] text-white shadow-sm border border-white/15"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
          }`}
        >
          <CheckCheck className="w-3 h-3 text-zinc-400 hidden @[315px]:inline shrink-0" />
          <span className="truncate">Hechas</span>
          <span className="text-[10px] font-mono tabular-nums px-1.5 rounded-full bg-white/[0.08] text-zinc-200">
            {historyItems.length}
          </span>
        </button>
      </div>

      {/* Cinta discreta cuando hay un reloj corriendo mientras ves otra pestaña */}
      {runningTimer && activeTab !== "agenda" && (
        <div className="px-3 py-1.5 border-b border-white/[0.08] bg-white/[0.03] flex items-center justify-between gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => onTabChange("agenda")}
            className="flex items-center gap-1.5 min-w-0 text-zinc-200 hover:text-white cursor-pointer"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-200 animate-pulse shrink-0" />
            <span className="truncate">{runningTimer.title}</span>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="font-mono font-semibold tabular-nums text-white">
              {formatCountdown(runningTimer.remainingSeconds ?? 0)}
            </span>
            <button
              type="button"
              onClick={() => onToggleTimer(runningTimer.id)}
              aria-label="Pausar reloj"
              className="p-1 rounded-md hover:bg-white/10 text-zinc-200 cursor-pointer"
            >
              <Pause className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Barra discreta de revisión real e importación de inventario */}
      {(onRunBusinessReview || onImportInventoryFile) && (
        <div className="px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.015] flex items-center justify-between gap-2 text-[10.5px]">
          <div className="min-w-0 text-zinc-400 truncate">
            {latestReview?.finishedAt ? (
              <span>
                Revisión:{" "}
                {new Date(latestReview.finishedAt).toLocaleTimeString("es-MX", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {inventoryCount > 0 ? ` · ${inventoryCount} SKUs` : ""}
              </span>
            ) : inventoryCount > 0 ? (
              <span>{inventoryCount} productos cargados · Sin revisar</span>
            ) : (
              <span>Importa CSV/JSON o revisa datos/</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onImportInventoryFile && (
              <>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".csv,.tsv,.json,text/csv,application/json"
                  onChange={(e) => void handleInventoryFileSelected(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => importFileInputRef.current?.click()}
                  title="Importar archivo CSV o JSON de inventario en datos/"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-zinc-200 transition-colors cursor-pointer"
                >
                  <ImportFileIcon className="w-3 h-3 text-zinc-300" />
                  <span>Importar</span>
                </button>
              </>
            )}
            {onRunBusinessReview && (
              <button
                type="button"
                disabled={isReviewRunning}
                onClick={() => onRunBusinessReview()}
                title="Ejecutar revisión real sobre datos/, empresa/ y memoria/"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] text-zinc-100 disabled:opacity-45 transition-colors cursor-pointer"
              >
                <ReviewRefreshIcon
                  className={`w-3 h-3 ${isReviewRunning ? "animate-spin" : ""}`}
                />
                <span>{isReviewRunning ? "Revisando..." : "Revisar"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Contenido Scrollable */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
        {activeTab === "pending" && (
          tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2.5">
              <CheckCircle2 className="w-8 h-8 text-zinc-500 mb-1" />
              <p className="text-xs text-zinc-200 font-medium">Sin revisiones pendientes</p>
              <p className="text-[11px] text-zinc-500 max-w-xs leading-relaxed">
                Aquí aparecerán solo propuestas reales cuando subas datos en tu espacio de trabajo, pidas análisis a Xox o crees notas y relojes.
              </p>
            </div>
          ) : (
            tasks.map((task) => (
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
            ))
          )
        )}

        {activeTab === "agenda" && (
          agendaItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-5 text-zinc-500 space-y-3">
              <CalendarClock className="w-8 h-8 text-zinc-500 mb-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-zinc-200 font-medium">Agenda despejada</p>
                <p className="text-[11px] text-zinc-500 max-w-[230px] leading-relaxed">
                  Programa citas o recordatorios, inicia un reloj rápido o fija una nota aquí mismo.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => openCreatorWithMode("schedule")}
                  className="xook-approve-btn px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <CalendarClock className="w-3 h-3" />
                  <span>Agendar evento</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreatorWithMode("timer")}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Clock className="w-3 h-3 text-zinc-300" />
                  <span>Reloj</span>
                </button>
                <button
                  type="button"
                  onClick={() => openCreatorWithMode("note")}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <StickyNote className="w-3 h-3 text-zinc-300" />
                  <span>Nota</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {!showQuickCreator && (
                <div className="flex items-center gap-1.5 pb-1">
                  <button
                    type="button"
                    onClick={() => openCreatorWithMode("schedule")}
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] text-[11px] font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3 h-3 text-zinc-300" />
                    <span>Agendar evento</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreatorWithMode("timer")}
                    className="py-1.5 px-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] text-[11px] text-zinc-300 inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Clock className="w-3 h-3 text-zinc-300" />
                    <span>Reloj</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreatorWithMode("note")}
                    className="py-1.5 px-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] text-[11px] text-zinc-300 inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <StickyNote className="w-3 h-3 text-zinc-300" />
                    <span>Nota</span>
                  </button>
                </div>
              )}
              {agendaItems.map((item) => {
              if (item.kind === "timer") {
                const rem = item.remainingSeconds ?? item.durationSeconds ?? 0;
                const total = item.durationSeconds ?? 1;
                const progress = Math.min(100, Math.max(0, Math.round(((total - rem) / total) * 100)));
                const finished = rem === 0;

                return (
                  <div
                    key={item.id}
                    className={`xook-task-card ${
                      finished ? "xook-task-card--alta" : "xook-task-card--info"
                    } rounded-2xl p-3.5 space-y-2.5`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.isRunning
                              ? "bg-sky-400 animate-pulse"
                              : finished
                              ? "bg-rose-400 animate-ping"
                              : "bg-zinc-500"
                          }`}
                        />
                        {finished ? "Tiempo cumplido" : item.isRunning ? "En curso" : "Reloj listo"}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {item.createdAtLabel}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-[13px] font-semibold text-white truncate">
                          {item.title}
                        </h4>
                        {item.subtitle && (
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                      <div
                        className={`text-lg font-mono font-semibold tabular-nums shrink-0 ${
                          finished
                            ? "text-rose-300"
                            : item.isRunning
                            ? "text-sky-200"
                            : "text-zinc-200"
                        }`}
                      >
                        {formatCountdown(rem)}
                      </div>
                    </div>

                    <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-zinc-300 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <div className="flex items-center gap-1.5 pt-0.5">
                      {!finished ? (
                        <button
                          type="button"
                          onClick={() => onToggleTimer(item.id)}
                          className="xook-approve-btn flex-1 py-1.5 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {item.isRunning ? (
                            <>
                              <Pause className="w-3 h-3" />
                              <span>Pausar</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3" />
                              <span>{rem < total ? "Reanudar" : "Iniciar"}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onCompleteAgendaItem(item)}
                          className="xook-approve-btn flex-1 py-1.5 px-3 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Marcar hecho</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onResetTimer(item.id)}
                        title="Reiniciar reloj"
                        aria-label="Reiniciar reloj"
                        className="p-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveAgendaItem(item.id)}
                        title="Eliminar reloj"
                        aria-label="Eliminar reloj"
                        className="p-1.5 rounded-xl bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.06] text-zinc-500 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className="xook-task-card xook-task-card--info rounded-2xl p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 shrink-0 pt-0.5">
                      {item.kind === "note" ? (
                        <StickyNote className="w-3 h-3 text-violet-300" />
                      ) : (
                        <CalendarClock className="w-3 h-3 text-sky-300" />
                      )}
                      <span>{item.kind === "note" ? "Nota fijada" : "Programada"}</span>
                    </span>

                    <div className="flex flex-wrap items-center justify-end gap-1 min-w-0">
                      {item.recurrence && (
                        <span className="text-[9.5px] font-medium text-sky-200 px-1.5 py-0.5 rounded bg-sky-400/10 border border-sky-300/20">
                          {item.recurrence}
                        </span>
                      )}
                      {(() => {
                        const rel =
                          item.kind !== "note"
                            ? formatRelativeTarget(item.nextRunAt, nowTick)
                            : null;
                        if (!rel) return null;
                        return (
                          <span
                            className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded border tabular-nums ${
                              rel.isDue
                                ? "text-amber-200 bg-amber-400/15 border-amber-300/30"
                                : "text-sky-200 bg-sky-400/10 border-sky-300/25"
                            }`}
                          >
                            {rel.label}
                          </span>
                        );
                      })()}
                      <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                        {item.timeLabel}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[13px] font-semibold text-white leading-snug">
                      {item.title}
                    </h4>
                    {item.subtitle && (
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                        {item.subtitle}
                      </p>
                    )}
                    {item.noteContent && (
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        {item.noteContent}
                      </p>
                    )}
                  </div>

                  {item.checklist && item.checklist.length > 0 && (
                    <div className="space-y-1 pt-0.5 border-t border-white/[0.05]">
                      {item.checklist.map((chk) => (
                        <button
                          key={chk.id}
                          type="button"
                          onClick={() => onToggleAgendaChecklist(item.id, chk.id)}
                          className="w-full flex items-start gap-2 py-1 px-1 rounded-lg hover:bg-white/[0.04] text-left cursor-pointer"
                        >
                          <span
                            className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                              chk.done
                                ? "bg-emerald-400/20 border-emerald-400/50 text-emerald-300"
                                : "border-white/20 bg-white/[0.02]"
                            }`}
                          >
                            {chk.done && <Check className="w-2.5 h-2.5" />}
                          </span>
                          <span
                            className={`text-[11px] leading-snug ${
                              chk.done ? "line-through text-zinc-500" : "text-zinc-200"
                            }`}
                          >
                            {chk.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.05]">
                    {item.kind !== "note" ? (
                      <button
                        type="button"
                        onClick={() => onToggleAgendaAuto(item.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] border cursor-pointer transition-colors ${
                          item.autoScheduled
                            ? "bg-sky-400/15 border-sky-300/35 text-sky-200"
                            : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <Repeat className="w-2.5 h-2.5" />
                        <span>{item.autoScheduled ? "Auto-agenda ON" : "Auto-agendar"}</span>
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {item.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onCompleteAgendaItem(item)}
                        className="px-2 py-1 rounded-lg text-[10.5px] font-medium text-emerald-300 hover:bg-emerald-500/10 border border-emerald-400/20 cursor-pointer"
                      >
                        Completar
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAgendaItem(item.id)}
                        aria-label="Eliminar elemento"
                        className="p-1 rounded-lg text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            </>
          )
        )}

        {activeTab === "completed" && (
          historyItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
              <Clock className="w-8 h-8 text-zinc-600 mb-1" />
              <p className="text-xs text-zinc-300 font-medium">Sin historial aún</p>
              <p className="text-[11px] text-zinc-500 max-w-xs">
                Las decisiones firmadas, ajustadas o descartadas aparecerán aquí auditadas.
              </p>
            </div>
          ) : (
            historyItems.map((entry) => {
              const isRejected = entry.decision === "rejected";
              const isAdjusted = entry.decision === "adjusted";
              const badgeLabel =
                entry.decision === "rejected"
                  ? "Descartada"
                  : isAdjusted
                  ? "Ajustada y firmada"
                  : entry.decision === "completed"
                  ? "Completada"
                  : "Autorizada y firmada";

              return (
                <div
                  key={entry.id}
                  className={`xook-task-card ${
                    isRejected ? "opacity-75" : "xook-task-card--approved"
                  } rounded-2xl p-3 space-y-1.5`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`flex items-center gap-1.5 text-[10.5px] font-medium ${
                        isRejected ? "text-zinc-400" : "text-emerald-300"
                      }`}
                    >
                      {isRejected ? (
                        <XCircle className="w-3.5 h-3.5 text-zinc-500" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      <span>{badgeLabel}</span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {entry.timestampLabel}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-xs font-semibold text-zinc-100 truncate">
                      {entry.title}
                    </h4>
                    {entry.amountLabel && (
                      <span className="text-[11px] font-mono font-semibold text-zinc-200 shrink-0">
                        {entry.amountLabel}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 truncate">{entry.summary}</p>
                </div>
              );
            })
          )
        )}
      </div>

      {/* Pie útil del Panel: Resumen operativo y límite HITL */}
      <div className="px-3.5 py-2.5 border-t border-white/[0.06] bg-[#0a0b10] space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-400">
            {financialTaskCount > 0 ? (
              <>
                <span className="text-zinc-200 font-medium">{financialTaskCount}</span>{" "}
                {financialTaskCount === 1 ? "orden" : "órdenes"} ·{" "}
                <span className="font-mono font-semibold text-white">
                  ${pendingFinancialTotal.toLocaleString()} {currency}
                </span>
              </>
            ) : (
              <span>{tasks.length} propuestas · {agendaItems.length} en agenda</span>
            )}
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {budgetRatio}% de {formatCompactLimit(effectiveBudgetLimit)}
          </span>
        </div>
        <div className="h-1 w-full rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="h-full rounded-full bg-zinc-300/75 transition-all duration-300"
            style={{ width: `${Math.max(budgetRatio, financialTaskCount > 0 ? 4 : 0)}%` }}
          />
        </div>
      </div>
    </aside>
  );
};

