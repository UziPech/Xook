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
import { waitTopLayerAnimations } from "../../utils/topLayerDialog";
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

export type OpenRouterSettingsTab = "models" | "account";

interface OpenRouterSettingsModalProps {
  isOpen: boolean;
  initialTab?: OpenRouterSettingsTab;
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

const MODEL_PAGE_SIZE = 50;

export const OpenRouterSettingsModal: React.FC<OpenRouterSettingsModalProps> = ({
  isOpen,
  initialTab = "models",
  config,
  accountUsage,
  catalogModels,
  requestsToday,
  onClose,
  onConfigUpdated,
  onUsageUpdated,
  onCatalogUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<OpenRouterSettingsTab>(initialTab);
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
  const [visibleLimit, setVisibleLimit] = useState<number>(MODEL_PAGE_SIZE);
  const [revealFromIndex, setRevealFromIndex] = useState<number>(MODEL_PAGE_SIZE);
  const [dialogRendered, setDialogRendered] = useState<boolean>(isOpen);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
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
    setVisibleLimit(MODEL_PAGE_SIZE);
    setRevealFromIndex(MODEL_PAGE_SIZE);
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [catalogFilter, modelSearch, activeTab]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setActiveTab(initialTab);
      setVisibleLimit(MODEL_PAGE_SIZE);
      setRevealFromIndex(MODEL_PAGE_SIZE);
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      const focusTimer = window.setTimeout(() => {
        if (initialTab === "models") {
          searchInputRef.current?.focus({ preventScroll: true });
        } else if (!config.hasApiKey) {
          keyInputRef.current?.focus({ preventScroll: true });
        }
      }, 110);
      return () => window.clearTimeout(focusTimer);
    }

    if (!dialog.open) {
      setDialogRendered(false);
      return;
    }

    const seq = ++closeSeqRef.current;
    void (async () => {
      dialog.setAttribute("data-closing", "");
      await waitTopLayerAnimations(dialog, 240);
      if (closeSeqRef.current !== seq) return;
      dialog.removeAttribute("data-closing");
      if (dialog.open) dialog.close();
      setDialogRendered(false);
    })();
  }, [isOpen, initialTab, config.hasApiKey]);

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

  const slicedModels = useMemo(
    () => visibleModels.slice(0, visibleLimit),
    [visibleModels, visibleLimit]
  );
  const hasMoreModels = slicedModels.length < visibleModels.length;

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

  const expandMoreModels = () => {
    setVisibleLimit((prev) => {
      const next = Math.min(visibleModels.length, prev + MODEL_PAGE_SIZE);
      if (next > prev) {
        setRevealFromIndex(prev);
      }
      return next;
    });
  };

  const handleModelListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!hasMoreModels) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      expandMoreModels();
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

  const hasKeyLimit = typeof effectiveUsage?.limit === "number" && effectiveUsage.limit > 0;
  const hasAccountCredits =
    typeof effectiveUsage?.credits_total === "number" && effectiveUsage.credits_total > 0;

  let limitSummaryPct = 0;
  if (hasKeyLimit && effectiveUsage?.limit) {
    const used =
      effectiveUsage.usage ??
      Math.max(0, effectiveUsage.limit - (effectiveUsage.limit_remaining ?? 0));
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

          {/* Cabecera limpia con selector de pestañas */}
          <header className="relative z-[1] shrink-0 px-5 pt-4 pb-3.5 border-b border-white/[0.08] bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                {activeTab === "models" ? (
                  <Cpu className="w-4 h-4 text-white/90" />
                ) : (
                  <KeyRound className="w-4 h-4 text-white/90" />
                )}
              </div>
              <div className="min-w-0">
                <h2
                  id="openrouter-modal-title"
                  className="text-sm font-semibold text-white tracking-tight"
                >
                  OpenRouter · Modelos y conexión
                </h2>
                <p className="text-[11px] text-zinc-300/80 truncate">
                  Activo: <span className="text-zinc-100 font-medium">{activeModelDisplay.name}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <div
                role="tablist"
                aria-label="Secciones de configuración de OpenRouter"
                className="quick-liquid-subcard inline-flex items-center p-0.5 rounded-full gap-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "models"}
                  onClick={() => setActiveTab("models")}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                    activeTab === "models"
                      ? "quick-liquid-chip-active text-white"
                      : "text-zinc-300/80 hover:text-white"
                  }`}
                >
                  Modelos ({allModels.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "account"}
                  onClick={() => setActiveTab("account")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                    activeTab === "account"
                      ? "quick-liquid-chip-active text-white"
                      : "text-zinc-300/80 hover:text-white"
                  }`}
                >
                  {!config.hasApiKey && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300/90 shrink-0" />
                  )}
                  <span>Cuenta y clave</span>
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar configuración"
                className="quick-liquid-btn w-8 h-8 rounded-full inline-flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Contenido principal */}
          {activeTab === "models" ? (
            <div
              key="models"
              role="tabpanel"
              aria-label="Catálogo de modelos"
              className="xook-dialog-tab-panel relative z-[1] flex-1 min-h-0 flex flex-col px-5 pt-3.5 pb-3 gap-3"
            >
              {/* Barra de estado fija (sin saltos de altura al abrir) */}
              <div className="quick-liquid-subcard shrink-0 h-9 px-3 rounded-xl flex items-center justify-between gap-2 text-[11px]">
                {!config.hasApiKey ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-200/90">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300/90 shrink-0" />
                      <span className="truncate">
                        Sin clave conectada · Vista previa gratuita
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-sky-200/90 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Conectar clave →
                    </button>
                  </>
                ) : testing && !effectiveUsage ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-300">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-200 shrink-0" />
                      <span className="truncate">Verificando saldo y límites en OpenRouter…</span>
                    </div>
                    <span className="font-mono text-[10.5px] text-zinc-400 shrink-0">
                      {freeModels.length} gratis
                    </span>
                  </>
                ) : testResult && !testResult.ok ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-rose-200">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                      <span className="truncate">{testResult.message}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-rose-100 hover:text-white font-medium shrink-0 cursor-pointer"
                    >
                      Revisar →
                    </button>
                  </>
                ) : effectiveUsage ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-200">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          canUsePaid ? "bg-emerald-300/90" : "bg-sky-200/85"
                        }`}
                      />
                      <span className="truncate">
                        {canUsePaid ? "Cuenta con saldo" : "Plan gratuito"}
                        {" · "}
                        {hasKeyLimit
                          ? `$${(effectiveUsage.limit_remaining ?? 0).toFixed(2)} disponibles`
                          : hasAccountCredits
                          ? `$${(effectiveUsage.credits_remaining ?? 0).toFixed(2)} créditos`
                          : `${requestsToday}/${dailyFreeCap} hoy · ${rpmFreeCap}/min`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-zinc-300 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Límites →
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
                      <span className="truncate">Clave lista ({config.maskedKey})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-zinc-300 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Ver cuenta →
                    </button>
                  </>
                )}
              </div>

              {/* Controles de filtrado y búsqueda */}
              <div className="shrink-0 flex flex-wrap items-center gap-2">
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
                    Disponibles ({availableModels.length})
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
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Buscar modelo o proveedor..."
                    className="quick-liquid-input w-full pl-8 pr-7 py-1.5 rounded-xl text-[11.5px] text-zinc-100 placeholder:text-zinc-400/80 focus:outline-none select-text"
                  />
                  {modelSearch && (
                    <button
                      type="button"
                      onClick={() => setModelSearch("")}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleReloadCatalog}
                  disabled={loadingCatalog}
                  title="Actualizar catálogo desde OpenRouter"
                  aria-label="Actualizar catálogo desde OpenRouter"
                  className="quick-liquid-btn w-8 h-8 rounded-xl inline-flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalog ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Lista única scrolleable con renderizado progresivo */}
              <div
                ref={listScrollRef}
                onScroll={handleModelListScroll}
                className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-1"
              >
                {loadingCatalog && catalogModels.length === 0 ? (
                  <div className="h-full min-h-[180px] flex items-center justify-center gap-2 text-xs text-zinc-300">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-200" />
                    <span>Cargando modelos reales de OpenRouter…</span>
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className="h-full min-h-[180px] flex flex-col items-center justify-center gap-2.5 text-center px-4">
                    <p className="text-xs text-zinc-400">
                      No se encontraron modelos con "{modelSearch}".
                    </p>
                    {modelSearch.trim().includes("/") && (
                      <button
                        type="button"
                        onClick={() => void handleSelectModel(modelSearch.trim())}
                        className="quick-liquid-btn px-3 py-1.5 rounded-full text-[11px] text-zinc-100 cursor-pointer"
                      >
                        Usar «{modelSearch.trim()}»
                      </button>
                    )}
                  </div>
                ) : (
                  <div key={catalogFilter} className="xook-catalog-swap space-y-1">
                    {slicedModels.map((m, idx) => {
                      const selected = config.modelId === m.id;
                      const requiresCredits = !m.is_free && !canUsePaid;
                      const isExpandedReveal = idx >= revealFromIndex;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => void handleSelectModel(m.id)}
                          style={
                            isExpandedReveal
                              ? {
                                  animationDelay: `${Math.min(idx - revealFromIndex, 10) * 16}ms`,
                                }
                              : undefined
                          }
                          className={`quick-liquid-option ${
                            isExpandedReveal ? "xook-model-reveal" : ""
                          } w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left cursor-pointer ${
                            selected
                              ? "is-selected text-white"
                              : requiresCredits
                              ? "text-zinc-300/75 opacity-80"
                              : "text-zinc-100"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[12px] font-medium">
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
                    })}

                    {hasMoreModels && (
                      <div className="pt-1.5 pb-1 flex items-center justify-center">
                        <button
                          type="button"
                          onClick={expandMoreModels}
                          className="quick-liquid-btn px-3.5 py-1.5 rounded-full text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                        >
                          Mostrar más ({visibleModels.length - slicedModels.length} restantes)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              key="account"
              role="tabpanel"
              aria-label="Cuenta, límites y clave API"
              className="xook-dialog-tab-panel relative z-[1] flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4"
            >
              {/* Bloque 1: Estado y límites reales de OpenRouter */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                    <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                      <Activity className="w-3 h-3 text-white/85" />
                    </span>
                    Uso y límite de OpenRouter
                  </span>

                  {config.hasApiKey && (
                    <button
                      type="button"
                      onClick={() => void handleRefreshUsage()}
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
                    Aún no has conectado una clave de OpenRouter. Pega tu clave abajo para consultar tu saldo real y habilitar todo el catálogo.
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

                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            limitSummaryPct >= 85 ? "bg-amber-300/85" : "bg-white/75"
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
                    <span>Consultando uso y límites en OpenRouter…</span>
                  </div>
                )}
              </section>

              {/* Bloque 2: Bóveda de API Key */}
              <section className="space-y-3 pt-4 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
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
                      ref={keyInputRef}
                      type={showKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
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
                      onClick={() => void handleClearKey()}
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

              {/* Bloque 3: Identificador manual */}
              <section className="pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowManualId((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-100 cursor-pointer transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showManualId ? "rotate-180" : ""}`}
                  />
                  <span>Ingresar identificador manual de modelo (avanzado)</span>
                </button>
                <div className={`xook-collapse-grid ${showManualId ? "is-open" : ""}`}>
                  <div>
                    <div className="flex gap-2 mt-2.5">
                      <input
                        type="text"
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        placeholder="ej. google/gemma-4-31b-it:free"
                        tabIndex={showManualId ? 0 : -1}
                        className="quick-liquid-input flex-1 px-3 py-1.5 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-400/80 focus:outline-none select-text"
                      />
                      <button
                        type="button"
                        tabIndex={showManualId ? 0 : -1}
                        onClick={() => void handleSelectModel(customModelInput)}
                        className="quick-liquid-btn px-3.5 py-1.5 rounded-xl text-xs text-zinc-100 cursor-pointer"
                      >
                        Aplicar
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Pie */}
          <footer className="relative z-[1] shrink-0 px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between text-[11px] text-zinc-400">
            <span>Las claves nunca se envían en prompts ni al historial.</span>
            <button
              type="button"
              onClick={onClose}
              className="quick-liquid-btn px-4 py-1.5 rounded-full text-zinc-100 font-medium cursor-pointer"
            >
              Listo
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
};
