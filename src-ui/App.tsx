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
  Sliders,
  X,
  FileText
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
  const [xoxMessage, setXoxMessage] = useState<string>("Vigilando inventario en tiempo real. ¿En qué te ayudo hoy?");
  
  // Estado para la Ventana de Contexto
  const [showContextDrawer, setShowContextDrawer] = useState<boolean>(true);
  const [selectedContext, setSelectedContext] = useState<ContextItem | null>(null);

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
        setXoxMessage("Vigilando inventario en tiempo real. ¿En qué te ayudo hoy?");
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
    setXoxMessage(`Xox está analizando tu instrucción: "${query}"...`);

    // Fases de pensamiento de Xox con los 12 principios de animación
    setTimeout(() => {
      setXoxMessage("Consultando reglas activas en @store-profile.json y niveles de stock...");
    }, 900);

    setTimeout(() => {
      setXoxMessage("Verificando límites de presupuesto y auditando proveedores...");
    }, 1900);

    setTimeout(() => {
      setXoxState("success");
      setXoxMessage("¡Análisis completado! He evaluado las directivas y el estado está sincronizado.");
      setStatusMessage(`Instrucción procesada con éxito por Xox.`);

      setTimeout(() => {
        setXoxState("idle");
        setXoxMessage("Vigilando inventario en tiempo real. ¿En qué te ayudo hoy?");
      }, 4000);

      setTimeout(() => setStatusMessage(null), 4500);
    }, 3000);
  };

  const handleXoxClick = () => {
    if (xoxState !== "idle") return;
    setXoxState("success");
    setXoxMessage("✨ ¡Hola! Soy Xox, tu copiloto estelar de orquestación.");
    setTimeout(() => {
      setXoxState("idle");
      setXoxMessage("Vigilando inventario en tiempo real. ¿En qué te ayudo hoy?");
    }, 3000);
  };

  const appendContextToPrompt = (name: string) => {
    setInputPrompt((prev) => (prev ? `${prev} @${name} ` : `@${name} `));
    inputRef.current?.focus();
  };

  const pendingCount = cards.filter(c => !approvedCards.includes(c.card_id)).length;

  return (
    <div className="h-screen w-screen bg-[#060709] text-zinc-100 flex flex-col font-sans select-none overflow-hidden antialiased">
      
      {/* 1. Header Minimalista & Stealth (Sin emojis, sin neón) */}
      <header className="h-12 border-b border-white/[0.06] bg-[#090a0f]/80 backdrop-blur-xl px-4 flex items-center justify-between shrink-0 z-20">
        
        {/* Identidad de Marca */}
        <div className="flex items-center space-x-3">
          <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shadow-inner">
            <XookGlyph className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs tracking-wider text-white">XOOK</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-zinc-400 font-mono border border-white/[0.06]">
              AGENTIC ORCHESTRATOR
            </span>
          </div>
        </div>

        {/* Chips de Contexto Activo (Monocromáticos y sutiles) */}
        <div className="hidden md:flex items-center space-x-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mr-1">
            Contexto Activo:
          </span>
          {contextItems.filter(c => c.pinned).map((item) => {
            const isSelected = selectedContext?.id === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setSelectedContext(item);
                  setShowContextDrawer(true);
                }}
                className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? "liquid-glass-pill-active"
                    : "liquid-glass-pill text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Pin className="w-2.5 h-2.5 text-zinc-400" />
                <span className="font-mono text-[11px]">@{item.name}</span>
              </button>
            );
          })}
        </div>

        {/* Controles de Estado y Toggle de Ventana de Contexto */}
        <div className="flex items-center space-x-2.5">
          {/* Micro Status de Xox */}
          <div 
            onClick={handleXoxClick}
            className="hidden sm:flex items-center space-x-1.5 text-xs bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] px-2.5 py-1 rounded-full cursor-pointer transition-colors"
            title="Xox Copiloto Estelar (Click para interactuar)"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              xoxState === "thinking" 
                ? "bg-cyan-400 animate-ping" 
                : xoxState === "success" 
                ? "bg-emerald-400" 
                : "bg-cyan-400"
            }`} />
            <span className="text-zinc-300 text-[11px] font-mono">Xox:</span>
            <span className="text-zinc-400 text-[11px] capitalize">
              {xoxState === "thinking" ? "Pensando..." : xoxState === "success" ? "Completado" : "Vigilando"}
            </span>
          </div>

          <div className="flex items-center space-x-2 text-xs bg-white/[0.03] border border-white/[0.06] px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span className="text-zinc-300 text-[11px] font-medium tracking-wide">Zero-Trust HITL</span>
          </div>

          <button
            onClick={() => setShowContextDrawer(!showContextDrawer)}
            className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-all cursor-pointer ${
              showContextDrawer 
                ? "bg-white/[0.1] text-white border-white/20 shadow-sm"
                : "bg-white/[0.03] text-zinc-400 border-white/[0.06] hover:text-zinc-200 hover:border-white/10"
            }`}
            title="Alternar Ventana de Contexto"
          >
            <Sliders className="w-3 h-3 text-zinc-300" />
            <span className="text-[11px] font-medium">Ventana de Contexto</span>
          </button>
        </div>
      </header>

      {/* 2. Cuerpo Principal */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* COLUMNA CENTRAL: Consola Principal + Tarjetas + Memoria */}
        <section className="flex-1 flex flex-col bg-[#060709] overflow-hidden">
          
          {/* Notificación de Sistema (Sutil, dark glass, sin neón) */}
          {statusMessage && (
            <div className="mx-6 mt-4 p-3 bg-zinc-900/95 border border-white/10 rounded-xl text-zinc-200 text-xs flex items-center justify-between shadow-2xl backdrop-blur-xl animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{statusMessage}</span>
              </div>
              <button 
                onClick={() => setStatusMessage(null)}
                className="text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Área de Trabajo con Scroll */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            
            {/* ========================================================================= */}
            {/* 1. XOX DIGITAL COMPANION (FLOTANDO LIBREMENTE ARRIBA DEL CHAT)           */}
            {/* ========================================================================= */}
            <div className="flex flex-col items-center justify-center pb-1 space-y-1">
              
              {/* Xox: Estrella de 5 picos redondeada, flotante y sin ningún contenedor */}
              <div className="relative flex flex-col items-center -my-3">
                <XoxStar 
                  state={xoxState} 
                  size={150} 
                  onClick={handleXoxClick}
                />
              </div>

              {/* Estado y Pensamiento de Xox (Limpio, tipografía etérea, sin caja pesada) */}
              <div className="flex flex-col items-center text-center space-y-1 max-w-lg">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full transition-all ${
                    xoxState === "thinking" 
                      ? "bg-cyan-400 animate-ping" 
                      : xoxState === "success" 
                      ? "bg-emerald-400" 
                      : xoxState === "alert" 
                      ? "bg-amber-400" 
                      : "bg-cyan-400/80"
                  }`} />
                  <span className="text-[11px] font-mono tracking-widest uppercase text-zinc-400 font-medium">
                    {xoxState === "thinking" ? "Xox Pensando..." : xoxState === "success" ? "Xox Sincronizado" : "Xox Activo"}
                  </span>
                </div>
                <p className={`text-xs transition-all duration-300 leading-relaxed ${
                  xoxState === "thinking" ? "text-cyan-300 font-medium animate-pulse" : "text-zinc-400"
                }`}>
                  {xoxMessage}
                </p>
              </div>

            </div>

            {/* ========================================================================= */}
            {/* 2. CONSOLA DE INSTRUCCIÓN & ORQUESTACIÓN (LIQUID GLASS HERO)              */}
            {/* ========================================================================= */}
            <div className="liquid-glass-hero rounded-2xl p-4 sm:p-5 relative overflow-hidden group shadow-2xl">
              {/* Reflejo especular superior tenue */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />

              {/* Cabecera de la consola de comando */}
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-white/[0.05]">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="font-medium tracking-wide text-zinc-300">
                    Consola de Instrucción & Orquestación
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-500">Gemini 2.5 Pro · HITL Enabled</span>
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 bg-white/[0.04] border border-white/[0.08] rounded">
                    ⌘K
                  </kbd>
                </div>
              </div>

              {/* Formulario Principal de Entrada */}
              <form onSubmit={handlePromptSubmit} className="space-y-3">
                <div className="relative flex items-center">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputPrompt}
                    onChange={(e) => setInputPrompt(e.target.value)}
                    disabled={xoxState === "thinking"}
                    placeholder={
                      xoxState === "thinking" 
                        ? "Xox está procesando tu instrucción en segundo plano..." 
                        : "Instruye a Xox, formula consultas o escribe @ para inyectar contexto..."
                    }
                    className="w-full bg-transparent text-sm sm:text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1 pr-12 font-normal disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!inputPrompt.trim() || xoxState === "thinking"}
                    className="absolute right-0 bg-white hover:bg-zinc-200 disabled:opacity-30 disabled:hover:bg-white text-zinc-950 p-2 rounded-xl transition-all active:scale-95 cursor-pointer shadow-md disabled:cursor-not-allowed"
                    title="Enviar instrucción a Xox (Enter)"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Accesos rápidos de contexto y sugerencias en Liquid Glass */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.04]">
                  {/* Inserción rápida de @contexto */}
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 overflow-x-auto">
                    <span className="text-[10px] text-zinc-500 uppercase font-mono">Inyectar:</span>
                    {contextItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => appendContextToPrompt(item.name)}
                        className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-white border border-white/[0.06] transition-colors cursor-pointer"
                      >
                        @{item.name}
                      </button>
                    ))}
                  </div>

                  {/* Sugerencias Rápidas */}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setInputPrompt("¿Cuál es el proveedor más rápido para reponer café?")}
                      className="px-2.5 py-0.5 rounded-full bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 border border-white/[0.05] transition-colors cursor-pointer"
                    >
                      ¿Proveedor más rápido?
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputPrompt("Auditar si alguna orden supera los $50,000 MXN de límite")}
                      className="px-2.5 py-0.5 rounded-full bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 border border-white/[0.05] transition-colors cursor-pointer"
                    >
                      Auditar límite de presupuesto
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Banner de Estado Operativo (Sobrio, fondo oscuro, sin resplandores) */}
            <div className="liquid-glass-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                  Panel Operativo del Administrador
                </h2>
                <p className="text-xs text-zinc-400 mt-1 max-w-xl leading-relaxed">
                  Supervisión continua con habilidad <span className="text-zinc-200 font-mono">@inventory-advisor</span>. Ninguna mutación se ejecuta sin tu firma digital explícita.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] bg-black/40 border border-white/[0.06] px-3 py-1.5 rounded-lg text-zinc-300 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium">Modo Seguro HITL</span>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* 2. TARJETAS DE DECISIÓN REQUERIDAS (Sin neón, estética oscura de lujo)   */}
            {/* ========================================================================= */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Tarjetas de Decisión Requeridas
                  </h3>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.04] text-zinc-300 font-mono border border-white/[0.08]">
                    {pendingCount} {pendingCount === 1 ? "pendiente" : "pendientes"}
                  </span>
                </div>
              </div>

              {cards.length === 0 ? (
                <div className="border border-dashed border-white/[0.08] rounded-xl p-10 text-center text-zinc-500 text-xs">
                  Todo tu inventario está en niveles óptimos. No se requieren acciones en este momento.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {cards.map((card) => {
                    const isApproved = approvedCards.includes(card.card_id);
                    return (
                      <div
                        key={card.card_id}
                        className={`liquid-glass-card rounded-2xl p-5 flex flex-col justify-between transition-all ${
                          isApproved ? "opacity-60" : ""
                        }`}
                      >
                        <div className="space-y-3.5">
                          {/* Cabecera de la tarjeta: Urgencia y Stock */}
                          <div className="flex items-start justify-between">
                            <span
                              className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                                card.urgency === "alta"
                                  ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                                  : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                              }`}
                            >
                              Urgencia {card.urgency}
                            </span>
                            <span className="text-xs text-zinc-400 font-mono">
                              Stock en bodega: <strong className="text-zinc-100">{card.current_stock} un.</strong>
                            </span>
                          </div>

                          {/* Título y descripción */}
                          <div>
                            <h4 className="text-sm sm:text-base font-semibold text-white tracking-tight">
                              {card.title}
                            </h4>
                            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                              {card.description}
                            </p>
                          </div>

                          {/* Resumen de la orden sugerida (Fondo ultra-oscuro y datos limpios) */}
                          <div className="liquid-glass-inset rounded-xl p-3.5 space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Proveedor sugerido:</span>
                              <span className="font-medium text-zinc-200">{card.supplier_name}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Cantidad recomendada:</span>
                              <span className="font-medium text-zinc-100 font-mono">+{card.recommended_order} unidades</span>
                            </div>
                            <div className="flex justify-between text-xs pt-1.5 border-t border-white/[0.05]">
                              <span className="text-zinc-400">Costo total proyectado:</span>
                              <span className="font-semibold text-white font-mono text-sm">
                                ${card.estimated_cost.toLocaleString()} {card.currency}
                              </span>
                            </div>
                          </div>

                          {/* Razonamiento formulado por el agente */}
                          <div className="flex items-start gap-2.5 text-xs text-zinc-300 bg-white/[0.02] border border-white/[0.05] p-3 rounded-xl leading-relaxed">
                            <Sparkles className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
                            <span>{card.reasoning}</span>
                          </div>
                        </div>

                        {/* Botones de acción Human-in-the-Loop */}
                        <div className="pt-4 mt-4 border-t border-white/[0.05] flex items-center justify-between">
                          {isApproved ? (
                            <div className="w-full py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-zinc-300 text-xs font-medium flex items-center justify-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              Orden Autorizada y Firmada
                            </div>
                          ) : (
                            <div className="w-full flex gap-2">
                              <button
                                onClick={() => handleApprove(card)}
                                className="flex-1 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 cursor-pointer"
                              >
                                Aprobar Orden
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setCards(cards.filter(c => c.card_id !== card.card_id));
                                }}
                                className="bg-white/[0.03] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 text-xs py-2.5 px-3.5 rounded-xl border border-white/[0.06] transition-colors cursor-pointer"
                              >
                                Descartar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ========================================================================= */}
            {/* 3. MEMORIA APRENDIDA DEL ASISTENTE (Sobria, datos limpios, sin neón)       */}
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

          </div>

        </section>

        {/* ========================================================================= */}
        {/* 4. VENTANA DE CONTEXTO (DRAWER LATERAL EN OBSIDIANA OSCURA)               */}
        {/* ========================================================================= */}
        {showContextDrawer && (
          <aside className="w-80 md:w-96 border-l border-white/[0.06] bg-[#08090d] flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
            
            {/* Cabecera del Panel */}
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0a0b10]">
              <div className="flex items-center space-x-2">
                <FolderOpen className="w-4 h-4 text-zinc-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                  Ventana de Contexto
                </h3>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded">
                5.05k / 128k
              </span>
            </div>

            {/* Medidor de Consumo de Contexto */}
            <div className="px-4 py-2.5 bg-black/40 border-b border-white/[0.04]">
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
                <span>Archivos Fijados</span>
                <button 
                  onClick={() => {
                    const newItem: ContextItem = {
                      id: `ctx_${Date.now()}`,
                      name: "nuevo-catalogo.json",
                      type: "catalog",
                      path: "context/business-profiles/catalogo.json",
                      tokens: "620 tokens",
                      pinned: true,
                      content: JSON.stringify({ "nota": "Nuevo catálogo de productos adjuntado al contexto activo." }, null, 2)
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
                        <div className="font-medium text-zinc-200 truncate">{item.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate font-mono">{item.path}</div>
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
                  <div className="px-4 py-2 border-b border-white/[0.05] bg-[#0a0b10] flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-300 flex items-center gap-1.5 truncate">
                      <Eye className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">Inspeccionar: {selectedContext.name}</span>
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
                  Selecciona una fuente de contexto arriba para ver su contenido activo.
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
        )}

      </div>
    </div>
  );
}