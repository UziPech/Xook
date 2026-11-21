import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeContextCheckpoint,
  sanitizeTurnWorkingMemory,
} from "./contextCheckpoint.ts";

test("sanitizeContextCheckpoint normalizes snake_case fields and compactionMethod", () => {
  const ckpt = sanitizeContextCheckpoint({
    objective: "Analizar el monorepo de XOOK",
    active_decisions: ["Usar npm workspaces"],
    superseded_discarded: ["Electron"],
    active_artifacts: ["packages/contracts/src/agentTrace.ts"],
    document_state: "Fase 1 en curso",
    pending_items: ["Agregar inspector"],
    compacted_turns: 12,
    tokens_before: 18000,
    tokens_after: 1200,
    saved_pct: 93,
    compaction_method: "llm",
  });

  assert.ok(ckpt);
  assert.equal(ckpt.compactionMethod, "llm");
  assert.deepEqual(ckpt.activeArtifacts, ["packages/contracts/src/agentTrace.ts"]);
  assert.equal(ckpt.savedPct, 93);
});

test("sanitizeTurnWorkingMemory drops empty payloads and preserves files/subagents", () => {
  assert.equal(sanitizeTurnWorkingMemory({}), null);
  const mem = sanitizeTurnWorkingMemory({
    files_read: ["src-brain/main_sidecar.py"],
    files_modified: ["src-brain/slices/ai_service/context_manager.py"],
    commands_run: ["pytest (exit 0)"],
    subagents: [{ name: "Auditor", role: "Revisor", ok: true, summary: "Sin fallos críticos" }],
    compact_note: "Leyó main_sidecar.py y editó context_manager.py",
  });
  assert.ok(mem);
  assert.deepEqual(mem.filesRead, ["src-brain/main_sidecar.py"]);
  assert.equal(mem.subagents.length, 1);
  assert.equal(mem.subagents[0].name, "Auditor");
});
