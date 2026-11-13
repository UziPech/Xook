export interface ActionCard {
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

export const FALLBACK_ACTION_CARDS: ActionCard[] = [
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
    reasoning: "Venta promedio de 2 un./día. Se sugiere reponer 15 días de stock para evitar desabasto.",
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
    reasoning: "Plazo de entrega de 5 días. Si se espera al viernes habrá quiebre de stock.",
  },
];

// Logotipo tipográfico brutalista XOOK (geometría arquitectónica, sin recuadros)
export function XookWordmark({ className = "h-3.5 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 94 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="XOOK"
      className={className}
    >
      {/* X */}
      <path d="M0 0H5.4L20 16H14.6L0 0Z" fill="currentColor" />
      <path d="M14.6 0H20L5.4 16H0L14.6 0Z" fill="currentColor" />
      {/* O */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M26.5 0H41.5L44 2.5V13.5L41.5 16H26.5L24 13.5V2.5L26.5 0ZM28 4V12H40V4H28Z"
        fill="currentColor"
      />
      {/* O */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M51.5 0H66.5L69 2.5V13.5L66.5 16H51.5L49 13.5V2.5L51.5 0ZM53 4V12H65V4H53Z"
        fill="currentColor"
      />
      {/* K */}
      <path
        d="M74 0H78V6.2L86.8 0H94L82.65 8L94 16H86.8L78 9.8V16H74V0Z"
        fill="currentColor"
      />
    </svg>
  );
}
