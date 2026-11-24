import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import { PermissionPrompt } from "./PermissionPrompt";

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
  /** La pasa la bandeja del chat; la tarjeta pendiente se ve igual dentro y fuera de ella. */
  docked?: boolean;
  surfaceVariant?: "default" | "liquid";
  onResolve: (requestId: string, decision: CommandPermissionDecisionKind) => void;
}

export function isShellTerminalAction(item: CommandPermissionUiItem): boolean {
  return !item.kind || item.kind === "command" || item.kind === "external_command";
}

interface ActionCopySpec {
  running: string;
  finishedOk: string;
  finishedFail: string;
  denied: string;
  /** Verbo corto estilo Claude Code (ej. "Buscar", "Listar", "Leer", "Terminal"). */
  inlineVerb: string;
}

function resolveActionCopy(item: CommandPermissionUiItem): ActionCopySpec {
  const targetApp = item.appName || item.program || "la aplicación";
  const specs: Record<string, ActionCopySpec> = {
    open_app: {
      running: `Abriendo ${targetApp}...`,
      finishedOk: `Se abrió ${targetApp}`,
      finishedFail: `No se pudo abrir ${targetApp}`,
      denied: "Apertura rechazada",
      inlineVerb: "Abrir",
    },
    os_notes_read: {
      running: "Consultando Notas de Mac...",
      finishedOk: "Notas consultadas",
      finishedFail: "No se pudieron consultar tus notas",
      denied: "Consulta rechazada",
      inlineVerb: "Notas",
    },
    os_notes_write: {
      running: "Guardando nota en Notas de Mac...",
      finishedOk: "Nota creada en Notas",
      finishedFail: "No se pudo crear la nota",
      denied: "Creación de nota rechazada",
      inlineVerb: "Crear nota",
    },
    os_calendar_read: {
      running: "Consultando Calendario de Mac...",
      finishedOk: "Calendario consultado",
      finishedFail: "No se pudo consultar el Calendario",
      denied: "Consulta de calendario rechazada",
      inlineVerb: "Calendario",
    },
    os_calendar_write: {
      running: "Agendando evento en Calendario de Mac...",
      finishedOk: "Evento agendado en Calendario",
      finishedFail: "No se pudo agendar el evento",
      denied: "Agenda de evento rechazada",
      inlineVerb: "Agendar",
    },
    ext_fs_list: {
      running: "Listando carpeta del equipo...",
      finishedOk: "Carpeta consultada",
      finishedFail: "No se pudo listar la carpeta",
      denied: "Exploración rechazada",
      inlineVerb: "Listar",
    },
    ext_fs_search: {
      running: "Buscando archivos en tu equipo...",
      finishedOk: "Búsqueda completada",
      finishedFail: "No se pudo completar la búsqueda",
      denied: "Búsqueda rechazada",
      inlineVerb: "Buscar",
    },
    ext_fs_read: {
      running: "Leyendo archivo del equipo...",
      finishedOk: "Archivo leído",
      finishedFail: "No se pudo leer el archivo",
      denied: "Lectura rechazada",
      inlineVerb: "Leer",
    },
    ext_fs_write: {
      running: "Guardando archivo en tu equipo...",
      finishedOk: "Archivo guardado",
      finishedFail: "No se pudo guardar el archivo",
      denied: "Escritura rechazada",
      inlineVerb: "Escribir",
    },
    ext_fs_edit: {
      running: "Aplicando cambios al archivo...",
      finishedOk: "Archivo editado",
      finishedFail: "No se pudo editar el archivo",
      denied: "Edición rechazada",
      inlineVerb: "Editar",
    },
    ext_fs_mkdir: {
      running: "Creando carpeta en tu equipo...",
      finishedOk: "Carpeta creada",
      finishedFail: "No se pudo crear la carpeta",
      denied: "Creación de carpeta rechazada",
      inlineVerb: "Crear carpeta",
    },
    desktop_ui_act: {
      running: `Operando interfaz de ${targetApp}...`,
      finishedOk: `Acción aplicada en ${targetApp}`,
      finishedFail: `No se pudo completar la acción en ${targetApp}`,
      denied: `Acción en ${targetApp} rechazada`,
      inlineVerb: "Interfaz",
    },
    desktop_ui_type: {
      running: `Escribiendo en ${targetApp}...`,
      finishedOk: `Texto enviado a ${targetApp}`,
      finishedFail: `No se pudo escribir en ${targetApp}`,
      denied: `Escritura en ${targetApp} rechazada`,
      inlineVerb: "Escribir UI",
    },
    desktop_ui_focus: {
      running: `Enfocando ${targetApp}...`,
      finishedOk: `${targetApp} enfocada`,
      finishedFail: `No se pudo enfocar ${targetApp}`,
      denied: `Enfoque en ${targetApp} rechazado`,
      inlineVerb: "Enfocar",
    },
  };
  return (
    specs[item.kind ?? "command"] ?? {
      running: "Ejecutando en terminal...",
      finishedOk: "Comando ejecutado",
      finishedFail: "El comando terminó con observaciones",
      denied: "Comando rechazado",
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
  surfaceVariant = "default",
  onResolve,
}) => {
  const [showTechnical, setShowTechnical] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const res = item.finished?.result;
  const stdoutText = res?.stdout?.trim() ?? "";
  const stderrText = res?.stderr?.trim() ?? "";
  const outputText = [stdoutText, stderrText]
    .filter(Boolean)
    .join("\n--- stderr ---\n");
  const isShell = isShellTerminalAction(item);
  const copy = resolveActionCopy(item);
  const isRunning = item.state === "running";

  const canInspectTechnical =
    Boolean(item.command) ||
    Boolean(item.appPath) ||
    Boolean(outputText) ||
    Boolean(item.error);

  const isLiquid = surfaceVariant === "liquid";

  // =========================================================================
  // 1. VISTA INLINE EN CONVERSACIÓN (ESTILO CLAUDE CODE + MINI TERMINAL MAC)
  // =========================================================================
  if (item.state !== "pending") {
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

  return <PermissionPrompt item={item} isShell={isShell} surfaceVariant={surfaceVariant} onResolve={onResolve} />;
};
