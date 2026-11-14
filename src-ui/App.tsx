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
  AtSign,
  KeyRound,
  RefreshCw,
  Trash2,
  MessageSquare,
  SquarePen,
  Table2,
  UserCircle2,
  Image as ImageIcon,
} from "lucide-react";
import { XoxStar, XoxState } from "./components/XoxStar";
import { XookWordmark } from "./components/XookBrand";
import { LiquidGlassBackdrop } from "./components/LiquidGlassBackdrop";
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
  PdfWorkspacePanel,
  type PdfWorkspacePanelState,
} from "./features/pdf-viewer/PdfWorkspacePanel";
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
  downloadWorkspaceFile,
  exportCanvasToPdf,
  getWorkspaceOverview,
  isWorkspaceTauriRuntime,
  openWorkspaceFile,
  openWorkspaceFolder,
  readUniversalDocument,
  readWorkspaceBinaryPreview,
  readWorkspaceFile,
  renderPdfPreview,
  renameWorkspace,
  resolveCommandPermission,
  saveWorkspaceFile,
  stageWorkspaceAttachment,
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
  type UiChatAttachment,
  UiChatMessage,
} from "./features/ai-service/ChatMessageList";
import {
  CommandPermissionCard,
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "./features/ai-service/CommandPermissionCard";
import {
  OpenRouterSettingsModal,
  type OpenRouterSettingsTab,
} from "./features/ai-service/OpenRouterSettingsModal";
import { ClarificationInputDock } from "./features/ai-service/ClarificationModal";
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
import { ProviderIcon } from "./features/ai-service/ProviderIcon";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  type AiProviderId,
  type AiUsageLedger,
  type AttachedContextItem,
  ClarificationSpec,
  type GeneratedPdfArtifact,
  type PdfDraftProgressEvent,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  ThinkingStep,
  computeProviderUsageSummary,
  detectApiKeyInText,
  detectKeySetupIntentWithProvider,
  detectVaultConfigRequest,
  estimateTokens,
  extractErrorMessage,
  fetchOpenRouterModels,
  formatContextLength,
  formatModelDisplay,
  formatPricePerMillion,
  formatTokenCount,
  getAiConfigStatus,
  getAiUsageLedger,
  getAvailableQuickModels,
  getLocalDailyRequestCount,
  getProviderSpec,
  incrementLocalDailyRequestCount,
  normalizeApiKey,
  normalizeProviderIdClient,
  onAiUsageUpdated,
  runXoxAiChatStream,
  sanitizeGeneratedPdfArtifact,
  saveAiConfig,
  testAiConnection,
} from "./features/ai-service/aiClient";

const BINARY_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;
const OFFICE_DOC_EXT_SET = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
]);
const BINARY_PREVIEW_EXT_SET = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "tif",
  "tiff",
  "heic",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
  "zip",
]);

function classifyAttachmentFile(
  file: Pick<File, "name" | "type">
): "pdf" | "image" | "text" | "binary" {
  const name = file.name.trim();
  const mime = (file.type || "").toLowerCase();
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return "pdf";
  if (BINARY_IMAGE_EXT_RE.test(name) || mime.startsWith("image/")) return "image";
  if (
    /^(text\/|application\/(json|csv|xml|javascript))/.test(mime) ||
    /\.(txt|md|json|csv|tsv|log|yaml|yml|xml)$/i.test(name)
  ) {
    return "text";
  }
  return "binary";
}

