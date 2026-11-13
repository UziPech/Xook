import React, { useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { XoxStar, XoxState } from "../../components/XoxStar";
import {
  OpenRouterModelOption,
  ThinkingStep,
  formatModelDisplay,
} from "./aiClient";

export interface UiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  reasoningDurationMs?: number;
  thinkingSteps?: ThinkingStep[];
  isStreaming?: boolean;
  isReasoningStreaming?: boolean;
  feedback?: "up" | "down" | null;
  modelUsed?: string;
  latencyMs?: number;
  tokensUsed?: number;
  generatedTaskCount?: number;
  isError?: boolean;
  actionButton?: {
    label: string;
    kind: "open_settings" | "save_pending_key";
    cardId?: string;
  };
}

interface ChatMessageListProps {
  messages: UiChatMessage[];
  modelCatalog?: OpenRouterModelOption[];
  xoxState: XoxState;
  thinkingLabel: string;
  summonTrigger?: number;
  greeting?: string | null;
  greetingLeaving?: boolean;
  onXoxClick?: () => void;
  onAction: (action: NonNullable<UiChatMessage["actionButton"]>) => void;
  onOpenTasksTab: () => void;
  onRegenerateMessage?: (msg: UiChatMessage) => void;
  onRateMessage?: (msgId: string, rating: "up" | "down") => void;
}

function renderInlineFormatting(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-white/[0.06] text-sky-200 font-mono text-[12px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function FormattedReply({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const lines = text.split("\n");
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-zinc-200 select-text">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        const isLastLine = i === lines.length - 1;
        const caret = streaming && isLastLine ? (
          <span className="inline-block w-1.5 h-3.5 ml-1 align-middle bg-sky-300/80 animate-pulse rounded-xs" />
        ) : null;

        if (/^#{1,3}\s+/.test(trimmed)) {
          return (
            <h4 key={i} className="text-[14.5px] font-semibold text-white pt-1">
              {renderInlineFormatting(trimmed.replace(/^#{1,3}\s+/, ""))}
              {caret}
            </h4>
          );
        }
        if (/^[-•*]\s+/.test(trimmed)) {
          return (
            <div key={i} className="flex items-start gap-2.5 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-300/75 mt-2 shrink-0" />
              <span>
                {renderInlineFormatting(trimmed.replace(/^[-•*]\s+/, ""))}
                {caret}
              </span>
            </div>
          );
        }
        const numMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="text-sky-300/80 font-mono text-[12.5px] mt-0.5 shrink-0">
                {numMatch[1]}
              </span>
              <span>
                {renderInlineFormatting(numMatch[2])}
                {caret}
              </span>
            </div>
          );
        }
        return (
          <p key={i}>
            {renderInlineFormatting(trimmed)}
            {caret}
          </p>
        );
      })}
    </div>
  );
}

const STREAM_PHASE_LABEL: Partial<Record<XoxState, string>> = {
  reading: "Leyendo contexto…",
  talking: "Respondiendo…",
  syncing: "Organizando tareas…",
};

