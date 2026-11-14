import {
  AgendaItem,
  TaskProposal,
  sanitizeTaskProposal,
} from "../task-decisions/taskSchema";
import {
  CanvasArtifact,
  canvasHasCellData,
  cleanVisibleReply,
  extractFirstHtmlTable,
  extractFirstMarkdownTable,
  markdownTableToCanvasArtifact,
  sanitizeCanvasArtifact,
} from "../canvas/canvasSchema";
import {
  ClarificationSpec,
  sanitizeClarificationSpec,
} from "./clarificationSchema";
import {
  AiProviderId,
  normalizeProviderIdClient,
} from "./ProviderIcon";
export type { ClarificationSpec, AiProviderId };
export { normalizeProviderIdClient };

const BROWSER_CANVAS_TOOL_DEF = {
  type: "function",
  function: {
    name: "create_canvas",
    description:
      "Crea un lienzo interactivo (Canvas) junto al chat para mostrar tablas comparativas, datos, listas de costos, cronogramas o documentos estructurados. Incluye siempre todas las filas completas en rows.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título claro del Canvas o tabla" },
        subtitle: { type: "string", description: "Contexto breve o unidades" },
        kind: { type: "string", enum: ["comparison", "table", "document"] },
        summary: { type: "string", description: "Conclusión o recomendación clave en 1 oración" },
        columns: {
          type: "array",
          description: "Nombres de columnas en orden, ej. [\"Sector\", \"Participación (%)\"]",
          items: { type: "string" },
        },
        rows: {
          type: "array",
          description:
            "Lista de filas. Cada fila es un arreglo de textos en el mismo orden de columns, ej. [[\"Agricultura\", \"22%\"], [\"Industria\", \"33%\"]]",
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
        recommended_row: {
          type: "integer",
          description:
            "Opcional (únicamente en comparativas o rankings con una opción ganadora): índice base 0 de la fila recomendada. Omítelo en listas o catálogos neutros.",
        },
        recommended_badge: {
          type: "string",
          description: "Opcional: etiqueta breve para destacar esa fila, ej. 'Recomendado'",
        },
        markdown: { type: "string", description: "Notas o documento Markdown si kind es document" },
      },
      required: ["title", "columns", "rows"],
    },
  },
};

const BROWSER_CLARIFICATION_TOOL_DEF = {
  type: "function",
  function: {
    name: "ask_clarification",
    description:
      "Abre una ventana interactiva de preguntas abiertas ÚNICAMENTE cuando al analizar el mensaje del usuario falte un dato indispensable no mencionado (ej. 'agenda algo' sin qué ni cuándo, o 'cita mañana' sin hora). Si ya dio evento + fecha + hora (ej. 'cita para mañana a las 10 pm'), NO la uses y crea la tarjeta directo. Prohibido preguntar datos ya dichos.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título breve y claro de la ventana" },
        subtitle: { type: "string", description: "Explicación corta de por qué necesitas estos datos" },
        submit_label: { type: "string", description: "Texto del botón enviar, ej. 'Continuar'" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              prompt: { type: "string" },
              kind: { type: "string", enum: ["choice_or_text", "single", "multi"] },
              options: {
                type: "array",
                items: { type: "string" },
                description: "OBLIGATORIO: al menos 2 o 3 opciones sugeridas claras además del campo libre",
              },
              placeholder: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["id", "prompt", "options"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
};

const BROWSER_VAULT_CONFIG_TOOL_DEF = {
  type: "function",
  function: {
    name: "configure_ai_vault",
    description:
      "Abre el formulario cifrado Zero-Trust dentro del chat de XOOK para guardar una API key en la bóveda local o cambiar el proveedor de IA activo (openrouter, deepseek, kimi, groq, gemini, openai, anthropic).",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["openrouter", "deepseek", "kimi", "groq", "gemini", "openai", "anthropic"],
        },
        action: {
          type: "string",
          enum: ["prompt_key", "switch_provider", "open_settings"],
        },
        note: { type: "string" },
      },
      required: ["provider", "action"],
    },
  },
};

export interface OpenRouterModelOption {
  id: string;
  name: string;
  provider_id?: AiProviderId | string;
  provider_name?: string;
  hint: string;
  is_free: boolean;
  context_length?: number | null;
  prompt_price_per_million?: number | null;
  completion_price_per_million?: number | null;
  cache_price_per_million?: number | null;
}

export interface AiProviderSpec {
  id: AiProviderId;
  name: string;
  shortName: string;
  baseUrl: string;
  defaultModelId: string;
  tierBadge: string;
  tariffSummary: string;
  inputPriceHint: string;
  outputPriceHint: string;
  cachePriceHint: string;
  rateLimitNote: string;
  keyPrefixHint: string;
  docsUrl: string;
  supportsPromptCache: boolean;
  supportsFreeTier: boolean;
  curatedModels: OpenRouterModelOption[];
}

export const DEFAULT_FAILOVER_ORDER: AiProviderId[] = [
  "openrouter",
  "deepseek",
  "kimi",
  "groq",
  "gemini",
  "openai",
  "anthropic",
];

export const AI_PROVIDERS: Record<AiProviderId, AiProviderSpec> = {
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    shortName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModelId: "openrouter/free",
    tierBadge: "Gratis + $5",
    tariffSummary: "$0 en modelos :free · Enrutamiento multi-modelo",
    inputPriceHint: "$0.00 (free)",
    outputPriceHint: "$0.00 (free)",
    cachePriceHint: "Según modelo",
    rateLimitNote: "50 req/día sin saldo (1,000/día al recargar $5+); 20 RPM.",
    keyPrefixHint: "sk-or-v1-...",
    docsUrl: "https://openrouter.ai/keys",
    supportsPromptCache: false,
    supportsFreeTier: true,
    curatedModels: [
      {
        id: "openrouter/free",
        name: "Automático (Gratis)",
        provider_id: "openrouter",
        provider_name: "OpenRouter",
        hint: "Elige el mejor modelo gratuito disponible",
        is_free: true,
        context_length: 200000,
        prompt_price_per_million: 0,
        completion_price_per_million: 0,
      },
      {
        id: "openrouter/auto",
        name: "Automático (Estándar)",
        provider_id: "openrouter",
        provider_name: "OpenRouter",
        hint: "Enruta al mejor modelo según la tarea",
        is_free: false,
        context_length: 2000000,
      },
      {
        id: "google/gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider_id: "openrouter",
        provider_name: "Google",
        hint: "Rápido y económico vía OpenRouter",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 0.3,
        completion_price_per_million: 2.5,
      },
      {
        id: "openai/gpt-4o-mini",
        name: "GPT-4o Mini",
        provider_id: "openrouter",
        provider_name: "OpenAI",
        hint: "Preciso y ligero",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.15,
        completion_price_per_million: 0.6,
      },
      {
        id: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider_id: "openrouter",
        provider_name: "Anthropic",
        hint: "Razonamiento profundo vía OpenRouter",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 3.0,
        completion_price_per_million: 15.0,
      },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek Directo",
    shortName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModelId: "deepseek-flash",
    tierBadge: "Ultra barato",
    tariffSummary: "$0.15/1M in · Caché en disco $0.003/1M",
    inputPriceHint: "$0.15 / 1M",
    outputPriceHint: "$0.60 / 1M",
    cachePriceHint: "$0.003 / 1M (automático)",
    rateLimitNote: "Sin límite rígido por RPM; con $2 USD rinde millones de tokens.",
    keyPrefixHint: "sk-...",
    docsUrl: "https://platform.deepseek.com/api_keys",
    supportsPromptCache: true,
    supportsFreeTier: false,
    curatedModels: [
      {
        id: "deepseek-flash",
        name: "DeepSeek Flash (V4)",
        provider_id: "deepseek",
        provider_name: "DeepSeek",
        hint: "Ultra costo-beneficio con caché en disco automático",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.15,
        completion_price_per_million: 0.6,
        cache_price_per_million: 0.003,
      },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        provider_id: "deepseek",
        provider_name: "DeepSeek",
        hint: "Mayor precisión analítica y agente complejo",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.66,
        completion_price_per_million: 1.98,
        cache_price_per_million: 0.066,
      },
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        provider_id: "deepseek",
        provider_name: "DeepSeek",
        hint: "Alias directo rápido",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.28,
        completion_price_per_million: 0.42,
        cache_price_per_million: 0.028,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        provider_id: "deepseek",
        provider_name: "DeepSeek",
        hint: "Cadena de pensamiento extendida",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.28,
        completion_price_per_million: 0.42,
        cache_price_per_million: 0.028,
      },
    ],
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    shortName: "Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModelId: "kimi-k3.1-pro",
    tierBadge: "Prepago · Saldo API",
    tariffSummary: "K3.1 Pro $2.00/$10.00 · Caché $0.20 · Ventana 1M",
    inputPriceHint: "$2.00 - $4.00 / 1M",
    outputPriceHint: "$10.00 - $20.00 / 1M",
    cachePriceHint: "$0.20 / 1M (caché)",
    rateLimitNote: "Consulta saldo real (/users/me/balance) + headers RPM/TPM por turno.",
    keyPrefixHint: "sk-...",
    docsUrl: "https://platform.moonshot.ai/console/api-keys",
    supportsPromptCache: true,
    supportsFreeTier: false,
    curatedModels: [
      {
        id: "kimi-k3.1-pro",
        name: "Kimi K3.1 Pro",
        provider_id: "kimi",
        provider_name: "Kimi (Moonshot)",
        hint: "Insignia de razonamiento y código con ventana 1M",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 2.0,
        completion_price_per_million: 10.0,
        cache_price_per_million: 0.2,
      },
      {
        id: "kimi-k3.1-pro-highspeed",
        name: "Kimi K3.1 Pro Highspeed",
        provider_id: "kimi",
        provider_name: "Kimi (Moonshot)",
        hint: "Alta velocidad y baja latencia · Ventana 1M",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 4.0,
        completion_price_per_million: 20.0,
        cache_price_per_million: 0.2,
      },
      {
        id: "kimi-k3",
        name: "Kimi K3",
        provider_id: "kimi",
        provider_name: "Kimi (Moonshot)",
        hint: "Modelo estándar balanceado · Ventana 1M",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 3.0,
        completion_price_per_million: 15.0,
        cache_price_per_million: 0.3,
      },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq (LPUs)",
    shortName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModelId: "openai/gpt-oss-120b",
    tierBadge: "Gratis rápido",
    tariffSummary: "Tier gratuito sin tarjeta · Desde $0.05/1M pago",
    inputPriceHint: "$0 gratis · $0.05-$0.15/1M",
    outputPriceHint: "$0 gratis · $0.08-$0.60/1M",
    cachePriceHint: "No aplica",
    rateLimitNote: "~30 RPM y cuota TPM gratis en hardware LPU ultra veloz.",
    keyPrefixHint: "gsk_...",
    docsUrl: "https://console.groq.com/keys",
    supportsPromptCache: false,
    supportsFreeTier: true,
    curatedModels: [
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B (LPU)",
        provider_id: "groq",
        provider_name: "Groq",
        hint: "Insignia de 120B ultra veloz con herramientas",
        is_free: true,
        context_length: 131072,
        prompt_price_per_million: 0.15,
        completion_price_per_million: 0.6,
      },
      {
        id: "openai/gpt-oss-20b",
        name: "GPT-OSS 20B (LPU)",
        provider_id: "groq",
        provider_name: "Groq",
        hint: "Baja latencia e iteración de loops",
        is_free: true,
        context_length: 131072,
        prompt_price_per_million: 0.075,
        completion_price_per_million: 0.3,
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout 17B",
        provider_id: "groq",
        provider_name: "Groq",
        hint: "Multimodal rápido con soporte de visión",
        is_free: true,
        context_length: 131072,
        prompt_price_per_million: 0.11,
        completion_price_per_million: 0.34,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B Instant",
        provider_id: "groq",
        provider_name: "Groq",
        hint: "Ultra ligero y veloz en cuota gratuita",
        is_free: true,
        context_length: 131072,
        prompt_price_per_million: 0.05,
        completion_price_per_million: 0.08,
      },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    shortName: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModelId: "gemini-2.5-flash-lite",
    tierBadge: "Gratis limitado",
    tariffSummary: "Free tier (tokens limitados) · Desde $0.10/1M",
    inputPriceHint: "$0 gratis · $0.10-$1.25/1M",
    outputPriceHint: "$0 gratis · $0.40-$10.00/1M",
    cachePriceHint: "$0.025-$0.31/1M",
    rateLimitNote: "Free tier con TPM/RPD acotado; Flash-Lite estira mucho la cuota.",
    keyPrefixHint: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
    supportsPromptCache: true,
    supportsFreeTier: true,
    curatedModels: [
      {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        provider_id: "gemini",
        provider_name: "Google",
        hint: "Cuota gratuita más amplia y menor costo por token",
        is_free: true,
        context_length: 1000000,
        prompt_price_per_million: 0.1,
        completion_price_per_million: 0.4,
        cache_price_per_million: 0.025,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider_id: "gemini",
        provider_name: "Google",
        hint: "Multimodal equilibrado con contexto 1M",
        is_free: true,
        context_length: 1000000,
        prompt_price_per_million: 0.3,
        completion_price_per_million: 2.5,
        cache_price_per_million: 0.075,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        provider_id: "gemini",
        provider_name: "Google",
        hint: "Razonamiento complejo (menor cuota gratis)",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 1.25,
        completion_price_per_million: 10.0,
        cache_price_per_million: 0.3125,
      },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI Directo",
    shortName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModelId: "gpt-4.1-mini",
    tierBadge: "Pro Dev",
    tariffSummary: "Desde $0.10/1M in · Prompt caching 75%",
    inputPriceHint: "$0.10-$2.00 / 1M",
    outputPriceHint: "$0.40-$8.00 / 1M",
    cachePriceHint: "75% descuento (automático)",
    rateLimitNote: "Requiere saldo prepago; ideal para desarrolladores con clave propia.",
    keyPrefixHint: "sk-proj-...",
    docsUrl: "https://platform.openai.com/api-keys",
    supportsPromptCache: true,
    supportsFreeTier: false,
    curatedModels: [
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider_id: "openai",
        provider_name: "OpenAI",
        hint: "Rápido, preciso en JSON/tools y económico",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 0.4,
        completion_price_per_million: 1.6,
        cache_price_per_million: 0.1,
      },
      {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        provider_id: "openai",
        provider_name: "OpenAI",
        hint: "Ultra bajo costo para clasificación rápida",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 0.1,
        completion_price_per_million: 0.4,
        cache_price_per_million: 0.025,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider_id: "openai",
        provider_name: "OpenAI",
        hint: "Alta capacidad en código y análisis extenso",
        is_free: false,
        context_length: 1000000,
        prompt_price_per_million: 2.0,
        completion_price_per_million: 8.0,
        cache_price_per_million: 0.5,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider_id: "openai",
        provider_name: "OpenAI",
        hint: "Multimodal ligero",
        is_free: false,
        context_length: 128000,
        prompt_price_per_million: 0.15,
        completion_price_per_million: 0.6,
        cache_price_per_million: 0.075,
      },
      {
        id: "o4-mini",
        name: "o4-mini (Reasoning)",
        provider_id: "openai",
        provider_name: "OpenAI",
        hint: "Razonamiento paso a paso",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 1.1,
        completion_price_per_million: 4.4,
        cache_price_per_million: 0.275,
      },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    shortName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModelId: "claude-sonnet-4-6",
    tierBadge: "Pro Claude",
    tariffSummary: "Desde $0.10–$3/1M in · Caché 90% dto.",
    inputPriceHint: "$0.10-$3.00 / 1M",
    outputPriceHint: "$0.50-$15.00 / 1M",
    cachePriceHint: "$0.01-$0.30 / 1M (-90%)",
    rateLimitNote: "API nativa /v1/messages con prompt caching explícito (-90% lecturas).",
    keyPrefixHint: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
    supportsPromptCache: true,
    supportsFreeTier: false,
    curatedModels: [
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider_id: "anthropic",
        provider_name: "Anthropic",
        hint: "Insignia de código, análisis y tool calling",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 3.0,
        completion_price_per_million: 15.0,
        cache_price_per_million: 0.3,
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        provider_id: "anthropic",
        provider_name: "Anthropic",
        hint: "Claude veloz y económico",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 1.0,
        completion_price_per_million: 5.0,
        cache_price_per_million: 0.1,
      },
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        provider_id: "anthropic",
        provider_name: "Anthropic",
        hint: "Generación reciente equilibrada",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 2.0,
        completion_price_per_million: 10.0,
        cache_price_per_million: 0.2,
      },
      {
        id: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        provider_id: "anthropic",
        provider_name: "Anthropic",
        hint: "Ultra económico con caché (-90%)",
        is_free: false,
        context_length: 200000,
        prompt_price_per_million: 0.1,
        completion_price_per_million: 0.5,
        cache_price_per_million: 0.01,
      },
    ],
  },
};

export const AI_PROVIDER_LIST: AiProviderSpec[] = DEFAULT_FAILOVER_ORDER.map(
  (id) => AI_PROVIDERS[id]
);

export function getProviderSpec(provider?: string | null): AiProviderSpec {
  return AI_PROVIDERS[normalizeProviderIdClient(provider)];
}

export function formatPricePerMillion(usd?: number | null): string {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return "Variable";
  if (usd <= 0) return "Gratis";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  if (usd < 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export const OPENROUTER_PRESET_MODELS: OpenRouterModelOption[] =
  AI_PROVIDERS.openrouter.curatedModels;

export interface ProviderRateLimitsSnapshot {
  source?: string | null;
  updatedAtMs?: number | null;
  rpmLimit?: number | null;
  rpmRemaining?: number | null;
  rpmResetAtMs?: number | null;
  tpmLimit?: number | null;
  tpmRemaining?: number | null;
  tpmResetAtMs?: number | null;
  itpmLimit?: number | null;
  itpmRemaining?: number | null;
  otpmLimit?: number | null;
  otpmRemaining?: number | null;
  retryAfterSec?: number | null;
  dailyLimit?: number | null;
  dailyRemaining?: number | null;
}

export interface ProviderBalanceSnapshot {
  currency?: string | null;
  balanceRaw?: number | null;
  balanceUsd?: number | null;
  creditsRemaining?: number | null;
  creditsTotal?: number | null;
  creditsUsage?: number | null;
  balanceGranted?: number | null;
  balanceToppedUp?: number | null;
  limit?: number | null;
  limitRemaining?: number | null;
  limitReset?: string | null;
  isFreeTier?: boolean | null;
  canUsePaidModels?: boolean | null;
  apiUsageDaily?: number | null;
  apiUsageMonthly?: number | null;
  updatedAtMs?: number | null;
  source?: string | null;
}

export interface ProviderLimitConfig {
  monthlyBudgetUsd?: number | null;
  dailyRequestLimit?: number | null;
  rpmLimit?: number | null;
  tierMode?: "free" | "paid" | string | null;
}

export interface ProviderUsageEntry {
  provider: string;
  todayDate: string;
  todayRequests: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayCachedTokens: number;
  todayCostUsd: number;
  monthKey: string;
  monthRequests: number;
  monthPromptTokens: number;
  monthCompletionTokens: number;
  monthCachedTokens: number;
  monthCostUsd: number;
  recentRequestTimestampsMs: number[];
  currentRpm: number;
  lastModelId?: string | null;
  lastRequestAtMs?: number | null;
  rateLimits?: ProviderRateLimitsSnapshot | null;
  balance?: ProviderBalanceSnapshot | null;
  limits: ProviderLimitConfig;
}

export interface AiUsageLedger {
  providers: Record<string, ProviderUsageEntry>;
}

export interface SetProviderLimitsInput {
  provider: string;
  monthlyBudgetUsd?: number | null;
  dailyRequestLimit?: number | null;
  rpmLimit?: number | null;
  tierMode?: "free" | "paid" | null;
}

export interface ProviderPublicStatus {
  provider: AiProviderId | string;
  modelId: string;
  hasApiKey: boolean;
  maskedKey: string | null;
  keySource: "vault" | "env" | "browser" | "none";
  customModels: string[];
  cooldownUntilMs?: number | null;
  quotaStatus?: "ready" | "cooldown" | "exhausted" | "auth_error";
  quotaReason?: string | null;
  apiRegion?: string | null;
}

export interface AiConfigStatus {
  provider: string;
  modelId: string;
  hasApiKey: boolean;
  maskedKey: string | null;
  keySource: "vault" | "env" | "browser" | "none";
  customModels: string[];
  autoFailover?: boolean;
  failoverOrder?: string[];
  configuredProviders?: Record<string, ProviderPublicStatus>;
}

export interface SaveAiConfigInput {
  provider?: string;
  targetProvider?: string;
  modelId?: string;
  apiKey?: string;
  clearKey?: boolean;
  customModels?: string[];
  autoFailover?: boolean;
  failoverOrder?: string[];
  clearCooldown?: boolean;
  apiRegion?: string;
}

export interface AiConnectionTestResult {
  ok: boolean;
  provider?: string;
  label?: string;
  base_url?: string;
  is_free_tier?: boolean;
  limit?: number | null;
  limit_remaining?: number | null;
  limit_reset?: string | null;
  usage?: number | null;
  usage_daily?: number | null;
  usage_weekly?: number | null;
  usage_monthly?: number | null;
  credits_total?: number | null;
  credits_usage?: number | null;
  credits_remaining?: number | null;
  balance_usd?: number | null;
  balance_raw?: number | null;
  balance_currency?: string | null;
  balance_granted?: number | null;
  balance_topped_up?: number | null;
  currency?: string | null;
  balance_available?: boolean | null;
  can_use_paid_models?: boolean;
  daily_free_limit?: number;
  rpm_free_limit?: number;
  rpm_limit?: number | null;
  rate_limit_source?: string | null;
  rate_limits?: ProviderRateLimitsSnapshot | Record<string, unknown> | null;
  message: string;
}

export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
}

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AttachedContextItem {
  name: string;
  type: string;
  content: string;
  kind?: "text" | "pdf" | "image" | "binary";
  workspacePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  imageDataUrl?: string;
}

export interface GeneratedPdfArtifact {
  path: string;
  filename: string;
  title: string;
  pageCount: number;
  sizeBytes: number;
  hasCover?: boolean;
  imagesEmbedded?: number;
  tablesCount?: number;
  theme?: string;
  previewPages?: Array<{
    page: number;
    width: number;
    height: number;
    dataUrl: string;
  }>;
  previewHasMore?: boolean;
}

export interface PdfDraftPreviewBlock {
  type: string;
  level?: number;
  text?: string;
  title?: string;
  tone?: string;
  language?: string;
  items?: string[];
  totalItems?: number;
  columns?: string[];
  rows?: string[][];
  totalRows?: number;
  path?: string;
  caption?: string;
  metrics?: Array<{ label: string; value: string }>;
  streaming?: boolean;
}

export interface PdfDraftCoverPreview {
  enabled: boolean;
  layout?: string;
  eyebrow?: string;
  imagePath?: string;
  footerNote?: string;
}

export interface PdfDraftProgressEvent {
  stage:
    | "composing"
    | "preparing"
    | "building_cover"
    | "building_blocks"
    | "rendering_pdf"
    | "rendering_preview";
  stepLabel: string;
  progress: number;
  title: string;
  subtitle?: string;
  theme?: string;
  author?: string;
  date?: string;
  hasCover?: boolean;
  cover?: PdfDraftCoverPreview | null;
  blocks: PdfDraftPreviewBlock[];
  totalBlocks?: number;
  completedBlocks?: number;
  path?: string;
}

export function sanitizeGeneratedPdfArtifact(raw: unknown): GeneratedPdfArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const path = typeof obj.path === "string" ? obj.path.trim() : "";
  if (!path) return null;
  const filename =
    typeof obj.filename === "string" && obj.filename.trim()
      ? obj.filename.trim()
      : path.split("/").pop() || "documento.pdf";
  const title =
    typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : filename;
  const pageCountRaw = obj.pageCount ?? obj.page_count;
  const sizeBytesRaw = obj.sizeBytes ?? obj.size_bytes;
  const rawPreviewPages = obj.previewPages ?? obj.preview_pages;
  const previewPages = Array.isArray(rawPreviewPages)
    ? rawPreviewPages
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const po = p as Record<string, unknown>;
          const dataUrl = String(po.dataUrl ?? po.data_url ?? "").trim();
          if (!dataUrl) return null;
          return {
            page: Number(po.page ?? 1),
            width: Number(po.width ?? 0),
            height: Number(po.height ?? 0),
            dataUrl,
          };
        })
        .filter((p): p is { page: number; width: number; height: number; dataUrl: string } => p !== null)
    : undefined;
  return {
    path,
    filename,
    title,
    pageCount: typeof pageCountRaw === "number" && Number.isFinite(pageCountRaw) ? pageCountRaw : 1,
    sizeBytes: typeof sizeBytesRaw === "number" && Number.isFinite(sizeBytesRaw) ? sizeBytesRaw : 0,
    hasCover: Boolean(obj.hasCover ?? obj.has_cover),
    imagesEmbedded:
      typeof (obj.imagesEmbedded ?? obj.images_embedded) === "number"
        ? Number(obj.imagesEmbedded ?? obj.images_embedded)
        : undefined,
    tablesCount:
      typeof (obj.tablesCount ?? obj.tables_count) === "number"
        ? Number(obj.tablesCount ?? obj.tables_count)
        : undefined,
    theme: typeof obj.theme === "string" ? obj.theme : undefined,
    ...(previewPages && previewPages.length > 0 ? { previewPages } : {}),
    ...(obj.previewHasMore !== undefined || obj.preview_has_more !== undefined
      ? { previewHasMore: Boolean(obj.previewHasMore ?? obj.preview_has_more) }
      : {}),
  };
}

