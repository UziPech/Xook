/**
 * Contratos del Grafo de Memoria de Xox y Optimizador de Tokens de Inicio (L0 / L1 / L2).
 *
 * Separa los recuerdos durables en tres niveles para minimizar el costo de tokens en cada turno:
 * - `L0_core`: Identidad y recuerdos fijados (`pinned`), siempre presentes en el prompt de inicio.
 * - `L1_contextual`: Recuerdos activados dinámicamente solo cuando la consulta actual coincide.
 * - `L2_ondemand`: Recuerdos latentes con costo 0 por cuerpo al inicio, expuestos mediante un índice compacto de 1 línea.
 */

import {
  containsSecretMaterial,
  normalizeUserMemoryCategory,
  type UserMemoryCategory,
  type UserMemoryFact,
  type UserMemoryScope,
  type UserProfileRecord,
} from "./userDataStore.ts";

export type MemoryTier = "L0_core" | "L1_contextual" | "L2_ondemand";

export type MemoryGraphNodeKind =
  | "hub"
  | "category"
  | "fact"
  | "workspace_fact"
  | "pattern"
  | "preference";

export interface MemoryGraphNode {
  id: string;
  kind: MemoryGraphNodeKind;
  label: string;
  detail: string;
  category: UserMemoryCategory | "workspace" | "pattern";
  scope: "global" | "workspace";
  tier: MemoryTier;
  pinned: boolean;
  tokenEstimate: number;
  confidence?: number;
  factId?: string;
  factKey?: string;
  sourceWindow?: string;
  updatedAt?: string;
  sourceKind?: "user_fact" | "workspace_fact" | "preference" | "pattern";
  sourceIndex?: number;
  preferenceBucket?: "likes" | "workflows" | "donts";
  rawText?: string;
  x: number;
  y: number;
  radius: number;
}

export interface MemoryGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "hierarchy" | "semantic";
  weight: number;
  label?: string;
  curveSeed?: number;
}

export interface MemoryTokenBudgetStats {
  totalFacts: number;
  l0Count: number;
  l1Count: number;
  l2Count: number;
  l0Tokens: number;
  l1Tokens: number;
  l2SavedTokens: number;
  indexOverheadTokens: number;
  naiveTokensEstimate: number;
  optimizedTokensEstimate: number;
  savedTokensEstimate: number;
  savedPct: number;
}

export interface StartupMemorySelection {
  l0Facts: UserMemoryFact[];
  l1Facts: UserMemoryFact[];
  l2Facts: UserMemoryFact[];
  promptBlock: string;
  l2IndexLine: string;
  stats: MemoryTokenBudgetStats;
}

export interface BuildMemoryGraphInput {
  agentName?: string;
  userProfile?: Partial<UserProfileRecord> | null;
  userFacts?: UserMemoryFact[];
  workspaceFacts?: string[];
  patterns?: Array<{ id?: string; description: string; confidence?: number }>;
  preferences?: { likes?: string[]; workflows?: string[]; donts?: string[] };
  activeWorkspaceName?: string | null;
  activeQuery?: string;
  l0MaxChars?: number;
  l1MaxChars?: number;
}

export interface MemoryGraphSnapshot {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  stats: MemoryTokenBudgetStats;
  categories: Array<{ id: string; label: string; count: number; tokenEstimate: number }>;
}

export const DEFAULT_L0_MAX_CHARS = 450;
export const DEFAULT_L1_MAX_CHARS = 650;

const GRAPH_CENTER_X = 400;
const GRAPH_CENTER_Y = 260;
const HUB_RADIUS = 28;
const CATEGORY_NODE_RADIUS = 18;
const FORCE_RELAXATION_ITERATIONS = 45;
const MIN_NODE_SEPARATION_PX = 52;

const CATEGORY_ORDER: ReadonlyArray<UserMemoryCategory | "workspace" | "pattern"> = [
  "identity",
  "preference",
  "work",
  "contact",
  "routine",
  "project",
  "other",
  "workspace",
  "pattern",
];

const CATEGORY_LABELS: Record<UserMemoryCategory | "workspace" | "pattern", string> = {
  identity: "Identidad",
  preference: "Preferencias",
  work: "Trabajo",
  contact: "Contactos",
  routine: "Rutina",
  project: "Proyectos",
  other: "General",
  workspace: "Espacio",
  pattern: "Patrones",
};

const CATEGORY_SYNONYMS: Record<UserMemoryCategory | "workspace" | "pattern", readonly string[]> = {
  identity: [
    "identity",
    "identidad",
    "nombre",
    "perfil",
    "quien",
    "ciudad",
    "ubicacion",
    "pais",
    "personal",
  ],
  preference: [
    "preference",
    "preferencia",
    "preferencias",
    "estilo",
    "tono",
    "formato",
    "gusta",
    "prefiere",
    "idioma",
  ],
  work: [
    "work",
    "trabajo",
    "rol",
    "empresa",
    "negocio",
    "tienda",
    "oficio",
    "profesion",
    "puesto",
    "cargo",
    "cliente",
    "ventas",
    "operacion",
  ],
  contact: [
    "contact",
    "contacto",
    "contactos",
    "equipo",
    "persona",
    "correo",
    "email",
    "telefono",
    "socio",
    "colega",
    "proveedor",
  ],
  routine: [
    "routine",
    "rutina",
    "horario",
    "agenda",
    "hora",
    "turno",
    "semana",
    "diario",
    "frecuencia",
    "calendario",
  ],
  project: [
    "project",
    "proyecto",
    "proyectos",
    "meta",
    "objetivo",
    "lanzamiento",
    "roadmap",
    "entrega",
    "sprint",
    "producto",
  ],
  other: ["other", "otro", "nota", "dato", "general"],
  workspace: ["workspace", "espacio", "hecho", "hechos", "memoria", "documento"],
  pattern: ["pattern", "patron", "patrones", "habito", "comportamiento", "flujo"],
};

const STOPWORDS = new Set<string>([
  // Español
  "para",
  "como",
  "este",
  "esta",
  "esto",
  "estos",
  "estas",
  "eso",
  "esa",
  "esos",
  "esas",
  "aquel",
  "pero",
  "porque",
  "cuando",
  "donde",
  "quien",
  "cual",
  "cuales",
  "todo",
  "toda",
  "todos",
  "todas",
  "algo",
  "nada",
  "muy",
  "mas",
  "menos",
  "tambien",
  "solo",
  "sobre",
  "entre",
  "hasta",
  "desde",
  "hacia",
  "ante",
  "bajo",
  "cabe",
  "con",
  "contra",
  "del",
  "los",
  "las",
  "una",
  "uno",
  "unos",
  "unas",
  "mis",
  "tus",
  "sus",
  "nuestro",
  "nuestra",
  "por",
  "sin",
  "tras",
  "que",
  "qué",
  "son",
  "ser",
  "era",
  "fue",
  "sido",
  "estar",
  "esta",
  "estan",
  "estoy",
  "estas",
  "hay",
  "tiene",
  "tengo",
  "tener",
  "hace",
  "hacer",
  "puede",
  "puedo",
  "puedes",
  "hola",
  "buenos",
  "buenas",
  "dias",
  "tardes",
  "noches",
  "gracias",
  "favor",
  "ayuda",
  "dime",
  "sabes",
  "necesito",
  "necesita",
  "quiero",
  "quiere",
  "revisar",
  "revisa",
  "buscar",
  "busca",
  "mostrar",
  "muestra",
  "dame",
  // Inglés
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "have",
  "has",
  "had",
  "not",
  "but",
  "are",
  "was",
  "were",
  "been",
  "will",
  "would",
  "could",
  "should",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "how",
  "all",
  "any",
  "can",
  "you",
  "your",
  "our",
  "their",
  "about",
  "into",
  "over",
  "after",
  "before",
  "under",
  "again",
  "there",
  "here",
  "hello",
  "hey",
  "please",
  "help",
]);

