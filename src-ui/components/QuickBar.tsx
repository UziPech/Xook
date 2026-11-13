import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Send, Sparkles, X } from "lucide-react";
import { XoxDragMotion, XoxStar, XoxState } from "./XoxStar";
import { QuickLiquidLayer } from "./QuickLiquidLayer";
import { ActionCard, FALLBACK_ACTION_CARDS } from "./XookBrand";
import { actionCardToTaskProposal } from "../features/task-decisions/taskSchema";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  detectApiKeyInText,
  fetchOpenRouterModels,
  formatModelDisplay,
  getAiConfigStatus,
  getAvailableQuickModels,
  incrementLocalDailyRequestCount,
  runXoxAiChat,
  saveAiConfig,
  testAiConnection,
} from "../features/ai-service/aiClient";

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

export const QuickBar: React.FC = () => {
  const [summonSeq, setSummonSeq] = useState<number>(1);
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [settleSeq, setSettleSeq] = useState<number>(0);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [statusNote, setStatusNote] = useState<string>("");
  const [reply, setReply] = useState<string | null>(null);
  const [pendingCards, setPendingCards] = useState<ActionCard[]>(FALLBACK_ACTION_CARDS);
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

  const refreshPendingCards = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const fetched = await invoke<ActionCard[]>("get_mock_action_cards");
      if (Array.isArray(fetched)) setPendingCards(fetched);
    } catch {
      // Mantiene fallback local fuera de Tauri
    }
    try {
      const cfg = await getAiConfigStatus();
      setAiConfig(cfg);
      if (cfg.modelId) setModelId(cfg.modelId);
      if (cfg.hasApiKey) {
        void testAiConnection().then((res) => {
          if (res.ok) setAccountUsage(res);
        });
      } else {
        setAccountUsage(null);
      }
    } catch {
      // Ignora error de carga inicial de bóveda
    }
    void fetchOpenRouterModels(false).then((res) => {
      if (res.models.length > 0) setLiveCatalog(res.models);
    });
  }, []);

  useEffect(() => {
    void refreshPendingCards();
    focusInput();

    let cancelled = false;
    let unlistenSummon: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;
    let unlistenRecenter: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const u1 = await listen<{ seq: number }>("quick:summon", (event) => {
          clearActionTimers();
          dragSessionRef.current = null;
          setIsDragging(false);
          xoxDragMotionRef.current.active = false;
          setIsLeaving(false);
          setShowModels(false);
          setSummonSeq(event.payload?.seq ?? Date.now());
          void refreshPendingCards();
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

        const u3 = await listen<{ phase: "step" | "end"; vx: number; vy: number }>(
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
          u3();
          return;
        }
        unlistenRecenter = u3;
      } catch {
        // Preview web sin runtime Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlistenSummon?.();
      unlistenDismiss?.();
      unlistenRecenter?.();
    };
  }, [
    clearActionTimers,
    ensureCapsuleSpringRunning,
    focusInput,
    refreshPendingCards,
    triggerSettleImpulse,
  ]);

  // Garantiza cierre limpio del arrastre si la ventana pierde el foco abruptamente
  useEffect(() => {
    const handleBlur = () => {
      finishDragSession(capsuleRef.current, dragSessionRef.current?.pointerId);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [finishDragSession]);

  // Auto-altura compacta del textarea (1 a 4 líneas)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 108)}px`;
  }, [inputPrompt]);

  // Escape oculta el menú de modelos o la Quick Bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [dismissGracefully, showModels]);

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

  const runQuickPrompt = async () => {
    const text = inputPrompt.trim();
    if (!text || xoxState === "thinking") return;

    clearActionTimers();
    setShowModels(false);
    setInputPrompt("");
    setReply(null);

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

    setXoxState("thinking");
    setStatusNote(`Consultando ${activeModel.name}...`);

    try {
      const latestCfg = await getAiConfigStatus();
      setAiConfig(latestCfg);
      if (!latestCfg.hasApiKey) {
        setXoxState("idle");
        setStatusNote("");
        setReply(
          "Aún no hay una clave de OpenRouter conectada. Abre XOOK (⌘↩) para conectar tu cuenta."
        );
        return;
      }

      incrementLocalDailyRequestCount(latestCfg.maskedKey);
      const currentTasks = pendingCards.map((c, idx) => actionCardToTaskProposal(c, idx));
      const res = await runXoxAiChat({
        message: text,
        history: [],
        currentTasks,
        agendaItems: [],
        attachedContext: [],
        modelOverride: modelId,
        businessContextSnapshot: currentTasks
          .map((t) => `- ${t.title}: ${t.subtitle}`)
          .join("\n"),
      });

      setXoxState(res.xoxMood === "alert" ? "alert" : "success");
      setStatusNote("");
      setReply(res.reply);

      const t = setTimeout(() => setXoxState("idle"), 2400);
      timersRef.current.push(t);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "No se pudo obtener respuesta.";
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
  const modelOptions: OpenRouterModelOption[] = getAvailableQuickModels(
    liveCatalog,
    aiConfig.customModels,
    canUsePaidModels,
    unavailableModelIds
  );

  const activeModel: OpenRouterModelOption = formatModelDisplay(modelId, [
    ...liveCatalog,
    ...modelOptions,
  ]);
  const isBusy = xoxState === "thinking" || xoxState === "reading" || xoxState === "syncing";
  const canSubmit = Boolean(inputPrompt.trim()) && xoxState !== "thinking";

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
            isDragging ? "is-dragging cursor-grabbing" : "cursor-grab"
          }`}
        >
          {/* Capa líquida viva y destellos recortados (sin backdrop-filter ni blur CSS) */}
          <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
            <QuickLiquidLayer
              motionRef={xoxDragMotionRef}
              active={!isLeaving}
              busy={isBusy}
              dragging={isDragging}
            />

            <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent" />
            <div className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-200/35 to-transparent" />
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
                  summonTrigger={summonSeq}
                  dragMotionRef={xoxDragMotionRef}
                  className={isDragging ? "!cursor-grabbing" : "!cursor-grab"}
                  onClick={() => {
                    if (suppressNextXoxClickRef.current) {
                      suppressNextXoxClickRef.current = false;
                      return;
                    }
                    setXoxState("success");
                    const t = setTimeout(() => setXoxState("idle"), 1800);
                    timersRef.current.push(t);
                  }}
                />
              </div>

              {/* Campo principal */}
              <div className="flex-1 min-w-0">
                {statusNote && (
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isBusy ? "bg-sky-300 animate-ping" : "bg-emerald-400"
                      }`}
                    />
                    <p
                      className={`text-[11px] truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.65)] ${
                        isBusy ? "xox-shimmer font-medium" : "text-zinc-200"
                      }`}
                    >
                      {statusNote}
                    </p>
                  </div>
                )}

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      runQuickPrompt();
                    }
                  }}
                  disabled={xoxState === "thinking"}
                  placeholder={xoxState === "thinking" ? "Procesando..." : "Escribe a Xox..."}
                  className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-white placeholder:text-zinc-200/65 [text-shadow:0_1px_5px_rgba(4,8,18,0.68)] focus:outline-none py-1 cursor-text select-text disabled:opacity-50"
                />
              </div>

              {/* Selector limpio de modelo + Enviar (estilo Liquid Glass) */}
              <div className="flex items-center gap-2 shrink-0">
                <div ref={modelMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setShowModels((v) => !v)}
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

                  {showModels && (
                    <div
                      role="listbox"
                      className="quick-liquid-menu menu-in menu-origin-top-right absolute right-0 top-full mt-2 w-64 p-1.5 rounded-2xl z-30"
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
                        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                      </div>

                      <div className="relative z-[1] px-2.5 py-1 mb-1 flex items-center justify-between text-[10px] text-zinc-200/75 border-b border-white/10">
                        <span>Disponibles ({modelOptions.length})</span>
                        <span className="font-mono">
                          {canUsePaidModels ? "Con saldo" : "Plan gratuito"}
                        </span>
                      </div>

                      <div className="relative z-[1] max-h-60 overflow-y-auto space-y-0.5">
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
                              <Check className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
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

            {/* Respuesta rápida inline (solo tras consultar) */}
            {reply && (
              <div className="toast-in mt-2.5 pt-2.5 border-t border-white/[0.14] flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-sky-300 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-100 leading-relaxed [text-shadow:0_1px_4px_rgba(4,8,18,0.6)]">
                    {reply}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReply(null);
                    inputRef.current?.focus();
                  }}
                  aria-label="Limpiar respuesta"
                  className="quick-liquid-btn shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
