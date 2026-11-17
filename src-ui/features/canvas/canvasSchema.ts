import {
  decodeSafeHtmlEntities,
  stripInlineMarkdownText,
} from "../../utils/markdownRenderer";
import {
  diagramSpecToMermaid,
  parseMermaidToDiagramSpec,
} from "./diagramMermaidParser";

export type CanvasKind = "comparison" | "table" | "document" | "diagram" | "plan" | "dashboard" | "form";

export type CanvasColumnKind = "text" | "number" | "currency" | "badge" | "rating";

export type CanvasColumnAlign = "left" | "center" | "right";

export type CanvasRowHighlight = "recommended" | "warning" | "muted" | null;

export type CanvasDiagramType = "flowchart" | "sequence" | "mindmap" | "process";
export type CanvasDiagramDirection = "TD" | "LR";
export type CanvasDiagramNodeShape = "rounded" | "pill" | "diamond" | "cylinder" | "note";
export type CanvasDiagramNodeTone = "neutral" | "accent" | "success" | "warning" | "critical";

export interface CanvasDiagramNode {
  id: string;
  label: string;
  subtitle?: string;
  shape?: CanvasDiagramNodeShape;
  tone?: CanvasDiagramNodeTone;
  group?: string;
  detail?: string;
}

export interface CanvasDiagramEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed";
}

export interface CanvasDiagramSpec {
  diagramType: CanvasDiagramType;
  direction: CanvasDiagramDirection;
  nodes: CanvasDiagramNode[];
  edges: CanvasDiagramEdge[];
  mermaid?: string;
}

export type CanvasPlanStatus =
  | "draft"
  | "approved"
  | "in_progress"
  | "completed"
  | "changes_requested";

export type CanvasPlanRiskLevel = "low" | "medium" | "high";
export type CanvasPlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface CanvasPlanStep {
  id: string;
  title: string;
  detail?: string;
  target?: string;
  dependsOn?: string[];
  checked: boolean;
  status: CanvasPlanStepStatus;
  risk?: CanvasPlanRiskLevel;
  comment?: string;
}

export interface CanvasPlanPhase {
  id: string;
  title: string;
  summary?: string;
  status: CanvasPlanStepStatus;
  comment?: string;
  steps: CanvasPlanStep[];
}

export interface CanvasPlanRisk {
  level: CanvasPlanRiskLevel;
  text: string;
  mitigation?: string;
}

export interface CanvasPlanSpec {
  goal: string;
  status: CanvasPlanStatus;
  scope?: string[];
  assumptions?: string[];
  risks?: CanvasPlanRisk[];
  phases: CanvasPlanPhase[];
  reviewComment?: string;
}

export type CanvasMetricTone = "neutral" | "positive" | "warning" | "critical";
export type CanvasChartType = "bar" | "horizontal_bar" | "line" | "area" | "donut";
export type CanvasValueFormat = "number" | "currency" | "percent" | "compact";

export interface CanvasKpiItem {
  id: string;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  tone?: CanvasMetricTone;
  caption?: string;
  progress?: number;
}

export interface CanvasChartSeries {
  id: string;
  name: string;
  values: number[];
  tone?: CanvasMetricTone | "accent";
}

export interface CanvasChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  chartType: CanvasChartType;
  categories: string[];
  series: CanvasChartSeries[];
  unit?: string;
  valueFormat?: CanvasValueFormat;
  targetValue?: number;
  targetLabel?: string;
}

export interface CanvasInsightItem {
  tone?: "info" | "positive" | "warning" | "critical";
  title?: string;
  text: string;
}

export interface CanvasDashboardSpec {
  kpis: CanvasKpiItem[];
  charts: CanvasChartSpec[];
  insights?: CanvasInsightItem[];
}

export type CanvasFormPurpose = "study_quiz" | "data_capture" | "survey";

export type CanvasFormFieldType =
  | "single_choice"
  | "multi_choice"
  | "true_false"
  | "short_text"
  | "long_text"
  | "number"
  | "rating"
  | "select";

export type CanvasFormAnswerValue = string | number | number[] | boolean;

export interface CanvasFormField {
  id: string;
  label: string;
  type: CanvasFormFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  correctIndex?: number;
  correctIndices?: number[];
  expectedAnswer?: string;
  hint?: string;
  explanation?: string;
  points?: number;
  min?: number;
  max?: number;
}

export interface CanvasFormScore {
  earned: number;
  total: number;
  correctCount: number;
  gradableCount: number;
  openCount: number;
  percent: number;
  passed?: boolean;
}

export interface CanvasFormSpec {
  purpose: CanvasFormPurpose;
  description?: string;
  submitLabel?: string;
  passingScorePercent?: number;
  showHints?: boolean;
  fields: CanvasFormField[];
  answers?: Record<string, CanvasFormAnswerValue>;
  checkedLocally?: boolean;
  submitted?: boolean;
  submittedAt?: string;
  score?: CanvasFormScore;
}

export type CanvasBlock =
  | { type: "callout"; title?: string; text: string; tone?: "info" | "warning" | "success" }
  | { type: "markdown"; title?: string; content: string }
  | { type: "diagram"; title?: string; diagram: CanvasDiagramSpec }
  | { type: "plan"; title?: string; plan: CanvasPlanSpec }
  | { type: "dashboard"; title?: string; dashboard: CanvasDashboardSpec }
  | { type: "form"; title?: string; form: CanvasFormSpec }
  | { type: "table"; title?: string; columns: CanvasColumn[]; rows: CanvasRow[] };

export type CanvasActionPayload =
  | { type: "plan_approve"; canvas: CanvasArtifact }
  | { type: "plan_request_changes"; canvas: CanvasArtifact }
  | { type: "diagram_ask_node"; canvas: CanvasArtifact; node: CanvasDiagramNode }
  | { type: "dashboard_ask_item"; canvas: CanvasArtifact; label: string; detail?: string }
  | { type: "form_submit"; canvas: CanvasArtifact }
  | { type: "ask_edit"; canvas: CanvasArtifact };

export interface CanvasColumn {
  id: string;
  label: string;
  align: CanvasColumnAlign;
  kind: CanvasColumnKind;
}

export interface CanvasRow {
  id: string;
  cells: Record<string, string>;
  highlight?: CanvasRowHighlight;
  badge?: string;
}

export interface CanvasArtifact {
  id: string;
  title: string;
  subtitle?: string;
  kind: CanvasKind;
  columns: CanvasColumn[];
  rows: CanvasRow[];
  summary?: string;
  markdown?: string;
  diagram?: CanvasDiagramSpec;
  plan?: CanvasPlanSpec;
  dashboard?: CanvasDashboardSpec;
  form?: CanvasFormSpec;
  blocks?: CanvasBlock[];
  updatedAt: string;
  sourceMessageId?: string;
}

export interface ParsedMarkdownTable {
  headers: string[];
  alignments: CanvasColumnAlign[];
  rows: string[][];
}

