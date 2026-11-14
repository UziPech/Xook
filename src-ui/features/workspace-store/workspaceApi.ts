export interface WorkspaceEntry {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface WorkspaceNodeEntry {
  relativePath: string;
  parentPath: string;
  name: string;
  kind: "dir" | "file";
  zone: string;
  writePolicy: "autonomous" | "hitl" | "system";
  depth: number;
  sizeBytes: number;
  modifiedAt: string;
  editable: boolean;
  extension: string;
}

export interface WorkspaceBusinessSummary {
  companyName: string;
  agentName: string;
  currency: string;
  stockThresholdDays: number;
  maxBudgetPerOrder: number;
}

export interface WorkspacePatternItem {
  pattern_id: string;
  description: string;
  confidence: number;
}

export interface WorkspaceOverview {
  active: WorkspaceEntry;
  workspaces: WorkspaceEntry[];
  defaultBaseDir: string;
  entries: WorkspaceNodeEntry[];
  profile: WorkspaceBusinessSummary;
  patterns: WorkspacePatternItem[];
  permissionsRuleCount: number;
}

export interface WorkspaceFileContent {
  relativePath: string;
  name: string;
  zone: string;
  content: string;
  editable: boolean;
  sizeBytes: number;
  modifiedAt: string;
}

export function isWorkspaceTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

export async function getWorkspaceOverview(): Promise<WorkspaceOverview | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("get_workspace_overview");
}

export async function createWorkspace(
  name: string,
  customPath?: string
): Promise<WorkspaceOverview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("create_workspace", {
    payload: {
      name,
      customPath: customPath?.trim() || null,
    },
  });
}

export async function switchWorkspace(workspaceId: string): Promise<WorkspaceOverview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("switch_workspace", { workspaceId });
}

export async function renameWorkspace(
  workspaceId: string,
  newName: string
): Promise<WorkspaceOverview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("rename_workspace", { workspaceId, newName });
}

export async function readWorkspaceFile(relativePath: string): Promise<WorkspaceFileContent> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceFileContent>("read_workspace_file", { relativePath });
}

export async function saveWorkspaceFile(
  relativePath: string,
  content: string
): Promise<WorkspaceOverview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("save_workspace_file", { relativePath, content });
}

export async function createWorkspaceFolder(relativePath: string): Promise<WorkspaceOverview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceOverview>("create_workspace_folder", { relativePath });
}

export async function openWorkspaceFolder(relativePath?: string): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_folder", {
    relativePath: relativePath ?? null,
  });
}

export interface StagedAttachmentResult {
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PdfSummaryInfo {
  ok?: boolean;
  path?: string;
  file_name?: string;
  size_bytes?: number;
  page_count?: number;
  title?: string | null;
  author?: string | null;
  has_selectable_text?: boolean;
}

export interface WorkspaceBinaryPreview {
  relativePath: string;
  name: string;
  kind: "image" | "pdf" | "office" | "binary";
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string | null;
  pdfSummary?: PdfSummaryInfo | null;
  openable: boolean;
}

export interface GeneratedPdfResult {
  ok?: boolean;
  path: string;
  filename: string;
  title: string;
  page_count: number;
  size_bytes: number;
  images_embedded?: number;
  tables_count?: number;
  has_cover?: boolean;
  theme?: string;
  warnings?: string[];
}

export async function stageWorkspaceAttachment(
  fileName: string,
  dataBase64: string,
  subDir?: string
): Promise<StagedAttachmentResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<StagedAttachmentResult>("stage_workspace_attachment", {
    fileName,
    dataBase64,
    subDir: subDir ?? null,
  });
}

export async function openWorkspaceFile(relativePath: string): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_workspace_file", { relativePath });
}

export async function readWorkspaceBinaryPreview(
  relativePath: string
): Promise<WorkspaceBinaryPreview> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WorkspaceBinaryPreview>("read_workspace_binary_preview", { relativePath });
}

export async function exportCanvasToPdf(
  spec: Record<string, unknown>
): Promise<GeneratedPdfResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GeneratedPdfResult>("export_canvas_pdf", { spec });
}

export async function recordWorkspaceDecision(payload: {
  cardId: string;
  title?: string;
  decision: string;
  adjustedQty?: number | null;
  notes?: string | null;
}): Promise<string | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("record_workspace_decision", { payload });
}



