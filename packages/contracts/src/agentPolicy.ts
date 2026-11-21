/**
 * Política de autonomía y niveles de riesgo para el modo agente de XOOK.
 *
 * Inspirado conceptualmente en la escalera de autonomía con techo y ajustes bloqueados
 * de pingdotgg/t3code (MIT), adaptado al modelo Guardián + HITL de XOOK.
 */

export const RUNTIME_AUTONOMY_MODES = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
] as const;

export type RuntimeAutonomyMode = (typeof RUNTIME_AUTONOMY_MODES)[number];

export const DEFAULT_RUNTIME_AUTONOMY_MODE: RuntimeAutonomyMode = "approval-required";

const RUNTIME_AUTONOMY_RANK: Record<RuntimeAutonomyMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

export const SANDBOX_SCOPES = [
  "read-only",
  "workspace-write",
  "host-guided",
] as const;

export type SandboxScope = (typeof SANDBOX_SCOPES)[number];

export const TOOL_RISK_TIERS = [
  "read_safe",
  "read_sensitive",
  "write_local",
  "write_protected_hitl",
  "command_exec",
  "destructive",
] as const;

export type ToolRiskTier = (typeof TOOL_RISK_TIERS)[number];

export interface ManagedPolicySetting<T> {
  value: T;
  /** Cuando es true, ni el usuario de sesión ni el agente pueden relajar este valor. */
  locked: boolean;
  source?: "default" | "workspace" | "admin";
}

export function isRuntimeAutonomyMode(value: unknown): value is RuntimeAutonomyMode {
  return (
    typeof value === "string" &&
    (RUNTIME_AUTONOMY_MODES as readonly string[]).includes(value)
  );
}

/** Devuelve true si `requested` supera el techo configurado `ceiling`. */
export function isRuntimeModeAbove(
  requested: RuntimeAutonomyMode,
  ceiling: RuntimeAutonomyMode | undefined
): boolean {
  if (!ceiling) return false;
  return RUNTIME_AUTONOMY_RANK[requested] > RUNTIME_AUTONOMY_RANK[ceiling];
}

/** Aplica el techo de autonomía sin permitir elevaciones silenciosas. */
export function clampRuntimeMode(
  requested: RuntimeAutonomyMode,
  ceiling: RuntimeAutonomyMode | undefined
): RuntimeAutonomyMode {
  if (!ceiling) return requested;
  return isRuntimeModeAbove(requested, ceiling) ? ceiling : requested;
}

/** Determina si una herramienta con cierto riesgo requiere confirmación HITL bajo el modo actual. */
export function requiresHitlApproval(
  risk: ToolRiskTier,
  mode: RuntimeAutonomyMode
): boolean {
  switch (risk) {
    case "read_safe":
      return false;
    case "read_sensitive":
      return mode === "approval-required";
    case "write_local":
      return mode === "approval-required";
    case "write_protected_hitl":
      return mode !== "full-access";
    case "command_exec":
      return mode === "approval-required" || mode === "auto-accept-edits";
    case "destructive":
      // En XOOK lo destructivo siempre exige confirmación visual HITL.
      return true;
  }
}
