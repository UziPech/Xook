import React, { useCallback, useEffect, useId, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  History,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  enableReadonlyCommandPreset,
  getCommandPermissions,
  listCommandExecutions,
  removeCommandPermissionRule,
  subscribePermissionEvents,
  subscribeWorkspaceUpdated,
  updateCommandDefaultPolicy,
  type CommandExecutionRecord,
  type PermissionsConfig,
} from "./workspaceApi";

interface WorkspacePermissionsSectionProps {
  activeWorkspaceId?: string | null;
  onStatusNotice?: (msg: string) => void;
}

const ACTION_LABEL: Record<string, { text: string; cls: string }> = {
  allow: {
    text: "Permitido",
    cls: "bg-white/[0.08] text-zinc-100 border-white/15",
  },
  ask: {
    text: "Preguntar",
    cls: "bg-white/[0.04] text-zinc-300 border-white/10",
  },
  deny: {
    text: "Bloqueado",
    cls: "bg-rose-500/10 text-rose-200 border-rose-400/25",
  },
};

export const WorkspacePermissionsSection: React.FC<WorkspacePermissionsSectionProps> = ({
  activeWorkspaceId,
  onStatusNotice,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [config, setConfig] = useState<PermissionsConfig | null>(null);
  const [history, setHistory] = useState<CommandExecutionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const panelId = useId();

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, execs] = await Promise.all([
        getCommandPermissions(),
        listCommandExecutions(10),
      ]);
      if (cfg) setConfig(cfg);
      setHistory(execs);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudieron cargar los permisos."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [activeWorkspaceId, refreshAll]);

  useEffect(() => {
    const unsubPerm = subscribePermissionEvents({
      onPermissionsUpdated: (cfg) => {
        setConfig(cfg);
      },
      onFinished: () => {
        void listCommandExecutions(10).then(setHistory).catch(() => {});
      },
    });
    const unsubWs = subscribeWorkspaceUpdated((reason) => {
      if (
        !reason ||
        reason.includes("permission") ||
        reason.includes("command")
      ) {
        void refreshAll();
      }
    });
    return () => {
      unsubPerm();
      unsubWs();
    };
  }, [refreshAll]);

  const handleEnableReadonly = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await enableReadonlyCommandPreset();
      if (updated) {
        setConfig(updated);
        onStatusNotice?.("Lectura segura de archivos activada.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo activar la lectura segura.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleDefaultPolicy = async () => {
    if (!config) return;
    const nextPolicy = config.defaultPolicy === "deny" ? "ask" : "deny";
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await updateCommandDefaultPolicy(nextPolicy);
      if (updated) {
        setConfig(updated);
        onStatusNotice?.(
          nextPolicy === "deny"
            ? "Acciones sin permiso ahora se bloquean por defecto."
            : "Acciones nuevas pedirán tu confirmación."
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo cambiar la política base."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRule = async (ruleId: string) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const updated = await removeCommandPermissionRule(ruleId);
      if (updated) {
        setConfig(updated);
        onStatusNotice?.("Permiso eliminado.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo eliminar el permiso."
      );
    } finally {
      setBusy(false);
    }
  };

  const allowRulesCount =
    config?.rules.filter((r) => r.action === "allow").length ?? 0;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0b0c10] overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            aria-hidden="true"
            className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform duration-200 ${
              expanded ? "rotate-90 text-zinc-200" : ""
            }`}
          />
          <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="text-xs font-medium text-zinc-100 truncate">
            Permisos y apps
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {loading && <Loader2 aria-hidden="true" className="w-3 h-3 text-zinc-400 animate-spin" />}
          <span className="text-[10.5px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300">
            {allowRulesCount} {allowRulesCount === 1 ? "activo" : "activos"}
          </span>
        </div>
      </button>

      {expanded && (
        <div id={panelId} className="panel-fade-in px-3 pb-3 pt-1.5 space-y-2.5 border-t border-white/[0.06]">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-2">
            <div className="min-w-0">
              <div className="text-[10.5px] text-zinc-400">Si Xox pide una acción nueva</div>
              <div className="text-[11.5px] font-medium text-zinc-100">
                {config?.defaultPolicy === "deny"
                  ? "Bloquear automáticamente"
                  : "Preguntar antes de actuar"}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !config}
              onClick={() => void handleToggleDefaultPolicy()}
              className="min-h-[28px] px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.1] text-[11px] text-zinc-100 disabled:opacity-40 cursor-pointer transition-colors shrink-0 inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-white/60"
            >
              <Lock aria-hidden="true" className="w-3 h-3 text-zinc-300" />
              <span>{config?.defaultPolicy === "deny" ? "Preguntar" : "Bloquear"}</span>
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEnableReadonly()}
            className="w-full min-h-[32px] flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-[11px] font-medium text-zinc-100 disabled:opacity-45 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
          >
            {allowRulesCount >= 4 ? (
              <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-zinc-200" />
            ) : (
              <Sparkles aria-hidden="true" className="w-3.5 h-3.5 text-zinc-300" />
            )}
            <span>
              {allowRulesCount >= 4
                ? "Lectura segura activada"
                : "Permitir lectura segura de archivos"}
            </span>
          </button>

          {errorMsg && (
            <div role="alert" className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-400/25 rounded-lg px-2.5 py-1.5">
              {errorMsg}
            </div>
          )}

          {config && config.rules.length > 0 ? (
            <ul className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
              {config.rules.map((rule) => {
                const badge = ACTION_LABEL[rule.action] ?? ACTION_LABEL.ask;
                const isExternalRule =
                  rule.scope === "app" ||
                  rule.scope === "capability" ||
                  rule.scope === "ext_read" ||
                  rule.scope === "ext_write";
                const title = isExternalRule
                  ? rule.description || rule.pattern
                  : rule.description || rule.pattern;
                return (
                  <li
                    key={rule.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-1.5 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isExternalRule && (
                          <ExternalLink aria-hidden="true" className="w-3 h-3 text-zinc-300 shrink-0" />
                        )}
                        <span className="text-zinc-100 truncate font-medium">
                          {title}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full border text-[9.5px] shrink-0 ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                      </div>
                      {isExternalRule && (
                        <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                          {rule.scope === "app"
                            ? `Aplicación: ${rule.pattern}`
                            : rule.scope === "ext_read"
                              ? `Lectura en equipo: ${rule.pattern}`
                              : rule.scope === "ext_write"
                                ? `Edición en equipo: ${rule.pattern}`
                                : `Integración: ${rule.pattern}`}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRemoveRule(rule.id)}
                      title="Quitar permiso"
                      aria-label={`Quitar permiso ${title}`}
                      className="min-w-[26px] min-h-[26px] p-1 rounded-md hover:bg-white/[0.08] text-zinc-400 hover:text-rose-200 transition-colors cursor-pointer shrink-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60"
                    >
                      <Trash2 aria-hidden="true" className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-[11px] text-zinc-400 text-center py-1">
              Aún no hay permisos especiales guardados.
            </div>
          )}

          <div className="pt-1.5 border-t border-white/[0.06]">
            <button
              type="button"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((v) => !v)}
              className="min-h-[26px] flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 rounded"
            >
              <History aria-hidden="true" className="w-3 h-3" />
              <span>
                {showHistory
                  ? "Ocultar actividad reciente"
                  : `Actividad reciente (${history.length})`}
              </span>
            </button>

            {showHistory && (
              <div className="panel-fade-in mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                {history.length === 0 ? (
                  <div className="text-[10.5px] text-zinc-400">
                    Todavía no hay actividad registrada.
                  </div>
                ) : (
                  history.map((item) => {
                    const isAppHistory = item.command.startsWith("open_app:");
                    const isNotesHistory = item.command.startsWith("os_notes:");
                    const isCalHistory = item.command.startsWith("os_calendar:");
                    const formattedCommand = isAppHistory
                      ? `App · ${item.command.replace(/^open_app:\s*/, "")}`
                      : isNotesHistory
                      ? `Notas · ${item.command.replace(/^os_notes:\s*/, "")}`
                      : isCalHistory
                      ? `Calendario · ${item.command.replace(/^os_calendar:\s*/, "")}`
                      : item.command;
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-1.5 text-[10.5px] space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-200 truncate">{item.purpose}</span>
                          <span className="text-zinc-400 shrink-0">{item.status}</span>
                        </div>
                        <div className="text-zinc-400 truncate">
                          {formattedCommand}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
