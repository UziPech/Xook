export type CommandPermissionDecisionKind = "allow_once" | "allow_always" | "deny";

export interface CommandExecutionResult {
  ok: boolean;
  commandId: string;
  status: string;
  permissionMode: string;
  exitCode?: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logPath?: string | null;
  error?: string | null;
}

export type CommandActionKind =
  | "command"
  | "external_command"
  | "open_app"
  | "os_notes_read"
  | "os_notes_write"
  | "os_calendar_read"
  | "os_calendar_write"
  | "ext_fs_list"
  | "ext_fs_search"
  | "ext_fs_read"
  | "ext_fs_write"
  | "ext_fs_edit"
  | "ext_fs_mkdir"
  | "desktop_ui_act"
  | "desktop_ui_type"
  | "desktop_ui_focus"
  | string;

export interface CommandPermissionRequestEvent {
  requestId: string;
  streamId?: string | null;
  commandId: string;
  kind?: CommandActionKind;
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  program: string;
  patternSuggestion: string;
  allowAlwaysAllowed?: boolean;
  isExternal?: boolean;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
}

export interface CommandFinishedEvent {
  requestId: string;
  streamId?: string | null;
  commandId?: string;
  kind?: CommandActionKind;
  purpose?: string;
  command?: string;
  cwdRel?: string;
  riskLevel?: string;
  status?: string;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
  result?: CommandExecutionResult;
  error?: string;
}

export interface CommandPermissionUiItem {
  requestId: string;
  streamId?: string | null;
  commandId?: string;
  kind?: CommandActionKind;
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  program?: string;
  patternSuggestion?: string;
  allowAlwaysAllowed?: boolean;
  isExternal?: boolean;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
  state: "pending" | "running" | "finished" | "denied" | "blocked" | "error";
  permissionChoice?: CommandPermissionDecisionKind;
  finished?: CommandFinishedEvent;
  error?: string;
}

export interface ChatTimelineTextSegment {
  id: string;
  kind: "text";
  text: string;
}

export interface ChatTimelineCommandSegment {
  id: string;
  kind: "command";
  command: CommandPermissionUiItem;
}

export type ChatTimelineSegment = ChatTimelineTextSegment | ChatTimelineCommandSegment;

export type ChatTimelineRenderGroup =
  | {
      kind: "text";
      id: string;
      text: string;
      isLastRawSegment: boolean;
    }
  | {
      kind: "commands";
      id: string;
      items: CommandPermissionUiItem[];
    };

export function resolveFinishedCommandState(
  ev: CommandFinishedEvent
): CommandPermissionUiItem["state"] {
  if (ev.status === "blocked") return "blocked";
  if (ev.status === "denied") return "denied";
  if (ev.result?.ok === false && ev.result.status !== "finished") return "error";
  return "finished";
}

export function buildPermissionUiItemFromRequest(
  req: CommandPermissionRequestEvent
): CommandPermissionUiItem {
  return {
    requestId: req.requestId,
    streamId: req.streamId,
    commandId: req.commandId,
    kind: req.kind,
    purpose: req.purpose,
    command: req.command,
    cwdRel: req.cwdRel,
    riskLevel: req.riskLevel,
    program: req.program,
    patternSuggestion: req.patternSuggestion,
    allowAlwaysAllowed: req.allowAlwaysAllowed,
    isExternal: req.isExternal,
    appName: req.appName,
    bundleId: req.bundleId,
    appPath: req.appPath,
    detailPreview: req.detailPreview,
    state: "pending",
  };
}

export function buildPermissionUiItemFromFinished(
  ev: CommandFinishedEvent
): CommandPermissionUiItem {
  return {
    requestId: ev.requestId,
    streamId: ev.streamId,
    commandId: ev.commandId ?? ev.result?.commandId,
    kind: ev.kind,
    purpose: ev.purpose ?? "",
    command: ev.command ?? "",
    cwdRel: ev.cwdRel ?? ".",
    riskLevel: ev.riskLevel ?? (ev.status === "blocked" ? "blocked" : "low"),
    appName: ev.appName,
    bundleId: ev.bundleId,
    appPath: ev.appPath,
    detailPreview: ev.detailPreview,
    state: resolveFinishedCommandState(ev),
    finished: ev,
    error: ev.error ?? ev.result?.error ?? undefined,
  };
}