export interface PermissionRule {
  id: string;
  pattern: string;
  action: "allow" | "ask" | "deny" | string;
  scope: "program" | "prefix" | "exact" | "app" | "capability" | "ext_read" | "ext_write" | string;
  description?: string | null;
  createdAt: string;
}

export interface PermissionsConfig {
  version: number;
  defaultPolicy: "ask" | "deny" | string;
  rules: PermissionRule[];
  updatedAt: string;
}

export interface CommandExecutionRecord {
  id: string;
  conversationId?: string | null;
  toolCallId?: string | null;
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  permissionMode: string;
  matchedRule?: string | null;
  status: string;
  exitCode?: number | null;
  durationMs?: number | null;
  logPath?: string | null;
  createdAt: string;
  finishedAt?: string | null;
}

export interface CommandExecutionResult {
  ok: boolean;
  commandId: string;
  status: string;
  permissionMode: string;
  exitCode?: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logPath?: string | null;
  error?: string | null;
}

export interface CommandPermissionRequestEvent {
  requestId: string;
  streamId?: string | null;
  commandId: string;
  kind?:
    | "command"
    | "external_command"
    | "open_app"
    | "os_notes_read"
    | "os_notes_write"
    | "os_calendar_read"
    | "os_calendar_write"
    | "ext_fs_list"
    | "ext_fs_search"
    | "ext_fs_read"
    | "ext_fs_write"
    | "ext_fs_edit"
    | "ext_fs_mkdir"
    | string;
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  program: string;
  patternSuggestion: string;
  allowAlwaysAllowed?: boolean;
  isExternal?: boolean;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
}

export interface CommandFinishedEvent {
  requestId: string;
  streamId?: string | null;
  commandId?: string;
  kind?:
    | "command"
    | "external_command"
    | "open_app"
    | "os_notes_read"
    | "os_notes_write"
    | "os_calendar_read"
    | "os_calendar_write"
    | "ext_fs_list"
    | "ext_fs_search"
    | "ext_fs_read"
    | "ext_fs_write"
    | "ext_fs_edit"
    | "ext_fs_mkdir"
    | string;
  purpose?: string;
  command?: string;
  cwdRel?: string;
  riskLevel?: string;
  status?: string;
  appName?: string | null;
  bundleId?: string | null;
  appPath?: string | null;
  detailPreview?: string | null;
  result?: CommandExecutionResult;
  error?: string;
}

export async function getCommandPermissions(): Promise<PermissionsConfig | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PermissionsConfig>("get_command_permissions");
}

export async function enableReadonlyCommandPreset(): Promise<PermissionsConfig | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PermissionsConfig>("enable_readonly_command_preset");
}

export async function updateCommandPermissionRule(input: {
  pattern: string;
  action: "allow" | "ask" | "deny";
  scope?: "program" | "prefix" | "exact";
  description?: string;
}): Promise<PermissionsConfig | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PermissionsConfig>("update_command_permission_rule", {
    pattern: input.pattern,
    action: input.action,
    scope: input.scope ?? null,
    description: input.description ?? null,
  });
}

export async function removeCommandPermissionRule(
  ruleId: string
): Promise<PermissionsConfig | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PermissionsConfig>("remove_command_permission_rule", { ruleId });
}

export async function updateCommandDefaultPolicy(
  defaultPolicy: "ask" | "deny"
): Promise<PermissionsConfig | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PermissionsConfig>("update_command_default_policy", {
    defaultPolicy,
  });
}

export async function listCommandExecutions(
  limit = 20
): Promise<CommandExecutionRecord[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CommandExecutionRecord[]>("list_command_executions_cmd", { limit });
}

export async function resolveCommandPermission(
  requestId: string,
  decision: "allow_once" | "allow_always" | "deny"
): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("resolve_command_permission", { requestId, decision });
}

