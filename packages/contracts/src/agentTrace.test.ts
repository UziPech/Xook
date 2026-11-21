import test from "node:test";
import assert from "node:assert/strict";
import { parseTraceLine } from "./agentTrace.ts";

test("parseTraceLine parses Python snake_case tool.result event with disposition", () => {
  const line = JSON.stringify({
    schema: 1,
    type: "tool.result",
    ts: "2026-11-21T18:00:00Z",
    session_id: "conv_123",
    turn_id: "turn_1",
    round: 2,
    tool_call_id: "call_9",
    tool: "workspace_edit_file",
    target: "agente/notas.md",
    ok: true,
    duration_ms: 42,
    output_chars: 180,
    disposition: { delivery: "delivered_verified", retry: "unsafe", verified: true },
  });
  const res = parseTraceLine(line, 4);
  assert.equal(res.warning, undefined);
  assert.ok(res.event);
  assert.equal(res.event.type, "tool.result");
  if (res.event.type === "tool.result") {
    assert.equal(res.event.sessionId, "conv_123");
    assert.equal(res.event.durationMs, 42);
    assert.equal(res.event.disposition?.delivery, "delivered_verified");
  }
});

test("parseTraceLine tolerates truncated tail with counted warning", () => {
  const res = parseTraceLine('{"schema":1,"type":"turn.end","ts":', 9);
  assert.equal(res.event, null);
  assert.match(res.warning ?? "", /Línea 9/);
});
