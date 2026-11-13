import React, { useState, useEffect, useRef, useId } from "react";
import { 
  CheckCircle2, 
  Brain, 
  Store, 
  FolderOpen,
  Plus,
  Send,
  Zap,
  Check,
  X,
  FileText,
  ListTodo,
  PanelLeft,
  ChevronDown,
  Paperclip,
  Cpu,
  AtSign,
  KeyRound,
  Sparkles,
  Activity,
  RefreshCw,
  Trash2,
  MessageSquare,
  SquarePen,
  Table2,
  UserCircle2
} from "lucide-react";
import { XoxStar, XoxState } from "./components/XoxStar";
import { XookWordmark } from "./components/XookBrand";
import { useAnimatedPresence } from "./hooks/useAnimatedPresence";
import {
  CanvasArtifact,
  canvasHasCellData,
  cleanVisibleReply,
  extractFirstHtmlTable,
  extractFirstMarkdownTable,
  markdownTableToCanvasArtifact,
  sanitizeCanvasArtifact,
} from "./features/canvas/canvasSchema";
import { CanvasPanel } from "./features/canvas/CanvasPanel";
import {
  AgendaItem,
  TaskHistoryItem,
  TaskProposal,
  computeVerifiedDecision,
  inferAlarmFromMisclassifiedTimer,
  parseScheduleTarget,
} from "./features/task-decisions/taskSchema";
import {
  ScheduledEventInput,
  TaskDecisionsPanel,
  TaskPanelTab,
} from "./features/task-decisions/TaskDecisionsPanel";
import {
  InventoryItem,
  LedgerAgendaItem,
  ReviewRun,
  completeAgendaItem,
  decideTaskHitl,
  deleteAgendaItem,
  hydrateWorkspaceLedger,
  importInventoryFile,
  listAgendaItems,
  listInventoryItems,
  listReviewRuns,
  recordHistoryEntry,
  resetTimerState,
  runBusinessReview,
  subscribeAgendaAndDatosEvents,
  subscribeLedgerUpdated,
  subscribeReviewUpdated,
  toggleTimerState,
  updateTaskProposal,
  upsertAgendaItem,
  upsertTasksBatch,
} from "./features/task-decisions/ledgerApi";
import {
  WorkspaceNodeEntry,
  WorkspaceOverview,
  createWorkspace,
  createWorkspaceFolder,
  getWorkspaceOverview,
  isWorkspaceTauriRuntime,
  openWorkspaceFolder,
  readWorkspaceFile,
  renameWorkspace,
  resolveCommandPermission,
  saveWorkspaceFile,
  subscribePermissionEvents,
  subscribeWorkspaceUpdated,
  switchWorkspace,
} from "./features/workspace-store/workspaceApi";
import {
  SelectedWorkspaceFile,
  WorkspaceTreePanel,
} from "./features/workspace-store/WorkspaceTreePanel";
import {
  ChatMessageList,
  UiChatMessage,
} from "./features/ai-service/ChatMessageList";
import {
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "./features/ai-service/CommandPermissionCard";
import { OpenRouterSettingsModal } from "./features/ai-service/OpenRouterSettingsModal";
import { ClarificationModal } from "./features/ai-service/ClarificationModal";
import { LocalAuthModal } from "./features/workspace-store/LocalAuthModal";
import {
  ConversationThread,
  LocalUserProfile,
  deleteLocalConversation,
  deriveConversationTitle,
  getLocalUserProfile,
  listLocalConversations,
  saveLocalConversation,
} from "./features/workspace-store/localStore";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  ClarificationSpec,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  ThinkingStep,
  detectApiKeyInText,
  estimateTokens,
  extractErrorMessage,
  fetchOpenRouterModels,
  formatContextLength,
  formatModelDisplay,
  formatTokenCount,
  getAiConfigStatus,
  getAvailableQuickModels,
  getLocalDailyRequestCount,
  incrementLocalDailyRequestCount,
  isKeySetupIntent,
  runXoxAiChatStream,
  saveAiConfig,
  testAiConnection,
} from "./features/ai-service/aiClient";

interface MemoryPattern {
  pattern_id: string;
  description: string;
  confidence: number;
}

interface ContextItem {
  id: string;
  name: string;
  type: "profile" | "memory" | "skill" | "catalog";
  path: string;
  pinned: boolean;
  content: string;
  isCustom?: boolean;
}

// Etiquetas legibles por tipo de fuente de contexto (sin jerga técnica)
const CONTEXT_LABEL: Record<ContextItem["type"], string> = {
  profile: "Reglas de tienda",
  memory: "Memoria",
  skill: "Asesor de stock",
  catalog: "Catálogo",
};

function ContextIcon({ type, className = "w-3.5 h-3.5 text-zinc-400 shrink-0" }: { type: ContextItem["type"]; className?: string }) {
  switch (type) {
    case "profile":
      return <Store className={className} />;
    case "memory":
      return <Brain className={className} />;
    case "skill":
      return <Zap className={className} />;
    case "catalog":
      return <FileText className={className} />;
  }
}

// Miniatura del rostro de Xox para el header (silueta fiel al cuerpo estelar y expresión)
const XOX_MINI_STAR_PATH =
  "M118.1 67.6Q126.8 55.4 132.4 69.3L137.9 82.7Q142.8 94.7 155.2 98.6L167.3 102.4Q181.6 106.9 170.2 116.6L160.1 125.0Q150.1 133.4 149.7 146.4L149.5 155.2Q149.0 170.2 135.4 163.8L130.5 161.5Q118.7 156.0 106.7 160.9L100.9 163.3Q87.0 168.9 87.7 153.9L88.2 143.7Q88.8 130.7 79.7 121.4L69.6 111.0Q59.1 100.2 73.8 97.3L88.2 94.4Q101.0 91.8 108.5 81.2Z";

