import test from "node:test";
import assert from "node:assert/strict";
import {
  appendReplyDeltaToTimeline,
  applyCommandFinishedEvent,
  applyCommandFinishedInTimeline,
  finalizeChatTimeline,
  groupTimelineForRender,
  markPermissionErrorInTimeline,
  resolvePermissionInTimeline,
  sanitizeTimelineForStorage,
  upsertPermissionRequestInTimeline,
  type ChatTimelineSegment,
  type CommandFinishedEvent,
  type CommandPermissionRequestEvent,
} from "./chatTimeline.ts";

function makeReq(overrides: Partial<CommandPermissionRequestEvent> = {}): CommandPermissionRequestEvent {
  return {
    requestId: "req_1",
    streamId: "str_1",
    commandId: "cmd_1",
    purpose: "Revisar estado de Git",
    command: "git status --short",
    cwdRel: ".",
    riskLevel: "low",
    program: "git",
    patternSuggestion: "git",
    ...overrides,
  };
}

function makeFinished(overrides: Partial<CommandFinishedEvent> = {}): CommandFinishedEvent {
  return {
    requestId: "req_1",
    streamId: "str_1",
    commandId: "cmd_1",
    purpose: "Revisar estado de Git",
    command: "git status --short",
    cwdRel: ".",
    riskLevel: "low",
    status: "finished",
    result: {
      ok: true,
      commandId: "cmd_1",
      status: "finished",
      permissionMode: "once",
      exitCode: 0,
      durationMs: 57,
      stdout: " M src-ui/components/XoxStar.tsx",
      stderr: "",
      truncated: false,
    },
    ...overrides,
  };
}

test("interleaves text -> command -> text -> command -> text in strict chronological order", () => {
  let timeline: ChatTimelineSegment[] = [];

  // Ronda 0: habla con el usuario y lanza comando 1
  timeline = appendReplyDeltaToTimeline(
    timeline,
    "Voy a revisar esa carpeta y el estado de Git de inmediato."
  );
  timeline = upsertPermissionRequestInTimeline(timeline, makeReq({ requestId: "req_1" }));
  timeline = resolvePermissionInTimeline(timeline, "req_1", "allow_once");
  timeline = applyCommandFinishedInTimeline(timeline, makeFinished({ requestId: "req_1" }));

  // Ronda 1: backend inyecta "\n\n" sintético antes del siguiente bloque de texto
  timeline = appendReplyDeltaToTimeline(timeline, "\n\n");
  timeline = appendReplyDeltaToTimeline(
    timeline,
    "Veo un archivo modificado, voy a revisar el diff."
  );
  timeline = upsertPermissionRequestInTimeline(
    timeline,
    makeReq({
      requestId: "req_2",
      commandId: "cmd_2",
      purpose: "Ver el detalle del único archivo modificado sin commit",
      command: "git diff",
    })
  );
  timeline = resolvePermissionInTimeline(timeline, "req_2", "allow_once");
  timeline = applyCommandFinishedInTimeline(
    timeline,
    makeFinished({
      requestId: "req_2",
      commandId: "cmd_2",
      purpose: "Ver el detalle del único archivo modificado sin commit",
      command: "git diff",
      result: {
        ok: true,
        commandId: "cmd_2",
        status: "finished",
        permissionMode: "once",
        exitCode: 0,
        durationMs: 53,
        stdout: "diff --git ...",
        stderr: "",
        truncated: false,
      },
    })
  );

  // Ronda 2: cierre tras comando 2
  timeline = appendReplyDeltaToTimeline(timeline, "\n\n");
  timeline = appendReplyDeltaToTimeline(timeline, "¿Lo dejo así o te preparo el commit?");

  const finalized = finalizeChatTimeline(
    timeline,
    "Voy a revisar esa carpeta y el estado de Git de inmediato.\n\nVeo un archivo modificado, voy a revisar el diff.\n\n¿Lo dejo así o te preparo el commit?"
  );

  assert.ok(finalized);
  assert.deepEqual(
    finalized.map((s) => s.kind),
    ["text", "command", "text", "command", "text"]
  );
  assert.equal(finalized[0].kind === "text" && finalized[0].text, "Voy a revisar esa carpeta y el estado de Git de inmediato.");
  assert.equal(finalized[1].kind === "command" && finalized[1].command.requestId, "req_1");
  assert.equal(finalized[2].kind === "text" && finalized[2].text, "Veo un archivo modificado, voy a revisar el diff.");
  assert.equal(finalized[3].kind === "command" && finalized[3].command.requestId, "req_2");
  assert.equal(finalized[4].kind === "text" && finalized[4].text, "¿Lo dejo así o te preparo el commit?");
});

