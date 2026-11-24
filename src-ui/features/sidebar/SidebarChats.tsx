import { useMemo, useState } from "react";
import { ChevronRight, Search, Trash2 } from "lucide-react";
import type { ConversationThread } from "../workspace-store/localStore";
import { FolderIcon, ICON_ANIMATE_ALWAYS, ICON_ANIMATE_ON_HOVER, XkIcon } from "../../components/icons";

interface SidebarChatsProps {
  conversations: ConversationThread[];
  activeConversationId: string;
  isStreaming: boolean;
  projectName: string | null;
  /** Solo cuando la conversación se está llenando: invita a resumirla. */
  showLongConversationNotice: boolean;
  isCompacting: boolean;
  onNewChat: () => void;
  onSelectConversation: (thread: ConversationThread) => void;
  onDeleteConversation: (id: string) => void;
  onOpenProject: () => void;
  onCompact: () => void;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function formatThreadDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

/** Lateral con los chats primero: nuevo chat, buscador, proyecto y conversaciones recientes. */
export function SidebarChats({
  conversations,
  activeConversationId,
  isStreaming,
  projectName,
  showLongConversationNotice,
  isCompacting,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onOpenProject,
  onCompact,
}: SidebarChatsProps) {
  const [query, setQuery] = useState("");
  const visibleThreads = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return conversations;
    return conversations.filter((thread) =>
      normalize(`${thread.title} ${thread.messages.map((m) => m.content).join(" ")}`).includes(needle)
    );
  }, [conversations, query]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-2.5 pt-2.5 space-y-2 shrink-0">
        <button
          type="button"
          onClick={onNewChat}
          disabled={isStreaming}
          className={`${ICON_ANIMATE_ON_HOVER} w-full h-10 flex items-center gap-2.5 px-3 rounded-[10px] border border-white/[0.1] bg-white/[0.06] hover:bg-white/[0.1] text-[13px] font-medium text-zinc-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-white/60`}
        >
          <XkIcon name="new-chat" size={18} />
          <span>Nuevo chat</span>
        </button>
        <div className="relative">
          <label htmlFor="xook-sidebar-search" className="sr-only">
            Buscar conversaciones
          </label>
          <Search
            className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="xook-sidebar-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conversaciones"
            className="w-full h-9 pl-8 pr-3 rounded-[10px] border border-white/[0.07] bg-[#0b0c10] text-[12.5px] text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-white/[0.2]"
          />
        </div>
      </div>

      <div className="px-2.5 pt-4 shrink-0">
        <span className="px-1 text-[11px] font-medium text-zinc-400">Proyecto</span>
        <button
          type="button"
          onClick={onOpenProject}
          title="Abrir los ajustes del proyecto"
          className="mt-1.5 w-full h-10 flex items-center gap-2.5 px-3 rounded-[10px] border border-white/[0.07] bg-[#0b0c10] hover:bg-white/[0.05] text-left transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <FolderIcon size={18} tone="blue" hasContent />
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-zinc-100">
            {projectName ?? "Sin proyecto"}
          </span>
          <span className="text-[11px] text-zinc-400 shrink-0">Ajustes</span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
        </button>
      </div>

      <div className="px-2.5 pt-4 pb-2 flex-1 min-h-0 flex flex-col">
        <span className="px-1 text-[11px] font-medium text-zinc-400 shrink-0">Recientes</span>
        <div className="mt-1.5 flex-1 min-h-0 overflow-y-auto space-y-0.5">
          {conversations.length === 0 ? (
            <p className="px-3 py-6 text-[12px] leading-relaxed text-zinc-400">
              Tus conversaciones con Xox se guardan aquí. Escribe la primera abajo.
            </p>
          ) : visibleThreads.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-zinc-400">Ninguna conversación coincide.</p>
          ) : (
            visibleThreads.map((thread) => {
              const isActive = thread.id === activeConversationId;
              return (
                <div
                  key={thread.id}
                  className={`group flex items-center rounded-[10px] transition-colors ${
                    isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(thread)}
                    title={thread.title}
                    aria-current={isActive ? "true" : undefined}
                    className="flex-1 min-w-0 h-9 flex items-center gap-2 pl-3 pr-1 text-left cursor-pointer rounded-[10px] focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    <span
                      className={`flex-1 min-w-0 truncate text-[12.5px] ${
                        isActive ? "text-white font-medium" : "text-zinc-300"
                      }`}
                    >
                      {thread.title}
                    </span>
                    <span className="text-[10.5px] text-zinc-400 shrink-0">
                      {formatThreadDate(thread.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(thread.id)}
                    disabled={isStreaming}
                    aria-label={`Eliminar «${thread.title}»`}
                    title="Eliminar conversación"
                    className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 w-8 h-8 mr-0.5 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06] cursor-pointer disabled:opacity-30 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showLongConversationNotice && (
        <div className={`${ICON_ANIMATE_ALWAYS} mx-2.5 mb-2.5 p-3 rounded-xl border border-[#2a2b31] bg-[#16171c] flex gap-2.5 items-start shrink-0`}>
          <XkIcon name="compact" size={18} className="text-zinc-200 shrink-0 mt-0.5" />
          <div className="min-w-0 flex flex-col gap-2">
            <p className="text-[12px] leading-relaxed text-zinc-100">
              Esta conversación ya es larga. Resúmela para que Xox no olvide lo importante.
            </p>
            <button
              type="button"
              onClick={onCompact}
              disabled={isCompacting || isStreaming}
              className="self-start h-7 px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11.5px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCompacting ? "Resumiendo…" : "Resumir y seguir"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
