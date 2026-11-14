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
      "Abre el formulario cifrado Zero-Trust dentro del chat de XOOK para guardar una API key en la bóveda local o cambiar el proveedor de IA activo (openrouter, deepseek, groq, gemini, openai, anthropic).",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["openrouter", "deepseek", "groq", "gemini", "openai", "anthropic"],
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
}

export interface AiConnectionTestResult {
  ok: boolean;
  provider?: string;
  label?: string;
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
  currency?: string | null;
  balance_available?: boolean | null;
  can_use_paid_models?: boolean;
  daily_free_limit?: number;
  rpm_free_limit?: number;
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
  totalTokens: number;
  cost?: number;
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
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface BrowserProviderSlot {
  modelId: string;
  apiKey: string | null;
  customModels: string[];
  cooldownUntilMs?: number | null;
  quotaStatus?: "ready" | "cooldown" | "exhausted" | "auth_error";
  quotaReason?: string | null;
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
    } else if (lower.includes("openai") || lower.includes("openia") || lower.includes("gpt")) {
      detectedProvider = "openai";
    } else {
      // sk- genérico puede ser DeepSeek o OpenAI legacy: Xox pregunta o da selector rápido
      detectedProvider = "deepseek";
      ambiguousProviders = ["deepseek", "openai"];
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
  else if (/\b(?:anthropic|antrophic|anhtropic|claude)\b/i.test(lower)) providerHint = "anthropic";
  else if (/\bgroq\b/i.test(lower)) providerHint = "groq";
  else if (/\b(?:gemini|google\s*ai|ai\s*studio)\b/i.test(lower)) providerHint = "gemini";
  else if (/\b(?:openai|open\s*ia|openia|chatgpt|gpt-4|gpt4|gpt-5)\b/i.test(lower)) providerHint = "openai";
  else if (/\bopenrouter\b/i.test(lower)) providerHint = "openrouter";

  const isSetup =
    /(api\s*key|clave\s*api|b[oó]veda|openrouter|deepseek|groq|gemini|anthropic|antrophic|openai|open\s*ia|openia|token\s*de\s*ia|configur\w*\s*(?:la\s*|el\s*|mi\s*|tu\s*)?(?:ia|clave|api|key|modelo|b[oó]veda|provedor|proveedor)|cambia\w*\s*(?:clave|proveedor|modelo)|guarda\w*\s*(?:la\s*|mi\s*)?(?:clave|api|key))/i.test(
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
      const baseUrl = spec.baseUrl;
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
          message: mapFriendlyHttpError(resp.status, undefined, spec.name),
        };
      }
      return {
        ok: true,
        provider: targetPid,
        label: spec.name,
        is_free_tier: spec.supportsFreeTier,
        can_use_paid_models: true,
        message: `Conexión verificada con ${spec.name}.`,
      };
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

    return {
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
      can_use_paid_models: canUsePaid,
      daily_free_limit: isFreeTier ? 50 : 1000,
      rpm_free_limit: 20,
      message: "Conexión verificada con OpenRouter.",
    };
  } catch (err) {
    return {
      ok: false,
      provider: "openrouter",
      message: extractErrorMessage(err, "No se pudo conectar con OpenRouter."),
    };
  }
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
      "empresa/reglas/operacion.md",
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
        total_tokens?: number;
        cost?: number;
      };
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
    const usage = res.usage
      ? {
          promptTokens: res.usage.prompt_tokens ?? 0,
          completionTokens: res.usage.completion_tokens ?? 0,
          totalTokens: res.usage.total_tokens ?? 0,
          cost: typeof res.usage.cost === "number" ? res.usage.cost : undefined,
        }
      : undefined;
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

class BrowserStreamTagRouter {
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

  constructor(
    private onReasoning: (chunk: string) => void,
    private onReply: (chunk: string) => void,
    private onPhase: (phase: "thinking" | "talking" | "canvas") => void
  ) {}

  private enterReply() {
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
        const found = this.findFirstTag(this.buf, BrowserStreamTagRouter.STOP_REPLY);
        if (found) {
          if (found.idx > 0) this.onReply(this.buf.slice(0, found.idx));
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
        const [safe, rem] = this.partialSplit(this.buf, BrowserStreamTagRouter.STOP_REPLY);
        if (safe) this.onReply(safe);
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
      const cleaned = this.buf.replace(
        /<\s*\/?\s*(?:analisis|analysis|respuesta|response|canvas|lienzo|acciones|actions|posta|reply|resp)\s*(?:>|$)/gi,
        ""
      );
      if (cleaned) this.onReply(cleaned);
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

  const header = `Eres Xox, un asistente inteligente y copiloto operativo dentro de XOOK. Respondes siempre en español claro, directo y humano, sin tecnicismos, sin emojis ni iconos y sin JSON visible al usuario.

FECHA Y HORA LOCAL ACTUAL DEL SISTEMA: ${nowLabel}

CAPACIDADES:
- Puedes responder preguntas generales de uso diario (qué hora es, qué día es hoy, cálculos, dudas generales, explicaciones o charla casual) de forma directa y natural usando la fecha y hora local actual cuando aplique, SIN desviar la conversación hacia inventario si el usuario no lo pidió.
- Cuando el usuario trate temas de su operación, tienda, inventario, proveedores, agenda o tareas, apoya usando su contexto operativo, reglamento y memoria.
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
          total_tokens?: number;
          cost?: number;
        };
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

      const usage = res.usage
        ? {
            promptTokens: res.usage.prompt_tokens ?? 0,
            completionTokens: res.usage.completion_tokens ?? 0,
            totalTokens: res.usage.total_tokens ?? 0,
            cost: typeof res.usage.cost === "number" ? res.usage.cost : undefined,
          }
        : undefined;

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
  if (!vault.apiKey) {
    throw new Error("Falta configurar tu clave API de OpenRouter.");
  }

  const chosenModel = req.modelOverride?.trim() || vault.modelId || "openrouter/free";
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

  const activeBrowserPid = normalizeProviderIdClient(req.providerOverride || vault.provider);
  const activeBrowserSpec = AI_PROVIDERS[activeBrowserPid];
  const apiKey = normalizeApiKey(vault.providers[activeBrowserPid]?.apiKey ?? vault.apiKey);

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
      const attemptResp = await fetch(`${activeBrowserSpec.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
      });
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
            usageObj = {
              promptTokens: evt.usage.prompt_tokens ?? 0,
              completionTokens: evt.usage.completion_tokens ?? 0,
              totalTokens: evt.usage.total_tokens ?? 0,
              cost: typeof evt.usage.cost === "number" ? evt.usage.cost : undefined,
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
    modelUsed: actualModel,
    latencyMs,
    usage: usageObj,
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
    return fetch(`${spec.baseUrl}/chat/completions`, {
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

  return {
    ...parsed,
    operation: clarificationSpec ? "ask_clarification" : parsed.operation,
    reply: finalReply,
    canvas: canvasArtifact,
    clarification: clarificationSpec,
    vaultAction,
    xoxMood: canvasArtifact && parsed.xoxMood === "talking" ? "success" : parsed.xoxMood,
    modelUsed: data.model || chosenModel,
    latencyMs,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
          cost: typeof data.usage.cost === "number" ? data.usage.cost : undefined,
        }
      : undefined,
  };
}