function normLookupKey(rawKey: string): string {
  return rawKey
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function asNonEmptyString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of ["value", "text", "label", "display", "content", "nombre"]) {
      if (k in obj) {
        const nested = asNonEmptyString(obj[k]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripHtmlCellText(rawHtml: string): string {
  const clean = rawHtml
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(clean).replace(/\s+/g, " ").trim();
}

export function parseHtmlTableFragment(fragment: string): ParsedMarkdownTable | null {
  const rowMatches = Array.from(fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  if (rowMatches.length === 0) return null;

  const parsedRows: string[][] = [];
  let firstHasTh = false;
  for (let rIdx = 0; rIdx < rowMatches.length; rIdx += 1) {
    const rowInner = rowMatches[rIdx][1];
    const cellMatches = Array.from(rowInner.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi));
    if (cellMatches.length === 0) continue;
    if (rIdx === 0 && cellMatches.some((m) => m[1].toLowerCase() === "th")) {
      firstHasTh = true;
    }
    parsedRows.push(cellMatches.map((m) => stripHtmlCellText(m[2])));
  }

  if (parsedRows.length < 2 && !(firstHasTh && parsedRows.length >= 2)) {
    return null;
  }
  const headers = parsedRows[0];
  if (!headers || headers.length < 2 || headers.every((h) => !h)) {
    return null;
  }
  const dataRows = parsedRows.slice(1);
  if (dataRows.length === 0) return null;

  const normalizedRows = dataRows.map((row) => headers.map((_, colIdx) => row[colIdx] ?? ""));
  const alignments: CanvasColumnAlign[] = headers.map((_, idx) => {
    const isNumeric = normalizedRows.every(
      (r) => !r[idx] || /^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$/i.test(r[idx])
    );
    return isNumeric ? "right" : "left";
  });

  return { headers, alignments, rows: normalizedRows };
}

export function extractFirstHtmlTable(text: string): ParsedMarkdownTable | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (!lower.includes("<tr") && !lower.includes("<table")) return null;
  const tableBlocks = Array.from(text.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi));
  for (const blk of tableBlocks) {
    const parsed = parseHtmlTableFragment(blk[0]);
    if (parsed) return parsed;
  }
  const trSeq = text.match(/(?:<tr\b[^>]*>[\s\S]*?<\/tr>\s*)+/i);
  if (trSeq) {
    return parseHtmlTableFragment(trSeq[0]);
  }
  return null;
}

export function parsedTableToMarkdown(tbl: ParsedMarkdownTable): string {
  const headers = tbl.headers.map((h) => h.replace(/\|/g, "\\|"));
  const sep = tbl.alignments.map((a) =>
    a === "right" ? "---:" : a === "center" ? ":---:" : "---"
  );
  const rows = tbl.rows.map((r) => {
    const vals = headers.map((_, idx) =>
      (r[idx] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
    );
    return `| ${vals.join(" | ")} |`;
  });
  return [`| ${headers.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...rows].join("\n");
}

function stripMarkdownTablesFromText(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length && lines[i].includes("|") && isMarkdownTableSeparator(lines[i + 1])) {
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        i += 1;
      }
      continue;
    }
    kept.push(lines[i]);
    i += 1;
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stashMarkdownCodeForCleaning(text: string): { stashedText: string; stash: string[] } {
  const stash: string[] = [];
  const pushToken = (raw: string): string => {
    const idx = stash.length;
    stash.push(raw);
    return `\uE000XOOKCODE_${idx}\uE001`;
  };

  const lines = text.split("\n");
  const outLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    const fenceChar = m ? m[2][0] : "";
    const fenceLen = m ? m[2].length : 0;
    const info = m ? m[3] : "";
    const validOpen = Boolean(m && !(fenceChar === "`" && info.includes("`")));

    if (validOpen) {
      const blockLines: string[] = [line];
      i += 1;
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      while (i < lines.length) {
        blockLines.push(lines[i]);
        if (closeRe.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      outLines.push(pushToken(blockLines.join("\n")));
      continue;
    }

    // Inline code spans on non-fenced lines
    outLines.push(line.replace(/(`+)(?:(?!\1)[^\n])+\1|`[^`\n]+`/g, (match) => pushToken(match)));
    i += 1;
  }

  return { stashedText: outLines.join("\n"), stash };
}

export function cleanVisibleReply(
  text: string,
  options?: { stripTables?: boolean }
): string {
  let out = (text || "").trim();
  if (!out) return "";

  const stripTables = Boolean(options?.stripTables);
  const { stashedText, stash } = stashMarkdownCodeForCleaning(out);
  out = stashedText;

  const replaceHtml = (fragment: string): string => {
    const parsed = parseHtmlTableFragment(fragment);
    if (!parsed) return "";
    return stripTables ? "" : `\n${parsedTableToMarkdown(parsed)}\n`;
  };

  out = out.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, replaceHtml);
  out = out.replace(/(?:<tr\b[^>]*>[\s\S]*?<\/tr>\s*)+(?:\s*<\/table>)?/gi, replaceHtml);
  out = out.replace(
    /<\s*(?:\/\s*)?(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|table|thead|tbody|tfoot|tr|th|td)\b[^>]*>/gi,
    ""
  );
  out = out.replace(
    /(?:^\s*<\s*(?:res|answer|output|final)\s*>|<\s*\/\s*(?:res|answer|output|final)\s*>\s*$|(?:^|\n)[ \t]*<\s*(?:\/\s*)?(?:res|answer|output|final)\s*>[ \t]*(?=\n|$))/gi,
    (match) => (match.startsWith("\n") ? "\n" : "")
  );
  out = out.replace(
    /<\s*\/\s*(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|res|answer|output|final)\s*$/gi,
    ""
  );
  if (stripTables) {
    out = stripMarkdownTablesFromText(out);
  }
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  if (stash.length > 0) {
    out = out.replace(/\uE000XOOKCODE_(\d+)\uE001/g, (_m, idx) => stash[Number(idx)] ?? "");
  }
  return out;
}

export function canvasHasCellData(canvas: CanvasArtifact | null | undefined): boolean {
  if (!canvas) return false;
  if (canvas.kind === "diagram" || canvas.diagram) {
    if (
      canvas.diagram &&
      (canvas.diagram.nodes.length > 0 || Boolean(canvas.diagram.mermaid?.trim()))
    ) {
      return true;
    }
  }
  if (canvas.kind === "plan" || canvas.plan) {
    if (
      canvas.plan &&
      (canvas.plan.phases.length > 0 || Boolean(canvas.plan.goal?.trim()))
    ) {
      return true;
    }
  }
  if (canvas.kind === "dashboard" || canvas.dashboard) {
    if (
      canvas.dashboard &&
      (canvas.dashboard.kpis.length > 0 ||
        canvas.dashboard.charts.length > 0 ||
        Boolean(canvas.dashboard.insights?.length))
    ) {
      return true;
    }
  }
  if (canvas.kind === "form" || canvas.form) {
    if (canvas.form && canvas.form.fields.length > 0) {
      return true;
    }
  }
  if (canvas.blocks && canvas.blocks.length > 0) {
    return true;
  }
  if (canvas.columns.length > 0) {
    if (canvas.rows.length === 0) return false;
    return canvas.rows.some((r) =>
      Object.values(r.cells).some((v) => typeof v === "string" && v.trim().length > 0)
    );
  }
  return Boolean(canvas.markdown?.trim() || canvas.summary?.trim());
}

function cleanCanvasHeaderLabel(raw: string, fallback: string): string {
  const cleaned = stripInlineMarkdownText(decodeSafeHtmlEntities(raw))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function inferColumnKind(label: string, sampleValues: string[]): CanvasColumnKind {
  const lower = stripInlineMarkdownText(label).toLowerCase();
  if (/(precio|costo|margen|total|ingreso|venta|mxn|usd|\$)/i.test(lower)) {
    return "currency";
  }
  if (/(estado|nivel|prioridad|recomend|etiqueta|categor)/i.test(lower)) {
    return "badge";
  }
  if (/(calific|puntaje|score|rating|estrella)/i.test(lower)) {
    return "rating";
  }
  const nonEmpty = sampleValues
    .map((v) => stripInlineMarkdownText(v))
    .filter(Boolean);
  if (nonEmpty.length > 0) {
    if (nonEmpty.every((v) => /^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$/i.test(v))) {
      return nonEmpty.some((v) => /[$€£]|mxn|usd/i.test(v)) ? "currency" : "number";
    }
  }
  return "text";
}

function inferAlign(kind: CanvasColumnKind, explicit?: string): CanvasColumnAlign {
  if (explicit === "left" || explicit === "center" || explicit === "right") {
    return explicit;
  }
  if (kind === "number" || kind === "currency") return "right";
  if (kind === "badge" || kind === "rating") return "center";
  return "left";
}

function normalizeColId(rawId: string, idx: number, used: Set<string>): string {
  const slug = rawId
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let base = slug || `col_${idx + 1}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  used.add(candidate);
  return candidate;
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

export function parseMarkdownTableBlock(lines: string[]): ParsedMarkdownTable | null {
  if (lines.length < 2) return null;
  const headerLine = lines[0]?.trim() ?? "";
  const separatorLine = lines[1]?.trim() ?? "";
  if (!headerLine.includes("|") || !isMarkdownTableSeparator(separatorLine)) {
    return null;
  }
  const headers = splitMarkdownTableRow(headerLine);
  if (headers.length < 2 || headers.every((h) => !h)) return null;

  const sepCells = splitMarkdownTableRow(separatorLine);
  const alignments: CanvasColumnAlign[] = headers.map((_, idx) => {
    const cell = (sepCells[idx] ?? "").trim();
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw || !raw.includes("|")) break;
    const parsed = splitMarkdownTableRow(raw);
    const normalized = headers.map((_, colIdx) => parsed[colIdx] ?? "");
    rows.push(normalized);
  }

  return { headers, alignments, rows };
}

export function extractFirstMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].includes("|") && isMarkdownTableSeparator(lines[i + 1])) {
      const table = parseMarkdownTableBlock(lines.slice(i));
      if (table) return table;
    }
  }
  return null;
}

export function markdownTableToCanvasArtifact(
  table: ParsedMarkdownTable,
  options?: { id?: string; title?: string; subtitle?: string; kind?: CanvasKind; summary?: string }
): CanvasArtifact {
  const usedIds = new Set<string>();
  const columns: CanvasColumn[] = table.headers.map((header, idx) => {
    const label = cleanCanvasHeaderLabel(header, `Columna ${idx + 1}`);
    const samples = table.rows.map((r) => r[idx] ?? "");
    const kind = inferColumnKind(label, samples);
    const align =
      table.alignments[idx] !== "left"
        ? table.alignments[idx]
        : inferAlign(kind);
    return {
      id: normalizeColId(label, idx, usedIds),
      label,
      align,
      kind,
    };
  });

  const rows: CanvasRow[] = table.rows.map((rawRow, rIdx) => {
    const cells: Record<string, string> = {};
    columns.forEach((col, cIdx) => {
      cells[col.id] = (rawRow[cIdx] ?? "").trim();
    });
    return {
      id: `row_${rIdx + 1}`,
      cells,
      highlight: null,
    };
  });

  const lowerTitle = (options?.title ?? "").toLowerCase();
  const isComparison =
    options?.kind === "comparison" ||
    /compar|vs|alternativ|opci|proveedor/i.test(lowerTitle) ||
    columns.some((c) => /criterio|ventaja|desventaja|opci[oó]n/i.test(c.label));

  return {
    id: options?.id || `canvas_${Date.now()}`,
    title: options?.title?.trim() || "Tabla comparativa",
    subtitle: options?.subtitle?.trim() || undefined,
    kind: options?.kind || (isComparison ? "comparison" : "table"),
    columns,
    rows,
    summary: options?.summary?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeDiagramNodeShape(raw: string): CanvasDiagramNodeShape {
  const low = raw.toLowerCase();
  if (low === "pill" || low === "start" || low === "end" || low === "oval" || low === "circle") {
    return "pill";
  }
  if (low === "diamond" || low === "decision" || low === "condicion" || low === "branch") {
    return "diamond";
  }
  if (low === "cylinder" || low === "db" || low === "database" || low === "storage") {
    return "cylinder";
  }
  if (low === "note" || low === "doc" || low === "document") {
    return "note";
  }
  return "rounded";
}

function sanitizeDiagramNodeTone(raw: string): CanvasDiagramNodeTone {
  const low = raw.toLowerCase();
  if (low === "accent" || low === "primary" || low === "highlight" || low === "info") return "accent";
  if (low === "success" || low === "ok" || low === "done" || low === "positive") return "success";
  if (low === "warning" || low === "warn" || low === "media" || low === "decision") return "warning";
  if (low === "critical" || low === "danger" || low === "error" || low === "alta") return "critical";
  return "neutral";
}

export function sanitizeDiagramSpec(raw: unknown): CanvasDiagramSpec | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    return parseMermaidToDiagramSpec(raw) ?? undefined;
  }
  if (typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  const rawMermaid =
    asNonEmptyString(obj.mermaid) ||
    asNonEmptyString(obj.mermaid_code) ||
    asNonEmptyString(obj.mermaidCode) ||
    asNonEmptyString(obj.code);

  const rawType = (
    asNonEmptyString(obj.diagramType) ||
    asNonEmptyString(obj.diagram_type) ||
    asNonEmptyString(obj.type) ||
    "flowchart"
  ).toLowerCase();
  const diagramType: CanvasDiagramType =
    rawType === "sequence" || rawType === "secuencia"
      ? "sequence"
      : rawType === "mindmap" || rawType === "mapa" || rawType === "tree"
        ? "mindmap"
        : rawType === "process" || rawType === "proceso"
          ? "process"
          : "flowchart";

  const rawDir = (
    asNonEmptyString(obj.direction) ||
    asNonEmptyString(obj.direccion) ||
    "TD"
  ).toUpperCase();
  const direction: CanvasDiagramDirection =
    rawDir === "LR" || rawDir === "RL" || rawDir === "HORIZONTAL" ? "LR" : "TD";

  const rawNodes = Array.isArray(obj.nodes)
    ? obj.nodes
    : Array.isArray(obj.nodos)
      ? obj.nodos
      : Array.isArray(obj.steps)
        ? obj.steps
        : [];
  const rawEdges = Array.isArray(obj.edges)
    ? obj.edges
    : Array.isArray(obj.conexiones)
      ? obj.conexiones
      : Array.isArray(obj.links)
        ? obj.links
        : [];

  const nodes: CanvasDiagramNode[] = [];
  const seenNodeIds = new Set<string>();
  rawNodes.slice(0, 60).forEach((n, idx) => {
    if (typeof n === "string") {
      const lbl = n.trim();
      if (!lbl) return;
      const id = `n_${idx + 1}`;
      seenNodeIds.add(id);
      nodes.push({ id, label: lbl, shape: "rounded", tone: "neutral" });
      return;
    }
    if (!n || typeof n !== "object") return;
    const nObj = n as Record<string, unknown>;
    const label =
      asNonEmptyString(nObj.label) ||
      asNonEmptyString(nObj.title) ||
      asNonEmptyString(nObj.titulo) ||
      asNonEmptyString(nObj.name) ||
      asNonEmptyString(nObj.nombre);
    const id = asNonEmptyString(nObj.id) || `n_${idx + 1}`;
    if (!label && !id) return;
    if (seenNodeIds.has(id)) return;
    seenNodeIds.add(id);
    const subtitle = asNonEmptyString(nObj.subtitle) || asNonEmptyString(nObj.subtitulo) || undefined;
    const detail = asNonEmptyString(nObj.detail) || asNonEmptyString(nObj.detalle) || asNonEmptyString(nObj.description) || undefined;
    const group = asNonEmptyString(nObj.group) || asNonEmptyString(nObj.grupo) || undefined;
    const shape = sanitizeDiagramNodeShape(asNonEmptyString(nObj.shape) || asNonEmptyString(nObj.forma));
    const tone = sanitizeDiagramNodeTone(asNonEmptyString(nObj.tone) || asNonEmptyString(nObj.tono));
    nodes.push({
      id,
      label: label || id,
      ...(subtitle ? { subtitle } : {}),
      ...(detail ? { detail } : {}),
      ...(group ? { group } : {}),
      shape,
      tone,
    });
  });

  const edges: CanvasDiagramEdge[] = [];
  rawEdges.slice(0, 100).forEach((e, idx) => {
    if (!e || typeof e !== "object") return;
    const eObj = e as Record<string, unknown>;
    const from =
      asNonEmptyString(eObj.from) ||
      asNonEmptyString(eObj.source) ||
      asNonEmptyString(eObj.desde) ||
      asNonEmptyString(eObj.origen);
    const to =
      asNonEmptyString(eObj.to) ||
      asNonEmptyString(eObj.target) ||
      asNonEmptyString(eObj.hacia) ||
      asNonEmptyString(eObj.destino);
    if (!from || !to) return;
    if (!seenNodeIds.has(from)) {
      seenNodeIds.add(from);
      nodes.push({ id: from, label: from, shape: "rounded", tone: "neutral" });
    }
    if (!seenNodeIds.has(to)) {
      seenNodeIds.add(to);
      nodes.push({ id: to, label: to, shape: "rounded", tone: "neutral" });
    }
    const label = asNonEmptyString(eObj.label) || asNonEmptyString(eObj.etiqueta) || undefined;
    const rawStyle = asNonEmptyString(eObj.style) || asNonEmptyString(eObj.estilo);
    const style = rawStyle === "dashed" || rawStyle === "discontinua" ? "dashed" : "solid";
    edges.push({
      id: asNonEmptyString(eObj.id) || `e_${idx + 1}`,
      from,
      to,
      ...(label ? { label } : {}),
      style,
    });
  });

  // Si no llegaron nodos explícitos pero sí código Mermaid, parsearlo automáticamente
  if (nodes.length === 0 && rawMermaid) {
    return parseMermaidToDiagramSpec(rawMermaid) ?? undefined;
  }
  if (nodes.length === 0) return undefined;

  // Si es diagrama de proceso sin edges explícitos, encadenar secuencialmente
  if (edges.length === 0 && nodes.length > 1 && (diagramType === "process" || diagramType === "flowchart")) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({
        id: `e_${i + 1}`,
        from: nodes[i].id,
        to: nodes[i + 1].id,
        style: "solid",
      });
    }
  }

  return {
    diagramType,
    direction,
    nodes,
    edges,
    ...(rawMermaid ? { mermaid: rawMermaid } : {}),
  };
}

