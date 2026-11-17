import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  CheckCircle2,
  HelpCircle,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react";
import type {
  CanvasArtifact,
  CanvasFormAnswerValue,
  CanvasFormField,
  CanvasFormSpec,
} from "../canvasSchema";
import {
  evaluateFormFieldState,
  gradeStudyForm,
  isFormFieldAnswered,
  resolveSelectedIndex,
} from "../canvasSchema";

interface FormCanvasViewProps {
  canvas: CanvasArtifact;
  form: CanvasFormSpec;
  onUpdateForm: (nextForm: CanvasFormSpec) => void;
  onSubmitForm?: (updatedCanvas: CanvasArtifact) => void;
}

const OPTION_LETTERS = "ABCDEFGHIJKL";

export const FormCanvasView: React.FC<FormCanvasViewProps> = ({
  canvas,
  form,
  onUpdateForm,
  onSubmitForm,
}) => {
  const [openHints, setOpenHints] = useState<Record<string, boolean>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());

  const answers = form.answers ?? {};
  const isQuiz = form.purpose === "study_quiz";
  const showFeedback = Boolean(isQuiz && (form.checkedLocally || form.submitted));

  const progress = useMemo(() => {
    const total = form.fields.length;
    const answered = form.fields.filter((f) =>
      isFormFieldAnswered(f, answers[f.id])
    ).length;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
    return { answered, total, percent };
  }, [form.fields, answers]);

  const activeScore = useMemo(() => {
    if (!isQuiz) return undefined;
    if (showFeedback) {
      return form.score ?? gradeStudyForm(form);
    }
    return undefined;
  }, [isQuiz, showFeedback, form]);

  const hasAnyState =
    progress.answered > 0 || Boolean(form.checkedLocally) || Boolean(form.submitted);

  const updateAnswer = (fieldId: string, val: CanvasFormAnswerValue | undefined) => {
    const nextAnswers: Record<string, CanvasFormAnswerValue> = { ...answers };
    if (
      val === undefined ||
      val === "" ||
      (Array.isArray(val) && val.length === 0)
    ) {
      delete nextAnswers[fieldId];
    } else {
      nextAnswers[fieldId] = val;
    }

    if (missingIds.has(fieldId)) {
      const nextMissing = new Set(missingIds);
      nextMissing.delete(fieldId);
      setMissingIds(nextMissing);
      if (nextMissing.size === 0) setValidationError(null);
    }

    const nextForm: CanvasFormSpec = {
      ...form,
      answers: nextAnswers,
      ...(form.checkedLocally ? { score: gradeStudyForm({ ...form, answers: nextAnswers }) } : {}),
    };
    onUpdateForm(nextForm);
  };

  const toggleMultiOption = (fieldId: string, optionIdx: number) => {
    const cur = Array.isArray(answers[fieldId]) ? (answers[fieldId] as number[]) : [];
    const exists = cur.includes(optionIdx);
    const next = exists
      ? cur.filter((idx) => idx !== optionIdx)
      : [...cur, optionIdx].sort((a, b) => a - b);
    updateAnswer(fieldId, next);
  };

  const handleCheckLocally = () => {
    const computedScore = gradeStudyForm(form);
    const nextForm: CanvasFormSpec = {
      ...form,
      checkedLocally: true,
      score: computedScore,
    };
    onUpdateForm(nextForm);
    setValidationError(null);
  };

  const handleReset = () => {
    setValidationError(null);
    setMissingIds(new Set());
    setOpenHints({});
    const nextForm: CanvasFormSpec = {
      ...form,
      answers: {},
      checkedLocally: false,
      submitted: false,
      submittedAt: undefined,
      score: undefined,
    };
    onUpdateForm(nextForm);
  };

  const handleSubmit = () => {
    const requiredMissing = form.fields.filter(
      (f) => f.required && !isFormFieldAnswered(f, answers[f.id])
    );
    if (requiredMissing.length > 0) {
      setMissingIds(new Set(requiredMissing.map((f) => f.id)));
      setValidationError(
        requiredMissing.length === 1
          ? "Completa el campo obligatorio marcado antes de enviar."
          : `Completa los ${requiredMissing.length} campos obligatorios marcados antes de enviar.`
      );
      return;
    }

    if (progress.answered === 0) {
      setValidationError("Responde al menos una pregunta o campo antes de enviar.");
      return;
    }

    setValidationError(null);
    setMissingIds(new Set());

    const computedScore = isQuiz ? gradeStudyForm(form) : undefined;
    const nextForm: CanvasFormSpec = {
      ...form,
      ...(isQuiz ? { checkedLocally: true, score: computedScore } : {}),
      submitted: true,
      submittedAt: new Date().toISOString(),
    };
    onUpdateForm(nextForm);

    if (onSubmitForm) {
      const updatedCanvas: CanvasArtifact = {
        ...canvas,
        form: nextForm,
        updatedAt: new Date().toISOString(),
      };
      onSubmitForm(updatedCanvas);
    }
  };

  const purposeLabel =
    form.purpose === "study_quiz"
      ? "Práctica y evaluación"
      : form.purpose === "survey"
        ? "Encuesta"
        : "Captura de datos";

  const evaluateFieldState = (field: CanvasFormField): "correct" | "wrong" | "open" | "ungraded" => {
    if (!showFeedback) return "ungraded";
    return evaluateFormFieldState(field, answers[field.id]);
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Cabecera de progreso y resultado */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3.5 py-2.5 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/[0.1] text-zinc-200">
              {purposeLabel}
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              {progress.answered}/{progress.total}{" "}
              {isQuiz ? "respondidas" : "completados"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {form.submitted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-500/15 border border-emerald-400/35 text-emerald-200">
                <Check className="w-3 h-3" />
                Enviado a Xox
              </span>
            )}
            {activeScore && activeScore.gradableCount > 0 && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                  activeScore.percent >= (form.passingScorePercent ?? 70)
                    ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
                    : "bg-amber-500/15 border-amber-400/40 text-amber-200"
                }`}
              >
                {activeScore.correctCount}/{activeScore.gradableCount} · {activeScore.percent}%
              </span>
            )}
          </div>
        </div>

        {/* Barra de progreso */}
        <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-white/80 transition-all duration-300 rounded-full"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        {form.description && (
          <p className="text-[12px] text-zinc-300 leading-relaxed">
            {form.description}
          </p>
        )}

        {activeScore && activeScore.openCount > 0 && (
          <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
            <span>
              {activeScore.openCount === 1
                ? "Incluye 1 pregunta abierta: envía a Xox para recibir retroalimentación personalizada."
                : `Incluye ${activeScore.openCount} preguntas abiertas: envía a Xox para recibir retroalimentación personalizada.`}
            </span>
          </p>
        )}
      </div>

      {/* Lista de preguntas / campos */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pr-1 space-y-3">
        {form.fields.map((field, idx) => {
          const val = answers[field.id];
          const fieldState = evaluateFieldState(field);
          const isMissing = missingIds.has(field.id);
          const hintOpen = Boolean(openHints[field.id]);
          const pickedSingle = resolveSelectedIndex(field, val);
          const pickedMulti = Array.isArray(val) ? new Set(val) : null;

          const cardBorderClass = isMissing
            ? "border-rose-400/50 bg-rose-500/[0.04]"
            : fieldState === "correct"
              ? "border-emerald-400/35 bg-emerald-500/[0.03]"
              : fieldState === "wrong"
                ? "border-rose-400/35 bg-rose-500/[0.03]"
                : "border-white/[0.08] bg-white/[0.02]";

          return (
            <div
              key={field.id}
              className={`rounded-2xl border p-3.5 space-y-2.5 transition-colors ${cardBorderClass}`}
            >
              {/* Encabezado de pregunta */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="w-5 h-5 rounded-md bg-white/[0.07] border border-white/[0.1] flex items-center justify-center text-[10.5px] font-mono text-zinc-300 shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <label
                      htmlFor={`canvas-form-${field.id}`}
                      className="text-[13px] font-medium text-zinc-100 leading-snug block"
                    >
                      {field.label}
                      {field.required && (
                        <span className="text-rose-300 ml-1" title="Obligatorio">
                          *
                        </span>
                      )}
                    </label>
                    {isMissing && (
                      <span className="text-[11px] text-rose-300 mt-0.5 block">
                        Campo obligatorio
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isQuiz && field.points && field.points > 1 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-white/[0.04] border border-white/[0.06]">
                      {field.points} pts
                    </span>
                  )}
                  {fieldState === "correct" && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {fieldState === "wrong" && (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  )}
                  {field.hint && form.showHints !== false && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenHints((prev) => ({
                          ...prev,
                          [field.id]: !prev[field.id],
                        }))
                      }
                      className={`px-2 py-0.5 rounded-lg text-[10.5px] inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                        hintOpen
                          ? "bg-white/[0.1] border-white/[0.2] text-white"
                          : "bg-white/[0.03] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>Pista</span>
                    </button>
                  )}
                </div>
              </div>

              {hintOpen && field.hint && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11.5px] text-zinc-300">
                  <span className="font-semibold text-zinc-200">Pista: </span>
                  {field.hint}
                </div>
              )}

              {/* Control por tipo */}
              {(field.type === "single_choice" || field.type === "true_false") &&
                field.options && (
                  <div
                    className={
                      field.type === "true_false" && field.options.length === 2
                        ? "grid grid-cols-2 gap-2"
                        : "space-y-1.5"
                    }
                  >
                    {field.options.map((opt, oIdx) => {
                      const selected = pickedSingle === oIdx;
                      const isCorrectOption =
                        showFeedback && field.correctIndex === oIdx;
                      const isWrongPicked =
                        showFeedback && selected && field.correctIndex !== undefined && field.correctIndex !== oIdx;

                      let btnStyle =
                        "border-white/[0.08] bg-white/[0.025] text-zinc-300 hover:bg-white/[0.06] hover:border-white/[0.16]";
                      if (isCorrectOption) {
                        btnStyle =
                          "border-emerald-400/50 bg-emerald-500/15 text-emerald-100";
                      } else if (isWrongPicked) {
                        btnStyle =
                          "border-rose-400/50 bg-rose-500/15 text-rose-100";
                      } else if (selected) {
                        btnStyle =
                          "border-white/[0.35] bg-white/[0.12] text-white";
                      }

                      return (
                        <button
                          key={`${field.id}-opt-${oIdx}`}
                          type="button"
                          onClick={() => updateAnswer(field.id, oIdx)}
                          className={`w-full text-left px-3 py-2 rounded-xl border text-[12px] flex items-center gap-2.5 transition-all cursor-pointer ${btnStyle}`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full border text-[10px] font-mono flex items-center justify-center shrink-0 ${
                              isCorrectOption
                                ? "border-emerald-300 bg-emerald-400/25 text-emerald-100"
                                : isWrongPicked
                                  ? "border-rose-300 bg-rose-400/25 text-rose-100"
                                  : selected
                                    ? "border-white bg-white text-black font-bold"
                                    : "border-white/[0.18] text-zinc-400"
                            }`}
                          >
                            {OPTION_LETTERS[oIdx] ?? String(oIdx + 1)}
                          </span>
                          <span className="flex-1 leading-snug">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

              {field.type === "multi_choice" && field.options && (
                <div className="space-y-1.5">
                  <span className="text-[10.5px] text-zinc-400 block">
                    Selecciona todas las que apliquen
                  </span>
                  {field.options.map((opt, oIdx) => {
                    const selected = Boolean(pickedMulti?.has(oIdx));
                    const isExpected =
                      showFeedback && Boolean(field.correctIndices?.includes(oIdx));
                    const isWrongPicked =
                      showFeedback &&
                      Array.isArray(field.correctIndices) &&
                      selected &&
                      !field.correctIndices.includes(oIdx);

                    let btnStyle =
                      "border-white/[0.08] bg-white/[0.025] text-zinc-300 hover:bg-white/[0.06] hover:border-white/[0.16]";
                    if (isExpected && selected) {
                      btnStyle =
                        "border-emerald-400/50 bg-emerald-500/15 text-emerald-100";
                    } else if (isExpected && !selected) {
                      btnStyle =
                        "border-emerald-400/35 bg-emerald-500/[0.06] text-emerald-200";
                    } else if (isWrongPicked) {
                      btnStyle =
                        "border-rose-400/50 bg-rose-500/15 text-rose-100";
                    } else if (selected) {
                      btnStyle =
                        "border-white/[0.35] bg-white/[0.12] text-white";
                    }

                    return (
                      <button
                        key={`${field.id}-mopt-${oIdx}`}
                        type="button"
                        onClick={() => toggleMultiOption(field.id, oIdx)}
                        className={`w-full text-left px-3 py-2 rounded-xl border text-[12px] flex items-center gap-2.5 transition-all cursor-pointer ${btnStyle}`}
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            selected
                              ? "border-white bg-white text-black"
                              : "border-white/[0.22] bg-transparent"
                          }`}
                        >
                          {selected && <Check className="w-3 h-3 stroke-[3]" />}
                        </span>
                        <span className="flex-1 leading-snug">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {field.type === "select" && field.options && (
                <select
                  id={`canvas-form-${field.id}`}
                  value={pickedSingle !== undefined ? String(pickedSingle) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateAnswer(
                      field.id,
                      v === "" ? undefined : Number.parseInt(v, 10)
                    );
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#0c0d12] border border-white/[0.12] focus:border-white/30 text-[12.5px] text-zinc-100 outline-none"
                >
                  <option value="">Selecciona una opción...</option>
                  {field.options.map((opt, oIdx) => (
                    <option key={`${field.id}-sel-${oIdx}`} value={String(oIdx)}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {field.type === "short_text" && (
                <input
                  id={`canvas-form-${field.id}`}
                  type="text"
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => updateAnswer(field.id, e.target.value)}
                  placeholder={field.placeholder || "Escribe tu respuesta..."}
                  className="w-full px-3 py-2 rounded-xl bg-[#0c0d12] border border-white/[0.1] focus:border-white/30 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors"
                />
              )}

              {field.type === "long_text" && (
                <textarea
                  id={`canvas-form-${field.id}`}
                  rows={3}
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => updateAnswer(field.id, e.target.value)}
                  placeholder={
                    field.placeholder || "Desarrolla tu respuesta con tus palabras..."
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#0c0d12] border border-white/[0.1] focus:border-white/30 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 outline-none resize-y transition-colors"
                />
              )}

              {field.type === "number" && (
                <input
                  id={`canvas-form-${field.id}`}
                  type="number"
                  step="any"
                  min={field.min}
                  max={field.max}
                  value={
                    typeof val === "number"
                      ? String(val)
                      : typeof val === "string"
                        ? val
                        : ""
                  }
                  onChange={(e) => updateAnswer(field.id, e.target.value)}
                  placeholder={field.placeholder || "Ingresa un valor numérico..."}
                  className="w-full px-3 py-2 rounded-xl bg-[#0c0d12] border border-white/[0.1] focus:border-white/30 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 outline-none font-mono transition-colors"
                />
              )}

              {field.type === "rating" && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Array.from(
                    { length: Math.min(10, Math.max(3, (field.max ?? 5) - (field.min ?? 1) + 1)) },
                    (_, i) => (field.min ?? 1) + i
                  ).map((scoreVal) => {
                    const currentNum = typeof val === "number" ? val : 0;
                    const active = currentNum >= scoreVal;
                    return (
                      <button
                        key={`${field.id}-rate-${scoreVal}`}
                        type="button"
                        onClick={() => updateAnswer(field.id, scoreVal)}
                        className={`px-2.5 py-1.5 rounded-xl border inline-flex items-center gap-1 text-[11.5px] font-mono transition-all cursor-pointer ${
                          active
                            ? "border-white/35 bg-white/15 text-white"
                            : "border-white/[0.08] bg-white/[0.025] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            active ? "fill-white text-white" : "text-zinc-500"
                          }`}
                        />
                        <span>{scoreVal}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Explicación / respuesta de referencia tras verificar o enviar */}
              {showFeedback && (field.explanation || field.expectedAnswer) && (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 space-y-1 text-[11.5px]">
                  {field.expectedAnswer && (
                    <p className="text-emerald-200">
                      <span className="font-semibold">Referencia: </span>
                      {field.expectedAnswer}
                    </p>
                  )}
                  {field.explanation && (
                    <p className="text-zinc-300 leading-relaxed">
                      <span className="font-semibold text-zinc-200">Explicación: </span>
                      {field.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Barra inferior de acciones */}
      <div className="pt-2.5 border-t border-white/[0.08] space-y-2 shrink-0 bg-[#090a0e]">
        {validationError && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300 px-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          {hasAnyState ? (
            <button
              type="button"
              onClick={handleReset}
              className="quick-liquid-btn px-2.5 py-1.5 rounded-xl inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-300 hover:text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reiniciar</span>
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500">
              {isQuiz
                ? "Responde a tu ritmo y verifica o envía a Xox"
                : "Completa los campos para enviarlos al chat"}
            </span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {isQuiz && (
              <button
                type="button"
                onClick={handleCheckLocally}
                disabled={progress.answered === 0}
                className="quick-liquid-btn px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-200 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Verificar respuestas</span>
              </button>
            )}

            {onSubmitForm && (
              <button
                type="button"
                onClick={handleSubmit}
                className="px-4 py-1.5 rounded-xl inline-flex items-center gap-1.5 text-[12px] font-semibold bg-white text-black hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {form.submitLabel ||
                    (isQuiz ? "Enviar a Xox para revisión" : "Enviar a Xox")}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