async function fileToBase64Payload(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

async function prepareImagePayload(file: File): Promise<{
  imageDataUrl?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
}> {
  if (typeof window === "undefined") return {};
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = objUrl;
    });
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return {};

    const renderScaled = (maxDim: number, forceJpeg: boolean): string | undefined => {
      const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
      const w = Math.max(1, Math.round(naturalW * scale));
      const h = Math.max(1, Math.round(naturalH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, w, h);
      const keepPng =
        !forceJpeg &&
        (/\.(png|webp|gif)$/i.test(file.name) ||
          /image\/(png|webp|gif)/i.test(file.type || ""));
      return keepPng
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.85);
    };

    const imageDataUrl = renderScaled(1408, false);
    const thumbUrl = renderScaled(144, true);
    return { imageDataUrl, thumbUrl, width: naturalW, height: naturalH };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function buildPdfSpecFromCanvas(canvas: CanvasArtifact): Record<string, unknown> {
  const blocks: Array<Record<string, unknown>> = [];
  if (canvas.summary?.trim()) {
    blocks.push({
      type: "callout",
      title: "Resumen ejecutivo",
      text: canvas.summary.trim(),
      tone: "info",
    });
  }
  if (canvas.columns.length > 0 && canvas.rows.length > 0) {
    blocks.push({ type: "heading", level: 1, text: "Detalle comparativo" });
    blocks.push({
      type: "table",
      headers: canvas.columns.map((c) => c.label),
      rows: canvas.rows.map((r) =>
        canvas.columns.map((c) => String(r.cells[c.id] ?? ""))
      ),
    });
  }
  return {
    title: canvas.title || "Reporte XOOK",
    subtitle: canvas.subtitle || undefined,
    theme: "executive",
    cover: { enabled: false },
    blocks,
    ...(canvas.columns.length === 0 && canvas.markdown?.trim()
      ? { markdown: canvas.markdown.trim() }
      : {}),
  };
}

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
  
  // Estados para paneles laterales, tareas y visor de documentos dedicado
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(true);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(true);
  const [showDocViewer, setShowDocViewer] = useState<boolean>(false);
  const [pdfPanelState, setPdfPanelState] = useState<PdfWorkspacePanelState | null>(null);
  const [pdfDraftProgress, setPdfDraftProgress] = useState<PdfDraftProgressEvent | null>(null);
  const [taskTab, setTaskTab] = useState<TaskPanelTab>("pending");
  const [selectedContext, setSelectedContext] = useState<ContextItem | null>(null);

  const pdfPreviewReqRef = useRef<number>(0);
  const rightPanelAutoOpenedTurnRef = useRef<string | null>(null);
  const lastPdfByTurnRef = useRef<Record<string, GeneratedPdfArtifact>>({});

  // Límites y anchos redimensionables para paneles laterales (Estilo Antigravity / IDE)
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 480;
  const MIN_RIGHT_WIDTH = 280;
  const MAX_RIGHT_WIDTH = 720;

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
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);

  // Archivos adjuntos, modelo activo, bóveda IA y chat real
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDraggingOverChat, setIsDraggingOverChat] = useState<boolean>(false);
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
  const [aiSettingsTab, setAiSettingsTab] = useState<OpenRouterSettingsTab>("models");
  const [aiSettingsProvider, setAiSettingsProvider] = useState<AiProviderId | undefined>(undefined);
  const [expandModelMenu, setExpandModelMenu] = useState<boolean>(false);

  const openAiSettings = (
    tab: OpenRouterSettingsTab = "models",
    provider?: AiProviderId
  ) => {
    setAiSettingsTab(tab);
    setAiSettingsProvider(provider ?? normalizeProviderIdClient(aiConfig.provider));
    setShowAiSettings(true);
  };
  const [activeClarification, setActiveClarification] = useState<ClarificationSpec | null>(null);
  const [accountUsage, setAccountUsage] = useState<AiConnectionTestResult | null>(null);
  const [usageLedger, setUsageLedger] = useState<AiUsageLedger | null>(null);
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
  const pendingSecretKeysRef = useRef<
    Map<string, { key: string; provider: AiProviderId; ambiguousProviders?: AiProviderId[] }>
  >(new Map());
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

  const activeProvider = normalizeProviderIdClient(aiConfig.provider);
  const activeSpec = getProviderSpec(activeProvider);
  const configuredProviderEntries = Object.values(aiConfig.configuredProviders ?? {});
  const configuredProvidersCount = configuredProviderEntries.filter((p) => p.hasApiKey).length;
  const hasAnyConfiguredKey =
    aiConfig.hasApiKey || (aiConfig.autoFailover !== false && configuredProvidersCount > 0);
  const activeProviderCatalog =
    catalogModels.length > 0 ? catalogModels : activeSpec.curatedModels;

  const canUsePaidModels =
    activeProvider !== "openrouter" ? true : Boolean(accountUsage?.can_use_paid_models);
  const availableQuickModels = getAvailableQuickModels(
    activeProviderCatalog,
    aiConfig.customModels,
    canUsePaidModels,
    unavailableModelIds,
    activeProvider
  );

  const activeModel: OpenRouterModelOption = formatModelDisplay(modelId, activeProviderCatalog);

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

  const computedUsage = computeProviderUsageSummary({
    provider: activeProvider,
    aiConfig,
    accountUsage,
    usageLedger,
    requestsTodayFallback: requestsToday,
    modelId,
  });

  const usageSummary = (() => {
    const activeSlot = aiConfig.configuredProviders?.[activeProvider];
    const backupTag =
      configuredProvidersCount > 1
        ? ` · ${configuredProvidersCount} provs.`
        : "";

    if (!hasAnyConfiguredKey) {
      return {
        tierLabel: `Conexión IA · ${activeSpec.shortName}`,
        headline: "Sin conectar",
        detail: "Conecta uno o varios proveedores de IA",
        pct: 0,
        meterMode: "unlimited" as const,
        hasMeterBar: false,
        connected: false,
      };
    }

    if (activeSlot?.quotaStatus === "exhausted" || activeSlot?.quotaStatus === "cooldown") {
      return {
        tierLabel: `${activeSpec.shortName} · Límite`,
        headline: activeSlot.quotaStatus === "exhausted" ? "Sin cuota" : "En espera",
        detail: activeSlot.quotaReason || `Respaldo automático ${aiConfig.autoFailover !== false ? "listo" : "inactivo"}${backupTag}`,
        pct: 100,
        meterMode: "used" as const,
        hasMeterBar: true,
        connected: true,
      };
    }

    if (accountUsage && !accountUsage.ok && (!accountUsage.provider || normalizeProviderIdClient(accountUsage.provider) === activeProvider)) {
      return {
        tierLabel: `${activeSpec.shortName}${backupTag}`,
        headline: "Requiere revisión",
        detail: accountUsage.message || `Revisa tu conexión con ${activeSpec.shortName}`,
        pct: 100,
        meterMode: "used" as const,
        hasMeterBar: true,
        connected: true,
      };
    }

    return {
      tierLabel: `${computedUsage.tierLabel}${backupTag}`,
      headline: computedUsage.headline,
      detail: computedUsage.subline,
      pct: computedUsage.pct,
      meterMode: computedUsage.meterMode,
      hasMeterBar: computedUsage.hasMeterBar,
      connected: true,
    };
  })();

  async function refreshModelsAndUsage(
    forceRefresh = false,
    hasKeyOverride?: boolean,
    maskedKeyOverride?: string | null,
    providerOverride?: AiProviderId
  ) {
    const targetPid = normalizeProviderIdClient(providerOverride ?? aiConfig.provider);
    setLoadingModels(true);
    let latestCatalog: OpenRouterModelOption[] = getProviderSpec(targetPid).curatedModels;
    try {
      const res = await fetchOpenRouterModels(false, forceRefresh, targetPid);
      if (res.models.length > 0) {
        latestCatalog = res.models;
        setCatalogModels(res.models);
      }
    } catch {
      setCatalogModels(latestCatalog);
    } finally {
      setLoadingModels(false);
    }

    void getAiUsageLedger().then(setUsageLedger).catch(() => {});

    const hasKey = hasKeyOverride ?? aiConfig.hasApiKey;
    const keyScope = maskedKeyOverride !== undefined ? maskedKeyOverride : aiConfig.maskedKey;
    setRequestsToday(getLocalDailyRequestCount(keyScope));

    if (hasKey) {
      try {
        const usageRes = await testAiConnection(targetPid);
        setAccountUsage(usageRes);
        void getAiUsageLedger().then(setUsageLedger).catch(() => {});
        if (targetPid === "openrouter" && usageRes.ok && !usageRes.can_use_paid_models) {
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
        const cfgPid = normalizeProviderIdClient(cfg.provider);
        await refreshModelsAndUsage(false, cfg.hasApiKey, cfg.maskedKey, cfgPid);
      } catch {
        // Mantiene valores iniciales si aún no hay bóveda
        await refreshModelsAndUsage(false, false, null, "openrouter");
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubUsage: (() => void) | null = null;
    void getAiUsageLedger()
      .then((ledger) => {
        if (!disposed) setUsageLedger(ledger);
      })
      .catch(() => {});
    void onAiUsageUpdated((ledger) => {
      if (!disposed) setUsageLedger(ledger);
    }).then((fn) => {
      if (disposed) fn();
      else unsubUsage = fn;
    });
    return () => {
      disposed = true;
      unsubUsage?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnv) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenAiConfig: (() => void) | null = null;
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

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<AiConfigStatus>("xox-ai-config-updated", (ev) => {
          if (disposed || !ev.payload) return;
          const next = ev.payload;
          setAiConfig(next);
          if (next.modelId) setModelId(next.modelId);
          setRequestsToday(getLocalDailyRequestCount(next.maskedKey));
        })
      )
      .then((fn) => {
        if (disposed) fn();
        else unlistenAiConfig = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      unlistenAiConfig?.();
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
        if (showModelMenu) {
          setShowModelMenu(false);
          modelTriggerRef.current?.focus();
        }
        if (showContextMenu) {
          setShowContextMenu(false);
          contextTriggerRef.current?.focus();
        }
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [showModelMenu, showContextMenu]);

  const handleListboxKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    closeMenu: () => void,
    triggerEl: HTMLButtonElement | null
  ) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      triggerEl?.focus();
    }
  };

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
      const updated = await saveAiConfig({
        provider: activeProvider,
        targetProvider: activeProvider,
        modelId: nextModelId,
      });
      setAiConfig(updated);
    } catch {
      // Mantiene selección local en caso de error temporal
    }
  };

  const saveVaultKeyDirect = async (
    targetPid: AiProviderId,
    rawKey: string,
    modelIdOverride?: string,
    recordTitle?: string
  ) => {
    const targetSpec = getProviderSpec(targetPid);
    const cleanedKey = normalizeApiKey(rawKey);
    const existingSlotModel = aiConfig.configuredProviders?.[targetPid]?.modelId;
    const chosenInitialModel =
      modelIdOverride ||
      existingSlotModel ||
      (targetPid === activeProvider ? modelId : targetSpec.defaultModelId);

    setXoxState("syncing");
    setXoxMessage(`Guardando clave de ${targetSpec.shortName} en bóveda y probando conexión...`);
    const updated = await saveAiConfig({
      provider: targetPid,
      targetProvider: targetPid,
      apiKey: cleanedKey,
      modelId: chosenInitialModel,
      clearCooldown: true,
    });
    setAiConfig(updated);
    setModelId(updated.modelId || chosenInitialModel);

    const [testRes, catRes] = await Promise.all([
      testAiConnection(targetPid),
      fetchOpenRouterModels(false, true, targetPid).catch(() => ({
        ok: false,
        models: targetSpec.curatedModels,
        source: "presets",
      })),
    ]);
    setAccountUsage(testRes);
    if (catRes.models.length > 0) {
      setCatalogModels(catRes.models);
    }
    setRequestsToday(getLocalDailyRequestCount(updated.maskedKey));

    let effectiveModel = updated.modelId || chosenInitialModel;
    if (targetPid === "openrouter" && testRes.ok && !testRes.can_use_paid_models) {
      const isFreeNow = formatModelDisplay(effectiveModel, catRes.models).is_free;
      if (!isFreeNow) {
        effectiveModel = "openrouter/free";
        setModelId("openrouter/free");
      }
    }
    const maskedLabel = updated.maskedKey ?? "cifrada";
    const displayCatalog = catRes.models.length > 0 ? catRes.models : targetSpec.curatedModels;

    const fallbackHistory: TaskHistoryItem = {
      id: `hist_vault_${targetPid}_${Date.now()}`,
      title: recordTitle ?? `Guardar clave API de ${targetSpec.shortName}`,
      category: "boveda",
      decision: "approved",
      summary: `${targetSpec.shortName} (${maskedLabel})`,
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

    setStatusMessage(
      testRes.ok
        ? `${targetSpec.shortName} conectado (${maskedLabel}).`
        : `Clave guardada (${maskedLabel}); revisa la conexión.`
    );
    setXoxState(testRes.ok ? "success" : "alert");
    setXoxMessage(
      testRes.ok
        ? `¡${targetSpec.shortName} conectado y listo para trabajar!`
        : testRes.message
    );
    setTimeout(() => {
      setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
      setXoxMessage("¿En qué puedo ayudarte?");
    }, 4000);
    setTimeout(() => setStatusMessage(null), 4500);

    return {
      targetSpec,
      updated,
      testRes,
      effectiveModel,
      maskedLabel,
      displayCatalog,
    };
  };

  const executeSavePendingKey = async (cardId: string, cardRef?: TaskProposal) => {
    const pending = pendingSecretKeysRef.current.get(cardId);
    if (!pending?.key) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        )
      );
      setStatusMessage("La clave ya fue procesada o expiró en memoria. Pégala de nuevo o usa Ajustes.");
      setTimeout(() => setStatusMessage(null), 4000);
      return;
    }

    const targetPid = pending.provider;
    try {
      const saved = await saveVaultKeyDirect(
        targetPid,
        pending.key,
        undefined,
        cardRef?.title
      );
      pendingSecretKeysRef.current.delete(cardId);
      setTasks((prev) => prev.filter((t) => t.cardId !== cardId));

      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        ),
        {
          id: `msg_a_${Date.now()}`,
          role: "assistant",
          content: saved.testRes.ok
            ? `Clave de **${saved.targetSpec.name}** guardada en bóveda segura (**${saved.maskedLabel}**) y conexión verificada.\n\n${saved.testRes.message} Ya puedes conversar conmigo usando **${formatModelDisplay(saved.effectiveModel, saved.displayCatalog).name}**.`
            : `Clave de **${saved.targetSpec.name}** guardada en bóveda segura (**${saved.maskedLabel}**), pero la verificación devolvió un aviso:\n${saved.testRes.message}`,
          isError: !saved.testRes.ok,
          actionButton: saved.testRes.ok
            ? undefined
            : {
                label: `Revisar Ajustes de ${saved.targetSpec.shortName}`,
                kind: "open_settings",
                provider: targetPid,
              },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
    } catch (err) {
      pendingSecretKeysRef.current.delete(cardId);
      console.error(err);
      setXoxState("alert");
      setXoxMessage("No se pudo guardar la clave en la bóveda.");
      setStatusMessage("Error al guardar la clave en la bóveda local.");
      setTimeout(() => setStatusMessage(null), 4500);
    }
  };

  const handleSaveInlineVaultKey = async (
    msgId: string,
    provider: AiProviderId,
    rawKeyInput: string,
    modelIdOverride?: string
  ): Promise<{ ok: boolean; message: string; maskedKey?: string }> => {
    const cleanedKey = normalizeApiKey(rawKeyInput);
    if (!cleanedKey) {
      return { ok: false, message: "Ingresa una API key válida antes de guardar." };
    }
    try {
      const saved = await saveVaultKeyDirect(provider, cleanedKey, modelIdOverride);
      const nextMessages: UiChatMessage[] = chatMessagesRef.current.map((m) =>
        m.id === msgId
          ? {
              ...m,
              actionButton: undefined,
              vaultPrompt: {
                provider,
                intent: m.vaultPrompt?.intent ?? "prompt_key",
                completed: true,
                savedMaskedKey: saved.maskedLabel,
              },
            }
          : m
      );
      const confirmMsg: UiChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: "assistant",
        content: saved.testRes.ok
          ? `Listo, guardé tu clave de **${saved.targetSpec.name}** (**${saved.maskedLabel}**) en la bóveda local y verifiqué la conexión.\n\n${saved.testRes.message} Modelo activo: **${formatModelDisplay(saved.effectiveModel, saved.displayCatalog).name}**.`
          : `Clave de **${saved.targetSpec.name}** guardada en la bóveda (**${saved.maskedLabel}**), pero la prueba devolvió un aviso:\n${saved.testRes.message}`,
        isError: !saved.testRes.ok,
        actionButton: saved.testRes.ok
          ? undefined
          : {
              label: `Revisar Ajustes de ${saved.targetSpec.shortName}`,
              kind: "open_settings",
              provider,
            },
      };
      const updatedThread = [...nextMessages, confirmMsg];
      setChatMessages(updatedThread);
      void persistConversation(updatedThread);
      return {
        ok: true,
        maskedKey: saved.maskedLabel,
        message: saved.testRes.ok
          ? `${saved.targetSpec.shortName} conectado (${saved.maskedLabel}).`
          : `Clave guardada (${saved.maskedLabel}). ${saved.testRes.message}`,
      };
    } catch (err) {
      const errText = extractErrorMessage(err, "No se pudo guardar la clave en la bóveda.");
      setXoxState("alert");
      setXoxMessage(errText);
      return { ok: false, message: errText };
    }
  };

  const handleChatAction = async (
    action: NonNullable<UiChatMessage["actionButton"]>
  ) => {
    if (action.kind === "open_settings") {
      openAiSettings("account", action.provider ?? activeProvider);
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
      const ext = (entry.extension || "").toLowerCase();
      if (BINARY_PREVIEW_EXT_SET.has(ext)) {
        const preview = await readWorkspaceBinaryPreview(entry.relativePath);
        setSelectedWorkspaceFile({
          relativePath: preview.relativePath,
          name: preview.name,
          zone: entry.zone,
          content: "",
          editable: false,
          pinned: pinnedWorkspacePaths.has(preview.relativePath),
          tokens: 0,
          kind: preview.kind,
          sizeBytes: preview.sizeBytes,
          mimeType: preview.mimeType,
          dataUrl: preview.dataUrl ?? null,
          pdfSummary: preview.pdfSummary ?? null,
        });
        if (preview.kind === "pdf") {
          void openPdfInRightPanel({
            path: preview.relativePath,
            title: preview.pdfSummary?.title || preview.name,
            filename: preview.name,
            pageCount: preview.pdfSummary?.page_count,
            sizeBytes: preview.sizeBytes,
          });
        } else if (preview.kind === "office" || OFFICE_DOC_EXT_SET.has(ext)) {
          void openUniversalDocInRightPanel({
            path: preview.relativePath,
            filename: preview.name,
            sizeBytes: preview.sizeBytes,
            ext,
          });
        } else if (preview.kind === "image" && preview.dataUrl) {
          setPdfDraftProgress(null);
          setPdfPanelState({
            path: preview.relativePath,
            filename: preview.name,
            title: preview.name,
            sizeBytes: preview.sizeBytes,
            pages: [],
            isLoadingPages: false,
            fileKind: "image",
            fileExtension: ext,
            imageDataUrl: preview.dataUrl,
            initialMode: "view",
          });
          setShowDocViewer(true);
        }
        triggerReadingPulse(`Inspeccionando ${entry.name}...`, 950);
        return;
      }

      const f = await readWorkspaceFile(entry.relativePath);
      const selectedFile: SelectedWorkspaceFile = {
        relativePath: f.relativePath,
        name: f.name,
        zone: f.zone,
        content: f.content,
        editable: f.editable,
        pinned: pinnedWorkspacePaths.has(f.relativePath),
        tokens: estimateTokens(f.content),
        kind: "text",
        sizeBytes: f.sizeBytes,
      };
      setSelectedWorkspaceFile(selectedFile);
      if (ext === "csv" || ext === "tsv") {
        void openUniversalDocInRightPanel({
          path: f.relativePath,
          filename: f.name,
          sizeBytes: f.sizeBytes,
          ext,
          textContent: f.content,
        });
      } else {
        setPdfDraftProgress(null);
        setPdfPanelState({
          path: f.relativePath,
          filename: f.name,
          title: f.name,
          sizeBytes: f.sizeBytes,
          pages: [],
          isLoadingPages: false,
          fileKind: "text",
          textContent: f.content,
          fileExtension: ext || "txt",
          initialMode: "view",
        });
        setShowDocViewer(true);
      }
      triggerReadingPulse(`Leyendo ${entry.name}...`, 1050);
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo abrir el archivo seleccionado.")
      );
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleAskXoxAnalyzeFile = (file: SelectedWorkspaceFile) => {
    const promptSuggestion =
      file.kind === "pdf"
        ? `Lee el PDF "${file.relativePath}" y dame un resumen estructurado con sus puntos clave.`
        : file.kind === "image"
        ? `Usa la imagen "${file.relativePath}" `
        : `Revisa el archivo "${file.relativePath}" y `;
    setInputPrompt((prev) => (prev.trim() ? `${prev.trim()} (${file.relativePath})` : promptSuggestion));
    requestAnimationFrame(() => inputRef.current?.focus());
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
    const rawTrimmed = rawQuery.trim();
    if ((!rawTrimmed && attachments.length === 0) || isChatStreaming) return;

    const baseMessages = overrideMessages ?? chatMessagesRef.current;
    const currentAttachments = attachments;
    const query =
      rawTrimmed ||
      (currentAttachments.length === 1
        ? `Analiza el archivo adjunto (${currentAttachments[0].name}).`
        : `Analiza los ${currentAttachments.length} archivos adjuntos.`);
    setInputPrompt("");
    setAttachments([]);

    // 1) Zero-Trust: desambiguación rápida sk- (DeepSeek vs OpenAI) si hay una clave pendiente
    if (
      pendingSecretKeysRef.current.size > 0 &&
      query.length <= 48 &&
      !/sk-|AIza|gsk_/i.test(query) &&
      /\b(?:openai|gpt|deepseek)\b/i.test(query)
    ) {
      const entries = Array.from(pendingSecretKeysRef.current.entries());
      const [latestCardId, latestEntry] = entries[entries.length - 1];
      const chosenPid: AiProviderId = /\b(?:openai|gpt)\b/i.test(query) ? "openai" : "deepseek";
      pendingSecretKeysRef.current.set(latestCardId, {
        ...latestEntry,
        provider: chosenPid,
      });
      const userConfirmMsg: UiChatMessage = {
        id: `msg_u_${Date.now()}`,
        role: "user",
        content: query,
      };
      setChatMessages([...baseMessages, userConfirmMsg]);
      const matchingCard = tasksRef.current.find((t) => t.cardId === latestCardId);
      await executeSavePendingKey(latestCardId, matchingCard);
      return;
    }

    // 1b) Zero-Trust: interceptar claves API localmente antes de cualquier llamada o historial
    const {
      detectedKey,
      maskedKey,
      detectedProvider,
      ambiguousProviders,
      sanitizedText,
    } = detectApiKeyInText(query);
    if (detectedKey && maskedKey) {
      const targetPid: AiProviderId = detectedProvider ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      const cardId = `vault_key_${Date.now()}`;
      pendingSecretKeysRef.current.set(cardId, {
        key: detectedKey,
        provider: targetPid,
        ambiguousProviders,
      });

      const providerDisplay =
        ambiguousProviders.length > 1
          ? `${targetSpec.shortName} (o OpenAI)`
          : targetSpec.name;

      const vaultProposal: TaskProposal = {
        cardId,
        title: `Guardar clave API de ${targetSpec.shortName}`,
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
              { label: "Proveedor", value: providerDisplay },
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
              {
                label: "Modelo inicial",
                value: targetPid === activeProvider ? modelId : targetSpec.defaultModelId,
              },
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
          targetLabel: `${targetSpec.shortName} (${maskedKey})`,
          primaryLabel: `Guardar en ${targetSpec.shortName}`,
        },
        paramValues: {},
      };

      setTasks((prev) => [vaultProposal, ...prev]);
      setShowRightSidebar(true);
      setTaskTab("pending");
      const ambiguityNote =
        ambiguousProviders.length > 1
          ? `\n\nEl prefijo \`sk-\` es compartido por **DeepSeek** y **OpenAI**. La preparé para **DeepSeek**; si corresponde a OpenAI, respóndeme *"es de openai"* y la guardo allí directo.`
          : "";
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        { id: `msg_u_${Date.now()}`, role: "user", content: sanitizedText },
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: `Detecté una clave de **${targetSpec.name}** (**${maskedKey}**) y la intercepté localmente antes de enviarla a internet.${ambiguityNote}\n\nPor seguridad Zero-Trust, confírmame si quieres guardarla en tu bóveda segura y probar la conexión.`,
          actionButton: {
            label: `Guardar en ${targetSpec.shortName}`,
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

    const initialAttachmentsMeta: UiChatAttachment[] = currentAttachments.map((file) => ({
      name: file.name,
      kind: classifyAttachmentFile(file),
    }));

    const userMsg: UiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: "user",
      content: query,
      ...(initialAttachmentsMeta.length > 0 ? { attachments: initialAttachmentsMeta } : {}),
    };

    const setupIntent = detectKeySetupIntentWithProvider(query);
    const vaultReq = detectVaultConfigRequest(query);

    if (vaultReq.isVaultRequest) {
      const targetPid: AiProviderId = vaultReq.providerHint ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      const targetSlot = aiConfig.configuredProviders?.[targetPid];

      if (vaultReq.intentKind === "switch_provider" && targetSlot?.hasApiKey) {
        const nextModel = targetSlot.modelId || targetSpec.defaultModelId;
        const updated = await saveAiConfig({
          provider: targetPid,
          modelId: nextModel,
        });
        setAiConfig(updated);
        setModelId(nextModel);
        void refreshModelsAndUsage(false, true, updated.maskedKey, targetPid);
        const nextMessages: UiChatMessage[] = [
          ...chatMessagesRef.current,
          userMsg,
          {
            id: `msg_a_${Date.now() + 1}`,
            role: "assistant",
            content: `Listo, cambié el proveedor activo a **${targetSpec.name}** usando **${formatModelDisplay(nextModel, targetSpec.curatedModels).name}** (${targetSlot.maskedKey ?? "clave guardada"}).\n\nTarifa base: ${targetSpec.tariffSummary}.`,
          },
        ];
        setChatMessages(nextMessages);
        void persistConversation(nextMessages);
        setXoxState("success");
        setXoxMessage(`Usando ${targetSpec.shortName}.`);
        setTimeout(() => {
          setXoxState((s) => (s === "success" ? "idle" : s));
          setXoxMessage("¿En qué puedo ayudarte?");
        }, 3200);
        return;
      }

      if (vaultReq.intentKind === "open_vault") {
        openAiSettings("account", targetPid);
      }

      const introLine = targetSlot?.hasApiKey
        ? `Ya tienes una clave guardada para **${targetSpec.name}** (${targetSlot.maskedKey ?? "cifrada"}). Puedes actualizarla aquí mismo en tu bóveda segura o elegir otro proveedor:`
        : `Claro, puedo guardarla directo en tu bóveda local segura de XOOK. Ingresa aquí tu API key de **${targetSpec.name}** (${targetSpec.keyPrefixHint}) o pégala directo en el chat:`;

      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        userMsg,
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: `${introLine}\n\n*Protección Zero-Trust:* tu clave se cifra localmente en tu equipo y nunca viaja al historial ni a ningún modelo externo.`,
          vaultPrompt: {
            provider: targetPid,
            intent: vaultReq.intentKind === "open_vault" ? "open_settings" : "prompt_key",
            note: `${targetSpec.tariffSummary} · Guardado local en bóveda`,
          },
          actionButton: {
            label: `Abrir Bóveda (${targetSpec.shortName})`,
            kind: "open_settings",
            provider: targetPid,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("idle");
      setXoxMessage(`Bóveda lista para ${targetSpec.shortName}.`);
      return;
    }

    // 2) Sin ninguna clave configurada: informar con honestidad y ofrecer bóveda directa en el chat
    if (!hasAnyConfiguredKey) {
      const targetPid = setupIntent.providerHint ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      if (setupIntent.isSetup) {
        openAiSettings("account", targetPid);
      }
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        userMsg,
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: setupIntent.isSetup
            ? `Preparé la bóveda para **${targetSpec.name}**. Ingresa o pega aquí tu clave \`${targetSpec.keyPrefixHint}\` para guardarla localmente.`
            : "Aún no tienes ningún proveedor de IA conectado.\n\nConecta una clave de **OpenRouter**, **DeepSeek**, **Groq**, **Gemini**, **OpenAI** o **Anthropic** directo aquí abajo o en los ajustes de XOOK.",
          vaultPrompt: {
            provider: targetPid,
            intent: "prompt_key",
            note: `${targetSpec.tariffSummary} · Bóveda Zero-Trust`,
          },
          actionButton: {
            label: setupIntent.providerHint ? `Configurar ${targetSpec.shortName}` : "Abrir Bóveda IA",
            kind: "open_settings",
            provider: targetPid,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("idle");
      setXoxMessage("Conecta un proveedor de IA para iniciar.");
      return;
    }

    // 3) Inferencia real en streaming contra el proveedor activo (con respaldo automático por cuota)
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
      let stagedAnyBinary = false;
      const thumbByIdx = new Map<number, { previewUrl?: string; workspacePath?: string }>();

      const fileSnippets: AttachedContextItem[] = await Promise.all(
        currentAttachments.map(async (file, fIdx): Promise<AttachedContextItem> => {
          const kind = classifyAttachmentFile(file);

          if (kind === "pdf" || kind === "image" || kind === "binary") {
            let stagedPath: string | undefined;
            let stagedMime = file.type || (kind === "pdf" ? "application/pdf" : "application/octet-stream");
            if (isTauriEnv && file.size > 0 && file.size <= 25 * 1024 * 1024) {
              try {
                const b64 = await fileToBase64Payload(file);
                const staged = await stageWorkspaceAttachment(file.name, b64);
                stagedPath = staged.relativePath;
                stagedMime = staged.mimeType || stagedMime;
                stagedAnyBinary = true;
              } catch {
                stagedPath = undefined;
              }
            }

            if (kind === "image") {
              const imgPrep = await prepareImagePayload(file);
              if (imgPrep.thumbUrl || stagedPath) {
                thumbByIdx.set(fIdx, {
                  previewUrl: imgPrep.thumbUrl,
                  workspacePath: stagedPath,
                });
              }
              const dimText =
                imgPrep.width && imgPrep.height ? ` (${imgPrep.width}×${imgPrep.height}px)` : "";
              return {
                name: file.name,
                type: stagedMime,
                kind: "image",
                workspacePath: stagedPath,
                mimeType: stagedMime,
                sizeBytes: file.size,
                width: imgPrep.width,
                height: imgPrep.height,
                imageDataUrl: imgPrep.imageDataUrl,
                content: stagedPath
                  ? `Imagen adjunta guardada en '${stagedPath}'${dimText}. Puedes usarla en 'pdf_generate' (como portada en 'cover.image_path' o bloque {type:'image', path:'${stagedPath}'}) o inspeccionarla con 'workspace_read'.`
                  : `Imagen adjunta '${file.name}'${dimText}.`,
              };
            }

            if (kind === "pdf") {
              if (stagedPath) {
                thumbByIdx.set(fIdx, { workspacePath: stagedPath });
              }
              return {
                name: file.name,
                type: "application/pdf",
                kind: "pdf",
                workspacePath: stagedPath,
                mimeType: "application/pdf",
                sizeBytes: file.size,
                content: stagedPath
                  ? `PDF adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Usa SIEMPRE la herramienta 'pdf_read' con path='${stagedPath}' para extraer su texto, tablas y OCR.`
                  : `Archivo PDF adjunto '${file.name}' (${Math.max(1, Math.round(file.size / 1024))} KB).`,
              };
            }

            const ext = file.name.split(".").pop()?.toLowerCase() || "";
            if (OFFICE_DOC_EXT_SET.has(ext) && stagedPath) {
              thumbByIdx.set(fIdx, { workspacePath: stagedPath });
              void openUniversalDocInRightPanel({
                path: stagedPath,
                filename: file.name,
                sizeBytes: file.size,
                ext,
              });
              return {
                name: file.name,
                type: stagedMime,
                kind: "binary",
                workspacePath: stagedPath,
                mimeType: stagedMime,
                sizeBytes: file.size,
                content: `Documento Office adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Usa SIEMPRE la herramienta 'workspace_read' con path='${stagedPath}' para leer su texto, diapositivas o tablas completas.`,
              };
            }

            return {
              name: file.name,
              type: stagedMime,
              kind: "binary",
              workspacePath: stagedPath,
              mimeType: stagedMime,
              sizeBytes: file.size,
              content: stagedPath
                ? `Archivo binario guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB).`
                : `(Archivo adjunto de ${Math.max(1, Math.round(file.size / 1024))} KB)`,
            };
          }

          if (file.size <= 131072) {
            try {
              const raw = await file.text();
              return {
                name: file.name,
                type: file.type || "text/plain",
                kind: "text",
                sizeBytes: file.size,
                content: raw.slice(0, 4000),
              };
            } catch {
              return {
                name: file.name,
                type: file.type || "archivo",
                kind: "text",
                content: "(No se pudo leer el contenido del archivo)",
              };
            }
          }

          return {
            name: file.name,
            type: file.type || "archivo",
            kind: "text",
            sizeBytes: file.size,
            content: `(Archivo de texto grande de ${Math.round(file.size / 1024)} KB)`,
          };
        })
      );

      if (thumbByIdx.size > 0) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id && m.attachments
              ? {
                  ...m,
                  attachments: m.attachments.map((att, idx) => {
                    const patch = thumbByIdx.get(idx);
                    return patch ? { ...att, ...patch } : att;
                  }),
                }
              : m
          )
        );
      }
      if (stagedAnyBinary && isTauriEnv) {
        void handleRefreshWorkspace();
      }

      const activeContextSnippets: AttachedContextItem[] = contextItems
        .filter((c) => c.pinned || selectedContext?.id === c.id)
        .map((c) => ({
          name: c.name,
          type: c.type,
          content: c.content.slice(0, 2500),
        }));

      if (showDocViewer && pdfPanelState?.path) {
        const viewerKind = pdfPanelState.fileKind || "pdf";
        const activeDocName =
          pdfPanelState.title || pdfPanelState.filename || pdfPanelState.path;
        if (viewerKind === "pdf") {
          activeContextSnippets.unshift({
            name: activeDocName,
            type: "application/pdf",
            kind: "pdf",
            workspacePath: pdfPanelState.path,
            content:
              `DOCUMENTO ACTIVO EN EL VISOR: '${pdfPanelState.path}' (título: '${pdfPanelState.title}', estilo/theme: '${pdfPanelState.theme || "executive"}', páginas actuales: ${pdfPanelState.pageCount || pdfPanelState.pages.length || 1}). ` +
              `Si el usuario pide agregar más páginas a este documento, llama a 'pdf_generate' con source_pdf_path='${pdfPanelState.path}', edit_action='append_pages' y theme='${pdfPanelState.theme || "executive"}' para conservar exactamente la misma tipografía, diseño, encabezados y numeración continua. ` +
              `Si pide modificar contenido de este PDF, usa source_pdf_path='${pdfPanelState.path}' con edit_action='modify' (y replacements=[{find, replace}] si aplica) manteniendo su misma tipografía y diseño.`,
          });
        } else {
          activeContextSnippets.unshift({
            name: activeDocName,
            type: "document",
            workspacePath: pdfPanelState.path,
            content:
              `DOCUMENTO ACTIVO EN EL VISOR: '${pdfPanelState.path}' (${viewerKind}, título: '${pdfPanelState.title}'). Usa 'workspace_read' con path='${pdfPanelState.path}' si necesitas leer su contenido completo.`,
          });
        }
      }

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
          providerOverride: activeProvider,
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
          onProviderFailover: (evt) => {
            const toSpec = getProviderSpec(evt.toProvider);
            const label =
              evt.notice ||
              `Límite en ${getProviderSpec(evt.fromProvider).shortName} · cambiando a ${toSpec.shortName}...`;
            setThinkingLabel(label);
            setXoxMessage(label);
            setStatusMessage(label);
            if (evt.modelUsed) {
              setModelId(evt.modelUsed);
            }
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
          onVaultAction: (vaultAction) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, vaultPrompt: vaultAction } : m
              )
            );
          },
          onPdfDraftProgress: (draft) => {
            handlePdfDraftProgress(draft, assistantMsgId);
          },
          onPdfGenerated: (pdf) => {
            const slimPdf: GeneratedPdfArtifact = {
              ...pdf,
              previewPages: undefined,
              previewHasMore: undefined,
            };
            lastPdfByTurnRef.current[assistantMsgId] = slimPdf;
            setChatMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const prevList = m.generatedPdfs ?? [];
                const nextList = prevList.some((p) => p.path === slimPdf.path)
                  ? prevList.map((p) => (p.path === slimPdf.path ? slimPdf : p))
                  : [...prevList, slimPdf];
                return { ...m, generatedPdfs: nextList };
              })
            );
            void openPdfInRightPanel(pdf);
          },
        }
      );

      clearXoxPhaseTimers();
      setPdfDraftProgress(null);
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
      const finalPid = res.providerUsed ? normalizeProviderIdClient(res.providerUsed) : activeProvider;
      if (res.failoverNotice || (res.failoverEvents && res.failoverEvents.length > 0)) {
        const noticeText =
          res.failoverNotice ||
          `Cuota agotada en ${activeSpec.shortName}; continué automáticamente con ${getProviderSpec(finalPid).shortName}.`;
        setStatusMessage(noticeText);
        setTimeout(() => setStatusMessage(null), 6500);
        void getAiConfigStatus().then((fresh) => {
          setAiConfig(fresh);
          if (fresh.modelId) setModelId(fresh.modelId);
        });
        void fetchOpenRouterModels(false, false, finalPid).then((catRes) => {
          if (catRes.models.length > 0) setCatalogModels(catRes.models);
        });
      }
      testAiConnection(finalPid)
        .then((u) => setAccountUsage(u))
        .catch(() => {});
      void getAiUsageLedger().then(setUsageLedger).catch(() => {});

      const nextClarification = res.clarification ?? null;
      const nextVaultAction = res.vaultAction ?? undefined;
      const resPdfs = res.generatedPdfs ?? [];
      const replyWithFailover =
        res.failoverNotice && res.reply && !res.reply.includes(res.failoverNotice)
          ? `> *Nota de respaldo automático:* ${res.failoverNotice}\n\n${res.reply}`
          : res.reply;
      const finalMessages = chatMessagesRef.current.map((m) => {
        if (m.id !== assistantMsgId) return m;
        const resolvedVault = nextVaultAction ?? m.vaultPrompt;
        return {
          ...m,
          content: replyWithFailover,
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
          vaultPrompt: resolvedVault,
          generatedPdfs: (() => {
            const base = m.generatedPdfs ?? [];
            if (resPdfs.length === 0) return base.length > 0 ? base : undefined;
            const byPath = new Map<string, GeneratedPdfArtifact>();
            for (const p of base) byPath.set(p.path, p);
            for (const p of resPdfs) byPath.set(p.path, p);
            return Array.from(byPath.values());
          })(),
          actionButton: nextClarification
            ? {
                label: "Responder preguntas",
                kind: "open_clarification" as const,
                clarification: nextClarification,
              }
            : resolvedVault
              ? {
                  label: `Abrir Bóveda (${getProviderSpec(resolvedVault.provider).shortName})`,
                  kind: "open_settings" as const,
                  provider: resolvedVault.provider,
                }
              : m.actionButton,
        };
      });
      setChatMessages(finalMessages);
      void persistConversation(finalMessages, convId);
      if (nextClarification) {
        setActiveClarification(nextClarification);
      }
      if (nextVaultAction?.intent === "open_settings") {
        openAiSettings("account", nextVaultAction.provider);
      } else if (
        nextVaultAction?.intent === "switch_provider" &&
        aiConfig.configuredProviders?.[nextVaultAction.provider]?.hasApiKey
      ) {
        const targetSlot = aiConfig.configuredProviders[nextVaultAction.provider];
        const nextModel = targetSlot?.modelId || getProviderSpec(nextVaultAction.provider).defaultModelId;
        void saveAiConfig({
          provider: nextVaultAction.provider,
          modelId: nextModel,
        }).then((updated) => {
          setAiConfig(updated);
          setModelId(updated.modelId || nextModel);
        });
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
      const recoveredTurnPdf = lastPdfByTurnRef.current[assistantMsgId];
      if (recoveredTurnPdf) {
        setPdfDraftProgress(null);
        void openPdfInRightPanel(recoveredTurnPdf);
      } else {
        setPdfDraftProgress(null);
      }
      const message = extractErrorMessage(
        err,
        `No se pudo completar la consulta con ${activeSpec.name}.`
      );
      const lowerMsg = message.toLowerCase();
      if (
        lowerMsg.includes("402") ||
        lowerMsg.includes("saldo") ||
        lowerMsg.includes("créditos") ||
        lowerMsg.includes("cuota") ||
        lowerMsg.includes("no está disponible") ||
        lowerMsg.includes("404")
      ) {
        setUnavailableModelIds((prev) => {
          const next = new Set(prev);
          next.add(modelId);
          return next;
        });
      }
      if (hasAnyConfiguredKey) {
        void getAiConfigStatus()
          .then((fresh) => {
            setAiConfig(fresh);
            if (fresh.modelId) setModelId(fresh.modelId);
            return testAiConnection(fresh.provider);
          })
          .then((u) => setAccountUsage(u))
          .catch(() => {});
      }
      const errMessages = chatMessagesRef.current.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: `Error al consultar ${activeSpec.name}: ${message}`,
              thinkingSteps: m.thinkingSteps?.map((s) =>
                s.status === "running" ? { ...s, status: "error" as const } : s
              ),
              isStreaming: false,
              isReasoningStreaming: false,
              isError: true,
              actionButton: {
                label: "Revisar proveedores y claves",
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

  // Saludo al hacer clic: única situación en la que aparece la burbuja de diálogo
  const handleXoxClick = () => {
    if (xoxState !== "idle" || greeting) return;
    setXoxState("success");
    setGreetingLeaving(false);
    const agentName = workspaceOverview?.profile.agentName?.trim() || "Xox";
    const activeRole = workspaceOverview?.profile.activeRole?.trim();
    setGreeting(
      activeRole
        ? `¡Hola! Soy ${agentName} (${activeRole}). ¿En qué trabajamos hoy?`
        : `¡Hola! Soy ${agentName}. ¿Qué construimos o revisamos hoy?`
    );
    greetingTimers.current.forEach(clearTimeout);
    greetingTimers.current = [
      setTimeout(() => setGreetingLeaving(true), 3400),
      setTimeout(() => {
        setGreeting(null);
        setGreetingLeaving(false);
        setXoxState((s) => (s === "success" ? "idle" : s));
      }, 3640),
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
  const docViewerPresence = useAnimatedPresence(
    showDocViewer && Boolean(pdfPanelState || pdfDraftProgress),
    220
  );

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

  const openPdfInRightPanel = async (
    meta: {
      path: string;
      title?: string;
      filename?: string;
      pageCount?: number;
      sizeBytes?: number;
      hasCover?: boolean;
      theme?: string;
      previewPages?: Array<{ page: number; width: number; height: number; dataUrl: string }>;
      previewHasMore?: boolean;
    },
    initialMode: "view" | "edit_blocks" | "edit_page" = "view"
  ) => {
    const reqId = (pdfPreviewReqRef.current += 1);
    setPdfDraftProgress(null);
    setShowDocViewer(true);

    const cleanTitle = meta.title || meta.filename || meta.path.split("/").pop() || "Documento PDF";
    if (meta.previewPages && meta.previewPages.length > 0) {
      setPdfPanelState({
        path: meta.path,
        filename: meta.filename || meta.path.split("/").pop(),
        title: cleanTitle,
        pageCount: meta.pageCount ?? meta.previewPages.length,
        sizeBytes: meta.sizeBytes,
        hasCover: meta.hasCover,
        theme: meta.theme,
        pages: meta.previewPages,
        hasMore: Boolean(meta.previewHasMore),
        isLoadingPages: false,
        fileKind: "pdf",
        initialMode,
      });
      return;
    }

    setPdfPanelState((prev) => ({
      path: meta.path,
      filename: meta.filename || meta.path.split("/").pop(),
      title: cleanTitle,
      pageCount: meta.pageCount ?? prev?.pageCount,
      sizeBytes: meta.sizeBytes ?? prev?.sizeBytes,
      hasCover: meta.hasCover ?? prev?.hasCover,
      theme: meta.theme ?? prev?.theme,
      pages: [],
      hasMore: false,
      isLoadingPages: true,
      fileKind: "pdf",
      initialMode,
    }));

    if (!isTauriEnv) return;
    try {
      const res = await renderPdfPreview(meta.path, { startPage: 1, maxPages: 8 });
      if (reqId !== pdfPreviewReqRef.current) return;
      if (res && res.ok && res.pages.length > 0) {
        setPdfPanelState((curr) =>
          curr
            ? {
                ...curr,
                pageCount: res.pageCount,
                pages: res.pages,
                hasMore: res.hasMore,
                isLoadingPages: false,
                error: null,
              }
            : null
        );
      } else {
        setPdfPanelState((curr) =>
          curr
            ? {
                ...curr,
                isLoadingPages: false,
                error: res?.error || "No se pudo generar la vista previa de páginas.",
              }
            : null
        );
      }
    } catch (err) {
      if (reqId !== pdfPreviewReqRef.current) return;
      setPdfPanelState((curr) =>
        curr
          ? {
              ...curr,
              isLoadingPages: false,
              error: extractErrorMessage(err, "No se pudo renderizar la vista previa del PDF."),
            }
          : null
      );
    }
  };

  const openUniversalDocInRightPanel = async (opts: {
    path: string;
    filename: string;
    sizeBytes?: number;
    ext?: string;
    textContent?: string;
    editMode?: boolean;
  }) => {
    const ext = (opts.ext || opts.path.split(".").pop() || "").toLowerCase();
    const isSpreadsheetText = ext === "csv" || ext === "tsv";
    setPdfDraftProgress(null);
    setPdfPanelState({
      path: opts.path,
      filename: opts.filename,
      title: opts.filename,
      sizeBytes: opts.sizeBytes,
      pages: [],
      isLoadingPages: true,
      fileKind: isSpreadsheetText ? "text" : "office",
      fileExtension: ext,
      textContent: opts.textContent,
      initialMode: opts.editMode ? "edit_page" : "view",
    });
    setShowDocViewer(true);

    try {
      const doc = await readUniversalDocument(opts.path);
      setPdfPanelState((curr) =>
        curr && curr.path === opts.path
          ? {
              ...curr,
              title: doc?.title || opts.filename,
              sizeBytes: doc?.sizeBytes ?? opts.sizeBytes,
              isLoadingPages: false,
              universalDoc: doc ?? null,
              textContent: opts.textContent ?? doc?.markdown ?? doc?.text ?? "",
              error: doc && doc.ok === false ? doc.error || "No se pudo leer el archivo." : null,
            }
          : curr
      );
    } catch (err) {
      setPdfPanelState((curr) =>
        curr && curr.path === opts.path
          ? {
              ...curr,
              isLoadingPages: false,
              error: extractErrorMessage(err, "No se pudo abrir el documento en el visor."),
            }
          : curr
      );
    }
  };

  const handleOpenWorkspaceFileInViewer = (
    file: SelectedWorkspaceFile,
    editMode = false
  ) => {
    const ext = file.relativePath.split(".").pop()?.toLowerCase() || "txt";
    if (file.kind === "pdf") {
      void openPdfInRightPanel(
        {
          path: file.relativePath,
          title: file.pdfSummary?.title || file.name,
          filename: file.name,
          pageCount: file.pdfSummary?.page_count,
          sizeBytes: file.sizeBytes,
        },
        editMode ? "edit_page" : "view"
      );
      return;
    }
    if (file.kind === "office" || OFFICE_DOC_EXT_SET.has(ext) || ext === "csv" || ext === "tsv") {
      void openUniversalDocInRightPanel({
        path: file.relativePath,
        filename: file.name,
        sizeBytes: file.sizeBytes,
        ext,
        textContent: file.content || undefined,
        editMode,
      });
      return;
    }
    if (file.kind === "image" && file.dataUrl) {
      setPdfDraftProgress(null);
      setPdfPanelState({
        path: file.relativePath,
        filename: file.name,
        title: file.name,
        sizeBytes: file.sizeBytes,
        pages: [],
        isLoadingPages: false,
        fileKind: "image",
        fileExtension: ext,
        imageDataUrl: file.dataUrl,
        initialMode: "view",
      });
      setShowDocViewer(true);
      return;
    }
    setPdfDraftProgress(null);
    setPdfPanelState({
      path: file.relativePath,
      filename: file.name,
      title: file.name,
      sizeBytes: file.sizeBytes,
      pages: [],
      isLoadingPages: false,
      fileKind: "text",
      textContent: file.content,
      fileExtension: ext,
      initialMode: editMode ? "edit_page" : "view",
    });
    setShowDocViewer(true);
  };

  const handleDownloadPdfFromChat = async (pdf: GeneratedPdfArtifact) => {
    try {
      const res = await downloadWorkspaceFile(pdf.path, pdf.filename || `${pdf.title}.pdf`);
      if (res?.ok) {
        setStatusMessage(`Descargado en Descargas: ${res.filename}`);
        setTimeout(() => setStatusMessage(null), 4200);
      }
    } catch (err) {
      setStatusMessage(extractErrorMessage(err, "No se pudo descargar el PDF."));
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleExportTextDocumentToPdf = async (title: string, markdownContent: string) => {
    if (!isTauriEnv) return;
    const rawRes = await exportCanvasToPdf({
      title,
      markdown: markdownContent,
      theme: "executive",
    });
    const pdfArtifact = sanitizeGeneratedPdfArtifact(rawRes);
    if (pdfArtifact) {
      setStatusMessage(`PDF generado: ${pdfArtifact.filename}`);
      setTimeout(() => setStatusMessage(null), 4000);
      void handleRefreshWorkspace();
      void openPdfInRightPanel(pdfArtifact);
    }
  };

  const handleLoadMorePdfPages = async (relativePath?: string, nextStartPage?: number) => {
    const snap = pdfPanelState;
    const targetPath = relativePath || snap?.path;
    if (!snap || !targetPath || snap.isLoadingPages || !isTauriEnv) {
      return;
    }
    const reqId = pdfPreviewReqRef.current;
    const nextStart = nextStartPage ?? snap.pages.length + 1;
    setPdfPanelState((curr) => (curr ? { ...curr, isLoadingPages: true } : curr));
    try {
      const res = await renderPdfPreview(targetPath, { startPage: nextStart, maxPages: 8 });
      if (reqId !== pdfPreviewReqRef.current) return;
      if (res && res.ok) {
        setPdfPanelState((curr) => {
          if (!curr) return curr;
          const seen = new Set(curr.pages.map((p) => p.page));
          const merged = [...curr.pages, ...res.pages.filter((p) => !seen.has(p.page))];
          return {
            ...curr,
            pages: merged,
            pageCount: res.pageCount,
            hasMore: res.hasMore,
            isLoadingPages: false,
          };
        });
      } else {
        setPdfPanelState((curr) => (curr ? { ...curr, isLoadingPages: false } : curr));
      }
    } catch {
      setPdfPanelState((curr) => (curr ? { ...curr, isLoadingPages: false } : curr));
    }
  };

  const handlePdfDraftProgress = (draft: PdfDraftProgressEvent, turnId: string) => {
    pdfPreviewReqRef.current += 1;
    if (rightPanelAutoOpenedTurnRef.current !== turnId) {
      rightPanelAutoOpenedTurnRef.current = turnId;
      setShowDocViewer(true);
    }
    setPdfDraftProgress(draft);
  };

  const handleExportCanvasPdf = async (canvas: CanvasArtifact) => {
    if (!isTauriEnv) return;
    const reqId = (pdfPreviewReqRef.current += 1);
    setShowDocViewer(true);
    const canvasPreviewBlocks: PdfDraftProgressEvent["blocks"] = [];
    if (canvas.summary?.trim()) {
      canvasPreviewBlocks.push({
        type: "callout",
        title: "Resumen ejecutivo",
        text: canvas.summary.trim(),
      });
    }
    if (canvas.columns.length > 0 && canvas.rows.length > 0) {
      canvasPreviewBlocks.push({
        type: "table",
        columns: canvas.columns.map((c) => c.label),
        rows: canvas.rows.slice(0, 6).map((r) => canvas.columns.map((c) => r.cells[c.id] ?? "")),
      });
    } else if (canvas.markdown?.trim()) {
      canvasPreviewBlocks.push({ type: "paragraph", text: canvas.markdown.trim().slice(0, 240) });
    }
    setPdfDraftProgress({
      stage: "rendering_pdf",
      stepLabel: "Compilando Canvas en páginas PDF...",
      progress: 0.45,
      title: canvas.title || "Canvas XOOK",
      subtitle: canvas.subtitle,
      theme: "executive",
      hasCover: false,
      cover: null,
      totalBlocks: canvasPreviewBlocks.length,
      completedBlocks: 1,
      blocks: canvasPreviewBlocks,
    });

    setXoxState("syncing");
    setThinkingLabel("Generando PDF...");
    setXoxMessage("Generando documento PDF...");
    try {
      const rawRes = await exportCanvasToPdf(buildPdfSpecFromCanvas(canvas));
      const pdfArtifact = sanitizeGeneratedPdfArtifact(rawRes);
      setPdfDraftProgress(null);
      if (pdfArtifact) {
        const targetMsgId = canvas.sourceMessageId;
        const hasSourceMsg = Boolean(
          targetMsgId && chatMessagesRef.current.some((m) => m.id === targetMsgId)
        );
        const nextMessages: UiChatMessage[] = hasSourceMsg
          ? chatMessagesRef.current.map((m) => {
              if (m.id !== targetMsgId) return m;
              const prevList = m.generatedPdfs ?? [];
              const merged = prevList.some((p) => p.path === pdfArtifact.path)
                ? prevList.map((p) => (p.path === pdfArtifact.path ? pdfArtifact : p))
                : [...prevList, pdfArtifact];
              return { ...m, generatedPdfs: merged };
            })
          : [
              ...chatMessagesRef.current,
              {
                id: `msg_pdf_${Date.now()}`,
                role: "assistant",
                content: `Exporté **${pdfArtifact.title}** a PDF en \`${pdfArtifact.path}\`.`,
                generatedPdfs: [pdfArtifact],
              },
            ];
        setChatMessages(nextMessages);
        void persistConversation(nextMessages);
        setStatusMessage(`PDF listo: ${pdfArtifact.path}`);
        setTimeout(() => setStatusMessage(null), 4500);
        if (reqId === pdfPreviewReqRef.current) {
          void openPdfInRightPanel(pdfArtifact);
        }
      }
      void handleRefreshWorkspace();
      setXoxState("success");
      setXoxMessage("PDF generado correctamente.");
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 2800);
    } catch (err) {
      setPdfDraftProgress(null);
      setXoxState("alert");
      const msg = extractErrorMessage(err, "No se pudo exportar el PDF.");
      if (reqId === pdfPreviewReqRef.current) {
        setPdfPanelState((curr) =>
          curr ? { ...curr, error: msg, isLoadingPages: false } : curr
        );
      }
      setStatusMessage(msg);
      setTimeout(() => setStatusMessage(null), 4500);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 3000);
    }
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

        {/* Lado Derecho: Toggle de Canvas + Tareas y Decisiones */}
        <div className="flex items-center gap-2">
          {showCanvas && activeCanvas && (
            <button
              type="button"
              onClick={() => setShowCanvas(false)}
              aria-pressed={showCanvas}
              title="Ocultar Canvas"
              className="px-2.5 py-1.5 rounded-lg border bg-white/[0.08] text-white border-white/[0.12] hover:bg-white/[0.12] flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Table2 className="w-3.5 h-3.5 text-zinc-200" />
              <span className="text-[11px] font-medium hidden sm:inline max-w-[120px] truncate">
                Canvas
              </span>
            </button>
          )}

          <button
            onClick={() => setShowRightSidebar((v) => !v)}
            aria-pressed={showRightSidebar}
            title={
              showRightSidebar
                ? "Ocultar panel de tareas"
                : "Mostrar panel de tareas"
            }
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
                className="h-full bg-[#07080b] flex flex-col shrink-0 overflow-hidden select-none"
              >
              
              {/* Cabecera del Panel con Tabs Contexto / Chats */}
              <div className="px-2.5 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 bg-[#090a0e]">
                <div
                  role="tablist"
                  aria-label="Secciones del panel lateral"
                  className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07]"
                  onKeyDown={(e) => {
                    if (
                      e.key === "ArrowLeft" ||
                      e.key === "ArrowRight" ||
                      e.key === "Home" ||
                      e.key === "End"
                    ) {
                      e.preventDefault();
                      const nextTab: "context" | "chats" =
                        e.key === "Home"
                          ? "context"
                          : e.key === "End"
                          ? "chats"
                          : leftTab === "context"
                          ? "chats"
                          : "context";
                      setLeftTab(nextTab);
                      document
                        .getElementById(
                          nextTab === "context"
                            ? "xook-sidebar-tab-context"
                            : "xook-sidebar-tab-chats"
                        )
                        ?.focus();
                    }
                  }}
                >
                  <button
                    id="xook-sidebar-tab-context"
                    type="button"
                    role="tab"
                    aria-selected={leftTab === "context"}
                    tabIndex={leftTab === "context" ? 0 : -1}
                    onClick={() => setLeftTab("context")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:outline-offset-2 ${
                      leftTab === "context"
                        ? "bg-white/[0.1] text-white border border-white/[0.12]"
                        : "border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    }`}
                  >
                    <FolderOpen
                      className={`w-3.5 h-3.5 ${
                        leftTab === "context" ? "text-zinc-200" : "text-zinc-500"
                      }`}
                    />
                    <span>Contexto</span>
                  </button>
                  <button
                    id="xook-sidebar-tab-chats"
                    type="button"
                    role="tab"
                    aria-selected={leftTab === "chats"}
                    tabIndex={leftTab === "chats" ? 0 : -1}
                    onClick={() => setLeftTab("chats")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:outline-offset-2 ${
                      leftTab === "chats"
                        ? "bg-white/[0.1] text-white border border-white/[0.12]"
                        : "border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
                    }`}
                  >
                    <MessageSquare
                      className={`w-3.5 h-3.5 ${
                        leftTab === "chats" ? "text-zinc-200" : "text-zinc-500"
                      }`}
                    />
                    <span>Chats</span>
                    {conversations.length > 0 && (
                      <span className="text-[10px] font-mono tabular-nums text-zinc-300 bg-white/[0.07] px-1.5 py-0.2 rounded-md">
                        {conversations.length}
                      </span>
                    )}
                  </button>
                </div>

                {leftTab === "chats" && (conversations.length > 0 || chatMessages.length > 0) ? (
                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isChatStreaming}
                    title="Iniciar nueva conversación"
                    className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] px-2.5 py-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    <SquarePen className="w-3 h-3 text-zinc-300" />
                    <span>Nueva</span>
                  </button>
                ) : null}
              </div>

              {leftTab === "context" ? (
                <div
                  id="xook-sidebar-panel-context"
                  role="tabpanel"
                  aria-labelledby="xook-sidebar-tab-context"
                  className="flex-1 flex flex-col min-h-0 overflow-hidden"
                >
                  {/* Estado de OpenRouter + Memoria de conversación (monocromo negro/gris) */}
                  <div className="mx-2.5 mt-2.5 mb-1.5 rounded-xl bg-[#0b0c10] border border-white/[0.08] p-2.5 space-y-2 shrink-0">
                    {/* Consumo y estado del proveedor de IA */}
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px] mb-1.5">
                        <span className="flex items-center gap-1.5 text-zinc-100 font-medium truncate">
                          <ProviderIcon
                            provider={activeProvider}
                            size={14}
                            className={`shrink-0 ${
                              accountUsage && !accountUsage.ok
                                ? "text-zinc-400"
                                : usageSummary.connected
                                ? "text-zinc-200"
                                : "text-zinc-500"
                            }`}
                          />
                          <span className="truncate">{usageSummary.tierLabel}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => refreshModelsAndUsage(true)}
                          title={`Actualizar límites y modelos de ${activeSpec.shortName}`}
                          className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-300 hover:text-white transition-colors shrink-0 cursor-pointer rounded px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-white/60"
                        >
                          <span className="tabular-nums">{usageSummary.headline}</span>
                          <RefreshCw
                            className={`w-3 h-3 text-zinc-500 ${loadingModels ? "animate-spin" : ""}`}
                          />
                        </button>
                      </div>
                      <progress
                        className="xook-usage-progress"
                        value={
                          usageSummary.hasMeterBar
                            ? Math.max(0, Math.min(100, usageSummary.pct))
                            : usageSummary.connected
                              ? 100
                              : 0
                        }
                        max={100}
                        aria-label={`${usageSummary.tierLabel}: ${usageSummary.headline}`}
                        style={{
                          ["--xook-progress-fill" as string]:
                            accountUsage && !accountUsage.ok
                              ? "rgba(244, 63, 94, 0.8)"
                              : usageSummary.meterMode === "used"
                                ? usageSummary.pct >= 85
                                  ? "rgba(251, 191, 36, 0.9)"
                                  : "rgba(244, 244, 245, 0.85)"
                                : usageSummary.meterMode === "remaining"
                                  ? usageSummary.pct <= 15
                                    ? "rgba(244, 63, 94, 0.85)"
                                    : "rgba(110, 231, 183, 0.85)"
                                  : "rgba(212, 212, 216, 0.45)",
                        }}
                      />
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-zinc-400">
                        <span className="truncate">{usageSummary.detail}</span>
                        <button
                          type="button"
                          onClick={() => openAiSettings(hasAnyConfiguredKey ? "models" : "account")}
                          className="px-2 py-0.5 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.09] text-zinc-200 hover:text-white font-medium shrink-0 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
                        >
                          {hasAnyConfiguredKey ? "Proveedores" : "Conectar"}
                        </button>
                      </div>
                    </div>

                    {/* Capacidad de memoria del chat actual */}
                    <div
                      className="pt-2 border-t border-white/[0.06]"
                      title={`Modelo activo: ${activeModel.name} (${formatTokenCount(totalActiveTokens)} de ${formatContextLength(modelContextWindow)} tokens en uso)`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] mb-1.5">
                        <span className="text-zinc-300 font-medium truncate">
                          Memoria de conversación
                        </span>
                        <span className="text-zinc-200 font-mono text-[10.5px] tabular-nums shrink-0">
                          {contextUsagePct <= 1 ? "Disponible" : `${contextUsagePct}% en uso`}
                        </span>
                      </div>
                      <div
                        className="w-full bg-white/[0.07] h-1 rounded-full overflow-hidden"
                        role="progressbar"
                        aria-label="Memoria de conversación"
                        aria-valuenow={contextUsagePct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-300 bg-zinc-300"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(totalActiveTokens > 0 ? 3 : 0, contextUsagePct)
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-zinc-500">
                        <span className="truncate">Asistente: {activeModel.name}</span>
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
                onOpenFile={(rel) => void openWorkspaceFile(rel)}
                onPreviewPdf={(file) =>
                  void openPdfInRightPanel({
                    path: file.relativePath,
                    title: file.pdfSummary?.title || file.name,
                    filename: file.name,
                    pageCount: file.pdfSummary?.page_count,
                    sizeBytes: file.sizeBytes,
                  })
                }
                onOpenInDocumentViewer={(file, editMode) =>
                  handleOpenWorkspaceFileInViewer(file, editMode)
                }
                onAskXoxAnalyzeFile={handleAskXoxAnalyzeFile}
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
                </div>
              ) : (
                <div
                  id="xook-sidebar-panel-chats"
                  role="tabpanel"
                  aria-labelledby="xook-sidebar-tab-chats"
                  className="flex-1 flex flex-col overflow-hidden"
                >
                  <div className="p-2.5 flex-1 overflow-y-auto space-y-1">
                    {conversations.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center px-5 py-10 space-y-3">
                        <div className="w-10 h-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-300">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-white">
                            Aún no tienes chats guardados
                          </p>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            Escribe tu primera consulta abajo. Cada conversación con Xox se guarda aquí automáticamente.
                          </p>
                        </div>
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
              <div className="px-3 py-2 border-t border-white/[0.06] bg-[#090a0e] text-[11px] text-zinc-400 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowLocalAuth(true)}
                  className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors truncate cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-white/60"
                  title="Configurar perfil de usuario local"
                >
                  <UserCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${
                      localUser ? "text-zinc-300" : "text-zinc-500"
                    }`}
                  />
                  <span className="truncate">
                    {localUser ? localUser.name : "Sin perfil local"}
                  </span>
                </button>
                <span className="text-zinc-400 font-medium flex items-center gap-1.5 shrink-0 truncate max-w-[140px]">
                  <Check
                    className={`w-3 h-3 shrink-0 ${
                      leftTab === "context"
                        ? workspaceOverview
                          ? "text-zinc-300"
                          : "text-zinc-500"
                        : "text-zinc-300"
                    }`}
                  />
                  <span className="truncate">
                    {leftTab === "context"
                      ? workspaceOverview?.active.name ?? "Espacio local"
                      : `${conversations.length} ${
                          conversations.length === 1 ? "chat" : "chats"
                        }`}
                  </span>
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

          {/* Barra mínima fija de acciones de conversación (sin título truncado de mensaje) */}
          {chatMessages.length > 0 && !(showLeftSidebar && leftTab === "chats") && (
            <div className="shrink-0 bg-[#060709]/95 backdrop-blur-md px-4 sm:px-6 z-10">
              <div className="max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto pt-2.5 pb-1 flex items-center justify-end gap-2">
                {!activeModel.is_free && accountUsage && !accountUsage.can_use_paid_models && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[9px] font-medium shrink-0 mr-auto">
                    Requiere saldo
                  </span>
                )}
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
            <div className="max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto space-y-6">

              {/* ========================================================================= */}
              {/* 1. XOX DIGITAL COMPANION (HERO EN ESTADO VACÍO / COMPACTO EN CHAT)      */}
              {/* ========================================================================= */}
              {chatMessages.length === 0 ? (
                <div className="min-h-[calc(100vh-18rem)] flex flex-col items-center justify-center py-2 text-center">
                  {/* Estrella Xox: protagonista en el Home (~20% más grande); hit-target solo sobre la estrella */}
                  <div className="relative flex flex-col items-center justify-center select-none pointer-events-none -mt-8 -mb-10 sm:-mt-10 sm:-mb-14 lg:-mb-16">
                    <XoxStar
                      state={xoxState}
                      responsive
                      hitArea="star"
                      className="w-[308px] h-[308px] sm:w-[384px] sm:h-[384px] lg:w-[408px] lg:h-[408px] xl:w-[456px] xl:h-[456px]"
                      summonTrigger={summonSeq}
                      onClick={handleXoxClick}
                    />

                    {/* Burbuja de saludo Liquid Glass (solo al hacer clic sobre la estrella Xox) */}
                    {greeting && (
                      <div
                        role="status"
                        aria-live="polite"
                        className={`xox-bubble absolute left-[60%] bottom-[69%] z-20 pointer-events-none ${
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

                  {/* Saludo Humano Amplio y Protagonista (espacio reservado fijo para evitar saltos verticales) */}
                  <div className="relative z-10 space-y-2.5 max-w-2xl px-4 flex flex-col items-center">
                    <h1 className="text-2xl sm:text-3xl lg:text-[34px] font-semibold leading-tight text-white tracking-tight select-text">
                      {localUser
                        ? `Hola ${localUser.name.split(" ")[0]}, ¿en qué puedo ayudarte?`
                        : "¿En qué puedo ayudarte?"}
                    </h1>

                    <div className="min-h-[28px] flex items-center justify-center">
                      {xoxStatusPresence.mounted ? (
                        <div
                          className={`${
                            isXoxStatusOpen ? "toast-in" : "toast-out pointer-events-none"
                          } inline-flex items-center gap-2 text-xs`}
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
                            className={
                              displayXoxStatus.busy
                                ? "xox-shimmer font-medium"
                                : displayXoxStatus.state === "alert"
                                ? "text-red-300"
                                : "text-zinc-300"
                            }
                          >
                            {displayXoxStatus.message}
                          </p>
                        </div>
                      ) : !hasAnyConfiguredKey ? (
                        <button
                          type="button"
                          onClick={() => openAiSettings("account")}
                          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 underline-offset-4 hover:underline transition-colors cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Conectar proveedor de IA</span>
                        </button>
                      ) : conversations.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleSelectConversation(conversations[0])}
                          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                          title="Retomar tu última conversación guardada"
                        >
                          <MessageSquare className="w-3 h-3 text-zinc-500" />
                          <span className="truncate max-w-[280px]">
                            Retomar: {conversations[0].title}
                          </span>
                        </button>
                      ) : null}
                    </div>
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
                    onPreviewPdf={(pdf) => void openPdfInRightPanel(pdf, "view")}
                    onEditPdf={(pdf) => void openPdfInRightPanel(pdf, "edit_page")}
                    onDownloadPdf={(pdf) => void handleDownloadPdfFromChat(pdf)}
                    onOpenPdf={(rel) => void openWorkspaceFile(rel)}
                    onRevealPdfFolder={(rel) => void openWorkspaceFolder(rel)}
                    modelCatalog={catalogModels}
                    onXoxClick={handleXoxClick}
                    onAction={handleChatAction}
                    onSaveInlineVaultKey={handleSaveInlineVaultKey}
                    onOpenAiVaultModal={(pid) => openAiSettings("account", pid ?? activeProvider)}
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
              <div
                className={`${
                  activeClarification || permissionItems.some((p) => p.state === "pending")
                    ? "h-80 sm:h-96"
                    : "h-44 sm:h-48"
                } shrink-0 transition-all`}
              />
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
            <div className="@container max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto pointer-events-auto">
              <div
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    setIsDraggingOverChat(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setIsDraggingOverChat(false);
                  }
                }}
                onDrop={(e) => {
                  if (e.dataTransfer?.files?.length) {
                    e.preventDefault();
                    setIsDraggingOverChat(false);
                    const dropped = Array.from(e.dataTransfer.files);
                    setAttachments((prev) => [...prev, ...dropped]);
                    triggerReadingPulse(
                      dropped.length === 1
                        ? `Leyendo ${dropped[0].name}...`
                        : `Leyendo ${dropped.length} archivos adjuntos...`
                    );
                  } else {
                    setIsDraggingOverChat(false);
                  }
                }}
                className={`liquid-glass-hero input-console rounded-2xl p-3 sm:p-3.5 relative group shadow-2xl transition-all ${
                  inputExpanded ? "is-expanded" : ""
                } ${isDraggingOverChat ? "ring-1 ring-white/30 border-white/25" : ""}`}
              >
                {/* Capa de recorte para los efectos de luz (los menús desplegables pueden sobresalir) */}
                <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                  {/* Reflejo especular superior tenue */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  {/* Barrido de luz de encendido */}
                  <span key={summonSeq} aria-hidden="true" className="console-sweep" />
                </div>

                {/* Bandeja acoplada al input para Permisos pendientes y Preguntas abiertas (estilo Antigravity / Claude Code) */}
                {(permissionItems.some((p) => p.state === "pending") || activeClarification) && (
                  <div className="mb-2.5 pb-2.5 border-b border-white/[0.08] space-y-2">
                    {permissionItems
                      .filter((p) => p.state === "pending")
                      .map((perm) => (
                        <CommandPermissionCard
                          key={perm.requestId}
                          item={perm}
                          docked
                          onResolve={(reqId, decision) =>
                            void handleResolvePermission(reqId, decision)
                          }
                        />
                      ))}

                    {activeClarification && (
                      <ClarificationInputDock
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
                    )}
                  </div>
                )}

                {/* Formulario Principal de Entrada */}
                <form onSubmit={handlePromptSubmit} className="space-y-2.5">
                  {/* Archivos adjuntos */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-1">
                      {attachments.map((f, i) => {
                        const attKind = classifyAttachmentFile(f);
                        return (
                          <span
                            key={`${f.name}-${i}`}
                            className="toast-in inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1 py-1 rounded-lg bg-white/[0.06] border border-white/[0.1] text-zinc-200 max-w-[220px]"
                          >
                            {attKind === "pdf" ? (
                              <FileText className="w-3 h-3 text-rose-300 shrink-0" />
                            ) : attKind === "image" ? (
                              <ImageIcon className="w-3 h-3 text-sky-300 shrink-0" />
                            ) : (
                              <Paperclip className="w-3 h-3 text-zinc-400 shrink-0" />
                            )}
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
                        );
                      })}
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
                      title="Adjuntar archivos (PDF, imágenes, CSV, texto...)"
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
                      onPaste={(e) => {
                        const pastedFiles = Array.from(e.clipboardData?.files ?? []);
                        if (pastedFiles.length > 0) {
                          e.preventDefault();
                          setAttachments((prev) => [...prev, ...pastedFiles]);
                          triggerReadingPulse(
                            pastedFiles.length === 1
                              ? `Imagen o archivo adjuntado (${pastedFiles[0].name || "portapapeles"})...`
                              : `${pastedFiles.length} archivos pegados...`
                          );
                        }
                      }}
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
                          : isDraggingOverChat
                          ? "Suelta tu PDF, imagen o archivo aquí..."
                          : "Escribe a Xox (o arrastra PDFs e imágenes)..."
                      }
                      className="input-bubble flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1.5 px-1 font-normal leading-relaxed disabled:opacity-50 select-text"
                    />

                    {/* Desplegable de modelos */}
                    <div ref={modelMenuRef} className="relative shrink-0 mb-0.5">
                      <button
                        ref={modelTriggerRef}
                        type="button"
                        onClick={() => {
                          setShowContextMenu(false);
                          setShowModelMenu((v) => !v);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={showModelMenu}
                        className="quick-liquid-btn h-8 inline-flex items-center gap-1.5 pl-2.5 pr-2.5 rounded-full text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                      >
                        <ProviderIcon provider={activeProvider} size={13} className="text-white/85 shrink-0" />
                        <span className="hidden @sm:inline truncate max-w-[160px]">{activeModel.name}</span>
                        <ChevronDown className={`w-3 h-3 text-white/65 transition-transform ${showModelMenu ? "rotate-180" : ""}`} />
                      </button>
                      {modelMenuPresence.mounted && (
                        <div
                          role="listbox"
                          aria-label="Modelos disponibles"
                          onKeyDown={(e) =>
                            handleListboxKeyDown(
                              e,
                              () => setShowModelMenu(false),
                              modelTriggerRef.current
                            )
                          }
                          className={`xook-liquid-menu ${
                            showModelMenu ? "menu-in" : "menu-out pointer-events-none"
                          } absolute right-0 bottom-full mb-2 w-80 overflow-hidden p-1.5 rounded-2xl z-30`}
                        >
                          <LiquidGlassBackdrop variant="menu" />

                          <div className="relative z-[1]">
                            <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-white/[0.08] mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <ProviderIcon provider={activeProvider} size={12} className="text-zinc-200 shrink-0" />
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300/85 truncate">
                                  {activeSpec.shortName} ({availableQuickModels.length})
                                </span>
                                {activeProvider === "openrouter" && !canUsePaidModels && (
                                  <span className="quick-liquid-chip px-1.5 py-0.5 rounded-full text-[9px] font-medium text-zinc-300/90 shrink-0">
                                    {aiConfig.hasApiKey ? "Sin saldo · gratis" : "Gratis"}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {availableQuickModels.length > 4 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandModelMenu((prev) => !prev);
                                    }}
                                    aria-expanded={expandModelMenu}
                                    title={expandModelMenu ? "Contraer lista de modelos" : "Ver más modelos"}
                                    className="inline-flex items-center gap-0.5 h-6 px-2 rounded-full text-[10px] font-medium text-sky-200/85 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                                  >
                                    <span>{expandModelMenu ? "Menos" : "Más"}</span>
                                    <ChevronDown
                                      className={`w-3 h-3 transition-transform duration-200 ${
                                        expandModelMenu ? "rotate-180" : ""
                                      }`}
                                    />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void refreshModelsAndUsage(true);
                                  }}
                                  aria-label={`Actualizar catálogo y estado de ${activeSpec.shortName}`}
                                  title={`Actualizar catálogo y estado de ${activeSpec.shortName}`}
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-300/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
                                >
                                  <RefreshCw className={`w-3 h-3 ${loadingModels ? "animate-spin" : ""}`} />
                                </button>
                              </div>
                            </div>

                            {unavailableModelIds.size > 0 && (
                              <div className="quick-liquid-subcard mx-1 mb-1.5 px-2.5 py-1.5 rounded-xl text-[10.5px] text-zinc-200/90 leading-snug">
                                Se ocultaron {unavailableModelIds.size} modelo(s) que devolvieron error o límite.
                              </div>
                            )}

                            <div
                              className={`xook-expand-list ${
                                expandModelMenu ? "max-h-80" : "max-h-56"
                              } overflow-y-auto space-y-0.5 pr-0.5`}
                            >
                              {availableQuickModels.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  role="option"
                                  aria-selected={m.id === modelId}
                                  onClick={() => void handleSelectModel(m.id)}
                                  className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer ${
                                    m.id === modelId ? "is-selected" : ""
                                  }`}
                                >
                                  <span className="min-w-0">
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-white truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]">
                                      <span className="truncate">{m.name}</span>
                                      {m.is_free ? (
                                        <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9px] font-medium text-zinc-200/90 shrink-0">
                                          gratis
                                        </span>
                                      ) : typeof m.prompt_price_per_million === "number" &&
                                        m.prompt_price_per_million > 0 ? (
                                        <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9px] font-mono text-zinc-300/90 shrink-0 tabular-nums">
                                          {formatPricePerMillion(m.prompt_price_per_million)}/1M
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="block text-[10.5px] text-zinc-300/75 truncate [text-shadow:0_1px_3px_rgba(4,8,18,0.6)]">
                                      {m.hint}
                                    </span>
                                  </span>
                                  {m.id === modelId && (
                                    <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                      <Check className="w-2.5 h-2.5 text-white" />
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>

                            <div className="mt-1.5 pt-1.5 border-t border-white/[0.08] space-y-1">
                              {hasAnyConfiguredKey && (
                                <div className="px-2.5 py-1 space-y-1">
                                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-zinc-300/85">
                                    <span className="truncate">{usageSummary.tierLabel}</span>
                                    <span className="font-mono text-zinc-100 shrink-0 tabular-nums">
                                      {usageSummary.headline}
                                    </span>
                                  </div>
                                  {usageSummary.hasMeterBar && (
                                    <progress
                                      className="xook-usage-progress"
                                      value={Math.max(0, Math.min(100, usageSummary.pct))}
                                      max={100}
                                      aria-label={`${usageSummary.tierLabel}: ${usageSummary.headline}`}
                                      style={{
                                        ["--xook-progress-fill" as string]:
                                          usageSummary.meterMode === "used"
                                            ? usageSummary.pct >= 85
                                              ? "rgba(251, 191, 36, 0.9)"
                                              : "rgba(244, 244, 245, 0.8)"
                                            : usageSummary.pct <= 15
                                              ? "rgba(244, 63, 94, 0.85)"
                                              : "rgba(110, 231, 183, 0.85)",
                                      }}
                                    />
                                  )}
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowModelMenu(false);
                                  openAiSettings("models");
                                }}
                                className="quick-liquid-option w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-[11px] font-medium text-zinc-100/90 hover:text-white cursor-pointer"
                              >
                                <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                  <KeyRound className="w-2.5 h-2.5 text-white/85" />
                                </span>
                                <span>Proveedores, tarifas y respaldo…</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={(!inputPrompt.trim() && attachments.length === 0) || isChatStreaming}
                      className={`shrink-0 mb-0.5 w-8 h-8 rounded-full flex items-center justify-center ${
                        (!inputPrompt.trim() && attachments.length === 0) || isChatStreaming
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
                        ref={contextTriggerRef}
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
                        <AtSign className="w-3 h-3 text-white/75 shrink-0" />
                        <span className="hidden @xs:inline">Contexto</span>
                        {activeContextCount > 0 && (
                          <span className="text-[10px] font-mono text-zinc-100 tabular-nums">
                            {activeContextCount}
                          </span>
                        )}
                        <ChevronDown className={`w-3 h-3 text-white/65 transition-transform ${showContextMenu ? "rotate-180" : ""}`} />
                      </button>

                      {contextMenuPresence.mounted && (
                        <div
                          role="listbox"
                          aria-label="Contexto disponible"
                          aria-multiselectable="true"
                          onKeyDown={(e) =>
                            handleListboxKeyDown(
                              e,
                              () => setShowContextMenu(false),
                              contextTriggerRef.current
                            )
                          }
                          className={`xook-liquid-menu menu-origin-left ${
                            showContextMenu ? "menu-in" : "menu-out pointer-events-none"
                          } absolute left-0 bottom-full mb-2 w-60 p-1.5 rounded-2xl z-30`}
                        >
                          <LiquidGlassBackdrop variant="menu" />

                          <div className="relative z-[1] space-y-0.5">
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
                                  className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer ${
                                    isInPrompt ? "is-selected" : ""
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span className="quick-liquid-icon w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0">
                                      <ContextIcon type={item.type} className="w-3 h-3 text-white/85" />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-xs font-medium text-white truncate">{friendlyLabel}</span>
                                      <span className="block text-[10px] text-zinc-300/75 font-mono truncate">{item.name}</span>
                                    </span>
                                  </span>
                                  {isInPrompt && (
                                    <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                      <Check className="w-2.5 h-2.5 text-white" />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
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
              onExportPdf={isTauriEnv ? handleExportCanvasPdf : undefined}
              onClose={() => setShowCanvas(false)}
            />
          </div>
        )}

        {/* PANEL DEDICADO DEL VISOR Y EDITOR DE DOCUMENTOS (INDEPENDIENTE DE TAREAS) */}
        {docViewerPresence.mounted && (pdfPanelState || pdfDraftProgress) && (
          <div
            className={`w-[46%] min-w-[360px] max-w-[680px] shrink-0 bg-[#060709] border-l border-white/[0.07] p-2.5 overflow-hidden transition-opacity duration-200 ${
              docViewerPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <PdfWorkspacePanel
              state={pdfPanelState}
              draftProgress={pdfDraftProgress}
              onClose={() => {
                setShowDocViewer(false);
                setPdfPanelState(null);
                setPdfDraftProgress(null);
              }}
              onOpenExternal={(rel) => void openWorkspaceFile(rel)}
              onRevealInFolder={(rel) => void openWorkspaceFolder(rel)}
              onLoadMorePages={(rel, nextStart) => void handleLoadMorePdfPages(rel, nextStart)}
              onReloadPreview={(rel) => {
                if (pdfPanelState?.fileKind === "office") {
                  void openUniversalDocInRightPanel({
                    path: rel,
                    filename: pdfPanelState.filename || rel.split("/").pop() || "Documento",
                    sizeBytes: pdfPanelState.sizeBytes,
                    ext: pdfPanelState.fileExtension,
                  });
                } else {
                  void openPdfInRightPanel({
                    path: rel,
                    title: pdfPanelState?.title,
                    filename: pdfPanelState?.filename,
                    pageCount: pdfPanelState?.pageCount,
                    sizeBytes: pdfPanelState?.sizeBytes,
                    hasCover: pdfPanelState?.hasCover,
                    theme: pdfPanelState?.theme,
                  });
                }
              }}
              onAskXoxAboutPdf={(_rel, title) => {
                setInputPrompt((prev) =>
                  prev.trim() ? prev : `Sobre el documento "${title}": `
                );
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              onSendXoxDocumentInstruction={(payload) => {
                const modeDesc =
                  payload.mode === "append_pages"
                    ? `Agrega más páginas al final del PDF "${payload.path}" (usando pdf_generate con source_pdf_path="${payload.path}", edit_action="append_pages" y theme="${payload.theme || "executive"}" para conservar exactamente la misma tipografía, diseño, encabezados y numeración continua)`
                    : `Modifica el documento "${payload.path}" (usando pdf_generate con source_pdf_path="${payload.path}", edit_action="modify" y theme="${payload.theme || "executive"}" conservando su misma tipografía y diseño)`;
                void runPromptQuery(`${modeDesc}: ${payload.instruction}`);
              }}
              onPdfUpdated={(updated) => {
                setPdfPanelState((curr) =>
                  curr
                    ? {
                        ...curr,
                        path: updated.path,
                        title: updated.title,
                        theme: updated.theme,
                        pageCount: updated.pageCount,
                        sizeBytes: updated.sizeBytes,
                        pages: updated.pages,
                        hasMore: updated.hasMore,
                        isLoadingPages: false,
                        error: null,
                      }
                    : null
                );
                void handleRefreshWorkspace();
              }}
              onSaveTextFile={async (rel, newContent) => {
                await handleSaveWorkspaceFile(rel, newContent);
                setPdfPanelState((curr) =>
                  curr
                    ? {
                        ...curr,
                        textContent: newContent,
                        sizeBytes: new Blob([newContent]).size,
                      }
                    : null
                );
              }}
              onExportTextToPdf={handleExportTextDocumentToPdf}
              onStatusNotice={(msg) => {
                setStatusMessage(msg);
                setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 4000);
              }}
            />
          </div>
        )}

        {/* ========================================================================= */}
        {/* COLUMNA 3: TAREAS Y DECISIONES DEL LADO DERECHO (EXCLUSIVA PARA TAREAS)   */}
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
              className={`sidebar-slot flex flex-col shrink-0 overflow-hidden bg-[#08090d] ${
                isResizingRight ? "is-resizing" : ""
              } ${rightPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <div className="flex-1 min-h-0 flex">
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
            </div>
          </>
        )}

      </div>

      <OpenRouterSettingsModal
        isOpen={showAiSettings}
        initialTab={aiSettingsTab}
        initialProvider={aiSettingsProvider}
        config={aiConfig}
        accountUsage={accountUsage}
        usageLedger={usageLedger}
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
          if (usage?.ok && (usage.can_use_paid_models || normalizeProviderIdClient(aiConfig.provider) !== "openrouter")) {
            setUnavailableModelIds(new Set());
          }
        }}
        onLedgerUpdated={setUsageLedger}
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
          "Mi Espacio"
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