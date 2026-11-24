/**
 * Contratos compartidos para observación e interacción semántica/física de UI de escritorio.
 *
 * Inspirado conceptualmente en el modelo Snapshot + Refs calificadas + Action Chains +
 * blocked_combo + DeliverySemantics de vercel-labs/agent-desktop (Apache-2.0),
 * adaptado al Guardián HITL de XOOK.
 */

import type { ToolRiskTier } from "./agentPolicy.ts";
import type { ToolDisposition } from "./deliverySemantics.ts";

export const DESKTOP_OPERATIONS = [
  "list_windows",
  "snapshot",
  "find",
  "focus_window",
  "click",
  "set_value",
  "type_text",
  "press_key",
  "focus",
  "scroll_to",
] as const;

export type DesktopOperation = (typeof DESKTOP_OPERATIONS)[number];

export const DESKTOP_ACT_KINDS = [
  "click",
  "set_value",
  "type_text",
  "press_key",
  "focus",
  "scroll_to",
  "focus_window",
] as const;

export type DesktopActKind = (typeof DESKTOP_ACT_KINDS)[number];

export const DESKTOP_PERMISSION_NEEDS = ["none", "accessibility"] as const;
export type DesktopPermissionNeed = (typeof DESKTOP_PERMISSION_NEEDS)[number];

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindowInfo {
  windowId: number;
  pid: number;
  appName: string;
  bundleId: string;
  title: string;
  bounds: DesktopBounds;
  isSensitive: boolean;
  sensitiveReason?: string | null;
}

export interface DesktopUiNode {
  refId?: string | null;
  role: string;
  name?: string | null;
  value?: string | null;
  description?: string | null;
  identifier?: string | null;
  enabled: boolean;
  focused: boolean;
  isSecure: boolean;
  actions: string[];
  bounds?: DesktopBounds | null;
  depth: number;
}

export interface DesktopSnapshotResult {
  ok: boolean;
  accessibilityGranted: boolean;
  blockedSensitive?: boolean;
  sensitiveReason?: string | null;
  snapshotId?: string | null;
  window?: DesktopWindowInfo | null;
  complete: boolean;
  truncated: boolean;
  nodesObserved: number;
  refsAllocated: number;
  matchedHits?: number;
  searchStatus?: "complete" | "matches_found_partial_scan" | "truncated_no_matches";
  nodes: DesktopUiNode[];
  treeText: string;
  error?: string | null;
}

export interface DesktopFindRequest {
  appName?: string;
  windowId?: number;
  rootRef?: string;
  query?: string;
  roles?: string[];
  limit?: number;
  maxNodes?: number;
}

export interface DesktopActRequest {
  action: DesktopActKind;
  refId?: string;
  value?: string;
  key?: string;
  clear?: boolean;
  pressEnter?: boolean;
  headed?: boolean;
  x?: number;
  y?: number;
  appName?: string;
  windowId?: number;
  purpose: string;
  clientRequestId?: string;
}

export interface DesktopActResult {
  ok: boolean;
  action: DesktopActKind;
  refId?: string | null;
  mechanism?: string;
  summary?: string;
  postValue?: string | null;
  disposition: ToolDisposition;
  error?: string | null;
}

const QUALIFIED_REF_RE = /^s[1-9][0-9]*:@e[1-9][0-9]*$/;

/** Valida que una referencia de UI tenga formato calificado `sN:@eM` (nunca `@e1` suelto). */
export function isQualifiedDesktopRef(raw: unknown): raw is string {
  return typeof raw === "string" && QUALIFIED_REF_RE.test(raw.trim());
}

const HIGH_RISK_UI_TOKENS = [
  "enviar",
  "send",
  "entregar",
  "turn in",
  "hand in",
  "submit",
  "eliminar",
  "borrar",
  "delete",
  "remove",
  "pagar",
  "pay",
  "comprar",
  "buy",
  "transferir",
  "transfer",
  "publicar",
  "publish",
  "confirmar pago",
  "autorizar pago",
  "cerrar sesion",
  "cerrar sesión",
  "log out",
  "logout",
  "sign out",
  "vaciar papelera",
  "empty trash",
] as const;

