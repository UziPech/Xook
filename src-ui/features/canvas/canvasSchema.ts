export type CanvasKind = "comparison" | "table" | "document";

export type CanvasColumnKind = "text" | "number" | "currency" | "badge" | "rating";

export type CanvasColumnAlign = "left" | "center" | "right";

export type CanvasRowHighlight = "recommended" | "warning" | "muted" | null;

export interface CanvasColumn {
  id: string;
  label: string;
  align: CanvasColumnAlign;
  kind: CanvasColumnKind;
}

export interface CanvasRow {
  id: string;
  cells: Record<string, string>;
  highlight?: CanvasRowHighlight;
  badge?: string;
}

export interface CanvasArtifact {
  id: string;
  title: string;
  subtitle?: string;
  kind: CanvasKind;
  columns: CanvasColumn[];
  rows: CanvasRow[];
  summary?: string;
  markdown?: string;
  updatedAt: string;
  sourceMessageId?: string;
}

export interface ParsedMarkdownTable {
  headers: string[];
  alignments: CanvasColumnAlign[];
  rows: string[][];
}

function normLookupKey(rawKey: string): string {
  return rawKey
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function asNonEmptyString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of ["value", "text", "label", "display", "content", "nombre"]) {
      if (k in obj) {
        const nested = asNonEmptyString(obj[k]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripHtmlCellText(rawHtml: string): string {
  const clean = rawHtml
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(clean).replace(/\s+/g, " ").trim();
}

export function parseHtmlTableFragment(fragment: string): ParsedMarkdownTable | null {
  const rowMatches = Array.from(fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  if (rowMatches.length === 0) return null;

  const parsedRows: string[][] = [];
  let firstHasTh = false;
  for (let rIdx = 0; rIdx < rowMatches.length; rIdx += 1) {
    const rowInner = rowMatches[rIdx][1];
    const cellMatches = Array.from(rowInner.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi));
    if (cellMatches.length === 0) continue;
    if (rIdx === 0 && cellMatches.some((m) => m[1].toLowerCase() === "th")) {
      firstHasTh = true;
    }
    parsedRows.push(cellMatches.map((m) => stripHtmlCellText(m[2])));
  }

  if (parsedRows.length < 2 && !(firstHasTh && parsedRows.length >= 2)) {
    return null;
  }
  const headers = parsedRows[0];
  if (!headers || headers.length < 2 || headers.every((h) => !h)) {
    return null;
  }
  const dataRows = parsedRows.slice(1);
  if (dataRows.length === 0) return null;

  const normalizedRows = dataRows.map((row) => headers.map((_, colIdx) => row[colIdx] ?? ""));
  const alignments: CanvasColumnAlign[] = headers.map((_, idx) => {
    const isNumeric = normalizedRows.every(
      (r) => !r[idx] || /^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$/i.test(r[idx])
    );
    return isNumeric ? "right" : "left";
  });

  return { headers, alignments, rows: normalizedRows };
}

export function extractFirstHtmlTable(text: string): ParsedMarkdownTable | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (!lower.includes("<tr") && !lower.includes("<table")) return null;
  const tableBlocks = Array.from(text.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi));
  for (const blk of tableBlocks) {
    const parsed = parseHtmlTableFragment(blk[0]);
    if (parsed) return parsed;
  }
  const trSeq = text.match(/(?:<tr\b[^>]*>[\s\S]*?<\/tr>\s*)+/i);
  if (trSeq) {
    return parseHtmlTableFragment(trSeq[0]);
  }
  return null;
}

export function parsedTableToMarkdown(tbl: ParsedMarkdownTable): string {
  const headers = tbl.headers.map((h) => h.replace(/\|/g, "\\|"));
  const sep = tbl.alignments.map((a) =>
    a === "right" ? "---:" : a === "center" ? ":---:" : "---"
  );
  const rows = tbl.rows.map((r) => {
    const vals = headers.map((_, idx) =>
      (r[idx] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
    );
    return `| ${vals.join(" | ")} |`;
  });
  return [`| ${headers.join(" | ")} |`, `| ${sep.join(" | ")} |`, ...rows].join("\n");
}

function stripMarkdownTablesFromText(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length && lines[i].includes("|") && isMarkdownTableSeparator(lines[i + 1])) {
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        i += 1;
      }
      continue;
    }
    kept.push(lines[i]);
    i += 1;
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stashMarkdownCodeForCleaning(text: string): { stashedText: string; stash: string[] } {
  const stash: string[] = [];
  const pushToken = (raw: string): string => {
    const idx = stash.length;
    stash.push(raw);
    return `\uE000XOOKCODE_${idx}\uE001`;
  };

  const lines = text.split("\n");
  const outLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    const fenceChar = m ? m[2][0] : "";
    const fenceLen = m ? m[2].length : 0;
    const info = m ? m[3] : "";
    const validOpen = Boolean(m && !(fenceChar === "`" && info.includes("`")));

    if (validOpen) {
      const blockLines: string[] = [line];
      i += 1;
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      while (i < lines.length) {
        blockLines.push(lines[i]);
        if (closeRe.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      outLines.push(pushToken(blockLines.join("\n")));
      continue;
    }

    // Inline code spans on non-fenced lines
    outLines.push(line.replace(/(`+)(?:(?!\1)[^\n])+\1|`[^`\n]+`/g, (match) => pushToken(match)));
    i += 1;
  }

  return { stashedText: outLines.join("\n"), stash };
}

export function cleanVisibleReply(
  text: string,
  options?: { stripTables?: boolean }
): string {
  let out = (text || "").trim();
  if (!out) return "";

  const stripTables = Boolean(options?.stripTables);
  const { stashedText, stash } = stashMarkdownCodeForCleaning(out);
  out = stashedText;

  const replaceHtml = (fragment: string): string => {
    const parsed = parseHtmlTableFragment(fragment);
    if (!parsed) return "";
    return stripTables ? "" : `\n${parsedTableToMarkdown(parsed)}\n`;
  };

  out = out.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, replaceHtml);
  out = out.replace(/(?:<tr\b[^>]*>[\s\S]*?<\/tr>\s*)+(?:\s*<\/table>)?/gi, replaceHtml);
  out = out.replace(
    /<\s*(?:\/\s*)?(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|table|thead|tbody|tfoot|tr|th|td)\b[^>]*>/gi,
    ""
  );
  out = out.replace(
    /(?:^\s*<\s*(?:res|answer|output|final)\s*>|<\s*\/\s*(?:res|answer|output|final)\s*>\s*$|(?:^|\n)[ \t]*<\s*(?:\/\s*)?(?:res|answer|output|final)\s*>[ \t]*(?=\n|$))/gi,
    (match) => (match.startsWith("\n") ? "\n" : "")
  );
  out = out.replace(
    /<\s*\/\s*(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|res|answer|output|final)\s*$/gi,
    ""
  );
  if (stripTables) {
    out = stripMarkdownTablesFromText(out);
  }
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  if (stash.length > 0) {
    out = out.replace(/\uE000XOOKCODE_(\d+)\uE001/g, (_m, idx) => stash[Number(idx)] ?? "");
  }
  return out;
}

export function canvasHasCellData(canvas: CanvasArtifact | null | undefined): boolean {
  if (!canvas) return false;
  if (canvas.columns.length > 0) {
    if (canvas.rows.length === 0) return false;
    return canvas.rows.some((r) =>
      Object.values(r.cells).some((v) => typeof v === "string" && v.trim().length > 0)
    );
  }
  return Boolean(canvas.markdown?.trim() || canvas.summary?.trim());
}

function inferColumnKind(label: string, sampleValues: string[]): CanvasColumnKind {
  const lower = label.toLowerCase();
  if (/(precio|costo|margen|total|ingreso|venta|mxn|usd|\$)/i.test(lower)) {
    return "currency";
  }
  if (/(estado|nivel|prioridad|recomend|etiqueta|categor)/i.test(lower)) {
    return "badge";
  }
  if (/(calific|puntaje|score|rating|estrella)/i.test(lower)) {
    return "rating";
  }
  const nonEmpty = sampleValues.filter(Boolean);
  if (nonEmpty.length > 0) {
    if (nonEmpty.every((v) => /^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$/i.test(v))) {
      return nonEmpty.some((v) => /[$€£]|mxn|usd/i.test(v)) ? "currency" : "number";
    }
  }
  return "text";
}

function inferAlign(kind: CanvasColumnKind, explicit?: string): CanvasColumnAlign {
  if (explicit === "left" || explicit === "center" || explicit === "right") {
    return explicit;
  }
  if (kind === "number" || kind === "currency") return "right";
  if (kind === "badge" || kind === "rating") return "center";
  return "left";
}

function normalizeColId(rawId: string, idx: number, used: Set<string>): string {
  const slug = rawId
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let base = slug || `col_${idx + 1}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  used.add(candidate);
  return candidate;
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

export function parseMarkdownTableBlock(lines: string[]): ParsedMarkdownTable | null {
  if (lines.length < 2) return null;
  const headerLine = lines[0]?.trim() ?? "";
  const separatorLine = lines[1]?.trim() ?? "";
  if (!headerLine.includes("|") || !isMarkdownTableSeparator(separatorLine)) {
    return null;
  }
  const headers = splitMarkdownTableRow(headerLine);
  if (headers.length < 2 || headers.every((h) => !h)) return null;

  const sepCells = splitMarkdownTableRow(separatorLine);
  const alignments: CanvasColumnAlign[] = headers.map((_, idx) => {
    const cell = (sepCells[idx] ?? "").trim();
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const raw = lines[i]?.trim() ?? "";
    if (!raw || !raw.includes("|")) break;
    const parsed = splitMarkdownTableRow(raw);
    const normalized = headers.map((_, colIdx) => parsed[colIdx] ?? "");
    rows.push(normalized);
  }

  return { headers, alignments, rows };
}

export function extractFirstMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].includes("|") && isMarkdownTableSeparator(lines[i + 1])) {
      const table = parseMarkdownTableBlock(lines.slice(i));
      if (table) return table;
    }
  }
  return null;
}

export function markdownTableToCanvasArtifact(
  table: ParsedMarkdownTable,
  options?: { id?: string; title?: string; subtitle?: string; kind?: CanvasKind; summary?: string }
): CanvasArtifact {
  const usedIds = new Set<string>();
  const columns: CanvasColumn[] = table.headers.map((header, idx) => {
    const label = header.replace(/\*\*/g, "").trim() || `Columna ${idx + 1}`;
    const samples = table.rows.map((r) => r[idx] ?? "");
    const kind = inferColumnKind(label, samples);
    const align =
      table.alignments[idx] !== "left"
        ? table.alignments[idx]
        : inferAlign(kind);
    return {
      id: normalizeColId(label, idx, usedIds),
      label,
      align,
      kind,
    };
  });

  const rows: CanvasRow[] = table.rows.map((rawRow, rIdx) => {
    const cells: Record<string, string> = {};
    columns.forEach((col, cIdx) => {
      cells[col.id] = (rawRow[cIdx] ?? "").trim();
    });
    return {
      id: `row_${rIdx + 1}`,
      cells,
      highlight: null,
    };
  });

  const lowerTitle = (options?.title ?? "").toLowerCase();
  const isComparison =
    options?.kind === "comparison" ||
    /compar|vs|alternativ|opci|proveedor/i.test(lowerTitle) ||
    columns.some((c) => /criterio|ventaja|desventaja|opci[oó]n/i.test(c.label));

  return {
    id: options?.id || `canvas_${Date.now()}`,
    title: options?.title?.trim() || "Tabla comparativa",
    subtitle: options?.subtitle?.trim() || undefined,
    kind: options?.kind || (isComparison ? "comparison" : "table"),
    columns,
    rows,
    summary: options?.summary?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeCanvasArtifact(
  raw: unknown,
  fallbackId?: string
): CanvasArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const title = asNonEmptyString(obj.title) || asNonEmptyString(obj.titulo) || "Tabla en Canvas";
  const subtitle = asNonEmptyString(obj.subtitle) || asNonEmptyString(obj.subtitulo) || undefined;
  const summary = asNonEmptyString(obj.summary) || asNonEmptyString(obj.resumen) || undefined;
  const markdown = asNonEmptyString(obj.markdown) || asNonEmptyString(obj.contenido) || undefined;

  const rawKind = asNonEmptyString(obj.kind) || asNonEmptyString(obj.tipo);
  let kind: CanvasKind = "table";
  if (rawKind === "comparison" || rawKind === "comparativa") kind = "comparison";
  else if (rawKind === "document" || rawKind === "documento") kind = "document";
  else if (/compar|vs|alternativ|opci/i.test(title)) kind = "comparison";

  const rawCols = Array.isArray(obj.columns)
    ? obj.columns
    : Array.isArray(obj.columnas)
      ? obj.columnas
      : Array.isArray(obj.headers)
        ? obj.headers
        : Array.isArray(obj.encabezados)
          ? obj.encabezados
          : [];
  const rawRows = Array.isArray(obj.rows)
    ? obj.rows
    : Array.isArray(obj.filas)
      ? obj.filas
      : Array.isArray(obj.data)
        ? obj.data
        : Array.isArray(obj.datos)
          ? obj.datos
          : Array.isArray(obj.items)
            ? obj.items
            : [];

  // Fallback: if no explicit columns/rows, try extracting a Markdown or HTML table if provided
  if (rawCols.length === 0 && rawRows.length === 0 && markdown) {
    const parsedTable = extractFirstMarkdownTable(markdown) ?? extractFirstHtmlTable(markdown);
    if (parsedTable) {
      return markdownTableToCanvasArtifact(parsedTable, {
        id: asNonEmptyString(obj.id) || fallbackId,
        title,
        subtitle,
        kind,
        summary,
      });
    }
    return {
      id: asNonEmptyString(obj.id) || fallbackId || `canvas_${Date.now()}`,
      title,
      subtitle,
      kind: "document",
      columns: [],
      rows: [],
      summary,
      markdown: cleanVisibleReply(markdown) || markdown,
      updatedAt: asNonEmptyString(obj.updatedAt) || new Date().toISOString(),
    };
  }

  // Derive columns from explicit columns OR from first object row
  const usedIds = new Set<string>();
  const rawColMeta: Array<{
    sourceKeys: string[];
    label: string;
    explicitAlign?: string;
    explicitKind?: CanvasColumnKind;
  }> = [];

  if (rawCols.length > 0) {
    rawCols.forEach((c, idx) => {
      if (typeof c === "string") {
        const label = c.trim() || `Columna ${idx + 1}`;
        rawColMeta.push({ sourceKeys: [c, label], label });
      } else if (c && typeof c === "object") {
        const cObj = c as Record<string, unknown>;
        const rawId =
          asNonEmptyString(cObj.id) ||
          asNonEmptyString(cObj.key) ||
          asNonEmptyString(cObj.accessorKey) ||
          asNonEmptyString(cObj.accessor) ||
          asNonEmptyString(cObj.field) ||
          asNonEmptyString(cObj.dataIndex) ||
          asNonEmptyString(cObj.clave) ||
          asNonEmptyString(cObj.slug);
        const label =
          asNonEmptyString(cObj.label) ||
          asNonEmptyString(cObj.header) ||
          asNonEmptyString(cObj.title) ||
          asNonEmptyString(cObj.titulo) ||
          asNonEmptyString(cObj.encabezado) ||
          asNonEmptyString(cObj.name) ||
          asNonEmptyString(cObj.nombre) ||
          asNonEmptyString(cObj.text) ||
          asNonEmptyString(cObj.texto) ||
          rawId ||
          `Columna ${idx + 1}`;
        const rawColKind = asNonEmptyString(cObj.kind) || asNonEmptyString(cObj.type);
        const explicitKind: CanvasColumnKind | undefined =
          rawColKind === "number" ||
          rawColKind === "currency" ||
          rawColKind === "badge" ||
          rawColKind === "rating" ||
          rawColKind === "text"
            ? rawColKind
            : undefined;
        rawColMeta.push({
          sourceKeys: Array.from(new Set([rawId, label].filter(Boolean))),
          label,
          explicitAlign: asNonEmptyString(cObj.align) || undefined,
          explicitKind,
        });
      }
    });
  } else if (rawRows.length > 0 && rawRows[0] && typeof rawRows[0] === "object" && !Array.isArray(rawRows[0])) {
    const first = rawRows[0] as Record<string, unknown>;
    const candidate =
      first.cells && typeof first.cells === "object" && !Array.isArray(first.cells)
        ? (first.cells as Record<string, unknown>)
        : first;
    Object.keys(candidate).forEach((k) => {
      if (k === "id" || k === "highlight" || k === "badge" || k === "destacado" || k === "etiqueta") return;
      rawColMeta.push({ sourceKeys: [k], label: k });
    });
  }

  if (rawColMeta.length === 0) {
    if (markdown || summary) {
      return {
        id: asNonEmptyString(obj.id) || fallbackId || `canvas_${Date.now()}`,
        title,
        subtitle,
        kind: "document",
        columns: [],
        rows: [],
        summary,
        markdown: cleanVisibleReply(markdown || summary || "") || summary,
        updatedAt: asNonEmptyString(obj.updatedAt) || new Date().toISOString(),
      };
    }
    return null;
  }

  const colIds = rawColMeta.map((meta, idx) =>
    normalizeColId(meta.sourceKeys[0] || meta.label, idx, usedIds)
  );

  const recRowRaw = obj.recommended_row !== undefined ? obj.recommended_row : obj.recommendedRow;
  let recRowIdx: number | null = null;
  if (typeof recRowRaw === "number" && Number.isInteger(recRowRaw)) {
    recRowIdx = recRowRaw;
  } else if (typeof recRowRaw === "string" && /^-?\d+$/.test(recRowRaw.trim())) {
    recRowIdx = Number.parseInt(recRowRaw.trim(), 10);
  }
  const recBadgeDefault =
    asNonEmptyString(obj.recommended_badge) || asNonEmptyString(obj.recommendedBadge) || "Recomendado";

  // First pass: normalize all row values so we can infer column kinds from samples
  const normalizedRows: CanvasRow[] = rawRows.slice(0, 120).map((r, rIdx) => {
    const cells: Record<string, string> = {};
    let rowId = `row_${rIdx + 1}`;
    let highlight: CanvasRowHighlight = null;
    let badge: string | undefined;

    if (Array.isArray(r)) {
      colIds.forEach((cid, cIdx) => {
        cells[cid] = asNonEmptyString(r[cIdx]);
      });
    } else if (r && typeof r === "object") {
      const rObj = r as Record<string, unknown>;
      const maybeId = asNonEmptyString(rObj.id);
      if (maybeId) rowId = maybeId;

      const rawHl = asNonEmptyString(rObj.highlight) || asNonEmptyString(rObj.destacado);
      if (rawHl === "recommended" || rawHl === "warning" || rawHl === "muted") {
        highlight = rawHl;
      }
      const rawBadge = asNonEmptyString(rObj.badge) || asNonEmptyString(rObj.etiqueta);
      if (rawBadge) badge = rawBadge;

      const listSrc = (["cells", "celdas", "values", "valores", "data", "columns", "cols"] as const)
        .map((k) => rObj[k])
        .find((v): v is unknown[] => Array.isArray(v));

      if (listSrc) {
        colIds.forEach((cid, cIdx) => {
          cells[cid] = asNonEmptyString(listSrc[cIdx]);
        });
      } else {
        const cellSource =
          rObj.cells && typeof rObj.cells === "object" && !Array.isArray(rObj.cells)
            ? (rObj.cells as Record<string, unknown>)
            : rObj.celdas && typeof rObj.celdas === "object" && !Array.isArray(rObj.celdas)
              ? (rObj.celdas as Record<string, unknown>)
              : rObj;

        const normMap = new Map<string, string>();
        for (const [k, v] of Object.entries(cellSource)) {
          const nk = normLookupKey(k);
          if (nk && !normMap.has(nk)) {
            normMap.set(nk, asNonEmptyString(v));
          }
        }

        colIds.forEach((cid, cIdx) => {
          const meta = rawColMeta[cIdx];
          let val = "";
          for (const key of [cid, ...meta.sourceKeys, meta.label]) {
            if (key in cellSource) {
              val = asNonEmptyString(cellSource[key]);
              if (val || cellSource[key] === 0) break;
            }
          }
          if (!val) {
            for (const key of [cid, ...meta.sourceKeys, meta.label]) {
              const nk = normLookupKey(key);
              const candidate = nk ? normMap.get(nk) : undefined;
              if (candidate) {
                val = candidate;
                break;
              }
            }
          }
          cells[cid] = val;
        });

        if (!Object.values(cells).some(Boolean)) {
          const skipKeys = new Set(["id", "highlight", "badge", "destacado", "etiqueta"]);
          const orderedVals = Object.entries(cellSource)
            .filter(([k]) => !skipKeys.has(k))
            .map(([, v]) => asNonEmptyString(v));
          if (orderedVals.some(Boolean)) {
            colIds.forEach((cid, cIdx) => {
              cells[cid] = orderedVals[cIdx] ?? "";
            });
          }
        }
      }
    }

    if (!highlight && recRowIdx !== null && rIdx === recRowIdx) {
      highlight = "recommended";
      if (!badge) badge = recBadgeDefault;
    }

    return { id: rowId, cells, highlight, badge };
  });

  const columns: CanvasColumn[] = rawColMeta.map((meta, idx) => {
    const cid = colIds[idx];
    const samples = normalizedRows.map((row) => row.cells[cid] ?? "");
    const colKind = meta.explicitKind ?? inferColumnKind(meta.label, samples);
    const align = inferAlign(colKind, meta.explicitAlign);
    return {
      id: cid,
      label: meta.label,
      align,
      kind: colKind,
    };
  });

  return {
    id: asNonEmptyString(obj.id) || fallbackId || `canvas_${Date.now()}`,
    title,
    subtitle,
    kind,
    columns,
    rows: normalizedRows,
    summary,
    markdown,
    updatedAt: asNonEmptyString(obj.updatedAt) || new Date().toISOString(),
  };
}

export function canvasArtifactToMarkdown(canvas: CanvasArtifact): string {
  const parts: string[] = [`# ${canvas.title}`];
  if (canvas.subtitle) parts.push(`_${canvas.subtitle}_`);
  if (canvas.summary) parts.push(`\n> ${canvas.summary}`);

  if (canvas.columns.length > 0) {
    const headers = canvas.columns.map((c) => c.label.replace(/\|/g, "\\|"));
    const sep = canvas.columns.map((c) => {
      if (c.align === "right") return "---:";
      if (c.align === "center") return ":---:";
      return "---";
    });
    const tableLines = [
      `| ${headers.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...canvas.rows.map((r) => {
        const vals = canvas.columns.map((c) =>
          (r.cells[c.id] ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
        );
        return `| ${vals.join(" | ")} |`;
      }),
    ];
    parts.push(`\n${tableLines.join("\n")}`);
  }

  if (canvas.markdown && canvas.markdown.trim()) {
    parts.push(`\n${canvas.markdown.trim()}`);
  }

  return parts.join("\n");
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function canvasArtifactToCsv(canvas: CanvasArtifact): string {
  if (canvas.columns.length === 0) return "";
  const header = canvas.columns.map((c) => escapeCsvCell(c.label)).join(",");
  const rows = canvas.rows.map((r) =>
    canvas.columns.map((c) => escapeCsvCell(r.cells[c.id] ?? "")).join(",")
  );
  return [header, ...rows].join("\n");
}

