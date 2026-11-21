import {
  DEFAULT_MAX_USER_MEMORY_FACTS,
  normalizeMemoryKey,
  normalizeUserMemoryCategory,
  normalizeUserMemoryScope,
  normalizeWindowFlowScope,
  upsertUserMemoryFacts,
  type UserDataSyncEvent,
  type UserMemoryCategory,
  type UserMemoryFact,
  type UserMemoryScope,
  type WindowFlowScope,
} from "@xook/contracts";
import type { UiChatMessage } from "../ai-service/ChatMessageList";
import type { ContextCheckpoint } from "../ai-service/aiClient";

export type {
  UserDataSyncEvent,
  UserMemoryCategory,
  UserMemoryFact,
  UserMemoryScope,
  WindowFlowScope,
};

export interface LocalUserProfile {
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

export interface SaveLocalUserInput {
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

export interface SaveUserMemoryFactInput {
  value: string;
  key?: string;
  category?: UserMemoryCategory | string;
  scope?: UserMemoryScope;
  sourceWindow?: WindowFlowScope;
  pinned?: boolean;
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userId?: string | null;
  messages: UiChatMessage[];
  checkpoint?: ContextCheckpoint | null;
  compactedUpToMessageId?: string | null;
}

const LOCAL_USER_KEY = "xook.local_user.v1";
const LOCAL_USER_MEMORY_KEY = "xook.user_memory.v1";
const LOCAL_CONVERSATIONS_KEY = "xook.conversations.v1";

export const LOCAL_USER_UPDATED_EVENT = "xook-local-user-updated";
export const USER_MEMORY_UPDATED_EVENT = "xook-user-memory-updated";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function dispatchBrowserSyncEvent<T>(eventName: string, detail: T): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
  } catch {
    // Ignorar entorno sin CustomEvent
  }
}

export function deriveConversationTitle(messages: UiChatMessage[]): string {
  const firstUser = messages.find(
    (m) =>
      m.role === "user" &&
      (m.content.trim().length > 0 || (m.attachments && m.attachments.length > 0))
  );
  if (!firstUser) return "Nueva conversación";
  let source = firstUser.content.replace(/\s+/g, " ").trim();
  if (!source && firstUser.attachments?.length) {
    const pasted = firstUser.attachments.find((a) => a.kind === "pasted_text");
    if (pasted?.pastedContent) {
      source = pasted.pastedContent.replace(/\s+/g, " ").trim();
    } else if (pasted?.name) {
      source = pasted.name;
    } else {
      const firstAtt = firstUser.attachments[0];
      source = firstAtt.kind === "image" ? `Imagen · ${firstAtt.name}` : firstAtt.name;
    }
  }
  if (!source) return "Nueva conversación";
  if (/^(hola|buenas|buenos d[ií]as|buenas tardes|hey|hi|que tal|qu[eé] pedo)/i.test(source) && source.length < 28) {
    return "Saludo Inicial";
  }
  return source.length > 42 ? `${source.slice(0, 40).trim()}…` : source;
}

export async function getLocalUserProfile(): Promise<LocalUserProfile | null> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<LocalUserProfile | null>("get_local_user");
      if (res) return res;
    } catch {
      // Fallback a almacenamiento del navegador si falla
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? (JSON.parse(raw) as LocalUserProfile) : null;
  } catch {
    return null;
  }
}

