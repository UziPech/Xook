import React from "react";
import { Plus, Trash2, X, RotateCcw, Sparkles, SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_SUBAGENT_ROSTER,
  SUBAGENT_DESIGN_LABELS,
  SUBAGENT_GLASS_PALETTE,
  SUBAGENT_SHAPE_GEOMETRY,
  type SubagentDesign,
  type SubagentProfile,
  type SubagentTeamMode,
} from "../features/ai-service/agentModeTypes";
import type { OpenRouterModelOption } from "../features/ai-service/aiClient";
import { LiquidGlassBackdrop } from "./LiquidGlassBackdrop";

/**
 * Mini-compañeros Xox translúcidos: cada sub-agente tiene una silueta única orgánica
 * con ojos brillantes y colores cristal super transparentes sin gradientes pesados.
 */
export const SubagentGlyph: React.FC<{
  design: SubagentDesign;
  className?: string;
  active?: boolean;
}> = ({ design, className = "w-4 h-4", active = false }) => {
  const safeDesign: SubagentDesign =
    design && design in SUBAGENT_GLASS_PALETTE ? design : "orbit";
  const pal = SUBAGENT_GLASS_PALETTE[safeDesign];
  const geom = SUBAGENT_SHAPE_GEOMETRY[safeDesign];
  const rimStroke = active ? "#FFFFFF" : pal.stroke;
  const fillCol = active ? pal.glow : pal.fill;

  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d={geom.path}
        fill={fillCol}
        stroke={rimStroke}
        strokeWidth="1.22"
        strokeLinejoin="round"
      />
      <circle cx="10" cy={geom.eyeY} r="3.6" fill={pal.glow} opacity="0.72" />
      {geom.ring && (
        <path
          d={geom.ring}
          stroke={rimStroke}
          strokeOpacity="0.88"
          strokeWidth="1.05"
          strokeLinecap="round"
        />
      )}
      <ellipse
        cx={geom.sheen.cx}
        cy={geom.sheen.cy}
        rx={geom.sheen.rx}
        ry={geom.sheen.ry}
        transform={`rotate(${geom.sheen.rot} ${geom.sheen.cx} ${geom.sheen.cy})`}
        fill={pal.highlight}
      />
      <ellipse cx="8.5" cy={geom.eyeY} rx="0.9" ry="1.38" fill={pal.eye} />
      <ellipse cx="11.5" cy={geom.eyeY} rx="0.9" ry="1.38" fill={pal.eye} />
      <circle cx="8.7" cy={geom.eyeY - 0.32} r="0.26" fill={pal.tintHex} />
      <circle cx="11.7" cy={geom.eyeY - 0.32} r="0.26" fill={pal.tintHex} />
    </svg>
  );
};

interface SubagentRosterPopoverProps {
  isOpen: boolean;
  teamMode: SubagentTeamMode;
  dynamicModel: string;
  roster: SubagentProfile[];
  models: OpenRouterModelOption[];
  onTeamModeChange: (mode: SubagentTeamMode) => void;
  onDynamicModelChange: (model: string) => void;
  onChange: (next: SubagentProfile[]) => void;
  onClose: () => void;
}

const DESIGNS: SubagentDesign[] = ["star", "prism", "orbit", "shield"];

