import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRuntimeMode,
  isRuntimeModeAbove,
  requiresHitlApproval,
} from "./agentPolicy.ts";

test("autonomy ladder enforces ceilings strictly", () => {
  assert.equal(isRuntimeModeAbove("full-access", "auto"), true);
  assert.equal(isRuntimeModeAbove("auto-accept-edits", "auto"), false);
  assert.equal(clampRuntimeMode("full-access", "auto-accept-edits"), "auto-accept-edits");
  assert.equal(clampRuntimeMode("approval-required", "auto"), "approval-required");
});

test("destructive operations always require HITL even in full-access", () => {
  assert.equal(requiresHitlApproval("destructive", "full-access"), true);
  assert.equal(requiresHitlApproval("read_safe", "approval-required"), false);
  assert.equal(requiresHitlApproval("write_protected_hitl", "auto"), true);
  assert.equal(requiresHitlApproval("command_exec", "auto-accept-edits"), true);
  assert.equal(requiresHitlApproval("command_exec", "auto"), false);
});
