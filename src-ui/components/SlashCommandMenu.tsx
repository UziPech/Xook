import React, { useMemo } from "react";
import {
  Bot,
  GraduationCap,
  ListChecks,
  ShieldCheck,
  Sparkles,
  Slash,
  X,
  ChevronRight,
} from "lucide-react";
import { LiquidGlassBackdrop } from "./LiquidGlassBackdrop";
import type { XoxModeId } from "../features/ai-service/agentModeTypes";

export type { XoxModeId };

export interface XoxCommandSpec {
  id: XoxModeId;
  slash: string;
  name: string;
  badge: string;
  description: string;
  hint: string;
  inputPlaceholder: string;
  promptPrefix: string;
  subagents?: Array<{ name: string; role: string; icon: string }>;
}

export const XOX_COMMAND_SPECS: Record<XoxModeId, XoxCommandSpec> = {
  agent: {
    id: "agent",
    slash: "/agent",
    name: "Orquestador Multi-Agente",
    badge: "Multi-Agente",
    description: "Despacha sub-agentes reales en paralelo con nombre, modelo y diseño propio + checklist en vivo.",
    hint: "Usa herramientas reales: spawn_subagent y agent_checklist_update",
    inputPlaceholder: "Modo Agente: Describe el objetivo que Xox y sus sub-agentes deben resolver...",
    promptPrefix: `[MODO AGENTE AUTÓNOMO (/agent)]:
Coordina un equipo de sub-agentes reales usando las herramientas \`agent_checklist_update\` y \`spawn_subagent\`:
1. Llama primero a \`agent_checklist_update\` para mostrar el plan en la tarjeta Checklist de la esquina derecha.
2. Despacha los sub-agentes necesarios con \`spawn_subagent\` (respetando los nombres, modelos y diseños del equipo configurado).
3. Actualiza la checklist con \`agent_checklist_update\` marcando cada paso completado (\`done\`) conforme avanzas.
4. Sintetiza los hallazgos reales y presenta acciones concretas.`,
    subagents: [
      { name: "Investigador", role: "Exploración de datos y archivos", icon: "orbit" },
      { name: "Analista", role: "Cálculos y reglas de negocio", icon: "prism" },
      { name: "Redactor", role: "Generación de documentos y PDF", icon: "star" },
      { name: "Auditor", role: "Validación de seguridad y consistencia", icon: "shield" },
    ],
  },
  study: {
    id: "study",
    slash: "/study",
    name: "Tutor Socrático & Academia",
    badge: "Modo Estudio",
    description: "Aprende a profundidad con guía paso a paso, flashcards rápidas y hojas de práctica/examen interactivas en Canvas.",
    hint: "Usa herramientas reales: create_form (cuestionario), study_create_deck y agent_checklist_update",
    inputPlaceholder: "Modo Estudio: ¿Qué tema, apunte o documento deseas aprender o practicar?...",
    promptPrefix: `[MODO ESTUDIO SOCRÁTICO (/study)]:
Actúa como Mentor Pedagógico Socrático de alto nivel con herramientas reales:
1. Usa \`agent_checklist_update\` para crear la ruta de aprendizaje en la esquina derecha (ej. Concepto, Analogía, Práctica, Repaso).
2. Según convenga:
   - Usa \`study_create_deck\` para tarjetas rápidas de memorización (flashcards) + 1 pregunta breve en el chat.
   - Usa \`create_form\` con \`purpose="study_quiz"\` cuando el usuario pida practicar, hacer un examen/cuestionario, resolver ejercicios o evaluar varios conceptos (permite opción múltiple, verdadero/falso, preguntas abiertas, pistas y explicaciones en Canvas).
3. En tu respuesta escrita, explica con una analogía clara, desglosa los conceptos y cierra con una pregunta socrática.`,
  },
  plan: {
    id: "plan",
    slash: "/plan",
    name: "Planificador de Tareas",
    badge: "Plan Maestro",
    description: "Crea un Plan visual en Canvas con fases, flujo de dependencias, riesgos y botón de aprobación antes de ejecutar.",
    hint: "Usa herramientas reales: create_plan y agent_checklist_update",
    inputPlaceholder: "Modo Plan: Describe el proyecto, flujo o meta que deseas planificar...",
    promptPrefix: `[MODO PLAN (/plan)]:
Diseña un Plan Maestro revisable ANTES de ejecutar cambios o modificar archivos:
1. Llama OBLIGATORIAMENTE a \`create_plan\` para presentar el plan estructurado en Canvas (objetivo, alcance, fases con pasos, dependencias, supuestos y riesgos) listo para revisión y aprobación del usuario.
2. Llama también a \`agent_checklist_update\` para mostrar el resumen de fases en la tarjeta Checklist de la esquina derecha.
3. No modifiques datos ni ejecutes acciones destructivas hasta que el usuario apruebe el plan.`,
  },
  audit: {
    id: "audit",
    slash: "/audit",
    name: "Auditoría de Negocio",
    badge: "Auditoría",
    description: "Inspección minuciosa de inventario, discrepancias, archivos y reglas Zero-Risk con reporte de checklist.",
    hint: "Usa herramientas reales: run_business_review, workspace_read y agent_checklist_update",
    inputPlaceholder: "Modo Auditoría: ¿Qué catálogo, archivos o reglas deseas auditar?...",
    promptPrefix: `[MODO AUDITORÍA ZERO-RISK (/audit)]:
Ejecuta una auditoría real y minuciosa sin modificar datos:
1. Registra los puntos de inspección en la esquina derecha usando \`agent_checklist_update\`.
2. Si hay workspace activo, invoca herramientas reales (\`run_business_review\`, \`workspace_list\`, \`workspace_read\`, \`workspace_search\`).
3. Marca como \`done\` cada punto verificado y entrega hallazgos por severidad (Alta, Media, Baja).`,
  },
  compact: {
    id: "compact",
    slash: "/compact",
    name: "Sintetizar & Limpiar Memoria",
    badge: "Memoria",
    description: "Extrae hechos duraderos a memoria persistente y compacta aprendizajes clave de la conversación.",
    hint: "Usa herramientas reales: memory_record_fact y agent_checklist_update",
    inputPlaceholder: "Modo Compact: Presiona Enter para sintetizar los aprendizajes clave...",
    promptPrefix: `[MODO COMPACT (/compact)]:
Sintetiza los aprendizajes, decisiones y preferencias clave de esta conversación:
1. Si hay hechos duraderos relevantes, usa \`memory_record_fact\` para guardarlos en memoria persistente.
2. Usa \`agent_checklist_update\` para resumir los acuerdos consolidados.
3. Entrega un resumen compacto y limpio para continuar sin perder contexto.`,
  },
};

