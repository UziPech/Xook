/**
 * Contratos compartidos para la persistencia durable y multi-ventana de datos del usuario.
 *
 * Mantiene separación estricta entre:
 * - Identidad y hechos durables del usuario (`global` o `workspace`), sincronizados pasivamente.
 * - Flujo efímero o conversación activa de cada ventana (`main`, `quick`, `document`).
 */

export const WINDOW_FLOW_SCOPES = ["main", "quick", "document", "settings"] as const;
export type WindowFlowScope = (typeof WINDOW_FLOW_SCOPES)[number];

export const USER_MEMORY_SCOPES = ["global", "workspace"] as const;
export type UserMemoryScope = (typeof USER_MEMORY_SCOPES)[number];

export const USER_MEMORY_CATEGORIES = [
  "identity",
  "preference",
  "work",
  "contact",
  "routine",
  "project",
  "other",
] as const;
export type UserMemoryCategory = (typeof USER_MEMORY_CATEGORIES)[number];

export interface UserProfileRecord {
  id: string;
  name: string;
  storeName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  preferredName?: string;
  occupation?: string;
  workContext?: string;
  language?: string;
  timezone?: string;
  notes?: string;
}

export interface SaveUserProfileInput {
  name: string;
  storeName?: string;
  role?: string;
  preferredName?: string;
  occupation?: string;
  workContext?: string;
  language?: string;
  timezone?: string;
  notes?: string;
}

export interface UserMemoryFact {
  id: string;
  key: string;
  category: UserMemoryCategory;
  value: string;
  scope: UserMemoryScope;
  sourceWindow: WindowFlowScope;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDataSyncEvent {
  kind: "profile" | "memory";
  sourceWindow?: WindowFlowScope;
  updatedAt: string;
  factCount?: number;
}

export const MAX_USER_MEMORY_VALUE_CHARS = 400;
export const DEFAULT_MAX_USER_MEMORY_FACTS = 120;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN\s+[A-Z0-9 ]*PRIVATE KEY-----/i,
  /\bsk-or-v1-[A-Za-z0-9_-]{12,}\b/,
  /\bsk-(?:ant|proj|live|test|svcacct)-[A-Za-z0-9_-]{12,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgsk_[0-9A-Za-z]{20,}\b/,
  /\bxox[bpars]-[0-9A-Za-z-]{12,}\b/,
  /\bbearer\s+[A-Za-z0-9._-]{20,}\b/i,
];

export function isWindowFlowScope(raw: unknown): raw is WindowFlowScope {
  return typeof raw === "string" && (WINDOW_FLOW_SCOPES as readonly string[]).includes(raw);
}

export function normalizeUserMemoryCategory(raw: unknown): UserMemoryCategory {
  if (typeof raw !== "string") return "other";
  const clean = raw.trim().toLowerCase();
  if ((USER_MEMORY_CATEGORIES as readonly string[]).includes(clean)) {
    return clean as UserMemoryCategory;
  }
  if (clean === "identidad" || clean === "perfil" || clean === "nombre") return "identity";
  if (clean === "preferencia" || clean === "preferencias" || clean === "estilo") return "preference";
  if (clean === "trabajo" || clean === "rol" || clean === "oficio" || clean === "negocio") return "work";
  if (clean === "contacto" || clean === "equipo" || clean === "persona") return "contact";
  if (clean === "rutina" || clean === "horario" || clean === "agenda") return "routine";
  if (clean === "proyecto" || clean === "meta") return "project";
  return "other";
}

export function normalizeUserMemoryScope(raw: unknown): UserMemoryScope {
  return typeof raw === "string" && raw.trim().toLowerCase() === "workspace"
    ? "workspace"
    : "global";
}

export function normalizeWindowFlowScope(raw: unknown): WindowFlowScope {
  if (typeof raw !== "string") return "main";
  const clean = raw.trim().toLowerCase();
  return isWindowFlowScope(clean) ? clean : "main";
}

function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMemoryKey(
  rawKey: string | undefined,
  category: string,
  value: string
): string {
  const candidate = (rawKey ?? "").trim();
  const base = candidate || `${category || "other"}_${value.slice(0, 48)}`;
  const slug = stripDiacritics(base)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 64)
    .replace(/[_-]+$/g, "");
  return slug || `${normalizeUserMemoryCategory(category)}_item`;
}