export function sanitizeGeneratedPdfList(raw: unknown): GeneratedPdfArtifact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeGeneratedPdfArtifact)
    .filter((item): item is GeneratedPdfArtifact => item !== null);
}

export interface XoxAiChatRequest {
  message: string;
  history: ChatTurnMessage[];
  currentTasks: TaskProposal[];
  agendaItems: AgendaItem[];
  attachedContext: AttachedContextItem[];
  modelOverride?: string;
  providerOverride?: string;
  /** Perfil local activo para contextualizar el saludo y rol */
  userProfile?: { name: string; storeName?: string; role?: string } | null;
  /** En modo browser preview, permite leer contexto de negocio en vivo */
  businessContextSnapshot?: string;
  /** Canvas activo abierto para ediciones incrementales desde el chat */
  activeCanvas?: CanvasArtifact | null;
}

export interface XoxTokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens: number;
  cost?: number;
  estimatedCostUsd?: number;
}

export interface ProviderFailoverEvent {
  fromProvider: string;
  toProvider: string;
  modelUsed?: string;
  kind?: string;
  reason?: string;
  notice?: string;
}

export interface VaultPromptSpec {
  provider: AiProviderId;
  intent: "prompt_key" | "switch_provider" | "open_settings";
  note?: string;
  completed?: boolean;
  savedMaskedKey?: string;
}

export interface XoxAiChatResponse {
  reply: string;
  reasoning?: string;
  reasoningDurationMs?: number;
  steps?: ThinkingStep[];
  xoxMood: "talking" | "success" | "alert";
  operation: "none" | "add_tasks" | "replace_tasks" | "ask_clarification";
  tasks: TaskProposal[];
  canvas?: CanvasArtifact;
  clarification?: ClarificationSpec;
  vaultAction?: VaultPromptSpec;
  generatedPdfs?: GeneratedPdfArtifact[];
  providerUsed?: string;
  modelUsed: string;
  latencyMs: number;
  usage?: XoxTokenUsage;
  rateLimits?: ProviderRateLimitsSnapshot;
  workspaceMutated?: boolean;
  failoverNotice?: string;
  exhaustedProviders?: Array<Record<string, unknown>>;
  failoverEvents?: ProviderFailoverEvent[];
}

export interface XoxStreamCallbacks {
  onStreamStart?: (streamId: string) => void;
  onPhase?: (state: "reading" | "thinking" | "talking" | "syncing", label?: string) => void;
  onProviderFailover?: (event: ProviderFailoverEvent) => void;
  onVaultAction?: (action: VaultPromptSpec) => void;
  onSteps?: (steps: ThinkingStep[]) => void;
  onReasoningDelta?: (delta: string) => void;
  onReasoningReset?: () => void;
  onReplyDelta?: (delta: string) => void;
  onCanvas?: (canvas: CanvasArtifact) => void;
  onPdfDraftProgress?: (draft: PdfDraftProgressEvent) => void;
  onPdfGenerated?: (pdf: GeneratedPdfArtifact) => void;
}

export interface WorkspaceContextSource {
  id: string;
  name: string;
  type: "profile" | "memory" | "skill" | "catalog";
  path: string;
  content: string;
  isCustom?: boolean;
}

const BROWSER_VAULT_KEY = "xook_ai_vault_v1";
const DAILY_REQUESTS_KEY = "xook_openrouter_daily_reqs_v1";
const BROWSER_USAGE_LEDGER_KEY = "xook_ai_usage_ledger_v1";
const BROWSER_USAGE_EVENT = "xook-browser-usage-updated";
export const AI_USAGE_UPDATED_EVENT = "xox-ai-usage-updated";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface BrowserProviderSlot {
  modelId: string;
  apiKey: string | null;
  customModels: string[];
  cooldownUntilMs?: number | null;
  quotaStatus?: "ready" | "cooldown" | "exhausted" | "auth_error";
  quotaReason?: string | null;
  apiRegion?: string | null;
}

interface BrowserVault {
  provider: AiProviderId;
  modelId: string;
  apiKey: string | null;
  customModels: string[];
  providers: Record<string, BrowserProviderSlot>;
  autoFailover: boolean;
  failoverOrder: AiProviderId[];
}

const cachedCatalogByProvider = new Map<
  AiProviderId,
  { fetchedAt: number; models: OpenRouterModelOption[]; source: string }
>();

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Extrae el mensaje real tanto de Error JS como de strings devueltos por Tauri invoke. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err.trim();
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    const msg = ((err as { message: string }).message || "").trim();
    if (msg.length > 0) return msg;
  }
  return fallback;
}

export function estimateTokens(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}

export function formatTokenCount(tokens: number): string {
  if (tokens <= 0) return "0";
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${tokens}`;
}

export function formatContextLength(ctx?: number | null): string {
  if (!ctx || ctx <= 0) return "—";
  if (ctx >= 1_000_000) {
    const m = ctx / 1_000_000;
    return Math.abs(m - Math.round(m)) < 0.08 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
  }
  if (ctx >= 1000) {
    return `${Math.round(ctx / 1000)}k`;
  }
  return `${ctx}`;
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/:free$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

export function formatModelDisplay(
  rawId: string,
  catalog: OpenRouterModelOption[] = []
): OpenRouterModelOption {
  const found =
    catalog.find((m) => m.id === rawId) ??
    OPENROUTER_PRESET_MODELS.find((m) => m.id === rawId);
  if (found) return found;

  const isFree = rawId.endsWith(":free") || rawId === "openrouter/free";
  if (rawId === "openrouter/free") {
    return OPENROUTER_PRESET_MODELS[0];
  }
  const [vendorRaw, ...rest] = rawId.split("/");
  const modelSlug = rest.join("/") || rawId;
  const providerName = rest.length > 0 ? titleCaseSlug(vendorRaw) : undefined;
  const cleanName = titleCaseSlug(modelSlug);

  return {
    id: rawId,
    name: cleanName || rawId,
    provider_name: providerName,
    hint: [providerName, isFree ? "Gratis" : "Estándar"].filter(Boolean).join(" · "),
    is_free: isFree,
    context_length: null,
  };
}

function formatOpenRouterRawModel(raw: {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}): OpenRouterModelOption {
  const preset = OPENROUTER_PRESET_MODELS.find((p) => p.id === raw.id);
  const promptStr = String(raw.pricing?.prompt ?? "1");
  const completionStr = String(raw.pricing?.completion ?? "1");
  const isFree =
    raw.id.endsWith(":free") ||
    raw.id === "openrouter/free" ||
    (promptStr === "0" && completionStr === "0");

  let cleanedName = (raw.name || raw.id).replace(/\s*\(free\)\s*$/i, "").trim();
  let providerName: string | undefined;
  const colonIdx = cleanedName.indexOf(":");
  if (colonIdx > 0) {
    const left = cleanedName.slice(0, colonIdx).trim();
    const right = cleanedName.slice(colonIdx + 1).trim();
    if (left && right) {
      providerName = left;
      cleanedName = right;
    }
  } else if (raw.id.includes("/")) {
    providerName = titleCaseSlug(raw.id.split("/", 1)[0]);
  }

  if (preset) {
    cleanedName = preset.name;
    providerName = preset.provider_name ?? providerName;
  }

  const ctx = raw.context_length ?? preset?.context_length ?? null;
  const ctxShort = ctx ? `${formatContextLength(ctx)} ctx` : null;

  const pNum = Number(promptStr);
  const cNum = Number(completionStr);
  const promptPricePerMillion = Number.isFinite(pNum) && pNum >= 0 ? Math.round(pNum * 1_000_000 * 10000) / 10000 : null;
  const completionPricePerMillion = Number.isFinite(cNum) && cNum >= 0 ? Math.round(cNum * 1_000_000 * 10000) / 10000 : null;

  let hint: string;
  if (raw.id === "openrouter/free") {
    hint = "Elige el mejor modelo gratuito disponible";
  } else if (isFree) {
    hint = [providerName, ctxShort, "Gratis"].filter(Boolean).join(" · ");
  } else {
    const priceLabel =
      promptPricePerMillion !== null && promptPricePerMillion > 0
        ? `$${promptPricePerMillion.toFixed(2)}/1M`
        : null;
    hint = [providerName, ctxShort, priceLabel].filter(Boolean).join(" · ") || "Modelo estándar";
  }

  return {
    id: raw.id,
    name: cleanedName,
    provider_name: providerName,
    hint,
    is_free: isFree,
    context_length: ctx,
    prompt_price_per_million: promptPricePerMillion,
    completion_price_per_million: completionPricePerMillion,
  };
}

/**
 * Devuelve únicamente modelos realmente utilizables según el nivel de la cuenta.
 * Evita confundir al usuario final mostrando modelos de pago si no hay saldo disponible.
 */
export function getAvailableQuickModels(
  catalog: OpenRouterModelOption[],
  customModels: string[],
  canUsePaidModels: boolean,
  unavailableModelIds: ReadonlySet<string> = new Set(),
  providerId: string = "openrouter"
): OpenRouterModelOption[] {
  const pid = normalizeProviderIdClient(providerId);
  const spec = getProviderSpec(pid);
  const curated = spec.curatedModels;
  const baseList = catalog.length > 0 ? catalog : curated;
  const byId = new Map<string, OpenRouterModelOption>();

  // Para proveedores directos, permitir todos sus modelos curados aunque canUsePaidModels venga en false
  const allowAllInList = pid !== "openrouter" || canUsePaidModels;

  for (const m of baseList) {
    if (!allowAllInList && !m.is_free) continue;
    if (unavailableModelIds.has(m.id)) continue;
    byId.set(m.id, m);
  }

  for (const cm of curated) {
    if (!allowAllInList && !cm.is_free) continue;
    if (unavailableModelIds.has(cm.id)) continue;
    if (!byId.has(cm.id)) {
      byId.set(cm.id, cm);
    }
  }

  if (pid === "openrouter" && !byId.has("openrouter/free")) {
    byId.set("openrouter/free", curated[0]);
  }

  for (const customId of customModels) {
    if (byId.has(customId) || unavailableModelIds.has(customId)) continue;
    const formatted = formatModelDisplay(customId, baseList);
    if (!allowAllInList && !formatted.is_free) continue;
    byId.set(customId, { ...formatted, provider_id: pid });
  }

  const presetIds = new Set(curated.map((p) => p.id));
  const list = Array.from(byId.values());
  list.sort((a, b) => {
    if (a.id === spec.defaultModelId) return -1;
    if (b.id === spec.defaultModelId) return 1;
    const aCurated = curated.findIndex((p) => p.id === a.id);
    const bCurated = curated.findIndex((p) => p.id === b.id);
    if (aCurated !== -1 && bCurated !== -1) return aCurated - bCurated;
    if (aCurated !== -1) return -1;
    if (bCurated !== -1) return 1;
    if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (pid === "openrouter" && canUsePaidModels) {
    return list.filter(
      (m) => presetIds.has(m.id) || m.is_free || customModels.includes(m.id)
    );
  }

  return list;
}

export function getLocalDailyRequestCount(keyScope?: string | null): number {
  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const scope = keyScope || "default";
    const raw = localStorage.getItem(DAILY_REQUESTS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; counts?: Record<string, number> };
    if (parsed.date !== todayUtc) return 0;
    return parsed.counts?.[scope] ?? 0;
  } catch {
    return 0;
  }
}

export function incrementLocalDailyRequestCount(keyScope?: string | null): number {
  try {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const scope = keyScope || "default";
    const raw = localStorage.getItem(DAILY_REQUESTS_KEY);
    let counts: Record<string, number> = {};
    if (raw) {
      const parsed = JSON.parse(raw) as { date?: string; counts?: Record<string, number> };
      if (parsed.date === todayUtc && parsed.counts) {
        counts = parsed.counts;
      }
    }
    const next = (counts[scope] ?? 0) + 1;
    counts[scope] = next;
    localStorage.setItem(DAILY_REQUESTS_KEY, JSON.stringify({ date: todayUtc, counts }));
    return next;
  } catch {
    return 0;
  }
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••";
  let prefixLen = 4;
  if (trimmed.startsWith("sk-or-v1-") && trimmed.length > 14) {
    prefixLen = 9;
  } else if ((trimmed.startsWith("sk-ant-") || trimmed.startsWith("sk-proj-")) && trimmed.length > 13) {
    prefixLen = 7;
  }
  return `${trimmed.slice(0, prefixLen)}••••${trimmed.slice(-4)}`;
}

const API_KEY_PATTERN =
  /(?<![A-Za-z0-9_-])(sk-or-(?:v1-)?[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{14,}|sk-svcacct-[A-Za-z0-9_-]{14,}|gsk_[A-Za-z0-9_-]{14,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,})(?![A-Za-z0-9_-])/;

export interface DetectedApiKeyResult {
  detectedKey: string | null;
  maskedKey: string | null;
  detectedProvider: AiProviderId | null;
  ambiguousProviders: AiProviderId[];
  sanitizedText: string;
}

/**
 * Detecta localmente claves API de OpenRouter, DeepSeek, Groq, Gemini, OpenAI y Anthropic antes de enviarlas.
 */
export function detectApiKeyInText(text: string): DetectedApiKeyResult {
  const match = text.match(API_KEY_PATTERN);
  if (!match) {
    return {
      detectedKey: null,
      maskedKey: null,
      detectedProvider: null,
      ambiguousProviders: [],
      sanitizedText: text,
    };
  }
  const detectedKey = match[1];
  const maskedKey = maskApiKey(detectedKey);
  const sanitizedText = text.replace(detectedKey, maskedKey);

  let detectedProvider: AiProviderId | null = null;
  let ambiguousProviders: AiProviderId[] = [];

  if (detectedKey.startsWith("sk-or-")) {
    detectedProvider = "openrouter";
  } else if (detectedKey.startsWith("sk-ant-")) {
    detectedProvider = "anthropic";
  } else if (detectedKey.startsWith("gsk_")) {
    detectedProvider = "groq";
  } else if (detectedKey.startsWith("AIza")) {
    detectedProvider = "gemini";
  } else if (detectedKey.startsWith("sk-proj-") || detectedKey.startsWith("sk-svcacct-")) {
    detectedProvider = "openai";
  } else if (detectedKey.startsWith("sk-")) {
    const lower = text.toLowerCase();
    if (lower.includes("deepseek")) {
      detectedProvider = "deepseek";
    } else if (lower.includes("kimi") || lower.includes("moonshot")) {
      detectedProvider = "kimi";
    } else if (lower.includes("openai") || lower.includes("openia") || lower.includes("gpt")) {
      detectedProvider = "openai";
    } else {
      // sk- genérico puede ser DeepSeek, Kimi u OpenAI legacy: Xox pregunta o da selector rápido
      detectedProvider = "deepseek";
      ambiguousProviders = ["deepseek", "kimi", "openai"];
    }
  }

  return {
    detectedKey,
    maskedKey,
    detectedProvider,
    ambiguousProviders,
    sanitizedText,
  };
}

export function detectKeySetupIntentWithProvider(text: string): {
  isSetup: boolean;
  providerHint: AiProviderId | null;
} {
  const lower = text.toLowerCase();
  let providerHint: AiProviderId | null = null;
  if (/\bdeepseek\b/i.test(lower)) providerHint = "deepseek";
  else if (/\b(?:kimi|moonshot)\b/i.test(lower)) providerHint = "kimi";
  else if (/\b(?:anthropic|antrophic|anhtropic|claude)\b/i.test(lower)) providerHint = "anthropic";
  else if (/\bgroq\b/i.test(lower)) providerHint = "groq";
  else if (/\b(?:gemini|google\s*ai|ai\s*studio)\b/i.test(lower)) providerHint = "gemini";
  else if (/\b(?:openai|open\s*ia|openia|chatgpt|gpt-4|gpt4|gpt-5)\b/i.test(lower)) providerHint = "openai";
  else if (/\bopenrouter\b/i.test(lower)) providerHint = "openrouter";

  const isSetup =
    /(api\s*key|clave\s*api|b[oó]veda|openrouter|deepseek|kimi|moonshot|groq|gemini|anthropic|antrophic|openai|open\s*ia|openia|token\s*de\s*ia|configur\w*\s*(?:la\s*|el\s*|mi\s*|tu\s*)?(?:ia|clave|api|key|modelo|b[oó]veda|provedor|proveedor)|cambia\w*\s*(?:clave|proveedor|modelo)|guarda\w*\s*(?:la\s*|mi\s*)?(?:clave|api|key))/i.test(
      text
    );
  return { isSetup, providerHint };
}

export interface VaultConfigRequestDetection {
  isVaultRequest: boolean;
  intentKind: "switch_provider" | "save_or_edit_key" | "open_vault";
  providerHint: AiProviderId | null;
}

/**
 * Detecta en lenguaje natural cuando el usuario pide a Xox configurar un proveedor,
 * cambiar de proveedor o guardar una API key en la bóveda de XOOK (sin filtrar código ajeno).
 */
export function detectVaultConfigRequest(text: string): VaultConfigRequestDetection {
  const trimmed = text.trim();
  const { providerHint } = detectKeySetupIntentWithProvider(trimmed);
  if (!trimmed || trimmed.length > 260) {
    return { isVaultRequest: false, intentKind: "open_vault", providerHint };
  }

  const mentionsXookApp = /\b(?:xook|xox|b[oó]veda|esta\s+app|la\s+app|tus\s+ajustes|tu\s+configuraci[oó]n)\b/i.test(
    trimmed
  );
  const mentionsExternalCoding =
    /\b(?:python|node\.?js|typescript|javascript|react|rust|flask|fastapi|django|express|next\.?js|snippet|c[oó]digo\s+en|script\s+en|mi\s+proyecto|\.py|\.tsx?|\.jsx?)\b/i.test(
      trimmed
    );
  if (mentionsExternalCoding && !mentionsXookApp) {
    return { isVaultRequest: false, intentKind: "open_vault", providerHint };
  }

  const mentionsSecretOrVault =
    /(?:\b(?:api\s*key|apikey|clave\s*(?:api|de\s+ia)?|token\s*(?:de\s+ia)?|b[oó]veda)\b|\bla\s+key\b|\bmi\s+key\b|\buna\s+key\b)/i.test(
      trimmed
    );
  const hasActionVerb =
    /\b(?:configur\w*|agreg\w*|añad\w*|anad\w*|pon(?:er|le|me|ga)?|met(?:e|er|ele|eme)?|guard\w*|conect\w*|activ\w*|cambi\w*|us(?:a|ar|emos)|seleccion\w*|abr(?:e|ir|eme)|edita\w*|actualiz\w*|ingres\w*|peg(?:a|ar)|dej\w*\s+configurar|deja\w*\s+configurar)\b/i.test(
      trimmed
    );
  const mentionsProviderEntity =
    providerHint !== null || /\b(?:provedor(?:es)?|proveedor(?:es)?|modelos?\s+de\s+ia)\b/i.test(trimmed);

  // Evitar capturar preguntas meramente informativas (ej. "¿cuánto cuesta deepseek?" o "compara gemini vs groq")
  const isPureQuestion =
    !hasActionVerb &&
    !/\b(?:b[oó]veda)\b/i.test(trimmed) &&
    /\b(?:cu[aá]nto\s+cuesta|tarifas?|precios?|l[ií]mites?|compar\w*|qu[eé]\s+es|por\s+qu[eé]|conviene|mejor)\b/i.test(
      trimmed
    );

  if (isPureQuestion) {
    return { isVaultRequest: false, intentKind: "open_vault", providerHint };
  }

  const explicitlyWantsVaultAction =
    (/\b(?:b[oó]veda)\b/i.test(trimmed) && (hasActionVerb || mentionsSecretOrVault || mentionsProviderEntity)) ||
    (mentionsSecretOrVault && hasActionVerb) ||
    (Boolean(providerHint) && hasActionVerb);

  if (!explicitlyWantsVaultAction) {
    return { isVaultRequest: false, intentKind: "open_vault", providerHint };
  }

  const isExplicitSwitch =
    Boolean(providerHint) &&
    !mentionsSecretOrVault &&
    !/\b(?:configur\w*|agreg\w*|añad\w*|anad\w*|guard\w*|edita\w*|peg\w*|b[oó]veda|pon(?:er|le|me)?\s+(?:la|mi|una)\b)\b/i.test(
      trimmed
    ) &&
    /\b(?:cambi\w*|us(?:a|ar|emos)|activ\w*|p[aá]sa\w*|seleccion\w*)\b/i.test(trimmed);

  if (isExplicitSwitch) {
    return { isVaultRequest: true, intentKind: "switch_provider", providerHint };
  }
  if (/\b(?:abr(?:e|ir|eme)|ver|muestra\w*)\b/i.test(trimmed) && !mentionsSecretOrVault && !providerHint) {
    return { isVaultRequest: true, intentKind: "open_vault", providerHint };
  }
  return { isVaultRequest: true, intentKind: "save_or_edit_key", providerHint };
}

export function isKeySetupIntent(text: string): boolean {
  return detectKeySetupIntentWithProvider(text).isSetup;
}

export function resolveProviderBaseUrlClient(
  providerId: AiProviderId | string,
  apiRegion?: string | null
): string {
  const pid = normalizeProviderIdClient(providerId);
  if (pid === "kimi") {
    const r = (apiRegion ?? "").trim().toLowerCase();
    if (r === "cn" || r === "china" || r === "moonshot-cn" || r === "moonshot.cn") {
      return "https://api.moonshot.cn/v1";
    }
    return "https://api.moonshot.ai/v1";
  }
  return AI_PROVIDERS[pid].baseUrl;
}

function createDefaultBrowserVault(): BrowserVault {
  const providers: Record<string, BrowserProviderSlot> = {};
  for (const spec of AI_PROVIDER_LIST) {
    providers[spec.id] = {
      modelId: spec.defaultModelId,
      apiKey: null,
      customModels: [],
      cooldownUntilMs: null,
      quotaStatus: "ready",
      quotaReason: null,
      apiRegion: spec.id === "kimi" ? "ai" : null,
    };
  }
  return {
    provider: "openrouter",
    modelId: "openrouter/free",
    apiKey: null,
    customModels: [],
    providers,
    autoFailover: true,
    failoverOrder: [...DEFAULT_FAILOVER_ORDER],
  };
}

function normalizeBrowserVault(raw: Partial<BrowserVault> | null | undefined): BrowserVault {
  const base = createDefaultBrowserVault();
  if (!raw) return base;
  const activePid = normalizeProviderIdClient(raw.provider);
  const nextProviders: Record<string, BrowserProviderSlot> = { ...base.providers };

  if (raw.providers && typeof raw.providers === "object") {
    for (const [k, slot] of Object.entries(raw.providers)) {
      if (!slot) continue;
      const pid = normalizeProviderIdClient(k);
      nextProviders[pid] = {
        modelId: slot.modelId || AI_PROVIDERS[pid].defaultModelId,
        apiKey: slot.apiKey ? normalizeApiKey(slot.apiKey) : null,
        customModels: Array.isArray(slot.customModels) ? slot.customModels : [],
        cooldownUntilMs: typeof slot.cooldownUntilMs === "number" ? slot.cooldownUntilMs : null,
        quotaStatus: slot.quotaStatus || "ready",
        quotaReason: slot.quotaReason || null,
        apiRegion:
          typeof slot.apiRegion === "string" && slot.apiRegion.trim()
            ? slot.apiRegion.trim()
            : pid === "kimi"
              ? "ai"
              : null,
      };
    }
  }

  // Migración legacy de un solo proveedor
  if (!nextProviders[activePid].apiKey && raw.apiKey) {
    nextProviders[activePid].apiKey = normalizeApiKey(raw.apiKey);
  }
  if (raw.modelId && (!raw.providers || !raw.providers[activePid]?.modelId)) {
    nextProviders[activePid].modelId = raw.modelId;
  }
  if (Array.isArray(raw.customModels) && raw.customModels.length > 0 && nextProviders[activePid].customModels.length === 0) {
    nextProviders[activePid].customModels = raw.customModels;
  }

  const orderRaw = Array.isArray(raw.failoverOrder) ? raw.failoverOrder : DEFAULT_FAILOVER_ORDER;
  const order: AiProviderId[] = [];
  for (const item of orderRaw) {
    const pid = normalizeProviderIdClient(item);
    if (!order.includes(pid)) order.push(pid);
  }
  for (const pid of DEFAULT_FAILOVER_ORDER) {
    if (!order.includes(pid)) order.push(pid);
  }

  const activeSlot = nextProviders[activePid];
  return {
    provider: activePid,
    modelId: activeSlot.modelId || AI_PROVIDERS[activePid].defaultModelId,
    apiKey: activeSlot.apiKey,
    customModels: activeSlot.customModels,
    providers: nextProviders,
    autoFailover: raw.autoFailover ?? true,
    failoverOrder: order,
  };
}

function readBrowserVault(): BrowserVault {
  try {
    const raw = localStorage.getItem(BROWSER_VAULT_KEY);
    if (!raw) return createDefaultBrowserVault();
    return normalizeBrowserVault(JSON.parse(raw) as Partial<BrowserVault>);
  } catch {
    return createDefaultBrowserVault();
  }
}

function writeBrowserVault(vault: BrowserVault): void {
  try {
    localStorage.setItem(BROWSER_VAULT_KEY, JSON.stringify(vault));
  } catch {
    // Ignorar error de almacenamiento privado
  }
}

function browserVaultToPublic(vault: BrowserVault): AiConfigStatus {
  const now = Date.now();
  const configuredProviders: Record<string, ProviderPublicStatus> = {};
  for (const spec of AI_PROVIDER_LIST) {
    const slot = vault.providers[spec.id];
    const activeCd = slot?.cooldownUntilMs && slot.cooldownUntilMs > now ? slot.cooldownUntilMs : null;
    configuredProviders[spec.id] = {
      provider: spec.id,
      modelId: slot?.modelId || spec.defaultModelId,
      hasApiKey: Boolean(slot?.apiKey),
      maskedKey: slot?.apiKey ? maskApiKey(slot.apiKey) : null,
      keySource: slot?.apiKey ? "browser" : "none",
      customModels: slot?.customModels ?? [],
      cooldownUntilMs: activeCd,
      quotaStatus: activeCd ? (slot?.quotaStatus || "cooldown") : "ready",
      quotaReason: activeCd ? (slot?.quotaReason ?? null) : null,
      apiRegion: slot?.apiRegion ?? (spec.id === "kimi" ? "ai" : null),
    };
  }
  const activeSlot = vault.providers[normalizeProviderIdClient(vault.provider)];
  return {
    provider: vault.provider,
    modelId: activeSlot?.modelId || vault.modelId,
    hasApiKey: Boolean(activeSlot?.apiKey),
    maskedKey: activeSlot?.apiKey ? maskApiKey(activeSlot.apiKey) : null,
    keySource: activeSlot?.apiKey ? "browser" : "none",
    customModels: activeSlot?.customModels ?? vault.customModels,
    autoFailover: vault.autoFailover,
    failoverOrder: vault.failoverOrder,
    configuredProviders,
  };
}

export async function getAiConfigStatus(): Promise<AiConfigStatus> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiConfigStatus>("get_ai_config");
    } catch {
      // Fallback a vault local si el comando no está disponible
    }
  }
  return browserVaultToPublic(readBrowserVault());
}

export function normalizeApiKey(raw?: string | null): string {
  let key = (raw ?? "").trim().replace(/^['"`]+|['"`,;.]+$/g, "");
  if (/^bearer\s+/i.test(key)) {
    key = key
      .replace(/^bearer\s+/i, "")
      .trim()
      .replace(/^['"`]+|['"`,;.]+$/g, "");
  }
  const embedded = key.match(API_KEY_PATTERN);
  if (embedded) {
    return embedded[1];
  }
  return key;
}

export async function saveAiConfig(input: SaveAiConfigInput): Promise<AiConfigStatus> {
  const cleanedKey = normalizeApiKey(input.apiKey);
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiConfigStatus>("save_ai_config", {
        payload: { ...input, apiKey: cleanedKey || undefined },
      });
    } catch {
      // Fallback
    }
  }

  const current = readBrowserVault();
  const nextActiveProvider = input.provider?.trim()
    ? normalizeProviderIdClient(input.provider)
    : normalizeProviderIdClient(current.provider);
  const targetPid = input.targetProvider?.trim()
    ? normalizeProviderIdClient(input.targetProvider)
    : input.provider?.trim()
      ? normalizeProviderIdClient(input.provider)
      : nextActiveProvider;

  const slot = { ...current.providers[targetPid] };
  if (input.modelId?.trim()) {
    slot.modelId = input.modelId.trim();
  }
  if (input.customModels) {
    slot.customModels = input.customModels.map((s) => s.trim()).filter(Boolean);
  }
  if (input.clearKey) {
    slot.apiKey = null;
    slot.cooldownUntilMs = null;
    slot.quotaStatus = "ready";
    slot.quotaReason = null;
  } else if (cleanedKey) {
    slot.apiKey = cleanedKey;
    slot.cooldownUntilMs = null;
    slot.quotaStatus = "ready";
    slot.quotaReason = null;
  }
  if (input.clearCooldown) {
    slot.cooldownUntilMs = null;
    slot.quotaStatus = "ready";
    slot.quotaReason = null;
  }
  if (typeof input.apiRegion === "string") {
    const trimmedRegion = input.apiRegion.trim();
    slot.apiRegion = trimmedRegion || (targetPid === "kimi" ? "ai" : null);
  }

  const nextProviders = { ...current.providers, [targetPid]: slot };
  const activeSlot = nextProviders[nextActiveProvider];
  const next = normalizeBrowserVault({
    provider: nextActiveProvider,
    modelId: activeSlot.modelId,
    apiKey: activeSlot.apiKey,
    customModels: activeSlot.customModels,
    providers: nextProviders,
    autoFailover: input.autoFailover ?? current.autoFailover,
    failoverOrder: (input.failoverOrder ?? current.failoverOrder).map((p) =>
      normalizeProviderIdClient(p),
    ),
  });
  writeBrowserVault(next);
  return browserVaultToPublic(next);
}

