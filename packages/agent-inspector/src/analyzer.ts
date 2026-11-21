import {
  parseTraceLine,
  type AgentTraceEvent,
  type CompactionMethod,
  type DeliveryState,
} from "../../contracts/src/index.ts";

export interface DiagnosticAlert {
  severity: "info" | "warning" | "critical";
  code:
    | "COMPACTION_FALLBACK"
    | "HIGH_CONTEXT_UTILIZATION"
    | "REPEATED_TOOL_FAILURE"
    | "UNVERIFIED_MUTATION"
    | "SUBAGENT_ERROR"
    | "TURN_ERROR"
    | "AGGRESSIVE_PRUNING";
  message: string;
  turnId?: string;
}

export interface ToolStatsSummary {
  tool: string;
  calls: number;
  okCount: number;
  errorCount: number;
  avgDurationMs: number;
  totalOutputChars: number;
  dispositions: Partial<Record<DeliveryState, number>>;
}

export interface TurnTimelineSummary {
  turnId: string;
  startedAt: string;
  mode: string | null;
  scope: "chat" | "document";
  provider: string;
  model: string;
  userPreview?: string;
  historyCount: number;
  hasCheckpoint: boolean;
  utilizationPct?: number;
  systemPromptTokens?: number;
  historyTokens?: number;
  compaction?: {
    auto: boolean;
    method: CompactionMethod;
    fallbackReason?: string;
    compactedTurns: number;
    savedPct: number;
  };
  toolCalls: number;
  toolErrors: number;
  prunedEvents: number;
  subagents: Array<{
    name: string;
    role: string;
    ok: boolean;
    durationMs: number;
    roundsUsed: number;
    hasHandoffContext: boolean;
    error?: string;
  }>;
  rounds?: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  workspaceMutated?: boolean;
  error?: string;
}

export interface SessionAnalysisReport {
  sessionId: string;
  workspace?: string;
  totalEvents: number;
  parseWarnings: string[];
  turns: TurnTimelineSummary[];
  tools: ToolStatsSummary[];
  compactions: {
    total: number;
    llmCount: number;
    fallbackCount: number;
  };
  totals: {
    turns: number;
    toolCalls: number;
    toolErrors: number;
    subagents: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    avgLatencyMs: number;
  };
  alerts: DiagnosticAlert[];
}

export function parseTraceJsonl(content: string): {
  events: AgentTraceEvent[];
  warnings: string[];
} {
  const lines = content.split(/\r?\n/);
  const events: AgentTraceEvent[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const res = parseTraceLine(lines[i], i + 1);
    if (res.warning) warnings.push(res.warning);
    if (res.event) events.push(res.event);
  }
  return { events, warnings };
}