const SEMANTIC_EDGE_STOPWORDS = new Set<string>([
  // Boilerplate / términos demasiado genéricos en español
  "este",
  "esta",
  "estos",
  "estas",
  "archivo",
  "archivos",
  "guarda",
  "guardar",
  "datos",
  "dato",
  "hechos",
  "hecho",
  "nunca",
  "siempre",
  "usuario",
  "espacio",
  "proyecto",
  "proyectos",
  "trabajo",
  "regla",
  "reglas",
  "usar",
  "hacer",
  "poner",
  "tener",
  "para",
  "como",
  "pero",
  "sobre",
  "entre",
  "desde",
  "hasta",
  "puede",
  "pueden",
  "debe",
  "deben",
  "solo",
  "mas",
  "muy",
  "bien",
  "todo",
  "cada",
  "otro",
  "otra",
  "otros",
  "otras",
  "antes",
  "despues",
  "forma",
  "manera",
  "general",
  "actual",
  "principal",
  "memoria",
  "contexto",
  "informacion",
  "preferencia",
  "preferencias",
  "prefiere",
  "gusto",
  "gustos",
  "flujo",
  "flujos",
  "evitar",
  "patron",
  "patrones",
  "pref",
  "workspace",
  "nota",
  "notas",
  // Inglés genérico
  "file",
  "files",
  "data",
  "fact",
  "facts",
  "never",
  "always",
  "user",
  "project",
  "projects",
  "work",
  "rule",
  "rules",
  "using",
  "make",
  "keep",
  "must",
  "only",
  "more",
  "very",
  "good",
  "well",
  "every",
  "each",
  "other",
  "others",
  "same",
  "also",
  "just",
  "like",
  "note",
  "notes",
  "info",
  "context",
  "memory",
  "pattern",
  "patterns",
]);

const WORKSPACE_BOILERPLATE_PREFIXES: readonly string[] = [
  "este archivo guarda",
  "este archivo ",
  "este espacio guia",
  "define aqui",
  "aqui se registran",
  "aqui se guardan",
  "aqui ",
];

const REDUNDANT_LABEL_PREFIX_RE =
  /^(?:gustos?|flujos?|evitar|no\s+hacer|preferencias?)\s*:\s*/i;

const SYNTHETIC_FACT_KEY_RE =
  /^(?:hecho_workspace_\d+|pref_(?:likes|workflows|donts|gusto|flujo|evitar)_\d+|patron_\d+)$/;

const MAX_LEAF_LABEL_CHARS = 24;
const MAX_SEMANTIC_EDGES_PER_LEAF = 2;
const MAX_SEMANTIC_EDGES_TOTAL = 14;

function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function tokenizeMeaningful(text: string, minLen = 3): string[] {
  const normalized = stripDiacritics(String(text ?? "")).toLowerCase();
  const rawTokens = normalized.split(/[^a-z0-9]+/);
  const unique = new Set<string>();
  for (const tok of rawTokens) {
    if (tok.length >= minLen && !STOPWORDS.has(tok)) {
      unique.add(tok);
    }
  }
  return Array.from(unique);
}

function extractSemanticKeywords(text: string): string[] {
  const normalized = stripDiacritics(String(text ?? "")).toLowerCase();
  const rawTokens = normalized.split(/[^a-z0-9]+/);
  const unique = new Set<string>();
  for (const tok of rawTokens) {
    if (tok.length < 4) continue;
    if (/^\d+$/.test(tok)) continue;
    if (!/[a-z]{2}/.test(tok)) continue;
    if (STOPWORDS.has(tok) || SEMANTIC_EDGE_STOPWORDS.has(tok)) continue;
    unique.add(tok);
  }
  return Array.from(unique);
}

function isWorkspaceFactBoilerplate(text: string): boolean {
  const normalized = stripDiacritics(String(text ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  if (/^[-_*]{3,}$/.test(normalized)) return true;
  if (/^<!--.*-->$/.test(normalized)) return true;
  return WORKSPACE_BOILERPLATE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function stripRedundantPrefix(text: string): string {
  let out = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 2; i += 1) {
    const next = out.replace(REDUNDANT_LABEL_PREFIX_RE, "").trim();
    if (next === out) break;
    out = next;
    if (!out) break;
  }
  return out;
}

interface ParsedWorkspaceFactLine {
  text: string;
  updatedAt?: string;
  factKey?: string;
}

function parseWorkspaceFactLine(rawLine: string): ParsedWorkspaceFactLine {
  let body = String(rawLine ?? "")
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

  let updatedAt: string | undefined;
  let factKey: string | undefined;
  let strippedTagCategory = false;

  for (let i = 0; i < 5; i += 1) {
    const tsMatch = body.match(/^\[(\d{4}-\d{2}-\d{2}[^\]]*)\]\s*(.*)$/);
    if (tsMatch && !updatedAt) {
      updatedAt = tsMatch[1].trim();
      body = tsMatch[2].trim();
      continue;
    }

    const keyMatch = body.match(/^\[key:([a-zA-Z0-9_.-]{1,64})\]\s*(.*)$/i);
    if (keyMatch && !factKey) {
      factKey = keyMatch[1].trim();
      body = keyMatch[2].trim();
      continue;
    }

    const parenCatMatch = body.match(/^\(([^)\n.:;]{1,32})\)\s+(.+)$/);
    if (parenCatMatch && !strippedTagCategory) {
      strippedTagCategory = true;
      body = parenCatMatch[2].trim();
      continue;
    }

    const bracketCatMatch = body.match(/^\[([^\]\n.:;]{1,32})\]\s+(.+)$/);
    if (bracketCatMatch && !strippedTagCategory) {
      strippedTagCategory = true;
      body = bracketCatMatch[2].trim();
      continue;
    }

    break;
  }

  body = body.replace(/^[:\-–—]\s+/, "").trim();
  return { text: body, updatedAt, factKey };
}