function sanitizeRiskLevel(raw: string): CanvasPlanRiskLevel {
  const low = raw.toLowerCase();
  if (low === "high" || low === "alta" || low === "alto" || low === "critical") return "high";
  if (low === "medium" || low === "media" || low === "medio" || low === "moderate") return "medium";
  return "low";
}

function sanitizePlanStepStatus(raw: string): CanvasPlanStepStatus {
  const low = raw.toLowerCase();
  if (low === "in_progress" || low === "running") return "in_progress";
  if (low === "done" || low === "completed" || low === "completado") return "done";
  if (low === "skipped" || low === "omitido") return "skipped";
  return "pending";
}

export function sanitizePlanSpec(raw: unknown, fallbackGoal?: string): CanvasPlanSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  const goal =
    asNonEmptyString(obj.goal) ||
    asNonEmptyString(obj.objetivo) ||
    asNonEmptyString(obj.title) ||
    fallbackGoal ||
    "";

  const rawStatus = (asNonEmptyString(obj.status) || asNonEmptyString(obj.estado) || "draft").toLowerCase();
  const status: CanvasPlanStatus =
    rawStatus === "approved" || rawStatus === "aprobado"
      ? "approved"
      : rawStatus === "in_progress" || rawStatus === "en_progreso"
        ? "in_progress"
        : rawStatus === "completed" || rawStatus === "completado"
          ? "completed"
          : rawStatus === "changes_requested" || rawStatus === "cambios"
            ? "changes_requested"
            : "draft";

  const rawScope = Array.isArray(obj.scope)
    ? obj.scope
    : Array.isArray(obj.alcance)
      ? obj.alcance
      : Array.isArray(obj.files)
        ? obj.files
        : [];
  const scope = rawScope.map((s) => asNonEmptyString(s)).filter(Boolean).slice(0, 20);

  const rawAssumptions = Array.isArray(obj.assumptions)
    ? obj.assumptions
    : Array.isArray(obj.supuestos)
      ? obj.supuestos
      : [];
  const assumptions = rawAssumptions.map((s) => asNonEmptyString(s)).filter(Boolean).slice(0, 12);

  const rawRisks = Array.isArray(obj.risks)
    ? obj.risks
    : Array.isArray(obj.riesgos)
      ? obj.riesgos
      : [];
  const risks: CanvasPlanRisk[] = [];
  rawRisks.slice(0, 12).forEach((r) => {
    if (typeof r === "string") {
      const txt = r.trim();
      if (txt) risks.push({ level: "medium", text: txt });
      return;
    }
    if (!r || typeof r !== "object") return;
    const rObj = r as Record<string, unknown>;
    const text = asNonEmptyString(rObj.text) || asNonEmptyString(rObj.description) || asNonEmptyString(rObj.riesgo);
    if (!text) return;
    const level = sanitizeRiskLevel(asNonEmptyString(rObj.level) || asNonEmptyString(rObj.severity) || asNonEmptyString(rObj.nivel));
    const mitigation = asNonEmptyString(rObj.mitigation) || asNonEmptyString(rObj.mitigacion) || undefined;
    risks.push({ level, text, ...(mitigation ? { mitigation } : {}) });
  });

  const rawPhases = Array.isArray(obj.phases)
    ? obj.phases
    : Array.isArray(obj.fases)
      ? obj.fases
      : [];

  const phases: CanvasPlanPhase[] = [];
  rawPhases.slice(0, 12).forEach((p, pIdx) => {
    if (!p || typeof p !== "object") return;
    const pObj = p as Record<string, unknown>;
    const pId = asNonEmptyString(pObj.id) || `phase_${pIdx + 1}`;
    const pTitle = asNonEmptyString(pObj.title) || asNonEmptyString(pObj.titulo) || asNonEmptyString(pObj.name) || `Fase ${pIdx + 1}`;
    const pSummary = asNonEmptyString(pObj.summary) || asNonEmptyString(pObj.resumen) || asNonEmptyString(pObj.description) || undefined;
    const pStatus = sanitizePlanStepStatus(asNonEmptyString(pObj.status) || asNonEmptyString(pObj.estado));
    const pComment = asNonEmptyString(pObj.comment) || asNonEmptyString(pObj.comentario) || undefined;

    const rawSteps = Array.isArray(pObj.steps)
      ? pObj.steps
      : Array.isArray(pObj.pasos)
        ? pObj.pasos
        : Array.isArray(pObj.tasks)
          ? pObj.tasks
          : [];

    const steps: CanvasPlanStep[] = [];
    rawSteps.slice(0, 20).forEach((s, sIdx) => {
      if (typeof s === "string") {
        const stTitle = s.trim();
        if (!stTitle) return;
        steps.push({
          id: `${pId}_step_${sIdx + 1}`,
          title: stTitle,
          checked: true,
          status: "pending",
        });
        return;
      }
      if (!s || typeof s !== "object") return;
      const sObj = s as Record<string, unknown>;
      const sTitle =
        asNonEmptyString(sObj.title) ||
        asNonEmptyString(sObj.titulo) ||
        asNonEmptyString(sObj.label) ||
        asNonEmptyString(sObj.name);
      if (!sTitle) return;
      const sId = asNonEmptyString(sObj.id) || `${pId}_step_${sIdx + 1}`;
      const detail = asNonEmptyString(sObj.detail) || asNonEmptyString(sObj.detalle) || asNonEmptyString(sObj.description) || undefined;
      const target = asNonEmptyString(sObj.target) || asNonEmptyString(sObj.archivo) || asNonEmptyString(sObj.area) || undefined;
      const rawDeps = Array.isArray(sObj.dependsOn)
        ? sObj.dependsOn
        : Array.isArray(sObj.depends_on)
          ? sObj.depends_on
          : Array.isArray(sObj.depende_de)
            ? sObj.depende_de
            : [];
      const dependsOn = rawDeps.map((d) => asNonEmptyString(d)).filter(Boolean);
      const checked = typeof sObj.checked === "boolean" ? sObj.checked : true;
      const stepStatus = sanitizePlanStepStatus(asNonEmptyString(sObj.status) || asNonEmptyString(sObj.estado));
      const riskRaw = asNonEmptyString(sObj.risk) || asNonEmptyString(sObj.riesgo);
      const risk = riskRaw ? sanitizeRiskLevel(riskRaw) : undefined;
      const comment = asNonEmptyString(sObj.comment) || asNonEmptyString(sObj.comentario) || undefined;

      steps.push({
        id: sId,
        title: sTitle,
        ...(detail ? { detail } : {}),
        ...(target ? { target } : {}),
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        checked,
        status: stepStatus,
        ...(risk ? { risk } : {}),
        ...(comment ? { comment } : {}),
      });
    });

    phases.push({
      id: pId,
      title: pTitle,
      ...(pSummary ? { summary: pSummary } : {}),
      status: pStatus,
      ...(pComment ? { comment: pComment } : {}),
      steps,
    });
  });

  // Fallback si mandaron steps sueltos en la raíz sin fases
  if (phases.length === 0 && Array.isArray(obj.steps)) {
    const fallbackSteps: CanvasPlanStep[] = [];
    (obj.steps as unknown[]).slice(0, 25).forEach((s, sIdx) => {
      const txt = typeof s === "string" ? s.trim() : asNonEmptyString((s as Record<string, unknown>)?.title || (s as Record<string, unknown>)?.label);
      if (txt) {
        fallbackSteps.push({
          id: `step_${sIdx + 1}`,
          title: txt,
          checked: true,
          status: "pending",
        });
      }
    });
    if (fallbackSteps.length > 0) {
      phases.push({
        id: "phase_1",
        title: "Plan de ejecución",
        status: "pending",
        steps: fallbackSteps,
      });
    }
  }

  if (phases.length === 0 && !goal) return undefined;

  const reviewComment = asNonEmptyString(obj.reviewComment) || asNonEmptyString(obj.review_comment) || undefined;
  return {
    goal: goal || "Plan maestro",
    status,
    ...(scope.length > 0 ? { scope } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
    ...(risks.length > 0 ? { risks } : {}),
    phases,
    ...(reviewComment ? { reviewComment } : {}),
  };
}

