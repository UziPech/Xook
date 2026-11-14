import type { WorkspaceBusinessSummary, WorkspaceNodeEntry } from "./workspaceApi";

export interface ParsedBusinessProfile {
  companyName: string;
  agentName: string;
  currency: string;
  stockThresholdDays: number;
  maxBudgetPerOrder: number;
  businessRules: string[];
  domainType: string;
  domainLabel: string;
  mission: string;
  activeRole: string;
  rawObj: Record<string, unknown>;
}

export interface ParsedUserPreferencesDoc {
  likes: string[];
  workflows: string[];
  donts: string[];
}

export const DOMAIN_PRESETS = [
  { id: "general", label: "General / Multi-propósito" },
  { id: "business", label: "Negocio / Operación y Ventas" },
  { id: "software", label: "Software / Ingeniería" },
  { id: "research", label: "Investigación / Estudio" },
  { id: "personal", label: "Personal / Productividad" },
  { id: "creative", label: "Creativo / Contenido" },
  { id: "custom", label: "Personalizado" },
] as const;

export interface DomainUiLabels {
  profileSectionTitle: string;
  nameLabel: string;
  empresaZoneLabel: string;
  empresaZoneSubtitle: string;
  datosZoneLabel: string;
  datosZoneSubtitle: string;
}

export function getDomainUiLabels(domainType?: string, domainLabel?: string): DomainUiLabels {
  switch ((domainType || "general").trim().toLowerCase()) {
    case "business":
      return {
        profileSectionTitle: "Mi negocio",
        nameLabel: "Nombre del negocio",
        empresaZoneLabel: "Empresa y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Datos del Negocio",
        datosZoneSubtitle: "Fuentes para revisiones reales",
      };
    case "software":
      return {
        profileSectionTitle: "Proyecto de Software",
        nameLabel: "Nombre del proyecto",
        empresaZoneLabel: "Arquitectura y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Specs y Datos",
        datosZoneSubtitle: "Fuentes y definiciones del proyecto",
      };
    case "research":
      return {
        profileSectionTitle: "Investigación / Estudio",
        nameLabel: "Nombre del proyecto o tema",
        empresaZoneLabel: "Marco y Criterios",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Fuentes y Datos",
        datosZoneSubtitle: "Documentos, datasets y notas",
      };
    case "personal":
      return {
        profileSectionTitle: "Espacio Personal",
        nameLabel: "Nombre del espacio",
        empresaZoneLabel: "Perfil y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Recursos y Registros",
        datosZoneSubtitle: "Archivos de referencia personal",
      };
    case "creative":
      return {
        profileSectionTitle: "Proyecto Creativo",
        nameLabel: "Nombre del proyecto",
        empresaZoneLabel: "Dirección y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Recursos y Guiones",
        datosZoneSubtitle: "Material base del proyecto",
      };
    case "custom":
      return {
        profileSectionTitle: domainLabel?.trim() || "Mi Espacio",
        nameLabel: "Nombre del espacio",
        empresaZoneLabel: "Contexto y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Datos y Fuentes",
        datosZoneSubtitle: "Archivos fuente del proyecto",
      };
    default:
      return {
        profileSectionTitle: "Proyecto o Espacio",
        nameLabel: "Nombre del espacio / proyecto",
        empresaZoneLabel: "Contexto y Reglas",
        empresaZoneSubtitle: "Requiere aprobación HITL para Xox",
        datosZoneLabel: "Datos y Fuentes",
        datosZoneSubtitle: "Archivos y datos reales",
      };
  }
}

export interface ParsedSupplier {
  id: string;
  name: string;
  leadTimeDays: number;
  contact: string;
  notes: string;
  rawObj: Record<string, unknown>;
}

export interface ParsedSuppliersDoc {
  suppliers: ParsedSupplier[];
  rawContainer: Record<string, unknown>;
}

export interface ParsedFactListDoc {
  title: string;
  subtitle: string;
  items: string[];
}

