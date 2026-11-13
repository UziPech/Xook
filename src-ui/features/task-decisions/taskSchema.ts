export type TaskUrgency = "alta" | "media" | "baja" | "info";

export type TaskCategory =
  | "abastecimiento"
  | "agenda"
  | "reloj"
  | "nota"
  | "optimizacion"
  | "regla"
  | "boveda";

export type MetricTone = "neutral" | "positive" | "warning" | "critical";

export interface MetricItem {
  label: string;
  value: string;
  sub?: string;
  tone?: MetricTone;
  /** Si se vincula a un parámetro numérico, el valor monetario se recalcula de forma determinística. */
  bindTotalFromParam?: string;
}

export interface CoverageBarBlock {
  type: "coverage_bar";
  currentLabel: string;
  targetLabel: string;
  /** Porcentaje llenado 0..100 */
  ratio: number;
  /** Posición del marcador de riesgo/entrega 0..100 */
  markerRatio?: number;
  tone: "critical" | "warning" | "ok" | "info";
  caption?: string;
}

export interface MetricsStripBlock {
  type: "metrics_strip";
  items: MetricItem[];
}

export interface ScheduleBlock {
  type: "schedule";
  mode: "timer" | "alarm" | "recurring" | "auto";
  timeLabel: string;
  dateLabel?: string;
  durationSeconds?: number;
  recurrence?: string;
  autoSchedule?: boolean;
  autoTriggerLabel?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ChecklistBlock {
  type: "checklist";
  title?: string;
  items: ChecklistItem[];
}

export interface NoteBlock {
  type: "note";
  content: string;
  tags?: string[];
}

export interface ComparisonRow {
  label: string;
  before: string;
  after: string;
  tone?: MetricTone;
}

export interface ComparisonBlock {
  type: "comparison";
  rows: ComparisonRow[];
}

export interface KvRow {
  label: string;
  value: string;
  subtle?: string;
}

export interface KvListBlock {
  type: "kv_list";
  rows: KvRow[];
}

export interface ParamOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ParamControlBlock {
  type: "param_control";
  key: string;
  label: string;
  kind: "stepper" | "select" | "toggle";
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  unitPrice?: number;
  currency?: string;
  options?: ParamOption[];
}

export interface InsightBlock {
  type: "insight";
  text: string;
  source?: string;
  confidence?: number;
}

export type TaskBlock =
  | MetricsStripBlock
  | CoverageBarBlock
  | ScheduleBlock
  | ChecklistBlock
  | NoteBlock
  | ComparisonBlock
  | KvListBlock
  | ParamControlBlock
  | InsightBlock;

export type ActionIntentType =
  | "stock_reorder"
  | "schedule_event"
  | "start_timer"
  | "save_note"
  | "apply_rule"
  | "save_api_key";

export interface TaskActionIntent {
  type: ActionIntentType;
  targetLabel: string;
  /** Etiqueta base del botón principal cuando no depende de cálculo de costo */
  primaryLabel: string;
  /** Clave del parámetro numérico para cálculo determinístico */
  quantityParamKey?: string;
  unitPrice?: number;
  fixedCost?: number;
  currency?: string;
  supplierName?: string;
  maxBudgetLimit?: number;
}

export interface TaskProposal {
  cardId: string;
  title: string;
  subtitle?: string;
  category: TaskCategory;
  urgency: TaskUrgency;
  /** Etiqueta breve en cabecera (ej. "2d de stock", "Hoy 18:30", "15 min") */
  statusChip?: string;
  /** Si la tarjeta debe abrirse expandida por defecto */
  defaultExpanded?: boolean;
  /** Etiqueta corta de origen generado por el agente (ej. "Asesor de stock") */
  generatedBy?: string;
  blocks: TaskBlock[];
  intent: TaskActionIntent;
  /** Estado mutable de parámetros ajustables dentro de la tarjeta */
  paramValues: Record<string, number | string | boolean>;
  /** Clave determinista para deduplicar propuestas repetidas */
  dedupKey?: string;
  /** Datos estructurados para ejecutar escrituras aprobadas tras HITL */
  stagingPayload?: Record<string, unknown>;
}

export interface AgendaItem {
  id: string;
  kind: "timer" | "alarm" | "recurring" | "note";
  title: string;
  subtitle?: string;
  timeLabel: string;
  recurrence?: string;
  autoScheduled?: boolean;
  autoRuleHint?: string;
  /** Para relojes/temporizadores en vivo */
  durationSeconds?: number;
  remainingSeconds?: number;
  endsAt?: string;
  isRunning?: boolean;
  /** Para citas/recordatorios programados */
  scheduleCronOrRule?: string;
  nextRunAt?: string;
  /** Para notas y checklists fijados */
  noteContent?: string;
  checklist?: ChecklistItem[];
  tags?: string[];
  createdAtLabel: string;
}

export interface TaskHistoryItem {
  id: string;
  title: string;
  category: TaskCategory;
  decision: "approved" | "adjusted" | "rejected" | "completed";
  summary: string;
  amountLabel?: string;
  timestampLabel: string;
  notes?: string;
}

const ALLOWED_BLOCK_TYPES = new Set<TaskBlock["type"]>([
  "metrics_strip",
  "coverage_bar",
  "schedule",
  "checklist",
  "note",
  "comparison",
  "kv_list",
  "param_control",
  "insight",
]);

function recoverSpreadText(obj: Record<string, unknown>): string {
  const numericKeys = Object.keys(obj)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (numericKeys.length < 2) return "";
  return numericKeys.map((k) => String(obj[k] ?? "")).join("").trim();
}

function readBlockStr(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function normalizeTaskBlock(rawBlock: unknown, rawTask: TaskProposal): TaskBlock | null {
  if (!rawBlock || typeof rawBlock !== "object") return null;
  const blk = rawBlock as Record<string, unknown>;
  const btype = blk.type as TaskBlock["type"];
  if (typeof btype !== "string" || !ALLOWED_BLOCK_TYPES.has(btype)) return null;

  if (btype === "checklist") {
    const rawItems = Array.isArray(blk.items)
      ? blk.items
      : Array.isArray(blk.steps)
      ? blk.steps
      : [];
    const seenIds = new Set<string>();
    const items: ChecklistItem[] = [];

    rawItems.forEach((entry, idx) => {
      let label = "";
      let rawId = "";
      let done = false;

      if (typeof entry === "string") {
        label = entry.trim();
      } else if (entry && typeof entry === "object") {
        const eObj = entry as Record<string, unknown>;
        rawId = readBlockStr(eObj.id);
        label =
          readBlockStr(eObj.label) ||
          readBlockStr(eObj.text) ||
          readBlockStr(eObj.title) ||
          readBlockStr(eObj.name) ||
          readBlockStr(eObj.description) ||
          recoverSpreadText(eObj);
        done = Boolean(eObj.done ?? eObj.checked);
      }

      if (!label) return;
      let itemId = rawId || `chk_${idx + 1}`;
      if (seenIds.has(itemId)) {
        itemId = `chk_${idx + 1}_${seenIds.size + 1}`;
      }
      seenIds.add(itemId);
      items.push({ id: itemId, label, done });
    });

    return {
      type: "checklist",
      title: readBlockStr(blk.title) || undefined,
      items,
    };
  }

  if (btype === "schedule") {
    let timeLabel =
      readBlockStr(blk.timeLabel) ||
      readBlockStr(blk.time_label) ||
      readBlockStr(blk.time) ||
      readBlockStr(blk.startTime);
    let dateLabel =
      readBlockStr(blk.dateLabel) ||
      readBlockStr(blk.date_label) ||
      readBlockStr(blk.date) ||
      readBlockStr(blk.day);
    const recurrence = readBlockStr(blk.recurrence) || readBlockStr(blk.repeat) || undefined;
    let autoTriggerLabel =
      readBlockStr(blk.autoTriggerLabel) || readBlockStr(blk.auto_trigger_label) || undefined;
    const durationSeconds =
      typeof blk.durationSeconds === "number"
        ? blk.durationSeconds
        : typeof blk.durationMinutes === "number"
        ? blk.durationMinutes * 60
        : undefined;

    if (Array.isArray(blk.items) && blk.items.length > 0) {
      const parts: string[] = [];
      let lastTime = "";
      for (const entry of blk.items) {
        if (entry && typeof entry === "object") {
          const eObj = entry as Record<string, unknown>;
          const t = readBlockStr(eObj.time) || readBlockStr(eObj.hour) || readBlockStr(eObj.timeLabel);
          const lbl = readBlockStr(eObj.label) || readBlockStr(eObj.text) || readBlockStr(eObj.title);
          if (t) lastTime = t;
          if (t && lbl) parts.push(`${t} ${lbl}`);
          else if (lbl) parts.push(lbl);
        } else if (typeof entry === "string" && entry.trim()) {
          parts.push(entry.trim());
        }
      }
      if (!timeLabel) {
        timeLabel = lastTime || readBlockStr(rawTask.statusChip) || readBlockStr(blk.title);
      }
      if (!dateLabel) {
        dateLabel = readBlockStr(blk.title);
      }
      if (!autoTriggerLabel && parts.length > 0) {
        autoTriggerLabel = parts.join(" · ");
      }
    }

    if (!timeLabel) {
      timeLabel = readBlockStr(rawTask.statusChip) || "Por confirmar";
    }

    const rawMode = readBlockStr(blk.mode).toLowerCase();
    const mode: ScheduleBlock["mode"] =
      rawMode === "timer" || rawMode === "alarm" || rawMode === "recurring" || rawMode === "auto"
        ? rawMode
        : typeof durationSeconds === "number" && rawTask.category === "reloj"
        ? "timer"
        : recurrence
        ? "recurring"
        : blk.autoSchedule
        ? "auto"
        : "alarm";

    return {
      type: "schedule",
      mode,
      timeLabel,
      dateLabel: dateLabel || undefined,
      durationSeconds,
      recurrence,
      autoSchedule: typeof blk.autoSchedule === "boolean" ? blk.autoSchedule : undefined,
      autoTriggerLabel,
    };
  }

  if (btype === "note") {
    const content = readBlockStr(blk.content) || readBlockStr(blk.text) || readBlockStr(blk.body);
    const tags = Array.isArray(blk.tags)
      ? blk.tags.map((t) => String(t).trim()).filter(Boolean)
      : undefined;
    return { type: "note", content, tags: tags && tags.length > 0 ? tags : undefined };
  }

  if (btype === "insight") {
    const text = readBlockStr(blk.text) || readBlockStr(blk.content) || readBlockStr(blk.summary);
    return { type: "insight", text };
  }

  return rawBlock as TaskBlock;
}

function hasExplicitCountdownText(text: string): boolean {
  return /\b\d+\s*(?:min|mins|minuto|minutos|seg|segs|segundo|segundos)\b/i.test(text);
}

function hasCalendarOrClockCue(text: string): boolean {
  return /\b(?:mañana|pasado\s+mañana|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b|\ba\s+las\s+\d{1,2}\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}\s*(?:hrs|a\.m\.|p\.m\.|am|pm)\b/i.test(
    text
  );
}

/**
 * Sanitiza y valida una propuesta generada por el agente (Zero-Trust UI Guard).
 * Filtra bloques desconocidos, repara variantes de esquema y acota parámetros numéricos.
 */
export function sanitizeTaskProposal(raw: TaskProposal): TaskProposal {
  const safeBlocks = (Array.isArray(raw.blocks) ? raw.blocks : [])
    .map((b) => normalizeTaskBlock(b, raw))
    .filter((b): b is TaskBlock => Boolean(b));

  const paramValues: Record<string, number | string | boolean> = {
    ...(raw.paramValues ?? {}),
  };

  let clampedBlocks = safeBlocks.map((block) => {
    if (block.type !== "param_control") return block;

    const min = typeof block.min === "number" ? block.min : 1;
    const max = typeof block.max === "number" ? block.max : 9999;

    if (block.kind === "stepper") {
      const current = Number(paramValues[block.key] ?? block.value ?? min);
      const safeVal = Number.isFinite(current)
        ? Math.min(max, Math.max(min, Math.round(current)))
        : min;
      paramValues[block.key] = safeVal;
      return { ...block, min, max, value: safeVal };
    }

    if (paramValues[block.key] === undefined) {
      paramValues[block.key] = block.value;
    }

    return block;
  });

  let safeCategory = raw.category;
  const safeIntent: TaskActionIntent = {
    ...(raw.intent ?? ({} as TaskActionIntent)),
    type: raw.intent?.type ?? (raw.category === "agenda" ? "schedule_event" : "apply_rule"),
    primaryLabel: raw.intent?.primaryLabel || "Autorizar",
    targetLabel: raw.intent?.targetLabel || raw.title || "Tarea",
  };

  if (safeIntent.type === "start_timer") {
    const schedBlock = clampedBlocks.find((b) => b.type === "schedule");
    const paramMins = typeof paramValues.duration_min === "number" ? paramValues.duration_min : 0;
    const blockSecs =
      schedBlock?.type === "schedule" && typeof schedBlock.durationSeconds === "number"
        ? schedBlock.durationSeconds
        : 0;
    const hasPositiveDuration = paramMins > 0 || blockSecs > 0;
    const combinedText = [
      raw.title,
      raw.subtitle,
      raw.statusChip,
      schedBlock?.type === "schedule" ? schedBlock.timeLabel : "",
      schedBlock?.type === "schedule" ? schedBlock.dateLabel : "",
    ]
      .filter(Boolean)
      .join(" ");
    const looksLikeCalendarEvent =
      hasCalendarOrClockCue(combinedText) && !hasExplicitCountdownText(combinedText);
    const schedMode = schedBlock?.type === "schedule" ? schedBlock.mode : undefined;

    if (
      !hasPositiveDuration ||
      schedMode === "alarm" ||
      schedMode === "recurring" ||
      schedMode === "auto" ||
      looksLikeCalendarEvent
    ) {
      safeIntent.type = "schedule_event";
      safeCategory = "agenda";
      if (/reloj|timer|temporizador/i.test(safeIntent.primaryLabel)) {
        safeIntent.primaryLabel = "Agendar recordatorio";
      }
      clampedBlocks = clampedBlocks.map((b) =>
        b.type === "schedule"
          ? {
              ...b,
              mode: b.recurrence ? "recurring" : "alarm",
              durationSeconds: undefined,
            }
          : b
      );
    }
  }

  const cleanDedupKey =
    typeof raw.dedupKey === "string" && raw.dedupKey.trim()
      ? raw.dedupKey.trim()
      : undefined;
  const cleanStagingPayload =
    raw.stagingPayload &&
    typeof raw.stagingPayload === "object" &&
    !Array.isArray(raw.stagingPayload)
      ? raw.stagingPayload
      : undefined;

  return {
    ...raw,
    category: safeCategory,
    blocks: clampedBlocks,
    intent: safeIntent,
    paramValues,
    ...(cleanDedupKey ? { dedupKey: cleanDedupKey } : {}),
    ...(cleanStagingPayload ? { stagingPayload: cleanStagingPayload } : {}),
  };
}

/**
 * Calcula de forma determinística el monto real verificado, si la acción fue ajustada
 * y la etiqueta exacta que verá el usuario en el botón HITL.
 */
export function computeVerifiedDecision(
  task: TaskProposal,
  workspaceBudgetLimit?: number
): {
  verifiedCost: number | null;
  currency: string;
  quantity: number | null;
  wasAdjusted: boolean;
  exceedsBudget: boolean;
  buttonLabel: string;
} {
  const { intent, paramValues, blocks } = task;
  const currency = intent.currency ?? "MXN";
  const maxBudget = intent.maxBudgetLimit ?? workspaceBudgetLimit;

  let quantity: number | null = null;
  let verifiedCost: number | null =
    typeof intent.fixedCost === "number" ? intent.fixedCost : null;
  let wasAdjusted = false;

  if (intent.quantityParamKey) {
    const paramBlock = blocks.find(
      (b): b is ParamControlBlock =>
        b.type === "param_control" && b.key === intent.quantityParamKey
    );
    const rawVal = paramValues[intent.quantityParamKey];
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      quantity = rawVal;
      if (paramBlock && typeof paramBlock.value === "number" && rawVal !== paramBlock.value) {
        wasAdjusted = true;
      }
      if (typeof intent.unitPrice === "number") {
        verifiedCost = quantity * intent.unitPrice;
      }
    }
  }

  const autoParam = blocks.find(
    (b): b is ParamControlBlock =>
      b.type === "param_control" && b.kind === "toggle" && b.key === "auto_schedule"
  );
  if (autoParam && paramValues.auto_schedule !== autoParam.value) {
    wasAdjusted = true;
  }

  const exceedsBudget =
    verifiedCost !== null &&
    typeof maxBudget === "number" &&
    maxBudget > 0 &&
    verifiedCost > maxBudget;

  let buttonLabel = intent.primaryLabel;
  if (verifiedCost !== null) {
    const prefix = wasAdjusted ? "Ajustar y aprobar" : intent.primaryLabel;
    buttonLabel = `${prefix} · $${verifiedCost.toLocaleString()} ${currency}`;
  } else if (wasAdjusted) {
    buttonLabel = `${intent.primaryLabel} (ajustado)`;
  }

  return {
    verifiedCost,
    currency,
    quantity,
    wasAdjusted,
    exceedsBudget,
    buttonLabel,
  };
}

export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

const WEEKDAY_MAP: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function extractClockTime(text: string): { hour: number; minute: number } | null {
  const colonMatch = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (colonMatch) {
    let hour = Number(colonMatch[1]);
    const minute = Number(colonMatch[2]);
    const tail = text.slice(colonMatch.index + colonMatch[0].length, colonMatch.index + colonMatch[0].length + 8);
    if (/^\s*(?:pm|p\.m\.)\b/i.test(tail) && hour < 12) hour += 12;
    if (/^\s*(?:am|a\.m\.)\b/i.test(tail) && hour === 12) hour = 0;
    return { hour, minute };
  }

  const spokenMatch = /(?:\ba\s+las\s+|\b)(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.|hrs|hs)\b/i.exec(text) ||
    /\ba\s+las\s+(\d{1,2})\b/i.exec(text);
  if (spokenMatch) {
    let hour = Number(spokenMatch[1]);
    const suffix = (spokenMatch[2] ?? "").toLowerCase();
    if ((suffix.startsWith("p")) && hour < 12) hour += 12;
    if ((suffix.startsWith("a")) && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return { hour, minute: 0 };
  }
  return null;
}

export function parseScheduleTarget(inputs: {
  title?: string;
  subtitle?: string;
  timeLabel?: string;
  dateLabel?: string;
  now?: Date;
}): { nextRunAt?: string; displayTimeLabel?: string } {
  const now = inputs.now ?? new Date();
  const combined = [inputs.dateLabel, inputs.timeLabel, inputs.title, inputs.subtitle]
    .filter(Boolean)
    .join(" ");
  const clock = extractClockTime(
    [inputs.timeLabel, inputs.dateLabel, inputs.title, inputs.subtitle].filter(Boolean).join(" ")
  );

  let targetDayOffset: number | null = null;
  const weekdayAndDom = /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\s+(\d{1,2})\b/i.exec(
    combined
  );
  const onlyWeekday = /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado)\b/i.exec(
    combined
  );

  if (/\bpasado\s+mañana\b/i.test(combined)) {
    targetDayOffset = 2;
  } else if (/\bmañana\b/i.test(combined)) {
    targetDayOffset = 1;
  } else if (weekdayAndDom) {
    const dom = Number(weekdayAndDom[2]);
    for (let i = 0; i <= 31; i += 1) {
      const cand = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (cand.getDate() === dom) {
        targetDayOffset = i;
        break;
      }
    }
  } else if (onlyWeekday) {
    const targetDow = WEEKDAY_MAP[onlyWeekday[1].toLowerCase()];
    if (typeof targetDow === "number") {
      targetDayOffset = (targetDow - now.getDay() + 7) % 7;
    }
  } else if (/\bhoy\b/i.test(combined)) {
    targetDayOffset = 0;
  }

  if (targetDayOffset === null && !clock) {
    return {};
  }

  const resolvedClock = clock ?? { hour: 9, minute: 0 };
  let offset = targetDayOffset ?? 0;
  let candidate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offset,
    resolvedClock.hour,
    resolvedClock.minute,
    0,
    0
  );

