import React, { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Lock,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  Table2,
  X,
  Zap,
} from "lucide-react";
import {
  PdfSummaryInfo,
  WorkspaceNodeEntry,
  WorkspaceOverview,
} from "./workspaceApi";
import { WorkspacePermissionsSection } from "./WorkspacePermissionsSection";

export interface SelectedWorkspaceFile {
  relativePath: string;
  name: string;
  zone: string;
  content: string;
  editable: boolean;
  pinned: boolean;
  tokens: number;
  kind?: "text" | "image" | "pdf" | "binary";
  sizeBytes?: number;
  mimeType?: string;
  dataUrl?: string | null;
  pdfSummary?: PdfSummaryInfo | null;
}

interface WorkspaceTreePanelProps {
  isTauriEnv: boolean;
  overview: WorkspaceOverview | null;
  selectedPath: string | null;
  pinnedPaths: Set<string>;
  highlightedPath: string | null;
  isLoading: boolean;
  onSelectFile: (entry: WorkspaceNodeEntry) => void;
  onTogglePinFile: (entry: WorkspaceNodeEntry) => void;
  onRefresh: () => void;
  onOpenFinder: (relativePath?: string) => void;
  onOpenFile?: (relativePath: string) => void;
  onPreviewPdf?: (file: SelectedWorkspaceFile) => void;
  onAskXoxAnalyzeFile?: (file: SelectedWorkspaceFile) => void;
  onCreateFolder: (relativePath: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>;
  selectedFile: SelectedWorkspaceFile | null;
  onSaveFileContent: (relativePath: string, content: string) => Promise<void>;
  onStatusNotice?: (message: string) => void;
}

const ZONE_META: Record<
  string,
  {
    label: string;
    subtitle: string;
    icon: React.FC<{ className?: string }>;
  }
> = {
  empresa: {
    label: "Empresa y Reglas",
    subtitle: "Requiere aprobación HITL para Xox",
    icon: Store,
  },
  datos: {
    label: "Datos del Negocio",
    subtitle: "Fuentes para revisiones reales",
    icon: Table2,
  },
  memoria: {
    label: "Memoria de Xox",
    subtitle: "Hechos y decisiones reales",
    icon: Brain,
  },
  habilidades: {
    label: "Habilidades",
    subtitle: "Instrucciones operativas",
    icon: Zap,
  },
  agente: {
    label: "Espacio de Xox",
    subtitle: "Carpetas, reportes y borradores",
    icon: Sparkles,
  },
};

function formatCompactPath(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return fullPath;
  return `…/${parts.slice(-2).join("/")}`;
}

export const WorkspaceTreePanel: React.FC<WorkspaceTreePanelProps> = ({
  isTauriEnv,
  overview,
  selectedPath,
  pinnedPaths,
  highlightedPath,
  isLoading,
  onSelectFile,
  onTogglePinFile,
  onRefresh,
  onOpenFinder,
  onOpenFile,
  onPreviewPdf,
  onAskXoxAnalyzeFile,
  onCreateFolder,
  onCreateWorkspace,
  onSwitchWorkspace,
  onRenameWorkspace,
  selectedFile,
  onSaveFileContent,
  onStatusNotice,
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(["empresa", "datos", "memoria", "agente"])
  );
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [renamingWs, setRenamingWs] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderZone, setNewFolderZone] = useState("agente/proyectos");
  const [newFolderName, setNewFolderName] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const [isEditingFile, setIsEditingFile] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  const [saveFlashed, setSaveFlashed] = useState(false);

  useEffect(() => {
    setIsEditingFile(false);
    setPanelError(null);
  }, [overview?.active.id, selectedFile?.relativePath]);

  const visibleEntries = useMemo(() => {
    if (!overview) return [];
    return overview.entries.filter((entry) => {
      if (entry.depth === 0) return true;
      const segments = entry.relativePath.split("/");
      let acc = "";
      for (let i = 0; i < segments.length - 1; i++) {
        acc = acc ? `${acc}/${segments[i]}` : segments[i];
        if (!expandedDirs.has(acc)) return false;
      }
      return true;
    });
  }, [overview, expandedDirs]);