export const SUPPORTED_CURRENCIES = [
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "USD", label: "USD — Dólar estadounidense" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "CLP", label: "CLP — Peso chileno" },
  { code: "PEN", label: "PEN — Sol peruano" },
] as const;

const INTERNAL_FILES = new Set([
  "empresa/perfil.json",
  "empresa/proveedores.json",
  "empresa/reglas/operacion.md",
  "memoria/hechos.md",
  "memoria/patrones.json",
  "memoria/decisiones.jsonl",
  "habilidades/perfil-usuario.md",
  "agente/notas-xox.md",
]);

export function isInternalWorkspaceEntry(entry: WorkspaceNodeEntry): boolean {
  if (entry.kind !== "file") return false;
  if (INTERNAL_FILES.has(entry.relativePath)) return true;
  if (entry.relativePath.startsWith("agente/logs/")) return true;
  if (entry.relativePath.startsWith("agente/.")) return true;
  // Ocultar espejos técnicos .json cuando son archivos de configuración/estado
  if (entry.zone === "memoria" && entry.extension === "json") return true;
  if (entry.zone === "memoria" && entry.extension === "jsonl") return true;
  if (entry.relativePath.startsWith("agente/ordenes/") && entry.extension === "json") {
    return true;
  }
  return false;
}

export function formatFriendlyZone(entry: WorkspaceNodeEntry, domainType?: string): string {
  const labels = getDomainUiLabels(domainType);
  if (entry.relativePath.startsWith("agente/reportes")) return "Reporte";
  if (entry.relativePath.startsWith("agente/revisiones")) return "Revisión";
  if (entry.relativePath.startsWith("agente/ordenes")) return "Entrega";
  if (entry.relativePath.startsWith("agente/adjuntos")) return "Adjunto";
  if (entry.relativePath.startsWith("agente/borradores")) return "Borrador";
  if (entry.relativePath.startsWith("datos/ventas")) return "Registros";
  if (entry.relativePath.startsWith("datos/documentos")) return "Documento";
  switch (entry.zone) {
    case "datos":
      return labels.datosZoneLabel;
    case "empresa":
      return labels.empresaZoneLabel;
    case "memoria":
      return "Memoria";
    case "habilidades":
      return "Habilidad";
    case "agente":
      return "Xox";
    default:
      return "Archivo";
  }
}

export function formatReadableFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "Vacío";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function parseBusinessProfile(
  rawJson: string | undefined | null,
  fallback?: WorkspaceBusinessSummary | null
): ParsedBusinessProfile {
  let rawObj: Record<string, unknown> = {};
  if (rawJson && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rawObj = parsed as Record<string, unknown>;
      }
    } catch {
      // Mantiene valores por defecto si el JSON estuviera dañado
    }
  }

  const str = (key: string, fb: string): string => {
    const v = rawObj[key];
    return typeof v === "string" && v.trim() ? v.trim() : fb;
  };

  const num = (key: string, fb: number, minVal = 1): number => {
    const v = rawObj[key];
    const parsed = typeof v === "number" ? v : Number(v);
    return Number.isFinite(parsed) && parsed >= minVal ? parsed : fb;
  };

  const rulesRaw = Array.isArray(rawObj.business_rules) ? rawObj.business_rules : [];
  const businessRules = rulesRaw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

  return {
    companyName: str("company_name", fallback?.companyName || "Mi Espacio"),
    agentName: str("agent_name", fallback?.agentName || "Xox"),
    currency: str("currency", fallback?.currency || "MXN").toUpperCase(),
    stockThresholdDays: Math.round(
      num("stock_threshold_days", fallback?.stockThresholdDays || 7, 1)
    ),
    maxBudgetPerOrder: num("max_budget_per_order", fallback?.maxBudgetPerOrder || 25000, 0),
    businessRules,
    domainType: str("domain_type", fallback?.domainType || "general").toLowerCase(),
    domainLabel: str("domain_label", fallback?.domainLabel || ""),
    mission: str("mission", ""),
    activeRole: str("active_role", fallback?.activeRole || "Asistente Co-Constructor"),
    rawObj,
  };
}

