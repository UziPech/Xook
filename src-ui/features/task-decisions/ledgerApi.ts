import { isWorkspaceTauriRuntime } from "../workspace-store/workspaceApi";
import {
  type AgendaItem,
  type TaskHistoryItem,
  type TaskProposal,
  sanitizeTaskProposal,
} from "./taskSchema";

export interface LedgerAgendaItem extends AgendaItem {
  endsAt?: string;
  scheduleCronOrRule?: string;
  nextRunAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpsertTaskOptions {
  dedupKey?: string;
  reviewRunId?: string;
  status?: "pending" | "approved" | "adjusted" | "rejected";
  stagingPayload?: unknown;
}

export interface DecideTaskHitlPayload {
  cardId: string;
  decisionId?: string;
  title: string;
  category: string;
  decision: "approved" | "adjusted" | "rejected";
  summary: string;
  amountLabel?: string;
  verifiedCost?: number | null;
  currency?: string | null;
  adjustedQty?: number | null;
  executionArtifactPath?: string;
  notes?: string;
  decidedBy?: string;
  updatedProposal?: TaskProposal;
  promoteAgendaItem?: AgendaItem;
}

export interface DecideTaskHitlResult {
  historyEntry: TaskHistoryItem;
  promotedAgendaItem: LedgerAgendaItem | null;
}

export interface AuditLogEntry {
  id: number;
  actor: string;
  action: string;
  targetPath: string;
  zone: string;
  detail?: string;
  createdAt: string;
  timestampLabel: string;
}

interface RawTaskLedgerRecord {
  cardId: string;
  dedupKey?: string;
  reviewRunId?: string;
  status: string;
  proposal: unknown;
}

function toCleanTask(raw: unknown): TaskProposal | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    return sanitizeTaskProposal(raw as TaskProposal);
  } catch {
    return null;
  }
}

function toAgendaPayload(item: LedgerAgendaItem) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle ?? null,
    timeLabel: item.timeLabel,
    recurrence: item.recurrence ?? null,
    autoScheduled: Boolean(item.autoScheduled),
    durationSeconds: item.durationSeconds ?? null,
    remainingSeconds: item.remainingSeconds ?? null,
    endsAt: item.endsAt ?? null,
    isRunning: Boolean(item.isRunning),
    noteContent: item.noteContent ?? null,
    checklist: item.checklist ?? null,
    tags: item.tags ?? null,
    scheduleCronOrRule: item.scheduleCronOrRule ?? null,
    nextRunAt: item.nextRunAt ?? null,
    createdAt: item.createdAt ?? null,
  };
}

function normalizeHistoryDecision(raw: string): TaskHistoryItem["decision"] {
  if (raw === "adjusted" || raw === "rejected" || raw === "completed") return raw;
  return "approved";
}

function toHistoryItem(dto: TaskHistoryItem): TaskHistoryItem {
  return {
    id: dto.id,
    title: dto.title,
    category: dto.category,
    decision: normalizeHistoryDecision(dto.decision),
    summary: dto.summary,
    amountLabel: dto.amountLabel ?? undefined,
    timestampLabel: dto.timestampLabel,
  };
}

export async function listTasks(
  status: "pending" | "approved" | "adjusted" | "rejected" | "all" = "pending"
): Promise<TaskProposal[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const rows = await invoke<RawTaskLedgerRecord[]>("list_tasks", { status });
  const parsed: TaskProposal[] = [];
  for (const row of rows) {
    const clean = toCleanTask(row.proposal);
    if (clean) parsed.push(clean);
  }
  return parsed;
}

export async function upsertTask(
  proposal: TaskProposal,
  opts?: UpsertTaskOptions
): Promise<TaskProposal | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  if (proposal.intent.type === "save_api_key") return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<RawTaskLedgerRecord | null>("create_task", {
    payload: {
      proposal,
      dedupKey: opts?.dedupKey ?? null,
      reviewRunId: opts?.reviewRunId ?? null,
      status: opts?.status ?? "pending",
      stagingPayload: opts?.stagingPayload ?? null,
    },
  });
  return res ? toCleanTask(res.proposal) : null;
}