export async function testAiConnection(provider?: string): Promise<AiConnectionTestResult> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiConnectionTestResult>("test_ai_connection", {
        provider: provider ?? null,
      });
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  const vault = readBrowserVault();
  const targetPid = normalizeProviderIdClient(provider || vault.provider);
  const spec = AI_PROVIDERS[targetPid];
  const slot = vault.providers[targetPid];
  const key = normalizeApiKey(slot?.apiKey);
  if (!key) {
    return {
      ok: false,
      provider: targetPid,
      message: `No hay una clave API de ${spec.name} guardada.`,
    };
  }
  if (targetPid === "openrouter" && /^[a-fA-F0-9]{64}$/.test(key)) {
    return {
      ok: false,
      provider: targetPid,
      message: "Parece que falta el prefijo 'sk-or-v1-' al inicio de tu clave de OpenRouter.",
    };
  }

  if (targetPid !== "openrouter") {
    try {
      const baseUrl = resolveProviderBaseUrlClient(targetPid, slot?.apiRegion);
      const headers: Record<string, string> =
        targetPid === "anthropic"
          ? {
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            }
          : { Authorization: `Bearer ${key}` };
      const resp = await fetch(`${baseUrl}/models`, { method: "GET", headers });
      if (!resp.ok) {
        return {
          ok: false,
          provider: targetPid,
          base_url: baseUrl,
          message: mapFriendlyHttpError(resp.status, undefined, spec.name),
        };
      }
      const headerLimits = parseBrowserRateLimitHeaders(resp.headers, targetPid);

      let isFreeTier = spec.supportsFreeTier;
      let canUsePaid = true;
      let balanceRaw: number | null = null;
      let balanceUsd: number | null = null;
      let creditsRemaining: number | null = null;
      let balanceCurrency: string | null = null;
      let balanceGranted: number | null = null;
      let balanceToppedUp: number | null = null;
      let balanceAvailable: boolean | null = null;

      if (targetPid === "deepseek") {
        try {
          const balResp = await fetch(`${baseUrl}/user/balance`, {
            method: "GET",
            headers: { Authorization: `Bearer ${key}` },
          });
          if (balResp.ok) {
            const balData = (await balResp.json()) as {
              is_available?: boolean;
              balance_infos?: Array<{
                currency?: string;
                total_balance?: string | number;
                granted_balance?: string | number;
                topped_up_balance?: string | number;
              }>;
            };
            const infos = Array.isArray(balData.balance_infos) ? balData.balance_infos : [];
            const usdRow = infos.find((r) => (r.currency ?? "").toUpperCase() === "USD");
            const chosenRow = usdRow ?? infos[0];
            if (chosenRow) {
              const cur = (chosenRow.currency || "USD").toUpperCase();
              const total = Number(chosenRow.total_balance ?? 0);
              const granted = Number(chosenRow.granted_balance ?? 0);
              const topped = Number(chosenRow.topped_up_balance ?? 0);
              balanceCurrency = cur;
              balanceRaw = Number.isFinite(total) ? Math.round(total * 1e6) / 1e6 : null;
              balanceGranted = Number.isFinite(granted) ? Math.round(granted * 1e6) / 1e6 : null;
              balanceToppedUp = Number.isFinite(topped) ? Math.round(topped * 1e6) / 1e6 : null;
              if (cur === "USD" && balanceRaw !== null) {
                balanceUsd = balanceRaw;
                creditsRemaining = balanceRaw;
              }
            }
            balanceAvailable =
              typeof balData.is_available === "boolean"
                ? balData.is_available
                : (balanceRaw ?? 0) > 0;
            canUsePaid = balanceAvailable;
            isFreeTier = !canUsePaid;
          }
        } catch {
          // Ignorar fallo de CORS o endpoint opcional
        }
      } else if (targetPid === "kimi") {
        try {
          const balResp = await fetch(`${baseUrl}/users/me/balance`, {
            method: "GET",
            headers: { Authorization: `Bearer ${key}` },
          });
          if (balResp.ok) {
            const balData = (await balResp.json()) as {
              data?: {
                available_balance?: number | string;
                voucher_balance?: number | string;
                cash_balance?: number | string;
                currency?: string;
              };
            };
            const d = balData.data;
            if (d && d.available_balance !== undefined) {
              const cur = (
                d.currency || (baseUrl.includes("moonshot.cn") ? "CNY" : "USD")
              ).toUpperCase();
              const avail = Number(d.available_balance ?? 0);
              const voucher = Number(d.voucher_balance ?? 0);
              const cash = Number(d.cash_balance ?? 0);
              balanceCurrency = cur;
              balanceRaw = Number.isFinite(avail) ? Math.round(avail * 1e6) / 1e6 : null;
              balanceGranted = Number.isFinite(voucher) ? Math.round(voucher * 1e6) / 1e6 : null;
              balanceToppedUp = Number.isFinite(cash) ? Math.round(cash * 1e6) / 1e6 : null;
              if (cur === "USD" && balanceRaw !== null) {
                balanceUsd = balanceRaw;
                creditsRemaining = balanceRaw;
              }
              balanceAvailable = (balanceRaw ?? 0) > 0;
              canUsePaid = balanceAvailable;
              isFreeTier = !canUsePaid;
            }
          }
        } catch {
          // Ignorar fallo de CORS o endpoint opcional
        }
      }

      const rateLimitSource =
        balanceRaw !== null
          ? "api_balance"
          : headerLimits
            ? "api_headers"
            : targetPid === "groq" || targetPid === "gemini"
              ? "reference_tier"
              : "none";

      const result: AiConnectionTestResult = {
        ok: true,
        provider: targetPid,
        label: spec.name,
        base_url: baseUrl,
        is_free_tier: isFreeTier,
        credits_remaining: creditsRemaining,
        balance_usd: balanceUsd,
        balance_raw: balanceRaw,
        balance_currency: balanceCurrency,
        currency: balanceCurrency,
        balance_granted: balanceGranted,
        balance_topped_up: balanceToppedUp,
        balance_available: balanceAvailable,
        can_use_paid_models: canUsePaid,
        rate_limit_source: rateLimitSource,
        rpm_limit: headerLimits?.rpmLimit ?? null,
        rate_limits: headerLimits,
        rpm_free_limit: targetPid === "groq" ? 30 : targetPid === "gemini" ? 15 : undefined,
        daily_free_limit: targetPid === "gemini" ? 1000 : undefined,
        message: `Conexión verificada con ${spec.name}.`,
      };
      recordBrowserTestConnectionUsage(result);
      return result;
    } catch (err) {
      return {
        ok: false,
        provider: targetPid,
        message: extractErrorMessage(err, `No se pudo conectar con ${spec.name} desde el navegador.`),
      };
    }
  }

  try {
    const resp = await fetch(`${OPENROUTER_BASE_URL}/key`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    const body = (await resp.json()) as {
      data?: {
        label?: string;
        is_free_tier?: boolean;
        limit?: number | null;
        limit_remaining?: number | null;
        limit_reset?: string | null;
        usage?: number | null;
        usage_daily?: number | null;
        usage_weekly?: number | null;
        usage_monthly?: number | null;
      };
      error?: { message?: string };
    };
    if (!resp.ok) {
      return {
        ok: false,
        provider: "openrouter",
        message: body.error?.message || `Error HTTP ${resp.status}`,
      };
    }
    const d = body.data ?? {};
    const isFreeTier = Boolean(d.is_free_tier);
    const limitVal = d.limit ?? null;
    const limitRemaining = d.limit_remaining ?? null;

    let creditsTotal: number | null = null;
    let creditsUsage: number | null = null;
    let creditsRemaining: number | null = null;
    try {
      const credResp = await fetch(`${OPENROUTER_BASE_URL}/credits`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (credResp.ok) {
        const credBody = (await credResp.json()) as {
          data?: { total_credits?: number; total_usage?: number };
        };
        if (typeof credBody.data?.total_credits === "number") {
          creditsTotal = credBody.data.total_credits;
          creditsUsage = credBody.data.total_usage ?? 0;
          creditsRemaining = Math.max(0, Math.round((creditsTotal - creditsUsage) * 1_000_000) / 1_000_000);
        }
      }
    } catch {
      // /credits requiere clave de administración en algunos casos
    }

    const canUsePaid =
      creditsRemaining !== null
        ? creditsRemaining > 0 && (limitRemaining === null || limitRemaining > 0)
        : limitRemaining !== null
        ? limitRemaining > 0
        : !isFreeTier;

    const headerLimits = parseBrowserRateLimitHeaders(resp.headers, "openrouter");
    const openRouterResult: AiConnectionTestResult = {
      ok: true,
      provider: "openrouter",
      label: d.label || "OpenRouter",
      is_free_tier: isFreeTier,
      limit: limitVal,
      limit_remaining: limitRemaining,
      limit_reset: d.limit_reset ?? null,
      usage: d.usage ?? null,
      usage_daily: d.usage_daily ?? null,
      usage_weekly: d.usage_weekly ?? null,
      usage_monthly: d.usage_monthly ?? null,
      credits_total: creditsTotal,
      credits_usage: creditsUsage,
      credits_remaining: creditsRemaining,
      balance_usd: creditsRemaining,
      balance_raw: creditsRemaining,
      balance_currency: creditsRemaining !== null ? "USD" : null,
      can_use_paid_models: canUsePaid,
      rate_limit_source: "api_balance",
      rate_limits: headerLimits,
      daily_free_limit: isFreeTier ? 50 : 1000,
      rpm_free_limit: 20,
      message: "Conexión verificada con OpenRouter.",
    };
    recordBrowserTestConnectionUsage(openRouterResult);
    return openRouterResult;
  } catch (err) {
    return {
      ok: false,
      provider: "openrouter",
      message: extractErrorMessage(err, "No se pudo conectar con OpenRouter."),
    };
  }
}

function getLocalDayAndMonthKeys(): { day: string; month: string; nowMs: number } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { day: `${y}-${m}-${day}`, month: `${y}-${m}`, nowMs: d.getTime() };
}

function parseNumericHeader(val: string | null): number | null {
  if (!val) return null;
  const n = Number(val.trim());
  return Number.isFinite(n) ? n : null;
}

