import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Send, Sparkles, X } from "lucide-react";
import { XoxStar, XoxState } from "./XoxStar";
import { ActionCard, FALLBACK_ACTION_CARDS, MODELS } from "./XookBrand";

export const QuickBar: React.FC = () => {
  const [summonSeq, setSummonSeq] = useState<number>(1);
  const [isLeaving, setIsLeaving] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [statusNote, setStatusNote] = useState<string>("");
  const [reply, setReply] = useState<string | null>(null);
  const [pendingCards, setPendingCards] = useState<ActionCard[]>(FALLBACK_ACTION_CARDS);
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [showModels, setShowModels] = useState<boolean>(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  const refreshPendingCards = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const fetched = await invoke<ActionCard[]>("get_mock_action_cards");
      if (Array.isArray(fetched)) setPendingCards(fetched);
    } catch {
      // Mantiene fallback local fuera de Tauri
    }
  }, []);

  useEffect(() => {
    void refreshPendingCards();
    focusInput();

    let cancelled = false;
    let unlistenSummon: (() => void) | undefined;
    let unlistenDismiss: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const u1 = await listen<{ seq: number }>("quick:summon", (event) => {
          clearActionTimers();
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
          setShowModels(false);
          setIsLeaving(true);
        });
        if (cancelled) {
          u2();
          return;
        }
        unlistenDismiss = u2;
      } catch {
        // Preview web sin runtime Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlistenSummon?.();
      unlistenDismiss?.();
    };
  }, [clearActionTimers, focusInput, refreshPendingCards]);

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

  const runQuickPrompt = () => {
    const text = inputPrompt.trim();
    if (!text || xoxState === "thinking") return;

    clearActionTimers();
    setShowModels(false);
    setInputPrompt("");
    setReply(null);
    setXoxState("thinking");
    setStatusNote("Consultando contexto y niveles de stock...");

    const t1 = setTimeout(() => {
      setStatusNote("Verificando reglas de presupuesto y proveedores...");
    }, 650);

    const t2 = setTimeout(() => {
      const topCard = pendingCards[0];
      const summary = topCard
        ? `Detecté ${pendingCards.length} órdenes pendientes. La más urgente es "${topCard.title}" (${topCard.current_stock} un. en bodega, sugerido +${topCard.recommended_order} un. por $${topCard.estimated_cost.toLocaleString()} ${topCard.currency}).`
        : `Evalué "${text}" con las reglas activas de tu tienda. Todo el inventario se encuentra en niveles estables.`;

      setXoxState("success");
      setStatusNote("");
      setReply(summary);

      const t3 = setTimeout(() => {
        setXoxState("idle");
      }, 2200);
      timersRef.current.push(t3);
    }, 1350);

    timersRef.current.push(t1, t2);
  };

  const activeModel = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const isBusy = xoxState === "thinking" || xoxState === "reading" || xoxState === "syncing";
  const canSubmit = Boolean(inputPrompt.trim()) && xoxState !== "thinking";

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          dismissGracefully();
        }
      }}
      className="w-screen h-screen bg-transparent flex items-start justify-center pt-6 px-6 select-none overflow-hidden"
    >
      {/* Cápsula Liquid Glass minimalista */}
      <div
        key={summonSeq}
        className={`quick-capsule-shell relative w-full max-w-[620px] rounded-[26px] px-4 py-2.5 ${
          isLeaving ? "quick-capsule-out" : "quick-capsule-in"
        }`}
      >
        {/* Capa decorativa recortada (sin backdrop-filter ni blur CSS) */}
        <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
          <svg
            aria-hidden="true"
            viewBox="0 0 620 140"
            className="absolute inset-0 w-full h-full opacity-90"
            preserveAspectRatio="none"
          >
            <defs>
              <radialGradient id="quick-starlight-aura" cx="10%" cy="50%" r="44%">
                <stop offset="0%" stopColor="#7DD3FC" stopOpacity="0.16" />
                <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#060709" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="quick-violet-tint" cx="90%" cy="15%" r="38%">
                <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#060709" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="620" height="140" fill="url(#quick-starlight-aura)" />
            <rect width="620" height="140" fill="url(#quick-violet-tint)" />
          </svg>

          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <span aria-hidden="true" className="quick-starlight-sweep" />

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

        {/* Zona invisible superior para arrastrar la cápsula sin barra de título */}
        <div
          data-tauri-drag-region
          className="absolute inset-x-6 top-0 h-3 cursor-grab active:cursor-grabbing z-10"
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runQuickPrompt();
          }}
          className="relative"
        >
          <div className="flex items-center gap-3">
            {/* Mascota Xox */}
            <div className="shrink-0 -ml-2 -my-3">
              <XoxStar
                state={xoxState}
                size={80}
                summonTrigger={summonSeq}
                onClick={() => {
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
                      isBusy ? "bg-sky-400 animate-ping" : "bg-emerald-400"
                    }`}
                  />
                  <p
                    className={`text-[11px] truncate ${
                      isBusy ? "xox-shimmer font-medium" : "text-zinc-400"
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
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1 select-text disabled:opacity-50"
              />
            </div>

            {/* Selector limpio de modelo + Enviar */}
            <div className="flex items-center gap-2 shrink-0">
              <div ref={modelMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowModels((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showModels}
                  className="h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[11.5px] font-medium text-zinc-300 hover:text-white bg-white/[0.045] hover:bg-white/[0.09] border border-white/[0.08] transition-colors cursor-pointer"
                >
                  <span>{activeModel.name}</span>
                  <ChevronDown
                    className={`w-3 h-3 text-zinc-400 transition-transform ${
                      showModels ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {showModels && (
                  <div
                    role="listbox"
                    className="menu-in menu-origin-top-right absolute right-0 top-full mt-2 w-48 p-1 rounded-xl bg-[#0e1017] border border-white/10 shadow-2xl z-30"
                  >
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={m.id === modelId}
                        onClick={() => {
                          setModelId(m.id);
                          setShowModels(false);
                          inputRef.current?.focus();
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          m.id === modelId ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"
                        }`}
                      >
                        <span>
                          <span className="block text-xs text-zinc-100">{m.name}</span>
                          <span className="block text-[10px] text-zinc-500">{m.hint}</span>
                        </span>
                        {m.id === modelId && (
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                title="Enviar"
                aria-label="Enviar"
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                  canSubmit
                    ? "bg-white hover:bg-zinc-200 text-zinc-950 shadow-md active:scale-95 cursor-pointer"
                    : "bg-white/[0.05] border border-white/[0.07] text-zinc-500 cursor-not-allowed"
                }`}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Respuesta rápida inline (solo tras consultar) */}
          {reply && (
            <div className="toast-in mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-sky-300 shrink-0 mt-0.5" />
                <p className="text-xs text-zinc-200 leading-relaxed">{reply}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReply(null);
                  inputRef.current?.focus();
                }}
                aria-label="Limpiar respuesta"
                className="shrink-0 p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
