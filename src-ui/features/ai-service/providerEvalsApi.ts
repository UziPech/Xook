// Evals de proveedores: Rust lee la bóveda y corre `slices.provider_evals.runner`.
// La UI nunca ve ni envía claves.

export interface ProviderEvalResult {
  caso: string;
  resultado: "ok" | "ok_preparatorio" | "fallo";
  puntaje: number;
  motivo: string;
  herramientas_llamadas: string[];
  latencia_ms: number;
}

export interface ProviderEvalSummary {
  casos?: number;
  ok?: number;
  ok_preparatorio?: number;
  fallos?: number;
  puntaje_pct?: number;
  latencia_p50_ms?: number;
  tokens_entrada?: number;
  tokens_salida?: number;
}

export interface ProviderEvalTargetReport {
  resumen: ProviderEvalSummary;
  resultados?: ProviderEvalResult[];
  saltado?: string;
}

/** Clave: `proveedor:modelo`. */
export type ProviderEvalReport = Record<string, ProviderEvalTargetReport>;

export async function runProviderEvals(targets: string[] = []): Promise<ProviderEvalReport> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderEvalReport>("run_provider_evals", { payload: { targets } });
}
