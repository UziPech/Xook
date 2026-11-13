import type { ActionCard } from "../../components/XookBrand";

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
  isRunning?: boolean;
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

/**
 * Sanitiza y valida una propuesta generada por el agente (Zero-Trust UI Guard).
 * Filtra bloques desconocidos y acota parámetros numéricos antes de renderizar.
 */
export function sanitizeTaskProposal(raw: TaskProposal): TaskProposal {
  const safeBlocks = raw.blocks.filter((b): b is TaskBlock =>
    Boolean(b && typeof b.type === "string" && ALLOWED_BLOCK_TYPES.has(b.type))
  );

  const paramValues: Record<string, number | string | boolean> = {
    ...(raw.paramValues ?? {}),
  };

  const clampedBlocks = safeBlocks.map((block) => {
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

  return {
    ...raw,
    blocks: clampedBlocks,
    paramValues,
  };
}

/**
 * Calcula de forma determinística el monto real verificado, si la acción fue ajustada
 * y la etiqueta exacta que verá el usuario en el botón HITL.
 */
export function computeVerifiedDecision(task: TaskProposal): {
  verifiedCost: number | null;
  currency: string;
  quantity: number | null;
  wasAdjusted: boolean;
  exceedsBudget: boolean;
  buttonLabel: string;
} {
  const { intent, paramValues, blocks } = task;
  const currency = intent.currency ?? "MXN";
  const maxBudget = intent.maxBudgetLimit ?? 50000;

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

  const exceedsBudget = verifiedCost !== null && verifiedCost > maxBudget;

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

/**
 * Adapta una ActionCard clásica del backend Rust/Python a una TaskProposal declarativa.
 */
export function actionCardToTaskProposal(
  card: ActionCard,
  index = 0
): TaskProposal {
  const unitPrice =
    card.recommended_order > 0
      ? Math.round((card.estimated_cost / card.recommended_order) * 100) / 100
      : card.estimated_cost;

  const isCafe = card.card_id.includes("cafe");
  const isMatcha = card.card_id.includes("te");
  const daysLeft = isCafe ? 2 : isMatcha ? 3 : Math.max(1, Math.round(card.current_stock / 2));
  const leadTimeDays = isMatcha ? 5 : 3;
  const stockRatio = Math.min(100, Math.max(12, Math.round((daysLeft / 10) * 100)));
  const deliveryMarker = Math.min(92, Math.round((leadTimeDays / 10) * 100));

  return sanitizeTaskProposal({
    cardId: card.card_id,
    title: card.title,
    subtitle: card.description,
    category: "abastecimiento",
    urgency: card.urgency,
    statusChip: `${daysLeft}d de stock`,
    defaultExpanded: index === 0 && card.urgency === "alta",
    generatedBy: "Asesor de stock",
    paramValues: {
      order_qty: card.recommended_order,
    },
    intent: {
      type: "stock_reorder",
      targetLabel: card.product_name,
      primaryLabel: "Aprobar orden",
      quantityParamKey: "order_qty",
      unitPrice,
      currency: card.currency,
      supplierName: card.supplier_name,
      maxBudgetLimit: 50000,
    },
    blocks: [
      {
        type: "metrics_strip",
        items: [
          {
            label: "Stock actual",
            value: `${card.current_stock} un.`,
            tone: card.urgency === "alta" ? "critical" : "warning",
          },
          {
            label: "Sugerido",
            value: `+${card.recommended_order} un.`,
            tone: "neutral",
          },
          {
            label: "Total",
            value: `$${card.estimated_cost.toLocaleString()}`,
            sub: card.currency,
            tone: "positive",
            bindTotalFromParam: "order_qty",
          },
        ],
      },
      {
        type: "coverage_bar",
        currentLabel: `Cobertura: ~${daysLeft} días`,
        targetLabel: `Entrega proveedor: ${leadTimeDays}d`,
        ratio: stockRatio,
        markerRatio: deliveryMarker,
        tone: daysLeft <= leadTimeDays ? "critical" : "warning",
        caption:
          daysLeft <= leadTimeDays
            ? "El stock actual se agota antes o justo al llegar el pedido."
            : "Ventana ajustada respecto al tiempo de entrega.",
      },
      {
        type: "param_control",
        key: "order_qty",
        label: "Cantidad a pedir",
        kind: "stepper",
        value: card.recommended_order,
        min: 1,
        max: 500,
        step: 5,
        unit: "un.",
        unitPrice,
        currency: card.currency,
      },
      {
        type: "kv_list",
        rows: [
          {
            label: "Proveedor",
            value: card.supplier_name,
            subtle: isMatcha ? "4.5★ · 5d entrega" : "4.8★ · 3d entrega",
          },
          {
            label: "Producto",
            value: card.product_name,
          },
        ],
      },
      {
        type: "insight",
        text: card.reasoning,
        source: isCafe ? "Patrón aprendido" : "store-profile.json",
        confidence: isCafe ? 0.95 : undefined,
      },
    ],
  });
}

export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

