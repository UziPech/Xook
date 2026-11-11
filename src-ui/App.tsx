import { useState, useEffect } from "react";
import { 
  ShieldCheck, 
  CheckCircle, 
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
  Sliders
} from "lucide-react";

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

export default function App() {
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [approvedCards, setApprovedCards] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  
  // Estado para la "Ventana de Contexto" (estilo Antigravity / Gemini)
  const [showContextDrawer, setShowContextDrawer] = useState<boolean>(true);
  const [selectedContext, setSelectedContext] = useState<ContextItem | null>(null);

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
    // Seleccionar por defecto el primer contexto
    setSelectedContext(contextItems[0]);
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
      setStatusMessage(`✅ Orden para "${card.product_name}" autorizada y registrada en la memoria local.`);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage("Error al procesar la aprobación.");
    }
  };

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPrompt.trim()) return;
    setStatusMessage(`Instrucción recibida: "${inputPrompt}". Xook está procesando con el contexto activo...`);
    setInputPrompt("");
    setTimeout(() => setStatusMessage(null), 4000);
  };

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none overflow-hidden">
      {/* 1. Barra Superior Global */}
      <header className="h-13 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 flex items-center justify-center text-lg font-black text-cyan-400 shadow-sm shadow-cyan-950/50">
            🦈
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm tracking-tight text-white">XOOK</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono border border-zinc-700/60">
              Agentic Orchestrator
            </span>
          </div>
        </div>

        {/* Chips de Contexto Activo (estilo Antigravity / Gemini) */}
        <div className="hidden md:flex items-center space-x-2">
          <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold mr-1">Contexto Activo:</span>
          {contextItems.filter(c => c.pinned).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSelectedContext(item);
                setShowContextDrawer(true);
              }}
              className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-all ${
                selectedContext?.id === item.id
                  ? "bg-cyan-950/60 border-cyan-500/50 text-cyan-300 shadow-sm shadow-cyan-950"
                  : "bg-zinc-900/80 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white"
              }`}
            >
              <Pin className="w-3 h-3 text-cyan-400" />
              <span>@{item.name}</span>
            </button>
          ))}
        </div>

        {/* Controles de Estado y Toggle de Ventana de Contexto */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-xs bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-zinc-300 text-[11px] font-medium">Zero-Trust HITL</span>
          </div>

          <button
            onClick={() => setShowContextDrawer(!showContextDrawer)}
            className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
              showContextDrawer 
                ? "bg-cyan-500 text-black font-semibold border-cyan-400"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-700"
            }`}
            title="Abrir o cerrar la Ventana de Contexto (como Antigravity)"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Ventana de Contexto</span>
          </button>
        </div>
      </header>

      {/* 2. Cuerpo Principal (Layout de 2 Columnas: Feed Central + Ventana de Contexto Lateral) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* COLUMNA CENTRAL: Feed de Trabajo, Tarjetas de Decisión y Chat */}
        <section className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
          
          {/* Notificación temporal de acción */}
          {statusMessage && (
            <div className="m-4 mb-0 p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-xl text-cyan-300 text-xs flex items-center justify-between shadow-lg backdrop-blur">
              <span>{statusMessage}</span>
              <CheckCircle className="w-4 h-4 text-cyan-400 shrink-0" />
            </div>
          )}

          {/* Área con scroll para el trabajo del asistente */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Banner de Bienvenida y Estado */}
            <div className="border border-zinc-800/80 bg-zinc-900/40 rounded-2xl p-5 relative overflow-hidden backdrop-blur">
              <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"></div>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    Panel Operativo del Administrador
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 max-w-xl leading-relaxed">
                    Xook supervisa el almacén en segundo plano mediante la habilidad <span className="text-cyan-400 font-mono">@inventory-advisor</span> y el contexto de tu empresa. Ninguna mutación se ejecuta sin tu confirmación.
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[11px] bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-lg text-zinc-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Modo Seguro Activo</span>
                </div>
              </div>
            </div>

            {/* Sección: Tarjetas de Decisión Pendientes */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                    Tarjetas de Decisión Requeridas
                  </h3>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                    {cards.filter(c => !approvedCards.includes(c.card_id)).length} pendientes
                  </span>
                </div>
              </div>

              {cards.length === 0 ? (
                <div className="border border-dashed border-zinc-800 rounded-xl p-10 text-center text-zinc-500 text-sm">
                  Todo tu inventario está en niveles óptimos. No se requieren acciones en este momento.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {cards.map((card) => {
                    const isApproved = approvedCards.includes(card.card_id);
                    return (
                      <div
                        key={card.card_id}
                        className={`border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                          isApproved
                            ? "bg-zinc-900/30 border-emerald-900/40 opacity-75"
                            : "bg-zinc-900/70 border-zinc-800 hover:border-zinc-700/80 shadow-xl shadow-black/40"
                        }`}
                      >
                        <div className="space-y-3.5">
                          {/* Cabecera de la tarjeta */}
                          <div className="flex items-start justify-between">
                            <span
                              className={`text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                                card.urgency === "alta"
                                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              }`}
                            >
                              Urgencia {card.urgency}
                            </span>
                            <span className="text-xs text-zinc-400 font-mono">
                              Stock en bodega: <strong className="text-white">{card.current_stock} un.</strong>
                            </span>
                          </div>

                          {/* Título y descripción */}
                          <div>
                            <h4 className="text-base font-semibold text-white tracking-tight">{card.title}</h4>
                            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{card.description}</p>
                          </div>

                          {/* Resumen de la orden sugerida */}
                          <div className="bg-zinc-950/70 rounded-xl p-3.5 border border-zinc-800/80 space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Proveedor sugerido:</span>
                              <span className="font-medium text-zinc-200">{card.supplier_name}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Cantidad recomendada:</span>
                              <span className="font-bold text-cyan-400">+{card.recommended_order} unidades</span>
                            </div>
                            <div className="flex justify-between text-xs pt-1.5 border-t border-zinc-800/80">
                              <span className="text-zinc-400">Costo total proyectado:</span>
                              <span className="font-bold text-emerald-400 text-sm">
                                ${card.estimated_cost.toLocaleString()} {card.currency}
                              </span>
                            </div>
                          </div>

                          {/* Razón explicada en lenguaje humano */}
                          <div className="flex items-start gap-2 text-xs text-zinc-300 bg-cyan-950/20 border border-cyan-800/30 p-3 rounded-xl">
                            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                            <span className="leading-relaxed">{card.reasoning}</span>
                          </div>
                        </div>

                        {/* Botones de acción Human-in-the-Loop */}
                        <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between">
                          {isApproved ? (
                            <div className="w-full py-2.5 bg-emerald-950/50 border border-emerald-800/50 rounded-xl text-emerald-400 text-xs font-semibold flex items-center justify-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              Orden Autorizada y Firmada
                            </div>
                          ) : (
                            <div className="w-full flex gap-2">
                              <button
                                onClick={() => handleApprove(card)}
                                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 cursor-pointer"
                              >
                                Aprobar Orden
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setCards(cards.filter(c => c.card_id !== card.card_id));
                                }}
                                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs py-2.5 px-3 rounded-xl transition-colors cursor-pointer"
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

            {/* Sección: Memoria Aprendida en Resumen */}
            <div className="border border-zinc-800/80 bg-zinc-900/30 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <Brain className="w-4 h-4 text-cyan-400" />
                Aprendizaje Reciente del Asistente
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {patterns.map((p) => (
                  <div key={p.pattern_id} className="p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-1">
                    <p className="text-xs text-zinc-300">{p.description}</p>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 font-mono">
                      <span>Confianza</span>
                      <span className="text-cyan-400 font-bold">{Math.round(p.confidence * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Input de Instrucción Inferior (Prompt Bar estilo Gemini) */}
          <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/40 backdrop-blur">
            <form onSubmit={handlePromptSubmit} className="relative flex items-center">
              <input
                type="text"
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                placeholder="Escribe una instrucción para Xook o escribe @ para invocar contexto..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-4 pr-24 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/70 transition-colors"
              />
              <div className="absolute right-2 flex items-center space-x-1">
                <button
                  type="submit"
                  disabled={!inputPrompt.trim()}
                  className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 text-black p-2 rounded-lg transition-all active:scale-95 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-zinc-500 overflow-x-auto">
              <span>Sugerencias rápidas:</span>
              <button
                type="button"
                onClick={() => setInputPrompt("¿Cuál es el proveedor más rápido para reponer café?")}
                className="bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 px-2.5 py-0.5 rounded-full border border-zinc-700/40 transition-colors cursor-pointer"
              >
                ¿Proveedor más rápido?
              </button>
              <button
                type="button"
                onClick={() => setInputPrompt("Auditar si alguna orden supera los $50,000 MXN de límite")}
                className="bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 px-2.5 py-0.5 rounded-full border border-zinc-700/40 transition-colors cursor-pointer"
              >
                Revisar límite de presupuesto
              </button>
            </div>
          </div>

        </section>

        {/* 3. VENTANA DE CONTEXTO (Drawer / Lateral Derecho estilo Antigravity / Gemini) */}
        {showContextDrawer && (
          <aside className="w-80 md:w-96 border-l border-zinc-800/80 bg-zinc-900/80 flex flex-col shrink-0 animate-in slide-in-from-right duration-200">
            
            {/* Cabecera del Panel de Contexto */}
            <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900">
              <div className="flex items-center space-x-2">
                <FolderOpen className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Ventana de Contexto
                </h3>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800 px-2 py-0.5 rounded">
                5.05k / 128k
              </span>
            </div>

            {/* Barra de Consumo de Contexto (Visual como en Antigravity) */}
            <div className="px-4 py-2 bg-zinc-950/60 border-b border-zinc-800/60">
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                <span>Capacidad del Modelo</span>
                <span className="text-cyan-400 font-mono font-bold">4% Usado</span>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-400 to-emerald-400 h-full w-[4%]"></div>
              </div>
            </div>

            {/* Lista de Fuentes de Contexto */}
            <div className="p-3 border-b border-zinc-800/80 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-semibold px-1 pb-1">
                <span>ARCHIVOS DE CONTEXTO FIJADOS</span>
                <button 
                  onClick={() => {
                    const newItem: ContextItem = {
                      id: `ctx_${Date.now()}`,
                      name: "nuevo-catalogo.json",
                      type: "catalog",
                      path: "context/business-profiles/catalogo.json",
                      tokens: "620 tokens",
                      pinned: true,
                      content: JSON.stringify({ "nota": "Nuevo catálogo de productos adjuntado al contexto." }, null, 2)
                    };
                    setContextItems(prev => [...prev, newItem]);
                    setSelectedContext(newItem);
                  }}
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[10px] cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Agregar
                </button>
              </div>

              {contextItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedContext(item)}
                  className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                    selectedContext?.id === item.id
                      ? "bg-zinc-800/90 border-cyan-500/50 text-white shadow-sm"
                      : "bg-zinc-950/40 border-zinc-800/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    {item.type === "profile" && <Store className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    {item.type === "memory" && <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                    {item.type === "skill" && <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    <div className="truncate">
                      <div className="font-semibold text-zinc-200 truncate">{item.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate font-mono">{item.path}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                    <span className="text-[10px] text-zinc-500 font-mono">{item.tokens}</span>
                    <Pin className="w-3 h-3 text-cyan-400" />
                  </div>
                </div>
              ))}
            </div>

            {/* Visor Inspector de Contexto Seleccionado */}
            <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950/50">
              {selectedContext ? (
                <>
                  <div className="px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-900/50 flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      Inspeccionar: {selectedContext.name}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">{selectedContext.type}</span>
                  </div>
                  <div className="flex-1 p-3 overflow-y-auto">
                    <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 overflow-x-auto whitespace-pre-wrap leading-relaxed">
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
            <div className="p-3 border-t border-zinc-800/80 bg-zinc-900/90 text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Almacenamiento Local</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" /> Sincronizado
              </span>
            </div>

          </aside>
        )}

      </div>
    </div>
  );
}