export function planSpecToDiagramSpec(plan: CanvasPlanSpec): CanvasDiagramSpec {
  const nodes: CanvasDiagramNode[] = [];
  const edges: CanvasDiagramEdge[] = [];
  const allSteps = plan.phases.flatMap((ph) =>
    ph.steps.map((st) => ({ phase: ph, step: st }))
  );
  const stepIds = new Set(allSteps.map((x) => x.step.id));

  // Si hay pocos pasos (<= 16), mostramos pasos con sus dependencias reales; si es enorme, agrupamos por fases
  if (allSteps.length > 0 && allSteps.length <= 16) {
    plan.phases.forEach((ph, pIdx) => {
      ph.steps.forEach((st, sIdx) => {
        const tone: CanvasDiagramNodeTone = !st.checked
          ? "neutral"
          : st.status === "done"
            ? "success"
            : st.status === "in_progress"
              ? "accent"
              : st.risk === "high"
                ? "critical"
                : st.risk === "medium"
                  ? "warning"
                  : "neutral";
        nodes.push({
          id: st.id,
          label: st.title,
          subtitle: ph.title,
          group: ph.title,
          detail: st.detail || (st.target ? `Área / archivo: ${st.target}` : undefined),
          shape: "rounded",
          tone,
        });

        const explicitDeps = (st.dependsOn ?? []).filter((d) => stepIds.has(d));
        if (explicitDeps.length > 0) {
          explicitDeps.forEach((dep) => {
            edges.push({ from: dep, to: st.id, style: "solid" });
          });
        } else if (sIdx > 0) {
          edges.push({ from: ph.steps[sIdx - 1].id, to: st.id, style: "solid" });
        } else if (pIdx > 0) {
          const prevPhase = plan.phases[pIdx - 1];
          const prevLast = prevPhase.steps[prevPhase.steps.length - 1];
          if (prevLast) {
            edges.push({ from: prevLast.id, to: st.id, style: "dashed" });
          }
        }
      });
    });
  } else {
    plan.phases.forEach((ph, pIdx) => {
      const doneCount = ph.steps.filter((s) => s.status === "done").length;
      nodes.push({
        id: ph.id,
        label: ph.title,
        subtitle: `${ph.steps.length} paso(s) · ${doneCount} listos`,
        detail: ph.summary,
        shape: pIdx === 0 ? "pill" : "rounded",
        tone: ph.status === "done" ? "success" : ph.status === "in_progress" ? "accent" : "neutral",
      });
      if (pIdx > 0) {
        edges.push({
          from: plan.phases[pIdx - 1].id,
          to: ph.id,
          style: "solid",
        });
      }
    });
  }

  return {
    diagramType: "flowchart",
    direction: "TD",
    nodes,
    edges,
  };
}

function parseNumericMetricValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw
      .replace(/[$€£,\s]/g, "")
      .replace(/\b(mxn|usd|eur|un\.?|u\.?|pzs?)\b/gi, "")
      .replace(/%$/, "")
      .trim();
    if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function sanitizeMetricTone(raw: string): CanvasMetricTone {
  const low = raw.toLowerCase();
  if (low === "positive" || low === "success" || low === "ok" || low === "good") return "positive";
  if (low === "warning" || low === "warn" || low === "media" || low === "caution") return "warning";
  if (low === "critical" || low === "danger" || low === "error" || low === "alta" || low === "bad") return "critical";
  return "neutral";
}

function sanitizeChartType(raw: string): CanvasChartType {
  const low = raw.toLowerCase();
  if (low === "horizontal_bar" || low === "hbar" || low === "horizontal" || low === "ranking") {
    return "horizontal_bar";
  }
  if (low === "line" || low === "linea" || low === "línea" || low === "trend") return "line";
  if (low === "area" || low === "área") return "area";
  if (low === "donut" || low === "pie" || low === "dona" || low === "pastel" || low === "ring") {
    return "donut";
  }
  return "bar";
}

function sanitizeValueFormat(raw: string, unit?: string): CanvasValueFormat {
  const low = raw.toLowerCase();
  if (low === "currency" || low === "moneda" || low === "money") return "currency";
  if (low === "percent" || low === "percentage" || low === "porcentaje") return "percent";
  if (low === "compact" || low === "compacto") return "compact";
  if (low === "number" || low === "numero" || low === "número") return "number";
  if (unit && /(\$|mxn|usd|eur)/i.test(unit)) return "currency";
  if (unit && /%/.test(unit)) return "percent";
  return "number";
}

export function sanitizeDashboardSpec(raw: unknown): CanvasDashboardSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  const rawKpis = Array.isArray(obj.kpis)
    ? obj.kpis
    : Array.isArray(obj.metrics)
      ? obj.metrics
      : Array.isArray(obj.tarjetas)
        ? obj.tarjetas
        : [];

  const kpis: CanvasKpiItem[] = [];
  rawKpis.slice(0, 8).forEach((k, idx) => {
    if (!k || typeof k !== "object") return;
    const kObj = k as Record<string, unknown>;
    const label = asNonEmptyString(kObj.label) || asNonEmptyString(kObj.title) || asNonEmptyString(kObj.nombre);
    const value = asNonEmptyString(kObj.value) || asNonEmptyString(kObj.valor);
    if (!label || !value) return;
    const delta = asNonEmptyString(kObj.delta) || asNonEmptyString(kObj.change) || asNonEmptyString(kObj.cambio) || undefined;
    const rawDeltaTone = (asNonEmptyString(kObj.deltaTone) || asNonEmptyString(kObj.delta_tone)).toLowerCase();
    const deltaTone: CanvasKpiItem["deltaTone"] =
      rawDeltaTone === "positive" || rawDeltaTone === "up"
        ? "positive"
        : rawDeltaTone === "negative" || rawDeltaTone === "down"
          ? "negative"
          : delta
            ? delta.trim().startsWith("-")
              ? "negative"
              : delta.trim().startsWith("+")
                ? "positive"
                : "neutral"
            : undefined;
    const tone = sanitizeMetricTone(asNonEmptyString(kObj.tone) || asNonEmptyString(kObj.tono));
    const caption = asNonEmptyString(kObj.caption) || asNonEmptyString(kObj.sub) || asNonEmptyString(kObj.nota) || undefined;
    const rawProg = parseNumericMetricValue(kObj.progress ?? kObj.ratio);
    const progress =
      rawProg !== null ? Math.max(0, Math.min(100, rawProg <= 1 && rawProg > 0 ? rawProg * 100 : rawProg)) : undefined;

    kpis.push({
      id: asNonEmptyString(kObj.id) || `kpi_${idx + 1}`,
      label,
      value,
      ...(delta ? { delta } : {}),
      ...(deltaTone ? { deltaTone } : {}),
      tone,
      ...(caption ? { caption } : {}),
      ...(progress !== undefined ? { progress } : {}),
    });
  });

  const rawChartsList = Array.isArray(obj.charts)
    ? obj.charts
    : Array.isArray(obj.graficas)
      ? obj.graficas
      : Array.isArray(obj.graphs)
        ? obj.graphs
        : obj.chart && typeof obj.chart === "object"
          ? [obj.chart]
          : [];

  const charts: CanvasChartSpec[] = [];
  rawChartsList.slice(0, 6).forEach((c, cIdx) => {
    if (!c || typeof c !== "object") return;
    const cObj = c as Record<string, unknown>;
    const title = asNonEmptyString(cObj.title) || asNonEmptyString(cObj.titulo) || `Gráfica ${cIdx + 1}`;
    const subtitle = asNonEmptyString(cObj.subtitle) || asNonEmptyString(cObj.subtitulo) || undefined;
    const chartType = sanitizeChartType(
      asNonEmptyString(cObj.chartType) || asNonEmptyString(cObj.chart_type) || asNonEmptyString(cObj.type) || asNonEmptyString(cObj.tipo)
    );
    const unit = asNonEmptyString(cObj.unit) || asNonEmptyString(cObj.unidad) || undefined;
    const valueFormat = sanitizeValueFormat(
      asNonEmptyString(cObj.valueFormat) || asNonEmptyString(cObj.value_format) || asNonEmptyString(cObj.format),
      unit
    );

    let categories: string[] = Array.isArray(cObj.categories)
      ? cObj.categories.map((x) => asNonEmptyString(x)).filter(Boolean)
      : Array.isArray(cObj.labels)
        ? cObj.labels.map((x) => asNonEmptyString(x)).filter(Boolean)
        : Array.isArray(cObj.categorias)
          ? cObj.categorias.map((x) => asNonEmptyString(x)).filter(Boolean)
          : [];

    const series: CanvasChartSeries[] = [];
    const rawSeries = Array.isArray(cObj.series) ? cObj.series : [];

    if (rawSeries.length > 0) {
      rawSeries.slice(0, 6).forEach((s, sIdx) => {
        if (!s || typeof s !== "object") return;
        const sObj = s as Record<string, unknown>;
        const sName = asNonEmptyString(sObj.name) || asNonEmptyString(sObj.label) || asNonEmptyString(sObj.nombre) || `Serie ${sIdx + 1}`;
        const rawVals = Array.isArray(sObj.values)
          ? sObj.values
          : Array.isArray(sObj.data)
            ? sObj.data
            : Array.isArray(sObj.valores)
              ? sObj.valores
              : [];
        const vals = rawVals.map((v) => parseNumericMetricValue(v) ?? 0);
        if (vals.length === 0) return;
        const rawTone = (asNonEmptyString(sObj.tone) || asNonEmptyString(sObj.tono)).toLowerCase();
        const tone: CanvasChartSeries["tone"] =
          rawTone === "accent" ? "accent" : rawTone ? sanitizeMetricTone(rawTone) : undefined;
        series.push({
          id: asNonEmptyString(sObj.id) || `s_${sIdx + 1}`,
          name: sName,
          values: vals,
          ...(tone ? { tone } : {}),
        });
      });
    } else if (Array.isArray(cObj.values)) {
      const vals = cObj.values.map((v) => parseNumericMetricValue(v) ?? 0);
      if (vals.length > 0) {
        series.push({
          id: "s_1",
          name: asNonEmptyString(cObj.seriesName) || asNonEmptyString(cObj.series_name) || title,
          values: vals,
          tone: "accent",
        });
      }
    } else {
      // Formato flexible data: [{ label/name/x, value/y }]
      const rawPoints = Array.isArray(cObj.data)
        ? cObj.data
        : Array.isArray(cObj.points)
          ? cObj.points
          : Array.isArray(cObj.datos)
            ? cObj.datos
            : [];
      if (rawPoints.length > 0) {
        const ptCats: string[] = [];
        const ptVals: number[] = [];
        rawPoints.slice(0, 32).forEach((pt, ptIdx) => {
          if (!pt || typeof pt !== "object") return;
          const ptObj = pt as Record<string, unknown>;
          const lbl =
            asNonEmptyString(ptObj.label) ||
            asNonEmptyString(ptObj.name) ||
            asNonEmptyString(ptObj.category) ||
            asNonEmptyString(ptObj.x) ||
            `Item ${ptIdx + 1}`;
          const num =
            parseNumericMetricValue(ptObj.value ?? ptObj.y ?? ptObj.total ?? ptObj.amount ?? ptObj.valor) ?? 0;
          ptCats.push(lbl);
          ptVals.push(num);
        });
        if (ptCats.length > 0) {
          if (categories.length === 0) categories = ptCats;
          series.push({
            id: "s_1",
            name: asNonEmptyString(cObj.seriesName) || unit || title,
            values: ptVals,
            tone: "accent",
          });
        }
      }
    }

    if (series.length === 0) return;
    const maxLen = Math.max(categories.length, ...series.map((s) => s.values.length));
    if (maxLen === 0) return;
    if (categories.length === 0) {
      categories = Array.from({ length: maxLen }, (_, idx) => `#${idx + 1}`);
    }
    const targetLen = Math.min(categories.length, ...series.map((s) => s.values.length), 32);
    if (targetLen === 0) return;

    const cleanCats = categories.slice(0, targetLen);
    const cleanSeries = series.map((s) => ({
      ...s,
      values: s.values.slice(0, targetLen),
    }));

    const targetValue = parseNumericMetricValue(cObj.targetValue ?? cObj.target_value ?? cObj.meta);
    const targetLabel = asNonEmptyString(cObj.targetLabel) || asNonEmptyString(cObj.target_label) || undefined;

    charts.push({
      id: asNonEmptyString(cObj.id) || `chart_${cIdx + 1}`,
      title,
      ...(subtitle ? { subtitle } : {}),
      chartType,
      categories: cleanCats,
      series: cleanSeries,
      ...(unit ? { unit } : {}),
      valueFormat,
      ...(targetValue !== null ? { targetValue } : {}),
      ...(targetLabel ? { targetLabel } : {}),
    });
  });

  const rawInsights = Array.isArray(obj.insights)
    ? obj.insights
    : Array.isArray(obj.hallazgos)
      ? obj.hallazgos
      : [];
  const insights: CanvasInsightItem[] = [];
  rawInsights.slice(0, 8).forEach((ins) => {
    if (typeof ins === "string") {
      if (ins.trim()) insights.push({ tone: "info", text: ins.trim() });
      return;
    }
    if (!ins || typeof ins !== "object") return;
    const iObj = ins as Record<string, unknown>;
    const text = asNonEmptyString(iObj.text) || asNonEmptyString(iObj.description) || asNonEmptyString(iObj.contenido);
    if (!text) return;
    const rawTone = (asNonEmptyString(iObj.tone) || asNonEmptyString(iObj.tono)).toLowerCase();
    const tone: CanvasInsightItem["tone"] =
      rawTone === "positive" || rawTone === "success"
        ? "positive"
        : rawTone === "warning" || rawTone === "warn"
          ? "warning"
          : rawTone === "critical" || rawTone === "danger" || rawTone === "error"
            ? "critical"
            : "info";
    const title = asNonEmptyString(iObj.title) || asNonEmptyString(iObj.titulo) || undefined;
    insights.push({ tone, ...(title ? { title } : {}), text });
  });

  if (kpis.length === 0 && charts.length === 0 && insights.length === 0) {
    return undefined;
  }

  return {
    kpis,
    charts,
    ...(insights.length > 0 ? { insights } : {}),
  };
}

