import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { LiquidGlassBackdrop } from "../../components/LiquidGlassBackdrop";
import {
  supportsTopLayerExit,
  waitTopLayerAnimations,
} from "../../utils/topLayerDialog";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  fetchOpenRouterModels,
  formatContextLength,
  formatModelDisplay,
  getAiConfigStatus,
  normalizeApiKey,
  saveAiConfig,
  testAiConnection,
} from "./aiClient";

interface OpenRouterSettingsModalProps {
  isOpen: boolean;
  config: AiConfigStatus;
  accountUsage: AiConnectionTestResult | null;
  catalogModels: OpenRouterModelOption[];
  requestsToday: number;
  onClose: () => void;
  onConfigUpdated: (next: AiConfigStatus) => void;
  onUsageUpdated: (usage: AiConnectionTestResult | null) => void;
  onCatalogUpdated: (models: OpenRouterModelOption[]) => void;
}

type CatalogFilter = "available" | "free" | "all";

export const OpenRouterSettingsModal: React.FC<OpenRouterSettingsModalProps> = ({
  isOpen,
  config,
  accountUsage,
  catalogModels,
  requestsToday,
  onClose,
  onConfigUpdated,
  onUsageUpdated,
  onCatalogUpdated,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [showKey, setShowKey] = useState<boolean>(false);
  const [customModelInput, setCustomModelInput] = useState<string>(config.modelId);
  const [showManualId, setShowManualId] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);

  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("available");
  const [modelSearch, setModelSearch] = useState<string>("");
  const [dialogRendered, setDialogRendered] = useState<boolean>(isOpen);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef<boolean>(false);
  const closeSeqRef = useRef<number>(0);
  const isOpenRef = useRef<boolean>(isOpen);
  isOpenRef.current = isOpen;

  const onCloseRef = useRef(onClose);
  const onConfigUpdatedRef = useRef(onConfigUpdated);
  const onUsageUpdatedRef = useRef(onUsageUpdated);
  const onCatalogUpdatedRef = useRef(onCatalogUpdated);
  onCloseRef.current = onClose;
  onConfigUpdatedRef.current = onConfigUpdated;
  onUsageUpdatedRef.current = onUsageUpdated;
  onCatalogUpdatedRef.current = onCatalogUpdated;

  useEffect(() => {
    setCustomModelInput(config.modelId);
  }, [config.modelId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (!dialog.open) {
      setDialogRendered(false);
      return;
    }

    const seq = ++closeSeqRef.current;
    void (async () => {
      if (!supportsTopLayerExit()) {
        dialog.setAttribute("data-closing", "");
        await waitTopLayerAnimations(dialog);
        if (closeSeqRef.current !== seq) return;
        dialog.removeAttribute("data-closing");
        if (dialog.open) dialog.close();
        setDialogRendered(false);
        return;
      }

      dialog.close();
      await waitTopLayerAnimations(dialog);
      if (closeSeqRef.current !== seq) return;
      setDialogRendered(false);
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setTestResult(null);

    void getAiConfigStatus()
      .then((fresh) => {
        if (!active) return;
        onConfigUpdatedRef.current(fresh);
        if (fresh.hasApiKey) {
          setTesting(true);
          return testAiConnection().then((res) => {
            if (!active) return;
            setTestResult(res);
            if (res.ok) onUsageUpdatedRef.current(res);
          });
        }
        return undefined;
      })
      .catch(() => {})
      .finally(() => {
        if (active) setTesting(false);
      });

    if (catalogModels.length === 0) {
      setLoadingCatalog(true);
      void fetchOpenRouterModels(false)
        .then((res) => {
          if (active && res.models.length > 0) {
            onCatalogUpdatedRef.current(res.models);
          }
        })
        .finally(() => {
          if (active) setLoadingCatalog(false);
        });
    }

    return () => {
      active = false;
    };
  }, [isOpen, catalogModels.length]);

  const effectiveUsage = testResult?.ok ? testResult : accountUsage?.ok ? accountUsage : null;
  const canUsePaid = effectiveUsage?.can_use_paid_models ?? false;
  const isFreeTier = effectiveUsage?.is_free_tier ?? true;
  const dailyFreeCap = effectiveUsage?.daily_free_limit ?? (isFreeTier ? 50 : 1000);
  const rpmFreeCap = effectiveUsage?.rpm_free_limit ?? 20;

  const allModels = useMemo(() => {
    if (catalogModels.length > 0) return catalogModels;
    return OPENROUTER_PRESET_MODELS;
  }, [catalogModels]);

  const freeModels = useMemo(() => allModels.filter((m) => m.is_free), [allModels]);

  const availableModels = useMemo(
    () => (canUsePaid ? allModels : freeModels),
    [allModels, freeModels, canUsePaid]
  );

  const visibleModels = useMemo(() => {
    const base =
      catalogFilter === "available"
        ? availableModels
        : catalogFilter === "free"
        ? freeModels
        : allModels;
    const q = modelSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.provider_name?.toLowerCase().includes(q) ?? false)
    );
  }, [allModels, availableModels, freeModels, catalogFilter, modelSearch]);

  const shouldRenderBody = isOpen || dialogRendered;

  const handleSaveKey = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = normalizeApiKey(apiKeyInput);
    if (!cleaned) return;
    if (/^[a-fA-F0-9]{64}$/.test(cleaned)) {
      setTestResult({
        ok: false,
        message:
          "Falta el prefijo 'sk-or-v1-' al inicio de la clave. Cópiala completa desde sk-or-v1-... sin recortar.",
      });
      return;
    }

    setSaving(true);
    setTestResult(null);
    try {
      const updated = await saveAiConfig({
        provider: "openrouter",
        apiKey: cleaned,
        modelId: customModelInput.trim() || config.modelId,
      });
      onConfigUpdated(updated);
      setApiKeyInput("");
      setTesting(true);
      const check = await testAiConnection();
      setTestResult(check);
      onUsageUpdated(check.ok ? check : null);
      void fetchOpenRouterModels(false, true).then((res) => {
        if (res.models.length > 0) onCatalogUpdated(res.models);
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message:
          err instanceof Error ? err.message : "No se pudo guardar la clave en la bóveda.",
      });
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const handleRefreshUsage = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection();
      setTestResult(res);
      onUsageUpdated(res.ok ? res : null);
    } finally {
      setTesting(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const updated = await saveAiConfig({ clearKey: true });
      onConfigUpdated(updated);
      onUsageUpdated(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectModel = async (nextId: string) => {
    const clean = nextId.trim();
    if (!clean) return;
    setCustomModelInput(clean);
    const inCatalog = allModels.some((m) => m.id === clean);
    const nextCustom =
      !inCatalog && !config.customModels.includes(clean)
        ? [clean, ...config.customModels].slice(0, 8)
        : config.customModels;

    const updated = await saveAiConfig({
      modelId: clean,
      customModels: nextCustom,
    });
    onConfigUpdated(updated);
  };

  const handleReloadCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetchOpenRouterModels(false, true);
      if (res.models.length > 0) {
        onCatalogUpdated(res.models);
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const sourceLabel =
    config.keySource === "vault"
      ? "Bóveda local"
      : config.keySource === "env"
      ? "Variable de entorno"
      : config.keySource === "browser"
      ? "Sesión local"
      : "Sin clave";

  const activeModelDisplay = formatModelDisplay(config.modelId, allModels);

  // Calcular resumen legible de límite de uso de OpenRouter
  const hasKeyLimit = typeof effectiveUsage?.limit === "number" && effectiveUsage.limit > 0;
  const hasAccountCredits =
    typeof effectiveUsage?.credits_total === "number" && effectiveUsage.credits_total > 0;

  let limitSummaryPct = 0;
  if (hasKeyLimit && effectiveUsage?.limit) {
    const used = effectiveUsage.usage ?? Math.max(0, effectiveUsage.limit - (effectiveUsage.limit_remaining ?? 0));
    limitSummaryPct = Math.min(100, Math.round((used / effectiveUsage.limit) * 100));
  } else if (hasAccountCredits && effectiveUsage?.credits_total) {
    limitSummaryPct = Math.min(
      100,
      Math.round(((effectiveUsage.credits_usage ?? 0) / effectiveUsage.credits_total) * 100)
    );
  } else if (config.hasApiKey) {
    limitSummaryPct = Math.min(100, Math.round((requestsToday / dailyFreeCap) * 100));
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="openrouter-modal-title"
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        if (isOpenRef.current) {
          onCloseRef.current();
        }
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        pressedOutsideRef.current =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        const releasedOutside =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
        if (pressedOutsideRef.current && releasedOutside) {
          onCloseRef.current();
        }
        pressedOutsideRef.current = false;
      }}
      className="xook-liquid-dialog"
    >
      {shouldRenderBody && (
        <>
          <LiquidGlassBackdrop variant="modal" />

          {/* Cabecera */}
          <div className="relative z-[1] px-5 py-4 border-b border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4 text-white/90" />
              </div>
              <div>
                <h2
                  id="openrouter-modal-title"
                  className="text-sm font-semibold text-white"
                >
                  OpenRouter · Límites y Modelos
                </h2>
                <p className="text-[11px] text-zinc-300/80">
                  Estado de tu cuenta, límite de uso actual y modelos disponibles para Xox
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar configuración"
              className="quick-liquid-btn w-8 h-8 rounded-full inline-flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Contenido scrollable */}
          <div className="relative z-[1] p-5 overflow-y-auto space-y-5">
            {/* Bloque 1: Límite de uso y estado real en OpenRouter */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                  <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                    <Activity className="w-3 h-3 text-white/85" />
                  </span>
                  Uso y límite de OpenRouter
                </span>

                {config.hasApiKey && (
                  <button
                    type="button"
                    onClick={handleRefreshUsage}
                    disabled={testing}
                    className="quick-liquid-btn inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] text-zinc-100 cursor-pointer"
                  >
                    {testing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>Actualizar estado</span>
                  </button>
                )}
              </div>

              {!config.hasApiKey ? (
                <div className="quick-liquid-subcard p-3.5 rounded-xl text-xs text-zinc-200/90 leading-relaxed">
                  Aún no has conectado una clave de OpenRouter. Agrega tu clave abajo para consultar tu límite de uso y habilitar los modelos disponibles.
                </div>
              ) : effectiveUsage ? (
                <div className="quick-liquid-subcard p-3.5 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="quick-liquid-chip inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-zinc-100">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            canUsePaid ? "bg-emerald-300/90" : "bg-sky-200/85"
                          }`}
                        />
                        {canUsePaid
                          ? "OpenRouter · Cuenta con saldo"
                          : "OpenRouter · Plan gratuito"}
                      </span>
                      {effectiveUsage.label && (
                        <span className="text-[11px] text-zinc-300/80 truncate max-w-[200px]">
                          {effectiveUsage.label}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-zinc-300/85">
                      {freeModels.length} modelos gratis · {allModels.length} totales
                    </span>
                  </div>

                  {/* Métricas reales de límite */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {hasKeyLimit ? (
                      <>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Disponible en clave
                          </div>
                          <div className="text-sm font-mono font-semibold text-white mt-0.5">
                            ${(effectiveUsage.limit_remaining ?? 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Tope asignado
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            ${(effectiveUsage.limit ?? 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Usado hoy / total
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            ${(effectiveUsage.usage_daily ?? 0).toFixed(3)} / $
                            {(effectiveUsage.usage ?? 0).toFixed(2)}
                          </div>
                        </div>
                      </>
                    ) : hasAccountCredits ? (
                      <>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Saldo restante
                          </div>
                          <div className="text-sm font-mono font-semibold text-white mt-0.5">
                            ${(effectiveUsage.credits_remaining ?? 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Créditos totales
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            ${(effectiveUsage.credits_total ?? 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Cuota gratis / día
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            {requestsToday} / {dailyFreeCap}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Solicitudes hoy (Xook)
                          </div>
                          <div className="text-sm font-mono font-semibold text-white mt-0.5">
                            {requestsToday} / {dailyFreeCap}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Límite por minuto
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            {rpmFreeCap} req/min
                          </div>
                        </div>
                        <div className="p-2.5 rounded-xl bg-white/[0.035] border border-white/[0.08]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Gasto en clave
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5">
                            ${(effectiveUsage.usage ?? 0).toFixed(2)}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Barra visual de límite */}
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          limitSummaryPct >= 85
                            ? "bg-amber-300/85"
                            : "bg-white/75"
                        }`}
                        style={{
                          width: `${Math.max(limitSummaryPct, limitSummaryPct > 0 ? 4 : 0)}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-300/80 leading-relaxed">
                      {canUsePaid
                        ? `Tu cuenta de OpenRouter tiene saldo habilitado. Puedes usar modelos de pago y hasta ${dailyFreeCap.toLocaleString()} solicitudes diarias en modelos gratuitos.`
                        : `OpenRouter limita el plan gratuito a ${dailyFreeCap} solicitudes por día y ${rpmFreeCap} por minuto. Solo los modelos gratuitos están habilitados para evitar errores por falta de saldo.`}
                    </p>
                  </div>
                </div>
              ) : testResult && !testResult.ok ? (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/25 text-xs text-rose-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                  <span>{testResult.message}</span>
                </div>
              ) : (
                <div className="quick-liquid-subcard p-3 rounded-xl text-xs text-zinc-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-200" />
                  <span>Consultando uso y límites en OpenRouter...</span>
                </div>
              )}
            </section>

            {/* Bloque 2: Bóveda de API Key */}
            <section className="space-y-3 pt-4 border-t border-white/[0.08]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                  <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-3 h-3 text-white/85" />
                  </span>
                  Clave API (Bóveda local)
                </span>
                <span className="quick-liquid-chip inline-flex items-center gap-1.5 text-[10.5px] font-mono px-2.5 py-0.5 rounded-full text-zinc-200">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      config.hasApiKey ? "bg-emerald-300/90" : "bg-amber-300/90"
                    }`}
                  />
                  {config.hasApiKey
                    ? `${config.maskedKey} · ${sourceLabel}`
                    : "Sin configurar"}
                </span>
              </div>

              <form onSubmit={handleSaveKey} className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    autoFocus={!config.hasApiKey}
                    placeholder={
                      config.hasApiKey
                        ? "Pegar nueva clave sk-or-v1-... para reemplazar"
                        : "Pega tu clave de OpenRouter: sk-or-v1-..."
                    }
                    autoComplete="off"
                    className="quick-liquid-input w-full pl-3 pr-9 py-2 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-400/80 focus:outline-none select-text"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                  >
                    {showKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!apiKeyInput.trim() || saving}
                  className="quick-liquid-btn-ready px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed shrink-0"
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </form>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="text-zinc-300/80 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-zinc-300/80 shrink-0" />
                  También puedes pegarla en el chat; Xox la intercepta localmente antes de enviarla.
                </span>

                {config.hasApiKey && config.keySource !== "env" && (
                  <button
                    type="button"
                    onClick={handleClearKey}
                    title="Eliminar clave guardada"
                    className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-zinc-300 hover:text-rose-200 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Quitar clave</span>
                  </button>
                )}
              </div>

              {testResult?.ok && (
                <div className="quick-liquid-subcard p-2.5 rounded-xl text-zinc-100 text-xs flex items-center gap-2">
                  <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </span>
                  <span>{testResult.message}</span>
                </div>
              )}
            </section>

            {/* Bloque 3: Catálogo en vivo y disponibilidad real de modelos */}
            <section className="space-y-3 pt-4 border-t border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                    <Cpu className="w-3 h-3 text-white/85" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                    Modelos de IA
                  </span>
                  <span className="text-[11px] text-zinc-300/80">
                    · Activo:{" "}
                    <strong className="text-white font-medium">
                      {activeModelDisplay.name}
                    </strong>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleReloadCatalog}
                  disabled={loadingCatalog}
                  className="quick-liquid-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-zinc-100 cursor-pointer"
                >
                  {loadingCatalog ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>Actualizar catálogo</span>
                </button>
              </div>

              {/* Pestañas de filtro */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="quick-liquid-subcard inline-flex p-0.5 rounded-xl gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCatalogFilter("available")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      catalogFilter === "available"
                        ? "quick-liquid-chip-active text-white"
                        : "text-zinc-300/80 hover:text-white"
                    }`}
                  >
                    Disponibles ahora ({availableModels.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogFilter("free")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      catalogFilter === "free"
                        ? "quick-liquid-chip-active text-white"
                        : "text-zinc-300/80 hover:text-white"
                    }`}
                  >
                    Gratis ({freeModels.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogFilter("all")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                      catalogFilter === "all"
                        ? "quick-liquid-chip-active text-white"
                        : "text-zinc-300/80 hover:text-white"
                    }`}
                  >
                    Todos ({allModels.length})
                  </button>
                </div>

                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    autoFocus={config.hasApiKey}
                    placeholder="Buscar modelo o proveedor..."
                    className="quick-liquid-input w-full pl-8 pr-3 py-1.5 rounded-xl text-[11.5px] text-zinc-100 placeholder:text-zinc-400/80 focus:outline-none select-text"
                  />
                </div>
              </div>

              {/* Lista de modelos */}
              <div className="quick-liquid-subcard rounded-xl p-1.5 max-h-60 overflow-y-auto space-y-0.5">
                {loadingCatalog && catalogModels.length === 0 ? (
                  <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-300">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-200" />
                    <span>Cargando modelos reales de OpenRouter...</span>
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className="py-6 text-center text-xs text-zinc-400">
                    No se encontraron modelos con "{modelSearch}".
                  </div>
                ) : (
                  visibleModels.map((m) => {
                    const selected = config.modelId === m.id;
                    const requiresCredits = !m.is_free && !canUsePaid;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSelectModel(m.id)}
                        className={`quick-liquid-option w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-left cursor-pointer ${
                          selected
                            ? "is-selected text-white"
                            : requiresCredits
                            ? "text-zinc-300/75 opacity-80"
                            : "text-zinc-100"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            <span className="truncate">{m.name}</span>
                            {m.is_free ? (
                              <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9px] font-mono uppercase text-zinc-200/90 shrink-0">
                                Gratis
                              </span>
                            ) : requiresCredits ? (
                              <span className="quick-liquid-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono text-zinc-300/90 shrink-0">
                                <Lock className="w-2.5 h-2.5" />
                                Requiere saldo
                              </span>
                            ) : typeof m.prompt_price_per_million === "number" &&
                              m.prompt_price_per_million > 0 ? (
                              <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9.5px] font-mono text-zinc-300 shrink-0">
                                ${m.prompt_price_per_million.toFixed(2)}/1M
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10.5px] text-zinc-400 truncate mt-0.5">
                            {[
                              m.provider_name,
                              m.context_length
                                ? `${formatContextLength(m.context_length)} contexto`
                                : null,
                              m.id,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        {selected && (
                          <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Opción avanzada colapsable para ID personalizado */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowManualId((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${showManualId ? "rotate-180" : ""}`}
                  />
                  <span>Ingresar identificador manual (avanzado)</span>
                </button>
                {showManualId && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      placeholder="ej. google/gemma-4-31b-it:free"
                      className="quick-liquid-input flex-1 px-3 py-1.5 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-400/80 focus:outline-none select-text"
                    />
                    <button
                      type="button"
                      onClick={() => handleSelectModel(customModelInput)}
                      className="quick-liquid-btn px-3 py-1.5 rounded-xl text-xs text-zinc-100 cursor-pointer"
                    >
                      Aplicar
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Pie */}
          <div className="relative z-[1] px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between text-[11px] text-zinc-400">
            <span>Las claves nunca se envían en prompts ni al historial.</span>
            <button
              type="button"
              onClick={onClose}
              className="quick-liquid-btn px-4 py-1.5 rounded-full text-zinc-100 font-medium cursor-pointer"
            >
              Listo
            </button>
          </div>
        </>
      )}
    </dialog>
  );
};
