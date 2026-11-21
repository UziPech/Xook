/**
 * Esquema aditivo v1 de trazas JSONL del agente XOOK (`.xook/agent_traces/<session>.jsonl`).
 *
 * Inspirado conceptualmente en el formato de Trace Segment aditivo de
 * vercel-labs/agent-desktop (Apache-2.0): cada línea es un evento atómico; los lectores
 * ignoran campos desconocidos y toleran líneas truncadas con advertencias contadas.
 */

import { sanitizeToolDisposition, type ToolDisposition } from "./deliverySemantics.ts";
import type { CompactionMethod } from "./contextCheckpoint.ts";

export const AGENT_TRACE_SCHEMA_VERSION = 1;

export type AgentTraceEventType =
  | "trace.meta"
  | "turn.start"
  | "context.budget"
  | "context.compacted"
  | "tool.call"
  | "tool.result"
  | "tool.pruned"
  | "subagent.spawn"
  | "subagent.done"
  | "turn.end"
  | "turn.error";

export interface AgentTraceBaseEvent {
  schema: number;
  type: AgentTraceEventType;
  ts: string;
  sessionId: string;
  turnId?: string;
}

export interface TraceMetaEvent extends AgentTraceBaseEvent {
  type: "trace.meta";
  workspace?: string;
  pid?: number;
  engine?: string;
}

export interface TurnStartEvent extends AgentTraceBaseEvent {
  type: "turn.start";
  mode?: string | null;
  scope: "chat" | "document";
  provider: string;
  model: string;
  historyCount: number;
  hasCheckpoint: boolean;
  userPreview?: string;
}

export interface ContextBudgetEvent extends AgentTraceBaseEvent {
  type: "context.budget";
  modelContextWindow: number;
  systemPromptTokens: number;
  historyTokens: number;
  checkpointTokens: number;
  toolDefsCount: number;
  utilizationPct: number;
}

export interface ContextCompactedTraceEvent extends AgentTraceBaseEvent {
  type: "context.compacted";
  scope: "chat" | "document";
  auto: boolean;
  method: CompactionMethod;
  fallbackReason?: string;
  compactedTurns: number;
  keptRecentTurns: number;
  tokensBefore: number;
  tokensAfter: number;
  savedPct: number;
}

export interface ToolCallTraceEvent extends AgentTraceBaseEvent {
  type: "tool.call";
  round: number;
  toolCallId: string;
  tool: string;
  target?: string;
}

export interface ToolResultTraceEvent extends AgentTraceBaseEvent {
  type: "tool.result";
  round: number;
  toolCallId: string;
  tool: string;
  target?: string;
  ok: boolean;
  durationMs: number;
  outputChars: number;
  disposition?: ToolDisposition;
  error?: string;
}

export interface ToolPrunedTraceEvent extends AgentTraceBaseEvent {
  type: "tool.pruned";
  round: number;
  prunedCount: number;
  charsBefore: number;
  charsAfter: number;
}

export interface SubagentSpawnTraceEvent extends AgentTraceBaseEvent {
  type: "subagent.spawn";
  subagentId: string;
  name: string;
  role: string;
  model: string;
  hasHandoffContext: boolean;
}

export interface SubagentDoneTraceEvent extends AgentTraceBaseEvent {
  type: "subagent.done";
  subagentId: string;
  name: string;
  role: string;
  model: string;
  ok: boolean;
  durationMs: number;
  roundsUsed: number;
  findingsChars: number;
  error?: string;
}

export interface TurnEndTraceEvent extends AgentTraceBaseEvent {
  type: "turn.end";
  provider: string;
  model: string;
  rounds: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  toolCallsCount: number;
  workspaceMutated: boolean;
}

export interface TurnErrorTraceEvent extends AgentTraceBaseEvent {
  type: "turn.error";
  provider?: string;
  model?: string;
  error: string;
}

export type AgentTraceEvent =
  | TraceMetaEvent
  | TurnStartEvent
  | ContextBudgetEvent
  | ContextCompactedTraceEvent
  | ToolCallTraceEvent
  | ToolResultTraceEvent
  | ToolPrunedTraceEvent
  | SubagentSpawnTraceEvent
  | SubagentDoneTraceEvent
  | TurnEndTraceEvent
  | TurnErrorTraceEvent;

const KNOWN_EVENT_TYPES = new Set<string>([
  "trace.meta",
  "turn.start",
  "context.budget",
  "context.compacted",
  "tool.call",
  "tool.result",
  "tool.pruned",
  "subagent.spawn",
  "subagent.done",
  "turn.end",
  "turn.error",
]);

