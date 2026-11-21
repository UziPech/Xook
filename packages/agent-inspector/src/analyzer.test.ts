import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTraceEvents,
  formatAnalysisReport,
  parseTraceJsonl,
} from "./analyzer.ts";

test("analyzeTraceEvents flags compaction fallback, high context usage, and tool failures", () => {
  const jsonl = [
    JSON.stringify({
      schema: 1,
      type: "trace.meta",
      ts: "2026-11-21T18:00:00Z",
      session_id: "conv_demo",
      workspace: "/tmp/ws",
    }),
    JSON.stringify({
      schema: 1,
      type: "turn.start",
      ts: "2026-11-21T18:00:01Z",
      session_id: "conv_demo",
      turn_id: "turn_1",
      mode: "agent",
      scope: "chat",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      history_count: 14,
      has_checkpoint: true,
      user_preview: "Analiza la arquitectura del monorepo",
    }),
    JSON.stringify({
      schema: 1,
      type: "context.budget",
      ts: "2026-11-21T18:00:01Z",
      session_id: "conv_demo",
      turn_id: "turn_1",
      model_context_window: 128000,
      system_prompt_tokens: 7200,
      history_tokens: 96000,
      checkpoint_tokens: 800,
      tool_defs_count: 28,
      utilization_pct: 81.2,
    }),
    JSON.stringify({
      schema: 1,
      type: "context.compacted",
      ts: "2026-11-21T18:00:02Z",
      session_id: "conv_demo",
      turn_id: "turn_1",
      scope: "chat",
      auto: true,
      method: "deterministic_fallback",
      fallback_reason: "HTTP 503",
      compacted_turns: 8,
      kept_recent_turns: 6,
      tokens_before: 12000,
      tokens_after: 900,
      saved_pct: 92,
    }),
    JSON.stringify({
      schema: 1,
      type: "tool.result",
      ts: "2026-11-21T18:00:03Z",
      session_id: "conv_demo",
      turn_id: "turn_1",
      round: 0,
      tool_call_id: "tc_1",
      tool: "run_workspace_command",
      ok: false,
      duration_ms: 510,
      output_chars: 120,
      disposition: { delivery: "delivered_unverified", retry: "verify_first" },
      error: "timeout",
    }),
    JSON.stringify({
      schema: 1,
      type: "turn.end",
      ts: "2026-11-21T18:00:05Z",
      session_id: "conv_demo",
      turn_id: "turn_1",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      rounds: 2,
      latency_ms: 4000,
      prompt_tokens: 11200,
      completion_tokens: 850,
      cached_tokens: 4000,
      total_tokens: 12050,
      estimated_cost_usd: 0.012,
      tool_calls_count: 1,
      workspace_mutated: false,
    }),
    '{"broken_tail": true',
  ].join("\n");

  const parsed = parseTraceJsonl(jsonl);
  assert.equal(parsed.warnings.length, 1);

  const report = analyzeTraceEvents(parsed.events, parsed.warnings);
  assert.equal(report.sessionId, "conv_demo");
  assert.equal(report.compactions.fallbackCount, 1);
  assert.equal(report.totals.toolErrors, 1);
  const codes = report.alerts.map((a) => a.code);
  assert.ok(codes.includes("HIGH_CONTEXT_UTILIZATION"));
  assert.ok(codes.includes("COMPACTION_FALLBACK"));
  assert.ok(codes.includes("UNVERIFIED_MUTATION"));

  const text = formatAnalysisReport(report);
  assert.match(text, /XOOK Agent Inspector/);
  assert.match(text, /COMPACTION_FALLBACK/);
});
