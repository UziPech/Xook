import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeBlockCard } from "../../utils/CodeBlockCard";
import { getLanguageMetaForExtension } from "../../utils/codeLanguages";
import { MarkdownContent } from "../../utils/markdownRenderer";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GripHorizontal,
  Image as ImageIcon,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PdfDraftProgressEvent } from "../ai-service/aiClient";
import {
  downloadWorkspaceFile,
  loadPdfEditableSpec,
  savePdfDocument,
  type PdfEditableSpec,
  type PdfPagePatch,
  type PdfPreviewPage,
  type UniversalDocumentPayload,
} from "../workspace-store/workspaceApi";

export interface PdfWorkspacePanelState {
  path: string;
  title: string;
  filename?: string;
  theme?: string;
  pageCount?: number;
  sizeBytes?: number;
  hasCover?: boolean;
  pages: PdfPreviewPage[];
  hasMore?: boolean;
  isLoadingPages?: boolean;
  error?: string | null;
  /** Tipo de archivo abierto en el visor universal */
  fileKind?: "pdf" | "text" | "office" | "image";
  textContent?: string;
  fileExtension?: string;
  universalDoc?: UniversalDocumentPayload | null;
  imageDataUrl?: string | null;
  initialMode?: "view" | "edit_blocks" | "edit_page";
}

