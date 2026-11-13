import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, HelpCircle, Send, Sparkles, Star, Table2, X } from "lucide-react";
import { XoxDragMotion, XoxStar, XoxState } from "./XoxStar";
import { QuickLiquidLayer } from "./QuickLiquidLayer";
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
import { LocalUserProfile, getLocalUserProfile } from "../features/workspace-store/localStore";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  ClarificationSpec,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  detectApiKeyInText,
  extractErrorMessage,
  fetchOpenRouterModels,
  formatModelDisplay,
  getAiConfigStatus,
  getAvailableQuickModels,
  incrementLocalDailyRequestCount,
  loadWorkspaceContext,
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
  resolveCommandPermission,
  subscribePermissionEvents,
} from "../features/workspace-store/workspaceApi";
import {
  CommandPermissionCard,
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "../features/ai-service/CommandPermissionCard";

const DRAG_THRESHOLD_PX = 4;

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
      "textarea, input, button, select, a, [role='listbox'], [role='option'], [data-no-drag='true']"
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

export const QuickBar: React.FC = () => {
  const [summonSeq, setSummonSeq] = useState<number>(1);
  const [isQuickVisible, setIsQuickVisible] = useState<boolean>(
    () => !(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
  );
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [settleSeq, setSettleSeq] = useState<number>(0);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [statusNote, setStatusNote] = useState<string>("");
  const [reply, setReply] = useState<string | null>(null);
  const [quickCanvas, setQuickCanvas] = useState<CanvasArtifact | null>(null);
  const [pendingClarification, setPendingClarification] = useState<ClarificationSpec | null>(null);
  const [permissionItems, setPermissionItems] = useState<CommandPermissionUiItem[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [inputExpanded, setInputExpanded] = useState<boolean>(false);
  const [localUser, setLocalUser] = useState<LocalUserProfile | null>(null);
  const [modelId, setModelId] = useState<string>(OPENROUTER_PRESET_MODELS[0].id);
  const [aiConfig, setAiConfig] = useState<AiConfigStatus>({
    provider: "openrouter",
    modelId: OPENROUTER_PRESET_MODELS[0].id,
    hasApiKey: false,
    maskedKey: null,
    keySource: "none",
    customModels: [],
  });
  const [accountUsage, setAccountUsage] = useState<AiConnectionTestResult | null>(null);
  const [liveCatalog, setLiveCatalog] = useState<OpenRouterModelOption[]>([]);
  const [unavailableModelIds, setUnavailableModelIds] = useState<Set<string>>(() => new Set());
  const [showModels, setShowModels] = useState<boolean>(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const suppressNextXoxClickRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  isStreamingRef.current = isStreaming;
  const activeStreamIdRef = useRef<string | null>(null);
  const accountUsageRef = useRef<AiConnectionTestResult | null>(null);
  accountUsageRef.current = accountUsage;
  const catalogLoadingRef = useRef<boolean>(false);
  const cachedSelectedModelRef = useRef<OpenRouterModelOption | null>(null);
  const lastPromptRef = useRef<string>("");
  const lastCanvasRef = useRef<CanvasArtifact | null>(null);
  const lastReplyRef = useRef<string | null>(null);
  const lastCanvasDisplayRef = useRef<CanvasArtifact | null>(null);
  const lastClarificationDisplayRef = useRef<ClarificationSpec | null>(null);
  const lastStatusNoteRef = useRef<string>("");

  if (reply) lastReplyRef.current = reply;
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
      const [cfg, savedUser] = await Promise.all([
        getAiConfigStatus(),
        getLocalUserProfile().catch(() => null),
      ]);
      setLocalUser(savedUser);
      setAiConfig(cfg);
      if (cfg.modelId) setModelId(cfg.modelId);
      if (cfg.hasApiKey) {
        if (!accountUsageRef.current) {
          void testAiConnection().then((res) => {
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
      const res = await fetchOpenRouterModels(false);
      if (res.models.length > 0) setLiveCatalog(res.models);
    } finally {
      catalogLoadingRef.current = false;
    }
  }, []);

  // Libera el catálogo extenso cuando el menú está cerrado para reducir memoria
  useEffect(() => {
    if (showModels || liveCatalog.length === 0) return;
    const t = setTimeout(() => {
      setLiveCatalog([]);
    }, 180);
    return () => clearTimeout(t);
  }, [showModels, liveCatalog.length]);

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
    };
  }, [
    clearActionTimers,
    ensureCapsuleSpringRunning,
    focusInput,
    refreshQuickSession,
    triggerSettleImpulse,
  ]);

  useEffect(() => {
    return subscribePermissionEvents({
      onRequest: (req) => {
        if (!activeStreamIdRef.current || req.streamId !== activeStreamIdRef.current) {
          return;
        }
        setPermissionItems((prev) => applyPermissionRequestItem(prev, req));
      },
      onFinished: (ev) => {
        setPermissionItems((prev) => applyCommandFinishedEvent(prev, ev));
      },
    });
  }, []);

  const handleResolveQuickPermission = useCallback(
    async (requestId: string, decision: CommandPermissionDecisionKind) => {
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
                  error: extractErrorMessage(err, "No se pudo enviar tu decisión."),
                }
              : item
          )
        );
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
    const rawCanvas = resolveQuickPreviewCanvas(
      lastCanvasRef.current ?? quickCanvas,
      rawReply,
      promptToSend || "Tabla rápida"
    );
    const responseToSend = rawReply
      ? cleanVisibleReply(rawReply, { stripTables: Boolean(rawCanvas) }) || rawReply
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

  // Escape oculta el menú de modelos o la Quick Bar; ⌘↩ abre XOOK completo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void openInMainWorkspace();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (showModels) {
          setShowModels(false);
        } else {
          dismissGracefully();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissGracefully, openInMainWorkspace, showModels]);

  // Cerrar selector de modelo al hacer clic fuera
  useEffect(() => {
    if (!showModels) return;
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModels(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showModels]);

  const runQuickPrompt = async (overridePrompt?: string) => {
    const text = (
      typeof overridePrompt === "string" ? overridePrompt : inputPrompt
    ).trim();
    if (!text || isStreamingRef.current) return;

    clearActionTimers();
    setShowModels(false);
    if (typeof overridePrompt !== "string") {
      setInputPrompt("");
    }
    setReply(null);
    setQuickCanvas(null);
    setPendingClarification(null);
    lastPromptRef.current = text;
    lastCanvasRef.current = null;
    lastReplyRef.current = null;
    lastCanvasDisplayRef.current = null;
    lastClarificationDisplayRef.current = null;

    // Zero-Trust: bloquear envío de claves API pegadas desde Quick Bar
    const { detectedKey, maskedKey } = detectApiKeyInText(text);
    if (detectedKey && maskedKey) {
      setXoxState("alert");
      setStatusNote("");
      setReply(
        `Detecté una clave API (${maskedKey}) y la retuve localmente sin enviarla a internet. Abre XOOK (⌘↩) para guardarla en la bóveda con tu aprobación.`
      );
      const t = setTimeout(() => setXoxState("idle"), 2600);
      timersRef.current.push(t);
      return;
    }

    setPermissionItems([]);
    setIsStreaming(true);
    setXoxState("reading");
    setStatusNote("Leyendo contexto...");

    const READING_MIN_MS = 500;
    const TALKING_MIN_MS = 950;
    const readingStartedAt = performance.now();
    let talkingStartedAt = 0;
    let latestPhase: "reading" | "thinking" | "talking" | "syncing" = "reading";
    let hasEnteredTalking = false;

    try {
      const latestCfg = await getAiConfigStatus();
      setAiConfig(latestCfg);
      if (!latestCfg.hasApiKey) {
        setIsStreaming(false);
        setXoxState("idle");
        setStatusNote("");
        setReply(
          "Aún no hay una clave de OpenRouter conectada. Abre XOOK (⌘↩) para conectar tu cuenta."
        );
        return;
      }

      incrementLocalDailyRequestCount(latestCfg.maskedKey);
      const [workspaceSources, currentTasks, agendaItems] = await Promise.all([
        loadWorkspaceContext().catch(() => []),
        listTasks("pending").catch(() => []),
        listAgendaItems().catch(() => []),
      ]);
      const businessContextSnapshot = workspaceSources
        .map((src) => `- ${src.path} (${src.type}): ${src.content.slice(0, 600)}`)
        .join("\n")
        .slice(0, 3500);

      const res = await runXoxAiChatStream(
        {
          message: text,
          history: [],
          currentTasks,
          agendaItems,
          attachedContext: workspaceSources.slice(0, 3).map((src) => ({
            name: src.name,
            type: src.type,
            content: src.content.slice(0, 1500),
          })),
          modelOverride: modelId,
          userProfile: localUser
            ? {
                name: localUser.name,
                storeName: localUser.storeName,
                role: localUser.role,
              }
            : null,
          businessContextSnapshot,
          activeCanvas: lastCanvasRef.current,
        },
        {
          onStreamStart: (streamId) => {
            activeStreamIdRef.current = streamId;
          },
          onPhase: (phase, label) => {
            if (hasEnteredTalking && (phase === "reading" || phase === "thinking")) {
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
                  : phase === "reading"
                    ? "Leyendo contexto..."
                    : `Consultando ${activeModel.name}...`)
            );
          },
          onReplyDelta: (delta) => {
            if (!hasEnteredTalking) {
              hasEnteredTalking = true;
              if (!talkingStartedAt) talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
              setStatusNote("Respondiendo...");
            }
            setReply((prev) => `${prev ?? ""}${delta}`);
          },
          onCanvas: (canvas) => {
            lastCanvasRef.current = canvas;
            setQuickCanvas(canvas);
          },
        }
      );

      clearActionTimers();
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
      setReply(res.reply);
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
      setIsStreaming(false);
      const errMsg = extractErrorMessage(err, "No se pudo obtener respuesta.");
      if (/saldo suficiente|402|no longer available/i.test(errMsg)) {
        setUnavailableModelIds((prev) => new Set(prev).add(modelId));
      }
      setXoxState("alert");
      setStatusNote("");
      setReply(`Error OpenRouter: ${errMsg}`);
      const t = setTimeout(() => setXoxState("idle"), 2800);
      timersRef.current.push(t);
    }
  };

  const handleCapsulePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;

    setShowModels(false);
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

  const canUsePaidModels = accountUsage?.can_use_paid_models ?? false;
  const modelOptions: OpenRouterModelOption[] = useMemo(
    () =>
      getAvailableQuickModels(
        liveCatalog,
        aiConfig.customModels,
        canUsePaidModels,
        unavailableModelIds
      ),
    [liveCatalog, aiConfig.customModels, canUsePaidModels, unavailableModelIds]
  );

  const activeModel: OpenRouterModelOption = useMemo(() => {
    const extra = cachedSelectedModelRef.current ? [cachedSelectedModelRef.current] : [];
    const resolved = formatModelDisplay(modelId, [...liveCatalog, ...modelOptions, ...extra]);
    cachedSelectedModelRef.current = resolved;
    return resolved;
  }, [modelId, liveCatalog, modelOptions]);

  const isBusy =
    isStreaming || xoxState === "thinking" || xoxState === "reading" || xoxState === "syncing";
  const canSubmit = Boolean(inputPrompt.trim()) && !isStreaming;

  const modelsPresence = useAnimatedPresence(showModels, 145);
  const statusPresence = useAnimatedPresence(Boolean(statusNote), 190);
  const hasQuickResult = Boolean(
    reply || quickCanvas || pendingClarification || permissionItems.length > 0
  );
  const replyPresence = useAnimatedPresence(hasQuickResult, 190);
  const displayReply = reply ?? lastReplyRef.current;
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

  useEffect(() => {
    if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) {
          await invoke("set_quick_state", {
            busy: isStreaming,
            hasContent: hasQuickResult,
          });
        }
      } catch {
        // Ignorar fuera de Tauri
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStreaming, hasQuickResult]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isDragging) {
          dismissGracefully();
        }
      }}
      className="w-screen h-screen bg-transparent flex items-start justify-center pt-6 px-6 select-none overflow-hidden"
    >
      {/* Envoltorio de entrada/salida independiente de la física de arrastre */}
      <div
        key={summonSeq}
        className={`w-full max-w-[620px] ${
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
          className={`quick-capsule-shell relative w-full rounded-[26px] px-4 py-2.5 ${
            inputExpanded || hasQuickResult ? "is-expanded" : ""
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

            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.16] to-transparent" />
            <div className="absolute inset-x-14 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-200/[0.14] to-transparent" />
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
                  ? "w-12 bg-sky-100/95 shadow-[0_0_6px_rgba(224,242,254,0.65)]"
                  : "w-8 bg-white/30 group-hover/grip:w-11 group-hover/grip:bg-sky-100/70"
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
                  active={isQuickVisible && !isLeaving}
                  summonTrigger={summonSeq}
                  dragMotionRef={xoxDragMotionRef}
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
              <div className="flex-1 min-w-0">
                {statusPresence.mounted && displayStatusNote && (
                  <div
                    className={`flex items-center gap-1.5 mb-0.5 ${
                      statusNote ? "toast-in" : "toast-out pointer-events-none"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        xoxState === "thinking" || xoxState === "reading"
                          ? "bg-indigo-200 animate-ping"
                          : xoxState === "syncing"
                            ? "bg-indigo-200 animate-pulse"
                            : xoxState === "talking"
                              ? "bg-sky-200"
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

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      runQuickPrompt();
                    }
                  }}
                  disabled={isStreaming}
                  placeholder={isStreaming ? "Procesando..." : "Escribe a Xox..."}
                  className="input-bubble w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-relaxed text-white placeholder:text-zinc-200/65 [text-shadow:0_1px_5px_rgba(4,8,18,0.68)] focus:outline-none py-1 cursor-text select-text disabled:opacity-50"
                />
              </div>

              {/* Selector limpio de modelo + Enviar (estilo Liquid Glass) */}
              <div className="flex items-center gap-2 shrink-0">
                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setShowModels((v) => {
                        const next = !v;
                        if (next && liveCatalog.length === 0) {
                          void loadModelCatalog();
                        }
                        return next;
                      })
                    }
                    aria-haspopup="listbox"
                    aria-expanded={showModels}
                    className="quick-liquid-btn h-8 inline-flex items-center gap-1.5 px-3.5 rounded-full text-[11.5px] font-medium text-white [text-shadow:0_1px_4px_rgba(4,8,18,0.65)] cursor-pointer"
                  >
                    <span className="max-w-[140px] truncate">{activeModel.name}</span>
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
                        modelsPresence.visible ? "menu-in" : "menu-out pointer-events-none"
                      } menu-origin-top-right absolute right-0 top-full mt-2 w-64 p-1.5 rounded-2xl z-30`}
                    >
                      <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 210 180"
                          preserveAspectRatio="none"
                          className="absolute inset-0 w-full h-full"
                        >
                          <defs>
                            <radialGradient id="ql-menu-cyan" cx="20%" cy="18%" r="65%">
                              <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.16" />
                              <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
                            </radialGradient>
                            <radialGradient id="ql-menu-aurora" cx="85%" cy="82%" r="60%">
                              <stop offset="0%" stopColor="#F472B6" stopOpacity="0.11" />
                              <stop offset="55%" stopColor="#A78BFA" stopOpacity="0.06" />
                              <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
                            </radialGradient>
                          </defs>
                          <rect width="210" height="180" fill="url(#ql-menu-cyan)" />
                          <rect width="210" height="180" fill="url(#ql-menu-aurora)" />
                        </svg>
                        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
                      </div>

                      <div className="relative z-[1] px-2.5 py-1 mb-1 flex items-center justify-between text-[10px] text-zinc-200/75 border-b border-white/[0.06]">
                        <span>Disponibles ({modelOptions.length})</span>
                        <span className="font-mono">
                          {canUsePaidModels ? "Con saldo" : "Plan gratuito"}
                        </span>
                      </div>

                      <div className="relative z-[1] max-h-52 overflow-y-auto space-y-0.5">
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
                              void saveAiConfig({ modelId: m.id })
                                .then(setAiConfig)
                                .catch(() => {});
                            }}
                            className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer ${
                              m.id === modelId ? "is-selected" : ""
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-white truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]">
                                {m.name}
                              </span>
                              <span className="block text-[10.5px] text-zinc-200/75 truncate [text-shadow:0_1px_3px_rgba(4,8,18,0.6)]">
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
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  title="Enviar"
                  aria-label="Enviar"
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    canSubmit
                      ? "quick-liquid-btn-ready active:scale-95 cursor-pointer"
                      : "quick-liquid-btn text-zinc-100/80 cursor-not-allowed"
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Respuesta rápida en vivo inline (con entrada y salida suaves) */}
            {replyPresence.mounted &&
              (displayReply || previewTableCanvas || permissionItems.length > 0) && (
              <div
                className={`${
                  hasQuickResult ? "toast-in" : "toast-out pointer-events-none"
                } mt-2.5 space-y-2`}
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
                        previewTableCanvas ? "max-h-[68px]" : "max-h-[145px]"
                      } overflow-y-auto xook-scroll pr-1 text-xs text-zinc-100 leading-relaxed space-y-1 [text-shadow:0_1px_4px_rgba(4,8,18,0.6)] select-text min-w-0 flex-1`}
                    >
                      {cleanedProseReply ? (
                        cleanedProseReply.split("\n").map((line, lineIdx, arr) => {
                          const trimmed = line.trim();
                          if (!trimmed) return <div key={lineIdx} className="h-0.5" />;
                          const isLast = lineIdx === arr.length - 1;
                          const caret =
                            isStreaming && isLast ? (
                              <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-indigo-200/85 animate-pulse rounded-xs" />
                            ) : null;
                          const cleanLine = trimmed
                            .replace(/^#{1,3}\s+/, "")
                            .replace(/^[-•*]\s+/, "• ");
                          return (
                            <p key={lineIdx}>
                              {cleanLine.split(/(\*\*[^*]+\*\*)/g).map((seg, segIdx) =>
                                seg.startsWith("**") && seg.endsWith("**") && seg.length > 4 ? (
                                  <strong key={segIdx} className="font-semibold text-white">
                                    {seg.slice(2, -2)}
                                  </strong>
                                ) : (
                                  <React.Fragment key={segIdx}>{seg}</React.Fragment>
                                )
                              )}
                              {caret}
                            </p>
                          );
                        })
                      ) : previewTableCanvas ? (
                        <p className="text-zinc-200 font-medium truncate">
                          {previewTableCanvas.summary || previewTableCanvas.title}
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
                      setQuickCanvas(null);
                      setPendingClarification(null);
                      setPermissionItems([]);
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

                {permissionItems.length > 0 && (
                  <div data-no-drag="true" className="ml-7 space-y-2 select-text">
                    {permissionItems.map((perm) => (
                      <CommandPermissionCard
                        key={perm.requestId}
                        item={perm}
                        compact
                        onResolve={(reqId, decision) =>
                          void handleResolveQuickPermission(reqId, decision)
                        }
                      />
                    ))}
                  </div>
                )}

                {previewTableCanvas && (
                  <div
                    data-no-drag="true"
                    className="ml-7 quick-liquid-table rounded-xl overflow-hidden select-text"
                  >
                    <div className="max-h-[132px] overflow-auto xook-scroll">
                      <table className="w-full border-separate border-spacing-0 text-[11.5px]">
                        <thead className="sticky top-0 z-10 quick-liquid-table-head">
                          <tr>
                            {previewTableCanvas.columns.map((col) => (
                              <th
                                key={col.id}
                                className={`px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-zinc-200/90 whitespace-nowrap ${
                                  col.align === "right"
                                    ? "text-right"
                                    : col.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                }`}
                              >
                                {col.label}
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
                                        <span>{cellVal || "—"}</span>
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
                    className="ml-7 max-h-[215px] overflow-y-auto xook-scroll rounded-xl border border-sky-400/20 bg-black/35 p-2.5 select-text"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-sky-200 mb-2">
                      <HelpCircle className="w-3.5 h-3.5 text-sky-300 shrink-0" />
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
                      <span className="max-w-[250px] truncate">
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
    </div>
  );
};