export interface PdfPreviewPage {
  page: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface PdfRenderPreviewResult {
  ok: boolean;
  path?: string;
  filename?: string;
  pageCount: number;
  startPage: number;
  renderedCount: number;
  hasMore: boolean;
  pages: PdfPreviewPage[];
  error?: string;
}

export async function renderPdfPreview(
  relativePath: string,
  options?: { startPage?: number; maxPages?: number; scale?: number }
): Promise<PdfRenderPreviewResult | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Record<string, unknown>>("render_pdf_preview", {
    relativePath,
    startPage: options?.startPage,
    maxPages: options?.maxPages,
    scale: options?.scale,
  });
  const rawPages = Array.isArray(raw?.pages) ? raw.pages : [];
  const pages: PdfPreviewPage[] = rawPages
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const dataUrl = String(obj.dataUrl ?? obj.data_url ?? "").trim();
      if (!dataUrl) return null;
      return {
        page: Number(obj.page ?? 1),
        width: Number(obj.width ?? 0),
        height: Number(obj.height ?? 0),
        dataUrl,
      };
    })
    .filter((p): p is PdfPreviewPage => p !== null);
  return {
    ok: Boolean(raw?.ok ?? true),
    path: typeof raw?.path === "string" ? raw.path : relativePath,
    filename: typeof raw?.filename === "string" ? raw.filename : undefined,
    pageCount: Number(raw?.pageCount ?? raw?.page_count ?? pages.length),
    startPage: Number(raw?.startPage ?? raw?.start_page ?? options?.startPage ?? 1),
    renderedCount: Number(raw?.renderedCount ?? raw?.rendered_count ?? pages.length),
    hasMore: Boolean(raw?.hasMore ?? raw?.has_more),
    pages,
    error: typeof raw?.error === "string" ? raw.error : undefined,
  };
}

export interface PdfEditableBlock {
  type:
    | "heading"
    | "paragraph"
    | "bullets"
    | "numbered_list"
    | "table"
    | "callout"
    | "code"
    | "divider"
    | "image"
    | "kpi_strip"
    | string;
  level?: number;
  text?: string;
  title?: string;
  tone?: string;
  items?: string[];
  headers?: string[];
  columns?: string[];
  rows?: string[][];
  code?: string;
  language?: string;
  path?: string;
  caption?: string;
  metrics?: Array<{ label: string; value: string; detail?: string }>;
}

export interface PdfPagePatch {
  id: string;
  page_number: number;
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  orig_x_pct?: number;
  orig_y_pct?: number;
  orig_w_pct?: number;
  orig_h_pct?: number;
  text: string;
  original_text?: string;
  font_size?: number;
  font_weight?: "normal" | "bold";
  text_color?: string;
  bg_color?: string;
  align?: "left" | "center" | "right";
  deleted?: boolean;
  is_new?: boolean;
}

export interface PdfEditableSpec {
  ok: boolean;
  source?: string;
  path: string;
  filename?: string;
  pageCount: number;
  title: string;
  subtitle: string;
  author: string;
  date: string;
  theme: string;
  hasCover: boolean;
  preserveFirstPage: boolean;
  skipInlineTitle: boolean;
  cover?: Record<string, unknown> | null;
  blocks: PdfEditableBlock[];
  markdown: string;
  pagePatches: PdfPagePatch[];
}

export interface PdfSaveResult {
  ok: boolean;
  path: string;
  filename?: string;
  title: string;
  theme: string;
  pageCount: number;
  sizeBytes: number;
  previewPages: PdfPreviewPage[];
  previewHasMore: boolean;
  editableSpec?: PdfEditableSpec;
}