export async function upsertTasksBatch(
  proposals: TaskProposal[],
  replacePending = false
): Promise<TaskProposal[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const persistable = proposals.filter((p) => p.intent.type !== "save_api_key");
  if (persistable.length === 0 && !replacePending) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const rows = await invoke<RawTaskLedgerRecord[]>("create_tasks_batch", {
    items: persistable.map((proposal) => ({
      proposal,
      status: "pending",
      dedupKey: proposal.dedupKey ?? null,
      stagingPayload: proposal.stagingPayload ?? null,
    })),
    replacePending,
  });
  const parsed: TaskProposal[] = [];
  for (const row of rows) {
    const clean = toCleanTask(row.proposal);
    if (clean) parsed.push(clean);
  }
  return parsed;
}

export async function updateTaskProposal(
  cardId: string,
  proposal: TaskProposal
): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  if (proposal.intent.type === "save_api_key") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("update_task_proposal", {
    cardId,
    proposal,
  });
}

export async function decideTaskHitl(
  payload: DecideTaskHitlPayload
): Promise<DecideTaskHitlResult | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{
    historyEntry: TaskHistoryItem;
    promotedAgendaItem: LedgerAgendaItem | null;
  }>("decide_task_hitl", {
    payload: {
      cardId: payload.cardId,
      decisionId: payload.decisionId ?? null,
      title: payload.title,
      category: payload.category,
      decision: payload.decision,
      summary: payload.summary,
      amountLabel: payload.amountLabel ?? null,
      verifiedCost: payload.verifiedCost ?? null,
      currency: payload.currency ?? null,
      adjustedQty: payload.adjustedQty ?? null,
      executionArtifactPath: payload.executionArtifactPath ?? null,
      notes: payload.notes ?? null,
      decidedBy: payload.decidedBy ?? null,
      updatedProposal:
        payload.updatedProposal && payload.updatedProposal.intent.type !== "save_api_key"
          ? payload.updatedProposal
          : null,
      promoteAgendaItem: payload.promoteAgendaItem
        ? toAgendaPayload(payload.promoteAgendaItem)
        : null,
    },
  });
  return {
    historyEntry: toHistoryItem(res.historyEntry),
    promotedAgendaItem: res.promotedAgendaItem ?? null,
  };
}

export async function listAgendaItems(): Promise<LedgerAgendaItem[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LedgerAgendaItem[]>("list_agenda_items");
}

export async function upsertAgendaItem(item: AgendaItem): Promise<LedgerAgendaItem> {
  if (!isWorkspaceTauriRuntime()) return item;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LedgerAgendaItem>("upsert_agenda_item", {
    payload: toAgendaPayload(item),
  });
}

export async function toggleTimerState(id: string): Promise<LedgerAgendaItem | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LedgerAgendaItem>("toggle_timer_state", { id });
}

export async function resetTimerState(id: string): Promise<LedgerAgendaItem | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LedgerAgendaItem>("reset_timer_state", { id });
}

export async function completeAgendaItem(payload: {
  agendaItemId: string;
  decisionId?: string;
  decidedBy?: string;
  notes?: string;
}): Promise<TaskHistoryItem | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const dto = await invoke<TaskHistoryItem>("complete_agenda_item", {
    payload: {
      agendaItemId: payload.agendaItemId,
      decisionId: payload.decisionId ?? null,
      decidedBy: payload.decidedBy ?? null,
      notes: payload.notes ?? null,
    },
  });
  return toHistoryItem(dto);
}

export async function deleteAgendaItem(id: string): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("delete_agenda_item", { id });
}

export async function listTaskHistory(limit = 150): Promise<TaskHistoryItem[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const rows = await invoke<TaskHistoryItem[]>("list_task_history", { limit });
  return rows.map(toHistoryItem);
}

export async function recordHistoryEntry(payload: {
  id?: string;
  taskCardId?: string;
  agendaItemId?: string;
  title: string;
  category: string;
  decision: "approved" | "adjusted" | "rejected" | "completed";
  summary: string;
  amountLabel?: string;
  notes?: string;
  decidedBy?: string;
}): Promise<TaskHistoryItem | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const dto = await invoke<TaskHistoryItem>("record_history_entry", {
    payload: {
      id: payload.id ?? null,
      taskCardId: payload.taskCardId ?? null,
      agendaItemId: payload.agendaItemId ?? null,
      title: payload.title,
      category: payload.category,
      decision: payload.decision,
      summary: payload.summary,
      amountLabel: payload.amountLabel ?? null,
      notes: payload.notes ?? null,
      decidedBy: payload.decidedBy ?? null,
    },
  });
  return toHistoryItem(dto);
}