function normalizeFormPurpose(raw: unknown, hasQuizMarkers: boolean): CanvasFormPurpose {
  const low = asNonEmptyString(raw).toLowerCase();
  if (
    low === "study_quiz" ||
    low === "quiz" ||
    low === "exam" ||
    low === "examen" ||
    low === "cuestionario" ||
    low === "practica" ||
    low === "study" ||
    low === "repaso" ||
    low === "autoevaluacion"
  ) {
    return "study_quiz";
  }
  if (low === "survey" || low === "encuesta" || low === "feedback") {
    return "survey";
  }
  if (low === "data_capture" || low === "capture" || low === "form" || low === "formulario" || low === "registro") {
    return "data_capture";
  }
  return hasQuizMarkers ? "study_quiz" : "data_capture";
}

function normalizeFormFieldType(rawType: unknown, rawObj?: Record<string, unknown>): CanvasFormFieldType {
  const low = asNonEmptyString(rawType)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
  if (low === "true_false" || low === "boolean" || low === "bool" || low === "verdadero_falso" || low === "vf") {
    return "true_false";
  }
  if (
    low === "multi_choice" ||
    low === "multi" ||
    low === "checkbox" ||
    low === "checkboxes" ||
    low === "multiple_select" ||
    low === "multiselect" ||
    low === "opcion_multiple_varias"
  ) {
    return "multi_choice";
  }
  if (low === "multiple_choice" || low === "opcion_multiple") {
    const hasMultiCorrect = Boolean(
      rawObj &&
        (Array.isArray(rawObj.correctIndices) ||
          Array.isArray(rawObj.correct_indices) ||
          rawObj.multi === true ||
          rawObj.allowMultiple === true)
    );
    return hasMultiCorrect ? "multi_choice" : "single_choice";
  }
  if (low === "single_choice" || low === "single" || low === "choice" || low === "mcq" || low === "radio" || low === "opcion_unica") {
    return "single_choice";
  }
  if (low === "select" || low === "dropdown" || low === "lista" || low === "desplegable") {
    return "select";
  }
  if (low === "number" || low === "numeric" || low === "numero" || low === "integer" || low === "float" || low === "decimal") {
    return "number";
  }
  if (low === "rating" || low === "stars" || low === "scale" || low === "escala" || low === "calificacion") {
    return "rating";
  }
  if (low === "long_text" || low === "textarea" || low === "paragraph" || low === "essay" || low === "open_ended" || low === "abierta" || low === "texto_largo") {
    return "long_text";
  }
  if (low === "short_text" || low === "text" || low === "short" || low === "input" || low === "texto_corto" || low === "open") {
    return "short_text";
  }
  if (rawObj && (Array.isArray(rawObj.options) || Array.isArray(rawObj.opciones) || Array.isArray(rawObj.choices))) {
    return "single_choice";
  }
  return "short_text";
}

function resolveOptionIndex(
  rawCorrect: unknown,
  options: string[],
  fieldType: CanvasFormFieldType
): number | undefined {
  if (typeof rawCorrect === "number" && Number.isInteger(rawCorrect)) {
    if (rawCorrect >= 0 && rawCorrect < options.length) return rawCorrect;
    return undefined;
  }
  if (typeof rawCorrect === "boolean" && fieldType === "true_false") {
    return rawCorrect ? 0 : 1;
  }
  const s = asNonEmptyString(rawCorrect);
  if (!s) return undefined;
  if (/^\d+$/.test(s)) {
    const idx = Number.parseInt(s, 10);
    if (idx >= 0 && idx < options.length) return idx;
  }
  if (fieldType === "true_false") {
    const low = s.toLowerCase();
    if (["true", "verdadero", "v", "si", "sí", "yes"].includes(low)) return 0;
    if (["false", "falso", "f", "no"].includes(low)) return 1;
  }
  // Single letter "A"/"B"/"C"/"D"
  if (/^[a-z]$/i.test(s) && options.length >= 2) {
    const idx = s.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }
  const normTarget = s.toLowerCase();
  const exactIdx = options.findIndex((o) => o.toLowerCase() === normTarget);
  if (exactIdx >= 0) return exactIdx;
  const partialIdx = options.findIndex((o) => o.toLowerCase().includes(normTarget) || normTarget.includes(o.toLowerCase()));
  return partialIdx >= 0 ? partialIdx : undefined;
}

export function isFormFieldAnswered(
  field: CanvasFormField,
  value: CanvasFormAnswerValue | undefined
): boolean {
  if (value === undefined || value === null) return false;
  if (field.type === "multi_choice") {
    return Array.isArray(value) && value.length > 0;
  }
  if (field.type === "single_choice" || field.type === "true_false" || field.type === "select") {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0;
    if (typeof value === "boolean") return true;
    return typeof value === "string" && value.trim().length > 0;
  }
  if (field.type === "rating") {
    return typeof value === "number" && Number.isFinite(value) && value >= (field.min ?? 1);
  }
  if (field.type === "number") {
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value.trim()));
  }
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveSelectedIndex(
  field: CanvasFormField,
  value: CanvasFormAnswerValue | undefined
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const options = field.options ?? [];
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 0 && (options.length === 0 || value < options.length) ? value : undefined;
  }
  if (typeof value === "boolean" && field.type === "true_false") {
    return value ? 0 : 1;
  }
  if (typeof value === "string") {
    return resolveOptionIndex(value, options, field.type);
  }
  return undefined;
}

export function evaluateFormFieldState(
  field: CanvasFormField,
  rawAns: CanvasFormAnswerValue | undefined
): "correct" | "wrong" | "open" {
  if (field.type === "single_choice" || field.type === "true_false" || field.type === "select") {
    if (typeof field.correctIndex !== "number") return "open";
    const picked = resolveSelectedIndex(field, rawAns);
    return picked !== undefined && picked === field.correctIndex ? "correct" : "wrong";
  }

  if (field.type === "multi_choice") {
    if (!Array.isArray(field.correctIndices) || field.correctIndices.length === 0) return "open";
    const target = Array.from(new Set(field.correctIndices)).sort((a, b) => a - b);
    const picked = Array.isArray(rawAns)
      ? Array.from(
          new Set(rawAns.filter((n): n is number => typeof n === "number" && Number.isInteger(n)))
        ).sort((a, b) => a - b)
      : [];
    return picked.length === target.length && picked.every((v, idx) => v === target[idx])
      ? "correct"
      : "wrong";
  }

  if (field.type === "number" && field.expectedAnswer !== undefined) {
    const expectedNum = parseNumericMetricValue(field.expectedAnswer);
    if (expectedNum !== null) {
      const userNum =
        typeof rawAns === "number"
          ? rawAns
          : typeof rawAns === "string"
            ? parseNumericMetricValue(rawAns)
            : null;
      return userNum !== null &&
        Math.abs(userNum - expectedNum) <= 1e-3 * Math.max(1, Math.abs(expectedNum))
        ? "correct"
        : "wrong";
    }
  }

  return "open";
}