  if (targetDayOffset === null && candidate.getTime() <= now.getTime()) {
    offset = 1;
    candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      resolvedClock.hour,
      resolvedClock.minute,
      0,
      0
    );
  } else if (
    onlyWeekday &&
    !weekdayAndDom &&
    offset === 0 &&
    candidate.getTime() <= now.getTime()
  ) {
    offset = 7;
    candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      resolvedClock.hour,
      resolvedClock.minute,
      0,
      0
    );
  }

  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const candMidnight = new Date(
    candidate.getFullYear(),
    candidate.getMonth(),
    candidate.getDate()
  ).getTime();
  const dayDiff = Math.round((candMidnight - todayMidnight) / 86400000);
  const hhmm = `${String(resolvedClock.hour).padStart(2, "0")}:${String(resolvedClock.minute).padStart(2, "0")}`;
  const dayLabel =
    dayDiff === 0
      ? "Hoy"
      : dayDiff === 1
      ? "Mañana"
      : candidate.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });

  return {
    nextRunAt: candidate.toISOString(),
    displayTimeLabel: `${dayLabel} · ${hhmm} hrs`,
  };
}

export function inferAlarmFromMisclassifiedTimer(
  item: AgendaItem,
  now: Date = new Date()
): AgendaItem | null {
  if (item.kind !== "timer") return null;
  const text = `${item.title} ${item.subtitle ?? ""}`.trim();
  if (!text || hasExplicitCountdownText(text) || /\breloj rápido\b/i.test(text)) {
    return null;
  }
  if (!hasCalendarOrClockCue(text)) return null;

  const parsed = parseScheduleTarget({
    title: item.title,
    subtitle: item.subtitle,
    now,
  });
  if (!parsed.nextRunAt) return null;

  return {
    ...item,
    kind: item.recurrence ? "recurring" : "alarm",
    timeLabel: parsed.displayTimeLabel ?? item.timeLabel,
    nextRunAt: parsed.nextRunAt,
    scheduleCronOrRule: item.scheduleCronOrRule ?? item.recurrence ?? "Una vez",
    durationSeconds: undefined,
    remainingSeconds: undefined,
    endsAt: undefined,
    isRunning: false,
  };
}

export function formatRelativeTarget(
  isoDate?: string,
  nowMs: number = Date.now()
): { label: string; isDue: boolean } | null {
  if (!isoDate) return null;
  const targetMs = Date.parse(isoDate);
  if (Number.isNaN(targetMs)) return null;
  const diffSec = Math.round((targetMs - nowMs) / 1000);

  if (diffSec <= -3600) {
    return { label: "Vencida", isDue: true };
  }
  if (diffSec <= -60) {
    return { label: `Hace ${Math.round(Math.abs(diffSec) / 60)} min`, isDue: true };
  }
  if (diffSec <= 60) {
    return { label: "Ahora", isDue: true };
  }
  if (diffSec < 3600) {
    return { label: `En ${Math.round(diffSec / 60)} min`, isDue: diffSec <= 300 };
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    return { label: m > 0 ? `En ${h}h ${m}m` : `En ${h}h`, isDue: false };
  }
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  return { label: h > 0 ? `En ${d}d ${h}h` : `En ${d}d`, isDue: false };
}

