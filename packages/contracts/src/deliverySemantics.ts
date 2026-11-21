/**
 * Semántica de entrega y reintento para herramientas del agente XOOK.
 *
 * Inspirado conceptualmente en el modelo DeliverySemantics de vercel-labs/agent-desktop
 * (Apache-2.0): distinguir "no llegó a ejecutarse" de "pudo haber producido efecto sin
 * confirmación", para que el agente jamás duplique mutaciones al reintentar.
 */

export const DELIVERY_STATES = [
  "not_delivered",
  "delivered_unverified",
  "delivered_verified",
  "unknown",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const RETRY_POLICIES = ["safe", "verify_first", "unsafe"] as const;

export type RetryPolicy = (typeof RETRY_POLICIES)[number];

export const TOOL_EFFECT_CLASSES = [
  "read_only",
  "staging_hitl",
  "mutating",
  "command_exec",
] as const;

export type ToolEffectClass = (typeof TOOL_EFFECT_CLASSES)[number];

export interface ToolDisposition {
  delivery: DeliveryState;
  retry: RetryPolicy;
  verified?: boolean;
  reason?: string;
}

export function isDeliveryState(value: unknown): value is DeliveryState {
  return typeof value === "string" && (DELIVERY_STATES as readonly string[]).includes(value);
}

export function isRetryPolicy(value: unknown): value is RetryPolicy {
  return typeof value === "string" && (RETRY_POLICIES as readonly string[]).includes(value);
}

/**
 * Calcula una disposición segura cuando una herramienta termina con éxito o fallo.
 * - Lecturas y rechazos previos a ejecución (permisos, argumentos) siempre son `not_delivered` + `safe`.
 * - Mutaciones exitosas son `delivered_verified` + `unsafe` (no repetir).
 * - Mutaciones o comandos que fallan/expiran en vuelo quedan en `delivered_unverified` + `verify_first`.
 */
export function settleToolDisposition(input: {
  ok: boolean;
  effectClass: ToolEffectClass;
  status?: string;
  timedOut?: boolean;
  validationError?: boolean;
  reason?: string;
}): ToolDisposition {
  const normStatus = (input.status ?? "").trim().toLowerCase();
  const blockedBeforeRun =
    input.validationError === true ||
    normStatus === "denied" ||
    normStatus === "blocked" ||
    normStatus === "cancelled" ||
    normStatus === "parse_error";

  if (blockedBeforeRun) {
    return {
      delivery: "not_delivered",
      retry: "safe",
      verified: false,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  if (input.ok) {
    if (input.effectClass === "read_only") {
      return {
        delivery: "delivered_verified",
        retry: "safe",
        verified: true,
        ...(input.reason ? { reason: input.reason } : {}),
      };
    }
    return {
      delivery: "delivered_verified",
      retry: "unsafe",
      verified: true,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  if (input.effectClass === "read_only") {
    return {
      delivery: "not_delivered",
      retry: "safe",
      verified: false,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  if (input.timedOut || input.effectClass === "command_exec") {
    return {
      delivery: "delivered_unverified",
      retry: "verify_first",
      verified: false,
      reason:
        input.reason ??
        "La operación pudo haber producido cambios parciales; verifica el estado antes de reintentar.",
    };
  }

  return {
    delivery: "unknown",
    retry: "verify_first",
    verified: false,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function sanitizeToolDisposition(raw: unknown): ToolDisposition | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isDeliveryState(obj.delivery) || !isRetryPolicy(obj.retry)) return null;
  return {
    delivery: obj.delivery,
    retry: obj.retry,
    ...(typeof obj.verified === "boolean" ? { verified: obj.verified } : {}),
    ...(typeof obj.reason === "string" && obj.reason.trim() ? { reason: obj.reason.trim() } : {}),
  };
}