function normalizeEditableSpec(
  raw: Record<string, unknown>,
  fallbackPath: string
): PdfEditableSpec {
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks: PdfEditableBlock[] = rawBlocks
    .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
    .map((b) => ({
      type: String(b.type ?? "paragraph"),
      level: typeof b.level === "number" ? b.level : undefined,
      text: typeof b.text === "string" ? b.text : typeof b.content === "string" ? b.content : undefined,
      title: typeof b.title === "string" ? b.title : undefined,
      tone: typeof b.tone === "string" ? b.tone : undefined,
      items: Array.isArray(b.items) ? b.items.map((x) => String(x ?? "")) : undefined,
      headers: Array.isArray(b.headers)
        ? b.headers.map((x) => String(x ?? ""))
        : Array.isArray(b.columns)
        ? b.columns.map((x) => String(x ?? ""))
        : undefined,
      rows: Array.isArray(b.rows)
        ? b.rows
            .filter((r): r is unknown[] => Array.isArray(r))
            .map((r) => r.map((c) => String(c ?? "")))
        : undefined,
      code: typeof b.code === "string" ? b.code : undefined,
      language: typeof b.language === "string" ? b.language : undefined,
      path: typeof b.path === "string" ? b.path : undefined,
      caption: typeof b.caption === "string" ? b.caption : undefined,
    }));

  const rawPatches = Array.isArray(raw.page_patches ?? raw.pagePatches)
    ? ((raw.page_patches ?? raw.pagePatches) as unknown[])
    : [];
  const pagePatches: PdfPagePatch[] = rawPatches
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
    .map((p, idx) => {
      const xPct = Number(p.x_pct ?? 12);
      const yPct = Number(p.y_pct ?? 12);
      const wPct = Number(p.w_pct ?? 28);
      const hPct = Number(p.h_pct ?? 5);
      const txt = String(p.text ?? "");
      return {
        id: String(p.id ?? `patch_${idx + 1}`),
        page_number: Number(p.page_number ?? 1),
        x_pct: xPct,
        y_pct: yPct,
        w_pct: wPct,
        h_pct: hPct,
        orig_x_pct: typeof p.orig_x_pct === "number" ? p.orig_x_pct : xPct,
        orig_y_pct: typeof p.orig_y_pct === "number" ? p.orig_y_pct : yPct,
        orig_w_pct: typeof p.orig_w_pct === "number" ? p.orig_w_pct : wPct,
        orig_h_pct: typeof p.orig_h_pct === "number" ? p.orig_h_pct : hPct,
        text: txt,
        original_text:
          typeof p.original_text === "string" ? p.original_text : txt,
        font_size: typeof p.font_size === "number" ? p.font_size : 11,
        font_weight: p.font_weight === "bold" ? "bold" : "normal",
        text_color: typeof p.text_color === "string" ? p.text_color : "#0F172A",
        bg_color: typeof p.bg_color === "string" ? p.bg_color : "#FFFFFF",
        align:
          p.align === "center" || p.align === "right" ? p.align : "left",
        deleted: Boolean(p.deleted ?? false),
        is_new: Boolean(p.is_new ?? false),
      };
    });

  return {
    ok: Boolean(raw.ok ?? true),
    source: typeof raw.source === "string" ? raw.source : undefined,
    path: typeof raw.path === "string" ? raw.path : fallbackPath,
    filename: typeof raw.filename === "string" ? raw.filename : undefined,
    pageCount: Number(raw.page_count ?? raw.pageCount ?? 1),
    title: String(raw.title ?? "Documento"),
    subtitle: String(raw.subtitle ?? ""),
    author: String(raw.author ?? ""),
    date: String(raw.date ?? ""),
    theme: String(raw.theme ?? "executive"),
    hasCover: Boolean(raw.has_cover ?? raw.hasCover ?? false),
    preserveFirstPage: Boolean(raw.preserve_first_page ?? raw.preserveFirstPage ?? false),
    skipInlineTitle: Boolean(raw.skip_inline_title ?? raw.skipInlineTitle ?? false),
    cover:
      raw.cover && typeof raw.cover === "object"
        ? (raw.cover as Record<string, unknown>)
        : null,
    blocks,
    markdown: String(raw.markdown ?? ""),
    pagePatches,
  };
}

export async function loadPdfEditableSpec(
  relativePath: string
): Promise<PdfEditableSpec | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Record<string, unknown>>("load_pdf_editable_spec", {
    relativePath,
  });
  if (!raw) return null;
  return normalizeEditableSpec(raw, relativePath);
}

