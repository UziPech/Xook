import type { XoxSkillEntry } from "./xoxStudioApi";

export interface SkillBlockModel {
  slug: string;
  title: string;
  description: string;
  role: string;
  domain: string;
  scope: "global" | "workspace" | "builtin";
  enabled: boolean;
  source: string;
  kind?: string;
  designSpec?: string;
  palettePreview?: string[];
  extraMeta?: Record<string, string>;
  prefs: string[];
  steps: string[];
  donts: string[];
  instructions: string;
}

export const SKILL_DOMAIN_OPTIONS = [
  { id: "general", label: "Uso general" },
  { id: "business", label: "Negocio y ventas" },
  { id: "personal", label: "Productividad personal" },
  { id: "creative", label: "Redacción y creativo" },
  { id: "software", label: "Tecnología / software" },
  { id: "research", label: "Estudio e investigación" },
  { id: "document-design", label: "Diseño de documentos" },
] as const;

export interface SkillStarterTemplate {
  id: string;
  label: string;
  model: Omit<SkillBlockModel, "slug" | "scope" | "source">;
}

export const SKILL_STARTER_TEMPLATES: SkillStarterTemplate[] = [
  {
    id: "summary",
    label: "Resúmenes claros",
    model: {
      title: "Resúmenes claros",
      description: "Resume documentos o temas largos en puntos fáciles de leer.",
      role: "Asistente de Síntesis",
      domain: "general",
      enabled: true,
      prefs: ["Lenguaje cotidiano, sin rodeos ni palabras técnicas innecesarias"],
      steps: [
        "Empieza con la idea principal en una sola frase",
        "Presenta 3 a 5 puntos clave en orden de importancia",
        "Cierra con una recomendación práctica o siguiente paso",
      ],
      donts: ["No copiar párrafos completos ni usar jerga difícil"],
      instructions: "Si el usuario pide ampliar un punto, desarrolla solo ese apartado.",
    },
  },
  {
    id: "sales",
    label: "Mensajes a clientes",
    model: {
      title: "Mensajes a clientes",
      description: "Redacta mensajes amables para responder dudas, cotizaciones o seguimiento.",
      role: "Atención al Cliente",
      domain: "business",
      enabled: true,
      prefs: ["Tono cálido, respetuoso y listo para copiar y enviar"],
      steps: [
        "Saluda por su nombre si está disponible",
        "Responde la duda o cotización con precios y tiempos claros",
        "Termina con una invitación amable a confirmar",
      ],
      donts: ["No prometer descuentos ni fechas sin confirmación"],
      instructions: "Ofrece siempre una versión corta (para WhatsApp) si el mensaje pasa de 5 líneas.",
    },
  },
  {
    id: "review",
    label: "Revisión semanal",
    model: {
      title: "Revisión semanal",
      description: "Ordena pendientes, metas y prioridades para arrancar o cerrar la semana.",
      role: "Organizador Personal",
      domain: "personal",
      enabled: true,
      prefs: ["Listas breves y accionables"],
      steps: [
        "Identifica los 3 objetivos más importantes de la semana",
        "Detecta tareas atrasadas o bloqueadas",
        "Propón bloques simples de tiempo para resolverlas",
      ],
      donts: ["No llenar la lista con más de 7 pendientes a la vez"],
      instructions: "",
    },
  },
];

