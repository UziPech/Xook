import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeToolDisposition,
  settleToolDisposition,
} from "./deliverySemantics.ts";

test("read-only failures settle to not_delivered and safe retry", () => {
  const disp = settleToolDisposition({ ok: false, effectClass: "read_only" });
  assert.equal(disp.delivery, "not_delivered");
  assert.equal(disp.retry, "safe");
});

test("blocked or validation errors on mutations never claim delivery", () => {
  const disp = settleToolDisposition({
    ok: false,
    effectClass: "mutating",
    status: "denied",
    reason: "Guardián bloqueó la ruta",
  });
  assert.equal(disp.delivery, "not_delivered");
  assert.equal(disp.retry, "safe");
  assert.equal(disp.reason, "Guardián bloqueó la ruta");
});

test("command execution failure or timeout requires verify_first", () => {
  const disp = settleToolDisposition({
    ok: false,
    effectClass: "command_exec",
    timedOut: true,
  });
  assert.equal(disp.delivery, "delivered_unverified");
  assert.equal(disp.retry, "verify_first");
});

test("successful mutation marks delivered_verified and unsafe to blind-retry", () => {
  const disp = settleToolDisposition({ ok: true, effectClass: "mutating" });
  assert.equal(disp.delivery, "delivered_verified");
  assert.equal(disp.retry, "unsafe");
  assert.equal(disp.verified, true);
});

test("sanitizeToolDisposition rejects malformed shapes", () => {
  assert.equal(sanitizeToolDisposition(null), null);
  assert.equal(sanitizeToolDisposition({ delivery: "bogus", retry: "safe" }), null);
  assert.deepEqual(
    sanitizeToolDisposition({ delivery: "not_delivered", retry: "safe", verified: false }),
    { delivery: "not_delivered", retry: "safe", verified: false }
  );
});
