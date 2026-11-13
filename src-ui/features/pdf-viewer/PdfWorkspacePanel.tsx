import React, { useEffect, useState } from "react";
import {
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type {
  PdfDraftCoverPreview,
  PdfDraftPreviewBlock,
  PdfDraftProgressEvent,
} from "../ai-service/aiClient";
import {
  readWorkspaceBinaryPreview,
  type PdfPreviewPage,
} from "../workspace-store/workspaceApi";

export interface PdfWorkspaceState {
  status: "generating" | "ready" | "error";
  title: string;
  subtitle?: string;
  path?: string;
  filename?: string;
  theme?: string;
  author?: string;
  date?: string;
  hasCover?: boolean;
  cover?: PdfDraftCoverPreview | null;
  draftBlocks?: PdfDraftPreviewBlock[];
  stage?: PdfDraftProgressEvent["stage"];
  stepLabel?: string;
  progress?: number;
  pageCount?: number;
  sizeBytes?: number;
  pages: PdfPreviewPage[];
  hasMore?: boolean;
  loadingPreview?: boolean;
  loadingMore?: boolean;
  error?: string;
}

interface PdfWorkspacePanelProps {
  width: number;
  state: PdfWorkspaceState;
  isTauriEnv: boolean;
  onOpenExternal?: (relativePath: string) => void;
  onRevealFolder?: (relativePath: string) => void;
  onLoadMorePages?: () => void;
  onRetryPreview?: () => void;
}

interface ThemeVisualStyle {
  label: string;
  pageBg: string;
  text: string;
  heading: string;
  muted: string;
  accent: string;
  surface: string;
  border: string;
  dark: boolean;
}

const THEME_VISUALS: Record<string, ThemeVisualStyle> = {
  executive: {
    label: "Ejecutivo",
    pageBg: "#FFFFFF",
    text: "#1E293B",
    heading: "#0F172A",
    muted: "#64748B",
    accent: "#0284C7",
    surface: "#F8FAFC",
    border: "#E2E8F0",
    dark: false,
  },
  modern: {
    label: "Moderno",
    pageBg: "#FFFFFF",
    text: "#1F2937",
    heading: "#111827",
    muted: "#6B7280",
    accent: "#4F46E5",
    surface: "#F9FAFB",
    border: "#E5E7EB",
    dark: false,
  },
  warm: {
    label: "Cálido",
    pageBg: "#FFFDF9",
    text: "#292524",
    heading: "#1C1917",
    muted: "#78716C",
    accent: "#B45309",
    surface: "#FAF5ED",
    border: "#E7DFD3",
    dark: false,
  },
  slate: {
    label: "Sobrio",
    pageBg: "#FFFFFF",
    text: "#27272A",
    heading: "#18181B",
    muted: "#71717A",
    accent: "#0F766E",
    surface: "#F4F4F5",
    border: "#E4E4E7",
    dark: false,
  },
  obsidian: {
    label: "Oscuro",
    pageBg: "#0F172A",
    text: "#E2E8F0",
    heading: "#F8FAFC",
    muted: "#94A3B8",
    accent: "#38BDF8",
    surface: "#1E293B",
    border: "#334155",
    dark: true,
  },
};

function getThemeVisual(themeName?: string): ThemeVisualStyle {
  const key = (themeName || "executive").trim().toLowerCase();
  return THEME_VISUALS[key] ?? THEME_VISUALS.executive;
}

function renderDraftBlockPreview(
  blk: PdfDraftPreviewBlock,
  index: number,
  pal: ThemeVisualStyle
) {
  const btype = (blk.type || "paragraph").toLowerCase();
  const isStreaming = Boolean(blk.streaming);

  if (btype === "heading") {
    const lvl = blk.level ?? 1;
    const sizeCls =
      lvl <= 1
        ? "text-[13.5px] font-bold pb-1 mb-1 border-b"
        : lvl === 2
        ? "text-[11.5px] font-semibold mt-1"
        : "text-[10.5px] font-semibold";
    return (
      <div
        key={`blk-${index}`}
        className={`${sizeCls} leading-snug transition-all`}
        style={{
          color: lvl === 2 ? pal.accent : pal.heading,
          borderColor: pal.border,
        }}
      >
        {blk.text || blk.title || "Sección..."}
        {isStreaming && (
          <span
            className="inline-block w-1.5 h-3 ml-1 align-middle animate-pulse rounded-xs"
            style={{ backgroundColor: pal.accent }}
          />
        )}
      </div>
    );
  }

  if (
    btype === "bullets" ||
    btype === "bullet_list" ||
    btype === "unordered_list" ||
    btype === "ul" ||
    btype === "list" ||
    btype === "numbered_list" ||
    btype === "ordered_list" ||
    btype === "ol"
  ) {
    const isOrdered = btype === "numbered_list" || btype === "ordered_list" || btype === "ol";
    const items = blk.items ?? [];
    return (
      <ul key={`blk-${index}`} className="space-y-0.5 pl-3">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="text-[10px] leading-relaxed flex items-start gap-1.5"
            style={{ color: pal.text }}
          >
            <span className="font-semibold shrink-0" style={{ color: pal.accent }}>
              {isOrdered ? `${idx + 1}.` : "•"}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (btype === "code" || btype === "code_block" || btype === "pre") {
    return (
      <div
        key={`blk-${index}`}
        className="rounded-md border overflow-hidden"
        style={{
          backgroundColor: "#0F172A",
          borderColor: "#334155",
        }}
      >
        {blk.language && (
          <div className="px-2 py-0.5 text-[8px] font-mono uppercase tracking-wider text-sky-300 bg-[#1E293B] border-b border-slate-700">
            {blk.language}
          </div>
        )}
        <pre className="px-2.5 py-2 text-[9px] leading-relaxed font-mono text-slate-200 whitespace-pre-wrap break-words m-0">
          {blk.text || ""}
          {isStreaming ? " ▍" : ""}
        </pre>
      </div>
    );
  }

  if (btype === "kpi_strip") {
    const metrics = blk.metrics ?? [];
    if (metrics.length === 0) return null;
    return (
      <div
        key={`blk-${index}`}
        className="grid gap-1.5 rounded-md border p-1.5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(metrics.length, 4)}, minmax(0, 1fr))`,
          backgroundColor: pal.surface,
          borderColor: pal.border,
        }}
      >
        {metrics.slice(0, 4).map((m, idx) => (
          <div key={idx} className="min-w-0">
            <div
              className="text-[8px] uppercase tracking-wider truncate font-semibold"
              style={{ color: pal.muted }}
            >
              {m.label}
            </div>
            <div
              className="text-[11px] font-bold truncate"
              style={{ color: pal.heading }}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (btype === "table") {
    const cols = blk.columns ?? [];
    const rows = blk.rows ?? [];
    if (cols.length === 0 && rows.length === 0) return null;
    return (
      <div
        key={`blk-${index}`}
        className="rounded border overflow-hidden text-[9px]"
        style={{ borderColor: pal.border }}
      >
        {cols.length > 0 && (
          <div
            className="grid gap-1 px-1.5 py-1 font-semibold"
            style={{
              gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`,
              backgroundColor: pal.dark ? "#1E293B" : pal.heading,
              color: "#FFFFFF",
            }}
          >
            {cols.map((c, idx) => (
              <span key={idx} className="truncate">
                {c}
              </span>
            ))}
          </div>
        )}
        {rows.slice(0, 4).map((r, rIdx) => (
          <div
            key={rIdx}
            className="grid gap-1 px-1.5 py-1 border-t"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, cols.length || r.length)}, minmax(0, 1fr))`,
              borderColor: pal.border,
              backgroundColor: rIdx % 2 === 1 ? pal.surface : pal.pageBg,
              color: pal.text,
            }}
          >
            {r.map((cell, cIdx) => (
              <span key={cIdx} className="truncate">
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (btype === "image") {
    const label = blk.caption || blk.path?.split("/").pop() || "Imagen";
    return (
      <div
        key={`blk-${index}`}
        className="rounded-md border px-2.5 py-2 flex items-center gap-2 text-[9.5px]"
        style={{ backgroundColor: pal.surface, borderColor: pal.border, color: pal.muted }}
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0" style={{ color: pal.accent }} />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  if (btype === "callout" || btype === "summary" || btype === "quote") {
    return (
      <div
        key={`blk-${index}`}
        className="rounded-r-md px-2.5 py-1.5 border-l-2 text-[9.5px] leading-relaxed"
        style={{
          backgroundColor: pal.surface,
          borderLeftColor: pal.accent,
          color: pal.text,
        }}
      >
        {blk.title && (
          <div className="font-semibold mb-0.5" style={{ color: pal.heading }}>
            {blk.title}
          </div>
        )}
        <p className="line-clamp-3">{blk.text}</p>
      </div>
    );
  }

  return (
    <p
      key={`blk-${index}`}
      className="text-[10px] leading-relaxed"
      style={{ color: pal.text }}
    >
      {blk.text || ""}
      {isStreaming && (
        <span
          className="inline-block w-1.5 h-2.5 ml-1 align-middle animate-pulse rounded-xs"
          style={{ backgroundColor: pal.accent }}
        />
      )}
    </p>
  );
}

export const PdfWorkspacePanel: React.FC<PdfWorkspacePanelProps> = ({
  width,
  state,
  isTauriEnv,
  onOpenExternal,
  onRevealFolder,
  onLoadMorePages,
  onRetryPreview,
}) => {
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [coverThumbUrl, setCoverThumbUrl] = useState<string | null>(null);
  const coverImagePath = state.cover?.imagePath?.trim() || "";

  useEffect(() => {
    let active = true;
    if (!coverImagePath || !isTauriEnv || state.status === "ready") {
      setCoverThumbUrl(null);
      return;
    }
    void readWorkspaceBinaryPreview(coverImagePath)
      .then((preview) => {
        if (active && preview?.dataUrl) {
          setCoverThumbUrl(preview.dataUrl);
        }
      })
      .catch(() => {
        if (active) setCoverThumbUrl(null);
      });
    return () => {
      active = false;
    };
  }, [coverImagePath, isTauriEnv, state.status]);

  const pal = getThemeVisual(state.theme);
  const isGenerating = state.status === "generating";
  const pct = Math.round(Math.min(1, Math.max(0.04, state.progress ?? 0.12)) * 100);
  const hasRealPages = state.pages.length > 0;
  const blocks = state.draftBlocks ?? [];
  const sizeKb = state.sizeBytes ? Math.max(1, Math.round(state.sizeBytes / 1024)) : null;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="@container h-full bg-[#08090d] flex flex-col shrink-0 overflow-hidden select-none"
    >
      {/* Barra superior del documento */}
      <div className="px-3.5 py-2.5 border-b border-white/[0.06] bg-[#0a0b10] space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                isGenerating
                  ? "bg-sky-500/15 border-sky-400/30 text-sky-300"
                  : state.status === "error"
                  ? "bg-rose-500/15 border-rose-400/30 text-rose-300"
                  : "bg-rose-500/15 border-rose-400/25 text-rose-200"
              }`}
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[12px] font-semibold text-zinc-100 truncate">
                  {state.title || "Nuevo documento PDF"}
                </h3>
                {isGenerating && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-[9.5px] font-medium text-sky-200">
                    En vivo · {pct}%
                  </span>
                )}
              </div>
              <p className="text-[10.5px] text-zinc-400 truncate font-mono">
                {isGenerating
                  ? state.stepLabel || "Construyendo documento..."
                  : state.path
                  ? `${state.path}${
                      state.pageCount
                        ? ` · ${state.pageCount} ${state.pageCount === 1 ? "pág." : "págs."}`
                        : ""
                    }${sizeKb ? ` · ${sizeKb} KB` : ""}`
                  : "Vista previa del documento"}
              </p>
            </div>
          </div>

          <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[9.5px] text-zinc-300">
            {pal.label}
          </span>
        </div>

        {/* Barra de progreso en vivo durante generación */}
        {isGenerating && (
          <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-rose-400 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Controles de zoom y acciones de archivo */}
        {state.path && !isGenerating && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="inline-flex items-center gap-1 rounded-lg bg-white/[0.03] border border-white/[0.07] px-1 py-0.5">
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.max(75, z - 15))}
                title="Alejar vista"
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setZoomPct(100)}
                title="Ajustar al ancho"
                className="px-1.5 text-[10px] font-mono text-zinc-300 hover:text-white cursor-pointer"
              >
                {zoomPct}%
              </button>
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.min(175, z + 15))}
                title="Acercar vista"
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {isTauriEnv && onOpenExternal && state.path && (
                <button
                  type="button"
                  onClick={() => onOpenExternal(state.path!)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-[10.5px] font-medium text-zinc-100 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3 text-rose-200" />
                  <span>Abrir</span>
                </button>
              )}
              {isTauriEnv && onRevealFolder && state.path && (
                <button
                  type="button"
                  onClick={() => onRevealFolder(state.path!)}
                  title="Mostrar archivo en Finder"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10.5px] text-zinc-300 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3 text-zinc-400" />
                  <span>Carpeta</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Área principal del documento */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#0b0d13] p-3.5">
        {state.status === "error" ? (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 space-y-2.5 text-center my-6">
            <AlertCircle className="w-5 h-5 text-rose-300 mx-auto" />
            <p className="text-[12px] font-medium text-rose-100">
              No se pudo mostrar la vista previa
            </p>
            <p className="text-[11px] text-rose-200/80 break-words">
              {state.error || "Ocurrió un error al renderizar las páginas del PDF."}
            </p>
            {onRetryPreview && state.path && (
              <button
                type="button"
                onClick={onRetryPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-[11px] text-white cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Reintentar vista previa</span>
              </button>
            )}
          </div>
        ) : hasRealPages ? (
          <div
            className="mx-auto space-y-4 transition-all"
            style={{ width: `${zoomPct}%`, minWidth: zoomPct < 100 ? `${zoomPct}%` : "100%" }}
          >
            {state.pages.map((p) => (
              <div key={p.page} className="space-y-1.5">
                <div className="rounded-xl overflow-hidden border border-white/[0.12] bg-white shadow-[0_14px_34px_rgba(0,0,0,0.48)]">
                  <img
                    src={p.dataUrl}
                    alt={`Página ${p.page} de ${state.title}`}
                    className="w-full h-auto block select-none"
                    draggable={false}
                  />
                </div>
                <div className="flex items-center justify-center">
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[10px] font-mono text-zinc-400">
                    Página {p.page}
                    {state.pageCount ? ` de ${state.pageCount}` : ""}
                  </span>
                </div>
              </div>
            ))}

            {state.hasMore && onLoadMorePages && (
              <div className="pt-1 pb-3 flex justify-center">
                <button
                  type="button"
                  disabled={state.loadingMore}
                  onClick={onLoadMorePages}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.12] text-[11px] font-medium text-zinc-100 disabled:opacity-50 cursor-pointer"
                >
                  {state.loadingMore ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-sky-300" />
                  )}
                  <span>
                    {state.loadingMore
                      ? "Renderizando páginas..."
                      : `Cargar más páginas (${state.pages.length}/${state.pageCount ?? "?"})`}
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : state.loadingPreview && !isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center gap-2.5 text-zinc-400 py-14">
            <Loader2 className="w-5 h-5 animate-spin text-sky-300" />
            <p className="text-[11.5px]">Renderizando páginas del documento...</p>
          </div>
        ) : (
          /* Vista previa en tiempo real mientras se redacta y compila el PDF */
          <div className="mx-auto space-y-3.5 pb-4">
            {/* Hoja 1: Portada (si el agente activó portada o imagen de portada) */}
            {(state.hasCover || state.cover?.enabled) && (
              <div
                className="rounded-xl border shadow-[0_14px_34px_rgba(0,0,0,0.45)] overflow-hidden transition-all"
                style={{
                  backgroundColor:
                    state.cover?.layout === "full_bleed"
                      ? "#0F172A"
                      : state.cover?.layout === "full_page"
                      ? "#FFFFFF"
                      : pal.pageBg,
                  borderColor: "rgba(255,255,255,0.12)",
                }}
              >
                {state.cover?.layout === "full_page" ? (
                  <div className="p-3 space-y-2">
                    {coverThumbUrl ? (
                      <div className="rounded-lg overflow-hidden border border-black/10 bg-white flex items-center justify-center">
                        <img
                          src={coverThumbUrl}
                          alt="Portada"
                          className="w-full max-h-72 object-contain"
                        />
                      </div>
                    ) : (
                      <div
                        className="rounded-lg border px-3 py-6 flex flex-col items-center justify-center gap-2 text-[10.5px]"
                        style={{
                          borderColor: pal.border,
                          backgroundColor: pal.surface,
                          color: pal.muted,
                        }}
                      >
                        <ImageIcon className="w-5 h-5" style={{ color: pal.accent }} />
                        <span className="truncate max-w-full">
                          {coverImagePath || "Imagen de portada"}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[9px] text-slate-500 px-1">
                      <span>Portada íntegra</span>
                      <span>Página 1</span>
                    </div>
                  </div>
                ) : (
                <div className="p-4 space-y-3 min-h-[210px] flex flex-col justify-between">
                  {coverThumbUrl && (
                    <div className="rounded-lg overflow-hidden border border-black/10 max-h-36 bg-black/10">
                      <img
                        src={coverThumbUrl}
                        alt="Portada"
                        className="w-full h-36 object-cover"
                      />
                    </div>
                  )}
                  {!coverThumbUrl && coverImagePath && (
                    <div
                      className="rounded-lg border px-3 py-2 flex items-center gap-2 text-[10px]"
                      style={{
                        borderColor: pal.border,
                        backgroundColor: pal.surface,
                        color: pal.muted,
                      }}
                    >
                      <ImageIcon className="w-3.5 h-3.5 shrink-0" style={{ color: pal.accent }} />
                      <span className="truncate">Portada: {coverImagePath}</span>
                    </div>
                  )}

                  <div
                    className={`space-y-1.5 ${
                      state.cover?.layout === "centered" ? "text-center" : "text-left"
                    }`}
                  >
                    {state.cover?.eyebrow && (
                      <div
                        className="text-[9px] font-bold uppercase tracking-widest"
                        style={{ color: pal.accent }}
                      >
                        {state.cover.eyebrow}
                      </div>
                    )}
                    <div
                      className="text-[17px] font-bold leading-tight"
                      style={{
                        color:
                          state.cover?.layout === "full_bleed" ? "#F8FAFC" : pal.heading,
                      }}
                    >
                      {state.title || "Preparando título de portada..."}
                    </div>
                    {state.subtitle && (
                      <div
                        className="text-[11px] leading-snug"
                        style={{
                          color:
                            state.cover?.layout === "full_bleed" ? "#CBD5E1" : pal.muted,
                        }}
                      >
                        {state.subtitle}
                      </div>
                    )}
                    <div
                      className={`h-0.5 w-10 rounded-full my-1 ${
                        state.cover?.layout === "centered" ? "mx-auto" : ""
                      }`}
                      style={{ backgroundColor: pal.accent }}
                    />
                  </div>

                  <div
                    className="flex items-center justify-between text-[9.5px] pt-1 border-t"
                    style={{
                      color:
                        state.cover?.layout === "full_bleed" ? "#94A3B8" : pal.muted,
                      borderColor:
                        state.cover?.layout === "full_bleed"
                          ? "rgba(255,255,255,0.12)"
                          : pal.border,
                    }}
                  >
                    <span>{state.author || "XOOK"}</span>
                    <span>Portada en vivo</span>
                  </div>
                </div>
                )}
              </div>
            )}

            {/* Hoja de contenido estructurado en vivo */}
            <div
              className="rounded-xl border shadow-[0_14px_34px_rgba(0,0,0,0.45)] p-4 space-y-2.5 min-h-[260px]"
              style={{
                backgroundColor: pal.pageBg,
                borderColor: "rgba(255,255,255,0.12)",
              }}
            >
              {!(state.hasCover || state.cover?.enabled) && (
                <div className="space-y-1 pb-2 border-b" style={{ borderColor: pal.accent }}>
                  <div
                    className="text-[15px] font-bold leading-snug"
                    style={{ color: pal.heading }}
                  >
                    {state.title || "Estructurando documento..."}
                  </div>
                  {state.subtitle && (
                    <div className="text-[10.5px]" style={{ color: pal.muted }}>
                      {state.subtitle}
                    </div>
                  )}
                </div>
              )}

              {blocks.length > 0 ? (
                <div className="space-y-2">
                  {blocks.map((blk, idx) => renderDraftBlockPreview(blk, idx, pal))}
                </div>
              ) : (
                <div className="space-y-2 py-2 animate-pulse">
                  <div className="h-3 w-2/3 rounded" style={{ backgroundColor: pal.border }} />
                  <div className="h-2.5 w-full rounded" style={{ backgroundColor: pal.surface }} />
                  <div className="h-2.5 w-5/6 rounded" style={{ backgroundColor: pal.surface }} />
                  <div className="h-2.5 w-4/5 rounded" style={{ backgroundColor: pal.surface }} />
                </div>
              )}

              {isGenerating && (
                <div
                  className="pt-2 border-t flex items-center gap-1.5 text-[9.5px]"
                  style={{ borderColor: pal.border, color: pal.muted }}
                >
                  <Loader2 className="w-3 h-3 animate-spin" style={{ color: pal.accent }} />
                  <span>{state.stepLabel || "Maquetando páginas finales..."}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

