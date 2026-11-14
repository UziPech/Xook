import React, { useEffect, useMemo, useState } from "react";
import {
  SortingState,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  Plus,
  Search,
  Sparkles,
  Star,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  CanvasArtifact,
  CanvasColumn,
  CanvasRow,
  CanvasRowHighlight,
  canvasArtifactToCsv,
  canvasArtifactToMarkdown,
} from "./canvasSchema";

const canvasTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
});

const canvasColumnHelper = createColumnHelper<typeof canvasTableFeatures, CanvasRow>();

interface CanvasPanelProps {
  canvas: CanvasArtifact;
  visible?: boolean;
  onUpdateCanvas: (updated: CanvasArtifact) => void;
  onAskXoxEdit?: (canvas: CanvasArtifact) => void;
  onExportPdf?: (canvas: CanvasArtifact) => Promise<void> | void;
  onClose: () => void;
}

function parseSortableNumeric(raw: string): number | null {
  const cleaned = raw
    .replace(/[$€£,\s]/g, "")
    .replace(/\b(mxn|usd|eur|d[ií]as?|hrs?|h|un\.?|u\.?)\b/gi, "")
    .replace(/%$/, "")
    .trim();
  if (!cleaned || !/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function getBadgeTone(value: string): string {
  const lower = value.toLowerCase();
  if (/(recomend|mejor|[oó]ptim|excelent|ideal|alta\s+rent|activo|listo)/i.test(lower)) {
    return "bg-white/[0.1] border-white/[0.22] text-white";
  }
  if (/(cr[ií]tic|riesgo|agot|alto\s+costo|alerta|retraso)/i.test(lower)) {
    return "bg-rose-500/15 border-rose-400/35 text-rose-200";
  }
  if (/(medio|moderad|precauci[oó]n|revisar|pendiente)/i.test(lower)) {
    return "bg-amber-500/15 border-amber-400/35 text-amber-200";
  }
  return "bg-white/[0.06] border-white/[0.12] text-zinc-200";
}

function isCompactMetricCell(raw: string): boolean {
  const trimmed = raw.replace(/^`+|`+$/g, "").trim();
  if (!trimmed || trimmed.length > 22) return false;
  return /^([$€£]?\s*-?\d[\d.,]*\s*(?:%|kb|mb|gb|tb|mxn|usd|eur|d[ií]as?|hrs?|h|un\.?|u\.?|pzs?|skus?)?|\d{1,4}[/-]\d{1,2}[/-]\d{1,4})$/i.test(
    trimmed
  );
}

function renderFormattedCellText(raw: string, isFirstCol: boolean): React.ReactNode {
  const trimmed = raw.trim();
  if (!trimmed) {
    return <span className="text-zinc-600 italic">—</span>;
  }

  // Si toda la celda viene envuelta en backticks (`ruta/archivo.pdf`), limpiarla y mostrarla como código legible
  if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length > 2 && !trimmed.slice(1, -1).includes("`")) {
    const inner = trimmed.slice(1, -1).trim();
    return (
      <code className="inline-block px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] font-mono text-[11.5px] text-zinc-100 break-all leading-snug">
        {inner}
      </code>
    );
  }

  // Formatear fragmentos inline `código` y **negrita**
  const parts = trimmed.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] font-mono text-[11.5px] text-zinc-100 break-all"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (isFirstCol && /[\\/]/.test(part) && part.length > 18) {
      return (
        <span key={idx} className="font-mono text-[11.5px] text-zinc-100 break-all">
          {part}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function nextHighlightState(current?: CanvasRowHighlight): CanvasRowHighlight {
  if (!current) return "recommended";
  if (current === "recommended") return "warning";
  return null;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({
  canvas,
  visible = true,
  onUpdateCanvas,
  onAskXoxEdit,
  onExportPdf,
  onClose,
}) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "markdown">(
    canvas.columns.length > 0 ? "table" : "markdown"
  );
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(canvas.title);
  const [copiedMd, setCopiedMd] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Al cambiar de artefacto Canvas, reinicia filtros, edición y modo de vista
  useEffect(() => {
    setSorting([]);
    setGlobalFilter("");
    setEditingCell(null);
    setEditingTitle(false);
    setTitleDraft(canvas.title);
    setViewMode(canvas.columns.length > 0 ? "table" : "markdown");
  }, [canvas.id, canvas.columns.length]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(canvas.title);
    }
  }, [canvas.title, editingTitle]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== canvas.title) {
      onUpdateCanvas({
        ...canvas,
        title: trimmed,
        updatedAt: new Date().toISOString(),
      });
    } else {
      setTitleDraft(canvas.title);
    }
  };

  const commitCell = (rowId: string, colId: string) => {
    setEditingCell(null);
    const nextRows = canvas.rows.map((r) =>
      r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: editDraft } } : r
    );
    onUpdateCanvas({
      ...canvas,
      rows: nextRows,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleToggleRowHighlight = (rowId: string) => {
    const nextRows = canvas.rows.map((r) =>
      r.id === rowId
        ? {
            ...r,
            highlight: nextHighlightState(r.highlight),
            badge:
              nextHighlightState(r.highlight) === "recommended" && !r.badge
                ? "Recomendado"
                : nextHighlightState(r.highlight) === null && r.badge === "Recomendado"
                  ? undefined
                  : r.badge,
          }
        : r
    );
    onUpdateCanvas({
      ...canvas,
      rows: nextRows,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddRow = () => {
    if (canvas.columns.length === 0) return;
    const cells: Record<string, string> = {};
    canvas.columns.forEach((c) => {
      cells[c.id] = "";
    });
    const newRowId = `row_${Date.now().toString(36)}`;
    onUpdateCanvas({
      ...canvas,
      rows: [...canvas.rows, { id: newRowId, cells, highlight: null }],
      updatedAt: new Date().toISOString(),
    });
    setEditingCell({ rowId: newRowId, colId: canvas.columns[0].id });
    setEditDraft("");
  };

  const handleDeleteRow = (rowId: string) => {
    if (canvas.rows.length <= 1) return;
    if (editingCell?.rowId === rowId) {
      setEditingCell(null);
    }
    onUpdateCanvas({
      ...canvas,
      rows: canvas.rows.filter((r) => r.id !== rowId),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(canvasArtifactToMarkdown(canvas));
      setCopiedMd(true);
      window.setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      // Ignorar si no hay clipboard
    }
  };

  const handleDownloadCsv = () => {
    const csv = canvasArtifactToCsv(canvas);
    if (!csv) return;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName =
      canvas.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "tabla-xook";
    a.href = url;
    a.download = `${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (!onExportPdf || exportingPdf) return;
    setExportingPdf(true);
    try {
      await onExportPdf(canvas);
    } finally {
      setExportingPdf(false);
    }
  };

  const columns = useMemo(
    () =>
      canvasColumnHelper.columns(
        canvas.columns.map((col: CanvasColumn, colIndex: number) =>
          canvasColumnHelper.accessor((row) => row.cells[col.id] ?? "", {
        id: col.id,
        header: col.label,
        sortFn: (rowA, rowB, columnId) => {
          const aVal = String(rowA.getValue(columnId) ?? "");
          const bVal = String(rowB.getValue(columnId) ?? "");
          const numA = parseSortableNumeric(aVal);
          const numB = parseSortableNumeric(bVal);
          if (numA !== null && numB !== null) {
            return numA - numB;
          }
          return aVal.localeCompare(bVal, "es", { numeric: true, sensitivity: "base" });
        },
        cell: ({ row }) => {
          const r = row.original;
          const val = r.cells[col.id] ?? "";
          const isEditing = editingCell?.rowId === r.id && editingCell?.colId === col.id;

          if (isEditing) {
            return (
              <input
                autoFocus
                aria-label={`Editar ${col.label}`}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => commitCell(r.id, col.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCell(r.id, col.id);
                  if (e.key === "Escape") setEditingCell(null);
                }}
                className="w-full min-w-[84px] px-2 py-1 rounded-md bg-black/75 border border-white/25 text-[12.5px] text-white outline-none"
              />
            );
          }

          const startEdit = () => {
            setEditingCell({ rowId: r.id, colId: col.id });
            setEditDraft(val);
          };

          if (col.kind === "badge" && val.trim()) {
            return (
              <button
                type="button"
                onClick={startEdit}
                title="Clic para editar"
                className="inline-flex items-center cursor-text"
              >
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${getBadgeTone(
                    val
                  )}`}
                >
                  {val.replace(/^`+|`+$/g, "")}
                </span>
              </button>
            );
          }

          const compactCell =
            col.kind === "currency" ||
            col.kind === "number" ||
            isCompactMetricCell(val);

          return (
            <div
              onClick={startEdit}
              title="Clic para editar celda"
              className={`min-h-[22px] rounded px-1 -mx-1 py-0.5 cursor-text hover:bg-white/[0.04] transition-colors flex items-start gap-1.5 leading-relaxed ${
                col.align === "right"
                  ? "justify-end text-right tabular-nums"
                  : col.align === "center"
                    ? "justify-center text-center"
                    : "justify-start text-left"
              }`}
            >
              <span
                className={
                  compactCell
                    ? "font-mono text-[12px] tabular-nums text-zinc-100 font-medium whitespace-nowrap"
                    : colIndex === 0
                      ? "font-medium text-white min-w-[120px] max-w-[230px]"
                      : "text-zinc-200 min-w-[140px]"
                }
              >
                {renderFormattedCellText(val, colIndex === 0)}
              </span>
              {colIndex === 0 && r.badge && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium shrink-0 ${
                    r.highlight === "recommended"
                      ? "bg-white/[0.1] border-white/[0.22] text-white"
                      : r.highlight === "warning"
                        ? "bg-amber-500/15 border-amber-400/35 text-amber-200"
                        : "bg-white/[0.06] border-white/[0.12] text-zinc-200"
                  }`}
                >
                  {r.highlight === "recommended" && <Star className="w-2.5 h-2.5 fill-current" />}
                  {r.badge}
                </span>
              )}
            </div>
          );
        },
      })
        )
      ),
    [canvas.columns, canvas.rows, editingCell, editDraft]
  );

  const table = useTable({
    features: canvasTableFeatures,
    data: canvas.rows,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue ?? "").trim().toLowerCase();
      if (!q) return true;
      const cellsText = Object.values(row.original.cells).join(" ").toLowerCase();
      const badgeText = (row.original.badge ?? "").toLowerCase();
      return cellsText.includes(q) || badgeText.includes(q);
    },
  });

  const markdownSource = useMemo(() => canvasArtifactToMarkdown(canvas), [canvas]);

  const extraMarkdownNotes = useMemo(() => {
    const raw = (canvas.markdown ?? "").trim();
    if (!raw || canvas.columns.length === 0) return "";
    // Filtra la tabla pipe si ya se muestra arriba como tabla interactiva
    const nonTableLines = raw
      .split("\n")
      .filter((line) => !/^\s*\|/.test(line))
      .join("\n")
      .trim();
    return nonTableLines;
  }, [canvas.markdown, canvas.columns.length]);

  const kindLabel =
    canvas.kind === "comparison"
      ? "Comparativa"
      : canvas.kind === "document"
        ? "Documento"
        : "Tabla";

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const showDeleteCol = canvas.rows.length > 1;
  const totalTableCols = canvas.columns.length + 1 + (showDeleteCol ? 1 : 0);

  return (
    <section
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 24px 60px -28px rgba(0,0,0,0.88)",
      }}
      className={`relative h-full flex flex-col rounded-2xl border border-white/[0.08] bg-[#090a0e] overflow-hidden ${
        visible ? "panel-fade-in" : "panel-fade-out"
      }`}
    >
      {/* Cabecera en dos niveles: barra de controles arriba y título amplio debajo */}
      <header className="relative px-4 pt-3 pb-2.5 border-b border-white/[0.07] bg-[#0c0d12] shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="quick-liquid-icon w-7 h-7 rounded-xl flex items-center justify-center shrink-0">
              <Table2 className="w-3.5 h-3.5 text-zinc-200" />
            </div>
            <span className="text-[11px] font-semibold tracking-[0.02em] text-zinc-100">
              Canvas
            </span>
            <span className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.09] text-[10px] font-medium text-zinc-300 shrink-0">
              {kindLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {canvas.columns.length > 0 && (
              <div className="flex items-center rounded-xl bg-white/[0.035] border border-white/[0.08] p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  title="Vista interactiva"
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                    viewMode === "table"
                      ? "bg-white/[0.11] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Tabla
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("markdown")}
                  title="Vista Markdown"
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer inline-flex items-center gap-1 ${
                    viewMode === "markdown"
                      ? "bg-white/[0.11] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>Texto</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCopyMarkdown}
              aria-label="Copiar tabla en formato Markdown"
              title="Copiar tabla para Docs / Notion / Excel"
              className="quick-liquid-btn w-7 h-7 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
            >
              {copiedMd ? (
                <Check className="w-3.5 h-3.5 text-white" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {canvas.columns.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadCsv}
                aria-label="Descargar CSV"
                title="Descargar CSV (Excel)"
                className="quick-liquid-btn w-7 h-7 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            {onExportPdf && (
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={exportingPdf}
                title="Exportar a PDF profesional"
                className="quick-liquid-btn h-7 px-2.5 rounded-xl inline-flex items-center gap-1 text-[11px] font-medium text-zinc-200 hover:text-white cursor-pointer disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-300" />
                <span>{exportingPdf ? "PDF..." : "PDF"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar Canvas"
              title="Cerrar Canvas"
              className="quick-liquid-btn w-7 h-7 rounded-xl flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              aria-label="Título de la tabla"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setTitleDraft(canvas.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full px-2.5 py-1 rounded-lg bg-black/70 border border-white/25 text-[14.5px] font-semibold text-white outline-none"
            />
          ) : (
            <h2
              onClick={() => {
                setTitleDraft(canvas.title);
                setEditingTitle(true);
              }}
              title="Clic para renombrar Canvas"
              className="text-[14.5px] font-semibold tracking-[-0.015em] leading-snug text-white line-clamp-2 cursor-text hover:text-zinc-200 transition-colors"
            >
              {canvas.title}
            </h2>
          )}
          <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
            {canvas.columns.length > 0
              ? filteredRowCount === canvas.rows.length
                ? `${canvas.rows.length} ${
                    canvas.rows.length === 1 ? "fila" : "filas"
                  } · ${canvas.columns.length} columnas`
                : `${filteredRowCount} de ${canvas.rows.length} filas · ${canvas.columns.length} columnas`
              : "Vista de documento"}
            {canvas.subtitle ? ` · ${canvas.subtitle}` : ""}
          </p>
        </div>
      </header>

      {/* Resumen / Conclusión destacada */}
      {canvas.summary && (
        <div className="relative mx-4 mt-3 px-3.5 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-stretch gap-2.5 text-[12px] text-zinc-200 shrink-0">
          <div className="w-[2px] rounded-full bg-zinc-400 shrink-0" />
          <p className="leading-relaxed select-text">{canvas.summary}</p>
        </div>
      )}

      {/* Barra de búsqueda y acciones */}
      {viewMode === "table" && canvas.columns.length > 0 && (
        <div className="relative px-4 pt-3 pb-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              aria-label="Filtrar filas de la tabla"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Filtrar filas..."
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-white/[0.035] border border-white/[0.08] focus:border-white/25 text-[12px] text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors"
            />
            {globalFilter && (
              <button
                type="button"
                onClick={() => setGlobalFilter("")}
                aria-label="Limpiar filtro"
                title="Limpiar filtro"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onAskXoxEdit && (
              <button
                type="button"
                onClick={() => onAskXoxEdit(canvas)}
                className="quick-liquid-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium text-zinc-100 hover:text-white cursor-pointer"
              >
                <Sparkles className="w-3 h-3 text-zinc-300 shrink-0" />
                <span>Ajustar con Xox</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleAddRow}
              className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium text-zinc-100 hover:text-white cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Fila</span>
            </button>
          </div>
        </div>
      )}

      {/* Contenido principal: Tarjeta de tabla @tanstack/react-table o Vista Markdown */}
      <div className="relative flex-1 min-h-0 overflow-auto xook-scroll px-4 pb-4">
        {viewMode === "table" && canvas.columns.length > 0 ? (
          <div className="space-y-3">
            <div
              tabIndex={0}
              role="region"
              aria-label={canvas.title || "Tabla interactiva"}
              className="xook-liquid-table rounded-xl overflow-x-auto xook-scroll focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
            >
              <table className="w-full table-auto border-separate border-spacing-0 text-[12.5px]">
                <caption className="sr-only">{canvas.title || "Tabla generada"}</caption>
                <thead className="sticky top-0 z-10 xook-liquid-table-head">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      <th
                        scope="col"
                        className="w-8 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-400"
                      >
                        ★
                      </th>
                      {hg.headers.map((header) => {
                        const col = canvas.columns.find((c) => c.id === header.column.id);
                        const sorted = header.column.getIsSorted();
                        return (
                          <th
                            key={header.id}
                            scope="col"
                            className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-zinc-200 select-none whitespace-nowrap"
                          >
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={`w-full flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer ${
                                col?.align === "right"
                                  ? "justify-end"
                                  : col?.align === "center"
                                    ? "justify-center"
                                    : "justify-start"
                              }`}
                            >
                              <span>
                                <table.FlexRender header={header} />
                              </span>
                              {sorted === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-white shrink-0" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="w-3 h-3 text-white shrink-0" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 text-zinc-500 shrink-0" />
                              )}
                            </button>
                          </th>
                        );
                      })}
                      {showDeleteCol && (
                        <th scope="col" className="w-8 px-2 py-2.5" aria-label="Acciones" />
                      )}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={totalTableCols}
                        className="px-4 py-10 text-center text-zinc-500 text-xs"
                      >
                        Sin coincidencias para "{globalFilter}".
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row, rowIndex) => {
                      const orig = row.original;
                      const isRecommended = orig.highlight === "recommended";
                      const isWarning = orig.highlight === "warning";
                      const rowClass = isRecommended
                        ? "is-featured"
                        : isWarning
                          ? "is-warning"
                          : rowIndex % 2 === 1
                            ? "is-alt"
                            : "";
                      return (
                        <tr
                          key={row.id}
                          className={`group/row xook-liquid-row ${rowClass}`}
                        >
                          <td className="px-2 py-3 text-center align-top">
                            <button
                              type="button"
                              onClick={() => handleToggleRowHighlight(orig.id)}
                              aria-label="Destacar fila"
                              title="Destacar fila (Recomendado / Atención / Normal)"
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-all cursor-pointer ${
                                isRecommended
                                  ? "bg-white/[0.12] border border-white/25 text-white"
                                  : isWarning
                                    ? "bg-amber-500/15 border border-amber-300/35 text-amber-200 hover:bg-amber-500/20"
                                    : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.08]"
                              }`}
                            >
                              {isWarning ? (
                                <AlertTriangle className="w-3 h-3" />
                              ) : (
                                <Star
                                  className={`w-3 h-3 ${
                                    isRecommended ? "fill-current" : ""
                                  }`}
                                />
                              )}
                            </button>
                          </td>
                          {row.getAllCells().map((cell) => (
                            <td key={cell.id} className="px-3.5 py-3 align-top">
                              <table.FlexRender cell={cell} />
                            </td>
                          ))}
                          {showDeleteCol && (
                            <td className="px-2 py-3 text-center align-top">
                              <button
                                type="button"
                                onClick={() => handleDeleteRow(orig.id)}
                                aria-label="Eliminar fila"
                                title="Eliminar fila"
                                className="p-1 rounded-md text-zinc-500 opacity-0 group-hover/row:opacity-100 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {extraMarkdownNotes && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-zinc-400 mb-1.5">
                  Notas de contexto
                </p>
                <div className="text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap select-text">
                  {extraMarkdownNotes}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 xook-liquid-table rounded-xl p-4">
            <pre className="text-[12.5px] leading-relaxed font-mono text-zinc-200 whitespace-pre-wrap select-text">
              {markdownSource}
            </pre>
          </div>
        )}
      </div>

      {/* Pie discreto */}
      <footer className="relative px-4 py-2 border-t border-white/[0.06] bg-[#0c0d12] flex items-center justify-between text-[10.5px] text-zinc-400 shrink-0">
        <span>Haz clic en título o celda para editar · Ordena por columna</span>
        {copiedMd && (
          <span className="text-zinc-200 font-medium">Copiado en formato Markdown</span>
        )}
      </footer>
    </section>
  );
};
