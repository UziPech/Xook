import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  HelpCircle,
  Monitor,
  ScanSearch,
  Send,
  Settings,
  Shield,
  Sparkles,
  Star,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  ActiveModeChip,
  SlashCommandMenu,
  XOX_COMMAND_LIST,
  XOX_COMMAND_SPECS,
  type XoxModeId,
} from "./SlashCommandMenu";
import { XoxDragMotion, XoxStar, XoxState, resolveXoxAccentPreset, type XoxAccentPreset, type XoxTerminalFeed } from "./XoxStar";
import {
  getGlobalXoxProfile,
  subscribeGlobalXoxProfile,
} from "../features/xox-studio/xoxStudioApi";
import { QuickLiquidLayer } from "./QuickLiquidLayer";
import { JellyPillTrack } from "./JellyPillTrack";
import { ComposerAttachmentTray } from "./ComposerAttachmentTray";
import { AttachmentPreviewDialog } from "./AttachmentPreviewDialog";
import {
  type AttachmentPreviewTarget,
  type ComposerAttachmentItem,
  type ComposerPastedTextAttachment,
  composeLlmMessageWithPastedText,
  createComposerFileItems,
  createPastedTextItem,
  derivePastedCardTitle,
  extractClipboardPayload,
  normalizePastedText,
  prepareImagePayload,
  revokeComposerAttachments,
  shouldGroupPastedText,
} from "../features/ai-service/composerAttachments";
import { MarkdownContent, renderInlineMarkdown } from "../utils/markdownRenderer";
import { getQuickBarPlaceholder } from "../utils/xoxGreetings";
import { useAnimatedPresence } from "../hooks/useAnimatedPresence";
import {
  CanvasArtifact,
  canvasHasCellData,
  cleanVisibleReply,
  extractFirstHtmlTable,
  extractFirstMarkdownTable,
  markdownTableToCanvasArtifact,
  sanitizeCanvasArtifact,
} from "../features/canvas/canvasSchema";
import {
  LocalUserProfile,
  getLocalUserProfile,
  subscribeLocalUserUpdated,
} from "../features/workspace-store/localStore";
import { ProviderIcon } from "../features/ai-service/ProviderIcon";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  AiUsageLedger,
  AttachedContextItem,
  ChatTurnMessage,
  ClarificationSpec,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  computeProviderUsageSummary,
  detectApiKeyInText,
  detectVaultConfigRequest,
  extractErrorMessage,
  fetchOpenRouterModels,
  formatModelDisplay,
  formatPricePerMillion,
  getAiConfigStatus,
  getAiUsageLedger,
  getAvailableQuickModels,
  getLocalDailyRequestCount,
  getProviderSpec,
  getUsageMeterFillColor,
  incrementLocalDailyRequestCount,
  isStreamCancelledError,
  cancelXoxAiChatStream,
  loadWorkspaceContext,
  normalizeProviderIdClient,
  onAiUsageUpdated,
  runXoxAiChatStream,
  saveAiConfig,
  testAiConnection,
} from "../features/ai-service/aiClient";
import {
  listAgendaItems,
  listTasks,
  upsertTasksBatch,
} from "../features/task-decisions/ledgerApi";
import { ClarificationForm } from "../features/ai-service/ClarificationModal";
import {
  type LiveScreenCapturePayload,
  type ScreenReaderStatus,
  captureScreenContextNow,
  clearScreenMemory,
  getScreenReaderStatus,
  isWorkspaceTauriRuntime,
  openScreenPermissionSettings,
  requestScreenPermission,
  resolveCommandPermission,
  setScreenReaderConfig,
  stageWorkspaceAttachment,
  subscribePermissionEvents,
  subscribeScreenContext,
} from "../features/workspace-store/workspaceApi";
import {
  CommandPermissionCard,
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "../features/ai-service/CommandPermissionCard";
import {
  appendReplyDeltaToTimeline,
  applyCommandFinishedInTimeline,
  finalizeChatTimeline,
  groupTimelineForRender,
  hasTimelineCommands,
  markPermissionErrorInTimeline,
  resolvePermissionInTimeline,
  timelineHasRequestId,
  upsertPermissionRequestInTimeline,
  type ChatTimelineSegment,
} from "@xook/contracts";

const DRAG_THRESHOLD_PX = 4;

const QUICK_OFFICE_INSPECT_EXT_SET = new Set([
  "pdf",
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
  "csv",
  "tsv",
]);

async function quickFileToBase64Payload(file: File): Promise<string> {
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

type Spring = { x: number; v: number };

const stepSpring = (s: Spring, target: number, k: number, c: number, dt: number) => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "textarea, input, button, select, a, [role='listbox'], [role='menu'], [role='option'], [data-no-drag='true']"
    )
  );
}

function resolveQuickPreviewCanvas(
  rawCanvas: CanvasArtifact | null | undefined,
  rawText: string | null | undefined,
  fallbackTitle: string
): CanvasArtifact | null {
  const sanitized = rawCanvas ? sanitizeCanvasArtifact(rawCanvas) : null;
  if (sanitized && sanitized.columns.length > 0 && sanitized.rows.length > 0 && canvasHasCellData(sanitized)) {
    return sanitized;
  }
  if (rawText) {
    const inlineTbl = extractFirstMarkdownTable(rawText) ?? extractFirstHtmlTable(rawText);
    if (inlineTbl && inlineTbl.rows.length > 0) {
      return markdownTableToCanvasArtifact(inlineTbl, {
        title: sanitized?.title || fallbackTitle || "Tabla rápida",
        subtitle: sanitized?.subtitle,
        summary: sanitized?.summary,
      });
    }
  }
  return null;
}

function isExplicitScreenReadIntent(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text) return false;
  return /\b(lee(r)?(\s+(la|mi|esta))?\s+pantalla|qu[eé]\s+(ves|hay|dice|aparece|tengo)(\s+en\s+(la|mi)?\s*pantalla|\s+aqu[ií]|\s+abierto)?|mira(\s+(la|mi))?\s*(pantalla|esto|aqu[ií])|analiza(\s+(la|mi))?\s*(pantalla|ventana)|explica(me)?\s+(esto|lo\s+de\s+mi\s+pantalla|la\s+pantalla)|revisa(\s+(la|mi))?\s*(pantalla|ventana)|captura\s+de\s+pantalla|ay[úu]dame\s+con\s+(esto|esta\s+ventana|lo\s+que\s+tengo\s+abierto)|what(?:'s| is)\s+on\s+(?:my\s+)?screen|read\s+(?:my\s+)?screen)\b/i.test(
    text
  );
}

