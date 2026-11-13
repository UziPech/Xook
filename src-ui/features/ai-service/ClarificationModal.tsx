import React, { useEffect, useState } from "react";
import { Check, HelpCircle, Send, X } from "lucide-react";
import {
  ClarificationSpec,
  formatClarificationReply,
} from "./clarificationSchema";

type AnswerMap = Record<string, { selected: string[]; customText: string }>;

interface ClarificationFormProps {
  clarification: ClarificationSpec;
  onSubmit: (formattedReply: string) => void;
  onCancel?: () => void;
  compact?: boolean;
  disabled?: boolean;
}

export const ClarificationForm: React.FC<ClarificationFormProps> = ({
  clarification,
  onSubmit,
  onCancel,
  compact = false,
  disabled = false,
}) => {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setAnswers({});
    setValidationError(null);
  }, [clarification.id]);

  const toggleOption = (qId: string, option: string, kind: string) => {
    setValidationError(null);
    setAnswers((prev) => {
      const cur = prev[qId] ?? { selected: [], customText: "" };
      if (kind === "multi") {
        const exists = cur.selected.includes(option);
        return {
          ...prev,
          [qId]: {
            ...cur,
            selected: exists
              ? cur.selected.filter((item) => item !== option)
              : [...cur.selected, option],
          },
        };
      }
      const already = cur.selected.length === 1 && cur.selected[0] === option;
      return {
        ...prev,
        [qId]: {
          ...cur,
          selected: already ? [] : [option],
        },
      };
    });
  };

  const setCustomText = (qId: string, customText: string) => {
    setValidationError(null);
    setAnswers((prev) => {
      const cur = prev[qId] ?? { selected: [], customText: "" };
      return {
        ...prev,
        [qId]: {
          ...cur,
          customText,
        },
      };
    });
  };

  const handleSubmit = () => {
    if (disabled) return;

    const missingRequired = clarification.questions.find((q) => {
      if (!q.required) return false;
      const ans = answers[q.id];
      return !ans || (ans.selected.length === 0 && !ans.customText.trim());
    });

    if (missingRequired) {
      setValidationError(`Falta responder: "${missingRequired.prompt}"`);
      return;
    }

    const hasAnyAnswer = clarification.questions.some((q) => {
      const ans = answers[q.id];
      return Boolean(ans && (ans.selected.length > 0 || ans.customText.trim()));
    });

    if (!hasAnyAnswer) {
      setValidationError("Elige una opción o escribe una respuesta para continuar.");
      return;
    }

    onSubmit(formatClarificationReply(clarification, answers));
  };

  return (
    <div
      role="group"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit();
        }
      }}
      className={compact ? "space-y-2.5" : "space-y-4"}
    >
      {clarification.questions.map((q, idx) => {
        const ans = answers[q.id] ?? { selected: [], customText: "" };
        const showOptions = q.kind !== "text" && q.options.length > 0;
        const showInput =
          q.kind === "text" || q.kind === "choice_or_text" || q.options.length === 0;

        return (
          <div
            key={q.id}
            className={`rounded-xl border border-white/[0.08] bg-white/[0.025] ${
              compact ? "p-2.5 space-y-2" : "p-3.5 space-y-2.5"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <label
                htmlFor={`clarify-input-${q.id}`}
                className={`font-medium text-zinc-100 leading-snug ${
                  compact ? "text-[12px]" : "text-[13px]"
                }`}
              >
                <span className="text-sky-400/80 mr-1.5">{idx + 1}.</span>
                {q.prompt}
              </label>
              {!q.required && (
                <span className="shrink-0 text-[10px] text-zinc-500 border border-white/[0.08] rounded-full px-2 py-0.5">
                  Opcional
                </span>
              )}
            </div>

            {showOptions && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const active = ans.selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleOption(q.id, opt, q.kind)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border text-left transition cursor-pointer ${
                        compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]"
                      } ${
                        active
                          ? "bg-sky-500/20 border-sky-400/55 text-sky-100 shadow-[0_0_16px_-6px_rgba(56,189,248,0.45)]"
                          : "bg-white/[0.035] border-white/[0.09] text-zinc-300 hover:bg-white/[0.08] hover:border-white/[0.18]"
                      }`}
                    >
                      {active && <Check className="w-3 h-3 text-sky-300 shrink-0" />}
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {showInput && (
              <input
                id={`clarify-input-${q.id}`}
                type="text"
                disabled={disabled}
                autoFocus={idx === 0 && !showOptions}
                value={ans.customText}
                onChange={(e) => setCustomText(q.id, e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    clarification.questions.length === 1
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit();
                  }
                }}
                placeholder={
                  q.placeholder ||
                  (showOptions
                    ? "O escribe otro detalle específico..."
                    : "Escribe tu respuesta...")
                }
                className={`w-full rounded-lg border border-white/[0.1] bg-black/35 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-sky-400/50 focus:bg-black/50 transition ${
                  compact ? "px-2.5 py-1.5 text-[11.5px]" : "px-3 py-2 text-[12.5px]"
                }`}
              />
            )}
          </div>
        );
      })}

      {validationError && (
        <p className="text-[11.5px] text-amber-300 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-1.5">
          {validationError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {!compact ? (
          <span className="text-[11px] text-zinc-500">
            Atajo: ⌘Enter para enviar
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className={`rounded-xl border border-white/[0.1] text-zinc-300 hover:bg-white/[0.06] transition cursor-pointer ${
                compact ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-2 text-xs"
              }`}
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={handleSubmit}
            className={`xook-approve-btn inline-flex items-center gap-1.5 rounded-xl font-semibold cursor-pointer ${
              compact ? "px-3 py-1.5 text-[11.5px]" : "px-4 py-2 text-xs"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{clarification.submitLabel || "Continuar"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ClarificationModalProps {
  isOpen: boolean;
  clarification: ClarificationSpec | null;
  onSubmit: (formattedReply: string) => void;
  onClose: () => void;
}

export const ClarificationModal: React.FC<ClarificationModalProps> = ({
  isOpen,
  clarification,
  onSubmit,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !clarification) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md panel-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clarification-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[520px] max-h-[86vh] flex flex-col rounded-2xl border border-white/[0.12] bg-[#0b0e14]/95 shadow-[0_28px_80px_-16px_rgba(0,0,0,0.92)] overflow-hidden">
        <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-sky-400/60 to-transparent" />

        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/[0.07]">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/25 bg-sky-500/10 px-2.5 py-0.5 text-[10.5px] font-medium text-sky-300 mb-1.5">
              <HelpCircle className="w-3 h-3" />
              <span>Pregunta abierta</span>
            </div>
            <h2
              id="clarification-modal-title"
              className="text-[15px] font-semibold text-zinc-100 leading-snug"
            >
              {clarification.title}
            </h2>
            {clarification.subtitle && (
              <p className="text-[12.5px] text-zinc-400 mt-1 leading-relaxed">
                {clarification.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.07] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <ClarificationForm
            clarification={clarification}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
};
