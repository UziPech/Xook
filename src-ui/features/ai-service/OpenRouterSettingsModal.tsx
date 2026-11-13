import React, { useEffect, useMemo, useState } from "react";
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

  const onCloseRef = React.useRef(onClose);
  const onConfigUpdatedRef = React.useRef(onConfigUpdated);
  const onUsageUpdatedRef = React.useRef(onUsageUpdated);
  const onCatalogUpdatedRef = React.useRef(onCatalogUpdated);
  onCloseRef.current = onClose;
  onConfigUpdatedRef.current = onConfigUpdated;
  onUsageUpdatedRef.current = onUsageUpdated;
  onCatalogUpdatedRef.current = onCatalogUpdated;

  useEffect(() => {
    setCustomModelInput(config.modelId);
  }, [config.modelId]);

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

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKey);
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

  if (!isOpen) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-fade-in w-full max-w-2xl rounded-2xl bg-[#0b0d13]/95 border border-white/[0.12] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between bg-[#0e1017]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-400/25 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-sky-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                OpenRouter · Límites y Modelos
              </h2>
              <p className="text-[11px] text-zinc-400">
                Estado de tu cuenta, límite de uso actual y modelos disponibles para Xox
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Bloque 1: Límite de uso y estado real en OpenRouter */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-300" />
                Uso y límite de OpenRouter
              </span>

              {config.hasApiKey && (
                <button
                  type="button"
                  onClick={handleRefreshUsage}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] text-zinc-200 cursor-pointer"
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
              <div className="p-3.5 rounded-xl bg-amber-500/[0.06] border border-amber-400/20 text-xs text-amber-200/90">
                Aún no has conectado una clave de OpenRouter. Agrega tu clave abajo para consultar tu límite de uso y habilitar los modelos disponibles.
              </div>
            ) : effectiveUsage ? (
              <div className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.08] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                        canUsePaid
                          ? "bg-emerald-500/10 border-emerald-400/25 text-emerald-300"
                          : "bg-sky-500/10 border-sky-400/25 text-sky-200"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          canUsePaid ? "bg-emerald-400" : "bg-sky-300"
                        }`}
                      />
                      {canUsePaid ? "OpenRouter · Cuenta con saldo" : "OpenRouter · Plan gratuito"}
                    </span>
                    {effectiveUsage.label && (
                      <span className="text-[11px] text-zinc-400 truncate max-w-[200px]">
                        {effectiveUsage.label}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400">
                    {freeModels.length} modelos gratis · {allModels.length} totales
                  </span>
                </div>

                {/* Métricas reales de límite */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {hasKeyLimit ? (
                    <>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Disponible en clave
                        </div>
                        <div className="text-sm font-mono font-semibold text-white mt-0.5">
                          ${(effectiveUsage.limit_remaining ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Tope asignado
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          ${(effectiveUsage.limit ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Usado hoy / total
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          ${(effectiveUsage.usage_daily ?? 0).toFixed(3)} / ${(effectiveUsage.usage ?? 0).toFixed(2)}
                        </div>
                      </div>
                    </>
                  ) : hasAccountCredits ? (
                    <>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Saldo restante
                        </div>
                        <div className="text-sm font-mono font-semibold text-emerald-300 mt-0.5">
                          ${(effectiveUsage.credits_remaining ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Créditos totales
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          ${(effectiveUsage.credits_total ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Cuota gratis / día
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          {requestsToday} / {dailyFreeCap}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Solicitudes hoy (Xook)
                        </div>
                        <div className="text-sm font-mono font-semibold text-white mt-0.5">
                          {requestsToday} / {dailyFreeCap}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Límite por minuto
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          {rpmFreeCap} req/min
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-black/40 border border-white/[0.05]">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Gasto en clave
                        </div>
                        <div className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">
                          ${(effectiveUsage.usage ?? 0).toFixed(2)}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Barra visual de límite */}
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        limitSummaryPct >= 85
                          ? "bg-amber-400"
                          : canUsePaid
                          ? "bg-emerald-400/80"
                          : "bg-sky-400/80"
                      }`}
                      style={{ width: `${Math.max(limitSummaryPct, limitSummaryPct > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
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
              <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.07] text-xs text-zinc-400 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300" />
                <span>Consultando uso y límites en OpenRouter...</span>
              </div>
            )}
          </section>

          {/* Bloque 2: Bóveda de API Key */}
          <section className="space-y-3 pt-4 border-t border-white/[0.07]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Clave API (Bóveda local)
              </span>
              <span
                className={`text-[10.5px] font-mono px-2 py-0.5 rounded-full border ${
                  config.hasApiKey
                    ? "bg-emerald-500/10 border-emerald-400/25 text-emerald-300"
                    : "bg-amber-500/10 border-amber-400/25 text-amber-300"
                }`}
              >
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
                  placeholder={
                    config.hasApiKey
                      ? "Pegar nueva clave sk-or-v1-... para reemplazar"
                      : "Pega tu clave de OpenRouter: sk-or-v1-..."
                  }
                  autoComplete="off"
                  className="w-full pl-3 pr-9 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400/45 select-text"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={!apiKeyInput.trim() || saving}
                className="xook-approve-btn px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-sky-300 shrink-0" />
                También puedes pegarla en el chat; Xox la intercepta localmente antes de enviarla.
              </span>

              {config.hasApiKey && config.keySource !== "env" && (
                <button
                  type="button"
                  onClick={handleClearKey}
                  title="Eliminar clave guardada"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.03] hover:bg-rose-500/10 border border-white/[0.06] hover:border-rose-500/25 text-zinc-400 hover:text-rose-200 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Quitar clave</span>
                </button>
              )}
            </div>

            {testResult?.ok && (
              <div className="p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-400/25 text-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>{testResult.message}</span>
              </div>
            )}
          </section>

          {/* Bloque 3: Catálogo en vivo y disponibilidad real de modelos */}
          <section className="space-y-3 pt-4 border-t border-white/[0.07]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-sky-300" />
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Modelos de IA
                </span>
                <span className="text-[11px] text-zinc-400">
                  · Activo: <strong className="text-zinc-200 font-medium">{activeModelDisplay.name}</strong>
                </span>
              </div>

              <button
                type="button"
                onClick={handleReloadCatalog}
                disabled={loadingCatalog}
                className="inline-flex items-center gap-1.5 text-[11px] text-sky-300 hover:text-sky-200 cursor-pointer"
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
              <div className="inline-flex p-0.5 rounded-xl bg-black/40 border border-white/[0.07] gap-0.5">
                <button
                  type="button"
                  onClick={() => setCatalogFilter("available")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    catalogFilter === "available"
                      ? "bg-white/[0.1] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Disponibles ahora ({availableModels.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogFilter("free")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    catalogFilter === "free"
                      ? "bg-white/[0.1] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Gratis ({freeModels.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogFilter("all")}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    catalogFilter === "all"
                      ? "bg-white/[0.1] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Todos ({allModels.length})
                </button>
              </div>

              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Buscar modelo o proveedor..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/[0.08] text-[11.5px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/20 select-text"
                />
              </div>
            </div>

            {/* Lista de modelos */}
            <div className="rounded-xl bg-black/40 border border-white/[0.07] p-2 max-h-60 overflow-y-auto space-y-1">
              {loadingCatalog && catalogModels.length === 0 ? (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-300" />
                  <span>Cargando modelos reales de OpenRouter...</span>
                </div>
              ) : visibleModels.length === 0 ? (
                <div className="py-6 text-center text-xs text-zinc-500">
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
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                        selected
                          ? "bg-sky-500/15 border border-sky-400/30 text-white"
                          : requiresCredits
                          ? "hover:bg-white/[0.03] border border-transparent text-zinc-400 opacity-80"
                          : "hover:bg-white/[0.06] border border-transparent text-zinc-200"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <span className="truncate">{m.name}</span>
                          {m.is_free ? (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/20 text-[9px] font-mono uppercase shrink-0">
                              Gratis
                            </span>
                          ) : requiresCredits ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-400/20 text-[9px] font-mono shrink-0">
                              <Lock className="w-2.5 h-2.5" />
                              Requiere saldo
                            </span>
                          ) : typeof m.prompt_price_per_million === "number" && m.prompt_price_per_million > 0 ? (
                            <span className="px-1.5 py-0.2 rounded bg-white/[0.05] text-zinc-400 text-[9.5px] font-mono shrink-0">
                              ${m.prompt_price_per_million.toFixed(2)}/1M
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10.5px] text-zinc-500 truncate mt-0.5">
                          {[m.provider_name, m.context_length ? `${formatContextLength(m.context_length)} contexto` : null, m.id]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      {selected && <Check className="w-3.5 h-3.5 text-sky-300 shrink-0" />}
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
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
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
                    className="flex-1 px-3 py-1.5 rounded-xl bg-black/50 border border-white/[0.08] text-xs font-mono text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 select-text"
                  />
                  <button
                    type="button"
                    onClick={() => handleSelectModel(customModelInput)}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.1] text-xs text-zinc-100 cursor-pointer"
                  >
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Pie */}
        <div className="px-5 py-3 border-t border-white/[0.07] bg-[#0e1017] flex items-center justify-between text-[11px] text-zinc-400">
          <span>Las claves nunca se envían en prompts ni al historial.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100 font-medium cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