function parseDurationResetMs(val: string | null, nowMs: number): number | null {
  if (!val) return null;
  const s = val.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const pure = Number(s);
  if (Number.isFinite(pure)) {
    return pure > 1_000_000_000 ? Math.round(pure * 1000) : Math.round(nowMs + pure * 1000);
  }
  let sec = 0;
  for (const m of s.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/g)) {
    const num = Number(m[1]);
    if (!Number.isFinite(num)) continue;
    if (m[2] === "ms") sec += num / 1000;
    else if (m[2] === "s") sec += num;
    else if (m[2] === "m") sec += num * 60;
    else if (m[2] === "h") sec += num * 3600;
    else if (m[2] === "d") sec += num * 86400;
  }
  return sec > 0 ? Math.round(nowMs + sec * 1000) : null;
}

export function normalizeRateLimitsSnapshot(raw: unknown): ProviderRateLimitsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pickNum = (camel: string, snake: string): number | null => {
    const v = r[camel] ?? r[snake];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const pickStr = (camel: string, snake: string): string | null => {
    const v = r[camel] ?? r[snake];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const snap: ProviderRateLimitsSnapshot = {
    source: pickStr("source", "source"),
    updatedAtMs: pickNum("updatedAtMs", "updated_at_ms"),
    rpmLimit: pickNum("rpmLimit", "rpm_limit"),
    rpmRemaining: pickNum("rpmRemaining", "rpm_remaining"),
    rpmResetAtMs: pickNum("rpmResetAtMs", "rpm_reset_at_ms"),
    tpmLimit: pickNum("tpmLimit", "tpm_limit"),
    tpmRemaining: pickNum("tpmRemaining", "tpm_remaining"),
    tpmResetAtMs: pickNum("tpmResetAtMs", "tpm_reset_at_ms"),
    itpmLimit: pickNum("itpmLimit", "itpm_limit"),
    itpmRemaining: pickNum("itpmRemaining", "itpm_remaining"),
    otpmLimit: pickNum("otpmLimit", "otpm_limit"),
    otpmRemaining: pickNum("otpmRemaining", "otpm_remaining"),
    retryAfterSec: pickNum("retryAfterSec", "retry_after_sec"),
    dailyLimit: pickNum("dailyLimit", "daily_limit"),
    dailyRemaining: pickNum("dailyRemaining", "daily_remaining"),
  };
  const hasAny =
    snap.rpmLimit !== null ||
    snap.rpmRemaining !== null ||
    snap.tpmLimit !== null ||
    snap.tpmRemaining !== null ||
    snap.itpmLimit !== null ||
    snap.otpmLimit !== null ||
    snap.dailyLimit !== null ||
    snap.retryAfterSec !== null;
  return hasAny ? snap : null;
}

export function parseBrowserRateLimitHeaders(
  headers: Headers,
  providerId: AiProviderId | string
): ProviderRateLimitsSnapshot | null {
  const nowMs = Date.now();
  const pid = normalizeProviderIdClient(providerId);
  const rpmLimit =
    parseNumericHeader(headers.get("anthropic-ratelimit-requests-limit")) ??
    parseNumericHeader(headers.get("x-ratelimit-limit-requests"));
  const rpmRemaining =
    parseNumericHeader(headers.get("anthropic-ratelimit-requests-remaining")) ??
    parseNumericHeader(headers.get("x-ratelimit-remaining-requests"));
  const rpmResetAtMs =
    parseDurationResetMs(headers.get("anthropic-ratelimit-requests-reset"), nowMs) ??
    parseDurationResetMs(headers.get("x-ratelimit-reset-requests"), nowMs);
  const tpmLimit =
    parseNumericHeader(headers.get("anthropic-ratelimit-tokens-limit")) ??
    parseNumericHeader(headers.get("x-ratelimit-limit-tokens"));
  const tpmRemaining =
    parseNumericHeader(headers.get("anthropic-ratelimit-tokens-remaining")) ??
    parseNumericHeader(headers.get("x-ratelimit-remaining-tokens"));
  const tpmResetAtMs =
    parseDurationResetMs(headers.get("anthropic-ratelimit-tokens-reset"), nowMs) ??
    parseDurationResetMs(headers.get("x-ratelimit-reset-tokens"), nowMs);
  const itpmLimit = parseNumericHeader(headers.get("anthropic-ratelimit-input-tokens-limit"));
  const itpmRemaining = parseNumericHeader(headers.get("anthropic-ratelimit-input-tokens-remaining"));
  const otpmLimit = parseNumericHeader(headers.get("anthropic-ratelimit-output-tokens-limit"));
  const otpmRemaining = parseNumericHeader(headers.get("anthropic-ratelimit-output-tokens-remaining"));
  const retryAfterSec = parseNumericHeader(headers.get("retry-after"));

  return normalizeRateLimitsSnapshot({
    source: `${pid}_headers`,
    updatedAtMs: nowMs,
    rpmLimit,
    rpmRemaining,
    rpmResetAtMs,
    tpmLimit,
    tpmRemaining,
    tpmResetAtMs,
    itpmLimit,
    itpmRemaining,
    otpmLimit,
    otpmRemaining,
    retryAfterSec,
  });
}

function createEmptyUsageEntry(provider: AiProviderId): ProviderUsageEntry {
  const { day, month } = getLocalDayAndMonthKeys();
  return {
    provider,
    todayDate: day,
    todayRequests: 0,
    todayPromptTokens: 0,
    todayCompletionTokens: 0,
    todayCachedTokens: 0,
    todayCostUsd: 0,
    monthKey: month,
    monthRequests: 0,
    monthPromptTokens: 0,
    monthCompletionTokens: 0,
    monthCachedTokens: 0,
    monthCostUsd: 0,
    recentRequestTimestampsMs: [],
    currentRpm: 0,
    lastModelId: null,
    lastRequestAtMs: null,
    rateLimits: null,
    balance: null,
    limits: {},
  };
}

function rolloverUsageEntry(entry: ProviderUsageEntry, day: string, month: string, nowMs: number): ProviderUsageEntry {
  const next = { ...entry };
  if (next.todayDate !== day) {
    next.todayDate = day;
    next.todayRequests = 0;
    next.todayPromptTokens = 0;
    next.todayCompletionTokens = 0;
    next.todayCachedTokens = 0;
    next.todayCostUsd = 0;
  }
  if (next.monthKey !== month) {
    next.monthKey = month;
    next.monthRequests = 0;
    next.monthPromptTokens = 0;
    next.monthCompletionTokens = 0;
    next.monthCachedTokens = 0;
    next.monthCostUsd = 0;
  }
  const cutoff = nowMs - 60_000;
  const recent = Array.isArray(next.recentRequestTimestampsMs)
    ? next.recentRequestTimestampsMs.filter((ts) => typeof ts === "number" && ts >= cutoff)
    : [];
  next.recentRequestTimestampsMs = recent;
  next.currentRpm = recent.length;
  return next;
}

function readBrowserUsageLedger(): AiUsageLedger {
  const { day, month, nowMs } = getLocalDayAndMonthKeys();
  try {
    const raw = localStorage.getItem(BROWSER_USAGE_LEDGER_KEY);
    if (!raw) return { providers: {} };
    const parsed = JSON.parse(raw) as Partial<AiUsageLedger>;
    const providers: Record<string, ProviderUsageEntry> = {};
    if (parsed.providers && typeof parsed.providers === "object") {
      for (const [k, entry] of Object.entries(parsed.providers)) {
        if (!entry) continue;
        const pid = normalizeProviderIdClient(k);
        providers[pid] = rolloverUsageEntry(
          {
            ...createEmptyUsageEntry(pid),
            ...entry,
            provider: pid,
            limits: entry.limits ?? {},
          },
          day,
          month,
          nowMs
        );
      }
    }
    return { providers };
  } catch {
    return { providers: {} };
  }
}

function writeBrowserUsageLedger(ledger: AiUsageLedger): void {
  try {
    localStorage.setItem(BROWSER_USAGE_LEDGER_KEY, JSON.stringify(ledger));
    window.dispatchEvent(new CustomEvent<AiUsageLedger>(BROWSER_USAGE_EVENT, { detail: ledger }));
  } catch {
    // Ignorar error de almacenamiento privado
  }
}

export function estimateBrowserTurnCostUsd(
  providerId: AiProviderId | string,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0
): number {
  const pid = normalizeProviderIdClient(providerId);
  const spec = AI_PROVIDERS[pid];
  const lower = (modelId || "").toLowerCase();
  const match =
    spec.curatedModels.find((m) => m.id.toLowerCase() === lower) ??
    spec.curatedModels.find((m) => lower.includes(m.id.toLowerCase()));
  if (!match || match.is_free) return 0;
  const inPrice = match.prompt_price_per_million ?? 0;
  const outPrice = match.completion_price_per_million ?? 0;
  const cachePrice = match.cache_price_per_million ?? inPrice;
  const safeCached = Math.min(Math.max(0, cachedTokens), Math.max(0, promptTokens));
  const uncachedIn = Math.max(0, promptTokens - safeCached);
  const cost =
    (uncachedIn / 1_000_000) * inPrice +
    (safeCached / 1_000_000) * cachePrice +
    (Math.max(0, completionTokens) / 1_000_000) * outPrice;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function recordBrowserTestConnectionUsage(result: AiConnectionTestResult): void {
  if (!result.ok || !result.provider) return;
  const pid = normalizeProviderIdClient(result.provider);
  const { day, month, nowMs } = getLocalDayAndMonthKeys();
  const ledger = readBrowserUsageLedger();
  const entry = rolloverUsageEntry(
    ledger.providers[pid] ?? createEmptyUsageEntry(pid),
    day,
    month,
    nowMs
  );
  const normRl = normalizeRateLimitsSnapshot(result.rate_limits);
  if (normRl) entry.rateLimits = normRl;
  entry.balance = {
    currency: result.balance_currency ?? result.currency ?? (result.credits_remaining !== null ? "USD" : null),
    balanceRaw: result.balance_raw ?? result.balance_usd ?? result.credits_remaining ?? null,
    balanceUsd: result.balance_usd ?? (result.balance_currency === "USD" ? result.balance_raw : null) ?? result.credits_remaining ?? null,
    creditsRemaining: result.credits_remaining ?? null,
    creditsTotal: result.credits_total ?? null,
    creditsUsage: result.credits_usage ?? null,
    balanceGranted: result.balance_granted ?? null,
    balanceToppedUp: result.balance_topped_up ?? null,
    limit: result.limit ?? null,
    limitRemaining: result.limit_remaining ?? null,
    limitReset: result.limit_reset ?? null,
    isFreeTier: result.is_free_tier ?? null,
    canUsePaidModels: result.can_use_paid_models ?? null,
    apiUsageDaily: result.usage_daily ?? null,
    apiUsageMonthly: result.usage_monthly ?? null,
    updatedAtMs: nowMs,
    source: result.rate_limit_source ?? "test_connection",
  };
  ledger.providers[pid] = entry;
  writeBrowserUsageLedger(ledger);
}

export function recordBrowserAiUsage(params: {
  provider: string;
  modelId: string;
  usage?: XoxTokenUsage;
  rateLimits?: ProviderRateLimitsSnapshot | null;
}): void {
  const pid = normalizeProviderIdClient(params.provider);
  const { day, month, nowMs } = getLocalDayAndMonthKeys();
  const ledger = readBrowserUsageLedger();
  const entry = rolloverUsageEntry(
    ledger.providers[pid] ?? createEmptyUsageEntry(pid),
    day,
    month,
    nowMs
  );
  const pt = Math.max(0, params.usage?.promptTokens ?? 0);
  const ct = Math.max(0, params.usage?.completionTokens ?? 0);
  const cached = Math.max(0, params.usage?.cachedTokens ?? 0);
  const rawCost =
    params.usage?.estimatedCostUsd ??
    params.usage?.cost ??
    estimateBrowserTurnCostUsd(pid, params.modelId, pt, ct, cached);
  const cost = Number.isFinite(rawCost) && rawCost > 0 ? Math.round(rawCost * 1_000_000) / 1_000_000 : 0;

  entry.todayRequests += 1;
  entry.monthRequests += 1;
  entry.todayPromptTokens += pt;
  entry.todayCompletionTokens += ct;
  entry.todayCachedTokens += cached;
  entry.todayCostUsd = Math.round((entry.todayCostUsd + cost) * 1_000_000) / 1_000_000;
  entry.monthPromptTokens += pt;
  entry.monthCompletionTokens += ct;
  entry.monthCachedTokens += cached;
  entry.monthCostUsd = Math.round((entry.monthCostUsd + cost) * 1_000_000) / 1_000_000;
  entry.lastModelId = params.modelId;
  entry.lastRequestAtMs = nowMs;
  const recent = [...entry.recentRequestTimestampsMs, nowMs].slice(-120);
  entry.recentRequestTimestampsMs = recent;
  entry.currentRpm = recent.length;
  if (params.rateLimits) {
    entry.rateLimits = params.rateLimits;
  }
  ledger.providers[pid] = entry;
  writeBrowserUsageLedger(ledger);
}

export async function getAiUsageLedger(): Promise<AiUsageLedger> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiUsageLedger>("get_ai_usage_ledger");
    } catch {
      // Fallback a almacenamiento local
    }
  }
  return readBrowserUsageLedger();
}

export async function setProviderUsageLimits(input: SetProviderLimitsInput): Promise<AiUsageLedger> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiUsageLedger>("set_provider_usage_limits", {
        payload: {
          provider: input.provider,
          monthlyBudgetUsd: input.monthlyBudgetUsd ?? null,
          dailyRequestLimit: input.dailyRequestLimit ?? null,
          rpmLimit: input.rpmLimit ?? null,
          tierMode: input.tierMode ?? null,
        },
      });
    } catch {
      // Fallback abajo
    }
  }
  const pid = normalizeProviderIdClient(input.provider);
  const { day, month, nowMs } = getLocalDayAndMonthKeys();
  const ledger = readBrowserUsageLedger();
  const entry = rolloverUsageEntry(
    ledger.providers[pid] ?? createEmptyUsageEntry(pid),
    day,
    month,
    nowMs
  );
  entry.limits = {
    monthlyBudgetUsd:
      typeof input.monthlyBudgetUsd === "number" && Number.isFinite(input.monthlyBudgetUsd) && input.monthlyBudgetUsd > 0
        ? input.monthlyBudgetUsd
        : null,
    dailyRequestLimit:
      typeof input.dailyRequestLimit === "number" && Number.isFinite(input.dailyRequestLimit) && input.dailyRequestLimit > 0
        ? Math.round(input.dailyRequestLimit)
        : null,
    rpmLimit:
      typeof input.rpmLimit === "number" && Number.isFinite(input.rpmLimit) && input.rpmLimit > 0
        ? Math.round(input.rpmLimit)
        : null,
    tierMode: input.tierMode === "free" || input.tierMode === "paid" ? input.tierMode : null,
  };
  ledger.providers[pid] = entry;
  writeBrowserUsageLedger(ledger);
  return ledger;
}

export async function resetProviderUsageLedger(provider?: string | null): Promise<AiUsageLedger> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiUsageLedger>("reset_provider_usage_ledger", {
        provider: provider ?? null,
      });
    } catch {
      // Fallback abajo
    }
  }
  const target = provider?.trim() ? normalizeProviderIdClient(provider) : null;
  const ledger = readBrowserUsageLedger();
  for (const [pid, entry] of Object.entries(ledger.providers)) {
    if (!target || pid === target) {
      entry.todayRequests = 0;
      entry.todayPromptTokens = 0;
      entry.todayCompletionTokens = 0;
      entry.todayCachedTokens = 0;
      entry.todayCostUsd = 0;
      entry.monthRequests = 0;
      entry.monthPromptTokens = 0;
      entry.monthCompletionTokens = 0;
      entry.monthCachedTokens = 0;
      entry.monthCostUsd = 0;
      entry.recentRequestTimestampsMs = [];
      entry.currentRpm = 0;
    }
  }
  writeBrowserUsageLedger(ledger);
  return ledger;
}

export async function onAiUsageUpdated(handler: (ledger: AiUsageLedger) => void): Promise<() => void> {
  const onBrowserEvt = (e: Event) => {
    const custom = e as CustomEvent<AiUsageLedger>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(BROWSER_USAGE_EVENT, onBrowserEvt);

  let unlistenTauri: (() => void) | null = null;
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenTauri = await listen<AiUsageLedger>(AI_USAGE_UPDATED_EVENT, (ev) => {
        if (ev.payload) handler(ev.payload);
      });
    } catch {
      // Ignorar si no está disponible
    }
  }
  return () => {
    window.removeEventListener(BROWSER_USAGE_EVENT, onBrowserEvt);
    if (unlistenTauri) unlistenTauri();
  };
}

export interface ProviderUsageSummary {
  provider: AiProviderId;
  providerName: string;
  sourceKind:
    | "api_balance"
    | "api_headers"
    | "user_budget"
    | "user_daily_cap"
    | "reference_tier"
    | "local_meter";
  sourceBadge: string;
  tierLabel: string;
  headline: string;
  shortBadge: string;
  subline: string;
  pct: number;
  meterMode: "remaining" | "used" | "unlimited";
  hasMeterBar: boolean;
  canUsePaid: boolean;
  isFreeTier: boolean;
  currency: string | null;
  balanceAmount: number | null;
  balanceGranted: number | null;
  balanceToppedUp: number | null;
  monthlyBudgetUsd: number | null;
  monthCostUsd: number;
  todayCostUsd: number;
  todayRequests: number;
  monthRequests: number;
  todayTokens: number;
  monthTokens: number;
  todayCachedTokens: number;
  monthCachedTokens: number;
  currentRpm: number;
  effectiveRpmLimit: number | null;
  effectiveRpmRemaining: number | null;
  rpmResetText: string | null;
  tpmRemaining: number | null;
  tpmLimit: number | null;
  dailyLimit: number | null;
  dailyRemaining: number | null;
}

function formatMoneyAmount(amount: number, currency?: string | null): string {
  const cur = (currency || "USD").toUpperCase();
  const abs = Math.abs(amount);
  const formatted = abs > 0 && abs < 0.01 ? amount.toFixed(4) : amount.toFixed(2);
  if (cur === "CNY" || cur === "RMB") return `¥${formatted} CNY`;
  return `$${formatted} ${cur}`;
}

function formatUsdShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs === 0) return "$0.00";
  if (abs < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

function formatResetEta(resetAtMs?: number | null): string | null {
  if (!resetAtMs || resetAtMs <= Date.now()) return null;
  const diffSec = Math.max(1, Math.round((resetAtMs - Date.now()) / 1000));
  if (diffSec < 60) return `reinicio en ${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const remSec = diffSec % 60;
  if (mins < 60) return `reinicio en ${mins}m ${remSec}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `reinicio en ${hrs}h ${remMins}m`;
}

export function computeProviderUsageSummary(params: {
  provider?: string | null;
  aiConfig?: AiConfigStatus | null;
  accountUsage?: AiConnectionTestResult | null;
  usageLedger?: AiUsageLedger | null;
  requestsTodayFallback?: number;
  modelId?: string | null;
}): ProviderUsageSummary {
  const pid = normalizeProviderIdClient(params.provider ?? params.aiConfig?.provider);
  const spec = AI_PROVIDERS[pid];
  const entry = params.usageLedger?.providers?.[pid];
  const slot = params.aiConfig?.configuredProviders?.[pid];
  const hasKey = Boolean(slot?.hasApiKey ?? (params.aiConfig?.provider === pid && params.aiConfig?.hasApiKey));
  const liveTest =
    params.accountUsage &&
    params.accountUsage.ok &&
    (!params.accountUsage.provider || normalizeProviderIdClient(params.accountUsage.provider) === pid)
      ? params.accountUsage
      : null;

  const bal = entry?.balance ?? null;
  const rl = normalizeRateLimitsSnapshot(liveTest?.rate_limits ?? entry?.rateLimits);
  const limits = entry?.limits ?? {};

  const todayRequests = entry?.todayRequests ?? params.requestsTodayFallback ?? 0;
  const monthRequests = entry?.monthRequests ?? todayRequests;
  const todayTokens = (entry?.todayPromptTokens ?? 0) + (entry?.todayCompletionTokens ?? 0);
  const monthTokens = (entry?.monthPromptTokens ?? 0) + (entry?.monthCompletionTokens ?? 0);
  const todayCachedTokens = entry?.todayCachedTokens ?? 0;
  const monthCachedTokens = entry?.monthCachedTokens ?? 0;
  const todayCostUsd = entry?.todayCostUsd ?? 0;
  const monthCostUsd = entry?.monthCostUsd ?? 0;
  const currentRpm = entry?.currentRpm ?? 0;

  const monthlyBudgetUsd =
    typeof limits.monthlyBudgetUsd === "number" && limits.monthlyBudgetUsd > 0 ? limits.monthlyBudgetUsd : null;
  const userDailyCap =
    typeof limits.dailyRequestLimit === "number" && limits.dailyRequestLimit > 0 ? limits.dailyRequestLimit : null;
  const userRpmCap =
    typeof limits.rpmLimit === "number" && limits.rpmLimit > 0 ? limits.rpmLimit : null;
  const tierOverride = limits.tierMode === "free" || limits.tierMode === "paid" ? limits.tierMode : null;

  const currency = liveTest?.balance_currency ?? liveTest?.currency ?? bal?.currency ?? null;
  const balanceAmount =
    liveTest?.balance_raw ??
    liveTest?.balance_usd ??
    liveTest?.credits_remaining ??
    bal?.balanceRaw ??
    bal?.balanceUsd ??
    bal?.creditsRemaining ??
    null;
  const balanceGranted = liveTest?.balance_granted ?? bal?.balanceGranted ?? null;
  const balanceToppedUp = liveTest?.balance_topped_up ?? bal?.balanceToppedUp ?? null;

  const keyLimit = liveTest?.limit ?? bal?.limit ?? null;
  const keyLimitRemaining = liveTest?.limit_remaining ?? bal?.limitRemaining ?? null;
  const creditsTotal = liveTest?.credits_total ?? bal?.creditsTotal ?? null;

  const canUsePaid =
    liveTest?.can_use_paid_models ??
    bal?.canUsePaidModels ??
    (pid === "deepseek" || pid === "kimi"
      ? balanceAmount !== null
        ? balanceAmount > 0
        : hasKey
      : pid === "openrouter"
        ? tierOverride === "paid"
        : true);

  const isFreeTier =
    tierOverride === "paid"
      ? false
      : tierOverride === "free"
        ? true
        : liveTest?.is_free_tier ?? bal?.isFreeTier ?? spec.supportsFreeTier;

  const rpmResetText = formatResetEta(rl?.rpmResetAtMs);
  const tpmLimit = rl?.tpmLimit ?? null;
  const tpmRemaining = rl?.tpmRemaining ?? null;

  const effectiveRpmLimit =
    rl?.rpmLimit ??
    userRpmCap ??
    (pid === "groq" && isFreeTier
      ? 30
      : pid === "gemini" && isFreeTier
        ? 15
        : pid === "openrouter" && isFreeTier
          ? 20
          : null);
  const effectiveRpmRemaining =
    rl?.rpmRemaining !== null && rl?.rpmRemaining !== undefined
      ? rl.rpmRemaining
      : effectiveRpmLimit !== null
        ? Math.max(0, effectiveRpmLimit - currentRpm)
        : null;

  const defaultDailyRef =
    pid === "openrouter" && isFreeTier
      ? creditsTotal !== null && creditsTotal >= 10
        ? 1000
        : 50
      : pid === "gemini" && isFreeTier
        ? 1000
        : null;
  const dailyLimit = rl?.dailyLimit ?? userDailyCap ?? defaultDailyRef;
  const dailyRemaining =
    rl?.dailyRemaining !== null && rl?.dailyRemaining !== undefined
      ? rl.dailyRemaining
      : dailyLimit !== null
        ? Math.max(0, dailyLimit - todayRequests)
        : null;

  if (!hasKey) {
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: "local_meter",
      sourceBadge: "Sin clave",
      tierLabel: `${spec.shortName} · Sin clave`,
      headline: `Configura tu clave de ${spec.shortName}`,
      shortBadge: "Sin clave",
      subline: spec.rateLimitNote,
      pct: 0,
      meterMode: "unlimited",
      hasMeterBar: false,
      canUsePaid: false,
      isFreeTier: spec.supportsFreeTier,
      currency,
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining,
    };
  }

  // 1. OpenRouter
  if (pid === "openrouter") {
    if (keyLimit !== null && keyLimit > 0 && keyLimitRemaining !== null) {
      const pct = Math.max(0, Math.min(100, Math.round((keyLimitRemaining / keyLimit) * 100)));
      return {
        provider: pid,
        providerName: spec.shortName,
        sourceKind: "api_balance",
        sourceBadge: "API OpenRouter",
        tierLabel: isFreeTier ? "OpenRouter Free" : "OpenRouter Pro",
        headline: `${formatUsdShort(keyLimitRemaining)} / ${formatUsdShort(keyLimit)} disp.`,
        shortBadge: formatUsdShort(keyLimitRemaining),
        subline: `Uso hoy: ${todayRequests} req · Mes est.: ${formatUsdShort(monthCostUsd)}`,
        pct,
        meterMode: "remaining",
        hasMeterBar: true,
        canUsePaid,
        isFreeTier,
        currency: "USD",
        balanceAmount: balanceAmount ?? keyLimitRemaining,
        balanceGranted,
        balanceToppedUp,
        monthlyBudgetUsd,
        monthCostUsd,
        todayCostUsd,
        todayRequests,
        monthRequests,
        todayTokens,
        monthTokens,
        todayCachedTokens,
        monthCachedTokens,
        currentRpm,
        effectiveRpmLimit,
        effectiveRpmRemaining,
        rpmResetText,
        tpmRemaining,
        tpmLimit,
        dailyLimit,
        dailyRemaining,
      };
    }
    if (balanceAmount !== null) {
      const hasBudget = monthlyBudgetUsd !== null && monthlyBudgetUsd > 0;
      const pct = hasBudget
        ? Math.max(0, Math.min(100, Math.round((monthCostUsd / monthlyBudgetUsd!) * 100)))
        : creditsTotal && creditsTotal > 0
          ? Math.max(0, Math.min(100, Math.round((balanceAmount / creditsTotal) * 100)))
          : balanceAmount > 0
            ? 100
            : 0;
      return {
        provider: pid,
        providerName: spec.shortName,
        sourceKind: hasBudget ? "user_budget" : "api_balance",
        sourceBadge: hasBudget ? "Saldo API + Presupuesto" : "Saldo API",
        tierLabel: balanceAmount > 0 ? "OpenRouter Prepago" : "OpenRouter Free",
        headline: hasBudget
          ? `Saldo: ${formatMoneyAmount(balanceAmount, currency)} · Mes ${formatUsdShort(monthCostUsd)}/${formatUsdShort(monthlyBudgetUsd!)}`
          : `Saldo API: ${formatMoneyAmount(balanceAmount, currency)}`,
        shortBadge: formatMoneyAmount(balanceAmount, currency),
        subline: `Hoy: ${todayRequests} req · ${formatTokenCount(todayTokens)} tok · ${currentRpm} RPM`,
        pct,
        meterMode: hasBudget ? "used" : "remaining",
        hasMeterBar: true,
        canUsePaid,
        isFreeTier,
        currency: currency || "USD",
        balanceAmount,
        balanceGranted,
        balanceToppedUp,
        monthlyBudgetUsd,
        monthCostUsd,
        todayCostUsd,
        todayRequests,
        monthRequests,
        todayTokens,
        monthTokens,
        todayCachedTokens,
        monthCachedTokens,
        currentRpm,
        effectiveRpmLimit,
        effectiveRpmRemaining,
        rpmResetText,
        tpmRemaining,
        tpmLimit,
        dailyLimit,
        dailyRemaining,
      };
    }
    const cap = dailyLimit ?? 50;
    const rem = Math.max(0, cap - todayRequests);
    const pct = Math.max(0, Math.min(100, Math.round((rem / cap) * 100)));
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: userDailyCap ? "user_daily_cap" : "reference_tier",
      sourceBadge: userDailyCap ? "Límite local" : "Tier gratis ref.",
      tierLabel: `OpenRouter ${cap === 1000 ? "Free 1K" : "Free"}`,
      headline: `Gratis hoy: ${rem} / ${cap} restantes`,
      shortBadge: `${rem}/${cap} hoy`,
      subline: `${todayRequests} envíos hoy · máx ${effectiveRpmLimit ?? 20} RPM`,
      pct,
      meterMode: "remaining",
      hasMeterBar: true,
      canUsePaid,
      isFreeTier: true,
      currency: "USD",
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit: cap,
      dailyRemaining: rem,
    };
  }

  // 2. DeepSeek y Kimi (prepago con consulta de saldo real en servidor)
  if (pid === "deepseek" || pid === "kimi") {
    const hasBalance = balanceAmount !== null;
    const hasBudget = monthlyBudgetUsd !== null && monthlyBudgetUsd > 0;
    const hasServerRpm = rl?.rpmLimit && rl.rpmLimit > 0 && rl.rpmRemaining !== null && rl.rpmRemaining !== undefined;
    let pct = 0;
    let meterMode: "remaining" | "used" | "unlimited" = "unlimited";
    let hasMeterBar = false;

    if (hasBudget) {
      pct = Math.max(0, Math.min(100, Math.round((monthCostUsd / monthlyBudgetUsd!) * 100)));
      meterMode = "used";
      hasMeterBar = true;
    } else if (hasServerRpm) {
      pct = Math.max(0, Math.min(100, Math.round((rl!.rpmRemaining! / rl!.rpmLimit!) * 100)));
      meterMode = "remaining";
      hasMeterBar = true;
    } else if (dailyLimit !== null && dailyRemaining !== null) {
      pct = Math.max(0, Math.min(100, Math.round((dailyRemaining / dailyLimit) * 100)));
      meterMode = "remaining";
      hasMeterBar = true;
    } else if (hasBalance) {
      pct = balanceAmount! > 0 && canUsePaid ? 100 : 0;
      meterMode = "remaining";
      hasMeterBar = true;
    }

    const balanceText = hasBalance
      ? balanceAmount! > 0 && canUsePaid
        ? `Saldo API: ${formatMoneyAmount(balanceAmount!, currency)}`
        : `Saldo agotado (${formatMoneyAmount(balanceAmount ?? 0, currency)})`
      : `Sin saldo consultado · ${todayRequests} req hoy`;

    const headline = hasBudget
      ? `${hasBalance ? `${formatMoneyAmount(balanceAmount!, currency)} disp. · ` : ""}Mes ${formatUsdShort(monthCostUsd)}/${formatUsdShort(monthlyBudgetUsd!)}`
      : hasServerRpm
        ? `${balanceText} · ${rl!.rpmRemaining}/${rl!.rpmLimit} RPM`
        : balanceText;

    const shortBadge = hasBalance
      ? formatMoneyAmount(balanceAmount!, currency)
      : todayCostUsd > 0
        ? `~${formatUsdShort(todayCostUsd)}`
        : spec.tierBadge;

    const subParts: string[] = [];
    if (todayRequests > 0 || todayTokens > 0) {
      subParts.push(`Hoy: ${todayRequests} req · ${formatTokenCount(todayTokens)} tok (~${formatUsdShort(todayCostUsd)})`);
    } else {
      subParts.push(spec.tariffSummary);
    }
    if (rpmResetText) subParts.push(rpmResetText);

    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: hasBalance ? "api_balance" : hasBudget ? "user_budget" : "local_meter",
      sourceBadge: hasBalance ? "Saldo API real" : hasBudget ? "Presupuesto usuario" : "Medición local",
      tierLabel: hasBalance
        ? canUsePaid
          ? `${spec.shortName} · Prepago`
          : `${spec.shortName} · Sin saldo`
        : `${spec.shortName} · Prepago`,
      headline,
      shortBadge,
      subline: subParts.join(" · "),
      pct,
      meterMode,
      hasMeterBar,
      canUsePaid,
      isFreeTier: false,
      currency: currency || "USD",
      balanceAmount,
      balanceGranted,
      balanceToppedUp,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining,
    };
  }

  // 3. Anthropic, OpenAI, Groq, Gemini (rate-limits en headers / 429 o presupuesto/cuota local)
  if (rl && ((rl.rpmLimit && rl.rpmLimit > 0 && rl.rpmRemaining !== null && rl.rpmRemaining !== undefined) || (rl.tpmLimit && rl.tpmLimit > 0 && rl.tpmRemaining !== null && rl.tpmRemaining !== undefined))) {
    const useRpm = Boolean(rl.rpmLimit && rl.rpmLimit > 0 && rl.rpmRemaining !== null && rl.rpmRemaining !== undefined);
    const pct = useRpm
      ? Math.max(0, Math.min(100, Math.round((rl.rpmRemaining! / rl.rpmLimit!) * 100)))
      : Math.max(0, Math.min(100, Math.round((rl.tpmRemaining! / rl.tpmLimit!) * 100)));
    const headline = useRpm
      ? `RPM API: ${rl.rpmRemaining}/${rl.rpmLimit}${rl.tpmLimit ? ` · TPM ${formatTokenCount(rl.tpmRemaining ?? 0)}/${formatTokenCount(rl.tpmLimit)}` : ""}`
      : `TPM API: ${formatTokenCount(rl.tpmRemaining ?? 0)}/${formatTokenCount(rl.tpmLimit ?? 0)}`;
    const shortBadge = useRpm
      ? `${rl.rpmRemaining}/${rl.rpmLimit} RPM`
      : `${pct}% TPM`;
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: "api_headers",
      sourceBadge: "Headers HTTP reales",
      tierLabel: `${spec.shortName} · ${isFreeTier ? "Gratis" : "Pago"}`,
      headline,
      shortBadge,
      subline: `Hoy: ${todayRequests} req · Est. ${formatUsdShort(todayCostUsd)}${rpmResetText ? ` · ${rpmResetText}` : ""}`,
      pct,
      meterMode: "remaining",
      hasMeterBar: true,
      canUsePaid,
      isFreeTier,
      currency: "USD",
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining,
    };
  }

  if (monthlyBudgetUsd !== null && monthlyBudgetUsd > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((monthCostUsd / monthlyBudgetUsd) * 100)));
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: "user_budget",
      sourceBadge: "Presupuesto usuario",
      tierLabel: `${spec.shortName} · Presupuesto`,
      headline: `Mes est.: ${formatUsdShort(monthCostUsd)} / ${formatUsdShort(monthlyBudgetUsd)}`,
      shortBadge: `${pct}% mes`,
      subline: `Hoy: ${todayRequests} req · ${formatTokenCount(todayTokens)} tok · ${currentRpm} RPM`,
      pct,
      meterMode: "used",
      hasMeterBar: true,
      canUsePaid,
      isFreeTier,
      currency: "USD",
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining,
    };
  }

  if (dailyLimit !== null && dailyLimit > 0) {
    const rem = Math.max(0, dailyLimit - todayRequests);
    const pct = Math.max(0, Math.min(100, Math.round((rem / dailyLimit) * 100)));
    const isRef = !userDailyCap;
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: isRef ? "reference_tier" : "user_daily_cap",
      sourceBadge: isRef ? "Límite ref. gratis" : "Límite local",
      tierLabel: `${spec.shortName} · ${isFreeTier ? "Gratis" : "Tope diario"}`,
      headline: `Hoy: ${todayRequests} / ${dailyLimit} req${effectiveRpmLimit ? ` · ${currentRpm}/${effectiveRpmLimit} RPM` : ""}`,
      shortBadge: `${rem}/${dailyLimit} hoy`,
      subline: `${formatTokenCount(todayTokens)} tok hoy · Sin header HTTP hasta usar cuota`,
      pct,
      meterMode: "remaining",
      hasMeterBar: true,
      canUsePaid,
      isFreeTier,
      currency: "USD",
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining: rem,
    };
  }

  if (effectiveRpmLimit !== null && effectiveRpmLimit > 0) {
    const remRpm = Math.max(0, effectiveRpmLimit - currentRpm);
    const pct = Math.max(0, Math.min(100, Math.round((remRpm / effectiveRpmLimit) * 100)));
    const isRef = !userRpmCap;
    return {
      provider: pid,
      providerName: spec.shortName,
      sourceKind: isRef ? "reference_tier" : "user_daily_cap",
      sourceBadge: isRef ? "RPM ref. gratis" : "RPM local",
      tierLabel: `${spec.shortName} · ${isFreeTier ? "Gratis LPU" : "Tope RPM"}`,
      headline: `RPM actual: ${currentRpm} / ${effectiveRpmLimit} · Hoy: ${todayRequests} req`,
      shortBadge: `${remRpm}/${effectiveRpmLimit} RPM`,
      subline: `${formatTokenCount(todayTokens)} tok hoy · Medición local por minuto`,
      pct,
      meterMode: "remaining",
      hasMeterBar: true,
      canUsePaid,
      isFreeTier,
      currency: "USD",
      balanceAmount: null,
      balanceGranted: null,
      balanceToppedUp: null,
      monthlyBudgetUsd,
      monthCostUsd,
      todayCostUsd,
      todayRequests,
      monthRequests,
      todayTokens,
      monthTokens,
      todayCachedTokens,
      monthCachedTokens,
      currentRpm,
      effectiveRpmLimit,
      effectiveRpmRemaining: remRpm,
      rpmResetText,
      tpmRemaining,
      tpmLimit,
      dailyLimit,
      dailyRemaining,
    };
  }

  // Fallback local puro (ej. Anthropic / OpenAI antes del primer turno o Gemini de pago)
  return {
    provider: pid,
    providerName: spec.shortName,
    sourceKind: "local_meter",
    sourceBadge: "Medición local",
    tierLabel: `${spec.shortName} · ${isFreeTier ? "Gratis" : "Pago"}`,
    headline:
      pid === "gemini"
        ? `Hoy: ${todayRequests} req · ${formatTokenCount(todayTokens)} tok (~${formatUsdShort(todayCostUsd)})`
        : `Hoy: ${todayRequests} req · ${formatTokenCount(todayTokens)} tok (~${formatUsdShort(todayCostUsd)})`,
    shortBadge: todayCostUsd > 0 ? `~${formatUsdShort(todayCostUsd)}` : `${todayRequests} req`,
    subline:
      pid === "gemini"
        ? "Gemini no envía headers de cuota en 200 OK · Configura tu presupuesto en Bóveda"
        : "Envía 1 turno para capturar headers RPM/TPM o configura tu presupuesto",
    pct: 0,
    meterMode: "unlimited",
    hasMeterBar: false,
    canUsePaid,
    isFreeTier,
    currency: "USD",
    balanceAmount: null,
    balanceGranted: null,
    balanceToppedUp: null,
    monthlyBudgetUsd,
    monthCostUsd,
    todayCostUsd,
    todayRequests,
    monthRequests,
    todayTokens,
    monthTokens,
    todayCachedTokens,
    monthCachedTokens,
    currentRpm,
    effectiveRpmLimit,
    effectiveRpmRemaining,
    rpmResetText,
    tpmRemaining,
    tpmLimit,
    dailyLimit,
    dailyRemaining,
  };
}

export async function fetchOpenRouterModels(
  freeOnly = false,
  forceRefresh = false,
  provider?: string
): Promise<{ ok: boolean; models: OpenRouterModelOption[]; source: string }> {
  const pid = normalizeProviderIdClient(provider || "openrouter");
  const spec = AI_PROVIDERS[pid];
  const now = Date.now();
  const cached = cachedCatalogByProvider.get(pid);
  if (!forceRefresh && cached && now - cached.fetchedAt < 5 * 60 * 1000) {
    const models = freeOnly ? cached.models.filter((m) => m.is_free) : cached.models;
    return { ok: true, models, source: cached.source };
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ ok: boolean; models: OpenRouterModelOption[]; source: string }>(
        "fetch_openrouter_models",
        { freeOnly: false, provider: pid }
      );
      if (res.ok && res.models.length > 0) {
        cachedCatalogByProvider.set(pid, { fetchedAt: now, models: res.models, source: res.source });
      }
      const filtered = freeOnly ? res.models.filter((m) => m.is_free) : res.models;
      return { ...res, models: filtered };
    } catch {
      // Fallback abajo
    }
  }

  if (pid !== "openrouter") {
    cachedCatalogByProvider.set(pid, {
      fetchedAt: now,
      models: spec.curatedModels,
      source: `${pid}_curated`,
    });
    return {
      ok: true,
      models: freeOnly ? spec.curatedModels.filter((m) => m.is_free) : spec.curatedModels,
      source: `${pid}_curated`,
    };
  }

  try {
    const vault = readBrowserVault();
    const orKey = vault.providers.openrouter?.apiKey;
    const headers: Record<string, string> = {};
    if (orKey) headers.Authorization = `Bearer ${orKey}`;
    const resp = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = (await resp.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const raw = payload.data ?? [];
    const list: OpenRouterModelOption[] = raw
      .filter((m) => Boolean(m.id))
      .map((m) => ({ ...formatOpenRouterRawModel(m), provider_id: "openrouter" }))
      .sort((a, b) => {
        if (a.id === "openrouter/free") return -1;
        if (b.id === "openrouter/free") return 1;
        if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    cachedCatalogByProvider.set("openrouter", { fetchedAt: now, models: list, source: "openrouter" });
    return {
      ok: true,
      models: freeOnly ? list.filter((m) => m.is_free) : list,
      source: "openrouter",
    };
  } catch {
    return {
      ok: false,
      models: spec.curatedModels.filter((m) => !freeOnly || m.is_free),
      source: "presets",
    };
  }
}

export async function loadWorkspaceContext(): Promise<WorkspaceContextSource[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const overview = await invoke<{
      entries: Array<{ relativePath: string; name: string; zone: string; kind: string; editable: boolean }>;
    }>("get_workspace_overview");
    if (!overview || !Array.isArray(overview.entries)) {
      return [];
    }

    const priorityPaths = [
      "empresa/perfil.json",
      "empresa/roles.md",
      "empresa/reglas/operacion.md",
      "habilidades/perfil-usuario.md",
      "memoria/hechos.md",
      "empresa/proveedores.json",
      "agente/notas-xox.md",
    ];
    const availablePaths = new Set(
      overview.entries.filter((e) => e.kind === "file" && e.editable).map((e) => e.relativePath)
    );
    const chosen = priorityPaths.filter((p) => availablePaths.has(p));

    const results = await Promise.all(
      chosen.map(async (relPath) => {
        try {
          const file = await invoke<{
            relativePath: string;
            name: string;
            zone: string;
            content: string;
          }>("read_workspace_file", { relativePath: relPath });
          const mappedType: WorkspaceContextSource["type"] =
            file.zone === "empresa"
              ? "profile"
              : file.zone === "memoria"
              ? "memory"
              : file.zone === "habilidades"
              ? "skill"
              : "catalog";
          return {
            id: `ws_${file.relativePath}`,
            name: file.name,
            type: mappedType,
            path: file.relativePath,
            content: file.content,
          } satisfies WorkspaceContextSource;
        } catch {
          return null;
        }
      })
    );

    return results.filter((item): item is WorkspaceContextSource => item !== null);
  } catch {
    return [];
  }
}

interface AccumulatedToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

function parseJsonObjectCandidate(rawText: string): Record<string, unknown> | null {
  const text = rawText.trim();
  if (!text) return null;
  const baseCandidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (fence) baseCandidates.push(fence[1]);
  baseCandidates.push(text);
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e > s) baseCandidates.push(text.slice(s, e + 1));

  const candidates: string[] = [];
  for (const cand of baseCandidates) {
    candidates.push(cand);
    const cleaned = cand.replace(/,\s*([}\]])/g, "$1");
    if (cleaned !== cand) candidates.push(cleaned);
  }

  for (const cand of candidates) {
    try {
      let parsed = JSON.parse(cand) as unknown;
      if (typeof parsed === "string") {
        parsed = JSON.parse(parsed) as unknown;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Siguiente candidato
    }
  }
  return null;
}