interface PdfWorkspacePanelProps {
  state: PdfWorkspacePanelState | null;
  draftProgress: PdfDraftProgressEvent | null;
  onClose: () => void;
  onOpenExternal: (relativePath: string) => void;
  onRevealInFolder: (relativePath: string) => void;
  onLoadMorePages?: (relativePath: string, nextStartPage: number) => void;
  onReloadPreview?: (relativePath: string) => void;
  onAskXoxAboutPdf?: (relativePath: string, title: string) => void;
  onSendXoxDocumentInstruction?: (payload: {
    path: string;
    title: string;
    theme: string;
    pageCount: number;
    mode: "append_pages" | "modify";
    instruction: string;
  }) => void;
  onPdfUpdated?: (updated: {
    path: string;
    title: string;
    theme?: string;
    pageCount: number;
    sizeBytes: number;
    pages: PdfPreviewPage[];
    hasMore: boolean;
  }) => void;
  onSaveTextFile?: (relativePath: string, newContent: string) => Promise<void>;
  onExportTextToPdf?: (title: string, markdownContent: string) => Promise<void>;
  onStatusNotice?: (msg: string) => void;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function isPatchModified(patch: PdfPagePatch): boolean {
  if (patch.deleted) return true;
  if (patch.is_new || patch.id.startsWith("patch_")) return true;
  if (
    patch.original_text !== undefined &&
    patch.text !== patch.original_text
  ) {
    return true;
  }
  if (
    patch.orig_x_pct !== undefined &&
    Math.abs(patch.x_pct - patch.orig_x_pct) > 0.25
  ) {
    return true;
  }
  if (
    patch.orig_y_pct !== undefined &&
    Math.abs(patch.y_pct - patch.orig_y_pct) > 0.25
  ) {
    return true;
  }
  return false;
}

export const PdfWorkspacePanel: React.FC<PdfWorkspacePanelProps> = ({
  state,
  draftProgress,
  onClose,
  onOpenExternal,
  onRevealInFolder,
  onLoadMorePages,
  onReloadPreview,
  onAskXoxAboutPdf,
  onSendXoxDocumentInstruction,
  onPdfUpdated,
  onSaveTextFile,
  onExportTextToPdf,
  onStatusNotice,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [activePage, setActivePage] = useState<number>(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Siempre sobre la misma vista previa: "view" (lectura) | "edit_page" (edición directa in-place en la página)
  const [viewerMode, setViewerMode] = useState<"view" | "edit_page">("view");
  const [addingNewTextMode, setAddingNewTextMode] = useState<boolean>(false);

  // Barra inline para pedirle a Xox que modifique o agregue páginas manteniendo la misma tipografía y diseño
  const [showXoxBar, setShowXoxBar] = useState<boolean>(false);
  const [xoxActionMode, setXoxActionMode] = useState<"append_pages" | "modify">("append_pages");
  const [xoxInstruction, setXoxInstruction] = useState<string>("");

  // Pestaña activa en hojas de cálculo (.xlsx, .xls, .csv)
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);

  // Estado de descarga
  const [downloading, setDownloading] = useState(false);
  const [downloadedBadge, setDownloadedBadge] = useState<string | null>(null);

  // Estado de carga y guardado de regiones interactivas del PDF
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [saveSuccessFlash, setSaveSuccessFlash] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [docTitle, setDocTitle] = useState("");
  const [docTheme, setDocTheme] = useState("executive");

  // Regiones de texto interactivas sobre las páginas del PDF
  const [pagePatches, setPagePatches] = useState<PdfPagePatch[]>([]);
  const [selectedPatchId, setSelectedPatchId] = useState<string | null>(null);
  const [draggingPatch, setDraggingPatch] = useState<{
    id: string;
    pageNumber: number;
    startX: number;
    startY: number;
    origXPct: number;
    origYPct: number;
    containerRect: DOMRect;
  } | null>(null);

  // Estado de edición de archivos de texto (.md, .txt, .csv, .json, código)
  const [textDraft, setTextDraft] = useState("");
  const [isEditingTextFile, setIsEditingTextFile] = useState(false);
  const [savingTextFile, setSavingTextFile] = useState(false);
  const [exportingTextPdf, setExportingTextPdf] = useState(false);

  const fileKind = state?.fileKind ?? "pdf";
  const isPdfDocument = fileKind === "pdf";
  const isTextDocument = fileKind === "text";
  const isOfficeDocument = fileKind === "office";
  const isImageDocument = fileKind === "image";
  const uniDoc = state?.universalDoc ?? null;

  const applyLoadedSpec = useCallback((spec: PdfEditableSpec) => {
    setDocTitle(spec.title || "Documento");
    setDocTheme(spec.theme || "executive");
    setPagePatches(spec.pagePatches || []);
  }, []);

  // Cargar documento cuando cambia el archivo activo
  useEffect(() => {
    setActivePage(1);
    setZoom(1);
    setEditError(null);
    setSelectedPatchId(null);
    setAddingNewTextMode(false);
    setDownloadedBadge(null);
    setActiveSheetIdx(0);

    if (!state) {
      setViewerMode("view");
      return;
    }

    setDocTitle(state.title || "Documento");
    setDocTheme(state.theme || "executive");

    if (state.fileKind === "text") {
      setTextDraft(state.textContent ?? state.universalDoc?.text ?? "");
      setIsEditingTextFile(
        state.initialMode === "edit_blocks" || state.initialMode === "edit_page"
      );
      setViewerMode("view");
      return;
    }

    if (state.fileKind === "office" || state.fileKind === "image") {
      setTextDraft(state.universalDoc?.markdown || state.universalDoc?.text || "");
      setIsEditingTextFile(false);
      setViewerMode("view");
      return;
    }

    if (state.initialMode === "edit_blocks" || state.initialMode === "edit_page") {
      setViewerMode("edit_page");
    } else {
      setViewerMode("view");
    }

    let cancelled = false;
    setLoadingSpec(true);
    void loadPdfEditableSpec(state.path)
      .then((spec) => {
        if (cancelled || !spec) return;
        applyLoadedSpec(spec);
      })
      .catch(() => {
        if (cancelled) return;
        setDocTitle(state.title || "Documento");
      })
      .finally(() => {
        if (!cancelled) setLoadingSpec(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    state?.path,
    state?.fileKind,
    state?.textContent,
    state?.universalDoc,
    state?.initialMode,
    applyLoadedSpec,
  ]);

  // Enfocar automáticamente el textarea al seleccionar un elemento de texto en la página
  useEffect(() => {
    if (selectedPatchId && viewerMode === "edit_page") {
      requestAnimationFrame(() => {
        const el = activeTextareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = `${Math.max(el.scrollHeight, 22)}px`;
        }
      });
    }
  }, [selectedPatchId, viewerMode]);

  // Arrastre de cualquier caja de texto sobre la página con el mouse
  useEffect(() => {
    if (!draggingPatch) return;
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - draggingPatch.startX;
      const dy = ev.clientY - draggingPatch.startY;
      const dxPct = (dx / Math.max(1, draggingPatch.containerRect.width)) * 100;
      const dyPct = (dy / Math.max(1, draggingPatch.containerRect.height)) * 100;

      setPagePatches((prev) =>
        prev.map((p) => {
          if (p.id !== draggingPatch.id) return p;
          const nextX = Math.max(
            0,
            Math.min(100 - p.w_pct, +(draggingPatch.origXPct + dxPct).toFixed(2))
          );
          const nextY = Math.max(
            0,
            Math.min(100 - p.h_pct, +(draggingPatch.origYPct + dyPct).toFixed(2))
          );
          return { ...p, x_pct: nextX, y_pct: nextY };
        })
      );
    };
    const handleUp = () => setDraggingPatch(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [draggingPatch]);

  const totalPages = useMemo(() => {
    if (isOfficeDocument && uniDoc?.docKind === "presentation") {
      return uniDoc.slides?.length || 1;
    }
    if (state?.pageCount && state.pageCount > 0) return state.pageCount;
    return state?.pages.length ?? 0;
  }, [state, isOfficeDocument, uniDoc]);

  const modifiedPatchesCount = useMemo(
    () => pagePatches.filter(isPatchModified).length,
    [pagePatches]
  );

  const scrollToPage = (pageNumber: number) => {
    const target = Math.max(1, Math.min(totalPages || 1, pageNumber));
    setActivePage(target);
    const node = pageRefs.current[target];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const itemsCount =
      isOfficeDocument && uniDoc?.docKind === "presentation"
        ? uniDoc.slides?.length || 0
        : state?.pages.length || 0;
    if (!itemsCount) return;

    const containerRect = container.getBoundingClientRect();
    const midY = containerRect.top + containerRect.height * 0.35;

    let closestPage = activePage;
    let closestDist = Number.POSITIVE_INFINITY;
    for (let idx = 1; idx <= itemsCount; idx++) {
      const el = pageRefs.current[idx];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - midY);
      if (dist < closestDist) {
        closestDist = dist;
        closestPage = idx;
      }
    }
    if (closestPage !== activePage) {
      setActivePage(closestPage);
    }
  };

  const handleDownload = async () => {
    if (!state || downloading) return;
    setDownloading(true);
    setEditError(null);
    try {
      const preferred =
        state.filename ||
        state.path.split("/").pop() ||
        `${(state.title || "documento")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")}.${state.fileExtension || "pdf"}`;
      const res = await downloadWorkspaceFile(state.path, preferred);
      if (res?.ok) {
        setDownloadedBadge(res.filename);
        onStatusNotice?.(`Descargado en Descargas: ${res.filename}`);
        setTimeout(() => {
          setDownloadedBadge((curr) => (curr === res.filename ? null : curr));
        }, 4500);
      } else if (isTextDocument) {
        const blob = new Blob([textDraft], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = preferred;
        a.click();
        URL.revokeObjectURL(url);
        setDownloadedBadge(preferred);
      }
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "No se pudo descargar el archivo."
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleSavePdfChanges = async () => {
    if (!state || savingPdf) return;
    setSavingPdf(true);
    setEditError(null);
    setSelectedPatchId(null);
    try {
      const res = await savePdfDocument(state.path, {
        title: docTitle.trim() || state.title || "Documento XOOK",
        theme: docTheme,
        page_patches: pagePatches,
        patches_only: true,
      });

      if (res.editableSpec) {
        applyLoadedSpec(res.editableSpec);
      }
      onPdfUpdated?.({
        path: res.path || state.path,
        title: res.title || docTitle,
        theme: res.theme || docTheme,
        pageCount: res.pageCount,
        sizeBytes: res.sizeBytes,
        pages: res.previewPages,
        hasMore: res.previewHasMore,
      });
      setSaveSuccessFlash(true);
      onStatusNotice?.("Documento PDF actualizado directamente en la vista previa.");
      setTimeout(() => setSaveSuccessFlash(false), 2600);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Error al guardar los cambios en el PDF."
      );
    } finally {
      setSavingPdf(false);
    }
  };

  const handleResetAllChanges = async () => {
    if (!state || savingPdf) return;
    setSelectedPatchId(null);
    const resetList = pagePatches
      .filter((p) => !p.is_new && !p.id.startsWith("patch_"))
      .map((p) => ({
        ...p,
        text: p.original_text ?? p.text,
        x_pct: p.orig_x_pct ?? p.x_pct,
        y_pct: p.orig_y_pct ?? p.y_pct,
        w_pct: p.orig_w_pct ?? p.w_pct,
        h_pct: p.orig_h_pct ?? p.h_pct,
        deleted: false,
      }));
    setPagePatches(resetList);
    setSavingPdf(true);
    try {
      const res = await savePdfDocument(state.path, {
        title: docTitle.trim() || state.title || "Documento XOOK",
        theme: docTheme,
        page_patches: [],
        patches_only: true,
      });
      if (res.editableSpec) {
        applyLoadedSpec(res.editableSpec);
      }
      onPdfUpdated?.({
        path: res.path || state.path,
        title: res.title || docTitle,
        theme: res.theme || docTheme,
        pageCount: res.pageCount,
        sizeBytes: res.sizeBytes,
        pages: res.previewPages,
        hasMore: res.previewHasMore,
      });
      onStatusNotice?.("Documento restaurado a su versión original.");
    } catch {
      // Ignorar si sólo se limpió en memoria
    } finally {
      setSavingPdf(false);
    }
  };

  const handleSaveTextDocument = async () => {
    if (!state || !onSaveTextFile || savingTextFile) return;
    setSavingTextFile(true);
    setEditError(null);
    try {
      await onSaveTextFile(state.path, textDraft);
      setIsEditingTextFile(false);
      setSaveSuccessFlash(true);
      onStatusNotice?.(`Cambios guardados en ${state.filename || state.path}`);
      setTimeout(() => setSaveSuccessFlash(false), 2500);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "No se pudo guardar el archivo."
      );
    } finally {
      setSavingTextFile(false);
    }
  };

  const handleSubmitXoxInstruction = (customText?: string, customMode?: "append_pages" | "modify") => {
    if (!state) return;
    const finalText = (customText ?? xoxInstruction).trim();
    const finalMode = customMode ?? xoxActionMode;
    if (!finalText) return;

    if (onSendXoxDocumentInstruction) {
      onSendXoxDocumentInstruction({
        path: state.path,
        title: docTitle || state.title || "Documento",
        theme: docTheme || state.theme || "executive",
        pageCount: totalPages || 1,
        mode: finalMode,
        instruction: finalText,
      });
      setXoxInstruction("");
      setShowXoxBar(false);
    } else if (onAskXoxAboutPdf) {
      onAskXoxAboutPdf(state.path, docTitle || state.title);
    }
  };

  const handlePageCanvasClick = (
    pageNumber: number,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (viewerMode !== "edit_page") return;
    if ((e.target as HTMLElement).closest("[data-patch-box='true']")) return;

    if (!addingNewTextMode) {
      setSelectedPatchId(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickXPct = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const clickYPct = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;

    const wPct = 36;
    const hPct = 3.8;
    const xPct = Math.max(2, Math.min(100 - wPct - 2, +(clickXPct - 4).toFixed(2)));
    const yPct = Math.max(1.5, Math.min(100 - hPct - 1.5, +(clickYPct - hPct / 2).toFixed(2)));

    const newPatch: PdfPagePatch = {
      id: `patch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      page_number: pageNumber,
      x_pct: xPct,
      y_pct: yPct,
      w_pct: wPct,
      h_pct: hPct,
      orig_x_pct: xPct,
      orig_y_pct: yPct,
      orig_w_pct: wPct,
      orig_h_pct: hPct,
      text: "Nuevo texto",
      original_text: "",
      font_size: 11,
      font_weight: "normal",
      text_color: "#0F172A",
      bg_color: "#FFFFFF",
      align: "left",
      deleted: false,
      is_new: true,
    };

    setPagePatches((prev) => [...prev, newPatch]);
    setSelectedPatchId(newPatch.id);
    setAddingNewTextMode(false);
  };

  const updatePatchById = (id: string, changes: Partial<PdfPagePatch>) => {
    setPagePatches((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...changes } : p))
    );
  };

  const deleteOrErasePatch = (patch: PdfPagePatch) => {
    if (patch.is_new || patch.id.startsWith("patch_")) {
      setPagePatches((prev) => prev.filter((p) => p.id !== patch.id));
    } else {
      updatePatchById(patch.id, { deleted: true });
    }
    if (selectedPatchId === patch.id) {
      setSelectedPatchId(null);
    }
  };

  const restorePatch = (patch: PdfPagePatch) => {
    updatePatchById(patch.id, {
      deleted: false,
      text: patch.original_text ?? patch.text,
      x_pct: patch.orig_x_pct ?? patch.x_pct,
      y_pct: patch.orig_y_pct ?? patch.y_pct,
      w_pct: patch.orig_w_pct ?? patch.w_pct,
      h_pct: patch.orig_h_pct ?? patch.h_pct,
    });
  };

  const isDraftingLive = Boolean(draftProgress);
  const pct = draftProgress
    ? Math.round(Math.min(1, Math.max(0.06, draftProgress.progress || 0.15)) * 100)
    : 0;

  const formatBadgeLabel = useMemo(() => {
    if (!state) return "DOC";
    if (uniDoc?.formatLabel) return uniDoc.formatLabel;
    if (state.fileExtension) return state.fileExtension.toUpperCase();
    if (isImageDocument) return "IMG";
    return "PDF";
  }, [state, uniDoc, isImageDocument]);

  return (
    <section
      aria-label="Visor y editor de documentos"
      className="h-full flex flex-col rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] via-[#090a0e]/95 to-[#050608]/98 backdrop-blur-2xl shadow-[0_24px_64px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.08)] overflow-hidden select-none"
    >
      {/* Cabecera minimalista Black/Gray Liquid Glass — Cierre directo con la X */}
      <header className="px-3.5 py-2 border-b border-white/[0.07] bg-black/45 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-zinc-900/90 border border-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] flex items-center justify-center shrink-0">
            {isDraftingLive ? (
              <Loader2 className="w-3.5 h-3.5 text-zinc-200 animate-spin" />
            ) : uniDoc?.docKind === "presentation" ? (
              <Presentation className="w-3.5 h-3.5 text-zinc-200" />
            ) : uniDoc?.docKind === "spreadsheet" || state?.fileExtension === "csv" ? (
              <FileSpreadsheet className="w-3.5 h-3.5 text-zinc-200" />
            ) : isImageDocument ? (
              <ImageIcon className="w-3.5 h-3.5 text-zinc-200" />
            ) : isTextDocument ? (
              <FileCode2 className="w-3.5 h-3.5 text-zinc-200" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-zinc-200" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-[12.5px] font-semibold text-zinc-100 truncate leading-tight">
              {isDraftingLive
                ? draftProgress?.title || "Maquetando documento…"
                : docTitle || state?.title || "Visor de Documentos"}
            </h2>
            <p className="text-[10px] text-zinc-400 truncate mt-0.5 flex items-center gap-1.5">
              {isDraftingLive ? (
                <span>{draftProgress?.stepLabel || "Compilando estructura…"}</span>
              ) : state ? (
                <>
                  <span className="text-zinc-300 font-medium">{formatBadgeLabel}</span>
                  {(isPdfDocument || uniDoc?.docKind === "presentation") &&
                    totalPages > 0 && (
                      <span>
                        · {totalPages}{" "}
                        {uniDoc?.docKind === "presentation"
                          ? totalPages === 1
                            ? "diapositiva"
                            : "diapositivas"
                          : totalPages === 1
                          ? "pág."
                          : "págs."}
                      </span>
                    )}
                  {uniDoc?.docKind === "spreadsheet" && uniDoc.sheets && (
                    <span>
                      · {uniDoc.sheets.length}{" "}
                      {uniDoc.sheets.length === 1 ? "hoja" : "hojas"}
                    </span>
                  )}
                  {state.sizeBytes ? <span>· {formatFileSize(state.sizeBytes)}</span> : null}
                  {saveSuccessFlash && (
                    <span className="inline-flex items-center gap-1 text-zinc-100 bg-white/[0.1] border border-white/[0.16] px-1.5 py-0.2 rounded-full text-[9.5px]">
                      <Check className="w-2.5 h-2.5" /> Guardado
                    </span>
                  )}
                </>
              ) : (
                <span>Selecciona o genera un documento</span>
              )}
            </p>
          </div>
        </div>

        {/* Selector directo Vista / Editar + Botón único X para cerrar y liberar el visor */}
        <div className="flex items-center gap-1.5 shrink-0">
          {state && !isDraftingLive && isPdfDocument && (
            <div
              role="group"
              aria-label="Modo de visualización y edición en vista previa"
              className="inline-flex items-center rounded-xl bg-zinc-950/90 border border-white/[0.08] p-0.5"
            >
              <button
                type="button"
                aria-pressed={viewerMode === "view"}
                onClick={() => {
                  setViewerMode("view");
                  setSelectedPatchId(null);
                  setAddingNewTextMode(false);
                }}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer ${
                  viewerMode === "view"
                    ? "bg-zinc-800/95 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] border border-white/[0.1]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Vista</span>
              </button>
              <button
                type="button"
                aria-pressed={viewerMode === "edit_page"}
                onClick={() => setViewerMode("edit_page")}
                title="Haz clic sobre cualquier texto en la vista previa para editarlo o borrarlo"
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer ${
                  viewerMode === "edit_page"
                    ? "bg-zinc-800/95 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] border border-white/[0.1]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Pencil className="w-3 h-3" />
                <span>Editar</span>
              </button>
            </div>
          )}

          {state && !isDraftingLive && isTextDocument && (
            <div
              role="group"
              aria-label="Modo de archivo"
              className="inline-flex items-center rounded-xl bg-zinc-950/90 border border-white/[0.08] p-0.5"
            >
              <button
                type="button"
                aria-pressed={!isEditingTextFile}
                onClick={() => setIsEditingTextFile(false)}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer ${
                  !isEditingTextFile
                    ? "bg-zinc-800/95 text-white border border-white/[0.1]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Vista</span>
              </button>
              <button
                type="button"
                aria-pressed={isEditingTextFile}
                onClick={() => setIsEditingTextFile(true)}
                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer ${
                  isEditingTextFile
                    ? "bg-zinc-800/95 text-white border border-white/[0.1]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Pencil className="w-3 h-3" />
                <span>Editar</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar visor de documentos"
            title="Cerrar visor de documentos"
            className="quick-liquid-btn w-7 h-7 rounded-xl inline-flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Barra de herramientas compacta de una sola línea (role="toolbar") */}
      {state && !isDraftingLive && (
        <div
          role="toolbar"
          aria-label="Controles del documento"
          className="px-3 py-1.5 border-b border-white/[0.06] bg-[#08090d]/90 flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar shrink-0"
        >
          <div className="flex items-center gap-1.5 shrink-0">
            {(isPdfDocument || isImageDocument || uniDoc?.docKind === "word") && (
              <div
                role="group"
                aria-label="Zoom de página"
                className="inline-flex items-center rounded-xl bg-zinc-900/80 border border-white/[0.08] p-0.5"
              >
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.65, +(z - 0.15).toFixed(2)))}
                  aria-label="Reducir zoom"
                  title="Reducir zoom"
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  title="Restablecer zoom a 100%"
                  className="px-1.5 text-[10px] font-mono text-zinc-200 hover:text-white cursor-pointer"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(1.85, +(z + 0.15).toFixed(2)))}
                  aria-label="Aumentar zoom"
                  title="Aumentar zoom"
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>
            )}

            {(isPdfDocument || uniDoc?.docKind === "presentation") &&
              totalPages > 1 && (
                <div
                  role="group"
                  aria-label="Navegación de páginas"
                  className="inline-flex items-center gap-0.5 rounded-xl bg-zinc-900/80 border border-white/[0.08] px-1.5 py-0.5"
                >
                  <button
                    type="button"
                    disabled={activePage <= 1}
                    onClick={() => scrollToPage(activePage - 1)}
                    aria-label="Página anterior"
                    className="p-0.5 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="text-[10px] font-mono text-zinc-200 px-1">
                    {activePage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={activePage >= totalPages}
                    onClick={() => scrollToPage(activePage + 1)}
                    aria-label="Página siguiente"
                    className="p-0.5 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}

            {isPdfDocument && viewerMode === "edit_page" && (
              <button
                type="button"
                aria-pressed={addingNewTextMode}
                onClick={() => {
                  setAddingNewTextMode((v) => !v);
                  setSelectedPatchId(null);
                }}
                title="Haz clic aquí y luego en cualquier zona vacía de la página para insertar un texto nuevo"
                className={`px-2 py-1 rounded-xl text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer border ${
                  addingNewTextMode
                    ? "bg-zinc-200 text-zinc-950 border-white shadow-sm"
                    : "quick-liquid-btn text-zinc-200 hover:text-white border-white/[0.1]"
                }`}
              >
                <Plus className="w-3 h-3" />
                <span>{addingNewTextMode ? "Clic en hoja…" : "Texto"}</span>
              </button>
            )}
          </div>

          {/* Grupo derecho: Acciones Liquid Glass compactas */}
          <div role="group" aria-label="Acciones del documento" className="flex items-center gap-1 shrink-0">
            {isPdfDocument && (viewerMode === "edit_page" || modifiedPatchesCount > 0) && (
              <button
                type="button"
                disabled={savingPdf}
                onClick={() => void handleSavePdfChanges()}
                className="quick-liquid-btn px-2 py-1 rounded-xl text-[10.5px] font-medium text-white bg-zinc-800/90 hover:bg-zinc-700/90 border border-white/[0.18] inline-flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingPdf ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                <span>{savingPdf ? "Guardando…" : "Guardar"}</span>
              </button>
            )}

            {isTextDocument && isEditingTextFile && onSaveTextFile && (
              <button
                type="button"
                disabled={savingTextFile}
                onClick={() => void handleSaveTextDocument()}
                className="quick-liquid-btn px-2 py-1 rounded-xl text-[10.5px] font-medium text-white bg-zinc-800/90 hover:bg-zinc-700/90 border border-white/[0.18] inline-flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
              >
                {savingTextFile ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                <span>{savingTextFile ? "Guardando…" : "Guardar"}</span>
              </button>
            )}

            {(isTextDocument || isOfficeDocument) && onExportTextToPdf && (
              <button
                type="button"
                disabled={exportingTextPdf}
                onClick={async () => {
                  const mdToExport =
                    uniDoc?.markdown || uniDoc?.text || textDraft;
                  if (!mdToExport.trim()) return;
                  setExportingTextPdf(true);
                  try {
                    await onExportTextToPdf(
                      state.title || state.filename || "Documento",
                      mdToExport
                    );
                  } finally {
                    setExportingTextPdf(false);
                  }
                }}
                title="Convertir este documento a PDF con diseño XOOK"
                className="quick-liquid-btn px-2 py-1 rounded-xl text-[10.5px] text-zinc-200 hover:text-white inline-flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
              >
                {exportingTextPdf ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileText className="w-3 h-3" />
                )}
                <span>A PDF</span>
              </button>
            )}

            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownload()}
              title="Guardar copia en tu carpeta de Descargas"
              className="quick-liquid-btn px-2 py-1 rounded-xl text-[10.5px] font-medium text-zinc-100 hover:text-white inline-flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : downloadedBadge ? (
                <Check className="w-3 h-3 text-zinc-100" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              <span>{downloadedBadge ? "Descargado" : "Descargar"}</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenExternal(state.path)}
              aria-label="Abrir en visor del sistema"
              title="Abrir en el visor nativo del sistema"
              className="quick-liquid-btn p-1.5 rounded-xl text-zinc-300 hover:text-white inline-flex items-center justify-center transition-all cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={() => onRevealInFolder(state.path)}
              aria-label="Mostrar en carpeta"
              title="Mostrar archivo en Finder"
              className="quick-liquid-btn p-1.5 rounded-xl text-zinc-300 hover:text-white inline-flex items-center justify-center transition-all cursor-pointer"
            >
              <FolderOpen className="w-3 h-3" />
            </button>

            <button
              type="button"
              aria-pressed={showXoxBar}
              onClick={() => setShowXoxBar((v) => !v)}
              title="Decirle a Xox que modifique o agregue más páginas manteniendo la misma tipografía y diseño"
              className={`px-2 py-1 rounded-xl text-[10.5px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer border ${
                showXoxBar
                  ? "bg-zinc-200 text-zinc-950 border-white shadow-sm"
                  : "quick-liquid-btn text-zinc-100 hover:text-white border-white/[0.12]"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>Pedir a Xox</span>
            </button>
          </div>
        </div>
      )}

      {/* Panel inline para decirle a Xox que modifique o agregue páginas con la misma tipografía y diseño */}
      {state && !isDraftingLive && showXoxBar && (
        <div className="px-3.5 py-2.5 border-b border-white/[0.08] bg-zinc-950/95 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setXoxActionMode("append_pages")}
                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 cursor-pointer transition-all ${
                  xoxActionMode === "append_pages"
                    ? "bg-zinc-800 text-white border border-white/[0.16]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Plus className="w-3 h-3" />
                <span>Agregar más páginas</span>
              </button>
              <button
                type="button"
                onClick={() => setXoxActionMode("modify")}
                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium inline-flex items-center gap-1 cursor-pointer transition-all ${
                  xoxActionMode === "modify"
                    ? "bg-zinc-800 text-white border border-white/[0.16]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <Pencil className="w-3 h-3" />
                <span>Modificar contenido</span>
              </button>
            </div>
            <span className="text-[10px] text-zinc-400">
              Mantiene tipografía y diseño ({docTheme})
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmitXoxInstruction();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={xoxInstruction}
              onChange={(e) => setXoxInstruction(e.target.value)}
              placeholder={
                xoxActionMode === "append_pages"
                  ? "Ej. Agrega 2 páginas más sobre conclusiones y plan de acción…"
                  : "Ej. Modifica la introducción y agrega una tabla comparativa…"
              }
              className="flex-1 px-3 py-1.5 rounded-xl bg-black/80 border border-white/[0.12] focus:border-white/[0.3] focus:outline-none text-[11.5px] text-zinc-100 placeholder:text-zinc-500 select-text"
            />
            <button
              type="submit"
              disabled={!xoxInstruction.trim()}
              className="quick-liquid-btn px-3 py-1.5 rounded-xl text-[11px] font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-white/[0.18] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shrink-0"
            >
              <Send className="w-3 h-3" />
              <span>Aplicar</span>
            </button>
          </form>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() =>
                handleSubmitXoxInstruction(
                  "Agrega 1 página adicional al final con conclusiones ejecutivas y recomendaciones clave.",
                  "append_pages"
                )
              }
              className="px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10px] text-zinc-300 hover:text-white cursor-pointer"
            >
              +1 pág. de conclusiones
            </button>
            <button
              type="button"
              onClick={() =>
                handleSubmitXoxInstruction(
                  "Agrega 2 páginas adicionales desarrollando más a fondo los temas del documento con ejemplos prácticos y tablas.",
                  "append_pages"
                )
              }
              className="px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10px] text-zinc-300 hover:text-white cursor-pointer"
            >
              +2 págs. de desarrollo
            </button>
            <button
              type="button"
              onClick={() =>
                handleSubmitXoxInstruction(
                  "Mejora y amplía la redacción de las secciones actuales conservando la portada y el mismo diseño.",
                  "modify"
                )
              }
              className="px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10px] text-zinc-300 hover:text-white cursor-pointer"
            >
              Mejorar redacción
            </button>
          </div>
        </div>
      )}

      {/* Aviso de error si ocurre alguno al guardar/descargar */}
      {editError && (
        <div className="px-3.5 py-2 bg-zinc-900/95 border-b border-white/[0.1] flex items-center justify-between gap-2 text-[11px] text-zinc-200 shrink-0">
          <span className="truncate">{editError}</span>
          <button
            type="button"
            onClick={() => setEditError(null)}
            aria-label="Cerrar aviso de error"
            className="text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Guía discreta cuando está activo el modo Editar sobre la vista previa */}
      {state && isPdfDocument && viewerMode === "edit_page" && (
        <div className="px-3.5 py-1.5 border-b border-white/[0.06] bg-zinc-950/90 flex items-center justify-between gap-2 text-[10.5px] text-zinc-400 shrink-0">
          <span>
            {addingNewTextMode
              ? "Haz clic en cualquier punto de la hoja para colocar el texto nuevo."
              : "Haz clic en cualquier texto de la hoja para editarlo o usa el ícono de papelera para borrarlo. Imágenes y logos intactos."}
          </span>
          {loadingSpec && (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" /> Detectando…
            </span>
          )}
        </div>
      )}

      {/* Cuerpo principal del visor universal */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#050608]/90"
      >
        {/* 1. Estado de maquetación en vivo mientras Xox genera o amplía el PDF */}
        {isDraftingLive && draftProgress && (
          <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-zinc-900/90 to-black/90 p-4 space-y-3.5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-block w-2 h-2 rounded-full bg-zinc-200 animate-pulse shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">
                  {draftProgress.stepLabel || "Construyendo documento PDF…"}
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-300 shrink-0">{pct}%</span>
            </div>

            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-zinc-400 via-zinc-200 to-white transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="mx-auto max-w-[440px] rounded-xl bg-white text-slate-900 shadow-[0_18px_45px_rgba(0,0,0,0.6)] border border-white/20 overflow-hidden transition-all">
              <div className="h-2 w-full bg-zinc-900" />
              <div className="p-5 space-y-3.5">
                <div className="border-b border-slate-200 pb-3">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                    {draftProgress.cover?.eyebrow ||
                      (draftProgress.hasCover
                        ? "PORTADA DEL DOCUMENTO"
                        : "DOCUMENTO EJECUTIVO")}
                  </div>
                  <h3 className="text-base font-bold text-slate-900 leading-snug mt-0.5">
                    {draftProgress.title || "Documento XOOK"}
                  </h3>
                  {draftProgress.subtitle && (
                    <p className="text-[11.5px] text-slate-600 mt-0.5">
                      {draftProgress.subtitle}
                    </p>
                  )}
                </div>

                {draftProgress.blocks && draftProgress.blocks.length > 0 && (
                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {draftProgress.blocks.map((blk, i) => {
                      const btype = (blk.type || "").toLowerCase();
                      if (btype === "heading") {
                        return (
                          <div
                            key={i}
                            className="text-[12px] font-bold text-slate-900 pt-1 border-b border-slate-100 pb-0.5"
                          >
                            {blk.text}
                          </div>
                        );
                      }
                      if (btype === "paragraph") {
                        return (
                          <p
                            key={i}
                            className="text-[10.5px] text-slate-700 leading-relaxed"
                          >
                            {blk.text}
                          </p>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. Visor de documentos Office: Word (.docx, .doc, .rtf, .odt) */}
        {!isDraftingLive &&
          state &&
          isOfficeDocument &&
          uniDoc?.docKind === "word" && (
            <div className="flex flex-col items-center">
              <article
                style={{
                  width: `${Math.round(zoom * 100)}%`,
                  maxWidth: `${Math.round(680 * zoom)}px`,
                }}
                className="w-full rounded-xl bg-white text-slate-900 shadow-[0_20px_50px_rgba(0,0,0,0.65)] border border-white/20 p-7 space-y-4 select-text"
              >
                <div className="border-b border-slate-200 pb-3 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[9.5px] font-bold uppercase tracking-widest text-slate-400">
                      DOCUMENTO {uniDoc.formatLabel}
                    </span>
                    <h1 className="text-lg font-bold text-slate-900 mt-0.5">
                      {uniDoc.title}
                    </h1>
                  </div>
                </div>

                {uniDoc.blocks && uniDoc.blocks.length > 0 ? (
                  <div className="space-y-3.5">
                    {uniDoc.blocks.map((blk, idx) => {
                      if (blk.type === "heading") {
                        const lvl = blk.level || 1;
                        return (
                          <h2
                            key={idx}
                            className={
                              lvl === 1
                                ? "text-[15px] font-bold text-slate-900 pt-2 border-b border-slate-100 pb-1"
                                : lvl === 2
                                ? "text-[13.5px] font-bold text-slate-800 pt-1.5"
                                : "text-[12.5px] font-semibold text-slate-800 pt-1"
                            }
                          >
                            {blk.text}
                          </h2>
                        );
                      }
                      if (blk.type === "bullets" && Array.isArray(blk.items)) {
                        return (
                          <ul
                            key={idx}
                            className="list-disc pl-5 space-y-1 text-[12.5px] text-slate-700 leading-relaxed"
                          >
                            {blk.items.map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                          </ul>
                        );
                      }
                      if (blk.type === "table" && Array.isArray(blk.headers)) {
                        return (
                          <div
                            key={idx}
                            tabIndex={0}
                            role="region"
                            aria-label={`Tabla ${idx + 1} de ${uniDoc.title}`}
                            className="overflow-x-auto rounded-lg border border-slate-200 my-2"
                          >
                            <table className="w-full border-collapse text-left text-[11.5px]">
                              <thead className="bg-slate-100 text-slate-800">
                                <tr>
                                  {blk.headers.map((h, hi) => (
                                    <th
                                      key={hi}
                                      scope="col"
                                      className="px-3 py-2 font-semibold border-b border-slate-200"
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 text-slate-700">
                                {(blk.rows || []).map((r, ri) => (
                                  <tr key={ri} className="hover:bg-slate-50">
                                    {r.map((cell, ci) => (
                                      <td key={ci} className="px-3 py-1.5">
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      }
                      return (
                        <p
                          key={idx}
                          className="text-[12.5px] text-slate-700 leading-relaxed whitespace-pre-wrap"
                        >
                          {blk.text}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <pre className="text-[12px] font-sans text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {uniDoc.text || "(Documento sin texto extraíble)"}
                  </pre>
                )}
              </article>
            </div>
          )}

        {/* 3. Visor de Presentaciones PowerPoint (.pptx, .ppt, .odp) */}
        {!isDraftingLive &&
          state &&
          isOfficeDocument &&
          uniDoc?.docKind === "presentation" && (
            <div className="space-y-5 flex flex-col items-center">
              {(uniDoc.slides || []).map((slide) => (
                <div
                  key={slide.slide_number}
                  ref={(el) => {
                    pageRefs.current[slide.slide_number] = el;
                  }}
                  className="w-full max-w-[680px] rounded-2xl bg-white text-slate-900 shadow-[0_20px_50px_rgba(0,0,0,0.65)] border border-white/20 overflow-hidden select-text"
                >
                  <div className="px-5 py-3 bg-zinc-900 text-zinc-100 flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-mono uppercase tracking-wider text-zinc-400">
                      Diapositiva {slide.slide_number} de {uniDoc.slides?.length || 1}
                    </span>
                    <span className="text-[10.5px] font-medium text-zinc-300">
                      {uniDoc.formatLabel}
                    </span>
                  </div>
                  <div className="p-6 space-y-4 min-h-[260px] flex flex-col justify-between">
                    <div className="space-y-3.5">
                      <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-2">
                        {slide.title}
                      </h3>
                      {slide.bullets.length > 0 && (
                        <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-slate-700 leading-relaxed">
                          {slide.bullets.map((b, bi) => (
                            <li key={bi}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {slide.tables.map((tbl, ti) => (
                        <div
                          key={ti}
                          tabIndex={0}
                          role="region"
                          aria-label={`Tabla en diapositiva ${slide.slide_number}`}
                          className="overflow-x-auto rounded-lg border border-slate-200"
                        >
                          <table className="w-full border-collapse text-left text-[11.5px]">
                            <thead className="bg-slate-100 text-slate-800">
                              <tr>
                                {tbl.headers.map((h, hi) => (
                                  <th
                                    key={hi}
                                    scope="col"
                                    className="px-3 py-1.5 font-semibold border-b border-slate-200"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 text-slate-700">
                              {tbl.rows.map((r, ri) => (
                                <tr key={ri}>
                                  {r.map((c, ci) => (
                                    <td key={ci} className="px-3 py-1.5">
                                      {c}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>

                    {slide.notes && (
                      <div className="mt-4 pt-3 border-t border-slate-200 text-[11px] text-slate-500">
                        <strong className="text-slate-700">Notas del orador:</strong>{" "}
                        {slide.notes}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        {/* 4. Visor de Hojas de Cálculo Excel / CSV (.xlsx, .xls, .ods, .csv, .tsv) */}
        {!isDraftingLive &&
          state &&
          isOfficeDocument &&
          uniDoc?.docKind === "spreadsheet" && (
            <div className="space-y-3">
              {uniDoc.sheets && uniDoc.sheets.length > 1 && (
                <div
                  role="tablist"
                  aria-label="Hojas del libro"
                  className="flex items-center gap-1.5 overflow-x-auto pb-1"
                >
                  {uniDoc.sheets.map((sh, idx) => (
                    <button
                      key={sh.name + idx}
                      type="button"
                      role="tab"
                      aria-selected={activeSheetIdx === idx}
                      onClick={() => setActiveSheetIdx(idx)}
                      className={`px-3 py-1 rounded-xl text-[11px] font-medium cursor-pointer transition-all ${
                        activeSheetIdx === idx
                          ? "bg-zinc-800 text-white border border-white/[0.16]"
                          : "bg-zinc-950/80 text-zinc-400 hover:text-zinc-200 border border-white/[0.06]"
                      }`}
                    >
                      {sh.name}
                    </button>
                  ))}
                </div>
              )}

              {(() => {
                const currentSheet =
                  uniDoc.sheets?.[activeSheetIdx] || uniDoc.sheets?.[0];
                if (!currentSheet || currentSheet.headers.length === 0) {
                  return (
                    <div className="rounded-xl border border-white/[0.08] bg-zinc-950/80 p-5 text-xs text-zinc-400">
                      Esta hoja no contiene filas tabulares visibles.
                    </div>
                  );
                }
                return (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={`Datos de ${currentSheet.name}`}
                    className="overflow-x-auto max-h-[72vh] rounded-2xl border border-white/[0.1] bg-zinc-950/90 shadow-inner select-text"
                  >
                    <table className="w-full border-collapse text-left text-[11.5px]">
                      <caption className="sr-only">
                        Hoja {currentSheet.name} de {uniDoc.title}
                      </caption>
                      <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-100 border-b border-white/[0.1]">
                        <tr>
                          <th
                            scope="col"
                            className="px-2.5 py-2 text-[10px] font-mono text-zinc-500 border-r border-white/[0.06] w-10 text-center"
                          >
                            #
                          </th>
                          {currentSheet.headers.map((h, hi) => (
                            <th
                              key={hi}
                              scope="col"
                              className="px-3 py-2 font-semibold text-zinc-200 border-r border-white/[0.06] whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.06] text-zinc-300">
                        {currentSheet.rows.map((row, ri) => (
                          <tr
                            key={ri}
                            className="hover:bg-white/[0.03] transition-colors"
                          >
                            <td className="px-2.5 py-1.5 text-[10px] font-mono text-zinc-500 border-r border-white/[0.05] text-center">
                              {ri + 1}
                            </td>
                            {currentSheet.headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="px-3 py-1.5 border-r border-white/[0.04] whitespace-nowrap max-w-[280px] truncate"
                                title={row[ci] || ""}
                              >
                                {row[ci] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

        {/* 5. Visor de Imágenes en el panel de documentos */}
        {!isDraftingLive && state && isImageDocument && (
          <div className="flex flex-col items-center justify-center py-2">
            {state.imageDataUrl ? (
              <div
                style={{
                  width: `${Math.round(zoom * 100)}%`,
                  maxWidth: `${Math.round(680 * zoom)}px`,
                }}
                className="rounded-2xl overflow-hidden border border-white/[0.12] bg-zinc-950 shadow-2xl"
              >
                <img
                  src={state.imageDataUrl}
                  alt={state.title}
                  className="w-full h-auto block"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.1] bg-zinc-900/80 p-6 text-xs text-zinc-300">
                Usa el botón «Abrir» para ver esta imagen en resolución completa.
              </div>
            )}
          </div>
        )}

        {/* 6. Visor / Editor de archivos de texto y tablas CSV (.md, .txt, .csv, .json, código) */}
        {!isDraftingLive && state && isTextDocument && (
          <div className="h-full flex flex-col space-y-3">
            {isEditingTextFile ? (
              <textarea
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder="Escribe o modifica el contenido del documento…"
                className="w-full flex-1 min-h-[420px] p-4 rounded-2xl bg-zinc-950/90 border border-white/[0.12] focus:border-white/[0.28] focus:outline-none text-[12.5px] font-mono text-zinc-100 leading-relaxed resize-none select-text shadow-inner"
              />
            ) : uniDoc?.docKind === "spreadsheet" &&
              uniDoc.sheets &&
              uniDoc.sheets[0]?.headers.length ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`Tabla ${state.title}`}
                className="overflow-x-auto max-h-[72vh] rounded-2xl border border-white/[0.1] bg-zinc-950/90 shadow-inner select-text"
              >
                <table className="w-full border-collapse text-left text-[11.5px]">
                  <caption className="sr-only">{state.title}</caption>
                  <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-100 border-b border-white/[0.1]">
                    <tr>
                      {uniDoc.sheets[0].headers.map((h, hi) => (
                        <th
                          key={hi}
                          scope="col"
                          className="px-3 py-2 font-semibold border-r border-white/[0.06] whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-zinc-300">
                    {uniDoc.sheets[0].rows.map((r, ri) => (
                      <tr key={ri} className="hover:bg-white/[0.03]">
                        {uniDoc.sheets![0].headers.map((_, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-1.5 border-r border-white/[0.04] whitespace-nowrap"
                          >
                            {r[ci] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (() => {
              const extLower = (state.fileExtension || "").trim().replace(/^\./, "").toLowerCase();
              const docFilename = state.path.split("/").pop() || state.title;
              const codeMeta = getLanguageMetaForExtension(extLower, docFilename);
              if (extLower === "md" || extLower === "markdown") {
                return (
                  <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-5 shadow-inner text-[13px] text-zinc-200 leading-relaxed select-text">
                    <MarkdownContent text={textDraft || "(Documento vacío)"} variant="default" />
                  </div>
                );
              }
              if (textDraft && codeMeta && codeMeta.id !== "plaintext") {
                return (
                  <CodeBlockCard
                    code={textDraft}
                    language={codeMeta.id}
                    filenameHint={docFilename}
                    variant="default"
                  />
                );
              }
              return (
                <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-5 shadow-inner">
                  <pre className="text-[12px] font-mono text-zinc-200 whitespace-pre-wrap break-words leading-relaxed select-text">
                    {textDraft || "(Documento vacío)"}
                  </pre>
                </div>
              );
            })()}
          </div>
        )}

        {/* 7. Vista previa de páginas PDF con edición y borrado directo in-place */}
        {!isDraftingLive && state && isPdfDocument && (
          <>
            {state.error && (
              <div className="rounded-xl border border-white/[0.12] bg-zinc-900/90 p-3.5 text-xs text-zinc-200 flex items-center justify-between gap-2">
                <span>{state.error}</span>
                {onReloadPreview && (
                  <button
                    type="button"
                    onClick={() => onReloadPreview(state.path)}
                    className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-white inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Reintentar</span>
                  </button>
                )}
              </div>
            )}

            {state.pages.length > 0 ? (
              <div className="space-y-5 flex flex-col items-center">
                {state.pages.map((p) => {
                  const patchesForThisPage = pagePatches.filter(
                    (pt) => pt.page_number === p.page
                  );
                  return (
                    <div
                      key={p.page}
                      ref={(el) => {
                        pageRefs.current[p.page] = el;
                      }}
                      style={{
                        width: `${Math.round(zoom * 100)}%`,
                        maxWidth: `${Math.round(680 * zoom)}px`,
                      }}
                      className="w-full transition-all duration-150"
                    >
                      <div
                        onClick={(e) => handlePageCanvasClick(p.page, e)}
                        className={`relative rounded-xl overflow-visible bg-white shadow-[0_20px_50px_rgba(0,0,0,0.65)] border ${
                          viewerMode === "edit_page"
                            ? addingNewTextMode
                              ? "border-white/60 cursor-crosshair ring-2 ring-white/30"
                              : "border-white/35"
                            : "border-white/[0.12]"
                        }`}
                      >
                        <img
                          src={p.dataUrl}
                          alt={`${state.title} — Página ${p.page}`}
                          className="w-full h-auto block rounded-xl select-none pointer-events-none"
                          loading="lazy"
                        />

                        {/* Capa 1: Cubiertas blancas/fondo sobre la posición original de textos editados, movidos o borrados */}
                        {patchesForThisPage.map((patch) => {
                          const isSelected =
                            viewerMode === "edit_page" && patch.id === selectedPatchId;
                          const modified = isPatchModified(patch);
                          if (patch.is_new) return null;
                          if (!modified && !isSelected) return null;

                          const ox = patch.orig_x_pct ?? patch.x_pct;
                          const oy = patch.orig_y_pct ?? patch.y_pct;
                          const ow = patch.orig_w_pct ?? patch.w_pct;
                          const oh = patch.orig_h_pct ?? patch.h_pct;
                          const coverBg =
                            patch.bg_color && patch.bg_color !== "transparent"
                              ? patch.bg_color
                              : "#FFFFFF";

                          return (
                            <div
                              key={`cover_${patch.id}`}
                              data-patch-box="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (patch.deleted && viewerMode === "edit_page") {
                                  restorePatch(patch);
                                }
                              }}
                              style={{
                                left: `${Math.max(0, ox - 0.35)}%`,
                                top: `${Math.max(0, oy - 0.25)}%`,
                                width: `${Math.min(100 - ox, ow + 0.7)}%`,
                                height: `${Math.min(100 - oy, oh + 0.55)}%`,
                                backgroundColor: coverBg,
                              }}
                              className={`absolute rounded-[2px] z-10 group/deleted ${
                                patch.deleted && viewerMode === "edit_page"
                                  ? "hover:ring-1 hover:ring-dashed hover:ring-zinc-400 cursor-pointer flex items-center justify-center"
                                  : "pointer-events-none"
                              }`}
                              title={
                                patch.deleted && viewerMode === "edit_page"
                                  ? `Texto borrado ("${patch.original_text || ""}"). Haz clic para restaurar.`
                                  : undefined
                              }
                            >
                              {patch.deleted && viewerMode === "edit_page" && (
                                <span className="opacity-0 group-hover/deleted:opacity-100 transition-opacity px-1.5 py-0.5 rounded bg-zinc-900/90 text-[9.5px] font-medium text-zinc-100 inline-flex items-center gap-1 shadow">
                                  <RotateCcw className="w-2.5 h-2.5" /> Restaurar
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {/* Capa 2: Cajas de texto interactivas (editar en el lugar o borrar con 1 clic) */}
                        {patchesForThisPage.map((patch) => {
                          if (patch.deleted) return null;
                          const isSelected =
                            viewerMode === "edit_page" && patch.id === selectedPatchId;
                          const modified = isPatchModified(patch);
                          const scaledFontPx = Math.max(
                            8.5,
                            (patch.font_size || 11) * 0.86 * zoom
                          );
                          const toolbarOnBottom = patch.y_pct < 9;

                          return (
                            <div
                              key={patch.id}
                              data-patch-box="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (viewerMode === "edit_page") {
                                  setSelectedPatchId(patch.id);
                                }
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (viewerMode !== "edit_page") {
                                  setViewerMode("edit_page");
                                }
                                setSelectedPatchId(patch.id);
                              }}
                              style={{
                                left: `${patch.x_pct}%`,
                                top: `${patch.y_pct}%`,
                                width: `${Math.max(4, patch.w_pct)}%`,
                                minHeight: `${Math.max(1.8, patch.h_pct)}%`,
                                backgroundColor:
                                  isSelected || modified
                                    ? patch.bg_color === "transparent"
                                      ? "transparent"
                                      : patch.bg_color || "#FFFFFF"
                                    : "transparent",
                                color: patch.text_color || "#0F172A",
                                fontSize: `${scaledFontPx}px`,
                                fontWeight: patch.font_weight === "bold" ? 700 : 400,
                                textAlign: patch.align || "left",
                                lineHeight: 1.24,
                              }}
                              className={`group/box absolute rounded-[3px] transition-shadow ${
                                isSelected
                                  ? "ring-2 ring-zinc-900 shadow-[0_8px_24px_rgba(0,0,0,0.28)] z-30"
                                  : viewerMode === "edit_page"
                                  ? modified
                                    ? "ring-1 ring-zinc-900/45 hover:ring-zinc-900 cursor-text z-20"
                                    : "hover:ring-1 hover:ring-zinc-900/65 hover:bg-zinc-950/[0.035] cursor-text z-20"
                                  : " z-20"
                              }`}
                            >
                              {viewerMode === "edit_page" && !isSelected && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteOrErasePatch(patch);
                                  }}
                                  title="Borrar este texto de la página"
                                  aria-label="Borrar texto"
                                  className="opacity-0 group-hover/box:opacity-100 focus:opacity-100 transition-opacity absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-zinc-900 text-zinc-100 hover:bg-black hover:text-white border border-white/25 shadow-md flex items-center justify-center cursor-pointer z-30"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              )}

                              {isSelected && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className={`absolute left-0 ${
                                    toolbarOnBottom ? "top-full mt-1.5" : "bottom-full mb-1.5"
                                  } flex items-center gap-1 px-1.5 py-1 rounded-xl bg-zinc-950/95 text-zinc-100 border border-white/20 shadow-[0_12px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl z-40 whitespace-nowrap select-none`}
                                >
                                  <button
                                    type="button"
                                    aria-label="Arrastrar para mover texto"
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      const boxEl = e.currentTarget.closest(
                                        "[data-patch-box='true']"
                                      ) as HTMLElement | null;
                                      const pageRect =
                                        boxEl?.parentElement?.getBoundingClientRect();
                                      if (!pageRect) return;
                                      setDraggingPatch({
                                        id: patch.id,
                                        pageNumber: p.page,
                                        startX: e.clientX,
                                        startY: e.clientY,
                                        origXPct: patch.x_pct,
                                        origYPct: patch.y_pct,
                                        containerRect: pageRect,
                                      });
                                    }}
                                    title="Arrastrar para mover este texto"
                                    className="px-1 py-0.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white cursor-move inline-flex items-center"
                                  >
                                    <GripHorizontal className="w-3.5 h-3.5" />
                                  </button>

                                  <div className="w-px h-3.5 bg-white/15" />

                                  <button
                                    type="button"
                                    aria-label="Reducir tamaño de letra"
                                    onClick={() =>
                                      updatePatchById(patch.id, {
                                        font_size: Math.max(
                                          7,
                                          +((patch.font_size || 11) - 1).toFixed(1)
                                        ),
                                      })
                                    }
                                    title="Reducir tamaño de letra"
                                    className="p-1 rounded hover:bg-white/10 text-zinc-300 hover:text-white cursor-pointer"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="text-[10px] font-mono text-zinc-300 px-0.5">
                                    {Math.round(patch.font_size || 11)}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label="Aumentar tamaño de letra"
                                    onClick={() =>
                                      updatePatchById(patch.id, {
                                        font_size: Math.min(
                                          42,
                                          +((patch.font_size || 11) + 1).toFixed(1)
                                        ),
                                      })
                                    }
                                    title="Aumentar tamaño de letra"
                                    className="p-1 rounded hover:bg-white/10 text-zinc-300 hover:text-white cursor-pointer"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>

                                  <button
                                    type="button"
                                    aria-label="Negrita"
                                    onClick={() =>
                                      updatePatchById(patch.id, {
                                        font_weight:
                                          patch.font_weight === "bold" ? "normal" : "bold",
                                      })
                                    }
                                    title="Negrita"
                                    className={`p-1 rounded cursor-pointer ${
                                      patch.font_weight === "bold"
                                        ? "bg-white/20 text-white"
                                        : "text-zinc-400 hover:text-white hover:bg-white/10"
                                    }`}
                                  >
                                    <Bold className="w-3 h-3" />
                                  </button>

                                  {(["left", "center", "right"] as const).map((al) => (
                                    <button
                                      key={al}
                                      type="button"
                                      aria-label={`Alinear ${al}`}
                                      onClick={() => updatePatchById(patch.id, { align: al })}
                                      className={`p-1 rounded cursor-pointer ${
                                        (patch.align || "left") === al
                                          ? "bg-white/20 text-white"
                                          : "text-zinc-400 hover:text-white hover:bg-white/10"
                                      }`}
                                    >
                                      {al === "left" ? (
                                        <AlignLeft className="w-3 h-3" />
                                      ) : al === "center" ? (
                                        <AlignCenter className="w-3 h-3" />
                                      ) : (
                                        <AlignRight className="w-3 h-3" />
                                      )}
                                    </button>
                                  ))}

                                  <div className="w-px h-3.5 bg-white/15" />

                                  {!patch.is_new && modified && (
                                    <button
                                      type="button"
                                      aria-label="Restaurar texto original"
                                      onClick={() => restorePatch(patch)}
                                      title="Restaurar texto original"
                                      className="px-1.5 py-0.5 rounded hover:bg-white/10 text-[10px] text-zinc-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <RotateCcw className="w-2.5 h-2.5" />
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => deleteOrErasePatch(patch)}
                                    title="Borrar este texto del documento"
                                    className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-medium text-zinc-100 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                    <span>Borrar</span>
                                  </button>

                                  <button
                                    type="button"
                                    aria-label="Confirmar edición"
                                    onClick={() => setSelectedPatchId(null)}
                                    title="Confirmar edición"
                                    className="p-1 rounded bg-zinc-200 text-zinc-950 hover:bg-white cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                </div>
                              )}

                              {isSelected ? (
                                <textarea
                                  ref={activeTextareaRef}
                                  value={patch.text}
                                  onChange={(e) => {
                                    const nextVal = e.target.value;
                                    e.currentTarget.style.height = "auto";
                                    e.currentTarget.style.height = `${Math.max(
                                      e.currentTarget.scrollHeight,
                                      20
                                    )}px`;
                                    updatePatchById(patch.id, { text: nextVal });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                      e.stopPropagation();
                                      setSelectedPatchId(null);
                                    }
                                  }}
                                  rows={Math.max(1, patch.text.split("\n").length)}
                                  style={{
                                    color: patch.text_color || "#0F172A",
                                    fontSize: `${scaledFontPx}px`,
                                    fontWeight: patch.font_weight === "bold" ? 700 : 400,
                                    textAlign: patch.align || "left",
                                    lineHeight: 1.24,
                                  }}
                                  className="w-full h-full min-h-[20px] p-0.5 bg-transparent border-0 focus:outline-none resize-none overflow-hidden select-text block"
                                />
                              ) : modified ? (
                                <div className="w-full h-full p-0.5 whitespace-pre-wrap break-words select-none">
                                  {patch.text}
                                </div>
                              ) : (
                                <div className="w-full h-full opacity-0 select-none">
                                  {patch.text}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        <div className="absolute bottom-2 right-2.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-mono text-zinc-200 border border-white/10 pointer-events-none z-20">
                          Pág. {p.page} {totalPages ? `/ ${totalPages}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {state.hasMore && onLoadMorePages && (
                  <button
                    type="button"
                    disabled={state.isLoadingPages}
                    onClick={() => onLoadMorePages(state.path, state.pages.length + 1)}
                    className="quick-liquid-btn px-4 py-2 rounded-xl text-xs font-medium text-zinc-100 inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {state.isLoadingPages ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Renderizando más páginas…</span>
                      </>
                    ) : (
                      <span>
                        Cargar más páginas ({state.pages.length} de {totalPages})
                      </span>
                    )}
                  </button>
                )}
              </div>
            ) : state.isLoadingPages ? (
              <div className="h-72 flex flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="w-6 h-6 text-zinc-300 animate-spin" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-zinc-200">
                    Renderizando páginas del documento…
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Preparando vista previa interactiva
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}

        {!isDraftingLive && !state && (
          <div className="h-72 flex flex-col items-center justify-center gap-2.5 text-center px-6">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center text-zinc-400">
              <FileText className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-zinc-300">Ningún documento abierto</p>
            <p className="text-[11px] text-zinc-500 max-w-xs leading-relaxed">
              Haz clic en cualquier PDF, Word (.docx/.doc), PowerPoint (.pptx), Excel (.xlsx),
              CSV o archivo del espacio de trabajo para verlo o editarlo aquí.
            </p>
          </div>
        )}
      </div>

      {/* Barra inferior cuando está en modo Editar o hay cambios aplicados en la vista previa */}
      {state &&
        !isDraftingLive &&
        isPdfDocument &&
        (viewerMode === "edit_page" || modifiedPatchesCount > 0) && (
          <footer className="px-3.5 py-2 border-t border-white/[0.08] bg-black/85 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span>
                {modifiedPatchesCount > 0
                  ? `${modifiedPatchesCount} ${
                      modifiedPatchesCount === 1
                        ? "cambio realizado en la página"
                        : "cambios realizados en las páginas"
                    }`
                  : "Haz clic en cualquier texto de la vista previa para editarlo o borrarlo"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {modifiedPatchesCount > 0 && (
                <button
                  type="button"
                  disabled={savingPdf}
                  onClick={() => void handleResetAllChanges()}
                  className="px-2.5 py-1 rounded-xl text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Restaurar original</span>
                </button>
              )}
              <button
                type="button"
                disabled={savingPdf}
                onClick={() => void handleSavePdfChanges()}
                className="quick-liquid-btn px-3.5 py-1.5 rounded-xl text-[11.5px] font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-white/[0.2] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {savingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{savingPdf ? "Actualizando PDF…" : "Guardar cambios en PDF"}</span>
              </button>
            </div>
          </footer>
        )}
    </section>
  );
};