export const SubagentRosterPopover: React.FC<SubagentRosterPopoverProps> = ({
  isOpen,
  teamMode,
  dynamicModel,
  roster,
  models,
  onTeamModeChange,
  onDynamicModelChange,
  onChange,
  onClose,
}) => {
  if (!isOpen) return null;

  const updateMember = (id: string, patch: Partial<SubagentProfile>) => {
    onChange(roster.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const addMember = () => {
    if (roster.length >= 6) return;
    const idx = roster.length + 1;
    onChange([
      ...roster,
      {
        id: `sub_${Date.now()}_${idx}`,
        name: `Especialista ${idx}`,
        role: "Especialista auxiliar según la tarea",
        model: "auto",
        design: DESIGNS[idx % DESIGNS.length],
        enabled: true,
      },
    ]);
  };

  const removeMember = (id: string) => {
    if (roster.length <= 1) return;
    onChange(roster.filter((m) => m.id !== id));
  };

  return (
    <div
      role="dialog"
      aria-label="Configurar equipo multi-agente"
      className="xook-liquid-menu menu-origin-left menu-in absolute left-0 bottom-full mb-2 w-[340px] sm:w-[440px] p-2.5 rounded-2xl z-30 shadow-2xl bg-[#090b10]/68 backdrop-blur-2xl border border-white/[0.09]"
    >
      <LiquidGlassBackdrop variant="menu" />

      <div className="relative z-[1] space-y-2.5">
        {/* Cabecera */}
        <div className="px-1.5 pb-1.5 flex items-center justify-between border-b border-white/[0.08]">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-200">
              Orquestación Multi-Agente
            </h4>
            <p className="text-[10px] text-zinc-400">
              Elige si Xox razona el equipo o usa agentes fijos
            </p>
          </div>

          <div className="flex items-center gap-1">
            {teamMode === "custom" && (
              <button
                type="button"
                onClick={() => onChange(DEFAULT_SUBAGENT_ROSTER)}
                title="Restablecer equipo predeterminado"
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar configuración de equipo"
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Selector Dinámico (estilo Claude) vs Fijo */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          <button
            type="button"
            onClick={() => onTeamModeChange("dynamic")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
              teamMode === "dynamic"
                ? "bg-white/[0.12] text-white border border-white/[0.16]"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Dinámico (Auto)</span>
          </button>

          <button
            type="button"
            onClick={() => onTeamModeChange("custom")}
            className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
              teamMode === "custom"
                ? "bg-white/[0.12] text-white border border-white/[0.16]"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Equipo Fijo ({roster.filter((r) => r.enabled).length})</span>
          </button>
        </div>

        {teamMode === "dynamic" ? (
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.07] p-3 space-y-2.5">
            <p className="text-[11.5px] text-zinc-300 leading-relaxed">
              Xox razona por sí solo qué especialistas requiere cada actividad, les asigna nombres
              claros según el problema y puede lanzar <strong className="text-white">sub-agentes adicionales</strong> si detecta un hueco durante la ejecución.
            </p>
            <div className="space-y-1">
              <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Modelo para sub-agentes dinámicos
              </label>
              <select
                value={dynamicModel}
                onChange={(e) => onDynamicModelChange(e.target.value)}
                className="w-full bg-white/[0.035] border border-white/[0.08] focus:border-white/[0.22] rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 focus:outline-none cursor-pointer"
              >
                <option value="auto">Automático (mismo modelo que Xox)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.is_free ? "(Gratis)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <>
            {/* Lista editable de agentes personalizados */}
            <div className="max-h-64 overflow-y-auto space-y-2 pr-0.5">
              {roster.map((member) => (
                <div
                  key={member.id}
                  className={`rounded-xl border p-2.5 space-y-2 transition-colors ${
                    member.enabled
                      ? "bg-white/[0.035] border-white/[0.1]"
                      : "bg-white/[0.015] border-white/[0.05] opacity-55"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.07] rounded-lg p-0.5">
                      {DESIGNS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => updateMember(member.id, { design: d })}
                          title={`Diseño ${SUBAGENT_DESIGN_LABELS[d]}`}
                          className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                            member.design === d
                              ? "bg-white/[0.11] text-white"
                              : "opacity-65 hover:opacity-100"
                          }`}
                        >
                          <SubagentGlyph design={d} active={member.design === d} className="w-4 h-4" />
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      value={member.name}
                      onChange={(e) => updateMember(member.id, { name: e.target.value })}
                      placeholder="Nombre del especialista"
                      maxLength={32}
                      className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] focus:border-white/[0.25] rounded-lg px-2 py-1 text-xs font-medium text-white focus:outline-none select-text"
                    />

                    <label className="inline-flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={member.enabled}
                        onChange={(e) => updateMember(member.id, { enabled: e.target.checked })}
                        className="accent-zinc-200 cursor-pointer"
                      />
                      <span>Activo</span>
                    </label>

                    {roster.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        title="Quitar sub-agente"
                        className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={member.role}
                      onChange={(e) => updateMember(member.id, { role: e.target.value })}
                      placeholder="Especialidad o tarea..."
                      maxLength={80}
                      className="bg-white/[0.03] border border-white/[0.07] focus:border-white/[0.2] rounded-lg px-2 py-1 text-[11px] text-zinc-300 focus:outline-none select-text"
                    />

                    <select
                      value={member.model}
                      onChange={(e) => updateMember(member.id, { model: e.target.value })}
                      className="bg-white/[0.035] border border-white/[0.08] focus:border-white/[0.22] rounded-lg px-2 py-1 text-[11px] text-zinc-200 focus:outline-none cursor-pointer"
                    >
                      <option value="auto">Modelo: Automático (Xox)</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} {m.is_free ? "(Gratis)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-1 border-t border-white/[0.07] flex items-center justify-between">
              <button
                type="button"
                onClick={addMember}
                disabled={roster.length >= 6}
                className="quick-liquid-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] text-zinc-200 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Agregar especialista</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 rounded-xl text-[11px] font-medium bg-white/[0.1] hover:bg-white/[0.16] text-white cursor-pointer transition-colors"
              >
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