  const toggleDir = (relPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.\./g, "");
    if (!clean) return;
    setBusyAction(true);
    setPanelError(null);
    try {
      const targetRel = `${newFolderZone}/${clean}`;
      await onCreateFolder(targetRel);
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(newFolderZone.split("/")[0]);
        next.add(newFolderZone);
        next.add(targetRel);
        return next;
      });
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo crear la carpeta.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateWorkspaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newWsName.trim();
    if (!clean) return;
    setBusyAction(true);
    setPanelError(null);
    try {
      await onCreateWorkspace(clean);
      setNewWsName("");
      setShowSwitcher(false);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo crear el espacio.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overview || !renameValue.trim()) return;
    setBusyAction(true);
    setPanelError(null);
    try {
      await onRenameWorkspace(overview.active.id, renameValue.trim());
      setRenamingWs(false);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo renombrar.");
    } finally {
      setBusyAction(false);
    }
  };

  const handleStartEdit = () => {
    if (!selectedFile) return;
    setDraftContent(selectedFile.content);
    setIsEditingFile(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    setPanelError(null);
    try {
      await onSaveFileContent(selectedFile.relativePath, draftContent);
      setIsEditingFile(false);
      setSaveFlashed(true);
      setTimeout(() => setSaveFlashed(false), 950);
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo guardar el archivo.");
    } finally {
      setSavingFile(false);
    }
  };

  if (!isTauriEnv) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-5 text-center space-y-2.5">
        <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center xook-empty-float">
          <FolderOpen className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-200">Modo vista previa</p>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-[220px]">
            Las carpetas reales, memoria en disco y comandos viven en la app desktop XOOK.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Cabecera del Espacio de Trabajo Activo */}
      <div className="px-3 py-2.5 border-b border-white/[0.06] bg-black/30 space-y-2 relative">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => setShowSwitcher((v) => !v)}
            className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] transition-colors cursor-pointer text-left"
            title={overview?.active.rootPath ?? "Cambiar o crear espacio de trabajo"}
          >
            <FolderOpen className="w-3.5 h-3.5 text-sky-300 shrink-0" />
            <span className="text-[11.5px] font-semibold text-zinc-100 truncate">
              {overview?.active.name ?? "Espacio Xox"}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-zinc-400 shrink-0 transition-transform duration-200 ${
                showSwitcher ? "rotate-180" : ""
              }`}
            />
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowNewFolder((v) => !v)}
              title="Crear carpeta en este espacio"
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                showNewFolder
                  ? "bg-sky-400/15 border-sky-400/30 text-sky-200"
                  : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-white hover:bg-white/[0.07]"
              }`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onOpenFinder()}
              title="Abrir carpeta en Finder"
              className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onRefresh}
              title="Actualizar archivos desde disco"
              className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-sky-300" : ""}`} />
            </button>
          </div>
        </div>

        {overview?.active.rootPath && (
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 px-0.5">
            <span className="truncate" title={overview.active.rootPath}>
              {formatCompactPath(overview.active.rootPath)}
            </span>
            <span className="shrink-0 text-zinc-600">
              {overview.entries.filter((e) => e.kind === "file").length} archivos
            </span>
          </div>
        )}

        {/* Popover Selector / Creador de Espacios */}
        {showSwitcher && overview && (
          <div className="panel-fade-in rounded-xl border border-white/10 bg-[#0b0d14] p-2.5 space-y-2 shadow-xl">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-400 font-semibold px-0.5">
              <span>Espacios locales</span>
              <button
                type="button"
                onClick={() => {
                  setRenamingWs((v) => !v);
                  setRenameValue(overview.active.name);
                }}
                className="text-sky-300 hover:text-sky-200 flex items-center gap-1 lowercase font-normal cursor-pointer"
              >
                <Pencil className="w-2.5 h-2.5" />
                renombrar
              </button>
            </div>

            {renamingWs && (
              <form onSubmit={handleRenameSubmit} className="flex gap-1.5">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg bg-black/50 border border-white/10 text-[11px] text-white focus:outline-none focus:border-sky-400/40 select-text"
                  placeholder="Nuevo nombre..."
                />
                <button
                  type="submit"
                  disabled={busyAction}
                  className="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/30 text-[11px] text-emerald-200 cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                </button>
              </form>
            )}

            <div className="max-h-32 overflow-y-auto space-y-1">
              {overview.workspaces.map((ws) => {
                const isActive = ws.id === overview.active.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    disabled={busyAction}
                    onClick={async () => {
                      if (!isActive) {
                        await onSwitchWorkspace(ws.id);
                      }
                      setShowSwitcher(false);
                    }}
                    className={`w-full px-2 py-1.5 rounded-lg text-left text-[11px] flex items-center justify-between transition-colors cursor-pointer ${
                      isActive
                        ? "bg-sky-400/15 border border-sky-400/25 text-white"
                        : "bg-white/[0.02] hover:bg-white/[0.06] border border-transparent text-zinc-300"
                    }`}
                  >
                    <span className="truncate font-medium">{ws.name}</span>
                    {isActive && <Check className="w-3 h-3 text-sky-300 shrink-0" />}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleCreateWorkspaceSubmit} className="pt-1.5 border-t border-white/[0.06] flex gap-1.5">
              <input
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="Nuevo espacio (ej. Mi Tienda)"
                className="flex-1 px-2 py-1 rounded-lg bg-black/50 border border-white/10 text-[11px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-sky-400/40 select-text"
              />
              <button
                type="submit"
                disabled={busyAction || !newWsName.trim()}
                className="px-2 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-[11px] text-white disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
              </button>
            </form>
          </div>
        )}

        {/* Formulario inline: Nueva Carpeta */}
        {showNewFolder && (
          <form
            onSubmit={handleCreateFolderSubmit}
            className="panel-fade-in rounded-xl border border-white/[0.08] bg-black/45 p-2 space-y-1.5"
          >
            <div className="flex items-center justify-between text-[10px] text-zinc-400">
              <span>Nueva carpeta dentro de:</span>
              <button
                type="button"
                onClick={() => setShowNewFolder(false)}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <select
              value={newFolderZone}
              onChange={(e) => setNewFolderZone(e.target.value)}
              className="w-full px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-[11px] text-zinc-200 focus:outline-none"
            >
              <option value="agente/proyectos">Espacio de Xox / proyectos</option>
              <option value="agente">Espacio de Xox (raíz)</option>
              <option value="datos">Datos del Negocio</option>
              <option value="memoria">Memoria de Xox</option>
              <option value="empresa/reglas">Empresa y Reglas / reglas</option>
              <option value="habilidades">Habilidades</option>
            </select>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="nombre-carpeta"
                autoFocus
                className="flex-1 px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-[11px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-sky-400/40 select-text"
              />
              <button
                type="submit"
                disabled={busyAction || !newFolderName.trim()}
                className="xook-approve-btn px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-40 cursor-pointer"
              >
                Crear
              </button>
            </div>
          </form>
        )}

        {panelError && (
          <div className="panel-fade-in text-[10.5px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-2 py-1.5">
            {panelError}
          </div>
        )}
      </div>

      <WorkspacePermissionsSection
        activeWorkspaceId={overview?.active.id}
        onStatusNotice={onStatusNotice}
      />

      {/* Árbol Real de Carpetas y Archivos */}
      <div className="max-h-[46%] overflow-y-auto p-2 border-b border-white/[0.06] space-y-0.5">
        {visibleEntries.map((entry, idx) => {
          const isDir = entry.kind === "dir";
          const isExpanded = expandedDirs.has(entry.relativePath);
          const isSelected = selectedPath === entry.relativePath;
          const isHighlighted = highlightedPath === entry.relativePath;
          const isPinned = pinnedPaths.has(entry.relativePath);
          const zoneInfo = entry.depth === 0 ? ZONE_META[entry.zone] : undefined;
          const ZoneIcon = zoneInfo?.icon;

          return (
            <div
              key={entry.relativePath}
              style={{
                paddingLeft: `${8 + entry.depth * 12}px`,
                animationDelay: `${Math.min(idx * 18, 160)}ms`,
              }}
              onClick={() => {
                if (isDir) {
                  toggleDir(entry.relativePath);
                } else {
                  setIsEditingFile(false);
                  onSelectFile(entry);
                }
              }}
              className={`xook-tree-item group pr-1.5 py-1.5 rounded-lg border text-[11.5px] flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                isHighlighted
                  ? "xook-node-highlight border"
                  : isSelected
                  ? "bg-white/[0.08] border-white/20 text-white"
                  : "bg-transparent border-transparent text-zinc-300 hover:bg-white/[0.04] hover:border-white/[0.06]"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isDir ? (
                  <>
                    <ChevronRight
                      className={`w-3 h-3 text-zinc-500 shrink-0 xook-chevron ${
                        isExpanded ? "is-open" : ""
                      }`}
                    />
                    {ZoneIcon ? (
                      <ZoneIcon className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                    ) : isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-sky-300/80 shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    )}
                    <span
                      className={`truncate ${
                        entry.depth === 0 ? "font-semibold text-zinc-100" : "text-zinc-300"
                      }`}
                      title={zoneInfo?.subtitle ?? entry.relativePath}
                    >
                      {zoneInfo ? zoneInfo.label : entry.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-3 shrink-0" />
                    {entry.extension.toLowerCase() === "pdf" ? (
                      <FileText className="w-3.5 h-3.5 text-rose-300/85 shrink-0" />
                    ) : ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(
                        entry.extension.toLowerCase()
                      ) ? (
                      <ImageIcon className="w-3.5 h-3.5 text-sky-300/85 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    )}
                    <span className="truncate font-mono text-[11px] text-zinc-300">
                      {entry.name}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {entry.depth === 0 && entry.writePolicy === "hitl" && (
                  <span title="Zona protegida: Xox propone cambios con aprobación HITL">
                    <Lock className="w-2.5 h-2.5 text-zinc-500" />
                  </span>
                )}
                {!isDir && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePinFile(entry);
                    }}
                    title={
                      isPinned
                        ? "Incluido en consultas de Xox (clic para quitar)"
                        : "Fijar archivo al contexto de chat"
                    }
                    className={`p-0.5 rounded transition-opacity cursor-pointer ${
                      isPinned
                        ? "text-sky-300 opacity-100"
                        : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200"
                    }`}
                  >
                    <Pin className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inspector + Editor Directo del Archivo Seleccionado */}
      <div className="flex-1 flex flex-col overflow-hidden bg-black/30">
        {selectedFile ? (
          <>
            <div className="px-3 py-2 border-b border-white/[0.05] bg-[#0a0b10] flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-mono text-[11px] text-zinc-200 truncate">
                  {selectedFile.relativePath}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {selectedFile.kind === "pdf"
                    ? `${
                        typeof selectedFile.pdfSummary?.page_count === "number"
                          ? `${selectedFile.pdfSummary.page_count} pág(s) · `
                          : ""
                      }${Math.max(1, Math.round((selectedFile.sizeBytes ?? 0) / 1024))} KB`
                    : selectedFile.kind === "image" || selectedFile.kind === "binary"
                    ? `${Math.max(1, Math.round((selectedFile.sizeBytes ?? 0) / 1024))} KB`
                    : `~${selectedFile.tokens} tok`}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isTauriEnv && onOpenFile && (
                  <button
                    type="button"
                    onClick={() => onOpenFile(selectedFile.relativePath)}
                    title="Abrir en el visor del sistema"
                    className="px-2 py-1 rounded-md text-[10.5px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    <span>Abrir</span>
                  </button>
                )}
                {selectedFile.editable && !isEditingFile && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="px-2 py-1 rounded-md text-[10.5px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                    <span>Editar</span>
                  </button>
                )}
                {isEditingFile && (
                  <>
                    <button
                      type="button"
                      disabled={savingFile}
                      onClick={handleSaveEdit}
                      className="px-2 py-1 rounded-md text-[10.5px] bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-emerald-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="w-2.5 h-2.5" />
                      <span>Guardar</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingFile}
                      onClick={() => setIsEditingFile(false)}
                      className="px-1.5 py-1 rounded-md text-[10.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 p-2.5 overflow-y-auto">
              {selectedFile.kind === "image" ? (
                <div className="space-y-2.5">
                  {selectedFile.dataUrl ? (
                    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/50 p-2 flex items-center justify-center">
                      <img
                        src={selectedFile.dataUrl}
                        alt={selectedFile.name}
                        className="max-h-[240px] w-auto object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl border border-white/[0.07] bg-black/40 text-[11px] text-zinc-400 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-sky-300 shrink-0" />
                      <span>Imagen disponible en el espacio de trabajo.</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {onAskXoxAnalyzeFile && (
                      <button
                        type="button"
                        onClick={() => onAskXoxAnalyzeFile(selectedFile)}
                        className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] text-sky-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Usar con Xox</span>
                      </button>
                    )}
                    {isTauriEnv && onOpenFile && (
                      <button
                        type="button"
                        onClick={() => onOpenFile(selectedFile.relativePath)}
                        className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Abrir en visor</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : selectedFile.kind === "pdf" ? (
                <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-black/45 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-400/25 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-rose-200" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[12px] font-medium text-zinc-100 truncate">
                        {selectedFile.pdfSummary?.title || selectedFile.name}
                      </p>
                      <p className="text-[10.5px] text-zinc-400">
                        {typeof selectedFile.pdfSummary?.page_count === "number"
                          ? `${selectedFile.pdfSummary.page_count} ${
                              selectedFile.pdfSummary.page_count === 1 ? "página" : "páginas"
                            }`
                          : "Documento PDF"}
                        {selectedFile.pdfSummary?.has_selectable_text === false
                          ? " · Escaneado (OCR listo)"
                          : selectedFile.pdfSummary?.has_selectable_text === true
                          ? " · Texto extraíble"
                          : ""}
                      </p>
                      {selectedFile.pdfSummary?.author && (
                        <p className="text-[10px] text-zinc-500 truncate">
                          Autor: {selectedFile.pdfSummary.author}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {onPreviewPdf && (
                      <button
                        type="button"
                        onClick={() => onPreviewPdf(selectedFile)}
                        className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-[11px] text-rose-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Ver en panel</span>
                      </button>
                    )}
                    {isTauriEnv && onOpenFile && (
                      <button
                        type="button"
                        onClick={() => onOpenFile(selectedFile.relativePath)}
                        className="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.1] text-[11px] text-zinc-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Abrir PDF</span>
                      </button>
                    )}
                    {onAskXoxAnalyzeFile && (
                      <button
                        type="button"
                        onClick={() => onAskXoxAnalyzeFile(selectedFile)}
                        className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-[11px] text-sky-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Leer y analizar con Xox</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : selectedFile.kind === "binary" ? (
                <div className="rounded-xl border border-white/[0.08] bg-black/45 p-3 space-y-2">
                  <p className="text-[11px] text-zinc-400">
                    Archivo binario ({Math.max(1, Math.round((selectedFile.sizeBytes ?? 0) / 1024))} KB).
                  </p>
                  {isTauriEnv && onOpenFile && (
                    <button
                      type="button"
                      onClick={() => onOpenFile(selectedFile.relativePath)}
                      className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Abrir con el sistema</span>
                    </button>
                  )}
                </div>
              ) : isEditingFile ? (
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  className="w-full h-full min-h-[160px] text-[11px] font-mono text-zinc-200 bg-black/70 p-2.5 rounded-xl border border-sky-400/30 focus:outline-none resize-none select-text leading-relaxed"
                />
              ) : (
                <pre
                  className={`text-[11px] font-mono text-zinc-300 bg-black/60 p-2.5 rounded-xl border overflow-x-auto whitespace-pre-wrap leading-relaxed select-text transition-colors ${
                    saveFlashed ? "xook-save-flash" : "border-white/[0.05]"
                  }`}
                >
                  {selectedFile.content || "(Archivo vacío)"}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-zinc-500 p-5 text-center space-y-1.5">
            <FileText className="w-5 h-5 text-zinc-600" />
            <p className="text-[11px] text-zinc-400">
              Selecciona un archivo real del espacio para leer o editar.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