export function slugifySkillName(raw: string): string {
  return (
    raw
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "habilidad-personalizada"
  );
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const clean = (raw || "").replace(/^\ufeff/, "");
  if (!clean.startsWith("---")) {
    return { meta: {}, body: clean.trim() };
  }
  const lines = clean.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { meta: {}, body: clean.trim() };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx <= 0) {
    return { meta: {}, body: clean.trim() };
  }

  const meta: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const rawLine of lines.slice(1, endIdx)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const startsWs = /^\s/.test(rawLine);
    if (!startsWs && rawLine.includes(":")) {
      const sep = rawLine.indexOf(":");
      const k = rawLine.slice(0, sep).trim().toLowerCase();
      const v = rawLine
        .slice(sep + 1)
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
      if (k) {
        currentKey = k;
        meta[k] = v === "|" || v === ">" || v === "|-" || v === ">-" ? "" : v;
      }
    } else if (startsWs && currentKey) {
      const isListItem = /^-\s+/.test(trimmed);
      const extra = trimmed.replace(/^-\s*/, "").replace(/^["']|["']$/g, "").trim();
      if (extra) {
        const sep = isListItem ? ", " : " ";
        meta[currentKey] = meta[currentKey] ? `${meta[currentKey]}${sep}${extra}` : extra;
      }
    }
  }

  return {
    meta,
    body: lines.slice(endIdx + 1).join("\n").trim(),
  };
}

const STANDARD_SKILL_FRONTMATTER_KEYS = new Set([
  "name",
  "title",
  "description",
  "role",
  "domain",
  "enabled",
  "source",
  "updated_at",
  "kind",
  "design_spec",
  "palette_preview",
]);

const DESIGN_EXTRA_META_KEYS = [
  "source_format",
  "supported_outputs",
  "source_file",
  "source_pdf",
  "document_type",
] as const;

function parsePalettePreview(raw?: string): string[] {
  if (!raw) return [];
  const matches = raw.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hex of matches) {
    const norm = hex.toUpperCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
      if (out.length >= 6) break;
    }
  }
  return out;
}

