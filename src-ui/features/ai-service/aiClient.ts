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
export type { ClarificationSpec };

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
              kind: { type: "string", enum: ["choice_or_text", "single", "multi", "text"] },
              options: { type: "array", items: { type: "string" } },
              placeholder: { type: "string" },
              required: { type: "boolean" },
            },
            required: ["id", "prompt"],
          },
        },
      },
      required: ["title", "questions"],
    },
  },
};

export interface OpenRouterModelOption {
  id: string;
  name: string;
  provider_name?: string;
  hint: string;
  is_free: boolean;
  context_length?: number | null;
  prompt_price_per_million?: number | null;
  completion_price_per_million?: number | null;
}

export const OPENROUTER_PRESET_MODELS: OpenRouterModelOption[] = [
  {
    id: "openrouter/free",
    name: "Automático (Gratis)",
    provider_name: "OpenRouter",
    hint: "Elige el mejor modelo gratuito disponible",
    is_free: true,
    context_length: 200000,
  },
  {
    id: "openrouter/auto",
    name: "Automático (Estándar)",
    provider_name: "OpenRouter",
    hint: "Enruta al mejor modelo según la tarea",
    is_free: false,
    context_length: 2000000,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider_name: "Google",
    hint: "Rápido y económico",
    is_free: false,
    context_length: 1000000,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider_name: "OpenAI",
    hint: "Preciso y ligero",
    is_free: false,
    context_length: 128000,
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider_name: "OpenAI",
    hint: "Modelo insignia de OpenAI",
    is_free: false,
    context_length: 128000,
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider_name: "Anthropic",
    hint: "Razonamiento profundo",
    is_free: false,
    context_length: 200000,
  },
];

export interface AiConfigStatus {
  provider: string;
  modelId: string;
  hasApiKey: boolean;
  maskedKey: string | null;
  keySource: "vault" | "env" | "browser" | "none";
  customModels: string[];
}

export interface SaveAiConfigInput {
  provider?: string;
  modelId?: string;
  apiKey?: string;
  clearKey?: boolean;
  customModels?: string[];
}

export interface AiConnectionTestResult {
  ok: boolean;
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
  generatedPdfs?: GeneratedPdfArtifact[];
  modelUsed: string;
  latencyMs: number;
  usage?: XoxTokenUsage;
  workspaceMutated?: boolean;
}