export function gradeStudyForm(form: CanvasFormSpec): CanvasFormScore {
  const answers = form.answers ?? {};
  let earned = 0;
  let total = 0;
  let correctCount = 0;
  let gradableCount = 0;
  let openCount = 0;

  for (const field of form.fields) {
    const pts = typeof field.points === "number" && field.points > 0 ? field.points : 1;
    const outcome = evaluateFormFieldState(field, answers[field.id]);
    if (outcome === "open") {
      openCount += 1;
      continue;
    }
    gradableCount += 1;
    total += pts;
    if (outcome === "correct") {
      earned += pts;
      correctCount += 1;
    }
  }

  const percent = total > 0 ? Math.round((earned / total) * 100) : 0;
  const passed =
    typeof form.passingScorePercent === "number" && gradableCount > 0
      ? percent >= form.passingScorePercent
      : undefined;

  return {
    earned,
    total,
    correctCount,
    gradableCount,
    openCount,
    percent,
    ...(passed !== undefined ? { passed } : {}),
  };
}

export function formatFormAnswerForDisplay(
  field: CanvasFormField,
  value: CanvasFormAnswerValue | undefined
): string {
  if (!isFormFieldAnswered(field, value)) return "Sin respuesta";
  const options = field.options ?? [];
  if (field.type === "multi_choice" && Array.isArray(value)) {
    const labels = value
      .filter((n): n is number => typeof n === "number" && n >= 0 && n < options.length)
      .map((n) => options[n]);
    return labels.length > 0 ? labels.join(", ") : value.join(", ");
  }
  if (field.type === "single_choice" || field.type === "true_false" || field.type === "select") {
    const idx = resolveSelectedIndex(field, value);
    if (idx !== undefined && options[idx] !== undefined) return options[idx];
  }
  if (field.type === "rating") {
    const max = field.max ?? 5;
    return `${String(value)} / ${max}`;
  }
  return String(value ?? "");
}

export function sanitizeFormSpec(raw: unknown): CanvasFormSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  const rawFields = Array.isArray(obj.fields)
    ? obj.fields
    : Array.isArray(obj.questions)
      ? obj.questions
      : Array.isArray(obj.preguntas)
        ? obj.preguntas
        : Array.isArray(obj.campos)
          ? obj.campos
          : Array.isArray(obj.items)
            ? obj.items
            : [];

  const fields: CanvasFormField[] = [];
  const usedIds = new Set<string>();
  let hasQuizMarkers = false;

  rawFields.slice(0, 35).forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    const f = item as Record<string, unknown>;
    const label =
      asNonEmptyString(f.label) ||
      asNonEmptyString(f.question) ||
      asNonEmptyString(f.pregunta) ||
      asNonEmptyString(f.prompt) ||
      asNonEmptyString(f.title) ||
      asNonEmptyString(f.titulo) ||
      asNonEmptyString(f.texto);
    if (!label) return;

    const rawType = f.type ?? f.tipo ?? f.kind;
    let ftype = normalizeFormFieldType(rawType, f);

    const rawOptions = Array.isArray(f.options)
      ? f.options
      : Array.isArray(f.opciones)
        ? f.opciones
        : Array.isArray(f.choices)
          ? f.choices
          : [];
    let options = rawOptions
      .slice(0, 12)
      .map((opt) => {
        if (typeof opt === "string" || typeof opt === "number" || typeof opt === "boolean") {
          return String(opt).trim();
        }
        if (opt && typeof opt === "object") {
          const o = opt as Record<string, unknown>;
          return (
            asNonEmptyString(o.label) ||
            asNonEmptyString(o.text) ||
            asNonEmptyString(o.value) ||
            asNonEmptyString(o.texto)
          );
        }
        return "";
      })
      .filter(Boolean);

    if (ftype === "true_false" && options.length === 0) {
      options = ["Verdadero", "Falso"];
    }
    if ((ftype === "single_choice" || ftype === "multi_choice" || ftype === "select") && options.length === 0) {
      ftype = "short_text";
    }

    const baseId =
      asNonEmptyString(f.id) || `f_${idx + 1}`;
    let fid = baseId.replace(/[^a-zA-Z0-9_-]+/g, "_");
    if (!fid) fid = `f_${idx + 1}`;
    if (usedIds.has(fid)) fid = `${fid}_${idx + 1}`;
    usedIds.add(fid);

    const rawCorrectIdx =
      f.correctIndex !== undefined
        ? f.correctIndex
        : f.correct_index !== undefined
          ? f.correct_index
          : f.correctAnswerIndex !== undefined
            ? f.correctAnswerIndex
            : f.indice_correcto !== undefined
              ? f.indice_correcto
              : f.correct_option !== undefined
                ? f.correct_option
                : f.correct_answer !== undefined
                  ? f.correct_answer
                  : f.correctAnswer;

    const correctIndex =
      options.length > 0 ? resolveOptionIndex(rawCorrectIdx, options, ftype) : undefined;

    const rawCorrectIndices = Array.isArray(f.correctIndices)
      ? f.correctIndices
      : Array.isArray(f.correct_indices)
        ? f.correct_indices
        : Array.isArray(f.correct_answers)
          ? f.correct_answers
          : undefined;
    let correctIndices: number[] | undefined;
    if (rawCorrectIndices && options.length > 0) {
      const resolved = rawCorrectIndices
        .map((c) => resolveOptionIndex(c, options, ftype))
        .filter((n): n is number => typeof n === "number" && n >= 0 && n < options.length);
      if (resolved.length > 0) {
        correctIndices = Array.from(new Set(resolved)).sort((a, b) => a - b);
      }
    }

    const expectedAnswer =
      asNonEmptyString(f.expectedAnswer) ||
      asNonEmptyString(f.expected_answer) ||
      asNonEmptyString(f.model_answer) ||
      asNonEmptyString(f.respuesta_esperada) ||
      undefined;
    const hint = asNonEmptyString(f.hint) || asNonEmptyString(f.pista) || undefined;
    const explanation = asNonEmptyString(f.explanation) || asNonEmptyString(f.explicacion) || undefined;
    const placeholder = asNonEmptyString(f.placeholder) || undefined;

    if (
      correctIndex !== undefined ||
      (correctIndices && correctIndices.length > 0) ||
      expectedAnswer ||
      explanation ||
      hint
    ) {
      hasQuizMarkers = true;
    }

    const pointsRaw = typeof f.points === "number" ? f.points : typeof f.puntos === "number" ? f.puntos : undefined;
    const points = pointsRaw !== undefined && Number.isFinite(pointsRaw) && pointsRaw > 0 ? pointsRaw : undefined;

    const minRaw = typeof f.min === "number" && Number.isFinite(f.min) ? f.min : undefined;
    const maxRaw = typeof f.max === "number" && Number.isFinite(f.max) ? f.max : undefined;

    fields.push({
      id: fid,
      label,
      type: ftype,
      required: f.required === true || f.obligatorio === true,
      ...(placeholder ? { placeholder } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(correctIndex !== undefined ? { correctIndex } : {}),
      ...(correctIndices ? { correctIndices } : {}),
      ...(expectedAnswer ? { expectedAnswer } : {}),
      ...(hint ? { hint } : {}),
      ...(explanation ? { explanation } : {}),
      ...(points !== undefined ? { points } : {}),
      ...(minRaw !== undefined ? { min: minRaw } : {}),
      ...(maxRaw !== undefined ? { max: maxRaw } : {}),
    });
  });

  if (fields.length === 0) return undefined;

  const purpose = normalizeFormPurpose(
    obj.purpose ?? obj.proposito ?? obj.mode ?? obj.form_type,
    hasQuizMarkers
  );
  const description =
    asNonEmptyString(obj.description) ||
    asNonEmptyString(obj.descripcion) ||
    asNonEmptyString(obj.instructions) ||
    asNonEmptyString(obj.instrucciones) ||
    undefined;
  const submitLabel =
    asNonEmptyString(obj.submitLabel) ||
    asNonEmptyString(obj.submit_label) ||
    undefined;
  const rawPass = obj.passingScorePercent ?? obj.passing_score_percent ?? obj.min_score;
  const passingScorePercent =
    typeof rawPass === "number" && Number.isFinite(rawPass) && rawPass > 0 && rawPass <= 100
      ? Math.round(rawPass)
      : undefined;
  const showHints =
    typeof obj.showHints === "boolean"
      ? obj.showHints
      : typeof obj.show_hints === "boolean"
        ? obj.show_hints
        : purpose === "study_quiz";

  // Preservar respuestas guardadas si el formulario ya fue interactuado
  const fieldIds = new Set(fields.map((f) => f.id));
  let answers: Record<string, CanvasFormAnswerValue> | undefined;
  if (obj.answers && typeof obj.answers === "object" && !Array.isArray(obj.answers)) {
    const cleanAnswers: Record<string, CanvasFormAnswerValue> = {};
    for (const [k, v] of Object.entries(obj.answers as Record<string, unknown>)) {
      if (!fieldIds.has(k)) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        cleanAnswers[k] = v;
      } else if (Array.isArray(v)) {
        const nums = v.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
        if (nums.length > 0) cleanAnswers[k] = nums;
      }
    }
    if (Object.keys(cleanAnswers).length > 0) {
      answers = cleanAnswers;
    }
  }

  const checkedLocally = obj.checkedLocally === true ? true : undefined;
  const submitted = obj.submitted === true ? true : undefined;
  const submittedAt = asNonEmptyString(obj.submittedAt) || undefined;
  const rawScore = obj.score && typeof obj.score === "object" ? (obj.score as CanvasFormScore) : undefined;

  return {
    purpose,
    ...(description ? { description } : {}),
    ...(submitLabel ? { submitLabel } : {}),
    ...(passingScorePercent !== undefined ? { passingScorePercent } : {}),
    ...(showHints !== undefined ? { showHints } : {}),
    fields,
    ...(answers ? { answers } : {}),
    ...(checkedLocally ? { checkedLocally } : {}),
    ...(submitted ? { submitted } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(rawScore && typeof rawScore.earned === "number" && typeof rawScore.total === "number"
      ? { score: rawScore }
      : {}),
  };
}