function formatFactPromptLine(fact: Pick<UserMemoryFact, "key" | "category" | "value">): string {
  const val = String(fact.value || "")
    .replace(/\s+/g, " ")
    .trim();
  const cat = normalizeUserMemoryCategory(fact.category);
  const key = String(fact.key || "").trim();
  return key ? `- [${cat}] (${key}): ${val}` : `- [${cat}] ${val}`;
}

function shortLabel(text: string, maxChars = MAX_LEAF_LABEL_CHARS): string {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, Math.max(1, maxChars - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const candidate =
    lastSpace >= Math.floor((maxChars - 1) * 0.65) ? slice.slice(0, lastSpace) : slice;
  return `${candidate.trimEnd()}…`;
}

/**
 * Estima la cantidad de tokens de un texto usando la heurística ~3.8 caracteres por token.
 */
export function estimateTokensFromText(text: string): number {
  const clean = String(text ?? "").trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 3.8));
}

/**
 * Evalúa la relevancia léxica/semántica de un hecho frente a una consulta del usuario.
 * Retorna `0` cuando la consulta está vacía o no contiene tokens significativos que coincidan.
 */
export function scoreFactRelevance(
  fact: Pick<UserMemoryFact, "key" | "category" | "value">,
  query: string
): number {
  const queryTokens = tokenizeMeaningful(query, 3);
  if (queryTokens.length === 0) {
    return 0;
  }

  const normKey = stripDiacritics(String(fact.key ?? "")).toLowerCase();
  const normVal = stripDiacritics(String(fact.value ?? "")).toLowerCase();
  const normCat = normalizeUserMemoryCategory(fact.category);

  const keyTokens = normKey.split(/[^a-z0-9]+/).filter(Boolean);
  const valTokens = normVal.split(/[^a-z0-9]+/).filter(Boolean);
  const keyTokenSet = new Set(keyTokens);
  const valTokenSet = new Set(valTokens);
  const catSynonyms = CATEGORY_SYNONYMS[normCat] ?? [normCat];

  let score = 0;

  for (const qTok of queryTokens) {
    if (keyTokenSet.has(qTok)) {
      score += 5;
    } else if (normKey.includes(qTok)) {
      score += 3;
    } else if (
      qTok.length >= 5 &&
      keyTokens.some((kTok) => kTok.length >= 5 && kTok.slice(0, 5) === qTok.slice(0, 5))
    ) {
      score += 2;
    }

    if (valTokenSet.has(qTok)) {
      score += 4;
    } else if (normVal.includes(qTok)) {
      score += 2.5;
    } else if (
      qTok.length >= 5 &&
      valTokens.some((vTok) => vTok.length >= 5 && vTok.slice(0, 5) === qTok.slice(0, 5))
    ) {
      score += 2;
    }

    if (
      catSynonyms.some(
        (syn) =>
          syn === qTok ||
          (qTok.length >= 4 && (syn.startsWith(qTok) || qTok.startsWith(syn)))
      )
    ) {
      score += 2;
    }
  }

  return score;
}

function buildTokenBudgetStats(params: {
  l0Tokens: number;
  l1Tokens: number;
  l2SavedTokens: number;
  l0Count: number;
  l1Count: number;
  l2Count: number;
  l2IndexLine: string;
}): MemoryTokenBudgetStats {
  const { l0Tokens, l1Tokens, l2SavedTokens, l0Count, l1Count, l2Count, l2IndexLine } = params;
  const totalFacts = l0Count + l1Count + l2Count;
  const rawIndexTokens = l2Count > 0 && l2IndexLine ? estimateTokensFromText(l2IndexLine) : 0;
  const indexOverheadTokens =
    l2Count > 0 && l2SavedTokens > 0
      ? Math.min(rawIndexTokens, Math.max(1, Math.floor(l2SavedTokens * 0.5)))
      : 0;

  const naiveTokensEstimate = l0Tokens + l1Tokens + l2SavedTokens;
  const optimizedTokensEstimate = l0Tokens + l1Tokens + indexOverheadTokens;
  const savedTokensEstimate = Math.max(0, naiveTokensEstimate - optimizedTokensEstimate);
  const savedPct =
    naiveTokensEstimate > 0
      ? Math.max(0, Math.min(100, Math.round((savedTokensEstimate / naiveTokensEstimate) * 100)))
      : 0;

  return {
    totalFacts,
    l0Count,
    l1Count,
    l2Count,
    l0Tokens,
    l1Tokens,
    l2SavedTokens,
    indexOverheadTokens,
    naiveTokensEstimate,
    optimizedTokensEstimate,
    savedTokensEstimate,
    savedPct,
  };
}

/**
 * Clasifica los hechos del usuario en niveles `L0_core`, `L1_contextual` y `L2_ondemand`,
 * construyendo el bloque optimizado para el prompt de inicio y las métricas de ahorro.
 */