export interface ParseTraceLineResult {
  event: AgentTraceEvent | null;
  warning?: string;
}

/**
 * Parsea una línea JSONL de traza sin lanzar excepciones ante colas truncadas o líneas corruptas.
 * Acepta tanto camelCase como snake_case proveniente de Python.
 */
export function parseTraceLine(rawLine: string, lineNumber?: number): ParseTraceLineResult {
  const trimmed = rawLine.trim();
  if (!trimmed) return { event: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      event: null,
      warning: `Línea ${lineNumber ?? "?"}: JSON inválido o truncado`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      event: null,
      warning: `Línea ${lineNumber ?? "?"}: evento no es objeto JSON`,
    };
  }

  const o = parsed as Record<string, unknown>;
  const type = String(o.type ?? "").trim();
  if (!KNOWN_EVENT_TYPES.has(type)) {
    return {
      event: null,
      warning: `Línea ${lineNumber ?? "?"}: tipo de evento desconocido '${type}'`,
    };
  }

  const base: AgentTraceBaseEvent = {
    schema: Number(o.schema ?? 1) || 1,
    type: type as AgentTraceEventType,
    ts: String(o.ts ?? ""),
    sessionId: String(o.sessionId ?? o.session_id ?? "default"),
    ...(typeof (o.turnId ?? o.turn_id) === "string"
      ? { turnId: String(o.turnId ?? o.turn_id) }
      : {}),
  };

  switch (base.type) {
    case "trace.meta":
      return {
        event: {
          ...base,
          type: "trace.meta",
          ...(typeof o.workspace === "string" ? { workspace: o.workspace } : {}),
          ...(typeof o.pid === "number" ? { pid: o.pid } : {}),
          ...(typeof o.engine === "string" ? { engine: o.engine } : {}),
        },
      };
    case "turn.start":
      return {
        event: {
          ...base,
          type: "turn.start",
          mode: typeof o.mode === "string" ? o.mode : null,
          scope: o.scope === "document" ? "document" : "chat",
          provider: String(o.provider ?? ""),
          model: String(o.model ?? ""),
          historyCount: Number(o.historyCount ?? o.history_count ?? 0) || 0,
          hasCheckpoint: Boolean(o.hasCheckpoint ?? o.has_checkpoint),
          ...(typeof (o.userPreview ?? o.user_preview) === "string"
            ? { userPreview: String(o.userPreview ?? o.user_preview) }
            : {}),
        },
      };
    case "context.budget":
      return {
        event: {
          ...base,
          type: "context.budget",
          modelContextWindow: Number(o.modelContextWindow ?? o.model_context_window ?? 0) || 0,
          systemPromptTokens: Number(o.systemPromptTokens ?? o.system_prompt_tokens ?? 0) || 0,
          historyTokens: Number(o.historyTokens ?? o.history_tokens ?? 0) || 0,
          checkpointTokens: Number(o.checkpointTokens ?? o.checkpoint_tokens ?? 0) || 0,
          toolDefsCount: Number(o.toolDefsCount ?? o.tool_defs_count ?? 0) || 0,
          utilizationPct: Number(o.utilizationPct ?? o.utilization_pct ?? 0) || 0,
        },
      };
    case "context.compacted":
      return {
        event: {
          ...base,
          type: "context.compacted",
          scope: o.scope === "document" ? "document" : "chat",
          auto: Boolean(o.auto),
          method:
            o.method === "llm" ? "llm" : "deterministic_fallback",
          ...(typeof (o.fallbackReason ?? o.fallback_reason) === "string" &&
          String(o.fallbackReason ?? o.fallback_reason).trim()
            ? { fallbackReason: String(o.fallbackReason ?? o.fallback_reason).trim() }
            : {}),
          compactedTurns: Number(o.compactedTurns ?? o.compacted_turns ?? 0) || 0,
          keptRecentTurns: Number(o.keptRecentTurns ?? o.kept_recent_turns ?? 0) || 0,
          tokensBefore: Number(o.tokensBefore ?? o.tokens_before ?? 0) || 0,
          tokensAfter: Number(o.tokensAfter ?? o.tokens_after ?? 0) || 0,
          savedPct: Number(o.savedPct ?? o.saved_pct ?? 0) || 0,
        },
      };
    case "tool.call":
      return {
        event: {
          ...base,
          type: "tool.call",
          round: Number(o.round ?? 0) || 0,
          toolCallId: String(o.toolCallId ?? o.tool_call_id ?? ""),
          tool: String(o.tool ?? ""),
          ...(typeof o.target === "string" && o.target ? { target: o.target } : {}),
        },
      };
    case "tool.result": {
      const disp = sanitizeToolDisposition(o.disposition);
      return {
        event: {
          ...base,
          type: "tool.result",
          round: Number(o.round ?? 0) || 0,
          toolCallId: String(o.toolCallId ?? o.tool_call_id ?? ""),
          tool: String(o.tool ?? ""),
          ...(typeof o.target === "string" && o.target ? { target: o.target } : {}),
          ok: Boolean(o.ok),
          durationMs: Number(o.durationMs ?? o.duration_ms ?? 0) || 0,
          outputChars: Number(o.outputChars ?? o.output_chars ?? 0) || 0,
          ...(disp ? { disposition: disp } : {}),
          ...(typeof o.error === "string" && o.error ? { error: o.error } : {}),
        },
      };
    }
    case "tool.pruned":
      return {
        event: {
          ...base,
          type: "tool.pruned",
          round: Number(o.round ?? 0) || 0,
          prunedCount: Number(o.prunedCount ?? o.pruned_count ?? 0) || 0,
          charsBefore: Number(o.charsBefore ?? o.chars_before ?? 0) || 0,
          charsAfter: Number(o.charsAfter ?? o.chars_after ?? 0) || 0,
        },
      };
    case "subagent.spawn":
      return {
        event: {
          ...base,
          type: "subagent.spawn",
          subagentId: String(o.subagentId ?? o.subagent_id ?? ""),
          name: String(o.name ?? ""),
          role: String(o.role ?? ""),
          model: String(o.model ?? ""),
          hasHandoffContext: Boolean(o.hasHandoffContext ?? o.has_handoff_context),
        },
      };
    case "subagent.done":
      return {
        event: {
          ...base,
          type: "subagent.done",
          subagentId: String(o.subagentId ?? o.subagent_id ?? ""),
          name: String(o.name ?? ""),
          role: String(o.role ?? ""),
          model: String(o.model ?? ""),
          ok: Boolean(o.ok),
          durationMs: Number(o.durationMs ?? o.duration_ms ?? 0) || 0,
          roundsUsed: Number(o.roundsUsed ?? o.rounds_used ?? 0) || 0,
          findingsChars: Number(o.findingsChars ?? o.findings_chars ?? 0) || 0,
          ...(typeof o.error === "string" && o.error ? { error: o.error } : {}),
        },
      };
    case "turn.end":
      return {
        event: {
          ...base,
          type: "turn.end",
          provider: String(o.provider ?? ""),
          model: String(o.model ?? ""),
          rounds: Number(o.rounds ?? 1) || 1,
          latencyMs: Number(o.latencyMs ?? o.latency_ms ?? 0) || 0,
          ...(typeof (o.promptTokens ?? o.prompt_tokens) === "number"
            ? { promptTokens: Number(o.promptTokens ?? o.prompt_tokens) }
            : {}),
          ...(typeof (o.completionTokens ?? o.completion_tokens) === "number"
            ? { completionTokens: Number(o.completionTokens ?? o.completion_tokens) }
            : {}),
          ...(typeof (o.cachedTokens ?? o.cached_tokens) === "number"
            ? { cachedTokens: Number(o.cachedTokens ?? o.cached_tokens) }
            : {}),
          ...(typeof (o.totalTokens ?? o.total_tokens) === "number"
            ? { totalTokens: Number(o.totalTokens ?? o.total_tokens) }
            : {}),
          ...(typeof (o.estimatedCostUsd ?? o.estimated_cost_usd) === "number"
            ? { estimatedCostUsd: Number(o.estimatedCostUsd ?? o.estimated_cost_usd) }
            : {}),
          toolCallsCount: Number(o.toolCallsCount ?? o.tool_calls_count ?? 0) || 0,
          workspaceMutated: Boolean(o.workspaceMutated ?? o.workspace_mutated),
        },
      };
    case "turn.error":
      return {
        event: {
          ...base,
          type: "turn.error",
          ...(typeof o.provider === "string" ? { provider: o.provider } : {}),
          ...(typeof o.model === "string" ? { model: o.model } : {}),
          error: String(o.error ?? "Error desconocido"),
        },
      };
  }
}