/** Mini silueta estática de la estrella Xox para turnos anteriores sin animación rAF. */
function XoxMiniGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-sky-200/85"
    >
      <path
        d="M12 2.5L14.4 8.6L20.8 9.2L15.9 13.4L17.4 19.7L12 16.3L6.6 19.7L8.1 13.4L3.2 9.2L9.6 8.6L12 2.5Z"
        fill="rgba(125,211,252,0.16)"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  modelCatalog = [],
  xoxState,
  thinkingLabel,
  summonTrigger,
  greeting,
  greetingLeaving = false,
  onXoxClick,
  onAction,
  onOpenTasksTab,
  onRegenerateMessage,
  onRateMessage,
}) => {
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Último turno de Xox: aquí vive el personaje guiando la conversación
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  const handleCopy = async (msg: UiChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === msg.id ? null : curr));
      }, 1800);
    } catch {
      // Ignorar si clipboard no está disponible
    }
  };

  return (
    <div className="@container space-y-6">
      {messages.map((msg, idx) => {
        if (msg.role === "user") {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[86%] @lg:max-w-[70%] rounded-2xl rounded-tr-sm px-4 py-2.5 bg-white/[0.075] border border-white/[0.1] text-[13.5px] text-zinc-100 leading-relaxed select-text">
                {msg.content}
              </div>
            </div>
          );
        }

        const isActiveGuideTurn = idx === lastAssistantIdx;
        const modelInfo = msg.modelUsed
          ? formatModelDisplay(msg.modelUsed, modelCatalog)
          : null;

        const hasThinking =
          Boolean(msg.reasoning?.trim()) ||
          Boolean(msg.thinkingSteps?.length) ||
          Boolean(msg.isReasoningStreaming);

        const isReadingNow =
          isActiveGuideTurn &&
          Boolean(msg.isStreaming) &&
          xoxState === "reading" &&
          !msg.content.trim() &&
          !msg.reasoning?.trim();

        const showThinkingRow = hasThinking && !isReadingNow;
        const isActivelyThinking = Boolean(
          msg.isStreaming && (!msg.content.trim() || msg.isReasoningStreaming)
        );
        const isThinkingOpen = expandedThinking[msg.id] ?? false;

        const durationSec =
          typeof msg.reasoningDurationMs === "number" && msg.reasoningDurationMs > 0
            ? (msg.reasoningDurationMs / 1000).toFixed(1)
            : null;

        const phaseLabel =
          isActiveGuideTurn && (msg.isStreaming || xoxState === "talking" || xoxState === "syncing")
            ? STREAM_PHASE_LABEL[xoxState] ||
              (xoxState === "thinking" ? null : thinkingLabel)
            : null;

        const cleanReasoning = (msg.reasoning ?? "")
          .replace(/<\/?(?:analisis|analysis|respuesta|response|acciones|actions)\s*>/gi, "")
          .trim();

        return (
          <div key={msg.id} className="flex items-start gap-2 @md:gap-3.5 @lg:gap-4">
            {/* Mascota Xox: carril izquierdo responsive y prominente, siempre visible */}
            <div className="shrink-0 self-start sticky top-3 w-[72px] @sm:w-[88px] @md:w-[104px] @lg:w-[120px] @2xl:w-[136px] flex justify-center">
              {isActiveGuideTurn ? (
                <div
                  className="relative -my-3 @md:-my-4 -mx-2 cursor-pointer select-none"
                  title="Haz clic para saludar a Xox"
                >
                  <XoxStar
                    state={xoxState}
                    responsive
                    className="w-[84px] h-[84px] @sm:w-[100px] @sm:h-[100px] @md:w-[116px] @md:h-[116px] @lg:w-[134px] @lg:h-[134px] @2xl:w-[152px] @2xl:h-[152px]"
                    summonTrigger={summonTrigger}
                    onClick={onXoxClick}
                  />
                  {greeting && (
                    <div
                      role="status"
                      aria-live="polite"
                      className={`xox-bubble absolute left-[72%] bottom-[70%] z-20 pointer-events-none ${
                        greetingLeaving ? "is-leaving" : ""
                      }`}
                    >
                      <div className="xox-bubble-body w-max max-w-[210px] px-3 py-1.5 rounded-[18px] text-left">
                        <p className="xox-bubble-text relative text-[11.5px] leading-snug text-white/95 font-medium">
                          {greeting}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-9 h-9 @md:w-10 @md:h-10 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mt-0.5">
                  <XoxMiniGlyph />
                </div>
              )}
            </div>

            {/* Contenido de la respuesta (estilo editorial limpio sin recuadro pesado) */}
            <div className="flex-1 min-w-0 max-w-3xl space-y-2">
              {/* Cabecera sutil del turno */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs @md:text-[13px] font-medium text-white">Xox</span>
                  {phaseLabel ? (
                    <span className="text-[11px] xox-shimmer inline-block font-medium truncate">
                      {phaseLabel}
                    </span>
                  ) : !msg.isStreaming && modelInfo ? (
                    <span
                      title={
                        [
                          msg.modelUsed,
                          typeof msg.latencyMs === "number" && msg.latencyMs > 0
                            ? `${(msg.latencyMs / 1000).toFixed(1)}s`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                      className="text-[11px] text-zinc-500 truncate"
                    >
                      {modelInfo.name}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Pensamiento minimalista colapsado por defecto: Thinking > (sin emojis ni iconos) */}
              {showThinkingRow && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedThinking((prev) => ({
                        ...prev,
                        [msg.id]: !isThinkingOpen,
                      }))
                    }
                    aria-expanded={isThinkingOpen}
                    className="group inline-flex items-center gap-1.5 py-0.5 text-[12.5px] font-medium cursor-pointer select-none"
                  >
                    <span
                      className={
                        isActivelyThinking
                          ? "xox-shimmer inline-block"
                          : "text-zinc-400 group-hover:text-zinc-200 transition-colors"
                      }
                    >
                      {!isActivelyThinking && durationSec
                        ? `Thinking · ${durationSec}s`
                        : "Thinking"}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`inline-block text-[11px] leading-none text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 ${
                        isThinkingOpen ? "rotate-90 text-zinc-300" : ""
                      }`}
                    >
                      &gt;
                    </span>
                  </button>

                  {isThinkingOpen && (
                    <div className="border-l border-white/[0.1] pl-3 ml-0.5 space-y-2.5 py-0.5">
                      {msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                        <div className="space-y-1">
                          {msg.thinkingSteps.map((step) => (
                            <div
                              key={step.id}
                              className="text-[11.5px] leading-snug text-zinc-400"
                            >
                              <span
                                className={
                                  step.status === "running"
                                    ? "xox-shimmer inline-block font-medium"
                                    : "text-zinc-300"
                                }
                              >
                                {step.label}
                              </span>
                              {step.detail && (
                                <span className="text-zinc-500 ml-1.5 font-mono text-[10.5px]">
                                  {step.detail}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {cleanReasoning && (
                        <div className="text-[12px] leading-relaxed text-zinc-400/90 whitespace-pre-wrap select-text">
                          {cleanReasoning}
                          {msg.isReasoningStreaming && (
                            <span className="inline-block w-1.5 h-3 ml-1 align-middle bg-sky-300/70 animate-pulse rounded-xs" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Respuesta limpia (sin recuadro pesado salvo en errores) */}
              {msg.content.trim() ? (
                msg.isError ? (
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-rose-500/[0.07] border border-rose-400/25">
                    <FormattedReply text={msg.content} />
                  </div>
                ) : (
                  <FormattedReply text={msg.content} streaming={Boolean(msg.isStreaming)} />
                )
              ) : msg.isStreaming && !showThinkingRow && !phaseLabel ? (
                <div className="py-0.5 text-[12.5px]">
                  <span className="xox-shimmer inline-block font-medium">Thinking</span>
                </div>
              ) : null}

              {/* Enlace a tarjetas generadas */}
              {(msg.generatedTaskCount ?? 0) > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={onOpenTasksTab}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/15 border border-sky-400/25 text-[11px] text-sky-200 transition-colors cursor-pointer"
                  >
                    <span>
                      {msg.generatedTaskCount}{" "}
                      {msg.generatedTaskCount === 1
                        ? "tarjeta generada en Tareas"
                        : "tarjetas generadas en Tareas"}
                    </span>
                  </button>
                </div>
              )}

              {/* Acción especial (ej. conectar clave) */}
              {msg.actionButton && (
                <div>
                  <button
                    type="button"
                    onClick={() => onAction(msg.actionButton!)}
                    className="xook-approve-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{msg.actionButton.label}</span>
                  </button>
                </div>
              )}

              {/* Barra discreta de acciones estilo Antigravity/Gemini */}
              {!msg.isStreaming && msg.content.trim() && !msg.actionButton && (
                <div className="flex items-center gap-1 pt-0.5 text-zinc-500">
                  {onRateMessage && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRateMessage(msg.id, "up")}
                        title="Respuesta útil"
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                          msg.feedback === "up"
                            ? "text-emerald-300 bg-emerald-500/10"
                            : "hover:text-zinc-200 hover:bg-white/[0.05]"
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRateMessage(msg.id, "down")}
                        title="Respuesta mejorable"
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                          msg.feedback === "down"
                            ? "text-rose-300 bg-rose-500/10"
                            : "hover:text-zinc-200 hover:bg-white/[0.05]"
                        }`}
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  {onRegenerateMessage && isActiveGuideTurn && !msg.isError && (
                    <button
                      type="button"
                      onClick={() => onRegenerateMessage(msg)}
                      title="Volver a generar respuesta"
                      className="p-1.5 rounded-lg hover:text-zinc-200 hover:bg-white/[0.05] transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCopy(msg)}
                    title={copiedId === msg.id ? "Copiado" : "Copiar respuesta"}
                    className="p-1.5 rounded-lg hover:text-zinc-200 hover:bg-white/[0.05] transition-colors cursor-pointer"
                  >
                    {copiedId === msg.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
