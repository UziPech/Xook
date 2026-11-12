import React, { useState, useEffect, useRef } from "react";
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
  PanelLeft
} from "lucide-react";
import { XoxStar, XoxState } from "./components/XoxStar";

interface ActionCard {
  card_id: string;
  title: string;
  description: string;
  urgency: "alta" | "media" | "baja";
  product_name: string;
  current_stock: number;
  recommended_order: number;
  estimated_cost: number;
  currency: string;
  supplier_name: string;
  reasoning: string;
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

// Emblema geométrico vectorial Xook (sin emojis, estética stealth y titanio)
function XookGlyph({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M4 19C7 19 11.5 17 14 13.5C16.5 10 18.5 4 18.5 4C18.5 4 14.5 7.5 11 11C8.2 13.8 5.5 16.5 4 19Z"
        fill="url(#xook-grad-fin)"
      />
      <path
        d="M7 19C10 19 13.5 17.5 15.5 14.5C13.5 15.5 10.5 16.5 7 19Z"
        fill="#FFFFFF"
        opacity="0.3"
      />
      <defs>
        <linearGradient id="xook-grad-fin" x1="4" y1="4" x2="18.5" y2="19" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.6" stopColor="#A1A1AA" />
          <stop offset="1" stopColor="#52525B" />
        </linearGradient>
      </defs>
    </svg>
  );
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

  const inputRef = useRef<HTMLInputElement>(null);

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
        setCards([
          {
            card_id: "card_cafe_01",
            title: "Reponer Café Chiapas 500g",
            description: "El stock actual (4 bolsas) se agotará en aproximadamente 2 días.",
            urgency: "alta",
            product_name: "Café de Grano Chiapas 500g",
            current_stock: 4,
            recommended_order: 20,
            estimated_cost: 1400.0,
            currency: "MXN",
            supplier_name: "Distribuidora del Sur",
            reasoning: "Venta promedio de 2 un./día. Se sugiere reponer 15 días de stock para evitar desabasto."
          },
          {
            card_id: "card_te_02",
            title: "Reabastecer Té Matcha 100g",
            description: "Quedan 6 unidades en bodega. El proveedor tarda 5 días hábiles en entregar.",
            urgency: "media",
            product_name: "Té Matcha Premium 100g",
            current_stock: 6,
            recommended_order: 15,
            estimated_cost: 2250.0,
            currency: "MXN",
            supplier_name: "Comercializadora Bajío",
            reasoning: "Plazo de entrega de 5 días. Si se espera al viernes habrá quiebre de stock."
          }
        ]);
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

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim() || xoxState === "thinking") return;
    
    const query = inputPrompt;
    setInputPrompt("");
    
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