export async function savePdfDocument(
  relativePath: string,
  payload: {
    title?: string;
    subtitle?: string;
    author?: string;
    date?: string;
    theme?: string;
    preserve_first_page?: boolean;
    skip_inline_title?: boolean;
    cover?: Record<string, unknown> | null;
    edit_mode?: "blocks" | "markdown";
    blocks?: PdfEditableBlock[];
    markdown?: string;
    page_patches?: PdfPagePatch[];
    patches_only?: boolean;
  }
): Promise<PdfSaveResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Record<string, unknown>>("save_pdf_document", {
    relativePath,
    payload,
  });
  const rawPages = Array.isArray(raw?.preview_pages) ? raw.preview_pages : [];
  const previewPages: PdfPreviewPage[] = rawPages
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const dataUrl = String(obj.dataUrl ?? obj.data_url ?? "").trim();
      if (!dataUrl) return null;
      return {
        page: Number(obj.page ?? 1),
        width: Number(obj.width ?? 0),
        height: Number(obj.height ?? 0),
        dataUrl,
      };
    })
    .filter((p): p is PdfPreviewPage => p !== null);

  return {
    ok: Boolean(raw?.ok ?? true),
    path: typeof raw?.path === "string" ? raw.path : relativePath,
    filename: typeof raw?.filename === "string" ? raw.filename : undefined,
    title: String(raw?.title ?? payload.title ?? "Documento"),
    theme: String(raw?.theme ?? payload.theme ?? "executive"),
    pageCount: Number(raw?.page_count ?? previewPages.length),
    sizeBytes: Number(raw?.size_bytes ?? 0),
    previewPages,
    previewHasMore: Boolean(raw?.preview_has_more),
    editableSpec:
      raw?.editable_spec && typeof raw.editable_spec === "object"
        ? normalizeEditableSpec(raw.editable_spec as Record<string, unknown>, relativePath)
        : undefined,
  };
}

export interface DownloadWorkspaceFileResult {
  ok: boolean;
  path: string;
  filename: string;
  downloadedPath: string;
}

export interface UniversalDocumentSlide {
  slide_number: number;
  title: string;
  bullets: string[];
  tables: Array<{ headers: string[]; rows: string[][] }>;
  notes?: string;
}

export interface UniversalDocumentSheet {
  name: string;
  headers: string[];
  rows: string[][];
  total_rows?: number;
  truncated?: boolean;
}

export interface UniversalDocumentPayload {
  ok: boolean;
  path: string;
  filename: string;
  title: string;
  sizeBytes: number;
  pageCount: number;
  docKind: "word" | "presentation" | "spreadsheet" | "markdown" | "text" | "code" | "image" | "pdf";
  formatLabel: string;
  blocks?: PdfEditableBlock[];
  slides?: UniversalDocumentSlide[];
  sheets?: UniversalDocumentSheet[];
  markdown?: string;
  text?: string;
  imageDataUrl?: string;
  error?: string;
}

export async function readUniversalDocument(
  relativePath: string
): Promise<UniversalDocumentPayload | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Record<string, unknown>>("read_universal_document", {
    relativePath,
  });
  if (!raw || raw.ok === false) return null;

  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks: PdfEditableBlock[] = rawBlocks
    .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === "object"))
    .map((b) => ({
      type: String(b.type ?? "paragraph"),
      level: typeof b.level === "number" ? b.level : undefined,
      text: typeof b.text === "string" ? b.text : typeof b.content === "string" ? b.content : undefined,
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

  const rawKind = String(raw.doc_kind ?? "text");
  const docKind: UniversalDocumentPayload["docKind"] =
    rawKind === "word" ||
    rawKind === "presentation" ||
    rawKind === "spreadsheet" ||
    rawKind === "markdown" ||
    rawKind === "code"
      ? rawKind
      : "text";

  return {
    ok: true,
    path: String(raw.path ?? relativePath),
    filename: String(raw.filename ?? relativePath.split("/").pop() ?? "documento"),
    title: String(raw.title ?? relativePath.split("/").pop() ?? "Documento"),
    sizeBytes: Number(raw.size_bytes ?? 0),
    pageCount: Number(raw.page_count ?? 1),
    docKind,
    formatLabel: String(raw.format_label ?? "DOC"),
    blocks,
    slides,
    sheets,
    markdown: typeof raw.markdown === "string" ? raw.markdown : "",
    text: typeof raw.text === "string" ? raw.text : "",
  };
}

export async function downloadWorkspaceFile(
  relativePath: string,
  preferredName?: string
): Promise<DownloadWorkspaceFileResult | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<Record<string, unknown>>("download_workspace_file", {
    relativePath,
    preferredName: preferredName ?? null,
  });
  return {
    ok: Boolean(raw?.ok ?? true),
    path: String(raw?.path ?? relativePath),
    filename: String(raw?.filename ?? preferredName ?? "documento.pdf"),
    downloadedPath: String(raw?.downloadedPath ?? ""),
  };
}

export function subscribeWorkspaceUpdated(
  onUpdated: (reason?: string) => void
): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    void listen<{ reason?: string }>("xox:workspace-updated", (ev) => {
      if (active) onUpdated(ev.payload?.reason);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
  });
  return () => {
    active = false;
    unlisten?.();
  };
}