test("hides pending commands from inline groups and stops streaming caret on text before pending command", () => {
  let timeline: ChatTimelineSegment[] = [];
  timeline = appendReplyDeltaToTimeline(timeline, "Voy a revisar el repo.");
  timeline = upsertPermissionRequestInTimeline(timeline, makeReq({ requestId: "req_1" }));
  timeline = resolvePermissionInTimeline(timeline, "req_1", "allow_once");
  timeline = applyCommandFinishedInTimeline(timeline, makeFinished({ requestId: "req_1" }));
  timeline = upsertPermissionRequestInTimeline(
    timeline,
    makeReq({ requestId: "req_2", purpose: "Ver el diff" })
  );

  const groups = groupTimelineForRender(timeline);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, "text");
  if (groups[0].kind === "text") {
    assert.equal(groups[0].isLastRawSegment, false);
  }
  assert.equal(groups[1].kind, "commands");
  if (groups[1].kind === "commands") {
    assert.equal(groups[1].items.length, 1);
    assert.equal(groups[1].items[0].requestId, "req_1");
  }
});

test("groups back-to-back commands cleanly while keeping text before and after", () => {
  let timeline: ChatTimelineSegment[] = [];
  timeline = appendReplyDeltaToTimeline(timeline, "Revisando...");
  timeline = applyCommandFinishedInTimeline(
    timeline,
    makeFinished({ requestId: "auto_1", command: "git status" }),
    { allowInsert: true }
  );
  timeline = applyCommandFinishedInTimeline(
    timeline,
    makeFinished({ requestId: "auto_2", command: "git diff" }),
    { allowInsert: true }
  );
  timeline = appendReplyDeltaToTimeline(timeline, "\n\nTodo listo.");

  const groups = groupTimelineForRender(timeline);
  assert.deepEqual(
    groups.map((g) => g.kind),
    ["text", "commands", "text"]
  );
  if (groups[1].kind === "commands") {
    assert.equal(groups[1].items.length, 2);
    assert.equal(groups[1].items[0].requestId, "auto_1");
    assert.equal(groups[1].items[1].requestId, "auto_2");
  }
  if (groups[2].kind === "text") {
    assert.equal(groups[2].isLastRawSegment, true);
  }
});

test("returns undefined from finalizeChatTimeline when a turn has no commands", () => {
  const timeline = appendReplyDeltaToTimeline([], "Hola, todo bien por aquí.");
  assert.equal(finalizeChatTimeline(timeline, "Hola, todo bien por aquí."), undefined);
});

test("appends fallback reply after commands when no text delta was streamed", () => {
  let timeline: ChatTimelineSegment[] = [];
  timeline = applyCommandFinishedInTimeline(
    timeline,
    makeFinished({ requestId: "auto_1" }),
    { allowInsert: true }
  );

  const finalized = finalizeChatTimeline(
    timeline,
    "Terminé el análisis; revisa los detalles arriba."
  );
  assert.ok(finalized);
  assert.deepEqual(
    finalized.map((s) => s.kind),
    ["command", "text"]
  );
  assert.equal(
    finalized[1].kind === "text" && finalized[1].text,
    "Terminé el análisis; revisa los detalles arriba."
  );
});

test("handles cancellation, error marking, and storage truncation cleanly", () => {
  let timeline: ChatTimelineSegment[] = [];
  timeline = appendReplyDeltaToTimeline(timeline, "Probando comando...");
  timeline = upsertPermissionRequestInTimeline(timeline, makeReq({ requestId: "req_run" }));
  timeline = resolvePermissionInTimeline(timeline, "req_run", "allow_once");
  timeline = upsertPermissionRequestInTimeline(timeline, makeReq({ requestId: "req_pend" }));

  const cancelled = finalizeChatTimeline(timeline, "Probando comando...", { cancelled: true });
  assert.ok(cancelled);
  assert.equal(cancelled.length, 2);
  assert.equal(cancelled[1].kind === "command" && cancelled[1].command.state, "error");

  const withErr = markPermissionErrorInTimeline(timeline, "req_run", "Fallo IPC");
  const errSeg = withErr.find((s) => s.kind === "command" && s.command.requestId === "req_run");
  assert.equal(errSeg?.kind === "command" && errSeg.command.error, "Fallo IPC");

  const hugeOut = "x".repeat(6000);
  const finishedTimeline = applyCommandFinishedInTimeline(
    [],
    makeFinished({
      requestId: "big_1",
      result: {
        ok: true,
        commandId: "cmd_big",
        status: "finished",
        permissionMode: "always_rule",
        exitCode: 0,
        durationMs: 12,
        stdout: hugeOut,
        stderr: "",
        truncated: false,
      },
    }),
    { allowInsert: true }
  );
  const stored = sanitizeTimelineForStorage(finishedTimeline, 200);
  assert.ok(stored);
  const storedOut =
    stored[0].kind === "command" ? stored[0].command.finished?.result?.stdout ?? "" : "";
  assert.ok(storedOut.length < 250);
  assert.ok(storedOut.includes("recortado al guardar"));
});

test("applyCommandFinishedEvent optionally inserts auto-approved commands when allowInsert is true", () => {
  const withoutInsert = applyCommandFinishedEvent([], makeFinished({ requestId: "auto_1" }));
  assert.equal(withoutInsert.length, 0);

  const withInsert = applyCommandFinishedEvent([], makeFinished({ requestId: "auto_1" }), {
    allowInsert: true,
  });
  assert.equal(withInsert.length, 1);
  assert.equal(withInsert[0].state, "finished");
  assert.equal(withInsert[0].requestId, "auto_1");
});
