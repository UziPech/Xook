import { isWorkspaceTauriRuntime } from "../workspace-store/workspaceApi";

export type AssistPresetId = "compact" | "balanced" | "wide" | "half" | "custom";
export type AssistSide = "right" | "left";

export interface AssistPresetOption {
  id: Exclude<AssistPresetId, "custom">;
  label: string;
  percentLabel: string;
  ratioPercent: number;
  hint: string;
}

export const ASSIST_PRESET_OPTIONS: AssistPresetOption[] = [
  {
    id: "compact",
    label: "Discreto",
    percentLabel: "Carril angosto",
    ratioPercent: 26,
    hint: "Carril delgado para dejar casi toda la pantalla a tu app",
  },
  {
    id: "balanced",
    label: "Asistente",
    percentLabel: "Recomendado",
    ratioPercent: 33,
    hint: "Tamaño ideal de asistencia sin distraer de tu trabajo",
  },
  {
    id: "wide",
    label: "Amplio",
    percentLabel: "Más lectura",
    ratioPercent: 42,
    hint: "Más espacio para respuestas largas, tablas y código",
  },
  {
    id: "half",
    label: "Mitad y mitad",
    percentLabel: "Igualado",
    ratioPercent: 50,
    hint: "Divide ambas pantallas por igual",
  },
];

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompanionWindowCandidate {
  windowId: number;
  pid: number;
  appName: string;
  bundleId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompanionWindowListResponse {
  ok: boolean;
  accessibilityGranted: boolean;
  windows: CompanionWindowCandidate[];
  error?: string | null;
}

export interface PairedCompanionInfo {
  pid: number;
  windowId?: number | null;
  appName: string;
  bundleId: string;
  windowTitle: string;
  tiledOk: boolean;
  savedFrame?: WindowRect | null;
}

export interface AssistWindowStatus {
  active: boolean;
  preset: AssistPresetId;
  side: AssistSide;
  splitCompanion: boolean;
  alwaysOnTop: boolean;
  accessibilityGranted: boolean;
  xookWidth: number;
  xookHeight: number;
  monitorWidth: number;
  monitorHeight: number;
  widthPercent: number;
  companion?: PairedCompanionInfo | null;
  notice?: string | null;
}

export interface ApplyAssistLayoutPayload {
  preset?: AssistPresetId;
  side?: AssistSide;
  customWidth?: number;
  splitCompanion?: boolean;
  targetPid?: number;
  targetWindowId?: number;
  targetTitle?: string;
  alwaysOnTop?: boolean;
}

export const DEFAULT_ASSIST_STATUS: AssistWindowStatus = {
  active: false,
  preset: "balanced",
  side: "right",
  splitCompanion: true,
  alwaysOnTop: false,
  accessibilityGranted: false,
  xookWidth: 1200,
  xookHeight: 800,
  monitorWidth: 1440,
  monitorHeight: 900,
  widthPercent: 83,
  companion: null,
  notice: null,
};

export async function getAssistWindowState(): Promise<AssistWindowStatus> {
  if (!isWorkspaceTauriRuntime()) return DEFAULT_ASSIST_STATUS;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AssistWindowStatus>("get_assist_window_state");
}

export async function listCompanionWindows(): Promise<CompanionWindowListResponse> {
  if (!isWorkspaceTauriRuntime()) {
    return { ok: true, accessibilityGranted: false, windows: [], error: null };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CompanionWindowListResponse>("list_companion_windows");
}

export async function applyAssistLayout(
  payload: ApplyAssistLayoutPayload
): Promise<AssistWindowStatus> {
  if (!isWorkspaceTauriRuntime()) return DEFAULT_ASSIST_STATUS;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AssistWindowStatus>("apply_assist_layout", { payload });
}

export async function rebalanceAssistSplit(): Promise<AssistWindowStatus> {
  if (!isWorkspaceTauriRuntime()) return DEFAULT_ASSIST_STATUS;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AssistWindowStatus>("rebalance_assist_split");
}

export async function setAssistAlwaysOnTop(enabled: boolean): Promise<AssistWindowStatus> {
  if (!isWorkspaceTauriRuntime()) return DEFAULT_ASSIST_STATUS;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AssistWindowStatus>("set_assist_always_on_top", { enabled });
}

export async function exitAssistLayout(
  restoreCompanion = true
): Promise<AssistWindowStatus> {
  if (!isWorkspaceTauriRuntime()) return DEFAULT_ASSIST_STATUS;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AssistWindowStatus>("exit_assist_layout", {
    restoreCompanion,
  });
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  if (!isWorkspaceTauriRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("request_accessibility_permission_cmd");
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!isWorkspaceTauriRuntime()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_accessibility_settings_cmd");
}
