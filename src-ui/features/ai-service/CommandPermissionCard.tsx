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
        badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/35",
        borderClass: "border-rose-500/30",
      };
    case "high":
      return {
        label: "Alto",
        badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/35",
        borderClass: "border-amber-500/30",
      };
    case "medium":
      return {
        label: "Medio",
        badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
        borderClass: "border-sky-500/25",
      };
    default:
      return {
        label: "Solo lectura",
        badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        borderClass: "border-white/[0.1]",
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

  return (
    <div
      className={`panel-fade-in rounded-xl border ${risk.borderClass} ${
        isLiquid
          ? "quick-liquid-subcard quick-liquid-permission [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]"
          : "bg-[#0d111a]/90 backdrop-blur-md"
      } transition-colors ${compact ? "p-2.5 text-[11.5px]" : "p-3 text-[12px]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="mt-0.5 shrink-0 w-6 h-6 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            {isRunning ? (
              <Loader2 className="w-3.5 h-3.5 text-sky-300 animate-spin" />
            ) : item.state === "blocked" || item.state === "error" || item.state === "denied" ? (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-300" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-sky-300" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-zinc-100 leading-snug">
                {headline}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${risk.badgeClass}`}
              >
                {risk.label}
              </span>
            </div>
            <p className="mt-1 text-zinc-300 leading-relaxed">{item.purpose}</p>
            {item.detailPreview && (
              <div className="mt-1.5 rounded-lg bg-white/[0.035] border border-white/[0.07] px-2.5 py-1.5 text-[11px] text-zinc-200 whitespace-pre-line leading-relaxed">
                {item.detailPreview}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-zinc-400">
              {isExternalAction ? (
                <ExternalLink className="w-3 h-3 shrink-0 text-sky-400/80" />
              ) : (
                <FolderOpen className="w-3 h-3 shrink-0 text-zinc-500" />
              )}
              <span className="truncate">{zoneLabel}</span>
              {res?.durationMs != null && (
                <span className="text-zinc-500">· {res.durationMs} ms</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {isPending && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onResolve(item.requestId, "allow_once")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/35 text-sky-100 text-[11px] font-medium transition-colors"
          >
            <Check className="w-3 h-3" />
            Permitir una vez
          </button>
          <button
            type="button"
            onClick={() => onResolve(item.requestId, "allow_always")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-100 text-[11px] font-medium transition-colors"
          >
            <CheckCheck className="w-3 h-3" />
            Permitir siempre
          </button>
          <button
            type="button"
            onClick={() => onResolve(item.requestId, "deny")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/15 border border-white/[0.08] hover:border-rose-500/30 text-zinc-300 hover:text-rose-200 text-[11px] font-medium transition-colors"
          >
            <X className="w-3 h-3" />
            Rechazar
          </button>
        </div>
      )}

      {!isPending && item.error && (
        <div className="mt-2 rounded-lg bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 text-[11px] text-rose-200">
          {item.error}
        </div>
      )}

      {!isPending && res?.logPath && (
        <div className="mt-2 text-[10.5px] text-zinc-400">
          Salida completa guardada en <span className="text-zinc-200">{res.logPath}</span>
        </div>
      )}

      {canInspectTechnical && (
        <div className="mt-2 pt-1.5 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showTechnical ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <Terminal className="w-3 h-3 text-zinc-500" />
            Ver detalle técnico y salida
          </button>

          {showTechnical && (
            <div className="panel-fade-in mt-1.5 rounded-lg bg-black/55 border border-white/[0.08] p-2 font-mono text-[10.5px] text-zinc-300 space-y-1.5 overflow-x-auto">
              {isExternalAction ? (
                <>
                  <div className="text-sky-200 break-all">
                    {item.kind === "open_app" ? "Aplicación" : "Integración"}:{" "}
                    {item.appName || item.program || item.command}
                  </div>
                  <div className="text-[10px] text-zinc-400 space-y-0.5">
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
                    <span className="text-sky-200 break-all">{item.command}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Carpeta: {item.cwdRel}
                    {item.patternSuggestion ? ` · Regla sugerida: ${item.patternSuggestion}` : ""}
                    {res?.exitCode != null ? ` · Código: ${res.exitCode}` : ""}
                  </div>
                </>
              )}
              {outputText && (
                <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-zinc-300 max-h-40 overflow-y-auto pt-1 border-t border-white/[0.06]">
                  {outputText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
