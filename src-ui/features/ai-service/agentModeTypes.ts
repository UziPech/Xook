export type XoxModeId = "agent" | "study" | "plan" | "audit" | "inspector" | "compact";

export type SubagentDesign = "star" | "prism" | "orbit" | "shield";

export type SubagentTeamMode = "dynamic" | "custom";

export interface SubagentProfile {
  id: string;
  name: string;
  role: string;
  model: string; // "auto" o ID específico de modelo (ej. "google/gemini-2.5-flash")
  design: SubagentDesign;
  enabled: boolean;
}

export interface SubagentActivity {
  id: string;
  name: string;
  role: string;
  model?: string;
  design: SubagentDesign;
  status: "pending" | "running" | "done" | "error";
  task?: string;
  summary?: string;
  durationMs?: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "done" | "error";
  assignee?: string;
}

export interface ChecklistState {
  id: string;
  title: string;
  mode?: XoxModeId | null;
  items: ChecklistItem[];
  updatedAt: number;
}

export interface StudyFlashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
}

export interface StudyQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface StudyDeckArtifact {
  id: string;
  topic: string;
  cards: StudyFlashcard[];
  quiz?: StudyQuizQuestion;
}

export const SUBAGENT_DESIGN_LABELS: Record<SubagentDesign, string> = {
  star: "Estelar",
  prism: "Prisma",
  orbit: "Orbital",
  shield: "Guardián",
};

export const DEFAULT_SUBAGENT_ROSTER: SubagentProfile[] = [
  {
    id: "sub_researcher",
    name: "Investigador de Datos",
    role: "Explora archivos, lee contexto y recopila evidencia real",
    model: "auto",
    design: "orbit",
    enabled: true,
  },
  {
    id: "sub_analyst",
    name: "Analista Estratégico",
    role: "Cruza métricas, cálculos y evalúa lógica de negocio",
    model: "auto",
    design: "prism",
    enabled: true,
  },
  {
    id: "sub_writer",
    name: "Redactor Ejecutivo",
    role: "Sintetiza hallazgos, crea tablas en Canvas o documentos",
    model: "auto",
    design: "star",
    enabled: true,
  },
  {
    id: "sub_auditor",
    name: "Auditor de Reglas",
    role: "Valida consistencia, riesgos y prepara aprobaciones HITL",
    model: "auto",
    design: "shield",
    enabled: true,
  },
];

export interface SubagentShapeGeometry {
  path: string;
  eyeY: number;
  sheen: { cx: number; cy: number; rx: number; ry: number; rot: number };
  ring: string | null;
}

export const SUBAGENT_SHAPE_GEOMETRY: Record<SubagentDesign, SubagentShapeGeometry> = {
  star: {
    path: "M 10 2.0 C 11.4 2.0 12.0 5.1 12.9 5.8 C 13.8 6.4 17.0 5.9 17.5 7.2 C 18.0 8.5 15.2 10.3 15.0 11.4 C 14.9 12.5 16.5 15.4 15.3 16.3 C 14.1 17.2 11.5 14.8 10.0 14.8 C 8.5 14.8 5.9 17.2 4.7 16.3 C 3.5 15.4 5.1 12.5 5.0 11.4 C 4.8 10.3 2.0 8.5 2.5 7.2 C 3.0 5.9 6.2 6.4 7.1 5.8 C 8.0 5.1 8.6 2.0 10 2.0 Z",
    eyeY: 10.0,
    sheen: { cx: 7.8, cy: 6.3, rx: 1.15, ry: 0.5, rot: -26 },
    ring: null,
  },
  prism: {
    path: "M 10 1.8 C 11.5 6.0 14.0 8.5 18.2 10.0 C 14.0 11.5 11.5 14.0 10.0 18.2 C 8.5 14.0 6.0 11.5 1.8 10.0 C 6.0 8.5 8.5 6.0 10 1.8 Z",
    eyeY: 10.0,
    sheen: { cx: 8.6, cy: 6.5, rx: 0.78, ry: 0.42, rot: -24 },
    ring: null,
  },
  shield: {
    path: "M 10 2.4 C 12.0 2.4 13.4 3.8 15.4 4.5 C 16.5 4.9 16.5 6.5 16.3 8.8 C 16.0 12.2 13.8 15.5 10.0 17.2 C 6.2 15.5 4.0 12.2 3.7 8.8 C 3.5 6.5 3.5 4.9 4.6 4.5 C 6.6 3.8 8.0 2.4 10 2.4 Z",
    eyeY: 9.35,
    sheen: { cx: 8.2, cy: 5.8, rx: 1.05, ry: 0.48, rot: -18 },
    ring: null,
  },
  orbit: {
    path: "M 10 4.3 C 13.7 4.3 15.7 6.3 15.7 10.0 C 15.7 13.7 13.7 15.7 10.0 15.7 C 6.3 15.7 4.3 13.7 4.3 10.0 C 4.3 6.3 6.3 4.3 10 4.3 Z",
    eyeY: 9.9,
    sheen: { cx: 7.9, cy: 6.7, rx: 1.05, ry: 0.48, rot: -24 },
    ring: "M 1.9 12.8 A 8.8 2.6 -22 1 0 18.1 7.2",
  },
};

