/**
 * Lectura y escritura de archivos JSON y JSONL para mostrarlos como formulario o lista
 * en lugar de código. Si el archivo no se puede leer, quien llama muestra el texto crudo.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type StructuredFormat = "json" | "jsonl";

export type ParsedStructured =
  | { format: "json"; value: JsonValue; trailingNewline: boolean }
  | { format: "jsonl"; records: JsonObject[]; trailingNewline: boolean };

export function structuredFormatForExtension(ext: string): StructuredFormat | null {
  const clean = ext.trim().replace(/^\./, "").toLowerCase();
  if (clean === "json") return "json";
  if (clean === "jsonl" || clean === "ndjson") return "jsonl";
  return null;
}

export function parseStructured(text: string, format: StructuredFormat): ParsedStructured | null {
  const trailingNewline = text.endsWith("\n");
  try {
    if (format === "json") {
      if (!text.trim()) return null;
      return { format, value: JSON.parse(text) as JsonValue, trailingNewline };
    }
    const records: JsonObject[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as JsonValue;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      records.push(parsed);
    }
    return records.length > 0 ? { format, records, trailingNewline } : null;
  } catch {
    return null;
  }
}

export function serializeStructured(parsed: ParsedStructured): string {
  const body =
    parsed.format === "json"
      ? JSON.stringify(parsed.value, null, 2)
      : parsed.records.map((record) => JSON.stringify(record)).join("\n");
  return parsed.trailingNewline ? `${body}\n` : body;
}

/** Nombres legibles para las claves que XOOK usa en sus archivos. */
const FIELD_LABELS: Record<string, string> = {
  agent_name: "Nombre del asistente",
  company_name: "Nombre del proyecto",
  domain_type: "Tipo de proyecto",
  domain_label: "Tipo de proyecto (texto)",
  active_role: "Cómo te ayuda Xox",
  mission: "De qué trata",
  currency: "Moneda",
  business_rules: "Reglas",
  rules: "Reglas",
  title: "Título",
  name: "Nombre",
  description: "Descripción",
  decision: "Decisión",
  notes: "Notas",
  timestamp: "Fecha",
  created_at: "Creado",
  updated_at: "Actualizado",
  adjusted_qty: "Cantidad ajustada",
  stock_threshold_days: "Días mínimos de inventario",
  max_budget_per_order: "Presupuesto máximo por pedido",
  email: "Correo",
  phone: "Teléfono",
  category: "Categoría",
  value: "Valor",
};

const VALUE_LABELS: Record<string, string> = {
  approved: "Aprobada",
  rejected: "Descartada",
  completed: "Completada",
  pending: "Pendiente",
  cancelled: "Cancelada",
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export function valueLabel(value: string): string {
  return VALUE_LABELS[value] ?? value;
}

/** Identificadores internos: se agrupan en "Detalles técnicos" para no distraer. */
export function isTechnicalKey(key: string): boolean {
  return /(^|_)(id|uuid|hash|slug)$/i.test(key) || /^(workspace|card|session)_/.test(key);
}

export function formatIfDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

/** Título corto para una tarjeta: el primer campo de texto con cara de nombre. */
export function recordTitle(record: JsonObject, fallback: string): string {
  for (const key of ["title", "name", "nombre", "titulo", "label", "description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const firstText = Object.entries(record).find(
    ([key, value]) => typeof value === "string" && value.trim() && !isTechnicalKey(key)
  );
  return firstText ? String(firstText[1]) : fallback;
}