export function selectStartupMemoryPayload(
  facts: UserMemoryFact[],
  options?: { query?: string; l0MaxChars?: number; l1MaxChars?: number }
): StartupMemorySelection {
  const query = options?.query ?? "";
  const l0MaxChars = options?.l0MaxChars ?? DEFAULT_L0_MAX_CHARS;
  const l1MaxChars = options?.l1MaxChars ?? DEFAULT_L1_MAX_CHARS;

  const validFacts: UserMemoryFact[] = [];
  if (Array.isArray(facts)) {
    for (const item of facts) {
      if (!item || typeof item.value !== "string") continue;
      const cleanVal = item.value.replace(/\s+/g, " ").trim();
      if (!cleanVal || containsSecretMaterial(cleanVal)) continue;
      validFacts.push({
        ...item,
        category: normalizeUserMemoryCategory(item.category),
        value: cleanVal,
      });
    }
  }

  const l0Candidates: UserMemoryFact[] = [];
  const nonL0Pool: UserMemoryFact[] = [];

  for (const fact of validFacts) {
    if (Boolean(fact.pinned) || fact.category === "identity") {
      l0Candidates.push(fact);
    } else {
      nonL0Pool.push(fact);
    }
  }

  l0Candidates.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  const l0Facts: UserMemoryFact[] = [];
  const l0Lines: string[] = [];
  let l0UsedChars = 0;
  const overflowFromL0: UserMemoryFact[] = [];

  for (const fact of l0Candidates) {
    const line = formatFactPromptLine(fact);
    const addLen = line.length + (l0Lines.length > 0 ? 1 : 0);
    if (l0MaxChars > 0 && l0UsedChars + addLen <= l0MaxChars) {
      l0Facts.push(fact);
      l0Lines.push(line);
      l0UsedChars += addLen;
    } else {
      overflowFromL0.push(fact);
    }
  }

  const remainingForL1L2 = [...overflowFromL0, ...nonL0Pool];

  const scoredCandidates = remainingForL1L2.map((fact) => ({
    fact,
    score: scoreFactRelevance(fact, query),
  }));

  const matchingForL1 = scoredCandidates
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Boolean(a.fact.pinned) !== Boolean(b.fact.pinned)) {
        return a.fact.pinned ? -1 : 1;
      }
      return String(b.fact.updatedAt || "").localeCompare(String(a.fact.updatedAt || ""));
    });

  const l1Facts: UserMemoryFact[] = [];
  const l1Lines: string[] = [];
  const selectedL1Ids = new Set<string>();
  let l1UsedChars = 0;

  for (const { fact } of matchingForL1) {
    const line = formatFactPromptLine(fact);
    const addLen = line.length + (l1Lines.length > 0 ? 1 : 0);
    if (l1MaxChars > 0 && l1UsedChars + addLen <= l1MaxChars) {
      l1Facts.push(fact);
      l1Lines.push(line);
      selectedL1Ids.add(fact.id);
      l1UsedChars += addLen;
    }
  }

  const l2Facts: UserMemoryFact[] = remainingForL1L2.filter(
    (fact) => !selectedL1Ids.has(fact.id)
  );
  const l2Lines = l2Facts.map((fact) => formatFactPromptLine(fact));

  let l2IndexLine = "";
  if (l2Facts.length > 0) {
    const l2Categories = Array.from(
      new Set(l2Facts.map((fact) => normalizeUserMemoryCategory(fact.category)))
    ).join(", ");
    l2IndexLine = `[Índice memoria L2 (${l2Facts.length} hechos en ${l2Categories}): usa memory_search si los necesitas]`;
  }

  const promptParts: string[] = [];
  if (l0Lines.length > 0) promptParts.push(...l0Lines);
  if (l1Lines.length > 0) promptParts.push(...l1Lines);
  if (l2IndexLine) promptParts.push(l2IndexLine);
  const promptBlock = promptParts.join("\n");

  const l0Tokens = l0Lines.reduce((sum, line) => sum + estimateTokensFromText(line), 0);
  const l1Tokens = l1Lines.reduce((sum, line) => sum + estimateTokensFromText(line), 0);
  const l2SavedTokens = l2Lines.reduce((sum, line) => sum + estimateTokensFromText(line), 0);

  const stats = buildTokenBudgetStats({
    l0Tokens,
    l1Tokens,
    l2SavedTokens,
    l0Count: l0Facts.length,
    l1Count: l1Facts.length,
    l2Count: l2Facts.length,
    l2IndexLine,
  });

  return {
    l0Facts,
    l1Facts,
    l2Facts,
    promptBlock,
    l2IndexLine,
    stats,
  };
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundWeight(value: number): number {
  return Math.round(value * 100) / 100;
}

function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Calcula una semilla de curvatura determinista no nula en `[-1, 1]`
 * (magnitud entre `0.25` y `0.95` con signo alternante `+`/`-`) a partir del ID de la arista.
 */
function computeEdgeCurveSeed(edgeId: string): number {
  const h = fnv1aHash(edgeId);
  const sign = (h & 1) === 0 ? 1 : -1;
  const normalized = ((h >>> 1) % 1000) / 1000;
  const magnitude = 0.25 + normalized * 0.7;
  return Math.round(sign * magnitude * 1000) / 1000;
}

/**
 * Construye una instantánea determinista del grafo de memoria estilo Obsidian (`viewBox 800 x 520`, centro `(400, 260)`)
 * mediante posicionamiento orgánico inicial y relajación por fuerzas de 45 iteraciones, con enlaces curvos (`curveSeed`).
 */