export async function saveLocalUserProfile(input: SaveLocalUserInput): Promise<LocalUserProfile> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<LocalUserProfile>("save_local_user", {
        payload: {
          name: input.name,
          storeName: input.storeName,
          role: input.role,
          preferredName: input.preferredName,
          occupation: input.occupation,
          workContext: input.workContext,
          language: input.language,
          timezone: input.timezone,
          notes: input.notes,
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message) throw err;
      if (typeof err === "string" && err.trim()) throw new Error(err);
      // Fallback en modo navegador
    }
  }

  const existing = await getLocalUserProfile();
  const now = new Date().toISOString();
  const resolveOpt = (val: string | undefined, prev: string | undefined): string | undefined => {
    if (val === undefined) return prev;
    const trimmed = val.trim();
    return trimmed ? trimmed : undefined;
  };
  const next: LocalUserProfile = {
    id: existing?.id ?? `usr_${Date.now()}`,
    name: input.name.trim(),
    storeName: input.storeName?.trim() || existing?.storeName || "Mi Tienda",
    role: input.role?.trim() || existing?.role || "Administrador",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(resolveOpt(input.preferredName, existing?.preferredName)
      ? { preferredName: resolveOpt(input.preferredName, existing?.preferredName) }
      : {}),
    ...(resolveOpt(input.occupation, existing?.occupation)
      ? { occupation: resolveOpt(input.occupation, existing?.occupation) }
      : {}),
    ...(resolveOpt(input.workContext, existing?.workContext)
      ? { workContext: resolveOpt(input.workContext, existing?.workContext) }
      : {}),
    ...(resolveOpt(input.language, existing?.language)
      ? { language: resolveOpt(input.language, existing?.language) }
      : {}),
    ...(resolveOpt(input.timezone, existing?.timezone)
      ? { timezone: resolveOpt(input.timezone, existing?.timezone) }
      : {}),
    ...(resolveOpt(input.notes, existing?.notes)
      ? { notes: resolveOpt(input.notes, existing?.notes) }
      : {}),
  };
  try {
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(next));
  } catch {
    // Ignorar error de cuota
  }
  dispatchBrowserSyncEvent<LocalUserProfile | null>(LOCAL_USER_UPDATED_EVENT, next);
  return next;
}

export async function clearLocalUserProfile(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_local_user");
    } catch {
      // Continúa limpiando fallback
    }
  }
  try {
    localStorage.removeItem(LOCAL_USER_KEY);
  } catch {
    // Ignorar
  }
  if (!isTauriRuntime()) {
    dispatchBrowserSyncEvent<LocalUserProfile | null>(LOCAL_USER_UPDATED_EVENT, null);
  }
}

export async function listUserMemoryFacts(): Promise<UserMemoryFact[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<UserMemoryFact[]>("list_user_memory_facts");
      if (Array.isArray(res)) return res;
    } catch {
      // Fallback abajo
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_USER_MEMORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as UserMemoryFact[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveUserMemoryFact(input: SaveUserMemoryFactInput): Promise<UserMemoryFact[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<UserMemoryFact[]>("save_user_memory_fact", {
        payload: {
          value: input.value,
          key: input.key,
          category: input.category,
          scope: input.scope ?? "global",
          sourceWindow: input.sourceWindow ?? "main",
          pinned: Boolean(input.pinned),
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message) throw err;
      if (typeof err === "string" && err.trim()) throw new Error(err);
    }
  }

  const current = await listUserMemoryFacts();
  const category = normalizeUserMemoryCategory(input.category);
  const scope = normalizeUserMemoryScope(input.scope);
  const sourceWindow = normalizeWindowFlowScope(input.sourceWindow);
  const key = normalizeMemoryKey(input.key, category, input.value);
  const now = new Date().toISOString();
  const { facts } = upsertUserMemoryFacts(
    current,
    {
      key,
      category,
      value: input.value,
      scope,
      sourceWindow,
      pinned: Boolean(input.pinned),
    },
    now,
    DEFAULT_MAX_USER_MEMORY_FACTS
  );
  try {
    localStorage.setItem(LOCAL_USER_MEMORY_KEY, JSON.stringify(facts));
  } catch {
    // Ignorar error de cuota
  }
  dispatchBrowserSyncEvent<UserDataSyncEvent>(USER_MEMORY_UPDATED_EVENT, {
    kind: "memory",
    sourceWindow,
    updatedAt: now,
    factCount: facts.length,
  });
  return facts;
}

export async function deleteUserMemoryFact(
  idOrKey: string,
  sourceWindow: WindowFlowScope = "settings"
): Promise<UserMemoryFact[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<UserMemoryFact[]>("delete_user_memory_fact", {
        idOrKey,
        sourceWindow,
      });
    } catch {
      // Fallback abajo
    }
  }

  const target = idOrKey.trim();
  const targetLow = target.toLowerCase();
  const current = await listUserMemoryFacts();
  const next = current.filter(
    (item) => item.id !== target && item.key.trim().toLowerCase() !== targetLow
  );
  try {
    localStorage.setItem(LOCAL_USER_MEMORY_KEY, JSON.stringify(next));
  } catch {
    // Ignorar
  }
  dispatchBrowserSyncEvent<UserDataSyncEvent>(USER_MEMORY_UPDATED_EVENT, {
    kind: "memory",
    sourceWindow,
    updatedAt: new Date().toISOString(),
    factCount: next.length,
  });
  return next;
}