const BLOCKED_KEY_COMBOS: ReadonlyArray<{ mods: ReadonlyArray<string>; key: string }> = [
  { mods: ["cmd"], key: "q" },
  { mods: ["cmd", "shift"], key: "q" },
  { mods: ["alt", "cmd"], key: "esc" },
  { mods: ["cmd", "ctrl"], key: "q" },
  { mods: ["cmd", "shift"], key: "delete" },
];

function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta si una combinación de teclas (o cualquier superset de modificadores)
 * cierra apps/sesión o borra la papelera de forma peligrosa.
 */
export function isBlockedKeyCombo(raw: string): boolean {
  const parts = raw
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    if (part === "cmd" || part === "command" || part === "meta") mods.add("cmd");
    else if (part === "ctrl" || part === "control") mods.add("ctrl");
    else if (part === "alt" || part === "option") mods.add("alt");
    else if (part === "shift") mods.add("shift");
    else if (part === "escape" || part === "esc") key = "esc";
    else if (part === "backspace" || part === "delete") key = "delete";
    else if (part === "enter" || part === "return") key = "return";
    else key = part;
  }
  return BLOCKED_KEY_COMBOS.some(
    (entry) => entry.key === key && entry.mods.every((m) => mods.has(m))
  );
}

const ELECTRON_CHROMIUM_TOKENS = [
  "antigravity",
  "vscode",
  "com.microsoft.vscode",
  "cursor",
  "windsurf",
  "chrome",
  "chromium",
  "electron",
  "slack",
  "whatsapp",
  "discord",
  "notion",
  "figma",
  "brave",
  "company.thebrowser.",
  "msedge",
  "obsidian",
  "linear",
  "spotify",
  "teams",
  "postman",
  "com.todesktop.",
  "com.tinyspeck.",
  "com.hnc.discord",
  "net.whatsapp.",
] as const;

/**
 * Detecta si la app objetivo corre sobre Electron o Chromium (donde activar la ventana
 * por `app_name` no garantiza el foco real del editor DOM y se exige `ref_id` o `(x, y)`).
 */
export function isElectronOrChromiumApp(bundleId: string, appName: string): boolean {
  const b = bundleId.trim().toLowerCase();
  const a = appName.trim().toLowerCase();
  if (!b && !a) return false;
  if (a === "arc" || a === "code" || a === "edge" || a === "microsoft edge") return true;
  return ELECTRON_CHROMIUM_TOKENS.some((tok) => b.includes(tok) || a.includes(tok));
}

/**
 * Detecta si la etiqueta de un control de UI sugiere una acción de compromiso o destructiva
 * que debe exigir confirmación HITL explícita cada vez (sin opción "Permitir siempre").
 */
export function isHighRiskUiTargetLabel(label: string): boolean {
  const norm = normalizeLabel(label);
  if (!norm) return false;
  return HIGH_RISK_UI_TOKENS.some((tok) => {
    const cleanTok = normalizeLabel(tok);
    const re = new RegExp(`(?:^|[^a-z0-9])${cleanTok.replace(/\s+/g, "\\s+")}(?:$|[^a-z0-9])`);
    return re.test(norm);
  });
}

/** Mapea exhaustivamente cada operación de escritorio a su nivel de riesgo en XOOK. */
export function desktopOperationToRiskTier(
  op: DesktopOperation,
  highRiskTarget = false
): ToolRiskTier {
  switch (op) {
    case "list_windows":
      return "read_safe";
    case "snapshot":
    case "find":
      return "read_sensitive";
    case "focus_window":
    case "focus":
    case "scroll_to":
      return "write_local";
    case "click":
    case "set_value":
    case "type_text":
    case "press_key":
      return highRiskTarget ? "destructive" : "write_protected_hitl";
  }
}
