import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  GitFork,
  ListChecks,
  MessageSquarePlus,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
} from "lucide-react";
import type {
  CanvasArtifact,
  CanvasPlanPhase,
  CanvasPlanRiskLevel,
  CanvasPlanSpec,
  CanvasPlanStep,
  CanvasPlanStepStatus,
} from "../canvasSchema";
import { planSpecToDiagramSpec } from "../canvasSchema";
import { DiagramCanvasView } from "./DiagramCanvasView";

interface PlanCanvasViewProps {
  canvas: CanvasArtifact;
  plan: CanvasPlanSpec;
  onUpdatePlan: (nextPlan: CanvasPlanSpec) => void;
  onApprovePlan?: (updatedCanvas: CanvasArtifact) => void;
  onRequestChanges?: (updatedCanvas: CanvasArtifact) => void;
  onAskNode?: (stepTitle: string, detail?: string) => void;
}

function getPlanStatusMeta(status: CanvasPlanSpec["status"]) {
  switch (status) {
    case "approved":
      return {
        label: "Aprobado",
        cls: "bg-emerald-500/15 border-emerald-400/35 text-emerald-200",
      };
    case "in_progress":
      return {
        label: "En ejecución",
        cls: "bg-white/[0.12] border-white/[0.28] text-white",
      };
    case "completed":
      return {
        label: "Completado",
        cls: "bg-emerald-500/20 border-emerald-400/45 text-emerald-100",
      };
    case "changes_requested":
      return {
        label: "Ajustes solicitados",
        cls: "bg-amber-500/15 border-amber-400/35 text-amber-200",
      };
    default:
      return {
        label: "Listo para revisión",
        cls: "bg-white/[0.06] border-white/[0.14] text-zinc-200",
      };
  }
}

function getRiskBadge(level?: CanvasPlanRiskLevel) {
  if (!level) return null;
  if (level === "high") {
    return {
      label: "Riesgo alto",
      cls: "bg-rose-500/15 border-rose-400/35 text-rose-200",
    };
  }
  if (level === "medium") {
    return {
      label: "Riesgo medio",
      cls: "bg-amber-500/15 border-amber-400/35 text-amber-200",
    };
  }
  return {
    label: "Riesgo bajo",
    cls: "bg-white/[0.05] border-white/[0.1] text-zinc-300",
  };
}