export function serializeBusinessProfile(profile: ParsedBusinessProfile): string {
  const next: Record<string, unknown> = {
    ...profile.rawObj,
    company_name: profile.companyName.trim() || "Mi Espacio",
    agent_name: profile.agentName.trim() || "Xox",
    currency: profile.currency.trim().toUpperCase() || "MXN",
    stock_threshold_days: Math.max(1, Math.round(profile.stockThresholdDays || 7)),
    max_budget_per_order: Math.max(0, Number(profile.maxBudgetPerOrder || 0)),
    preferred_suppliers: Array.isArray(profile.rawObj.preferred_suppliers)
      ? profile.rawObj.preferred_suppliers
      : [],
    business_rules: profile.businessRules.map((r) => r.trim()).filter(Boolean),
    domain_type: (profile.domainType || "general").trim().toLowerCase() || "general",
    active_role: profile.activeRole.trim() || "Asistente Co-Constructor",
  };
  if (profile.domainLabel.trim()) {
    next.domain_label = profile.domainLabel.trim();
  } else {
    delete next.domain_label;
  }
  if (profile.mission.trim()) {
    next.mission = profile.mission.trim();
  } else {
    delete next.mission;
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

function slugifySupplierId(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base ? `prov_${base}` : `prov_${index + 1}`;
}

export function parseSuppliersFile(rawJson: string | undefined | null): ParsedSuppliersDoc {
  let rawContainer: Record<string, unknown> = {};
  let rawList: unknown[] = [];

  if (rawJson && rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else if (parsed && typeof parsed === "object") {
        rawContainer = parsed as Record<string, unknown>;
        const candidate =
          rawContainer.suppliers ?? rawContainer.proveedores ?? rawContainer.items;
        if (Array.isArray(candidate)) {
          rawList = candidate;
        }
      }
    } catch {
      // Silencio si JSON inválido
    }
  }

  const suppliers: ParsedSupplier[] = rawList
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((obj, idx) => {
      const name = String(obj.name ?? obj.nombre ?? "").trim() || `Proveedor ${idx + 1}`;
      const id = String(obj.id ?? obj.supplier_id ?? "").trim() || slugifySupplierId(name, idx);
      const rawDays = Number(
        obj.delivery_lead_time_days ?? obj.lead_time_days ?? obj.dias_entrega ?? 3
      );
      const leadTimeDays =
        Number.isFinite(rawDays) && rawDays >= 1 ? Math.round(rawDays) : 3;
      const contact = String(obj.contact ?? obj.contacto ?? obj.email ?? obj.phone ?? "").trim();
      const notes = String(obj.notes ?? obj.notas ?? "").trim();
      return {
        id,
        name,
        leadTimeDays,
        contact,
        notes,
        rawObj: obj,
      };
    });

  return { suppliers, rawContainer };
}

export function serializeSuppliersFile(
  suppliers: ParsedSupplier[],
  rawContainer: Record<string, unknown> = {}
): string {
  const nextArray = suppliers.map((s, idx) => {
    const cleanName = s.name.trim();
    const out: Record<string, unknown> = {
      ...s.rawObj,
      id: s.id.trim() || slugifySupplierId(cleanName, idx),
      name: cleanName,
      delivery_lead_time_days: Math.max(1, Math.round(s.leadTimeDays || 3)),
    };
    if (s.contact.trim()) {
      out.contact = s.contact.trim();
    } else {
      delete out.contact;
    }
    if (s.notes.trim()) {
      out.notes = s.notes.trim();
    } else {
      delete out.notes;
    }
    return out;
  });

  // Guardamos como objeto { suppliers: [...] } para compatibilidad total entre Rust (inventory.rs) y Python (review_engine.py)
  const payload: Record<string, unknown> = {
    ...rawContainer,
    suppliers: nextArray,
  };
  delete payload.proveedores;
  delete payload.items;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseMarkdownFactList(
  rawMd: string | undefined | null,
  fallbackTitle: string,
  fallbackSubtitle: string
): ParsedFactListDoc {
  const lines = (rawMd ?? "").split(/\r?\n/);
  let title = fallbackTitle;
  let subtitle = fallbackSubtitle;
  let foundTitle = false;
  let foundSubtitle = false;
  const items: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (!foundTitle) {
        title = line.replace(/^#+\s*/, "").trim() || fallbackTitle;
        foundTitle = true;
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const cleanItem = line.replace(/^[-*]\s+/, "").trim();
      if (cleanItem) items.push(cleanItem);
      continue;
    }

    if (
      !foundSubtitle &&
      items.length === 0 &&
      (line.startsWith("Define aquí") ||
        line.startsWith("Este archivo") ||
        line.startsWith("Aquí "))
    ) {
      subtitle = line;
      foundSubtitle = true;
      continue;
    }

    items.push(line);
  }

  return { title, subtitle, items };
}

export function serializeMarkdownFactList(doc: ParsedFactListDoc): string {
  const cleanTitle = doc.title.trim() || "Memoria";
  const cleanSubtitle = doc.subtitle.trim();
  const cleanItems = doc.items.map((item) => item.trim()).filter(Boolean);

  const lines: string[] = [`# ${cleanTitle}`, ""];
  if (cleanSubtitle) {
    lines.push(cleanSubtitle, "");
  }
  for (const item of cleanItems) {
    lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseUserPreferencesDoc(rawMd: string | undefined | null): ParsedUserPreferencesDoc {
  const likes: string[] = [];
  const workflows: string[] = [];
  const donts: string[] = [];
  let section: "" | "likes" | "workflows" | "donts" = "";

  for (const rawLine of (rawMd ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const low = line.toLowerCase();
    if (line.startsWith("#")) {
      if (low.includes("gusto") || low.includes("estilo") || low.includes("preferencia")) {
        section = "likes";
      } else if (low.includes("flujo") || low.includes("workflow") || low.includes("proceso")) {
        section = "workflows";
      } else if (low.includes("no hacer") || low.includes("evitar") || low.includes("límite") || low.includes("limite")) {
        section = "donts";
      } else {
        section = "";
      }
      continue;
    }
    if (/^[-*•]\s+/.test(line) && section) {
      const item = line.replace(/^[-*•]\s+/, "").trim();
      if (!item) continue;
      if (section === "likes") likes.push(item);
      else if (section === "workflows") workflows.push(item);
      else donts.push(item);
    }
  }

  return { likes, workflows, donts };
}

export function serializeUserPreferencesDoc(doc: ParsedUserPreferencesDoc): string {
  const clean = (arr: string[], fb: string) => {
    const out = arr.map((s) => s.trim()).filter(Boolean);
    return out.length ? out : [fb];
  };
  const likes = clean(doc.likes, "Español claro, directo y práctico.");
  const workflows = clean(doc.workflows, "Validar datos reales del workspace antes de actuar.");
  const donts = clean(doc.donts, "Nunca inventar información ni borrar archivos clave sin confirmación.");

  return [
    "# Perfil del Usuario, Gustos, Flujo y Límites",
    "",
    "Este espacio guía a **Xox** sobre tu forma de trabajar, preferencias y qué evitar.",
    "",
    "## Gustos y Estilo",
    ...likes.map((x) => `- ${x}`),
    "",
    "## Flujo de Trabajo Preferido",
    ...workflows.map((x) => `- ${x}`),
    "",
    "## Qué NO Hacer",
    ...donts.map((x) => `- ${x}`),
    "",
  ].join("\n");
}