function isTableRequestPrompt(userMessage: string): boolean {
  return /\b(tabla|tablas|comparativa|comparativo|comparaci[oó]n|comparar|compara|composici[oó]n|desglose|canvas|lienzo|matriz|cuadro)\b/i.test(
    userMessage
  );
}

function hasStructuredTableMarkup(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (lower.includes("<tr") && (lower.includes("<td") || lower.includes("<th"))) return true;
  if (text.includes("|") && text.includes("---")) return true;
  return false;
}

function extractCanvasToolMetadata(toolCalls: AccumulatedToolCall[]): Record<string, unknown> {
  for (const tc of toolCalls) {
    const fnName = (tc.function?.name ?? "").trim().toLowerCase();
    if (!fnName || (!fnName.includes("create_canvas") && fnName !== "canvas")) continue;
    const parsedArgs = parseJsonObjectCandidate(tc.function.arguments);
    if (parsedArgs) {
      const inner =
        parsedArgs.canvas && typeof parsedArgs.canvas === "object"
          ? parsedArgs.canvas
          : parsedArgs.arguments && typeof parsedArgs.arguments === "object"
            ? parsedArgs.arguments
            : parsedArgs;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    }
  }
  return {};
}

function extractCanvasFromToolCalls(toolCalls: AccumulatedToolCall[]): CanvasArtifact | undefined {
  for (const tc of toolCalls) {
    const fnName = (tc.function?.name ?? "").trim().toLowerCase();
    if (!fnName || (!fnName.includes("create_canvas") && fnName !== "canvas")) continue;
    const rawArgs = tc.function.arguments;
    const parsedArgs = parseJsonObjectCandidate(rawArgs);
    if (parsedArgs) {
      const inner =
        parsedArgs.canvas && typeof parsedArgs.canvas === "object"
          ? parsedArgs.canvas
          : parsedArgs.arguments && typeof parsedArgs.arguments === "object"
            ? parsedArgs.arguments
            : parsedArgs;
      const sanitized = sanitizeCanvasArtifact(inner);
      if (sanitized && canvasHasCellData(sanitized)) return sanitized;
    } else if (hasStructuredTableMarkup(rawArgs)) {
      const tbl = sanitizeCanvasArtifact({ title: "Tabla comparativa", markdown: rawArgs });
      if (tbl && canvasHasCellData(tbl)) return tbl;
    }
  }
  return undefined;
}

function extractClarificationFromToolCalls(
  toolCalls: AccumulatedToolCall[],
  originalQuery?: string
): ClarificationSpec | undefined {
  for (const tc of toolCalls) {
    const fnName = (tc.function?.name ?? "").trim().toLowerCase();
    if (!fnName || (!fnName.includes("ask_clarification") && !fnName.includes("open_question"))) {
      continue;
    }
    const parsedArgs = parseJsonObjectCandidate(tc.function.arguments);
    if (!parsedArgs) continue;
    const inner =
      parsedArgs.clarification && typeof parsedArgs.clarification === "object"
        ? parsedArgs.clarification
        : parsedArgs.arguments && typeof parsedArgs.arguments === "object"
          ? parsedArgs.arguments
          : parsedArgs;
    const sanitized = sanitizeClarificationSpec(inner);
    if (sanitized) {
      return {
        ...sanitized,
        originalQuery: sanitized.originalQuery || originalQuery,
      };
    }
  }
  return undefined;
}

function extractVaultActionFromToolCalls(
  toolCalls: AccumulatedToolCall[]
): VaultPromptSpec | undefined {
  for (const tc of toolCalls) {
    const fnName = (tc.function?.name ?? "").trim().toLowerCase();
    if (!fnName || !fnName.includes("configure_ai_vault")) continue;
    const parsedArgs = parseJsonObjectCandidate(tc.function.arguments);
    const rawPid =
      typeof parsedArgs?.provider === "string" ? parsedArgs.provider.trim() : undefined;
    const rawAction =
      typeof parsedArgs?.action === "string"
        ? parsedArgs.action.trim().toLowerCase()
        : "prompt_key";
    const intent =
      rawAction === "switch_provider" || rawAction === "open_settings"
        ? rawAction
        : "prompt_key";
    const note = typeof parsedArgs?.note === "string" ? parsedArgs.note.trim() : undefined;
    return {
      provider: normalizeProviderIdClient(rawPid),
      intent,
      note: note ? note.slice(0, 220) : undefined,
    };
  }
  return undefined;
}

function resolveBrowserCanvasArtifact(params: {
  toolCalls: AccumulatedToolCall[];
  canvasBuf: string;
  actionsCanvas?: unknown;
  fullReply: string;
  userMessage: string;
}): CanvasArtifact | undefined {
  const fromTool = extractCanvasFromToolCalls(params.toolCalls);
  if (fromTool && canvasHasCellData(fromTool)) return fromTool;

  const trimmedCanvas = params.canvasBuf.trim();
  if (trimmedCanvas && trimmedCanvas !== "{}") {
    const parsed = parseJsonObjectCandidate(trimmedCanvas);
    if (parsed) {
      const sanitized = sanitizeCanvasArtifact(parsed);
      if (sanitized && canvasHasCellData(sanitized)) return sanitized;
    }
    const mdTable = extractFirstMarkdownTable(trimmedCanvas) ?? extractFirstHtmlTable(trimmedCanvas);
    if (mdTable) {
      return markdownTableToCanvasArtifact(mdTable, { title: "Tabla comparativa" });
    }
  }

  if (params.actionsCanvas && typeof params.actionsCanvas === "object") {
    const fromActions = sanitizeCanvasArtifact(params.actionsCanvas);
    if (fromActions && canvasHasCellData(fromActions)) return fromActions;
  }

  if (
    hasStructuredTableMarkup(params.fullReply) &&
    (isTableRequestPrompt(params.userMessage) ||
      params.toolCalls.length > 0 ||
      /<tr/i.test(params.fullReply) ||
      params.fullReply.includes("|"))
  ) {
    const inlineTable =
      extractFirstMarkdownTable(params.fullReply) ?? extractFirstHtmlTable(params.fullReply);
    if (inlineTable && inlineTable.rows.length > 0) {
      const meta = params.toolCalls.length > 0 ? extractCanvasToolMetadata(params.toolCalls) : {};
      const title =
        typeof meta.title === "string" && meta.title.trim()
          ? meta.title.trim()
          : typeof meta.titulo === "string" && meta.titulo.trim()
            ? meta.titulo.trim()
            : "Tabla generada";
      const subtitle =
        typeof meta.subtitle === "string" && meta.subtitle.trim()
          ? meta.subtitle.trim()
          : undefined;
      const summary =
        typeof meta.summary === "string" && meta.summary.trim() ? meta.summary.trim() : undefined;
      return markdownTableToCanvasArtifact(inlineTable, { title, subtitle, summary });
    }
  }

  return undefined;
}

function extractBrowserJson(rawContent: string): {
  reply: string;
  xoxMood: "talking" | "success" | "alert";
  operation: "none" | "add_tasks" | "replace_tasks" | "ask_clarification";
  tasks: TaskProposal[];
  canvas?: CanvasArtifact;
  clarification?: ClarificationSpec;
} {
  const parsed = parseJsonObjectCandidate(rawContent);
  if (
    parsed &&
    (typeof parsed.reply === "string" ||
      Array.isArray(parsed.tasks) ||
      parsed.canvas ||
      parsed.clarification)
  ) {
    const safeTasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((t) => sanitizeTaskProposal(t as TaskProposal))
      : [];
    const safeCanvas = parsed.canvas ? sanitizeCanvasArtifact(parsed.canvas) ?? undefined : undefined;
    const safeClarification = parsed.clarification
      ? sanitizeClarificationSpec(parsed.clarification) ?? undefined
      : undefined;
    const op = safeClarification
      ? "ask_clarification"
      : parsed.operation === "add_tasks" ||
          parsed.operation === "replace_tasks" ||
          parsed.operation === "ask_clarification"
        ? parsed.operation
        : safeTasks.length > 0
        ? "add_tasks"
        : "none";
    const mood =
      parsed.xox_mood === "success" || parsed.xox_mood === "alert" || parsed.xox_mood === "talking"
        ? parsed.xox_mood
        : safeTasks.length > 0 || safeCanvas
        ? "success"
        : "talking";
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      xoxMood: mood,
      operation: op,
      tasks: safeTasks,
      canvas: safeCanvas,
      clarification: safeClarification,
    };
  }

  return {
    reply: rawContent.trim() || "Listo, procesé tu consulta.",
    xoxMood: "talking",
    operation: "none",
    tasks: [],
  };
}

function mapFriendlyHttpError(
  status: number,
  rawMessage?: string,
  providerName = "el proveedor de IA"
): string {
  const lower = (rawMessage ?? "").toLowerCase();
  if (
    status === 402 ||
    lower.includes("insufficient credits") ||
    lower.includes("more credits") ||
    lower.includes("insufficient_quota") ||
    lower.includes("credit balance is too low") ||
    lower.includes("insufficient balance") ||
    lower.includes("exceeded your current quota")
  ) {
    return `${providerName} se quedó sin saldo o cuota disponible. Agrega saldo o activa el respaldo automático con otro proveedor.`;
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
    return `Se alcanzó el límite temporal de solicitudes en ${providerName}. Espera un momento o deja que XOOK cambie automáticamente al siguiente proveedor.`;
  }
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("api key not valid")) {
    return `La clave API de ${providerName} no es válida o expiró.`;
  }
  return rawMessage || `Error HTTP ${status} en ${providerName}`;
}

export async function runXoxAiChat(req: XoxAiChatRequest): Promise<XoxAiChatResponse> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<{
      reply: string;
      reasoning?: string;
      xox_mood?: "talking" | "success" | "alert";
      operation?: "none" | "add_tasks" | "replace_tasks" | "ask_clarification";
      tasks?: TaskProposal[];
      canvas?: unknown;
      clarification?: unknown;
      generated_pdfs?: unknown[];
      provider_used?: string;
      model_used?: string;
      latency_ms?: number;
      exhausted_providers?: Array<Record<string, unknown>>;
      failover_events?: Array<{
        from_provider?: string;
        to_provider?: string;
        reason?: string;
        kind?: string;
        model_used?: string;
      }>;
      failover_notice?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cached_tokens?: number;
        prompt_cache_hit_tokens?: number;
        total_tokens?: number;
        cost?: number;
        estimated_cost_usd?: number;
      };
      rate_limits?: Record<string, unknown>;
    }>("run_xox_chat", {
      payload: {
        message: req.message,
        history: req.history,
        currentTasks: req.currentTasks,
        agendaItems: req.agendaItems,
        attachedContext: req.attachedContext,
        modelOverride: req.modelOverride ?? null,
        providerOverride: req.providerOverride ?? null,
        userProfile: req.userProfile ?? null,
        activeCanvas: req.activeCanvas ?? null,
      },
    });
    const cachedTok = res.usage?.cached_tokens ?? res.usage?.prompt_cache_hit_tokens ?? 0;
    const estCost =
      typeof res.usage?.estimated_cost_usd === "number"
        ? res.usage.estimated_cost_usd
        : typeof res.usage?.cost === "number"
          ? res.usage.cost
          : undefined;
    const usage = res.usage
      ? {
          promptTokens: res.usage.prompt_tokens ?? 0,
          completionTokens: res.usage.completion_tokens ?? 0,
          cachedTokens: cachedTok > 0 ? cachedTok : undefined,
          totalTokens: res.usage.total_tokens ?? 0,
          cost: typeof res.usage.cost === "number" ? res.usage.cost : estCost,
          estimatedCostUsd: estCost,
        }
      : undefined;
    const rateLimits = normalizeRateLimitsSnapshot(res.rate_limits) ?? undefined;
    const safeClarification = res.clarification
      ? sanitizeClarificationSpec(res.clarification) ?? undefined
      : undefined;
    return {
      reply: res.reply,
      reasoning: res.reasoning,
      xoxMood: res.xox_mood ?? "talking",
      operation: safeClarification ? "ask_clarification" : res.operation ?? "none",
      tasks: (res.tasks ?? []).map(sanitizeTaskProposal),
      canvas: res.canvas ? sanitizeCanvasArtifact(res.canvas) ?? undefined : undefined,
      clarification: safeClarification,
      generatedPdfs: sanitizeGeneratedPdfList(res.generated_pdfs),
      providerUsed: res.provider_used,
      modelUsed: res.model_used ?? req.modelOverride ?? "openrouter/free",
      latencyMs: res.latency_ms ?? 0,
      usage,
      rateLimits,
      failoverNotice: res.failover_notice,
      exhaustedProviders: res.exhausted_providers,
      failoverEvents: res.failover_events?.map((fe) => ({
        fromProvider: fe.from_provider ?? "",
        toProvider: fe.to_provider ?? "",
        modelUsed: fe.model_used,
        kind: fe.kind,
        reason: fe.reason,
      })),
    };
  }

  return runBrowserAiChat(req);
}

export class BrowserStreamTagRouter {
  private static readonly OPEN_ANALYSIS = ["<analisis>", "<analysis>"];
  private static readonly CLOSE_ANALYSIS = ["</analisis>", "</analysis>"];
  private static readonly OPEN_REPLY = ["<respuesta>", "<response>", "<posta>", "<reply>", "<resp>"];
  private static readonly CLOSE_REPLY = ["</respuesta>", "</response>", "</posta>", "</reply>", "</resp>"];
  private static readonly OPEN_CANVAS = ["<canvas>", "<lienzo>"];
  private static readonly CLOSE_CANVAS = ["</canvas>", "</lienzo>"];
  private static readonly OPEN_ACTIONS = ["<acciones>", "<actions>"];
  private static readonly CLOSE_ACTIONS = ["</acciones>", "</actions>"];
  private static readonly STOP_REPLY = [
    ...BrowserStreamTagRouter.CLOSE_REPLY,
    ...BrowserStreamTagRouter.OPEN_CANVAS,
    ...BrowserStreamTagRouter.OPEN_ACTIONS,
  ];
  private static readonly ALL_OPEN = [
    ...BrowserStreamTagRouter.OPEN_ANALYSIS,
    ...BrowserStreamTagRouter.OPEN_REPLY,
    ...BrowserStreamTagRouter.OPEN_CANVAS,
    ...BrowserStreamTagRouter.OPEN_ACTIONS,
  ];

  private mode:
    | "detect"
    | "analysis"
    | "after_analysis"
    | "reply"
    | "after_reply"
    | "canvas"
    | "after_canvas"
    | "actions" = "detect";
  private buf = "";
  public canvasBuf = "";
  public actionsBuf = "";
  private enteredReply = false;
  private enteredCanvas = false;
  private replyFenceChar = "";
  private replyFenceLen = 0;
  private replyAtLineStart = true;

  private static readonly FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

  constructor(
    private onReasoning: (chunk: string) => void,
    private onReply: (chunk: string) => void,
    private onPhase: (phase: "thinking" | "talking" | "canvas") => void
  ) {}

  private emitReply(text: string) {
    if (!text) return;
    this.replyAtLineStart = text.endsWith("\n");
    this.onReply(text);
  }

  private enterReply() {
    this.replyFenceChar = "";
    this.replyFenceLen = 0;
    this.replyAtLineStart = true;
    if (!this.enteredReply) {
      this.enteredReply = true;
      this.onPhase("talking");
    }
  }

  private enterCanvas() {
    this.mode = "canvas";
    if (!this.enteredCanvas) {
      this.enteredCanvas = true;
      this.onPhase("canvas");
    }
  }

  private static readonly PREFIX_RE = /^<\s*(?:\/\s*)?[a-z]*\s*$/i;
  private static tagRegexCache = new Map<string, RegExp>();

  private static canonicalTag(raw: string): string {
    return raw.replace(/\s+/g, "").toLowerCase();
  }

  private static compileTagRegex(tags: string[], anchored = false): RegExp {
    const key = `${anchored ? "^" : ""}${tags.join("|")}`;
    let cached = BrowserStreamTagRouter.tagRegexCache.get(key);
    if (!cached) {
      const parts = tags.map((tag) => {
        const isClose = tag.startsWith("</");
        const name = isClose ? tag.slice(2, -1) : tag.slice(1, -1);
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return `<\\s*${isClose ? "/\\s*" : ""}${escaped}\\s*>`;
      });
      cached = new RegExp(`${anchored ? "^(?:" : "(?:"}${parts.join("|")})`, "i");
      BrowserStreamTagRouter.tagRegexCache.set(key, cached);
    }
    return cached;
  }

  private partialSplit(s: string, tags: string[]): [string, string] {
    const idx = s.lastIndexOf("<");
    if (idx === -1) return [s, ""];
    const tail = s.slice(idx);
    if (!tail.includes(">") && BrowserStreamTagRouter.PREFIX_RE.test(tail)) {
      const normalized = BrowserStreamTagRouter.canonicalTag(tail);
      if (tags.some((t) => t.startsWith(normalized))) {
        return [s.slice(0, idx), s.slice(idx)];
      }
    }
    return [s, ""];
  }

  private findFirstTag(
    s: string,
    tags: string[]
  ): { idx: number; rawLength: number; canonical: string } | null {
    const match = BrowserStreamTagRouter.compileTagRegex(tags, false).exec(s);
    if (!match || match.index === undefined) return null;
    return {
      idx: match.index,
      rawLength: match[0].length,
      canonical: BrowserStreamTagRouter.canonicalTag(match[0]),
    };
  }

  private tryMatchNextSection(allowFallbackReply: boolean): boolean {
    const trimmed = this.buf.trimStart();
    if (!trimmed) {
      this.buf = "";
      return false;
    }
    this.buf = trimmed;
    const matchers: Array<{ tags: string[]; target: "analysis" | "reply" | "canvas" | "actions" }> = [
      { tags: BrowserStreamTagRouter.OPEN_ANALYSIS, target: "analysis" },
      { tags: BrowserStreamTagRouter.OPEN_REPLY, target: "reply" },
      { tags: BrowserStreamTagRouter.OPEN_CANVAS, target: "canvas" },
      { tags: BrowserStreamTagRouter.OPEN_ACTIONS, target: "actions" },
    ];
    for (const { tags, target } of matchers) {
      const match = BrowserStreamTagRouter.compileTagRegex(tags, true).exec(trimmed);
      if (match) {
        this.buf = trimmed.slice(match[0].length).replace(/^\r?\n/, "");
        if (target === "analysis") {
          this.mode = "analysis";
          this.onPhase("thinking");
        } else if (target === "reply") {
          this.mode = "reply";
          this.enterReply();
        } else if (target === "canvas") {
          this.enterCanvas();
        } else {
          this.mode = "actions";
        }
        return true;
      }
    }
    if (BrowserStreamTagRouter.PREFIX_RE.test(trimmed)) {
      const normalized = BrowserStreamTagRouter.canonicalTag(trimmed);
      if (BrowserStreamTagRouter.ALL_OPEN.some((t) => t.startsWith(normalized))) {
        return false;
      }
    }
    if (allowFallbackReply) {
      this.mode = "reply";
      this.enterReply();
      return true;
    }
    this.buf = "";
    return false;
  }