function hasFinishedMetadata(ev: CommandFinishedEvent): boolean {
  return Boolean(
    ev.command?.trim() ||
      ev.purpose?.trim() ||
      ev.appName?.trim() ||
      ev.detailPreview?.trim()
  );
}

export function mergeCommandFinishedIntoItem(
  item: CommandPermissionUiItem,
  ev: CommandFinishedEvent
): CommandPermissionUiItem {
  return {
    ...item,
    commandId: ev.commandId ?? ev.result?.commandId ?? item.commandId,
    kind: ev.kind ?? item.kind,
    purpose: ev.purpose || item.purpose,
    command: ev.command || item.command,
    cwdRel: ev.cwdRel || item.cwdRel,
    riskLevel: ev.riskLevel || item.riskLevel,
    appName: ev.appName ?? item.appName,
    bundleId: ev.bundleId ?? item.bundleId,
    appPath: ev.appPath ?? item.appPath,
    detailPreview: ev.detailPreview ?? item.detailPreview,
    state: resolveFinishedCommandState(ev),
    finished: ev,
    error: ev.error ?? ev.result?.error ?? item.error,
  };
}

export function applyPermissionRequestItem(
  prev: CommandPermissionUiItem[],
  req: CommandPermissionRequestEvent
): CommandPermissionUiItem[] {
  const item = buildPermissionUiItemFromRequest(req);
  const idx = prev.findIndex((p) => p.requestId === req.requestId);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = item;
    return next;
  }
  return [...prev, item];
}

export function applyCommandFinishedEvent(
  prev: CommandPermissionUiItem[],
  ev: CommandFinishedEvent,
  options?: { allowInsert?: boolean }
): CommandPermissionUiItem[] {
  const exists = prev.some((p) => p.requestId === ev.requestId);
  if (!exists) {
    if (options?.allowInsert && hasFinishedMetadata(ev)) {
      return [...prev, buildPermissionUiItemFromFinished(ev)];
    }
    return prev;
  }
  return prev.map((p) =>
    p.requestId === ev.requestId ? mergeCommandFinishedIntoItem(p, ev) : p
  );
}

export function applyPermissionResolution(
  prev: CommandPermissionUiItem[],
  requestId: string,
  decision: CommandPermissionDecisionKind
): CommandPermissionUiItem[] {
  return prev.map((item) =>
    item.requestId === requestId
      ? {
          ...item,
          permissionChoice: decision,
          state: decision === "deny" ? "denied" : "running",
        }
      : item
  );
}

function nextTextSegmentId(segments: ChatTimelineSegment[]): string {
  let maxNum = 0;
  for (const seg of segments) {
    if (seg.kind !== "text") continue;
    const match = /^seg_txt_(\d+)$/.exec(seg.id);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return `seg_txt_${maxNum + 1}`;
}

/**
 * Añade texto de streaming al último bloque de texto o abre un nuevo bloque después de un comando.
 * Ignora saltos de línea sintéticos (`\n\n`) al abrir un bloque nuevo tras un comando.
 */
export function appendReplyDeltaToTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  delta: string
): ChatTimelineSegment[] {
  const base = timeline ? [...timeline] : [];
  if (!delta) return base;

  const last = base[base.length - 1];
  if (last && last.kind === "text") {
    base[base.length - 1] = {
      ...last,
      text: last.text + delta,
    };
    return base;
  }

  const trimmedLeadingNewlines = delta.replace(/^\n+/, "");
  if (!trimmedLeadingNewlines) {
    return base;
  }

  base.push({
    id: nextTextSegmentId(base),
    kind: "text",
    text: trimmedLeadingNewlines,
  });
  return base;
}

export function upsertPermissionRequestInTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  req: CommandPermissionRequestEvent
): ChatTimelineSegment[] {
  const base = timeline ? [...timeline] : [];
  const item = buildPermissionUiItemFromRequest(req);
  const idx = base.findIndex(
    (seg) => seg.kind === "command" && seg.command.requestId === req.requestId
  );
  if (idx >= 0) {
    const existing = base[idx];
    if (existing.kind === "command") {
      base[idx] = { ...existing, command: item };
    }
    return base;
  }
  base.push({
    id: `seg_cmd_${req.requestId}`,
    kind: "command",
    command: item,
  });
  return base;
}

