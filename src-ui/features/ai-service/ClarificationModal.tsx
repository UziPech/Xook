import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CornerDownLeft,
  HelpCircle,
  X,
} from "lucide-react";
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
  const [stepIndex, setStepIndex] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const advanceTimerRef = useRef<number | null>(null);

  const totalSteps = clarification.questions.length;
  const safeStepIndex = Math.min(Math.max(0, stepIndex), Math.max(0, totalSteps - 1));
  const currentQuestion = clarification.questions[safeStepIndex];

  useEffect(() => {
    setAnswers({});
    setStepIndex(0);
    setValidationError(null);
    return () => {
      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, [clarification.id]);

  if (!currentQuestion) return null;

  const isQuestionAnswered = (qId: string): boolean => {
    const ans = answers[qId];
    return Boolean(ans && (ans.selected.length > 0 || ans.customText.trim().length > 0));
  };

  const handleSelectOption = (qId: string, option: string, kind: string) => {
    if (disabled) return;
    setValidationError(null);
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    if (kind === "multi") {
      setAnswers((prev) => {
        const cur = prev[qId] ?? { selected: [], customText: "" };
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
      });
      return;
    }

    setAnswers((prev) => {
      const cur = prev[qId] ?? { selected: [], customText: "" };
      return {
        ...prev,
        [qId]: {
          ...cur,
          selected: [option],
        },
      };
    });

    // Avanza automáticamente a la siguiente pregunta cuando hay más preguntas
    if (safeStepIndex < totalSteps - 1) {
      advanceTimerRef.current = window.setTimeout(() => {
        setStepIndex((idx) => Math.min(totalSteps - 1, idx + 1));
      }, 140);
    }
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

  const handleFinalSubmit = (overrideAnswers?: AnswerMap) => {
    if (disabled) return;
    const effective = overrideAnswers ?? answers;

    const missingIdx = clarification.questions.findIndex((q) => {
      if (!q.required) return false;
      const ans = effective[q.id];
      return !ans || (ans.selected.length === 0 && !ans.customText.trim());
    });

    if (missingIdx >= 0) {
      const missingQ = clarification.questions[missingIdx];
      setStepIndex(missingIdx);
      setValidationError(`Elige una opción o escribe tu respuesta para: "${missingQ.prompt}"`);
      return;
    }

    const hasAnyAnswer = clarification.questions.some((q) => {
      const ans = effective[q.id];
      return Boolean(ans && (ans.selected.length > 0 || ans.customText.trim()));
    });

    if (!hasAnyAnswer) {
      setValidationError("Elige una opción o escribe una respuesta para continuar.");
      return;
    }

    onSubmit(formatClarificationReply(clarification, effective));
  };

  const handleNextOrSubmit = () => {
    if (disabled) return;
    if ( currentQuestion.required && !isQuestionAnswered(currentQuestion.id)) {
      setValidationError("Selecciona una de las opciones o escribe tu respuesta abajo.");
      return;
    }
    setValidationError(null);
    if (safeStepIndex < totalSteps - 1) {
      setStepIndex(safeStepIndex + 1);
    } else {
      handleFinalSubmit();
    }
  };

  const curAns = answers[currentQuestion.id] ?? { selected: [], customText: "" };
  const isLastStep = safeStepIndex >= totalSteps - 1;

  return (
    <div
      role="group"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          handleNextOrSubmit();
        }
      }}
      className="space-y-2.5"
    >
      {/* Indicador de progreso paso a paso (1 por 1) */}
      {totalSteps > 1 && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {clarification.questions.map((q, idx) => {
              const active = idx === safeStepIndex;
              const answered = isQuestionAnswered(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setValidationError(null);
                    setStepIndex(idx);
                  }}
                  className={`h-5 px-2 rounded-md text-[10px] font-mono inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                    active
                      ? "bg-zinc-100 text-zinc-950 border-white font-semibold"
                      : answered
                      ? "bg-white/[0.07] text-zinc-200 border-white/[0.14]"
                      : "bg-white/[0.025] text-zinc-500 border-white/[0.07] hover:text-zinc-300"
                  }`}
                >
                  <span>{idx + 1}</span>
                  {answered && !active && <Check className="w-2.5 h-2.5" />}
                </button>
              );
            })}
          </div>
          <span className="text-[10.5px] font-mono text-zinc-500">
            Pregunta {safeStepIndex + 1} de {totalSteps}
          </span>
        </div>
      )}

      {/* Pregunta activa única + sus opciones + respuesta libre */}
      <div key={currentQuestion.id} className="panel-fade-in space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={`clarify-input-${currentQuestion.id}`}
            className={`font-medium text-zinc-100 leading-snug ${
              compact ? "text-[12px]" : "text-[12.5px]"
            }`}
          >
            {currentQuestion.prompt}
          </label>
          {!currentQuestion.required && (
            <span className="shrink-0 text-[9.5px] text-zinc-500 border border-white/[0.08] rounded-md px-1.5 py-0.5">
              Opcional
            </span>
          )}
        </div>

        {/* Al menos 2-3 opciones sugeridas */}
        {currentQuestion.options.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {currentQuestion.options.map((opt, optIdx) => {
              const active = curAns.selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    handleSelectOption(currentQuestion.id, opt, currentQuestion.kind)
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    compact
                      ? "px-2.5 py-1 text-[11px]"
                      : "px-2.5 py-1.5 text-[11.5px]"
                  } ${
                    active
                      ? "bg-zinc-100 border-white text-zinc-950 font-medium"
                      : "bg-white/[0.035] border-white/[0.09] text-zinc-200 hover:bg-white/[0.08] hover:border-white/[0.18] hover:text-white"
                  }`}
                >
                  {active ? (
                    <Check className="w-3 h-3 text-zinc-950 stroke-[2.25] shrink-0" />
                  ) : (
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                      {optIdx + 1}
                    </span>
                  )}
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Opción libre siempre disponible para que el usuario escriba su propia respuesta */}
        <div className="pt-0.5">
          <input
            id={`clarify-input-${currentQuestion.id}`}
            type="text"
            disabled={disabled}
            value={curAns.customText}
            onChange={(e) => setCustomText(currentQuestion.id, e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.metaKey &&
                !e.ctrlKey
              ) {
                e.preventDefault();
                e.stopPropagation();
                handleNextOrSubmit();
              }
            }}
            placeholder={
              currentQuestion.placeholder &&
              currentQuestion.placeholder !== "Escribe tu respuesta..."
                ? currentQuestion.placeholder
                : "O escribe tu propia respuesta aquí..."
            }
            className="w-full h-8 px-2.5 rounded-lg border border-white/[0.09] bg-[#07080b] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] transition"
          />
        </div>
      </div>

      {validationError && (
        <p className="text-[11px] text-zinc-200 bg-white/[0.05] border border-white/[0.12] rounded-lg px-2.5 py-1">
          {validationError}
        </p>
      )}

      {/* Barra inferior de navegación 1 por 1 */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          {safeStepIndex > 0 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setValidationError(null);
                setStepIndex((idx) => Math.max(0, idx - 1));
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Anterior</span>
            </button>
          ) : (
            <span className="text-[10.5px] text-zinc-500 hidden sm:inline">
              Elige una opción o responde libremente
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {onCancel && (
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="px-2.5 py-1 rounded-lg border border-white/[0.08] text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors cursor-pointer"
            >
              Omitir
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={handleNextOrSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <span>
              {isLastStep
                ? clarification.submitLabel || "Continuar"
                : "Siguiente"}
            </span>
            {isLastStep ? (
              <CornerDownLeft className="w-3 h-3 stroke-[2.25]" />
            ) : (
              <ArrowRight className="w-3 h-3 stroke-[2.25]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ClarificationInputDockProps {
  clarification: ClarificationSpec;
  onSubmit: (formattedReply: string) => void;
  onClose: () => void;
}

export const ClarificationInputDock: React.FC<ClarificationInputDockProps> = ({
  clarification,
  onSubmit,
  onClose,
}) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="region"
      aria-label={clarification.title || "Pregunta abierta"}
      className="panel-fade-in rounded-xl border border-white/[0.08] bg-[#0a0b0f] px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.09] text-[10px] font-medium text-zinc-300 shrink-0">
            <HelpCircle className="w-2.5 h-2.5 text-zinc-400" />
            <span>Pregunta</span>
          </span>
          <h3 className="text-[12px] font-semibold text-zinc-100 truncate">
            {clarification.title}
          </h3>
          {clarification.subtitle && (
            <span className="text-[11px] text-zinc-500 truncate hidden md:inline">
              · {clarification.subtitle}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar pregunta"
          className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-[220px] overflow-y-auto xook-scroll pr-0.5">
        <ClarificationForm
          compact
          clarification={clarification}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
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
  if (!isOpen || !clarification) return null;
  return (
    <ClarificationInputDock
      clarification={clarification}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
};