  feed(chunk: string) {
    if (!chunk) return;
    this.buf += chunk;
    while (this.buf.length > 0) {
      if (this.mode === "detect" || this.mode === "after_analysis") {
        if (!this.tryMatchNextSection(true)) return;
        continue;
      }

      if (this.mode === "after_reply" || this.mode === "after_canvas") {
        if (!this.tryMatchNextSection(this.mode === "after_canvas")) return;
        continue;
      }

      if (this.mode === "analysis") {
        const found = this.findFirstTag(this.buf, BrowserStreamTagRouter.CLOSE_ANALYSIS);
        if (found) {
          if (found.idx > 0) this.onReasoning(this.buf.slice(0, found.idx));
          this.buf = this.buf.slice(found.idx + found.rawLength);
          this.mode = "after_analysis";
          continue;
        }
        const [safe, rem] = this.partialSplit(this.buf, BrowserStreamTagRouter.CLOSE_ANALYSIS);
        if (safe) this.onReasoning(safe);
        this.buf = rem;
        return;
      }

      if (this.mode === "reply") {
        // Inside a fenced code block, emit literally and ignore STOP_REPLY tags
        if (this.replyFenceChar) {
          const nlIdx = this.buf.indexOf("\n");
          if (nlIdx !== -1) {
            const segment = this.buf.slice(0, nlIdx + 1);
            this.buf = this.buf.slice(nlIdx + 1);
            if (this.replyAtLineStart) {
              const stripped = segment.replace(/\r?\n$/, "").trim();
              if (
                stripped.length >= this.replyFenceLen &&
                stripped.split("").every((ch) => ch === this.replyFenceChar)
              ) {
                this.replyFenceChar = "";
                this.replyFenceLen = 0;
              }
            }
            this.emitReply(segment);
            continue;
          }
          const escapedFence = this.replyFenceChar === "~" ? "~" : "`";
          if (
            this.replyAtLineStart &&
            new RegExp(`^[ \\t]*${escapedFence}*$`).test(this.buf)
          ) {
            return;
          }
          this.emitReply(this.buf);
          this.buf = "";
          return;
        }

        // Outside a fence: check if a new line starts a code fence
        if (this.replyAtLineStart) {
          const nlIdx = this.buf.indexOf("\n");
          if (nlIdx === -1) {
            const trimmedWs = this.buf.replace(/^[ \t]+/, "");
            if (!trimmedWs) return;
            if (trimmedWs[0] === "`" || trimmedWs[0] === "~") {
              const fenceMatch = trimmedWs.match(/^(`+|~+)(.*)$/);
              if (fenceMatch) {
                const runLen = fenceMatch[1].length;
                const infoRest = fenceMatch[2];
                if (runLen < 3 && !infoRest) return;
                if (runLen >= 3 && !(fenceMatch[1][0] === "`" && infoRest.includes("`"))) {
                  return;
                }
              }
            }
          } else {
            const firstLine = this.buf.slice(0, nlIdx).replace(/\r$/, "");
            const openMatch = BrowserStreamTagRouter.FENCE_OPEN_RE.exec(firstLine);
            if (openMatch) {
              const fenceChar = openMatch[2][0];
              const infoStr = openMatch[3];
              if (!(fenceChar === "`" && infoStr.includes("`"))) {
                this.replyFenceChar = fenceChar;
                this.replyFenceLen = openMatch[2].length;
                const segment = this.buf.slice(0, nlIdx + 1);
                this.buf = this.buf.slice(nlIdx + 1);
                this.emitReply(segment);
                continue;
              }
            }
          }
        }

        // Normal prose scan up to next newline (so next line re-checks fence opening)
        const nlIdx = this.buf.indexOf("\n");
        const scanSlice = nlIdx !== -1 ? this.buf.slice(0, nlIdx + 1) : this.buf;
        const found = this.findFirstTag(scanSlice, BrowserStreamTagRouter.STOP_REPLY);
        if (found) {
          if (found.idx > 0) this.emitReply(this.buf.slice(0, found.idx));
          this.buf = this.buf.slice(found.idx + found.rawLength);
          if (BrowserStreamTagRouter.OPEN_CANVAS.includes(found.canonical)) {
            this.enterCanvas();
          } else if (BrowserStreamTagRouter.OPEN_ACTIONS.includes(found.canonical)) {
            this.mode = "actions";
          } else {
            this.mode = "after_reply";
          }
          continue;
        }
        if (nlIdx !== -1) {
          this.emitReply(scanSlice);
          this.buf = this.buf.slice(nlIdx + 1);
          continue;
        }
        const [safe, rem] = this.partialSplit(this.buf, BrowserStreamTagRouter.STOP_REPLY);
        if (safe) this.emitReply(safe);
        this.buf = rem;
        return;
      }

      if (this.mode === "canvas") {
        const found = this.findFirstTag(this.buf, BrowserStreamTagRouter.CLOSE_CANVAS);
        if (found) {
          this.canvasBuf += this.buf.slice(0, found.idx);
          this.buf = this.buf.slice(found.idx + found.rawLength);
          this.mode = "after_canvas";
          continue;
        }
        const [safe, rem] = this.partialSplit(this.buf, BrowserStreamTagRouter.CLOSE_CANVAS);
        this.canvasBuf += safe;
        this.buf = rem;
        return;
      }

      if (this.mode === "actions") {
        const found = this.findFirstTag(this.buf, BrowserStreamTagRouter.CLOSE_ACTIONS);
        if (found) {
          this.actionsBuf += this.buf.slice(0, found.idx);
          this.buf = "";
          return;
        }
        const [safe, rem] = this.partialSplit(this.buf, BrowserStreamTagRouter.CLOSE_ACTIONS);
        this.actionsBuf += safe;
        this.buf = rem;
        return;
      }
    }
  }

  flush() {
    if (!this.buf) return;
    if (this.mode === "detect" || this.mode === "after_analysis") {
      const trimmed = this.buf
        .trimStart()
        .replace(/<\s*\/?\s*(?:analisis|analysis|respuesta|response|canvas|lienzo|acciones|actions|posta|reply|resp)\s*(?:>|$)/gi, "");
      if (trimmed) {
        this.enterReply();
        this.onReply(trimmed);
      }
    } else if (this.mode === "analysis") {
      this.onReasoning(this.buf);
    } else if (this.mode === "reply") {
      if (this.replyFenceChar) {
        this.emitReply(this.buf);
      } else {
        const cleaned = this.buf.replace(
          /<\s*\/?\s*(?:analisis|analysis|respuesta|response|canvas|lienzo|acciones|actions|posta|reply|resp)\s*(?:>|$)/gi,
          ""
        );
        if (cleaned) this.emitReply(cleaned);
      }
    } else if (this.mode === "canvas") {
      this.canvasBuf += this.buf.replace(/<\s*\/?\s*(?:canvas|lienzo)\s*>/gi, "");
    } else if (this.mode === "actions") {
      this.actionsBuf += this.buf.replace(/<\s*\/?\s*(?:acciones|actions)\s*>/gi, "");
    }
    this.buf = "";
  }
}

function getBrowserLocalDateTimeLabel(): string {
  const now = new Date();
  let formatted = now.toISOString();
  try {
    formatted = new Intl.DateTimeFormat("es-MX", {
      dateStyle: "full",
      timeStyle: "medium",
    }).format(now);
  } catch {
    formatted = now.toLocaleString("es-MX");
  }
  const timeZone =
    typeof Intl !== "undefined" && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : "UTC";
  return `${formatted} (zona horaria: ${timeZone})`;
}

function buildBrowserSystemPrompt(
  req: XoxAiChatRequest,
  streamMode: boolean
): string {
  const compactTasks = req.currentTasks.slice(0, 8).map((t) => ({
    cardId: t.cardId,
    title: t.title,
    category: t.category,
    urgency: t.urgency,
    paramValues: t.paramValues,
    intent: t.intent,
  }));

  const opLine = req.userProfile?.name
    ? `\nUSUARIO ACTIVO: ${req.userProfile.name} (${req.userProfile.role || "Operador"}${req.userProfile.storeName ? `, ${req.userProfile.storeName}` : ""})`
    : "";

  const nowLabel = getBrowserLocalDateTimeLabel();

  const canvasLine = req.activeCanvas
    ? `\nCANVAS ACTIVO EN PANTALLA (si el usuario pide modificarlo o ampliarlo, actualiza este Canvas manteniendo su id):\n${JSON.stringify({
        id: req.activeCanvas.id,
        title: req.activeCanvas.title,
        kind: req.activeCanvas.kind,
        summary: req.activeCanvas.summary,
        columns: req.activeCanvas.columns.slice(0, 12),
        rows: req.activeCanvas.rows.slice(0, 25),
      })}`
    : "";

  const header = `Eres Xox, el agente inteligente y co-constructor operativo de propósito múltiple de XOOK. Respondes siempre en español claro, directo y humano (o en el idioma que pida el usuario), adaptando tu rol y enfoque al proyecto o espacio activo sin JSON visible al usuario.

FECHA Y HORA LOCAL ACTUAL DEL SISTEMA: ${nowLabel}

CAPACIDADES:
- Puedes responder preguntas generales de uso diario (qué hora es, qué día es hoy, cálculos, programación, redacción, investigación o charla casual) de forma directa y natural usando la fecha y hora local actual cuando aplique, SIN desviar la conversación hacia inventario si el usuario no lo pidió.
- Cuando el usuario trabaje en negocios, software, investigación, productividad o proyectos creativos, adapta tu rol y apoya usando el contexto, gustos/flujo del usuario, habilidades y memoria reales del workspace.
- Si el usuario pide crear o mostrar una TABLA, tabla comparativa, desglose, matriz de opciones o presupuesto: usa la herramienta \`create_canvas\` (preferida; evita emitir bloques \`<canvas>\` manualmente) pasando columnas en texto simple y TODAS las filas completas en \`rows\`. NUNCA escribas etiquetas HTML (<table>, <tr>, <th>, <td>, <pdf>) en tu mensaje al usuario; escribe libremente tu explicación o conclusión sin duplicar la tabla en HTML ni usar etiquetas XML.
- Aclaraciones (\`ask_clarification\`): analiza primero qué ya especificó el usuario. Si ya dio evento/acción + fecha/hora (ej. "cita para mañana a las 10 pm"), NO pidas aclaraciones y genera la tarjeta directo (solo avisa si choca con AGENDA ACTIVA). Úsala únicamente si falta un dato esencial (como en "agenda algo" o "haz una cita mañana" sin hora), preguntando SOLO lo que falta y nunca datos que ya indicó.
- Bóveda y proveedores IA (\`configure_ai_vault\`): TÚ SÍ PUEDES configurar proveedores en la bóveda local de XOOK (openrouter, deepseek, groq, gemini, openai, anthropic). Si el usuario pide agregar, configurar o cambiar su API key o proveedor en XOOK, PROHIBIDO sugerir \`.env\` o código; llama de inmediato a \`configure_ai_vault\` para mostrar el formulario seguro Zero-Trust en tu respuesta.
- Agenda vs Reloj: para recordatorios o entregas con fecha/hora del reloj (ej. "mañana 18:00", "viernes 13 a las 19:00", "1 hora antes") usa SIEMPRE \`intent.type="schedule_event"\` y \`schedule.mode="alarm"\` (NUNCA \`start_timer\`). Usa \`start_timer\` solo para temporizadores cortos que arrancan ahora con \`paramValues.duration_min\` explícito.
${req.businessContextSnapshot ? `\nCONTEXTO DEL NEGOCIO:\n${req.businessContextSnapshot}\n` : ""}${opLine}${canvasLine}
TAREAS PENDIENTES:\n${JSON.stringify(compactTasks)}
AGENDA ACTIVA:\n${JSON.stringify(req.agendaItems.slice(0, 6))}
${req.attachedContext.length ? `CONTEXTO ADJUNTO:\n${JSON.stringify(req.attachedContext.map(({ imageDataUrl: _ignored, ...rest }) => rest))}` : ""}`;

  if (streamMode) {
    return `${header}

ESTILO DE RESPUESTA Y LIBERTAD:
Responde directamente en español (o en el idioma que pida el usuario) usando Markdown natural y limpio, con plena libertad expresiva para escribir todo lo que necesites y elegir el tono, estructura, encabezados, listas, bloques de código, tablas Markdown o extensión que mejor ayuden al usuario.
- NUNCA envuelvas tu respuesta en etiquetas XML o pseudo-HTML como \`<respuesta>\`, \`<analisis>\`, \`<posta>\`, \`<reply>\`, \`<canvas>\` o \`<acciones>\`. Escribe directamente al usuario.
- Cuando escribas código, consultas, configuraciones o diagramas en CUALQUIER lenguaje o formato (Python, C#, C++, TypeScript, TSX, Rust, Go, Java, Kotlin, Swift, SQL, HTML, CSS, Bash, PowerShell, Terraform/HCL, Solidity, Zig, Prisma, Dockerfile, YAML, JSON, LaTeX, Mermaid, etc.), usa SIEMPRE bloques Markdown con el identificador exacto del lenguaje tras \`\`\` (por ejemplo, \`\`\`csharp, \`\`\`python, \`\`\`tsx, \`\`\`sql, \`\`\`hcl, \`\`\`dockerfile) y opcionalmente el nombre del archivo si aporta claridad (por ejemplo, \`\`\`csharp CuentaBancaria.cs). Si el bloque contiene \`\`\` internos, envuélvelo con cuatro comillas invertidas (\`\`\`\`). Presenta código idiomático, completo y bien indentado.
- Usa herramientas nativas como \`create_canvas\`, \`propose_tasks\`, \`ask_clarification\`, \`configure_ai_vault\` o \`pdf_generate\` únicamente cuando la petición requiera una tabla interactiva, tareas/recordatorios en XOOK, aclaración estructurada, configurar la bóveda o PDF.`;
  }

  return `${header}

Responde SIEMPRE con un objeto JSON válido:
{
  "reply": "Tu respuesta natural en español para el usuario",
  "xox_mood": "talking" | "success" | "alert",
  "operation": "none" | "add_tasks" | "replace_tasks" | "ask_clarification",
  "tasks": [], // Opcional: tarjetas TaskProposal válidas cuando corresponda crear/reconstruir tareas, relojes, agendas o notas
  "canvas": null, // Opcional: objeto Canvas si generaste tabla comparativa/datos sin usar create_canvas
  "clarification": null // Opcional: preguntas interactivas si faltan datos del usuario
}
Tipos permitidos en blocks: metrics_strip, coverage_bar, schedule, checklist, note, comparison, kv_list, param_control, insight.`;
}

export async function runXoxAiChatStream(
  req: XoxAiChatRequest,
  callbacks?: XoxStreamCallbacks
): Promise<XoxAiChatResponse> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const streamId = `str_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    callbacks?.onStreamStart?.(streamId);
    const unlisten = await listen<{
      stream_id?: string;
      event?: {
        type?: string;
        xox_state?: "reading" | "thinking" | "talking" | "syncing";
        label?: string;
        steps?: ThinkingStep[];
        delta?: string;
        canvas?: unknown;
        pdf?: unknown;
        from_provider?: string;
        to_provider?: string;
        model_used?: string;
        kind?: string;
        reason?: string;
        notice?: string;
        [key: string]: unknown;
      };
    }>("xox-chat-stream", (ev) => {
      const payload = ev.payload;
      if (!payload || payload.stream_id !== streamId || !payload.event) return;
      const evt = payload.event;
      if (evt.type === "phase" && evt.xox_state) {
        callbacks?.onPhase?.(evt.xox_state, evt.label);
      } else if (evt.type === "provider_failover") {
        callbacks?.onProviderFailover?.({
          fromProvider: String(evt.from_provider ?? ""),
          toProvider: String(evt.to_provider ?? ""),
          modelUsed: typeof evt.model_used === "string" ? evt.model_used : undefined,
          kind: typeof evt.kind === "string" ? evt.kind : undefined,
          reason: typeof evt.reason === "string" ? evt.reason : undefined,
          notice: typeof evt.notice === "string" ? evt.notice : undefined,
        });
      } else if (evt.type === "steps" && Array.isArray(evt.steps)) {
        callbacks?.onSteps?.(evt.steps);
      } else if (evt.type === "reasoning_delta" && evt.delta) {
        callbacks?.onReasoningDelta?.(evt.delta);
      } else if (evt.type === "reasoning_reset") {
        callbacks?.onReasoningReset?.();
      } else if (evt.type === "reply_delta" && evt.delta) {
        callbacks?.onReplyDelta?.(evt.delta);
      } else if (evt.type === "canvas" && evt.canvas) {
        const parsedCanvas = sanitizeCanvasArtifact(evt.canvas);
        if (parsedCanvas) callbacks?.onCanvas?.(parsedCanvas);
      } else if (evt.type === "vault_action" && evt.vault_action && typeof evt.vault_action === "object") {
        const va = evt.vault_action as { provider?: unknown; intent?: unknown; note?: unknown };
        const rawIntent = String(va.intent ?? "prompt_key").trim().toLowerCase();
        const intent =
          rawIntent === "switch_provider" || rawIntent === "open_settings" ? rawIntent : "prompt_key";
        callbacks?.onVaultAction?.({
          provider: normalizeProviderIdClient(typeof va.provider === "string" ? va.provider : undefined),
          intent,
          note: typeof va.note === "string" ? va.note : undefined,
        });
      } else if (evt.type === "pdf_draft_progress") {
        const rawBlocks = Array.isArray(evt.blocks) ? evt.blocks : [];
        const blocks: PdfDraftPreviewBlock[] = rawBlocks
          .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
          .map((b) => ({
            type: String(b.type ?? "paragraph"),
            level: typeof b.level === "number" ? b.level : undefined,
            text: typeof b.text === "string" ? b.text : undefined,
            title: typeof b.title === "string" ? b.title : undefined,
            tone: typeof b.tone === "string" ? b.tone : undefined,
            language: typeof b.language === "string" ? b.language : undefined,
            items: Array.isArray(b.items) ? b.items.map(String) : undefined,
            totalItems: typeof b.total_items === "number" ? b.total_items : undefined,
            columns: Array.isArray(b.columns) ? b.columns.map(String) : undefined,
            rows: Array.isArray(b.rows)
              ? b.rows.map((r) => (Array.isArray(r) ? r.map(String) : []))
              : undefined,
            totalRows: typeof b.total_rows === "number" ? b.total_rows : undefined,
            path: typeof b.path === "string" ? b.path : undefined,
            caption: typeof b.caption === "string" ? b.caption : undefined,
            metrics: Array.isArray(b.metrics)
              ? b.metrics
                  .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
                  .map((m) => ({
                    label: String(m.label ?? ""),
                    value: String(m.value ?? ""),
                  }))
              : undefined,
            streaming: Boolean(b.streaming),
          }));
        const rawCov =
          evt.cover && typeof evt.cover === "object"
            ? (evt.cover as Record<string, unknown>)
            : null;
        callbacks?.onPdfDraftProgress?.({
          stage: (typeof evt.stage === "string" ? evt.stage : "composing") as PdfDraftProgressEvent["stage"],
          stepLabel: String(evt.step_label ?? evt.stepLabel ?? "Generando documento PDF..."),
          progress: typeof evt.progress === "number" ? evt.progress : 0.15,
          title: String(evt.title ?? ""),
          subtitle: typeof evt.subtitle === "string" ? evt.subtitle : undefined,
          theme: typeof evt.theme === "string" ? evt.theme : undefined,
          author: typeof evt.author === "string" ? evt.author : undefined,
          date: typeof evt.date === "string" ? evt.date : undefined,
          hasCover: Boolean(evt.has_cover ?? evt.hasCover ?? rawCov?.enabled),
          cover: rawCov
            ? {
                enabled: Boolean(rawCov.enabled ?? true),
                layout: typeof rawCov.layout === "string" ? rawCov.layout : undefined,
                eyebrow: typeof rawCov.eyebrow === "string" ? rawCov.eyebrow : undefined,
                imagePath:
                  typeof (rawCov.image_path ?? rawCov.imagePath) === "string"
                    ? String(rawCov.image_path ?? rawCov.imagePath)
                    : undefined,
                footerNote:
                  typeof (rawCov.footer_note ?? rawCov.footerNote) === "string"
                    ? String(rawCov.footer_note ?? rawCov.footerNote)
                    : undefined,
              }
            : null,
          blocks,
          totalBlocks: typeof (evt.total_blocks ?? evt.totalBlocks) === "number"
            ? Number(evt.total_blocks ?? evt.totalBlocks)
            : blocks.length,
          completedBlocks: typeof (evt.completed_blocks ?? evt.completedBlocks) === "number"
            ? Number(evt.completed_blocks ?? evt.completedBlocks)
            : blocks.length,
          path: typeof evt.path === "string" ? evt.path : undefined,
        });
      } else if (evt.type === "pdf_generated" && evt.pdf) {
        const parsedPdf = sanitizeGeneratedPdfArtifact(evt.pdf);
        if (parsedPdf) callbacks?.onPdfGenerated?.(parsedPdf);
      }
    });

    try {
      const res = await invoke<{
        reply: string;
        reasoning?: string;
        reasoning_duration_ms?: number;
        steps?: ThinkingStep[];
        xox_mood?: "talking" | "success" | "alert";
        operation?: "none" | "add_tasks" | "replace_tasks" | "ask_clarification";
        tasks?: TaskProposal[];
        canvas?: unknown;
        clarification?: unknown;
        generated_pdfs?: unknown[];
        vault_action?: { provider?: string; intent?: string; note?: string };
        provider_used?: string;
        model_used?: string;
        latency_ms?: number;
        workspace_mutated?: boolean;
        exhausted_providers?: Array<Record<string, unknown>>;
        failover_events?: Array<{
          from_provider?: string;
          to_provider?: string;
          reason?: string;
          kind?: string;
          model_used?: string;
        }>;
        failover_notice?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cached_tokens?: number;
          prompt_cache_hit_tokens?: number;
          total_tokens?: number;
          cost?: number;
          estimated_cost_usd?: number;
        };
        rate_limits?: Record<string, unknown>;
      }>("run_xox_chat_stream", {
        payload: {
          message: req.message,
          history: req.history,
          currentTasks: req.currentTasks,
          agendaItems: req.agendaItems,
          attachedContext: req.attachedContext,
          modelOverride: req.modelOverride ?? null,
          providerOverride: req.providerOverride ?? null,
          streamId,
          userProfile: req.userProfile ?? null,
          activeCanvas: req.activeCanvas ?? null,
        },
      });

      const cachedTok = res.usage?.cached_tokens ?? res.usage?.prompt_cache_hit_tokens ?? 0;
      const estCost =
        typeof res.usage?.estimated_cost_usd === "number"
          ? res.usage.estimated_cost_usd
          : typeof res.usage?.cost === "number"
            ? res.usage.cost
            : undefined;
      const usage = res.usage
        ? {
            promptTokens: res.usage.prompt_tokens ?? 0,
            completionTokens: res.usage.completion_tokens ?? 0,
            cachedTokens: cachedTok > 0 ? cachedTok : undefined,
            totalTokens: res.usage.total_tokens ?? 0,
            cost: typeof res.usage.cost === "number" ? res.usage.cost : estCost,
            estimatedCostUsd: estCost,
          }
        : undefined;
      const rateLimits = normalizeRateLimitsSnapshot(res.rate_limits) ?? undefined;

      const resCanvas = res.canvas ? sanitizeCanvasArtifact(res.canvas) ?? undefined : undefined;
      const safeCanvas = resCanvas && canvasHasCellData(resCanvas) ? resCanvas : undefined;
      const safeClarification = res.clarification
        ? sanitizeClarificationSpec(res.clarification) ?? undefined
        : undefined;
      const safeVaultAction: VaultPromptSpec | undefined = res.vault_action
        ? {
            provider: normalizeProviderIdClient(res.vault_action.provider),
            intent:
              res.vault_action.intent === "switch_provider" ||
              res.vault_action.intent === "open_settings"
                ? res.vault_action.intent
                : "prompt_key",
            note: typeof res.vault_action.note === "string" ? res.vault_action.note : undefined,
          }
        : undefined;
      const hasTabularCanvas = Boolean(
        safeCanvas && safeCanvas.columns.length > 0 && safeCanvas.rows.length > 0
      );
      const cleanedReply = cleanVisibleReply(res.reply, { stripTables: hasTabularCanvas });
      const finalTauriReply =
        cleanedReply ||
        (hasTabularCanvas && safeCanvas
          ? `Listo, preparé "${safeCanvas.title}" en Canvas (${safeCanvas.rows.length} filas y ${safeCanvas.columns.length} columnas).${safeCanvas.summary ? `\n\n${safeCanvas.summary}` : ""}`
          : safeClarification
            ? safeClarification.subtitle || safeClarification.title
            : res.reply);

      return {
        reply: finalTauriReply,
        reasoning: res.reasoning,
        reasoningDurationMs: res.reasoning_duration_ms,
        steps: res.steps,
        xoxMood: res.xox_mood ?? "talking",
        operation: safeClarification ? "ask_clarification" : res.operation ?? "none",
        tasks: (res.tasks ?? []).map(sanitizeTaskProposal),
        canvas: safeCanvas,
        clarification: safeClarification,
        vaultAction: safeVaultAction,
        generatedPdfs: sanitizeGeneratedPdfList(res.generated_pdfs),
        providerUsed: res.provider_used,
        modelUsed: res.model_used ?? req.modelOverride ?? "openrouter/free",
        latencyMs: res.latency_ms ?? 0,
        usage,
        rateLimits,
        workspaceMutated: Boolean(res.workspace_mutated),
        failoverNotice: res.failover_notice,
        exhaustedProviders: res.exhausted_providers,
        failoverEvents: res.failover_events?.map((fe) => ({
          fromProvider: fe.from_provider ?? "",
          toProvider: fe.to_provider ?? "",
          modelUsed: fe.model_used,
          kind: fe.kind,
          reason: fe.reason,
        })),
      };
    } finally {
      unlisten();
    }
  }

  // Fallback de streaming real para modo preview en navegador
  const vault = readBrowserVault();
  const activeBrowserPid = normalizeProviderIdClient(req.providerOverride || vault.provider);
  const activeBrowserSpec = AI_PROVIDERS[activeBrowserPid];
  const activeSlot = vault.providers[activeBrowserPid];
  const apiKey = normalizeApiKey(activeSlot?.apiKey ?? (activeBrowserPid === vault.provider ? vault.apiKey : null));
  if (!apiKey) {
    throw new Error(`Falta configurar tu clave API de ${activeBrowserSpec.name}.`);
  }

  const chosenModel =
    req.modelOverride?.trim() || activeSlot?.modelId || vault.modelId || activeBrowserSpec.defaultModelId;
  const contextNames = req.attachedContext.map((c) => c.name).filter(Boolean);
  const steps: ThinkingStep[] = [
    {
      id: "read_context",
      label: "Leyendo contexto y reglas del negocio",
      detail: contextNames.slice(0, 4).join(" · ") || "Contexto base",
      status: "running",
    },
  ];
  callbacks?.onPhase?.("reading", "Leyendo perfil y reglas...");
  callbacks?.onSteps?.([...steps]);

  const systemPrompt = buildBrowserSystemPrompt(req, true);

  const messages = [
    { role: "system", content: systemPrompt },
    ...req.history.slice(-10),
    { role: "user", content: req.message },
  ];

  steps[0] = { ...steps[0], status: "done" };
  steps.push({
    id: "think_llm",
    label: "Analizando tu solicitud",
    detail: chosenModel,
    status: "running",
  });
  callbacks?.onPhase?.("thinking", "Analizando tu solicitud...");
  callbacks?.onSteps?.([...steps]);

  const started = performance.now();
  let reasoningStarted: number | null = null;
  let reasoningEnded: number | null = null;
  let reasoningText = "";
  let replyText = "";
  let actualModel = chosenModel;
  let usageObj: XoxTokenUsage | undefined;
  let browserRateLimits: ProviderRateLimitsSnapshot | null = null;

  const upsertStep = (id: string, label: string, status: "running" | "done") => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx !== -1) {
      steps[idx] = { ...steps[idx], label, status };
    } else {
      steps.push({ id, label, status });
    }
  };

  const pushReasoning = (delta: string) => {
    if (!delta) return;
    if (reasoningStarted === null) reasoningStarted = performance.now();
    reasoningText += delta;
    callbacks?.onReasoningDelta?.(delta);
  };
  const pushReply = (delta: string) => {
    if (!delta) return;
    if (reasoningStarted !== null && reasoningEnded === null) reasoningEnded = performance.now();
    replyText += delta;
    callbacks?.onReplyDelta?.(delta);
  };
  const handlePhase = (phase: "thinking" | "talking" | "canvas") => {
    if (phase === "talking") {
      if (reasoningStarted !== null && reasoningEnded === null) reasoningEnded = performance.now();
      steps[1] = { ...steps[1], status: "done" };
      upsertStep("talk_reply", "Respondiendo en vivo", "running");
      callbacks?.onPhase?.("talking", "Respondiendo...");
      callbacks?.onSteps?.([...steps]);
    } else if (phase === "canvas") {
      if (reasoningStarted !== null && reasoningEnded === null) reasoningEnded = performance.now();
      steps[1] = { ...steps[1], status: "done" };
      upsertStep("build_canvas", "Generando tabla en Canvas", "running");
      callbacks?.onPhase?.("syncing", "Diseñando tabla en Canvas...");
      callbacks?.onSteps?.([...steps]);
    } else {
      callbacks?.onPhase?.("thinking", "Evaluando opciones...");
    }
  };

  const activeBrowserBaseUrl = resolveProviderBaseUrlClient(activeBrowserPid, activeSlot?.apiRegion);

  const runBrowserStreamPass = async (
    reqMessages: Array<Record<string, unknown>>,
    allowTools: boolean,
    tagRouter: BrowserStreamTagRouter
  ): Promise<AccumulatedToolCall[]> => {
    let includeTools = allowTools;
    let resp: Response | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reqBody: Record<string, unknown> = {
        model: chosenModel,
        messages: reqMessages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
      };
      if (includeTools) {
        reqBody.tools = [
          BROWSER_CANVAS_TOOL_DEF,
          BROWSER_CLARIFICATION_TOOL_DEF,
          BROWSER_VAULT_CONFIG_TOOL_DEF,
        ];
        reqBody.tool_choice = "auto";
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (activeBrowserPid === "openrouter") {
        headers["HTTP-Referer"] = window.location.origin;
        headers["X-Title"] = "XOOK Enterprise Agentic Orchestrator";
      }
      const attemptResp = await fetch(`${activeBrowserBaseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
      });
      const parsedRl = parseBrowserRateLimitHeaders(attemptResp.headers, activeBrowserPid);
      if (parsedRl) browserRateLimits = parsedRl;
      if (attemptResp.ok && attemptResp.body) {
        resp = attemptResp;
        break;
      }
      let errText = "";
      try {
        const j = (await attemptResp.json()) as { error?: { message?: string } };
        errText = j.error?.message ?? "";
      } catch {
        // Ignorar
      }
      if (
        includeTools &&
        (attemptResp.status === 400 || attemptResp.status === 404) &&
        /(tool|function|endpoints|unsupported)/i.test(errText)
      ) {
        includeTools = false;
        continue;
      }
      throw new Error(mapFriendlyHttpError(attemptResp.status, errText, activeBrowserSpec.name));
    }

    if (!resp || !resp.body) {
      throw new Error("No se pudo abrir la transmisión en vivo.");
    }

    const tcAcc = new Map<number, AccumulatedToolCall>();
    let notifiedCanvasTc = false;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      const lines = sseBuf.split("\n");
      sseBuf = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === "[DONE]") break;
        try {
          const evt = JSON.parse(dataStr) as {
            model?: string;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              prompt_cache_hit_tokens?: number;
              prompt_tokens_details?: { cached_tokens?: number };
              total_tokens?: number;
              cost?: number;
            };
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning?: string;
                reasoning_content?: string;
                reasoning_details?: Array<{ text?: string; summary?: string }>;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          if (evt.model) {
            actualModel = evt.model;
            steps[1] = { ...steps[1], detail: actualModel };
          }
          if (evt.usage) {
            const pt = evt.usage.prompt_tokens ?? 0;
            const ct = evt.usage.completion_tokens ?? 0;
            const cached =
              evt.usage.prompt_cache_hit_tokens ?? evt.usage.prompt_tokens_details?.cached_tokens ?? 0;
            const estCost =
              typeof evt.usage.cost === "number"
                ? evt.usage.cost
                : estimateBrowserTurnCostUsd(activeBrowserPid, actualModel, pt, ct, cached);
            usageObj = {
              promptTokens: pt,
              completionTokens: ct,
              cachedTokens: cached > 0 ? cached : undefined,
              totalTokens: evt.usage.total_tokens ?? pt + ct,
              cost: estCost,
              estimatedCostUsd: estCost,
            };
          }
          const delta = evt.choices?.[0]?.delta;
          if (!delta) continue;
          const detailsText = Array.isArray(delta.reasoning_details)
            ? delta.reasoning_details
                .map((d) => d?.text || d?.summary || "")
                .filter(Boolean)
                .join("")
            : "";
          const r = delta.reasoning || delta.reasoning_content || detailsText;
          if (r) pushReasoning(r);

          if (Array.isArray(delta.tool_calls)) {
            for (const tcd of delta.tool_calls) {
              const idx = typeof tcd.index === "number" ? tcd.index : 0;
              const entry: AccumulatedToolCall = tcAcc.get(idx) ?? {
                id: tcd.id || `call_${idx}`,
                type: "function",
                function: { name: "", arguments: "" },
              };
              if (tcd.id) entry.id = tcd.id;
              if (tcd.function?.name) {
                const nameDelta = tcd.function.name;
                if (!entry.function.name) {
                  entry.function.name = nameDelta;
                } else if (
                  nameDelta !== entry.function.name &&
                  !entry.function.name.endsWith(nameDelta)
                ) {
                  entry.function.name += nameDelta;
                }
              }
              if (typeof tcd.function?.arguments === "string" && tcd.function.arguments) {
                const argsDelta = tcd.function.arguments;
                let replaced = false;
                if (
                  entry.function.arguments.trimEnd().endsWith("}") &&
                  argsDelta.trimStart().startsWith("{")
                ) {
                  try {
                    const prevObj = JSON.parse(entry.function.arguments);
                    const nextObj = JSON.parse(argsDelta);
                    if (prevObj && typeof prevObj === "object" && nextObj && typeof nextObj === "object") {
                      entry.function.arguments = argsDelta;
                      replaced = true;
                    }
                  } catch {
                    // Continuar acumulando
                  }
                }
                if (!replaced) {
                  entry.function.arguments += argsDelta;
                }
              } else if (tcd.function?.arguments && typeof tcd.function.arguments === "object") {
                entry.function.arguments = JSON.stringify(tcd.function.arguments);
              }
              tcAcc.set(idx, entry);
              if (!notifiedCanvasTc && entry.function.name.toLowerCase().includes("create_canvas")) {
                notifiedCanvasTc = true;
                handlePhase("canvas");
              }
            }
          }

          if (delta.content) tagRouter.feed(delta.content);
        } catch {
          // Ignorar chunk incompleto
        }
      }
    }
    tagRouter.flush();
    return Array.from(tcAcc.entries())
      .sort(([a], [b]) => a - b)
      .map(([, val]) => val);
  };

  const router = new BrowserStreamTagRouter(pushReasoning, pushReply, handlePhase);
  const toolCallsList = await runBrowserStreamPass(
    messages as Array<Record<string, unknown>>,
    true,
    router
  );

  const latencyMs = Math.round(performance.now() - started);
  let parsedActions = router.actionsBuf.trim()
    ? extractBrowserJson(router.actionsBuf)
    : {
        reply: replyText,
        xoxMood: "talking" as const,
        operation: "none" as const,
        tasks: [] as TaskProposal[],
        canvas: undefined as CanvasArtifact | undefined,
        clarification: undefined as ClarificationSpec | undefined,
      };

  const clarificationSpec =
    extractClarificationFromToolCalls(toolCallsList, req.message) ??
    (parsedActions.clarification
      ? {
          ...parsedActions.clarification,
          originalQuery: parsedActions.clarification.originalQuery || req.message,
        }
      : undefined);

  const vaultAction = extractVaultActionFromToolCalls(toolCallsList);
  if (vaultAction) {
    callbacks?.onVaultAction?.(vaultAction);
  }

  const canvasArtifact = resolveBrowserCanvasArtifact({
    toolCalls: toolCallsList,
    canvasBuf: router.canvasBuf,
    actionsCanvas: parsedActions.canvas,
    fullReply: replyText.trim() || parsedActions.reply,
    userMessage: req.message,
  });

  if (canvasArtifact) {
    upsertStep("build_canvas", `Tabla lista en Canvas: "${canvasArtifact.title}"`, "done");
    callbacks?.onCanvas?.(canvasArtifact);
    callbacks?.onSteps?.([...steps]);

    if (toolCallsList.length > 0 && !replyText.trim()) {
      const followupRouter = new BrowserStreamTagRouter(pushReasoning, pushReply, handlePhase);
      const toolResultContent = JSON.stringify({
        ok: true,
        canvas_title: canvasArtifact.title,
        columns: canvasArtifact.columns.length,
        rows: canvasArtifact.rows.length,
        instruction:
          "La tabla ya está abierta en Canvas. Responde únicamente con 1 a 3 oraciones breves de conclusión en español directamente en Markdown (sin etiquetas XML). NO repitas la tabla ni escribas HTML.",
      });
      try {
        await runBrowserStreamPass(
          [
            ...(messages as Array<Record<string, unknown>>),
            { role: "assistant", content: "", tool_calls: toolCallsList },
            ...toolCallsList.map((tc, i) => ({
              role: "tool",
              tool_call_id: tc.id || `call_${i}`,
              content: toolResultContent,
            })),
          ],
          false,
          followupRouter
        );
        if (followupRouter.actionsBuf.trim()) {
          parsedActions = extractBrowserJson(followupRouter.actionsBuf);
        }
      } catch {
        // Fallback amigable debajo
      }
    }

    if (!replyText.trim()) {
      const fallbackText =
        `Listo, preparé "${canvasArtifact.title}" en Canvas (${canvasArtifact.rows.length} filas y ${canvasArtifact.columns.length} columnas).` +
        (canvasArtifact.summary ? `\n\n${canvasArtifact.summary}` : "");
      pushReply(fallbackText);
    }
  }

  const rawFinalReply = replyText.trim() || parsedActions.reply;
  const hasTabularCanvas = Boolean(
    canvasArtifact && canvasArtifact.columns.length > 0 && canvasArtifact.rows.length > 0
  );
  const cleanedFinalReply = cleanVisibleReply(rawFinalReply, { stripTables: hasTabularCanvas });
  const finalReply =
    cleanedFinalReply ||
    (vaultAction
      ? `Abrí el formulario seguro de bóveda para **${getProviderSpec(vaultAction.provider).name}** aquí mismo. Ingresa tu clave para guardarla localmente.`
      : hasTabularCanvas && canvasArtifact
        ? `Listo, preparé "${canvasArtifact.title}" en Canvas (${canvasArtifact.rows.length} filas y ${canvasArtifact.columns.length} columnas).${canvasArtifact.summary ? `\n\n${canvasArtifact.summary}` : ""}`
        : clarificationSpec
          ? clarificationSpec.subtitle || clarificationSpec.title
          : rawFinalReply);
  const completedSteps = steps.map((s) => ({ ...s, status: "done" as const }));
  if (clarificationSpec) {
    completedSteps.push({
      id: "ask_clarification",
      label: "Esperando detalles del usuario",
      status: "done",
    });
  } else if (vaultAction) {
    completedSteps.push({
      id: "configure_ai_vault",
      label: `Bóveda lista para ${getProviderSpec(vaultAction.provider).shortName}`,
      status: "done",
    });
  } else if (parsedActions.tasks.length > 0) {
    completedSteps.push({
      id: "build_tasks",
      label: `Generando ${parsedActions.tasks.length} tarjeta(s) de acción`,
      status: "done",
    });
    callbacks?.onPhase?.("syncing", "Preparando tarjetas de acción...");
  } else if (completedSteps.length < 3 && !canvasArtifact) {
    completedSteps.push({ id: "talk_reply", label: "Respuesta completada", status: "done" });
  }
  callbacks?.onSteps?.(completedSteps);

  const reasoningDurationMs =
    reasoningStarted !== null
      ? Math.max(200, Math.round((reasoningEnded ?? performance.now()) - reasoningStarted))
      : reasoningText.trim()
      ? latencyMs
      : 0;

  recordBrowserAiUsage({
    provider: activeBrowserPid,
    modelId: actualModel,
    usage: usageObj,
    rateLimits: browserRateLimits,
  });

  return {
    reply: finalReply,
    reasoning: reasoningText.trim(),
    reasoningDurationMs,
    steps: completedSteps,
    xoxMood: canvasArtifact && parsedActions.xoxMood === "talking" ? "success" : parsedActions.xoxMood,
    operation: clarificationSpec ? "ask_clarification" : parsedActions.operation,
    tasks: parsedActions.tasks,
    canvas: canvasArtifact,
    clarification: clarificationSpec,
    vaultAction,
    providerUsed: activeBrowserPid,
    modelUsed: actualModel,
    latencyMs,
    usage: usageObj,
    rateLimits: browserRateLimits ?? undefined,
  };
}

async function runBrowserAiChat(req: XoxAiChatRequest): Promise<XoxAiChatResponse> {
  const vault = readBrowserVault();
  const activePid = normalizeProviderIdClient(req.providerOverride || vault.provider);
  const spec = AI_PROVIDERS[activePid];
  const slot = vault.providers[activePid];
  const activeKey = normalizeApiKey(slot?.apiKey ?? vault.apiKey);
  if (!activeKey) {
    throw new Error(`Falta configurar tu clave API de ${spec.name}.`);
  }

  const chosenModel = req.modelOverride?.trim() || slot?.modelId || vault.modelId || spec.defaultModelId;
  const systemPrompt = buildBrowserSystemPrompt(req, false);

  const messages = [
    { role: "system", content: systemPrompt },
    ...req.history.slice(-10),
    { role: "user", content: req.message },
  ];

  const started = performance.now();
  const makeCall = async (useJsonFormat: boolean, useTools: boolean) => {
    const payload: Record<string, unknown> = {
      model: chosenModel,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    };
    if (useJsonFormat) {
      payload.response_format = { type: "json_object" };
    }
    if (useTools) {
      payload.tools = [
        BROWSER_CANVAS_TOOL_DEF,
        BROWSER_CLARIFICATION_TOOL_DEF,
        BROWSER_VAULT_CONFIG_TOOL_DEF,
      ];
      payload.tool_choice = "auto";
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeKey}`,
    };
    if (activePid === "openrouter") {
      headers["HTTP-Referer"] = window.location.origin;
      headers["X-Title"] = "XOOK Enterprise Agentic Orchestrator";
    }
    return fetch(`${resolveProviderBaseUrlClient(activePid, slot?.apiRegion)}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  };

  let resp = await makeCall(true, true);
  if (resp.status === 400 || resp.status === 404) {
    resp = await makeCall(false, true);
    if (resp.status === 400 || resp.status === 404) {
      resp = await makeCall(false, false);
    }
  }

  const browserRateLimits = parseBrowserRateLimitHeaders(resp.headers, activePid);

  const data = (await resp.json()) as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: AccumulatedToolCall[];
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      total_tokens?: number;
      cost?: number;
    };
    error?: { message?: string };
  };
  if (!resp.ok) {
    throw new Error(mapFriendlyHttpError(resp.status, data.error?.message));
  }

  const latencyMs = Math.round(performance.now() - started);
  const msgObj = data.choices?.[0]?.message;
  const rawContent = msgObj?.content ?? "";
  const toolCalls = Array.isArray(msgObj?.tool_calls) ? msgObj.tool_calls : [];
  const parsed = extractBrowserJson(rawContent);
  const clarificationSpec =
    extractClarificationFromToolCalls(toolCalls, req.message) ??
    (parsed.clarification
      ? {
          ...parsed.clarification,
          originalQuery: parsed.clarification.originalQuery || req.message,
        }
      : undefined);
  const vaultAction = extractVaultActionFromToolCalls(toolCalls);
  const canvasArtifact = resolveBrowserCanvasArtifact({
    toolCalls,
    canvasBuf: "",
    actionsCanvas: parsed.canvas,
    fullReply: parsed.reply,
    userMessage: req.message,
  });

  const cleanedSyncReply = cleanVisibleReply(parsed.reply || "", { stripTables: false });
  const finalReply =
    cleanedSyncReply ||
    (vaultAction
      ? `Abrí el formulario seguro de bóveda para **${getProviderSpec(vaultAction.provider).name}**. Ingresa ahí tu clave para guardarla localmente.`
      : canvasArtifact
        ? `Listo, generé "${canvasArtifact.title}" en Canvas (${canvasArtifact.rows.length} filas y ${canvasArtifact.columns.length} columnas).`
        : clarificationSpec
          ? clarificationSpec.subtitle || clarificationSpec.title
          : "Listo, procesé tu consulta.");

  const resolvedModel = data.model || chosenModel;
  const pt = data.usage?.prompt_tokens ?? 0;
  const ct = data.usage?.completion_tokens ?? 0;
  const cached =
    data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const estCost =
    typeof data.usage?.cost === "number"
      ? data.usage.cost
      : estimateBrowserTurnCostUsd(activePid, resolvedModel, pt, ct, cached);
  const usageObj: XoxTokenUsage | undefined = data.usage
    ? {
        promptTokens: pt,
        completionTokens: ct,
        cachedTokens: cached > 0 ? cached : undefined,
        totalTokens: data.usage.total_tokens ?? pt + ct,
        cost: estCost,
        estimatedCostUsd: estCost,
      }
    : undefined;

  recordBrowserAiUsage({
    provider: activePid,
    modelId: resolvedModel,
    usage: usageObj,
    rateLimits: browserRateLimits,
  });

  return {
    ...parsed,
    operation: clarificationSpec ? "ask_clarification" : parsed.operation,
    reply: finalReply,
    canvas: canvasArtifact,
    clarification: clarificationSpec,
    vaultAction,
    xoxMood: canvasArtifact && parsed.xoxMood === "talking" ? "success" : parsed.xoxMood,
    providerUsed: activePid,
    modelUsed: resolvedModel,
    latencyMs,
    usage: usageObj,
    rateLimits: browserRateLimits ?? undefined,
  };
}