export function subscribePermissionEvents(handlers: {
  onRequest?: (req: CommandPermissionRequestEvent) => void;
  onFinished?: (ev: CommandFinishedEvent) => void;
  onPermissionsUpdated?: (cfg: PermissionsConfig) => void;
}): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  const unlisteners: Array<() => void> = [];

  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    if (handlers.onRequest) {
      void listen<CommandPermissionRequestEvent>("xox-permission-request", (ev) => {
        if (active && ev.payload) handlers.onRequest?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
    if (handlers.onFinished) {
      void listen<CommandFinishedEvent>("xox:command-finished", (ev) => {
        if (active && ev.payload) handlers.onFinished?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
    if (handlers.onPermissionsUpdated) {
      void listen<PermissionsConfig>("xox:permissions-updated", (ev) => {
        if (active && ev.payload) handlers.onPermissionsUpdated?.(ev.payload);
      }).then((fn) => (active ? unlisteners.push(fn) : fn()));
    }
  });

  return () => {
    active = false;
    for (const fn of unlisteners) fn();
  };
}

export interface ScreenReaderStatus {
  rollingEnabled: boolean;
  retentionMinutes: number;
  captureMode: "display" | "window" | string;
  permissionGranted: boolean;
  accessibilityGranted: boolean;
  pausedSensitive: boolean;
  sensitiveReason?: string | null;
  activeAppName: string;
  activeWindowTitle: string;
  lastCapturedAt?: string | null;
  observationCount: number;
  lastPreview?: string | null;
  lastError?: string | null;
}

export interface LiveScreenCapturePayload {
  ok: boolean;
  permissionGranted: boolean;
  accessibilityGranted: boolean;
  blockedSensitive: boolean;
  sensitiveReason?: string | null;
  appName: string;
  bundleId: string;
  windowTitle: string;
  captureMode: string;
  text: string;
  ocrText: string;
  axText: string;
  imageDataUrl?: string | null;
  capturedAt: string;
  error?: string | null;
}

export interface ScreenObservationRecord {
  id: string;
  appName: string;
  bundleId: string;
  windowTitle: string;
  contentText: string;
  captureMode: string;
  capturedAt: string;
  expiresAt: string;
}

export async function getScreenReaderStatus(): Promise<ScreenReaderStatus | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenReaderStatus>("get_screen_reader_status");
}

export async function setScreenReaderConfig(payload: {
  rollingEnabled?: boolean;
  retentionMinutes?: number;
  captureMode?: "display" | "window";
}): Promise<ScreenReaderStatus | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenReaderStatus>("set_screen_reader_config", { payload });
}

export async function requestScreenPermission(): Promise<ScreenReaderStatus | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenReaderStatus>("request_screen_permission_cmd");
}

export async function openScreenPermissionSettings(): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_screen_permission_settings");
}

export async function captureScreenContextNow(options?: {
  mode?: "display" | "window";
  includeImage?: boolean;
  saveObservation?: boolean;
}): Promise<LiveScreenCapturePayload | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LiveScreenCapturePayload>("capture_screen_context_now", {
    mode: options?.mode ?? null,
    includeImage: options?.includeImage ?? true,
    saveObservation: options?.saveObservation ?? true,
  });
}

export async function queryScreenMemory(
  query?: string,
  limit = 6
): Promise<ScreenObservationRecord[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenObservationRecord[]>("query_screen_memory_cmd", {
    query: query ?? null,
    limit,
  });
}

export async function clearScreenMemory(): Promise<ScreenReaderStatus | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenReaderStatus>("clear_screen_memory_cmd");
}

export function subscribeScreenContext(
  onStatus: (status: ScreenReaderStatus) => void
): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    void listen<ScreenReaderStatus>("screen:context-updated", (ev) => {
      if (active && ev.payload) onStatus(ev.payload);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
  });
  return () => {
    active = false;
    unlisten?.();
  };
}