export function resolvePermissionInTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  requestId: string,
  decision: CommandPermissionDecisionKind
): ChatTimelineSegment[] {
  if (!timeline || timeline.length === 0) return [];
  let changed = false;
  const next = timeline.map((seg) => {
    if (seg.kind !== "command" || seg.command.requestId !== requestId) return seg;
    changed = true;
    return {
      ...seg,
      command: {
        ...seg.command,
        permissionChoice: decision,
        state: (decision === "deny" ? "denied" : "running") as CommandPermissionUiItem["state"],
      },
    };
  });
  return changed ? next : timeline;
}

export function markPermissionErrorInTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  requestId: string,
  error: string
): ChatTimelineSegment[] {
  if (!timeline || timeline.length === 0) return [];
  let changed = false;
  const next = timeline.map((seg) => {
    if (seg.kind !== "command" || seg.command.requestId !== requestId) return seg;
    changed = true;
    return {
      ...seg,
      command: {
        ...seg.command,
        state: "error" as const,
        error,
      },
    };
  });
  return changed ? next : timeline;
}

export function applyCommandFinishedInTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  ev: CommandFinishedEvent,
  options?: { allowInsert?: boolean }
): ChatTimelineSegment[] {
  const base = timeline ? [...timeline] : [];
  const idx = base.findIndex(
    (seg) => seg.kind === "command" && seg.command.requestId === ev.requestId
  );
  if (idx >= 0) {
    const existing = base[idx];
    if (existing.kind === "command") {
      base[idx] = {
        ...existing,
        command: mergeCommandFinishedIntoItem(existing.command, ev),
      };
    }
    return base;
  }
  if (options?.allowInsert && hasFinishedMetadata(ev)) {
    base.push({
      id: `seg_cmd_${ev.requestId}`,
      kind: "command",
      command: buildPermissionUiItemFromFinished(ev),
    });
  }
  return base;
}

const DSML_BLOCK_RE = /<[｜|]DSML[｜|][\s\S]*?(?:<\/[｜|]DSML[｜|][^>]*>|$)/gi;

function stripLeakedDsml(raw: string): string {
  if (!raw || !raw.toUpperCase().includes("DSML")) return raw;
  return raw.replace(DSML_BLOCK_RE, "");
}

export function hasTimelineCommands(
  timeline: ChatTimelineSegment[] | undefined
): boolean {
  return Boolean(timeline?.some((seg) => seg.kind === "command"));
}

export function timelineHasRequestId(
  timeline: ChatTimelineSegment[] | undefined,
  requestId: string
): boolean {
  return Boolean(
    timeline?.some((seg) => seg.kind === "command" && seg.command.requestId === requestId)
  );
}

/**
 * Reconcilia el timeline cronológico al cerrar un turno (éxito, cancelación o error).
 * Si el turno no tuvo comandos, retorna `undefined` para evitar overhead en mensajes simples.
 */
export function finalizeChatTimeline(
  timeline: ChatTimelineSegment[] | undefined,
  finalReply: string,
  options?: {
    failoverNotice?: string;
    cleanText?: (raw: string) => string;
    cancelled?: boolean;
  }
): ChatTimelineSegment[] | undefined {
  if (!timeline || timeline.length === 0) return undefined;

  const cleanFn = options?.cleanText ?? ((raw: string) => raw);
  const cleaned: ChatTimelineSegment[] = [];

  for (const seg of timeline) {
    if (seg.kind === "command") {
      if (seg.command.state === "pending") {
        // Nunca dejamos una solicitud pendiente huérfana cuando el turno ya cerró
        continue;
      }
      if (options?.cancelled && seg.command.state === "running") {
        cleaned.push({
          ...seg,
          command: {
            ...seg.command,
            state: "error",
            error: seg.command.error || "Detenido por el usuario.",
          },
        });
        continue;
      }
      cleaned.push(seg);
      continue;
    }

    const stripped = stripLeakedDsml(seg.text);
    const visible = cleanFn(stripped).trim();
    if (!visible) continue;

    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.kind === "text") {
      cleaned[cleaned.length - 1] = {
        ...prev,
        text: `${prev.text}\n\n${visible}`,
      };
    } else {
      cleaned.push({ ...seg, text: visible });
    }
  }

  const hasCommands = cleaned.some((seg) => seg.kind === "command");
  if (!hasCommands) return undefined;

  const trimmedFinal = finalReply.trim();
  const textSegments = cleaned.filter((seg): seg is ChatTimelineTextSegment => seg.kind === "text");

  // Caso raro: el modelo devolvió JSON `{"reply": "..."}` en el stream y el backend lo desempaquetó
  if (
    textSegments.length === 1 &&
    trimmedFinal &&
    textSegments[0].text.startsWith("{") &&
    textSegments[0].text.includes('"reply"') &&
    !trimmedFinal.startsWith("{")
  ) {
    const idx = cleaned.findIndex((seg) => seg.id === textSegments[0].id);
    if (idx >= 0) {
      cleaned[idx] = { ...textSegments[0], text: trimmedFinal };
    }
  } else if (textSegments.length === 0 && trimmedFinal) {
    // Fallback del backend que no se emitió como delta (ej. respuesta de síntesis tras herramientas)
    cleaned.push({
      id: nextTextSegmentId(cleaned),
      kind: "text",
      text: trimmedFinal,
    });
  }

  if (options?.failoverNotice) {
    const notice = options.failoverNotice.trim();
    const alreadyPresent = cleaned.some(
      (seg) => seg.kind === "text" && seg.text.includes(notice)
    );
    if (notice && !alreadyPresent) {
      const noticeMd = `> *Nota de respaldo automático:* ${notice}`;
      if (cleaned[0]?.kind === "text") {
        cleaned[0] = {
          ...cleaned[0],
          text: `${noticeMd}\n\n${cleaned[0].text}`,
        };
      } else {
        cleaned.unshift({
          id: "seg_txt_failover",
          kind: "text",
          text: noticeMd,
        });
      }
    }
  }

  return cleaned;
}