export const PlanCanvasView: React.FC<PlanCanvasViewProps> = ({
  canvas,
  plan,
  onUpdatePlan,
  onApprovePlan,
  onRequestChanges,
  onAskNode,
}) => {
  const [subTab, setSubTab] = useState<"phases" | "flow">("phases");
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});
  const [openCommentKey, setOpenCommentKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [showRiskPanel, setShowRiskPanel] = useState(true);

  const flowDiagram = useMemo(() => planSpecToDiagramSpec(plan), [plan]);

  const stepTitleById = useMemo(() => {
    const map = new Map<string, string>();
    plan.phases.forEach((ph) => {
      ph.steps.forEach((st) => map.set(st.id, st.title));
    });
    return map;
  }, [plan]);

  const stats = useMemo(() => {
    let total = 0;
    let selected = 0;
    let done = 0;
    let commentsCount = plan.reviewComment?.trim() ? 1 : 0;
    plan.phases.forEach((ph) => {
      if (ph.comment?.trim()) commentsCount += 1;
      ph.steps.forEach((st) => {
        total += 1;
        if (st.checked) selected += 1;
        if (st.status === "done") done += 1;
        if (st.comment?.trim()) commentsCount += 1;
      });
    });
    return { total, selected, done, commentsCount };
  }, [plan]);

  const isReviewMode = plan.status === "draft" || plan.status === "changes_requested";
  const statusMeta = getPlanStatusMeta(plan.status);

  const toggleStepChecked = (phaseId: string, stepId: string) => {
    const nextPhases = plan.phases.map((ph) =>
      ph.id !== phaseId
        ? ph
        : {
            ...ph,
            steps: ph.steps.map((st) =>
              st.id !== stepId
                ? st
                : isReviewMode
                  ? { ...st, checked: !st.checked }
                  : {
                      ...st,
                      status: (st.status === "done" ? "pending" : "done") as CanvasPlanStepStatus,
                    }
            ),
          }
    );
    onUpdatePlan({ ...plan, phases: nextPhases });
  };

  const openInlineComment = (key: string, currentValue?: string) => {
    if (openCommentKey === key) {
      setOpenCommentKey(null);
      return;
    }
    setOpenCommentKey(key);
    setCommentDraft(currentValue ?? "");
  };

  const savePhaseComment = (phaseId: string) => {
    const trimmed = commentDraft.trim();
    const nextPhases = plan.phases.map((ph) =>
      ph.id === phaseId ? { ...ph, comment: trimmed || undefined } : ph
    );
    onUpdatePlan({ ...plan, phases: nextPhases });
    setOpenCommentKey(null);
    setCommentDraft("");
  };

  const saveStepComment = (phaseId: string, stepId: string) => {
    const trimmed = commentDraft.trim();
    const nextPhases = plan.phases.map((ph) =>
      ph.id !== phaseId
        ? ph
        : {
            ...ph,
            steps: ph.steps.map((st) =>
              st.id === stepId ? { ...st, comment: trimmed || undefined } : st
            ),
          }
    );
    onUpdatePlan({ ...plan, phases: nextPhases });
    setOpenCommentKey(null);
    setCommentDraft("");
  };

  const handleApprove = () => {
    const nextPlan: CanvasPlanSpec = {
      ...plan,
      status: "approved",
      phases: plan.phases.map((ph) => ({
        ...ph,
        steps: ph.steps.map((st) => ({
          ...st,
          status: st.checked ? st.status : "skipped",
        })),
      })),
    };
    const updatedCanvas: CanvasArtifact = {
      ...canvas,
      plan: nextPlan,
      updatedAt: new Date().toISOString(),
    };
    onUpdatePlan(nextPlan);
    onApprovePlan?.(updatedCanvas);
  };

  const handleRequestChanges = () => {
    const nextPlan: CanvasPlanSpec = {
      ...plan,
      status: "changes_requested",
    };
    const updatedCanvas: CanvasArtifact = {
      ...canvas,
      plan: nextPlan,
      updatedAt: new Date().toISOString(),
    };
    onUpdatePlan(nextPlan);
    onRequestChanges?.(updatedCanvas);
  };

  const handleReopenDraft = () => {
    onUpdatePlan({
      ...plan,
      status: "draft",
      phases: plan.phases.map((ph) => ({
        ...ph,
        steps: ph.steps.map((st) => ({
          ...st,
          status: st.status === "skipped" ? "pending" : st.status,
        })),
      })),
    });
  };

  const hasRisksOrAssumptions =
    (plan.assumptions && plan.assumptions.length > 0) ||
    (plan.risks && plan.risks.length > 0);

  return (
    <div className="flex flex-col h-full min-h-[340px]">
      <div className="flex-1 min-h-0 overflow-auto xook-scroll space-y-3 pt-3 pb-3">
        {/* Tarjeta de Objetivo, Estado y Alcance */}
        <div className="rounded-xl border border-white/[0.09] bg-white/[0.03] p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10.5px] font-medium ${statusMeta.cls}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {statusMeta.label}
            </span>
            <span className="text-[11px] font-mono text-zinc-400 tabular-nums">
              {isReviewMode
                ? `${stats.selected}/${stats.total} pasos incluidos`
                : `${stats.done}/${stats.selected} completados`}
            </span>
          </div>

          <p className="text-[12.5px] text-zinc-100 leading-relaxed select-text">
            {plan.goal}
          </p>

          {plan.scope && plan.scope.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mr-1">
                Alcance:
              </span>
              {plan.scope.map((item, idx) => (
                <span
                  key={`${item}-${idx}`}
                  className="px-2 py-0.5 rounded-md bg-white/[0.045] border border-white/[0.08] text-[10.5px] text-zinc-300 font-mono"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Selector de sub-vista: Fases vs Mapa de Flujo */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-xl bg-white/[0.03] border border-white/[0.08] p-0.5">
            <button
              type="button"
              onClick={() => setSubTab("phases")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                subTab === "phases"
                  ? "bg-white/[0.11] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ListChecks className="w-3 h-3" />
              <span>Fases ({plan.phases.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab("flow")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                subTab === "flow"
                  ? "bg-white/[0.11] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <GitFork className="w-3 h-3" />
              <span>Mapa de flujo</span>
            </button>
          </div>

          {!isReviewMode && (
            <button
              type="button"
              onClick={handleReopenDraft}
              className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/[0.05] cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reabrir revisión</span>
            </button>
          )}
        </div>

        {/* Vista Fases Interactiva */}
        {subTab === "phases" ? (
          <div className="space-y-2.5">
            {plan.phases.map((phase: CanvasPlanPhase, pIdx: number) => {
              const isCollapsed = Boolean(collapsedPhases[phase.id]);
              const phaseCommentKey = `phase:${phase.id}`;
              const selectedCount = phase.steps.filter((s) => s.checked).length;
              const doneCount = phase.steps.filter((s) => s.status === "done").length;

              return (
                <div
                  key={phase.id}
                  className="rounded-xl border border-white/[0.08] bg-[#0c0d13] overflow-hidden"
                >
                  {/* Encabezado de Fase */}
                  <div className="px-3.5 py-2.5 bg-white/[0.025] border-b border-white/[0.06] flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedPhases((prev) => ({
                          ...prev,
                          [phase.id]: !prev[phase.id],
                        }))
                      }
                      className="flex items-start gap-2 text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="mt-0.5 text-zinc-400 shrink-0">
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                            Fase {pIdx + 1}
                          </span>
                          <h4 className="text-[12.5px] font-semibold text-white">
                            {phase.title}
                          </h4>
                        </div>
                        {phase.summary && (
                          <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                            {phase.summary}
                          </p>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                        {isReviewMode
                          ? `${selectedCount}/${phase.steps.length}`
                          : `${doneCount}/${phase.steps.length}`}
                      </span>
                      <button
                        type="button"
                        title="Comentar esta fase"
                        onClick={() => openInlineComment(phaseCommentKey, phase.comment)}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                          phase.comment
                            ? "bg-amber-500/15 text-amber-200 border border-amber-400/30"
                            : "text-zinc-400 hover:text-white hover:bg-white/[0.07]"
                        }`}
                      >
                        <MessageSquarePlus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Caja de comentario inline de fase */}
                  {openCommentKey === phaseCommentKey && (
                    <div className="px-3.5 py-2.5 bg-white/[0.02] border-b border-white/[0.06] flex items-center gap-2">
                      <input
                        autoFocus
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") savePhaseComment(phase.id);
                          if (e.key === "Escape") setOpenCommentKey(null);
                        }}
                        placeholder={`Observación sobre "${phase.title}"...`}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/[0.16] text-[11.5px] text-white placeholder:text-zinc-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => savePhaseComment(phase.id)}
                        className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] font-medium text-white cursor-pointer"
                      >
                        Guardar
                      </button>
                    </div>
                  )}

                  {phase.comment && openCommentKey !== phaseCommentKey && (
                    <div className="px-3.5 py-2 bg-amber-500/[0.07] border-b border-amber-400/20 text-[11px] text-amber-100 flex items-center justify-between gap-2">
                      <span>
                        <strong className="font-medium">Observación:</strong> {phase.comment}
                      </span>
                      <button
                        type="button"
                        onClick={() => openInlineComment(phaseCommentKey, phase.comment)}
                        className="text-[10px] text-amber-200/80 hover:text-amber-100 underline cursor-pointer shrink-0"
                      >
                        Editar
                      </button>
                    </div>
                  )}

                  {/* Lista de Pasos de la Fase */}
                  {!isCollapsed && (
                    <div className="divide-y divide-white/[0.05]">
                      {phase.steps.map((step: CanvasPlanStep) => {
                        const stepCommentKey = `step:${phase.id}:${step.id}`;
                        const riskBadge = getRiskBadge(step.risk);
                        const isSkipped = !step.checked || step.status === "skipped";
                        const isDone = step.status === "done";

                        return (
                          <div
                            key={step.id}
                            className={`px-3.5 py-2.5 transition-colors ${
                              isSkipped ? "opacity-55" : "hover:bg-white/[0.02]"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => toggleStepChecked(phase.id, step.id)}
                                aria-label={
                                  isReviewMode
                                    ? `Incluir paso ${step.title}`
                                    : `Marcar paso ${step.title}`
                                }
                                title={
                                  isReviewMode
                                    ? step.checked
                                      ? "Clic para omitir este paso"
                                      : "Clic para incluir este paso"
                                    : isDone
                                      ? "Marcar como pendiente"
                                      : "Marcar como completado"
                                }
                                className="mt-0.5 shrink-0 cursor-pointer text-zinc-300 hover:text-white"
                              >
                                {isReviewMode ? (
                                  <span
                                    className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                                      step.checked
                                        ? "bg-white text-black border-white"
                                        : "border-white/25 bg-transparent"
                                    }`}
                                  >
                                    {step.checked && <Check className="w-3 h-3 stroke-[2.5]" />}
                                  </span>
                                ) : isDone ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                                ) : (
                                  <Circle className="w-4 h-4 text-zinc-500" />
                                )}
                              </button>

                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p
                                    className={`text-[12px] font-medium leading-snug ${
                                      isDone
                                        ? "line-through text-zinc-400"
                                        : isSkipped
                                          ? "line-through text-zinc-400"
                                          : "text-zinc-100"
                                    }`}
                                  >
                                    {step.title}
                                  </p>
                                  <button
                                    type="button"
                                    title="Agregar comentario a este paso"
                                    onClick={() => openInlineComment(stepCommentKey, step.comment)}
                                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                                      step.comment
                                        ? "bg-amber-500/15 text-amber-200 border border-amber-400/30"
                                        : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06]"
                                    }`}
                                  >
                                    <MessageSquarePlus className="w-3 h-3" />
                                  </button>
                                </div>

                                {step.detail && (
                                  <p className="text-[11.5px] text-zinc-400 leading-relaxed select-text">
                                    {step.detail}
                                  </p>
                                )}

                                {(step.target ||
                                  riskBadge ||
                                  (step.dependsOn && step.dependsOn.length > 0)) && (
                                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    {step.target && (
                                      <code className="px-1.5 py-0.5 rounded bg-white/[0.045] border border-white/[0.08] font-mono text-[10px] text-zinc-300">
                                        {step.target}
                                      </code>
                                    )}
                                    {riskBadge && (
                                      <span
                                        className={`px-1.5 py-0.5 rounded-full border text-[9.5px] font-medium ${riskBadge.cls}`}
                                      >
                                        {riskBadge.label}
                                      </span>
                                    )}
                                    {step.dependsOn?.map((depId) => (
                                      <span
                                        key={depId}
                                        className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.07] text-[10px] text-zinc-400"
                                      >
                                        Requiere: {stepTitleById.get(depId) ?? depId}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {step.comment && openCommentKey !== stepCommentKey && (
                                  <p className="text-[11px] text-amber-200 bg-amber-500/[0.08] border border-amber-400/20 rounded-lg px-2 py-1 mt-1">
                                    Nota: {step.comment}
                                  </p>
                                )}

                                {openCommentKey === stepCommentKey && (
                                  <div className="flex items-center gap-1.5 pt-1.5">
                                    <input
                                      autoFocus
                                      value={commentDraft}
                                      onChange={(e) => setCommentDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveStepComment(phase.id, step.id);
                                        if (e.key === "Escape") setOpenCommentKey(null);
                                      }}
                                      placeholder="Escribe una observación o ajuste para este paso..."
                                      className="flex-1 px-2.5 py-1 rounded-lg bg-black/65 border border-white/[0.16] text-[11px] text-white placeholder:text-zinc-500 outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => saveStepComment(phase.id, step.id)}
                                      className="quick-liquid-btn px-2 py-1 rounded-lg text-[10.5px] font-medium text-white cursor-pointer"
                                    >
                                      OK
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <DiagramCanvasView
            title={canvas.title}
            diagram={flowDiagram}
            onAskNode={(node) => onAskNode?.(node.label, node.detail)}
          />
        )}

        {/* Supuestos y Riesgos antes de aprobar */}
        {hasRisksOrAssumptions && subTab === "phases" && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRiskPanel((v) => !v)}
              className="w-full px-3.5 py-2 flex items-center justify-between text-left hover:bg-white/[0.025] cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                <ShieldAlert className="w-3.5 h-3.5 text-zinc-400" />
                <span>Supuestos y Riesgos</span>
              </span>
              {showRiskPanel ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </button>

            {showRiskPanel && (
              <div className="px-3.5 pb-3 pt-1 space-y-2.5 border-t border-white/[0.06]">
                {plan.risks && plan.risks.length > 0 && (
                  <div className="space-y-1.5">
                    {plan.risks.map((rk, rIdx) => {
                      const rb = getRiskBadge(rk.level);
                      return (
                        <div
                          key={`rk-${rIdx}`}
                          className="rounded-lg bg-white/[0.025] border border-white/[0.07] px-2.5 py-2 space-y-1"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {rb && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded-full border text-[9.5px] font-medium ${rb.cls}`}
                                  >
                                    {rb.label}
                                  </span>
                                )}
                                <p className="text-[11.5px] text-zinc-200">{rk.text}</p>
                              </div>
                              {rk.mitigation && (
                                <p className="text-[11px] text-zinc-400 mt-0.5">
                                  Mitigación: {rk.mitigation}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {plan.assumptions && plan.assumptions.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                      Supuestos considerados
                    </span>
                    <ul className="space-y-1">
                      {plan.assumptions.map((asm, aIdx) => (
                        <li
                          key={`asm-${aIdx}`}
                          className="text-[11.5px] text-zinc-300 flex items-start gap-1.5"
                        >
                          <span className="text-zinc-500 mt-0.5">•</span>
                          <span>{asm}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Barra inferior de revisión HITL estilo Antigravity */}
      {isReviewMode && (onApprovePlan || onRequestChanges) && (
        <div className="pt-2.5 border-t border-white/[0.08] space-y-2 shrink-0 bg-[#090a0e]">
          <input
            type="text"
            value={plan.reviewComment ?? ""}
            onChange={(e) =>
              onUpdatePlan({ ...plan, reviewComment: e.target.value })
            }
            placeholder="Nota general o cambio deseado antes de aprobar (opcional)..."
            className="w-full px-3 py-1.5 rounded-xl bg-white/[0.035] border border-white/[0.08] focus:border-white/25 text-[11.5px] text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors"
          />

          <div className="flex items-center justify-between gap-2">
            {onRequestChanges && (
              <button
                type="button"
                onClick={handleRequestChanges}
                className="quick-liquid-btn px-3 py-1.5 rounded-xl inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {stats.commentsCount > 0
                    ? `Pedir ajustes (${stats.commentsCount})`
                    : "Pedir ajustes"}
                </span>
              </button>
            )}

            {onApprovePlan && (
              <button
                type="button"
                disabled={stats.selected === 0}
                onClick={handleApprove}
                className="ml-auto px-4 py-1.5 rounded-xl inline-flex items-center gap-1.5 text-[12px] font-semibold bg-white text-black hover:bg-zinc-200 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Aprobar y ejecutar plan</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
