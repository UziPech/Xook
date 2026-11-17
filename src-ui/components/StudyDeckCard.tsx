import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  RotateCw,
  Check,
  X,
  HelpCircle,
} from "lucide-react";
import type { StudyDeckArtifact } from "../features/ai-service/agentModeTypes";

interface StudyDeckCardProps {
  deck: StudyDeckArtifact;
}

/**
 * Tarjeta interactiva para el modo /study (Flashcards + Quiz Socrático).
 * Estética monocroma neutra alineada a XOOK.
 */
export const StudyDeckCard: React.FC<StudyDeckCardProps> = ({ deck }) => {
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  const cards = deck.cards ?? [];
  const currentCard = cards[cardIdx];

  const handleNext = () => {
    if (cards.length === 0) return;
    setFlipped(false);
    setShowHint(false);
    setCardIdx((i) => (i + 1) % cards.length);
  };

  const handlePrev = () => {
    if (cards.length === 0) return;
    setFlipped(false);
    setShowHint(false);
    setCardIdx((i) => (i - 1 + cards.length) % cards.length);
  };

  return (
    <div className="mt-3 rounded-2xl bg-white/[0.025] backdrop-blur-xl border border-white/[0.08] p-3.5 space-y-3 select-none">
      {/* Encabezado del Mazo */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-zinc-200 shrink-0">
            <GraduationCap className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">
              Mazo de Estudio
            </span>
            <h4 className="text-xs font-semibold text-white truncate">{deck.topic}</h4>
          </div>
        </div>

        {cards.length > 0 && (
          <span className="text-[10.5px] font-mono text-zinc-400 tabular-nums shrink-0">
            Tarjeta {cardIdx + 1} / {cards.length}
          </span>
        )}
      </div>

      {/* Flashcard Interactiva */}
      {currentCard && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="w-full text-left rounded-xl bg-white/[0.035] hover:bg-white/[0.055] border border-white/[0.09] p-3.5 transition-all cursor-pointer min-h-[96px] flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                {flipped ? "Respuesta / Concepto" : "Pregunta / Término"}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                <RotateCw className="w-3 h-3" />
                <span>Clic para voltear</span>
              </span>
            </div>

            <p className="text-[13px] text-zinc-100 leading-relaxed select-text">
              {flipped ? currentCard.back : currentCard.front}
            </p>

            {showHint && currentCard.hint && !flipped && (
              <p className="text-[11px] text-zinc-400 border-t border-white/[0.06] pt-1.5">
                Pista: {currentCard.hint}
              </p>
            )}
          </button>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrev}
                disabled={cards.length <= 1}
                aria-label="Tarjeta anterior"
                className="quick-liquid-btn w-7 h-7 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={cards.length <= 1}
                aria-label="Siguiente tarjeta"
                className="quick-liquid-btn w-7 h-7 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {currentCard.hint && !flipped && (
              <button
                type="button"
                onClick={() => setShowHint((h) => !h)}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/[0.05] cursor-pointer transition-colors"
              >
                <HelpCircle className="w-3 h-3" />
                <span>{showHint ? "Ocultar pista" : "Ver pista"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quiz de Autoevaluación Socrática */}
      {deck.quiz && deck.quiz.options.length > 0 && (
        <div className="pt-2.5 border-t border-white/[0.07] space-y-2">
          <p className="text-xs font-medium text-zinc-200 leading-snug select-text">
            Autoevaluación: {deck.quiz.question}
          </p>
          <div className="space-y-1">
            {deck.quiz.options.map((opt, oIdx) => {
              const answered = selectedOption !== null;
              const isChosen = selectedOption === oIdx;
              const isCorrect = oIdx === deck.quiz?.correctIndex;

              return (
                <button
                  key={`${oIdx}-${opt.slice(0, 12)}`}
                  type="button"
                  onClick={() => setSelectedOption(oIdx)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-left text-[11.5px] border transition-all cursor-pointer ${
                    answered && isCorrect
                      ? "bg-white/[0.1] border-white/[0.25] text-white font-medium"
                      : answered && isChosen && !isCorrect
                        ? "bg-white/[0.03] border-white/[0.08] text-zinc-400 line-through"
                        : "bg-white/[0.02] border-white/[0.07] text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span>{opt}</span>
                  {answered && isCorrect && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                  {answered && isChosen && !isCorrect && (
                    <X className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          {selectedOption !== null && deck.quiz.explanation && (
            <p className="text-[11px] text-zinc-300 bg-white/[0.04] border border-white/[0.08] rounded-xl px-2.5 py-2 leading-relaxed select-text">
              {deck.quiz.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