export interface SubagentGlassStyle {
  tintHex: string;
  fill: string;
  stroke: string;
  highlight: string;
  eye: string;
  glow: string;
  cardBg: string;
  cardBorder: string;
  pillText: string;
}

export const SUBAGENT_GLASS_PALETTE: Record<SubagentDesign, SubagentGlassStyle> = {
  star: {
    tintHex: "#BAE6FD",
    fill: "rgba(186, 230, 253, 0.15)",
    stroke: "rgba(224, 242, 254, 0.84)",
    highlight: "rgba(255, 255, 255, 0.48)",
    eye: "rgba(255, 255, 255, 0.96)",
    glow: "rgba(186, 230, 253, 0.26)",
    cardBg: "rgba(186, 230, 253, 0.035)",
    cardBorder: "rgba(186, 230, 253, 0.17)",
    pillText: "rgba(224, 242, 254, 0.92)",
  },
  orbit: {
    tintHex: "#A7F3D0",
    fill: "rgba(167, 243, 208, 0.14)",
    stroke: "rgba(209, 250, 229, 0.82)",
    highlight: "rgba(255, 255, 255, 0.46)",
    eye: "rgba(255, 255, 255, 0.96)",
    glow: "rgba(167, 243, 208, 0.24)",
    cardBg: "rgba(167, 243, 208, 0.032)",
    cardBorder: "rgba(167, 243, 208, 0.16)",
    pillText: "rgba(209, 250, 229, 0.92)",
  },
  prism: {
    tintHex: "#DDD6FE",
    fill: "rgba(221, 214, 254, 0.14)",
    stroke: "rgba(237, 233, 254, 0.82)",
    highlight: "rgba(255, 255, 255, 0.46)",
    eye: "rgba(255, 255, 255, 0.96)",
    glow: "rgba(221, 214, 254, 0.24)",
    cardBg: "rgba(221, 214, 254, 0.032)",
    cardBorder: "rgba(221, 214, 254, 0.16)",
    pillText: "rgba(237, 233, 254, 0.92)",
  },
  shield: {
    tintHex: "#FDE68A",
    fill: "rgba(253, 230, 138, 0.13)",
    stroke: "rgba(254, 243, 199, 0.80)",
    highlight: "rgba(255, 255, 255, 0.44)",
    eye: "rgba(255, 255, 255, 0.96)",
    glow: "rgba(253, 230, 138, 0.22)",
    cardBg: "rgba(253, 230, 138, 0.03)",
    cardBorder: "rgba(253, 230, 138, 0.15)",
    pillText: "rgba(254, 243, 199, 0.90)",
  },
};
