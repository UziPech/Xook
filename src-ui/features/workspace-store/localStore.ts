import type { UiChatMessage } from "../ai-service/ChatMessageList";

export interface LocalUserProfile {
  id: string;
  name: string;
  storeName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveLocalUserInput {
  name: string;
  storeName?: string;
  role?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userId?: string | null;
  messages: UiChatMessage[];
}

const LOCAL_USER_KEY = "xook.local_user.v1";
const LOCAL_CONVERSATIONS_KEY = "xook.conversations.v1";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function deriveConversationTitle(messages: UiChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim().length > 0);
  if (!firstUser) return "Nueva conversación";
  const cleaned = firstUser.content.replace(/\s+/g, " ").trim();
  if (/^(hola|buenas|buenos d[ií]as|buenas tardes|hey|hi|que tal|qu[eé] pedo)/i.test(cleaned) && cleaned.length < 28) {
    return "Saludo Inicial";
  }
  return cleaned.length > 42 ? `${cleaned.slice(0, 40).trim()}…` : cleaned;
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
        },
      });
    } catch {
      // Fallback en modo navegador
    }
  }

  const existing = await getLocalUserProfile();
  const now = new Date().toISOString();
  const next: LocalUserProfile = {
    id: existing?.id ?? `usr_${Date.now()}`,
    name: input.name.trim(),
    storeName: input.storeName?.trim() || existing?.storeName || "Mi Tienda",
    role: input.role?.trim() || existing?.role || "Administrador",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(next));
  } catch {
    // Ignorar error de cuota
  }
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
  // Nunca persistimos banderas transitorias de streaming
  const sanitizedThread: ConversationThread = {
    ...thread,
    messages: thread.messages.map((m) => ({
      ...m,
      isStreaming: false,
      isReasoningStreaming: false,
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