export function sanitizeCanvasArtifact(
  raw: unknown,
  fallbackId?: string
): CanvasArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const hasExplicitTable = Boolean(
    obj.columns || obj.columnas || obj.rows || obj.filas
  );
  const hasDashboardHint = Boolean(
    obj.dashboard || obj.kpis || obj.charts || obj.graficas || obj.chart
  );
  const hasFormHint = Boolean(
    obj.form ||
      obj.formulario ||
      (!hasExplicitTable && (obj.fields || obj.questions || obj.preguntas || obj.campos))
  );
  const title =
    asNonEmptyString(obj.title) ||
    asNonEmptyString(obj.titulo) ||
    (obj.plan || obj.phases || obj.fases
      ? "Plan de ejecución"
      : obj.diagram || obj.diagrama || obj.nodes || obj.mermaid
        ? "Diagrama visual"
        : hasDashboardHint
          ? "Dashboard de análisis"
          : hasFormHint
            ? "Cuestionario interactivo"
            : "Tabla en Canvas");
  const subtitle = asNonEmptyString(obj.subtitle) || asNonEmptyString(obj.subtitulo) || undefined;
  const summary = asNonEmptyString(obj.summary) || asNonEmptyString(obj.resumen) || undefined;
  const markdown = asNonEmptyString(obj.markdown) || asNonEmptyString(obj.contenido) || undefined;

  const rawKind = (asNonEmptyString(obj.kind) || asNonEmptyString(obj.tipo)).toLowerCase();
  let kind: CanvasKind = "table";
  if (rawKind === "comparison" || rawKind === "comparativa") kind = "comparison";
  else if (rawKind === "document" || rawKind === "documento") kind = "document";
  else if (rawKind === "diagram" || rawKind === "diagrama" || rawKind === "flowchart") kind = "diagram";
  else if (rawKind === "plan" || rawKind === "roadmap") kind = "plan";
  else if (rawKind === "dashboard" || rawKind === "chart" || rawKind === "grafica" || rawKind === "tablero") kind = "dashboard";
  else if (rawKind === "form" || rawKind === "quiz" || rawKind === "cuestionario" || rawKind === "formulario" || rawKind === "examen" || rawKind === "survey" || rawKind === "encuesta") kind = "form";
  else if (obj.plan || obj.phases || obj.fases) kind = "plan";
  else if (obj.diagram || obj.diagrama || obj.nodes || obj.nodos || obj.mermaid || obj.mermaid_code) kind = "diagram";
  else if (hasFormHint) kind = "form";
  else if (hasDashboardHint) kind = "dashboard";
  else if (/compar|vs|alternativ|opci/i.test(title)) kind = "comparison";

  const nowIso = asNonEmptyString(obj.updatedAt) || new Date().toISOString();
  const canvasId = asNonEmptyString(obj.id) || fallbackId || `canvas_${Date.now()}`;

  // 1) Artefacto tipo Plan de Acción (estilo Antigravity)
  if (kind === "plan" || obj.plan || obj.phases || obj.fases) {
    const planSource = obj.plan && typeof obj.plan === "object" ? obj.plan : obj;
    const plan = sanitizePlanSpec(planSource, summary || title);
    if (plan) {
      return {
        id: canvasId,
        title,
        subtitle,
        kind: "plan",
        columns: [],
        rows: [],
        summary: summary || plan.goal,
        markdown,
        plan,
        updatedAt: nowIso,
      };
    }
  }

  // 2) Artefacto tipo Diagrama visual / Flujo
  if (kind === "diagram" || obj.diagram || obj.diagrama || obj.nodes || obj.nodos || obj.mermaid || obj.mermaid_code) {
    const diagramSource = obj.diagram && typeof obj.diagram === "object"
      ? obj.diagram
      : obj.diagrama && typeof obj.diagrama === "object"
        ? obj.diagrama
        : obj;
    const diagram = sanitizeDiagramSpec(diagramSource);
    if (diagram) {
      return {
        id: canvasId,
        title,
        subtitle,
        kind: "diagram",
        columns: [],
        rows: [],
        summary,
        markdown,
        diagram,
        updatedAt: nowIso,
      };
    }
  }

  // 2.5) Artefacto tipo Formulario / Cuestionario Interactivo
  if (kind === "form" || hasFormHint) {
    const formSource =
      obj.form && typeof obj.form === "object"
        ? obj.form
        : obj.formulario && typeof obj.formulario === "object"
          ? obj.formulario
          : obj;
    const formSpec = sanitizeFormSpec(formSource);
    if (formSpec) {
      return {
        id: canvasId,
        title,
        subtitle,
        kind: "form",
        columns: [],
        rows: [],
        summary: summary || formSpec.description,
        markdown,
        form: formSpec,
        updatedAt: nowIso,
      };
    }
  }

  // 3) Artefacto tipo Mini-Dashboard (KPIs + gráficas + tabla de respaldo opcional)
  let dashboardSpec: CanvasDashboardSpec | undefined;
  if (kind === "dashboard" || hasDashboardHint) {
    const dashSource = obj.dashboard && typeof obj.dashboard === "object" ? obj.dashboard : obj;
    dashboardSpec = sanitizeDashboardSpec(dashSource);
  }

  const rawCols = Array.isArray(obj.columns)
    ? obj.columns
    : Array.isArray(obj.columnas)
      ? obj.columnas
      : Array.isArray(obj.headers)
        ? obj.headers
        : Array.isArray(obj.encabezados)
          ? obj.encabezados
          : [];
  const rawRows = Array.isArray(obj.rows)
    ? obj.rows
    : Array.isArray(obj.filas)
      ? obj.filas
      : Array.isArray(obj.data)
        ? obj.data
        : Array.isArray(obj.datos)
          ? obj.datos
          : Array.isArray(obj.items)
            ? obj.items
            : [];

  if (dashboardSpec && rawCols.length === 0 && rawRows.length === 0) {
    return {
      id: canvasId,
      title,
      subtitle,
      kind: "dashboard",
      columns: [],
      rows: [],
      summary,
      markdown,
      dashboard: dashboardSpec,
      updatedAt: nowIso,
    };
  }

  // Fallback: if no explicit columns/rows, try extracting a Markdown or HTML table or Mermaid diagram if provided
  if (rawCols.length === 0 && rawRows.length === 0 && markdown) {
    const mermaidMatch = markdown.match(/```mermaid\s*([\s\S]*?)```/i);
    if (mermaidMatch) {
      const parsedMermaid = parseMermaidToDiagramSpec(mermaidMatch[1]);
      if (parsedMermaid) {
        return {
          id: canvasId,
          title,
          subtitle,
          kind: "diagram",
          columns: [],
          rows: [],
          summary,
          markdown,
          diagram: parsedMermaid,
          updatedAt: nowIso,
        };
      }
    }
    const parsedTable = extractFirstMarkdownTable(markdown) ?? extractFirstHtmlTable(markdown);
    if (parsedTable) {
      return markdownTableToCanvasArtifact(parsedTable, {
        id: asNonEmptyString(obj.id) || fallbackId,
        title,
        subtitle,
        kind,
        summary,
      });
    }
    return {
      id: canvasId,
      title,
      subtitle,
      kind: "document",
      columns: [],
      rows: [],
      summary,
      markdown: cleanVisibleReply(markdown) || markdown,
      updatedAt: nowIso,
    };
  }

  // Derive columns from explicit columns OR from first object row
  const usedIds = new Set<string>();
  const rawColMeta: Array<{
    sourceKeys: string[];
    label: string;
    explicitAlign?: string;
    explicitKind?: CanvasColumnKind;
  }> = [];

  if (rawCols.length > 0) {
    rawCols.forEach((c, idx) => {
      if (typeof c === "string") {
        const rawLabel = c.trim();
        const label = cleanCanvasHeaderLabel(rawLabel, `Columna ${idx + 1}`);
        rawColMeta.push({ sourceKeys: Array.from(new Set([rawLabel, label].filter(Boolean))), label });
      } else if (c && typeof c === "object") {
        const cObj = c as Record<string, unknown>;
        const rawId =
          asNonEmptyString(cObj.id) ||
          asNonEmptyString(cObj.key) ||
          asNonEmptyString(cObj.accessorKey) ||
          asNonEmptyString(cObj.accessor) ||
          asNonEmptyString(cObj.field) ||
          asNonEmptyString(cObj.dataIndex) ||
          asNonEmptyString(cObj.clave) ||
          asNonEmptyString(cObj.slug);
        const rawLabel =
          asNonEmptyString(cObj.label) ||
          asNonEmptyString(cObj.header) ||
          asNonEmptyString(cObj.title) ||
          asNonEmptyString(cObj.titulo) ||
          asNonEmptyString(cObj.encabezado) ||
          asNonEmptyString(cObj.name) ||
          asNonEmptyString(cObj.nombre) ||
          asNonEmptyString(cObj.text) ||
          asNonEmptyString(cObj.texto) ||
          rawId;
        const label = cleanCanvasHeaderLabel(rawLabel, `Columna ${idx + 1}`);
        const rawColKind = asNonEmptyString(cObj.kind) || asNonEmptyString(cObj.type);
        const explicitKind: CanvasColumnKind | undefined =
          rawColKind === "number" ||
          rawColKind === "currency" ||
          rawColKind === "badge" ||
          rawColKind === "rating" ||
          rawColKind === "text"
            ? rawColKind
            : undefined;
        rawColMeta.push({
          sourceKeys: Array.from(new Set([rawId, rawLabel, label].filter(Boolean))),
          label,
          explicitAlign: asNonEmptyString(cObj.align) || undefined,
          explicitKind,
        });
      }
    });
  } else if (rawRows.length > 0 && rawRows[0] && typeof rawRows[0] === "object" && !Array.isArray(rawRows[0])) {
    const first = rawRows[0] as Record<string, unknown>;
    const candidate =
      first.cells && typeof first.cells === "object" && !Array.isArray(first.cells)
        ? (first.cells as Record<string, unknown>)
        : first;
    Object.keys(candidate).forEach((k, idx) => {
      if (k === "id" || k === "highlight" || k === "badge" || k === "destacado" || k === "etiqueta") return;
      rawColMeta.push({
        sourceKeys: [k],
        label: cleanCanvasHeaderLabel(k, `Columna ${idx + 1}`),
      });
    });
  }

  if (rawColMeta.length === 0) {
    if (dashboardSpec) {
      return {
        id: canvasId,
        title,
        subtitle,
        kind: "dashboard",
        columns: [],
        rows: [],
        summary,
        markdown,
        dashboard: dashboardSpec,
        updatedAt: nowIso,
      };
    }
    if (markdown || summary) {
      return {
        id: canvasId,
        title,
        subtitle,
        kind: "document",
        columns: [],
        rows: [],
        summary,
        markdown: cleanVisibleReply(markdown || summary || "") || summary,
        updatedAt: asNonEmptyString(obj.updatedAt) || new Date().toISOString(),
      };
    }
    return null;
  }

  const colIds = rawColMeta.map((meta, idx) =>
    normalizeColId(meta.sourceKeys[0] || meta.label, idx, usedIds)
  );

  const recRowRaw = obj.recommended_row !== undefined ? obj.recommended_row : obj.recommendedRow;
  let recRowIdx: number | null = null;
  if (typeof recRowRaw === "number" && Number.isInteger(recRowRaw)) {
    recRowIdx = recRowRaw;
  } else if (typeof recRowRaw === "string" && /^-?\d+$/.test(recRowRaw.trim())) {
    recRowIdx = Number.parseInt(recRowRaw.trim(), 10);
  }
  const recBadgeDefault =
    asNonEmptyString(obj.recommended_badge) || asNonEmptyString(obj.recommendedBadge) || "Recomendado";

  // First pass: normalize all row values so we can infer column kinds from samples
  const normalizedRows: CanvasRow[] = rawRows.slice(0, 120).map((r, rIdx) => {
    const cells: Record<string, string> = {};
    let rowId = `row_${rIdx + 1}`;
    let highlight: CanvasRowHighlight = null;
    let badge: string | undefined;

    if (Array.isArray(r)) {
      colIds.forEach((cid, cIdx) => {
        cells[cid] = asNonEmptyString(r[cIdx]);
      });
    } else if (r && typeof r === "object") {
      const rObj = r as Record<string, unknown>;
      const maybeId = asNonEmptyString(rObj.id);
      if (maybeId) rowId = maybeId;

      const rawHl = asNonEmptyString(rObj.highlight) || asNonEmptyString(rObj.destacado);
      if (rawHl === "recommended" || rawHl === "warning" || rawHl === "muted") {
        highlight = rawHl;
      }
      const rawBadge = asNonEmptyString(rObj.badge) || asNonEmptyString(rObj.etiqueta);
      if (rawBadge) badge = rawBadge;

      const listSrc = (["cells", "celdas", "values", "valores", "data", "columns", "cols"] as const)
        .map((k) => rObj[k])
        .find((v): v is unknown[] => Array.isArray(v));

      if (listSrc) {
        colIds.forEach((cid, cIdx) => {
          cells[cid] = asNonEmptyString(listSrc[cIdx]);
        });
      } else {
        const cellSource =
          rObj.cells && typeof rObj.cells === "object" && !Array.isArray(rObj.cells)
            ? (rObj.cells as Record<string, unknown>)
            : rObj.celdas && typeof rObj.celdas === "object" && !Array.isArray(rObj.celdas)
              ? (rObj.celdas as Record<string, unknown>)
              : rObj;

        const normMap = new Map<string, string>();
        for (const [k, v] of Object.entries(cellSource)) {
          const nk = normLookupKey(k);
          if (nk && !normMap.has(nk)) {
            normMap.set(nk, asNonEmptyString(v));
          }
        }

        colIds.forEach((cid, cIdx) => {
          const meta = rawColMeta[cIdx];
          let val = "";
          for (const key of [cid, ...meta.sourceKeys, meta.label]) {
            if (key in cellSource) {
              val = asNonEmptyString(cellSource[key]);
              if (val || cellSource[key] === 0) break;
            }
          }
          if (!val) {
            for (const key of [cid, ...meta.sourceKeys, meta.label]) {
              const nk = normLookupKey(key);
              const candidate = nk ? normMap.get(nk) : undefined;
              if (candidate) {
                val = candidate;
                break;
              }
            }
          }
          cells[cid] = val;
        });

        if (!Object.values(cells).some(Boolean)) {
          const skipKeys = new Set(["id", "highlight", "badge", "destacado", "etiqueta"]);
          const orderedVals = Object.entries(cellSource)
            .filter(([k]) => !skipKeys.has(k))
            .map(([, v]) => asNonEmptyString(v));
          if (orderedVals.some(Boolean)) {
            colIds.forEach((cid, cIdx) => {
              cells[cid] = orderedVals[cIdx] ?? "";
            });
          }
        }
      }
    }

    if (!highlight && recRowIdx !== null && rIdx === recRowIdx) {
      highlight = "recommended";
      if (!badge) badge = recBadgeDefault;
    }

    return { id: rowId, cells, highlight, badge };
  });

  const columns: CanvasColumn[] = rawColMeta.map((meta, idx) => {
    const cid = colIds[idx];
    const samples = normalizedRows.map((row) => row.cells[cid] ?? "");
    const colKind = meta.explicitKind ?? inferColumnKind(meta.label, samples);
    const align = inferAlign(colKind, meta.explicitAlign);
    return {
      id: cid,
      label: meta.label,
      align,
      kind: colKind,
    };
  });

  return {
    id: asNonEmptyString(obj.id) || fallbackId || `canvas_${Date.now()}`,
    title,
    subtitle,
    kind: dashboardSpec ? "dashboard" : kind,
    columns,
    rows: normalizedRows,
    summary,
    markdown,
    ...(dashboardSpec ? { dashboard: dashboardSpec } : {}),
    updatedAt: asNonEmptyString(obj.updatedAt) || new Date().toISOString(),
  };
}