function parseSupportedOutputs(raw?: string): string[] {
  if (!raw) return [];
  const cleaned = raw.replace(/[\[\]"']/g, " ");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cleaned.split(/[\s,]+/)) {
    const token = part.trim().toLowerCase().replace(/^\./, "");
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export interface SkillDesignMeta {
  isPdfDesign: boolean;
  isDocumentDesign: boolean;
  kind?: string;
  designSpec?: string;
  palettePreview: string[];
  documentType?: string;
  sourceFormat?: string;
  supportedOutputs?: string[];
  sourceFile?: string;
  sourcePdf?: string;
}

export type DesignSkillBadgeMetaInput =
  | SkillDesignMeta
  | SkillBlockModel
  | {
      kind?: string;
      sourceFormat?: string;
      source_format?: string;
      sourceFile?: string;
      source_file?: string;
      sourcePdf?: string;
      source_pdf?: string;
      extraMeta?: Record<string, string>;
    }
  | null
  | undefined;

export function getDesignSkillBadgeLabel(meta: DesignSkillBadgeMetaInput): string {
  if (!meta) return "Diseño Doc";
  const extra = "extraMeta" in meta && meta.extraMeta ? meta.extraMeta : undefined;
  const rawFormat = (
    ("sourceFormat" in meta ? meta.sourceFormat : undefined) ||
    ("source_format" in meta ? meta.source_format : undefined) ||
    extra?.source_format ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/^\./, "");

  const sourcePath = (
    ("sourceFile" in meta ? meta.sourceFile : undefined) ||
    ("source_file" in meta ? meta.source_file : undefined) ||
    extra?.source_file ||
    ("sourcePdf" in meta ? meta.sourcePdf : undefined) ||
    ("source_pdf" in meta ? meta.source_pdf : undefined) ||
    extra?.source_pdf ||
    ""
  )
    .trim()
    .toLowerCase();
  const inferredExt = sourcePath.includes(".") ? sourcePath.split(".").pop() || "" : "";
  const fmt = rawFormat || inferredExt;

  if (fmt === "docx" || fmt === "doc" || fmt === "rtf" || fmt === "odt" || fmt === "word") {
    return "Diseño Word";
  }
  if (
    fmt === "xlsx" ||
    fmt === "xls" ||
    fmt === "ods" ||
    fmt === "csv" ||
    fmt === "tsv" ||
    fmt === "excel"
  ) {
    return "Diseño Excel";
  }
  if (fmt === "pptx" || fmt === "ppt" || fmt === "odp" || fmt === "powerpoint") {
    return "Diseño PPTX";
  }
  if (fmt === "pdf" || meta.kind === "pdf-design") {
    return "Diseño PDF";
  }
  return "Diseño Doc";
}

export function extractSkillDesignMeta(entry: XoxSkillEntry): SkillDesignMeta {
  const { meta } = parseFrontmatter(entry.rawMarkdown);
  const kind = meta.kind?.trim() || undefined;
  const designSpec = meta.design_spec?.trim() || undefined;
  const palettePreview = parsePalettePreview(meta.palette_preview);
  const documentType = meta.document_type?.trim() || undefined;
  const sourcePdf = meta.source_pdf?.trim() || undefined;
  const sourceFile = meta.source_file?.trim() || sourcePdf || undefined;
  const rawSourceFormat = meta.source_format?.trim().toLowerCase().replace(/^\./, "") || undefined;
  const inferredFromFile =
    sourceFile && sourceFile.includes(".")
      ? sourceFile.split(".").pop()?.trim().toLowerCase()
      : undefined;
  const sourceFormat =
    rawSourceFormat ||
    inferredFromFile ||
    (kind === "pdf-design" ? "pdf" : undefined);
  const supportedOutputs = parseSupportedOutputs(meta.supported_outputs);
  const domain = (meta.domain || entry.domain || "").trim().toLowerCase();
  const isDocumentDesign =
    kind === "document-design" ||
    kind === "pdf-design" ||
    domain === "document-design" ||
    Boolean(designSpec);
  return {
    isPdfDesign: isDocumentDesign,
    isDocumentDesign,
    kind,
    designSpec,
    palettePreview,
    documentType,
    sourceFormat,
    ...(supportedOutputs.length > 0 ? { supportedOutputs } : {}),
    sourceFile,
    sourcePdf,
  };
}

export function parseSkillToBlocks(entry: XoxSkillEntry): SkillBlockModel {
  const { meta, body } = parseFrontmatter(entry.rawMarkdown);

  let title = meta.title || entry.name || entry.slug;
  let description = meta.description || entry.description || "";
  const prefs: string[] = [];
  const steps: string[] = [];
  const donts: string[] = [];
  const extraLines: string[] = [];

  type SectionKey = "prefs" | "steps" | "donts" | "instructions" | "extra";
  let section: SectionKey = "extra";

  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("# ") && !meta.title) {
      title = trimmed.slice(2).trim() || title;
      continue;
    }
    if (/^\*\*prop[oó]sito:\*\*/i.test(trimmed)) {
      const parsedDesc = trimmed.replace(/^\*\*prop[oó]sito:\*\*/i, "").trim();
      if (!description && parsedDesc) description = parsedDesc;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim().toLowerCase();
      if (/(gusto|estilo|preferencia)/.test(heading)) {
        section = "prefs";
      } else if (/(flujo|paso|workflow|proceso)/.test(heading)) {
        section = "steps";
      } else if (/(no hacer|evitar|l[ií]mite)/.test(heading)) {
        section = "donts";
      } else if (/(criterio|instruccion|indicacion)/.test(heading)) {
        section = "instructions";
      } else {
        section = "extra";
        extraLines.push(rawLine);
      }
      continue;
    }

    if ((section === "prefs" || section === "steps" || section === "donts") && /^[-*•]\s+/.test(trimmed)) {
      const item = trimmed.replace(/^[-*•]\s+/, "").trim();
      if (item) {
        if (section === "prefs") prefs.push(item);
        else if (section === "steps") steps.push(item);
        else donts.push(item);
      }
      continue;
    }

    if (section === "instructions" || section === "extra") {
      extraLines.push(rawLine);
    }
  }

  const scope =
    entry.scope === "workspace" || entry.scope === "builtin" ? entry.scope : "global";

  const kind =
    meta.kind?.trim() ||
    (meta.design_spec?.trim() ? "document-design" : undefined);
  const designSpec = meta.design_spec?.trim() || undefined;
  const palettePreview = parsePalettePreview(meta.palette_preview);
  const extraMeta: Record<string, string> = {};
  for (const key of DESIGN_EXTRA_META_KEYS) {
    const val = meta[key]?.trim();
    if (val) extraMeta[key] = val;
  }
  for (const [k, v] of Object.entries(meta)) {
    if (!STANDARD_SKILL_FRONTMATTER_KEYS.has(k) && v.trim() && !(k in extraMeta)) {
      extraMeta[k] = v.trim();
    }
  }

  return {
    slug: entry.slug,
    title: title.trim() || entry.slug,
    description: description.trim(),
    role: (meta.role || entry.role || "").trim(),
    domain: (meta.domain || entry.domain || "general").trim() || "general",
    scope,
    enabled: entry.enabled,
    source: entry.source || "learned-from-user",
    ...(kind ? { kind } : {}),
    ...(designSpec ? { designSpec } : {}),
    ...(palettePreview.length > 0 ? { palettePreview } : {}),
    ...(Object.keys(extraMeta).length > 0 ? { extraMeta } : {}),
    prefs,
    steps,
    donts,
    instructions: extraLines.join("\n").trim(),
  };
}

function cleanBullets(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = raw.replace(/^[-*•\s]+/, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(clean);
    }
  }
  return out;
}