export const QuickBar: React.FC = () => {
  const [summonSeq, setSummonSeq] = useState<number>(1);
  const [isQuickVisible, setIsQuickVisible] = useState<boolean>(
    () => !(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
  );
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [settleSeq, setSettleSeq] = useState<number>(0);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [quickAttachments, setQuickAttachments] = useState<ComposerAttachmentItem[]>([]);
  const quickAttachmentsRef = useRef<ComposerAttachmentItem[]>(quickAttachments);
  quickAttachmentsRef.current = quickAttachments;
  const [quickPreviewTarget, setQuickPreviewTarget] =
    useState<AttachmentPreviewTarget | null>(null);
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [xoxTerminalFeed, setXoxTerminalFeed] = useState<XoxTerminalFeed | null>(null);
  const [statusNote, setStatusNote] = useState<string>("");
  const [reply, setReply] = useState<string | null>(null);
  const [quickTimeline, setQuickTimeline] = useState<ChatTimelineSegment[]>([]);
  const [quickCanvas, setQuickCanvas] = useState<CanvasArtifact | null>(null);
  const [pendingClarification, setPendingClarification] = useState<ClarificationSpec | null>(null);
  const [permissionItems, setPermissionItems] = useState<CommandPermissionUiItem[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [inputExpanded, setInputExpanded] = useState<boolean>(false);
  const [tableScrolled, setTableScrolled] = useState<boolean>(false);

  useEffect(() => {
    setTableScrolled(false);
  }, [summonSeq, reply === null, quickCanvas === null]);
  const [localUser, setLocalUser] = useState<LocalUserProfile | null>(null);
  const [quickActiveMode, setQuickActiveMode] = useState<XoxModeId | null>(null);
  const [showCommandMenu, setShowCommandMenu] = useState<boolean>(false);
  const [commandMenuFilter, setCommandMenuFilter] = useState<string>("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState<number>(0);
  const quickActiveModeSpec = quickActiveMode ? XOX_COMMAND_SPECS[quickActiveMode] : null;
  const filteredCommands = useMemo(() => {
    const cleanFilter = commandMenuFilter.replace(/^\//, "").trim().toLowerCase();
    if (!cleanFilter) return XOX_COMMAND_LIST;
    return XOX_COMMAND_LIST.filter(
      (cmd) =>
        cmd.slash.toLowerCase().includes(cleanFilter) ||
        cmd.id.toLowerCase().includes(cleanFilter) ||
        cmd.name.toLowerCase().includes(cleanFilter) ||
        cmd.description.toLowerCase().includes(cleanFilter)
    );
  }, [commandMenuFilter]);
  const quickPlaceholder = useMemo(() => {
    if (quickActiveModeSpec && !isStreaming) {
      return quickActiveModeSpec.inputPlaceholder;
    }
    return getQuickBarPlaceholder({
      isStreaming,
      userName: localUser?.name,
      seed: summonSeq,
    });
  }, [quickActiveModeSpec, isStreaming, localUser?.name, summonSeq]);
  const [modelId, setModelId] = useState<string>(OPENROUTER_PRESET_MODELS[0].id);
  const [aiConfig, setAiConfig] = useState<AiConfigStatus>({
    provider: "openrouter",
    modelId: OPENROUTER_PRESET_MODELS[0].id,
    hasApiKey: false,
    maskedKey: null,
    keySource: "none",
    customModels: [],
  });
  const activeProvider = normalizeProviderIdClient(aiConfig.provider);
  const activeSpec = getProviderSpec(activeProvider);
  const [accountUsage, setAccountUsage] = useState<AiConnectionTestResult | null>(null);
  const [usageLedger, setUsageLedger] = useState<AiUsageLedger | null>(null);
  const [liveCatalog, setLiveCatalog] = useState<OpenRouterModelOption[]>([]);
  const [unavailableModelIds, setUnavailableModelIds] = useState<Set<string>>(() => new Set());
  const [showModels, setShowModels] = useState<boolean>(false);
  const [expandModels, setExpandModels] = useState<boolean>(false);
  const [screenStatus, setScreenStatus] = useState<ScreenReaderStatus | null>(null);
  const [attachLiveScreen, setAttachLiveScreen] = useState<boolean>(false);
  const [showScreenMenu, setShowScreenMenu] = useState<boolean>(false);
  const [liveScreenBadge, setLiveScreenBadge] = useState<string | null>(null);
  const [screenPermissionNeeded, setScreenPermissionNeeded] = useState<boolean>(false);
  const [quickAccentPreset, setQuickAccentPreset] = useState<XoxAccentPreset>("classic");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const screenMenuRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const quickHistoryRef = useRef<ChatTurnMessage[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const suppressNextXoxClickRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  isStreamingRef.current = isStreaming;
  const activeStreamIdRef = useRef<string | null>(null);
  const quickAbortControllerRef = useRef<AbortController | null>(null);
  const accountUsageRef = useRef<AiConnectionTestResult | null>(null);
  accountUsageRef.current = accountUsage;
  const catalogLoadingRef = useRef<boolean>(false);
  const cachedSelectedModelRef = useRef<OpenRouterModelOption | null>(null);
  const lastPromptRef = useRef<string>("");
  const lastCanvasRef = useRef<CanvasArtifact | null>(null);
  const lastReplyRef = useRef<string | null>(null);
  const activeQuickTimelineRef = useRef<ChatTimelineSegment[]>([]);
  const lastTimelineRef = useRef<ChatTimelineSegment[]>([]);
  const lastCanvasDisplayRef = useRef<CanvasArtifact | null>(null);
  const lastClarificationDisplayRef = useRef<ClarificationSpec | null>(null);
  const lastStatusNoteRef = useRef<string>("");

  if (reply) lastReplyRef.current = reply;
  if (quickTimeline.length > 0) lastTimelineRef.current = quickTimeline;
  if (quickCanvas) lastCanvasDisplayRef.current = quickCanvas;
  if (pendingClarification) lastClarificationDisplayRef.current = pendingClarification;
  if (statusNote) lastStatusNoteRef.current = statusNote;

  const xoxDragMotionRef = useRef<XoxDragMotion>({
    active: false,
    vx: 0,
    vy: 0,
    releaseVx: 0,
    releaseVy: 0,
  });

  const animStateRef = useRef({
    rafId: 0,
    running: false,
    lastTime: 0,
    x: { x: 0, v: 0 } as Spring,
    y: { x: 0, v: 0 } as Spring,
    rot: { x: 0, v: 0 } as Spring,
    scale: { x: 1, v: 0 } as Spring,
    // Desplazamiento acumulado en preview web sin runtime Tauri
    previewX: 0,
    previewY: 0,
  });

  const dragSessionRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    lastScreenX: number;
    lastScreenY: number;
    lastMoveAt: number;
    active: boolean;
    tauriMode: boolean;
    tauriReady: boolean;
    inFlight: boolean;
    pendingStep: boolean;
    ended: boolean;
  } | null>(null);

  const clearActionTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearActionTimers(), [clearActionTimers]);

  useEffect(() => {
    return () => {
      revokeComposerAttachments(quickAttachmentsRef.current);
    };
  }, []);

  const appendQuickFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const existingImgCount = quickAttachmentsRef.current.filter((a) => a.kind === "image").length;
    const created = createComposerFileItems(files, existingImgCount);
    setQuickAttachments((prev) => [...prev, ...created]);
    for (const item of created) {
      if (item.kind === "image") {
        void prepareImagePayload(item.file).then((prep) => {
          if (!prep.thumbUrl && !prep.imageDataUrl) return;
          setQuickAttachments((prev) =>
            prev.map((curr) =>
              curr.id === item.id && curr.kind === "image"
                ? {
                    ...curr,
                    thumbUrl: prep.thumbUrl ?? curr.thumbUrl,
                    imageDataUrl: prep.imageDataUrl ?? curr.imageDataUrl,
                    width: prep.width ?? curr.width,
                    height: prep.height ?? curr.height,
                  }
                : curr
            )
          );
        });
      }
    }
  }, []);

  const appendQuickPastedText = useCallback((rawText: string) => {
    const existingPasted = quickAttachmentsRef.current.filter(
      (a) => a.kind === "pasted_text"
    ).length;
    const item = createPastedTextItem(rawText, existingPasted);
    setQuickAttachments((prev) => [...prev, item]);
  }, []);

  const removeQuickAttachment = useCallback((id: string) => {
    setQuickAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokeComposerAttachments([target]);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const updateQuickPastedText = useCallback((id: string, nextContent: string) => {
    const { content, charCount, lineCount } = normalizePastedText(nextContent);
    setQuickAttachments((prev) =>
      prev.map((item, idx) =>
        item.id === id && item.kind === "pasted_text"
          ? {
              ...item,
              content,
              charCount,
              lineCount,
              name: derivePastedCardTitle(content, idx + 1),
            }
          : item
      )
    );
  }, []);

  const unwrapQuickPastedText = useCallback(
    (id: string, content: string) => {
      removeQuickAttachment(id);
      setInputPrompt((prev) => {
        const trimmedPrev = prev.trimEnd();
        return trimmedPrev ? `${trimmedPrev}\n\n${content}` : content;
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [removeQuickAttachment]
  );

  const inspectQuickAttachment = useCallback((item: ComposerAttachmentItem) => {
    if (item.kind === "image") {
      const src = item.objectUrl || item.imageDataUrl || item.thumbUrl;
      if (!src) return;
      setQuickPreviewTarget({
        kind: "image",
        id: item.id,
        name: item.name,
        src,
        width: item.width,
        height: item.height,
        sizeBytes: item.sizeBytes,
        removable: true,
      });
      return;
    }
    if (item.kind === "pasted_text") {
      setQuickPreviewTarget({
        kind: "pasted_text",
        id: item.id,
        name: item.name,
        content: item.content,
        charCount: item.charCount,
        lineCount: item.lineCount,
        editable: true,
      });
    }
  }, []);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    timersRef.current.push(t);
  }, []);

  const hideNow = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("hide_quick_bar");
    } catch {
      // Ignorar fuera de Tauri (preview en navegador)
    }
  }, []);

  const dismissGracefully = useCallback(() => {
    setShowModels(false);
    setShowScreenMenu(false);
    setIsLeaving(true);
    const t = setTimeout(() => {
      void hideNow();
    }, 145);
    timersRef.current.push(t);
  }, [hideNow]);

  const ensureCapsuleSpringRunning = useCallback(() => {
    const anim = animStateRef.current;
    if (anim.running) return;
    anim.running = true;
    anim.lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(Math.max((now - anim.lastTime) / 1000, 1 / 240), 1 / 30);
      anim.lastTime = now;

      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const motion = xoxDragMotionRef.current;

      // Decaimiento exponencial suave de la velocidad si el cursor se detiene brevemente en el aire
      const decay = Math.exp(-11 * dt);
      if (motion.active && !dragSessionRef.current?.active) {
        // Durante glide programático (recentrado), la velocidad llega por evento
      } else {
        motion.vx *= decay;
        motion.vy *= decay;
      }

      const active = motion.active;
      const targetX = !reduced && active ? clamp(-motion.vx * 0.0085, -11, 11) : 0;
      const targetY = !reduced && active ? clamp(-motion.vy * 0.007 - 2.0, -10, 8) : 0;
      const targetRot = !reduced && active ? clamp(motion.vx * 0.0022, -2.5, 2.5) : 0;
      const targetScale = !reduced && active ? 1.018 : 1;

      const k = active ? 240 : 260;
      const c = active ? 22 : 17;
      const ks = active ? 250 : 320;
      const cs = active ? 21 : 19;

      stepSpring(anim.x, targetX, k, c, dt);
      stepSpring(anim.y, targetY, k, c, dt);
      stepSpring(anim.rot, targetRot, k, c, dt);
      stepSpring(anim.scale, targetScale, ks, cs, dt);

      const el = capsuleRef.current;
      if (el) {
        const totalX = anim.previewX + anim.x.x;
        const totalY = anim.previewY + anim.y.x;
        const atRest =
          !active &&
          Math.abs(anim.x.x) < 0.02 &&
          Math.abs(anim.x.v) < 0.05 &&
          Math.abs(anim.y.x) < 0.02 &&
          Math.abs(anim.y.v) < 0.05 &&
          Math.abs(anim.rot.x) < 0.01 &&
          Math.abs(anim.rot.v) < 0.05 &&
          Math.abs(anim.scale.x - 1) < 0.0005 &&
          Math.abs(anim.scale.v) < 0.002;

        if (atRest && anim.previewX === 0 && anim.previewY === 0) {
          el.style.transform = "";
          anim.x = { x: 0, v: 0 };
          anim.y = { x: 0, v: 0 };
          anim.rot = { x: 0, v: 0 };
          anim.scale = { x: 1, v: 0 };
          anim.running = false;
          anim.rafId = 0;
          return;
        }

        el.style.transform = `translate(${totalX.toFixed(2)}px, ${totalY.toFixed(
          2
        )}px) rotate(${anim.rot.x.toFixed(2)}deg) scale(${anim.scale.x.toFixed(4)})`;

        if (atRest) {
          anim.x = { x: 0, v: 0 };
          anim.y = { x: 0, v: 0 };
          anim.rot = { x: 0, v: 0 };
          anim.scale = { x: 1, v: 0 };
          anim.running = false;
          anim.rafId = 0;
          return;
        }
      }

      anim.rafId = requestAnimationFrame(tick);
    };

    anim.rafId = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      const anim = animStateRef.current;
      if (anim.rafId) cancelAnimationFrame(anim.rafId);
      anim.running = false;
    };
  }, []);

  const triggerSettleImpulse = useCallback(
    (releaseVx: number, releaseVy: number) => {
      const motion = xoxDragMotionRef.current;
      motion.active = false;
      motion.releaseVx = releaseVx;
      motion.releaseVy = releaseVy;
      motion.vx = 0;
      motion.vy = 0;

      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        const anim = animStateRef.current;
        // Micro-overshoot en dirección del movimiento y suave compresión al aterrizar
        anim.x.v += clamp(releaseVx * 0.09, -95, 95);
        anim.y.v += clamp(releaseVy * 0.09 + 36, -80, 95);
        anim.scale.v -= 0.16;
        setSettleSeq((s) => s + 1);
      }

      ensureCapsuleSpringRunning();
    },
    [ensureCapsuleSpringRunning]
  );

  const finishDragSession = useCallback(
    (pointerTarget?: HTMLElement | null, pointerId?: number) => {
      const session = dragSessionRef.current;
      if (!session || session.ended) return;
      session.ended = true;
      dragSessionRef.current = null;

      if (pointerTarget && typeof pointerId === "number") {
        try {
          if (pointerTarget.hasPointerCapture(pointerId)) {
            pointerTarget.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignorar si ya fue liberado
        }
      }

      if (!session.active) return;

      const releaseVx = xoxDragMotionRef.current.vx;
      const releaseVy = xoxDragMotionRef.current.vy;
      session.active = false;
      setIsDragging(false);
      triggerSettleImpulse(releaseVx, releaseVy);

      requestAnimationFrame(() => {
        suppressNextXoxClickRef.current = false;
      });

      if (session.tauriMode && session.tauriReady) {
        void (async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("end_quick_drag");
          } catch {
            // Ignorar fuera de Tauri
          }
        })();
      }
    },
    [triggerSettleImpulse]
  );

  const scheduleStepQuickDrag = useCallback(() => {
    const session = dragSessionRef.current;
    if (!session || !session.active || !session.tauriMode || !session.tauriReady) return;
    if (session.inFlight) {
      session.pendingStep = true;
      return;
    }

    session.inFlight = true;
    session.pendingStep = false;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("step_quick_drag");
      } catch {
        // Ignorar errores transitorios
      } finally {
        const cur = dragSessionRef.current;
        if (cur === session) {
          session.inFlight = false;
          if (session.pendingStep && session.active && !session.ended) {
            scheduleStepQuickDrag();
          }
        }
      }
    })();
  }, []);

  const resetPosition = useCallback(async () => {
    setShowModels(false);
    const anim = animStateRef.current;
    if (anim.previewX !== 0 || anim.previewY !== 0) {
      anim.x.x += anim.previewX;
      anim.y.x += anim.previewY;
      anim.previewX = 0;
      anim.previewY = 0;
      triggerSettleImpulse(0, 0);
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reset_quick_position");
    } catch {
      // Fallback fuera de Tauri
    }
  }, [triggerSettleImpulse]);

  const refreshQuickSession = useCallback(async () => {
    try {
      const [cfg, savedUser, scrStatus, ledger] = await Promise.all([
        getAiConfigStatus(),
        getLocalUserProfile().catch(() => null),
        getScreenReaderStatus().catch(() => null),
        getAiUsageLedger().catch(() => null),
      ]);
      setLocalUser(savedUser);
      setAiConfig(cfg);
      if (scrStatus) setScreenStatus(scrStatus);
      if (ledger) setUsageLedger(ledger);
      if (cfg.modelId) setModelId(cfg.modelId);
      if (cfg.hasApiKey) {
        if (!accountUsageRef.current) {
          void testAiConnection(cfg.provider).then((res) => {
            if (res.ok) setAccountUsage(res);
          });
        }
      } else {
        setAccountUsage(null);
      }
    } catch {
      // Ignora error de carga inicial de bóveda
    }
  }, []);

  const loadModelCatalog = useCallback(async () => {
    if (catalogLoadingRef.current) return;
    catalogLoadingRef.current = true;
    try {
      const res = await fetchOpenRouterModels(false, false, activeProvider);
      if (res.models.length > 0) setLiveCatalog(res.models);
    } finally {
      catalogLoadingRef.current = false;
    }
  }, [activeProvider]);

  // Libera el catálogo extenso cuando la Quick Bar se oculta para reducir memoria
  useEffect(() => {
    if (isQuickVisible || showModels || liveCatalog.length === 0) return;
    const t = setTimeout(() => {
      setLiveCatalog([]);
    }, 180);
    return () => clearTimeout(t);
  }, [isQuickVisible, showModels, liveCatalog.length]);

  useEffect(() => {
    const isTauriRuntime =
      typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

    if (!isTauriRuntime) {
      void refreshQuickSession();
      focusInput();
    }

    let cancelled = false;
    let unlistenSummon: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;
    let unlistenRecenter: (() => void) | undefined;
    let unlistenAiConfig: (() => void) | undefined;
    let unlistenAiUsage: (() => void) | undefined;

    void onAiUsageUpdated((ledger) => {
      if (!cancelled) setUsageLedger(ledger);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenAiUsage = fn;
    });

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        const u1 = await listen<{ seq: number }>("quick:summon", (event) => {
          clearActionTimers();
          dragSessionRef.current = null;
          setIsDragging(false);
          xoxDragMotionRef.current.active = false;
          setIsLeaving(false);
          setIsQuickVisible(true);
          setShowModels(false);
          setShowScreenMenu(false);
          setShowCommandMenu(false);
          setCommandMenuFilter("");
          setSummonSeq(event.payload?.seq ?? Date.now());
          void refreshQuickSession();
          focusInput();
        });
        if (cancelled) {
          u1();
          return;
        }
        unlistenSummon = u1;

        const u2 = await listen("quick:dismiss", () => {
          dragSessionRef.current = null;
          setIsDragging(false);
          xoxDragMotionRef.current.active = false;
          setShowModels(false);
          setShowScreenMenu(false);
          setShowCommandMenu(false);
          setCommandMenuFilter("");
          setIsLeaving(true);
        });
        if (cancelled) {
          u2();
          return;
        }
        unlistenDismiss = u2;

        const u3 = await listen("quick:hidden", () => {
          clearActionTimers();
          dragSessionRef.current = null;
          setIsDragging(false);
          xoxDragMotionRef.current.active = false;
          const anim = animStateRef.current;
          if (anim.rafId) {
            cancelAnimationFrame(anim.rafId);
            anim.rafId = 0;
          }
          anim.running = false;
          if (capsuleRef.current && anim.previewX === 0 && anim.previewY === 0) {
            capsuleRef.current.style.transform = "";
          }
          setShowModels(false);
          setShowScreenMenu(false);
          setIsLeaving(false);
          setIsQuickVisible(false);
          setLiveCatalog([]);
        });
        if (cancelled) {
          u3();
          return;
        }
        unlistenHidden = u3;

        const u4 = await listen<{ phase: "step" | "end"; vx: number; vy: number }>(
          "quick:recenter",
          (event) => {
            const { phase, vx, vy } = event.payload ?? {};
            if (phase === "step") {
              setIsDragging(true);
              xoxDragMotionRef.current.active = true;
              xoxDragMotionRef.current.vx = vx ?? 0;
              xoxDragMotionRef.current.vy = vy ?? 0;
              ensureCapsuleSpringRunning();
            } else {
              setIsDragging(false);
              triggerSettleImpulse(vx ?? 0, vy ?? 0);
            }
          }
        );
        if (cancelled) {
          u4();
          return;
        }
        unlistenRecenter = u4;

        const u5 = await listen<AiConfigStatus>("xox-ai-config-updated", (ev) => {
          if (!ev.payload) return;
          setAiConfig(ev.payload);
          if (ev.payload.modelId) setModelId(ev.payload.modelId);
          setLiveCatalog([]);
        });
        if (cancelled) {
          u5();
          return;
        }
        unlistenAiConfig = u5;

        const ready = await invoke<{ visible: boolean; seq: number }>("quick_bar_ready");
        if (cancelled) return;
        if (ready?.visible) {
          clearActionTimers();
          setIsLeaving(false);
          setIsQuickVisible(true);
          if (ready.seq) setSummonSeq(ready.seq);
          void refreshQuickSession();
          focusInput();
        }
      } catch {
        // Preview web sin runtime Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlistenSummon?.();
      unlistenDismiss?.();
      unlistenHidden?.();
      unlistenRecenter?.();
      unlistenAiConfig?.();
      unlistenAiUsage?.();
    };
  }, [
    clearActionTimers,
    ensureCapsuleSpringRunning,
    focusInput,
    refreshQuickSession,
    triggerSettleImpulse,
  ]);

  useEffect(() => {
    return subscribeScreenContext((st) => {
      setScreenStatus(st);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsub: (() => void) | null = null;
    void subscribeLocalUserUpdated((profile) => {
      if (!disposed) {
        setLocalUser(profile);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unsub = fn;
    });
    return () => {
      disposed = true;
      unsub?.();
    };
  }, []);

  const quickPermissionHandlersRef = useRef<{
    onRequest: (req: Parameters<typeof applyPermissionRequestItem>[1]) => void;
    onFinished: (ev: Parameters<typeof applyCommandFinishedEvent>[1]) => void;
  }>({
    onRequest: () => {},
    onFinished: () => {},
  });

  quickPermissionHandlersRef.current = {
    onRequest: (req) => {
      if (!activeStreamIdRef.current || req.streamId !== activeStreamIdRef.current) {
        return;
      }
      setPermissionItems((prev) => applyPermissionRequestItem(prev, req));
      const nextTimeline = upsertPermissionRequestInTimeline(
        activeQuickTimelineRef.current,
        req
      );
      activeQuickTimelineRef.current = nextTimeline;
      setQuickTimeline(nextTimeline);
    },
    onFinished: (ev) => {
      const matchesActiveStream = Boolean(
        ev.streamId &&
          activeStreamIdRef.current &&
          ev.streamId === activeStreamIdRef.current
      );
      if (
        ev.streamId &&
        (!activeStreamIdRef.current || ev.streamId !== activeStreamIdRef.current)
      ) {
        setPermissionItems((prev) => applyCommandFinishedEvent(prev, ev));
        if (timelineHasRequestId(activeQuickTimelineRef.current, ev.requestId)) {
          const nextTimeline = applyCommandFinishedInTimeline(
            activeQuickTimelineRef.current,
            ev
          );
          activeQuickTimelineRef.current = nextTimeline;
          setQuickTimeline(nextTimeline);
        }
        return;
      }
      setPermissionItems((prev) =>
        applyCommandFinishedEvent(prev, ev, { allowInsert: matchesActiveStream })
      );
      const nextTimeline = applyCommandFinishedInTimeline(
        activeQuickTimelineRef.current,
        ev,
        { allowInsert: matchesActiveStream }
      );
      activeQuickTimelineRef.current = nextTimeline;
      setQuickTimeline(nextTimeline);
    },
  };

  useEffect(() => {
    return subscribePermissionEvents({
      onRequest: (req) => quickPermissionHandlersRef.current.onRequest(req),
      onFinished: (ev) => quickPermissionHandlersRef.current.onFinished(ev),
    });
  }, []);

  const handleResolveQuickPermission = useCallback(
    async (requestId: string, decision: CommandPermissionDecisionKind) => {
      setPermissionItems((prev) =>
        applyPermissionResolution(prev, requestId, decision)
      );
      if (timelineHasRequestId(activeQuickTimelineRef.current, requestId)) {
        const nextTimeline = resolvePermissionInTimeline(
          activeQuickTimelineRef.current,
          requestId,
          decision
        );
        activeQuickTimelineRef.current = nextTimeline;
        setQuickTimeline(nextTimeline);
      }
      try {
        await resolveCommandPermission(requestId, decision);
      } catch (err) {
        const errText = extractErrorMessage(err, "No se pudo enviar tu decisión.");
        setPermissionItems((prev) =>
          prev.map((item) =>
            item.requestId === requestId
              ? {
                  ...item,
                  state: "error",
                  error: errText,
                }
              : item
          )
        );
        if (timelineHasRequestId(activeQuickTimelineRef.current, requestId)) {
          const nextTimeline = markPermissionErrorInTimeline(
            activeQuickTimelineRef.current,
            requestId,
            errText
          );
          activeQuickTimelineRef.current = nextTimeline;
          setQuickTimeline(nextTimeline);
        }
      }
    },
    []
  );

  // Garantiza cierre limpio del arrastre si la ventana pierde el foco abruptamente
  useEffect(() => {
    const handleBlur = () => {
      finishDragSession(capsuleRef.current, dragSessionRef.current?.pointerId);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [finishDragSession]);

  useEffect(() => {
    let active = true;
    void getGlobalXoxProfile()
      .then((prof) => {
        if (active) setQuickAccentPreset(resolveXoxAccentPreset(prof.accentPreset));
      })
      .catch(() => {});
    let unsub = () => {};
    void subscribeGlobalXoxProfile((prof) => {
      if (active) setQuickAccentPreset(resolveXoxAccentPreset(prof.accentPreset));
    }).then((fn) => {
      unsub = fn;
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Auto-altura suave del textarea estilo burbuja (1 a 4 líneas)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const prevHeight = el.style.height || `${el.offsetHeight || 32}px`;
    el.style.height = "auto";
    const nextPx = Math.min(Math.max(el.scrollHeight, 32), 108);
    el.style.height = prevHeight;
    void el.offsetHeight;
    el.style.height = `${nextPx}px`;
    setInputExpanded(nextPx > 44);
  }, [inputPrompt, summonSeq]);

  const openInMainWorkspace = useCallback(async () => {
    const typedPrompt = inputPrompt.trim();
    const promptToSend = lastPromptRef.current || typedPrompt || null;
    const rawReply = reply?.trim() ? reply : null;
    const directCanvas = lastCanvasRef.current ?? quickCanvas;
    const sanitizedDirect = directCanvas ? sanitizeCanvasArtifact(directCanvas) : null;
    const rawCanvas =
      sanitizedDirect && canvasHasCellData(sanitizedDirect)
        ? sanitizedDirect
        : resolveQuickPreviewCanvas(
            directCanvas,
            rawReply,
            promptToSend || "Tabla rápida"
          );
    const hasTabularQuick = Boolean(
      rawCanvas && rawCanvas.columns.length > 0 && rawCanvas.rows.length > 0
    );
    const responseToSend = rawReply
      ? cleanVisibleReply(rawReply, { stripTables: hasTabularQuick }) || rawReply
      : rawCanvas
        ? `Listo, preparé "${rawCanvas.title}" en Canvas.`
        : null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_main_workspace", {
        payload: {
          prompt: promptToSend,
          autoRun: Boolean(!responseToSend && !rawCanvas && typedPrompt),
          responseText: responseToSend,
          canvas: rawCanvas ?? null,
        },
      });
    } catch {
      // Ignorar fuera de Tauri
    }
  }, [inputPrompt, reply, quickCanvas]);

  // Escape oculta menús, desactiva el modo activo (cuando está vacío) o cierra la Quick Bar; ⌘↩ abre XOOK completo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void openInMainWorkspace();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (showCommandMenu) {
          setShowCommandMenu(false);
          setCommandMenuFilter("");
        } else if (showScreenMenu) {
          setShowScreenMenu(false);
        } else if (showModels) {
          setShowModels(false);
        } else if (quickActiveMode && !inputPrompt.trim()) {
          setQuickActiveMode(null);
          inputRef.current?.focus();
        } else {
          dismissGracefully();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    dismissGracefully,
    inputPrompt,
    openInMainWorkspace,
    quickActiveMode,
    showCommandMenu,
    showModels,
    showScreenMenu,
  ]);

  // Cerrar menús flotantes al hacer clic fuera
  useEffect(() => {
    if (!showModels && !showScreenMenu && !showCommandMenu) return;
    const onDown = (e: MouseEvent) => {
      if (showModels && modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModels(false);
      }
      if (showScreenMenu && screenMenuRef.current && !screenMenuRef.current.contains(e.target as Node)) {
        setShowScreenMenu(false);
      }
      if (showCommandMenu && commandMenuRef.current && !commandMenuRef.current.contains(e.target as Node)) {
        setShowCommandMenu(false);
        setCommandMenuFilter("");
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showCommandMenu, showModels, showScreenMenu]);

  const runQuickPrompt = async (overridePrompt?: string) => {
    const rawTyped = (
      typeof overridePrompt === "string" ? overridePrompt : inputPrompt
    ).trim();
    const currentQuickAttachments =
      typeof overridePrompt === "string" ? [] : quickAttachmentsRef.current;

    let effectiveQuickMode: XoxModeId | null = quickActiveMode;
    let cleanedTyped = rawTyped;
    const inlineCmdMatch = rawTyped.match(/^(\/[a-zA-Z]+)(?:\s+(.*))?$/s);
    if (inlineCmdMatch) {
      const matchedCmd = XOX_COMMAND_LIST.find(
        (c) => c.slash.toLowerCase() === inlineCmdMatch[1].toLowerCase()
      );
      if (matchedCmd) {
        effectiveQuickMode = matchedCmd.id;
        cleanedTyped = (inlineCmdMatch[2] ?? "").trim();
        setQuickActiveMode(matchedCmd.id);
        if (!cleanedTyped && currentQuickAttachments.length === 0) {
          setInputPrompt("");
          setShowCommandMenu(false);
          setCommandMenuFilter("");
          inputRef.current?.focus();
          return;
        }
      }
    }

    if ((!cleanedTyped && currentQuickAttachments.length === 0) || isStreamingRef.current) return;

    const effectiveModeSpec = effectiveQuickMode ? XOX_COMMAND_SPECS[effectiveQuickMode] : null;
    const pastedItems = currentQuickAttachments.filter(
      (a): a is ComposerPastedTextAttachment => a.kind === "pasted_text"
    );
    const fileItems = currentQuickAttachments.filter(
      (a): a is Exclude<ComposerAttachmentItem, ComposerPastedTextAttachment> =>
        a.kind !== "pasted_text"
    );
    const text = composeLlmMessageWithPastedText(
      cleanedTyped,
      pastedItems,
      fileItems.map((f) => ({ name: f.name, kind: f.kind }))
    );

    clearActionTimers();
    setShowModels(false);
    setShowScreenMenu(false);
    setShowCommandMenu(false);
    setCommandMenuFilter("");
    setLiveScreenBadge(null);
    setScreenPermissionNeeded(false);
    if (typeof overridePrompt !== "string") {
      setInputPrompt("");
      setQuickAttachments([]);
    }
    setReply(null);
    setQuickTimeline([]);
    activeQuickTimelineRef.current = [];
    lastTimelineRef.current = [];
    setQuickCanvas(null);
    setPendingClarification(null);
    lastPromptRef.current = cleanedTyped || text;
    lastCanvasRef.current = null;
    lastReplyRef.current = null;
    lastCanvasDisplayRef.current = null;
    lastClarificationDisplayRef.current = null;

    // Zero-Trust: bloquear envío de claves API pegadas desde Quick Bar
    const { detectedKey, maskedKey, detectedProvider } = detectApiKeyInText(text);
    if (detectedKey && maskedKey) {
      revokeComposerAttachments(currentQuickAttachments);
      const targetSpec = detectedProvider ? getProviderSpec(detectedProvider) : null;
      setXoxState("alert");
      setStatusNote("");
      setReply(
        `Detecté una clave API${targetSpec ? ` de ${targetSpec.shortName}` : ""} (${maskedKey}) y la retuve localmente sin enviarla a internet. Abre XOOK (⌘↩) y pégala en el chat o en Ajustes > Bóveda para guardarla cifrada.`
      );
      const t = setTimeout(() => setXoxState("idle"), 2600);
      timersRef.current.push(t);
      return;
    }

    const vaultReq =
      pastedItems.length === 0 && rawTyped
        ? detectVaultConfigRequest(rawTyped)
        : { isVaultRequest: false, intentKind: "open_vault" as const, providerHint: null };
    if (vaultReq.isVaultRequest) {
      const targetPid = vaultReq.providerHint ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      const targetSlot = aiConfig.configuredProviders?.[targetPid];
      if (vaultReq.intentKind === "switch_provider" && targetSlot?.hasApiKey) {
        try {
          const nextModel = targetSlot.modelId || targetSpec.defaultModelId;
          const updated = await saveAiConfig({
            provider: targetPid,
            modelId: nextModel,
          });
          setAiConfig(updated);
          setModelId(nextModel);
          setXoxState("success");
          setStatusNote("");
          setReply(
            `Listo, cambié el proveedor activo a ${targetSpec.name} (${targetSlot.maskedKey ?? "clave guardada"}).`
          );
          const t = setTimeout(() => setXoxState("idle"), 2600);
          timersRef.current.push(t);
          return;
        } catch {
          // Continúa con guía local
        }
      }
      setXoxState("idle");
      setStatusNote("");
      setReply(
        `Para guardar tu API key de ${targetSpec.name} (${targetSpec.keyPrefixHint}) en la bóveda local cifrada, abre XOOK (⌘↩) y pídelo en el chat (aparecerá el recuadro seguro Zero-Trust ahí mismo) o entra a Ajustes > Conexión IA.`
      );
      return;
    }

    setPermissionItems([]);
    setQuickTimeline([]);
    activeQuickTimelineRef.current = [];
    setIsStreaming(true);
    setXoxState("reading");
    setStatusNote("Leyendo contexto...");

    const READING_MIN_MS = 500;
    const TALKING_MIN_MS = 950;
    const readingStartedAt = performance.now();
    let talkingStartedAt = 0;
    let latestPhase: XoxState = "reading";
    let hasEnteredTalking = false;

    try {
      const latestCfg = await getAiConfigStatus();
      setAiConfig(latestCfg);
      const latestBackupConfigured =
        latestCfg.autoFailover !== false &&
        Object.values(latestCfg.configuredProviders ?? {}).some((p) => p.hasApiKey);
      if (!latestCfg.hasApiKey && !latestBackupConfigured) {
        setIsStreaming(false);
        setXoxState("idle");
        setStatusNote("");
        setReply(
          "Aún no hay ningún proveedor de IA conectado. Abre XOOK (⌘↩) para configurar tus claves o tarifas."
        );
        return;
      }

      incrementLocalDailyRequestCount(latestCfg.maskedKey);
      const wantsLiveScreen = attachLiveScreen || isExplicitScreenReadIntent(text);
      const [workspaceSources, currentTasks, agendaItems] = await Promise.all([
        loadWorkspaceContext().catch(() => []),
        listTasks("pending").catch(() => []),
        listAgendaItems().catch(() => []),
      ]);
      const extraAttached: AttachedContextItem[] = workspaceSources.slice(0, 3).map((src) => ({
        name: src.name,
        type: src.type,
        content: src.content.slice(0, 1500),
      }));

      if (fileItems.length > 0) {
        const canStageWorkspace = isWorkspaceTauriRuntime();
        const quickFileSnippets = await Promise.all(
          fileItems.map(async (item): Promise<AttachedContextItem | null> => {
            if (item.kind === "image") {
              const imgPrep =
                item.imageDataUrl
                  ? {
                      imageDataUrl: item.imageDataUrl,
                      width: item.width,
                      height: item.height,
                    }
                  : await prepareImagePayload(item.file);
              const dimText =
                imgPrep.width && imgPrep.height ? ` (${imgPrep.width}×${imgPrep.height}px)` : "";
              return {
                name: item.name,
                type: item.mimeType || "image/png",
                kind: "image",
                mimeType: item.mimeType || "image/png",
                sizeBytes: item.sizeBytes,
                width: imgPrep.width,
                height: imgPrep.height,
                imageDataUrl: imgPrep.imageDataUrl,
                content: `Imagen adjunta '${item.name}'${dimText}.`,
              };
            }

            const ext = item.name.split(".").pop()?.toLowerCase() || "";
            const isInspectableDoc =
              item.kind === "pdf" || QUICK_OFFICE_INSPECT_EXT_SET.has(ext);
            const shouldStageFile =
              canStageWorkspace &&
              item.file.size > 0 &&
              item.file.size <= 25 * 1024 * 1024 &&
              (item.kind === "pdf" ||
                item.kind === "binary" ||
                (isInspectableDoc && effectiveQuickMode === "inspector"));

            let stagedPath: string | undefined;
            let stagedMime =
              item.mimeType ||
              (item.kind === "pdf" ? "application/pdf" : "application/octet-stream");
            if (shouldStageFile) {
              try {
                const b64 = await quickFileToBase64Payload(item.file);
                const staged = await stageWorkspaceAttachment(item.name, b64);
                stagedPath = staged.relativePath;
                stagedMime = staged.mimeType || stagedMime;
              } catch {
                stagedPath = undefined;
              }
            }

            if (isInspectableDoc && (stagedPath || item.kind !== "text")) {
              const kb = Math.max(1, Math.round(item.sizeBytes / 1024));
              const fmtTag = ext ? `.${ext}` : item.kind;
              const content = stagedPath
                ? effectiveQuickMode === "inspector"
                  ? `Documento (${fmtTag}) adjunto guardado en '${stagedPath}' (${kb} KB). Estás en modo /inspector: usa 'document_inspect_design' con path='${stagedPath}' para analizar su diseño visual y estructural, y guárdalo como habilidad reutilizable con 'document_save_design_skill'.`
                  : item.kind === "pdf"
                    ? `PDF adjunto guardado en '${stagedPath}' (${kb} KB). Usa SIEMPRE la herramienta 'pdf_read' con path='${stagedPath}' para leerlo.`
                    : `Documento Office (${fmtTag}) adjunto guardado en '${stagedPath}' (${kb} KB). Usa SIEMPRE la herramienta 'workspace_read' con path='${stagedPath}' para leerlo.`
                : `Documento (${fmtTag}) adjunto '${item.name}' (${kb} KB).`;
              return {
                name: item.name,
                type: stagedMime,
                kind: item.kind === "pdf" ? "pdf" : "binary",
                workspacePath: stagedPath,
                mimeType: stagedMime,
                sizeBytes: item.sizeBytes,
                content,
              };
            }

            if (item.kind === "text" && item.file.size <= 131072) {
              try {
                const raw = await item.file.text();
                return {
                  name: item.name,
                  type: item.mimeType || "text/plain",
                  kind: "text",
                  workspacePath: stagedPath,
                  sizeBytes: item.sizeBytes,
                  content: raw.slice(0, 4000),
                };
              } catch {
                return null;
              }
            }
            return {
              name: item.name,
              type: stagedMime,
              kind: item.kind,
              workspacePath: stagedPath,
              mimeType: stagedMime,
              sizeBytes: item.sizeBytes,
              content: stagedPath
                ? `Archivo adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(item.sizeBytes / 1024))} KB).`
                : `Archivo adjunto '${item.name}'.`,
            };
          })
        );
        for (const snippet of quickFileSnippets) {
          if (snippet) extraAttached.unshift(snippet);
        }
        revokeComposerAttachments(currentQuickAttachments);
      }

      if (wantsLiveScreen) {
        setXoxState("reading");
        setStatusNote("Capturando pantalla...");
        const liveCap: LiveScreenCapturePayload | null = await captureScreenContextNow({
          includeImage: true,
          saveObservation: true,
        }).catch(() => null);

        if (liveCap && !liveCap.permissionGranted) {
          setScreenPermissionNeeded(true);
          setIsStreaming(false);
          setXoxState("alert");
          setStatusNote("Permiso de pantalla requerido");
          setReply(
            "Necesito tu autorización en Ajustes del Sistema > Grabación de Pantalla para leer lo que ves en tiempo real."
          );
          return;
        }
        if (liveCap?.blockedSensitive) {
          setIsStreaming(false);
          setXoxState("alert");
          setStatusNote("Lectura pausada por seguridad");
          setReply(
            `Pausé la lectura automáticamente porque hay contenido protegido en pantalla (${liveCap.sensitiveReason || "contraseña o sesión privada"}).`
          );
          return;
        }
        if (liveCap?.ok) {
          const surfaceTitle = liveCap.appName
            ? `${liveCap.appName}${liveCap.windowTitle ? ` · ${liveCap.windowTitle.slice(0, 32)}` : ""}`
            : "Pantalla actual";
          setLiveScreenBadge(surfaceTitle);
          setXoxState("thinking");
          setStatusNote(
            liveCap.appName
              ? `Vista lista (${liveCap.appName.slice(0, 18)})...`
              : "Vista lista · Analizando..."
          );
          extraAttached.unshift({
            name: `Pantalla actual (${surfaceTitle})`,
            type: liveCap.imageDataUrl ? "image" : "text",
            kind: liveCap.imageDataUrl ? "image" : "text",
            content: liveCap.text || liveCap.ocrText || liveCap.axText || "Vista capturada.",
            ...(liveCap.imageDataUrl
              ? { imageDataUrl: liveCap.imageDataUrl, mimeType: "image/jpeg" }
              : {}),
          });
        } else {
          setXoxState("thinking");
          setStatusNote(`Consultando ${activeModel.name}...`);
        }
      }

      const businessContextSnapshot = workspaceSources
        .map((src) => `- ${src.path} (${src.type}): ${src.content.slice(0, 600)}`)
        .join("\n")
        .slice(0, 3500);

      const messageForModel =
        effectiveModeSpec && effectiveQuickMode !== "compact"
          ? `${effectiveModeSpec.promptPrefix}\n\n${text}`
          : text;

      const quickAbortController = new AbortController();
      quickAbortControllerRef.current = quickAbortController;
      const res = await runXoxAiChatStream(
        {
          message: messageForModel,
          activeMode: effectiveQuickMode ?? undefined,
          history: quickHistoryRef.current.slice(-10),
          currentTasks,
          agendaItems,
          attachedContext: extraAttached,
          modelOverride: modelId,
          providerOverride: activeProvider,
          userProfile: localUser
            ? {
                name: localUser.name,
                storeName: localUser.storeName,
                role: localUser.role,
                ...(localUser.preferredName ? { preferredName: localUser.preferredName } : {}),
                ...(localUser.occupation ? { occupation: localUser.occupation } : {}),
                ...(localUser.workContext ? { workContext: localUser.workContext } : {}),
                ...(localUser.language ? { language: localUser.language } : {}),
                ...(localUser.timezone ? { timezone: localUser.timezone } : {}),
                ...(localUser.notes ? { notes: localUser.notes } : {}),
              }
            : null,
          businessContextSnapshot,
          activeCanvas: lastCanvasRef.current,
          sessionId: "quick_bar",
        },
        {
          signal: quickAbortController.signal,
          onStreamStart: (streamId) => {
            activeStreamIdRef.current = streamId;
          },
          onProviderFailover: (evt) => {
            const toSpec = getProviderSpec(evt.toProvider);
            setStatusNote(
              evt.notice || `Cambiando respaldo a ${toSpec.shortName}...`
            );
            if (evt.modelUsed) {
              setModelId(evt.modelUsed);
            }
          },
          onPhase: (phase, label) => {
            const afterCommand =
              activeQuickTimelineRef.current[activeQuickTimelineRef.current.length - 1]?.kind ===
              "command";
            if (phase === "coding" || (afterCommand && (phase === "reading" || phase === "thinking"))) {
              hasEnteredTalking = false;
            } else if (hasEnteredTalking && (phase === "reading" || phase === "thinking")) {
              return;
            }
            if (phase === "talking") {
              hasEnteredTalking = true;
              if (!talkingStartedAt) talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
              setStatusNote(label || "Respondiendo...");
              return;
            }
            if (phase === "thinking" && latestPhase === "reading") {
              const elapsed = performance.now() - readingStartedAt;
              const remaining = READING_MIN_MS - elapsed;
              if (remaining > 40) {
                const t = setTimeout(() => {
                  if (hasEnteredTalking || !isStreamingRef.current) return;
                  latestPhase = "thinking";
                  setXoxState("thinking");
                  setStatusNote(`Pensando (${activeModel.name})...`);
                }, remaining);
                timersRef.current.push(t);
                return;
              }
            }
            latestPhase = phase;
            setXoxState(phase);
            setStatusNote(
              label ||
                (phase === "syncing"
                  ? "Diseñando tabla en Canvas..."
                  : phase === "coding"
                    ? "Ejecutando código y terminal..."
                    : phase === "reading"
                      ? "Leyendo contexto..."
                      : `Consultando ${activeModel.name}...`)
            );
          },
          onTerminal: (termEvt) => {
            setXoxTerminalFeed((prev) => ({
              seq: (prev?.seq ?? 0) + 1,
              mode: termEvt.mode,
              status: termEvt.status,
              command: termEvt.command ?? termEvt.target,
              outputLines: termEvt.outputLines,
            }));
          },
          onSteps: (steps) => {
            if (hasEnteredTalking || !Array.isArray(steps) || steps.length === 0) return;
            const activeStep = [...steps].reverse().find((step) => step.status === "running");
            if (activeStep?.label) {
              setStatusNote(activeStep.label);
            }
          },
          onReasoningDelta: () => {
            if (!hasEnteredTalking && latestPhase !== "thinking") {
              latestPhase = "thinking";
              setXoxState("thinking");
              setStatusNote(`Pensando (${activeModel.name})...`);
            }
          },
          onReplyDelta: (delta) => {
            if (!hasEnteredTalking) {
              hasEnteredTalking = true;
              if (!talkingStartedAt) talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
              setStatusNote("Respondiendo...");
            }
            const nextTimeline = appendReplyDeltaToTimeline(
              activeQuickTimelineRef.current,
              delta
            );
            activeQuickTimelineRef.current = nextTimeline;
            setQuickTimeline(nextTimeline);
            setReply((prev) => `${prev ?? ""}${delta}`);
          },
          onCanvas: (canvas) => {
            lastCanvasRef.current = canvas;
            setQuickCanvas(canvas);
          },
        }
      );

      clearActionTimers();
      if (quickAbortControllerRef.current === quickAbortController) {
        quickAbortControllerRef.current = null;
      }
      activeStreamIdRef.current = null;
      if (res.tasks.length > 0) {
        void upsertTasksBatch(res.tasks, res.operation === "replace_tasks").catch(() => {});
      }
      if (res.canvas) {
        lastCanvasRef.current = res.canvas;
        setQuickCanvas(res.canvas);
      }
      if (res.clarification) {
        lastClarificationDisplayRef.current = res.clarification;
        setPendingClarification(res.clarification);
      }
      if (res.reply?.trim()) {
        quickHistoryRef.current = [
          ...quickHistoryRef.current.slice(-14),
          { role: "user", content: text },
          { role: "assistant", content: res.reply },
        ];
      }
      if (res.failoverNotice || (res.failoverEvents && res.failoverEvents.length > 0)) {
        const finalPid = res.providerUsed ? normalizeProviderIdClient(res.providerUsed) : activeProvider;
        void getAiConfigStatus().then((fresh) => {
          setAiConfig(fresh);
          if (fresh.modelId) setModelId(fresh.modelId);
        });
        void fetchOpenRouterModels(false, false, finalPid).then((catRes) => {
          if (catRes.models.length > 0) setLiveCatalog(catRes.models);
        });
      }
      void getAiUsageLedger().then(setUsageLedger).catch(() => {});
      const replyFinalText =
        res.failoverNotice && res.reply && !res.reply.includes(res.failoverNotice)
          ? `> *Respaldo automático:* ${res.failoverNotice}\n\n${res.reply}`
          : res.reply;
      const finalizedQuickTimeline =
        finalizeChatTimeline(activeQuickTimelineRef.current, replyFinalText, {
          failoverNotice: res.failoverNotice,
          cleanText: (raw) =>
            cleanVisibleReply(raw, {
              stripTables: Boolean(res.canvas && res.canvas.columns.length > 0 && res.canvas.rows.length > 0),
            }),
        }) ?? [];
      activeQuickTimelineRef.current = finalizedQuickTimeline;
      setQuickTimeline(finalizedQuickTimeline);
      setPermissionItems((prev) => prev.filter((p) => p.state === "pending"));
      setReply(replyFinalText);
      setIsStreaming(false);

      const finalMood: XoxState = res.xoxMood === "alert" ? "alert" : "success";
      const finishQuickMood = () => {
        setXoxState(finalMood);
        setStatusNote("");
        const idleTimer = setTimeout(() => {
          setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
        }, 2200);
        timersRef.current.push(idleTimer);
      };

      const talkElapsed = talkingStartedAt ? performance.now() - talkingStartedAt : 0;
      const talkWait = talkingStartedAt
        ? Math.max(0, TALKING_MIN_MS - talkElapsed)
        : res.reply.trim().length > 0
          ? TALKING_MIN_MS
          : 0;

      if (res.canvas) {
        setXoxState("syncing");
        setStatusNote("Tabla lista en Canvas...");
        const syncTimer = setTimeout(finishQuickMood, 750);
        timersRef.current.push(syncTimer);
      } else if (talkWait > 40) {
        setXoxState("talking");
        setStatusNote("Respondiendo...");
        const talkTimer = setTimeout(finishQuickMood, talkWait);
        timersRef.current.push(talkTimer);
      } else {
        finishQuickMood();
      }
    } catch (err) {
      clearActionTimers();
      const wasCancelled =
        isStreamCancelledError(err) || Boolean(quickAbortControllerRef.current?.signal.aborted);
      quickAbortControllerRef.current = null;
      activeStreamIdRef.current = null;
      const settledQuickTimeline =
        finalizeChatTimeline(activeQuickTimelineRef.current, "", {
          cancelled: true,
          cleanText: (raw) => cleanVisibleReply(raw, { stripTables: false }),
        }) ?? [];
      activeQuickTimelineRef.current = settledQuickTimeline;
      setQuickTimeline(settledQuickTimeline);
      setPermissionItems([]);
      setIsStreaming(false);
      if (wasCancelled) {
        setXoxState("idle");
        setStatusNote("Proceso detenido");
        const t = setTimeout(() => setStatusNote(""), 1800);
        timersRef.current.push(t);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      const errMsg = extractErrorMessage(err, "No se pudo obtener respuesta.");
      if (/saldo suficiente|402|cuota|no longer available/i.test(errMsg)) {
        setUnavailableModelIds((prev) => new Set(prev).add(modelId));
      }
      setXoxState("alert");
      setStatusNote("");
      const errorLine = `Error (${activeSpec.shortName}): ${errMsg}`;
      if (settledQuickTimeline.length > 0) {
        const withError = appendReplyDeltaToTimeline(settledQuickTimeline, `\n\n${errorLine}`);
        activeQuickTimelineRef.current = withError;
        setQuickTimeline(withError);
      }
      setReply(errorLine);
      const t = setTimeout(() => setXoxState("idle"), 2800);
      timersRef.current.push(t);
    }
  };

  const handleStopQuickGeneration = useCallback(() => {
    const controller = quickAbortControllerRef.current;
    const streamId = activeStreamIdRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    if (streamId) {
      void cancelXoxAiChatStream(streamId);
    }
  }, []);

  const handleCapsulePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;

    setShowModels(false);
    setShowScreenMenu(false);
    const now = performance.now();
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastScreenX: e.screenX,
      lastScreenY: e.screenY,
      lastMoveAt: now,
      active: false,
      tauriMode: true,
      tauriReady: false,
      inFlight: false,
      pendingStep: false,
      ended: false,
    };
  };

  const handleCapsulePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId || session.ended) return;

    if (e.buttons === 0 && session.active) {
      finishDragSession(e.currentTarget, e.pointerId);
      return;
    }

    const now = performance.now();

    if (!session.active) {
      const dist = Math.hypot(e.clientX - session.startClientX, e.clientY - session.startClientY);
      if (dist < DRAG_THRESHOLD_PX) return;

      session.active = true;
      session.lastScreenX = e.screenX;
      session.lastScreenY = e.screenY;
      session.lastMoveAt = now;
      suppressNextXoxClickRef.current = true;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignorar si no soporta captura
      }

      setIsDragging(true);
      xoxDragMotionRef.current.active = true;
      xoxDragMotionRef.current.vx = 0;
      xoxDragMotionRef.current.vy = 0;
      ensureCapsuleSpringRunning();

      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("begin_quick_drag");
          if (session.ended || dragSessionRef.current !== session) {
            await invoke("end_quick_drag");
            return;
          }
          session.tauriMode = true;
          session.tauriReady = true;
          scheduleStepQuickDrag();
        } catch {
          // Fallback visual en preview web sin runtime Tauri
          session.tauriMode = false;
          session.tauriReady = false;
        }
      })();
      return;
    }

    const dtMs = Math.max(now - session.lastMoveAt, 4);
    const dx = e.screenX - session.lastScreenX;
    const dy = e.screenY - session.lastScreenY;
    session.lastScreenX = e.screenX;
    session.lastScreenY = e.screenY;
    session.lastMoveAt = now;

    const instVx = (dx / dtMs) * 1000;
    const instVy = (dy / dtMs) * 1000;
    const motion = xoxDragMotionRef.current;
    motion.vx = motion.vx * 0.62 + instVx * 0.38;
    motion.vy = motion.vy * 0.62 + instVy * 0.38;

    if (session.tauriMode) {
      scheduleStepQuickDrag();
    } else {
      animStateRef.current.previewX += dx;
      animStateRef.current.previewY += dy;
    }
    ensureCapsuleSpringRunning();
  };

  const handleCapsulePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    finishDragSession(e.currentTarget, e.pointerId);
  };

  const quickUsageSummary = computeProviderUsageSummary({
    provider: activeProvider,
    aiConfig,
    accountUsage,
    usageLedger,
    requestsTodayFallback: getLocalDailyRequestCount(aiConfig.maskedKey),
    modelId,
  });

  const canUsePaidModels =
    activeProvider !== "openrouter" ? true : quickUsageSummary.canUsePaid;
  const modelOptions: OpenRouterModelOption[] = useMemo(
    () =>
      getAvailableQuickModels(
        liveCatalog,
        aiConfig.customModels,
        canUsePaidModels,
        unavailableModelIds,
        activeProvider
      ),
    [liveCatalog, aiConfig.customModels, canUsePaidModels, unavailableModelIds, activeProvider]
  );

  const activeModel: OpenRouterModelOption = useMemo(() => {
    const extra = cachedSelectedModelRef.current ? [cachedSelectedModelRef.current] : [];
    const resolved = formatModelDisplay(modelId, [
      ...liveCatalog,
      ...activeSpec.curatedModels,
      ...modelOptions,
      ...extra,
    ]);
    cachedSelectedModelRef.current = resolved;
    return resolved;
  }, [modelId, liveCatalog, activeSpec.curatedModels, modelOptions]);

  const isBusy =
    isStreaming ||
    xoxState === "thinking" ||
    xoxState === "reading" ||
    xoxState === "coding" ||
    xoxState === "syncing";
  const canSubmit =
    (Boolean(inputPrompt.trim()) || quickAttachments.length > 0) && !isStreaming;

  const modelsPresence = useAnimatedPresence(showModels, 150);
  const screenMenuPresence = useAnimatedPresence(showScreenMenu, 150);
  const commandMenuPresence = useAnimatedPresence(showCommandMenu, 150);
  const statusPresence = useAnimatedPresence(Boolean(statusNote), 190);
  const hasQuickResult = Boolean(
    reply ||
      quickCanvas ||
      pendingClarification ||
      permissionItems.length > 0 ||
      hasTimelineCommands(quickTimeline)
  );
  const replyPresence = useAnimatedPresence(hasQuickResult, 190);
  const displayReply = reply ?? lastReplyRef.current;
  const displayTimeline =
    quickTimeline.length > 0 ? quickTimeline : lastTimelineRef.current;
  const displayCanvas = quickCanvas ?? lastCanvasDisplayRef.current;
  const displayClarification = pendingClarification ?? lastClarificationDisplayRef.current;
  const displayStatusNote = statusNote || lastStatusNoteRef.current;

  const previewTableCanvas = useMemo(
    () =>
      resolveQuickPreviewCanvas(
        displayCanvas,
        displayReply,
        lastPromptRef.current || "Tabla rápida"
      ),
    [displayCanvas, displayReply]
  );

  const cleanedProseReply = useMemo(
    () =>
      displayReply
        ? cleanVisibleReply(displayReply, { stripTables: Boolean(previewTableCanvas) })
        : "",
    [displayReply, previewTableCanvas]
  );

  const hasQuickContent = hasQuickResult || quickAttachments.length > 0;

  useEffect(() => {
    if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) {
          await invoke("set_quick_state", {
            busy: isStreaming,
            hasContent: hasQuickContent,
          });
        }
      } catch {
        // Ignorar fuera de Tauri
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStreaming, hasQuickContent]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isDragging) {
          dismissGracefully();
        }
      }}
      className="w-screen h-screen bg-transparent flex items-start justify-center pt-5 px-5 select-none overflow-hidden"
    >
      {/* Envoltorio de entrada/salida independiente de la física de arrastre */}
      <div
        key={summonSeq}
        className={`w-full max-w-[740px] ${
          isLeaving ? "quick-capsule-out" : "quick-capsule-in"
        }`}
      >
        {/* Cápsula Liquid Glass minimalista */}
        <div
          ref={capsuleRef}
          onPointerDown={handleCapsulePointerDown}
          onPointerMove={handleCapsulePointerMove}
          onPointerUp={handleCapsulePointerUp}
          onPointerCancel={handleCapsulePointerUp}
          onLostPointerCapture={handleCapsulePointerUp}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
            if (droppedFiles.length > 0) {
              e.preventDefault();
              appendQuickFiles(droppedFiles);
              inputRef.current?.focus();
            }
          }}
          className={`quick-capsule-shell relative w-full rounded-[26px] px-4 py-2.5 ${
            inputExpanded || hasQuickResult || quickAttachments.length > 0 || Boolean(quickActiveMode)
              ? "is-expanded"
              : ""
          } ${isDragging ? "is-dragging cursor-grabbing" : "cursor-grab"} ${
            !isQuickVisible ? "is-paused" : ""
          }`}
        >
          {/* Capa líquida viva y destellos recortados (sin backdrop-filter ni blur CSS) */}
          <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
            <QuickLiquidLayer
              motionRef={xoxDragMotionRef}
              active={isQuickVisible && !isLeaving}
              busy={isBusy}
              dragging={isDragging}
            />

            <span aria-hidden="true" className="quick-starlight-sweep" />
            {settleSeq > 0 && (
              <span key={settleSeq} aria-hidden="true" className="quick-settle-sweep" />
            )}

            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="quick-glint quick-glint-1 absolute top-2.5 left-12 w-3 h-3 text-sky-200"
            >
              <path
                d="M12 1L14.3 9.7L23 12L14.3 14.3L12 23L9.7 14.3L1 12L9.7 9.7Z"
                fill="currentColor"
              />
            </svg>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="quick-glint quick-glint-2 absolute top-3 right-20 w-2.5 h-2.5 text-white"
            >
              <path
                d="M12 1L14.3 9.7L23 12L14.3 14.3L12 23L9.7 14.3L1 12L9.7 9.7Z"
                fill="currentColor"
              />
            </svg>
          </div>

          {/* Indicador superior minimalista para mover y doble clic para centrar */}
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              void resetPosition();
            }}
            title="Arrastra para mover · Doble clic para centrar"
            className="absolute inset-x-12 top-0 h-4 flex items-start justify-center pt-[5px] z-20 group/grip"
          >
            <span
              className={`h-[3px] rounded-full transition-all duration-200 ${
                isDragging
                  ? "w-12 bg-sky-100/80 shadow-[0_0_6px_rgba(224,242,254,0.45)]"
                  : "w-8 bg-white/[0.15] group-hover/grip:w-11 group-hover/grip:bg-sky-100/45"
              }`}
            />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runQuickPrompt();
            }}
            className="relative z-[1]"
          >
            <div className="flex items-center gap-3">
              {/* Mascota Xox (tocar celebra; arrastrar mueve la Quick Bar) */}
              <div className="shrink-0 -ml-1.5 -my-3.5">
                <XoxStar
                  state={xoxState}
                  size={82}
                  glassContrast
                  accentPreset={quickAccentPreset}
                  active={isQuickVisible && !isLeaving}
                  summonTrigger={summonSeq}
                  dragMotionRef={xoxDragMotionRef}
                  terminal={xoxTerminalFeed}
                  className={isDragging ? "!cursor-grabbing" : "!cursor-grab"}
                  onClick={() => {
                    if (suppressNextXoxClickRef.current) {
                      suppressNextXoxClickRef.current = false;
                      return;
                    }
                    if (isStreamingRef.current || isBusy) return;
                    setXoxState("success");
                    const t = setTimeout(() => setXoxState("idle"), 1800);
                    timersRef.current.push(t);
                  }}
                />
              </div>

              {/* Campo principal */}
              <div ref={commandMenuRef} className="relative flex-1 min-w-0">
                {statusPresence.mounted && displayStatusNote && (
                  <div
                    className={`flex items-center gap-1.5 mb-0.5 ${
                      statusNote ? "toast-in" : "toast-out pointer-events-none"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        xoxState === "thinking" || xoxState === "reading"
                          ? "bg-white/85 animate-ping"
                          : xoxState === "syncing"
                            ? "bg-white/80 animate-pulse"
                            : "bg-white/85"
                      }`}
                    />
                    <p
                      className={`text-[11px] truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.65)] ${
                        isBusy || xoxState === "talking"
                          ? "quick-shimmer font-medium"
                          : "text-zinc-200"
                      }`}
                    >
                      {displayStatusNote}
                    </p>
                  </div>
                )}

                {quickAttachments.length > 0 && (
                  <div className="mb-1" data-no-drag="true">
                    <ComposerAttachmentTray
                      items={quickAttachments}
                      onRemove={removeQuickAttachment}
                      onInspect={inspectQuickAttachment}
                      compact
                      disabled={isStreaming}
                    />
                  </div>
                )}

                {quickActiveModeSpec && (
                  <div className="mb-1 flex items-center" data-no-drag="true">
                    <ActiveModeChip
                      spec={quickActiveModeSpec}
                      compact
                      onDismiss={() => {
                        setQuickActiveMode(null);
                        inputRef.current?.focus();
                      }}
                    />
                  </div>
                )}

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputPrompt}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInputPrompt(val);

                    if (val.startsWith("/")) {
                      setShowModels(false);
                      setShowScreenMenu(false);
                      setShowCommandMenu(true);
                      setCommandMenuFilter(val);
                      setSelectedCommandIndex(0);
                    } else if (showCommandMenu) {
                      setShowCommandMenu(false);
                      setCommandMenuFilter("");
                    }

                    const matchSlash = val.match(/^(\/[a-zA-Z]+)\s+(.*)$/s);
                    if (matchSlash) {
                      const typedCmd = matchSlash[1].toLowerCase();
                      const rest = matchSlash[2];
                      const found = XOX_COMMAND_LIST.find(
                        (c) => c.slash.toLowerCase() === typedCmd
                      );
                      if (found) {
                        setQuickActiveMode(found.id);
                        setInputPrompt(rest);
                        setShowCommandMenu(false);
                        setCommandMenuFilter("");
                      }
                    }
                  }}
                  onPaste={(e) => {
                    const { files: pastedFiles, text: pastedText } = extractClipboardPayload(
                      e.clipboardData
                    );
                    if (pastedFiles.length > 0) {
                      e.preventDefault();
                      appendQuickFiles(pastedFiles);
                      return;
                    }
                    if (pastedText && shouldGroupPastedText(pastedText)) {
                      e.preventDefault();
                      appendQuickPastedText(pastedText);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (showCommandMenu) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (filteredCommands.length > 0) {
                          setSelectedCommandIndex((i) => (i + 1) % filteredCommands.length);
                        }
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        if (filteredCommands.length > 0) {
                          setSelectedCommandIndex(
                            (i) => (i - 1 + filteredCommands.length) % filteredCommands.length
                          );
                        }
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        if (
                          filteredCommands.length > 0 &&
                          selectedCommandIndex >= 0 &&
                          selectedCommandIndex < filteredCommands.length
                        ) {
                          e.preventDefault();
                          const chosen = filteredCommands[selectedCommandIndex];
                          setQuickActiveMode(chosen.id);
                          setInputPrompt("");
                          setShowCommandMenu(false);
                          setCommandMenuFilter("");
                          return;
                        }
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowCommandMenu(false);
                        setCommandMenuFilter("");
                        return;
                      }
                    }

                    if (e.key === "Backspace" && !inputPrompt && quickActiveMode) {
                      e.preventDefault();
                      setQuickActiveMode(null);
                      return;
                    }

                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                        return;
                      }
                      runQuickPrompt();
                    }
                  }}
                  disabled={isStreaming}
                  aria-label="Pregunta rápida a Xox"
                  placeholder={quickPlaceholder}
                  className="input-bubble w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-relaxed text-white placeholder:text-zinc-200/65 [text-shadow:0_1px_5px_rgba(4,8,18,0.68)] focus:outline-none py-1 cursor-text select-text disabled:opacity-50"
                />

                {commandMenuPresence.mounted && (
                  <SlashCommandMenu
                    isOpen={showCommandMenu}
                    placement="bottom"
                    filterQuery={commandMenuFilter}
                    selectedIndex={selectedCommandIndex}
                    onSelect={(cmd) => {
                      setQuickActiveMode(cmd.id);
                      setInputPrompt("");
                      setShowCommandMenu(false);
                      setCommandMenuFilter("");
                      inputRef.current?.focus();
                    }}
                    onClose={() => {
                      setShowCommandMenu(false);
                      setCommandMenuFilter("");
                      inputRef.current?.focus();
                    }}
                  />
                )}
              </div>

              {/* Inspector + Lectura de pantalla + Selector de modelo + Enviar (estilo Liquid Glass neumórfico) */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-pressed={quickActiveMode === "inspector"}
                  aria-label="Activar /inspector — Analizar diseño de PDF, Word o Excel"
                  title={
                    quickActiveMode === "inspector"
                      ? "Inspector de Diseño activo (PDF, Word, Excel) · Clic para desactivar"
                      : "Activar /inspector — Analizar diseño de PDF, Word o Excel"
                  }
                  onClick={() => {
                    setShowModels(false);
                    setShowScreenMenu(false);
                    setShowCommandMenu(false);
                    setCommandMenuFilter("");
                    setQuickActiveMode((prev) => (prev === "inspector" ? null : "inspector"));
                    inputRef.current?.focus();
                  }}
                  className={`group/inspector relative w-8 h-8 inline-flex items-center justify-center rounded-full text-white cursor-pointer ${
                    quickActiveMode === "inspector"
                      ? "quick-liquid-chip-active"
                      : "quick-liquid-btn"
                  }`}
                >
                  <ScanSearch
                    className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                      quickActiveMode === "inspector"
                        ? "text-white"
                        : "text-white/75 group-hover/inspector:text-white"
                    }`}
                  />
                  {quickActiveMode === "inspector" && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-white/90 pointer-events-none" />
                  )}
                </button>

                <div ref={screenMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModels(false);
                      setShowScreenMenu((v) => !v);
                    }}
                    aria-label="Opciones de lectura de pantalla"
                    aria-haspopup="menu"
                    aria-expanded={showScreenMenu}
                    title={
                      screenStatus?.permissionGranted === false
                        ? "Autorizar lectura de pantalla"
                        : attachLiveScreen
                          ? "Vista en vivo activa para el próximo mensaje"
                          : screenStatus?.rollingEnabled
                            ? `Memoria de pantalla activa (${screenStatus.retentionMinutes} min)`
                            : "Opciones de lectura de pantalla"
                    }
                    className={`group/eye relative w-8 h-8 inline-flex items-center justify-center rounded-full text-white cursor-pointer ${
                      attachLiveScreen
                        ? "quick-liquid-chip-active"
                        : "quick-liquid-btn"
                    }`}
                  >
                    <Eye
                      className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                        attachLiveScreen
                          ? "text-sky-200"
                          : screenStatus?.permissionGranted === false || screenStatus?.pausedSensitive
                            ? "text-amber-300/90"
                            : "text-white/75 group-hover/eye:text-white"
                      }`}
                    />
                    {(attachLiveScreen ||
                      screenStatus?.permissionGranted === false ||
                      screenStatus?.pausedSensitive ||
                      screenStatus?.rollingEnabled) && (
                      <span
                        className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full pointer-events-none ${
                          screenStatus?.permissionGranted === false || screenStatus?.pausedSensitive
                            ? "bg-amber-300"
                            : attachLiveScreen
                              ? "bg-sky-300"
                              : "bg-emerald-300/75"
                        }`}
                      />
                    )}
                  </button>

                  {screenMenuPresence.mounted && (
                    <div
                      role="menu"
                      className={`quick-liquid-menu ${
                        showScreenMenu ? "menu-in" : "menu-out pointer-events-none"
                      } menu-origin-top-right absolute right-0 top-full ${
                        inputExpanded || hasQuickResult ? "mt-2.5" : "mt-[30px]"
                      } w-72 overflow-hidden p-2 rounded-[20px] z-30`}
                    >
                      <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                        <QuickLiquidLayer
                          motionRef={xoxDragMotionRef}
                          active={isQuickVisible && !isLeaving && showScreenMenu}
                          busy={isBusy}
                          dragging={isDragging}
                        />
                      </div>
                      <div className="relative z-[1] space-y-1.5 [text-shadow:0_1px_4px_rgba(4,8,18,0.72)]">
                        <div className="px-2 py-1 flex items-center justify-between text-[10.5px] text-zinc-100/85">
                          <span className="inline-flex items-center gap-1.5 font-medium text-white">
                            <Monitor className="w-3 h-3 text-sky-200" />
                            <span>Lectura de pantalla</span>
                          </span>
                          <span className="text-[10px] text-zinc-100/80">
                            {screenStatus?.observationCount
                              ? `${screenStatus.observationCount} rec.`
                              : "En RAM"}
                          </span>
                        </div>
                        <div
                          aria-hidden="true"
                          className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                        />

                        {screenStatus?.permissionGranted === false && (
                          <div className="quick-liquid-subcard rounded-xl p-2 space-y-1.5 text-[11px] text-amber-100">
                            <div className="flex items-center gap-1.5 font-medium">
                              <Shield className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                              <span>Permiso de pantalla pendiente</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  void requestScreenPermission().then((st) => {
                                    if (st) setScreenStatus(st);
                                  });
                                }}
                                className="quick-liquid-chip-active flex-1 px-2.5 py-1 rounded-lg text-[10.5px] font-medium text-white cursor-pointer"
                              >
                                Autorizar
                              </button>
                              <button
                                type="button"
                                onClick={() => void openScreenPermissionSettings()}
                                className="quick-liquid-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] text-zinc-100 cursor-pointer"
                              >
                                <Settings className="w-3 h-3" />
                                <span>Ajustes</span>
                              </button>
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setAttachLiveScreen((v) => !v);
                            setShowScreenMenu(false);
                            inputRef.current?.focus();
                          }}
                          className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer ${
                            attachLiveScreen ? "is-selected" : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-[11.5px] font-medium text-white">
                              Incluir vista al enviar
                            </span>
                            <span className="block text-[10px] text-zinc-200/75">
                              También funciona diciendo &quot;lee la pantalla&quot;
                            </span>
                          </span>
                          <span
                            className={`quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0 ${
                              attachLiveScreen ? "text-sky-200" : "text-white/40"
                            }`}
                          >
                            {attachLiveScreen ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <Eye className="w-2.5 h-2.5" />
                            )}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const nextRolling = !(screenStatus?.rollingEnabled ?? true);
                            void setScreenReaderConfig({ rollingEnabled: nextRolling }).then((st) => {
                              if (st) setScreenStatus(st);
                            });
                          }}
                          className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer ${
                            screenStatus?.rollingEnabled ? "is-selected" : ""
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-[11.5px] font-medium text-white">
                              Memoria continua ({screenStatus?.retentionMinutes ?? 10} min)
                            </span>
                            <span className="block text-[10px] text-zinc-200/75">
                              Solo texto reciente, cero imágenes en disco
                            </span>
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              screenStatus?.rollingEnabled ? "bg-emerald-300" : "bg-white/30"
                            }`}
                          />
                        </button>

                        <div className="px-1 pt-0.5">
                          <JellyPillTrack
                            activeKey={screenStatus?.captureMode === "window" ? "window" : "display"}
                            role="group"
                            aria-label="Modo de captura de pantalla"
                            pillRadius="9999px"
                            variant="quick"
                            className="grid grid-cols-2 gap-1 p-0.5 rounded-full"
                          >
                            <button
                              type="button"
                              aria-pressed={(screenStatus?.captureMode || "display") === "display"}
                              onClick={() => {
                                void setScreenReaderConfig({ captureMode: "display" }).then((st) => {
                                  if (st) setScreenStatus(st);
                                });
                              }}
                              className={`xook-jelly-tab inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-full text-[10.5px] font-medium cursor-pointer ${
                                (screenStatus?.captureMode || "display") === "display"
                                  ? "text-white"
                                  : "text-zinc-300/80 hover:text-white"
                              }`}
                            >
                              <Monitor className="w-3 h-3" />
                              <span>Pantalla</span>
                            </button>
                            <button
                              type="button"
                              aria-pressed={screenStatus?.captureMode === "window"}
                              onClick={() => {
                                void setScreenReaderConfig({ captureMode: "window" }).then((st) => {
                                  if (st) setScreenStatus(st);
                                });
                              }}
                              className={`xook-jelly-tab inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-full text-[10.5px] font-medium cursor-pointer ${
                                screenStatus?.captureMode === "window"
                                  ? "text-white"
                                  : "text-zinc-300/80 hover:text-white"
                              }`}
                            >
                              <AppWindow className="w-3 h-3" />
                              <span>Ventana</span>
                            </button>
                          </JellyPillTrack>
                        </div>

                        {screenStatus?.activeAppName && (
                          <div className="px-2 pt-0.5 flex items-center justify-between gap-2 text-[10px] text-zinc-200/75">
                            <span className="truncate">
                              Detrás: {screenStatus.activeAppName}
                              {screenStatus.activeWindowTitle
                                ? ` · ${screenStatus.activeWindowTitle}`
                                : ""}
                            </span>
                            {(screenStatus.observationCount ?? 0) > 0 && (
                              <button
                                type="button"
                                title="Borrar memoria reciente de pantalla"
                                onClick={() => {
                                  void clearScreenMemory().then((st) => {
                                    if (st) setScreenStatus(st);
                                  });
                                }}
                                className="quick-liquid-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] text-white/85 cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                                <span>Limpiar</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowScreenMenu(false);
                      setShowModels((v) => {
                        const next = !v;
                        if (next && liveCatalog.length === 0) {
                          void loadModelCatalog();
                        }
                        return next;
                      });
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={showModels}
                    className="quick-liquid-btn h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[11.5px] font-medium text-white [text-shadow:0_1px_4px_rgba(4,8,18,0.65)] cursor-pointer"
                  >
                    <ProviderIcon provider={activeProvider} size={13} className="text-white/85 shrink-0" />
                    <span className="max-w-[132px] truncate">{activeModel.name}</span>
                    <ChevronDown
                      className={`w-3 h-3 text-sky-100/80 transition-transform ${
                        showModels ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {modelsPresence.mounted && (
                    <div
                      role="listbox"
                      className={`quick-liquid-menu ${
                        showModels ? "menu-in" : "menu-out pointer-events-none"
                      } menu-origin-top-right absolute right-0 top-full ${
                        inputExpanded || hasQuickResult ? "mt-2.5" : "mt-[30px]"
                      } w-72 overflow-hidden p-1.5 rounded-[20px] z-30`}
                    >
                      <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                        <QuickLiquidLayer
                          motionRef={xoxDragMotionRef}
                          active={isQuickVisible && !isLeaving && showModels}
                          busy={isBusy}
                          dragging={isDragging}
                        />
                      </div>

                      <div className="relative z-[1] px-2.5 py-1 flex items-center justify-between gap-2 text-[10px] text-zinc-100/85 [text-shadow:0_1px_4px_rgba(4,8,18,0.72)]">
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <ProviderIcon provider={activeProvider} size={11} className="shrink-0" />
                          <span>{activeSpec.shortName} ({modelOptions.length})</span>
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono tabular-nums" title={quickUsageSummary.headline}>
                            {quickUsageSummary.shortBadge}
                          </span>
                          {modelOptions.length > 4 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandModels((prev) => !prev);
                              }}
                              aria-expanded={expandModels}
                              title={expandModels ? "Contraer lista" : "Ver más modelos"}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-medium text-sky-200/90 hover:text-white hover:bg-white/[0.10] transition-colors cursor-pointer"
                            >
                              <span>{expandModels ? "Menos" : "Más"}</span>
                              <ChevronDown
                                className={`w-2.5 h-2.5 transition-transform duration-200 ${
                                  expandModels ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          )}
                        </div>
                      </div>
                      <div
                        aria-hidden="true"
                        className="relative z-[1] mb-1 h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                      />

                      <div
                        className={`xook-expand-list relative z-[1] ${
                          expandModels ? "max-h-[280px]" : "max-h-[228px]"
                        } overflow-y-auto space-y-0.5`}
                      >
                        {modelOptions.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            role="option"
                            aria-selected={m.id === modelId}
                            onClick={() => {
                              setModelId(m.id);
                              setShowModels(false);
                              inputRef.current?.focus();
                              void saveAiConfig({
                                provider: activeProvider,
                                targetProvider: activeProvider,
                                modelId: m.id,
                              })
                                .then(setAiConfig)
                                .catch(() => {});
                            }}
                            className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer ${
                              m.id === modelId ? "is-selected" : ""
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 text-xs font-medium text-white truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.72)]">
                                <span className="truncate">{m.name}</span>
                                {m.is_free ? (
                                  <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[8.5px] font-medium text-zinc-100/95 shrink-0">
                                    gratis
                                  </span>
                                ) : typeof m.prompt_price_per_million === "number" &&
                                  m.prompt_price_per_million > 0 ? (
                                  <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[8.5px] font-mono text-zinc-100/90 shrink-0 tabular-nums">
                                    {formatPricePerMillion(m.prompt_price_per_million)}/1M
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-[10.5px] text-zinc-100/80 truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.72)]">
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

                      {aiConfig.hasApiKey && (
                        <>
                          <div
                            aria-hidden="true"
                            className="relative z-[1] mt-1.5 h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                          />
                          <div className="relative z-[1] pt-1.5 px-2 pb-0.5 space-y-1 [text-shadow:0_1px_4px_rgba(4,8,18,0.72)]">
                            <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-100/85">
                              <span className="truncate">{quickUsageSummary.sourceBadge}</span>
                              <span className="font-mono text-white shrink-0 tabular-nums">
                                {quickUsageSummary.headline}
                              </span>
                            </div>
                            {quickUsageSummary.hasMeterBar && (
                              <progress
                                className="xook-usage-progress"
                                value={Math.max(0, Math.min(100, quickUsageSummary.pct))}
                                max={100}
                                aria-label={`${quickUsageSummary.tierLabel}: ${quickUsageSummary.headline}`}
                                style={{
                                  ["--xook-progress-fill" as string]: getUsageMeterFillColor({
                                    meterMode: quickUsageSummary.meterMode,
                                    pct: quickUsageSummary.pct,
                                  }),
                                }}
                              />
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStopQuickGeneration}
                    title="Detener respuesta en curso"
                    aria-label="Detener respuesta en curso"
                    className="xook-stop-btn quick-liquid-btn-ready w-8 h-8 rounded-full flex items-center justify-center active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80"
                  >
                    <span aria-hidden="true" className="xook-stop-ring" />
                    <span
                      aria-hidden="true"
                      className="relative z-[1] w-2.5 h-2.5 rounded-[2.5px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.45)]"
                    />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    title="Enviar"
                    aria-label="Enviar"
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      canSubmit
                        ? "quick-liquid-btn-ready cursor-pointer"
                        : "quick-liquid-btn text-zinc-100/60 cursor-not-allowed"
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Respuesta rápida en vivo inline (con entrada y salida suaves) */}
            {replyPresence.mounted &&
              (displayReply ||
                previewTableCanvas ||
                permissionItems.length > 0 ||
                hasTimelineCommands(displayTimeline)) && (
              <div
                className={`${
                  hasQuickResult ? "toast-in" : "toast-out pointer-events-none"
                } mt-2.5 space-y-2 max-h-[calc(100vh-115px)] overflow-y-auto xook-scroll`}
              >
                <div
                  aria-hidden="true"
                  className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent mb-2.5"
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-2.5 h-2.5 text-sky-100/95" />
                    </span>
                    <div
                      className={`${
                        previewTableCanvas ? "max-h-[136px]" : "max-h-[340px]"
                      } overflow-y-auto xook-scroll pr-1.5 text-[13px] text-zinc-100 leading-relaxed [text-shadow:0_1px_4px_rgba(4,8,18,0.68)] select-text min-w-0 flex-1 space-y-2`}
                    >
                      {hasTimelineCommands(displayTimeline) ? (
                        (() => {
                          const qGroups = groupTimelineForRender(displayTimeline);
                          if (qGroups.length === 0) {
                            return permissionItems.some((p) => p.state === "pending") ? (
                              <p className="text-zinc-300 font-medium truncate">
                                Xox espera tu autorización para continuar
                              </p>
                            ) : null;
                          }
                          return qGroups.map((group) =>
                            group.kind === "text" ? (
                              <MarkdownContent
                                key={group.id}
                                text={cleanVisibleReply(group.text, {
                                  stripTables: Boolean(previewTableCanvas),
                                })}
                                variant="liquid"
                                compact
                                streaming={isStreaming && group.isLastRawSegment}
                                className="space-y-1.5"
                              />
                            ) : (
                              <div key={group.id} data-no-drag="true" className="space-y-1.5">
                                {group.items.map((perm) => (
                                  <CommandPermissionCard
                                    key={perm.requestId}
                                    item={perm}
                                    compact
                                    surfaceVariant="liquid"
                                    onResolve={(reqId, decision) =>
                                      void handleResolveQuickPermission(reqId, decision)
                                    }
                                  />
                                ))}
                              </div>
                            )
                          );
                        })()
                      ) : cleanedProseReply ? (
                        <MarkdownContent
                          text={cleanedProseReply}
                          variant="liquid"
                          compact
                          streaming={isStreaming}
                          className="space-y-1.5"
                        />
                      ) : previewTableCanvas ? (
                        <p className="text-zinc-200 font-medium truncate">
                          {renderInlineMarkdown(
                            previewTableCanvas.summary || previewTableCanvas.title,
                            {
                              variant: "liquid",
                              preserveLineBreaks: false,
                              keyPrefix: "qsum",
                            }
                          )}
                        </p>
                      ) : permissionItems.length > 0 ? (
                        <p className="text-zinc-300 font-medium truncate">
                          {permissionItems.some((p) => p.state === "pending")
                            ? "Xox espera tu autorización para continuar"
                            : "Acción procesada con Guardián"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReply(null);
                      setQuickTimeline([]);
                      activeQuickTimelineRef.current = [];
                      lastTimelineRef.current = [];
                      setQuickCanvas(null);
                      setPendingClarification(null);
                      setPermissionItems([]);
                      setLiveScreenBadge(null);
                      setScreenPermissionNeeded(false);
                      quickHistoryRef.current = [];
                      lastCanvasRef.current = null;
                      lastReplyRef.current = null;
                      lastCanvasDisplayRef.current = null;
                      lastClarificationDisplayRef.current = null;
                      inputRef.current?.focus();
                    }}
                    aria-label="Limpiar respuesta"
                    className="quick-liquid-btn shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white/85 hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {(liveScreenBadge || screenPermissionNeeded) && !isStreaming && (
                  <div
                    data-no-drag="true"
                    className="ml-7 quick-liquid-subcard rounded-xl px-2.5 py-2 flex items-center justify-between gap-2 text-[11px] text-white/95 [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]"
                  >
                    {screenPermissionNeeded ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-amber-100 min-w-0 truncate">
                          <Shield className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                          <span className="truncate">Autoriza Grabación de Pantalla para leer tu vista</span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              void requestScreenPermission().then((st) => {
                                if (st) setScreenStatus(st);
                                if (st?.permissionGranted) setScreenPermissionNeeded(false);
                              });
                            }}
                            className="quick-liquid-chip-active px-2.5 py-1 rounded-lg text-[10.5px] font-medium cursor-pointer"
                          >
                            Autorizar
                          </button>
                          <button
                            type="button"
                            onClick={() => void openScreenPermissionSettings()}
                            className="quick-liquid-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] cursor-pointer"
                          >
                            <Settings className="w-3 h-3" />
                            <span>Abrir Ajustes</span>
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sky-100 min-w-0 truncate">
                        <Eye className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                        <span className="truncate">Leído desde pantalla: {liveScreenBadge}</span>
                      </span>
                    )}
                  </div>
                )}

                {(() => {
                  const dockPerms = hasTimelineCommands(displayTimeline)
                    ? permissionItems.filter(
                        (p) =>
                          p.state === "pending" ||
                          !timelineHasRequestId(displayTimeline, p.requestId)
                      )
                    : permissionItems;
                  if (dockPerms.length === 0) return null;
                  return (
                    <div data-no-drag="true" className="ml-7 space-y-2 select-text">
                      {dockPerms.map((perm) => (
                        <CommandPermissionCard
                          key={perm.requestId}
                          item={perm}
                          compact
                          surfaceVariant="liquid"
                          onResolve={(reqId, decision) =>
                            void handleResolveQuickPermission(reqId, decision)
                          }
                        />
                      ))}
                    </div>
                  );
                })()}

                {previewTableCanvas && (
                  <div
                    data-no-drag="true"
                    data-scrolled={tableScrolled ? "true" : undefined}
                    className="ml-7 quick-liquid-table rounded-xl overflow-hidden select-text"
                  >
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label={previewTableCanvas.title || "Tabla generada"}
                      onScroll={(e) => {
                        const scrolled = e.currentTarget.scrollTop > 2;
                        setTableScrolled((prev) => (prev === scrolled ? prev : scrolled));
                      }}
                      className="max-h-[244px] overflow-auto xook-scroll focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                    >
                      <table className="w-full border-separate border-spacing-0 text-[12px]">
                        <thead className="sticky top-0 z-10 quick-liquid-table-head">
                          <tr>
                            {previewTableCanvas.columns.map((col) => (
                              <th
                                key={col.id}
                                scope="col"
                                className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-zinc-100/95 whitespace-nowrap ${
                                  col.align === "right"
                                    ? "text-right"
                                    : col.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                }`}
                              >
                                {renderInlineMarkdown(col.label, {
                                  variant: "liquid",
                                  keyPrefix: `qth-${col.id}`,
                                })}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewTableCanvas.rows.map((r, rIdx) => {
                            const isRec = r.highlight === "recommended";
                            const isWarn = r.highlight === "warning";
                            return (
                              <tr
                                key={r.id || rIdx}
                                className={`xook-liquid-row ${
                                  isRec
                                    ? "is-featured"
                                    : isWarn
                                      ? "is-warning"
                                      : rIdx % 2 === 1
                                        ? "is-alt"
                                        : ""
                                }`}
                              >
                                {previewTableCanvas.columns.map((col, cIdx) => {
                                  const cellVal = r.cells[col.id] ?? "";
                                  return (
                                    <td
                                      key={col.id}
                                      className={`px-2.5 py-1.5 align-middle ${
                                        col.align === "right"
                                          ? "text-right font-mono tabular-nums text-indigo-100/95"
                                          : col.align === "center"
                                            ? "text-center text-zinc-100/90"
                                            : cIdx === 0
                                              ? "text-left font-medium text-white"
                                              : "text-left text-zinc-100/90"
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-1.5">
                                        {cIdx === 0 && isRec && (
                                          <span className="quick-liquid-icon w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0">
                                            <Star className="w-2.5 h-2.5 text-indigo-100 fill-current" />
                                          </span>
                                        )}
                                        <span>
                                          {cellVal
                                            ? renderInlineMarkdown(cellVal, {
                                                variant: "liquid",
                                                keyPrefix: `qtd-${rIdx}-${col.id}`,
                                              })
                                            : "—"}
                                        </span>
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {displayClarification && !isStreaming && (
                  <div
                    data-no-drag="true"
                    className="ml-7 max-h-[215px] overflow-y-auto xook-scroll rounded-xl quick-liquid-subcard quick-liquid-clarify p-2.5 select-text [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 mb-2">
                      <HelpCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{displayClarification.title}</span>
                    </div>
                    <ClarificationForm
                      compact
                      clarification={displayClarification}
                      disabled={isStreaming}
                      onCancel={() => {
                        setPendingClarification(null);
                        lastClarificationDisplayRef.current = null;
                      }}
                      onSubmit={(formattedReply) => {
                        void runQuickPrompt(formattedReply);
                      }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pl-7">
                  {previewTableCanvas ? (
                    <button
                      type="button"
                      onClick={() => void openInMainWorkspace()}
                      className="quick-liquid-btn inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium text-white/95 cursor-pointer"
                    >
                      <Table2 className="w-3 h-3 text-sky-100/90 shrink-0" />
                      <span className="max-w-[340px] truncate">
                        {previewTableCanvas.title} ({previewTableCanvas.rows.length}{" "}
                        {previewTableCanvas.rows.length === 1 ? "fila" : "filas"})
                      </span>
                      <span className="text-zinc-200/75 shrink-0">· Abrir en Canvas</span>
                      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-white/90 shrink-0">
                        ⌘↩
                      </kbd>
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-zinc-300/75">
                      {isStreaming
                        ? "Escribiendo en vivo…"
                        : displayClarification
                          ? "Responde para continuar"
                          : "Listo para continuar"}
                    </span>
                  )}

                  {!previewTableCanvas && !isStreaming && (
                    <button
                      type="button"
                      onClick={() => void openInMainWorkspace()}
                      className="quick-liquid-btn inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] font-medium text-white/95 cursor-pointer"
                    >
                      <span>Abrir XOOK</span>
                      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.08] text-white/90">
                        ⌘↩
                      </kbd>
                      <ExternalLink className="w-3 h-3 text-sky-100/90 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      <AttachmentPreviewDialog
        target={quickPreviewTarget}
        onClose={() => setQuickPreviewTarget(null)}
        onSavePastedText={updateQuickPastedText}
        onUnwrapPastedText={unwrapQuickPastedText}
        onRemoveAttachment={removeQuickAttachment}
      />
    </div>
  );
};