export const XOX_COMMAND_LIST: XoxCommandSpec[] = Object.values(XOX_COMMAND_SPECS);

export function getCommandIcon(id: XoxModeId, className = "w-4 h-4") {
  switch (id) {
    case "agent":
      return <Bot className={className} />;
    case "study":
      return <GraduationCap className={className} />;
    case "plan":
      return <ListChecks className={className} />;
    case "audit":
      return <ShieldCheck className={className} />;
    case "compact":
      return <Sparkles className={className} />;
    default:
      return <Slash className={className} />;
  }
}

interface SlashCommandMenuProps {
  isOpen: boolean;
  filterQuery: string;
  selectedIndex: number;
  onSelect: (command: XoxCommandSpec) => void;
  onClose: () => void;
  menuRef?: React.RefObject<HTMLDivElement | null>;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  isOpen,
  filterQuery,
  selectedIndex,
  onSelect,
  onClose,
  menuRef,
}) => {
  const cleanFilter = filterQuery.replace(/^\//, "").trim().toLowerCase();

  const filteredCommands = useMemo(() => {
    if (!cleanFilter) return XOX_COMMAND_LIST;
    return XOX_COMMAND_LIST.filter(
      (cmd) =>
        cmd.slash.toLowerCase().includes(cleanFilter) ||
        cmd.id.toLowerCase().includes(cleanFilter) ||
        cmd.name.toLowerCase().includes(cleanFilter) ||
        cmd.description.toLowerCase().includes(cleanFilter)
    );
  }, [cleanFilter]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Comandos y modos de Xox"
      className="xook-liquid-menu menu-origin-left menu-in absolute left-0 bottom-full mb-2 w-80 sm:w-96 p-1.5 rounded-2xl z-30 shadow-2xl bg-[#090b10]/68 backdrop-blur-2xl border border-white/[0.09]"
    >
      <LiquidGlassBackdrop variant="menu" />

      <div className="relative z-[1] space-y-1">
        {/* Cabecera del menú en estilo neutro/monocromo */}
        <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-white/[0.07] mb-1">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-zinc-300">
              <Slash className="w-3 h-3" />
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-300">
              Comandos y Modos de Xox
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400">
              ↑ ↓ · Enter
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer transition-colors"
              title="Cerrar menú (Escape)"
              aria-label="Cerrar menú"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Lista de comandos filtrados con estética neutra sin gradientes */}
        <div className="max-h-64 overflow-y-auto space-y-0.5 pr-0.5">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-zinc-400">
              No hay comandos que coincidan con &ldquo;/{cleanFilter}&rdquo;
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(cmd)}
                  className={`quick-liquid-option w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left cursor-pointer transition-all ${
                    isSelected
                      ? "is-selected bg-white/[0.08] border border-white/[0.12]"
                      : "hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  {/* Contenedor neutro para el icono */}
                  <span
                    className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border transition-colors ${
                      isSelected
                        ? "bg-white/[0.1] border-white/[0.18] text-white"
                        : "bg-white/[0.04] border-white/[0.08] text-zinc-300"
                    }`}
                  >
                    {getCommandIcon(cmd.id, "w-3.5 h-3.5")}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-white tracking-wide">
                        {cmd.slash}
                      </span>
                      <span className="text-[9.5px] px-1.5 py-0.5 rounded-md font-medium text-zinc-300 bg-white/[0.05] border border-white/[0.08] shrink-0">
                        {cmd.badge}
                      </span>
                      {cmd.subagents && (
                        <span className="text-[9.5px] text-zinc-400 font-mono">
                          ({cmd.subagents.length} sub-agentes)
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-zinc-300/90 leading-snug line-clamp-2 mt-0.5">
                      {cmd.description}
                    </p>
                  </div>

                  {isSelected && (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-300 shrink-0 self-center" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Pie informativo neutro */}
        <div className="pt-1 border-t border-white/[0.06] px-2 text-[10px] text-zinc-400 flex items-center justify-between">
          <span>Esc para cerrar</span>
          <span className="text-zinc-500 font-mono">XOOK Agentic</span>
        </div>
      </div>
    </div>
  );
};

interface ActiveModeChipProps {
  spec: XoxCommandSpec;
  onDismiss: () => void;
  extraAction?: React.ReactNode;
}

export const ActiveModeChip: React.FC<ActiveModeChipProps> = ({
  spec,
  onDismiss,
  extraAction,
}) => {
  return (
    <div className="inline-flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-xl text-xs bg-white/[0.03] border border-white/[0.08] text-zinc-200 backdrop-blur-xl transition-all shadow-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 shrink-0" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-white tracking-wide">{spec.slash}</span>
        <span className="text-zinc-300 text-[11px] truncate">· {spec.name}</span>
      </div>

      {extraAction}

      <button
        type="button"
        onClick={onDismiss}
        title="Desactivar modo (Escape)"
        aria-label="Desactivar modo"
        className="ml-0.5 p-0.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