export async function getAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AuditLogEntry[]>("get_audit_log", { limit });
}

export async function hydrateWorkspaceLedger(): Promise<{
  tasks: TaskProposal[];
  agendaItems: LedgerAgendaItem[];
  historyItems: TaskHistoryItem[];
}> {
  if (!isWorkspaceTauriRuntime()) {
    return { tasks: [], agendaItems: [], historyItems: [] };
  }
  const [tasks, agendaItems, historyItems] = await Promise.all([
    listTasks("pending"),
    listAgendaItems(),
    listTaskHistory(150),
  ]);
  return { tasks, agendaItems, historyItems };
}

export async function subscribeLedgerUpdated(
  onUpdate: (scope: string) => void
): Promise<() => void> {
  if (!isWorkspaceTauriRuntime()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ scope?: string }>(
    "xook:ledger-updated",
    (event) => {
      onUpdate(event.payload?.scope ?? "all");
    }
  );
  return unlisten;
}


export interface InventoryItem {
  sku: string;
  name: string;
  category?: string | null;
  currentStock: number;
  unit: string;
  avgDailySales: number;
  costUnit: number;
  currency: string;
  supplierId?: string | null;
  minStockDays?: number | null;
  sourceFile?: string | null;
  updatedAt: string;
}

export interface ReviewRun {
  id: string;
  reviewType: string;
  triggerSource: string;
  status: string;
  sourcesScanned: string[];
  findingsCount: number;
  summary?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface ImportInventoryResult {
  importedCount: number;
  filePath: string;
  items: InventoryItem[];
}

export interface RunReviewResult {
  reviewRun: ReviewRun;
  reportPath?: string | null;
  analyzedItemsCount: number;
  skippedDuplicatesCount: number;
  newTasksCount: number;
  summary: string;
}

export interface DueAgendaNotice {
  id: string;
  kind: string;
  title: string;
  timeLabel: string;
  autoScheduled: boolean;
}

export interface DatosChangedNotice {
  path: string;
  summary: string;
  newTasksCount: number;
}

export async function importInventoryFile(
  filename: string | null,
  content: string
): Promise<ImportInventoryResult | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ImportInventoryResult>("import_inventory_file", {
    filename,
    content,
  });
}

export async function listInventoryItems(): Promise<InventoryItem[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InventoryItem[]>("list_inventory_items");
}

export async function listReviewRuns(limit = 10): Promise<ReviewRun[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ReviewRun[]>("list_review_runs", { limit });
}

export async function runBusinessReview(
  triggerSource = "manual"
): Promise<RunReviewResult | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RunReviewResult>("run_business_review", { triggerSource });
}

export function subscribeReviewUpdated(
  onUpdated: (result: RunReviewResult) => void
): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    void listen<RunReviewResult>("review:updated", (event) => {
      if (active && event.payload) {
        onUpdated(event.payload);
      }
    }).then((fn) => {
      if (active) {
        unlisten = fn;
      } else {
        fn();
      }
    });
  });
  return () => {
    active = false;
    unlisten?.();
  };
}

export function subscribeAgendaAndDatosEvents(handlers: {
  onTimerExpired?: (notice: DueAgendaNotice) => void;
  onAgendaDue?: (notice: DueAgendaNotice) => void;
  onDatosChanged?: (notice: DatosChangedNotice) => void;
}): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  const unlisteners: Array<() => void> = [];

  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    if (handlers.onTimerExpired) {
      void listen<DueAgendaNotice>("agenda:timer-expired", (ev) => {
        if (active && ev.payload) handlers.onTimerExpired?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
    if (handlers.onAgendaDue) {
      void listen<DueAgendaNotice>("agenda:due-reminder", (ev) => {
        if (active && ev.payload) handlers.onAgendaDue?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
    if (handlers.onDatosChanged) {
      void listen<DatosChangedNotice>("workspace:datos-changed", (ev) => {
        if (active && ev.payload) handlers.onDatosChanged?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
  });

  return () => {
    active = false;
    for (const fn of unlisteners) fn();
  };
}