function XoxHeaderFace({
  state,
  onClick,
}: {
  state: XoxState;
  onClick?: () => void;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-mini-body-${uid}`,
    rim: `xox-mini-rim-${uid}`,
    core: `xox-mini-core-${uid}`,
  };
  const isAlert = state === "alert";
  const isSuccess = state === "success";
  const isSyncing = state === "syncing";
  const isThinking = state === "thinking";
  const coreColor = isAlert
    ? "#EF4444"
    : isSuccess
    ? "#34D399"
    : isSyncing
    ? "#2DD4BF"
    : "#38BDF8";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Xox, mascota de XOOK"
      title="Xox · Haz clic para saludar"
      className="w-[26px] h-[26px] flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50 rounded-full"
    >
      <svg viewBox="55 52 130 126" className="w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={ids.body} x1="65" y1="60" x2="175" y2="170" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.34" />
            <stop offset="45%" stopColor="#BAE6FD" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.24" />
          </linearGradient>
          <linearGradient id={ids.rim} x1="62" y1="58" x2="176" y2="172" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="50%" stopColor="#BAE6FD" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.38" />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={isThinking || isAlert || isSuccess || isSyncing ? coreColor : "#FFFFFF"} stopOpacity="0.55" />
            <stop offset="55%" stopColor={coreColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={coreColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        <path
          d={XOX_MINI_STAR_PATH}
          fill={isAlert ? "rgba(239,68,68,0.24)" : `url(#${ids.body})`}
          stroke={isAlert ? "#F87171" : `url(#${ids.rim})`}
          strokeWidth="4.2"
          strokeLinejoin="round"
        />

        <circle cx="120" cy="117" r="30" fill={`url(#${ids.core})`} />

        {/* Reflejo especular sutil */}
        <ellipse
          cx="104"
          cy="94"
          rx="12"
          ry="4.2"
          transform="rotate(-30 104 94)"
          fill="#FFFFFF"
          opacity="0.24"
        />

        {/* Mejillas */}
        <circle cx="99.5" cy="127.5" r="4.6" fill={isAlert ? "#F87171" : "#38BDF8"} opacity="0.38" />
        <circle cx="140.5" cy="127.5" r="4.6" fill={isAlert ? "#F87171" : "#38BDF8"} opacity="0.38" />

        {/* Ojos */}
        {isSuccess ? (
          <>
            <path d="M104 117Q110.5 107.5 117 117" stroke="#FFFFFF" strokeWidth="4.4" strokeLinecap="round" fill="none" />
            <path d="M123 117Q129.5 107.5 136 117" stroke="#FFFFFF" strokeWidth="4.4" strokeLinecap="round" fill="none" />
            <path d="M113 128.5Q120 135.5 127 128.5" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" fill="none" opacity="0.92" />
          </>
        ) : (
          <>
            <g transform="translate(110.5 115)">
              <g className="xox-mini-eye">
                <ellipse cx="0" cy="0" rx="5.2" ry="7.8" fill="#FFFFFF" opacity="0.96" />
                <circle cx="1.9" cy="-2.5" r="1.9" fill={isAlert ? "#FCA5A5" : "#38BDF8"} />
              </g>
            </g>
            <g transform="translate(129.5 115)">
              <g className="xox-mini-eye">
                <ellipse cx="0" cy="0" rx="5.2" ry="7.8" fill="#FFFFFF" opacity="0.96" />
                <circle cx="1.9" cy="-2.5" r="1.9" fill={isAlert ? "#FCA5A5" : "#38BDF8"} />
              </g>
            </g>
          </>
        )}
      </svg>
    </button>
  );
}

export default function App() {
  const [tasks, setTasks] = useState<TaskProposal[]>([]);
  const [agendaItems, setAgendaItems] = useState<LedgerAgendaItem[]>([]);
  const [historyItems, setHistoryItems] = useState<TaskHistoryItem[]>([]);
  const agendaItemsRef = useRef<LedgerAgendaItem[]>(agendaItems);
  agendaItemsRef.current = agendaItems;
  const suppressLedgerSyncUntilRef = useRef<number>(0);
  const paramSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [latestReview, setLatestReview] = useState<ReviewRun | null>(null);
  const [isReviewRunning, setIsReviewRunning] = useState<boolean>(false);
  const [permissionItems, setPermissionItems] = useState<CommandPermissionUiItem[]>([]);
  const activeStreamIdRef = useRef<string | null>(null);
  const [workspaceOverview, setWorkspaceOverview] = useState<WorkspaceOverview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<SelectedWorkspaceFile | null>(null);
  const selectedWorkspacePathRef = useRef<string | null>(null);
  selectedWorkspacePathRef.current = selectedWorkspaceFile?.relativePath ?? null;
  const [pinnedWorkspacePaths, setPinnedWorkspacePaths] = useState<Set<string>>(
    () => new Set(["empresa/perfil.json", "empresa/reglas/operacion.md", "memoria/hechos.md"])
  );
  const [highlightedWorkspacePath, setHighlightedWorkspacePath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  
  // Estado de Xox (Mascota Digital y Orquestador Estelar)
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [xoxMessage, setXoxMessage] = useState<string>("¿En qué puedo ayudarte?");
  
  // Estados para paneles laterales y tareas
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(true);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(true);
  const [taskTab, setTaskTab] = useState<TaskPanelTab>("pending");
  const [selectedContext, setSelectedContext] = useState<ContextItem | null>(null);
  const [showStatePreview, setShowStatePreview] = useState<boolean>(false);

  // Límites y anchos redimensionables para paneles laterales (Estilo Antigravity / IDE)
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 480;
  const MIN_RIGHT_WIDTH = 280;
  const MAX_RIGHT_WIDTH = 540;

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("xook_left_width");
      return saved ? Math.min(Math.max(Number(saved), MIN_LEFT_WIDTH), MAX_LEFT_WIDTH) : 280;
    } catch {
      return 280;
    }
  });

  const [rightWidth, setRightWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("xook_right_width");
      return saved ? Math.min(Math.max(Number(saved), MIN_RIGHT_WIDTH), MAX_RIGHT_WIDTH) : 340;
    } catch {
      return 340;
    }
  });

  const [isResizingLeft, setIsResizingLeft] = useState<boolean>(false);
  const [isResizingRight, setIsResizingRight] = useState<boolean>(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Archivos adjuntos, modelo activo, bóveda IA y chat real
  const [attachments, setAttachments] = useState<File[]>([]);
  const [modelId, setModelId] = useState<string>(OPENROUTER_PRESET_MODELS[0].id);
  const [aiConfig, setAiConfig] = useState<AiConfigStatus>({
    provider: "openrouter",
    modelId: OPENROUTER_PRESET_MODELS[0].id,
    hasApiKey: false,
    maskedKey: null,
    keySource: "none",
    customModels: [],
  });
  const [showAiSettings, setShowAiSettings] = useState<boolean>(false);
  const [activeClarification, setActiveClarification] = useState<ClarificationSpec | null>(null);
  const [accountUsage, setAccountUsage] = useState<AiConnectionTestResult | null>(null);
  const [catalogModels, setCatalogModels] = useState<OpenRouterModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [unavailableModelIds, setUnavailableModelIds] = useState<Set<string>>(() => new Set());
  const [requestsToday, setRequestsToday] = useState<number>(() => getLocalDailyRequestCount(null));
  const [chatMessages, setChatMessages] = useState<UiChatMessage[]>([]);
  const [activeCanvas, setActiveCanvas] = useState<CanvasArtifact | null>(null);
  const [showCanvas, setShowCanvas] = useState<boolean>(false);
  const [isChatStreaming, setIsChatStreaming] = useState<boolean>(false);
  const [localUser, setLocalUser] = useState<LocalUserProfile | null>(null);
  const [showLocalAuth, setShowLocalAuth] = useState<boolean>(false);
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => `conv_${Date.now()}`);
  const [leftTab, setLeftTab] = useState<"context" | "chats">("context");
  const [thinkingLabel, setThinkingLabel] = useState<string>("Consultando a Xox...");
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
  const [showContextMenu, setShowContextMenu] = useState<boolean>(false);
  const [learningToast, setLearningToast] = useState<MemoryPattern | null>(null);
  const [inputExpanded, setInputExpanded] = useState<boolean>(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const pendingSecretKeysRef = useRef<Map<string, string>>(new Map());
  const chatMessagesRef = useRef<UiChatMessage[]>(chatMessages);
  chatMessagesRef.current = chatMessages;
  const activeConvIdRef = useRef<string>(activeConversationId);
  activeConvIdRef.current = activeConversationId;
  const activeConvCreatedAtRef = useRef<string>(new Date().toISOString());

  // Burbuja de saludo de Xox (solo al hacer clic sobre la mascota)
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLeaving, setGreetingLeaving] = useState<boolean>(false);
  const [summonSeq, setSummonSeq] = useState<number>(0);
  const greetingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const xoxPhaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isChatStreamingRef = useRef<boolean>(false);
  isChatStreamingRef.current = isChatStreaming;

  const clearXoxPhaseTimers = () => {
    xoxPhaseTimersRef.current.forEach(clearTimeout);
    xoxPhaseTimersRef.current = [];
  };

  const triggerReadingPulse = (label: string, durationMs = 1150) => {
    if (isChatStreamingRef.current) return;
    clearXoxPhaseTimers();
    setXoxState("reading");
    setXoxMessage(label);
    xoxPhaseTimersRef.current.push(
      setTimeout(() => {
        if (isChatStreamingRef.current) return;
        setXoxState((s) => (s === "reading" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, durationMs)
    );
  };

  useEffect(
    () => () => {
      greetingTimers.current.forEach(clearTimeout);
      clearXoxPhaseTimers();
    },
    []
  );
  const lastMsg = chatMessages[chatMessages.length - 1];
  const lastMsgStreamLen = (lastMsg?.content?.length ?? 0) + (lastMsg?.reasoning?.length ?? 0);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: isChatStreaming ? "auto" : "smooth", block: "end" });
  }, [chatMessages.length, lastMsgStreamLen, xoxState, isChatStreaming]);

  const canUsePaidModels = Boolean(accountUsage?.can_use_paid_models);
  const availableQuickModels = getAvailableQuickModels(
    catalogModels,
    aiConfig.customModels,
    canUsePaidModels,
    unavailableModelIds
  );

  const activeModel: OpenRouterModelOption = formatModelDisplay(modelId, catalogModels);

  // Lista de elementos reales en la Ventana de Contexto
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const activeContextItems = contextItems.filter(
    (c) => c.pinned || selectedContext?.id === c.id
  );
  const totalActiveTokens = activeContextItems.reduce(
    (sum, item) => sum + estimateTokens(item.content),
    0
  );
  const modelContextWindow = activeModel.context_length ?? 128000;
  const contextUsagePct =
    modelContextWindow > 0
      ? Math.min(100, Math.round((totalActiveTokens / modelContextWindow) * 1000) / 10)
      : 0;

  const freeCatalogCount = catalogModels.filter((m) => m.is_free).length;

  const usageSummary = (() => {
    if (!aiConfig.hasApiKey) {
      return {
        primary: "Conectar IA",
        tierLabel: "OpenRouter",
        headline: "Sin conectar",
        detail: "Conecta tu clave para consultar límites y modelos",
        pct: 0,
        connected: false,
      };
    }

    if (!accountUsage) {
      return {
        primary: activeModel.name,
        tierLabel: "Límite OpenRouter",
        headline: "Consultando…",
        detail: `${requestsToday} consultas hoy en este equipo`,
        pct: 0,
        connected: true,
      };
    }

    if (!accountUsage.ok) {
      return {
        primary: "OpenRouter · Revisar clave",
        tierLabel: "Límite OpenRouter",
        headline: "Error de acceso",
        detail: accountUsage.message || "Verifica tu clave en OpenRouter",
        pct: 100,
        connected: true,
      };
    }

    if (accountUsage.can_use_paid_models) {
      if (accountUsage.limit != null && accountUsage.limit > 0 && accountUsage.limit_remaining != null) {
        const usedUsd = Math.max(0, accountUsage.limit - accountUsage.limit_remaining);
        const pct = Math.min(100, Math.round((usedUsd / accountUsage.limit) * 100));
        return {
          primary: `OpenRouter · $${accountUsage.limit_remaining.toFixed(2)} disp.`,
          tierLabel: "Límite OpenRouter",
          headline: `$${accountUsage.limit_remaining.toFixed(2)} / $${accountUsage.limit.toFixed(2)}`,
          detail: `Uso hoy: $${(accountUsage.usage_daily ?? 0).toFixed(4)} USD · ${requestsToday} consultas`,
          pct,
          connected: true,
        };
      }
      if (
        accountUsage.credits_remaining != null &&
        accountUsage.credits_total != null &&
        accountUsage.credits_total > 0
      ) {
        const usedUsd = Math.max(0, accountUsage.credits_total - accountUsage.credits_remaining);
        const pct = Math.min(100, Math.round((usedUsd / accountUsage.credits_total) * 100));
        return {
          primary: `OpenRouter · $${accountUsage.credits_remaining.toFixed(2)} disp.`,
          tierLabel: "Saldo OpenRouter",
          headline: `$${accountUsage.credits_remaining.toFixed(2)} USD`,
          detail: `Gastado hoy: $${(accountUsage.usage_daily ?? 0).toFixed(4)} USD · ${requestsToday} consultas`,
          pct,
          connected: true,
        };
      }
      return {
        primary: "OpenRouter · Con saldo",
        tierLabel: "Límite OpenRouter",
        headline: "Plan activo",
        detail: `Gasto hoy: $${(accountUsage.usage_daily ?? 0).toFixed(4)} USD · ${requestsToday} consultas`,
        pct: 0,
        connected: true,
      };
    }

    const dailyLimit = accountUsage.daily_free_limit || 50;
    const rpmLimit = accountUsage.rpm_free_limit || 20;
    const pct = Math.min(100, Math.round((requestsToday / dailyLimit) * 100));
    return {
      primary: `OpenRouter · ${requestsToday}/${dailyLimit} hoy`,
      tierLabel: "Límite OpenRouter (Gratis)",
      headline: `${requestsToday} / ${dailyLimit} hoy`,
      detail: `${rpmLimit}/min máx. · ${
        freeCatalogCount > 0 ? `${freeCatalogCount} modelos gratis activos` : "Solo modelos gratuitos"
      }`,
      pct,
      connected: true,
    };
  })();

  async function refreshModelsAndUsage(
    forceRefresh = false,
    hasKeyOverride?: boolean,
    maskedKeyOverride?: string | null
  ) {
    setLoadingModels(true);
    let latestCatalog: OpenRouterModelOption[] = catalogModels;
    try {
      const res = await fetchOpenRouterModels(false, forceRefresh);
      if (res.models.length > 0) {
        latestCatalog = res.models;
        setCatalogModels(res.models);
      }
    } catch {
      // Mantiene catálogo previo o respaldos
    } finally {
      setLoadingModels(false);
    }

    const hasKey = hasKeyOverride ?? aiConfig.hasApiKey;
    const keyScope = maskedKeyOverride !== undefined ? maskedKeyOverride : aiConfig.maskedKey;
    setRequestsToday(getLocalDailyRequestCount(keyScope));

    if (hasKey) {
      try {
        const usageRes = await testAiConnection();
        setAccountUsage(usageRes);
        if (usageRes.ok && !usageRes.can_use_paid_models) {
          setModelId((curr) => {
            const info = formatModelDisplay(curr, latestCatalog);
            return info.is_free ? curr : "openrouter/free";
          });
        }
      } catch {
        // Conserva estado anterior si falla la red
      }
    } else {
      setAccountUsage(null);
    }
  }

  async function hydrateLedgerState(preserveSecretCards = true) {
    if (!isWorkspaceTauriRuntime()) return;
    try {
      const ledger = await hydrateWorkspaceLedger();
      setTasks((prev) => {
        if (!preserveSecretCards) return ledger.tasks;
        const ephemeralSecrets = prev.filter((t) => t.intent.type === "save_api_key");
        const seen = new Set(ephemeralSecrets.map((t) => t.cardId));
        return [
          ...ephemeralSecrets,
          ...ledger.tasks.filter((t) => !seen.has(t.cardId)),
        ];
      });
      const repairedAgendaToPersist: LedgerAgendaItem[] = [];
      const normalizedAgenda = ledger.agendaItems.map((item) => {
        const repaired = inferAlarmFromMisclassifiedTimer(item);
        if (repaired) {
          repairedAgendaToPersist.push(repaired as LedgerAgendaItem);
          return repaired as LedgerAgendaItem;
        }
        return item;
      });
      setAgendaItems(normalizedAgenda);
      if (repairedAgendaToPersist.length > 0 && isWorkspaceTauriRuntime()) {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        for (const repairedItem of repairedAgendaToPersist) {
          void upsertAgendaItem(repairedItem).catch(() => {});
        }
      }
      setHistoryItems(ledger.historyItems);
    } catch (err) {
      console.error("Error hidratando ledger SQLite:", err);
    }
  }

  const hydrateWorkspaceState = async (
    overview: WorkspaceOverview,
    preferredSelectedPath?: string | null,
    overridePinned?: Set<string>
  ) => {
    setWorkspaceOverview(overview);
    setPatterns(overview.patterns ?? []);

    const activePinned = overridePinned ?? pinnedWorkspacePaths;
    const fileEntries = overview.entries.filter((e) => e.kind === "file" && e.editable);
    const availableSet = new Set(fileEntries.map((e) => e.relativePath));

    const toLoad = Array.from(activePinned).filter((p) => availableSet.has(p));
    const loadedSnippets = await Promise.all(
      toLoad.map(async (relPath): Promise<ContextItem | null> => {
        try {
          const f = await readWorkspaceFile(relPath);
          const ctxType: ContextItem["type"] =
            f.zone === "empresa"
              ? "profile"
              : f.zone === "memoria"
              ? "memory"
              : f.zone === "habilidades"
              ? "skill"
              : "catalog";
          return {
            id: `ws_${f.relativePath}`,
            name: f.name,
            type: ctxType,
            path: f.relativePath,
            pinned: true,
            content: f.content,
          };
        } catch {
          return null;
        }
      })
    );

    const cleanContext = loadedSnippets.filter((c): c is ContextItem => c !== null);
    setContextItems(cleanContext);

    const targetSelect =
      (preferredSelectedPath && availableSet.has(preferredSelectedPath)
        ? preferredSelectedPath
        : null) ??
      (availableSet.has("empresa/perfil.json")
        ? "empresa/perfil.json"
        : fileEntries[0]?.relativePath ?? null);

    if (targetSelect) {
      try {
        const f = await readWorkspaceFile(targetSelect);
        setSelectedWorkspaceFile({
          relativePath: f.relativePath,
          name: f.name,
          zone: f.zone,
          content: f.content,
          editable: f.editable,
          pinned: activePinned.has(f.relativePath),
          tokens: estimateTokens(f.content),
        });
        setSelectedContext(
          cleanContext.find((c) => c.path === f.relativePath) ?? cleanContext[0] ?? null
        );
      } catch {
        setSelectedWorkspaceFile(null);
      }
    } else {
      setSelectedWorkspaceFile(null);
      setSelectedContext(cleanContext[0] ?? null);
    }
  };

  const refreshInventoryAndReview = async () => {
    if (!isWorkspaceTauriRuntime()) return;
    const [invItems, reviews] = await Promise.all([
      listInventoryItems().catch(() => []),
      listReviewRuns(1).catch(() => []),
    ]);
    setInventoryItems(invItems);
    setLatestReview(reviews[0] ?? null);
  };

  useEffect(() => {
    async function loadData() {
      const tauriActive = isWorkspaceTauriRuntime();
      setIsTauriEnv(tauriActive);

      if (tauriActive) {
        setWorkspaceLoading(true);
        try {
          const overview = await getWorkspaceOverview();
          if (overview) {
            await hydrateWorkspaceState(overview);
            await Promise.all([
              hydrateLedgerState(false),
              refreshInventoryAndReview(),
            ]);
          }
        } catch (err) {
          console.error("Error inicializando workspace:", err);
        } finally {
          setWorkspaceLoading(false);
        }
      } else {
        // Modo Browser Preview: sin mocks falsos
        setContextItems([]);
        setSelectedContext(null);
        setPatterns([]);
        setTasks([]);
        setAgendaItems([]);
        setHistoryItems([]);
      }

      try {
        const [savedUser, savedConvs] = await Promise.all([
          getLocalUserProfile(),
          listLocalConversations(),
        ]);
        setLocalUser(savedUser);
        setConversations(savedConvs);
      } catch {
        // Sin datos previos locales
      }

      try {
        const cfg = await getAiConfigStatus();
        setAiConfig(cfg);
        if (cfg.modelId) {
          setModelId(cfg.modelId);
        }
        await refreshModelsAndUsage(false, cfg.hasApiKey, cfg.maskedKey);
      } catch {
        // Mantiene valores iniciales si aún no hay bóveda
        await refreshModelsAndUsage(false, false, null);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    if (!isTauriEnv) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    subscribeLedgerUpdated(() => {
      if (disposed) return;
      if (Date.now() < suppressLedgerSyncUntilRef.current) return;
      void hydrateLedgerState(true);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTauriEnv]);

  const persistConversation = async (
    nextMessages: UiChatMessage[],
    convId = activeConvIdRef.current
  ) => {
    if (nextMessages.length === 0) return;
    const now = new Date().toISOString();
    const thread: ConversationThread = {
      id: convId,
      title: deriveConversationTitle(nextMessages),
      createdAt: activeConvCreatedAtRef.current,
      updatedAt: now,
      userId: localUser?.id ?? null,
      messages: nextMessages,
    };
    try {
      const updatedList = await saveLocalConversation(thread);
      setConversations(updatedList);
    } catch {
      // Mantiene historial en memoria aunque falle escritura
    }
  };

  const handleStartNewChat = () => {
    if (isChatStreaming) return;
    const nextId = `conv_${Date.now()}`;
    activeConvCreatedAtRef.current = new Date().toISOString();
    setActiveConversationId(nextId);
    setChatMessages([]);
    setActiveCanvas(null);
    setShowCanvas(false);
    setXoxState("idle");
    setXoxMessage("¿En qué puedo ayudarte?");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelectConversation = (thread: ConversationThread) => {
    if (isChatStreaming) return;
    activeConvCreatedAtRef.current = thread.createdAt;
    setActiveConversationId(thread.id);
    const msgs = thread.messages ?? [];
    setChatMessages(msgs);
    let restoredCanvas: CanvasArtifact | null = null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].canvas) {
        const cleanRestored = sanitizeCanvasArtifact(msgs[i].canvas);
        if (cleanRestored && canvasHasCellData(cleanRestored)) {
          restoredCanvas = cleanRestored;
          break;
        }
      }
    }
    setActiveCanvas(restoredCanvas);
    setShowCanvas(Boolean(restoredCanvas));
    setXoxState("idle");
    setXoxMessage("¿En qué puedo ayudarte?");
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const updated = await deleteLocalConversation(id);
      setConversations(updated);
      if (id === activeConvIdRef.current) {
        handleStartNewChat();
      }
    } catch {
      // Ignorar
    }
  };

  const handleRateMessage = (msgId: string, rating: "up" | "down") => {
    const nextMessages = chatMessagesRef.current.map((m) =>
      m.id === msgId ? { ...m, feedback: m.feedback === rating ? null : rating } : m
    );
    setChatMessages(nextMessages);
    void persistConversation(nextMessages);
  };

  // Notificación discreta del aprendizaje más reciente (aparece y se oculta sola)
  useEffect(() => {
    if (patterns.length === 0) return;
    const latest = [...patterns].sort((a, b) => b.confidence - a.confidence)[0];
    const showT = setTimeout(() => setLearningToast(latest), 1200);
    const hideT = setTimeout(() => setLearningToast(null), 9000);
    return () => {
      clearTimeout(showT);
      clearTimeout(hideT);
    };
  }, [patterns]);

  useEffect(() => {
    if (!isTauriEnv) return;

    const showNotice = (msg: string, durationMs = 4500) => {
      setStatusMessage(msg);
      setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), durationMs);
    };

    const unsubWorkspace = subscribeWorkspaceUpdated(() => {
      void getWorkspaceOverview()
        .then((overview) => {
          if (overview) {
            return hydrateWorkspaceState(overview, selectedWorkspacePathRef.current);
          }
          return undefined;
        })
        .catch(() => {});
      void refreshInventoryAndReview();
    });

    const unsubReview = subscribeReviewUpdated((result) => {
      setLatestReview(result.reviewRun);
      void listInventoryItems().then(setInventoryItems).catch(() => {});
      if (result.newTasksCount > 0) {
        void hydrateLedgerState(true).catch(() => {});
      }
    });

    const unsubAgendaDatos = subscribeAgendaAndDatosEvents({
      onTimerExpired: (notice) => {
        showNotice(`Reloj vencido: "${notice.title}"`, 6000);
        void hydrateLedgerState(true).catch(() => {});
      },
      onAgendaDue: (notice) => {
        showNotice(`Agenda: "${notice.title}" (${notice.timeLabel})`, 6000);
        void hydrateLedgerState(true).catch(() => {});
      },
      onDatosChanged: (notice) => {
        showNotice(
          notice.newTasksCount > 0
            ? `Cambios detectados en ${notice.path}: ${notice.newTasksCount} nuevas propuestas.`
            : `Datos actualizados en ${notice.path}: ${notice.summary}`,
          5500
        );
      },
    });

    const unsubPermissions = subscribePermissionEvents({
      onRequest: (req) => {
        if (
          req.streamId &&
          activeStreamIdRef.current &&
          req.streamId !== activeStreamIdRef.current
        ) {
          return;
        }
        if (!activeStreamIdRef.current && req.streamId) {
          return;
        }
        setPermissionItems((prev) => applyPermissionRequestItem(prev, req));
      },
      onFinished: (ev) => {
        setPermissionItems((prev) => applyCommandFinishedEvent(prev, ev));
      },
    });

    return () => {
      unsubWorkspace();
      unsubReview();
      unsubAgendaDatos();
      unsubPermissions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriEnv]);

  // El input crece como una burbuja solo cuando hay texto escrito (vacío siempre queda en 1 línea)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const syncHeight = () => {
      if (!inputPrompt) {
        el.style.height = "";
        el.style.overflowY = "hidden";
        setInputExpanded(false);
        return;
      }

      const prev = el.style.height || `${el.offsetHeight}px`;
      el.style.transition = "none";
      el.style.height = "auto";
      const target = Math.min(el.scrollHeight, 200);
      el.style.height = prev;
      void el.offsetHeight; // forzar reflow para que la transición parta de la altura previa
      el.style.transition = "";
      el.style.height = `${target}px`;
      el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
      setInputExpanded(target > 46);
    };

    syncHeight();

    if (!inputPrompt || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [inputPrompt]);

  // Cerrar menús desplegables (modelos y contexto) al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!showModelMenu && !showContextMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showModelMenu && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setShowModelMenu(false);
      }
      if (showContextMenu && contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setShowContextMenu(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowModelMenu(false);
        setShowContextMenu(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [showModelMenu, showContextMenu]);

  // Atajo de teclado ⌘K para enfocar el input y respaldo local ⌘⇧X para Quick Bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "x" && isTauriEnv) {
        e.preventDefault();
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("toggle_quick_bar_cmd"))
          .catch(() => {});
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTauriEnv]);

  // Manejador global de arrastre para redimensionar paneles (60fps sin pérdida de foco)
  useEffect(() => {
    if (!isResizingLeft && !isResizingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.min(Math.max(e.clientX, MIN_LEFT_WIDTH), MAX_LEFT_WIDTH);
        setLeftWidth(newWidth);
        try {
          localStorage.setItem("xook_left_width", String(newWidth));
        } catch {
          // Ignore
        }
      } else if (isResizingRight) {
        const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, MIN_RIGHT_WIDTH), MAX_RIGHT_WIDTH);
        setRightWidth(newWidth);
        try {
          localStorage.setItem("xook_right_width", String(newWidth));
        } catch {
          // Ignore
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingLeft, isResizingRight]);

  const tasksRef = useRef<TaskProposal[]>(tasks);
  tasksRef.current = tasks;

  // Reloj en vivo para temporizadores activos en la pestaña Agenda
  const hasRunningTimers = agendaItems.some(
    (item) => item.kind === "timer" && item.isRunning && (item.remainingSeconds ?? 0) > 0
  );

  useEffect(() => {
    if (!hasRunningTimers) return;
    const interval = setInterval(() => {
      const nowMs = Date.now();
      let finishedTitle: string | null = null;
      for (const item of agendaItemsRef.current) {
        if (item.kind !== "timer" || !item.isRunning) continue;
        const nextRem = item.endsAt
          ? Math.max(0, Math.ceil((Date.parse(item.endsAt) - nowMs) / 1000))
          : Math.max(0, (item.remainingSeconds ?? 0) - 1);
        if (nextRem <= 0) {
          finishedTitle = item.title;
          break;
        }
      }

      setAgendaItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "timer" || !item.isRunning) return item;
          const remaining = item.endsAt
            ? Math.max(0, Math.ceil((Date.parse(item.endsAt) - nowMs) / 1000))
            : Math.max(0, (item.remainingSeconds ?? 0) - 1);
          if (remaining <= 0) {
            return {
              ...item,
              remainingSeconds: 0,
              isRunning: false,
              endsAt: undefined,
              timeLabel: "00:00",
            };
          }
          return { ...item, remainingSeconds: remaining };
        })
      );

      if (finishedTitle) {
        setXoxState("alert");
        setXoxMessage(`¡Tiempo cumplido: ${finishedTitle}!`);
        setStatusMessage(`Reloj finalizado: "${finishedTitle}"`);
        if (isTauriEnv) {
          suppressLedgerSyncUntilRef.current = Date.now() + 350;
          void listAgendaItems();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimers, isTauriEnv]);

  const nowTimeLabel = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const schedulePersistTaskProposal = (updatedTask: TaskProposal) => {
    if (!isTauriEnv || updatedTask.intent.type === "save_api_key") return;
    const prevTimer = paramSyncTimersRef.current[updatedTask.cardId];
    if (prevTimer) clearTimeout(prevTimer);
    paramSyncTimersRef.current[updatedTask.cardId] = setTimeout(() => {
      delete paramSyncTimersRef.current[updatedTask.cardId];
      void updateTaskProposal(updatedTask.cardId, updatedTask);
    }, 220);
  };

  const handleUpdateTaskParam = (
    cardId: string,
    key: string,
    value: number | string | boolean
  ) => {
    const existing = tasksRef.current.find((t) => t.cardId === cardId);
    if (existing) {
      schedulePersistTaskProposal({
        ...existing,
        paramValues: { ...existing.paramValues, [key]: value },
      });
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.cardId === cardId
          ? { ...t, paramValues: { ...t.paramValues, [key]: value } }
          : t
      )
    );
  };

  const handleToggleTaskChecklist = (cardId: string, itemId: string) => {
    const existing = tasksRef.current.find((t) => t.cardId === cardId);
    if (existing && isTauriEnv && existing.intent.type !== "save_api_key") {
      const updatedTask: TaskProposal = {
        ...existing,
        blocks: existing.blocks.map((blk) =>
          blk.type === "checklist"
            ? {
                ...blk,
                items: blk.items.map((it) =>
                  it.id === itemId ? { ...it, done: !it.done } : it
                ),
              }
            : blk
        ),
      };
      void updateTaskProposal(cardId, updatedTask);
    }
    setTasks((prev) =>
      prev.map((t) => {
        if (t.cardId !== cardId) return t;
        return {
          ...t,
          blocks: t.blocks.map((blk) =>
            blk.type === "checklist"
              ? {
                  ...blk,
                  items: blk.items.map((it) =>
                    it.id === itemId ? { ...it, done: !it.done } : it
                  ),
                }
              : blk
          ),
        };
      })
    );
  };

  const handleSelectModel = async (nextModelId: string) => {
    setModelId(nextModelId);
    setShowModelMenu(false);
    inputRef.current?.focus();
    try {
      const updated = await saveAiConfig({ modelId: nextModelId });
      setAiConfig(updated);
    } catch {
      // Mantiene selección local en caso de error temporal
    }
  };

  const executeSavePendingKey = async (cardId: string, cardRef?: TaskProposal) => {
    const secret = pendingSecretKeysRef.current.get(cardId);
    if (!secret) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        )
      );
      setStatusMessage("La clave ya fue procesada o expiró en memoria. Pégala de nuevo o usa Ajustes.");
      setTimeout(() => setStatusMessage(null), 4000);
      return;
    }

    setXoxState("syncing");
    setXoxMessage("Guardando clave en bóveda segura y probando conexión...");
    try {
      const updated = await saveAiConfig({
        provider: "openrouter",
        apiKey: secret,
        modelId,
      });
      pendingSecretKeysRef.current.delete(cardId);
      setAiConfig(updated);

      const testRes = await testAiConnection();
      setAccountUsage(testRes);
      setRequestsToday(getLocalDailyRequestCount(updated.maskedKey));
      if (testRes.ok && !testRes.can_use_paid_models) {
        setModelId((curr) =>
          formatModelDisplay(curr, catalogModels).is_free ? curr : "openrouter/free"
        );
      }
      const maskedLabel = updated.maskedKey ?? "cifrada";

      setTasks((prev) => prev.filter((t) => t.cardId !== cardId));
      const fallbackHistory: TaskHistoryItem = {
        id: `hist_${cardId}_${Date.now()}`,
        title: cardRef?.title ?? "Guardar clave API de OpenRouter",
        category: "boveda",
        decision: "approved",
        summary: `OpenRouter (${maskedLabel})`,
        timestampLabel: nowTimeLabel(),
      };
      if (isTauriEnv) {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        const savedHist = await recordHistoryEntry({
          id: fallbackHistory.id,
          title: fallbackHistory.title,
          category: fallbackHistory.category,
          decision: "approved",
          summary: fallbackHistory.summary,
          decidedBy: localUser?.name ?? undefined,
        }).catch(() => null);
        setHistoryItems((prev) => [savedHist ?? fallbackHistory, ...prev]);
      } else {
        setHistoryItems((prev) => [fallbackHistory, ...prev]);
      }

      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        ),
        {
          id: `msg_a_${Date.now()}`,
          role: "assistant",
          content: testRes.ok
            ? `Clave guardada en bóveda segura (**${maskedLabel}**) y conexión verificada con OpenRouter.\n\n${testRes.message} Ya puedes conversar conmigo usando **${formatModelDisplay(modelId, catalogModels).name}**.`
            : `Clave guardada en bóveda segura (**${maskedLabel}**), pero la verificación devolvió un aviso:\n${testRes.message}`,
          isError: !testRes.ok,
          actionButton: testRes.ok
            ? undefined
            : { label: "Revisar Ajustes OpenRouter", kind: "open_settings" },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);

      setStatusMessage(
        testRes.ok
          ? `OpenRouter conectado (${maskedLabel}).`
          : `Clave guardada (${maskedLabel}); revisa la conexión.`
      );
      setXoxState(testRes.ok ? "success" : "alert");
      setXoxMessage(
        testRes.ok
          ? "¡OpenRouter conectado y listo para trabajar!"
          : testRes.message
      );
      setTimeout(() => {
        setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4000);
      setTimeout(() => setStatusMessage(null), 4500);
    } catch (err) {
      pendingSecretKeysRef.current.delete(cardId);
      console.error(err);
      setXoxState("alert");
      setXoxMessage("No se pudo guardar la clave en la bóveda.");
      setStatusMessage("Error al guardar la clave en la bóveda local.");
      setTimeout(() => setStatusMessage(null), 4500);
    }
  };

  const handleChatAction = async (
    action: NonNullable<UiChatMessage["actionButton"]>
  ) => {
    if (action.kind === "open_settings") {
      setShowAiSettings(true);
      return;
    }
    if (action.kind === "open_clarification" && action.clarification) {
      setActiveClarification(action.clarification);
      return;
    }
    if (action.kind === "save_pending_key" && action.cardId) {
      const matchingCard = tasksRef.current.find((t) => t.cardId === action.cardId);
      await executeSavePendingKey(action.cardId, matchingCard);
    }
  };

  const clearPendingTaskSync = (cardId: string) => {
    const pendingTimer = paramSyncTimersRef.current[cardId];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete paramSyncTimersRef.current[cardId];
    }
  };

  const handleApproveTask = async (task: TaskProposal) => {
    clearPendingTaskSync(task.cardId);
    if (task.intent.type === "save_api_key") {
      await executeSavePendingKey(task.cardId, task);
      return;
    }

    const decision = computeVerifiedDecision(
      task,
      workspaceOverview?.profile.maxBudgetPerOrder
    );
    const decisionType: "approved" | "adjusted" = decision.wasAdjusted ? "adjusted" : "approved";
    const summaryText =
      decision.quantity !== null && task.intent.supplierName
        ? `+${decision.quantity} un. con ${task.intent.supplierName}`
        : task.intent.targetLabel;
    const amountLabel =
      decision.verifiedCost !== null
        ? `$${decision.verifiedCost.toLocaleString()} ${decision.currency}`
        : undefined;
    const notesText = decision.wasAdjusted
      ? "Cantidad o parámetros ajustados por el administrador"
      : "Autorizado por el administrador";

    let promotedAgendaDraft: LedgerAgendaItem | undefined;
    if (
      task.intent.type === "start_timer" ||
      task.intent.type === "schedule_event" ||
      task.intent.type === "save_note"
    ) {
      const schedBlock = task.blocks.find((b) => b.type === "schedule");
      const noteBlock = task.blocks.find((b) => b.type === "note");
      const chkBlock = task.blocks.find((b) => b.type === "checklist");
      const explicitDurationMin =
        typeof task.paramValues.duration_min === "number" && task.paramValues.duration_min > 0
          ? task.paramValues.duration_min
          : schedBlock?.type === "schedule" &&
            typeof schedBlock.durationSeconds === "number" &&
            schedBlock.durationSeconds > 0 &&
            schedBlock.mode === "timer"
          ? Math.round(schedBlock.durationSeconds / 60)
          : null;
      const autoOn =
        typeof task.paramValues.auto_schedule === "boolean"
          ? task.paramValues.auto_schedule
          : schedBlock?.type === "schedule"
          ? Boolean(schedBlock.autoSchedule)
          : false;
      const normalizedChecklist =
        chkBlock?.type === "checklist"
          ? chkBlock.items
              .map((it, idx) => {
                const label =
                  typeof it?.label === "string"
                    ? it.label.trim()
                    : typeof it === "string"
                      ? String(it).trim()
                      : "";
                if (!label) return null;
                return {
                  id: typeof it?.id === "string" && it.id.trim() ? it.id : `chk_${idx + 1}`,
                  label,
                  done: Boolean(it?.done),
                };
              })
              .filter(
                (it): it is { id: string; label: string; done: boolean } => Boolean(it)
              )
          : [];
      const agendaChecklist = normalizedChecklist.length > 0 ? normalizedChecklist : undefined;
      const resolvedTimeLabel =
        typeof task.paramValues.window_slot === "string" && task.paramValues.window_slot.trim()
          ? `${task.paramValues.window_slot.trim()} hrs`
          : schedBlock?.type === "schedule" && schedBlock.timeLabel?.trim()
          ? schedBlock.timeLabel.trim()
          : task.statusChip?.trim() || "09:00 hrs";
      const resolvedSubtitle =
        task.subtitle?.trim() ||
        (schedBlock?.type === "schedule" ? schedBlock.autoTriggerLabel : undefined);

      if (task.intent.type === "start_timer" && explicitDurationMin !== null) {
        const secs = Math.max(1, explicitDurationMin) * 60;
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: "timer",
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: `${String(explicitDurationMin).padStart(2, "0")}:00`,
          durationSeconds: secs,
          remainingSeconds: secs,
          endsAt: new Date(Date.now() + secs * 1000).toISOString(),
          isRunning: true,
          autoScheduled: autoOn,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      } else if (task.intent.type === "save_note") {
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: "note",
          title: task.title,
          timeLabel: "Fijada",
          noteContent: noteBlock?.type === "note" ? noteBlock.content : task.subtitle,
          checklist: agendaChecklist,
          tags: noteBlock?.type === "note" ? noteBlock.tags : undefined,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      } else {
        const scheduledTarget = parseScheduleTarget({
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: resolvedTimeLabel,
          dateLabel: schedBlock?.type === "schedule" ? schedBlock.dateLabel : undefined,
        });
        const recurrenceLabel =
          schedBlock?.type === "schedule" ? schedBlock.recurrence : undefined;
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: autoOn || Boolean(recurrenceLabel) ? "recurring" : "alarm",
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: scheduledTarget.displayTimeLabel || resolvedTimeLabel,
          recurrence: recurrenceLabel,
          autoScheduled: autoOn,
          scheduleCronOrRule: recurrenceLabel ?? (autoOn ? "Automática" : "Una vez"),
          nextRunAt: scheduledTarget.nextRunAt,
          checklist: agendaChecklist,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      }
    }

    try {
      let persistedHistory: TaskHistoryItem | null = null;
      let persistedAgenda: LedgerAgendaItem | null = null;

      if (isTauriEnv) {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        const result = await decideTaskHitl({
          cardId: task.cardId,
          title: task.title,
          category: task.category,
          decision: decisionType,
          summary: summaryText,
          amountLabel,
          verifiedCost: decision.verifiedCost,
          currency: decision.currency,
          adjustedQty: decision.wasAdjusted ? decision.quantity : null,
          notes: notesText,
          decidedBy: localUser?.name ?? undefined,
          updatedProposal: task,
          promoteAgendaItem: promotedAgendaDraft,
        });
        persistedHistory = result?.historyEntry ?? null;
        persistedAgenda = result?.promotedAgendaItem ?? null;
      }

      const finalAgenda = persistedAgenda ?? promotedAgendaDraft;
      if (finalAgenda) {
        setAgendaItems((prev) => [finalAgenda, ...prev]);
      }

      const historyEntry: TaskHistoryItem = persistedHistory ?? {
        id: `hist_${task.cardId}_${Date.now()}`,
        title: task.title,
        category: task.category,
        decision: decisionType,
        summary: summaryText,
        amountLabel,
        timestampLabel: nowTimeLabel(),
      };

      setHistoryItems((prev) => [historyEntry, ...prev]);
      setTasks((prev) => prev.filter((t) => t.cardId !== task.cardId));

      setStatusMessage(`"${task.title}" autorizado y registrado.`);
      setXoxState("success");
      setXoxMessage(`¡Listo! "${task.title}" confirmado.`);
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 3500);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage("Error al procesar la aprobación.");
    }
  };

  const handleDiscardTask = async (task: TaskProposal) => {
    clearPendingTaskSync(task.cardId);
    if (pendingSecretKeysRef.current.has(task.cardId)) {
      pendingSecretKeysRef.current.delete(task.cardId);
    }
    if (task.intent.type === "save_api_key") {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.actionButton?.cardId === task.cardId ? { ...m, actionButton: undefined } : m
        )
      );
    }

    let persistedHistory: TaskHistoryItem | null = null;
    try {
      if (isTauriEnv && task.intent.type !== "save_api_key") {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        const result = await decideTaskHitl({
          cardId: task.cardId,
          title: task.title,
          category: task.category,
          decision: "rejected",
          summary: `Descartada · ${task.intent.targetLabel}`,
          notes: "Descartado desde el panel de tareas",
          decidedBy: localUser?.name ?? undefined,
          updatedProposal: task,
        });
        persistedHistory = result?.historyEntry ?? null;
      }
    } catch {
      // Continuar actualización local si falla escritura
    }

    const historyEntry: TaskHistoryItem = persistedHistory ?? {
      id: `hist_rej_${task.cardId}_${Date.now()}`,
      title: task.title,
      category: task.category,
      decision: "rejected",
      summary: `Descartada · ${task.intent.targetLabel}`,
      timestampLabel: nowTimeLabel(),
    };

    setHistoryItems((prev) => [historyEntry, ...prev]);
    setTasks((prev) => prev.filter((t) => t.cardId !== task.cardId));
    setStatusMessage(`"${task.title}" descartada y registrada en memoria.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleAskXoxAboutTask = (task: TaskProposal) => {
    setInputPrompt(`Sobre "${task.title}": `);
    inputRef.current?.focus();
  };

  const handleRefreshWorkspace = async () => {
    if (!isTauriEnv) return;
    setWorkspaceLoading(true);
    try {
      const overview = await getWorkspaceOverview();
      if (overview) {
        await hydrateWorkspaceState(overview, selectedWorkspaceFile?.relativePath ?? null);
        await Promise.all([
          hydrateLedgerState(true),
          refreshInventoryAndReview(),
        ]);
      }
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleSelectWorkspaceFile = async (entry: WorkspaceNodeEntry) => {
    if (!isTauriEnv || entry.kind !== "file") return;
    try {
      const f = await readWorkspaceFile(entry.relativePath);
      setSelectedWorkspaceFile({
        relativePath: f.relativePath,
        name: f.name,
        zone: f.zone,
        content: f.content,
        editable: f.editable,
        pinned: pinnedWorkspacePaths.has(f.relativePath),
        tokens: estimateTokens(f.content),
      });
      triggerReadingPulse(`Leyendo ${entry.name}...`, 1050);
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo abrir el archivo seleccionado.")
      );
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleTogglePinWorkspaceFile = async (entry: WorkspaceNodeEntry) => {
    if (entry.kind !== "file") return;
    const nextPinned = new Set(pinnedWorkspacePaths);
    if (nextPinned.has(entry.relativePath)) {
      nextPinned.delete(entry.relativePath);
    } else {
      nextPinned.add(entry.relativePath);
    }
    setPinnedWorkspacePaths(nextPinned);
    if (selectedWorkspaceFile?.relativePath === entry.relativePath) {
      setSelectedWorkspaceFile((prev) =>
        prev ? { ...prev, pinned: nextPinned.has(entry.relativePath) } : null
      );
    }
    if (workspaceOverview) {
      await hydrateWorkspaceState(
        workspaceOverview,
        selectedWorkspaceFile?.relativePath ?? entry.relativePath,
        nextPinned
      );
    }
  };

  const handleCreateWorkspaceFolder = async (relativePath: string) => {
    const nextOverview = await createWorkspaceFolder(relativePath);
    setHighlightedWorkspacePath(relativePath);
    setTimeout(() => setHighlightedWorkspacePath((curr) => (curr === relativePath ? null : curr)), 1500);
    await hydrateWorkspaceState(nextOverview, selectedWorkspaceFile?.relativePath ?? null);
    setStatusMessage(`Carpeta creada: ${relativePath}`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleSaveWorkspaceFile = async (relativePath: string, content: string) => {
    const nextOverview = await saveWorkspaceFile(relativePath, content);
    await hydrateWorkspaceState(nextOverview, relativePath);
    setStatusMessage(`Guardado en ${relativePath}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleCreateNewWorkspace = async (name: string) => {
    const nextOverview = await createWorkspace(name);
    await hydrateWorkspaceState(nextOverview, "empresa/perfil.json");
    await Promise.all([
      hydrateLedgerState(true),
      refreshInventoryAndReview(),
    ]);
    setStatusMessage(`Espacio "${nextOverview.active.name}" creado en Documentos/XoxMemoryApp.`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleSwitchActiveWorkspace = async (workspaceId: string) => {
    const nextOverview = await switchWorkspace(workspaceId);
    await hydrateWorkspaceState(nextOverview, "empresa/perfil.json");
    await Promise.all([
      hydrateLedgerState(true),
      refreshInventoryAndReview(),
    ]);
    setStatusMessage(`Espacio activo: ${nextOverview.active.name}`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleRenameActiveWorkspace = async (workspaceId: string, newName: string) => {
    const nextOverview = await renameWorkspace(workspaceId, newName);
    await hydrateWorkspaceState(nextOverview, selectedWorkspaceFile?.relativePath ?? null);
    setStatusMessage(`Espacio renombrado a "${nextOverview.active.name}".`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleRunBusinessReview = async (triggerSource = "manual") => {
    if (!isTauriEnv || isReviewRunning) return;
    setIsReviewRunning(true);
    try {
      const res = await runBusinessReview(triggerSource);
      const [overview] = await Promise.all([
        getWorkspaceOverview(),
        refreshInventoryAndReview(),
        hydrateLedgerState(true),
      ]);
      if (overview) {
        await hydrateWorkspaceState(overview, selectedWorkspacePathRef.current);
      }
      if (res) {
        setLatestReview(res.reviewRun);
        setStatusMessage(
          res.newTasksCount > 0
            ? `Revisión lista: ${res.newTasksCount} nuevas propuestas.`
            : res.summary || "Revisión completada sin pendientes nuevos."
        );
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo completar la revisión del espacio.")
      );
      setTimeout(() => setStatusMessage(null), 4500);
    } finally {
      setIsReviewRunning(false);
    }
  };

  const handleImportInventoryFile = async (filename: string, content: string) => {
    if (!isTauriEnv) return;
    try {
      const imported = await importInventoryFile(filename, content);
      if (imported) {
        setInventoryItems(imported.items);
        setStatusMessage(
          `Importados ${imported.importedCount} productos en ${imported.filePath}. Analizando...`
        );
        await handleRunBusinessReview("import");
      }
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo importar el archivo en datos/.")
      );
      setTimeout(() => setStatusMessage(null), 4500);
    }
  };

  const handleResolvePermission = async (
    requestId: string,
    decision: CommandPermissionDecisionKind
  ) => {
    setPermissionItems((prev) =>
      applyPermissionResolution(prev, requestId, decision)
    );
    try {
      await resolveCommandPermission(requestId, decision);
    } catch (err) {
      setPermissionItems((prev) =>
        prev.map((item) =>
          item.requestId === requestId
            ? {
                ...item,
                state: "error",
                error: extractErrorMessage(err, "No se pudo entregar tu decisión."),
              }
            : item
        )
      );
    }
  };

  const handleToggleTimer = async (id: string) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      try {
        const updated = await toggleTimerState(id);
        if (updated) {
          setAgendaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isRunning: !item.isRunning } : item
      )
    );
  };

  const handleResetTimer = async (id: string) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      try {
        const updated = await resetTimerState(id);
        if (updated) {
          setAgendaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isRunning: false,
              endsAt: undefined,
              remainingSeconds: item.durationSeconds ?? 900,
            }
          : item
      )
    );
  };

  const handleCompleteAgendaItem = async (item: AgendaItem) => {
    setAgendaItems((prev) => prev.filter((a) => a.id !== item.id));
    let savedHistory: TaskHistoryItem | null = null;
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      savedHistory = await completeAgendaItem({
        agendaItemId: item.id,
        decidedBy: localUser?.name ?? undefined,
      }).catch(() => null);
    }
    setHistoryItems((prev) => [
      savedHistory ?? {
        id: `hist_ag_${item.id}_${Date.now()}`,
        title: item.title,
        category: item.kind === "note" ? "nota" : "agenda",
        decision: "completed",
        summary: item.noteContent ?? item.subtitle ?? item.timeLabel,
        timestampLabel: nowTimeLabel(),
      },
      ...prev,
    ]);
    setStatusMessage(`"${item.title}" completado.`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleRemoveAgendaItem = async (id: string) => {
    setAgendaItems((prev) => prev.filter((a) => a.id !== id));
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await deleteAgendaItem(id).catch(() => {});
    }
  };

  const handleToggleAgendaChecklist = async (agendaId: string, itemId: string) => {
    const existing = agendaItemsRef.current.find((it) => it.id === agendaId);
    const updatedItem =
      existing && existing.checklist
        ? {
            ...existing,
            checklist: existing.checklist.map((c) =>
              c.id === itemId ? { ...c, done: !c.done } : c
            ),
          }
        : null;

    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === agendaId && item.checklist
          ? {
              ...item,
              checklist: item.checklist.map((c) =>
                c.id === itemId ? { ...c, done: !c.done } : c
              ),
            }
          : item
      )
    );
    if (updatedItem && isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await upsertAgendaItem(updatedItem).catch(() => {});
    }
  };

  const handleToggleAgendaAuto = async (id: string) => {
    const existing = agendaItemsRef.current.find((it) => it.id === id);
    const updatedItem = existing
      ? { ...existing, autoScheduled: !existing.autoScheduled }
      : null;

    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, autoScheduled: !item.autoScheduled } : item
      )
    );
    if (updatedItem && isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await upsertAgendaItem(updatedItem).catch(() => {});
    }
  };

  const persistAgendaDraft = async (draft: LedgerAgendaItem) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      const saved = await upsertAgendaItem(draft).catch(() => null);
      setAgendaItems((prev) => [saved ?? draft, ...prev]);
    } else {
      setAgendaItems((prev) => [draft, ...prev]);
    }
  };

  const formatScheduledTimeLabel = (dateIso: string, time24: string): { label: string; nextRunAt?: string } => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const parsed = new Date(`${dateIso}T${time24}:00`);
    const nextRunAt = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    const dayPrefix =
      dateIso === todayStr
        ? "Hoy"
        : dateIso === tomorrowStr
        ? "Mañana"
        : Number.isNaN(parsed.getTime())
        ? dateIso
        : parsed.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    return {
      label: `${dayPrefix} · ${time24} hrs`,
      nextRunAt,
    };
  };

  const handleCreateQuickTimer = async (title: string, minutes: number) => {
    const secs = Math.max(1, minutes) * 60;
    const draft: LedgerAgendaItem = {
      id: `ag_timer_${Date.now()}`,
      kind: "timer",
      title,
      subtitle: `Reloj rápido (${minutes} min)`,
      timeLabel: `${String(minutes).padStart(2, "0")}:00`,
      durationSeconds: secs,
      remainingSeconds: secs,
      endsAt: new Date(Date.now() + secs * 1000).toISOString(),
      isRunning: true,
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Reloj "${title}" iniciado (${minutes} min).`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleCreateQuickNote = async (title: string, content: string) => {
    const draft: LedgerAgendaItem = {
      id: `ag_note_${Date.now()}`,
      kind: "note",
      title,
      timeLabel: "Fijada",
      noteContent: content,
      tags: ["Manual"],
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Nota "${title}" guardada en Agenda.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleCreateScheduledEvent = async (input: ScheduledEventInput) => {
    const { label, nextRunAt } = formatScheduledTimeLabel(input.dateIso, input.time24);
    const isRecurring = input.autoScheduled || Boolean(input.recurrence);
    const draft: LedgerAgendaItem = {
      id: `ag_sched_${Date.now()}`,
      kind: isRecurring ? "recurring" : "alarm",
      title: input.title,
      subtitle: input.notes,
      timeLabel: label,
      recurrence: input.recurrence,
      autoScheduled: input.autoScheduled,
      scheduleCronOrRule: input.recurrence ?? "Una vez",
      nextRunAt,
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Agendado: "${input.title}" (${label}).`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const runPromptQuery = async (
    rawQuery: string,
    overrideMessages?: UiChatMessage[]
  ) => {
    const query = rawQuery.trim();
    if (!query || isChatStreaming) return;

    const baseMessages = overrideMessages ?? chatMessagesRef.current;
    const currentAttachments = attachments;
    setInputPrompt("");
    setAttachments([]);

    // 1) Zero-Trust: interceptar claves API localmente antes de cualquier llamada o historial
    const { detectedKey, maskedKey, sanitizedText } = detectApiKeyInText(query);
    if (detectedKey && maskedKey) {
      const cardId = `vault_key_${Date.now()}`;
      pendingSecretKeysRef.current.set(cardId, detectedKey);

      const vaultProposal: TaskProposal = {
        cardId,
        title: "Guardar clave API de OpenRouter",
        subtitle: `Se detectó una clave (${maskedKey}) en tu mensaje. Aprueba para guardarla en la bóveda local sin enviarla al modelo.`,
        urgency: "media",
        category: "boveda",
        generatedBy: "Bóveda Zero-Trust",
        statusChip: "Requiere aprobación",
        defaultExpanded: true,
        blocks: [
          {
            type: "kv_list",
            rows: [
              { label: "Proveedor", value: "OpenRouter" },
              {
                label: "Clave detectada",
                value: maskedKey,
                subtle: "Aislada localmente",
              },
              {
                label: "Destino",
                value: isTauriEnv
                  ? "Bóveda local Tauri (0600)"
                  : "Almacenamiento local de sesión",
              },
              { label: "Modelo activo", value: modelId },
            ],
          },
          {
            type: "insight",
            text: "Tu clave se mantiene aislada en memoria temporal hasta que confirmes; nunca viaja dentro del prompt.",
            confidence: 1,
            source: "Protección Zero-Trust",
          },
        ],
        intent: {
          type: "save_api_key",
          targetLabel: `OpenRouter (${maskedKey})`,
          primaryLabel: "Guardar en bóveda segura",
        },
        paramValues: {},
      };

      setTasks((prev) => [vaultProposal, ...prev]);
      setShowRightSidebar(true);
      setTaskTab("pending");
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        { id: `msg_u_${Date.now()}`, role: "user", content: sanitizedText },
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: `Detecté una clave API (**${maskedKey}**) y la intercepté localmente antes de enviarla a internet.\n\nPor seguridad Zero-Trust, confírmame si quieres guardarla en la bóveda segura y probar la conexión con OpenRouter.`,
          actionButton: {
            label: "Guardar clave en bóveda segura",
            kind: "save_pending_key",
            cardId,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("alert");
      setXoxMessage(`Clave ${maskedKey} retenida en memoria segura.`);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      return;
    }

    const userMsg: UiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: "user",
      content: query,
    };

    // 2) Sin clave configurada: informar con honestidad y abrir flujo guiado (cero respuestas mock)
    if (!aiConfig.hasApiKey) {
      const wantsSetup = isKeySetupIntent(query);
      if (wantsSetup) {
        setShowAiSettings(true);
      }
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        userMsg,
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: wantsSetup
            ? "Abrí los ajustes de OpenRouter para configurar tu acceso.\n\nTambién puedes pegar aquí tu clave `sk-or-v1-...` cuando quieras: la detecto localmente sin exponerla al modelo."
            : "Aún no tengo una clave de OpenRouter conectada.\n\nConecta tu clave en los ajustes de OpenRouter o pégala en este chat para activarme (incluye modelos gratuitos).",
          actionButton: {
            label: "Configurar OpenRouter",
            kind: "open_settings",
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("idle");
      setXoxMessage("Conecta OpenRouter para iniciar.");
      return;
    }

    // 3) Inferencia real en streaming contra OpenRouter
    const convId = activeConvIdRef.current;
    const assistantMsgId = `msg_a_${Date.now() + 1}`;
    const priorHistory = baseMessages
      .filter((m) => !m.isError && m.content.trim().length > 0)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    const initialStep: ThinkingStep = {
      id: "read_context",
      label: "Leyendo contexto y reglas del negocio",
      status: "running",
    };

    const assistantPlaceholder: UiChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      reasoning: "",
      thinkingSteps: [initialStep],
      isStreaming: true,
      isReasoningStreaming: true,
    };

    const startedMessages = [...baseMessages, userMsg, assistantPlaceholder];
    clearXoxPhaseTimers();
    const readingStartedAt = performance.now();
    const READING_MIN_MS = 750;
    let latestPhase: XoxState = "reading";
    let hasEnteredTalking = false;
    let talkingStartedAt = 0;

    setChatMessages(startedMessages);
    setIsChatStreaming(true);
    setXoxState("reading");
    setThinkingLabel("Leyendo contexto…");
    setXoxMessage("Leyendo contexto y reglas...");

    try {
      const fileSnippets = await Promise.all(
        currentAttachments.map(async (file) => {
          const isReadableText =
            file.size <= 131072 &&
            (/^(text\/|application\/(json|csv|xml|javascript))/.test(file.type) ||
              /\.(txt|md|json|csv|tsv|log|yaml|yml|xml)$/i.test(file.name));
          if (!isReadableText) {
            return {
              name: file.name,
              type: file.type || "archivo",
              content: `(Archivo adjunto de ${Math.round(file.size / 1024)} KB)`,
            };
          }
          try {
            const raw = await file.text();
            return {
              name: file.name,
              type: file.type || "text/plain",
              content: raw.slice(0, 4000),
            };
          } catch {
            return {
              name: file.name,
              type: file.type || "archivo",
              content: "(No se pudo leer el contenido del archivo)",
            };
          }
        })
      );

      const activeContextSnippets = contextItems
        .filter((c) => c.pinned || selectedContext?.id === c.id)
        .map((c) => ({
          name: c.name,
          type: c.type,
          content: c.content.slice(0, 2500),
        }));

      const businessContextSnapshot = [
        ...contextItems.map((c) => `- ${c.name} (${c.type}): ${c.content.slice(0, 700)}`),
        ...patterns.map(
          (p) => `- Patrón aprendido (${Math.round(p.confidence * 100)}%): ${p.description}`
        ),
      ]
        .join("\n")
        .slice(0, 4500);

      setPermissionItems([]);
      const res = await runXoxAiChatStream(
        {
          message: query,
          history: priorHistory,
          currentTasks: tasksRef.current,
          agendaItems,
          attachedContext: [...fileSnippets, ...activeContextSnippets],
          modelOverride: modelId,
          userProfile: localUser
            ? {
                name: localUser.name,
                storeName: localUser.storeName,
                role: localUser.role,
              }
            : null,
          businessContextSnapshot,
          activeCanvas: showCanvas ? activeCanvas : null,
        },
        {
          onStreamStart: (sid) => {
            activeStreamIdRef.current = sid;
          },
          onPhase: (state, label) => {
            if (hasEnteredTalking && (state === "reading" || state === "thinking")) {
              return;
            }
            if (state === "talking") {
              clearXoxPhaseTimers();
              hasEnteredTalking = true;
              if (!talkingStartedAt) talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
              if (label) {
                setThinkingLabel(label);
                setXoxMessage(label);
              }
              return;
            }
            if (state === "thinking" && latestPhase === "reading") {
              const elapsed = performance.now() - readingStartedAt;
              const remaining = READING_MIN_MS - elapsed;
              if (remaining > 40) {
                xoxPhaseTimersRef.current.push(
                  setTimeout(() => {
                    if (hasEnteredTalking) return;
                    latestPhase = "thinking";
                    setXoxState("thinking");
                    setThinkingLabel(label || "Thinking");
                    setXoxMessage(label || "Thinking");
                  }, remaining)
                );
                return;
              }
            }
            latestPhase = state;
            setXoxState(state);
            if (label) {
              setThinkingLabel(label);
              setXoxMessage(label);
            }
          },
          onSteps: (steps) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, thinkingSteps: steps } : m
              )
            );
          },
          onReasoningDelta: (delta) => {
            if (!hasEnteredTalking && latestPhase === "reading") {
              const elapsed = performance.now() - readingStartedAt;
              if (elapsed >= READING_MIN_MS) {
                latestPhase = "thinking";
                setXoxState("thinking");
              }
            }
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      reasoning: (m.reasoning ?? "") + delta,
                      isReasoningStreaming: true,
                    }
                  : m
              )
            );
          },
          onReasoningReset: () => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, reasoning: "", isReasoningStreaming: true }
                  : m
              )
            );
          },
          onReplyDelta: (delta) => {
            if (!hasEnteredTalking) {
              clearXoxPhaseTimers();
              hasEnteredTalking = true;
              talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
            }
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content + delta,
                      isReasoningStreaming: false,
                    }
                  : m
              )
            );
          },
          onCanvas: (canvas) => {
            const withSource: CanvasArtifact = { ...canvas, sourceMessageId: assistantMsgId };
            setActiveCanvas(withSource);
            setShowCanvas(true);
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, canvas: withSource } : m
              )
            );
          },
        }
      );

      clearXoxPhaseTimers();
      const generatedCount = res.tasks.length;
      const finalCanvas = res.canvas
        ? { ...res.canvas, sourceMessageId: assistantMsgId }
        : undefined;
      if (finalCanvas) {
        setActiveCanvas(finalCanvas);
        setShowCanvas(true);
      }
      if (generatedCount > 0) {
        const replacePending = res.operation === "replace_tasks";
        if (replacePending) {
          setTasks((prev) => [
            ...res.tasks,
            ...prev.filter((t) => t.intent.type === "save_api_key"),
          ]);
        } else {
          setTasks((prev) => [...res.tasks, ...prev]);
        }
        setShowRightSidebar(true);
        setTaskTab("pending");
        if (isTauriEnv) {
          suppressLedgerSyncUntilRef.current = Date.now() + 450;
          void upsertTasksBatch(res.tasks, replacePending);
        }
      }

      setRequestsToday(incrementLocalDailyRequestCount(aiConfig.maskedKey));
      testAiConnection()
        .then((u) => setAccountUsage(u))
        .catch(() => {});

      const nextClarification = res.clarification ?? null;
      const finalMessages = chatMessagesRef.current.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: res.reply,
              reasoning: res.reasoning || m.reasoning,
              reasoningDurationMs: res.reasoningDurationMs,
              thinkingSteps: res.steps ?? m.thinkingSteps,
              isStreaming: false,
              isReasoningStreaming: false,
              modelUsed: res.modelUsed,
              latencyMs: res.latencyMs,
              tokensUsed: res.usage?.totalTokens,
              generatedTaskCount: generatedCount,
              canvas: finalCanvas ?? m.canvas,
              actionButton: nextClarification
                ? {
                    label: "Responder preguntas",
                    kind: "open_clarification" as const,
                    clarification: nextClarification,
                  }
                : m.actionButton,
            }
          : m
      );
      setChatMessages(finalMessages);
      void persistConversation(finalMessages, convId);
      if (nextClarification) {
        setActiveClarification(nextClarification);
      }

      setIsChatStreaming(false);
      if (res.workspaceMutated && isTauriEnv) {
        void handleRefreshWorkspace();
      }

      const finalMood: XoxState = res.xoxMood === "alert" ? "alert" : "success";
      const summaryStatus =
        generatedCount > 0
          ? `Xox generó ${generatedCount} ${generatedCount === 1 ? "tarjeta" : "tarjetas"} en Tareas & Decisiones.`
          : nextClarification
          ? "Xox necesita unos datos para continuar."
          : "¿En qué más te ayudo?";
      setStatusMessage(generatedCount > 0 ? summaryStatus : null);

      const finishMood = (successDelayMs: number) => {
        setXoxState(finalMood);
        setXoxMessage(summaryStatus);
        xoxPhaseTimersRef.current.push(
          setTimeout(() => {
            setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
            setXoxMessage("¿En qué puedo ayudarte?");
          }, successDelayMs)
        );
      };

      if (generatedCount > 0) {
        setXoxState("syncing");
        setXoxMessage("Organizando tarjetas en Tareas...");
        xoxPhaseTimersRef.current.push(
          setTimeout(() => finishMood(2800), 850)
        );
      } else {
        const TALKING_MIN_MS = 1100;
        const talkElapsed = talkingStartedAt ? performance.now() - talkingStartedAt : 0;
        const talkWait = talkingStartedAt
          ? Math.max(0, TALKING_MIN_MS - talkElapsed)
          : res.reply.trim().length > 0
            ? TALKING_MIN_MS
            : 0;
        if (talkWait > 40) {
          setXoxState("talking");
          setXoxMessage("Respondiendo...");
          xoxPhaseTimersRef.current.push(
            setTimeout(() => finishMood(1800), talkWait)
          );
        } else {
          finishMood(1800);
        }
      }

      if (generatedCount > 0) {
        xoxPhaseTimersRef.current.push(
          setTimeout(() => setStatusMessage(null), 4500)
        );
      }
    } catch (err) {
      clearXoxPhaseTimers();
      const message = extractErrorMessage(
        err,
        "No se pudo completar la consulta con OpenRouter."
      );
      const lowerMsg = message.toLowerCase();
      if (
        lowerMsg.includes("402") ||
        lowerMsg.includes("saldo") ||
        lowerMsg.includes("créditos") ||
        lowerMsg.includes("no está disponible") ||
        lowerMsg.includes("404")
      ) {
        setUnavailableModelIds((prev) => {
          const next = new Set(prev);
          next.add(modelId);
          return next;
        });
      }
      if (aiConfig.hasApiKey) {
        testAiConnection()
          .then((u) => setAccountUsage(u))
          .catch(() => {});
      }
      const errMessages = chatMessagesRef.current.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: `Error al consultar OpenRouter: ${message}`,
              thinkingSteps: m.thinkingSteps?.map((s) =>
                s.status === "running" ? { ...s, status: "error" as const } : s
              ),
              isStreaming: false,
              isReasoningStreaming: false,
              isError: true,
              actionButton: {
                label: "Revisar clave y modelo",
                kind: "open_settings" as const,
              },
            }
          : m
      );
      setChatMessages(errMessages);
      void persistConversation(errMessages, convId);
      setIsChatStreaming(false);
      setXoxState("alert");
      setXoxMessage("Error al conectar con OpenRouter.");
      setStatusMessage(message);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleRegenerateMessage = (targetMsg: UiChatMessage) => {
    if (isChatStreaming) return;
    const msgs = chatMessagesRef.current;
    const targetIdx = msgs.findIndex((m) => m.id === targetMsg.id);
    if (targetIdx <= 0) return;
    let userIdx = -1;
    for (let i = targetIdx - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;
    const userPrompt = msgs[userIdx].content;
    const trimmedHistory = msgs.slice(0, userIdx);
    void runPromptQuery(userPrompt, trimmedHistory);
  };

  const handlePromptSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    runPromptQuery(inputPrompt);
  };

  type MainSummonEventPayload = {
    seq: number;
    prompt?: string | null;
    autoRun?: boolean;
    responseText?: string | null;
    canvas?: unknown;
  };

  const mainSummonHandlerRef = useRef<(payload: MainSummonEventPayload) => void>(() => {});
  mainSummonHandlerRef.current = (payload) => {
    const { seq, prompt, autoRun, responseText, canvas } = payload ?? {};
    setSummonSeq(seq ?? Date.now());
    requestAnimationFrame(() => inputRef.current?.focus());

    if (responseText || canvas) {
      const safePrompt = prompt ? detectApiKeyInText(prompt).sanitizedText : null;
      const rawResponse = responseText ? detectApiKeyInText(responseText).sanitizedText : "";
      const normalizedIncoming = canvas ? sanitizeCanvasArtifact(canvas) ?? undefined : undefined;
      let transferredCanvas: CanvasArtifact | undefined =
        normalizedIncoming && canvasHasCellData(normalizedIncoming)
          ? normalizedIncoming
          : undefined;
      if (!transferredCanvas && rawResponse) {
        const inlineTbl =
          extractFirstMarkdownTable(rawResponse) ?? extractFirstHtmlTable(rawResponse);
        if (inlineTbl && inlineTbl.rows.length > 0) {
          transferredCanvas = markdownTableToCanvasArtifact(inlineTbl, {
            title: normalizedIncoming?.title || safePrompt || "Tabla en Canvas",
            subtitle: normalizedIncoming?.subtitle,
            summary: normalizedIncoming?.summary,
          });
        }
      }
      const hasTabularTransferred = Boolean(
        transferredCanvas &&
          transferredCanvas.columns.length > 0 &&
          transferredCanvas.rows.length > 0
      );
      const cleanedResponse = cleanVisibleReply(rawResponse, { stripTables: hasTabularTransferred });
      const safeResponse =
        cleanedResponse ||
        (hasTabularTransferred && transferredCanvas
          ? `Listo, preparé "${transferredCanvas.title}" en Canvas (${transferredCanvas.rows.length} filas y ${transferredCanvas.columns.length} columnas).${transferredCanvas.summary ? `\n\n${transferredCanvas.summary}` : ""}`
          : rawResponse || "Listo.");
      const assistantQbId = `msg_qb_a_${Date.now() + 1}`;
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        ...(safePrompt
          ? [{ id: `msg_qb_u_${Date.now()}`, role: "user" as const, content: safePrompt }]
          : []),
        {
          id: assistantQbId,
          role: "assistant" as const,
          content: safeResponse,
          canvas: transferredCanvas,
        },
      ];
      setChatMessages(nextMessages);
      if (transferredCanvas) {
        const withSource = { ...transferredCanvas, sourceMessageId: assistantQbId };
        setActiveCanvas(withSource);
        setShowCanvas(true);
      }
      void persistConversation(nextMessages);
      setXoxState("success");
      setXoxMessage(safeResponse);
      if (safePrompt) setStatusMessage(`Continuando desde Quick Bar: "${safePrompt}"`);
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      setTimeout(() => setStatusMessage(null), 4500);
    } else if (prompt && autoRun) {
      runPromptQuery(prompt);
    } else if (prompt) {
      setInputPrompt(prompt);
    }
  };

  // Escuchar invocaciones desde la Quick Bar (⌘⇧X -> Abrir XOOK / ⌘↩) o desde la Barra de Menú
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const fn = await listen<MainSummonEventPayload>("main:summon", (event) => {
          mainSummonHandlerRef.current(event.payload);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        // Ignorar fuera de Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Estados "ocupados": el texto muestra el efecto shimmer gris con brillo blanco
  const xoxBusy =
    xoxState === "thinking" ||
    xoxState === "reading" ||
    xoxState === "talking" ||
    xoxState === "syncing";

  // Vista previa manual de un estado de Xox (selector de desarrollo)
  const previewXoxState = (s: XoxState) => {
    const messages: Record<XoxState, string> = {
      idle: "¿En qué puedo ayudarte?",
      talking: "Te explico lo que encontré en el inventario.",
      thinking: "Analizando reglas activas y niveles de stock...",
      reading: "Leyendo archivos de contexto y reglas de la tienda...",
      syncing: "Sincronizando memoria y contexto...",
      success: "¡Listo! Acción completada.",
      alert: "Atención: stock crítico detectado en varios productos.",
    };
    setXoxState(s);
    setXoxMessage(messages[s]);
  };

  // Saludo al hacer clic: única situación en la que aparece la burbuja de diálogo
  const handleXoxClick = () => {
    if (xoxState !== "idle" || greeting) return;
    setXoxState("success");
    setGreetingLeaving(false);
    setGreeting("¡Hola! Soy Xox, tu copiloto de inventario.");
    greetingTimers.current.forEach(clearTimeout);
    greetingTimers.current = [
      setTimeout(() => setGreetingLeaving(true), 3400),
      setTimeout(() => {
        setGreeting(null);
        setGreetingLeaving(false);
        setXoxState((s) => (s === "success" ? "idle" : s));
      }, 3750),
    ];
  };

  // Añade o quita una fuente de contexto del mensaje (comportamiento de chip)
  const toggleContextInPrompt = (name: string) => {
    const tag = `@${name}`;
    setInputPrompt((prev) => {
      if (prev.includes(tag)) {
        return prev.split(tag).join("").replace(/\s{2,}/g, " ").trim();
      }
      return prev.trim() ? `${prev.trimEnd()} ${tag} ` : `${tag} `;
    });
    inputRef.current?.focus();
  };

  const pendingCount = tasks.length;

  // Estados de presencia animada para ventanas laterales y emergentes (entrada y salida)
  const leftPresence = useAnimatedPresence(showLeftSidebar, 270);
  const rightPresence = useAnimatedPresence(showRightSidebar, 270);
  const canvasPresence = useAnimatedPresence(showCanvas && Boolean(activeCanvas), 220);

  const handleOpenCanvas = (canvas: CanvasArtifact) => {
    setActiveCanvas(canvas);
    setShowCanvas(true);
  };

  const handleUpdateCanvas = (updated: CanvasArtifact) => {
    setActiveCanvas(updated);
    const nextMessages = chatMessagesRef.current.map((m) =>
      m.id === updated.sourceMessageId || m.canvas?.id === updated.id
        ? { ...m, canvas: updated }
        : m
    );
    setChatMessages(nextMessages);
    void persistConversation(nextMessages);
  };

  const handleAskXoxAboutCanvas = (canvas: CanvasArtifact) => {
    setActiveCanvas(canvas);
    setShowCanvas(true);
    setInputPrompt((prev) =>
      prev.trim() ? prev : `Sobre la tabla "${canvas.title}": `
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const statusToastPresence = useAnimatedPresence(Boolean(statusMessage), 190);
  const lastStatusRef = useRef<string | null>(statusMessage);
  if (statusMessage) lastStatusRef.current = statusMessage;
  const displayStatusMessage = statusMessage ?? lastStatusRef.current;

  const learningToastPresence = useAnimatedPresence(Boolean(learningToast), 190);
  const lastLearningToastRef = useRef<MemoryPattern | null>(learningToast);
  if (learningToast) lastLearningToastRef.current = learningToast;
  const displayLearningToast = learningToast ?? lastLearningToastRef.current;

  const isXoxStatusOpen = xoxState !== "idle" && !greeting;
  const xoxStatusPresence = useAnimatedPresence(isXoxStatusOpen, 190);
  const lastXoxStatusRef = useRef({ state: xoxState, message: xoxMessage, busy: xoxBusy });
  if (isXoxStatusOpen) {
    lastXoxStatusRef.current = { state: xoxState, message: xoxMessage, busy: xoxBusy };
  }
  const displayXoxStatus = isXoxStatusOpen
    ? { state: xoxState, message: xoxMessage, busy: xoxBusy }
    : lastXoxStatusRef.current;

  const modelMenuPresence = useAnimatedPresence(showModelMenu, 150);
  const contextMenuPresence = useAnimatedPresence(showContextMenu, 150);
  const statePreviewPresence = useAnimatedPresence(showStatePreview, 150);
  const activeContextCount = contextItems.filter((item) => inputPrompt.includes(`@${item.name}`)).length;

  return (
    <div className="h-screen w-screen bg-[#060709] text-zinc-100 flex flex-col font-sans select-none overflow-hidden antialiased">
      
      {/* 1. Header Minimalista & Stealth */}
      <header className="h-12 border-b border-white/[0.06] bg-[#090a0f]/80 backdrop-blur-xl px-4 flex items-center justify-between shrink-0 z-20">
        
        {/* Identidad de Marca y Toggle de Contexto Izquierdo */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            aria-pressed={showLeftSidebar}
            title={showLeftSidebar ? "Ocultar panel de contexto" : "Mostrar panel de contexto"}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              showLeftSidebar
                ? "bg-white/[0.08] text-white border-white/[0.1]"
                : "bg-transparent text-zinc-400 border-transparent hover:text-zinc-100 hover:bg-white/[0.05]"
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

          <div className="flex items-center gap-2">
            <XoxHeaderFace state={xoxState} onClick={handleXoxClick} />
            <XookWordmark className="h-3.5 w-auto text-zinc-100" />
          </div>
        </div>

        {/* Lado Derecho: Registro Local + Estado OpenRouter + Toggle de Tareas y Decisiones */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLocalAuth(true)}
            title={
              localUser
                ? `${localUser.name} · ${localUser.role} (${localUser.storeName}) — Perfil local`
                : "Crear perfil de operador local"
            }
            className="quick-liquid-btn px-2.5 py-1.5 rounded-lg text-zinc-200 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <UserCircle2
              className={`w-3.5 h-3.5 ${
                localUser ? "text-emerald-400" : "text-zinc-400"
              }`}
            />
            <span className="text-[11px] font-medium max-w-[110px] truncate hidden sm:inline">
              {localUser ? localUser.name : "Registro local"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowAiSettings(true)}
            title={
              aiConfig.hasApiKey
                ? `${usageSummary.primary} · Modelo: ${activeModel.name}`
                : "Configurar clave de OpenRouter"
            }
            className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${
              aiConfig.hasApiKey
                ? "quick-liquid-btn text-zinc-200 hover:text-white"
                : "border bg-amber-500/10 hover:bg-amber-500/15 text-amber-200 border-amber-400/25 transition-all"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                aiConfig.hasApiKey ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
            <KeyRound className="w-3 h-3 opacity-80" />
            <span className="text-[11px] font-medium max-w-[190px] truncate hidden sm:inline">
              {usageSummary.primary}
            </span>
          </button>

          {activeCanvas && (
            <button
              type="button"
              onClick={() => setShowCanvas((v) => !v)}
              aria-pressed={showCanvas}
              title={showCanvas ? "Ocultar Canvas" : `Abrir Canvas: ${activeCanvas.title}`}
              className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${
                showCanvas
                  ? "quick-liquid-btn text-sky-100 !bg-sky-400/[0.10]"
                  : "quick-liquid-btn text-zinc-200 hover:text-white"
              }`}
            >
              <Table2 className="w-3.5 h-3.5 text-sky-300" />
              <span className="text-[11px] font-medium hidden sm:inline max-w-[120px] truncate">
                Canvas
              </span>
            </button>
          )}

          <button
            onClick={() => setShowRightSidebar(!showRightSidebar)}
            aria-pressed={showRightSidebar}
            title={showRightSidebar ? "Ocultar panel de tareas" : "Mostrar panel de tareas"}
            className={`px-2 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              showRightSidebar
                ? "bg-white/[0.08] text-white border-white/[0.1]"
                : "bg-transparent text-zinc-400 border-transparent hover:text-zinc-100 hover:bg-white/[0.05]"
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium hidden sm:inline">Tareas</span>
            {pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 pl-1.5 ml-0.5 border-l border-white/[0.08] text-[11px] font-mono tabular-nums text-zinc-200">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {pendingCount}
              </span>
            ) : (
              <span className="pl-1.5 ml-0.5 border-l border-white/[0.08] text-[11px] font-mono tabular-nums text-zinc-500">
                0
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 2. Cuerpo Principal en 3 Columnas: [Contexto Izq] | [Xox Centro] | [Tareas Der] */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* ========================================================================= */}
        {/* COLUMNA 1: CONTEXTO DEL LADO IZQUIERDO                                    */}
        {/* ========================================================================= */}
        {leftPresence.mounted && (
          <>
            <div
              aria-hidden={!showLeftSidebar}
              inert={!showLeftSidebar}
              style={{ width: leftPresence.visible ? `${leftWidth}px` : "0px" }}
              className={`sidebar-slot flex justify-end shrink-0 overflow-hidden ${
                isResizingLeft ? "is-resizing" : ""
              } ${leftPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <aside
                style={{ width: `${leftWidth}px` }}
                className="h-full bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
              >
              
              {/* Cabecera del Panel con Tabs Contexto / Chats */}
              <div className="p-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#0a0b10]">
                <div className="flex items-center p-0.5 rounded-lg bg-black/50 border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setLeftTab("context")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      leftTab === "context"
                        ? "bg-white/[0.09] text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Contexto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftTab("chats")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      leftTab === "chats"
                        ? "bg-white/[0.09] text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chats</span>
                    {conversations.length > 0 && (
                      <span className="text-[10px] font-mono text-zinc-400 bg-white/[0.06] px-1 rounded">
                        {conversations.length}
                      </span>
                    )}
                  </button>
                </div>

                {leftTab === "context" ? (
                  <span
                    title="Tokens estimados de contexto activo vs. ventana máxima del modelo seleccionado"
                    className="text-[10px] text-zinc-400 font-mono bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded shrink-0"
                  >
                    {formatTokenCount(totalActiveTokens)} / {formatContextLength(modelContextWindow)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isChatStreaming}
                    title="Iniciar nueva conversación"
                    className="flex items-center gap-1 text-[11px] text-zinc-200 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] px-2 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <SquarePen className="w-3 h-3" />
                    <span>Nueva</span>
                  </button>
                )}
              </div>

              {leftTab === "context" ? (
                <>
              {/* Estado Real de OpenRouter + Contexto del Modelo */}
              <div className="px-3.5 py-2.5 bg-black/40 border-b border-white/[0.06] space-y-2.5">
                {/* Consumo y límite real de OpenRouter */}
                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 mb-1">
                    <span className="flex items-center gap-1.5 text-zinc-300 font-medium truncate">
                      <Activity className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate">{usageSummary.tierLabel}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => refreshModelsAndUsage(true)}
                      title="Actualizar límites de OpenRouter y catálogo de modelos"
                      className="flex items-center gap-1 text-[10px] font-mono text-zinc-200 hover:text-white transition-colors shrink-0 cursor-pointer"
                    >
                      <span>{usageSummary.headline}</span>
                      <RefreshCw className={`w-2.5 h-2.5 text-zinc-400 ${loadingModels ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                  <div className="w-full bg-white/[0.06] h-1 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        usageSummary.pct >= 85
                          ? "bg-amber-400"
                          : usageSummary.connected
                          ? "bg-emerald-400/80"
                          : "bg-zinc-600"
                      }`}
                      style={{ width: `${Math.max(usageSummary.connected ? 4 : 0, usageSummary.pct)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                    <span className="truncate">{usageSummary.detail}</span>
                    <button
                      type="button"
                      onClick={() => setShowAiSettings(true)}
                      className="text-sky-300/90 hover:text-sky-200 shrink-0 cursor-pointer"
                    >
                      {aiConfig.hasApiKey ? "Ver modelos" : "Conectar"}
                    </button>
                  </div>
                </div>

                {/* Uso real de la ventana de contexto del modelo */}
                <div className="pt-2 border-t border-white/[0.05]">
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                    <span>Contexto activo ({activeModel.name})</span>
                    <span className="text-zinc-200 font-mono font-medium">
                      {contextUsagePct}% usado
                    </span>
                  </div>
                  <div className="w-full bg-white/[0.06] h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-zinc-300 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(totalActiveTokens > 0 ? 2 : 0, contextUsagePct))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Árbol Real del Espacio de Trabajo + Inspector/Editor */}
              <WorkspaceTreePanel
                isTauriEnv={isTauriEnv}
                overview={workspaceOverview}
                selectedPath={selectedWorkspaceFile?.relativePath ?? null}
                pinnedPaths={pinnedWorkspacePaths}
                highlightedPath={highlightedWorkspacePath}
                isLoading={workspaceLoading}
                onSelectFile={handleSelectWorkspaceFile}
                onTogglePinFile={handleTogglePinWorkspaceFile}
                onRefresh={handleRefreshWorkspace}
                onOpenFinder={(rel) => void openWorkspaceFolder(rel)}
                onCreateFolder={handleCreateWorkspaceFolder}
                onCreateWorkspace={handleCreateNewWorkspace}
                onSwitchWorkspace={handleSwitchActiveWorkspace}
                onRenameWorkspace={handleRenameActiveWorkspace}
                selectedFile={selectedWorkspaceFile}
                onSaveFileContent={handleSaveWorkspaceFile}
                onStatusNotice={(msg) => {
                  setStatusMessage(msg);
                  setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 4000);
                }}
              />
                </>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-2.5 flex-1 overflow-y-auto space-y-1">
                    {conversations.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10 space-y-3">
                        <div className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-zinc-500">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-zinc-300">
                            Sin conversaciones guardadas
                          </p>
                          <p className="text-[11px] text-zinc-500 leading-relaxed">
                            Tus chats con Xox se guardan automáticamente en este equipo para retomarlos cuando quieras.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleStartNewChat}
                          disabled={isChatStreaming}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-xs text-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
                        >
                          <SquarePen className="w-3.5 h-3.5" />
                          <span>Nueva conversación</span>
                        </button>
                      </div>
                    ) : (
                      conversations.map((thread) => {
                        const isActive = thread.id === activeConversationId;
                        const lastMsg = thread.messages[thread.messages.length - 1];
                        const snippet = lastMsg?.content?.replace(/\s+/g, " ").trim() ?? "";
                        const dateLabel = (() => {
                          try {
                            const d = new Date(thread.updatedAt);
                            const sameDay =
                              d.toDateString() === new Date().toDateString();
                            return sameDay
                              ? d.toLocaleTimeString("es-MX", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : d.toLocaleDateString("es-MX", {
                                  day: "numeric",
                                  month: "short",
                                });
                          } catch {
                            return "";
                          }
                        })();
                        return (
                          <div
                            key={thread.id}
                            onClick={() => handleSelectConversation(thread)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleSelectConversation(thread);
                              }
                            }}
                            className={`group rounded-xl p-2.5 border transition-all cursor-pointer ${
                              isActive
                                ? "bg-white/[0.08] border-white/[0.14]"
                                : "bg-transparent border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`text-xs font-medium truncate ${
                                      isActive ? "text-white" : "text-zinc-200"
                                    }`}
                                  >
                                    {thread.title}
                                  </span>
                                  <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                                    {dateLabel}
                                  </span>
                                </div>
                                {snippet && (
                                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                                    {snippet}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteConversation(thread.id);
                                }}
                                disabled={isChatStreaming}
                                title="Eliminar conversación"
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-white/[0.05] transition-all cursor-pointer disabled:opacity-30 shrink-0"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Pie del Panel Lateral */}
              <div className="p-3 border-t border-white/[0.06] bg-[#0a0b10] text-[11px] text-zinc-400 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowLocalAuth(true)}
                  className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors truncate cursor-pointer"
                  title="Configurar perfil de usuario local"
                >
                  <UserCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${
                      localUser ? "text-emerald-400" : "text-zinc-500"
                    }`}
                  />
                  <span className="truncate">
                    {localUser ? localUser.name : "Sin perfil local"}
                  </span>
                </button>
                <span className="text-zinc-400 font-medium flex items-center gap-1 shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />{" "}
                  {leftTab === "context"
                    ? (() => {
                        const fileCount = workspaceOverview
                          ? workspaceOverview.entries.filter((e) => e.kind === "file").length
                          : contextItems.length;
                        return `${fileCount} ${fileCount === 1 ? "archivo" : "archivos"}`;
                      })()
                    : `${conversations.length} ${
                        conversations.length === 1 ? "chat" : "chats"
                      }`}
                </span>
              </div>
              </aside>
            </div>

            {/* Separador redimensionable izquierdo (Splitter Aurora de Vidrio) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingLeft(true);
              }}
              onDoubleClick={() => setLeftWidth(280)}
              className={`splitter-aurora-glass ${isResizingLeft ? "is-resizing" : ""} ${
                leftPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              {/* Zona de captura ampliada invisible para fácil arrastre */}
              <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            </div>
          </>
        )}

        {/* COLUMNA CENTRAL: Xox + Conversación + Input Pinned al fondo */}
        <section className="flex-1 flex flex-col bg-[#060709] overflow-hidden relative">
          
          {/* Notificación de Sistema: flota sobre el contenido, no lo desplaza */}
          {statusToastPresence.mounted && displayStatusMessage && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-4"
            >
              <div
                className={`${
                  statusMessage ? "toast-in pointer-events-auto" : "toast-out pointer-events-none"
                } bg-zinc-900/95 border border-white/10 rounded-xl px-3.5 py-2.5 text-zinc-200 text-xs flex items-center gap-3 shadow-2xl backdrop-blur-xl max-w-lg`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{displayStatusMessage}</span>
                </div>
                <button
                  onClick={() => setStatusMessage(null)}
                  aria-label="Cerrar notificación"
                  className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Barra mínima fija de conversación activa (siempre sobre el área con scroll) */}
          {chatMessages.length > 0 && (
            <div className="shrink-0 border-b border-white/[0.06] bg-[#060709]/95 backdrop-blur-md px-4 sm:px-6 z-10">
              <div className="max-w-5xl mx-auto py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    title={deriveConversationTitle(chatMessages)}
                    className="text-sm font-medium text-white truncate"
                  >
                    {deriveConversationTitle(chatMessages)}
                  </span>
                  {!activeModel.is_free && accountUsage && !accountUsage.can_use_paid_models && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[9px] font-medium shrink-0">
                      Requiere saldo
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLeftSidebar(true);
                      setLeftTab("chats");
                    }}
                    title="Ver historial de conversaciones"
                    className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span className="hidden sm:inline">Chats</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isChatStreaming}
                    title="Nueva conversación"
                    className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-200 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <SquarePen className="w-3 h-3" />
                    <span className="hidden sm:inline">Nueva</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Área de Trabajo con Scroll: Xox Hero / Chat en vivo */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
            <div className="max-w-5xl mx-auto space-y-6">

              {/* ========================================================================= */}
              {/* 1. XOX DIGITAL COMPANION (HERO EN ESTADO VACÍO / COMPACTO EN CHAT)      */}
              {/* ========================================================================= */}
              {chatMessages.length === 0 ? (
                <div className="min-h-[calc(100vh-18rem)] flex flex-col items-center justify-center py-2 text-center">
                  {/* Estrella Xox: protagonista en el Home, con burbuja de diálogo flotante */}
                  <div
                    className="relative flex flex-col items-center justify-center cursor-pointer select-none -mb-6 sm:-mb-8"
                    title="Haz clic para saludar a Xox"
                  >
                    <XoxStar
                      state={xoxState}
                      responsive
                      className="w-64 h-64 sm:w-80 sm:h-80 lg:w-[340px] lg:h-[340px] xl:w-[380px] xl:h-[380px]"
                      summonTrigger={summonSeq}
                      onClick={handleXoxClick}
                    />

                    {/* Burbuja de saludo Liquid Glass (solo al hacer clic en Xox) */}
                    {greeting && (
                      <div
                        role="status"
                        aria-live="polite"
                        className={`xox-bubble absolute left-[61%] bottom-[73%] z-10 pointer-events-none ${
                          greetingLeaving ? "is-leaving" : ""
                        }`}
                      >
                        <span aria-hidden="true" className="xox-bubble-trail xox-bubble-trail-sm" />
                        <span aria-hidden="true" className="xox-bubble-trail xox-bubble-trail-md" />

                        <div className="xox-bubble-body w-max max-w-[260px] px-4 py-2.5 rounded-[22px] text-left">
                          <p className="xox-bubble-text relative text-[13px] leading-snug text-white/95 font-medium">
                            {greeting}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Saludo Humano Amplio y Protagonista */}
                  <div className="space-y-3.5 max-w-2xl px-4 flex flex-col items-center">
                    <h1 className="text-2xl sm:text-3xl lg:text-[34px] font-semibold leading-tight text-white tracking-tight">
                      {localUser
                        ? `Hola ${localUser.name.split(" ")[0]}, ¿en qué puedo ayudarte?`
                        : "¿En qué puedo ayudarte?"}
                    </h1>
                    {conversations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conversations[0])}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                        title="Retomar tu última conversación guardada"
                      >
                        <MessageSquare className="w-3 h-3 text-zinc-400" />
                        <span className="truncate max-w-[260px]">
                          Retomar: {conversations[0].title}
                        </span>
                      </button>
                    )}

                    {/* Estado activo de Xox durante los procesos */}
                    {xoxStatusPresence.mounted && (
                      <div
                        className={`${
                          isXoxStatusOpen ? "toast-in" : "toast-out pointer-events-none"
                        } inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-md`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            displayXoxStatus.state === "thinking" || displayXoxStatus.state === "reading"
                              ? "bg-cyan-400 animate-ping"
                              : displayXoxStatus.state === "success"
                              ? "bg-emerald-400"
                              : displayXoxStatus.state === "syncing"
                              ? "bg-teal-400 animate-pulse"
                              : displayXoxStatus.state === "alert"
                              ? "bg-red-500 animate-pulse"
                              : "bg-cyan-400"
                          }`}
                        />
                        <p
                          className={`text-xs ${
                            displayXoxStatus.busy
                              ? "xox-shimmer font-medium"
                              : displayXoxStatus.state === "alert"
                              ? "text-red-300"
                              : "text-zinc-300"
                          }`}
                        >
                          {displayXoxStatus.message}
                        </p>
                      </div>
                    )}

                    {/* Acciones rápidas iniciales */}
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          runPromptQuery("Evalúa el stock urgente del almacén y propón qué hacer")
                        }
                        className="quick-liquid-btn group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3 text-sky-100/70 group-hover:text-sky-100 transition-colors" />
                        <span>Evaluar stock urgente</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          runPromptQuery(
                            "Crea un temporizador de 15 minutos para confirmar recepción de mercancía"
                          )
                        }
                        className="quick-liquid-btn group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3 text-sky-100/70 group-hover:text-sky-100 transition-colors" />
                        <span>Crear timer de 15 min</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          runPromptQuery(
                            "Genera una tabla comparativa en Canvas de nuestros proveedores de café considerando costo, tiempo de entrega y margen"
                          )
                        }
                        className="quick-liquid-btn group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <Table2 className="w-3 h-3 text-sky-200/85 group-hover:text-sky-100 transition-colors" />
                        <span>Tabla comparativa</span>
                      </button>

                      {!aiConfig.hasApiKey ? (
                        <button
                          type="button"
                          onClick={() => setShowAiSettings(true)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-400/25 text-xs text-amber-200 transition-colors cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Conectar clave OpenRouter</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            runPromptQuery("Organiza y resume mis tareas pendientes en tarjetas")
                          }
                          className="quick-liquid-btn group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs text-zinc-200 hover:text-white cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3 text-sky-100/70 group-hover:text-sky-100 transition-colors" />
                          <span>Consolidar tareas</span>
                        </button>
                      )}
                    </div>

                    {/* Selector de estados para desarrollo (plegado y discreto por defecto) */}
                    {import.meta.env.DEV && (
                      <div className="pt-0.5 flex flex-col items-center">
                        <button
                          type="button"
                          onClick={() => setShowStatePreview((v) => !v)}
                          className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
                        >
                          {showStatePreview ? "ocultar estados de prueba" : "• probar estados de Xox"}
                        </button>
                        {statePreviewPresence.mounted && (
                          <div
                            className={`${
                              showStatePreview ? "panel-fade-in" : "panel-fade-out pointer-events-none"
                            } flex flex-wrap items-center justify-center gap-1 pt-1.5`}
                          >
                            {(["idle", "reading", "thinking", "talking", "syncing", "alert", "success"] as XoxState[]).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => previewXoxState(s)}
                                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                                  xoxState === s
                                    ? "bg-white/10 border-white/25 text-white"
                                    : "bg-white/[0.02] border-white/[0.06] text-zinc-500 hover:text-zinc-300"
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <ChatMessageList
                    messages={chatMessages}
                    xoxState={xoxState}
                    thinkingLabel={thinkingLabel}
                    summonTrigger={summonSeq}
                    greeting={greeting}
                    greetingLeaving={greetingLeaving}
                    activeCanvasId={showCanvas ? activeCanvas?.id ?? null : null}
                    onOpenCanvas={handleOpenCanvas}
                    modelCatalog={catalogModels}
                    onXoxClick={handleXoxClick}
                    onAction={handleChatAction}
                    onOpenTasksTab={() => {
                      setShowRightSidebar(true);
                      setTaskTab("pending");
                    }}
                    onRegenerateMessage={(msgId) => void handleRegenerateMessage(msgId)}
                    onRateMessage={handleRateMessage}
                    permissionItems={permissionItems}
                    onResolvePermission={(reqId, decision) =>
                      void handleResolvePermission(reqId, decision)
                    }
                  />
                </div>
              )}

              {/* Espaciador inferior para que el último elemento pueda scrollear sobre el input fijo */}
              <div className="h-44 sm:h-48 shrink-0" />
              <div ref={chatEndRef} />

            </div>
          </div>

          {/* Notificación compacta de aprendizaje reciente (esquina superior derecha) */}
          {learningToastPresence.mounted && displayLearningToast && (
            <div
              role="status"
              aria-live="polite"
              className={`${
                learningToast ? "toast-in" : "toast-out pointer-events-none"
              } absolute top-4 right-4 z-20 w-[280px] liquid-glass-card rounded-xl p-3 flex items-start gap-2.5`}
            >
              <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Brain className="w-3.5 h-3.5 text-zinc-300" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Xox aprendió algo
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {Math.round(displayLearningToast.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[11.5px] text-zinc-200 leading-snug line-clamp-2">
                  {displayLearningToast.description}
                </p>
              </div>
              <button
                onClick={() => setLearningToast(null)}
                aria-label="Cerrar notificación"
                className="text-zinc-500 hover:text-zinc-300 p-0.5 -mr-1 -mt-1 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 4. INPUT / CHAT FIJO EN LA PARTE INFERIOR (PINNED DOCK)                    */}
          {/* ========================================================================= */}
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-[#060709] via-[#060709]/95 to-transparent pointer-events-none z-10">
            <div className="@container max-w-5xl mx-auto pointer-events-auto">
              <div className={`liquid-glass-hero input-console rounded-2xl p-3 sm:p-4 relative group shadow-2xl ${inputExpanded ? "is-expanded" : ""}`}>
                {/* Capa de recorte para los efectos de luz (los menús desplegables pueden sobresalir) */}
                <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                  {/* Reflejo especular superior tenue */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                  {/* Barrido de luz de encendido */}
                  <span key={summonSeq} aria-hidden="true" className="console-sweep" />
                </div>

                {/* Formulario Principal de Entrada */}
                <form onSubmit={handlePromptSubmit} className="space-y-2.5">
                  {/* Archivos adjuntos */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {attachments.map((f, i) => (
                        <span
                          key={`${f.name}-${i}`}
                          className="toast-in inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1 py-1 rounded-lg bg-white/[0.06] border border-white/[0.1] text-zinc-200 max-w-[200px]"
                        >
                          <Paperclip className="w-3 h-3 text-zinc-400 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`Quitar ${f.name}`}
                            className="text-zinc-500 hover:text-zinc-200 p-0.5 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="relative flex items-end gap-2">
                    {/* Botón + para subir archivos */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) {
                          setAttachments((prev) => [...prev, ...files]);
                          triggerReadingPulse(
                            files.length === 1
                              ? `Leyendo ${files[0].name}...`
                              : `Leyendo ${files.length} archivos adjuntos...`
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Adjuntar archivos"
                      aria-label="Adjuntar archivos"
                      className="quick-liquid-btn shrink-0 mb-0.5 w-8 h-8 rounded-full flex items-center justify-center text-zinc-200 hover:text-white active:scale-95 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>

                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={inputPrompt}
                      onChange={(e) => setInputPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          handlePromptSubmit();
                        }
                      }}
                      disabled={isChatStreaming}
                      placeholder={
                        isChatStreaming
                          ? "Procesando..."
                          : "Escribe a Xox..."
                      }
                      className="input-bubble flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1.5 px-1 font-normal leading-relaxed disabled:opacity-50 select-text"
                    />

                    {/* Desplegable de modelos */}
                    <div ref={modelMenuRef} className="relative shrink-0 mb-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowContextMenu(false);
                          setShowModelMenu((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={showModelMenu}
                        className="quick-liquid-btn h-8 inline-flex items-center gap-1.5 pl-2.5 pr-2.5 rounded-full text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <Cpu className="w-3 h-3 text-sky-100/75" />
                        <span className="hidden @sm:inline">{activeModel.name}</span>
                        <ChevronDown className={`w-3 h-3 text-white/65 transition-transform ${showModelMenu ? "rotate-180" : ""}`} />
                      </button>
                      {modelMenuPresence.mounted && (
                        <div
                          role="listbox"
                          className={`${
                            showModelMenu ? "menu-in" : "menu-out pointer-events-none"
                          } absolute right-0 bottom-full mb-2 w-72 p-1.5 rounded-xl bg-zinc-900/95 border border-white/10 shadow-2xl backdrop-blur-xl z-30`}
                        >
                          <div className="px-2 py-1.5 flex items-center justify-between border-b border-white/[0.06] mb-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                              Modelos disponibles ({availableQuickModels.length})
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void refreshModelsAndUsage(true);
                              }}
                              title="Actualizar catálogo y límites de OpenRouter"
                              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                            >
                              <RefreshCw className={`w-3 h-3 ${loadingModels ? "animate-spin" : ""}`} />
                            </button>
                          </div>

                          {!canUsePaidModels && (
                            <div className="mx-1 mb-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-[10px] text-zinc-400 leading-snug">
                              {aiConfig.hasApiKey
                                ? "Mostrando solo modelos que funcionan sin saldo en tu cuenta."
                                : "Vista previa de modelos gratuitos disponibles en OpenRouter."}
                            </div>
                          )}

                          {unavailableModelIds.size > 0 && (
                            <div className="mx-1 mb-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-200/90 leading-snug">
                              Se ocultaron {unavailableModelIds.size} modelo(s) que devolvieron error o límite.
                            </div>
                          )}

                          <div className="max-h-56 overflow-y-auto space-y-0.5">
                            {availableQuickModels.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                role="option"
                                aria-selected={m.id === modelId}
                                onClick={() => void handleSelectModel(m.id)}
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                                  m.id === modelId ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5 text-xs text-zinc-100 truncate">
                                    <span className="truncate">{m.name}</span>
                                    {canUsePaidModels && m.is_free && (
                                      <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-medium shrink-0">
                                        gratis
                                      </span>
                                    )}
                                  </span>
                                  <span className="block text-[10px] text-zinc-500 truncate">
                                    {m.hint}
                                  </span>
                                </span>
                                {m.id === modelId && (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>

                          <div className="mt-1 pt-1.5 border-t border-white/[0.08] space-y-1">
                            {aiConfig.hasApiKey && (
                              <div className="px-2.5 py-1 flex items-center justify-between text-[10px] text-zinc-400">
                                <span className="truncate">{usageSummary.tierLabel}</span>
                                <span className="font-mono text-zinc-200 shrink-0">{usageSummary.headline}</span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setShowModelMenu(false);
                                setShowAiSettings(true);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] text-sky-300 hover:bg-white/[0.06] transition-colors cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5 shrink-0" />
                              <span>Ver límites, clave y catálogo completo…</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!inputPrompt.trim() || isChatStreaming}
                      className={`shrink-0 mb-0.5 w-8 h-8 rounded-full flex items-center justify-center ${
                        !inputPrompt.trim() || isChatStreaming
                          ? "quick-liquid-btn text-zinc-200/70 cursor-not-allowed"
                          : "quick-liquid-btn-ready active:scale-95 cursor-pointer"
                      }`}
                      title="Enviar instrucción (Enter)"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Barra inferior compacta: selector de contexto desplegable + atajo ⌘K */}
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/[0.05]">
                    <div ref={contextMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setShowModelMenu(false);
                          setShowContextMenu((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={showContextMenu}
                        aria-label="Seleccionar contexto"
                        title="Adjuntar contexto al mensaje"
                        className={`quick-liquid-btn h-7 inline-flex items-center gap-1.5 pl-2.5 pr-2.5 rounded-full text-[11px] cursor-pointer ${
                          activeContextCount > 0 || showContextMenu
                            ? "text-white"
                            : "text-zinc-300 hover:text-white"
                        }`}
                      >
                        <AtSign className="w-3 h-3 text-zinc-400 shrink-0" />
                        <span className="hidden @xs:inline">Contexto</span>
                        {activeContextCount > 0 && (
                          <span className="text-[10px] font-mono text-emerald-400 tabular-nums">
                            {activeContextCount}
                          </span>
                        )}
                        <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${showContextMenu ? "rotate-180" : ""}`} />
                      </button>

                      {contextMenuPresence.mounted && (
                        <div
                          role="listbox"
                          aria-multiselectable="true"
                          className={`${
                            showContextMenu ? "menu-in" : "menu-out pointer-events-none"
                          } menu-origin-left absolute left-0 bottom-full mb-2 w-60 p-1 rounded-xl bg-zinc-900/95 border border-white/10 shadow-2xl backdrop-blur-xl z-30`}
                        >
                          {contextItems.map((item) => {
                            const friendlyLabel = CONTEXT_LABEL[item.type] || item.name;
                            const isInPrompt = inputPrompt.includes(`@${item.name}`);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={isInPrompt}
                                onClick={() => toggleContextInPrompt(item.name)}
                                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                                  isInPrompt ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <ContextIcon type={item.type} className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                  <span className="min-w-0">
                                    <span className="block text-xs text-zinc-100 truncate">{friendlyLabel}</span>
                                    <span className="block text-[10px] text-zinc-500 font-mono truncate">{item.name}</span>
                                  </span>
                                </span>
                                {isInPrompt && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="hidden @sm:flex items-center gap-1.5">
                      {isTauriEnv && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const { invoke } = await import("@tauri-apps/api/core");
                              await invoke("toggle_quick_bar_cmd");
                            } catch {
                              // Ignore
                            }
                          }}
                          title="Abrir Xox Quick Bar flotante (⌘⇧X)"
                          className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded transition-colors cursor-pointer"
                        >
                          ⌘⇧X
                        </button>
                      )}
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-white/[0.03] border border-white/[0.06] rounded">
                        ⌘K
                      </kbd>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>

        </section>

        {/* PANEL CANVAS INTERACTIVO ESTILO GEMINI (TABLAS COMPARATIVAS Y DATOS) */}
        {canvasPresence.mounted && activeCanvas && (
          <div className="w-[44%] min-w-[330px] max-w-[660px] shrink-0 bg-[#060709] border-l border-white/[0.07] p-2.5 overflow-hidden">
            <CanvasPanel
              canvas={activeCanvas}
              visible={canvasPresence.visible}
              onUpdateCanvas={handleUpdateCanvas}
              onAskXoxEdit={handleAskXoxAboutCanvas}
              onClose={() => setShowCanvas(false)}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* COLUMNA 3: TAREAS Y DECISIONES DEL LADO DERECHO (POR ACEPTAR Y HECHAS)    */}
        {/* ========================================================================= */}
        {rightPresence.mounted && (
          <>
            {/* Separador redimensionable derecho (Splitter Aurora de Vidrio) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingRight(true);
              }}
              onDoubleClick={() => setRightWidth(340)}
              className={`splitter-aurora-glass ${isResizingRight ? "is-resizing" : ""} ${
                rightPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              {/* Zona de captura ampliada invisible para fácil arrastre */}
              <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            </div>

            <div
              aria-hidden={!showRightSidebar}
              inert={!showRightSidebar}
              style={{ width: rightPresence.visible ? `${rightWidth}px` : "0px" }}
              className={`sidebar-slot flex justify-start shrink-0 overflow-hidden ${
                isResizingRight ? "is-resizing" : ""
              } ${rightPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <TaskDecisionsPanel
                width={rightWidth}
                tasks={tasks}
                agendaItems={agendaItems}
                historyItems={historyItems}
                maxBudgetLimit={workspaceOverview?.profile.maxBudgetPerOrder ?? 25000}
                currency={workspaceOverview?.profile.currency ?? "MXN"}
                activeTab={taskTab}
                onTabChange={setTaskTab}
                onUpdateParam={handleUpdateTaskParam}
                onToggleTaskChecklist={handleToggleTaskChecklist}
                onApproveTask={handleApproveTask}
                onDiscardTask={handleDiscardTask}
                onAskXox={handleAskXoxAboutTask}
                onToggleTimer={handleToggleTimer}
                onResetTimer={handleResetTimer}
                onCompleteAgendaItem={handleCompleteAgendaItem}
                onRemoveAgendaItem={handleRemoveAgendaItem}
                onToggleAgendaChecklist={handleToggleAgendaChecklist}
                onToggleAgendaAuto={handleToggleAgendaAuto}
                onCreateQuickTimer={handleCreateQuickTimer}
                onCreateQuickNote={handleCreateQuickNote}
                onCreateScheduledEvent={handleCreateScheduledEvent}
                onTriggerXoxReconstruct={() =>
                  runPromptQuery("Consolida y agrupa las órdenes de inventario")
                }
                inventoryCount={inventoryItems.length}
                latestReview={latestReview}
                isReviewRunning={isReviewRunning}
                onRunBusinessReview={() => void handleRunBusinessReview("manual")}
                onImportInventoryFile={handleImportInventoryFile}
              />
            </div>
          </>
        )}

      </div>

      <ClarificationModal
        isOpen={Boolean(activeClarification)}
        clarification={activeClarification}
        onClose={() => setActiveClarification(null)}
        onSubmit={(formattedReply) => {
          const clarificationId = activeClarification?.id;
          const cleanedMessages = chatMessagesRef.current.map((m) =>
            m.actionButton?.kind === "open_clarification" &&
            (!clarificationId || m.actionButton.clarification?.id === clarificationId)
              ? { ...m, actionButton: undefined }
              : m
          );
          setChatMessages(cleanedMessages);
          setActiveClarification(null);
          void runPromptQuery(formattedReply, cleanedMessages);
        }}
      />

      <OpenRouterSettingsModal
        isOpen={showAiSettings}
        config={aiConfig}
        accountUsage={accountUsage}
        catalogModels={catalogModels}
        requestsToday={requestsToday}
        onClose={() => setShowAiSettings(false)}
        onConfigUpdated={(next) => {
          setAiConfig(next);
          if (next.modelId) {
            setModelId(next.modelId);
          }
          setRequestsToday(getLocalDailyRequestCount(next.maskedKey));
        }}
        onUsageUpdated={(usage) => {
          setAccountUsage(usage);
          if (usage?.ok && usage.can_use_paid_models) {
            setUnavailableModelIds(new Set());
          }
        }}
        onCatalogUpdated={(models) => {
          if (models.length > 0) {
            setCatalogModels(models);
          }
        }}
      />

      <LocalAuthModal
        isOpen={showLocalAuth}
        user={localUser}
        defaultStoreName={
          workspaceOverview?.profile.companyName ||
          localUser?.storeName ||
          "Mi Empresa"
        }
        onClose={() => setShowLocalAuth(false)}
        onUserUpdated={(updatedUser) => {
          setLocalUser(updatedUser);
          setStatusMessage(
            updatedUser
              ? `Sesión local activa: ${updatedUser.name} (${updatedUser.storeName})`
              : "Sesión local cerrada."
          );
        }}
      />
    </div>
  );
}