export function analyzeTraceEvents(
  events: readonly AgentTraceEvent[],
  parseWarnings: readonly string[] = []
): SessionAnalysisReport {
  let sessionId = "unknown";
  let workspace: string | undefined;

  const turnsById = new Map<string, TurnTimelineSummary>();
  const turnOrder: string[] = [];
  const toolAcc = new Map<
    string,
    {
      calls: number;
      okCount: number;
      errorCount: number;
      durationSum: number;
      outputCharsSum: number;
      dispositions: Partial<Record<DeliveryState, number>>;
    }
  >();
  const subagentHandoffById = new Map<string, boolean>();
  const failStreakByTurnTool = new Map<string, number>();

  const alerts: DiagnosticAlert[] = [];
  let compactionsTotal = 0;
  let compactionsLlm = 0;
  let compactionsFallback = 0;

  const ensureTurn = (turnId: string, ts: string): TurnTimelineSummary => {
    let existing = turnsById.get(turnId);
    if (!existing) {
      existing = {
        turnId,
        startedAt: ts,
        mode: null,
        scope: "chat",
        provider: "",
        model: "",
        historyCount: 0,
        hasCheckpoint: false,
        toolCalls: 0,
        toolErrors: 0,
        prunedEvents: 0,
        subagents: [],
      };
      turnsById.set(turnId, existing);
      turnOrder.push(turnId);
    }
    return existing;
  };

  for (const ev of events) {
    if (sessionId === "unknown" && ev.sessionId) {
      sessionId = ev.sessionId;
    }
    const turnId = ev.turnId ?? "turn_unknown";

    switch (ev.type) {
      case "trace.meta":
        if (ev.workspace) workspace = ev.workspace;
        break;
      case "turn.start": {
        const t = ensureTurn(turnId, ev.ts);
        t.startedAt = ev.ts || t.startedAt;
        t.mode = ev.mode ?? null;
        t.scope = ev.scope;
        t.provider = ev.provider;
        t.model = ev.model;
        t.historyCount = ev.historyCount;
        t.hasCheckpoint = ev.hasCheckpoint;
        if (ev.userPreview) t.userPreview = ev.userPreview;
        break;
      }
      case "context.budget": {
        const t = ensureTurn(turnId, ev.ts);
        t.utilizationPct = ev.utilizationPct;
        t.systemPromptTokens = ev.systemPromptTokens;
        t.historyTokens = ev.historyTokens;
        if (ev.utilizationPct >= 75) {
          alerts.push({
            severity: ev.utilizationPct >= 90 ? "critical" : "warning",
            code: "HIGH_CONTEXT_UTILIZATION",
            turnId,
            message: `Uso alto de ventana de contexto (${ev.utilizationPct.toFixed(1)}% de ${ev.modelContextWindow} tokens; system=${ev.systemPromptTokens}, history=${ev.historyTokens}).`,
          });
        }
        break;
      }
      case "context.compacted": {
        const t = ensureTurn(turnId, ev.ts);
        compactionsTotal += 1;
        if (ev.method === "llm") compactionsLlm += 1;
        else compactionsFallback += 1;
        t.compaction = {
          auto: ev.auto,
          method: ev.method,
          ...(ev.fallbackReason ? { fallbackReason: ev.fallbackReason } : {}),
          compactedTurns: ev.compactedTurns,
          savedPct: ev.savedPct,
        };
        if (ev.method === "deterministic_fallback") {
          alerts.push({
            severity: "critical",
            code: "COMPACTION_FALLBACK",
            turnId,
            message: `Compactación cayó al fallback determinístico (${ev.fallbackReason ?? "motivo no reportado"}). Revisa la llamada al LLM compactador.`,
          });
        }
        break;
      }
      case "tool.call":
        ensureTurn(turnId, ev.ts);
        break;
      case "tool.result": {
        const t = ensureTurn(turnId, ev.ts);
        t.toolCalls += 1;
        if (!ev.ok) t.toolErrors += 1;

        const stat = toolAcc.get(ev.tool) ?? {
          calls: 0,
          okCount: 0,
          errorCount: 0,
          durationSum: 0,
          outputCharsSum: 0,
          dispositions: {},
        };
        stat.calls += 1;
        if (ev.ok) stat.okCount += 1;
        else stat.errorCount += 1;
        stat.durationSum += ev.durationMs;
        stat.outputCharsSum += ev.outputChars;
        if (ev.disposition) {
          const d = ev.disposition.delivery;
          stat.dispositions[d] = (stat.dispositions[d] ?? 0) + 1;
          if (d === "delivered_unverified" && !ev.ok) {
            alerts.push({
              severity: "warning",
              code: "UNVERIFIED_MUTATION",
              turnId,
              message: `Herramienta '${ev.tool}' terminó en 'delivered_unverified' (verifica estado antes de repetir).`,
            });
          }
        }
        toolAcc.set(ev.tool, stat);

        const streakKey = `${turnId}::${ev.tool}`;
        if (!ev.ok) {
          const nextStreak = (failStreakByTurnTool.get(streakKey) ?? 0) + 1;
          failStreakByTurnTool.set(streakKey, nextStreak);
          if (nextStreak === 2) {
            alerts.push({
              severity: "warning",
              code: "REPEATED_TOOL_FAILURE",
              turnId,
              message: `La herramienta '${ev.tool}' falló repetidamente en el mismo turno (${ev.error ?? "sin detalle"}).`,
            });
          }
        } else {
          failStreakByTurnTool.set(streakKey, 0);
        }
        break;
      }
      case "tool.pruned": {
        const t = ensureTurn(turnId, ev.ts);
        t.prunedEvents += ev.prunedCount;
        if (ev.charsBefore > 0 && ev.charsAfter / ev.charsBefore < 0.1 && ev.prunedCount >= 3) {
          alerts.push({
            severity: "info",
            code: "AGGRESSIVE_PRUNING",
            turnId,
            message: `Se podaron ${ev.prunedCount} salidas de herramientas en ronda ${ev.round} (${ev.charsBefore} -> ${ev.charsAfter} chars).`,
          });
        }
        break;
      }
      case "subagent.spawn":
        ensureTurn(turnId, ev.ts);
        subagentHandoffById.set(ev.subagentId, ev.hasHandoffContext);
        break;
      case "subagent.done": {
        const t = ensureTurn(turnId, ev.ts);
        t.subagents.push({
          name: ev.name,
          role: ev.role,
          ok: ev.ok,
          durationMs: ev.durationMs,
          roundsUsed: ev.roundsUsed,
          hasHandoffContext: subagentHandoffById.get(ev.subagentId) ?? false,
          ...(ev.error ? { error: ev.error } : {}),
        });
        if (!ev.ok) {
          alerts.push({
            severity: "warning",
            code: "SUBAGENT_ERROR",
            turnId,
            message: `Sub-agente '${ev.name}' falló: ${ev.error ?? "error desconocido"}.`,
          });
        }
        break;
      }
      case "turn.end": {
        const t = ensureTurn(turnId, ev.ts);
        if (ev.provider) t.provider = ev.provider;
        if (ev.model) t.model = ev.model;
        t.rounds = ev.rounds;
        t.latencyMs = ev.latencyMs;
        t.promptTokens = ev.promptTokens;
        t.completionTokens = ev.completionTokens;
        t.cachedTokens = ev.cachedTokens;
        t.totalTokens = ev.totalTokens;
        t.estimatedCostUsd = ev.estimatedCostUsd;
        t.workspaceMutated = ev.workspaceMutated;
        break;
      }
      case "turn.error": {
        const t = ensureTurn(turnId, ev.ts);
        t.error = ev.error;
        alerts.push({
          severity: "critical",
          code: "TURN_ERROR",
          turnId,
          message: `Error en turno: ${ev.error}`,
        });
        break;
      }
    }
  }

  const turns = turnOrder.map((id) => turnsById.get(id)!);
  const tools: ToolStatsSummary[] = Array.from(toolAcc.entries())
    .map(([tool, s]) => ({
      tool,
      calls: s.calls,
      okCount: s.okCount,
      errorCount: s.errorCount,
      avgDurationMs: s.calls > 0 ? Math.round(s.durationSum / s.calls) : 0,
      totalOutputChars: s.outputCharsSum,
      dispositions: s.dispositions,
    }))
    .sort((a, b) => b.calls - a.calls);

  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let toolCallsTotal = 0;
  let toolErrorsTotal = 0;
  let subagentsTotal = 0;

  for (const t of turns) {
    promptTokens += t.promptTokens ?? 0;
    completionTokens += t.completionTokens ?? 0;
    cachedTokens += t.cachedTokens ?? 0;
    totalTokens += t.totalTokens ?? 0;
    estimatedCostUsd += t.estimatedCostUsd ?? 0;
    if (typeof t.latencyMs === "number" && t.latencyMs > 0) {
      latencySum += t.latencyMs;
      latencyCount += 1;
    }
    toolCallsTotal += t.toolCalls;
    toolErrorsTotal += t.toolErrors;
    subagentsTotal += t.subagents.length;
  }

  return {
    sessionId,
    ...(workspace ? { workspace } : {}),
    totalEvents: events.length,
    parseWarnings: [...parseWarnings],
    turns,
    tools,
    compactions: {
      total: compactionsTotal,
      llmCount: compactionsLlm,
      fallbackCount: compactionsFallback,
    },
    totals: {
      turns: turns.length,
      toolCalls: toolCallsTotal,
      toolErrors: toolErrorsTotal,
      subagents: subagentsTotal,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
    },
    alerts,
  };
}

