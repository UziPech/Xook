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
import {
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  buildPermissionUiItemFromFinished,
  buildPermissionUiItemFromRequest,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "@xook/contracts";
import { MacMiniTerminal } from "./MacMiniTerminal";

export {
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  buildPermissionUiItemFromFinished,
  buildPermissionUiItemFromRequest,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
};

interface CommandPermissionCardProps {
  item: CommandPermissionUiItem;
  compact?: boolean;
  docked?: boolean;
  surfaceVariant?: "default" | "liquid";
  onResolve: (requestId: string, decision: CommandPermissionDecisionKind) => void;
}

export function isShellTerminalAction(item: CommandPermissionUiItem): boolean {
  return !item.kind || item.kind === "command" || item.kind === "external_command";
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

interface ActionCopySpec {
  pending: string;
  running: string;
  finishedOk: string;
  finishedFail: string;
  denied: string;
  zone: string;
  /** Verbo corto estilo Claude Code (ej. "Buscar", "Listar", "Leer", "Terminal"). */
  inlineVerb: string;
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
      inlineVerb: "Abrir",
    },
    os_notes_read: {
      pending: "Xox solicita permiso para consultar tus notas en Notas",
      running: "Consultando Notas de Mac...",
      finishedOk: "Notas consultadas",
      finishedFail: "No se pudieron consultar tus notas",
      denied: "Consulta rechazada",
      zone: "App Notas de tu Mac",
      inlineVerb: "Notas",
    },
    os_notes_write: {
      pending: "Xox solicita permiso para crear una nota en Notas",
      running: "Guardando nota en Notas de Mac...",
      finishedOk: "Nota creada en Notas",
      finishedFail: "No se pudo crear la nota",
      denied: "Creación de nota rechazada",
      zone: "App Notas de tu Mac",
      inlineVerb: "Crear nota",
    },
    os_calendar_read: {
      pending: "Xox solicita permiso para consultar tu Calendario",
      running: "Consultando Calendario de Mac...",
      finishedOk: "Calendario consultado",
      finishedFail: "No se pudo consultar el Calendario",
      denied: "Consulta de calendario rechazada",
      zone: "App Calendario de tu Mac",
      inlineVerb: "Calendario",
    },
    os_calendar_write: {
      pending: "Xox solicita permiso para agendar en tu Calendario",
      running: "Agendando evento en Calendario de Mac...",
      finishedOk: "Evento agendado en Calendario",
      finishedFail: "No se pudo agendar el evento",
      denied: "Agenda de evento rechazada",
      zone: "App Calendario de tu Mac",
      inlineVerb: "Agendar",
    },
    ext_fs_list: {
      pending: "Xox solicita permiso para explorar esta carpeta del equipo",
      running: "Listando carpeta del equipo...",
      finishedOk: "Carpeta consultada",
      finishedFail: "No se pudo listar la carpeta",
      denied: "Exploración rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Listar",
    },
    ext_fs_search: {
      pending: "Xox solicita permiso para buscar archivos en tu equipo",
      running: "Buscando archivos en tu equipo...",
      finishedOk: "Búsqueda completada",
      finishedFail: "No se pudo completar la búsqueda",
      denied: "Búsqueda rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Buscar",
    },
    ext_fs_read: {
      pending: "Xox solicita permiso para leer un archivo de tu equipo",
      running: "Leyendo archivo del equipo...",
      finishedOk: "Archivo leído",
      finishedFail: "No se pudo leer el archivo",
      denied: "Lectura rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Leer",
    },
    ext_fs_write: {
      pending: "Xox solicita permiso para guardar un archivo en tu equipo",
      running: "Guardando archivo en tu equipo...",
      finishedOk: "Archivo guardado",
      finishedFail: "No se pudo guardar el archivo",
      denied: "Escritura rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Escribir",
    },
    ext_fs_edit: {
      pending: "Xox solicita permiso para editar un archivo de tu equipo",
      running: "Aplicando cambios al archivo...",
      finishedOk: "Archivo editado",
      finishedFail: "No se pudo editar el archivo",
      denied: "Edición rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Editar",
    },
    ext_fs_mkdir: {
      pending: "Xox solicita permiso para crear una carpeta en tu equipo",
      running: "Creando carpeta en tu equipo...",
      finishedOk: "Carpeta creada",
      finishedFail: "No se pudo crear la carpeta",
      denied: "Creación de carpeta rechazada",
      zone: item.cwdRel || "Carpeta del equipo",
      inlineVerb: "Crear carpeta",
    },
    desktop_ui_act: {
      pending: `Xox solicita permiso para interactuar con ${targetApp}`,
      running: `Operando interfaz de ${targetApp}...`,
      finishedOk: `Acción aplicada en ${targetApp}`,
      finishedFail: `No se pudo completar la acción en ${targetApp}`,
      denied: `Acción en ${targetApp} rechazada`,
      zone: `Interfaz de ${targetApp}`,
      inlineVerb: "Interfaz",
    },
    desktop_ui_type: {
      pending: `Xox solicita permiso para escribir en ${targetApp}`,
      running: `Escribiendo en ${targetApp}...`,
      finishedOk: `Texto enviado a ${targetApp}`,
      finishedFail: `No se pudo escribir en ${targetApp}`,
      denied: `Escritura en ${targetApp} rechazada`,
      zone: `Interfaz de ${targetApp}`,
      inlineVerb: "Escribir UI",
    },
    desktop_ui_focus: {
      pending: `Xox solicita permiso para traer al frente ${targetApp}`,
      running: `Enfocando ${targetApp}...`,
      finishedOk: `${targetApp} enfocada`,
      finishedFail: `No se pudo enfocar ${targetApp}`,
      denied: `Enfoque en ${targetApp} rechazado`,
      zone: `Ventana de ${targetApp}`,
      inlineVerb: "Enfocar",
    },
  };
  return (
    specs[item.kind ?? "command"] ?? {
      pending: "Xox solicita permiso para ejecutar un comando",
      running: "Ejecutando en terminal...",
      finishedOk: "Comando ejecutado",
      finishedFail: "El comando terminó con observaciones",
      denied: "Comando rechazado",
      zone: item.cwdRel === "." ? "Carpeta principal del negocio" : item.cwdRel,
      inlineVerb: "Terminal",
    }
  );
}