export function buildMemoryGraphSnapshot(input: BuildMemoryGraphInput): MemoryGraphSnapshot {
  const activeQuery = String(input.activeQuery ?? "").trim();
  const selection = selectStartupMemoryPayload(input.userFacts ?? [], {
    query: activeQuery,
    l0MaxChars: input.l0MaxChars,
    l1MaxChars: input.l1MaxChars,
  });

  const factTierById = new Map<string, MemoryTier>();
  for (const fact of selection.l0Facts) factTierById.set(fact.id, "L0_core");
  for (const fact of selection.l1Facts) factTierById.set(fact.id, "L1_contextual");
  for (const fact of selection.l2Facts) factTierById.set(fact.id, "L2_ondemand");

  const rawFactValueById = new Map<string, string>();
  if (Array.isArray(input.userFacts)) {
    for (const item of input.userFacts) {
      if (item && typeof item.id === "string" && typeof item.value === "string") {
        rawFactValueById.set(item.id, item.value);
      }
    }
  }

  const orderedFacts = [...selection.l0Facts, ...selection.l1Facts, ...selection.l2Facts];

  type UnpositionedLeaf = Omit<MemoryGraphNode, "x" | "y">;
  const rawLeaves: UnpositionedLeaf[] = [];

  for (const fact of orderedFacts) {
    const tier = factTierById.get(fact.id) ?? "L2_ondemand";
    const category = normalizeUserMemoryCategory(fact.category);
    const scope: UserMemoryScope = fact.scope === "workspace" ? "workspace" : "global";
    const line = formatFactPromptLine(fact);
    const labelSource = stripRedundantPrefix(fact.value) || fact.value;
    rawLeaves.push({
      id: `fact_${fact.id}`,
      kind: "fact",
      label: shortLabel(labelSource, MAX_LEAF_LABEL_CHARS),
      detail: fact.value,
      category,
      scope,
      tier,
      pinned: Boolean(fact.pinned),
      tokenEstimate: estimateTokensFromText(line),
      factId: fact.id,
      factKey: fact.key,
      sourceWindow: fact.sourceWindow,
      updatedAt: fact.updatedAt,
      sourceKind: "user_fact",
      rawText: rawFactValueById.get(fact.id) ?? fact.value,
      radius: tier === "L0_core" ? 13 : tier === "L1_contextual" ? 12 : 10,
    });
  }

  // Preferencias del perfil de Xox (likes, workflows, donts)
  const prefs = input.preferences;
  if (prefs) {
    const prefEntries: Array<{
      bucket: "donts" | "likes" | "workflows";
      prefix: string;
      items: string[];
      isCoreRule: boolean;
    }> = [
      { bucket: "donts", prefix: "Evitar", items: prefs.donts ?? [], isCoreRule: true },
      { bucket: "likes", prefix: "Gusto", items: prefs.likes ?? [], isCoreRule: false },
      { bucket: "workflows", prefix: "Flujo", items: prefs.workflows ?? [], isCoreRule: false },
    ];
    for (const group of prefEntries) {
      for (let originalIndex = 0; originalIndex < group.items.length; originalIndex += 1) {
        const rawText = String(group.items[originalIndex] ?? "");
        const trimmedRaw = rawText.replace(/\s+/g, " ").trim();
        if (!trimmedRaw || containsSecretMaterial(trimmedRaw)) continue;
        const clean = stripRedundantPrefix(trimmedRaw);
        if (!clean || containsSecretMaterial(clean)) continue;
        const matchesQuery =
          scoreFactRelevance(
            { key: group.prefix.toLowerCase(), category: "preference", value: clean },
            activeQuery
          ) > 0;
        const tier: MemoryTier = group.isCoreRule
          ? "L0_core"
          : matchesQuery
            ? "L1_contextual"
            : "L2_ondemand";
        rawLeaves.push({
          id: `pref_${group.bucket}_${originalIndex}`,
          kind: "preference",
          label: shortLabel(clean, MAX_LEAF_LABEL_CHARS),
          detail: clean,
          category: "preference",
          scope: "global",
          tier,
          pinned: group.isCoreRule,
          tokenEstimate: estimateTokensFromText(`- [preference] (${group.prefix}): ${clean}`),
          factKey: `pref_${group.bucket}_${originalIndex}`,
          sourceKind: "preference",
          sourceIndex: originalIndex,
          preferenceBucket: group.bucket,
          rawText,
          radius: tier === "L0_core" ? 12 : tier === "L1_contextual" ? 11 : 9,
        });
      }
    }
  }

  // Hechos del workspace (memoria/hechos.md)
  if (Array.isArray(input.workspaceFacts)) {
    let wfIdx = 0;
    for (let originalIndex = 0; originalIndex < input.workspaceFacts.length; originalIndex += 1) {
      const rawBullet = String(input.workspaceFacts[originalIndex] ?? "");
      const withoutBullet = rawBullet
        .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !withoutBullet ||
        containsSecretMaterial(rawBullet) ||
        isWorkspaceFactBoilerplate(withoutBullet)
      ) {
        continue;
      }

      const parsed = parseWorkspaceFactLine(rawBullet);
      const clean = stripRedundantPrefix(parsed.text);
      if (!clean || containsSecretMaterial(clean) || isWorkspaceFactBoilerplate(clean)) {
        continue;
      }

      wfIdx += 1;
      const matchesQuery =
        scoreFactRelevance(
          { key: parsed.factKey ?? "workspace_hecho", category: "work", value: clean },
          activeQuery
        ) > 0;
      const tier: MemoryTier = matchesQuery ? "L1_contextual" : "L2_ondemand";
      rawLeaves.push({
        id: `wf_${originalIndex}`,
        kind: "workspace_fact",
        label: shortLabel(clean, MAX_LEAF_LABEL_CHARS),
        detail: clean,
        category: "workspace",
        scope: "workspace",
        tier,
        pinned: false,
        tokenEstimate: estimateTokensFromText(`- [workspace] ${clean}`),
        factKey: parsed.factKey ?? `hecho_workspace_${wfIdx}`,
        ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
        sourceKind: "workspace_fact",
        sourceIndex: originalIndex,
        rawText: rawBullet,
        radius: tier === "L1_contextual" ? 12 : 10,
      });
    }
  }

  // Patrones aprendidos
  if (Array.isArray(input.patterns)) {
    let patIdx = 0;
    for (let originalIndex = 0; originalIndex < input.patterns.length; originalIndex += 1) {
      const pat = input.patterns[originalIndex];
      const rawDesc = String(pat?.description ?? "");
      const clean = stripRedundantPrefix(rawDesc.replace(/\s+/g, " ").trim());
      if (!clean || containsSecretMaterial(rawDesc) || containsSecretMaterial(clean)) continue;
      patIdx += 1;
      const matchesQuery =
        scoreFactRelevance(
          { key: "patron", category: "routine", value: clean },
          activeQuery
        ) > 0;
      const tier: MemoryTier = matchesQuery ? "L1_contextual" : "L2_ondemand";
      rawLeaves.push({
        id: `pat_${pat.id || patIdx}`,
        kind: "pattern",
        label: shortLabel(clean, MAX_LEAF_LABEL_CHARS),
        detail: clean,
        category: "pattern",
        scope: "workspace",
        tier,
        pinned: false,
        tokenEstimate: estimateTokensFromText(`- [pattern] ${clean}`),
        confidence: typeof pat.confidence === "number" ? pat.confidence : undefined,
        factKey: `patron_${patIdx}`,
        sourceKind: "pattern",
        sourceIndex: originalIndex,
        rawText: rawDesc,
        radius: tier === "L1_contextual" ? 11 : 9,
      });
    }
  }

  // Agrupar hojas por categoría respetando orden determinista
  const leavesByCategory = new Map<
    UserMemoryCategory | "workspace" | "pattern",
    UnpositionedLeaf[]
  >();
  for (const cat of CATEGORY_ORDER) {
    leavesByCategory.set(cat, []);
  }
  for (const leaf of rawLeaves) {
    const group = leavesByCategory.get(leaf.category);
    if (group) {
      group.push(leaf);
    }
  }

  const activeCategories = CATEGORY_ORDER.filter(
    (cat) => (leavesByCategory.get(cat)?.length ?? 0) > 0
  );

  const userName =
    input.userProfile?.preferredName?.trim() || input.userProfile?.name?.trim() || "";
  const agentName = input.agentName?.trim() || "Xox";
  const hubLabel = userName ? `${agentName} · ${userName}` : agentName;
  const profileSummaryParts = [
    userName ? `Usuario: ${userName}` : null,
    input.userProfile?.role?.trim() ? `Rol: ${input.userProfile.role.trim()}` : null,
    input.userProfile?.storeName?.trim() || input.activeWorkspaceName?.trim()
      ? `Espacio: ${input.userProfile?.storeName?.trim() || input.activeWorkspaceName?.trim()}`
      : null,
    input.userProfile?.workContext?.trim()
      ? `Contexto: ${input.userProfile.workContext.trim()}`
      : null,
  ].filter(Boolean);

  const hubNode: MemoryGraphNode = {
    id: "hub_core",
    kind: "hub",
    label: hubLabel,
    detail:
      profileSummaryParts.length > 0
        ? profileSummaryParts.join(" · ")
        : "Núcleo de memoria jerárquica de Xox (L0 fijo, L1 contextual, L2 bajo demanda).",
    category: "identity",
    scope: "global",
    tier: "L0_core",
    pinned: true,
    tokenEstimate:
      profileSummaryParts.length > 0
        ? estimateTokensFromText(profileSummaryParts.join(" "))
        : 10,
    x: GRAPH_CENTER_X,
    y: GRAPH_CENTER_Y,
    radius: HUB_RADIUS,
  };

  const nodes: MemoryGraphNode[] = [hubNode];
  const edges: MemoryGraphEdge[] = [];
  const positionedLeaves: MemoryGraphNode[] = [];
  const categoriesSummary: Array<{
    id: string;
    label: string;
    count: number;
    tokenEstimate: number;
  }> = [];

  // Metadatos de relajación por nodo y arista
  const categoryAnchorById = new Map<string, { angle: number; targetRadius: number }>();
  const leafTargetDistById = new Map<string, number>();
  const leafParentCatId = new Map<string, string>();

  // Distribuir sectores angulares proporcionalmente al número de hojas de cada categoría
  // con radios iniciales variados (105..155) y jitter angular orgánico tipo Obsidian.
  const catCount = Math.max(1, activeCategories.length);
  const minSectorPerCat = Math.min(0.45, (2 * Math.PI) / (catCount * 1.6));
  const remainingArc = Math.max(0, 2 * Math.PI - catCount * minSectorPerCat);
  const totalLeafCount = Math.max(
    1,
    activeCategories.reduce((sum, cat) => sum + (leavesByCategory.get(cat)?.length ?? 0), 0)
  );
  const sectorSpans = activeCategories.map((cat) => {
    const count = leavesByCategory.get(cat)?.length ?? 0;
    return minSectorPerCat + (count / totalLeafCount) * remainingArc;
  });

  let cursorAngle =
    activeCategories.length > 0 ? -Math.PI / 2 - sectorSpans[0] / 2 : -Math.PI / 2;

  activeCategories.forEach((cat, catIdx) => {
    const catLeaves = leavesByCategory.get(cat) ?? [];
    const sectorSpan = sectorSpans[catIdx] ?? (2 * Math.PI) / catCount;
    const catNodeId = `cat_${cat}`;
    const catHash = fnv1aHash(catNodeId);
    const angleJitter =
      (((catHash % 1000) / 1000) - 0.5) * Math.min(0.16, sectorSpan * 0.2);
    const baseAngle = cursorAngle + sectorSpan / 2 + angleJitter;
    cursorAngle += sectorSpan;

    // Radio orgánico variado en [106, 154] combinando serie áurea y hash determinista
    const goldenStep = (catIdx * 0.61803398875 + ((catHash >>> 7) % 1000) / 3500) % 1;
    const catTargetRadius = 106 + goldenStep * 48;

    const catX = GRAPH_CENTER_X + catTargetRadius * Math.cos(baseAngle);
    const catY = GRAPH_CENTER_Y + catTargetRadius * Math.sin(baseAngle);

    categoryAnchorById.set(catNodeId, {
      angle: baseAngle,
      targetRadius: catTargetRadius,
    });

    const catTokenSum = catLeaves.reduce((sum, item) => sum + item.tokenEstimate, 0);
    const hasL0 = catLeaves.some((item) => item.tier === "L0_core");
    const hasL1 = catLeaves.some((item) => item.tier === "L1_contextual");
    const catTier: MemoryTier = hasL0 ? "L0_core" : hasL1 ? "L1_contextual" : "L2_ondemand";
    const catScope: "global" | "workspace" =
      cat === "workspace" || cat === "pattern" || catLeaves.every((l) => l.scope === "workspace")
        ? "workspace"
        : "global";

    const catLabel = CATEGORY_LABELS[cat];

    nodes.push({
      id: catNodeId,
      kind: "category",
      label: catLabel,
      detail: `${catLabel}: ${catLeaves.length} ${catLeaves.length === 1 ? "nodo" : "nodos"} (~${catTokenSum} tokens)`,
      category: cat,
      scope: catScope,
      tier: catTier,
      pinned: hasL0,
      tokenEstimate: catTokenSum,
      x: catX,
      y: catY,
      radius: CATEGORY_NODE_RADIUS,
    });

    const hubEdgeId = `edge_hub_${catNodeId}`;
    edges.push({
      id: hubEdgeId,
      source: hubNode.id,
      target: catNodeId,
      kind: "hierarchy",
      weight: catTier === "L0_core" ? 1 : catTier === "L1_contextual" ? 0.85 : 0.55,
      curveSeed: computeEdgeCurveSeed(hubEdgeId),
    });

    categoriesSummary.push({
      id: cat,
      label: catLabel,
      count: catLeaves.length,
      tokenEstimate: catTokenSum,
    });

    // Posicionamiento inicial orgánico de hojas alrededor de su categoría padre
    const leafCount = catLeaves.length;
    const usableArc =
      catCount === 1
        ? Math.min(Math.PI * 1.75, Math.max(0.5, (leafCount - 1) * 0.52))
        : Math.max(0.28, sectorSpan * 0.92);
    const spread =
      leafCount <= 1 ? 0 : Math.min(usableArc, (leafCount - 1) * 0.46);

    catLeaves.forEach((leaf, leafIdx) => {
      const leafHash = fnv1aHash(leaf.id);
      const jitterAngle = (((leafHash % 1000) / 1000) - 0.5) * 0.11;
      const angleOffset =
        leafCount <= 1
          ? (((leafHash % 1000) / 1000) - 0.5) * 0.25
          : (leafIdx / (leafCount - 1) - 0.5) * spread + jitterAngle;
      const leafAngle = baseAngle + angleOffset;

      const radialPhase =
        (leafIdx * 0.61803398875 + ((leafHash >>> 9) % 1000) / 2500) % 1;
      const targetBranchLen = 75 + radialPhase * 30;
      const ringLayerOffset = Math.min(28, Math.floor(leafIdx / 3) * 12);
      const initialCenterRadius = catTargetRadius + targetBranchLen * 0.92 + ringLayerOffset;

      const polarX = GRAPH_CENTER_X + initialCenterRadius * Math.cos(leafAngle);
      const polarY = GRAPH_CENTER_Y + initialCenterRadius * Math.sin(leafAngle);
      const branchX = catX + (targetBranchLen + ringLayerOffset) * Math.cos(leafAngle);
      const branchY = catY + (targetBranchLen + ringLayerOffset) * Math.sin(leafAngle);
      const lx = polarX * 0.65 + branchX * 0.35;
      const ly = polarY * 0.65 + branchY * 0.35;

      const positioned: MemoryGraphNode = {
        ...leaf,
        x: lx,
        y: ly,
      };
      nodes.push(positioned);
      positionedLeaves.push(positioned);
      leafTargetDistById.set(positioned.id, targetBranchLen);
      leafParentCatId.set(positioned.id, catNodeId);

      const leafEdgeId = `edge_${catNodeId}_${positioned.id}`;
      edges.push({
        id: leafEdgeId,
        source: catNodeId,
        target: positioned.id,
        kind: "hierarchy",
        weight:
          positioned.tier === "L0_core"
            ? 1
            : positioned.tier === "L1_contextual"
              ? 0.9
              : 0.6,
        curveSeed: computeEdgeCurveSeed(leafEdgeId),
      });
    });
  });

  // Enlaces semánticos transversales filtrados y acotados (máx. 2 por hoja, máx. 14 en total)
  const leafTokens = new Map<string, string[]>();
  for (const leaf of positionedLeaves) {
    const meaningfulKey =
      leaf.factKey && !SYNTHETIC_FACT_KEY_RE.test(leaf.factKey) ? leaf.factKey : "";
    const tokens = extractSemanticKeywords(`${meaningfulKey} ${leaf.detail}`);
    leafTokens.set(leaf.id, tokens);
  }

  const candidateSemanticEdges: Array<
    MemoryGraphEdge & { crossCategory: boolean; sharedCount: number }
  > = [];
  for (let i = 0; i < positionedLeaves.length; i += 1) {
    const leafA = positionedLeaves[i];
    const tokensA = leafTokens.get(leafA.id) ?? [];
    if (tokensA.length === 0) continue;

    for (let j = i + 1; j < positionedLeaves.length; j += 1) {
      const leafB = positionedLeaves[j];
      const tokensB = leafTokens.get(leafB.id) ?? [];
      if (tokensB.length === 0) continue;

      const sharedSet = new Set<string>();
      for (const tokA of tokensA) {
        for (const tokB of tokensB) {
          if (
            tokA === tokB ||
            (tokA.length >= 5 && tokB.length >= 5 && tokA.slice(0, 5) === tokB.slice(0, 5))
          ) {
            sharedSet.add(tokA.length <= tokB.length ? tokA : tokB);
            break;
          }
        }
      }

      if (sharedSet.size > 0) {
        const shared = Array.from(sharedSet).sort(
          (a, b) => b.length - a.length || a.localeCompare(b)
        );
        const crossCategory = leafA.category !== leafB.category;
        const weight = roundWeight(
          Math.min(1, 0.45 + shared.length * 0.2 + (crossCategory ? 0.15 : 0))
        );
        const semEdgeId = `edge_sem_${leafA.id}_${leafB.id}`;
        candidateSemanticEdges.push({
          id: semEdgeId,
          source: leafA.id,
          target: leafB.id,
          kind: "semantic",
          weight,
          label: shared[0],
          curveSeed: computeEdgeCurveSeed(semEdgeId),
          crossCategory,
          sharedCount: shared.length,
        });
      }
    }
  }

  candidateSemanticEdges.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
    if (a.crossCategory !== b.crossCategory) return a.crossCategory ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const semanticEdges: MemoryGraphEdge[] = [];
  const semanticDegree = new Map<string, number>();
  let selectedSemanticCount = 0;
  for (const semEdge of candidateSemanticEdges) {
    if (selectedSemanticCount >= MAX_SEMANTIC_EDGES_TOTAL) break;
    const degA = semanticDegree.get(semEdge.source) ?? 0;
    const degB = semanticDegree.get(semEdge.target) ?? 0;
    if (degA >= MAX_SEMANTIC_EDGES_PER_LEAF || degB >= MAX_SEMANTIC_EDGES_PER_LEAF) {
      continue;
    }
    semanticDegree.set(semEdge.source, degA + 1);
    semanticDegree.set(semEdge.target, degB + 1);
    selectedSemanticCount += 1;
    const finalSemEdge: MemoryGraphEdge = {
      id: semEdge.id,
      source: semEdge.source,
      target: semEdge.target,
      kind: "semantic",
      weight: semEdge.weight,
      label: semEdge.label,
      curveSeed: semEdge.curveSeed,
    };
    semanticEdges.push(finalSemEdge);
    edges.push(finalSemEdge);
  }

  // Semilla de afinidad semántica inicial: acerca ligeramente hojas enlazadas semánticamente
  if (nodes.length > 2) {
    const nodeById = new Map<string, MemoryGraphNode>();
    for (const node of nodes) {
      nodeById.set(node.id, node);
    }

    for (const semEdge of semanticEdges) {
      const nodeA = nodeById.get(semEdge.source);
      const nodeB = nodeById.get(semEdge.target);
      if (!nodeA || !nodeB) continue;
      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      const pull = 0.07 * semEdge.weight;
      nodeA.x += dx * pull;
      nodeA.y += dy * pull;
      nodeB.x -= dx * pull;
      nodeB.y -= dy * pull;
    }

    // Relajación determinista por fuerzas de 45 iteraciones estilo Obsidian Graph View
    const nCount = nodes.length;
    const fx = new Float64Array(nCount);
    const fy = new Float64Array(nCount);
    const nodeIdxById = new Map<string, number>();
    for (let i = 0; i < nCount; i += 1) {
      nodeIdxById.set(nodes[i].id, i);
    }

    for (let iter = 0; iter < FORCE_RELAXATION_ITERATIONS; iter += 1) {
      fx.fill(0);
      fy.fill(0);
      const alpha = 1 - (iter / FORCE_RELAXATION_ITERATIONS) * 0.55;

      // 1. Repulsión nodo-nodo (Coulomb + separación mínima para que etiquetas no colisionen)
      for (let i = 0; i < nCount; i += 1) {
        const nodeA = nodes[i];
        for (let j = i + 1; j < nCount; j += 1) {
          const nodeB = nodes[j];
          let dx = nodeB.x - nodeA.x;
          let dy = nodeB.y - nodeA.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 0.01) {
            const symAngle = ((i * 31 + j * 17) % 360) * (Math.PI / 180);
            dx = Math.cos(symAngle) * 0.5;
            dy = Math.sin(symAngle) * 0.5;
            distSq = 0.25;
          }
          const dist = Math.sqrt(distSq);
          const ux = dx / dist;
          const uy = dy / dist;

          let minSep = MIN_NODE_SEPARATION_PX;
          if (nodeA.kind === "hub" || nodeB.kind === "hub") {
            const other = nodeA.kind === "hub" ? nodeB : nodeA;
            minSep = other.kind === "category" ? 98 : 138;
          } else if (nodeA.kind === "category" && nodeB.kind === "category") {
            minSep = 86;
          } else if (nodeA.kind === "category" || nodeB.kind === "category") {
            minSep = 64;
          } else {
            minSep = 54;
          }

          let repel = 0;
          if (dist < 230) {
            repel += 380 / Math.max(36, distSq);
          }
          if (dist < minSep) {
            repel += (minSep - dist) * 0.42;
          }

          if (repel > 0) {
            const rx = ux * repel;
            const ry = uy * repel;
            if (i !== 0) {
              fx[i] -= rx;
              fy[i] -= ry;
            }
            if (j !== 0) {
              fx[j] += rx;
              fy[j] += ry;
            }
          }
        }
      }

      // 2. Atracción de resortes por aristas jerárquicas y semánticas
      for (const edge of edges) {
        const idxA = nodeIdxById.get(edge.source);
        const idxB = nodeIdxById.get(edge.target);
        if (idxA === undefined || idxB === undefined) continue;
        const nodeA = nodes[idxA];
        const nodeB = nodes[idxB];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const dist = Math.max(0.1, Math.hypot(dx, dy));
        const ux = dx / dist;
        const uy = dy / dist;

        if (edge.kind === "hierarchy") {
          if (nodeA.kind === "hub" && nodeB.kind === "category") {
            const anchor = categoryAnchorById.get(nodeB.id);
            const targetLen = anchor ? anchor.targetRadius : 128;
            const spring = (dist - targetLen) * 0.16;
            fx[idxB] -= ux * spring;
            fy[idxB] -= uy * spring;

            if (anchor) {
              const targetX = GRAPH_CENTER_X + targetLen * Math.cos(anchor.angle);
              const targetY = GRAPH_CENTER_Y + targetLen * Math.sin(anchor.angle);
              fx[idxB] += (targetX - nodeB.x) * 0.08;
              fy[idxB] += (targetY - nodeB.y) * 0.08;
            }
          } else {
            const targetLen = leafTargetDistById.get(nodeB.id) ?? 88;
            const spring = (dist - targetLen) * 0.14;
            const pullX = ux * spring;
            const pullY = uy * spring;
            if (idxA !== 0) {
              fx[idxA] += pullX * 0.25;
              fy[idxA] += pullY * 0.25;
            }
            if (idxB !== 0) {
              fx[idxB] -= pullX * 0.75;
              fy[idxB] -= pullY * 0.75;
            }
          }
        } else {
          // Enlace semántico transversal (~145px longitud objetivo suave)
          const targetLen = 145;
          if (dist > targetLen * 0.75) {
            const spring = (dist - targetLen) * 0.036 * edge.weight;
            const pullX = ux * spring;
            const pullY = uy * spring;
            if (idxA !== 0) {
              fx[idxA] += pullX;
              fy[idxA] += pullY;
            }
            if (idxB !== 0) {
              fx[idxB] -= pullX;
              fy[idxB] -= pullY;
            }
          }
        }
      }

      // 3. Preferencia radial exterior para hojas + gravedad suave de centrado hacia (400, 260)
      let centroidX = 0;
      let centroidY = 0;
      for (let i = 1; i < nCount; i += 1) {
        const node = nodes[i];
        centroidX += node.x;
        centroidY += node.y;

        const cdx = node.x - GRAPH_CENTER_X;
        const cdy = node.y - GRAPH_CENTER_Y;
        const cDist = Math.max(0.1, Math.hypot(cdx, cdy));

        // Gravedad suave de centrado hacia (400, 260)
        fx[i] -= cdx * 0.012;
        fy[i] -= cdy * 0.012;

        if (node.kind !== "category") {
          const parentCatId = leafParentCatId.get(node.id);
          const parentIdx = parentCatId ? nodeIdxById.get(parentCatId) : undefined;
          const parentDist =
            parentIdx !== undefined
              ? Math.hypot(
                  nodes[parentIdx].x - GRAPH_CENTER_X,
                  nodes[parentIdx].y - GRAPH_CENTER_Y
                )
              : 120;
          const minLeafCenterDist = Math.max(168, parentDist + 46);
          if (cDist < minLeafCenterDist) {
            const pushOut = (minLeafCenterDist - cDist) * 0.35;
            fx[i] += (cdx / cDist) * pushOut;
            fy[i] += (cdy / cDist) * pushOut;
          }
        }

        // Amortiguación elástica suave si se acerca a los bordes del lienzo base (800 x 520)
        if (Math.abs(cdx) > 335) {
          fx[i] -= (cdx - Math.sign(cdx) * 335) * 0.18;
        }
        if (Math.abs(cdy) > 218) {
          fy[i] -= (cdy - Math.sign(cdy) * 218) * 0.18;
        }
      }

      if (nCount > 1) {
        const avgOffsetX = centroidX / (nCount - 1) - GRAPH_CENTER_X;
        const avgOffsetY = centroidY / (nCount - 1) - GRAPH_CENTER_Y;
        const maxStep = 13 * alpha;
        for (let i = 1; i < nCount; i += 1) {
          let stepX = (fx[i] - avgOffsetX * 0.03) * alpha;
          let stepY = (fy[i] - avgOffsetY * 0.03) * alpha;
          const stepMag = Math.hypot(stepX, stepY);
          if (stepMag > maxStep) {
            stepX = (stepX / stepMag) * maxStep;
            stepY = (stepY / stepMag) * maxStep;
          }
          nodes[i].x += stepX;
          nodes[i].y += stepY;
        }
      }
    }

    // Pase final de garantía de distancia mínima entre pares (~52px) para evitar solapamientos
    for (let pass = 0; pass < 5; pass += 1) {
      for (let i = 0; i < nCount; i += 1) {
        const nodeA = nodes[i];
        for (let j = i + 1; j < nCount; j += 1) {
          const nodeB = nodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.max(0.01, Math.hypot(dx, dy));
          const requiredSep =
            nodeA.kind === "hub" || nodeB.kind === "hub" ? 95 : MIN_NODE_SEPARATION_PX;
          if (dist < requiredSep) {
            const push = (requiredSep - dist) * 0.52;
            const ux = dx / dist;
            const uy = dy / dist;
            if (i === 0) {
              nodeB.x += ux * push * 2;
              nodeB.y += uy * push * 2;
            } else {
              nodeA.x -= ux * push;
              nodeA.y -= uy * push;
              nodeB.x += ux * push;
              nodeB.y += uy * push;
            }
          }
        }
      }
      for (let i = 1; i < nCount; i += 1) {
        const node = nodes[i];
        if (node.kind === "category") continue;
        const cdx = node.x - GRAPH_CENTER_X;
        const cdy = node.y - GRAPH_CENTER_Y;
        const cDist = Math.max(0.01, Math.hypot(cdx, cdy));
        if (cDist < 162) {
          const pushOut = 162 - cDist;
          node.x += (cdx / cDist) * pushOut;
          node.y += (cdy / cDist) * pushOut;
        }
      }
    }
  }

  // Redondeo final determinista a 1 decimal (Math.round(v * 10) / 10)
  hubNode.x = GRAPH_CENTER_X;
  hubNode.y = GRAPH_CENTER_Y;
  for (let i = 1; i < nodes.length; i += 1) {
    nodes[i].x = roundCoord(nodes[i].x);
    nodes[i].y = roundCoord(nodes[i].y);
  }

  // Estadísticas integradas de presupuesto de tokens sobre todos los nodos hoja de memoria
  let l0Count = 0;
  let l1Count = 0;
  let l2Count = 0;
  let l0Tokens = 0;
  let l1Tokens = 0;
  let l2SavedTokens = 0;
  const l2Cats = new Set<string>();

  for (const leaf of positionedLeaves) {
    if (leaf.tier === "L0_core") {
      l0Count += 1;
      l0Tokens += leaf.tokenEstimate;
    } else if (leaf.tier === "L1_contextual") {
      l1Count += 1;
      l1Tokens += leaf.tokenEstimate;
    } else {
      l2Count += 1;
      l2SavedTokens += leaf.tokenEstimate;
      l2Cats.add(leaf.category);
    }
  }

  const combinedL2IndexLine =
    l2Count > 0
      ? `[Índice memoria L2 (${l2Count} hechos en ${Array.from(l2Cats).join(", ")}): usa memory_search si los necesitas]`
      : "";

  const stats = buildTokenBudgetStats({
    l0Tokens,
    l1Tokens,
    l2SavedTokens,
    l0Count,
    l1Count,
    l2Count,
    l2IndexLine: combinedL2IndexLine,
  });

  return {
    nodes,
    edges,
    stats,
    categories: categoriesSummary,
  };
}