/**
 * Agrupa segmentos consecutivos de comandos para renderizar texto y comandos
 * intercalados con ritmo visual limpio y sin cursor de streaming pegado a texto previo.
 */
export function groupTimelineForRender(
  timeline: ChatTimelineSegment[] | undefined,
  options?: { includePendingCommands?: boolean }
): ChatTimelineRenderGroup[] {
  if (!timeline || timeline.length === 0) return [];
  const includePending = Boolean(options?.includePendingCommands);
  const lastRawIdx = timeline.length - 1;
  const groups: ChatTimelineRenderGroup[] = [];

  for (let i = 0; i < timeline.length; i += 1) {
    const seg = timeline[i];
    if (seg.kind === "text") {
      if (!seg.text.trim()) continue;
      groups.push({
        kind: "text",
        id: seg.id,
        text: seg.text,
        isLastRawSegment: i === lastRawIdx,
      });
      continue;
    }

    if (!includePending && seg.command.state === "pending") {
      continue;
    }

    const prev = groups[groups.length - 1];
    if (prev && prev.kind === "commands") {
      prev.items.push(seg.command);
    } else {
      groups.push({
        kind: "commands",
        id: `grp_${seg.id}`,
        items: [seg.command],
      });
    }
  }

  return groups;
}

function truncateStoredOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[recortado al guardar]`;
}

/**
 * Sanitiza el timeline antes de persistirlo en historial de conversaciones
 * para evitar inflar el almacenamiento con salidas masivas de stdout/stderr.
 */
export function sanitizeTimelineForStorage(
  timeline: ChatTimelineSegment[] | undefined,
  maxOutputChars = 4000
): ChatTimelineSegment[] | undefined {
  if (!timeline || timeline.length === 0) return undefined;
  const sanitized: ChatTimelineSegment[] = [];

  for (const seg of timeline) {
    if (seg.kind === "text") {
      if (!seg.text.trim()) continue;
      sanitized.push(seg);
      continue;
    }
    if (seg.command.state === "pending") continue;
    const normalizedState: CommandPermissionUiItem["state"] =
      seg.command.state === "running" ? "error" : seg.command.state;
    const prevFinished = seg.command.finished;
    const safeFinished: CommandFinishedEvent | undefined = prevFinished
      ? {
          ...prevFinished,
          ...(prevFinished.result
            ? {
                result: {
                  ...prevFinished.result,
                  stdout: truncateStoredOutput(prevFinished.result.stdout ?? "", maxOutputChars),
                  stderr: truncateStoredOutput(prevFinished.result.stderr ?? "", maxOutputChars),
                },
              }
            : {}),
        }
      : undefined;

    sanitized.push({
      ...seg,
      command: {
        ...seg.command,
        state: normalizedState,
        ...(safeFinished ? { finished: safeFinished } : {}),
      },
    });
  }

  return sanitized.some((s) => s.kind === "command") ? sanitized : undefined;
}
