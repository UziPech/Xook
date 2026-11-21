/**
 * Contratos de ventana de contexto, compactación y memoria operativa por turno.
 * Compartidos entre el motor Python (`context_manager.py`), la UI (`src-ui/`) y `@xook/agent-inspector`.
 */

import type { ToolDisposition } from "./deliverySemantics.ts";

export type CompactionMethod = "llm" | "deterministic_fallback";

export interface ContextCheckpoint {
  objective: string;
  activeDecisions: string[];
  supersededDiscarded: string[];
  documentState: string;
  pendingItems: string[];
  /** Rutas de archivos, artefactos y hechos verificados que deben sobrevivir la compactación. */
  activeArtifacts?: string[];
  summary: string;
  compactedTurns: number;
  tokensBefore?: number;
  tokensAfter?: number;
  savedPct?: number;
  auto?: boolean;
  compactionMethod?: CompactionMethod;
  fallbackReason?: string;
  updatedAt?: string;
}

export interface ContextCompactedEvent {
  auto: boolean;
  scope: "chat" | "document";
  documentPath?: string;
  documentTitle?: string;
  compactedTurnsThisPass: number;
  keptRecentTurns: number;
  tokensBefore: number;
  tokensAfter: number;
  savedPct: number;
  compactionMethod?: CompactionMethod;
  fallbackReason?: string;
  checkpoint: ContextCheckpoint;
}

export interface TurnToolActionDigest {
  tool: string;
  target?: string;
  ok: boolean;
  summary: string;
  disposition?: ToolDisposition;
}

export interface TurnSubagentDigest {
  name: string;
  role: string;
  ok: boolean;
  summary: string;
}

/**
 * Memoria operativa compacta producida al finalizar un turno agéntico.
 * Permite que el siguiente turno recuerde qué archivos se leyeron/editaron, qué comandos
 * corrieron y qué concluyeron los sub-agentes, sin arrastrar salidas crudas gigantes.
 */
export interface TurnWorkingMemory {
  filesRead: string[];
  filesModified: string[];
  commandsRun: string[];
  subagents: TurnSubagentDigest[];
  actions: TurnToolActionDigest[];
  compactNote: string;
}

export function sanitizeContextCheckpoint(raw: unknown): ContextCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const asStrList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const objective = String(o.objective ?? "").trim();
  const activeDecisions = asStrList(o.activeDecisions ?? o.active_decisions);
  const supersededDiscarded = asStrList(o.supersededDiscarded ?? o.superseded_discarded);
  const activeArtifacts = asStrList(o.activeArtifacts ?? o.active_artifacts);
  const documentState = String(o.documentState ?? o.document_state ?? "").trim();
  const pendingItems = asStrList(o.pendingItems ?? o.pending_items);
  const summary = String(o.summary ?? "").trim();
  if (!objective && !summary && activeDecisions.length === 0 && !documentState) return null;

  const rawMethod = String(o.compactionMethod ?? o.compaction_method ?? "").trim();
  const compactionMethod: CompactionMethod | undefined =
    rawMethod === "llm" || rawMethod === "deterministic_fallback" ? rawMethod : undefined;
  const rawFallbackReason = String(o.fallbackReason ?? o.fallback_reason ?? "").trim();

  return {
    objective,
    activeDecisions,
    supersededDiscarded,
    ...(activeArtifacts.length > 0 ? { activeArtifacts } : {}),
    documentState,
    pendingItems,
    summary: summary || objective || "Contexto anterior compactado.",
    compactedTurns: Number(o.compactedTurns ?? o.compacted_turns ?? 0) || 0,
    tokensBefore:
      typeof (o.tokensBefore ?? o.tokens_before) === "number"
        ? Number(o.tokensBefore ?? o.tokens_before)
        : undefined,
    tokensAfter:
      typeof (o.tokensAfter ?? o.tokens_after) === "number"
        ? Number(o.tokensAfter ?? o.tokens_after)
        : undefined,
    savedPct:
      typeof (o.savedPct ?? o.saved_pct) === "number"
        ? Number(o.savedPct ?? o.saved_pct)
        : undefined,
    auto: typeof o.auto === "boolean" ? o.auto : undefined,
    ...(compactionMethod ? { compactionMethod } : {}),
    ...(rawFallbackReason ? { fallbackReason: rawFallbackReason } : {}),
    updatedAt:
      typeof (o.updatedAt ?? o.updated_at) === "string"
        ? String(o.updatedAt ?? o.updated_at)
        : undefined,
  };
}

export function sanitizeTurnWorkingMemory(raw: unknown): TurnWorkingMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const asList = (v: unknown, limit: number): string[] =>
    Array.isArray(v)
      ? v
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
          .slice(0, limit)
      : [];

  const filesRead = asList(o.filesRead ?? o.files_read, 20);
  const filesModified = asList(o.filesModified ?? o.files_modified, 20);
  const commandsRun = asList(o.commandsRun ?? o.commands_run, 12);
  const rawSubs = Array.isArray(o.subagents) ? o.subagents : [];
  const subagents: TurnSubagentDigest[] = rawSubs
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
    .slice(0, 8)
    .map((s) => ({
      name: String(s.name ?? "Sub-agente").trim(),
      role: String(s.role ?? "").trim(),
      ok: Boolean(s.ok),
      summary: String(s.summary ?? "").trim().slice(0, 280),
    }))
    .filter((s) => Boolean(s.name));

  const rawActions = Array.isArray(o.actions) ? o.actions : [];
  const actions: TurnToolActionDigest[] = rawActions
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object"))
    .slice(0, 20)
    .map((a) => ({
      tool: String(a.tool ?? "").trim(),
      ...(typeof a.target === "string" && a.target.trim() ? { target: a.target.trim() } : {}),
      ok: Boolean(a.ok),
      summary: String(a.summary ?? "").trim().slice(0, 220),
    }))
    .filter((a) => Boolean(a.tool));

  const compactNote = String(o.compactNote ?? o.compact_note ?? "").trim().slice(0, 1200);
  if (
    filesRead.length === 0 &&
    filesModified.length === 0 &&
    commandsRun.length === 0 &&
    subagents.length === 0 &&
    actions.length === 0 &&
    !compactNote
  ) {
    return null;
  }

  return {
    filesRead,
    filesModified,
    commandsRun,
    subagents,
    actions,
    compactNote,
  };
}