/** Limpia prefijos repetitivos en el objetivo inline para imitar la concisión de Claude Code. */
function resolveInlineTarget(item: CommandPermissionUiItem): string {
  const kind = item.kind ?? "command";
  if (kind === "open_app") {
    return item.appName || item.program || item.purpose || item.command;
  }
  if (kind.startsWith("desktop_ui_")) {
    const app = item.appName || item.program || "";
    const detail = item.purpose?.trim() || item.detailPreview?.trim() || "";
    if (app && detail && !detail.toLowerCase().includes(app.toLowerCase())) {
      return `${app} · ${detail}`;
    }
    return detail || app || item.command;
  }
  const rawPurpose = (item.purpose ?? "").trim();
  const stripped = rawPurpose
    .replace(/^Listar carpeta del equipo:\s*/i, "")
    .replace(/^Buscar\s+/i, "")
    .replace(/^Leer archivo(?: del equipo)?:\s*/i, "")
    .replace(/^Guardar archivo(?: en el equipo)?:\s*/i, "")
    .replace(/^Editar archivo(?: del equipo)?:\s*/i, "")
    .replace(/^Crear carpeta(?: en el equipo)?:\s*/i, "")
    .trim();
  return (
    stripped ||
    item.detailPreview?.replace(/\s+/g, " ").trim() ||
    item.cwdRel ||
    item.command ||
    ""
  );
}