export function containsSecretMaterial(text: string): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export function sanitizeUserFactValue(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const collapsed = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) {
    return { ok: false, error: "El dato a recordar no puede estar vacío." };
  }
  if (containsSecretMaterial(collapsed)) {
    return {
      ok: false,
      error: "Por seguridad, no se guardan claves API, tokens ni llaves privadas en memoria del usuario.",
    };
  }
  const clipped =
    collapsed.length > MAX_USER_MEMORY_VALUE_CHARS
      ? collapsed.slice(0, MAX_USER_MEMORY_VALUE_CHARS).trim()
      : collapsed;
  return { ok: true, value: clipped };
}

function stableFactId(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `umem_${(hash >>> 0).toString(16)}`;
}

export function upsertUserMemoryFacts(
  existing: UserMemoryFact[],
  incoming: Omit<UserMemoryFact, "id" | "createdAt" | "updatedAt"> & { id?: string },
  nowIso: string,
  maxItems = DEFAULT_MAX_USER_MEMORY_FACTS
): { saved: UserMemoryFact; facts: UserMemoryFact[] } {
  const cleanCheck = sanitizeUserFactValue(incoming.value);
  if (!cleanCheck.ok) {
    throw new Error(cleanCheck.error);
  }

  const category = normalizeUserMemoryCategory(incoming.category);
  const scope = normalizeUserMemoryScope(incoming.scope);
  const sourceWindow = normalizeWindowFlowScope(incoming.sourceWindow);
  const normKey = normalizeMemoryKey(incoming.key, category, cleanCheck.value);
  const normValue = cleanCheck.value.toLowerCase();

  const keyMatchIdx = existing.findIndex((item) => item.key.trim().toLowerCase() === normKey);
  const valMatchIdx =
    keyMatchIdx >= 0
      ? keyMatchIdx
      : existing.findIndex(
          (item) => item.value.replace(/\s+/g, " ").trim().toLowerCase() === normValue
        );

  const matchIdx = valMatchIdx;
  const existingItem = matchIdx >= 0 ? existing[matchIdx] : null;
  const matchedByValueOnly = keyMatchIdx < 0 && valMatchIdx >= 0;
  const saved: UserMemoryFact = {
    id: existingItem?.id || incoming.id || stableFactId(normKey),
    key:
      existingItem?.key && (matchedByValueOnly || !incoming.key?.trim())
        ? existingItem.key
        : normKey,
    category,
    value: cleanCheck.value,
    scope,
    sourceWindow,
    pinned: Boolean(incoming.pinned || existingItem?.pinned),
    createdAt: existingItem?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const remaining = existing.filter((_, idx) => idx !== matchIdx);
  const combined = [saved, ...remaining];

  const cap = Math.max(1, maxItems);
  if (combined.length <= cap) {
    return { saved, facts: combined };
  }

  // Al recortar al tope, conserva los `pinned` más recientes sin exceder `cap`.
  const pinnedCount = combined.filter((item) => item.pinned).length;
  let unpinnedBudget = Math.max(0, cap - pinnedCount);
  const finalFacts: UserMemoryFact[] = [];
  for (const item of combined) {
    if (item.pinned) {
      if (finalFacts.length < cap) {
        finalFacts.push(item);
      }
    } else if (unpinnedBudget > 0) {
      unpinnedBudget -= 1;
      finalFacts.push(item);
    }
  }
  return { saved, facts: finalFacts };
}

export function formatUserMemoryForPrompt(
  facts: UserMemoryFact[],
  maxChars = 1800
): string {
  if (!Array.isArray(facts) || facts.length === 0 || maxChars <= 0) {
    return "";
  }
  const ordered = [...facts].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  const lines: string[] = [];
  let used = 0;
  for (const item of ordered) {
    const val = String(item.value || "").replace(/\s+/g, " ").trim();
    if (!val || containsSecretMaterial(val)) continue;
    const cat = normalizeUserMemoryCategory(item.category);
    const key = String(item.key || "").trim();
    const line = key ? `- [${cat}] (${key}): ${val}` : `- [${cat}] ${val}`;
    const addLen = line.length + (lines.length > 0 ? 1 : 0);
    if (used + addLen > maxChars) {
      break;
    }
    lines.push(line);
    used += addLen;
  }
  return lines.join("\n");
}