  const handleXoxClick = () => {
    if (xoxState !== "idle") return;
    setXoxState("success");
    setXoxMessage("✨ ¡Hola! Soy Xox, tu copiloto de inventario.");
    setTimeout(() => {
      setXoxState("idle");
      setXoxMessage("¿En qué puedo ayudarte?");
    }, 3000);
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
                ? "bg-white/[0.1] text-white border-white/20 shadow-sm"
                : "bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:text-zinc-200 hover:border-white/10"
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

          <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-inner">
            <XookGlyph className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs tracking-wider text-white">XOOK</span>
          <span
            role="img"
            aria-label="Modo seguro: toda mutación requiere tu aprobación"
            className="hidden sm:flex items-center pl-2.5 ml-0.5 border-l border-white/[0.08]"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-400/80" />
          </span>
        </div>

        {/* Lado Derecho: Toggle de Tareas y Decisiones */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRightSidebar(!showRightSidebar)}
            aria-pressed={showRightSidebar}
            title={showRightSidebar ? "Ocultar panel de tareas" : "Mostrar panel de tareas"}
            className={`text-xs pl-2.5 pr-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
              showRightSidebar
                ? "bg-white/[0.1] text-white border-white/20 shadow-sm"
                : "bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:text-zinc-200 hover:border-white/10"
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span className="text-[11px] font-medium hidden sm:inline">Tareas</span>
            {pendingCount > 0 ? (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 tabular-nums">
                {pendingCount}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
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
        {showLeftSidebar && (
          <>
            <aside 
              style={{ width: `${leftWidth}px` }} 
              className="bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
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
                        {item.type === "profile" && <Store className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                        {item.type === "memory" && <Brain className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                        {item.type === "skill" && <Zap className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                        {item.type === "catalog" && <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
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

            {/* Separador redimensionable izquierdo (Splitter Aurora de Vidrio) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingLeft(true);
              }}
              onDoubleClick={() => setLeftWidth(280)}
              className={`splitter-aurora-glass ${isResizingLeft ? "is-resizing" : ""}`}
            >
              {/* Zona de captura ampliada invisible para fácil arrastre */}
              <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            </div>
          </>
        )}

        {/* COLUMNA CENTRAL: Xox + Conversación + Input Pinned al fondo */}
        <section className="flex-1 flex flex-col bg-[#060709] overflow-hidden relative">
          
          {/* Notificación de Sistema: flota sobre el contenido, no lo desplaza */}
          {statusMessage && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-4"
            >
              <div className="toast-in pointer-events-auto bg-zinc-900/95 border border-white/10 rounded-xl px-3.5 py-2.5 text-zinc-200 text-xs flex items-center gap-3 shadow-2xl backdrop-blur-xl max-w-lg">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{statusMessage}</span>
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
                
                {/* Estrella Xox: Tamaño armónico, sin contenedor rígido, animación intacta */}
                <div 
                  className="relative flex flex-col items-center justify-center cursor-pointer select-none -mb-3"
                  onClick={handleXoxClick}
                  title="Haz clic para saludar a Xox"
                >
                  <XoxStar 
                    state={xoxState} 
                    size={210} 
                    onClick={handleXoxClick}
                  />
                </div>

                {/* Saludo Humano Simplificado */}
                <div className="space-y-2 max-w-lg flex flex-col items-center">
                  <h1 className="text-xl sm:text-2xl font-medium text-white tracking-tight">
                    ¿En qué puedo ayudarte?
                  </h1>

                  {/* Estado activo de Xox (solo visible cuando está pensando, sincronizando o alertando) */}
                  {xoxState !== "idle" && (
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-md">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        xoxState === "thinking" || xoxState === "reading"
                          ? "bg-cyan-400 animate-ping" 
                          : xoxState === "success" 
                          ? "bg-emerald-400" 
                          : xoxState === "syncing"
                          ? "bg-teal-400 animate-pulse"
                          : xoxState === "alert" 
                          ? "bg-red-500 animate-pulse" 
                          : "bg-cyan-400"
                      }`} />
                      <p className={`text-xs ${
                        xoxBusy ? "xox-shimmer font-medium" : xoxState === "alert" ? "text-red-300" : "text-zinc-300"
                      }`}>
                        {xoxMessage}
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
                      {showStatePreview && (
                        <div className="flex flex-wrap items-center justify-center gap-1 pt-1.5">
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

              {/* ========================================================================= */}
              {/* MEMORIA Y APRENDIZAJE RECIENTE DE LA TIENDA                              */}
              {/* ========================================================================= */}
              <div className="liquid-glass-card rounded-2xl p-5 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-zinc-400" />
                  <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Aprendizaje Reciente del Asistente
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {patterns.map((p) => (
                    <div key={p.pattern_id} className="p-3.5 liquid-glass-inset rounded-xl space-y-2">
                      <p className="text-xs text-zinc-300 leading-relaxed">{p.description}</p>
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 font-mono border-t border-white/[0.04]">
                        <span>Nivel de Confianza</span>
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-white/[0.08] h-1 rounded-full overflow-hidden">
                            <div 
                              className="bg-zinc-300 h-full rounded-full" 
                              style={{ width: `${Math.round(p.confidence * 100)}%` }} 
                            />
                          </div>
                          <span className="text-zinc-200 font-semibold">{Math.round(p.confidence * 100)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Espaciador inferior para que el último elemento pueda scrollear sobre el input fijo */}
              <div className="h-44 sm:h-48 shrink-0" />

            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. INPUT / CHAT FIJO EN LA PARTE INFERIOR (PINNED DOCK)                    */}
          {/* ========================================================================= */}
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-[#060709] via-[#060709]/95 to-transparent pointer-events-none z-10">
            <div className="max-w-4xl mx-auto pointer-events-auto">
              <div className="liquid-glass-hero rounded-2xl p-3 sm:p-4 relative overflow-hidden group shadow-2xl">
                {/* Reflejo especular superior tenue */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />
                {/* Barrido de luz de encendido */}
                <span aria-hidden="true" className="console-sweep" />

                {/* Formulario Principal de Entrada */}
                <form onSubmit={handlePromptSubmit} className="space-y-2.5">
                  <div className="relative flex items-center">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputPrompt}
                      onChange={(e) => setInputPrompt(e.target.value)}
                      disabled={xoxState === "thinking"}
                      placeholder={
                        xoxState === "thinking" 
                          ? "Xox está procesando tu consulta..." 
                          : "Escribe a Xox o haz una consulta sobre inventario..."
                      }
                      className="w-full bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1.5 pl-2 pr-12 font-normal disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!inputPrompt.trim() || xoxState === "thinking"}
                      className="absolute right-1 bg-white hover:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-white text-zinc-950 p-2 rounded-xl transition-all active:scale-95 cursor-pointer shadow-md disabled:cursor-not-allowed"
                      title="Enviar instrucción (Enter)"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Fila de utilidades: Contextos con etiquetas humanas + sugerencias rápidas + ⌘K */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono pr-0.5">
                        Contexto:
                      </span>
                      {contextItems.map((item) => {
                        const friendlyLabel = CONTEXT_LABEL[item.type] || item.name;
                        const isInPrompt = inputPrompt.includes(`@${item.name}`);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={isInPrompt}
                            onClick={() => toggleContextInPrompt(item.name)}
                            title={`${isInPrompt ? "Quitar" : "Añadir"} ${friendlyLabel}`}
                            className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                              isInPrompt
                                ? "bg-white/[0.12] border-white/25 text-white"
                                : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-white hover:bg-white/[0.08]"
                            }`}
                          >
                            {isInPrompt ? (
                              <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            ) : (
                              <>
                                {item.type === "profile" && <Store className="w-3 h-3 text-zinc-400 shrink-0" />}
                                {item.type === "memory" && <Brain className="w-3 h-3 text-zinc-400 shrink-0" />}
                                {item.type === "skill" && <Zap className="w-3 h-3 text-zinc-400 shrink-0" />}
                                {item.type === "catalog" && <FileText className="w-3 h-3 text-zinc-400 shrink-0" />}
                              </>
                            )}
                            <span>{friendlyLabel}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setInputPrompt("¿Cuál es el proveedor más rápido para reponer café?")}
                        className="px-2.5 py-1 rounded-full bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 border border-white/[0.05] transition-colors cursor-pointer"
                      >
                        ¿Proveedor más rápido?
                      </button>
                      <button
                        type="button"
                        onClick={() => setInputPrompt("Auditar si alguna orden supera los $50,000 MXN")}
                        className="px-2.5 py-1 rounded-full bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 border border-white/[0.05] transition-colors cursor-pointer"
                      >
                        Auditar presupuesto
                      </button>
                      <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-white/[0.03] border border-white/[0.06] rounded ml-1">
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
        {showRightSidebar && (
          <>
            {/* Separador redimensionable derecho (Splitter Aurora de Vidrio) */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizingRight(true);
              }}
              onDoubleClick={() => setRightWidth(340)}
              className={`splitter-aurora-glass ${isResizingRight ? "is-resizing" : ""}`}
            >
              {/* Zona de captura ampliada invisible para fácil arrastre */}
              <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
            </div>

            <aside 
              style={{ width: `${rightWidth}px` }} 
              className="bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
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
        </>
      )}

      </div>
    </div>
  );
}