export function canvasArtifactToMarkdown(canvas: CanvasArtifact): string {
  const parts: string[] = [`# ${canvas.title}`];
  if (canvas.subtitle) parts.push(`_${canvas.subtitle}_`);
  if (canvas.summary) parts.push(`\n> ${canvas.summary}`);

  if (canvas.dashboard) {
    const d = canvas.dashboard;
    if (d.kpis.length > 0) {
      parts.push("\n## Indicadores Clave");
      d.kpis.forEach((k) => {
        const deltaStr = k.delta ? ` (${k.delta})` : "";
        const capStr = k.caption ? ` — ${k.caption}` : "";
        parts.push(`- **${k.label}:** ${k.value}${deltaStr}${capStr}`);
      });
    }
    d.charts.forEach((ch) => {
      parts.push(`\n### ${ch.title}`);
      if (ch.subtitle) parts.push(`_${ch.subtitle}_`);
      const headers = ["Categoría", ...ch.series.map((s) => s.name)];
      const sep = ["---", ...ch.series.map(() => "---:")];
      const rows = ch.categories.map((cat, idx) => [
        cat.replace(/\|/g, "\\|"),
        ...ch.series.map((s) => String(s.values[idx] ?? 0)),
      ]);
      parts.push(
        `\n| ${headers.join(" | ")} |\n| ${sep.join(" | ")} |\n${rows
          .map((r) => `| ${r.join(" | ")} |`)
          .join("\n")}`
      );
    });
    if (d.insights && d.insights.length > 0) {
      parts.push("\n## Hallazgos");
      d.insights.forEach((ins) => {
        parts.push(`- ${ins.title ? `**${ins.title}:** ` : ""}${ins.text}`);
      });
    }
  }

  if (canvas.plan) {
    const p = canvas.plan;
    parts.push(`\n**Objetivo:** ${p.goal}`);
    if (p.scope && p.scope.length > 0) {
      parts.push(`\n**Alcance:** ${p.scope.join(", ")}`);
    }
    p.phases.forEach((ph, pIdx) => {
      parts.push(`\n## ${pIdx + 1}. ${ph.title}`);
      if (ph.summary) parts.push(ph.summary);
      ph.steps.forEach((st) => {
        const mark = st.status === "done" || st.checked ? "x" : " ";
        const target = st.target ? ` (\`${st.target}\`)` : "";
        parts.push(`- [${mark}] **${st.title}**${target}${st.detail ? ` — ${st.detail}` : ""}`);
        if (st.comment) parts.push(`  - _Observación:_ ${st.comment}`);
      });
      if (ph.comment) parts.push(`> _Comentario en fase:_ ${ph.comment}`);
    });
    if (p.assumptions && p.assumptions.length > 0) {
      parts.push("\n### Supuestos");
      p.assumptions.forEach((a) => parts.push(`- ${a}`));
    }
    if (p.risks && p.risks.length > 0) {
      parts.push("\n### Riesgos");
      p.risks.forEach((r) =>
        parts.push(`- **[${r.level.toUpperCase()}]** ${r.text}${r.mitigation ? ` _(Mitigación: ${r.mitigation})_` : ""}`)
      );
    }
  }

  if (canvas.diagram) {
    const mermaidCode = diagramSpecToMermaid(canvas.diagram);
    if (mermaidCode) {
      parts.push(`\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``);
    }
  }

  if (canvas.form) {
    const f = canvas.form;
    if (f.description && f.description !== canvas.summary) {
      parts.push(`\n${f.description}`);
    }
    if (f.score && f.score.gradableCount > 0) {
      parts.push(
        `\n**Resultado:** ${f.score.correctCount}/${f.score.gradableCount} correctas (${f.score.earned}/${f.score.total} pts · ${f.score.percent}%)`
      );
    }
    f.fields.forEach((field, idx) => {
      parts.push(`\n### ${idx + 1}. ${field.label}${field.required ? " *" : ""}`);
      const userVal = f.answers?.[field.id];
      const showAnswerKey = Boolean(f.checkedLocally || f.submitted);
      if (field.options && field.options.length > 0) {
        const pickedSingle = resolveSelectedIndex(field, userVal);
        const pickedMulti = Array.isArray(userVal) ? new Set(userVal) : null;
        field.options.forEach((opt, oIdx) => {
          const isPicked =
            field.type === "multi_choice"
              ? Boolean(pickedMulti?.has(oIdx))
              : pickedSingle === oIdx;
          const isCorrect =
            showAnswerKey &&
            (field.type === "multi_choice"
              ? Boolean(field.correctIndices?.includes(oIdx))
              : field.correctIndex === oIdx);
          const marker = isPicked ? "x" : " ";
          const suffix = isCorrect ? " ✅" : "";
          parts.push(`- [${marker}] ${opt}${suffix}`);
        });
      } else {
        const ansText = formatFormAnswerForDisplay(field, userVal);
        parts.push(`- **Respuesta:** ${ansText}`);
        if (showAnswerKey && field.expectedAnswer) {
          parts.push(`- **Referencia:** ${field.expectedAnswer}`);
        }
      }
      if (showAnswerKey && field.explanation) {
        parts.push(`> _Explicación:_ ${field.explanation}`);
      }
    });
  }

  if (canvas.columns.length > 0) {
    const headers = canvas.columns.map((c) => c.label.replace(/\|/g, "\\|"));
    const sep = canvas.columns.map((c) => {
      if (c.align === "right") return "---:";
      if (c.align === "center") return ":---:";
      return "---";
    });
    const tableLines = [
      `| ${headers.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...canvas.rows.map((r) => {
        const vals = canvas.columns.map((c) =>
          (r.cells[c.id] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
        );
        return `| ${vals.join(" | ")} |`;
      }),
    ];
    parts.push(`\n${tableLines.join("\n")}`);
  }

  if (canvas.markdown && canvas.markdown.trim()) {
    parts.push(`\n${canvas.markdown.trim()}`);
  }

  return parts.join("\n");
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function canvasArtifactToCsv(canvas: CanvasArtifact): string {
  if (canvas.columns.length === 0) return "";
  const header = canvas.columns.map((c) => escapeCsvCell(stripInlineMarkdownText(c.label))).join(",");
  const rows = canvas.rows.map((r) =>
    canvas.columns
      .map((c) => escapeCsvCell(stripInlineMarkdownText(r.cells[c.id] ?? "")))
      .join(",")
  );
  return [header, ...rows].join("\n");
}

