import React, { useState } from "react";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import type {
  CommandFinishedEvent,
  CommandPermissionRequestEvent,
} from "../workspace-store/workspaceApi";

export type CommandPermissionDecisionKind = "allow_once" | "allow_always" | "deny";

export interface CommandPermissionUiItem {
  requestId: string;
  streamId?: string | null;
  commandId?: string;
  kind?:
    | "command"
    | "open_app"
    | "os_notes_read"
    | "os_notes_write"
    | "os_calendar_read"
    | "os_calendar_write"
    | string;
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  program?: string;
  patternSuggestion?: string;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
  state: "pending" | "running" | "finished" | "denied" | "blocked" | "error";
  permissionChoice?: CommandPermissionDecisionKind;
  finished?: CommandFinishedEvent;
  error?: string;
}

interface CommandPermissionCardProps {
  item: CommandPermissionUiItem;
  compact?: boolean;
  docked?: boolean;
  surfaceVariant?: "default" | "liquid";
  onResolve: (requestId: string, decision: CommandPermissionDecisionKind) => void;
}

function getRiskMeta(riskLevel: string): {
  label: string;
  badgeClass: string;
  borderClass: string;
} {
  switch (riskLevel) {
    case "blocked":
      return {
        label: "Bloqueado",
        badgeClass: "bg-white/[0.05] text-zinc-300 border-white/[0.14]",
        borderClass: "border-white/[0.12]",
      };
    case "high":
      return {
        label: "Confirmación",
        badgeClass: "bg-white/[0.06] text-zinc-200 border-white/[0.14]",
        borderClass: "border-white/[0.11]",
      };
    case "medium":
      return {
        label: "Escritura",
        badgeClass: "bg-white/[0.05] text-zinc-300 border-white/[0.11]",
        borderClass: "border-white/[0.09]",
      };
    default:
      return {
        label: "Solo lectura",
        badgeClass: "bg-white/[0.035] text-zinc-400 border-white/[0.08]",
        borderClass: "border-white/[0.08]",
      };
  }
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
    appName: req.appName,
    bundleId: req.bundleId,
    appPath: req.appPath,
    detailPreview: req.detailPreview,
    state: "pending",
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
  ev: CommandFinishedEvent
): CommandPermissionUiItem[] {
  if (!prev.some((p) => p.requestId === ev.requestId)) return prev;
  return prev.map((p) => {
    if (p.requestId !== ev.requestId) return p;
    const nextState: CommandPermissionUiItem["state"] =
      ev.status === "blocked"
        ? "blocked"
        : ev.status === "denied"
        ? "denied"
        : ev.result?.ok === false && ev.result.status !== "finished"
        ? "error"
        : "finished";
    return {
      ...p,
      kind: ev.kind ?? p.kind,
      appName: ev.appName ?? p.appName,
      bundleId: ev.bundleId ?? p.bundleId,
      appPath: ev.appPath ?? p.appPath,
      detailPreview: ev.detailPreview ?? p.detailPreview,
      state: nextState,
      finished: ev,
      error: ev.error ?? ev.result?.error ?? p.error,
    };
  });
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

interface ActionCopySpec {
  pending: string;
  running: string;
  finishedOk: string;
  finishedFail: string;
  denied: string;
  zone: string;
}

function resolveActionCopy(item: CommandPermissionUiItem): ActionCopySpec {
  const targetApp = item.appName || item.program || "la aplicación";
  const specs: Record<string, ActionCopySpec> = {
    open_app: {
      pending: `Xox solicita permiso para abrir ${targetApp}`,
      running: `Abriendo ${targetApp}...`,
      finishedOk: `Se abrió ${targetApp}`,
      finishedFail: `No se pudo abrir ${targetApp}`,
      denied: "Apertura rechazada",
      zone: "Aplicación instalada en tu Mac",
    },
    os_notes_read: {
      pending: "Xox solicita permiso para consultar tus notas en Notas",
      running: "Consultando Notas de Mac...",
      finishedOk: "Notas consultadas",
      finishedFail: "No se pudieron consultar tus notas",
      denied: "Consulta rechazada",
      zone: "App Notas de tu Mac",
    },
    os_notes_write: {
      pending: "Xox solicita permiso para crear una nota en Notas",
      running: "Guardando nota en Notas de Mac...",
      finishedOk: "Nota creada en Notas",
      finishedFail: "No se pudo crear la nota",
      denied: "Creación de nota rechazada",
      zone: "App Notas de tu Mac",
    },
    os_calendar_read: {
      pending: "Xox solicita permiso para consultar tu Calendario",
      running: "Consultando Calendario de Mac...",
      finishedOk: "Calendario consultado",
      finishedFail: "No se pudo consultar el Calendario",
      denied: "Consulta de calendario rechazada",
      zone: "App Calendario de tu Mac",
    },
    os_calendar_write: {
      pending: "Xox solicita permiso para agendar en tu Calendario",
      running: "Agendando evento en Calendario de Mac...",
      finishedOk: "Evento agendado en Calendario",
      finishedFail: "No se pudo agendar el evento",
      denied: "Agenda de evento rechazada",
      zone: "App Calendario de tu Mac",
    },
  };
  return (
    specs[item.kind ?? "command"] ?? {
      pending: "Xox solicita permiso para revisar archivos",
      running: "Ejecutando verificación en el espacio...",
      finishedOk: "Verificación completada",
      finishedFail: "La verificación terminó con observaciones",
      denied: "Acción rechazada",
      zone: item.cwdRel === "." ? "Carpeta principal del negocio" : item.cwdRel,
    }
  );
}

export const CommandPermissionCard: React.FC<CommandPermissionCardProps> = ({
  item,
  compact = false,
  docked = false,
  surfaceVariant = "default",
  onResolve,
}) => {
  const [showTechnical, setShowTechnical] = useState(false);
  const risk = getRiskMeta(item.riskLevel);
  const res = item.finished?.result;
  const outputText = [res?.stdout?.trim(), res?.stderr?.trim()]
    .filter(Boolean)
    .join("\n--- stderr ---\n");
  const isExternalAction = Boolean(item.kind && item.kind !== "command");
  const copy = resolveActionCopy(item);
  const zoneLabel = copy.zone;

  const isPending = item.state === "pending";
  const isRunning = item.state === "running";
  const isFault =
    item.state === "blocked" || item.state === "error" || item.state === "denied";
  const headline = isPending
    ? copy.pending
    : isRunning
    ? copy.running
    : item.state === "finished"
    ? res?.ok === false
      ? copy.finishedFail
      : copy.finishedOk
    : item.state === "denied"
    ? copy.denied
    : item.state === "blocked"
    ? "Bloqueado por seguridad"
    : copy.finishedFail;

  const canInspectTechnical =
    Boolean(item.command) ||
    Boolean(item.appPath) ||
    Boolean(outputText) ||
    Boolean(item.error);

  const isLiquid = surfaceVariant === "liquid";

  const technicalBlock = showTechnical && canInspectTechnical && (
    <div className="panel-fade-in mt-2 rounded-lg bg-[#07080b] border border-white/[0.08] p-2 font-mono text-[10.5px] text-zinc-300 space-y-1 overflow-x-auto">
      {isExternalAction ? (
        <>
          <div className="text-zinc-200 break-all">
            {item.kind === "open_app" ? "Aplicación" : "Integración"}:{" "}
            {item.appName || item.program || item.command}
          </div>
          <div className="text-[10px] text-zinc-500 space-y-0.5">
            {item.bundleId && <div>Identificador: {item.bundleId}</div>}
            {item.appPath && <div className="break-all">Ruta: {item.appPath}</div>}
            {item.patternSuggestion && (
              <div>
                Regla sugerida: {item.patternSuggestion} (
                {item.kind === "open_app" ? "app" : "integración"})
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div>
            <span className="text-zinc-500">$ </span>
            <span className="text-zinc-200 break-all">{item.command}</span>
          </div>
          <div className="text-[10px] text-zinc-500">
            Carpeta: {item.cwdRel}
            {item.patternSuggestion ? ` · Regla sugerida: ${item.patternSuggestion}` : ""}
            {res?.exitCode != null ? ` · Código: ${res.exitCode}` : ""}
          </div>
        </>
      )}
      {outputText && (
        <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-zinc-300 max-h-36 overflow-y-auto pt-1 border-t border-white/[0.06]">
          {outputText}
        </pre>
      )}
    </div>
  );

  // Vista compacta de 1 línea para acciones ya resueltas o en ejecución dentro del historial de chat
  if (!isPending && !docked && !isLiquid) {
    return (
      <div className="panel-fade-in rounded-xl border border-white/[0.07] bg-[#0b0c10] px-3 py-2 text-[11.5px] transition-colors">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 w-5 h-5 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
              {isRunning ? (
                <Loader2 className="w-3 h-3 text-zinc-300 animate-spin" />
              ) : isFault ? (
                <ShieldAlert className="w-3 h-3 text-zinc-400" />
              ) : (
                <Check className="w-3 h-3 text-zinc-300" />
              )}
            </div>
            <span className="font-medium text-zinc-200 shrink-0">{headline}</span>
            {item.purpose && (
              <span className="text-zinc-500 truncate hidden sm:inline">
                · {item.purpose}
              </span>
            )}
            {res?.durationMs != null && (
              <span className="text-[10.5px] font-mono text-zinc-500 shrink-0">
                · {res.durationMs} ms
              </span>
            )}
          </div>

          {canInspectTechnical && (
            <button
              type="button"
              onClick={() => setShowTechnical((v) => !v)}
              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <Terminal className="w-2.5 h-2.5" />
              <span>{showTechnical ? "Ocultar" : "Detalle"}</span>
              {showTechnical ? (
                <ChevronDown className="w-2.5 h-2.5" />
              ) : (
                <ChevronRight className="w-2.5 h-2.5" />
              )}
            </button>
          )}
        </div>

        {item.error && (
          <div className="mt-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300">
            {item.error}
          </div>
        )}
        {technicalBlock}
      </div>
    );
  }

  // Vista acoplada en la consola de entrada (Input Dock) o QuickBar
  return (
    <div
      className={`panel-fade-in rounded-xl border ${risk.borderClass} ${
        isLiquid
          ? "quick-liquid-subcard quick-liquid-permission [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]"
          : docked
          ? "bg-[#0a0b0f] border-white/[0.08]"
          : "bg-[#0b0c10] border-white/[0.08]"
      } transition-colors ${compact || docked ? "px-3 py-2.5 text-[11.5px]" : "p-3 text-[12px]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="shrink-0 w-5 h-5 rounded-md bg-white/[0.05] border border-white/[0.09] flex items-center justify-center">
            {isRunning ? (
              <Loader2 className="w-3 h-3 text-zinc-200 animate-spin" />
            ) : isFault ? (
              <ShieldAlert className="w-3 h-3 text-zinc-400" />
            ) : (
              <ShieldCheck className="w-3 h-3 text-zinc-200" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="font-medium text-zinc-100 leading-snug">
              {headline}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${risk.badgeClass}`}
            >
              {risk.label}
            </span>
          </div>
        </div>

        {isPending && (
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onResolve(item.requestId, "allow_once")}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold transition-colors cursor-pointer"
            >
              <Check className="w-3 h-3 stroke-[2.25]" />
              <span>Permitir una vez</span>
            </button>
            <button
              type="button"
              onClick={() => onResolve(item.requestId, "allow_always")}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.12] text-zinc-200 hover:text-white text-[11px] font-medium transition-colors cursor-pointer"
            >
              <CheckCheck className="w-3 h-3" />
              <span>Permitir siempre</span>
            </button>
            <button
              type="button"
              onClick={() => onResolve(item.requestId, "deny")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-transparent hover:bg-white/[0.06] border border-white/[0.08] text-zinc-400 hover:text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Rechazar</span>
            </button>
          </div>
        )}
      </div>

      <div className="mt-1.5 pl-7 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-[11px] text-zinc-400">
          {item.purpose && (
            <span className="text-zinc-300 leading-snug">{item.purpose}</span>
          )}
          {item.detailPreview && (
            <span className="inline-flex items-center rounded-md bg-white/[0.035] border border-white/[0.08] px-2 py-0.5 font-mono text-[10.5px] text-zinc-300 max-w-full truncate">
              {item.detailPreview.replace(/\s+/g, " ").trim()}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500">
            {isExternalAction ? (
              <ExternalLink className="w-2.5 h-2.5 shrink-0 text-zinc-500" />
            ) : (
              <FolderOpen className="w-2.5 h-2.5 shrink-0 text-zinc-500" />
            )}
            <span className="truncate">{zoneLabel}</span>
            {res?.durationMs != null && <span>· {res.durationMs} ms</span>}
          </span>
        </div>

        {canInspectTechnical && (
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer shrink-0"
          >
            {showTechnical ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <Terminal className="w-2.5 h-2.5 text-zinc-500" />
            <span>Detalle técnico</span>
          </button>
        )}
      </div>

      {!isPending && item.error && (
        <div className="mt-2 ml-7 rounded-lg bg-white/[0.03] border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-300">
          {item.error}
        </div>
      )}

      {!isPending && res?.logPath && (
        <div className="mt-1.5 ml-7 text-[10.5px] text-zinc-500">
          Salida completa guardada en <span className="text-zinc-300">{res.logPath}</span>
        </div>
      )}

      {technicalBlock && <div className="ml-7">{technicalBlock}</div>}
    </div>
  );
};
