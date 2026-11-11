import { useState, useEffect } from "react";
import { 
  ShieldCheck, 
  Package, 
  CheckCircle, 
  Brain, 
  Store, 
  Sparkles,
  ArrowRight
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

export default function App() {
  const [activeTab, setActiveTab] = useState<"actions" | "memory" | "rules">("actions");
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [approvedCards, setApprovedCards] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(false);

  useEffect(() => {
    // Detectar si estamos corriendo dentro de Tauri o en navegador
    async function loadInitialData() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        setIsTauriEnv(true);
        const fetchedCards = await invoke<ActionCard[]>("get_mock_action_cards");
        const fetchedPatterns = await invoke<MemoryPattern[]>("get_learned_patterns");
        setCards(fetchedCards);
        setPatterns(fetchedPatterns);
      } catch {
        // Fallback para navegador web (desarrollo local)
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
    loadInitialData();
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
            notes: "Autorizado desde el panel de usuario"
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* Barra de Cabecera */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-xl font-black text-cyan-400">
            🦈
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              XOOK <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono">v1.0</span>
            </h1>
            <p className="text-xs text-zinc-400">Orquestador Agéntico de Negocio</p>
          </div>
        </div>

        {/* Indicador de Seguridad y Estado */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-xs bg-zinc-800/80 px-3 py-1.5 rounded-full border border-zinc-700">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-zinc-300 font-medium">Protección de Datos: Activa (Zero-Trust)</span>
          </div>
          <div className="text-xs text-zinc-500 font-mono">
            {isTauriEnv ? "Desktop Nativo" : "Modo Vista Previa"}
          </div>
        </div>
      </header>

      {/* Navegación por Pestañas de Negocio */}
      <div className="border-b border-zinc-800/80 px-6 bg-zinc-900/30 flex space-x-6">
        <button
          onClick={() => setActiveTab("actions")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "actions"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Package className="w-4 h-4" />
          Tarjetas de Decisión ({cards.filter(c => !approvedCards.includes(c.card_id)).length})
        </button>

        <button
          onClick={() => setActiveTab("memory")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "memory"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Brain className="w-4 h-4" />
          Memoria y Aprendizaje Local ({patterns.length})
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "rules"
              ? "border-cyan-400 text-cyan-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Store className="w-4 h-4" />
          Reglas de mi Empresa
        </button>
      </div>

      {/* Alerta de notificación flotante */}
      {statusMessage && (
        <div className="mx-6 mt-4 p-3 bg-emerald-950/70 border border-emerald-600/40 rounded-lg text-emerald-300 text-sm flex items-center justify-between animate-fade-in">
          <span>{statusMessage}</span>
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        </div>
      )}

      {/* Área Principal de Contenido */}
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto space-y-6">
        {activeTab === "actions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Acciones Pendientes de Aprobación</h2>
                <p className="text-sm text-zinc-400">
                  Xook supervisa tus almacenes y sugiere pedidos. Ninguna compra ni modificación se ejecuta sin tu clic.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Control Humano Obligatorio (HITL)</span>
              </div>
            </div>

            {cards.length === 0 ? (
              <div className="border border-dashed border-zinc-800 rounded-xl p-12 text-center text-zinc-500">
                Todo tu inventario está en niveles óptimos. No se requieren acciones en este momento.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cards.map((card) => {
                  const isApproved = approvedCards.includes(card.card_id);
                  return (
                    <div
                      key={card.card_id}
                      className={`border rounded-xl p-5 transition-all flex flex-col justify-between ${
                        isApproved
                          ? "bg-zinc-900/40 border-emerald-900/50 opacity-70"
                          : "bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 shadow-lg shadow-black/40"
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Cabecera de la tarjeta */}
                        <div className="flex items-start justify-between">
                          <span
                            className={`text-xs px-2.5 py-1 rounded-full font-medium uppercase tracking-wider ${
                              card.urgency === "alta"
                                ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            }`}
                          >
                            Urgencia {card.urgency}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                            Stock actual: <strong className="text-zinc-200">{card.current_stock} un.</strong>
                          </span>
                        </div>

                        {/* Título y descripción */}
                        <div>
                          <h3 className="text-base font-semibold text-white">{card.title}</h3>
                          <p className="text-xs text-zinc-400 mt-1">{card.description}</p>
                        </div>

                        {/* Resumen de la orden sugerida */}
                        <div className="bg-zinc-950/60 rounded-lg p-3 border border-zinc-800/80 space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Proveedor sugerido:</span>
                            <span className="font-medium text-zinc-200">{card.supplier_name}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Cantidad recomendada:</span>
                            <span className="font-bold text-cyan-400">+{card.recommended_order} unidades</span>
                          </div>
                          <div className="flex justify-between text-xs pt-1 border-t border-zinc-800">
                            <span className="text-zinc-400">Costo aproximado:</span>
                            <span className="font-bold text-emerald-400">
                              ${card.estimated_cost.toLocaleString()} {card.currency}
                            </span>
                          </div>
                        </div>

                        {/* Por qué Xook lo recomienda */}
                        <div className="flex items-start gap-2 text-xs text-zinc-400 bg-cyan-950/20 border border-cyan-800/30 p-2.5 rounded-lg">
                          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                          <span>{card.reasoning}</span>
                        </div>
                      </div>

                      {/* Botón de Decisión */}
                      <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between">
                        {isApproved ? (
                          <div className="w-full py-2 bg-emerald-950/60 border border-emerald-800/50 rounded-lg text-emerald-400 text-xs font-medium flex items-center justify-center gap-2">
                            <CheckCircle className="w-4 h-4" />
                            Orden Autorizada
                          </div>
                        ) : (
                          <div className="w-full flex gap-2">
                            <button
                              onClick={() => handleApprove(card)}
                              className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
                            >
                              Aprobar Orden
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setCards(cards.filter(c => c.card_id !== card.card_id));
                              }}
                              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs py-2.5 px-3 rounded-lg transition-colors"
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
        )}

        {activeTab === "memory" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Memoria y Aprendizaje Local</h2>
              <p className="text-sm text-zinc-400">
                Xook aprende automáticamente de las aprobaciones, descartes y compras que realizas para no volverte a preguntar cosas obvias.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-zinc-800 bg-zinc-900/60 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Brain className="w-4 h-4 text-cyan-400" />
                  Patrones de Negocio Detectados
                </h3>
                <div className="space-y-3">
                  {patterns.map((p) => (
                    <div key={p.pattern_id} className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg space-y-1">
                      <p className="text-xs text-zinc-200 font-medium">{p.description}</p>
                      <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                        <span>Confianza del modelo</span>
                        <span className="text-cyan-400 font-mono">{Math.round(p.confidence * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-800 bg-zinc-900/60 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Privacidad Garantizada
                </h3>
                <div className="text-xs text-zinc-400 space-y-2 leading-relaxed">
                  <p>
                    • <strong>100% Local:</strong> Esta memoria se almacena en el archivo aislado <code className="text-cyan-400 bg-zinc-800/80 px-1 py-0.5 rounded">context/memory/memory_store.json</code> dentro de tu propia máquina.
                  </p>
                  <p>
                    • <strong>Sin telemetría oculta:</strong> Tus volúmenes de venta y lista de clientes nunca salen a servidores de terceros sin tu conocimiento.
                  </p>
                  <p>
                    • <strong>Historial auditado:</strong> Cada decisión aprobada queda registrada con sello de tiempo inmutable.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "rules" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Reglas de mi Empresa</h2>
              <p className="text-sm text-zinc-400">
                Límites operativos que el asistente nunca violará, definidos en <code className="text-cyan-400 font-mono">context/business-profiles/store-profile.json</code>.
              </p>
            </div>

            <div className="border border-zinc-800 bg-zinc-900/60 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-950/70 border border-zinc-800 p-4 rounded-lg">
                  <span className="text-xs text-zinc-400">Presupuesto Máximo por Orden</span>
                  <div className="text-lg font-bold text-emerald-400 mt-1">$50,000 MXN</div>
                </div>
                <div className="bg-zinc-950/70 border border-zinc-800 p-4 rounded-lg">
                  <span className="text-xs text-zinc-400">Umbral de Alerta de Stock</span>
                  <div className="text-lg font-bold text-amber-400 mt-1">7 días restantes</div>
                </div>
                <div className="bg-zinc-950/70 border border-zinc-800 p-4 rounded-lg">
                  <span className="text-xs text-zinc-400">Proveedores Verificados</span>
                  <div className="text-lg font-bold text-cyan-400 mt-1">2 proveedores</div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Políticas Activas:</h4>
                <ul className="text-xs text-zinc-400 space-y-1.5 list-disc list-inside">
                  <li>No emitir órdenes de compra a proveedores con menos de 4 estrellas sin confirmación.</li>
                  <li>Si un producto tiene menos de 5 unidades, marcar urgencia como ALTA.</li>
                  <li>Nunca ejecutar pagos ni mutaciones sin autorización visual del administrador.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
