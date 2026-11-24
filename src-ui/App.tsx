import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useId, useCallback } from "react";
import { 
  CheckCircle2, 
  Brain, 
  Store, 
  Plus,
  Send,
  Zap,
  Check,
  X,
  FileText,
  ListTodo,
  PanelLeft,
  ChevronDown,
  ChevronLeft,
  AtSign,
  KeyRound,
  RefreshCw,
  MessageSquare,
  SquarePen,
  Table2,
  Slash,
  ScanSearch,
  Users,
  Layers,
  Sparkles,
  Loader2,
} from "lucide-react";
import { AssistDockMenu } from "./components/AssistDockMenu";
import {
  DEFAULT_ASSIST_STATUS,
  applyAssistLayout,
  exitAssistLayout,
  getAssistWindowState,
  listCompanionWindows,
  openAccessibilitySettings,
  rebalanceAssistSplit,
  requestAccessibilityPermission,
  setAssistAlwaysOnTop,
  type ApplyAssistLayoutPayload,
  type AssistWindowStatus,
  type CompanionWindowCandidate,
} from "./features/window-assist/windowAssistApi";
import {
  SlashCommandMenu,
  ActiveModeChip,
  XOX_COMMAND_SPECS,
  XOX_COMMAND_LIST,
  type XoxModeId,
} from "./components/SlashCommandMenu";
import { ChecklistCornerCard } from "./components/ChecklistCornerCard";
import { SubagentRosterPopover } from "./components/SubagentRosterPopover";
import { ComposerAttachmentTray } from "./components/ComposerAttachmentTray";
import { AttachmentPreviewDialog } from "./components/AttachmentPreviewDialog";
import {
  type AttachmentPreviewTarget,
  type ComposerAttachmentItem,
  type ComposerPastedTextAttachment,
  composeLlmMessageWithPastedText,
  createComposerFileItems,
  createPastedTextItem,
  derivePastedCardTitle,
  extractClipboardPayload,
  normalizePastedText,
  prepareImagePayload,
  revokeComposerAttachments,
  shouldGroupPastedText,
} from "./features/ai-service/composerAttachments";
import {
  DEFAULT_SUBAGENT_ROSTER,
  type ChecklistState,
  type SubagentProfile,
  type SubagentTeamMode,
} from "./features/ai-service/agentModeTypes";
import {
  XoxStar,
  XoxSilhouetteIcon,
  XoxState,
  XOX_ACCENT_PRESETS,
  getXoxBubbleVars,
  getXoxCosmosVars,
  resolveXoxAccentPreset,
  resolveXoxStateColors,
  type XoxAccentPreset,
  type XoxTerminalFeed,
} from "./components/XoxStar";
import {
  XoxFlightOverlay,
  type XoxFlightPoint,
  type XoxFlightSpec,
} from "./components/XoxFlightOverlay";
import {
  XoxStudioPanel,
  type MemoryLivePulse,
  type XoxStudioTabId,
} from "./features/xox-studio/XoxStudioPanel";
import {
  DEFAULT_GLOBAL_XOX_PROFILE,
  getGlobalXoxProfile,
  listXoxSkills,
  saveGlobalXoxProfile,
  subscribeGlobalXoxProfile,
  type GlobalXoxProfile,
  type XoxSkillEntry,
} from "./features/xox-studio/xoxStudioApi";
import { XookWordmark } from "./components/XookBrand";
import { SidebarChats } from "./features/sidebar/SidebarChats";
import { SidebarFooter, footerUsageText } from "./features/sidebar/SidebarFooter";
import { LiquidGlassBackdrop } from "./components/LiquidGlassBackdrop";
import { useAnimatedPresence } from "./hooks/useAnimatedPresence";
import {
  DEFAULT_IDLE_GREETING,
  getChatInputPlaceholder,
  getHeroGreeting,
  getTimeOfDayBand,
  getXoxBubbleGreeting,
  isSameLocalDay,
} from "./utils/xoxGreetings";
import {
  CanvasActionPayload,
  CanvasArtifact,
  CanvasVersionSnapshot,
  canvasHasCellData,
  cleanVisibleReply,
  evaluateFormFieldState,
  extractFirstHtmlTable,
  extractFirstMarkdownTable,
  formatFormAnswerForDisplay,
  gradeStudyForm,
  markdownTableToCanvasArtifact,
  resolveSelectedIndex,
  sanitizeCanvasArtifact,
} from "./features/canvas/canvasSchema";
import { evaluateSafeFormula, formatComputedValue } from "./features/canvas/safeFormulaEval";
import { CanvasPanel } from "./features/canvas/CanvasPanel";
import {
  PdfWorkspacePanel,
  type PdfWorkspacePanelState,
} from "./features/pdf-viewer/PdfWorkspacePanel";
import {
  AgendaItem,
  TaskHistoryItem,
  TaskProposal,
  computeVerifiedDecision,
  inferAlarmFromMisclassifiedTimer,
  parseScheduleTarget,
} from "./features/task-decisions/taskSchema";
import {
  ScheduledEventInput,
  TaskDecisionsPanel,
  TaskPanelTab,
} from "./features/task-decisions/TaskDecisionsPanel";
import {
  InventoryItem,
  LedgerAgendaItem,
  ReviewRun,
  completeAgendaItem,
  decideTaskHitl,
  deleteAgendaItem,
  hydrateWorkspaceLedger,
  importInventoryFile,
  listAgendaItems,
  listInventoryItems,
  listReviewRuns,
  recordHistoryEntry,
  resetTimerState,
  runBusinessReview,
  subscribeAgendaAndDatosEvents,
  subscribeLedgerUpdated,
  subscribeReviewUpdated,
  toggleTimerState,
  updateTaskProposal,
  upsertAgendaItem,
  upsertTasksBatch,
} from "./features/task-decisions/ledgerApi";
import {
  WorkspaceNodeEntry,
  WorkspaceOverview,
  createWorkspace,
  createWorkspaceFolder,
  downloadWorkspaceFile,
  exportCanvasToPdf,
  getWorkspaceOverview,
  isWorkspaceTauriRuntime,
  openWorkspaceFile,
  openWorkspaceFolder,
  readUniversalDocument,
  readWorkspaceBinaryPreview,
  readWorkspaceFile,
  renderPdfPreview,
  renameWorkspace,
  resolveCommandPermission,
  saveWorkspaceFile,
  stageWorkspaceAttachment,
  subscribePermissionEvents,
  subscribeWorkspaceUpdated,
  switchWorkspace,
  type PdfEditableBlock,
  type UniversalDocumentPayload,
  type UniversalDocumentSheet,
  type UniversalDocumentSlide,
} from "./features/workspace-store/workspaceApi";
import {
  SelectedWorkspaceFile,
  WorkspaceTreePanel,
} from "./features/workspace-store/WorkspaceTreePanel";
import {
  ChatMessageList,
  type UiChatAttachment,
  UiChatMessage,
} from "./features/ai-service/ChatMessageList";
import {
  CommandPermissionCard,
  applyCommandFinishedEvent,
  applyPermissionRequestItem,
  applyPermissionResolution,
  type CommandPermissionDecisionKind,
  type CommandPermissionUiItem,
} from "./features/ai-service/CommandPermissionCard";
import {
  appendReplyDeltaToTimeline,
  applyCommandFinishedInTimeline,
  finalizeChatTimeline,
  markPermissionErrorInTimeline,
  resolvePermissionInTimeline,
  timelineHasRequestId,
  upsertPermissionRequestInTimeline,
  type ChatTimelineSegment,
} from "@xook/contracts";
import {
  OpenRouterSettingsModal,
  type OpenRouterSettingsTab,
} from "./features/ai-service/OpenRouterSettingsModal";
import { ClarificationInputDock } from "./features/ai-service/ClarificationModal";
import { LocalAuthModal } from "./features/workspace-store/LocalAuthModal";
import {
  ConversationThread,
  LocalUserProfile,
  deleteLocalConversation,
  deleteUserMemoryFact,
  deriveConversationTitle,
  getLocalUserProfile,
  listLocalConversations,
  listUserMemoryFacts,
  saveLocalConversation,
  saveUserMemoryFact,
  subscribeLocalUserUpdated,
  subscribeUserMemoryUpdated,
  type UserMemoryCategory,
  type UserMemoryFact,
} from "./features/workspace-store/localStore";
import { ProviderIcon } from "./features/ai-service/ProviderIcon";
import {
  AiConfigStatus,
  AiConnectionTestResult,
  type AiProviderId,
  type AiUsageLedger,
  type AttachedContextItem,
  ClarificationSpec,
  type ContextCheckpoint,
  type ContextCompactedEvent,
  type DocumentContextSnapshot,
  type GeneratedOfficeDocumentEvent,
  type GeneratedPdfArtifact,
  type PdfDraftProgressEvent,
  OPENROUTER_PRESET_MODELS,
  OpenRouterModelOption,
  ThinkingStep,
  compactXoxContext,
  computeProviderUsageSummary,
  detectApiKeyInText,
  detectKeySetupIntentWithProvider,
  detectVaultConfigRequest,
  estimateTokens,
  extractErrorMessage,
  fetchOpenRouterModels,
  formatModelDisplay,
  formatPricePerMillion,
  formatTokenCount,
  getAiConfigStatus,
  getAiUsageLedger,
  getAvailableQuickModels,
  getLocalDailyRequestCount,
  getProviderSpec,
  getUsageMeterFillColor,
  incrementLocalDailyRequestCount,
  isStreamCancelledError,
  cancelXoxAiChatStream,
  XOOK_STREAM_CANCELLED_CODE,
  manageDocumentContext,
  normalizeApiKey,
  normalizeProviderIdClient,
  onAiUsageUpdated,
  runXoxAiChatStream,
  sanitizeGeneratedPdfArtifact,
  saveAiConfig,
  testAiConnection,
} from "./features/ai-service/aiClient";
import {
  SettingsModal,
  type SettingsTabId,
} from "./features/settings/SettingsModal";
import {
  getTtsStatus,
  isTauriTtsRuntime,
  subscribeTtsEvents,
  ttsPlayer,
  type TtsPlaybackSnapshot,
  type TtsStatus,
} from "./features/tts-voice/ttsClient";

const OFFICE_DOC_EXT_SET = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
]);
const BINARY_PREVIEW_EXT_SET = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "tif",
  "tiff",
  "heic",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "rtf",
  "odt",
  "ods",
  "odp",
  "zip",
]);

async function fileToBase64Payload(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function normalizeUniversalDocFromEvent(
  raw: Record<string, unknown> | null | undefined,
  fallback: {
    path: string;
    filename: string;
    title: string;
    format: string;
    sizeBytes?: number;
    pageCount?: number;
  }
): UniversalDocumentPayload | null {
  if (!raw || typeof raw !== "object" || raw.ok === false) return null;

  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks: PdfEditableBlock[] = rawBlocks
    .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
    .map((b) => ({
      type: String(b.type ?? "paragraph"),
      level: typeof b.level === "number" ? b.level : undefined,
      text:
        typeof b.text === "string"
          ? b.text
          : typeof b.content === "string"
            ? b.content
            : undefined,
      title: typeof b.title === "string" ? b.title : undefined,
      items: Array.isArray(b.items) ? b.items.map((x) => String(x ?? "")) : undefined,
      headers: Array.isArray(b.headers) ? b.headers.map((x) => String(x ?? "")) : undefined,
      rows: Array.isArray(b.rows)
        ? b.rows
            .filter((r): r is unknown[] => Array.isArray(r))
            .map((r) => r.map((c) => String(c ?? "")))
        : undefined,
    }));

  const slides: UniversalDocumentSlide[] = Array.isArray(raw.slides)
    ? raw.slides
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
        .map((s, idx) => ({
          slide_number: Number(s.slide_number ?? idx + 1),
          title: String(s.title ?? `Diapositiva ${idx + 1}`),
          bullets: Array.isArray(s.bullets) ? s.bullets.map((x) => String(x ?? "")) : [],
          tables: Array.isArray(s.tables)
            ? s.tables
                .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === "object"))
                .map((t) => ({
                  headers: Array.isArray(t.headers) ? t.headers.map((x) => String(x ?? "")) : [],
                  rows: Array.isArray(t.rows)
                    ? t.rows
                        .filter((r): r is unknown[] => Array.isArray(r))
                        .map((r) => r.map((c) => String(c ?? "")))
                    : [],
                }))
            : [],
          notes: typeof s.notes === "string" ? s.notes : "",
        }))
    : [];

  const sheets: UniversalDocumentSheet[] = Array.isArray(raw.sheets)
    ? raw.sheets
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
        .map((s, idx) => ({
          name: String(s.name ?? `Hoja ${idx + 1}`),
          headers: Array.isArray(s.headers) ? s.headers.map((x) => String(x ?? "")) : [],
          rows: Array.isArray(s.rows)
            ? s.rows
                .filter((r): r is unknown[] => Array.isArray(r))
                .map((r) => r.map((c) => String(c ?? "")))
            : [],
          total_rows: typeof s.total_rows === "number" ? s.total_rows : undefined,
          truncated: Boolean(s.truncated),
        }))
    : [];

  const fmt = (fallback.format || "").toLowerCase().replace(/^\./, "");
  const fallbackKind: UniversalDocumentPayload["docKind"] =
    fmt === "xlsx" || fmt === "xls" || fmt === "ods" || fmt === "csv" || fmt === "tsv"
      ? "spreadsheet"
      : fmt === "pptx" || fmt === "ppt" || fmt === "odp"
        ? "presentation"
        : fmt === "docx" || fmt === "doc" || fmt === "rtf" || fmt === "odt"
          ? "word"
          : "text";

  const rawKind = String(raw.docKind ?? raw.doc_kind ?? "").trim().toLowerCase();
  const docKind: UniversalDocumentPayload["docKind"] =
    rawKind === "word" ||
    rawKind === "presentation" ||
    rawKind === "spreadsheet" ||
    rawKind === "markdown" ||
    rawKind === "code" ||
    rawKind === "text"
      ? rawKind
      : fallbackKind;

  return {
    ok: true,
    path: String(raw.path ?? fallback.path),
    filename: String(raw.filename ?? fallback.filename),
    title: String(raw.title ?? fallback.title),
    sizeBytes: Number(raw.sizeBytes ?? raw.size_bytes ?? fallback.sizeBytes ?? 0),
    pageCount: Number(raw.pageCount ?? raw.page_count ?? fallback.pageCount ?? 1),
    docKind,
    formatLabel: String(
      raw.formatLabel ?? raw.format_label ?? (fmt ? fmt.toUpperCase() : "DOC")
    ),
    blocks,
    slides,
    sheets,
    markdown: typeof raw.markdown === "string" ? raw.markdown : "",
    text: typeof raw.text === "string" ? raw.text : "",
  };
}

function mergeCanvasWithVersionHistory(
  prev: CanvasArtifact | null | undefined,
  incoming: CanvasArtifact,
): CanvasArtifact {
  if (!prev || prev.id !== incoming.id) {
    return incoming;
  }
  if (prev.updatedAt && incoming.updatedAt && prev.updatedAt === incoming.updatedAt) {
    return {
      ...incoming,
      ...(prev.versions?.length ? { versions: prev.versions } : {}),
    };
  }
  const existingVersions = prev.versions ?? [];
  const prevClean: CanvasArtifact = { ...prev, versions: undefined };
  const snapshot: CanvasVersionSnapshot = {
    version: existingVersions.length + 1,
    updatedAt: prev.updatedAt,
    summary: prev.summary,
    artifact: prevClean,
  };
  return {
    ...incoming,
    versions: [...existingVersions, snapshot].slice(-12),
  };
}

function buildPdfSpecFromCanvas(canvas: CanvasArtifact): Record<string, unknown> {
  const blocks: Array<Record<string, unknown>> = [];
  if (canvas.summary?.trim()) {
    blocks.push({
      type: "callout",
      title: "Resumen ejecutivo",
      text: canvas.summary.trim(),
      tone: "info",
    });
  }
  if (canvas.plan) {
    const p = canvas.plan;
    if (p.scope && p.scope.length > 0) {
      blocks.push({
        type: "callout",
        title: "Alcance",
        text: p.scope.join(", "),
        tone: "info",
      });
    }
    p.phases.forEach((ph, idx) => {
      blocks.push({ type: "heading", level: 1, text: `Fase ${idx + 1}: ${ph.title}` });
      if (ph.summary) {
        blocks.push({ type: "paragraph", text: ph.summary });
      }
      ph.steps.forEach((st) => {
        const mark = st.status === "done" || st.checked ? "[x]" : "[ ]";
        const targetTxt = st.target ? ` (${st.target})` : "";
        blocks.push({
          type: "paragraph",
          text: `${mark} ${st.title}${targetTxt}${st.detail ? ` — ${st.detail}` : ""}`,
        });
      });
    });
    if (p.risks && p.risks.length > 0) {
      blocks.push({ type: "heading", level: 2, text: "Riesgos identificados" });
      p.risks.forEach((r) => {
        blocks.push({
          type: "paragraph",
          text: `[${r.level.toUpperCase()}] ${r.text}${r.mitigation ? ` · Mitigación: ${r.mitigation}` : ""}`,
        });
      });
    }
  }
  if (canvas.diagram) {
    blocks.push({ type: "heading", level: 1, text: "Estructura del diagrama" });
    canvas.diagram.nodes.forEach((n, idx) => {
      const outs = canvas.diagram!.edges
        .filter((e) => e.from === n.id)
        .map((e) => {
          const targetNode = canvas.diagram!.nodes.find((x) => x.id === e.to);
          return `${e.label ? `${e.label} -> ` : ""}${targetNode?.label ?? e.to}`;
        });
      blocks.push({
        type: "paragraph",
        text: `${idx + 1}. ${n.label}${n.detail ? `: ${n.detail}` : ""}${outs.length > 0 ? ` [Continúa hacia: ${outs.join("; ")}]` : ""}`,
      });
    });
  }
  if (canvas.dashboard) {
    const d = canvas.dashboard;
    if (d.kpis.length > 0) {
      blocks.push({
        type: "kpi_strip",
        items: d.kpis.slice(0, 4).map((k) => ({
          label: k.label,
          value: k.delta ? `${k.value} (${k.delta})` : k.value,
        })),
      });
    }
    d.charts.forEach((ch) => {
      blocks.push({ type: "heading", level: 2, text: ch.title });
      blocks.push({
        type: "table",
        headers: ["Categoría", ...ch.series.map((s) => s.name)],
        rows: ch.categories.map((cat, idx) => [
          cat,
          ...ch.series.map((s) => String(s.values[idx] ?? 0)),
        ]),
      });
    });
    if (d.insights && d.insights.length > 0) {
      d.insights.forEach((ins) => {
        blocks.push({
          type: "callout",
          title: ins.title || "Hallazgo clave",
          text: ins.text,
          tone: ins.tone === "warning" || ins.tone === "critical" ? "warning" : "info",
        });
      });
    }
  }
  if (canvas.form) {
    const f = canvas.form;
    if (f.score && f.score.gradableCount > 0) {
      blocks.push({
        type: "callout",
        title: "Resultado",
        text: `${f.score.correctCount} de ${f.score.gradableCount} correctas (${f.score.earned}/${f.score.total} pts · ${f.score.percent}%)`,
        tone: "info",
      });
    }
    f.fields.forEach((field, idx) => {
      blocks.push({
        type: "heading",
        level: 2,
        text: `${idx + 1}. ${field.label}${field.required ? " *" : ""}`,
      });
      if (field.options && field.options.length > 0) {
        const userVal = f.answers?.[field.id];
        const pickedSingle = resolveSelectedIndex(field, userVal);
        const pickedMulti = Array.isArray(userVal) ? new Set(userVal) : null;
        blocks.push({
          type: "bullets",
          items: field.options.map((opt, oIdx) => {
            const isPicked =
              field.type === "multi_choice"
                ? Boolean(pickedMulti?.has(oIdx))
                : pickedSingle === oIdx;
            const mark = isPicked ? "[x]" : "[ ]";
            return `${mark} ${opt}`;
          }),
        });
      } else {
        const answerStr = formatFormAnswerForDisplay(field, f.answers?.[field.id]);
        blocks.push({ type: "paragraph", text: `Respuesta: ${answerStr}` });
      }
      if ((f.checkedLocally || f.submitted) && field.explanation) {
        blocks.push({
          type: "callout",
          title: "Explicación",
          text: field.explanation,
          tone: "info",
        });
      }
    });
  }
  if (canvas.blocks && canvas.blocks.length > 0) {
    canvas.blocks.forEach((blk) => {
      if (blk.title) blocks.push({ type: "heading", level: 2, text: blk.title });
      if (blk.type === "callout") {
        blocks.push({
          type: "callout",
          title: blk.title || undefined,
          text: blk.text,
          tone: blk.tone === "critical" ? "warning" : blk.tone || "info",
        });
      } else if (blk.type === "markdown") {
        blocks.push({ type: "paragraph", text: blk.content });
      } else if (blk.type === "table" && blk.columns.length > 0 && blk.rows.length > 0) {
        blocks.push({
          type: "table",
          headers: blk.columns.map((c) => c.label),
          rows: blk.rows.map((r) => blk.columns.map((c) => String(r.cells[c.id] ?? ""))),
        });
      } else if (blk.type === "interactive") {
        const sub = buildPdfSpecFromCanvas({
          id: canvas.id,
          title: blk.title || canvas.title,
          kind: "interactive",
          columns: [],
          rows: [],
          interactive: blk.interactive,
          updatedAt: canvas.updatedAt,
        });
        if (Array.isArray(sub.blocks)) blocks.push(...(sub.blocks as Array<Record<string, unknown>>));
      } else if (blk.type === "dashboard") {
        const sub = buildPdfSpecFromCanvas({
          id: canvas.id,
          title: blk.title || canvas.title,
          kind: "dashboard",
          columns: [],
          rows: [],
          dashboard: blk.dashboard,
          updatedAt: canvas.updatedAt,
        });
        if (Array.isArray(sub.blocks)) blocks.push(...(sub.blocks as Array<Record<string, unknown>>));
      } else if (blk.type === "plan") {
        const sub = buildPdfSpecFromCanvas({
          id: canvas.id,
          title: blk.title || canvas.title,
          kind: "plan",
          columns: [],
          rows: [],
          plan: blk.plan,
          updatedAt: canvas.updatedAt,
        });
        if (Array.isArray(sub.blocks)) blocks.push(...(sub.blocks as Array<Record<string, unknown>>));
      } else if (blk.type === "diagram") {
        const sub = buildPdfSpecFromCanvas({
          id: canvas.id,
          title: blk.title || canvas.title,
          kind: "diagram",
          columns: [],
          rows: [],
          diagram: blk.diagram,
          updatedAt: canvas.updatedAt,
        });
        if (Array.isArray(sub.blocks)) blocks.push(...(sub.blocks as Array<Record<string, unknown>>));
      } else if (blk.type === "form") {
        const sub = buildPdfSpecFromCanvas({
          id: canvas.id,
          title: blk.title || canvas.title,
          kind: "form",
          columns: [],
          rows: [],
          form: blk.form,
          updatedAt: canvas.updatedAt,
        });
        if (Array.isArray(sub.blocks)) blocks.push(...(sub.blocks as Array<Record<string, unknown>>));
      }
    });
  }
  if (canvas.interactive) {
    const inter = canvas.interactive;
    if (inter.description) blocks.push({ type: "paragraph", text: inter.description });
    if (inter.computed && inter.computed.length > 0) {
      blocks.push({
        type: "kpi_strip",
        items: inter.computed.slice(0, 6).map((c) => {
          const res = evaluateSafeFormula(c.expr, inter.state);
          return {
            label: c.label,
            value: formatComputedValue(res.value, c.format, c.unit),
          };
        }),
      });
    }
    if (inter.controls.length > 0) {
      blocks.push({ type: "heading", level: 2, text: "Parámetros del escenario" });
      blocks.push({
        type: "table",
        headers: ["Control", "Valor"],
        rows: inter.controls.map((ctrl) => [
          ctrl.label,
          `${ctrl.prefix ?? ""}${String(inter.state[ctrl.stateKey] ?? "—")}${ctrl.unit ? ` ${ctrl.unit}` : ""}`,
        ]),
      });
    }
  }
  if (canvas.customApp) {
    const app = canvas.customApp;
    if (app.description) blocks.push({ type: "paragraph", text: app.description });
    if (app.state && Object.keys(app.state).length > 0) {
      blocks.push({ type: "heading", level: 2, text: "Estado capturado de la mini-app" });
      blocks.push({
        type: "table",
        headers: ["Variable", "Valor"],
        rows: Object.entries(app.state).map(([k, v]) => [
          k,
          typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v),
        ]),
      });
    }
  }
  if (canvas.columns.length > 0 && canvas.rows.length > 0) {
    blocks.push({ type: "heading", level: 1, text: "Detalle comparativo" });
    blocks.push({
      type: "table",
      headers: canvas.columns.map((c) => c.label),
      rows: canvas.rows.map((r) =>
        canvas.columns.map((c) => String(r.cells[c.id] ?? ""))
      ),
    });
  }
  return {
    title: canvas.title || "Reporte",
    subtitle: canvas.subtitle || undefined,
    theme: "executive",
    cover: { enabled: false },
    blocks,
    ...(canvas.columns.length === 0 &&
    !canvas.plan &&
    !canvas.diagram &&
    !canvas.dashboard &&
    !canvas.form &&
    !canvas.interactive &&
    !canvas.customApp &&
    !(canvas.blocks && canvas.blocks.length > 0) &&
    canvas.markdown?.trim()
      ? { markdown: canvas.markdown.trim() }
      : {}),
  };
}

interface MemoryPattern {
  pattern_id: string;
  description: string;
  confidence: number;
}

interface ContextItem {
  id: string;
  name: string;
  type: "profile" | "memory" | "skill" | "catalog";
  path: string;
  pinned: boolean;
  content: string;
  isCustom?: boolean;
}

// Etiquetas legibles por tipo de fuente de contexto (sin jerga técnica)
const CONTEXT_LABEL: Record<ContextItem["type"], string> = {
  profile: "Reglas de tienda",
  memory: "Memoria",
  skill: "Asesor de stock",
  catalog: "Catálogo",
};

function ContextIcon({ type, className = "w-3.5 h-3.5 text-zinc-400 shrink-0" }: { type: ContextItem["type"]; className?: string }) {
  switch (type) {
    case "profile":
      return <Store className={className} />;
    case "memory":
      return <Brain className={className} />;
    case "skill":
      return <Zap className={className} />;
    case "catalog":
      return <FileText className={className} />;
  }
}

// Miniatura del rostro de Xox para la identidad de marca en el panel lateral (silueta fiel al cuerpo estelar y expresión)
const XOX_MINI_STAR_PATH =
  "M118.1 67.6Q126.8 55.4 132.4 69.3L137.9 82.7Q142.8 94.7 155.2 98.6L167.3 102.4Q181.6 106.9 170.2 116.6L160.1 125.0Q150.1 133.4 149.7 146.4L149.5 155.2Q149.0 170.2 135.4 163.8L130.5 161.5Q118.7 156.0 106.7 160.9L100.9 163.3Q87.0 168.9 87.7 153.9L88.2 143.7Q88.8 130.7 79.7 121.4L69.6 111.0Q59.1 100.2 73.8 97.3L88.2 94.4Q101.0 91.8 108.5 81.2Z";

function XoxHeaderFace({
  state,
  onClick,
  agentName = "Xox",
  accentPreset = "classic",
}: {
  state: XoxState;
  onClick?: () => void;
  agentName?: string;
  accentPreset?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    body: `xox-mini-body-${uid}`,
    rim: `xox-mini-rim-${uid}`,
    core: `xox-mini-core-${uid}`,
    blush: `xox-mini-blush-${uid}`,
  };
  const colors = resolveXoxStateColors(accentPreset, state);
  const isAlert = state === "alert";
  const isSuccess = state === "success";
  const isTalking = state === "talking";
  const isThinking = state === "thinking";
  const isSyncing = state === "syncing";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${agentName}, asistente de XOOK`}
      title={`${agentName} · Haz clic para saludar`}
      className="group w-[26px] h-[26px] shrink-0 flex items-center justify-center cursor-pointer transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-full"
    >
      <svg viewBox="55 52 130 126" className="block w-full h-full" aria-hidden="true">
        <defs>
          <linearGradient id={ids.body} x1="64" y1="58" x2="176" y2="172" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="24%" stopColor={colors.bodyTint} stopOpacity="0.10" />
            <stop offset="52%" stopColor="#050814" stopOpacity="0.16" />
            <stop offset="84%" stopColor={colors.bodyGlow} stopOpacity="0.16" />
            <stop offset="100%" stopColor={colors.rim2} stopOpacity="0.24" />
          </linearGradient>
          <linearGradient id={ids.rim} x1="62" y1="58" x2="176" y2="172" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.94" />
            <stop offset="32%" stopColor={colors.rim1} stopOpacity="0.54" />
            <stop offset="62%" stopColor={colors.rim2} stopOpacity="0.28" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.70" />
          </linearGradient>
          <radialGradient id={ids.core} cx="50%" cy="56%" r="52%">
            <stop offset="0%" stopColor={isThinking || isAlert || isSuccess || isSyncing ? colors.glow : colors.bodyGlow} stopOpacity="0.26" />
            <stop offset="58%" stopColor={colors.glow} stopOpacity="0.10" />
            <stop offset="100%" stopColor={colors.glow} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ids.blush} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colors.blush} stopOpacity="0.64" />
            <stop offset="55%" stopColor={colors.blush} stopOpacity="0.24" />
            <stop offset="100%" stopColor={colors.blush} stopOpacity="0" />
          </radialGradient>
        </defs>

        <path
          d={XOX_MINI_STAR_PATH}
          fill={isAlert ? "rgba(239,68,68,0.24)" : `url(#${ids.body})`}
          stroke={isAlert ? "#F87171" : `url(#${ids.rim})`}
          strokeWidth="3.3"
          strokeLinejoin="round"
        />

        <circle cx="120" cy="120" r="32" fill={`url(#${ids.core})`} />

        {/* Reflejo especular curvo de gota Liquid Glass */}
        <path
          d="M 93 99 Q 104 89 117 95 Q 105 93 93 99 Z"
          fill="#FFFFFF"
          opacity="0.62"
        />

        {/* Mejillas con sonrojo difuminado al interactuar o en sucesos */}
        <g
          className={`transition-opacity duration-300 ${
            isAlert
              ? "opacity-0"
              : isSuccess
                ? "opacity-75"
                : isTalking
                  ? "opacity-60"
                  : "opacity-0 group-hover:opacity-55"
          }`}
        >
          <ellipse cx="99.5" cy="127" rx="9.5" ry="5.8" transform="rotate(-8 99.5 127)" fill={`url(#${ids.blush})`} />
          <ellipse cx="140.5" cy="127" rx="9.5" ry="5.8" transform="rotate(8 140.5 127)" fill={`url(#${ids.blush})`} />
        </g>

        {/* Ojos limpios sin pupila (ambas capas montadas con transición suave de opacidad) */}
        <g
          className={`transition-opacity duration-200 ${
            isSuccess ? "opacity-100" : "opacity-0"
          }`}
        >
          <path d="M103.5 117.5 C106 109.5 114.5 109.2 117 116.8" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M123 116.8 C125.5 109.2 134 109.5 136.5 117.5" stroke="#FFFFFF" strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <path d="M113 128 Q120 135.5 127 128" stroke="#FFFFFF" strokeWidth="3.8" strokeLinecap="round" fill="none" opacity="0.95" />
        </g>
        <g
          className={`transition-opacity duration-200 ${
            isSuccess ? "opacity-0" : "opacity-100"
          }`}
        >
          <g transform="translate(110.5 115)">
            <g className="xox-mini-eye">
              <ellipse cx="0" cy="0" rx="5.1" ry="7.8" fill="#FFFFFF" opacity="0.98" />
            </g>
          </g>
          <g transform="translate(129.5 115)">
            <g className="xox-mini-eye">
              <ellipse cx="0" cy="0" rx="5.1" ry="7.8" fill="#FFFFFF" opacity="0.98" />
            </g>
          </g>
        </g>
      </svg>
    </button>
  );
}

export default function App() {
  const [tasks, setTasks] = useState<TaskProposal[]>([]);
  const [agendaItems, setAgendaItems] = useState<LedgerAgendaItem[]>([]);
  const [historyItems, setHistoryItems] = useState<TaskHistoryItem[]>([]);
  const agendaItemsRef = useRef<LedgerAgendaItem[]>(agendaItems);
  agendaItemsRef.current = agendaItems;
  const suppressLedgerSyncUntilRef = useRef<number>(0);
  const paramSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [patterns, setPatterns] = useState<MemoryPattern[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [latestReview, setLatestReview] = useState<ReviewRun | null>(null);
  const [isReviewRunning, setIsReviewRunning] = useState<boolean>(false);
  const [permissionItems, setPermissionItems] = useState<CommandPermissionUiItem[]>([]);
  const activeStreamIdRef = useRef<string | null>(null);
  const activeAssistantMsgIdRef = useRef<string | null>(null);
  const activeTimelineRef = useRef<ChatTimelineSegment[]>([]);
  const permissionEventHandlersRef = useRef<{
    onRequest: (req: Parameters<typeof applyPermissionRequestItem>[1]) => void;
    onFinished: (ev: Parameters<typeof applyCommandFinishedEvent>[1]) => void;
  }>({
    onRequest: () => {},
    onFinished: () => {},
  });
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const [workspaceOverview, setWorkspaceOverview] = useState<WorkspaceOverview | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState<boolean>(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<SelectedWorkspaceFile | null>(null);
  const selectedWorkspacePathRef = useRef<string | null>(null);
  selectedWorkspacePathRef.current = selectedWorkspaceFile?.relativePath ?? null;
  const [pinnedWorkspacePaths, setPinnedWorkspacePaths] = useState<Set<string>>(
    () => new Set(["empresa/perfil.json", "empresa/reglas/operacion.md"])
  );
  const [highlightedWorkspacePath, setHighlightedWorkspacePath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(false);
  const [inputPrompt, setInputPrompt] = useState<string>("");
  
  // Estado de Xox (Mascota Digital y Orquestador Estelar)
  const [xoxState, setXoxState] = useState<XoxState>("idle");
  const [xoxTerminalFeed, setXoxTerminalFeed] = useState<XoxTerminalFeed | null>(null);
  const [xoxMessage, setXoxMessage] = useState<string>(DEFAULT_IDLE_GREETING);
  const [globalXoxProfile, setGlobalXoxProfile] = useState<GlobalXoxProfile>(
    DEFAULT_GLOBAL_XOX_PROFILE
  );
  const globalXoxProfileRef = useRef<GlobalXoxProfile>(globalXoxProfile);
  globalXoxProfileRef.current = globalXoxProfile;
  const [xoxSkills, setXoxSkills] = useState<XoxSkillEntry[]>([]);
  const [showXoxStudio, setShowXoxStudio] = useState<boolean>(false);
  const showXoxStudioRef = useRef<boolean>(showXoxStudio);
  showXoxStudioRef.current = showXoxStudio;
  const [xoxStudioTab, setXoxStudioTab] = useState<XoxStudioTabId>("identity");
  const [isMemoryWideMode, setIsMemoryWideMode] = useState<boolean>(false);
  const [memoryLivePulse, setMemoryLivePulse] = useState<MemoryLivePulse | null>(null);
  const suppressMemorySyncPulseUntilRef = useRef<number>(0);
  const triggerMemoryLivePulse = useCallback(
    (
      action: MemoryLivePulse["action"],
      source: MemoryLivePulse["source"],
      label?: string
    ) => {
      setMemoryLivePulse((prev) => ({
        seq: (prev?.seq ?? 0) + 1,
        action,
        source,
        label: label?.trim() ? label.trim() : undefined,
      }));
    },
    []
  );
  const [highlightedSkillSlug, setHighlightedSkillSlug] = useState<string | null>(null);
  const [previewAccentPreset, setPreviewAccentPreset] = useState<XoxAccentPreset | null>(null);
  const [xoxTravelPhase, setXoxTravelPhase] = useState<"idle" | "to-studio" | "from-studio">("idle");
  const [xoxGlideSeq, setXoxGlideSeq] = useState<number>(0);
  const [xoxExitingStage, setXoxExitingStage] = useState<boolean>(false);
  const [xoxFlight, setXoxFlight] = useState<XoxFlightSpec | null>(null);
  const [xoxFlightPending, setXoxFlightPending] = useState<boolean>(false);
  const xoxInFlight = Boolean(xoxFlight) || xoxFlightPending;
  const xoxFlightIdRef = useRef<number>(0);
  const pendingXoxFlightRef = useRef<{
    direction: "to-studio";
    from: XoxFlightPoint;
  } | null>(null);
  const lastChatXoxSnapshotRef = useRef<{
    cx: number;
    cy: number;
    size: number;
    viewportH: number;
    isHero: boolean;
  } | null>(null);
  const prevShowStudioRef = useRef<boolean>(false);

  const [activeMode, setActiveMode] = useState<XoxModeId | null>(null);
  const activeModeSpec = activeMode ? XOX_COMMAND_SPECS[activeMode] : null;
  const [activeChecklist, setActiveChecklist] = useState<ChecklistState | null>(null);
  const [checklistCollapsed, setChecklistCollapsed] = useState<boolean>(false);
  const [subagentTeamMode, setSubagentTeamMode] = useState<SubagentTeamMode>("dynamic");
  const [dynamicSubagentModel, setDynamicSubagentModel] = useState<string>("auto");
  const [subagentRoster, setSubagentRoster] = useState<SubagentProfile[]>(() => DEFAULT_SUBAGENT_ROSTER);
  const [showRosterPopover, setShowRosterPopover] = useState<boolean>(false);
  const rosterPopoverRef = useRef<HTMLDivElement>(null);

  const effectiveSubagentRoster = useMemo<SubagentProfile[] | undefined>(() => {
    if (activeMode !== "agent") return undefined;
    if (subagentTeamMode === "custom") return subagentRoster;
    if (dynamicSubagentModel && dynamicSubagentModel !== "auto") {
      return [
        {
          id: "dyn_pref",
          name: "__dynamic_default__",
          role: "Modelo preferido",
          model: dynamicSubagentModel,
          design: "orbit",
          enabled: true,
        },
      ];
    }
    return undefined;
  }, [activeMode, subagentTeamMode, subagentRoster, dynamicSubagentModel]);

  const handleToggleChecklistItem = (itemId: string) => {
    setActiveChecklist((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        updatedAt: Date.now(),
        items: prev.items.map((it) =>
          it.id === itemId
            ? { ...it, status: it.status === "done" ? "pending" : "done" }
            : it
        ),
      };
    });
  };

  const effectiveAgentName =
    globalXoxProfile.agentName.trim() || workspaceOverview?.profile.agentName || "Xox";
  const effectiveAccentPreset = resolveXoxAccentPreset(globalXoxProfile.accentPreset);
  const displayAccentPreset =
    showXoxStudio && previewAccentPreset ? previewAccentPreset : effectiveAccentPreset;

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const measureFlightPoint = (selector: string): XoxFlightPoint | null => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return null;
    if (
      r.bottom < 0 ||
      r.top > window.innerHeight ||
      r.right < 0 ||
      r.left > window.innerWidth
    ) {
      return null;
    }
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      size: r.width,
    };
  };

  const getStudioRightEdge = () => {
    const rightSplitter = document.querySelector<HTMLElement>(
      '[data-xox-right-splitter][data-xox-right-open="true"]'
    );
    if (rightSplitter) {
      const r = rightSplitter.getBoundingClientRect();
      if (r.left > 0) return r.left;
    }
    const mainRow = document.querySelector<HTMLElement>("[data-xox-main-row]");
    return mainRow ? mainRow.getBoundingClientRect().right : window.innerWidth;
  };

  useEffect(() => {
    if (prevShowStudioRef.current === showXoxStudio) return;
    prevShowStudioRef.current = showXoxStudio;
    if (showXoxStudio) {
      setXoxTravelPhase("to-studio");
      setXoxExitingStage(true);
      setXoxGlideSeq((n) => n + 1);
      const t = window.setTimeout(() => setXoxExitingStage(false), 380);
      return () => window.clearTimeout(t);
    }
    pendingXoxFlightRef.current = null;
    setXoxFlightPending(false);
    setXoxFlight((curr) => (curr?.direction === "to-studio" ? null : curr));
    setXoxExitingStage(false);
    setXoxTravelPhase("from-studio");
    setXoxGlideSeq((n) => n + 1);
    setPreviewAccentPreset(null);
    const t2 = window.setTimeout(() => setXoxTravelPhase("idle"), 440);
    return () => window.clearTimeout(t2);
  }, [showXoxStudio]);

  const refreshXoxStudioData = async () => {
    try {
      const [prof, skillsList] = await Promise.all([
        getGlobalXoxProfile(),
        listXoxSkills(),
      ]);
      setGlobalXoxProfile(prof);
      setXoxSkills(skillsList);
    } catch {
      // Ignora error transitorio en carga inicial
    }
  };

  const openXoxStudio = (
    tab: XoxStudioTabId = "identity",
    skillSlug?: string | null
  ) => {
    if (!showXoxStudio && !prefersReducedMotion()) {
      const liveFlightFrom = measureFlightPoint("[data-xox-flight-mover]");
      const heroFrom = measureFlightPoint('[data-xox-stage="chat-hero"]');
      const laneFrom = heroFrom ? null : measureFlightPoint('[data-xox-stage="chat-lane"]');
      const from = liveFlightFrom ?? heroFrom ?? laneFrom;
      if (from) {
        if (!liveFlightFrom) {
          lastChatXoxSnapshotRef.current = {
            ...from,
            viewportH: window.innerHeight,
            isHero: Boolean(heroFrom),
          };
        }
        pendingXoxFlightRef.current = { direction: "to-studio", from };
        setXoxFlightPending(true);
      }
    }
    setShowCanvas(false);
    setShowDocViewer(false);
    setXoxStudioTab(tab);
    setHighlightedSkillSlug(skillSlug ?? null);
    setShowXoxStudio(true);
    void refreshXoxStudioData();
  };

  const closeXoxStudio = () => {
    if (showXoxStudio && !prefersReducedMotion()) {
      const from =
        measureFlightPoint("[data-xox-flight-mover]") ??
        measureFlightPoint('[data-xox-stage="studio"]');
      const chatSec = document.querySelector<HTMLElement>("[data-xox-chat-section]");
      if (from && chatSec) {
        const chatRect = chatSec.getBoundingClientRect();
        const finalRight = getStudioRightEdge();
        const finalChatW = Math.max(300, finalRight - chatRect.left);
        const hasHeroDom = Boolean(document.querySelector('[data-xox-stage="chat-hero"]'));
        const snap = lastChatXoxSnapshotRef.current;
        let to: XoxFlightPoint | null = null;

        if (hasHeroDom) {
          const responsiveSize =
            window.innerWidth >= 1280
              ? 456
              : window.innerWidth >= 1024
                ? 408
                : window.innerWidth >= 640
                  ? 384
                  : 308;
          const sameViewportH =
            Boolean(snap && snap.isHero && Math.abs(snap.viewportH - window.innerHeight) < 8);
          const toSize = sameViewportH && snap ? snap.size : responsiveSize;
          const toCy =
            sameViewportH && snap
              ? snap.cy
              : chatRect.top + Math.max(180, (chatRect.height - 170) * 0.44);
          to = {
            cx: chatRect.left + finalChatW / 2,
            cy: toCy,
            size: toSize,
          };
        } else if (snap && !snap.isHero) {
          const laneSlot = document.querySelector<HTMLElement>('[data-xox-lane-slot="active"]');
          if (laneSlot) {
            const lr = laneSlot.getBoundingClientRect();
            if (lr.top >= 0 && lr.top <= window.innerHeight - 60) {
              to = {
                cx: snap.cx,
                cy: lr.top + snap.size / 2 - 4,
                size: snap.size,
              };
            }
          }
        }

        if (to) {
          pendingXoxFlightRef.current = null;
          setXoxFlightPending(false);
          xoxFlightIdRef.current += 1;
          setXoxFlight({
            id: xoxFlightIdRef.current,
            direction: "from-studio",
            from,
            to,
          });
        }
      }
    }
    setShowXoxStudio(false);
  };
  
  // Estados para paneles laterales, tareas y visor de documentos multi-pestaña (estilo editor)
  const [showLeftSidebar, setShowLeftSidebar] = useState<boolean>(false);
  const [showRightSidebar, setShowRightSidebar] = useState<boolean>(false);
  const [showDocViewer, setShowDocViewer] = useState<boolean>(false);

  useEffect(() => {
    if (showDocViewer) {
      setShowXoxStudio(false);
    }
  }, [showDocViewer]);

  const [openDocTabs, setOpenDocTabs] = useState<PdfWorkspacePanelState[]>([]);
  const [activeDocTabPath, setActiveDocTabPath] = useState<string | null>(null);
  const pdfPanelState = useMemo<PdfWorkspacePanelState | null>(() => {
    if (openDocTabs.length === 0) return null;
    if (activeDocTabPath) {
      const found = openDocTabs.find((t) => t.path === activeDocTabPath);
      if (found) return found;
    }
    return openDocTabs[openDocTabs.length - 1] ?? null;
  }, [openDocTabs, activeDocTabPath]);

  // Contexto aislado por ventana de documento + checkpoints de compactación (auto y manual)
  const [docContextsByPath, setDocContextsByPath] = useState<
    Record<string, DocumentContextSnapshot>
  >({});
  const [docContextScopeEnabled, setDocContextScopeEnabled] = useState<boolean>(true);
  const [isCompactingContext, setIsCompactingContext] = useState<boolean>(false);
  const [chatCheckpoint, setChatCheckpoint] = useState<ContextCheckpoint | null>(null);
  const [compactedUpToMessageId, setCompactedUpToMessageId] = useState<string | null>(null);

  const chatCheckpointRef = useRef<ContextCheckpoint | null>(chatCheckpoint);
  chatCheckpointRef.current = chatCheckpoint;
  const compactedUpToMsgIdRef = useRef<string | null>(compactedUpToMessageId);
  compactedUpToMsgIdRef.current = compactedUpToMessageId;
  const docContextScopeEnabledRef = useRef<boolean>(docContextScopeEnabled);
  docContextScopeEnabledRef.current = docContextScopeEnabled;

  const upsertDocTab = (next: PdfWorkspacePanelState, activate = true) => {
    const stamped: PdfWorkspacePanelState = {
      ...next,
      revision: next.revision ?? Date.now(),
    };
    setOpenDocTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === stamped.path);
      if (idx >= 0) {
        return prev.map((t, i) => (i === idx ? stamped : t));
      }
      return [...prev.slice(-9), stamped];
    });
    if (activate) {
      setActiveDocTabPath(stamped.path);
    }
  };

  const patchDocTab = (
    targetPath: string,
    updater: (curr: PdfWorkspacePanelState) => PdfWorkspacePanelState
  ) => {
    setOpenDocTabs((prev) =>
      prev.map((t) => (t.path === targetPath ? updater(t) : t))
    );
  };

  const closeDocTab = (targetPath: string) => {
    setOpenDocTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === targetPath);
      if (idx < 0) return prev;
      const nextList = prev.filter((t) => t.path !== targetPath);
      if (nextList.length === 0) {
        setActiveDocTabPath(null);
        setShowDocViewer(false);
        setPdfDraftProgress(null);
        rightPanelAutoOpenedTurnRef.current = null;
      } else if (activeDocTabPath === targetPath) {
        const fallback = nextList[Math.max(0, idx - 1)] ?? nextList[0];
        setActiveDocTabPath(fallback.path);
      }
      return nextList;
    });
  };

  const closeAllDocTabs = () => {
    setShowDocViewer(false);
    setOpenDocTabs([]);
    setActiveDocTabPath(null);
    setPdfDraftProgress(null);
    rightPanelAutoOpenedTurnRef.current = null;
  };

  const docViewerRef = useRef<{ show: boolean; state: PdfWorkspacePanelState | null }>({
    show: false,
    state: null,
  });
  docViewerRef.current = { show: showDocViewer, state: pdfPanelState };
  const [pdfDraftProgress, setPdfDraftProgress] = useState<PdfDraftProgressEvent | null>(null);
  const [taskTab, setTaskTab] = useState<TaskPanelTab>("pending");
  const [selectedContext, setSelectedContext] = useState<ContextItem | null>(null);

  const pdfPreviewReqRef = useRef<number>(0);
  const rightPanelAutoOpenedTurnRef = useRef<string | null>(null);
  const lastPdfByTurnRef = useRef<Record<string, GeneratedPdfArtifact>>({});
  const turnOpenedPdfRevRef = useRef<Record<string, number>>({});

  // Sincroniza el contexto aislado en disco cada vez que se cambia o abre una pestaña de documento
  useEffect(() => {
    const activeTab = pdfPanelState;
    if (!showDocViewer || !activeTab?.path) return;
    let cancelled = false;
    void manageDocumentContext({
      action: "get",
      path: activeTab.path,
      title: activeTab.title,
      fileKind: activeTab.fileKind ?? "pdf",
    })
      .then((res) => {
        if (cancelled || !res?.documentContext) return;
        const snap = res.documentContext;
        setDocContextsByPath((prev) => ({ ...prev, [snap.path]: snap }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showDocViewer, pdfPanelState?.path, pdfPanelState?.revision, pdfPanelState?.title, pdfPanelState?.fileKind]);

  // Límites y anchos redimensionables para paneles laterales (Estilo Antigravity / IDE)
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 480;
  const MIN_RIGHT_WIDTH = 280;
  const MAX_RIGHT_WIDTH = 720;

  const [leftWidth, setLeftWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("xook_left_width");
      return saved ? Math.min(Math.max(Number(saved), MIN_LEFT_WIDTH), MAX_LEFT_WIDTH) : 280;
    } catch {
      return 280;
    }
  });

  const [rightWidth, setRightWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("xook_right_width");
      return saved ? Math.min(Math.max(Number(saved), MIN_RIGHT_WIDTH), MAX_RIGHT_WIDTH) : 340;
    } catch {
      return 340;
    }
  });

  const [isResizingLeft, setIsResizingLeft] = useState<boolean>(false);
  const [isResizingRight, setIsResizingRight] = useState<boolean>(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const hasMacOverlayChrome =
    isWorkspaceTauriRuntime() &&
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!hasMacOverlayChrome) return;
    let active = true;
    let unlistenResize: (() => void) | null = null;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const syncFullscreen = async () => {
          const full = await win.isFullscreen();
          if (active) setIsWindowFullscreen(full);
        };
        await syncFullscreen();
        unlistenResize = await win.onResized(() => {
          void syncFullscreen();
        });
      } catch {
        // Ignora errores transitorios fuera de ventana Tauri nativa
      }
    })();

    return () => {
      active = false;
      unlistenResize?.();
    };
  }, [hasMacOverlayChrome]);

  const isCompactViewport = viewportWidth < 740;
  const isCompactViewportRef = useRef<boolean>(isCompactViewport);
  isCompactViewportRef.current = isCompactViewport;
  const effectiveLeftWidth = isCompactViewport
    ? Math.min(300, Math.max(248, viewportWidth - 44))
    : leftWidth;
  const effectiveRightWidth = isCompactViewport
    ? Math.min(340, Math.max(280, viewportWidth - 28))
    : rightWidth;

  const isMemoryWideStudio =
    showXoxStudio && xoxStudioTab === "memory" && isMemoryWideMode;
  const studioPanelWidth = isCompactViewport
    ? viewportWidth
    : isMemoryWideStudio
      ? viewportWidth >= 1100
        ? Math.min(
            1440,
            Math.max(760, Math.round(viewportWidth * 0.72)),
            Math.max(540, viewportWidth - 320)
          )
        : Math.max(540, viewportWidth - 280)
      : Math.min(
          860,
          Math.max(440, Math.round(viewportWidth * 0.54)),
          Math.max(360, viewportWidth - 260)
        );
  const docViewerPanelWidth = isCompactViewport
    ? viewportWidth
    : Math.min(
        680,
        Math.max(360, Math.round(viewportWidth * 0.46)),
        Math.max(320, viewportWidth - 260)
      );

  // Estado y controles de Modo Asistencia (pantalla dividida con app acompañante)
  const [assistStatus, setAssistStatus] = useState<AssistWindowStatus>(DEFAULT_ASSIST_STATUS);
  const [companionWindows, setCompanionWindows] = useState<CompanionWindowCandidate[]>([]);
  const [loadingCompanions, setLoadingCompanions] = useState<boolean>(false);
  const [assistBusy, setAssistBusy] = useState<boolean>(false);
  const prevCompactViewportRef = useRef<boolean>(isCompactViewport);

  useEffect(() => {
    if (!prevCompactViewportRef.current && isCompactViewport) {
      setShowLeftSidebar(false);
      setShowRightSidebar(false);
    }
    prevCompactViewportRef.current = isCompactViewport;
  }, [isCompactViewport]);

  const refreshCompanionWindows = useCallback(async () => {
    if (!isWorkspaceTauriRuntime()) return;
    setLoadingCompanions(true);
    try {
      const res = await listCompanionWindows();
      setCompanionWindows(res.windows ?? []);
      setAssistStatus((prev) => ({
        ...prev,
        accessibilityGranted: res.accessibilityGranted,
      }));
    } catch {
      // Ignora si no hay entorno Tauri activo
    } finally {
      setLoadingCompanions(false);
    }
  }, []);

  const assistStatusRef = useRef<AssistWindowStatus>(assistStatus);
  assistStatusRef.current = assistStatus;

  useEffect(() => {
    if (!isWorkspaceTauriRuntime()) return;
    let mounted = true;
    const syncAssistOnFocus = async () => {
      try {
        const prev = assistStatusRef.current;
        const st = await getAssistWindowState();
        if (!mounted) return;
        setAssistStatus(st);
        // Si el usuario acaba de activar Accesibilidad en Ajustes y volvió a Xook,
        // completamos automáticamente la división de ambas ventanas sin pedirle otro clic.
        if (
          st.active &&
          st.splitCompanion &&
          st.accessibilityGranted &&
          (!prev.accessibilityGranted || !st.companion?.tiledOk)
        ) {
          const applied = await applyAssistLayout({
            preset: st.preset,
            side: st.side,
            splitCompanion: true,
            alwaysOnTop: st.alwaysOnTop,
          });
          if (mounted) setAssistStatus(applied);
        }
      } catch {
        // Ignora errores transitorios
      }
    };
    void syncAssistOnFocus();
    const onFocus = () => {
      void syncAssistOnFocus();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const flashAssistNotice = useCallback((msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((curr) => (curr === msg ? null : curr));
    }, 4200);
  }, []);

  const handleApplyAssistLayout = useCallback(
    async (payload: ApplyAssistLayoutPayload) => {
      if (!isWorkspaceTauriRuntime()) return;
      setAssistBusy(true);
      try {
        setShowLeftSidebar(false);
        setShowRightSidebar(false);
        const next = await applyAssistLayout(payload);
        setAssistStatus(next);
        if (next.notice) {
          flashAssistNotice(next.notice);
        } else if (next.companion?.tiledOk && next.companion.appName) {
          flashAssistNotice(`Modo Asistencia dividido con ${next.companion.appName}`);
        }
      } catch (err) {
        flashAssistNotice(
          err instanceof Error ? err.message : "No se pudo aplicar el Modo Asistencia."
        );
      } finally {
        setAssistBusy(false);
      }
    },
    [flashAssistNotice]
  );

  const handleRebalanceAssistSplit = useCallback(async () => {
    if (!isWorkspaceTauriRuntime()) return;
    setAssistBusy(true);
    try {
      const next = await rebalanceAssistSplit();
      setAssistStatus(next);
      if (next.notice) {
        flashAssistNotice(next.notice);
      } else if (next.companion?.appName) {
        flashAssistNotice(`División reajustada con ${next.companion.appName}`);
      }
    } catch (err) {
      flashAssistNotice(
        err instanceof Error ? err.message : "No se pudo reajustar la división."
      );
    } finally {
      setAssistBusy(false);
    }
  }, [flashAssistNotice]);

  const handleToggleAssistPin = useCallback(
    async (enabled: boolean) => {
      if (!isWorkspaceTauriRuntime()) return;
      try {
        const next = await setAssistAlwaysOnTop(enabled);
        setAssistStatus(next);
      } catch (err) {
        flashAssistNotice(
          err instanceof Error ? err.message : "No se pudo cambiar 'Siempre visible'."
        );
      }
    },
    [flashAssistNotice]
  );

  const handleExitAssist = useCallback(async () => {
    if (!isWorkspaceTauriRuntime()) return;
    setAssistBusy(true);
    try {
      const next = await exitAssistLayout(true);
      setAssistStatus(next);
      flashAssistNotice("Ventana restaurada al tamaño normal");
    } catch (err) {
      flashAssistNotice(
        err instanceof Error ? err.message : "No se pudo restaurar la ventana."
      );
    } finally {
      setAssistBusy(false);
    }
  }, [flashAssistNotice]);

  const handleRequestAccessibility = useCallback(async () => {
    try {
      const granted = await requestAccessibilityPermission();
      setAssistStatus((prev) => ({ ...prev, accessibilityGranted: granted }));
      if (granted) {
        flashAssistNotice("Accesibilidad autorizada: ya puedes dividir automáticamente con otras apps.");
        void refreshCompanionWindows();
      } else {
        flashAssistNotice("Autoriza a XOOK en Ajustes > Privacidad y Seguridad > Accesibilidad.");
      }
    } catch {
      void openAccessibilitySettings();
    }
  }, [flashAssistNotice, refreshCompanionWindows]);

  const handleOpenAccessibilitySettings = useCallback(async () => {
    try {
      await openAccessibilitySettings();
    } catch {
      // Ignora fuera de macOS
    }
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const composerRectRef = useRef<DOMRect | null>(null);
  const chatInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);

  // Archivos adjuntos (imágenes con miniatura real, textos pegados agrupados y archivos), modelo activo, bóveda IA y chat real
  const [attachments, setAttachments] = useState<ComposerAttachmentItem[]>([]);
  const attachmentsRef = useRef<ComposerAttachmentItem[]>(attachments);
  attachmentsRef.current = attachments;
  const [attachmentPreviewTarget, setAttachmentPreviewTarget] =
    useState<AttachmentPreviewTarget | null>(null);
  const [isDraggingOverChat, setIsDraggingOverChat] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      revokeComposerAttachments(attachmentsRef.current);
    };
  }, []);

  useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const syncRect = () => {
      composerRectRef.current = el.getBoundingClientRect();
    };
    syncRect();
    const ro = new ResizeObserver(syncRect);
    ro.observe(el);
    window.addEventListener("resize", syncRect, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncRect);
    };
  }, []);

  const appendFilesToComposer = (files: File[]) => {
    if (!files.length) return;
    const existingImgCount = attachmentsRef.current.filter((a) => a.kind === "image").length;
    const created = createComposerFileItems(files, existingImgCount);
    setAttachments((prev) => [...prev, ...created]);
    for (const item of created) {
      if (item.kind === "image") {
        void prepareImagePayload(item.file).then((prep) => {
          if (!prep.thumbUrl && !prep.imageDataUrl) return;
          setAttachments((prev) =>
            prev.map((curr) =>
              curr.id === item.id && curr.kind === "image"
                ? {
                    ...curr,
                    thumbUrl: prep.thumbUrl ?? curr.thumbUrl,
                    imageDataUrl: prep.imageDataUrl ?? curr.imageDataUrl,
                    width: prep.width ?? curr.width,
                    height: prep.height ?? curr.height,
                  }
                : curr
            )
          );
        });
      }
    }
  };

  const appendPastedTextToComposer = (rawText: string) => {
    const existingPastedCount = attachmentsRef.current.filter(
      (a) => a.kind === "pasted_text"
    ).length;
    const item = createPastedTextItem(rawText, existingPastedCount);
    setAttachments((prev) => [...prev, item]);
    triggerReadingPulse(
      `Texto pegado agrupado (${item.lineCount} ${item.lineCount === 1 ? "línea" : "líneas"})...`
    );
  };

  const removeComposerAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) revokeComposerAttachments([target]);
      return prev.filter((a) => a.id !== id);
    });
  };

  const updateComposerPastedText = (id: string, nextContent: string) => {
    const { content, charCount, lineCount } = normalizePastedText(nextContent);
    setAttachments((prev) =>
      prev.map((item, idx) =>
        item.id === id && item.kind === "pasted_text"
          ? {
              ...item,
              content,
              charCount,
              lineCount,
              name: derivePastedCardTitle(content, idx + 1),
            }
          : item
      )
    );
  };

  const unwrapComposerPastedText = (id: string, content: string) => {
    removeComposerAttachment(id);
    setInputPrompt((prev) => {
      const trimmedPrev = prev.trimEnd();
      if (!trimmedPrev) return content;
      return `${trimmedPrev}\n\n${content}`;
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const inspectComposerAttachment = (item: ComposerAttachmentItem) => {
    if (item.kind === "image") {
      const src = item.objectUrl || item.imageDataUrl || item.thumbUrl;
      if (!src) return;
      setAttachmentPreviewTarget({
        kind: "image",
        id: item.id,
        name: item.name,
        src,
        width: item.width,
        height: item.height,
        sizeBytes: item.sizeBytes,
        removable: true,
      });
      return;
    }
    if (item.kind === "pasted_text") {
      setAttachmentPreviewTarget({
        kind: "pasted_text",
        id: item.id,
        name: item.name,
        content: item.content,
        charCount: item.charCount,
        lineCount: item.lineCount,
        editable: true,
      });
    }
  };
  const [modelId, setModelId] = useState<string>(OPENROUTER_PRESET_MODELS[0].id);
  const [aiConfig, setAiConfig] = useState<AiConfigStatus>({
    provider: "openrouter",
    modelId: OPENROUTER_PRESET_MODELS[0].id,
    hasApiKey: false,
    maskedKey: null,
    keySource: "none",
    customModels: [],
  });
  const [showAiSettings, setShowAiSettings] = useState<boolean>(false);
  const [aiSettingsTab, setAiSettingsTab] = useState<OpenRouterSettingsTab>("models");
  const [aiSettingsProvider, setAiSettingsProvider] = useState<AiProviderId | undefined>(undefined);
  const [expandModelMenu, setExpandModelMenu] = useState<boolean>(false);

  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>("voice");
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [ttsPlayback, setTtsPlayback] = useState<TtsPlaybackSnapshot>(() => ttsPlayer.getSnapshot());
  const ttsStatusRef = useRef<TtsStatus | null>(null);
  ttsStatusRef.current = ttsStatus;
  const wasTtsSpeakingRef = useRef<boolean>(false);

  const openSettings = (tab: SettingsTabId = "voice") => {
    setSettingsInitialTab(tab);
    setShowSettingsModal(true);
  };

  const openAiSettings = (
    tab: OpenRouterSettingsTab = "models",
    provider?: AiProviderId
  ) => {
    setAiSettingsTab(tab);
    setAiSettingsProvider(provider ?? normalizeProviderIdClient(aiConfig.provider));
    setShowAiSettings(true);
  };
  const [activeClarification, setActiveClarification] = useState<ClarificationSpec | null>(null);
  const [accountUsage, setAccountUsage] = useState<AiConnectionTestResult | null>(null);
  const [usageLedger, setUsageLedger] = useState<AiUsageLedger | null>(null);
  const [catalogModels, setCatalogModels] = useState<OpenRouterModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [unavailableModelIds, setUnavailableModelIds] = useState<Set<string>>(() => new Set());
  const [requestsToday, setRequestsToday] = useState<number>(() => getLocalDailyRequestCount(null));
  const [chatMessages, setChatMessages] = useState<UiChatMessage[]>([]);
  const [activeCanvas, setActiveCanvas] = useState<CanvasArtifact | null>(null);
  const [showCanvas, setShowCanvas] = useState<boolean>(false);
  const [canvasExpanded, setCanvasExpanded] = useState<boolean>(false);
  const canvasPanelWidth = isCompactViewport
    ? viewportWidth
    : canvasExpanded
      ? Math.min(
          980,
          Math.max(520, Math.round(viewportWidth * 0.62)),
          Math.max(340, viewportWidth - 240)
        )
      : Math.min(
          660,
          Math.max(330, Math.round(viewportWidth * 0.44)),
          Math.max(300, viewportWidth - 260)
        );
  const hasRightSplitOpen = showCanvas || showRightSidebar || showXoxStudio || showDocViewer;
  const hasCompactOverlayOpen =
    isCompactViewport &&
    (showLeftSidebar ||
      showRightSidebar ||
      showXoxStudio ||
      (showCanvas && Boolean(activeCanvas)) ||
      (showDocViewer && Boolean(pdfPanelState || pdfDraftProgress)));

  const closeAllCompactOverlays = () => {
    if (showLeftSidebar) setShowLeftSidebar(false);
    if (showRightSidebar) setShowRightSidebar(false);
    if (showXoxStudio) closeXoxStudio();
    if (showCanvas) {
      setShowCanvas(false);
      setCanvasExpanded(false);
    }
    if (showDocViewer) closeAllDocTabs();
  };

  // El diseño de pantalla dividida solo aplica mientras el ancho siga siendo de panel dividido (<= ~56% del monitor);
  // si el usuario estira/expande la ventana manualmente a ancho completo, vuelve automáticamente al diseño de escritorio.
  const splitMaxLayoutWidth =
    assistStatus.monitorWidth > 0
      ? Math.max(780, Math.round(assistStatus.monitorWidth * 0.56))
      : 820;
  const isEffectiveSplitLayout =
    assistStatus.active && !isWindowFullscreen && viewportWidth <= splitMaxLayoutWidth;

  useEffect(() => {
    setChecklistCollapsed(hasRightSplitOpen || isCompactViewport);
  }, [hasRightSplitOpen, isCompactViewport]);
  const [isChatStreaming, setIsChatStreaming] = useState<boolean>(false);
  const [localUser, setLocalUser] = useState<LocalUserProfile | null>(null);
  const [userMemoryFacts, setUserMemoryFacts] = useState<UserMemoryFact[]>([]);
  const [showLocalAuth, setShowLocalAuth] = useState<boolean>(false);
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => `conv_${Date.now()}`);
  const [leftTab, setLeftTab] = useState<"context" | "chats">("chats");
  const [thinkingLabel, setThinkingLabel] = useState<string>("Consultando a Xox...");
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
  const [showContextMenu, setShowContextMenu] = useState<boolean>(false);
  const [showCommandMenu, setShowCommandMenu] = useState<boolean>(false);
  const [commandMenuFilter, setCommandMenuFilter] = useState<string>("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState<number>(0);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const commandTriggerRef = useRef<HTMLButtonElement>(null);
  const [learningToast, setLearningToast] = useState<MemoryPattern | null>(null);
  const [inputExpanded, setInputExpanded] = useState<boolean>(false);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  // El chat sigue al último mensaje solo mientras el usuario esté abajo. Si sube a
  // leer durante el streaming, cada token ya no lo regresa al final.
  const chatStickToBottomRef = useRef<boolean>(true);
  const chatLastScrollTopRef = useRef<number>(0);
  const chatPrevLengthRef = useRef<number>(0);
  const chatPrevFirstIdRef = useRef<string | undefined>(undefined);
  const pendingSecretKeysRef = useRef<
    Map<string, { key: string; provider: AiProviderId; ambiguousProviders?: AiProviderId[] }>
  >(new Map());
  const chatMessagesRef = useRef<UiChatMessage[]>(chatMessages);
  chatMessagesRef.current = chatMessages;
  const activeConvIdRef = useRef<string>(activeConversationId);
  activeConvIdRef.current = activeConversationId;
  const activeConvCreatedAtRef = useRef<string>(new Date().toISOString());

  // Burbuja de saludo de Xox (solo al hacer clic sobre la mascota)
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLeaving, setGreetingLeaving] = useState<boolean>(false);
  const [summonSeq, setSummonSeq] = useState<number>(0);
  const greetingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const greetingSeqRef = useRef(0);
  const lastBubbleMessageRef = useRef<string | null>(null);
  const [homeGreetingSlot, setHomeGreetingSlot] = useState<{
    seed: number;
    nowMs: number;
    avoidText: string | null;
  }>(() => ({
    seed: Math.floor(Math.random() * 100_000),
    nowMs: Date.now(),
    avoidText: null,
  }));
  const xoxPhaseTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isChatStreamingRef = useRef<boolean>(false);
  isChatStreamingRef.current = isChatStreaming;

  const clearXoxPhaseTimers = () => {
    xoxPhaseTimersRef.current.forEach(clearTimeout);
    xoxPhaseTimersRef.current = [];
  };

  const triggerReadingPulse = (label: string, durationMs = 1150) => {
    if (isChatStreamingRef.current) return;
    clearXoxPhaseTimers();
    setXoxState("reading");
    setXoxMessage(label);
    xoxPhaseTimersRef.current.push(
      setTimeout(() => {
        if (isChatStreamingRef.current) return;
        setXoxState((s) => (s === "reading" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, durationMs)
    );
  };

  useEffect(
    () => () => {
      greetingTimers.current.forEach(clearTimeout);
      clearXoxPhaseTimers();
      ttsPlayer.stop();
    },
    []
  );

  // Estado inicial de voz local y suscripción al reproductor
  useEffect(() => {
    let active = true;
    void getTtsStatus()
      .then((fresh) => {
        if (active) setTtsStatus(fresh);
      })
      .catch(() => {});

    const unsubPlayer = ttsPlayer.subscribe(setTtsPlayback);
    let unsubEvents = () => {};
    let unsubXoxProfile = () => {};
    void refreshXoxStudioData();
    void subscribeTtsEvents({
      onStatusUpdated: (next) => {
        if (active) setTtsStatus(next);
      },
    }).then((fn) => {
      unsubEvents = fn;
    });
    void subscribeGlobalXoxProfile((nextProf) => {
      if (!active) return;
      setGlobalXoxProfile(nextProf);
      void listXoxSkills().then((list) => {
        if (active) setXoxSkills(list);
      }).catch(() => {});
    }).then((fn) => {
      unsubXoxProfile = fn;
    });

    return () => {
      active = false;
      unsubPlayer();
      unsubEvents();
      unsubXoxProfile();
    };
  }, []);

  // Sincroniza animación de habla de Xox con la reproducción real de audio
  useEffect(() => {
    if (ttsPlayback.isPlaying) {
      wasTtsSpeakingRef.current = true;
      clearXoxPhaseTimers();
      setXoxState("talking");
      setXoxMessage("Hablando...");
    } else if (wasTtsSpeakingRef.current) {
      wasTtsSpeakingRef.current = false;
      if (!isChatStreamingRef.current) {
        setXoxState((s) => (s === "talking" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }
    }

    if (ttsPlayback.error) {
      setStatusMessage(ttsPlayback.error);
      const t = setTimeout(() => setStatusMessage(null), 4200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ttsPlayback.isPlaying, ttsPlayback.error]);

  const handleSpeakMessage = (msg: UiChatMessage) => {
    const current = ttsStatusRef.current;
    const isDesktop = isTauriTtsRuntime();
    const canSpeak = isDesktop
      ? Boolean(current?.config.enabled && current?.modelsInstalled)
      : Boolean(current?.config.enabled);

    if (!canSpeak) {
      openSettings("voice");
      setStatusMessage(
        isDesktop && !current?.modelsInstalled
          ? "Descarga y activa la voz local en Configuraciones → Voz."
          : "Activa la voz en Configuraciones → Voz para escuchar mensajes."
      );
      setTimeout(() => setStatusMessage(null), 4000);
      return;
    }

    void ttsPlayer.playMessage(
      msg.id,
      cleanVisibleReply(msg.content, { stripTables: false }),
      {
        voiceId: current?.config.voiceId,
        speed: current?.config.speed,
      }
    );
  };

  // Actualiza la franja horaria del saludo si el usuario vuelve más tarde al Home
  useEffect(() => {
    const syncGreetingClock = () => {
      if (document.visibilityState === "hidden") return;
      const now = new Date();
      setHomeGreetingSlot((prev) => {
        const prevDate = new Date(prev.nowMs);
        if (
          getTimeOfDayBand(prevDate) === getTimeOfDayBand(now) &&
          isSameLocalDay(prevDate, now)
        ) {
          return prev;
        }
        return {
          seed: Math.floor(Math.random() * 100_000),
          nowMs: now.getTime(),
          avoidText: null,
        };
      });
    };
    document.addEventListener("visibilitychange", syncGreetingClock);
    window.addEventListener("focus", syncGreetingClock);
    return () => {
      document.removeEventListener("visibilitychange", syncGreetingClock);
      window.removeEventListener("focus", syncGreetingClock);
    };
  }, []);

  const heroGreeting = useMemo(
    () =>
      getHeroGreeting({
        userName: localUser?.name,
        now: new Date(homeGreetingSlot.nowMs),
        seed: homeGreetingSlot.seed,
        avoidText: homeGreetingSlot.avoidText,
      }),
    [localUser?.name, homeGreetingSlot]
  );

  const chatInputPlaceholder = useMemo(() => {
    if (activeModeSpec) {
      return activeModeSpec.inputPlaceholder;
    }
    return getChatInputPlaceholder({
      isStreaming: isChatStreaming,
      isDragging: isDraggingOverChat,
      hasMessages: chatMessages.length > 0,
      seed: homeGreetingSlot.seed,
    });
  }, [activeModeSpec, isChatStreaming, isDraggingOverChat, chatMessages.length, homeGreetingSlot.seed]);
  const lastMsg = chatMessages[chatMessages.length - 1];
  const lastMsgStreamLen = (lastMsg?.content?.length ?? 0) + (lastMsg?.reasoning?.length ?? 0);
  const isXoxWorking =
    xoxState === "thinking" ||
    xoxState === "reading" ||
    xoxState === "coding" ||
    xoxState === "syncing";
  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const movedUp = el.scrollTop < chatLastScrollTopRef.current - 1;
    if (movedUp && distanceToBottom > 2) {
      // Cualquier desplazamiento hacia arriba suelta el chat, aunque sea de pocos
      // píxeles: el trackpad manda pasos pequeños entre token y token. El texto que
      // crece por debajo no mueve `scrollTop`, y el scroll propio siempre baja.
      chatStickToBottomRef.current = false;
    } else if (!movedUp && distanceToBottom < 24) {
      chatStickToBottomRef.current = true;
    }
    chatLastScrollTopRef.current = el.scrollTop;
  }, []);

  // La rueda o el trackpad hacia arriba sueltan el chat antes de que llegue otro token.
  const handleChatWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) chatStickToBottomRef.current = false;
  }, []);

  useEffect(() => {
    const el = chatScrollRef.current;
    const prevLength = chatPrevLengthRef.current;
    const prevFirstId = chatPrevFirstIdRef.current;
    chatPrevLengthRef.current = chatMessages.length;
    chatPrevFirstIdRef.current = chatMessages[0]?.id;
    if (!el) return;
    if (chatMessages.length === 0) {
      chatStickToBottomRef.current = true;
      if (el.scrollTop !== 0) {
        el.scrollTop = 0;
      }
      return;
    }
    // Enviar un mensaje (o abrir otra conversación) vuelve a pegar el chat al final.
    if (
      prevLength === 0 ||
      chatMessages[0]?.id !== prevFirstId ||
      chatMessages.slice(prevLength).some((msg) => msg.role === "user")
    ) {
      chatStickToBottomRef.current = true;
    }
    if (!chatStickToBottomRef.current) return;
    // `scrollTo` sobre el contenedor, no `scrollIntoView`: este también desplaza a
    // los ancestros y hace temblar el layout en cada token.
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isChatStreaming ? "auto" : "smooth",
    });
  }, [chatMessages, lastMsgStreamLen, isChatStreaming, isXoxWorking]);

  const activeProvider = normalizeProviderIdClient(aiConfig.provider);
  const activeSpec = getProviderSpec(activeProvider);
  const configuredProviderEntries = Object.values(aiConfig.configuredProviders ?? {});
  const configuredProvidersCount = configuredProviderEntries.filter((p) => p.hasApiKey).length;
  const hasAnyConfiguredKey =
    aiConfig.hasApiKey || (aiConfig.autoFailover !== false && configuredProvidersCount > 0);
  const activeProviderCatalog =
    catalogModels.length > 0 ? catalogModels : activeSpec.curatedModels;

  const canUsePaidModels =
    activeProvider !== "openrouter" ? true : Boolean(accountUsage?.can_use_paid_models);
  const availableQuickModels = getAvailableQuickModels(
    activeProviderCatalog,
    aiConfig.customModels,
    canUsePaidModels,
    unavailableModelIds,
    activeProvider
  );

  const activeModel: OpenRouterModelOption = formatModelDisplay(modelId, activeProviderCatalog);

  // Lista de elementos reales en la Ventana de Contexto
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const workspaceMemoryFacts = useMemo<string[]>(() => {
    const memoryItems = contextItems.filter(
      (c) =>
        c.type === "memory" ||
        c.path === "memoria/hechos.md" ||
        c.path.startsWith("memoria/")
    );
    const facts: string[] = [];
    for (const item of memoryItems) {
      for (const rawLine of item.content.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
        const candidate = (bulletMatch ? bulletMatch[1] : trimmed).trim();
        if (candidate && !facts.includes(candidate)) {
          facts.push(candidate);
        }
      }
    }
    return facts;
  }, [contextItems]);

  const studioMemoryPatterns = useMemo(
    () =>
      patterns.map((p) => ({
        id: p.pattern_id,
        description: p.description,
        confidence: p.confidence,
      })),
    [patterns]
  );

  const activeContextItems = contextItems.filter(
    (c) => c.pinned || selectedContext?.id === c.id
  );
  const pinnedFilesTokens = activeContextItems.reduce(
    (sum, item) => sum + estimateTokens(item.content),
    0
  );
  const activeDocumentContext: DocumentContextSnapshot | null =
    pdfPanelState?.path ? (docContextsByPath[pdfPanelState.path] ?? null) : null;
  const isDocumentWindowFocused = Boolean(
    showDocViewer && pdfPanelState?.path && docContextScopeEnabled
  );
  const activeChatTurnsTokens = useMemo(() => {
    let startIdx = 0;
    if (compactedUpToMessageId) {
      const foundIdx = chatMessages.findIndex((m) => m.id === compactedUpToMessageId);
      if (foundIdx >= 0) startIdx = foundIdx + 1;
    }
    let sum = 0;
    for (let i = startIdx; i < chatMessages.length; i += 1) {
      const m = chatMessages[i];
      if (!m || m.isError || m.isCompactionDividerOnly) continue;
      sum += 8 + estimateTokens(m.content);
    }
    return sum;
  }, [chatMessages, compactedUpToMessageId]);
  const chatCheckpointTokens = useMemo(() => {
    if (!chatCheckpoint) return 0;
    return (
      chatCheckpoint.tokensAfter ??
      estimateTokens(
        [
          chatCheckpoint.objective,
          chatCheckpoint.summary,
          chatCheckpoint.documentState,
          ...chatCheckpoint.activeDecisions,
          ...chatCheckpoint.supersededDiscarded,
        ].join(" ")
      )
    );
  }, [chatCheckpoint]);

  const totalActiveTokens = isDocumentWindowFocused
    ? (activeDocumentContext?.estimatedTokens ?? 1400) + pinnedFilesTokens
    : 2200 + chatCheckpointTokens + activeChatTurnsTokens + pinnedFilesTokens;
  const modelContextWindow = activeModel.context_length ?? 128000;
  const contextUsagePct =
    modelContextWindow > 0
      ? Math.min(100, Math.round((totalActiveTokens / modelContextWindow) * 1000) / 10)
      : 0;

  const computedUsage = computeProviderUsageSummary({
    provider: activeProvider,
    aiConfig,
    accountUsage,
    usageLedger,
    requestsTodayFallback: requestsToday,
    modelId,
  });

  const usageSummary = (() => {
    const activeSlot = aiConfig.configuredProviders?.[activeProvider];
    const backupTag =
      configuredProvidersCount > 1
        ? ` · ${configuredProvidersCount} provs.`
        : "";

    if (!hasAnyConfiguredKey) {
      return {
        tierLabel: `Conexión IA · ${activeSpec.shortName}`,
        headline: "Sin conectar",
        detail: "Conecta uno o varios proveedores de IA",
        pct: 0,
        meterMode: "unlimited" as const,
        hasMeterBar: false,
        connected: false,
        alert: false,
      };
    }

    if (activeSlot?.quotaStatus === "exhausted" || activeSlot?.quotaStatus === "cooldown") {
      return {
        tierLabel: `${activeSpec.shortName} · Límite`,
        headline: activeSlot.quotaStatus === "exhausted" ? "Sin cuota" : "En espera",
        detail: activeSlot.quotaReason || `Respaldo automático ${aiConfig.autoFailover !== false ? "listo" : "inactivo"}${backupTag}`,
        pct: 100,
        meterMode: "used" as const,
        hasMeterBar: true,
        connected: true,
        alert: true,
      };
    }

    if (accountUsage && !accountUsage.ok && (!accountUsage.provider || normalizeProviderIdClient(accountUsage.provider) === activeProvider)) {
      return {
        tierLabel: `${activeSpec.shortName}${backupTag}`,
        headline: "Requiere revisión",
        detail: accountUsage.message || `Revisa tu conexión con ${activeSpec.shortName}`,
        pct: 100,
        meterMode: "used" as const,
        hasMeterBar: true,
        connected: true,
        alert: true,
      };
    }

    return {
      tierLabel: `${computedUsage.tierLabel}${backupTag}`,
      headline: computedUsage.headline,
      detail: computedUsage.subline,
      pct: computedUsage.pct,
      meterMode: computedUsage.meterMode,
      hasMeterBar: computedUsage.hasMeterBar,
      connected: true,
      alert: false,
    };
  })();
  const sidebarUsageLabel = footerUsageText({
    connected: usageSummary.connected,
    providerName: activeSpec.shortName,
    alertHeadline: usageSummary.alert ? usageSummary.headline : null,
    shortBadge: computedUsage.shortBadge,
    sourceKind: computedUsage.sourceKind,
  });
  const sidebarUsageDetail = `${usageSummary.tierLabel}: ${usageSummary.headline} · ${usageSummary.detail}`;

  async function refreshModelsAndUsage(
    forceRefresh = false,
    hasKeyOverride?: boolean,
    maskedKeyOverride?: string | null,
    providerOverride?: AiProviderId
  ) {
    const targetPid = normalizeProviderIdClient(providerOverride ?? aiConfig.provider);
    setLoadingModels(true);
    let latestCatalog: OpenRouterModelOption[] = getProviderSpec(targetPid).curatedModels;
    try {
      const res = await fetchOpenRouterModels(false, forceRefresh, targetPid);
      if (res.models.length > 0) {
        latestCatalog = res.models;
        setCatalogModels(res.models);
      }
    } catch {
      setCatalogModels(latestCatalog);
    } finally {
      setLoadingModels(false);
    }

    void getAiUsageLedger().then(setUsageLedger).catch(() => {});

    const hasKey = hasKeyOverride ?? aiConfig.hasApiKey;
    const keyScope = maskedKeyOverride !== undefined ? maskedKeyOverride : aiConfig.maskedKey;
    setRequestsToday(getLocalDailyRequestCount(keyScope));

    if (hasKey) {
      try {
        const usageRes = await testAiConnection(targetPid);
        setAccountUsage(usageRes);
        void getAiUsageLedger().then(setUsageLedger).catch(() => {});
        if (targetPid === "openrouter" && usageRes.ok && !usageRes.can_use_paid_models) {
          setModelId((curr) => {
            const info = formatModelDisplay(curr, latestCatalog);
            return info.is_free ? curr : "openrouter/free";
          });
        }
      } catch {
        // Conserva estado anterior si falla la red
      }
    } else {
      setAccountUsage(null);
    }
  }

  async function hydrateLedgerState(preserveSecretCards = true) {
    if (!isWorkspaceTauriRuntime()) return;
    try {
      const ledger = await hydrateWorkspaceLedger();
      setTasks((prev) => {
        if (!preserveSecretCards) return ledger.tasks;
        const ephemeralSecrets = prev.filter((t) => t.intent.type === "save_api_key");
        const seen = new Set(ephemeralSecrets.map((t) => t.cardId));
        return [
          ...ephemeralSecrets,
          ...ledger.tasks.filter((t) => !seen.has(t.cardId)),
        ];
      });
      const repairedAgendaToPersist: LedgerAgendaItem[] = [];
      const normalizedAgenda = ledger.agendaItems.map((item) => {
        const repaired = inferAlarmFromMisclassifiedTimer(item);
        if (repaired) {
          repairedAgendaToPersist.push(repaired as LedgerAgendaItem);
          return repaired as LedgerAgendaItem;
        }
        return item;
      });
      setAgendaItems(normalizedAgenda);
      if (repairedAgendaToPersist.length > 0 && isWorkspaceTauriRuntime()) {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        for (const repairedItem of repairedAgendaToPersist) {
          void upsertAgendaItem(repairedItem).catch(() => {});
        }
      }
      setHistoryItems(ledger.historyItems);
    } catch (err) {
      console.error("Error hidratando ledger SQLite:", err);
    }
  }

  const hydrateWorkspaceState = async (
    overview: WorkspaceOverview,
    preferredSelectedPath?: string | null,
    overridePinned?: Set<string>
  ) => {
    setWorkspaceOverview(overview);
    setPatterns(overview.patterns ?? []);

    const activePinned = overridePinned ?? pinnedWorkspacePaths;
    const fileEntries = overview.entries.filter((e) => e.kind === "file" && e.editable);
    const availableSet = new Set(fileEntries.map((e) => e.relativePath));

    const toLoad = Array.from(new Set([...activePinned, "memoria/hechos.md"])).filter((p) =>
      availableSet.has(p)
    );
    const loadedSnippets = await Promise.all(
      toLoad.map(async (relPath): Promise<ContextItem | null> => {
        try {
          const f = await readWorkspaceFile(relPath);
          const ctxType: ContextItem["type"] =
            f.zone === "empresa"
              ? "profile"
              : f.zone === "memoria"
              ? "memory"
              : f.zone === "habilidades"
              ? "skill"
              : "catalog";
          return {
            id: `ws_${f.relativePath}`,
            name: f.name,
            type: ctxType,
            path: f.relativePath,
            pinned: activePinned.has(f.relativePath),
            content: f.content,
          };
        } catch {
          return null;
        }
      })
    );

    const cleanContext = loadedSnippets.filter((c): c is ContextItem => c !== null);
    setContextItems(cleanContext);

    const targetSelect =
      (preferredSelectedPath && availableSet.has(preferredSelectedPath)
        ? preferredSelectedPath
        : null) ??
      (availableSet.has("empresa/perfil.json")
        ? "empresa/perfil.json"
        : fileEntries[0]?.relativePath ?? null);

    if (targetSelect) {
      try {
        const f = await readWorkspaceFile(targetSelect);
        setSelectedWorkspaceFile({
          relativePath: f.relativePath,
          name: f.name,
          zone: f.zone,
          content: f.content,
          editable: f.editable,
          pinned: activePinned.has(f.relativePath),
          tokens: estimateTokens(f.content),
        });
        setSelectedContext(
          cleanContext.find((c) => c.path === f.relativePath) ?? cleanContext[0] ?? null
        );
      } catch {
        setSelectedWorkspaceFile(null);
      }
    } else {
      setSelectedWorkspaceFile(null);
      setSelectedContext(cleanContext[0] ?? null);
    }
  };

  const refreshInventoryAndReview = async () => {
    if (!isWorkspaceTauriRuntime()) return;
    const [invItems, reviews] = await Promise.all([
      listInventoryItems().catch(() => []),
      listReviewRuns(1).catch(() => []),
    ]);
    setInventoryItems(invItems);
    setLatestReview(reviews[0] ?? null);
  };

  useEffect(() => {
    async function loadData() {
      const tauriActive = isWorkspaceTauriRuntime();
      setIsTauriEnv(tauriActive);

      if (tauriActive) {
        setWorkspaceLoading(true);
        try {
          const overview = await getWorkspaceOverview();
          if (overview) {
            await hydrateWorkspaceState(overview);
            await Promise.all([
              hydrateLedgerState(false),
              refreshInventoryAndReview(),
            ]);
          }
        } catch (err) {
          console.error("Error inicializando workspace:", err);
        } finally {
          setWorkspaceLoading(false);
        }
      } else {
        // Modo Browser Preview: sin mocks falsos
        setContextItems([]);
        setSelectedContext(null);
        setPatterns([]);
        setTasks([]);
        setAgendaItems([]);
        setHistoryItems([]);
      }

      try {
        const [savedUser, savedConvs, savedFacts] = await Promise.all([
          getLocalUserProfile(),
          listLocalConversations(),
          listUserMemoryFacts(),
        ]);
        setLocalUser(savedUser);
        setConversations(savedConvs);
        setUserMemoryFacts(savedFacts);
      } catch {
        // Sin datos previos locales
      }

      try {
        const cfg = await getAiConfigStatus();
        setAiConfig(cfg);
        if (cfg.modelId) {
          setModelId(cfg.modelId);
        }
        const cfgPid = normalizeProviderIdClient(cfg.provider);
        await refreshModelsAndUsage(false, cfg.hasApiKey, cfg.maskedKey, cfgPid);
      } catch {
        // Mantiene valores iniciales si aún no hay bóveda
        await refreshModelsAndUsage(false, false, null, "openrouter");
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubUsage: (() => void) | null = null;
    void getAiUsageLedger()
      .then((ledger) => {
        if (!disposed) setUsageLedger(ledger);
      })
      .catch(() => {});
    void onAiUsageUpdated((ledger) => {
      if (!disposed) setUsageLedger(ledger);
    }).then((fn) => {
      if (disposed) fn();
      else unsubUsage = fn;
    });
    return () => {
      disposed = true;
      unsubUsage?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnv) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let unlistenAiConfig: (() => void) | null = null;
    subscribeLedgerUpdated(() => {
      if (disposed) return;
      if (Date.now() < suppressLedgerSyncUntilRef.current) return;
      void hydrateLedgerState(true);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<AiConfigStatus>("xox-ai-config-updated", (ev) => {
          if (disposed || !ev.payload) return;
          const next = ev.payload;
          setAiConfig(next);
          if (next.modelId) setModelId(next.modelId);
          setRequestsToday(getLocalDailyRequestCount(next.maskedKey));
        })
      )
      .then((fn) => {
        if (disposed) fn();
        else unlistenAiConfig = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
      unlistenAiConfig?.();
    };
  }, [isTauriEnv]);

  useEffect(() => {
    let disposed = false;
    let unsubUser: (() => void) | null = null;
    let unsubMemory: (() => void) | null = null;
    void subscribeLocalUserUpdated((profile) => {
      if (!disposed) {
        setLocalUser(profile);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unsubUser = fn;
    });
    void subscribeUserMemoryUpdated((syncEvt) => {
      if (!disposed) {
        void listUserMemoryFacts()
          .then((facts) => {
            if (!disposed) {
              setUserMemoryFacts(facts);
              if (
                syncEvt.sourceWindow !== "main" ||
                Date.now() >= suppressMemorySyncPulseUntilRef.current
              ) {
                triggerMemoryLivePulse("synced", "xox");
              }
            }
          })
          .catch(() => {});
      }
    }).then((fn) => {
      if (disposed) fn();
      else unsubMemory = fn;
    });
    return () => {
      disposed = true;
      unsubUser?.();
      unsubMemory?.();
    };
  }, []);

  const convPersistInFlightRef = useRef<boolean>(false);
  const convPersistQueueRef = useRef<Map<string, ConversationThread>>(new Map());

  const flushConversationQueue = async () => {
    if (convPersistInFlightRef.current) return;
    convPersistInFlightRef.current = true;
    try {
      while (convPersistQueueRef.current.size > 0) {
        const nextEntry = convPersistQueueRef.current.entries().next();
        if (nextEntry.done) break;
        const [queuedId, queuedThread] = nextEntry.value;
        convPersistQueueRef.current.delete(queuedId);
        try {
          const updatedList = await saveLocalConversation(queuedThread);
          setConversations(updatedList);
        } catch {
          // Mantiene historial en memoria aunque falle escritura
        }
      }
    } finally {
      convPersistInFlightRef.current = false;
      if (convPersistQueueRef.current.size > 0) {
        void flushConversationQueue();
      }
    }
  };

  const persistConversation = async (
    nextMessages: UiChatMessage[],
    convId = activeConvIdRef.current,
    checkpointOverride?: ContextCheckpoint | null,
    compactedUpToOverride?: string | null
  ) => {
    if (nextMessages.length === 0) return;
    const now = new Date().toISOString();
    const thread: ConversationThread = {
      id: convId,
      title: deriveConversationTitle(nextMessages),
      createdAt: activeConvCreatedAtRef.current,
      updatedAt: now,
      userId: localUser?.id ?? null,
      messages: nextMessages,
      checkpoint:
        checkpointOverride !== undefined ? checkpointOverride : chatCheckpointRef.current,
      compactedUpToMessageId:
        compactedUpToOverride !== undefined
          ? compactedUpToOverride
          : compactedUpToMsgIdRef.current,
    };
    convPersistQueueRef.current.set(convId, thread);
    await flushConversationQueue();
  };

  const handleStartNewChat = () => {
    if (isChatStreaming) return;
    const nextId = `conv_${Date.now()}`;
    activeConvCreatedAtRef.current = new Date().toISOString();
    setActiveConversationId(nextId);
    setChatMessages([]);
    setPermissionItems([]);
    setChatCheckpoint(null);
    setCompactedUpToMessageId(null);
    setActiveCanvas(null);
    setShowCanvas(false);
    setActiveChecklist(null);
    setShowRosterPopover(false);
    setXoxState("idle");
    setXoxMessage(DEFAULT_IDLE_GREETING);
    setHomeGreetingSlot({
      seed: Math.floor(Math.random() * 100_000),
      nowMs: Date.now(),
      avoidText: heroGreeting,
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelectConversation = (thread: ConversationThread) => {
    if (isChatStreaming) return;
    activeConvCreatedAtRef.current = thread.createdAt;
    setActiveConversationId(thread.id);
    const msgs = thread.messages ?? [];
    setChatMessages(msgs);
    setPermissionItems([]);
    setChatCheckpoint(thread.checkpoint ?? null);
    setCompactedUpToMessageId(thread.compactedUpToMessageId ?? null);
    let restoredCanvas: CanvasArtifact | null = null;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const candidate =
        msgs[i].canvases && msgs[i].canvases!.length > 0
          ? msgs[i].canvases![msgs[i].canvases!.length - 1]
          : msgs[i].canvas;
      if (candidate) {
        const cleanRestored = sanitizeCanvasArtifact(candidate);
        if (cleanRestored && canvasHasCellData(cleanRestored)) {
          restoredCanvas = cleanRestored;
          break;
        }
      }
    }
    setActiveCanvas(restoredCanvas);
    setShowCanvas(Boolean(restoredCanvas));
    setXoxState("idle");
    setXoxMessage("¿En qué puedo ayudarte?");
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const updated = await deleteLocalConversation(id);
      setConversations(updated);
      if (id === activeConvIdRef.current) {
        handleStartNewChat();
      }
    } catch {
      // Ignorar
    }
  };

  const handleRateMessage = (msgId: string, rating: "up" | "down") => {
    const nextMessages = chatMessagesRef.current.map((m) =>
      m.id === msgId ? { ...m, feedback: m.feedback === rating ? null : rating } : m
    );
    setChatMessages(nextMessages);
    void persistConversation(nextMessages);
  };

  // Notificación discreta del aprendizaje más reciente (aparece y se oculta sola)
  useEffect(() => {
    if (patterns.length === 0) return;
    const latest = [...patterns].sort((a, b) => b.confidence - a.confidence)[0];
    const showT = setTimeout(() => setLearningToast(latest), 1200);
    const hideT = setTimeout(() => setLearningToast(null), 9000);
    return () => {
      clearTimeout(showT);
      clearTimeout(hideT);
    };
  }, [patterns]);

  permissionEventHandlersRef.current = {
    onRequest: (req) => {
      if (
        req.streamId &&
        activeStreamIdRef.current &&
        req.streamId !== activeStreamIdRef.current
      ) {
        return;
      }
      if (!activeStreamIdRef.current && req.streamId) {
        return;
      }
      setPermissionItems((prev) => applyPermissionRequestItem(prev, req));
      const targetMsgId = activeAssistantMsgIdRef.current;
      if (targetMsgId) {
        const nextTimeline = upsertPermissionRequestInTimeline(
          activeTimelineRef.current,
          req
        );
        activeTimelineRef.current = nextTimeline;
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === targetMsgId ? { ...m, timeline: nextTimeline } : m
          )
        );
      }
    },
    onFinished: (ev) => {
      const matchesActiveStream = Boolean(
        ev.streamId &&
          activeStreamIdRef.current &&
          ev.streamId === activeStreamIdRef.current
      );
      const belongsToOtherStream = Boolean(
        ev.streamId &&
          (!activeStreamIdRef.current || ev.streamId !== activeStreamIdRef.current)
      );
      if (belongsToOtherStream) {
        setPermissionItems((prev) => applyCommandFinishedEvent(prev, ev));
        setChatMessages((prev) => {
          if (!prev.some((m) => timelineHasRequestId(m.timeline, ev.requestId))) {
            return prev;
          }
          return prev.map((m) =>
            timelineHasRequestId(m.timeline, ev.requestId)
              ? { ...m, timeline: applyCommandFinishedInTimeline(m.timeline, ev) }
              : m
          );
        });
        return;
      }
      setPermissionItems((prev) =>
        applyCommandFinishedEvent(prev, ev, { allowInsert: matchesActiveStream })
      );
      const targetMsgId = activeAssistantMsgIdRef.current;
      if (targetMsgId) {
        const nextTimeline = applyCommandFinishedInTimeline(
          activeTimelineRef.current,
          ev,
          { allowInsert: matchesActiveStream }
        );
        activeTimelineRef.current = nextTimeline;
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === targetMsgId ? { ...m, timeline: nextTimeline } : m
          )
        );
      }
    },
  };

  useEffect(() => {
    if (!isTauriEnv) return;

    const showNotice = (msg: string, durationMs = 4500) => {
      setStatusMessage(msg);
      setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), durationMs);
    };

    const unsubWorkspace = subscribeWorkspaceUpdated(() => {
      void getWorkspaceOverview()
        .then((overview) => {
          if (overview) {
            return hydrateWorkspaceState(overview, selectedWorkspacePathRef.current);
          }
          return undefined;
        })
        .catch(() => {});
      const openDoc = docViewerRef.current;
      if (
        openDoc.show &&
        openDoc.state?.path &&
        openDoc.state.fileKind !== "pdf" &&
        !openDoc.state.isLoadingPages
      ) {
        const targetPath = openDoc.state.path;
        void readUniversalDocument(targetPath)
          .then((doc) => {
            if (!doc) return;
            patchDocTab(targetPath, (curr) => ({
              ...curr,
              title: doc.title || curr.title,
              sizeBytes: doc.sizeBytes ?? curr.sizeBytes,
              universalDoc: doc,
              textContent: doc.markdown ?? doc.text ?? curr.textContent,
              revision: Date.now(),
              error: doc.ok === false ? doc.error || "No se pudo leer el archivo." : null,
            }));
          })
          .catch(() => {});
      }
      void refreshInventoryAndReview();
      void refreshXoxStudioData();
    });

    const unsubReview = subscribeReviewUpdated((result) => {
      setLatestReview(result.reviewRun);
      void listInventoryItems().then(setInventoryItems).catch(() => {});
      if (result.newTasksCount > 0) {
        void hydrateLedgerState(true).catch(() => {});
      }
    });

    const unsubAgendaDatos = subscribeAgendaAndDatosEvents({
      onTimerExpired: (notice) => {
        showNotice(`Reloj vencido: "${notice.title}"`, 6000);
        void hydrateLedgerState(true).catch(() => {});
      },
      onAgendaDue: (notice) => {
        showNotice(`Agenda: "${notice.title}" (${notice.timeLabel})`, 6000);
        void hydrateLedgerState(true).catch(() => {});
      },
      onDatosChanged: (notice) => {
        showNotice(
          notice.newTasksCount > 0
            ? `Cambios detectados en ${notice.path}: ${notice.newTasksCount} nuevas propuestas.`
            : `Datos actualizados en ${notice.path}: ${notice.summary}`,
          5500
        );
      },
    });

    const unsubPermissions = subscribePermissionEvents({
      onRequest: (req) => permissionEventHandlersRef.current.onRequest(req),
      onFinished: (ev) => permissionEventHandlersRef.current.onFinished(ev),
    });

    return () => {
      unsubWorkspace();
      unsubReview();
      unsubAgendaDatos();
      unsubPermissions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriEnv]);

  const prevInputPromptRef = useRef<string>(inputPrompt);

  // El input crece como una burbuja solo cuando hay texto escrito (vacío siempre queda en 1 línea)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const textChanged = prevInputPromptRef.current !== inputPrompt;
    prevInputPromptRef.current = inputPrompt;

    const syncHeight = (animateHeight: boolean) => {
      if (!inputPrompt) {
        if (el.style.height || el.style.overflowY !== "hidden") {
          if (!animateHeight) el.style.transition = "none";
          el.style.height = "";
          el.style.overflowY = "hidden";
          if (!animateHeight) {
            void el.offsetHeight;
            el.style.transition = "";
          }
        }
        setInputExpanded(false);
        return;
      }

      const prevHeight = parseFloat(el.style.height || "0") || el.offsetHeight;
      el.style.transition = "none";
      el.style.height = "auto";
      const target = Math.min(el.scrollHeight, 200);
      el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";

      if (animateHeight && Math.abs(target - prevHeight) >= 1) {
        el.style.height = `${prevHeight}px`;
        void el.offsetHeight; // forzar reflow para que la transición parta de la altura previa
        el.style.transition = "";
        el.style.height = `${target}px`;
      } else {
        el.style.height = `${target}px`;
        void el.offsetHeight;
        el.style.transition = "";
      }
      setInputExpanded(target > 46);
    };

    syncHeight(textChanged);

    if (!inputPrompt || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncHeight(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [inputPrompt]);

  // Cerrar menús desplegables (modelos, contexto, comandos y equipo multi-agente) al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!showModelMenu && !showContextMenu && !showCommandMenu && !showRosterPopover) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showModelMenu && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setShowModelMenu(false);
      }
      if (showContextMenu && contextMenuRef.current && !contextMenuRef.current.contains(target)) {
        setShowContextMenu(false);
      }
      if (
        showCommandMenu &&
        commandMenuRef.current &&
        !commandMenuRef.current.contains(target) &&
        !commandTriggerRef.current?.contains(target)
      ) {
        setShowCommandMenu(false);
      }
      if (
        showRosterPopover &&
        rosterPopoverRef.current &&
        !rosterPopoverRef.current.contains(target)
      ) {
        setShowRosterPopover(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showModelMenu) {
          setShowModelMenu(false);
          modelTriggerRef.current?.focus();
        }
        if (showContextMenu) {
          setShowContextMenu(false);
          contextTriggerRef.current?.focus();
        }
        if (showCommandMenu) {
          setShowCommandMenu(false);
          commandTriggerRef.current?.focus();
        }
        if (showRosterPopover) {
          setShowRosterPopover(false);
        }
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [showModelMenu, showContextMenu, showCommandMenu, showRosterPopover]);

  const handleListboxKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    closeMenu: () => void,
    triggerEl: HTMLButtonElement | null
  ) => {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      triggerEl?.focus();
    }
  };

  // Atajos de teclado: ⌘K (input), ⌘⇧X (Quick Bar), ⌘⌥→ / ⌘⌥← / ⌘⌥↑ (Modo Asistencia) y Escape (drawers compactos)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "x" && isTauriEnv) {
        e.preventDefault();
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("toggle_quick_bar_cmd"))
          .catch(() => {});
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && isTauriEnv) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          void handleApplyAssistLayout({
            preset: assistStatus.active ? assistStatus.preset : "balanced",
            side: "right",
            splitCompanion: assistStatus.splitCompanion,
            alwaysOnTop: assistStatus.alwaysOnTop,
          });
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          void handleApplyAssistLayout({
            preset: assistStatus.active ? assistStatus.preset : "balanced",
            side: "left",
            splitCompanion: assistStatus.splitCompanion,
            alwaysOnTop: assistStatus.alwaysOnTop,
          });
          return;
        }
        if (e.key === "ArrowUp" && assistStatus.active) {
          e.preventDefault();
          void handleExitAssist();
          return;
        }
      }
      if (
        e.key === "Escape" &&
        hasCompactOverlayOpen &&
        !showModelMenu &&
        !showContextMenu &&
        !showCommandMenu &&
        !showRosterPopover
      ) {
        e.preventDefault();
        closeAllCompactOverlays();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isTauriEnv,
    assistStatus.active,
    assistStatus.preset,
    assistStatus.splitCompanion,
    assistStatus.alwaysOnTop,
    hasCompactOverlayOpen,
    showModelMenu,
    showContextMenu,
    showCommandMenu,
    showRosterPopover,
    handleApplyAssistLayout,
    handleExitAssist,
  ]);

  // Manejador global de arrastre para redimensionar paneles (60fps sin pérdida de foco)
  useEffect(() => {
    if (!isResizingLeft && !isResizingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.min(Math.max(e.clientX, MIN_LEFT_WIDTH), MAX_LEFT_WIDTH);
        setLeftWidth(newWidth);
        try {
          localStorage.setItem("xook_left_width", String(newWidth));
        } catch {
          // Ignore
        }
      } else if (isResizingRight) {
        const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, MIN_RIGHT_WIDTH), MAX_RIGHT_WIDTH);
        setRightWidth(newWidth);
        try {
          localStorage.setItem("xook_right_width", String(newWidth));
        } catch {
          // Ignore
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingLeft, isResizingRight]);

  const tasksRef = useRef<TaskProposal[]>(tasks);
  tasksRef.current = tasks;

  // Reloj en vivo para temporizadores activos en la pestaña Agenda
  const hasRunningTimers = agendaItems.some(
    (item) => item.kind === "timer" && item.isRunning && (item.remainingSeconds ?? 0) > 0
  );

  useEffect(() => {
    if (!hasRunningTimers) return;
    const interval = setInterval(() => {
      const nowMs = Date.now();
      let finishedTitle: string | null = null;
      for (const item of agendaItemsRef.current) {
        if (item.kind !== "timer" || !item.isRunning) continue;
        const nextRem = item.endsAt
          ? Math.max(0, Math.ceil((Date.parse(item.endsAt) - nowMs) / 1000))
          : Math.max(0, (item.remainingSeconds ?? 0) - 1);
        if (nextRem <= 0) {
          finishedTitle = item.title;
          break;
        }
      }

      setAgendaItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "timer" || !item.isRunning) return item;
          const remaining = item.endsAt
            ? Math.max(0, Math.ceil((Date.parse(item.endsAt) - nowMs) / 1000))
            : Math.max(0, (item.remainingSeconds ?? 0) - 1);
          if (remaining <= 0) {
            return {
              ...item,
              remainingSeconds: 0,
              isRunning: false,
              endsAt: undefined,
              timeLabel: "00:00",
            };
          }
          return { ...item, remainingSeconds: remaining };
        })
      );

      if (finishedTitle) {
        setXoxState("alert");
        setXoxMessage(`¡Tiempo cumplido: ${finishedTitle}!`);
        setStatusMessage(`Reloj finalizado: "${finishedTitle}"`);
        if (isTauriEnv) {
          suppressLedgerSyncUntilRef.current = Date.now() + 350;
          void listAgendaItems();
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimers, isTauriEnv]);

  const nowTimeLabel = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const schedulePersistTaskProposal = (updatedTask: TaskProposal) => {
    if (!isTauriEnv || updatedTask.intent.type === "save_api_key") return;
    const prevTimer = paramSyncTimersRef.current[updatedTask.cardId];
    if (prevTimer) clearTimeout(prevTimer);
    paramSyncTimersRef.current[updatedTask.cardId] = setTimeout(() => {
      delete paramSyncTimersRef.current[updatedTask.cardId];
      void updateTaskProposal(updatedTask.cardId, updatedTask);
    }, 220);
  };

  const handleUpdateTaskParam = (
    cardId: string,
    key: string,
    value: number | string | boolean
  ) => {
    const existing = tasksRef.current.find((t) => t.cardId === cardId);
    if (existing) {
      schedulePersistTaskProposal({
        ...existing,
        paramValues: { ...existing.paramValues, [key]: value },
      });
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.cardId === cardId
          ? { ...t, paramValues: { ...t.paramValues, [key]: value } }
          : t
      )
    );
  };

  const handleToggleTaskChecklist = (cardId: string, itemId: string) => {
    const existing = tasksRef.current.find((t) => t.cardId === cardId);
    if (existing && isTauriEnv && existing.intent.type !== "save_api_key") {
      const updatedTask: TaskProposal = {
        ...existing,
        blocks: existing.blocks.map((blk) =>
          blk.type === "checklist"
            ? {
                ...blk,
                items: blk.items.map((it) =>
                  it.id === itemId ? { ...it, done: !it.done } : it
                ),
              }
            : blk
        ),
      };
      void updateTaskProposal(cardId, updatedTask);
    }
    setTasks((prev) =>
      prev.map((t) => {
        if (t.cardId !== cardId) return t;
        return {
          ...t,
          blocks: t.blocks.map((blk) =>
            blk.type === "checklist"
              ? {
                  ...blk,
                  items: blk.items.map((it) =>
                    it.id === itemId ? { ...it, done: !it.done } : it
                  ),
                }
              : blk
          ),
        };
      })
    );
  };

  const handleSelectModel = async (nextModelId: string) => {
    setModelId(nextModelId);
    setShowModelMenu(false);
    inputRef.current?.focus();
    try {
      const updated = await saveAiConfig({
        provider: activeProvider,
        targetProvider: activeProvider,
        modelId: nextModelId,
      });
      setAiConfig(updated);
    } catch {
      // Mantiene selección local en caso de error temporal
    }
  };

  const saveVaultKeyDirect = async (
    targetPid: AiProviderId,
    rawKey: string,
    modelIdOverride?: string,
    recordTitle?: string
  ) => {
    const targetSpec = getProviderSpec(targetPid);
    const cleanedKey = normalizeApiKey(rawKey);
    const existingSlotModel = aiConfig.configuredProviders?.[targetPid]?.modelId;
    const chosenInitialModel =
      modelIdOverride ||
      existingSlotModel ||
      (targetPid === activeProvider ? modelId : targetSpec.defaultModelId);

    setXoxState("syncing");
    setXoxMessage(`Guardando clave de ${targetSpec.shortName} en bóveda y probando conexión...`);
    const updated = await saveAiConfig({
      provider: targetPid,
      targetProvider: targetPid,
      apiKey: cleanedKey,
      modelId: chosenInitialModel,
      clearCooldown: true,
    });
    setAiConfig(updated);
    setModelId(updated.modelId || chosenInitialModel);

    const [testRes, catRes] = await Promise.all([
      testAiConnection(targetPid),
      fetchOpenRouterModels(false, true, targetPid).catch(() => ({
        ok: false,
        models: targetSpec.curatedModels,
        source: "presets",
      })),
    ]);
    setAccountUsage(testRes);
    if (catRes.models.length > 0) {
      setCatalogModels(catRes.models);
    }
    setRequestsToday(getLocalDailyRequestCount(updated.maskedKey));

    let effectiveModel = updated.modelId || chosenInitialModel;
    if (targetPid === "openrouter" && testRes.ok && !testRes.can_use_paid_models) {
      const isFreeNow = formatModelDisplay(effectiveModel, catRes.models).is_free;
      if (!isFreeNow) {
        effectiveModel = "openrouter/free";
        setModelId("openrouter/free");
      }
    }
    const maskedLabel = updated.maskedKey ?? "cifrada";
    const displayCatalog = catRes.models.length > 0 ? catRes.models : targetSpec.curatedModels;

    const fallbackHistory: TaskHistoryItem = {
      id: `hist_vault_${targetPid}_${Date.now()}`,
      title: recordTitle ?? `Guardar clave API de ${targetSpec.shortName}`,
      category: "boveda",
      decision: "approved",
      summary: `${targetSpec.shortName} (${maskedLabel})`,
      timestampLabel: nowTimeLabel(),
    };
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      const savedHist = await recordHistoryEntry({
        id: fallbackHistory.id,
        title: fallbackHistory.title,
        category: fallbackHistory.category,
        decision: "approved",
        summary: fallbackHistory.summary,
        decidedBy: localUser?.name ?? undefined,
      }).catch(() => null);
      setHistoryItems((prev) => [savedHist ?? fallbackHistory, ...prev]);
    } else {
      setHistoryItems((prev) => [fallbackHistory, ...prev]);
    }

    setStatusMessage(
      testRes.ok
        ? `${targetSpec.shortName} conectado (${maskedLabel}).`
        : `Clave guardada (${maskedLabel}); revisa la conexión.`
    );
    setXoxState(testRes.ok ? "success" : "alert");
    setXoxMessage(
      testRes.ok
        ? `¡${targetSpec.shortName} conectado y listo para trabajar!`
        : testRes.message
    );
    setTimeout(() => {
      setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
      setXoxMessage("¿En qué puedo ayudarte?");
    }, 4000);
    setTimeout(() => setStatusMessage(null), 4500);

    return {
      targetSpec,
      updated,
      testRes,
      effectiveModel,
      maskedLabel,
      displayCatalog,
    };
  };

  const executeSavePendingKey = async (cardId: string, cardRef?: TaskProposal) => {
    const pending = pendingSecretKeysRef.current.get(cardId);
    if (!pending?.key) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        )
      );
      setStatusMessage("La clave ya fue procesada o expiró en memoria. Pégala de nuevo o usa Ajustes.");
      setTimeout(() => setStatusMessage(null), 4000);
      return;
    }

    const targetPid = pending.provider;
    try {
      const saved = await saveVaultKeyDirect(
        targetPid,
        pending.key,
        undefined,
        cardRef?.title
      );
      pendingSecretKeysRef.current.delete(cardId);
      setTasks((prev) => prev.filter((t) => t.cardId !== cardId));

      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current.map((m) =>
          m.actionButton?.cardId === cardId ? { ...m, actionButton: undefined } : m
        ),
        {
          id: `msg_a_${Date.now()}`,
          role: "assistant",
          content: saved.testRes.ok
            ? `Clave de **${saved.targetSpec.name}** guardada en bóveda segura (**${saved.maskedLabel}**) y conexión verificada.\n\n${saved.testRes.message} Ya puedes conversar conmigo usando **${formatModelDisplay(saved.effectiveModel, saved.displayCatalog).name}**.`
            : `Clave de **${saved.targetSpec.name}** guardada en bóveda segura (**${saved.maskedLabel}**), pero la verificación devolvió un aviso:\n${saved.testRes.message}`,
          isError: !saved.testRes.ok,
          actionButton: saved.testRes.ok
            ? undefined
            : {
                label: `Revisar Ajustes de ${saved.targetSpec.shortName}`,
                kind: "open_settings",
                provider: targetPid,
              },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
    } catch (err) {
      pendingSecretKeysRef.current.delete(cardId);
      console.error(err);
      setXoxState("alert");
      setXoxMessage("No se pudo guardar la clave en la bóveda.");
      setStatusMessage("Error al guardar la clave en la bóveda local.");
      setTimeout(() => setStatusMessage(null), 4500);
    }
  };

  const handleSaveInlineVaultKey = async (
    msgId: string,
    provider: AiProviderId,
    rawKeyInput: string,
    modelIdOverride?: string
  ): Promise<{ ok: boolean; message: string; maskedKey?: string }> => {
    const cleanedKey = normalizeApiKey(rawKeyInput);
    if (!cleanedKey) {
      return { ok: false, message: "Ingresa una API key válida antes de guardar." };
    }
    try {
      const saved = await saveVaultKeyDirect(provider, cleanedKey, modelIdOverride);
      const nextMessages: UiChatMessage[] = chatMessagesRef.current.map((m) =>
        m.id === msgId
          ? {
              ...m,
              actionButton: undefined,
              vaultPrompt: {
                provider,
                intent: m.vaultPrompt?.intent ?? "prompt_key",
                completed: true,
                savedMaskedKey: saved.maskedLabel,
              },
            }
          : m
      );
      const confirmMsg: UiChatMessage = {
        id: `msg_a_${Date.now()}`,
        role: "assistant",
        content: saved.testRes.ok
          ? `Listo, guardé tu clave de **${saved.targetSpec.name}** (**${saved.maskedLabel}**) en la bóveda local y verifiqué la conexión.\n\n${saved.testRes.message} Modelo activo: **${formatModelDisplay(saved.effectiveModel, saved.displayCatalog).name}**.`
          : `Clave de **${saved.targetSpec.name}** guardada en la bóveda (**${saved.maskedLabel}**), pero la prueba devolvió un aviso:\n${saved.testRes.message}`,
        isError: !saved.testRes.ok,
        actionButton: saved.testRes.ok
          ? undefined
          : {
              label: `Revisar Ajustes de ${saved.targetSpec.shortName}`,
              kind: "open_settings",
              provider,
            },
      };
      const updatedThread = [...nextMessages, confirmMsg];
      setChatMessages(updatedThread);
      void persistConversation(updatedThread);
      return {
        ok: true,
        maskedKey: saved.maskedLabel,
        message: saved.testRes.ok
          ? `${saved.targetSpec.shortName} conectado (${saved.maskedLabel}).`
          : `Clave guardada (${saved.maskedLabel}). ${saved.testRes.message}`,
      };
    } catch (err) {
      const errText = extractErrorMessage(err, "No se pudo guardar la clave en la bóveda.");
      setXoxState("alert");
      setXoxMessage(errText);
      return { ok: false, message: errText };
    }
  };

  const handleChatAction = async (
    action: NonNullable<UiChatMessage["actionButton"]>
  ) => {
    if (action.kind === "open_settings") {
      openAiSettings("account", action.provider ?? activeProvider);
      return;
    }
    if (action.kind === "open_clarification" && action.clarification) {
      setActiveClarification(action.clarification);
      return;
    }
    if (action.kind === "open_xox_studio") {
      openXoxStudio(action.studioTab ?? "identity", action.skillSlug);
      return;
    }
    if (action.kind === "save_pending_key" && action.cardId) {
      const matchingCard = tasksRef.current.find((t) => t.cardId === action.cardId);
      await executeSavePendingKey(action.cardId, matchingCard);
    }
  };

  const clearPendingTaskSync = (cardId: string) => {
    const pendingTimer = paramSyncTimersRef.current[cardId];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete paramSyncTimersRef.current[cardId];
    }
  };

  const handleApproveTask = async (task: TaskProposal) => {
    clearPendingTaskSync(task.cardId);
    if (task.intent.type === "save_api_key") {
      await executeSavePendingKey(task.cardId, task);
      return;
    }

    const decision = computeVerifiedDecision(
      task,
      workspaceOverview?.profile.maxBudgetPerOrder
    );
    const decisionType: "approved" | "adjusted" = decision.wasAdjusted ? "adjusted" : "approved";
    const summaryText =
      decision.quantity !== null && task.intent.supplierName
        ? `+${decision.quantity} un. con ${task.intent.supplierName}`
        : task.intent.targetLabel;
    const amountLabel =
      decision.verifiedCost !== null
        ? `$${decision.verifiedCost.toLocaleString()} ${decision.currency}`
        : undefined;
    const notesText = decision.wasAdjusted
      ? "Cantidad o parámetros ajustados por el administrador"
      : "Autorizado por el administrador";

    let promotedAgendaDraft: LedgerAgendaItem | undefined;
    if (
      task.intent.type === "start_timer" ||
      task.intent.type === "schedule_event" ||
      task.intent.type === "save_note"
    ) {
      const schedBlock = task.blocks.find((b) => b.type === "schedule");
      const noteBlock = task.blocks.find((b) => b.type === "note");
      const chkBlock = task.blocks.find((b) => b.type === "checklist");
      const explicitDurationMin =
        typeof task.paramValues.duration_min === "number" && task.paramValues.duration_min > 0
          ? task.paramValues.duration_min
          : schedBlock?.type === "schedule" &&
            typeof schedBlock.durationSeconds === "number" &&
            schedBlock.durationSeconds > 0 &&
            schedBlock.mode === "timer"
          ? Math.round(schedBlock.durationSeconds / 60)
          : null;
      const autoOn =
        typeof task.paramValues.auto_schedule === "boolean"
          ? task.paramValues.auto_schedule
          : schedBlock?.type === "schedule"
          ? Boolean(schedBlock.autoSchedule)
          : false;
      const normalizedChecklist =
        chkBlock?.type === "checklist"
          ? chkBlock.items
              .map((it, idx) => {
                const label =
                  typeof it?.label === "string"
                    ? it.label.trim()
                    : typeof it === "string"
                      ? String(it).trim()
                      : "";
                if (!label) return null;
                return {
                  id: typeof it?.id === "string" && it.id.trim() ? it.id : `chk_${idx + 1}`,
                  label,
                  done: Boolean(it?.done),
                };
              })
              .filter(
                (it): it is { id: string; label: string; done: boolean } => Boolean(it)
              )
          : [];
      const agendaChecklist = normalizedChecklist.length > 0 ? normalizedChecklist : undefined;
      const resolvedTimeLabel =
        typeof task.paramValues.window_slot === "string" && task.paramValues.window_slot.trim()
          ? `${task.paramValues.window_slot.trim()} hrs`
          : schedBlock?.type === "schedule" && schedBlock.timeLabel?.trim()
          ? schedBlock.timeLabel.trim()
          : task.statusChip?.trim() || "09:00 hrs";
      const resolvedSubtitle =
        task.subtitle?.trim() ||
        (schedBlock?.type === "schedule" ? schedBlock.autoTriggerLabel : undefined);

      if (task.intent.type === "start_timer" && explicitDurationMin !== null) {
        const secs = Math.max(1, explicitDurationMin) * 60;
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: "timer",
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: `${String(explicitDurationMin).padStart(2, "0")}:00`,
          durationSeconds: secs,
          remainingSeconds: secs,
          endsAt: new Date(Date.now() + secs * 1000).toISOString(),
          isRunning: true,
          autoScheduled: autoOn,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      } else if (task.intent.type === "save_note") {
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: "note",
          title: task.title,
          timeLabel: "Fijada",
          noteContent: noteBlock?.type === "note" ? noteBlock.content : task.subtitle,
          checklist: agendaChecklist,
          tags: noteBlock?.type === "note" ? noteBlock.tags : undefined,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      } else {
        const scheduledTarget = parseScheduleTarget({
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: resolvedTimeLabel,
          dateLabel: schedBlock?.type === "schedule" ? schedBlock.dateLabel : undefined,
        });
        const recurrenceLabel =
          schedBlock?.type === "schedule" ? schedBlock.recurrence : undefined;
        promotedAgendaDraft = {
          id: `ag_${Date.now()}`,
          kind: autoOn || Boolean(recurrenceLabel) ? "recurring" : "alarm",
          title: task.title,
          subtitle: resolvedSubtitle,
          timeLabel: scheduledTarget.displayTimeLabel || resolvedTimeLabel,
          recurrence: recurrenceLabel,
          autoScheduled: autoOn,
          scheduleCronOrRule: recurrenceLabel ?? (autoOn ? "Automática" : "Una vez"),
          nextRunAt: scheduledTarget.nextRunAt,
          checklist: agendaChecklist,
          createdAtLabel: `Hoy · ${nowTimeLabel()}`,
        };
      }
    }

    try {
      let persistedHistory: TaskHistoryItem | null = null;
      let persistedAgenda: LedgerAgendaItem | null = null;

      if (isTauriEnv) {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        const result = await decideTaskHitl({
          cardId: task.cardId,
          title: task.title,
          category: task.category,
          decision: decisionType,
          summary: summaryText,
          amountLabel,
          verifiedCost: decision.verifiedCost,
          currency: decision.currency,
          adjustedQty: decision.wasAdjusted ? decision.quantity : null,
          notes: notesText,
          decidedBy: localUser?.name ?? undefined,
          updatedProposal: task,
          promoteAgendaItem: promotedAgendaDraft,
        });
        persistedHistory = result?.historyEntry ?? null;
        persistedAgenda = result?.promotedAgendaItem ?? null;
      }

      const finalAgenda = persistedAgenda ?? promotedAgendaDraft;
      if (finalAgenda) {
        setAgendaItems((prev) => [finalAgenda, ...prev]);
      }

      const historyEntry: TaskHistoryItem = persistedHistory ?? {
        id: `hist_${task.cardId}_${Date.now()}`,
        title: task.title,
        category: task.category,
        decision: decisionType,
        summary: summaryText,
        amountLabel,
        timestampLabel: nowTimeLabel(),
      };

      setHistoryItems((prev) => [historyEntry, ...prev]);
      setTasks((prev) => prev.filter((t) => t.cardId !== task.cardId));

      setStatusMessage(`"${task.title}" autorizado y registrado.`);
      setXoxState("success");
      setXoxMessage(`¡Listo! "${task.title}" confirmado.`);
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 3500);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setStatusMessage("Error al procesar la aprobación.");
    }
  };

  const handleDiscardTask = async (task: TaskProposal) => {
    clearPendingTaskSync(task.cardId);
    if (pendingSecretKeysRef.current.has(task.cardId)) {
      pendingSecretKeysRef.current.delete(task.cardId);
    }
    if (task.intent.type === "save_api_key") {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.actionButton?.cardId === task.cardId ? { ...m, actionButton: undefined } : m
        )
      );
    }

    let persistedHistory: TaskHistoryItem | null = null;
    try {
      if (isTauriEnv && task.intent.type !== "save_api_key") {
        suppressLedgerSyncUntilRef.current = Date.now() + 450;
        const result = await decideTaskHitl({
          cardId: task.cardId,
          title: task.title,
          category: task.category,
          decision: "rejected",
          summary: `Descartada · ${task.intent.targetLabel}`,
          notes: "Descartado desde el panel de tareas",
          decidedBy: localUser?.name ?? undefined,
          updatedProposal: task,
        });
        persistedHistory = result?.historyEntry ?? null;
      }
    } catch {
      // Continuar actualización local si falla escritura
    }

    const historyEntry: TaskHistoryItem = persistedHistory ?? {
      id: `hist_rej_${task.cardId}_${Date.now()}`,
      title: task.title,
      category: task.category,
      decision: "rejected",
      summary: `Descartada · ${task.intent.targetLabel}`,
      timestampLabel: nowTimeLabel(),
    };

    setHistoryItems((prev) => [historyEntry, ...prev]);
    setTasks((prev) => prev.filter((t) => t.cardId !== task.cardId));
    setStatusMessage(`"${task.title}" descartada y registrada en memoria.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleAskXoxAboutTask = (task: TaskProposal) => {
    setInputPrompt(`Sobre "${task.title}": `);
    inputRef.current?.focus();
  };

  const handleRefreshWorkspace = async () => {
    if (!isTauriEnv) return;
    setWorkspaceLoading(true);
    try {
      const overview = await getWorkspaceOverview();
      if (overview) {
        await hydrateWorkspaceState(overview, selectedWorkspaceFile?.relativePath ?? null);
        await Promise.all([
          hydrateLedgerState(true),
          refreshInventoryAndReview(),
        ]);
      }
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const extractWorkspaceFactBody = (line: string): string => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    return (bulletMatch ? bulletMatch[1] : trimmed).trim();
  };

  const formatWorkspaceFactTimestamp = (date = new Date()): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  };

  const readWorkspaceHechosMarkdown = async (): Promise<string> => {
    if (isTauriEnv) {
      try {
        const file = await readWorkspaceFile("memoria/hechos.md");
        return file.content;
      } catch {
        // Archivo todavía no existe en disco
      }
    }
    const cached = contextItems.find((c) => c.path === "memoria/hechos.md");
    return cached?.content ?? "# Hechos del negocio\n\n";
  };

  const persistWorkspaceHechosMarkdown = async (updatedContent: string): Promise<void> => {
    if (isTauriEnv) {
      await saveWorkspaceFile("memoria/hechos.md", updatedContent);
      await handleRefreshWorkspace();
      return;
    }
    setContextItems((prev) => {
      const exists = prev.some((c) => c.path === "memoria/hechos.md");
      if (exists) {
        return prev.map((c) =>
          c.path === "memoria/hechos.md" ? { ...c, content: updatedContent } : c
        );
      }
      return [
        ...prev,
        {
          id: "ws_memoria/hechos.md",
          name: "hechos.md",
          type: "memory",
          path: "memoria/hechos.md",
          pinned: false,
          content: updatedContent,
        },
      ];
    });
  };

  const findWorkspaceFactLineIndex = (lines: string[], rawLine: string): number => {
    const targetRaw = rawLine.trim();
    const targetBody = extractWorkspaceFactBody(rawLine);
    if (!targetRaw && !targetBody) return -1;
    const exactIdx = lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return false;
      return trimmed === targetRaw || extractWorkspaceFactBody(line) === targetBody;
    });
    if (exactIdx >= 0) return exactIdx;
    const normTarget = targetBody.replace(/\s+/g, " ");
    return lines.findIndex((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return false;
      return extractWorkspaceFactBody(line).replace(/\s+/g, " ") === normTarget;
    });
  };

  const handleUpdateWorkspaceFact = async (rawOldLine: string, nextText: string) => {
    const cleanNext = nextText.trim().replace(/\s*\r?\n+\s*/g, " ");
    if (!cleanNext) return;
    const existing = await readWorkspaceHechosMarkdown();
    const lines = existing.split(/\r?\n/);
    const matchIdx = findWorkspaceFactLineIndex(lines, rawOldLine);
    const buildReplacement = (oldLine?: string): string => {
      if (/^[-*•]\s+/.test(cleanNext)) return cleanNext;
      if (/^\[\d{4}-\d{2}-\d{2}/.test(cleanNext)) return `- ${cleanNext}`;
      const existingBody = oldLine ? extractWorkspaceFactBody(oldLine) : "";
      const metaMatch = existingBody.match(
        /^(?:\[\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?\]\s*)?(?:(\([^)]+\))\s*)?(?:(\[key:[^\]]+\])\s*)?/
      );
      const catTag = metaMatch?.[1] ?? "(espacio)";
      const keyTag = metaMatch?.[2] ? `${metaMatch[2]} ` : "";
      return `- [${formatWorkspaceFactTimestamp()}] ${catTag} ${keyTag}${cleanNext}`;
    };
    if (matchIdx >= 0) {
      lines[matchIdx] = buildReplacement(lines[matchIdx]);
    } else {
      if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
        lines.splice(0, lines.length, "# Hechos del negocio", "");
      }
      lines.push(buildReplacement());
    }
    const updatedContent = `${lines.join("\n").trimEnd()}\n`;
    await persistWorkspaceHechosMarkdown(updatedContent);
    triggerMemoryLivePulse("updated", "user", cleanNext);
  };

  const handleDeleteWorkspaceFact = async (rawLine: string) => {
    const existing = await readWorkspaceHechosMarkdown();
    const lines = existing.split(/\r?\n/);
    const matchIdx = findWorkspaceFactLineIndex(lines, rawLine);
    if (matchIdx < 0) return;
    lines.splice(matchIdx, 1);
    const updatedContent = `${lines.join("\n").trimEnd()}\n`;
    await persistWorkspaceHechosMarkdown(updatedContent);
    triggerMemoryLivePulse("removed", "user");
  };

  const handleAddWorkspaceFact = async (text: string) => {
    const cleanText = text.trim().replace(/\s*\r?\n+\s*/g, " ");
    if (!cleanText) return;
    const existing = await readWorkspaceHechosMarkdown();
    const base = existing.trimEnd();
    const timestamp = formatWorkspaceFactTimestamp();
    const updatedContent = `${
      base ? `${base}\n` : "# Hechos del negocio\n\n"
    }- [${timestamp}] (espacio) ${cleanText}\n`;
    await persistWorkspaceHechosMarkdown(updatedContent);
    triggerMemoryLivePulse("added", "user", cleanText);
  };

  const handleUpdatePreference = async (
    bucket: "likes" | "workflows" | "donts",
    index: number,
    nextText: string
  ) => {
    const cleanText = nextText.trim();
    if (!cleanText) return;
    const current = globalXoxProfileRef.current;
    const currentList = Array.isArray(current[bucket]) ? [...current[bucket]] : [];
    if (index < 0 || index >= currentList.length) return;
    currentList[index] = cleanText;
    const { updatedAt: _ignoredUpdatedAt, ...restProfile } = current;
    const saved = await saveGlobalXoxProfile({
      ...restProfile,
      [bucket]: currentList,
    });
    setGlobalXoxProfile(saved);
    triggerMemoryLivePulse("updated", "user", cleanText);
  };

  const handleDeletePreference = async (
    bucket: "likes" | "workflows" | "donts",
    index: number
  ) => {
    const current = globalXoxProfileRef.current;
    const currentList = Array.isArray(current[bucket]) ? [...current[bucket]] : [];
    if (index < 0 || index >= currentList.length) return;
    const nextList = currentList.filter((_, idx) => idx !== index);
    const { updatedAt: _ignoredUpdatedAt, ...restProfile } = current;
    const saved = await saveGlobalXoxProfile({
      ...restProfile,
      [bucket]: nextList,
    });
    setGlobalXoxProfile(saved);
    triggerMemoryLivePulse("removed", "user");
  };

  const handleAskXoxEditMemory = (prefillPrompt: string) => {
    setInputPrompt(prefillPrompt);
    if (isCompactViewportRef.current && showXoxStudioRef.current) {
      closeXoxStudio();
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSelectWorkspaceFile = async (entry: WorkspaceNodeEntry) => {
    if (!isTauriEnv || entry.kind !== "file") return;
    try {
      const ext = (entry.extension || "").toLowerCase();
      if (BINARY_PREVIEW_EXT_SET.has(ext)) {
        const preview = await readWorkspaceBinaryPreview(entry.relativePath);
        setSelectedWorkspaceFile({
          relativePath: preview.relativePath,
          name: preview.name,
          zone: entry.zone,
          content: "",
          editable: false,
          pinned: pinnedWorkspacePaths.has(preview.relativePath),
          tokens: 0,
          kind: preview.kind,
          sizeBytes: preview.sizeBytes,
          mimeType: preview.mimeType,
          dataUrl: preview.dataUrl ?? null,
          pdfSummary: preview.pdfSummary ?? null,
        });
        if (preview.kind === "pdf") {
          void openPdfInRightPanel({
            path: preview.relativePath,
            title: preview.pdfSummary?.title || preview.name,
            filename: preview.name,
            pageCount: preview.pdfSummary?.page_count,
            sizeBytes: preview.sizeBytes,
          });
        } else if (preview.kind === "office" || OFFICE_DOC_EXT_SET.has(ext)) {
          void openUniversalDocInRightPanel({
            path: preview.relativePath,
            filename: preview.name,
            sizeBytes: preview.sizeBytes,
            ext,
          });
        } else if (preview.kind === "image" && preview.dataUrl) {
          setPdfDraftProgress(null);
          upsertDocTab({
            path: preview.relativePath,
            filename: preview.name,
            title: preview.name,
            sizeBytes: preview.sizeBytes,
            pages: [],
            isLoadingPages: false,
            fileKind: "image",
            fileExtension: ext,
            imageDataUrl: preview.dataUrl,
            initialMode: "view",
            revision: Date.now(),
          });
          setShowDocViewer(true);
        }
        triggerReadingPulse(`Inspeccionando ${entry.name}...`, 950);
        return;
      }

      const f = await readWorkspaceFile(entry.relativePath);
      const selectedFile: SelectedWorkspaceFile = {
        relativePath: f.relativePath,
        name: f.name,
        zone: f.zone,
        content: f.content,
        editable: f.editable,
        pinned: pinnedWorkspacePaths.has(f.relativePath),
        tokens: estimateTokens(f.content),
        kind: "text",
        sizeBytes: f.sizeBytes,
      };
      setSelectedWorkspaceFile(selectedFile);
      if (ext === "csv" || ext === "tsv") {
        void openUniversalDocInRightPanel({
          path: f.relativePath,
          filename: f.name,
          sizeBytes: f.sizeBytes,
          ext,
          textContent: f.content,
        });
      } else {
        setPdfDraftProgress(null);
        upsertDocTab({
          path: f.relativePath,
          filename: f.name,
          title: f.name,
          sizeBytes: f.sizeBytes,
          pages: [],
          isLoadingPages: false,
          fileKind: "text",
          textContent: f.content,
          fileExtension: ext || "txt",
          initialMode: "view",
          revision: Date.now(),
        });
        setShowDocViewer(true);
      }
      triggerReadingPulse(`Leyendo ${entry.name}...`, 1050);
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo abrir el archivo seleccionado.")
      );
      setTimeout(() => setStatusMessage(null), 3500);
    }
  };

  const handleAskXoxAnalyzeFile = (file: SelectedWorkspaceFile) => {
    const promptSuggestion =
      file.kind === "pdf"
        ? `Lee el PDF "${file.relativePath}" y dame un resumen estructurado con sus puntos clave.`
        : file.kind === "image"
        ? `Usa la imagen "${file.relativePath}" `
        : `Revisa el archivo "${file.relativePath}" y `;
    setInputPrompt((prev) => (prev.trim() ? `${prev.trim()} (${file.relativePath})` : promptSuggestion));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleTogglePinWorkspaceFile = async (entry: WorkspaceNodeEntry) => {
    if (entry.kind !== "file") return;
    const nextPinned = new Set(pinnedWorkspacePaths);
    if (nextPinned.has(entry.relativePath)) {
      nextPinned.delete(entry.relativePath);
    } else {
      nextPinned.add(entry.relativePath);
    }
    setPinnedWorkspacePaths(nextPinned);
    if (selectedWorkspaceFile?.relativePath === entry.relativePath) {
      setSelectedWorkspaceFile((prev) =>
        prev ? { ...prev, pinned: nextPinned.has(entry.relativePath) } : null
      );
    }
    if (workspaceOverview) {
      await hydrateWorkspaceState(
        workspaceOverview,
        selectedWorkspaceFile?.relativePath ?? entry.relativePath,
        nextPinned
      );
    }
  };

  const handleCreateWorkspaceFolder = async (relativePath: string) => {
    const nextOverview = await createWorkspaceFolder(relativePath);
    setHighlightedWorkspacePath(relativePath);
    setTimeout(() => setHighlightedWorkspacePath((curr) => (curr === relativePath ? null : curr)), 1500);
    await hydrateWorkspaceState(nextOverview, selectedWorkspaceFile?.relativePath ?? null);
    setStatusMessage(`Carpeta creada: ${relativePath}`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleSaveWorkspaceFile = async (relativePath: string, content: string) => {
    const nextOverview = await saveWorkspaceFile(relativePath, content);
    await hydrateWorkspaceState(nextOverview, relativePath);
    setStatusMessage(`Guardado en ${relativePath}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleCreateNewWorkspace = async (name: string) => {
    const nextOverview = await createWorkspace(name);
    await hydrateWorkspaceState(nextOverview, "empresa/perfil.json");
    await Promise.all([
      hydrateLedgerState(true),
      refreshInventoryAndReview(),
    ]);
    setStatusMessage(`Espacio "${nextOverview.active.name}" creado en Documentos/XoxMemoryApp.`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleSwitchActiveWorkspace = async (workspaceId: string) => {
    const nextOverview = await switchWorkspace(workspaceId);
    await hydrateWorkspaceState(nextOverview, "empresa/perfil.json");
    await Promise.all([
      hydrateLedgerState(true),
      refreshInventoryAndReview(),
    ]);
    setStatusMessage(`Espacio activo: ${nextOverview.active.name}`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleRenameActiveWorkspace = async (workspaceId: string, newName: string) => {
    const nextOverview = await renameWorkspace(workspaceId, newName);
    await hydrateWorkspaceState(nextOverview, selectedWorkspaceFile?.relativePath ?? null);
    setStatusMessage(`Espacio renombrado a "${nextOverview.active.name}".`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleRunBusinessReview = async (triggerSource = "manual") => {
    if (!isTauriEnv || isReviewRunning) return;
    setIsReviewRunning(true);
    try {
      const res = await runBusinessReview(triggerSource);
      const [overview] = await Promise.all([
        getWorkspaceOverview(),
        refreshInventoryAndReview(),
        hydrateLedgerState(true),
      ]);
      if (overview) {
        await hydrateWorkspaceState(overview, selectedWorkspacePathRef.current);
      }
      if (res) {
        setLatestReview(res.reviewRun);
        setStatusMessage(
          res.newTasksCount > 0
            ? `Revisión lista: ${res.newTasksCount} nuevas propuestas.`
            : res.summary || "Revisión completada sin pendientes nuevos."
        );
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo completar la revisión del espacio.")
      );
      setTimeout(() => setStatusMessage(null), 4500);
    } finally {
      setIsReviewRunning(false);
    }
  };

  const handleImportInventoryFile = async (filename: string, content: string) => {
    if (!isTauriEnv) return;
    try {
      const imported = await importInventoryFile(filename, content);
      if (imported) {
        setInventoryItems(imported.items);
        setStatusMessage(
          `Importados ${imported.importedCount} productos en ${imported.filePath}. Analizando...`
        );
        await handleRunBusinessReview("import");
      }
    } catch (err) {
      setStatusMessage(
        extractErrorMessage(err, "No se pudo importar el archivo en datos/.")
      );
      setTimeout(() => setStatusMessage(null), 4500);
    }
  };

  const handleResolvePermission = async (
    requestId: string,
    decision: CommandPermissionDecisionKind
  ) => {
    setPermissionItems((prev) =>
      applyPermissionResolution(prev, requestId, decision)
    );
    if (timelineHasRequestId(activeTimelineRef.current, requestId)) {
      activeTimelineRef.current = resolvePermissionInTimeline(
        activeTimelineRef.current,
        requestId,
        decision
      );
    }
    setChatMessages((prev) => {
      if (!prev.some((m) => timelineHasRequestId(m.timeline, requestId))) return prev;
      return prev.map((m) =>
        timelineHasRequestId(m.timeline, requestId)
          ? { ...m, timeline: resolvePermissionInTimeline(m.timeline, requestId, decision) }
          : m
      );
    });
    try {
      await resolveCommandPermission(requestId, decision);
    } catch (err) {
      const errText = extractErrorMessage(err, "No se pudo entregar tu decisión.");
      setPermissionItems((prev) =>
        prev.map((item) =>
          item.requestId === requestId
            ? {
                ...item,
                state: "error",
                error: errText,
              }
            : item
        )
      );
      if (timelineHasRequestId(activeTimelineRef.current, requestId)) {
        activeTimelineRef.current = markPermissionErrorInTimeline(
          activeTimelineRef.current,
          requestId,
          errText
        );
      }
      setChatMessages((prev) => {
        if (!prev.some((m) => timelineHasRequestId(m.timeline, requestId))) return prev;
        return prev.map((m) =>
          timelineHasRequestId(m.timeline, requestId)
            ? { ...m, timeline: markPermissionErrorInTimeline(m.timeline, requestId, errText) }
            : m
        );
      });
    }
  };

  const handleToggleTimer = async (id: string) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      try {
        const updated = await toggleTimerState(id);
        if (updated) {
          setAgendaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isRunning: !item.isRunning } : item
      )
    );
  };

  const handleResetTimer = async (id: string) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      try {
        const updated = await resetTimerState(id);
        if (updated) {
          setAgendaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isRunning: false,
              endsAt: undefined,
              remainingSeconds: item.durationSeconds ?? 900,
            }
          : item
      )
    );
  };

  const handleCompleteAgendaItem = async (item: AgendaItem) => {
    setAgendaItems((prev) => prev.filter((a) => a.id !== item.id));
    let savedHistory: TaskHistoryItem | null = null;
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      savedHistory = await completeAgendaItem({
        agendaItemId: item.id,
        decidedBy: localUser?.name ?? undefined,
      }).catch(() => null);
    }
    setHistoryItems((prev) => [
      savedHistory ?? {
        id: `hist_ag_${item.id}_${Date.now()}`,
        title: item.title,
        category: item.kind === "note" ? "nota" : "agenda",
        decision: "completed",
        summary: item.noteContent ?? item.subtitle ?? item.timeLabel,
        timestampLabel: nowTimeLabel(),
      },
      ...prev,
    ]);
    setStatusMessage(`"${item.title}" completado.`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleRemoveAgendaItem = async (id: string) => {
    setAgendaItems((prev) => prev.filter((a) => a.id !== id));
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await deleteAgendaItem(id).catch(() => {});
    }
  };

  const handleToggleAgendaChecklist = async (agendaId: string, itemId: string) => {
    const existing = agendaItemsRef.current.find((it) => it.id === agendaId);
    const updatedItem =
      existing && existing.checklist
        ? {
            ...existing,
            checklist: existing.checklist.map((c) =>
              c.id === itemId ? { ...c, done: !c.done } : c
            ),
          }
        : null;

    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === agendaId && item.checklist
          ? {
              ...item,
              checklist: item.checklist.map((c) =>
                c.id === itemId ? { ...c, done: !c.done } : c
              ),
            }
          : item
      )
    );
    if (updatedItem && isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await upsertAgendaItem(updatedItem).catch(() => {});
    }
  };

  const handleToggleAgendaAuto = async (id: string) => {
    const existing = agendaItemsRef.current.find((it) => it.id === id);
    const updatedItem = existing
      ? { ...existing, autoScheduled: !existing.autoScheduled }
      : null;

    setAgendaItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, autoScheduled: !item.autoScheduled } : item
      )
    );
    if (updatedItem && isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      await upsertAgendaItem(updatedItem).catch(() => {});
    }
  };

  const persistAgendaDraft = async (draft: LedgerAgendaItem) => {
    if (isTauriEnv) {
      suppressLedgerSyncUntilRef.current = Date.now() + 450;
      const saved = await upsertAgendaItem(draft).catch(() => null);
      setAgendaItems((prev) => [saved ?? draft, ...prev]);
    } else {
      setAgendaItems((prev) => [draft, ...prev]);
    }
  };

  const formatScheduledTimeLabel = (dateIso: string, time24: string): { label: string; nextRunAt?: string } => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const parsed = new Date(`${dateIso}T${time24}:00`);
    const nextRunAt = Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    const dayPrefix =
      dateIso === todayStr
        ? "Hoy"
        : dateIso === tomorrowStr
        ? "Mañana"
        : Number.isNaN(parsed.getTime())
        ? dateIso
        : parsed.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
    return {
      label: `${dayPrefix} · ${time24} hrs`,
      nextRunAt,
    };
  };

  const handleCreateQuickTimer = async (title: string, minutes: number) => {
    const secs = Math.max(1, minutes) * 60;
    const draft: LedgerAgendaItem = {
      id: `ag_timer_${Date.now()}`,
      kind: "timer",
      title,
      subtitle: `Reloj rápido (${minutes} min)`,
      timeLabel: `${String(minutes).padStart(2, "0")}:00`,
      durationSeconds: secs,
      remainingSeconds: secs,
      endsAt: new Date(Date.now() + secs * 1000).toISOString(),
      isRunning: true,
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Reloj "${title}" iniciado (${minutes} min).`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleCreateQuickNote = async (title: string, content: string) => {
    const draft: LedgerAgendaItem = {
      id: `ag_note_${Date.now()}`,
      kind: "note",
      title,
      timeLabel: "Fijada",
      noteContent: content,
      tags: ["Manual"],
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Nota "${title}" guardada en Agenda.`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const handleCreateScheduledEvent = async (input: ScheduledEventInput) => {
    const { label, nextRunAt } = formatScheduledTimeLabel(input.dateIso, input.time24);
    const isRecurring = input.autoScheduled || Boolean(input.recurrence);
    const draft: LedgerAgendaItem = {
      id: `ag_sched_${Date.now()}`,
      kind: isRecurring ? "recurring" : "alarm",
      title: input.title,
      subtitle: input.notes,
      timeLabel: label,
      recurrence: input.recurrence,
      autoScheduled: input.autoScheduled,
      scheduleCronOrRule: input.recurrence ?? "Una vez",
      nextRunAt,
      createdAtLabel: `Hoy · ${nowTimeLabel()}`,
    };
    await persistAgendaDraft(draft);
    setStatusMessage(`Agendado: "${input.title}" (${label}).`);
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const applyCompactedContextEvent = (
    evt: ContextCompactedEvent,
    opts?: {
      attachToAssistantMsgId?: string;
      excludeUserMsgId?: string;
      insertStandaloneDivider?: boolean;
    }
  ) => {
    const notice = {
      auto: evt.auto,
      scope: evt.scope,
      documentPath: evt.documentPath,
      documentTitle: evt.documentTitle,
      compactedTurns: evt.compactedTurnsThisPass,
      savedPct: evt.savedPct,
      checkpoint: evt.checkpoint,
    };

    if (evt.scope === "document" && evt.documentPath) {
      setDocContextsByPath((prev) => {
        const curr = prev[evt.documentPath!];
        return {
          ...prev,
          [evt.documentPath!]: curr
            ? {
                ...curr,
                checkpoint: evt.checkpoint,
                recentTurnsCount: evt.keptRecentTurns,
                estimatedTokens: Math.max(
                  900,
                  curr.estimatedTokens - Math.max(0, evt.tokensBefore - evt.tokensAfter)
                ),
              }
            : {
                path: evt.documentPath!,
                title: evt.documentTitle || evt.documentPath!.split("/").pop() || "Documento",
                fileKind: "pdf",
                pinnedRules: [],
                checkpoint: evt.checkpoint,
                recentTurns: [],
                recentTurnsCount: evt.keptRecentTurns,
                totalTurnsRecorded: evt.checkpoint.compactedTurns,
                headings: [],
                estimatedTokens: Math.max(1200, evt.tokensAfter + 900),
              },
        };
      });
    } else {
      chatCheckpointRef.current = evt.checkpoint;
      setChatCheckpoint(evt.checkpoint);
      const msgs = chatMessagesRef.current;
      // Determinar el último mensaje incluido en la compactación (excluyendo el turno en curso)
      const eligible = msgs.filter(
        (m) =>
          !m.isError &&
          !m.isCompactionDividerOnly &&
          m.id !== opts?.attachToAssistantMsgId &&
          m.id !== opts?.excludeUserMsgId
      );
      const keep = Math.max(0, evt.keptRecentTurns);
      const boundaryIdx = eligible.length - keep - 1;
      if (boundaryIdx >= 0 && eligible[boundaryIdx]) {
        compactedUpToMsgIdRef.current = eligible[boundaryIdx].id;
        setCompactedUpToMessageId(eligible[boundaryIdx].id);
      } else if (keep === 0 && eligible.length > 0) {
        compactedUpToMsgIdRef.current = eligible[eligible.length - 1].id;
        setCompactedUpToMessageId(eligible[eligible.length - 1].id);
      }
    }

    if (opts?.attachToAssistantMsgId) {
      const targetId = opts.attachToAssistantMsgId;
      setChatMessages((prev) =>
        prev.map((m) => (m.id === targetId ? { ...m, compactionNotice: notice } : m))
      );
    } else if (opts?.insertStandaloneDivider) {
      const dividerMsg: UiChatMessage = {
        id: `msg_cmp_${Date.now()}`,
        role: "assistant",
        content: "",
        isCompactionDividerOnly: true,
        compactionNotice: notice,
      };
      const nextMsgs = [...chatMessagesRef.current, dividerMsg];
      setChatMessages(nextMsgs);
      void persistConversation(nextMsgs);
    }
  };

  const handleRunManualCompact = async (
    focusHint = "",
    forceScope?: "chat" | "document"
  ) => {
    if (isCompactingContext || isChatStreaming) return;
    const targetDoc =
      showDocViewer && pdfPanelState?.path ? pdfPanelState : null;
    const scope: "chat" | "document" =
      forceScope ??
      (targetDoc && docContextScopeEnabledRef.current ? "document" : "chat");

    setIsCompactingContext(true);
    setXoxState("thinking");
    setXoxMessage(
      scope === "document" && targetDoc
        ? `Compactando contexto de ${targetDoc.title}...`
        : "Compactando memoria de conversación..."
    );
    try {
      const baseMsgs = chatMessagesRef.current;
      let startIdx = 0;
      if (scope === "chat" && compactedUpToMsgIdRef.current) {
        const idx = baseMsgs.findIndex((m) => m.id === compactedUpToMsgIdRef.current);
        if (idx >= 0) startIdx = idx + 1;
      }
      const chatHist = baseMsgs
        .slice(startIdx)
        .filter((m) => !m.isError && !m.isCompactionDividerOnly && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content.trim() }));

      const res = await compactXoxContext({
        scope,
        history: chatHist,
        prevCheckpoint:
          scope === "document" && targetDoc
            ? (docContextsByPath[targetDoc.path]?.checkpoint ?? null)
            : chatCheckpointRef.current,
        documentPath: scope === "document" && targetDoc ? targetDoc.path : undefined,
        documentTitle: scope === "document" && targetDoc ? targetDoc.title : undefined,
        documentFileKind: scope === "document" && targetDoc ? (targetDoc.fileKind ?? "pdf") : undefined,
        focusHint: focusHint.trim(),
        keepRecent: 2,
        modelOverride: modelId,
        providerOverride: activeProvider,
      });

      if (res.documentContext) {
        const snap = res.documentContext;
        setDocContextsByPath((prev) => ({ ...prev, [snap.path]: snap }));
      }
      if (res.checkpoint) {
        applyCompactedContextEvent(
          {
            auto: false,
            scope: res.scope,
            documentPath: res.documentPath,
            documentTitle: targetDoc?.title,
            compactedTurnsThisPass: res.compactedTurnsThisPass,
            keptRecentTurns: res.keptRecentTurns,
            tokensBefore: res.tokensBefore,
            tokensAfter: res.tokensAfter,
            savedPct: res.savedPct,
            checkpoint: res.checkpoint,
          },
          { insertStandaloneDivider: true }
        );
        const pctNote = res.savedPct > 0 ? ` (~${res.savedPct}% liberado)` : "";
        setStatusMessage(
          res.scope === "document" && targetDoc
            ? `Contexto de "${targetDoc.title}" compactado${pctNote}.`
            : `Conversación compactada${pctNote}.`
        );
      } else {
        setStatusMessage("El contexto ya está limpio y compacto.");
      }
      setTimeout(() => setStatusMessage(null), 4000);
      setXoxState("success");
      setXoxMessage("Contexto compactado.");
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 2400);
    } catch (err) {
      setStatusMessage(extractErrorMessage(err, "No se pudo compactar el contexto."));
      setTimeout(() => setStatusMessage(null), 4000);
      setXoxState("idle");
      setXoxMessage("¿En qué puedo ayudarte?");
    } finally {
      setIsCompactingContext(false);
    }
  };

  const handleUpdateActiveDocRules = async (rules: string[]) => {
    const activeTab = pdfPanelState;
    if (!activeTab?.path) return;
    try {
      const res = await manageDocumentContext({
        action: "update_rules",
        path: activeTab.path,
        title: activeTab.title,
        fileKind: activeTab.fileKind ?? "pdf",
        rules,
      });
      if (res.documentContext) {
        const snap = res.documentContext;
        setDocContextsByPath((prev) => ({ ...prev, [snap.path]: snap }));
      }
      setStatusMessage(`Reglas fijadas actualizadas para "${activeTab.title}".`);
      setTimeout(() => setStatusMessage(null), 3200);
    } catch {
      // Ignorar fallo silencioso
    }
  };

  const handleResetActiveDocContext = async (keepRules = true) => {
    const activeTab = pdfPanelState;
    if (!activeTab?.path) return;
    try {
      const res = await manageDocumentContext({
        action: "reset",
        path: activeTab.path,
        title: activeTab.title,
        fileKind: activeTab.fileKind ?? "pdf",
        keepRules,
      });
      if (res.documentContext) {
        const snap = res.documentContext;
        setDocContextsByPath((prev) => ({ ...prev, [snap.path]: snap }));
      }
      setStatusMessage(
        keepRules
          ? `Historial de "${activeTab.title}" reiniciado (reglas fijadas conservadas).`
          : `Contexto de "${activeTab.title}" reiniciado por completo.`
      );
      setTimeout(() => setStatusMessage(null), 3600);
    } catch {
      // Ignorar fallo silencioso
    }
  };

  const runPromptQuery = async (
    rawQuery: string,
    overrideMessages?: UiChatMessage[],
    options?: {
      overrideMode?: XoxModeId | null;
      overrideAttachments?: ComposerAttachmentItem[];
      forceScope?: "chat" | "document";
      forceDocument?: {
        path: string;
        title?: string;
        fileKind?: string;
        theme?: string;
        pageCount?: number;
        hasCover?: boolean;
        revision?: number;
      };
    }
  ) => {
    const rawTrimmed = rawQuery.trim();
    const effectiveMode: XoxModeId | null =
      options && "overrideMode" in options ? (options.overrideMode ?? null) : activeMode;

    // Interceptar `/compact` real (manual) antes de enviar al chat normal
    if (
      !isChatStreaming &&
      (effectiveMode === "compact" || /^\/compact(?:\s+|$)/i.test(rawTrimmed))
    ) {
      const focusHint = rawTrimmed.replace(/^\/compact\s*/i, "").trim();
      setInputPrompt("");
      setActiveMode(null);
      await handleRunManualCompact(focusHint, options?.forceScope);
      return;
    }

    const currentAttachments: ComposerAttachmentItem[] =
      options?.overrideAttachments ?? attachments;
    if ((!rawTrimmed && currentAttachments.length === 0) || isChatStreaming) return;

    const effectiveModeSpec = effectiveMode ? XOX_COMMAND_SPECS[effectiveMode] : null;
    const baseMessages = overrideMessages ?? chatMessagesRef.current;
    const pastedItems = currentAttachments.filter(
      (att): att is ComposerPastedTextAttachment => att.kind === "pasted_text"
    );
    const fileItems = currentAttachments.filter(
      (att): att is Exclude<ComposerAttachmentItem, ComposerPastedTextAttachment> =>
        att.kind !== "pasted_text"
    );
    const query = composeLlmMessageWithPastedText(
      rawTrimmed,
      pastedItems,
      fileItems.map((f) => ({ name: f.name, kind: f.kind }))
    );
    setInputPrompt("");
    if (!options?.overrideAttachments) {
      setAttachments([]);
    }

    // 1) Zero-Trust: desambiguación rápida sk- (DeepSeek vs OpenAI) si hay una clave pendiente
    if (
      pendingSecretKeysRef.current.size > 0 &&
      query.length <= 48 &&
      !/sk-|AIza|gsk_/i.test(query) &&
      /\b(?:openai|gpt|deepseek)\b/i.test(query)
    ) {
      const entries = Array.from(pendingSecretKeysRef.current.entries());
      const [latestCardId, latestEntry] = entries[entries.length - 1];
      const chosenPid: AiProviderId = /\b(?:openai|gpt)\b/i.test(query) ? "openai" : "deepseek";
      pendingSecretKeysRef.current.set(latestCardId, {
        ...latestEntry,
        provider: chosenPid,
      });
      const userConfirmMsg: UiChatMessage = {
        id: `msg_u_${Date.now()}`,
        role: "user",
        content: query,
      };
      setChatMessages([...baseMessages, userConfirmMsg]);
      const matchingCard = tasksRef.current.find((t) => t.cardId === latestCardId);
      await executeSavePendingKey(latestCardId, matchingCard);
      return;
    }

    // 1b) Zero-Trust: interceptar claves API localmente antes de cualquier llamada o historial
    const {
      detectedKey,
      maskedKey,
      detectedProvider,
      ambiguousProviders,
      sanitizedText,
    } = detectApiKeyInText(query);
    if (detectedKey && maskedKey) {
      const targetPid: AiProviderId = detectedProvider ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      const cardId = `vault_key_${Date.now()}`;
      pendingSecretKeysRef.current.set(cardId, {
        key: detectedKey,
        provider: targetPid,
        ambiguousProviders,
      });

      const providerDisplay =
        ambiguousProviders.length > 1
          ? `${targetSpec.shortName} (o OpenAI)`
          : targetSpec.name;

      const vaultProposal: TaskProposal = {
        cardId,
        title: `Guardar clave API de ${targetSpec.shortName}`,
        subtitle: `Se detectó una clave (${maskedKey}) en tu mensaje. Aprueba para guardarla en la bóveda local sin enviarla al modelo.`,
        urgency: "media",
        category: "boveda",
        generatedBy: "Bóveda Zero-Trust",
        statusChip: "Requiere aprobación",
        defaultExpanded: true,
        blocks: [
          {
            type: "kv_list",
            rows: [
              { label: "Proveedor", value: providerDisplay },
              {
                label: "Clave detectada",
                value: maskedKey,
                subtle: "Aislada localmente",
              },
              {
                label: "Destino",
                value: isTauriEnv
                  ? "Bóveda local Tauri (0600)"
                  : "Almacenamiento local de sesión",
              },
              {
                label: "Modelo inicial",
                value: targetPid === activeProvider ? modelId : targetSpec.defaultModelId,
              },
            ],
          },
          {
            type: "insight",
            text: "Tu clave se mantiene aislada en memoria temporal hasta que confirmes; nunca viaja dentro del prompt.",
            confidence: 1,
            source: "Protección Zero-Trust",
          },
        ],
        intent: {
          type: "save_api_key",
          targetLabel: `${targetSpec.shortName} (${maskedKey})`,
          primaryLabel: `Guardar en ${targetSpec.shortName}`,
        },
        paramValues: {},
      };

      setTasks((prev) => [vaultProposal, ...prev]);
      setShowRightSidebar(true);
      setTaskTab("pending");
      const ambiguityNote =
        ambiguousProviders.length > 1
          ? `\n\nEl prefijo \`sk-\` es compartido por **DeepSeek** y **OpenAI**. La preparé para **DeepSeek**; si corresponde a OpenAI, respóndeme *"es de openai"* y la guardo allí directo.`
          : "";
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        { id: `msg_u_${Date.now()}`, role: "user", content: sanitizedText },
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: `Detecté una clave de **${targetSpec.name}** (**${maskedKey}**) y la intercepté localmente antes de enviarla a internet.${ambiguityNote}\n\nPor seguridad Zero-Trust, confírmame si quieres guardarla en tu bóveda segura y probar la conexión.`,
          actionButton: {
            label: `Guardar en ${targetSpec.shortName}`,
            kind: "save_pending_key",
            cardId,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("alert");
      setXoxMessage(`Clave ${maskedKey} retenida en memoria segura.`);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      return;
    }

    const initialAttachmentsMeta: UiChatAttachment[] = currentAttachments.map((item) => {
      if (item.kind === "pasted_text") {
        return {
          name: item.name,
          kind: "pasted_text",
          pastedContent: item.content,
          charCount: item.charCount,
          lineCount: item.lineCount,
        };
      }
      if (item.kind === "image") {
        return {
          name: item.name,
          kind: "image",
          previewUrl: item.thumbUrl || item.objectUrl || undefined,
          fullPreviewUrl: item.imageDataUrl || item.objectUrl || undefined,
          width: item.width,
          height: item.height,
        };
      }
      return {
        name: item.name,
        kind: item.kind,
      };
    });

    const resolvedDocTarget =
      options?.forceDocument ??
      (showDocViewer && pdfPanelState?.path && docContextScopeEnabledRef.current
        ? {
            path: pdfPanelState.path,
            title: pdfPanelState.title || pdfPanelState.filename || pdfPanelState.path,
            fileKind: pdfPanelState.fileKind || "pdf",
            theme: pdfPanelState.theme || "executive",
            pageCount: pdfPanelState.pageCount || pdfPanelState.pages.length || 1,
            hasCover: pdfPanelState.hasCover,
            revision: pdfPanelState.revision,
          }
        : null);
    const effectiveScope: "chat" | "document" =
      options?.forceScope === "chat"
        ? "chat"
        : resolvedDocTarget
          ? "document"
          : "chat";

    const userMsg: UiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: "user",
      content: rawTrimmed,
      mode: effectiveMode ?? undefined,
      ...(effectiveScope === "document" && resolvedDocTarget
        ? {
            documentScopeTag: {
              path: resolvedDocTarget.path,
              title: resolvedDocTarget.title || resolvedDocTarget.path.split("/").pop() || "Documento",
            },
          }
        : {}),
      ...(initialAttachmentsMeta.length > 0 ? { attachments: initialAttachmentsMeta } : {}),
    };

    const intentTargetText = pastedItems.length === 0 ? rawTrimmed : "";
    const setupIntent = detectKeySetupIntentWithProvider(intentTargetText);
    const vaultReq =
      effectiveMode || !intentTargetText
        ? { isVaultRequest: false, intentKind: "open_vault" as const, providerHint: null }
        : detectVaultConfigRequest(intentTargetText);

    if (vaultReq.isVaultRequest) {
      const targetPid: AiProviderId = vaultReq.providerHint ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      const targetSlot = aiConfig.configuredProviders?.[targetPid];

      if (vaultReq.intentKind === "switch_provider" && targetSlot?.hasApiKey) {
        const nextModel = targetSlot.modelId || targetSpec.defaultModelId;
        const updated = await saveAiConfig({
          provider: targetPid,
          modelId: nextModel,
        });
        setAiConfig(updated);
        setModelId(nextModel);
        void refreshModelsAndUsage(false, true, updated.maskedKey, targetPid);
        const nextMessages: UiChatMessage[] = [
          ...chatMessagesRef.current,
          userMsg,
          {
            id: `msg_a_${Date.now() + 1}`,
            role: "assistant",
            content: `Listo, cambié el proveedor activo a **${targetSpec.name}** usando **${formatModelDisplay(nextModel, targetSpec.curatedModels).name}** (${targetSlot.maskedKey ?? "clave guardada"}).\n\nTarifa base: ${targetSpec.tariffSummary}.`,
          },
        ];
        setChatMessages(nextMessages);
        void persistConversation(nextMessages);
        setXoxState("success");
        setXoxMessage(`Usando ${targetSpec.shortName}.`);
        setTimeout(() => {
          setXoxState((s) => (s === "success" ? "idle" : s));
          setXoxMessage("¿En qué puedo ayudarte?");
        }, 3200);
        return;
      }

      if (vaultReq.intentKind === "open_vault") {
        openAiSettings("account", targetPid);
      }

      const introLine = targetSlot?.hasApiKey
        ? `Ya tienes una clave guardada para **${targetSpec.name}** (${targetSlot.maskedKey ?? "cifrada"}). Puedes actualizarla aquí mismo en tu bóveda segura o elegir otro proveedor:`
        : `Claro, puedo guardarla directo en tu bóveda local segura de XOOK. Ingresa aquí tu API key de **${targetSpec.name}** (${targetSpec.keyPrefixHint}) o pégala directo en el chat:`;

      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        userMsg,
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: `${introLine}\n\n*Protección Zero-Trust:* tu clave se cifra localmente en tu equipo y nunca viaja al historial ni a ningún modelo externo.`,
          vaultPrompt: {
            provider: targetPid,
            intent: vaultReq.intentKind === "open_vault" ? "open_settings" : "prompt_key",
            note: `${targetSpec.tariffSummary} · Guardado local en bóveda`,
          },
          actionButton: {
            label: `Abrir Bóveda (${targetSpec.shortName})`,
            kind: "open_settings",
            provider: targetPid,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("idle");
      setXoxMessage(`Bóveda lista para ${targetSpec.shortName}.`);
      return;
    }

    // 2) Sin ninguna clave configurada: informar con honestidad y ofrecer bóveda directa en el chat
    if (!hasAnyConfiguredKey) {
      const targetPid = setupIntent.providerHint ?? activeProvider;
      const targetSpec = getProviderSpec(targetPid);
      if (setupIntent.isSetup) {
        openAiSettings("account", targetPid);
      }
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        userMsg,
        {
          id: `msg_a_${Date.now() + 1}`,
          role: "assistant",
          content: setupIntent.isSetup
            ? `Preparé la bóveda para **${targetSpec.name}**. Ingresa o pega aquí tu clave \`${targetSpec.keyPrefixHint}\` para guardarla localmente.`
            : "Aún no tienes ningún proveedor de IA conectado.\n\nConecta una clave de **OpenRouter**, **DeepSeek**, **Groq**, **Gemini**, **OpenAI** o **Anthropic** directo aquí abajo o en los ajustes de XOOK.",
          vaultPrompt: {
            provider: targetPid,
            intent: "prompt_key",
            note: `${targetSpec.tariffSummary} · Bóveda Zero-Trust`,
          },
          actionButton: {
            label: setupIntent.providerHint ? `Configurar ${targetSpec.shortName}` : "Abrir Bóveda IA",
            kind: "open_settings",
            provider: targetPid,
          },
        },
      ];
      setChatMessages(nextMessages);
      void persistConversation(nextMessages);
      setXoxState("idle");
      setXoxMessage("Conecta un proveedor de IA para iniciar.");
      return;
    }

    // 3) Inferencia real en streaming contra el proveedor activo (con respaldo automático por cuota)
    const convId = activeConvIdRef.current;
    const assistantMsgId = `msg_a_${Date.now() + 1}`;
    const historyStartIdx = (() => {
      if (effectiveScope === "chat" && compactedUpToMsgIdRef.current) {
        const idx = baseMessages.findIndex((m) => m.id === compactedUpToMsgIdRef.current);
        if (idx >= 0) return idx + 1;
      }
      return 0;
    })();
    const priorHistory =
      effectiveScope === "document"
        ? []
        : baseMessages
            .slice(historyStartIdx)
            .filter(
              (m) =>
                !m.isError &&
                !m.isCompactionDividerOnly &&
                (m.content.trim().length > 0 ||
                  (m.generatedPdfs && m.generatedPdfs.length > 0) ||
                  (m.attachments && m.attachments.length > 0) ||
                  Boolean(m.canvas) ||
                  (m.canvases && m.canvases.length > 0))
            )
            .slice(-40)
            .map((m) => {
              const notes: string[] = [];
              if (m.attachments && m.attachments.length > 0) {
                const pastedInTurn = m.attachments.filter(
                  (a) => a.kind === "pasted_text" && a.pastedContent
                );
                for (const pAtt of pastedInTurn) {
                  const safeLabel = (pAtt.name || "Texto pegado").replace(/"/g, "'");
                  const clipped = (pAtt.pastedContent ?? "").slice(0, 4000);
                  notes.push(`<texto_pegado titulo="${safeLabel}">\n${clipped}\n</texto_pegado>`);
                }
                const otherAtts = m.attachments.filter((a) => a.kind !== "pasted_text");
                if (otherAtts.length > 0) {
                  const attDesc = otherAtts
                    .map((a) => (a.workspacePath ? `${a.name} (${a.workspacePath})` : a.name))
                    .join(", ");
                  notes.push(`[Archivos adjuntos en este turno: ${attDesc}]`);
                }
              }
              if (m.generatedPdfs && m.generatedPdfs.length > 0) {
                const pdfDesc = m.generatedPdfs
                  .map(
                    (p) =>
                      `${p.path} (título: "${p.title || p.filename}", ${p.pageCount || 1} pág., theme: ${p.theme || "executive"})`
                  )
                  .join("; ");
                notes.push(`[PDFs generados/editados en este turno: ${pdfDesc}]`);
              }
              const turnCanvases =
                m.canvases && m.canvases.length > 0 ? m.canvases : m.canvas ? [m.canvas] : [];
              if (turnCanvases.length > 0) {
                const canvasDesc = turnCanvases
                  .map((c) => `"${c.title || "Canvas"}" (id: ${c.id}, tipo: ${c.kind})`)
                  .join(", ");
                notes.push(`[Canvas de este turno: ${canvasDesc}]`);
              }
              if (m.turnMemory?.compactNote) {
                notes.push(`[Memoria operativa del turno: ${m.turnMemory.compactNote}]`);
              }
              const suffix = notes.length > 0 ? `\n${notes.join("\n")}` : "";
              return { role: m.role, content: `${m.content.trim()}${suffix}`.trim() };
            });

    const initialStep: ThinkingStep = {
      id: "read_context",
      label: effectiveModeSpec
        ? `${effectiveModeSpec.name}: Leyendo contexto...`
        : "Leyendo contexto y reglas del negocio",
      status: "running",
    };

    const assistantPlaceholder: UiChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      reasoning: "",
      mode: effectiveMode ?? undefined,
      thinkingSteps: [initialStep],
      isStreaming: true,
      isReasoningStreaming: true,
    };

    const startedMessages = [...baseMessages, userMsg, assistantPlaceholder];
    clearXoxPhaseTimers();
    ttsPlayer.stop();
    const readingStartedAt = performance.now();
    const READING_MIN_MS = 750;
    let latestPhase: XoxState = "reading";
    let hasEnteredTalking = false;
    let talkingStartedAt = 0;
    let streamedReplyText = "";
    let startedStreamSpeech = false;
    const isAutoSpeakReady = () => {
      const cfg = ttsStatusRef.current;
      return (
        Boolean(cfg?.config.enabled) &&
        Boolean(cfg?.config.autoPlay) &&
        (!isTauriTtsRuntime() || Boolean(cfg?.modelsInstalled))
      );
    };

    // Si había una burbuja de saludo abierta, cancelarla limpiamente antes de iniciar el turno
    greetingSeqRef.current += 1;
    greetingTimers.current.forEach(clearTimeout);
    greetingTimers.current = [];
    setGreeting(null);
    setGreetingLeaving(false);

    const turnAbortController = new AbortController();
    chatAbortControllerRef.current = turnAbortController;
    setChatMessages(startedMessages);
    setIsChatStreaming(true);
    setXoxState("reading");
    const readingLabel = effectiveModeSpec
      ? `${effectiveModeSpec.slash} · ${effectiveModeSpec.badge}...`
      : "Leyendo contexto y reglas...";
    setThinkingLabel(readingLabel);
    setXoxMessage(readingLabel);

    try {
      let stagedAnyBinary = false;
      const thumbByIdx = new Map<
        number,
        {
          previewUrl?: string;
          fullPreviewUrl?: string;
          workspacePath?: string;
          width?: number;
          height?: number;
        }
      >();
      const objectUrlsToRevoke: string[] = [];

      const fileSnippetList = await Promise.all(
        currentAttachments.map(async (item, fIdx): Promise<AttachedContextItem | null> => {
          if (item.kind === "pasted_text") {
            // Ya incluido íntegramente en el mensaje del usuario (<texto_pegado>)
            return null;
          }

          const file = item.file;
          const kind = item.kind;

          if (kind === "pdf" || kind === "image" || kind === "binary") {
            let stagedPath: string | undefined;
            let stagedMime =
              file.type || (kind === "pdf" ? "application/pdf" : "application/octet-stream");
            if (isTauriEnv && file.size > 0 && file.size <= 25 * 1024 * 1024) {
              try {
                const b64 = await fileToBase64Payload(file);
                const staged = await stageWorkspaceAttachment(item.name, b64);
                stagedPath = staged.relativePath;
                stagedMime = staged.mimeType || stagedMime;
                stagedAnyBinary = true;
              } catch {
                stagedPath = undefined;
              }
            }

            if (kind === "image") {
              const imgPrep =
                item.imageDataUrl && item.thumbUrl
                  ? {
                      imageDataUrl: item.imageDataUrl,
                      thumbUrl: item.thumbUrl,
                      width: item.width,
                      height: item.height,
                    }
                  : await prepareImagePayload(file);
              if (imgPrep.thumbUrl || imgPrep.imageDataUrl || stagedPath) {
                thumbByIdx.set(fIdx, {
                  previewUrl: imgPrep.thumbUrl || imgPrep.imageDataUrl,
                  fullPreviewUrl: imgPrep.imageDataUrl || imgPrep.thumbUrl,
                  workspacePath: stagedPath,
                  width: imgPrep.width,
                  height: imgPrep.height,
                });
                if (item.objectUrl && (imgPrep.thumbUrl || imgPrep.imageDataUrl)) {
                  objectUrlsToRevoke.push(item.objectUrl);
                }
              }
              const dimText =
                imgPrep.width && imgPrep.height ? ` (${imgPrep.width}×${imgPrep.height}px)` : "";
              return {
                name: item.name,
                type: stagedMime,
                kind: "image",
                workspacePath: stagedPath,
                mimeType: stagedMime,
                sizeBytes: file.size,
                width: imgPrep.width,
                height: imgPrep.height,
                imageDataUrl: imgPrep.imageDataUrl,
                content: stagedPath
                  ? `Imagen adjunta guardada en '${stagedPath}'${dimText}. Puedes usarla en 'pdf_generate' (como portada en 'cover.image_path' o bloque {type:'image', path:'${stagedPath}'}) o inspeccionarla con 'workspace_read'.`
                  : `Imagen adjunta '${item.name}'${dimText}.`,
              };
            }

            if (kind === "pdf") {
              if (stagedPath) {
                thumbByIdx.set(fIdx, { workspacePath: stagedPath });
              }
              return {
                name: item.name,
                type: "application/pdf",
                kind: "pdf",
                workspacePath: stagedPath,
                mimeType: "application/pdf",
                sizeBytes: file.size,
                content: stagedPath
                  ? effectiveMode === "inspector"
                    ? `PDF adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Estás en modo /inspector: usa 'document_inspect_design' con path='${stagedPath}' para analizar su diseño visual y guardarlo con 'document_save_design_skill'.`
                    : `PDF adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Usa SIEMPRE la herramienta 'pdf_read' con path='${stagedPath}' para extraer su texto, tablas y OCR.`
                  : `Archivo PDF adjunto '${item.name}' (${Math.max(1, Math.round(file.size / 1024))} KB).`,
              };
            }

            const ext = item.name.split(".").pop()?.toLowerCase() || "";
            if (OFFICE_DOC_EXT_SET.has(ext) && stagedPath) {
              thumbByIdx.set(fIdx, { workspacePath: stagedPath });
              void openUniversalDocInRightPanel({
                path: stagedPath,
                filename: item.name,
                sizeBytes: file.size,
                ext,
              });
              return {
                name: item.name,
                type: stagedMime,
                kind: "binary",
                workspacePath: stagedPath,
                mimeType: stagedMime,
                sizeBytes: file.size,
                content:
                  effectiveMode === "inspector"
                    ? `Documento Office (.${ext}) adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Estás en modo /inspector: usa 'document_inspect_design' con path='${stagedPath}' para analizar su diseño visual y estructural, y guárdalo como habilidad reutilizable con 'document_save_design_skill'.`
                    : `Documento Office adjunto guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB). Usa SIEMPRE la herramienta 'workspace_read' con path='${stagedPath}' para leer su texto, diapositivas o tablas completas.`,
              };
            }

            return {
              name: item.name,
              type: stagedMime,
              kind: "binary",
              workspacePath: stagedPath,
              mimeType: stagedMime,
              sizeBytes: file.size,
              content: stagedPath
                ? `Archivo binario guardado en '${stagedPath}' (${Math.max(1, Math.round(file.size / 1024))} KB).`
                : `(Archivo adjunto de ${Math.max(1, Math.round(file.size / 1024))} KB)`,
            };
          }

          if (file.size <= 131072) {
            try {
              const raw = await file.text();
              return {
                name: item.name,
                type: file.type || "text/plain",
                kind: "text",
                sizeBytes: file.size,
                content: raw.slice(0, 4000),
              };
            } catch {
              return {
                name: item.name,
                type: file.type || "archivo",
                kind: "text",
                content: "(No se pudo leer el contenido del archivo)",
              };
            }
          }

          return {
            name: item.name,
            type: file.type || "archivo",
            kind: "text",
            sizeBytes: file.size,
            content: `(Archivo de texto grande de ${Math.round(file.size / 1024)} KB)`,
          };
        })
      );
      const fileSnippets: AttachedContextItem[] = fileSnippetList.filter(
        (s): s is AttachedContextItem => s !== null
      );

      if (thumbByIdx.size > 0) {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id && m.attachments
              ? {
                  ...m,
                  attachments: m.attachments.map((att, idx) => {
                    const patch = thumbByIdx.get(idx);
                    return patch ? { ...att, ...patch } : att;
                  }),
                }
              : m
          )
        );
        if (objectUrlsToRevoke.length > 0) {
          window.setTimeout(() => {
            for (const url of objectUrlsToRevoke) {
              try {
                URL.revokeObjectURL(url);
              } catch {
                // Ignorar
              }
            }
          }, 1000);
        }
      }
      if (stagedAnyBinary && isTauriEnv) {
        void handleRefreshWorkspace();
      }

      const activeContextSnippets: AttachedContextItem[] = contextItems
        .filter((c) => c.pinned || selectedContext?.id === c.id)
        .map((c) => ({
          name: c.name,
          type: c.type,
          content: c.content.slice(0, 2500),
        }));

      if (effectiveScope !== "document" && showDocViewer && pdfPanelState?.path) {
        const viewerKind = pdfPanelState.fileKind || "pdf";
        const activeDocName =
          pdfPanelState.title || pdfPanelState.filename || pdfPanelState.path;
        if (viewerKind === "pdf") {
          activeContextSnippets.unshift({
            name: activeDocName,
            type: "application/pdf",
            kind: "pdf",
            workspacePath: pdfPanelState.path,
            content:
              `DOCUMENTO ACTIVO EN EL VISOR: '${pdfPanelState.path}' (título: '${pdfPanelState.title}', estilo/theme: '${pdfPanelState.theme || "executive"}', páginas actuales: ${pdfPanelState.pageCount || pdfPanelState.pages.length || 1}). ` +
              (effectiveMode === "inspector"
                ? `Estás en modo /inspector: usa 'document_inspect_design' con path='${pdfPanelState.path}' para analizar su diseño visual (colores, tipografía, márgenes, encabezados, tablas y estructura) y guardarlo como habilidad reutilizable con 'document_save_design_skill'. `
                : "") +
              `Si el usuario comenta o da feedback negativo/de ajuste sobre este documento, PRIMERO inspecciónalo con 'pdf_read' (si aún no conoces sus encabezados/texto exacto) y luego aplica el cambio REAL sobre '${pdfPanelState.path}' llamando a 'pdf_generate' con source_pdf_path='${pdfPanelState.path}', edit_action='modify' (usando 'section_updates' para cambios por sección sin borrar lo demás, o 'replacements' para reemplazos puntuales, o 'markdown'/'blocks' completos). ` +
              `Si pide agregar más páginas, usa source_pdf_path='${pdfPanelState.path}', edit_action='append_pages' y theme='${pdfPanelState.theme || "executive"}'. NO añadas marca de agua XOOK salvo que se pida explícitamente.`,
          });
        } else {
          const isOfficeOrCsv =
            viewerKind === "office" ||
            pdfPanelState.fileExtension === "csv" ||
            pdfPanelState.fileExtension === "tsv";
          activeContextSnippets.unshift({
            name: activeDocName,
            type: "document",
            workspacePath: pdfPanelState.path,
            content:
              `DOCUMENTO ACTIVO EN EL VISOR: '${pdfPanelState.path}' (${viewerKind}, título: '${pdfPanelState.title}'). ` +
              (effectiveMode === "inspector" && isOfficeOrCsv
                ? `Estás en modo /inspector: usa 'document_inspect_design' con path='${pdfPanelState.path}' para analizar su diseño visual/estructural y guardarlo como habilidad reutilizable con 'document_save_design_skill'. `
                : "") +
              `Usa 'workspace_read' con path='${pdfPanelState.path}' si necesitas ver su contenido completo; si pide modificarlo, edítalo directamente ('office_generate' con source_path='${pdfPanelState.path}' y edit_action='modify' para .docx/.xlsx, o 'workspace_edit_file' para texto/Markdown).`,
          });
        }
      } else if (selectedWorkspaceFile?.relativePath) {
        activeContextSnippets.push({
          name: selectedWorkspaceFile.name,
          type: "workspace_selection",
          workspacePath: selectedWorkspaceFile.relativePath,
          content: `Último archivo seleccionado en el espacio de trabajo: '${selectedWorkspaceFile.relativePath}' (${selectedWorkspaceFile.name}). Úsalo como candidato principal si el usuario se refiere implícitamente a "ese archivo/documento".`,
        });
      }

      const businessContextSnapshot = [
        ...contextItems
          .filter(
            (c) =>
              !(
                isTauriEnv &&
                (c.path === "memoria/hechos.md" || c.type === "memory")
              )
          )
          .map((c) => `- ${c.name} (${c.type}): ${c.content.slice(0, 700)}`),
        ...patterns.map(
          (p) => `- Patrón aprendido (${Math.round(p.confidence * 100)}%): ${p.description}`
        ),
      ]
        .join("\n")
        .slice(0, 4500);

      const fallbackChatCanvas = (() => {
        for (let i = chatMessagesRef.current.length - 1; i >= 0; i -= 1) {
          const m = chatMessagesRef.current[i];
          if (m.canvas) return m.canvas;
          if (m.canvases && m.canvases.length > 0) {
            return m.canvases[m.canvases.length - 1];
          }
        }
        return null;
      })();
      const effectiveActiveCanvas =
        showCanvas && !(showDocViewer && pdfPanelState?.path)
          ? (activeCanvas ?? fallbackChatCanvas)
          : null;

      setPermissionItems([]);
      activeAssistantMsgIdRef.current = assistantMsgId;
      activeTimelineRef.current = [];
      let turnCompactedEvt: ContextCompactedEvent | null = null;
      let turnMemoryMutated = false;
      let turnOpenedOfficePath: string | null = null;
      if (turnAbortController.signal.aborted) {
        throw new Error(XOOK_STREAM_CANCELLED_CODE);
      }
      const res = await runXoxAiChatStream(
        {
          message: query,
          activeMode: effectiveMode,
          subagentRoster: effectiveSubagentRoster,
          history: priorHistory,
          currentTasks: tasksRef.current,
          agendaItems,
          attachedContext: [...fileSnippets, ...activeContextSnippets],
          modelOverride: modelId,
          providerOverride: activeProvider,
          userProfile: localUser
            ? {
                name: localUser.name,
                storeName: localUser.storeName,
                role: localUser.role,
                ...(localUser.preferredName ? { preferredName: localUser.preferredName } : {}),
                ...(localUser.occupation ? { occupation: localUser.occupation } : {}),
                ...(localUser.workContext ? { workContext: localUser.workContext } : {}),
                ...(localUser.language ? { language: localUser.language } : {}),
                ...(localUser.timezone ? { timezone: localUser.timezone } : {}),
                ...(localUser.notes ? { notes: localUser.notes } : {}),
              }
            : null,
          businessContextSnapshot,
          activeCanvas: effectiveActiveCanvas,
          contextScope: effectiveScope,
          activeDocument: effectiveScope === "document" ? resolvedDocTarget : null,
          contextCheckpoint: effectiveScope === "chat" ? chatCheckpointRef.current : null,
          modelContextWindow,
          sessionId: convId,
        },
        {
          signal: turnAbortController.signal,
          onStreamStart: (sid) => {
            activeStreamIdRef.current = sid;
          },
          onContextCompacted: (evt) => {
            turnCompactedEvt = evt;
            applyCompactedContextEvent(evt, {
              attachToAssistantMsgId: assistantMsgId,
              excludeUserMsgId: userMsg.id,
            });
          },
          onProviderFailover: (evt) => {
            const toSpec = getProviderSpec(evt.toProvider);
            const label =
              evt.notice ||
              `Límite en ${getProviderSpec(evt.fromProvider).shortName} · cambiando a ${toSpec.shortName}...`;
            setThinkingLabel(label);
            setXoxMessage(label);
            setStatusMessage(label);
            if (evt.modelUsed) {
              setModelId(evt.modelUsed);
            }
          },
          onPhase: (state, label) => {
            const afterCommand =
              activeTimelineRef.current[activeTimelineRef.current.length - 1]?.kind === "command";
            if (state === "coding" || (afterCommand && (state === "reading" || state === "thinking"))) {
              clearXoxPhaseTimers();
              hasEnteredTalking = false;
            } else if (hasEnteredTalking && (state === "reading" || state === "thinking")) {
              return;
            }
            if (state === "talking") {
              clearXoxPhaseTimers();
              hasEnteredTalking = true;
              if (!talkingStartedAt) talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
              if (label) {
                setThinkingLabel(label);
                setXoxMessage(label);
              }
              return;
            }
            if (state === "thinking" && latestPhase === "reading") {
              const elapsed = performance.now() - readingStartedAt;
              const remaining = READING_MIN_MS - elapsed;
              if (remaining > 40) {
                xoxPhaseTimersRef.current.push(
                  setTimeout(() => {
                    if (hasEnteredTalking) return;
                    latestPhase = "thinking";
                    setXoxState("thinking");
                    setThinkingLabel(label || "Thinking");
                    setXoxMessage(label || "Thinking");
                  }, remaining)
                );
                return;
              }
            }
            latestPhase = state;
            setXoxState(state);
            if (label) {
              setThinkingLabel(label);
              setXoxMessage(label);
            }
          },
          onTerminal: (termEvt) => {
            setXoxTerminalFeed((prev) => ({
              seq: (prev?.seq ?? 0) + 1,
              mode: termEvt.mode,
              status: termEvt.status,
              command: termEvt.command ?? termEvt.target,
              outputLines: termEvt.outputLines,
            }));
          },
          onSteps: (steps) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, thinkingSteps: steps } : m
              )
            );
          },
          onChecklistUpdate: (chk) => {
            setActiveChecklist(chk);
          },
          onSubagentEvent: (sub) => {
            setChatMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const existing = m.subagents ?? [];
                const foundIdx = existing.findIndex((s) => s.id === sub.id);
                const nextSubs =
                  foundIdx >= 0
                    ? existing.map((s, i) => (i === foundIdx ? { ...s, ...sub } : s))
                    : [...existing, sub];
                return { ...m, subagents: nextSubs };
              })
            );
          },
          onStudyDeck: (deck) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, studyDeck: deck } : m
              )
            );
          },
          onWebSources: (sources) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, webSources: sources } : m
              )
            );
          },
          onReasoningDelta: (delta) => {
            if (!hasEnteredTalking && latestPhase === "reading") {
              const elapsed = performance.now() - readingStartedAt;
              if (elapsed >= READING_MIN_MS) {
                latestPhase = "thinking";
                setXoxState("thinking");
              }
            }
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      reasoning: (m.reasoning ?? "") + delta,
                      isReasoningStreaming: true,
                    }
                  : m
              )
            );
          },
          onReasoningReset: () => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, reasoning: "", isReasoningStreaming: true }
                  : m
              )
            );
          },
          onReplyDelta: (delta) => {
            if (!hasEnteredTalking) {
              clearXoxPhaseTimers();
              hasEnteredTalking = true;
              talkingStartedAt = performance.now();
              latestPhase = "talking";
              setXoxState("talking");
            }
            streamedReplyText += delta;
            if (isAutoSpeakReady()) {
              const visibleSoFar = cleanVisibleReply(streamedReplyText, { stripTables: false });
              if (!startedStreamSpeech && visibleSoFar.trim().length > 0) {
                startedStreamSpeech = true;
                ttsPlayer.beginStreamSession(assistantMsgId, {
                  voiceId: ttsStatusRef.current?.config.voiceId,
                  speed: ttsStatusRef.current?.config.speed,
                });
              }
              if (startedStreamSpeech) {
                ttsPlayer.pushStreamText(assistantMsgId, visibleSoFar);
              }
            }
            const nextTimeline = appendReplyDeltaToTimeline(
              activeTimelineRef.current,
              delta
            );
            activeTimelineRef.current = nextTimeline;
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content + delta,
                      timeline: nextTimeline,
                      isReasoningStreaming: false,
                    }
                  : m
              )
            );
          },
          onCanvas: (canvas) => {
            let prevExisting: CanvasArtifact | null = null;
            if (activeCanvas?.id === canvas.id) {
              prevExisting = activeCanvas;
            } else {
              for (let i = chatMessagesRef.current.length - 1; i >= 0; i -= 1) {
                const msg = chatMessagesRef.current[i];
                const match =
                  msg.canvases?.find((c) => c.id === canvas.id) ??
                  (msg.canvas?.id === canvas.id ? msg.canvas : undefined);
                if (match) {
                  prevExisting = match;
                  break;
                }
              }
            }
            const withSource = mergeCanvasWithVersionHistory(prevExisting, {
              ...canvas,
              sourceMessageId: assistantMsgId,
            });
            setShowXoxStudio(false);
            setActiveCanvas(withSource);
            setShowCanvas(true);
            setChatMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const prevList = m.canvases ?? (m.canvas ? [m.canvas] : []);
                const idx = prevList.findIndex((c) => c.id === withSource.id);
                const nextList =
                  idx >= 0
                    ? prevList.map((c, i) => (i === idx ? withSource : c))
                    : [...prevList, withSource];
                return { ...m, canvas: withSource, canvases: nextList };
              })
            );
          },
          onXoxCustomized: (evt) => {
            void refreshXoxStudioData();
            if (evt.section === "voice") {
              void getTtsStatus().then(setTtsStatus).catch(() => {});
            }
            if (evt.slug) {
              setHighlightedSkillSlug(evt.slug);
            }
            if (
              evt.changed?.some(
                (field) =>
                  field === "likes" ||
                  field === "workflows" ||
                  field === "donts" ||
                  field === "global_rules"
              )
            ) {
              triggerMemoryLivePulse("updated", "xox", evt.summary);
            }
          },
          onUserMemoryUpdated: (evt) => {
            turnMemoryMutated = true;
            suppressMemorySyncPulseUntilRef.current = Date.now() + 500;
            void listUserMemoryFacts().then(setUserMemoryFacts).catch(() => {});
            if (evt.profileUpdated) {
              void getLocalUserProfile().then(setLocalUser).catch(() => {});
            }
            if (evt.scope === "workspace" || evt.path === "memoria/hechos.md") {
              void handleRefreshWorkspace();
            }
            triggerMemoryLivePulse(
              evt.action === "forget_user_info" ? "removed" : "updated",
              "xox",
              evt.key || (evt.scope === "workspace" ? "memoria/hechos.md" : undefined)
            );
            if (!isCompactViewportRef.current) {
              if (!showXoxStudioRef.current) {
                showXoxStudioRef.current = true;
                openXoxStudio("memory");
              } else {
                setXoxStudioTab("memory");
              }
            }
          },
          onVaultAction: (vaultAction) => {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, vaultPrompt: vaultAction } : m
              )
            );
          },
          onPdfDraftProgress: (draft) => {
            handlePdfDraftProgress(draft, assistantMsgId);
          },
          onPdfGenerated: (pdf) => {
            const freshRev = pdf.revision || Date.now();
            const stampedPdf: GeneratedPdfArtifact = { ...pdf, revision: freshRev };
            const slimPdf: GeneratedPdfArtifact = {
              ...stampedPdf,
              previewPages: undefined,
              previewHasMore: undefined,
            };
            lastPdfByTurnRef.current[assistantMsgId] = slimPdf;
            turnOpenedPdfRevRef.current[assistantMsgId] = freshRev;
            setChatMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                const prevList = m.generatedPdfs ?? [];
                const nextList = prevList.some((p) => p.path === slimPdf.path)
                  ? prevList.map((p) => (p.path === slimPdf.path ? slimPdf : p))
                  : [...prevList, slimPdf];
                return { ...m, generatedPdfs: nextList };
              })
            );
            void openPdfInRightPanel(stampedPdf);
          },
          onDocumentGenerated: (doc) => {
            turnOpenedOfficePath = doc.path;
            void openGeneratedOfficeDocInRightPanel(doc);
          },
        }
      );

      clearXoxPhaseTimers();
      if (chatAbortControllerRef.current === turnAbortController) {
        chatAbortControllerRef.current = null;
      }
      const rawTurnTimeline = activeTimelineRef.current;
      activeStreamIdRef.current = null;
      activeAssistantMsgIdRef.current = null;
      activeTimelineRef.current = [];
      setPermissionItems([]);
      setPdfDraftProgress(null);
      const generatedCount = res.tasks.length;
      const rawResCanvases =
        res.canvases && res.canvases.length > 0
          ? res.canvases
          : res.canvas
            ? [res.canvas]
            : [];
      const currentAssistantMsg = chatMessagesRef.current.find((m) => m.id === assistantMsgId);
      const finalCanvases: CanvasArtifact[] = rawResCanvases.map((rc) => {
        let prevExisting: CanvasArtifact | null = null;
        const inCurrent =
          currentAssistantMsg?.canvases?.find((c) => c.id === rc.id) ??
          (currentAssistantMsg?.canvas?.id === rc.id ? currentAssistantMsg.canvas : undefined);
        if (inCurrent) {
          prevExisting = inCurrent;
        } else if (activeCanvas?.id === rc.id) {
          prevExisting = activeCanvas;
        } else {
          for (let i = chatMessagesRef.current.length - 1; i >= 0; i -= 1) {
            const msg = chatMessagesRef.current[i];
            const match =
              msg.canvases?.find((c) => c.id === rc.id) ??
              (msg.canvas?.id === rc.id ? msg.canvas : undefined);
            if (match) {
              prevExisting = match;
              break;
            }
          }
        }
        return mergeCanvasWithVersionHistory(prevExisting, {
          ...rc,
          sourceMessageId: assistantMsgId,
        });
      });
      const finalCanvas =
        finalCanvases.length > 0 ? finalCanvases[finalCanvases.length - 1] : undefined;
      if (finalCanvas) {
        setShowXoxStudio(false);
        setActiveCanvas(finalCanvas);
        setShowCanvas(true);
      }
      if (generatedCount > 0) {
        const replacePending = res.operation === "replace_tasks";
        if (replacePending) {
          setTasks((prev) => [
            ...res.tasks,
            ...prev.filter((t) => t.intent.type === "save_api_key"),
          ]);
        } else {
          setTasks((prev) => [...res.tasks, ...prev]);
        }
        setShowRightSidebar(true);
        setTaskTab("pending");
        if (isTauriEnv) {
          suppressLedgerSyncUntilRef.current = Date.now() + 450;
          void upsertTasksBatch(res.tasks, replacePending);
        }
      }

      setRequestsToday(incrementLocalDailyRequestCount(aiConfig.maskedKey));
      const finalPid = res.providerUsed ? normalizeProviderIdClient(res.providerUsed) : activeProvider;
      if (res.failoverNotice || (res.failoverEvents && res.failoverEvents.length > 0)) {
        const noticeText =
          res.failoverNotice ||
          `Cuota agotada en ${activeSpec.shortName}; continué automáticamente con ${getProviderSpec(finalPid).shortName}.`;
        setStatusMessage(noticeText);
        setTimeout(() => setStatusMessage(null), 6500);
        void getAiConfigStatus().then((fresh) => {
          setAiConfig(fresh);
          if (fresh.modelId) setModelId(fresh.modelId);
        });
        void fetchOpenRouterModels(false, false, finalPid).then((catRes) => {
          if (catRes.models.length > 0) setCatalogModels(catRes.models);
        });
      }
      testAiConnection(finalPid)
        .then((u) => setAccountUsage(u))
        .catch(() => {});
      void getAiUsageLedger().then(setUsageLedger).catch(() => {});

      const nextClarification = res.clarification ?? null;
      const nextVaultAction = res.vaultAction ?? undefined;
      const resPdfs = res.generatedPdfs ?? [];
      if (res.documentContext) {
        const snap = res.documentContext;
        setDocContextsByPath((prev) => ({ ...prev, [snap.path]: snap }));
      }
      if (res.contextCompacted && !turnCompactedEvt) {
        turnCompactedEvt = res.contextCompacted;
        applyCompactedContextEvent(res.contextCompacted, {
          attachToAssistantMsgId: assistantMsgId,
        });
      }
      // Garantizar apertura fresca del último PDF generado incluso si la pestaña se cerró antes o si se omitió el evento de stream
      if (resPdfs.length > 0) {
        const latestPdf = resPdfs[resPdfs.length - 1];
        const openedRev = turnOpenedPdfRevRef.current[assistantMsgId] ?? 0;
        const alreadyOpenedSamePath =
          openedRev > 0 &&
          docViewerRef.current.show &&
          docViewerRef.current.state?.path === latestPdf.path &&
          (docViewerRef.current.state?.pages?.length ?? 0) > 0;
        if (!alreadyOpenedSamePath) {
          const freshRev = latestPdf.revision || Date.now();
          turnOpenedPdfRevRef.current[assistantMsgId] = freshRev;
          void openPdfInRightPanel({ ...latestPdf, revision: freshRev }, "view");
        }
      }
      const resOfficeDocs = res.generatedDocuments ?? [];
      if (resOfficeDocs.length > 0) {
        const latestOffice = resOfficeDocs[resOfficeDocs.length - 1];
        if (turnOpenedOfficePath !== latestOffice.path) {
          turnOpenedOfficePath = latestOffice.path;
          void openGeneratedOfficeDocInRightPanel(latestOffice);
        }
      }
      const replyWithFailover =
        res.failoverNotice && res.reply && !res.reply.includes(res.failoverNotice)
          ? `> *Nota de respaldo automático:* ${res.failoverNotice}\n\n${res.reply}`
          : res.reply;
      const lastCust =
        res.xoxCustomizations && res.xoxCustomizations.length > 0
          ? res.xoxCustomizations[res.xoxCustomizations.length - 1]
          : undefined;
      const hasTabularCanvas = finalCanvases.some(
        (c) => c.columns.length > 0 && c.rows.length > 0
      );
      const finalizedTimeline = finalizeChatTimeline(rawTurnTimeline, replyWithFailover, {
        failoverNotice: res.failoverNotice,
        cleanText: (raw) => cleanVisibleReply(raw, { stripTables: hasTabularCanvas }),
      });
      const finalMessages = chatMessagesRef.current.map((m) => {
        if (m.id !== assistantMsgId) return m;
        const resolvedVault = nextVaultAction ?? m.vaultPrompt;
        return {
          ...m,
          content: replyWithFailover,
          timeline: finalizedTimeline,
          reasoning: res.reasoning || m.reasoning,
          reasoningDurationMs: res.reasoningDurationMs,
          thinkingSteps: res.steps ?? m.thinkingSteps,
          isStreaming: false,
          isReasoningStreaming: false,
          modelUsed: res.modelUsed,
          latencyMs: res.latencyMs,
          tokensUsed: res.usage?.totalTokens,
          generatedTaskCount: generatedCount,
          canvas: finalCanvas ?? m.canvas,
          canvases: finalCanvases.length > 0 ? finalCanvases : m.canvases,
          webSources: res.webSources && res.webSources.length > 0 ? res.webSources : m.webSources,
          vaultPrompt: resolvedVault,
          generatedPdfs: (() => {
            const base = m.generatedPdfs ?? [];
            if (resPdfs.length === 0) return base.length > 0 ? base : undefined;
            const byPath = new Map<string, GeneratedPdfArtifact>();
            for (const p of base) byPath.set(p.path, p);
            for (const p of resPdfs) byPath.set(p.path, p);
            return Array.from(byPath.values());
          })(),
          turnMemory: res.turnMemory ?? m.turnMemory,
          actionButton: nextClarification
            ? {
                label: "Responder preguntas",
                kind: "open_clarification" as const,
                clarification: nextClarification,
              }
            : resolvedVault
              ? {
                  label: `Abrir Bóveda (${getProviderSpec(resolvedVault.provider).shortName})`,
                  kind: "open_settings" as const,
                  provider: resolvedVault.provider,
                }
              : turnMemoryMutated
                ? {
                    label: "Ver en Grafo de Memoria",
                    kind: "open_xox_studio" as const,
                    studioTab: "memory" as const,
                  }
                : lastCust
                  ? {
                      label: `Ver cambio en Espacio de ${effectiveAgentName}`,
                      kind: "open_xox_studio" as const,
                      studioTab: lastCust.section,
                      skillSlug: lastCust.slug,
                    }
                  : m.actionButton,
        };
      });
      setChatMessages(finalMessages);
      void persistConversation(finalMessages, convId);
      if (nextClarification) {
        setActiveClarification(nextClarification);
      }
      if (nextVaultAction?.intent === "open_settings") {
        openAiSettings("account", nextVaultAction.provider);
      } else if (
        nextVaultAction?.intent === "switch_provider" &&
        aiConfig.configuredProviders?.[nextVaultAction.provider]?.hasApiKey
      ) {
        const targetSlot = aiConfig.configuredProviders[nextVaultAction.provider];
        const nextModel = targetSlot?.modelId || getProviderSpec(nextVaultAction.provider).defaultModelId;
        void saveAiConfig({
          provider: nextVaultAction.provider,
          modelId: nextModel,
        }).then((updated) => {
          setAiConfig(updated);
          setModelId(updated.modelId || nextModel);
        });
      }

      setIsChatStreaming(false);
      if (res.workspaceMutated && isTauriEnv) {
        void handleRefreshWorkspace();
      }
      if (res.xoxCustomizations && res.xoxCustomizations.length > 0) {
        void refreshXoxStudioData();
        if (res.xoxCustomizations.some((c) => c.section === "voice")) {
          void getTtsStatus().then(setTtsStatus).catch(() => {});
        }
      }

      const finalMood: XoxState = res.xoxMood === "alert" ? "alert" : "success";
      const summaryStatus =
        generatedCount > 0
          ? `Xox generó ${generatedCount} ${generatedCount === 1 ? "tarjeta" : "tarjetas"} en Tareas & Decisiones.`
          : nextClarification
          ? "Xox necesita unos datos para continuar."
          : "¿En qué más te ayudo?";
      setStatusMessage(generatedCount > 0 ? summaryStatus : null);

      const finishMood = (successDelayMs: number) => {
        setXoxState(finalMood);
        setXoxMessage(summaryStatus);
        xoxPhaseTimersRef.current.push(
          setTimeout(() => {
            setXoxState((s) => (s === "success" || s === "alert" ? "idle" : s));
            setXoxMessage("¿En qué puedo ayudarte?");
          }, successDelayMs)
        );
      };

      const latestTts = ttsStatusRef.current;
      const shouldAutoSpeak =
        isAutoSpeakReady() &&
        !nextClarification &&
        replyWithFailover.trim().length > 0;

      let spokenQueued = false;
      if (shouldAutoSpeak) {
        const finalSpeechSource =
          startedStreamSpeech && res.reply.trim().length > 0 ? res.reply : replyWithFailover;
        spokenQueued = ttsPlayer.finishStreamSession(
          assistantMsgId,
          cleanVisibleReply(finalSpeechSource, { stripTables: false }),
          {
            voiceId: latestTts?.config.voiceId,
            speed: latestTts?.config.speed,
          }
        );
      } else if (startedStreamSpeech) {
        ttsPlayer.stop();
      }

      if (generatedCount > 0) {
        setXoxState("syncing");
        setXoxMessage("Organizando tarjetas en Tareas...");
        xoxPhaseTimersRef.current.push(
          setTimeout(() => finishMood(2800), 850)
        );
      } else if (!shouldAutoSpeak || !spokenQueued) {
        const TALKING_MIN_MS = 1100;
        const talkElapsed = talkingStartedAt ? performance.now() - talkingStartedAt : 0;
        const talkWait = talkingStartedAt
          ? Math.max(0, TALKING_MIN_MS - talkElapsed)
          : res.reply.trim().length > 0
            ? TALKING_MIN_MS
            : 0;
        if (talkWait > 40) {
          setXoxState("talking");
          setXoxMessage("Respondiendo...");
          xoxPhaseTimersRef.current.push(
            setTimeout(() => finishMood(1800), talkWait)
          );
        } else {
          finishMood(1800);
        }
      }

      if (generatedCount > 0) {
        xoxPhaseTimersRef.current.push(
          setTimeout(() => setStatusMessage(null), 4500)
        );
      }
    } catch (err) {
      clearXoxPhaseTimers();
      const wasCancelled =
        isStreamCancelledError(err) || Boolean(chatAbortControllerRef.current?.signal.aborted);
      const rawTurnTimeline = activeTimelineRef.current;
      chatAbortControllerRef.current = null;
      activeStreamIdRef.current = null;
      activeAssistantMsgIdRef.current = null;
      activeTimelineRef.current = [];
      setPermissionItems([]);
      if (startedStreamSpeech) {
        ttsPlayer.stop();
      }
      const recoveredTurnPdf = lastPdfByTurnRef.current[assistantMsgId];
      if (recoveredTurnPdf) {
        setPdfDraftProgress(null);
        void openPdfInRightPanel(recoveredTurnPdf);
      } else {
        setPdfDraftProgress(null);
      }
      if (wasCancelled) {
        const stoppedMessages = chatMessagesRef.current.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: m.content.trim() ? m.content : "*Respuesta detenida.*",
                timeline: finalizeChatTimeline(
                  rawTurnTimeline,
                  m.content.trim() ? m.content : "*Respuesta detenida.*",
                  {
                    cancelled: true,
                    cleanText: (raw) => cleanVisibleReply(raw, { stripTables: false }),
                  }
                ),
                thinkingSteps: m.thinkingSteps?.map((s) =>
                  s.status === "running" ? { ...s, status: "done" as const } : s
                ),
                isStreaming: false,
                isReasoningStreaming: false,
              }
            : m
        );
        setChatMessages(stoppedMessages);
        void persistConversation(stoppedMessages, convId);
        setIsChatStreaming(false);
        setXoxState("idle");
        setXoxMessage("Proceso detenido.");
        setTimeout(() => {
          setXoxMessage((curr) => (curr === "Proceso detenido." ? "¿En qué puedo ayudarte?" : curr));
        }, 2400);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      const message = extractErrorMessage(
        err,
        `No se pudo completar la consulta con ${activeSpec.name}.`
      );
      const lowerMsg = message.toLowerCase();
      if (
        lowerMsg.includes("402") ||
        lowerMsg.includes("saldo") ||
        lowerMsg.includes("créditos") ||
        lowerMsg.includes("cuota") ||
        lowerMsg.includes("no está disponible") ||
        lowerMsg.includes("404")
      ) {
        setUnavailableModelIds((prev) => {
          const next = new Set(prev);
          next.add(modelId);
          return next;
        });
      }
      if (hasAnyConfiguredKey) {
        void getAiConfigStatus()
          .then((fresh) => {
            setAiConfig(fresh);
            if (fresh.modelId) setModelId(fresh.modelId);
            return testAiConnection(fresh.provider);
          })
          .then((u) => setAccountUsage(u))
          .catch(() => {});
      }
      const errMessages = chatMessagesRef.current.map((m) =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: `Error al consultar ${activeSpec.name}: ${message}`,
              timeline: finalizeChatTimeline(rawTurnTimeline, "", {
                cancelled: true,
                cleanText: (raw) => cleanVisibleReply(raw, { stripTables: false }),
              }),
              thinkingSteps: m.thinkingSteps?.map((s) =>
                s.status === "running" ? { ...s, status: "error" as const } : s
              ),
              isStreaming: false,
              isReasoningStreaming: false,
              isError: true,
              actionButton: {
                label: "Revisar proveedores y claves",
                kind: "open_settings" as const,
              },
            }
          : m
      );
      setChatMessages(errMessages);
      void persistConversation(errMessages, convId);
      setIsChatStreaming(false);
      setXoxState("alert");
      setXoxMessage("Error al conectar con OpenRouter.");
      setStatusMessage(message);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleRegenerateMessage = (targetMsg: UiChatMessage) => {
    if (isChatStreaming) return;
    const msgs = chatMessagesRef.current;
    const targetIdx = msgs.findIndex((m) => m.id === targetMsg.id);
    if (targetIdx <= 0) return;
    let userIdx = -1;
    for (let i = targetIdx - 1; i >= 0; i -= 1) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) return;
    const targetUserMsg = msgs[userIdx];
    const userPrompt = targetUserMsg.content;
    const pastedOverrides: ComposerAttachmentItem[] = (targetUserMsg.attachments ?? [])
      .filter((att) => att.kind === "pasted_text" && Boolean(att.pastedContent))
      .map((att, idx) => createPastedTextItem(att.pastedContent ?? "", idx));
    const trimmedHistory = msgs.slice(0, userIdx);
    void runPromptQuery(
      userPrompt,
      trimmedHistory,
      pastedOverrides.length > 0 ? { overrideAttachments: pastedOverrides } : undefined
    );
  };

  const handleStopGeneration = () => {
    const controller = chatAbortControllerRef.current;
    const streamId = activeStreamIdRef.current;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    if (streamId) {
      void cancelXoxAiChatStream(streamId);
    }
    ttsPlayer.stop();
  };

  const handlePromptSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    runPromptQuery(inputPrompt);
  };

  const handleInspectPdfDesign = (
    relativePath: string,
    title: string,
    formatLabel?: string
  ) => {
    const ext = relativePath.split(".").pop()?.toLowerCase() || "";
    const friendlyFormat =
      formatLabel?.trim() ||
      (ext === "docx" || ext === "doc" || ext === "rtf" || ext === "odt"
        ? "Word"
        : ext === "xlsx" || ext === "xls" || ext === "ods"
          ? "Excel"
          : ext === "pptx" || ext === "ppt" || ext === "odp"
            ? "PowerPoint"
            : ext === "csv" || ext === "tsv"
              ? "CSV"
              : "PDF");
    const cleanTitle = (
      title ||
      relativePath.split("/").pop() ||
      `este documento ${friendlyFormat}`
    ).trim();
    const isSpreadsheetDoc =
      ext === "xlsx" || ext === "xls" || ext === "ods" || ext === "csv" || ext === "tsv";
    const styleChecklist = isSpreadsheetDoc
      ? "hojas, columnas, paleta de colores, estilos de cabecera/cebra/totales, fórmulas y formatos numéricos"
      : "tipografía, colores, márgenes, encabezados/pies, tablas y estructura";
    setActiveMode("inspector");
    setShowCommandMenu(false);
    setCommandMenuFilter("");
    setShowRosterPopover(false);
    setShowXoxStudio(false);
    if (isCompactViewport) {
      setShowDocViewer(false);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
    if (isChatStreaming) {
      setStatusMessage("Modo /inspector activado. Espera a que termine la respuesta actual.");
      setTimeout(() => setStatusMessage(null), 3200);
      return;
    }
    void runPromptQuery(
      `Analiza el diseño visual y estructural del documento ${friendlyFormat} "${cleanTitle}" (${relativePath}) usando document_inspect_design, resume su estilo detectado (${styleChecklist}) sin datos sensibles y guárdalo como habilidad reutilizable con document_save_design_skill.`,
      undefined,
      { overrideMode: "inspector", forceScope: "chat" }
    );
  };

  type MainSummonEventPayload = {
    seq: number;
    prompt?: string | null;
    autoRun?: boolean;
    responseText?: string | null;
    canvas?: unknown;
  };

  const mainSummonHandlerRef = useRef<(payload: MainSummonEventPayload) => void>(() => {});
  mainSummonHandlerRef.current = (payload) => {
    const { seq, prompt, autoRun, responseText, canvas } = payload ?? {};
    setSummonSeq(seq ?? Date.now());
    requestAnimationFrame(() => inputRef.current?.focus());

    if (responseText || canvas) {
      const safePrompt = prompt ? detectApiKeyInText(prompt).sanitizedText : null;
      const rawResponse = responseText ? detectApiKeyInText(responseText).sanitizedText : "";
      const normalizedIncoming = canvas ? sanitizeCanvasArtifact(canvas) ?? undefined : undefined;
      let transferredCanvas: CanvasArtifact | undefined =
        normalizedIncoming && canvasHasCellData(normalizedIncoming)
          ? normalizedIncoming
          : undefined;
      if (!transferredCanvas && rawResponse) {
        const inlineTbl =
          extractFirstMarkdownTable(rawResponse) ?? extractFirstHtmlTable(rawResponse);
        if (inlineTbl && inlineTbl.rows.length > 0) {
          transferredCanvas = markdownTableToCanvasArtifact(inlineTbl, {
            title: normalizedIncoming?.title || safePrompt || "Tabla en Canvas",
            subtitle: normalizedIncoming?.subtitle,
            summary: normalizedIncoming?.summary,
          });
        }
      }
      const hasTabularTransferred = Boolean(
        transferredCanvas &&
          transferredCanvas.columns.length > 0 &&
          transferredCanvas.rows.length > 0
      );
      const cleanedResponse = cleanVisibleReply(rawResponse, { stripTables: hasTabularTransferred });
      const safeResponse =
        cleanedResponse ||
        (hasTabularTransferred && transferredCanvas
          ? `Listo, preparé "${transferredCanvas.title}" en Canvas (${transferredCanvas.rows.length} filas y ${transferredCanvas.columns.length} columnas).${transferredCanvas.summary ? `\n\n${transferredCanvas.summary}` : ""}`
          : transferredCanvas
            ? `Listo, preparé "${transferredCanvas.title}" en Canvas.${transferredCanvas.summary ? `\n\n${transferredCanvas.summary}` : ""}`
            : rawResponse || "Listo.");
      const assistantQbId = `msg_qb_a_${Date.now() + 1}`;
      const nextMessages: UiChatMessage[] = [
        ...chatMessagesRef.current,
        ...(safePrompt
          ? [{ id: `msg_qb_u_${Date.now()}`, role: "user" as const, content: safePrompt }]
          : []),
        {
          id: assistantQbId,
          role: "assistant" as const,
          content: safeResponse,
          canvas: transferredCanvas,
        },
      ];
      setChatMessages(nextMessages);
      if (transferredCanvas) {
        const withSource = { ...transferredCanvas, sourceMessageId: assistantQbId };
        setActiveCanvas(withSource);
        setShowCanvas(true);
      }
      void persistConversation(nextMessages);
      setXoxState("success");
      setXoxMessage(safeResponse);
      if (safePrompt) setStatusMessage(`Continuando desde Quick Bar: "${safePrompt}"`);
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 4500);
      setTimeout(() => setStatusMessage(null), 4500);
    } else if (prompt && autoRun) {
      runPromptQuery(prompt);
    } else if (prompt) {
      setInputPrompt(prompt);
    }
  };

  // Escuchar invocaciones desde la Quick Bar (⌘⇧X -> Abrir XOOK / ⌘↩) o desde la Barra de Menú
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const fn = await listen<MainSummonEventPayload>("main:summon", (event) => {
          mainSummonHandlerRef.current(event.payload);
        });
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        // Ignorar fuera de Tauri
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Estados "ocupados": el texto muestra el efecto shimmer gris con brillo blanco
  const xoxBusy =
    xoxState === "thinking" ||
    xoxState === "reading" ||
    xoxState === "coding" ||
    xoxState === "talking" ||
    xoxState === "syncing";

  // Saludo al hacer clic: única situación en la que aparece la burbuja de diálogo
  const handleXoxClick = () => {
    if (xoxState !== "idle" || greeting) return;
    const seq = ++greetingSeqRef.current;
    setXoxState("talking");
    setGreetingLeaving(false);
    const bubbleMessage = getXoxBubbleGreeting({
      agentName: effectiveAgentName,
      activeRole: globalXoxProfile.activeRole || workspaceOverview?.profile.activeRole,
      userName: localUser?.name,
      inActiveChat: chatMessages.length > 0,
      pendingTasksCount: tasks.length,
      lastMessage: lastBubbleMessageRef.current,
    });
    lastBubbleMessageRef.current = bubbleMessage;
    setGreeting(bubbleMessage);
    greetingTimers.current.forEach(clearTimeout);
    // Duración de habla proporcional a la frase, cerrando con una sonrisa breve mientras la burbuja se despide
    const talkMs = Math.min(3100, Math.max(2000, 1350 + bubbleMessage.length * 25));
    const leaveMs = Math.max(3500, talkMs + 550);
    greetingTimers.current = [
      setTimeout(() => {
        if (greetingSeqRef.current !== seq) return;
        setXoxState((s) => (s === "talking" ? "idle" : s));
      }, talkMs),
      setTimeout(() => {
        if (greetingSeqRef.current !== seq) return;
        setGreetingLeaving(true);
      }, leaveMs),
      setTimeout(() => {
        if (greetingSeqRef.current !== seq) return;
        setGreeting(null);
        setGreetingLeaving(false);
      }, leaveMs + 240),
    ];
  };

  // Añade o quita una fuente de contexto del mensaje (comportamiento de chip)
  const toggleContextInPrompt = (name: string) => {
    const tag = `@${name}`;
    setInputPrompt((prev) => {
      if (prev.includes(tag)) {
        return prev.split(tag).join("").replace(/\s{2,}/g, " ").trim();
      }
      return prev.trim() ? `${prev.trimEnd()} ${tag} ` : `${tag} `;
    });
    inputRef.current?.focus();
  };

  const pendingCount = tasks.length;

  // Estados de presencia animada para ventanas laterales y emergentes (entrada y salida)
  const leftPresence = useAnimatedPresence(showLeftSidebar, 290);
  const rightPresence = useAnimatedPresence(showRightSidebar, 290);
  const canvasPresence = useAnimatedPresence(showCanvas && Boolean(activeCanvas), 290);
  const studioPresence = useAnimatedPresence(showXoxStudio, 400);
  const docViewerPresence = useAnimatedPresence(
    showDocViewer && Boolean(pdfPanelState || pdfDraftProgress),
    290
  );

  // Calcula la coordenada destino exacta del santuario antes del primer paint para iniciar el vuelo físico
  useLayoutEffect(() => {
    if (!showXoxStudio || !studioPresence.mounted) return;
    const pending = pendingXoxFlightRef.current;
    if (!pending || pending.direction !== "to-studio") return;
    pendingXoxFlightRef.current = null;

    const innerEl = document.querySelector<HTMLElement>("[data-xox-studio-inner]");
    const starEl = document.querySelector<HTMLElement>('[data-xox-stage="studio"]');
    if (!innerEl || !starEl) {
      setXoxFlightPending(false);
      return;
    }

    const innerRect = innerEl.getBoundingClientRect();
    const starRect = starEl.getBoundingClientRect();
    const finalStudioRight = getStudioRightEdge();
    const finalInnerLeft = finalStudioRight - studioPanelWidth;
    const relX = starRect.left - innerRect.left;

    const to: XoxFlightPoint = {
      cx: finalInnerLeft + relX + starRect.width / 2,
      cy: starRect.top + starRect.height / 2,
      size: starRect.width,
    };

    xoxFlightIdRef.current += 1;
    setXoxFlightPending(false);
    setXoxFlight({
      id: xoxFlightIdRef.current,
      direction: "to-studio",
      from: pending.from,
      to,
    });
  }, [showXoxStudio, studioPresence.mounted, studioPanelWidth, showRightSidebar]);

  const handleOpenCanvas = (canvas: CanvasArtifact) => {
    setShowXoxStudio(false);
    setActiveCanvas(canvas);
    setShowCanvas(true);
  };

  const handleUpdateCanvas = (updated: CanvasArtifact) => {
    setActiveCanvas(updated);
    const nextMessages = chatMessagesRef.current.map((m) => {
      const hasMatch =
        m.id === updated.sourceMessageId ||
        m.canvas?.id === updated.id ||
        Boolean(m.canvases?.some((c) => c.id === updated.id));
      if (!hasMatch) return m;
      const nextCanvases = m.canvases?.map((c) => (c.id === updated.id ? updated : c));
      return {
        ...m,
        canvas: m.canvas?.id === updated.id || !m.canvas ? updated : m.canvas,
        ...(nextCanvases ? { canvases: nextCanvases } : {}),
      };
    });
    setChatMessages(nextMessages);
    void persistConversation(nextMessages);
  };

  const handleAskXoxAboutCanvas = (canvas: CanvasArtifact) => {
    setActiveCanvas(canvas);
    setShowCanvas(true);
    const noun =
      canvas.kind === "composite"
        ? "la vista compuesta"
        : canvas.kind === "interactive"
          ? "la interfaz interactiva"
          : canvas.kind === "custom_app"
            ? "la mini-app"
            : canvas.kind === "plan"
              ? "el plan"
              : canvas.kind === "diagram"
                ? "el diagrama"
                : canvas.kind === "dashboard"
                  ? "el dashboard"
                  : canvas.kind === "form"
                    ? canvas.form?.purpose === "study_quiz"
                      ? "el cuestionario"
                      : "el formulario"
                    : canvas.kind === "document"
                      ? "el documento"
                      : "la tabla";
    setInputPrompt((prev) =>
      prev.trim() ? prev : `Sobre ${noun} "${canvas.title}": `
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCanvasAction = (action: CanvasActionPayload) => {
    if (action.type === "ask_edit") {
      handleAskXoxAboutCanvas(action.canvas);
      return;
    }

    if (action.type === "dashboard_ask_item") {
      const detailHint = action.detail ? ` (${action.detail})` : "";
      void runPromptQuery(
        `Sobre "${action.label}" en el dashboard "${action.canvas.title}"${detailHint}: analiza qué está ocurriendo y qué decisión recomiendas.`
      );
      return;
    }

    if (action.type === "diagram_ask_node") {
      const n = action.node;
      const detailHint = n.detail ? ` (Contexto: ${n.detail})` : "";
      void runPromptQuery(
        `Sobre "${n.label}" en "${action.canvas.title}"${detailHint}: explícamelo con claridad y qué decisiones o pasos implica.`
      );
      return;
    }

    if (action.type === "plan_approve" && action.canvas.plan) {
      handleUpdateCanvas(action.canvas);
      const p = action.canvas.plan;
      const approvedSteps = p.phases.flatMap((ph) =>
        ph.steps
          .filter((st) => st.checked)
          .map((st) => ({
            phase: ph.title,
            step: st,
          }))
      );
      const skippedSteps = p.phases.flatMap((ph) =>
        ph.steps.filter((st) => !st.checked).map((st) => st.title)
      );
      const notes: string[] = [];
      if (p.reviewComment?.trim()) notes.push(`Nota general: ${p.reviewComment.trim()}`);
      p.phases.forEach((ph) => {
        if (ph.comment?.trim()) notes.push(`Fase "${ph.title}": ${ph.comment.trim()}`);
        ph.steps.forEach((st) => {
          if (st.comment?.trim()) notes.push(`Paso "${st.title}": ${st.comment.trim()}`);
        });
      });

      setActiveChecklist({
        id: `chk_plan_${Date.now()}`,
        title: action.canvas.title,
        mode: "plan",
        items: approvedSteps.slice(0, 15).map(({ step }) => ({
          id: step.id,
          label: step.title,
          status: step.status === "done" ? "done" : "pending",
        })),
        updatedAt: Date.now(),
      });

      if (activeMode === "plan") {
        setActiveMode(null);
      }

      const stepsText = approvedSteps
        .map(({ phase, step }, idx) => `${idx + 1}. [${phase}] ${step.title}${step.target ? ` (${step.target})` : ""}`)
        .join("\n");
      const skippedText = skippedSteps.length > 0 ? `\n\nPasos omitidos por el usuario:\n- ${skippedSteps.join("\n- ")}` : "";
      const notesText = notes.length > 0 ? `\n\nNotas adicionales:\n- ${notes.join("\n- ")}` : "";

      void runPromptQuery(
        `Apruebo el plan "${action.canvas.title}". Procede a ejecutar los pasos seleccionados y ve actualizando el progreso en la checklist:\n${stepsText}${skippedText}${notesText}`,
        undefined,
        { overrideMode: null }
      );
      return;
    }

    if (action.type === "plan_request_changes" && action.canvas.plan) {
      handleUpdateCanvas(action.canvas);
      const p = action.canvas.plan;
      const feedbackLines: string[] = [];
      if (p.reviewComment?.trim()) {
        feedbackLines.push(`Nota general: ${p.reviewComment.trim()}`);
      }
      p.phases.forEach((ph) => {
        if (ph.comment?.trim()) {
          feedbackLines.push(`En fase "${ph.title}": ${ph.comment.trim()}`);
        }
        ph.steps.forEach((st) => {
          if (!st.checked) {
            feedbackLines.push(`Quitar u omitir paso: "${st.title}"`);
          }
          if (st.comment?.trim()) {
            feedbackLines.push(`En paso "${st.title}": ${st.comment.trim()}`);
          }
        });
      });
      const body =
        feedbackLines.length > 0
          ? feedbackLines.join("\n- ")
          : "Reorganiza el plan haciéndolo más claro y específico.";
      void runPromptQuery(
        `Ajusta el plan "${action.canvas.title}" en Canvas (manteniendo su id "${action.canvas.id}" con \`create_plan\`) tomando en cuenta estas observaciones:\n- ${body}`,
        undefined,
        { overrideMode: "plan" }
      );
      return;
    }

    if (action.type === "form_submit" && action.canvas.form) {
      handleUpdateCanvas(action.canvas);
      const f = action.canvas.form;
      const isQuiz = f.purpose === "study_quiz";
      const score = isQuiz ? (f.score ?? gradeStudyForm(f)) : undefined;

      const lines = f.fields.map((field, idx) => {
        const val = f.answers?.[field.id];
        const answerDisplay = formatFormAnswerForDisplay(field, val);
        if (!isQuiz) {
          return `${idx + 1}. ${field.label}: ${answerDisplay}`;
        }
        let statusTag = "";
        const outcome = evaluateFormFieldState(field, val);
        if (outcome === "open") {
          statusTag = " [PREGUNTA ABIERTA — evaluar respuesta]";
        } else if (outcome === "correct") {
          statusTag = " [CORRECTA]";
        } else if (field.type === "multi_choice" && Array.isArray(field.correctIndices) && field.options) {
          const expectedText = field.correctIndices
            .map((i) => field.options![i])
            .filter(Boolean)
            .join(", ");
          statusTag = ` [INCORRECTA — esperadas: "${expectedText}"]`;
        } else if (typeof field.correctIndex === "number" && field.options?.[field.correctIndex] !== undefined) {
          statusTag = ` [INCORRECTA — esperada: "${field.options[field.correctIndex]}"]`;
        } else if (field.expectedAnswer) {
          statusTag = ` [INCORRECTA — esperado: "${field.expectedAnswer}"]`;
        } else {
          statusTag = " [INCORRECTA]";
        }
        return `${idx + 1}. ${field.label}\n   Respuesta del usuario: ${answerDisplay}${statusTag}`;
      });

      if (isQuiz) {
        const scoreLine =
          score && score.gradableCount > 0
            ? `Puntaje automático en preguntas cerradas: ${score.correctCount}/${score.gradableCount} (${score.earned}/${score.total} pts · ${score.percent}%).\n`
            : "";
        void runPromptQuery(
          `Envío mis respuestas del cuestionario "${action.canvas.title}":\n${scoreLine}\n${lines.join("\n")}\n\nPor favor evalúa mis respuestas abiertas si las hay, explícame brevemente cualquier error de forma clara y dime qué tema conviene reforzar.`
        );
      } else {
        void runPromptQuery(
          `Envío el formulario "${action.canvas.title}" con los siguientes datos:\n\n${lines.join("\n")}\n\nConfirma la recepción y continúa con el análisis o siguiente paso usando esta información.`
        );
      }
      return;
    }

    if (action.type === "interactive_submit") {
      handleUpdateCanvas(action.canvas);
      const fallback = `Desde la interfaz interactiva "${action.canvas.title}" se activó "${action.actionLabel ?? "Enviar escenario"}".`;
      void runPromptQuery(action.prompt || fallback);
      return;
    }

    if (action.type === "custom_app_message") {
      handleUpdateCanvas(action.canvas);
      const extraPayload =
        action.payload !== undefined
          ? `\n\nDatos adjuntos:\n\`\`\`json\n${JSON.stringify(action.payload, null, 2)}\n\`\`\``
          : "";
      void runPromptQuery(
        `Desde la mini-app "${action.canvas.title}": ${action.prompt}${extraPayload}`
      );
    }
  };

  const openPdfInRightPanel = async (
    meta: {
      path: string;
      title?: string;
      filename?: string;
      pageCount?: number;
      sizeBytes?: number;
      hasCover?: boolean;
      theme?: string;
      revision?: number;
      previewPages?: Array<{ page: number; width: number; height: number; dataUrl: string }>;
      previewHasMore?: boolean;
    },
    initialMode: "view" | "edit_blocks" | "edit_page" = "view"
  ) => {
    const reqId = (pdfPreviewReqRef.current += 1);
    const freshRev = meta.revision ?? Date.now();
    setPdfDraftProgress(null);
    setShowDocViewer(true);

    const cleanTitle = meta.title || meta.filename || meta.path.split("/").pop() || "Documento PDF";
    if (meta.previewPages && meta.previewPages.length > 0) {
      upsertDocTab({
        path: meta.path,
        filename: meta.filename || meta.path.split("/").pop(),
        title: cleanTitle,
        pageCount: meta.pageCount ?? meta.previewPages.length,
        sizeBytes: meta.sizeBytes,
        hasCover: meta.hasCover,
        theme: meta.theme,
        pages: meta.previewPages,
        hasMore: Boolean(meta.previewHasMore),
        isLoadingPages: false,
        fileKind: "pdf",
        initialMode,
        revision: freshRev,
      });
      return;
    }

    const existingTab = openDocTabs.find((t) => t.path === meta.path);
    upsertDocTab({
      path: meta.path,
      filename: meta.filename || meta.path.split("/").pop(),
      title: cleanTitle,
      pageCount: meta.pageCount ?? existingTab?.pageCount,
      sizeBytes: meta.sizeBytes ?? existingTab?.sizeBytes,
      hasCover: meta.hasCover ?? existingTab?.hasCover,
      theme: meta.theme ?? existingTab?.theme,
      pages: [],
      hasMore: false,
      isLoadingPages: true,
      fileKind: "pdf",
      initialMode,
      revision: freshRev,
    });

    if (!isTauriEnv) return;
    try {
      const res = await renderPdfPreview(meta.path, { startPage: 1, maxPages: 8 });
      if (reqId !== pdfPreviewReqRef.current) return;
      if (res && res.ok && res.pages.length > 0) {
        patchDocTab(meta.path, (curr) => ({
          ...curr,
          pageCount: res.pageCount,
          pages: res.pages,
          hasMore: res.hasMore,
          isLoadingPages: false,
          error: null,
          revision: freshRev,
        }));
      } else {
        patchDocTab(meta.path, (curr) => ({
          ...curr,
          isLoadingPages: false,
          error: res?.error || "No se pudo generar la vista previa de páginas.",
        }));
      }
    } catch (err) {
      if (reqId !== pdfPreviewReqRef.current) return;
      patchDocTab(meta.path, (curr) => ({
        ...curr,
        isLoadingPages: false,
        error: extractErrorMessage(err, "No se pudo renderizar la vista previa del PDF."),
      }));
    }
  };

  const openUniversalDocInRightPanel = async (opts: {
    path: string;
    filename: string;
    sizeBytes?: number;
    ext?: string;
    textContent?: string;
    editMode?: boolean;
  }) => {
    const ext = (opts.ext || opts.path.split(".").pop() || "").toLowerCase();
    const isSpreadsheetText = ext === "csv" || ext === "tsv";
    const freshRev = Date.now();
    setPdfDraftProgress(null);
    upsertDocTab({
      path: opts.path,
      filename: opts.filename,
      title: opts.filename,
      sizeBytes: opts.sizeBytes,
      pages: [],
      isLoadingPages: true,
      fileKind: isSpreadsheetText ? "text" : "office",
      fileExtension: ext,
      textContent: opts.textContent,
      initialMode: opts.editMode ? "edit_page" : "view",
      revision: freshRev,
    });
    setShowDocViewer(true);

    try {
      const doc = await readUniversalDocument(opts.path);
      patchDocTab(opts.path, (curr) => ({
        ...curr,
        title: doc?.title || opts.filename,
        sizeBytes: doc?.sizeBytes ?? opts.sizeBytes,
        isLoadingPages: false,
        universalDoc: doc ?? null,
        textContent: opts.textContent ?? doc?.markdown ?? doc?.text ?? "",
        revision: freshRev,
        error: doc && doc.ok === false ? doc.error || "No se pudo leer el archivo." : null,
      }));
    } catch (err) {
      patchDocTab(opts.path, (curr) => ({
        ...curr,
        isLoadingPages: false,
        error: extractErrorMessage(err, "No se pudo abrir el documento en el visor."),
      }));
    }
  };

  const openGeneratedOfficeDocInRightPanel = async (
    doc: GeneratedOfficeDocumentEvent
  ) => {
    const ext = (
      doc.format ||
      doc.filename.split(".").pop() ||
      doc.path.split(".").pop() ||
      "docx"
    )
      .toLowerCase()
      .replace(/^\./, "");
    const cleanFilename = doc.filename || doc.path.split("/").pop() || `documento.${ext}`;
    const cleanTitle = doc.title || cleanFilename;
    const normalizedUniDoc = normalizeUniversalDocFromEvent(doc.universal_doc, {
      path: doc.path,
      filename: cleanFilename,
      title: cleanTitle,
      format: ext,
      sizeBytes: doc.size_bytes,
      pageCount: doc.page_count,
    });

    if (normalizedUniDoc) {
      const freshRev = doc.revision || Date.now();
      setPdfDraftProgress(null);
      upsertDocTab({
        path: doc.path,
        filename: cleanFilename,
        title: normalizedUniDoc.title || cleanTitle,
        sizeBytes: doc.size_bytes ?? normalizedUniDoc.sizeBytes,
        pageCount: doc.page_count ?? normalizedUniDoc.pageCount,
        pages: [],
        isLoadingPages: false,
        fileKind: "office",
        fileExtension: ext,
        universalDoc: normalizedUniDoc,
        textContent: normalizedUniDoc.markdown || normalizedUniDoc.text || "",
        initialMode: "view",
        revision: freshRev,
      });
      setShowDocViewer(true);
      return;
    }

    await openUniversalDocInRightPanel({
      path: doc.path,
      filename: cleanFilename,
      sizeBytes: doc.size_bytes,
      ext,
    });
  };

  const handleOpenWorkspaceFileInViewer = (
    file: SelectedWorkspaceFile,
    editMode = false
  ) => {
    const ext = file.relativePath.split(".").pop()?.toLowerCase() || "txt";
    if (file.kind === "pdf") {
      void openPdfInRightPanel(
        {
          path: file.relativePath,
          title: file.pdfSummary?.title || file.name,
          filename: file.name,
          pageCount: file.pdfSummary?.page_count,
          sizeBytes: file.sizeBytes,
        },
        editMode ? "edit_page" : "view"
      );
      return;
    }
    if (file.kind === "office" || OFFICE_DOC_EXT_SET.has(ext) || ext === "csv" || ext === "tsv") {
      void openUniversalDocInRightPanel({
        path: file.relativePath,
        filename: file.name,
        sizeBytes: file.sizeBytes,
        ext,
        textContent: file.content || undefined,
        editMode,
      });
      return;
    }
    if (file.kind === "image" && file.dataUrl) {
      setPdfDraftProgress(null);
      upsertDocTab({
        path: file.relativePath,
        filename: file.name,
        title: file.name,
        sizeBytes: file.sizeBytes,
        pages: [],
        isLoadingPages: false,
        fileKind: "image",
        fileExtension: ext,
        imageDataUrl: file.dataUrl,
        initialMode: "view",
        revision: Date.now(),
      });
      setShowDocViewer(true);
      return;
    }
    setPdfDraftProgress(null);
    upsertDocTab({
      path: file.relativePath,
      filename: file.name,
      title: file.name,
      sizeBytes: file.sizeBytes,
      pages: [],
      isLoadingPages: false,
      fileKind: "text",
      textContent: file.content,
      fileExtension: ext,
      initialMode: editMode ? "edit_page" : "view",
      revision: Date.now(),
    });
    setShowDocViewer(true);
  };

  const handleDownloadPdfFromChat = async (pdf: GeneratedPdfArtifact) => {
    try {
      const res = await downloadWorkspaceFile(pdf.path, pdf.filename || `${pdf.title}.pdf`);
      if (res?.ok) {
        setStatusMessage(`Descargado en Descargas: ${res.filename}`);
        setTimeout(() => setStatusMessage(null), 4200);
      }
    } catch (err) {
      setStatusMessage(extractErrorMessage(err, "No se pudo descargar el PDF."));
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleExportTextDocumentToPdf = async (title: string, markdownContent: string) => {
    if (!isTauriEnv) return;
    const rawRes = await exportCanvasToPdf({
      title,
      markdown: markdownContent,
      theme: "executive",
    });
    const pdfArtifact = sanitizeGeneratedPdfArtifact(rawRes);
    if (pdfArtifact) {
      setStatusMessage(`PDF generado: ${pdfArtifact.filename}`);
      setTimeout(() => setStatusMessage(null), 4000);
      void handleRefreshWorkspace();
      void openPdfInRightPanel(pdfArtifact);
    }
  };

  const handleLoadMorePdfPages = async (relativePath?: string, nextStartPage?: number) => {
    const snap = relativePath
      ? openDocTabs.find((t) => t.path === relativePath) ?? pdfPanelState
      : pdfPanelState;
    const targetPath = relativePath || snap?.path;
    if (!snap || !targetPath || snap.isLoadingPages || !isTauriEnv) {
      return;
    }
    const reqId = pdfPreviewReqRef.current;
    const nextStart = nextStartPage ?? snap.pages.length + 1;
    patchDocTab(targetPath, (curr) => ({ ...curr, isLoadingPages: true }));
    try {
      const res = await renderPdfPreview(targetPath, { startPage: nextStart, maxPages: 8 });
      if (reqId !== pdfPreviewReqRef.current) return;
      if (res && res.ok) {
        patchDocTab(targetPath, (curr) => {
          const seen = new Set(curr.pages.map((p) => p.page));
          const merged = [...curr.pages, ...res.pages.filter((p) => !seen.has(p.page))];
          return {
            ...curr,
            pages: merged,
            pageCount: res.pageCount,
            hasMore: res.hasMore,
            isLoadingPages: false,
          };
        });
      } else {
        patchDocTab(targetPath, (curr) => ({ ...curr, isLoadingPages: false }));
      }
    } catch {
      patchDocTab(targetPath, (curr) => ({ ...curr, isLoadingPages: false }));
    }
  };

  const handlePdfDraftProgress = (draft: PdfDraftProgressEvent, turnId: string) => {
    // Nunca cancelar una vista previa ya abierta en este mismo turno ni re-pisar el PDF final
    if (!turnOpenedPdfRevRef.current[turnId]) {
      pdfPreviewReqRef.current += 1;
    }
    if (rightPanelAutoOpenedTurnRef.current !== turnId) {
      rightPanelAutoOpenedTurnRef.current = turnId;
      setShowDocViewer(true);
    }
    setPdfDraftProgress(draft);
  };

  const handleExportCanvasPdf = async (canvas: CanvasArtifact) => {
    if (!isTauriEnv) return;
    const reqId = (pdfPreviewReqRef.current += 1);
    setShowDocViewer(true);
    const canvasPreviewBlocks: PdfDraftProgressEvent["blocks"] = [];
    if (canvas.summary?.trim()) {
      canvasPreviewBlocks.push({
        type: "callout",
        title: "Resumen ejecutivo",
        text: canvas.summary.trim(),
      });
    }
    if (canvas.plan) {
      canvasPreviewBlocks.push({
        type: "callout",
        title: `Plan (${canvas.plan.phases.length} fases)`,
        text: canvas.plan.goal,
      });
    } else if (canvas.dashboard) {
      canvasPreviewBlocks.push({
        type: "callout",
        title: `Dashboard (${canvas.dashboard.kpis.length} KPIs · ${canvas.dashboard.charts.length} gráficas)`,
        text:
          canvas.dashboard.kpis
            .slice(0, 3)
            .map((k) => `${k.label}: ${k.value}`)
            .join(" | ") || canvas.title,
      });
    } else if (canvas.diagram) {
      canvasPreviewBlocks.push({
        type: "paragraph",
        text: `Diagrama visual con ${canvas.diagram.nodes.length} nodos y ${canvas.diagram.edges.length} conexiones.`,
      });
    } else if (canvas.columns.length > 0 && canvas.rows.length > 0) {
      canvasPreviewBlocks.push({
        type: "table",
        columns: canvas.columns.map((c) => c.label),
        rows: canvas.rows.slice(0, 6).map((r) => canvas.columns.map((c) => r.cells[c.id] ?? "")),
      });
    } else if (canvas.markdown?.trim()) {
      canvasPreviewBlocks.push({ type: "paragraph", text: canvas.markdown.trim().slice(0, 240) });
    }
    setPdfDraftProgress({
      stage: "rendering_pdf",
      stepLabel: "Compilando Canvas en páginas PDF...",
      progress: 0.45,
      title: canvas.title || "Canvas",
      subtitle: canvas.subtitle,
      theme: "executive",
      hasCover: false,
      cover: null,
      totalBlocks: canvasPreviewBlocks.length,
      completedBlocks: 1,
      blocks: canvasPreviewBlocks,
    });

    setXoxState("syncing");
    setThinkingLabel("Generando PDF...");
    setXoxMessage("Generando documento PDF...");
    try {
      const rawRes = await exportCanvasToPdf(buildPdfSpecFromCanvas(canvas));
      const pdfArtifact = sanitizeGeneratedPdfArtifact(rawRes);
      setPdfDraftProgress(null);
      if (pdfArtifact) {
        const targetMsgId = canvas.sourceMessageId;
        const hasSourceMsg = Boolean(
          targetMsgId && chatMessagesRef.current.some((m) => m.id === targetMsgId)
        );
        const nextMessages: UiChatMessage[] = hasSourceMsg
          ? chatMessagesRef.current.map((m) => {
              if (m.id !== targetMsgId) return m;
              const prevList = m.generatedPdfs ?? [];
              const merged = prevList.some((p) => p.path === pdfArtifact.path)
                ? prevList.map((p) => (p.path === pdfArtifact.path ? pdfArtifact : p))
                : [...prevList, pdfArtifact];
              return { ...m, generatedPdfs: merged };
            })
          : [
              ...chatMessagesRef.current,
              {
                id: `msg_pdf_${Date.now()}`,
                role: "assistant",
                content: `Exporté **${pdfArtifact.title}** a PDF en \`${pdfArtifact.path}\`.`,
                generatedPdfs: [pdfArtifact],
              },
            ];
        setChatMessages(nextMessages);
        void persistConversation(nextMessages);
        setStatusMessage(`PDF listo: ${pdfArtifact.path}`);
        setTimeout(() => setStatusMessage(null), 4500);
        if (reqId === pdfPreviewReqRef.current) {
          void openPdfInRightPanel(pdfArtifact);
        }
      }
      void handleRefreshWorkspace();
      setXoxState("success");
      setXoxMessage("PDF generado correctamente.");
      setTimeout(() => {
        setXoxState((s) => (s === "success" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 2800);
    } catch (err) {
      setPdfDraftProgress(null);
      setXoxState("alert");
      const msg = extractErrorMessage(err, "No se pudo exportar el PDF.");
      if (reqId === pdfPreviewReqRef.current && pdfPanelState?.path) {
        patchDocTab(pdfPanelState.path, (curr) => ({
          ...curr,
          error: msg,
          isLoadingPages: false,
        }));
      }
      setStatusMessage(msg);
      setTimeout(() => setStatusMessage(null), 4500);
      setTimeout(() => {
        setXoxState((s) => (s === "alert" ? "idle" : s));
        setXoxMessage("¿En qué puedo ayudarte?");
      }, 3000);
    }
  };

  const statusToastPresence = useAnimatedPresence(Boolean(statusMessage), 190);
  const lastStatusRef = useRef<string | null>(statusMessage);
  if (statusMessage) lastStatusRef.current = statusMessage;
  const displayStatusMessage = statusMessage ?? lastStatusRef.current;

  const learningToastPresence = useAnimatedPresence(Boolean(learningToast), 190);
  const lastLearningToastRef = useRef<MemoryPattern | null>(learningToast);
  if (learningToast) lastLearningToastRef.current = learningToast;
  const displayLearningToast = learningToast ?? lastLearningToastRef.current;

  const isXoxStatusOpen = xoxState !== "idle" && !greeting;
  const xoxStatusPresence = useAnimatedPresence(isXoxStatusOpen, 190);
  const lastXoxStatusRef = useRef({ state: xoxState, message: xoxMessage, busy: xoxBusy });
  if (isXoxStatusOpen) {
    lastXoxStatusRef.current = { state: xoxState, message: xoxMessage, busy: xoxBusy };
  }
  const displayXoxStatus = isXoxStatusOpen
    ? { state: xoxState, message: xoxMessage, busy: xoxBusy }
    : lastXoxStatusRef.current;

  const modelMenuPresence = useAnimatedPresence(showModelMenu, 150);
  const contextMenuPresence = useAnimatedPresence(showContextMenu, 150);
  const commandMenuPresence = useAnimatedPresence(showCommandMenu, 150);
  const activeContextCount = contextItems.filter((item) => inputPrompt.includes(`@${item.name}`)).length;

  const filteredCommands = useMemo(() => {
    const cleanFilter = commandMenuFilter.replace(/^\//, "").trim().toLowerCase();
    if (!cleanFilter) return XOX_COMMAND_LIST;
    return XOX_COMMAND_LIST.filter(
      (cmd) =>
        cmd.slash.toLowerCase().includes(cleanFilter) ||
        cmd.id.toLowerCase().includes(cleanFilter) ||
        cmd.name.toLowerCase().includes(cleanFilter) ||
        cmd.description.toLowerCase().includes(cleanFilter)
    );
  }, [commandMenuFilter]);

  return (
    <div className="h-screen w-screen bg-[#060709] text-zinc-100 flex flex-col font-sans select-none overflow-hidden antialiased">
      
      {/* 1. Header Minimalista & Stealth integrado en la barra superior de ventana */}
      <header
        data-tauri-drag-region="deep"
        className={`h-12 min-h-12 border-b border-white/[0.06] bg-[#090a0f]/80 backdrop-blur-xl pr-2.5 sm:pr-4 flex items-center justify-between gap-1.5 sm:gap-2 shrink-0 z-20 ${
          hasMacOverlayChrome && !isWindowFullscreen ? "pl-[84px] sm:pl-[88px]" : "pl-3 sm:pl-4"
        }`}
      >
        
        {/* Toggle de Contexto Izquierdo */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={() => {
              const next = !showLeftSidebar;
              if (next && isCompactViewport) {
                if (showRightSidebar) setShowRightSidebar(false);
                if (showXoxStudio) closeXoxStudio();
                if (showCanvas) setShowCanvas(false);
                if (showDocViewer) closeAllDocTabs();
              }
              setShowLeftSidebar(next);
            }}
            aria-pressed={showLeftSidebar}
            aria-label={showLeftSidebar ? "Ocultar panel de contexto" : "Mostrar panel de contexto"}
            title={showLeftSidebar ? "Ocultar panel de contexto" : "Mostrar panel de contexto"}
            className={`shrink-0 min-w-[28px] min-h-[28px] p-1.5 rounded-lg border border-transparent transition-colors cursor-pointer flex items-center justify-center ${
              showLeftSidebar
                ? "bg-white/[0.045] text-zinc-100 hover:bg-white/[0.07]"
                : "bg-transparent text-zinc-400/85 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          >
            <PanelLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          {isEffectiveSplitLayout && assistStatus.companion?.appName && (
            <span
              data-tauri-drag-region="deep"
              className="hidden min-[440px]:inline text-[11px] text-zinc-500 truncate select-none"
            >
              {assistStatus.companion.appName}
            </span>
          )}
        </div>

        {/* Lado Derecho: Modo Asistencia + Espacio de Xox + Toggle de Canvas + Tareas y Decisiones */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {(isTauriEnv || isWorkspaceTauriRuntime()) && (
            <AssistDockMenu
              status={assistStatus}
              viewportWidth={viewportWidth}
              companions={companionWindows}
              loadingCompanions={loadingCompanions}
              busy={assistBusy}
              onRefreshCompanions={() => void refreshCompanionWindows()}
              onApplyLayout={handleApplyAssistLayout}
              onRebalanceSplit={handleRebalanceAssistSplit}
              onToggleAlwaysOnTop={handleToggleAssistPin}
              onExitAssist={handleExitAssist}
              onRequestAccessibility={handleRequestAccessibility}
              onOpenAccessibilitySettings={handleOpenAccessibilitySettings}
            />
          )}

          <button
            type="button"
            onClick={() => {
              if (showXoxStudio) {
                closeXoxStudio();
              } else {
                if (isCompactViewport) {
                  setShowLeftSidebar(false);
                  setShowRightSidebar(false);
                }
                openXoxStudio("identity");
              }
            }}
            aria-pressed={showXoxStudio}
            aria-label={`Espacio de ${effectiveAgentName}`}
            title={`Abrir Espacio de ${effectiveAgentName} (nombre, voz, skills, prompt global)`}
            className={`shrink-0 min-h-[28px] px-2 sm:px-2.5 py-1.5 rounded-lg border border-transparent flex items-center gap-1.5 transition-colors cursor-pointer ${
              showXoxStudio
                ? "bg-white/[0.045] text-zinc-100 hover:bg-white/[0.07]"
                : "bg-transparent text-zinc-400/90 hover:text-zinc-100 hover:bg-white/[0.04]"
            }`}
          >
            <XoxSilhouetteIcon
              aria-hidden="true"
              className="w-4 h-4 shrink-0 transition-colors duration-500"
              style={{
                color:
                  displayAccentPreset === "classic"
                    ? "#F4F4F5"
                    : XOX_ACCENT_PRESETS[displayAccentPreset].rim,
              }}
            />
            <span className="text-[11px] font-medium hidden sm:inline max-w-[140px] truncate">
              {effectiveAgentName}
            </span>
          </button>

          {showCanvas && activeCanvas && (
            <button
              type="button"
              onClick={() => setShowCanvas(false)}
              aria-pressed={showCanvas}
              aria-label="Ocultar Canvas"
              title="Ocultar Canvas"
              className="shrink-0 min-h-[28px] px-2 sm:px-2.5 py-1.5 rounded-lg border border-transparent bg-white/[0.045] text-zinc-100 hover:bg-white/[0.07] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Table2 className="w-3.5 h-3.5 text-zinc-200" aria-hidden="true" />
              <span className="text-[11px] font-medium hidden sm:inline max-w-[120px] truncate">
                Canvas
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const next = !showRightSidebar;
              if (next && isCompactViewport) {
                if (showLeftSidebar) setShowLeftSidebar(false);
                if (showXoxStudio) closeXoxStudio();
                if (showCanvas) setShowCanvas(false);
                if (showDocViewer) closeAllDocTabs();
              }
              setShowRightSidebar(next);
            }}
            aria-pressed={showRightSidebar}
            aria-label={`Tareas (${pendingCount} pendientes)`}
            title={
              showRightSidebar
                ? "Ocultar panel de tareas"
                : "Mostrar panel de tareas"
            }
            className={`shrink-0 min-h-[28px] px-2 py-1.5 rounded-lg border border-transparent flex items-center gap-1.5 transition-colors cursor-pointer ${
              showRightSidebar
                ? "bg-white/[0.045] text-zinc-100 hover:bg-white/[0.07]"
                : "bg-transparent text-zinc-400/85 hover:text-zinc-200 hover:bg-white/[0.04]"
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="text-[11px] font-medium hidden sm:inline">Tareas</span>
            {pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 pl-1.5 ml-0.5 border-l border-white/[0.08] text-[11px] font-mono tabular-nums text-zinc-200">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {pendingCount}
              </span>
            ) : (
              <span className="pl-1.5 ml-0.5 border-l border-white/[0.08] text-[11px] font-mono tabular-nums text-zinc-500">
                0
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 2. Cuerpo Principal en 3 Columnas: [Contexto Izq] | [Xox Centro] | [Tareas Der] */}
      <div data-xox-main-row className="relative flex-1 min-h-0 flex overflow-hidden">
        {hasCompactOverlayOpen && (
          <div
            aria-hidden="true"
            onClick={closeAllCompactOverlays}
            className="xook-compact-drawer-backdrop"
          />
        )}
        
        {/* ========================================================================= */}
        {/* COLUMNA 1: CONTEXTO DEL LADO IZQUIERDO                                    */}
        {/* ========================================================================= */}
        {leftPresence.mounted && (
          <>
            <div
              role={isCompactViewport ? "dialog" : undefined}
              aria-modal={isCompactViewport && showLeftSidebar ? true : undefined}
              aria-label={isCompactViewport ? "Panel de contexto y chats" : undefined}
              aria-hidden={!showLeftSidebar}
              inert={!showLeftSidebar}
              style={{ width: leftPresence.visible ? `${effectiveLeftWidth}px` : "0px" }}
              className={`sidebar-slot flex justify-end shrink-0 overflow-hidden ${
                isCompactViewport ? "xook-compact-drawer-surface is-left" : ""
              } ${
                isResizingLeft ? "is-resizing" : ""
              } ${leftPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <aside
                style={{ width: `${effectiveLeftWidth}px` }}
                className="h-full bg-[#07080b] flex flex-col shrink-0 overflow-hidden select-none"
              >
              
              {/* Cabecera del Panel Lateral: identidad XOOK (los chats van primero; el proyecto se abre aparte) */}
              <div className="xook-sidebar-header-shell w-full px-2.5 py-2 border-b border-white/[0.06] bg-[#090a0e] shrink-0">
                <div className="xook-sidebar-header-inner">
                  <div className="flex items-center-safe gap-2 shrink-0 min-w-0">
                    <XoxHeaderFace
                      state={xoxState}
                      onClick={handleXoxClick}
                      agentName={effectiveAgentName}
                      accentPreset={displayAccentPreset}
                    />
                    <XookWordmark className="block h-3.5 w-auto shrink-0 text-zinc-100" />
                  </div>
                </div>
              </div>

              {leftTab === "context" ? (
                <div
                  id="xook-sidebar-panel-context"
                  aria-label="Ajustes del proyecto"
                  className="flex-1 flex flex-col min-h-0 overflow-hidden"
                >
                  <div className="px-2.5 pt-2.5 pb-1 flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setLeftTab("chats")}
                      className="h-8 inline-flex items-center gap-1 pl-1.5 pr-2.5 rounded-lg text-[12px] text-zinc-300 hover:text-white hover:bg-white/[0.06] cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                      Chats
                    </button>
                    <span className="text-[12px] font-medium text-zinc-400 truncate">Ajustes del proyecto</span>
                  </div>

              {/* Árbol Real del Espacio de Trabajo + Inspector/Editor */}
              <WorkspaceTreePanel
                isTauriEnv={isTauriEnv}
                overview={workspaceOverview}
                selectedPath={selectedWorkspaceFile?.relativePath ?? null}
                pinnedPaths={pinnedWorkspacePaths}
                highlightedPath={highlightedWorkspacePath}
                isLoading={workspaceLoading}
                onSelectFile={handleSelectWorkspaceFile}
                onTogglePinFile={handleTogglePinWorkspaceFile}
                onRefresh={handleRefreshWorkspace}
                onOpenFinder={(rel) => void openWorkspaceFolder(rel)}
                onOpenFile={(rel) => void openWorkspaceFile(rel)}
                onPreviewPdf={(file) =>
                  void openPdfInRightPanel({
                    path: file.relativePath,
                    title: file.pdfSummary?.title || file.name,
                    filename: file.name,
                    pageCount: file.pdfSummary?.page_count,
                    sizeBytes: file.sizeBytes,
                  })
                }
                onOpenInDocumentViewer={(file, editMode) =>
                  handleOpenWorkspaceFileInViewer(file, editMode)
                }
                onAskXoxAnalyzeFile={handleAskXoxAnalyzeFile}
                onCreateFolder={handleCreateWorkspaceFolder}
                onCreateWorkspace={handleCreateNewWorkspace}
                onSwitchWorkspace={handleSwitchActiveWorkspace}
                onRenameWorkspace={handleRenameActiveWorkspace}
                selectedFile={selectedWorkspaceFile}
                onSaveFileContent={handleSaveWorkspaceFile}
                globalAgentName={effectiveAgentName}
                onOpenXoxStudio={(tab) => openXoxStudio(tab ?? "identity")}
                onStatusNotice={(msg) => {
                  setStatusMessage(msg);
                  setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 4000);
                }}
              />
                </div>
              ) : (
                <SidebarChats
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  isStreaming={isChatStreaming}
                  projectName={workspaceOverview?.active.name ?? null}
                  showLongConversationNotice={
                    !isDocumentWindowFocused && chatMessages.length > 0 && contextUsagePct >= 65
                  }
                  isCompacting={isCompactingContext}
                  onNewChat={handleStartNewChat}
                  onSelectConversation={handleSelectConversation}
                  onDeleteConversation={(id) => void handleDeleteConversation(id)}
                  onOpenProject={() => setLeftTab("context")}
                  onCompact={() => void handleRunManualCompact()}
                />
              )}

              {/* Pie del Panel Lateral */}
              <SidebarFooter
                userName={localUser?.name ?? null}
                usageLabel={sidebarUsageLabel}
                usageDetail={sidebarUsageDetail}
                voiceEnabled={Boolean(ttsStatus?.config.enabled)}
                settingsOpen={showSettingsModal}
                onOpenProfile={() => setShowLocalAuth(true)}
                onOpenUsage={() => openAiSettings(hasAnyConfiguredKey ? "models" : "account")}
                onOpenVoice={() => openSettings("voice")}
                onOpenSettings={() => openSettings("voice")}
              />
              </aside>
            </div>

            {/* Separador redimensionable izquierdo (Splitter Aurora de Vidrio) */}
            {!isCompactViewport && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingLeft(true);
                }}
                onDoubleClick={() => setLeftWidth(280)}
                style={!leftPresence.visible ? { width: "0px" } : undefined}
                className={`splitter-aurora-glass ${isResizingLeft ? "is-resizing" : ""} ${
                  leftPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                {/* Zona de captura ampliada invisible para fácil arrastre */}
                <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
              </div>
            )}
          </>
        )}

        {/* COLUMNA CENTRAL: Xox + Conversación + Input Pinned al fondo */}
        <section
          data-xox-chat-section
          data-xox-split={isEffectiveSplitLayout ? "true" : "false"}
          inert={hasCompactOverlayOpen}
          style={getXoxCosmosVars(displayAccentPreset)}
          className={`xook-gemini-backdrop xook-chat-container flex-1 min-w-0 flex flex-col overflow-hidden relative ${
            showXoxStudio ? "is-studio-open" : ""
          }`}
        >
          
          {/* Notificación de Sistema: flota sobre el contenido, no lo desplaza */}
          {statusToastPresence.mounted && displayStatusMessage && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-4"
            >
              <div
                className={`${
                  statusMessage ? "toast-in pointer-events-auto" : "toast-out pointer-events-none"
                } bg-zinc-900/95 border border-white/10 rounded-xl px-3.5 py-2.5 text-zinc-200 text-xs flex items-center gap-3 shadow-2xl backdrop-blur-xl max-w-lg`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{displayStatusMessage}</span>
                </div>
                <button
                  onClick={() => setStatusMessage(null)}
                  aria-label="Cerrar notificación"
                  className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Barra mínima fija de acciones de conversación (sin título truncado de mensaje) */}
          {chatMessages.length > 0 && !(showLeftSidebar && leftTab === "chats") && (
            <div className="shrink-0 bg-[#08090e]/88 backdrop-blur-md border-b border-white/[0.05] px-3 sm:px-6 z-10">
              <div className="max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto py-1.5 flex items-center justify-end gap-2">
                {!activeModel.is_free && accountUsage && !accountUsage.can_use_paid_models && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[9px] font-medium shrink-0 mr-auto">
                    Requiere saldo
                  </span>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLeftSidebar(true);
                      setLeftTab("chats");
                    }}
                    title="Ver historial de conversaciones"
                    className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span className="hidden sm:inline">Chats</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleStartNewChat}
                    disabled={isChatStreaming}
                    title="Nueva conversación"
                    className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-zinc-200 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <SquarePen className="w-3 h-3" />
                    <span className="hidden sm:inline">Nueva</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Área de Trabajo con Scroll: Xox Hero / Chat en vivo */}
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            onWheel={handleChatWheel}
            className="xook-chat-scroll-pad relative z-[1] flex-1 flex flex-col overflow-y-auto"
          >
            <div
              className={`w-full max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto transition-[padding] duration-200 ${
                chatMessages.length === 0 ? "flex-[1_0_auto] flex flex-col" : "shrink-0 space-y-6"
              } ${
                activeChecklist && !checklistCollapsed && !hasRightSplitOpen && !isCompactViewport
                  ? "lg:pr-[314px]"
                  : ""
              }`}
            >

              {/* ========================================================================= */}
              {/* 1. XOX DIGITAL COMPANION (HERO EN ESTADO VACÍO / COMPACTO EN CHAT)      */}
              {/* ========================================================================= */}
              {chatMessages.length === 0 ? (
                <div className="xox-hero-stage">
                  {/* Estrella Xox: protagonista en el Home; se desliza hacia Espacio de Xox al abrirlo */}
                  <div
                    className={`xox-hero-slot xox-hero-slot-adaptive relative flex flex-col items-center justify-center select-none pointer-events-none ${
                      showXoxStudio && !xoxFlightPending ? "is-away" : ""
                    }`}
                  >
                    <div
                      data-xox-stage="chat-hero"
                      className={
                        xoxFlight
                          ? "opacity-0 pointer-events-none"
                          : xoxFlightPending
                            ? ""
                            : xoxTravelPhase === "to-studio"
                              ? "xox-stage-away"
                              : xoxTravelPhase === "from-studio"
                                ? "xox-stage-home"
                                : ""
                      }
                    >
                      <XoxStar
                        state={xoxState}
                        responsive
                        hitArea="star"
                        clickBehavior="greet"
                        accentPreset={displayAccentPreset}
                        glideTrigger={showXoxStudio || xoxInFlight ? 0 : xoxGlideSeq}
                        glideDir="left"
                        active={!showXoxStudio && !xoxFlight}
                        className="xox-hero-star-size"
                        summonTrigger={summonSeq}
                        onClick={handleXoxClick}
                        terminal={xoxTerminalFeed}
                        subagents={
                          activeMode === "agent" && subagentTeamMode === "custom"
                            ? subagentRoster
                                .filter((r) => r.enabled)
                                .map((r) => ({
                                  id: r.id,
                                  name: r.name,
                                  design: r.design,
                                  status: "pending" as const,
                                }))
                            : undefined
                        }
                      />
                    </div>

                    {/* Burbuja de saludo Liquid Glass (solo al hacer clic sobre la estrella Xox) */}
                    {greeting && (
                      <div
                        role="status"
                        aria-live="polite"
                        style={getXoxBubbleVars(displayAccentPreset)}
                        className={`xox-bubble absolute left-[60%] bottom-[69%] z-20 pointer-events-none ${
                          greetingLeaving ? "is-leaving" : ""
                        }`}
                      >
                        <span aria-hidden="true" className="xox-bubble-trail xox-bubble-trail-sm" />
                        <span aria-hidden="true" className="xox-bubble-trail xox-bubble-trail-md" />

                        <div className="xox-bubble-body w-max max-w-[260px] px-4 py-2.5 rounded-[22px] text-left">
                          <p className="xox-bubble-text relative text-[13px] leading-snug text-white/95 font-medium">
                            {greeting}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Saludo Humano Amplio y Protagonista (espacio reservado fijo para evitar saltos verticales) */}
                  <div className="relative z-10 space-y-2.5 max-w-2xl px-3 sm:px-4 flex flex-col items-center">
                    <h1 className="xox-hero-title-adaptive font-semibold text-white tracking-tight select-text">
                      {heroGreeting}
                    </h1>

                    <div className="min-h-[28px] flex items-center justify-center">
                      {xoxStatusPresence.mounted ? (
                        <div
                          className={`${
                            isXoxStatusOpen ? "toast-in" : "toast-out pointer-events-none"
                          } inline-flex items-center gap-2 text-xs`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              displayXoxStatus.state === "thinking" || displayXoxStatus.state === "reading"
                                ? "animate-ping"
                                : displayXoxStatus.state === "success"
                                ? "bg-emerald-400"
                                : displayXoxStatus.state === "syncing"
                                ? "bg-teal-400 animate-pulse"
                                : displayXoxStatus.state === "alert"
                                ? "bg-red-500 animate-pulse"
                                : ""
                            }`}
                            style={
                              displayXoxStatus.state === "success" ||
                              displayXoxStatus.state === "syncing" ||
                              displayXoxStatus.state === "alert"
                                ? undefined
                                : { backgroundColor: XOX_ACCENT_PRESETS[displayAccentPreset].accessory }
                            }
                          />
                          <p
                            className={
                              displayXoxStatus.busy
                                ? "xox-shimmer font-medium"
                                : displayXoxStatus.state === "alert"
                                ? "text-red-300"
                                : "text-zinc-300"
                            }
                          >
                            {displayXoxStatus.message}
                          </p>
                        </div>
                      ) : !hasAnyConfiguredKey ? (
                        <button
                          type="button"
                          onClick={() => openAiSettings("account")}
                          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 underline-offset-4 hover:underline transition-colors cursor-pointer"
                        >
                          <KeyRound className="w-3 h-3" />
                          <span>Conectar proveedor de IA</span>
                        </button>
                      ) : conversations.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleSelectConversation(conversations[0])}
                          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                          title="Retomar tu última conversación guardada"
                        >
                          <MessageSquare className="w-3 h-3 text-zinc-500" />
                          <span className="truncate max-w-[280px]">
                            Retomar: {conversations[0].title}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <ChatMessageList
                      messages={chatMessages}
                      xoxState={xoxState}
                      thinkingLabel={thinkingLabel}
                      summonTrigger={summonSeq}
                      greeting={greeting}
                      greetingLeaving={greetingLeaving}
                      activeCanvasId={showCanvas ? activeCanvas?.id ?? null : null}
                      onOpenCanvas={handleOpenCanvas}
                      onPreviewAttachment={(target) => setAttachmentPreviewTarget(target)}
                      onPreviewPdf={(pdf) => void openPdfInRightPanel(pdf, "view")}
                      onEditPdf={(pdf) => void openPdfInRightPanel(pdf, "edit_page")}
                      onDownloadPdf={(pdf) => void handleDownloadPdfFromChat(pdf)}
                      onOpenPdf={(rel) => void openWorkspaceFile(rel)}
                      onRevealPdfFolder={(rel) => void openWorkspaceFolder(rel)}
                      modelCatalog={catalogModels}
                      onXoxClick={handleXoxClick}
                      onAction={handleChatAction}
                      onSaveInlineVaultKey={handleSaveInlineVaultKey}
                      onOpenAiVaultModal={(pid) => openAiSettings("account", pid ?? activeProvider)}
                      onOpenTasksTab={() => {
                        setShowRightSidebar(true);
                        setTaskTab("pending");
                      }}
                      onRegenerateMessage={(msgId) => void handleRegenerateMessage(msgId)}
                      onRateMessage={handleRateMessage}
                      permissionItems={permissionItems}
                      onResolvePermission={(reqId, decision) =>
                        void handleResolvePermission(reqId, decision)
                      }
                      ttsEnabled={Boolean(ttsStatus?.config.enabled)}
                      ttsModelsInstalled={Boolean(ttsStatus?.modelsInstalled)}
                      ttsLoadingMessageId={ttsPlayback.loadingMessageId}
                      ttsPlayingMessageId={ttsPlayback.playingMessageId}
                      onSpeakMessage={handleSpeakMessage}
                      accentPreset={displayAccentPreset}
                      agentName={effectiveAgentName}
                      xoxAwayInStudio={showXoxStudio && !xoxExitingStage}
                      xoxInFlight={xoxInFlight}
                      xoxTravelPhase={xoxTravelPhase}
                      glideSeq={showXoxStudio || xoxInFlight ? 0 : xoxGlideSeq}
                      xoxTerminal={xoxTerminalFeed}
                      isSplitMode={isEffectiveSplitLayout}
                      rosterSubagents={
                        activeMode === "agent" && subagentTeamMode === "custom"
                          ? subagentRoster
                              .filter((r) => r.enabled)
                              .map((r) => ({
                                id: r.id,
                                name: r.name,
                                design: r.design,
                                status: "pending" as const,
                              }))
                          : undefined
                      }
                    />
                  </div>

                  {/* Espaciador inferior para que el último elemento pueda scrollear sobre el input fijo y Xox */}
                  <div
                    className={`${
                      activeClarification || permissionItems.some((p) => p.state === "pending")
                        ? "h-[21rem] sm:h-[25rem]"
                        : isEffectiveSplitLayout
                          ? "h-[19rem] sm:h-[21rem]"
                          : "h-60 sm:h-56"
                    } shrink-0 transition-[height]`}
                  />
                </>
              )}

            </div>
          </div>

          {/* Tarjeta flotante de Checklist en la esquina derecha (se pliega en píldora al abrir Canvas o Panel) */}
          {activeChecklist && activeChecklist.items.length > 0 && (
            <ChecklistCornerCard
              checklist={activeChecklist}
              collapsed={checklistCollapsed}
              onCollapsedChange={setChecklistCollapsed}
              className={`absolute ${
                chatMessages.length > 0 && !(showLeftSidebar && leftTab === "chats")
                  ? "top-12"
                  : "top-3"
              } right-5 z-20`}
              onToggleItem={handleToggleChecklistItem}
              onClose={() => setActiveChecklist(null)}
            />
          )}

          {/* Notificación compacta de aprendizaje reciente (esquina superior derecha) */}
          {learningToastPresence.mounted && displayLearningToast && (
            <div
              role="status"
              aria-live="polite"
              className={`${
                learningToast ? "toast-in" : "toast-out pointer-events-none"
              } absolute top-4 right-4 z-20 w-[280px] liquid-glass-card rounded-xl p-3 flex items-start gap-2.5`}
            >
              <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Brain className="w-3.5 h-3.5 text-zinc-300" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Xox aprendió algo
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">
                    {Math.round(displayLearningToast.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[11.5px] text-zinc-200 leading-snug line-clamp-2">
                  {displayLearningToast.description}
                </p>
              </div>
              <button
                onClick={() => setLearningToast(null)}
                aria-label="Cerrar notificación"
                className="text-zinc-500 hover:text-zinc-300 p-0.5 -mr-1 -mt-1 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 4. INPUT / CHAT FIJO EN LA PARTE INFERIOR (PINNED DOCK)                    */}
          {/* ========================================================================= */}
          <div className="xook-composer-pad absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#060709] via-[#060709]/95 to-transparent pointer-events-none z-10">
            <div className="@container max-w-5xl xl:max-w-[1360px] 2xl:max-w-[1440px] mx-auto pointer-events-auto relative">
              {/* Xox fija en la esquina derecha sobre el input cuando la columna de chat es angosta (<560px) */}
              {chatMessages.length > 0 && (
                <div
                  className={`xox-compact-dock-perch items-center justify-center select-none ${
                    showXoxStudio || xoxFlight || showModelMenu || showContextMenu || showCommandMenu
                      ? "opacity-0 scale-95"
                      : "opacity-100 scale-100"
                  }`}
                >
                  <XoxStar
                    state={xoxState}
                    responsive
                    hitArea="star"
                    clickBehavior="greet"
                    accentPreset={displayAccentPreset}
                    active={
                      !showXoxStudio &&
                      !xoxFlight &&
                      (isEffectiveSplitLayout ||
                        viewportWidth < 620 ||
                        hasRightSplitOpen ||
                        showLeftSidebar)
                    }
                    className="xox-compact-perch-star"
                    summonTrigger={summonSeq}
                    onClick={handleXoxClick}
                    terminal={xoxTerminalFeed}
                    subagents={
                      activeMode === "agent" && subagentTeamMode === "custom" && isChatStreaming
                        ? subagentRoster
                            .filter((r) => r.enabled)
                            .map((r) => ({
                              id: r.id,
                              name: r.name,
                              design: r.design,
                              status: "pending" as const,
                            }))
                        : undefined
                    }
                  />
                  {greeting && (
                    <div
                      role="status"
                      aria-live="polite"
                      style={getXoxBubbleVars(displayAccentPreset)}
                      className={`xox-bubble absolute z-20 pointer-events-none ${
                        greetingLeaving ? "is-leaving" : ""
                      }`}
                    >
                      <div className="xox-bubble-body w-max px-3 py-1.5 rounded-[18px]">
                        <p className="xox-bubble-text relative text-[11.5px] leading-snug text-white/95 font-medium">
                          {greeting}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div
                ref={composerRef}
                onPointerEnter={() => {
                  if (composerRef.current) {
                    composerRectRef.current = composerRef.current.getBoundingClientRect();
                  }
                }}
                onPointerMove={(e) => {
                  const el = composerRef.current;
                  if (!el) return;
                  const rect = composerRectRef.current ?? el.getBoundingClientRect();
                  composerRectRef.current = rect;
                  if (rect.width <= 0 || rect.height <= 0) return;
                  const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
                  const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
                  el.style.setProperty("--stitch-mx", `${x.toFixed(2)}%`);
                  el.style.setProperty("--stitch-my", `${y.toFixed(2)}%`);
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    setIsDraggingOverChat(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setIsDraggingOverChat(false);
                  }
                }}
                onDrop={(e) => {
                  if (e.dataTransfer?.files?.length) {
                    e.preventDefault();
                    setIsDraggingOverChat(false);
                    const dropped = Array.from(e.dataTransfer.files);
                    appendFilesToComposer(dropped);
                    triggerReadingPulse(
                      dropped.length === 1
                        ? `Leyendo ${dropped[0].name}...`
                        : `Leyendo ${dropped.length} archivos adjuntos...`
                    );
                  } else {
                    setIsDraggingOverChat(false);
                  }
                }}
                className={`liquid-glass-hero input-console rounded-2xl p-3 sm:p-3.5 relative group shadow-2xl ${
                  inputExpanded || attachments.length > 0 ? "is-expanded" : ""
                } ${isDraggingOverChat ? "ring-1 ring-white/30 border-white/25" : ""}`}
              >
                {/* Borde iridiscente 1px estilo Stitch (esquina superior izquierda violeta -> izquierda azul/cian) */}
                <span aria-hidden="true" className="xook-stitch-rim" />
                <span aria-hidden="true" className="xook-stitch-pointer-rim" />

                {/* Capa de recorte para los efectos de luz internos (los menús desplegables pueden sobresalir) */}
                <div className="xook-stitch-fx absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                  {/* Bruma luminosa interna en la esquina y borde izquierdo */}
                  <span aria-hidden="true" className="xook-stitch-bloom" />
                  {/* Destello reactivo al puntero */}
                  <span aria-hidden="true" className="xook-stitch-pointer-glow" />
                  {/* Reflejo especular superior tenue */}
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-violet-200/12 via-white/[0.06] to-transparent" />
                  {/* Barrido de luz de encendido */}
                  <span key={summonSeq} aria-hidden="true" className="console-sweep" />
                </div>

                {/* Bandeja acoplada al input para Permisos pendientes y Preguntas abiertas (estilo Antigravity / Claude Code) */}
                {(permissionItems.some((p) => p.state === "pending") || activeClarification) && (
                  <div className="relative z-10 mb-2.5 pb-2.5 border-b border-white/[0.08] space-y-2">
                    {permissionItems
                      .filter((p) => p.state === "pending")
                      .map((perm) => (
                        <CommandPermissionCard
                          key={perm.requestId}
                          item={perm}
                          docked
                          onResolve={(reqId, decision) =>
                            void handleResolvePermission(reqId, decision)
                          }
                        />
                      ))}

                    {activeClarification && (
                      <ClarificationInputDock
                        clarification={activeClarification}
                        onClose={() => setActiveClarification(null)}
                        onSubmit={(formattedReply) => {
                          const clarificationId = activeClarification?.id;
                          const cleanedMessages = chatMessagesRef.current.map((m) =>
                            m.actionButton?.kind === "open_clarification" &&
                            (!clarificationId || m.actionButton.clarification?.id === clarificationId)
                              ? { ...m, actionButton: undefined }
                              : m
                          );
                          setChatMessages(cleanedMessages);
                          setActiveClarification(null);
                          void runPromptQuery(formattedReply, cleanedMessages);
                        }}
                      />
                    )}
                  </div>
                )}

                {/* Formulario Principal de Entrada */}
                <form onSubmit={handlePromptSubmit} className="relative z-10 space-y-2.5">
                  {/* Píldora de Ventana de Contexto Aislado cuando hay un documento abierto */}
                  {showDocViewer && pdfPanelState?.path && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.035] border border-white/[0.09] text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            docContextScopeEnabled ? "bg-emerald-400" : "bg-zinc-500"
                          }`}
                          aria-hidden="true"
                        />
                        <Layers className="w-3.5 h-3.5 text-zinc-300 shrink-0" aria-hidden="true" />
                        <span className="font-medium text-zinc-100 truncate">
                          {docContextScopeEnabled
                            ? `Ventana: ${pdfPanelState.title}`
                            : `Chat general (visor: ${pdfPanelState.title})`}
                        </span>
                        {docContextScopeEnabled && activeDocumentContext && (
                          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-zinc-400 bg-white/[0.05] border border-white/[0.08] rounded-full px-1.5 py-0.2 shrink-0">
                            {activeDocumentContext.recentTurnsCount} turnos · ~{formatTokenCount(activeDocumentContext.estimatedTokens)} tok
                          </span>
                        )}
                        {docContextScopeEnabled &&
                          activeDocumentContext &&
                          activeDocumentContext.pinnedRules.length > 0 && (
                            <span className="hidden md:inline-flex text-[10px] text-zinc-300 bg-white/[0.06] border border-white/[0.1] rounded-full px-1.5 py-0.2 shrink-0">
                              {activeDocumentContext.pinnedRules.length} regla
                              {activeDocumentContext.pinnedRules.length === 1 ? "" : "s"}
                            </span>
                          )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDocContextScopeEnabled((v) => !v)}
                          aria-pressed={docContextScopeEnabled}
                          title={
                            docContextScopeEnabled
                              ? "Cambiar temporalmente al contexto del chat general sin cerrar el documento"
                              : "Volver al contexto aislado de este documento"
                          }
                          className="px-2 py-0.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.09] text-[10px] font-medium text-zinc-200 hover:text-white cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-white/70"
                        >
                          {docContextScopeEnabled ? "Chat general" : "Focar doc"}
                        </button>
                        <button
                          type="button"
                          disabled={isCompactingContext || isChatStreaming}
                          onClick={() =>
                            void handleRunManualCompact(
                              "",
                              docContextScopeEnabled ? "document" : "chat"
                            )
                          }
                          title="Compactar ahora el contexto activo (/compact)"
                          className="px-2 py-0.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.13] border border-white/[0.1] text-[10px] font-medium text-zinc-100 hover:text-white inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-white/70"
                        >
                          {isCompactingContext ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                          )}
                          <span>Compactar</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Bandeja visual de adjuntos (imágenes con miniatura real + tarjetas PEGADO estilo Claude/Gemini + archivos) */}
                  <ComposerAttachmentTray
                    items={attachments}
                    onRemove={removeComposerAttachment}
                    onInspect={inspectComposerAttachment}
                    disabled={isChatStreaming}
                  />

                  {/* Badge de Modo Activo (/agent, /study, etc.) */}
                  {activeModeSpec && (
                    <div ref={rosterPopoverRef} className="relative px-1 flex items-center gap-2">
                      <ActiveModeChip
                        spec={activeModeSpec}
                        onDismiss={() => {
                          setActiveMode(null);
                          setShowRosterPopover(false);
                          inputRef.current?.focus();
                        }}
                        extraAction={
                          activeMode === "agent" ? (
                            <button
                              type="button"
                              onClick={() => setShowRosterPopover((v) => !v)}
                              title="Configurar nombres, modelos y diseños de sub-agentes"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-medium bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.1] text-zinc-200 hover:text-white transition-colors cursor-pointer"
                            >
                              <Users className="w-2.5 h-2.5" />
                              <span>
                                {subagentTeamMode === "dynamic"
                                  ? "Equipo: Auto"
                                  : `Equipo (${subagentRoster.filter((r) => r.enabled).length})`}
                              </span>
                            </button>
                          ) : activeMode === "inspector" &&
                            showDocViewer &&
                            pdfPanelState?.path &&
                            ((pdfPanelState.fileKind ?? "pdf") === "pdf" ||
                              pdfPanelState.fileKind === "office" ||
                              pdfPanelState.fileExtension === "csv" ||
                              pdfPanelState.fileExtension === "tsv") ? (
                            <button
                              type="button"
                              disabled={isChatStreaming}
                              onClick={() =>
                                handleInspectPdfDesign(
                                  pdfPanelState.path,
                                  pdfPanelState.title || pdfPanelState.filename || "Documento",
                                  pdfPanelState.universalDoc?.formatLabel ||
                                    pdfPanelState.fileExtension?.toUpperCase()
                                )
                              }
                              title={`Analizar el diseño de "${pdfPanelState.title || pdfPanelState.path}"`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-medium bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.1] text-zinc-200 hover:text-white transition-colors cursor-pointer disabled:opacity-45"
                            >
                              <ScanSearch className="w-2.5 h-2.5" />
                              <span>Analizar abierto</span>
                            </button>
                          ) : undefined
                        }
                      />

                      {activeMode === "agent" && (
                        <SubagentRosterPopover
                          isOpen={showRosterPopover}
                          teamMode={subagentTeamMode}
                          dynamicModel={dynamicSubagentModel}
                          roster={subagentRoster}
                          models={availableQuickModels}
                          onTeamModeChange={setSubagentTeamMode}
                          onDynamicModelChange={setDynamicSubagentModel}
                          onChange={setSubagentRoster}
                          onClose={() => setShowRosterPopover(false)}
                        />
                      )}
                    </div>
                  )}

                  {/* Campo de escritura principal a ancho completo (estilo Claude / Gemini) */}
                  <div className="relative px-1">
                    <label htmlFor={chatInputId} className="sr-only">
                      Escribe un mensaje para {effectiveAgentName}
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) {
                          appendFilesToComposer(files);
                          triggerReadingPulse(
                            files.length === 1
                              ? `Leyendo ${files[0].name}...`
                              : `Leyendo ${files.length} archivos adjuntos...`
                          );
                        }
                        e.target.value = "";
                      }}
                    />

                    <textarea
                      id={chatInputId}
                      ref={inputRef}
                      rows={1}
                      value={inputPrompt}
                      onChange={(e) => {
                        const val = e.target.value;
                        setInputPrompt(val);

                        // Si el usuario escribe / al inicio, abrir menú de comandos
                        if (val.startsWith("/")) {
                          setShowCommandMenu(true);
                          setCommandMenuFilter(val);
                          setSelectedCommandIndex(0);
                        } else if (showCommandMenu && !val) {
                          setShowCommandMenu(false);
                          setCommandMenuFilter("");
                        }

                        // Si escribe "/agent " o similar con un espacio, activar el modo automáticamente
                        const matchSlash = val.match(/^(\/[a-zA-Z]+)\s+(.*)$/s);
                        if (matchSlash) {
                          const typedCmd = matchSlash[1].toLowerCase();
                          const rest = matchSlash[2];
                          const found = XOX_COMMAND_LIST.find((c) => c.slash.toLowerCase() === typedCmd);
                          if (found) {
                            setActiveMode(found.id);
                            setInputPrompt(rest);
                            setShowCommandMenu(false);
                            setCommandMenuFilter("");
                          }
                        }
                      }}
                      onPaste={(e) => {
                        const { files: pastedFiles, text: pastedText } = extractClipboardPayload(
                          e.clipboardData
                        );
                        if (pastedFiles.length > 0) {
                          e.preventDefault();
                          appendFilesToComposer(pastedFiles);
                          triggerReadingPulse(
                            pastedFiles.length === 1
                              ? `Imagen o archivo adjuntado (${pastedFiles[0].name || "portapapeles"})...`
                              : `${pastedFiles.length} archivos pegados...`
                          );
                          return;
                        }
                        if (pastedText && shouldGroupPastedText(pastedText)) {
                          e.preventDefault();
                          appendPastedTextToComposer(pastedText);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (showCommandMenu) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            if (filteredCommands.length > 0) {
                              setSelectedCommandIndex((i) => (i + 1) % filteredCommands.length);
                            }
                            return;
                          }
                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            if (filteredCommands.length > 0) {
                              setSelectedCommandIndex(
                                (i) => (i - 1 + filteredCommands.length) % filteredCommands.length
                              );
                            }
                            return;
                          }
                          if (e.key === "Enter" || e.key === "Tab") {
                            if (
                              filteredCommands.length > 0 &&
                              selectedCommandIndex >= 0 &&
                              selectedCommandIndex < filteredCommands.length
                            ) {
                              e.preventDefault();
                              const chosen = filteredCommands[selectedCommandIndex];
                              setActiveMode(chosen.id);
                              setInputPrompt("");
                              setShowCommandMenu(false);
                              setCommandMenuFilter("");
                              return;
                            }
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setShowCommandMenu(false);
                            setCommandMenuFilter("");
                            return;
                          }
                        }

                        // Si el prompt está vacío y presiona Backspace teniendo un modo activo, desactivarlo
                        if (e.key === "Backspace" && !inputPrompt && activeMode) {
                          e.preventDefault();
                          setActiveMode(null);
                          return;
                        }

                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
                            return;
                          }
                          handlePromptSubmit();
                        }
                      }}
                      disabled={isChatStreaming}
                      placeholder={chatInputPlaceholder}
                      className="input-bubble w-full min-w-0 resize-none overflow-hidden bg-transparent text-sm sm:text-[15.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none py-1 font-normal leading-relaxed disabled:opacity-50 select-text"
                    />
                  </div>

                  {/* Barra inferior unificada: adjuntar + modos + contexto a la izquierda · modelo + atajos + enviar a la derecha */}
                  <div className="pt-1.5 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1 @[460px]:gap-1.5 min-w-0 shrink-0">
                      {/* Botón + para subir archivos o imágenes */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Adjuntar archivos o imágenes (PDF, PNG, JPG, CSV, texto...)"
                        aria-label="Adjuntar archivos o imágenes"
                        className="quick-liquid-btn shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-zinc-200 hover:text-white active:scale-95 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>

                      {/* Desplegable de Modos y Comandos Especiales (/agent, /study, etc.) */}
                      <div ref={commandMenuRef} className="relative shrink-0">
                        <button
                          ref={commandTriggerRef}
                          type="button"
                          onClick={() => {
                            setShowModelMenu(false);
                            setShowContextMenu(false);
                            setShowCommandMenu((v) => !v);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={showCommandMenu}
                          aria-label="Comandos y modos de Xox"
                          title="Activar modos (/agent, /study, /plan, /audit, /inspector, /compact)"
                          className={`quick-liquid-btn h-8 inline-flex items-center gap-1 @[520px]:gap-1.5 px-2 @[520px]:px-2.5 rounded-full text-[11px] cursor-pointer ${
                            activeMode || showCommandMenu
                              ? "text-white"
                              : "text-zinc-300 hover:text-white"
                          }`}
                        >
                          <Slash className="w-3 h-3 text-white/75 shrink-0" />
                          <span className="hidden @[520px]:inline">Modos</span>
                          {activeModeSpec && (
                            <span className="text-[10px] font-medium text-zinc-300 font-mono">
                              {activeModeSpec.slash}
                            </span>
                          )}
                          <ChevronDown
                            className={`w-3 h-3 text-white/65 transition-transform shrink-0 ${
                              showCommandMenu ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {commandMenuPresence.mounted && (
                          <SlashCommandMenu
                            isOpen={showCommandMenu}
                            filterQuery={commandMenuFilter}
                            selectedIndex={selectedCommandIndex}
                            onSelect={(cmd) => {
                              setActiveMode(cmd.id);
                              setInputPrompt("");
                              setShowCommandMenu(false);
                              setCommandMenuFilter("");
                              inputRef.current?.focus();
                            }}
                            onClose={() => {
                              setShowCommandMenu(false);
                              setCommandMenuFilter("");
                            }}
                          />
                        )}
                      </div>

                      {/* Selector de Contexto */}
                      <div ref={contextMenuRef} className="relative shrink-0">
                        <button
                          ref={contextTriggerRef}
                          type="button"
                          onClick={() => {
                            setShowModelMenu(false);
                            setShowContextMenu((v) => !v);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={showContextMenu}
                          aria-label="Seleccionar contexto"
                          title="Adjuntar contexto al mensaje"
                          className={`quick-liquid-btn h-8 inline-flex items-center gap-1 @[520px]:gap-1.5 px-2 @[520px]:px-2.5 rounded-full text-[11px] cursor-pointer ${
                            activeContextCount > 0 || showContextMenu
                              ? "text-white"
                              : "text-zinc-300 hover:text-white"
                          }`}
                        >
                          <AtSign className="w-3 h-3 text-white/75 shrink-0" />
                          <span className="hidden @[520px]:inline">Contexto</span>
                          {activeContextCount > 0 && (
                            <span className="text-[10px] font-mono text-zinc-100 tabular-nums">
                              {activeContextCount}
                            </span>
                          )}
                          <ChevronDown className={`w-3 h-3 text-white/65 transition-transform shrink-0 ${showContextMenu ? "rotate-180" : ""}`} />
                        </button>

                        {contextMenuPresence.mounted && (
                          <div
                            role="listbox"
                            aria-label="Contexto disponible"
                            aria-multiselectable="true"
                            onKeyDown={(e) =>
                              handleListboxKeyDown(
                                e,
                                () => setShowContextMenu(false),
                                contextTriggerRef.current
                              )
                            }
                            className={`xook-liquid-menu menu-origin-left ${
                              showContextMenu ? "menu-in" : "menu-out pointer-events-none"
                            } absolute left-0 bottom-full mb-2 w-[min(15rem,calc(100vw-2rem))] p-1.5 rounded-2xl z-30`}
                          >
                            <LiquidGlassBackdrop variant="menu" />

                            <div className="relative z-[1] space-y-0.5">
                              {contextItems.map((item) => {
                                const friendlyLabel = CONTEXT_LABEL[item.type] || item.name;
                                const isInPrompt = inputPrompt.includes(`@${item.name}`);
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    role="option"
                                    aria-selected={isInPrompt}
                                    onClick={() => toggleContextInPrompt(item.name)}
                                    className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer ${
                                      isInPrompt ? "is-selected" : ""
                                    }`}
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      <span className="quick-liquid-icon w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0">
                                        <ContextIcon type={item.type} className="w-3 h-3 text-white/85" />
                                      </span>
                                      <span className="min-w-0">
                                        <span className="block text-xs font-medium text-white truncate">{friendlyLabel}</span>
                                        <span className="block text-[10px] text-zinc-300/75 font-mono truncate">{item.name}</span>
                                      </span>
                                    </span>
                                    {isInPrompt && (
                                      <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5 text-white" />
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 @[460px]:gap-1.5 min-w-0">
                      <div className="hidden @[620px]:flex items-center gap-1 mr-0.5 shrink-0">
                        {isTauriEnv && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const { invoke } = await import("@tauri-apps/api/core");
                                await invoke("toggle_quick_bar_cmd");
                              } catch {
                                // Ignore
                              }
                            }}
                            title="Abrir Xox Quick Bar flotante (⌘⇧X)"
                            className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded transition-colors cursor-pointer"
                          >
                            ⌘⇧X
                          </button>
                        )}
                        <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 bg-white/[0.03] border border-white/[0.06] rounded">
                          ⌘K
                        </kbd>
                      </div>

                      {/* Desplegable de modelos */}
                      <div ref={modelMenuRef} className="relative min-w-0">
                        <button
                          ref={modelTriggerRef}
                          type="button"
                          onClick={() => {
                            setShowContextMenu(false);
                            setShowModelMenu((v) => !v);
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={showModelMenu}
                          className="quick-liquid-btn h-8 max-w-full inline-flex items-center gap-1.5 px-2 @[460px]:px-2.5 rounded-full text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                        >
                          <ProviderIcon provider={activeProvider} size={13} className="text-white/85 shrink-0" />
                          <span className="truncate max-w-[92px] @[410px]:max-w-[134px] @[560px]:max-w-[168px]">{activeModel.name}</span>
                          <ChevronDown className={`w-3 h-3 text-white/65 transition-transform shrink-0 ${showModelMenu ? "rotate-180" : ""}`} />
                        </button>
                        {modelMenuPresence.mounted && (
                          <div
                            role="listbox"
                            aria-label="Modelos disponibles"
                            onKeyDown={(e) =>
                              handleListboxKeyDown(
                                e,
                                () => setShowModelMenu(false),
                                modelTriggerRef.current
                              )
                            }
                            className={`xook-liquid-menu ${
                              showModelMenu ? "menu-in" : "menu-out pointer-events-none"
                            } absolute right-0 bottom-full mb-2 w-[min(20rem,calc(100vw-1.25rem))] overflow-hidden p-1.5 rounded-2xl z-30`}
                          >
                            <LiquidGlassBackdrop variant="menu" />

                            <div className="relative z-[1]">
                              <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-white/[0.08] mb-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <ProviderIcon provider={activeProvider} size={12} className="text-zinc-200 shrink-0" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-300/85 truncate">
                                    {activeSpec.shortName} ({availableQuickModels.length})
                                  </span>
                                  {activeProvider === "openrouter" && !canUsePaidModels && (
                                    <span className="quick-liquid-chip px-1.5 py-0.5 rounded-full text-[9px] font-medium text-zinc-300/90 shrink-0">
                                      {aiConfig.hasApiKey ? "Sin saldo · gratis" : "Gratis"}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {availableQuickModels.length > 4 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandModelMenu((prev) => !prev);
                                      }}
                                      aria-expanded={expandModelMenu}
                                      title={expandModelMenu ? "Contraer lista de modelos" : "Ver más modelos"}
                                      className="inline-flex items-center gap-0.5 h-6 px-2 rounded-full text-[10px] font-medium text-sky-200/85 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                                    >
                                      <span>{expandModelMenu ? "Menos" : "Más"}</span>
                                      <ChevronDown
                                        className={`w-3 h-3 transition-transform duration-200 ${
                                          expandModelMenu ? "rotate-180" : ""
                                        }`}
                                      />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void refreshModelsAndUsage(true);
                                    }}
                                    aria-label={`Actualizar catálogo y estado de ${activeSpec.shortName}`}
                                    title={`Actualizar catálogo y estado de ${activeSpec.shortName}`}
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-300/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${loadingModels ? "animate-spin" : ""}`} />
                                  </button>
                                </div>
                              </div>

                              {unavailableModelIds.size > 0 && (
                                <div className="quick-liquid-subcard mx-1 mb-1.5 px-2.5 py-1.5 rounded-xl text-[10.5px] text-zinc-200/90 leading-snug">
                                  Se ocultaron {unavailableModelIds.size} modelo(s) que devolvieron error o límite.
                                </div>
                              )}

                              <div
                                className={`xook-expand-list ${
                                  expandModelMenu ? "max-h-80" : "max-h-56"
                                } overflow-y-auto space-y-0.5 pr-0.5`}
                              >
                                {availableQuickModels.map((m) => (
                                  <button
                                    key={m.id}
                                    type="button"
                                    role="option"
                                    aria-selected={m.id === modelId}
                                    onClick={() => void handleSelectModel(m.id)}
                                    className={`quick-liquid-option w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left cursor-pointer ${
                                      m.id === modelId ? "is-selected" : ""
                                    }`}
                                  >
                                    <span className="min-w-0">
                                      <span className="flex items-center gap-1.5 text-xs font-medium text-white truncate [text-shadow:0_1px_4px_rgba(4,8,18,0.65)]">
                                        <span className="truncate">{m.name}</span>
                                        {m.is_free ? (
                                          <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9px] font-medium text-zinc-200/90 shrink-0">
                                            gratis
                                          </span>
                                        ) : typeof m.prompt_price_per_million === "number" &&
                                          m.prompt_price_per_million > 0 ? (
                                          <span className="quick-liquid-chip px-1.5 py-0.5 rounded-md text-[9px] font-mono text-zinc-300/90 shrink-0 tabular-nums">
                                            {formatPricePerMillion(m.prompt_price_per_million)}/1M
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="block text-[10.5px] text-zinc-300/75 truncate [text-shadow:0_1px_3px_rgba(4,8,18,0.6)]">
                                        {m.hint}
                                      </span>
                                    </span>
                                    {m.id === modelId && (
                                      <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5 text-white" />
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>

                              <div className="mt-1.5 pt-1.5 border-t border-white/[0.08] space-y-1">
                                {hasAnyConfiguredKey && (
                                  <div className="px-2.5 py-1 space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-[10.5px] text-zinc-300/85">
                                      <span className="truncate">{usageSummary.tierLabel}</span>
                                      <span className="font-mono text-zinc-100 shrink-0 tabular-nums">
                                        {usageSummary.headline}
                                      </span>
                                    </div>
                                    {usageSummary.hasMeterBar && (
                                      <progress
                                        className="xook-usage-progress"
                                        value={Math.max(0, Math.min(100, usageSummary.pct))}
                                        max={100}
                                        aria-label={`${usageSummary.tierLabel}: ${usageSummary.headline}`}
                                        style={{
                                          ["--xook-progress-fill" as string]: getUsageMeterFillColor({
                                            meterMode: usageSummary.meterMode,
                                            pct: usageSummary.pct,
                                          }),
                                        }}
                                      />
                                    )}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowModelMenu(false);
                                    openAiSettings("models");
                                  }}
                                  className="quick-liquid-option w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-[11px] font-medium text-zinc-100/90 hover:text-white cursor-pointer"
                                >
                                  <span className="quick-liquid-icon w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0">
                                    <KeyRound className="w-2.5 h-2.5 text-white/85" />
                                  </span>
                                  <span>Proveedores, tarifas y respaldo…</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {isChatStreaming ? (
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          aria-label="Detener respuesta en curso"
                          title="Detener generación"
                          className="xook-stop-btn quick-liquid-btn-ready shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-95 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80"
                        >
                          <span aria-hidden="true" className="xook-stop-ring" />
                          <span
                            aria-hidden="true"
                            className="relative z-[1] w-2.5 h-2.5 rounded-[2.5px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.45)]"
                          />
                        </button>
                      ) : isCompactingContext ? (
                        <button
                          type="button"
                          disabled
                          aria-label="Compactando contexto..."
                          title="Compactando contexto..."
                          className="xook-stop-btn quick-liquid-btn-ready shrink-0 w-8 h-8 rounded-full flex items-center justify-center cursor-wait opacity-90"
                        >
                          <span aria-hidden="true" className="xook-stop-ring" />
                          <span
                            aria-hidden="true"
                            className="relative z-[1] w-2.5 h-2.5 rounded-[2.5px] bg-white/90"
                          />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={
                            !inputPrompt.trim() && attachments.length === 0 && activeMode !== "compact"
                          }
                          aria-label="Enviar mensaje"
                          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            !inputPrompt.trim() && attachments.length === 0 && activeMode !== "compact"
                              ? "quick-liquid-btn text-zinc-200/70 cursor-not-allowed"
                              : "quick-liquid-btn-ready active:scale-95 cursor-pointer"
                          }`}
                          title="Enviar instrucción (Enter)"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>

        </section>

        {/* PANEL ESPACIO DE XOX (IDENTIDAD GLOBAL, VOZ, SKILLS EN BLOQUES Y PROMPT INICIAL) */}
        {studioPresence.mounted && (
          <div
            role={isCompactViewport ? "dialog" : undefined}
            aria-modal={isCompactViewport && showXoxStudio ? true : undefined}
            aria-label={isCompactViewport ? `Espacio de ${effectiveAgentName}` : undefined}
            aria-hidden={!showXoxStudio}
            inert={!showXoxStudio}
            style={{ width: studioPresence.visible ? `${studioPanelWidth}px` : "0px" }}
            className={`sidebar-slot sidebar-studio-slot h-full flex flex-col min-h-0 shrink-0 bg-[#060709] overflow-hidden ${
              isCompactViewport ? "xook-compact-drawer-surface is-right" : ""
            } ${
              studioPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <div
              data-xox-studio-inner
              style={{ width: `${studioPanelWidth}px` }}
              className={`flex-1 h-full flex flex-col min-h-0 border-l border-white/[0.07] shrink-0 transition-[width] duration-300 ease-out ${
                isMemoryWideStudio ? "p-1.5" : "p-2.5"
              }`}
            >
              <XoxStudioPanel
                visible={studioPresence.visible}
                hideStar={xoxInFlight}
                initialTab={xoxStudioTab}
                onTabChange={(tab) => setXoxStudioTab(tab)}
                isMemoryWideMode={isMemoryWideMode}
                onToggleMemoryWideMode={() => {
                  const next = !isMemoryWideMode;
                  setIsMemoryWideMode(next);
                  if (next && !isCompactViewport) {
                    setShowLeftSidebar(false);
                    setShowRightSidebar(false);
                  }
                }}
                highlightedSkillSlug={highlightedSkillSlug}
                glideSeq={xoxGlideSeq}
                memoryLivePulse={memoryLivePulse}
                profile={globalXoxProfile}
                skills={xoxSkills}
                ttsStatus={ttsStatus}
                xoxState={xoxState}
                hasActiveWorkspace={Boolean(workspaceOverview?.active)}
                activeWorkspaceName={workspaceOverview?.active.name ?? null}
                localUser={localUser}
                userMemoryFacts={userMemoryFacts}
                workspaceFacts={workspaceMemoryFacts}
                patterns={studioMemoryPatterns}
                onSaveMemoryFact={async (input: {
                  value: string;
                  key?: string;
                  category?: UserMemoryCategory;
                  pinned?: boolean;
                }) => {
                  suppressMemorySyncPulseUntilRef.current = Date.now() + 500;
                  const next = await saveUserMemoryFact({
                    value: input.value,
                    key: input.key,
                    category: input.category,
                    pinned: input.pinned,
                    scope: "global",
                    sourceWindow: "main",
                  });
                  setUserMemoryFacts(next);
                  triggerMemoryLivePulse("updated", "user", input.key || input.value);
                }}
                onTogglePinMemoryFact={async (fact: UserMemoryFact) => {
                  suppressMemorySyncPulseUntilRef.current = Date.now() + 500;
                  const next = await saveUserMemoryFact({
                    value: fact.value,
                    key: fact.key,
                    category: fact.category,
                    scope: fact.scope,
                    sourceWindow: "main",
                    pinned: !fact.pinned,
                  });
                  setUserMemoryFacts(next);
                  triggerMemoryLivePulse("updated", "user", fact.key || fact.value);
                }}
                onDeleteMemoryFact={async (idOrKey: string) => {
                  suppressMemorySyncPulseUntilRef.current = Date.now() + 500;
                  const next = await deleteUserMemoryFact(idOrKey, "main");
                  setUserMemoryFacts(next);
                  triggerMemoryLivePulse("removed", "user", idOrKey);
                }}
                onUpdateWorkspaceFact={handleUpdateWorkspaceFact}
                onDeleteWorkspaceFact={handleDeleteWorkspaceFact}
                onAddWorkspaceFact={handleAddWorkspaceFact}
                onUpdatePreference={handleUpdatePreference}
                onDeletePreference={handleDeletePreference}
                onAskXoxEditMemory={handleAskXoxEditMemory}
                onProfileChanged={(nextProf) => {
                  setGlobalXoxProfile(nextProf);
                  setPreviewAccentPreset(null);
                }}
                onPreviewAccentChange={setPreviewAccentPreset}
                onSkillsRefresh={refreshXoxStudioData}
                onTtsStatusChanged={setTtsStatus}
                onAskXoxCustomize={(hintPrompt) => {
                  setInputPrompt(hintPrompt);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                onStatusNotice={(msg) => {
                  setStatusMessage(msg);
                  setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 3800);
                }}
                onClose={closeXoxStudio}
              />
            </div>
          </div>
        )}

        {/* PANEL CANVAS INTERACTIVO ESTILO GEMINI (TABLAS COMPARATIVAS Y DATOS) */}
        {canvasPresence.mounted && activeCanvas && (
          <div
            role={isCompactViewport ? "dialog" : undefined}
            aria-modal={isCompactViewport && showCanvas ? true : undefined}
            aria-label={isCompactViewport ? "Canvas interactivo" : undefined}
            aria-hidden={!showCanvas}
            inert={!showCanvas}
            style={{ width: canvasPresence.visible ? `${canvasPanelWidth}px` : "0px" }}
            className={`sidebar-slot shrink-0 bg-[#060709] overflow-hidden ${
              isCompactViewport ? "xook-compact-drawer-surface is-right" : ""
            } ${
              canvasPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <div
              style={{ width: `${canvasPanelWidth}px` }}
              className="h-full border-l border-white/[0.07] p-2.5 shrink-0"
            >
              <CanvasPanel
                canvas={activeCanvas}
                siblingCanvases={(() => {
                  const sourceMsg = chatMessages.find(
                    (m) =>
                      m.id === activeCanvas.sourceMessageId ||
                      Boolean(m.canvases?.some((c) => c.id === activeCanvas.id))
                  );
                  return sourceMsg?.canvases && sourceMsg.canvases.length > 1
                    ? sourceMsg.canvases
                    : undefined;
                })()}
                onSelectSiblingCanvas={handleOpenCanvas}
                visible={canvasPresence.visible}
                expanded={canvasExpanded}
                onToggleExpand={() => setCanvasExpanded((v) => !v)}
                onUpdateCanvas={handleUpdateCanvas}
                onCanvasAction={handleCanvasAction}
                onAskXoxEdit={handleAskXoxAboutCanvas}
                onExportPdf={isTauriEnv ? handleExportCanvasPdf : undefined}
                onClose={() => {
                  setShowCanvas(false);
                  setCanvasExpanded(false);
                }}
              />
            </div>
          </div>
        )}

        {/* PANEL DEDICADO DEL VISOR Y EDITOR DE DOCUMENTOS (INDEPENDIENTE DE TAREAS) */}
        {docViewerPresence.mounted && (pdfPanelState || pdfDraftProgress) && (
          <div
            role={isCompactViewport ? "dialog" : undefined}
            aria-modal={isCompactViewport && showDocViewer ? true : undefined}
            aria-label={isCompactViewport ? "Visor de documentos" : undefined}
            aria-hidden={!showDocViewer}
            inert={!showDocViewer}
            style={{ width: docViewerPresence.visible ? `${docViewerPanelWidth}px` : "0px" }}
            className={`sidebar-slot shrink-0 bg-[#060709] overflow-hidden ${
              isCompactViewport ? "xook-compact-drawer-surface is-right" : ""
            } ${
              docViewerPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <div
              style={{ width: `${docViewerPanelWidth}px` }}
              className="h-full border-l border-white/[0.07] p-2.5 shrink-0"
            >
              <PdfWorkspacePanel
              state={pdfPanelState}
              openTabs={openDocTabs}
              activeTabPath={pdfPanelState?.path ?? null}
              onSelectTab={(targetPath) => {
                setActiveDocTabPath(targetPath);
                setDocContextScopeEnabled(true);
                const tab = openDocTabs.find((t) => t.path === targetPath);
                if (tab && tab.fileKind === "pdf" && tab.pages.length === 0 && !tab.isLoadingPages) {
                  void openPdfInRightPanel({
                    path: tab.path,
                    title: tab.title,
                    filename: tab.filename,
                    pageCount: tab.pageCount,
                    sizeBytes: tab.sizeBytes,
                    hasCover: tab.hasCover,
                    theme: tab.theme,
                    revision: Date.now(),
                  });
                }
              }}
              onCloseTab={(targetPath) => closeDocTab(targetPath)}
              documentContext={activeDocumentContext}
              isDocumentContextActive={docContextScopeEnabled}
              isCompactingContext={isCompactingContext}
              onToggleDocumentContext={() => setDocContextScopeEnabled((v) => !v)}
              onCompactDocumentContext={() => void handleRunManualCompact("", "document")}
              onResetDocumentContext={(keepRules) => void handleResetActiveDocContext(keepRules)}
              onUpdateDocumentRules={(rules) => void handleUpdateActiveDocRules(rules)}
              draftProgress={pdfDraftProgress}
              onClose={closeAllDocTabs}
              onOpenExternal={(rel) => void openWorkspaceFile(rel)}
              onRevealInFolder={(rel) => void openWorkspaceFolder(rel)}
              onLoadMorePages={(rel, nextStart) => void handleLoadMorePdfPages(rel, nextStart)}
              onReloadPreview={(rel) => {
                if (pdfPanelState?.fileKind === "office") {
                  void openUniversalDocInRightPanel({
                    path: rel,
                    filename: pdfPanelState.filename || rel.split("/").pop() || "Documento",
                    sizeBytes: pdfPanelState.sizeBytes,
                    ext: pdfPanelState.fileExtension,
                  });
                } else {
                  void openPdfInRightPanel({
                    path: rel,
                    title: pdfPanelState?.title,
                    filename: pdfPanelState?.filename,
                    pageCount: pdfPanelState?.pageCount,
                    sizeBytes: pdfPanelState?.sizeBytes,
                    hasCover: pdfPanelState?.hasCover,
                    theme: pdfPanelState?.theme,
                    revision: Date.now(),
                  });
                }
              }}
              onAskXoxAboutPdf={(_rel, title) => {
                setDocContextScopeEnabled(true);
                setInputPrompt((prev) =>
                  prev.trim() ? prev : `Sobre el documento "${title}": `
                );
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              onInspectDocumentDesign={handleInspectPdfDesign}
              onInspectPdfDesign={handleInspectPdfDesign}
              onSendXoxDocumentInstruction={(payload) => {
                setDocContextScopeEnabled(true);
                const prefix =
                  payload.mode === "append_pages"
                    ? `Agrega nuevas páginas al final conservando la misma tipografía y estilo (${payload.theme || "executive"}): `
                    : `Aplica este ajuste conservando diseño y tipografía (${payload.theme || "executive"}): `;
                void runPromptQuery(`${prefix}${payload.instruction}`, undefined, {
                  forceScope: "document",
                  forceDocument: {
                    path: payload.path,
                    title: payload.title,
                    fileKind: pdfPanelState?.fileKind || "pdf",
                    theme: payload.theme || "executive",
                    pageCount: payload.pageCount,
                    hasCover: pdfPanelState?.hasCover,
                    revision: pdfPanelState?.revision,
                  },
                });
              }}
              onPdfUpdated={(updated) => {
                patchDocTab(updated.path, (curr) => ({
                  ...curr,
                  path: updated.path,
                  title: updated.title,
                  theme: updated.theme,
                  pageCount: updated.pageCount,
                  sizeBytes: updated.sizeBytes,
                  pages: updated.pages,
                  hasMore: updated.hasMore,
                  isLoadingPages: false,
                  error: null,
                  revision: Date.now(),
                }));
                void handleRefreshWorkspace();
              }}
              onSaveTextFile={async (rel, newContent) => {
                await handleSaveWorkspaceFile(rel, newContent);
                patchDocTab(rel, (curr) => ({
                  ...curr,
                  textContent: newContent,
                  sizeBytes: new Blob([newContent]).size,
                  revision: Date.now(),
                }));
              }}
              onExportTextToPdf={handleExportTextDocumentToPdf}
              onStatusNotice={(msg) => {
                setStatusMessage(msg);
                setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 4000);
              }}
            />
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* COLUMNA 3: TAREAS Y DECISIONES DEL LADO DERECHO (EXCLUSIVA PARA TAREAS)   */}
        {/* ========================================================================= */}
        {rightPresence.mounted && (
          <>
            {/* Separador redimensionable derecho (Splitter Aurora de Vidrio) */}
            {!isCompactViewport && (
              <div
                data-xox-right-splitter
                data-xox-right-open={showRightSidebar ? "true" : "false"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizingRight(true);
                }}
                onDoubleClick={() => setRightWidth(340)}
                style={!rightPresence.visible ? { width: "0px" } : undefined}
                className={`splitter-aurora-glass ${isResizingRight ? "is-resizing" : ""} ${
                  rightPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                {/* Zona de captura ampliada invisible para fácil arrastre */}
                <div className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize" />
              </div>
            )}

            <div
              role={isCompactViewport ? "dialog" : undefined}
              aria-modal={isCompactViewport && showRightSidebar ? true : undefined}
              aria-label={isCompactViewport ? "Panel de tareas y decisiones" : undefined}
              aria-hidden={!showRightSidebar}
              inert={!showRightSidebar}
              style={{ width: rightPresence.visible ? `${effectiveRightWidth}px` : "0px" }}
              className={`sidebar-slot flex flex-col shrink-0 overflow-hidden bg-[#08090d] ${
                isCompactViewport ? "xook-compact-drawer-surface is-right" : ""
              } ${
                isResizingRight ? "is-resizing" : ""
              } ${rightPresence.visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <div className="flex-1 min-h-0 flex">
                <TaskDecisionsPanel
                  width={effectiveRightWidth}
                  tasks={tasks}
                  agendaItems={agendaItems}
                  historyItems={historyItems}
                  maxBudgetLimit={workspaceOverview?.profile.maxBudgetPerOrder ?? 25000}
                  currency={workspaceOverview?.profile.currency ?? "MXN"}
                  activeTab={taskTab}
                  onTabChange={setTaskTab}
                  onUpdateParam={handleUpdateTaskParam}
                  onToggleTaskChecklist={handleToggleTaskChecklist}
                  onApproveTask={handleApproveTask}
                  onDiscardTask={handleDiscardTask}
                  onAskXox={handleAskXoxAboutTask}
                  onToggleTimer={handleToggleTimer}
                  onResetTimer={handleResetTimer}
                  onCompleteAgendaItem={handleCompleteAgendaItem}
                  onRemoveAgendaItem={handleRemoveAgendaItem}
                  onToggleAgendaChecklist={handleToggleAgendaChecklist}
                  onToggleAgendaAuto={handleToggleAgendaAuto}
                  onCreateQuickTimer={handleCreateQuickTimer}
                  onCreateQuickNote={handleCreateQuickNote}
                  onCreateScheduledEvent={handleCreateScheduledEvent}
                  onTriggerXoxReconstruct={() =>
                    runPromptQuery("Consolida y agrupa las órdenes de inventario")
                  }
                  inventoryCount={inventoryItems.length}
                  latestReview={latestReview}
                  isReviewRunning={isReviewRunning}
                  onRunBusinessReview={() => void handleRunBusinessReview("manual")}
                  onImportInventoryFile={handleImportInventoryFile}
                />
              </div>
            </div>
          </>
        )}

      </div>

      <OpenRouterSettingsModal
        isOpen={showAiSettings}
        initialTab={aiSettingsTab}
        initialProvider={aiSettingsProvider}
        config={aiConfig}
        accountUsage={accountUsage}
        usageLedger={usageLedger}
        catalogModels={catalogModels}
        requestsToday={requestsToday}
        onClose={() => setShowAiSettings(false)}
        onConfigUpdated={(next) => {
          setAiConfig(next);
          if (next.modelId) {
            setModelId(next.modelId);
          }
          setRequestsToday(getLocalDailyRequestCount(next.maskedKey));
        }}
        onUsageUpdated={(usage) => {
          setAccountUsage(usage);
          if (usage?.ok && (usage.can_use_paid_models || normalizeProviderIdClient(aiConfig.provider) !== "openrouter")) {
            setUnavailableModelIds(new Set());
          }
        }}
        onLedgerUpdated={setUsageLedger}
        onCatalogUpdated={(models) => {
          if (models.length > 0) {
            setCatalogModels(models);
          }
        }}
      />

      <LocalAuthModal
        isOpen={showLocalAuth}
        user={localUser}
        defaultStoreName={
          workspaceOverview?.profile.companyName ||
          localUser?.storeName ||
          "Mi Espacio"
        }
        onClose={() => setShowLocalAuth(false)}
        onUserUpdated={(updatedUser) => {
          setLocalUser(updatedUser);
          setStatusMessage(
            updatedUser
              ? `Sesión local activa: ${updatedUser.name} (${updatedUser.storeName})`
              : "Sesión local cerrada."
          );
        }}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        initialTab={settingsInitialTab}
        onClose={() => setShowSettingsModal(false)}
        ttsStatus={ttsStatus}
        onTtsStatusChanged={setTtsStatus}
        aiConfig={aiConfig}
        modelCatalog={catalogModels}
        localUser={localUser}
        activeWorkspaceId={workspaceOverview?.active.id ?? null}
        agentName={effectiveAgentName}
        onOpenXoxStudio={(tab) => openXoxStudio(tab ?? "identity")}
        onOpenAiSettings={(tab) => openAiSettings(tab ?? "models")}
        onOpenLocalAuth={() => setShowLocalAuth(true)}
        onStatusNotice={(msg) => {
          setStatusMessage(msg);
          setTimeout(() => setStatusMessage(null), 3800);
        }}
      />

      <AttachmentPreviewDialog
        target={attachmentPreviewTarget}
        onClose={() => setAttachmentPreviewTarget(null)}
        onSavePastedText={updateComposerPastedText}
        onUnwrapPastedText={unwrapComposerPastedText}
        onRemoveAttachment={removeComposerAttachment}
      />

      {xoxFlight && (
        <XoxFlightOverlay
          flight={xoxFlight}
          xoxState={xoxState}
          accentPreset={displayAccentPreset}
          terminal={xoxTerminalFeed}
          onComplete={(flightId) => {
            setXoxFlight((curr) => (curr && curr.id === flightId ? null : curr));
            setXoxTravelPhase("idle");
            setXoxExitingStage(false);
          }}
        />
      )}
    </div>
  );
}