export function formatAnalysisReport(report: SessionAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`=== XOOK Agent Inspector · Sesión ${report.sessionId} ===`);
  if (report.workspace) lines.push(`Workspace: ${report.workspace}`);
  lines.push(
    `Turnos: ${report.totals.turns} | Herramientas: ${report.totals.toolCalls} (${report.totals.toolErrors} err) | Sub-agentes: ${report.totals.subagents} | Latencia media: ${report.totals.avgLatencyMs} ms`
  );
  lines.push(
    `Tokens: total=${report.totals.totalTokens.toLocaleString("en-US")} (prompt=${report.totals.promptTokens.toLocaleString("en-US")}, completion=${report.totals.completionTokens.toLocaleString("en-US")}, cached=${report.totals.cachedTokens.toLocaleString("en-US")}) | Costo est.: $${report.totals.estimatedCostUsd.toFixed(4)}`
  );
  lines.push(
    `Compactaciones: ${report.compactions.total} (LLM: ${report.compactions.llmCount}, Fallback: ${report.compactions.fallbackCount})`
  );

  if (report.alerts.length > 0) {
    lines.push("");
    lines.push("Alertas detectadas:");
    for (const a of report.alerts) {
      const tag = a.severity === "critical" ? "[CRÍTICO]" : a.severity === "warning" ? "[AVISO]" : "[INFO]";
      lines.push(`  ${tag} (${a.code}${a.turnId ? ` · ${a.turnId}` : ""}) ${a.message}`);
    }
  } else {
    lines.push("");
    lines.push("Alertas detectadas: ninguna (salud de contexto y herramientas estable).");
  }

  if (report.tools.length > 0) {
    lines.push("");
    lines.push("Desglose de herramientas:");
    for (const tool of report.tools) {
      const okPct = tool.calls > 0 ? Math.round((tool.okCount / tool.calls) * 100) : 100;
      const dispSummary = Object.entries(tool.dispositions)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      lines.push(
        `  - ${tool.tool}: ${tool.calls}x (${okPct}% ok, ~${tool.avgDurationMs}ms, ${tool.totalOutputChars} chars)` +
          (dispSummary ? ` [${dispSummary}]` : "")
      );
    }
  }

  if (report.turns.length > 0) {
    lines.push("");
    lines.push("Línea de tiempo por turno:");
    for (const t of report.turns) {
      const modeTag = t.mode ? `/${t.mode}` : "chat";
      const utilTag = typeof t.utilizationPct === "number" ? `ctx=${t.utilizationPct.toFixed(1)}%` : "ctx=?";
      const cmpTag = t.compaction
        ? ` | compact=${t.compaction.method}(-${t.compaction.savedPct}%)`
        : "";
      const subTag = t.subagents.length > 0 ? ` | subagentes=${t.subagents.length}` : "";
      const preview = t.userPreview ? ` "${t.userPreview.slice(0, 70)}"` : "";
      lines.push(
        `  • [${t.turnId}] ${modeTag} (${t.provider}/${t.model}) · ${utilTag} · rondas=${t.rounds ?? "?"} · tools=${t.toolCalls}(err=${t.toolErrors}) · ${t.latencyMs ?? 0}ms${cmpTag}${subTag}${preview}`
      );
      if (t.error) {
        lines.push(`      ↳ ERROR: ${t.error}`);
      }
    }
  }

  if (report.parseWarnings.length > 0) {
    lines.push("");
    lines.push(`Advertencias de lectura JSONL (${report.parseWarnings.length}):`);
    for (const w of report.parseWarnings.slice(0, 5)) {
      lines.push(`  - ${w}`);
    }
  }

  return lines.join("\n");
}
