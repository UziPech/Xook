export function cleanTtsErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return "No se pudo completar la operación de voz.";
  }
  return trimmed;
}