function StatusDot({
  state,
  ok,
}: {
  state: CommandPermissionUiItem["state"];
  ok?: boolean;
}) {
  if (state === "running") {
    return (
      <span
        aria-hidden="true"
        className="w-[7px] h-[7px] rounded-full bg-zinc-200 animate-pulse shrink-0"
      />
    );
  }
  if (state === "blocked" || state === "error" || (state === "finished" && ok === false)) {
    return (
      <span
        aria-hidden="true"
        className="w-[7px] h-[7px] rounded-full bg-rose-400/85 shrink-0"
      />
    );
  }
  if (state === "denied") {
    return (
      <span
        aria-hidden="true"
        className="w-[7px] h-[7px] rounded-full bg-amber-400/80 shrink-0"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="w-[7px] h-[7px] rounded-full bg-emerald-400/75 shrink-0"
    />
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
  const [terminalVisible, setTerminalVisible] = useState(true);
  const risk = getRiskMeta(item.riskLevel);
  const res = item.finished?.result;
  const stdoutText = res?.stdout?.trim() ?? "";
  const stderrText = res?.stderr?.trim() ?? "";
  const outputText = [stdoutText, stderrText]
    .filter(Boolean)
    .join("\n--- stderr ---\n");
  const isShell = isShellTerminalAction(item);
  const isExternalAction = !isShell;
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

  // =========================================================================
  // 1. VISTA INLINE EN CONVERSACIÓN (ESTILO CLAUDE CODE + MINI TERMINAL MAC)
  // =========================================================================
  if (!isPending && !docked) {
    // 1A. Comandos de consola/terminal -> Fila Claude Code + Mini Terminal macOS SVG
    if (isShell) {
      const shellLabel = item.purpose?.trim() || item.command?.trim() || copy.finishedOk;
      return (
        <div className="panel-fade-in py-0.5 space-y-1.5">
          <button
            type="button"
            onClick={() => setTerminalVisible((v) => !v)}
            aria-expanded={terminalVisible}
            className="group flex items-center justify-between gap-2 w-full text-left py-0.5 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-white/60 rounded"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-3.5 inline-flex items-center justify-center shrink-0">
                <StatusDot state={item.state} ok={res?.ok} />
              </span>
              <span
                className={`text-[12.5px] font-medium shrink-0 ${
                  isRunning ? "xox-shimmer" : "text-zinc-200 group-hover:text-white"
                }`}
              >
                {copy.inlineVerb}
              </span>
              {shellLabel && (
                <span
                  title={shellLabel}
                  className="text-[12px] text-zinc-400 truncate"
                >
                  {shellLabel}
                </span>
              )}
            </div>
            <span className="inline-flex items-center gap-1.5 shrink-0 text-[10.5px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">
              {res?.durationMs != null && <span className="tabular-nums">{res.durationMs}ms</span>}
              {terminalVisible ? (
                <ChevronDown className="w-3 h-3 opacity-70" />
              ) : (
                <ChevronRight className="w-3 h-3 opacity-70" />
              )}
            </span>
          </button>

          {terminalVisible && (
            <div className="pl-[18px]">
              <MacMiniTerminal
                command={item.command}
                cwdRel={item.cwdRel}
                stdout={res?.stdout}
                stderr={res?.stderr}
                exitCode={res?.exitCode}
                durationMs={res?.durationMs}
                state={item.state}
                error={item.error}
                logPath={res?.logPath}
                compact={compact}
                surfaceVariant={surfaceVariant}
              />
            </div>
          )}
        </div>
      );
    }

    // 1B. Acciones no-terminal (archivos, búsquedas, apps, notas, calendario, UI)
    //     SIN caja ni recuadro: fila minimalista estilo Claude Code con conector `⎿` desplegable.
    const inlineTarget = resolveInlineTarget(item);
    const faultSubline =
      item.error ||
      (item.state === "denied"
        ? copy.denied
        : item.state === "blocked"
        ? "Bloqueado por seguridad"
        : item.state === "finished" && res?.ok === false
        ? copy.finishedFail
        : null);

    return (
      <div className="panel-fade-in py-0.5">
        <button
          type="button"
          disabled={!canInspectTechnical}
          onClick={() => {
            if (canInspectTechnical) setShowTechnical((v) => !v);
          }}
          aria-expanded={canInspectTechnical ? showTechnical : undefined}
          className={`group flex items-center justify-between gap-2 w-full text-left py-[2px] select-none rounded focus-visible:outline-2 focus-visible:outline-white/60 ${
            canInspectTechnical ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3.5 inline-flex items-center justify-center shrink-0">
              <StatusDot state={item.state} ok={res?.ok} />
            </span>
            <span
              className={`text-[12.5px] font-medium shrink-0 ${
                isRunning
                  ? "xox-shimmer"
                  : isLiquid
                  ? "text-zinc-100 group-hover:text-white"
                  : "text-zinc-200 group-hover:text-white"
              }`}
            >
              {copy.inlineVerb}
            </span>
            {inlineTarget && (
              <span
                title={inlineTarget}
                className={`text-[11.5px] font-mono truncate ${
                  isLiquid ? "text-zinc-300/90" : "text-zinc-400 group-hover:text-zinc-300"
                }`}
              >
                {inlineTarget}
              </span>
            )}
          </div>

          <span className="inline-flex items-center gap-1 shrink-0 text-[10.5px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">
            {res?.durationMs != null && <span className="tabular-nums">{res.durationMs}ms</span>}
            {canInspectTechnical && (
              showTechnical ? (
                <ChevronDown className="w-3 h-3 opacity-75" />
              ) : (
                <ChevronRight className="w-3 h-3 opacity-45 group-hover:opacity-100 transition-opacity" />
              )
            )}
          </span>
        </button>

        {/* Sublínea tipo Claude Code (`⎿`) si hubo error/rechazo incluso colapsado */}
        {!showTechnical && faultSubline && (
          <div className="flex items-start gap-1.5 pl-[18px] pt-0.5 text-[11px] text-zinc-400">
            <span aria-hidden="true" className="text-zinc-600 select-none leading-snug">
              ⎿
            </span>
            <span
              className={
                item.state === "denied" ? "text-amber-300/80" : "text-rose-300/85"
              }
            >
              {faultSubline}
            </span>
          </div>
        )}

        {/* Detalle expandible sin recuadro pesado: rama limpia `⎿` en monoespaciado */}
        {showTechnical && canInspectTechnical && (
          <div className="panel-fade-in pl-[18px] mt-1 space-y-1 text-[11px] font-mono text-zinc-400 select-text">
            <div className="flex items-start gap-1.5 border-l border-white/[0.1] pl-2.5 py-0.5">
              <div className="min-w-0 flex-1 space-y-1">
                {(item.appName || item.command) && (
                  <div className="text-zinc-300 break-all">
                    {item.kind === "open_app"
                      ? `App: ${item.appName || item.program || item.command}`
                      : item.command || item.appName}
                  </div>
                )}
                {item.appPath && (
                  <div className="text-[10.5px] text-zinc-500 break-all">{item.appPath}</div>
                )}
                {faultSubline && (
                  <div
                    className={
                      item.state === "denied" ? "text-amber-300/85" : "text-rose-300/85"
                    }
                  >
                    {faultSubline}
                  </div>
                )}
                {outputText && (
                  <pre className="m-0 whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-zinc-400 max-h-40 overflow-y-auto xook-scroll pt-0.5">
                    {outputText}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 2. VISTA DE APROBACIÓN PENDIENTE (INPUT DOCK / QUICKBAR)
  // =========================================================================
  const technicalBlock = showTechnical && canInspectTechnical && !isShell && (
    <div className="panel-fade-in mt-2 border-l border-white/[0.12] pl-2.5 py-0.5 font-mono text-[10.5px] text-zinc-400 space-y-1 overflow-x-auto">
      <div className="text-zinc-200 break-all">
        {item.kind === "open_app" ? "Aplicación" : "Acción"}:{" "}
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
      {outputText && (
        <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-zinc-300 max-h-36 overflow-y-auto pt-1">
          {outputText}
        </pre>
      )}
    </div>
  );

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
            {item.allowAlwaysAllowed !== false && (
              <button
                type="button"
                onClick={() => onResolve(item.requestId, "allow_always")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.12] text-zinc-200 hover:text-white text-[11px] font-medium transition-colors cursor-pointer"
              >
                <CheckCheck className="w-3 h-3" />
                <span>Permitir siempre</span>
              </button>
            )}
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

      {/* Si es comando de terminal pendiente, previsualizar en la mini terminal de Mac */}
      {isShell && item.command ? (
        <div className="mt-2 pl-7 space-y-1.5">
          {item.purpose && (
            <div className="text-[11px] text-zinc-300 leading-snug">{item.purpose}</div>
          )}
          <MacMiniTerminal
            command={item.command}
            cwdRel={item.cwdRel}
            state={item.state}
            previewOnly
            compact
            surfaceVariant={surfaceVariant}
          />
        </div>
      ) : (
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
      )}

      {!isPending && item.error && (
        <div className="mt-2 ml-7 rounded-lg bg-white/[0.03] border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-300">
          {item.error}
        </div>
      )}

      {technicalBlock && <div className="ml-7">{technicalBlock}</div>}
    </div>
  );
};
