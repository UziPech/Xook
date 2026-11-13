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
  scope: "program" | "prefix" | "exact" | string;
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
  purpose: string;
  command: string;
  cwdRel: string;
  riskLevel: "low" | "medium" | "high" | "blocked" | string;
  program: string;
  patternSuggestion: string;
}

export interface CommandFinishedEvent {
  requestId: string;
  streamId?: string | null;
  commandId?: string;
  purpose?: string;
  command?: string;
  cwdRel?: string;
  riskLevel?: string;
  status?: string;
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