export interface XoxStreamCallbacks {
  onStreamStart?: (streamId: string) => void;
  onPhase?: (state: "reading" | "thinking" | "talking" | "syncing", label?: string) => void;
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

interface BrowserVault {
  provider: string;
  modelId: string;
  apiKey: string | null;
  customModels: string[];
}

let cachedCatalog: { fetchedAt: number; models: OpenRouterModelOption[]; source: string } | null = null;

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
  unavailableModelIds: ReadonlySet<string> = new Set()
): OpenRouterModelOption[] {
  const baseList = catalog.length > 0 ? catalog : OPENROUTER_PRESET_MODELS;
  const byId = new Map<string, OpenRouterModelOption>();

  for (const m of baseList) {
    if (!canUsePaidModels && !m.is_free) continue;
    if (unavailableModelIds.has(m.id)) continue;
    byId.set(m.id, m);
  }

  // Asegurar que Automático (Gratis) siempre esté arriba
  if (!byId.has("openrouter/free")) {
    byId.set("openrouter/free", OPENROUTER_PRESET_MODELS[0]);
  }

  for (const customId of customModels) {
    if (byId.has(customId) || unavailableModelIds.has(customId)) continue;
    const formatted = formatModelDisplay(customId, baseList);
    if (!canUsePaidModels && !formatted.is_free) continue;
    byId.set(customId, formatted);
  }

  const presetIds = new Set(OPENROUTER_PRESET_MODELS.map((p) => p.id));
  const curatedPaid = OPENROUTER_PRESET_MODELS.filter((p) => !p.is_free);

  const list = Array.from(byId.values());
  list.sort((a, b) => {
    if (a.id === "openrouter/free") return -1;
    if (b.id === "openrouter/free") return 1;
    if (canUsePaidModels) {
      const aPreset = presetIds.has(a.id);
      const bPreset = presetIds.has(b.id);
      if (aPreset !== bPreset) return aPreset ? -1 : 1;
      if (aPreset && bPreset) {
        return (
          curatedPaid.findIndex((p) => p.id === a.id) -
          curatedPaid.findIndex((p) => p.id === b.id)
        );
      }
    }
    if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Si tiene saldo, mostrar presets + modelos gratuitos reales (no saturar con 475 ítems el menú rápido)
  if (canUsePaidModels) {
    const pinnedAndFree = list.filter(
      (m) => presetIds.has(m.id) || m.is_free || customModels.includes(m.id)
    );
    return pinnedAndFree;
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
  const prefixLen = trimmed.startsWith("sk-or-v1-") && trimmed.length > 14 ? 9 : 4;
  return `${trimmed.slice(0, prefixLen)}••••${trimmed.slice(-4)}`;
}

/**
 * Detecta localmente claves tipo OpenRouter / OpenAI antes de enviarlas a internet.
 */
export function detectApiKeyInText(text: string): {
  detectedKey: string | null;
  maskedKey: string | null;
  sanitizedText: string;
} {
  const regex = /\b(sk-or-(?:v1-)?[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,})\b/;
  const match = text.match(regex);
  if (!match) {
    return { detectedKey: null, maskedKey: null, sanitizedText: text };
  }
  const detectedKey = match[1];
  const maskedKey = maskApiKey(detectedKey);
  const sanitizedText = text.replace(detectedKey, maskedKey);
  return { detectedKey, maskedKey, sanitizedText };
}

export function isKeySetupIntent(text: string): boolean {
  return /(api\s*key|clave\s*api|openrouter|token\s*de\s*ia|configur\w*\s*(?:la\s*)?(?:ia|clave|api|modelo)|cambia\w*\s*clave)/i.test(
    text
  );
}

function readBrowserVault(): BrowserVault {
  try {
    const raw = localStorage.getItem(BROWSER_VAULT_KEY);
    if (!raw) {
      return {
        provider: "openrouter",
        modelId: "openrouter/free",
        apiKey: null,
        customModels: [],
      };
    }
    const parsed = JSON.parse(raw) as Partial<BrowserVault>;
    return {
      provider: parsed.provider || "openrouter",
      modelId: parsed.modelId || "openrouter/free",
      apiKey: parsed.apiKey || null,
      customModels: Array.isArray(parsed.customModels) ? parsed.customModels : [],
    };
  } catch {
    return {
      provider: "openrouter",
      modelId: "openrouter/free",
      apiKey: null,
      customModels: [],
    };
  }
}

function writeBrowserVault(vault: BrowserVault): void {
  try {
    localStorage.setItem(BROWSER_VAULT_KEY, JSON.stringify(vault));
  } catch {
    // Ignorar error de almacenamiento privado
  }
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
  const vault = readBrowserVault();
  return {
    provider: vault.provider,
    modelId: vault.modelId,
    hasApiKey: Boolean(vault.apiKey),
    maskedKey: vault.apiKey ? maskApiKey(vault.apiKey) : null,
    keySource: vault.apiKey ? "browser" : "none",
    customModels: vault.customModels,
  };
}

export function normalizeApiKey(raw?: string | null): string {
  let key = (raw ?? "").trim().replace(/^['"`]+|['"`,;.]+$/g, "");
  if (/^bearer\s+/i.test(key)) {
    key = key
      .replace(/^bearer\s+/i, "")
      .trim()
      .replace(/^['"`]+|['"`,;.]+$/g, "");
  }
  const embedded = key.match(/\b(sk-or-(?:v1-)?[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,})\b/);
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
  const next: BrowserVault = {
    provider: input.provider?.trim() || current.provider,
    modelId: input.modelId?.trim() || current.modelId,
    customModels: input.customModels ?? current.customModels,
    apiKey: input.clearKey ? null : cleanedKey || current.apiKey,
  };
  writeBrowserVault(next);

  return {
    provider: next.provider,
    modelId: next.modelId,
    hasApiKey: Boolean(next.apiKey),
    maskedKey: next.apiKey ? maskApiKey(next.apiKey) : null,
    keySource: next.apiKey ? "browser" : "none",
    customModels: next.customModels,
  };
}

export async function testAiConnection(): Promise<AiConnectionTestResult> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AiConnectionTestResult>("test_ai_connection");
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  const vault = readBrowserVault();
  const key = normalizeApiKey(vault.apiKey);
  if (!key) {
    return { ok: false, message: "No hay una clave API de OpenRouter guardada." };
  }
  if (/^[a-fA-F0-9]{64}$/.test(key)) {
    return {
      ok: false,
      message: "Parece que falta el prefijo 'sk-or-v1-' al inicio de tu clave de OpenRouter.",
    };
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
      message: extractErrorMessage(err, "No se pudo conectar con OpenRouter."),
    };
  }
}

export async function fetchOpenRouterModels(
  freeOnly = false,
  forceRefresh = false
): Promise<{ ok: boolean; models: OpenRouterModelOption[]; source: string }> {
  const now = Date.now();
  if (!forceRefresh && cachedCatalog && now - cachedCatalog.fetchedAt < 5 * 60 * 1000) {
    const models = freeOnly
      ? cachedCatalog.models.filter((m) => m.is_free)
      : cachedCatalog.models;
    return { ok: true, models, source: cachedCatalog.source };
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ ok: boolean; models: OpenRouterModelOption[]; source: string }>(
        "fetch_openrouter_models",
        { freeOnly: false }
      );
      if (res.ok && res.models.length > 0) {
        cachedCatalog = { fetchedAt: now, models: res.models, source: res.source };
      }
      const filtered = freeOnly ? res.models.filter((m) => m.is_free) : res.models;
      return { ...res, models: filtered };
    } catch {
      // Fallback abajo
    }
  }

  try {
    const vault = readBrowserVault();
    const headers: Record<string, string> = {};
    if (vault.apiKey) headers.Authorization = `Bearer ${vault.apiKey}`;
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
      .map((m) => formatOpenRouterRawModel(m))
      .sort((a, b) => {
        if (a.id === "openrouter/free") return -1;
        if (b.id === "openrouter/free") return 1;
        if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    cachedCatalog = { fetchedAt: now, models: list, source: "openrouter" };
    return {
      ok: true,
      models: freeOnly ? list.filter((m) => m.is_free) : list,
      source: "openrouter",
    };
  } catch {
    return {
      ok: false,
      models: OPENROUTER_PRESET_MODELS.filter((m) => !freeOnly || m.is_free),
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

function mapFriendlyHttpError(status: number, rawMessage?: string): string {
  const lower = (rawMessage ?? "").toLowerCase();
  if (status === 402 || lower.includes("insufficient credits") || lower.includes("more credits")) {
    return "Tu cuenta de OpenRouter no tiene saldo suficiente para este modelo. Cambia a un modelo gratuito o recarga créditos.";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "Se alcanzó el límite temporal de solicitudes en OpenRouter (gratuito: 20/min o 50/día). Espera un momento o prueba otro modelo gratuito.";
  }
  return rawMessage || `Error OpenRouter HTTP ${status}`;
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
      model_used?: string;
      latency_ms?: number;
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
      modelUsed: res.model_used ?? req.modelOverride ?? "openrouter/free",
      latencyMs: res.latency_ms ?? 0,
      usage,
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
- Usa herramientas nativas como \`create_canvas\`, \`propose_tasks\`, \`ask_clarification\` o \`pdf_generate\` únicamente cuando la petición requiera una tabla interactiva, tareas/recordatorios en XOOK, aclaración estructurada o PDF.`;
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
        [key: string]: unknown;
      };
    }>("xox-chat-stream", (ev) => {
      const payload = ev.payload;
      if (!payload || payload.stream_id !== streamId || !payload.event) return;
      const evt = payload.event;
      if (evt.type === "phase" && evt.xox_state) {
        callbacks?.onPhase?.(evt.xox_state, evt.label);
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
        model_used?: string;
        latency_ms?: number;
        workspace_mutated?: boolean;
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
        generatedPdfs: sanitizeGeneratedPdfList(res.generated_pdfs),
        modelUsed: res.model_used ?? req.modelOverride ?? "openrouter/free",
        latencyMs: res.latency_ms ?? 0,
        usage,
        workspaceMutated: Boolean(res.workspace_mutated),
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

  const apiKey = normalizeApiKey(vault.apiKey);

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
        reqBody.tools = [BROWSER_CANVAS_TOOL_DEF, BROWSER_CLARIFICATION_TOOL_DEF];
        reqBody.tool_choice = "auto";
      }
      const attemptResp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "XOOK Enterprise Agentic Orchestrator",
        },
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
      throw new Error(mapFriendlyHttpError(attemptResp.status, errText));
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
    (hasTabularCanvas && canvasArtifact
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
    modelUsed: actualModel,
    latencyMs,
    usage: usageObj,
  };
}

async function runBrowserAiChat(req: XoxAiChatRequest): Promise<XoxAiChatResponse> {
  const vault = readBrowserVault();
  if (!vault.apiKey) {
    throw new Error("Falta configurar tu clave API de OpenRouter.");
  }

  const chosenModel = req.modelOverride?.trim() || vault.modelId || "openrouter/free";
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
      payload.tools = [BROWSER_CANVAS_TOOL_DEF, BROWSER_CLARIFICATION_TOOL_DEF];
      payload.tool_choice = "auto";
    }
    return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizeApiKey(vault.apiKey)}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": "XOOK Enterprise Agentic Orchestrator",
      },
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
    (canvasArtifact
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