export async function subscribeLocalUserUpdated(
  handler: (profile: LocalUserProfile | null) => void
): Promise<() => void> {
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<LocalUserProfile | null>(LOCAL_USER_UPDATED_EVENT, (ev) => {
        handler(ev.payload ?? null);
      });
    } catch {
      // Fallback abajo
    }
  }
  if (typeof window === "undefined") return () => {};
  const listener = (ev: Event) => {
    const custom = ev as CustomEvent<LocalUserProfile | null>;
    handler(custom.detail ?? null);
  };
  window.addEventListener(LOCAL_USER_UPDATED_EVENT, listener);
  return () => window.removeEventListener(LOCAL_USER_UPDATED_EVENT, listener);
}

export async function subscribeUserMemoryUpdated(
  handler: (event: UserDataSyncEvent) => void
): Promise<() => void> {
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<UserDataSyncEvent>(USER_MEMORY_UPDATED_EVENT, (ev) => {
        if (ev.payload) handler(ev.payload);
      });
    } catch {
      // Fallback abajo
    }
  }
  if (typeof window === "undefined") return () => {};
  const listener = (ev: Event) => {
    const custom = ev as CustomEvent<UserDataSyncEvent>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(USER_MEMORY_UPDATED_EVENT, listener);
  return () => window.removeEventListener(USER_MEMORY_UPDATED_EVENT, listener);
}

export async function listLocalConversations(): Promise<ConversationThread[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<ConversationThread[]>("list_conversations");
      if (Array.isArray(res)) return res;
    } catch {
      // Fallback abajo
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_CONVERSATIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ConversationThread[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLocalConversation(thread: ConversationThread): Promise<ConversationThread[]> {
  // Nunca persistimos banderas transitorias de streaming ni blob/full-res URLs pesados
  const sanitizedThread: ConversationThread = {
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      isStreaming: false,
      isReasoningStreaming: false,
      ...(m.attachments && m.attachments.length > 0
        ? {
            attachments: m.attachments.map((att) => {
              const { fullPreviewUrl: _discardFull, ...rest } = att;
              const safePreview =
                rest.previewUrl && !rest.previewUrl.startsWith("blob:")
                  ? rest.previewUrl
                  : undefined;
              const safePasted =
                typeof rest.pastedContent === "string" && rest.pastedContent.length > 50_000
                  ? `${rest.pastedContent.slice(0, 50_000)}\n...[recortado al guardar]`
                  : rest.pastedContent;
              return {
                ...rest,
                ...(safePreview ? { previewUrl: safePreview } : { previewUrl: undefined }),
                ...(safePasted !== undefined ? { pastedContent: safePasted } : {}),
              };
            }),
          }
        : {}),
    })),
  };

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<ConversationThread[]>("save_conversation", {
        conversation: sanitizedThread,
      });
    } catch {
      // Fallback abajo
    }
  }

  const current = await listLocalConversations();
  const filtered = current.filter((c) => c.id !== sanitizedThread.id);
  const next = [sanitizedThread, ...filtered].slice(0, 100);
  try {
    localStorage.setItem(LOCAL_CONVERSATIONS_KEY, JSON.stringify(next));
  } catch {
    // Ignorar
  }
  return next;
}

export async function deleteLocalConversation(id: string): Promise<ConversationThread[]> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<ConversationThread[]>("delete_conversation", { id });
    } catch {
      // Fallback abajo
    }
  }

  const current = await listLocalConversations();
  const next = current.filter((c) => c.id !== id);
  try {
    localStorage.setItem(LOCAL_CONVERSATIONS_KEY, JSON.stringify(next));
  } catch {
    // Ignorar
  }
  return next;
}
