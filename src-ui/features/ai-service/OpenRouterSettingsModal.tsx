import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
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
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { LiquidGlassBackdrop } from "../../components/LiquidGlassBackdrop";
import { waitTopLayerAnimations } from "../../utils/topLayerDialog";
import { ProviderIcon, normalizeProviderIdClient } from "./ProviderIcon";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LIST,
  AiConfigStatus,
  AiConnectionTestResult,
  AiProviderId,
  DEFAULT_FAILOVER_ORDER,
  OpenRouterModelOption,
  fetchOpenRouterModels,
  formatContextLength,
  formatModelDisplay,
  formatPricePerMillion,
  getAiConfigStatus,
  getProviderSpec,
  normalizeApiKey,
  saveAiConfig,
  testAiConnection,
} from "./aiClient";

export type OpenRouterSettingsTab = "models" | "account";

interface OpenRouterSettingsModalProps {
  isOpen: boolean;
  initialTab?: OpenRouterSettingsTab;
  initialProvider?: AiProviderId;
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
  initialProvider,
  config,
  accountUsage,
  catalogModels,
  requestsToday,
  onClose,
  onConfigUpdated,
  onUsageUpdated,
  onCatalogUpdated,
}) => {
  const activeConfigProvider = normalizeProviderIdClient(config.provider);
  const [activeTab, setActiveTab] = useState<OpenRouterSettingsTab>(initialTab);
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(
    initialProvider ?? activeConfigProvider
  );

  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [showKey, setShowKey] = useState<boolean>(false);
  const [customModelInput, setCustomModelInput] = useState<string>(config.modelId);
  const [showManualId, setShowManualId] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResultsByProvider, setTestResultsByProvider] = useState<
    Partial<Record<AiProviderId, AiConnectionTestResult>>
  >({});

  const [catalogByProvider, setCatalogByProvider] = useState<
    Partial<Record<AiProviderId, OpenRouterModelOption[]>>
  >(() => (catalogModels.length > 0 ? { openrouter: catalogModels } : {}));
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

  const selectedSpec = getProviderSpec(selectedProvider);
  const selectedSlot = config.configuredProviders?.[selectedProvider];
  const selectedHasKey =
    selectedSlot?.hasApiKey ?? (selectedProvider === activeConfigProvider ? config.hasApiKey : false);
  const selectedMaskedKey =
    selectedSlot?.maskedKey ?? (selectedProvider === activeConfigProvider ? config.maskedKey : null);
  const selectedKeySource =
    selectedSlot?.keySource ?? (selectedProvider === activeConfigProvider ? config.keySource : "none");
  const selectedModelId =
    selectedSlot?.modelId ||
    (selectedProvider === activeConfigProvider ? config.modelId : selectedSpec.defaultModelId);
  const selectedCustomModels =
    selectedSlot?.customModels ??
    (selectedProvider === activeConfigProvider ? config.customModels : []);
  const selectedQuotaStatus = selectedSlot?.quotaStatus ?? "ready";
  const selectedQuotaReason = selectedSlot?.quotaReason ?? null;
  const selectedCooldownUntil = selectedSlot?.cooldownUntilMs ?? null;

  useEffect(() => {
    if (catalogModels.length > 0 && activeConfigProvider === "openrouter") {
      setCatalogByProvider((prev) =>
        prev.openrouter && prev.openrouter.length > 0 ? prev : { ...prev, openrouter: catalogModels }
      );
    }
  }, [catalogModels, activeConfigProvider]);

  useEffect(() => {
    setCustomModelInput(selectedModelId);
  }, [selectedModelId, selectedProvider]);

  useEffect(() => {
    setVisibleLimit(MODEL_PAGE_SIZE);
    setRevealFromIndex(MODEL_PAGE_SIZE);
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [catalogFilter, modelSearch, activeTab, selectedProvider]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setActiveTab(initialTab);
      setSelectedProvider(initialProvider ?? normalizeProviderIdClient(config.provider));
      setVisibleLimit(MODEL_PAGE_SIZE);
      setRevealFromIndex(MODEL_PAGE_SIZE);
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      const focusTimer = window.setTimeout(() => {
        if (initialTab === "models") {
          searchInputRef.current?.focus({ preventScroll: true });
        } else if (!selectedHasKey) {
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
  }, [isOpen, initialTab, initialProvider]);

  // Cargar configuración fresca + verificar proveedor seleccionado + cargar su catálogo
  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    void getAiConfigStatus()
      .then((fresh) => {
        if (!active) return;
        onConfigUpdatedRef.current(fresh);
        const slot = fresh.configuredProviders?.[selectedProvider];
        const hasKey =
          slot?.hasApiKey ??
          (selectedProvider === normalizeProviderIdClient(fresh.provider) && fresh.hasApiKey);
        if (hasKey) {
          setTesting(true);
          return testAiConnection(selectedProvider).then((res) => {
            if (!active) return;
            setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: res }));
            if (selectedProvider === normalizeProviderIdClient(fresh.provider) && res.ok) {
              onUsageUpdatedRef.current(res);
            }
          });
        }
        return undefined;
      })
      .catch(() => {})
      .finally(() => {
        if (active) setTesting(false);
      });

    const existingCat = catalogByProvider[selectedProvider];
    if (!existingCat || existingCat.length === 0) {
      setLoadingCatalog(true);
      void fetchOpenRouterModels(false, false, selectedProvider)
        .then((res) => {
          if (!active) return;
          const modelsList = res.models.length > 0 ? res.models : selectedSpec.curatedModels;
          setCatalogByProvider((prev) => ({ ...prev, [selectedProvider]: modelsList }));
          if (selectedProvider === normalizeProviderIdClient(config.provider)) {
            onCatalogUpdatedRef.current(modelsList);
          }
        })
        .finally(() => {
          if (active) setLoadingCatalog(false);
        });
    }

    return () => {
      active = false;
    };
  }, [isOpen, selectedProvider]);

  const currentTestResult = testResultsByProvider[selectedProvider] ?? null;
  const effectiveUsage = currentTestResult?.ok
    ? currentTestResult
    : selectedProvider === activeConfigProvider && accountUsage?.ok
      ? accountUsage
      : null;

  const canUsePaid =
    selectedProvider === "openrouter"
      ? (effectiveUsage?.can_use_paid_models ?? false)
      : true;
  const isFreeTier = effectiveUsage?.is_free_tier ?? selectedSpec.supportsFreeTier;
  const dailyFreeCap = effectiveUsage?.daily_free_limit ?? (isFreeTier ? 50 : 1000);
  const rpmFreeCap = effectiveUsage?.rpm_free_limit ?? 20;

  const currentCatalogModels = catalogByProvider[selectedProvider] ?? [];

  const allModels = useMemo(() => {
    const base =
      currentCatalogModels.length > 0 ? currentCatalogModels : selectedSpec.curatedModels;
    const byId = new Map<string, OpenRouterModelOption>();
    for (const cm of selectedSpec.curatedModels) {
      byId.set(cm.id, cm);
    }
    for (const m of base) {
      byId.set(m.id, m);
    }
    for (const cid of selectedCustomModels) {
      if (!byId.has(cid)) {
        byId.set(cid, formatModelDisplay(cid, selectedSpec.curatedModels));
      }
    }
    return Array.from(byId.values());
  }, [currentCatalogModels, selectedSpec, selectedCustomModels]);

  const freeModels = useMemo(() => allModels.filter((m) => m.is_free), [allModels]);

  const availableModels = useMemo(() => {
    if (selectedProvider !== "openrouter") return allModels;
    return canUsePaid ? allModels : freeModels;
  }, [selectedProvider, allModels, freeModels, canUsePaid]);

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

  const handleActivateProvider = async (pid: AiProviderId) => {
    setSaving(true);
    try {
      const slot = config.configuredProviders?.[pid];
      const nextModel = slot?.modelId || AI_PROVIDERS[pid].defaultModelId;
      const updated = await saveAiConfig({
        provider: pid,
        modelId: nextModel,
      });
      onConfigUpdated(updated);
      const res = await fetchOpenRouterModels(false, false, pid);
      if (res.models.length > 0) {
        setCatalogByProvider((prev) => ({ ...prev, [pid]: res.models }));
        onCatalogUpdated(res.models);
      }
      if (slot?.hasApiKey) {
        const check = await testAiConnection(pid);
        setTestResultsByProvider((prev) => ({ ...prev, [pid]: check }));
        if (check.ok) onUsageUpdated(check);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKey = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = normalizeApiKey(apiKeyInput);
    if (!cleaned) return;
    if (selectedProvider === "openrouter" && /^[a-fA-F0-9]{64}$/.test(cleaned)) {
      setTestResultsByProvider((prev) => ({
        ...prev,
        [selectedProvider]: {
          ok: false,
          provider: selectedProvider,
          message:
            "Falta el prefijo 'sk-or-v1-' al inicio de la clave. Cópiala completa desde sk-or-v1-... sin recortar.",
        },
      }));
      return;
    }

    setSaving(true);
    setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: undefined }));
    try {
      const updated = await saveAiConfig({
        provider: selectedProvider,
        targetProvider: selectedProvider,
        apiKey: cleaned,
        modelId: customModelInput.trim() || selectedModelId,
        clearCooldown: true,
      });
      onConfigUpdated(updated);
      setApiKeyInput("");
      setTesting(true);
      const check = await testAiConnection(selectedProvider);
      setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: check }));
      onUsageUpdated(check.ok ? check : null);
      void fetchOpenRouterModels(false, true, selectedProvider).then((res) => {
        if (res.models.length > 0) {
          setCatalogByProvider((prev) => ({ ...prev, [selectedProvider]: res.models }));
          onCatalogUpdated(res.models);
        }
      });
    } catch (err) {
      setTestResultsByProvider((prev) => ({
        ...prev,
        [selectedProvider]: {
          ok: false,
          provider: selectedProvider,
          message:
            err instanceof Error ? err.message : "No se pudo guardar la clave en la bóveda.",
        },
      }));
    } finally {
      setSaving(false);
      setTesting(false);
    }
  };

  const handleRefreshUsage = async () => {
    setTesting(true);
    setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: undefined }));
    try {
      const res = await testAiConnection(selectedProvider);
      setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: res }));
      if (selectedProvider === activeConfigProvider) {
        onUsageUpdated(res.ok ? res : null);
      }
    } finally {
      setTesting(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setTestResultsByProvider((prev) => ({ ...prev, [selectedProvider]: undefined }));
    try {
      const updated = await saveAiConfig({
        targetProvider: selectedProvider,
        clearKey: true,
      });
      onConfigUpdated(updated);
      if (selectedProvider === activeConfigProvider) {
        onUsageUpdated(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClearCooldown = async (pid: AiProviderId) => {
    const updated = await saveAiConfig({
      targetProvider: pid,
      clearCooldown: true,
    });
    onConfigUpdated(updated);
  };

  const handleToggleAutoFailover = async () => {
    const next = !(config.autoFailover ?? true);
    const updated = await saveAiConfig({ autoFailover: next });
    onConfigUpdated(updated);
  };

  const handleMoveFailoverPriority = async (pid: AiProviderId, direction: -1 | 1) => {
    const currentOrder = (config.failoverOrder && config.failoverOrder.length > 0
      ? config.failoverOrder
      : DEFAULT_FAILOVER_ORDER
    ).map((p) => normalizeProviderIdClient(p));
    const idx = currentOrder.indexOf(pid);
    if (idx === -1) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    const [removed] = nextOrder.splice(idx, 1);
    nextOrder.splice(swapIdx, 0, removed);
    const updated = await saveAiConfig({ failoverOrder: nextOrder });
    onConfigUpdated(updated);
  };

  const handleSelectModel = async (nextId: string) => {
    const clean = nextId.trim();
    if (!clean) return;
    setCustomModelInput(clean);
    const inCatalog = allModels.some((m) => m.id === clean);
    const nextCustom =
      !inCatalog && !selectedCustomModels.includes(clean)
        ? [clean, ...selectedCustomModels].slice(0, 8)
        : selectedCustomModels;

    const updated = await saveAiConfig({
      provider: selectedProvider,
      targetProvider: selectedProvider,
      modelId: clean,
      customModels: nextCustom,
    });
    onConfigUpdated(updated);
    onCatalogUpdated(allModels);
  };

  const handleReloadCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetchOpenRouterModels(false, true, selectedProvider);
      if (res.models.length > 0) {
        setCatalogByProvider((prev) => ({ ...prev, [selectedProvider]: res.models }));
        if (selectedProvider === activeConfigProvider) {
          onCatalogUpdated(res.models);
        }
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
    selectedKeySource === "vault"
      ? "Bóveda local"
      : selectedKeySource === "env"
        ? "Variable de entorno"
        : selectedKeySource === "browser"
          ? "Sesión local"
          : "Sin clave";

  const activeSpec = getProviderSpec(activeConfigProvider);
  const activeModelDisplay = formatModelDisplay(config.modelId, allModels);
  const autoFailoverEnabled = config.autoFailover ?? true;
  const failoverOrderList: AiProviderId[] = useMemo(() => {
    const raw =
      config.failoverOrder && config.failoverOrder.length > 0
        ? config.failoverOrder
        : DEFAULT_FAILOVER_ORDER;
    const out: AiProviderId[] = [];
    for (const p of raw) {
      const pid = normalizeProviderIdClient(p);
      if (!out.includes(pid)) out.push(pid);
    }
    for (const p of DEFAULT_FAILOVER_ORDER) {
      if (!out.includes(p)) out.push(p);
    }
    return out;
  }, [config.failoverOrder]);

  const configuredCount = AI_PROVIDER_LIST.filter(
    (s) => config.configuredProviders?.[s.id]?.hasApiKey
  ).length;

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
  } else if (selectedHasKey && selectedProvider === "openrouter") {
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
          <header className="relative z-[1] shrink-0 px-5 pt-4 pb-3 border-b border-white/[0.08] bg-white/[0.02] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                  {activeTab === "models" ? (
                    <ProviderIcon
                      provider={selectedProvider}
                      size={16}
                      className="text-white/95"
                    />
                  ) : (
                    <KeyRound className="w-4 h-4 text-white/90" />
                  )}
                </div>
                <div className="min-w-0">
                  <h2
                    id="openrouter-modal-title"
                    className="text-sm font-semibold text-white tracking-tight"
                  >
                    Proveedores de IA · Modelos y tarifas
                  </h2>
                  <p className="text-[11px] text-zinc-300/80 truncate flex items-center gap-1.5">
                    <span>Activo:</span>
                    <span className="text-zinc-100 font-medium inline-flex items-center gap-1">
                      <ProviderIcon provider={activeConfigProvider} size={11} />
                      {activeSpec.shortName} · {activeModelDisplay.name}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <div
                  role="tablist"
                  aria-label="Secciones de configuración de IA"
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
                    {configuredCount === 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300/90 shrink-0" />
                    )}
                    <span>Claves y respaldo</span>
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
            </div>

            {/* Selector Liquid Glass de los 6 proveedores + tarifa rápida */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {AI_PROVIDER_LIST.map((spec) => {
                const slot = config.configuredProviders?.[spec.id];
                const isViewing = selectedProvider === spec.id;
                const isActiveMain = activeConfigProvider === spec.id;
                const hasKey =
                  slot?.hasApiKey ?? (isActiveMain ? config.hasApiKey : false);
                const quotaState = slot?.quotaStatus ?? "ready";
                const dotClass =
                  hasKey && quotaState === "ready"
                    ? "bg-emerald-300/90"
                    : hasKey && (quotaState === "cooldown" || quotaState === "exhausted" || quotaState === "auth_error")
                      ? "bg-amber-300/90"
                      : "bg-zinc-500/70";

                return (
                  <button
                    key={spec.id}
                    type="button"
                    onClick={() => setSelectedProvider(spec.id)}
                    className={`quick-liquid-option px-2.5 py-2 rounded-xl text-left cursor-pointer transition-all ${
                      isViewing ? "is-selected text-white" : "text-zinc-200/85 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <ProviderIcon provider={spec.id} size={13} className="shrink-0" />
                        <span className="text-[11px] font-medium truncate">{spec.shortName}</span>
                      </span>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
                        title={
                          hasKey
                            ? quotaState === "ready"
                              ? "Clave lista"
                              : "Cuota en enfriamiento"
                            : "Sin clave"
                        }
                      />
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-1 text-[9.5px] text-zinc-400">
                      <span className="truncate">{spec.tierBadge}</span>
                      {isActiveMain && (
                        <span className="text-[8.5px] font-mono uppercase text-zinc-200/90 shrink-0">
                          En uso
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </header>

          {/* Barra compacta de tarifas y estado del proveedor seleccionado */}
          <div className="relative z-[1] shrink-0 px-5 pt-3">
            <div className="quick-liquid-subcard px-3 py-2 rounded-xl flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 font-medium text-white">
                  <ProviderIcon provider={selectedProvider} size={13} />
                  {selectedSpec.name}
                </span>
                <span className="text-zinc-300/85 font-mono text-[10.5px]">
                  In: <strong className="text-zinc-100 font-medium">{selectedSpec.inputPriceHint}</strong>
                  {" · "}Out: <strong className="text-zinc-100 font-medium">{selectedSpec.outputPriceHint}</strong>
                  {selectedSpec.supportsPromptCache && (
                    <>
                      {" · "}Caché: <strong className="text-zinc-100 font-medium">{selectedSpec.cachePriceHint}</strong>
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2 ml-auto shrink-0">
                {(selectedQuotaStatus === "exhausted" ||
                  selectedQuotaStatus === "cooldown" ||
                  selectedQuotaStatus === "auth_error") && (
                  <button
                    type="button"
                    onClick={() => void handleClearCooldown(selectedProvider)}
                    className="quick-liquid-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-amber-200 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Restablecer cuota
                  </button>
                )}

                {selectedProvider !== activeConfigProvider && selectedHasKey ? (
                  <button
                    type="button"
                    onClick={() => void handleActivateProvider(selectedProvider)}
                    disabled={saving}
                    className="quick-liquid-btn-ready px-2.5 py-0.5 rounded-full text-[10.5px] font-medium cursor-pointer"
                  >
                    Usar {selectedSpec.shortName}
                  </button>
                ) : !selectedHasKey ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("account")}
                    className="text-sky-200/90 hover:text-white font-medium cursor-pointer transition-colors"
                  >
                    Conectar clave →
                  </button>
                ) : (
                  <span className="text-[10.5px] text-zinc-400">
                    {selectedSpec.supportsFreeTier ? "Tier gratis + pago" : "Pago por uso"}
                  </span>
                )}
              </div>
            </div>
            <p className="text-[10.5px] text-zinc-400/90 mt-1.5 px-0.5 truncate">
              {selectedSpec.rateLimitNote}
            </p>
          </div>

          {/* Contenido principal */}
          {activeTab === "models" ? (
            <div
              key={`models-${selectedProvider}`}
              role="tabpanel"
              aria-label="Catálogo de modelos"
              className="xook-dialog-tab-panel relative z-[1] flex-1 min-h-0 flex flex-col px-5 pt-2.5 pb-3 gap-2.5"
            >
              {/* Barra de estado fija */}
              <div className="quick-liquid-subcard shrink-0 h-9 px-3 rounded-xl flex items-center justify-between gap-2 text-[11px]">
                {!selectedHasKey ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-200/90">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300/90 shrink-0" />
                      <span className="truncate">
                        Sin clave de {selectedSpec.shortName} · Vista previa de modelos y tarifas
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-sky-200/90 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Pegar clave →
                    </button>
                  </>
                ) : testing && !effectiveUsage ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-300">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-200 shrink-0" />
                      <span className="truncate">
                        Verificando conexión con {selectedSpec.shortName}…
                      </span>
                    </div>
                    <span className="font-mono text-[10.5px] text-zinc-400 shrink-0">
                      {allModels.length} modelos
                    </span>
                  </>
                ) : currentTestResult && !currentTestResult.ok ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-rose-200">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-300 shrink-0" />
                      <span className="truncate">{currentTestResult.message}</span>
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
                        {selectedProvider === "deepseek" && typeof effectiveUsage.balance_usd === "number"
                          ? `DeepSeek saldo: $${effectiveUsage.balance_usd.toFixed(2)} USD`
                          : selectedProvider === "openrouter"
                            ? canUsePaid
                              ? hasKeyLimit
                                ? `$${(effectiveUsage.limit_remaining ?? 0).toFixed(2)} disponibles`
                                : hasAccountCredits
                                  ? `$${(effectiveUsage.credits_remaining ?? 0).toFixed(2)} créditos`
                                  : "OpenRouter con saldo"
                              : `Plan gratuito · ${requestsToday}/${dailyFreeCap} hoy · ${rpmFreeCap}/min`
                            : `${selectedSpec.shortName} conectado · ${selectedMaskedKey}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-zinc-300 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Cuenta →
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0 text-zinc-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300/80 shrink-0" />
                      <span className="truncate">
                        Clave lista ({selectedMaskedKey}) · {sourceLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("account")}
                      className="text-zinc-300 hover:text-white font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      Ver clave →
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
                  {freeModels.length > 0 && (
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
                  )}
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
                    placeholder={`Buscar modelo en ${selectedSpec.shortName}...`}
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
                  onClick={() => void handleReloadCatalog()}
                  disabled={loadingCatalog}
                  title={`Actualizar catálogo de ${selectedSpec.shortName}`}
                  aria-label={`Actualizar catálogo de ${selectedSpec.shortName}`}
                  className="quick-liquid-btn w-8 h-8 rounded-xl inline-flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalog ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* Lista única scrolleable con tarifas por modelo */}
              <div
                ref={listScrollRef}
                onScroll={handleModelListScroll}
                className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-1"
              >
                {loadingCatalog && currentCatalogModels.length === 0 ? (
                  <div className="h-full min-h-[160px] flex items-center justify-center gap-2 text-xs text-zinc-300">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-200" />
                    <span>Cargando modelos de {selectedSpec.shortName}…</span>
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className="h-full min-h-[160px] flex flex-col items-center justify-center gap-2.5 text-center px-4">
                    <p className="text-xs text-zinc-400">
                      No se encontraron modelos con "{modelSearch}".
                    </p>
                    {modelSearch.trim().length > 2 && (
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
                  <div key={`${selectedProvider}-${catalogFilter}`} className="xook-catalog-swap space-y-1">
                    {slicedModels.map((m, idx) => {
                      const selected =
                        activeConfigProvider === selectedProvider && config.modelId === m.id;
                      const requiresCredits =
                        selectedProvider === "openrouter" && !m.is_free && !canUsePaid;
                      const isExpandedReveal = idx >= revealFromIndex;
                      const hasPrices =
                        typeof m.prompt_price_per_million === "number" &&
                        typeof m.completion_price_per_million === "number" &&
                        (m.prompt_price_per_million > 0 || m.completion_price_per_million > 0);
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
                            <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium">
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
                              ) : null}
                              {hasPrices && (
                                <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9.5px] font-mono text-zinc-300 shrink-0 tabular-nums">
                                  {formatPricePerMillion(m.prompt_price_per_million)} /{" "}
                                  {formatPricePerMillion(m.completion_price_per_million)} 1M
                                  {typeof m.cache_price_per_million === "number" &&
                                  m.cache_price_per_million > 0
                                    ? ` · caché ${formatPricePerMillion(m.cache_price_per_million)}`
                                    : ""}
                                </span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-zinc-400 truncate mt-0.5">
                              {[
                                m.hint && m.hint !== m.name ? m.hint : null,
                                m.context_length
                                  ? `${formatContextLength(m.context_length)} ctx`
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
              key={`account-${selectedProvider}`}
              role="tabpanel"
              aria-label="Cuenta, claves y respaldo automático"
              className="xook-dialog-tab-panel relative z-[1] flex-1 min-h-0 overflow-y-auto px-5 py-3.5 space-y-4"
            >
              {/* Bloque 1: Clave API del proveedor seleccionado */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                    <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                      <ShieldCheck className="w-3 h-3 text-white/85" />
                    </span>
                    Clave API de {selectedSpec.shortName}
                  </span>
                  <span className="quick-liquid-chip inline-flex items-center gap-1.5 text-[10.5px] font-mono px-2.5 py-0.5 rounded-full text-zinc-200">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        selectedHasKey ? "bg-emerald-300/90" : "bg-amber-300/90"
                      }`}
                    />
                    {selectedHasKey
                      ? `${selectedMaskedKey} · ${sourceLabel}`
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
                        selectedHasKey
                          ? `Pegar nueva clave (${selectedSpec.keyPrefixHint}) para reemplazar`
                          : `Pega tu clave de ${selectedSpec.shortName}: ${selectedSpec.keyPrefixHint}`
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
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
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
                    Consíguela en{" "}
                    <a
                      href={selectedSpec.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-zinc-100 underline decoration-white/30 hover:decoration-white"
                    >
                      {selectedSpec.docsUrl.replace(/^https?:\/\//, "")}
                    </a>
                    {" "}o pégala directo en el chat.
                  </span>

                  <div className="flex items-center gap-1.5">
                    {selectedHasKey && (
                      <button
                        type="button"
                        onClick={() => void handleRefreshUsage()}
                        disabled={testing}
                        className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-zinc-200 hover:text-white cursor-pointer"
                      >
                        {testing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        <span>Probar</span>
                      </button>
                    )}
                    {selectedHasKey && selectedKeySource !== "env" && (
                      <button
                        type="button"
                        onClick={() => void handleClearKey()}
                        title={`Eliminar clave de ${selectedSpec.shortName}`}
                        className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-zinc-300 hover:text-rose-200 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Quitar</span>
                      </button>
                    )}
                  </div>
                </div>

                {currentTestResult && (
                  <div
                    className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                      currentTestResult.ok
                        ? "quick-liquid-subcard text-zinc-100"
                        : "bg-rose-500/10 border border-rose-400/25 text-rose-200"
                    }`}
                  >
                    {currentTestResult.ok ? (
                      <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-3 h-3 text-white" />
                      </span>
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
                    )}
                    <span>{currentTestResult.message}</span>
                  </div>
                )}

                {selectedQuotaReason &&
                  (selectedQuotaStatus === "exhausted" ||
                    selectedQuotaStatus === "cooldown" ||
                    selectedQuotaStatus === "auth_error") && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-300/25 text-[11px] text-amber-100 flex items-center justify-between gap-2">
                      <span className="truncate">
                        Cuota / límite detectado:{" "}
                        {selectedCooldownUntil && selectedCooldownUntil > Date.now()
                          ? `en pausa temporal`
                          : "limitado"}{" "}
                        · {selectedQuotaReason}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleClearCooldown(selectedProvider)}
                        className="quick-liquid-btn px-2.5 py-1 rounded-full text-[10.5px] text-white shrink-0 cursor-pointer"
                      >
                        Reactivar
                      </button>
                    </div>
                  )}
              </section>

              {/* Bloque 2: Métricas de uso (OpenRouter o saldo DeepSeek si disponible) */}
              {selectedHasKey &&
                selectedProvider === "openrouter" &&
                effectiveUsage && (
                  <section className="space-y-2.5 pt-3 border-t border-white/[0.08]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                      <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                        <Activity className="w-3 h-3 text-white/85" />
                      </span>
                      Límites y saldo en OpenRouter
                    </span>
                    <div className="quick-liquid-subcard p-3 rounded-xl space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            {hasKeyLimit
                              ? "Disponible en clave"
                              : hasAccountCredits
                                ? "Saldo restante"
                                : "Solicitudes hoy"}
                          </div>
                          <div className="text-sm font-mono font-semibold text-white mt-0.5 tabular-nums">
                            {hasKeyLimit
                              ? `$${(effectiveUsage.limit_remaining ?? 0).toFixed(2)}`
                              : hasAccountCredits
                                ? `$${(effectiveUsage.credits_remaining ?? 0).toFixed(2)}`
                                : `${requestsToday} / ${dailyFreeCap}`}
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Límite RPM gratis
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5 tabular-nums">
                            {rpmFreeCap} req/min
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                            Gasto en clave
                          </div>
                          <div className="text-sm font-mono font-semibold text-zinc-100 mt-0.5 tabular-nums">
                            ${(effectiveUsage.usage ?? 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
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
                    </div>
                  </section>
                )}

              {/* Bloque 3: Respaldo automático por cuota y orden de failover */}
              <section className="space-y-2.5 pt-3 border-t border-white/[0.08]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                      <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                        <Cpu className="w-3 h-3 text-white/85" />
                      </span>
                      Respaldo automático al agotar cuota
                    </span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Cuando un proveedor llega a límite (429/402 o saldo agotado), XOOK cambia en automático al siguiente con clave activa.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoFailoverEnabled}
                    onClick={() => void handleToggleAutoFailover()}
                    className={`quick-liquid-chip inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                      autoFailoverEnabled ? "quick-liquid-chip-active text-white" : "text-zinc-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        autoFailoverEnabled ? "bg-emerald-300/90" : "bg-zinc-500"
                      }`}
                    />
                    {autoFailoverEnabled ? "Automático activado" : "Desactivado"}
                  </button>
                </div>

                <div className="quick-liquid-subcard p-2.5 rounded-xl space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400 px-1">
                    Orden de prioridad ({configuredCount} de {AI_PROVIDER_LIST.length} conectados)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {failoverOrderList.map((pid, idx) => {
                      const spec = AI_PROVIDERS[pid];
                      const slot = config.configuredProviders?.[pid];
                      const hasKey = Boolean(slot?.hasApiKey);
                      const status = slot?.quotaStatus ?? "ready";
                      const statusLabel = !hasKey
                        ? "Sin clave"
                        : status === "exhausted"
                          ? "Sin saldo/cuota"
                          : status === "auth_error"
                            ? "Clave inválida"
                            : status === "cooldown"
                              ? "En espera"
                              : "Listo";
                      const statusDot = !hasKey
                        ? "bg-zinc-500/70"
                        : status === "ready"
                          ? "bg-emerald-300/90"
                          : "bg-amber-300/90";

                      return (
                        <div
                          key={pid}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07] text-[11px]"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedProvider(pid)}
                            className="flex items-center gap-2 min-w-0 text-left cursor-pointer hover:text-white"
                          >
                            <span className="font-mono text-[10px] text-zinc-400 w-3.5 shrink-0">
                              {idx + 1}.
                            </span>
                            <ProviderIcon provider={pid} size={13} className="shrink-0 text-zinc-200" />
                            <span className="font-medium text-zinc-100 truncate">
                              {spec.shortName}
                            </span>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-300/85">
                              <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                              {statusLabel}
                            </span>
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => void handleMoveFailoverPriority(pid, -1)}
                              aria-label={`Subir prioridad de ${spec.shortName}`}
                              className="quick-liquid-btn w-5 h-5 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <ArrowLeft className="w-2.5 h-2.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === failoverOrderList.length - 1}
                              onClick={() => void handleMoveFailoverPriority(pid, 1)}
                              aria-label={`Bajar prioridad de ${spec.shortName}`}
                              className="quick-liquid-btn w-5 h-5 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Bloque 4: Identificador manual */}
              <section className="pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowManualId((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-100 cursor-pointer transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showManualId ? "rotate-180" : ""}`}
                  />
                  <span>
                    Ingresar identificador manual de modelo en {selectedSpec.shortName} (avanzado)
                  </span>
                </button>
                <div className={`xook-collapse-grid ${showManualId ? "is-open" : ""}`}>
                  <div>
                    <div className="flex gap-2 mt-2.5">
                      <input
                        type="text"
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        placeholder={`ej. ${selectedSpec.defaultModelId}`}
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
