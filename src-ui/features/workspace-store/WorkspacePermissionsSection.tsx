import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
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
    text: "Permitir",
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  ask: {
    text: "Preguntar",
    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  deny: {
    text: "Bloquear",
    cls: "bg-rose-500/15 text-rose-300 border-rose-500/30",
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
        onStatusNotice?.("Perfil de lectura segura (ls, pwd, wc, head) activado.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo activar el perfil.");
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
            ? "Comandos sin regla ahora se bloquean por defecto."
            : "Comandos nuevos pedirán confirmación."
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
        onStatusNotice?.("Regla de permiso eliminada.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo eliminar la regla."
      );
    } finally {
      setBusy(false);
    }
  };

  const allowRulesCount =
    config?.rules.filter((r) => r.action === "allow").length ?? 0;

  return (
    <div className="border-b border-white/[0.06] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          )}
          <ShieldCheck className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          <span className="text-[11px] font-medium text-zinc-200 truncate">
            Permisos y apps
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {loading && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />}
          <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-full bg-white/[0.07] text-zinc-300">
            {allowRulesCount} reglas
          </span>
        </div>
      </button>

      {expanded && (
        <div className="panel-fade-in px-3 pb-3 pt-1 space-y-2.5">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-black/40 border border-white/[0.07] px-2.5 py-1.5">
            <div className="min-w-0">
              <div className="text-[10.5px] text-zinc-400">Comandos nuevos</div>
              <div className="text-[11px] font-medium text-zinc-200">
                {config?.defaultPolicy === "deny"
                  ? "Bloquear si no hay regla"
                  : "Preguntar antes de ejecutar"}
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !config}
              onClick={() => void handleToggleDefaultPolicy()}
              className="px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-[10.5px] text-zinc-200 disabled:opacity-40 cursor-pointer transition-colors"
            >
              <Lock className="w-3 h-3 inline mr-1 -mt-0.5 text-zinc-400" />
              {config?.defaultPolicy === "deny" ? "Cambiar a Preguntar" : "Modo estricto"}
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEnableReadonly()}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] font-medium text-sky-100 disabled:opacity-45 cursor-pointer transition-colors"
          >
            {allowRulesCount >= 4 ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
            )}
            Activar lectura segura (ls, pwd, wc, head)
          </button>

          {errorMsg && (
            <div className="text-[10.5px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-2 py-1">
              {errorMsg}
            </div>
          )}

          {config && config.rules.length > 0 ? (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
              {config.rules.map((rule) => {
                const badge = ACTION_LABEL[rule.action] ?? ACTION_LABEL.ask;
                const isExternalRule = rule.scope === "app" || rule.scope === "capability";
                return (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-black/35 border border-white/[0.06] px-2 py-1 text-[10.5px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isExternalRule && (
                          <ExternalLink className="w-3 h-3 text-sky-300 shrink-0" />
                        )}
                        <span className="font-mono text-zinc-100 truncate">
                          {isExternalRule ? rule.description || rule.pattern : rule.pattern}
                        </span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full border text-[9.5px] ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                      </div>
                      {(isExternalRule ? rule.pattern : rule.description) && (
                        <div className="text-[10px] text-zinc-500 truncate">
                          {rule.scope === "app"
                            ? `App: ${rule.pattern}`
                            : rule.scope === "capability"
                            ? `Integración: ${rule.pattern}`
                            : rule.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRemoveRule(rule.id)}
                      title="Revocar regla"
                      aria-label={`Eliminar regla ${rule.pattern}`}
                      className="p-1 rounded hover:bg-rose-500/15 text-zinc-500 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10.5px] text-zinc-500 text-center py-1">
              Sin reglas guardadas todavía (.xook/permissions.json).
            </div>
          )}

          <div className="pt-1 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 text-[10.5px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <History className="w-3 h-3" />
              <span>
                {showHistory
                  ? "Ocultar historial de comandos"
                  : `Historial reciente (${history.length})`}
              </span>
            </button>

            {showHistory && (
              <div className="panel-fade-in mt-1.5 space-y-1 max-h-36 overflow-y-auto">
                {history.length === 0 ? (
                  <div className="text-[10px] text-zinc-500">
                    Aún no se han ejecutado comandos en este espacio.
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
                      : `$ ${item.command}`;
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg bg-black/45 border border-white/[0.06] px-2 py-1 text-[10px] space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-200 truncate">{item.purpose}</span>
                          <span className="text-zinc-500 shrink-0">{item.status}</span>
                        </div>
                        <div className="font-mono text-zinc-500 truncate">
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

