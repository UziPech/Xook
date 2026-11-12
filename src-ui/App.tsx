import React, { useState, useEffect, useRef, useId } from "react";
import { 
  ShieldCheck, 
  CheckCircle2, 
  Brain, 
  Store, 
  Sparkles,
  ArrowRight,
  FolderOpen,
  Pin,
  Plus,
  Send,
  Zap,
  Check,
  Eye,
  X,
  FileText,
  ListTodo,
  CheckCheck,
  Clock,
  PanelLeft,
  ChevronDown,
  Paperclip,
  Cpu,
  AtSign
} from "lucide-react";
import { XoxStar, XoxState } from "./components/XoxStar";
import { ActionCard, FALLBACK_ACTION_CARDS, MODELS, XookWordmark } from "./components/XookBrand";

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
  tokens: string;
  pinned: boolean;
  content: string;
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

/**
 * Mantiene montados los paneles y ventanas durante su animación de salida.
 */
function useAnimatedPresence(isOpen: boolean, durationMs: number) {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(isOpen);
  const prevOpenRef = useRef(isOpen);

  useEffect(() => {
    if (prevOpenRef.current === isOpen) return;
    prevOpenRef.current = isOpen;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (isOpen) {
      setMounted(true);
      if (reducedMotion) {
        setVisible(true);
        return;
      }
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    setVisible(false);
    if (reducedMotion) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(timer);
  }, [isOpen, durationMs]);

  return { mounted, visible };
}

export default function App() {
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [approvedCards, setApprovedCards] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  
  // Estado de Xox (Mascota Digital y Orquestador Estelar)
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [xoxMessage, setXoxMessage] = useState<string>("¿En qué puedo ayudarte?");
  
  // Estados para paneles laterales y tareas
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(true);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(true);
  const [taskTab, setTaskTab] = useState<"pending" | "completed">("pending");
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

  // Archivos adjuntos, modelo activo y notificación de aprendizaje
  const [attachments, setAttachments] = useState<File[]>([]);
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
  const [showContextMenu, setShowContextMenu] = useState<boolean>(false);
  const [learningToast, setLearningToast] = useState<MemoryPattern | null>(null);
  const [inputExpanded, setInputExpanded] = useState<boolean>(false);

  // Burbuja de saludo de Xox (solo al hacer clic sobre la mascota)
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLeaving, setGreetingLeaving] = useState<boolean>(false);
  const [summonSeq, setSummonSeq] = useState<number>(0);
  const greetingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => greetingTimers.current.forEach(clearTimeout), []);
  const activeModel = MODELS.find((m) => m.id === modelId) ?? MODELS[0];

  // Lista de elementos en la Ventana de Contexto
  const [contextItems, setContextItems] = useState<ContextItem[]>([
    {
      id: "ctx_profile",
      name: "store-profile.json",
      type: "profile",
      path: "context/business-profiles/store-profile.json",
      tokens: "1.4k tokens",
      pinned: true,
      content: JSON.stringify({
        "company_name": "Tienda Xook Demo",
        "currency": "MXN",
        "stock_threshold_days": 7,
        "max_budget_per_order": 50000.0,
        "preferred_suppliers": ["Distribuidora del Sur", "Comercializadora Bajío"],
        "rules": [
          "Presupuesto máximo por orden: $50,000 MXN",
          "Solo proveedores calificados con 4+ estrellas",
          "Requerir autorización obligatoria para toda mutación"
        ]
      }, null, 2)
    },
    {
      id: "ctx_memory",
      name: "memory_store.json",
      type: "memory",
      path: "context/memory/memory_store.json",
      tokens: "2.8k tokens",
      pinned: true,
      content: JSON.stringify({
        "user_preferences": {
          "budget_safety_limit": 50000.0,
          "preferred_notification_style": "action_cards_only"
        },
        "learned_patterns": [
          "El usuario autoriza compras de Café Chiapas sin objeción.",
          "Preferencia por reordenar los días martes y miércoles."
        ]
      }, null, 2)
    },
    {
      id: "ctx_skill",
      name: "inventory-advisor",
      type: "skill",
      path: "skills/inventory-advisor/SKILL.md",
      tokens: "850 tokens",
      pinned: true,
      content: `# Asesor de Inventario y Abastecimiento
- Monitorea niveles de stock contra venta diaria promedio.
- Formula tarjetas de compra para productos con menos de 7 días de stock.
- Exige aprobación visual explícita antes de contactar proveedores.`
    }
  ]);

  useEffect(() => {
    async function loadData() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        setIsTauriEnv(true);
        const fetchedCards = await invoke<ActionCard[]>("get_mock_action_cards");
        const fetchedPatterns = await invoke<MemoryPattern[]>("get_learned_patterns");
        setCards(fetchedCards);
        setPatterns(fetchedPatterns);
      } catch {
        // Fallback local
        setIsTauriEnv(false);
        setCards(FALLBACK_ACTION_CARDS);
        setPatterns([
          {
            pattern_id: "pat_01",
            description: "El usuario autoriza compras sin objeción para 'Café Chiapas' si el proveedor es 'Distribuidora del Sur'.",
            confidence: 0.95
          },
          {
            pattern_id: "pat_02",
            description: "Preferencia por órdenes menores a $5,000 MXN en días hábiles.",
            confidence: 0.88
          }
        ]);
      }
    }
    loadData();
    setSelectedContext(contextItems[0]);
  }, []);

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

  // Atajo de teclado ⌘K para enfocar el input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const handleApprove = async (card: ActionCard) => {
    try {
      if (isTauriEnv) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("approve_action", {
          payload: {
            card_id: card.card_id,
            decision: "approved",
            adjusted_qty: null,
            notes: "Autorizado por el administrador"
          }
        });
      }
      setApprovedCards((prev) => [...prev, card.card_id]);
      setStatusMessage(`Orden para "${card.product_name}" autorizada y registrada.`);
      
      // Xox reacciona con alegría a la aprobación HITL
      setXoxState("success");
      setXoxMessage(`¡Orden de ${card.product_name} autorizada y firmada!`);
      setTimeout(() => {
        setXoxState("idle");
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 3500);

      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage("Error al procesar la aprobación.");
    }
  };

  const runPromptQuery = (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || xoxState === "thinking") return;

    setInputPrompt("");
    setAttachments([]);

    // Activar estado de pensamiento de Xox
    setXoxState("thinking");
    setXoxMessage(`Analizando: "${query}"...`);

    // Fases de pensamiento de Xox
    setTimeout(() => {
      setXoxMessage("Consultando reglas activas y niveles de stock...");
    }, 900);

    setTimeout(() => {
      setXoxMessage("Verificando límites de presupuesto y proveedores...");
    }, 1900);

    setTimeout(() => {
      setXoxState("success");
      setXoxMessage("¡Análisis completado! He evaluado las directivas.");
      setStatusMessage(`Instrucción procesada con éxito por Xox.`);

      setTimeout(() => {
        setXoxState("idle");
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4000);

      setTimeout(() => setStatusMessage(null), 4500);
    }, 3000);
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
  };

  const mainSummonHandlerRef = useRef<(payload: MainSummonEventPayload) => void>(() => {});
  mainSummonHandlerRef.current = (payload) => {
    const { seq, prompt, autoRun, responseText } = payload ?? {};
    setSummonSeq(seq ?? Date.now());
    requestAnimationFrame(() => inputRef.current?.focus());

    if (responseText) {
      setXoxState("success");
      setXoxMessage(responseText);
      if (prompt) setStatusMessage(`Continuando desde Quick Bar: "${prompt}"`);
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
  const xoxBusy = xoxState === "thinking" || xoxState === "reading" || xoxState === "syncing";

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

  const pendingCards = cards.filter(c => !approvedCards.includes(c.card_id));
  const completedCards = cards.filter(c => approvedCards.includes(c.card_id));
  const pendingCount = pendingCards.length;

  // Estados de presencia animada para ventanas laterales y emergentes (entrada y salida)
  const leftPresence = useAnimatedPresence(showLeftSidebar, 270);
  const rightPresence = useAnimatedPresence(showRightSidebar, 270);

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

        {/* Lado Derecho: Toggle de Tareas y Decisiones */}
        <div className="flex items-center gap-2">
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
              
              {/* Cabecera del Panel */}
              <div className="p-3.5 border-b border-white/[0.06] flex items-center justify-between bg-[#0a0b10]">
                <div className="flex items-center space-x-2">
                  <FolderOpen className="w-4 h-4 text-zinc-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                    Contexto & Reglas
                  </h3>
                </div>
                <span className="text-[10px] text-zinc-400 font-mono bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded">
                  5.05k / 128k
                </span>
              </div>

              {/* Medidor de Consumo de Contexto */}
              <div className="px-3.5 py-2.5 bg-black/40 border-b border-white/[0.04]">
                <div className="flex justify-between text-[11px] text-zinc-400 mb-1.5">
                  <span>Capacidad del Modelo</span>
                  <span className="text-zinc-200 font-mono font-medium">4% Usado</span>
                </div>
                <div className="w-full bg-white/[0.06] h-1 rounded-full overflow-hidden">
                  <div className="bg-zinc-300 h-full w-[4%] rounded-full"></div>
                </div>
              </div>

              {/* Lista de Fuentes de Contexto */}
              <div className="p-3 border-b border-white/[0.06] space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-zinc-500 font-semibold uppercase tracking-wider px-1 pb-1">
                  <span>Fuentes Activas</span>
                  <button 
                    onClick={() => {
                      const newItem: ContextItem = {
                        id: `ctx_${Date.now()}`,
                        name: "catalogo-nuevo.json",
                        type: "catalog",
                        path: "context/business-profiles/catalogo.json",
                        tokens: "620 tokens",
                        pinned: true,
                        content: JSON.stringify({ "nota": "Nuevo catálogo de productos adjuntado." }, null, 2)
                      };
                      setContextItems(prev => [...prev, newItem]);
                      setSelectedContext(newItem);
                    }}
                    className="text-zinc-400 hover:text-white flex items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Agregar
                  </button>
                </div>

                {contextItems.map((item) => {
                  const isSelected = selectedContext?.id === item.id;
                  const friendlyLabel = CONTEXT_LABEL[item.type] || item.name;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedContext(item)}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? "bg-white/[0.08] border-white/20 text-white shadow-sm"
                          : "bg-white/[0.02] border-white/[0.05] text-zinc-400 hover:border-white/10 hover:text-zinc-200"
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 truncate">
                        <ContextIcon type={item.type} />
                        <div className="truncate">
                          <div className="font-medium text-zinc-200 truncate">{friendlyLabel}</div>
                          <div className="text-[10px] text-zinc-500 truncate font-mono">{item.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                        <span className="text-[10px] text-zinc-500 font-mono">{item.tokens}</span>
                        <Pin className="w-3 h-3 text-zinc-400" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Inspector de Archivo Seleccionado */}
              <div className="flex-1 flex flex-col overflow-hidden bg-black/30">
                {selectedContext ? (
                  <>
                    <div className="px-3.5 py-2 border-b border-white/[0.05] bg-[#0a0b10] flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-300 flex items-center gap-1.5 truncate">
                        <Eye className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="truncate">{CONTEXT_LABEL[selectedContext.type] || selectedContext.name}</span>
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 uppercase shrink-0">
                        {selectedContext.type}
                      </span>
                    </div>
                    <div className="flex-1 p-3 overflow-y-auto">
                      <pre className="text-[11px] font-mono text-zinc-300 bg-black/60 p-3 rounded-xl border border-white/[0.05] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {selectedContext.content}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 p-6 text-center">
                    Selecciona una fuente de contexto para inspeccionar su configuración.
                  </div>
                )}
              </div>

              {/* Pie del Panel de Contexto */}
              <div className="p-3 border-t border-white/[0.06] bg-[#0a0b10] text-[11px] text-zinc-400 flex items-center justify-between">
                <span>Almacenamiento Local</span>
                <span className="text-zinc-300 font-medium flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-400" /> Sincronizado
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

          {/* Área de Trabajo con Scroll: Xox Hero + Sección de Procesos / Tarjetas */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
            <div className="max-w-4xl mx-auto space-y-7">
              
              {/* ========================================================================= */}
              {/* 1. XOX DIGITAL COMPANION (LIMPIO, SIN TEXTO INVASIVO NI BOTONES PESADOS) */}
              {/* ========================================================================= */}
              <div className="flex flex-col items-center justify-center pt-2 pb-1 text-center">
                
                {/* Estrella Xox: más grande, con burbuja de diálogo flotante */}
                <div 
                  className="relative flex flex-col items-center justify-center cursor-pointer select-none -mb-4"
                  title="Haz clic para saludar a Xox"
                >
                  <XoxStar 
                    state={xoxState} 
                    size={280} 
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
                      {/* Estela de burbujitas hacia Xox, como la de "pensando" */}
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

                {/* Saludo Humano Simplificado */}
                <div className="space-y-2 max-w-lg flex flex-col items-center">
                  <h1 className="text-xl sm:text-2xl font-medium text-white tracking-tight">
                    ¿En qué puedo ayudarte?
                  </h1>

                  {/* Estado activo de Xox durante los procesos (pensando, leyendo, alertas...) */}
                  {xoxStatusPresence.mounted && (
                    <div
                      className={`${
                        isXoxStatusOpen ? "toast-in" : "toast-out pointer-events-none"
                      } inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-md`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        displayXoxStatus.state === "thinking" || displayXoxStatus.state === "reading"
                          ? "bg-cyan-400 animate-ping"
                          : displayXoxStatus.state === "success"
                          ? "bg-emerald-400"
                          : displayXoxStatus.state === "syncing"
                          ? "bg-teal-400 animate-pulse"
                          : displayXoxStatus.state === "alert"
                          ? "bg-red-500 animate-pulse"
                          : "bg-cyan-400"
                      }`} />
                      <p className={`text-xs ${
                        displayXoxStatus.busy ? "xox-shimmer font-medium" : displayXoxStatus.state === "alert" ? "text-red-300" : "text-zinc-300"
                      }`}>
                        {displayXoxStatus.message}
                      </p>
                    </div>
                  )}

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
                          {(["idle", "reading", "thinking", "syncing", "alert", "success"] as XoxState[]).map((s) => (
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

              {/* Espaciador inferior para que el último elemento pueda scrollear sobre el input fijo */}
              <div className="h-44 sm:h-48 shrink-0" />

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
            <div className="@container max-w-4xl mx-auto pointer-events-auto">
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
                        if (files.length) setAttachments((prev) => [...prev, ...files]);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Adjuntar archivos"
                      aria-label="Adjuntar archivos"
                      className="shrink-0 mb-0.5 w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.05] border border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.1] transition-all active:scale-95 cursor-pointer"
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
                      disabled={xoxState === "thinking"}
                      placeholder={
                        xoxState === "thinking"
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
                        className="h-8 inline-flex items-center gap-1.5 pl-2.5 pr-2 rounded-full text-[11px] text-zinc-300 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-colors cursor-pointer"
                      >
                        <Cpu className="w-3 h-3 text-zinc-400" />
                        <span className="hidden @sm:inline">{activeModel.name}</span>
                        <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${showModelMenu ? "rotate-180" : ""}`} />
                      </button>
                      {modelMenuPresence.mounted && (
                        <div
                          role="listbox"
                          className={`${
                            showModelMenu ? "menu-in" : "menu-out pointer-events-none"
                          } absolute right-0 bottom-full mb-2 w-52 p-1 rounded-xl bg-zinc-900/95 border border-white/10 shadow-2xl backdrop-blur-xl z-30`}
                        >
                          {MODELS.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              role="option"
                              aria-selected={m.id === modelId}
                              onClick={() => {
                                setModelId(m.id);
                                setShowModelMenu(false);
                                inputRef.current?.focus();
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                                m.id === modelId ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                              }`}
                            >
                              <span>
                                <span className="block text-xs text-zinc-100">{m.name}</span>
                                <span className="block text-[10px] text-zinc-500">{m.hint}</span>
                              </span>
                              {m.id === modelId && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!inputPrompt.trim() || xoxState === "thinking"}
                      className="shrink-0 mb-0.5 bg-white hover:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-white text-zinc-950 p-2 rounded-xl transition-all active:scale-95 cursor-pointer shadow-md disabled:cursor-not-allowed"
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
                        className={`h-7 inline-flex items-center gap-1.5 pl-2.5 pr-2 rounded-full text-[11px] border transition-colors cursor-pointer ${
                          activeContextCount > 0 || showContextMenu
                            ? "bg-white/[0.08] border-white/15 text-white"
                            : "bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06] text-zinc-400 hover:text-white"
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
              <aside
                style={{ width: `${rightWidth}px` }}
                className="h-full bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
              >
            
            {/* Cabecera del Panel */}
            <div className="p-3.5 border-b border-white/[0.06] flex items-center justify-between bg-[#0a0b10]">
              <div className="flex items-center space-x-2">
                <ListTodo className="w-4 h-4 text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                  Tareas & Decisiones
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Modo Seguro</span>
              </div>
            </div>

            {/* Selector de Pestañas: Por Aceptar vs Hechas */}
            <div className="p-2 border-b border-white/[0.06] bg-black/40 flex gap-1">
              <button
                type="button"
                onClick={() => setTaskTab("pending")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  taskTab === "pending"
                    ? "bg-white/[0.1] text-white shadow-sm border border-white/15"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Por aceptar</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-white/[0.08] text-zinc-300">
                  {pendingCards.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTaskTab("completed")}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  taskTab === "completed"
                    ? "bg-white/[0.1] text-white shadow-sm border border-white/15"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
                }`}
              >
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hechas</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-white/[0.08] text-zinc-300">
                  {completedCards.length}
                </span>
              </button>
            </div>

            {/* Contenido de Tareas (Scrollable) */}
            <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5">
              {taskTab === "pending" ? (
                pendingCards.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400/50 mb-1" />
                    <p className="text-xs text-zinc-300 font-medium">¡Todo al día!</p>
                    <p className="text-[11px] text-zinc-500 max-w-xs">
                      No tienes tareas pendientes por aceptar. Todo el inventario está en niveles óptimos.
                    </p>
                  </div>
                ) : (
                  pendingCards.map((card) => (
                    <div
                      key={card.card_id}
                      className="liquid-glass-card rounded-2xl p-4 flex flex-col justify-between space-y-3"
                    >
                      {/* Cabecera de la tarjeta: Urgencia y Stock */}
                      <div className="flex items-start justify-between">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                            card.urgency === "alta"
                              ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                              : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          }`}
                        >
                          Urgencia {card.urgency}
                        </span>
                        <span className="text-[11px] text-zinc-400 font-mono">
                          Stock: <strong className="text-zinc-200">{card.current_stock} un.</strong>
                        </span>
                      </div>

                      {/* Título y descripción */}
                      <div>
                        <h4 className="text-xs sm:text-sm font-semibold text-white tracking-tight">
                          {card.title}
                        </h4>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                          {card.description}
                        </p>
                      </div>

                      {/* Resumen de la orden sugerida */}
                      <div className="liquid-glass-inset rounded-xl p-2.5 space-y-1.5 text-xs">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400">Proveedor:</span>
                          <span className="font-medium text-zinc-200 truncate ml-2">{card.supplier_name}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-zinc-400">Reorden sugerida:</span>
                          <span className="font-medium text-zinc-100 font-mono">+{card.recommended_order} un.</span>
                        </div>
                        <div className="flex justify-between text-[11px] pt-1 border-t border-white/[0.05]">
                          <span className="text-zinc-400">Costo total:</span>
                          <span className="font-semibold text-white font-mono">
                            ${card.estimated_cost.toLocaleString()} {card.currency}
                          </span>
                        </div>
                      </div>

                      {/* Razonamiento */}
                      <div className="flex items-start gap-2 text-[11px] text-zinc-300 bg-white/[0.02] border border-white/[0.05] p-2.5 rounded-xl leading-relaxed">
                        <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
                        <span>{card.reasoning}</span>
                      </div>

                      {/* Botones de acción HITL */}
                      <div className="pt-2 flex gap-2">
                        <button
                          onClick={() => handleApprove(card)}
                          className="flex-1 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                        >
                          Aprobar Orden
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setCards(cards.filter(c => c.card_id !== card.card_id));
                          }}
                          className="bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 text-xs py-2 px-3 rounded-xl border border-white/[0.06] transition-colors cursor-pointer"
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  ))
                )
              ) : (
                completedCards.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
                    <Clock className="w-8 h-8 text-zinc-600 mb-1" />
                    <p className="text-xs text-zinc-300 font-medium">Sin historial aún</p>
                    <p className="text-[11px] text-zinc-500 max-w-xs">
                      Las órdenes que autorices aparecerán aquí registradas y firmadas.
                    </p>
                  </div>
                ) : (
                  completedCards.map((card) => (
                    <div
                      key={card.card_id}
                      className="liquid-glass-card rounded-2xl p-3.5 space-y-2 border-emerald-500/20 bg-emerald-950/[0.05]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Autorizada y Firmada</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono">Modo HITL</span>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-white">
                          {card.title}
                        </h4>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          +{card.recommended_order} unidades con {card.supplier_name}
                        </p>
                      </div>

                      <div className="flex justify-between items-center text-[11px] pt-1.5 border-t border-white/[0.05] font-mono text-zinc-400">
                        <span>Total orden:</span>
                        <span className="font-semibold text-zinc-200">
                          ${card.estimated_cost.toLocaleString()} {card.currency}
                        </span>
                      </div>
                    </div>
                  ))
                )
              )}
            </div>

            {/* Pie del Panel de Tareas */}
            <div className="p-3 border-t border-white/[0.06] bg-[#0a0b10] text-[11px] text-zinc-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Modo Seguro HITL</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500">Zero-Trust</span>
            </div>
              </aside>
            </div>
          </>
        )}

      </div>
    </div>
  );
}