export function serializeBlocksToSkillMarkdown(model: SkillBlockModel): string {
  const title = model.title.replace(/\s+/g, " ").trim() || "Habilidad personalizada";
  const slug = slugifySkillName(model.slug || title);
  const desc = (model.description.replace(/\s+/g, " ").trim() || `Ayuda personalizada para ${title}`).replace(/"/g, "'");
  const safeTitle = title.replace(/"/g, "'");
  const safeRole = model.role.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  const safeDomain = (model.domain || "general").trim().replace(/"/g, "'");
  const safeKind = (model.kind || "").trim().replace(/"/g, "'");
  const safeDesignSpec = (model.designSpec || "").trim().replace(/"/g, "'");
  const cleanPalette = parsePalettePreview((model.palettePreview ?? []).join(", "));
  const today = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    "---",
    `name: "${slug}"`,
    `title: "${safeTitle}"`,
    `description: "${desc}"`,
  ];
  if (safeRole) lines.push(`role: "${safeRole}"`);
  if (safeDomain) lines.push(`domain: "${safeDomain}"`);
  if (safeKind) lines.push(`kind: "${safeKind}"`);
  if (safeDesignSpec) lines.push(`design_spec: "${safeDesignSpec}"`);
  if (cleanPalette.length > 0) {
    lines.push(`palette_preview: "${cleanPalette.join(", ")}"`);
  }
  if (model.extraMeta) {
    for (const [rawKey, rawVal] of Object.entries(model.extraMeta)) {
      const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const val = (rawVal ?? "").replace(/\s+/g, " ").trim().replace(/"/g, "'");
      if (!key || !val || STANDARD_SKILL_FRONTMATTER_KEYS.has(key)) continue;
      lines.push(`${key}: "${val}"`);
    }
  }
  lines.push(
    `enabled: ${model.enabled ? "true" : "false"}`,
    `source: "${(model.source || "user-studio").replace(/"/g, "'")}"`,
    `updated_at: "${today}"`,
    "---",
    "",
    `# ${title}`,
    "",
    `**Propósito:** ${desc}`
  );

  const prefs = cleanBullets(model.prefs);
  const steps = cleanBullets(model.steps);
  const donts = cleanBullets(model.donts);
  const inst = model.instructions.trim();

  if (prefs.length > 0) {
    lines.push("", "## Gustos y Estilo del Usuario", ...prefs.map((p) => `- ${p}`));
  }
  if (steps.length > 0) {
    lines.push("", "## Flujo de Trabajo", ...steps.map((s) => `- ${s}`));
  }
  if (donts.length > 0) {
    lines.push("", "## Qué NO Hacer", ...donts.map((d) => `- ${d}`));
  }
  if (inst) {
    lines.push("", "## Criterios e Instrucciones", inst);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
