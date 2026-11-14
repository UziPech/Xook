import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
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
  ListChecks,
  Lock,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  Table2,
  Trash2,
  Truck,
  X,
  Zap,
} from "lucide-react";
import {
  PdfSummaryInfo,
  WorkspaceNodeEntry,
  WorkspaceOverview,
  readWorkspaceFile,
} from "./workspaceApi";
import { WorkspacePermissionsSection } from "./WorkspacePermissionsSection";
import {
  ParsedBusinessProfile,
  ParsedFactListDoc,
  ParsedSupplier,
  SUPPORTED_CURRENCIES,
  formatFriendlyZone,
  formatReadableFileSize,
  isInternalWorkspaceEntry,
  parseBusinessProfile,
  parseMarkdownFactList,
  parseSuppliersFile,
  serializeBusinessProfile,
  serializeMarkdownFactList,
  serializeSuppliersFile,
} from "./workspaceMemorySchema";

export interface SelectedWorkspaceFile {
  relativePath: string;
  name: string;
  zone: string;
  content: string;
  editable: boolean;
  pinned: boolean;
  tokens: number;
  kind?: "text" | "image" | "pdf" | "office" | "binary" | string;
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
  onOpenInDocumentViewer?: (file: SelectedWorkspaceFile, editMode?: boolean) => void;
  onAskXoxAnalyzeFile?: (file: SelectedWorkspaceFile) => void;
  onCreateFolder: (relativePath: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>;
  selectedFile: SelectedWorkspaceFile | null;
  onSaveFileContent: (relativePath: string, content: string) => Promise<void>;
  onStatusNotice?: (message: string) => void;
}

type PanelViewMode = "simple" | "files";

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

function formatCompactBudget(amount: number, currency: string): string {
  if (!Number.isFinite(amount) || amount <= 0) return currency;
  return `$${amount.toLocaleString("es-MX")} ${currency}`;
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
  onOpenInDocumentViewer,
  onAskXoxAnalyzeFile,
  onCreateFolder,
  onCreateWorkspace,
  onSwitchWorkspace,
  onRenameWorkspace,
  selectedFile,
  onSaveFileContent,
  onStatusNotice,
}) => {
  const uid = useId();
  const [viewMode, setViewMode] = useState<PanelViewMode>("simple");

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

  // Estado legible (Vista Simple sin JSON)
  const [profileDraft, setProfileDraft] = useState<ParsedBusinessProfile>(() =>
    parseBusinessProfile(null, overview?.profile)
  );
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const [newRuleText, setNewRuleText] = useState("");
  const [factsDoc, setFactsDoc] = useState<ParsedFactListDoc>({
    title: "Memoria Viva",
    subtitle: "Este archivo guarda hechos reales y acuerdos confirmados del negocio.",
    items: [],
  });
  const [newFactText, setNewFactText] = useState("");

  const [suppliersList, setSuppliersList] = useState<ParsedSupplier[]>([]);
  const [suppliersContainer, setSuppliersContainer] = useState<Record<string, unknown>>({});
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [supName, setSupName] = useState("");
  const [supDays, setSupDays] = useState("3");
  const [supContact, setSupContact] = useState("");

  const showSavedFeedback = (label: string) => {
    setSavedToast(label);
    setTimeout(() => setSavedToast((curr) => (curr === label ? null : curr)), 2400);
  };

  const loadFriendlyDocuments = useCallback(async () => {
    if (!isTauriEnv || !overview) return;

    const available = new Set(overview.entries.map((e) => e.relativePath));

    try {
      if (available.has("empresa/perfil.json")) {
        const f = await readWorkspaceFile("empresa/perfil.json");
        const parsed = parseBusinessProfile(f.content, overview.profile);
        setProfileDraft(parsed);
        setProfileDirty(false);
      } else {
        setProfileDraft(parseBusinessProfile(null, overview.profile));
        setProfileDirty(false);
      }
    } catch {
      setProfileDraft(parseBusinessProfile(null, overview.profile));
    }

    try {
      if (available.has("memoria/hechos.md")) {
        const f = await readWorkspaceFile("memoria/hechos.md");
        setFactsDoc(
          parseMarkdownFactList(
            f.content,
            `Memoria Viva — ${overview.active.name}`,
            "Este archivo guarda hechos reales y acuerdos confirmados del negocio."
          )
        );
      }
    } catch {
      // Mantiene memoria en curso
    }

    try {
      if (available.has("empresa/proveedores.json")) {
        const f = await readWorkspaceFile("empresa/proveedores.json");
        const parsed = parseSuppliersFile(f.content);
        setSuppliersList(parsed.suppliers);
        setSuppliersContainer(parsed.rawContainer);
      }
    } catch {
      // Mantiene lista actual
    }
  }, [isTauriEnv, overview]);

  useEffect(() => {
    void loadFriendlyDocuments();
  }, [loadFriendlyDocuments]);

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

  const userDocuments = useMemo(() => {
    if (!overview) return [];
    return overview.entries.filter(
      (entry) => entry.kind === "file" && !isInternalWorkspaceEntry(entry)
    );
  }, [overview]);

  const selectedDocument = useMemo(() => {
    if (!selectedFile) return null;
    const match = userDocuments.find((d) => d.relativePath === selectedFile.relativePath);
    return match ? selectedFile : null;
  }, [selectedFile, userDocuments]);

  const toggleDir = (relPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const handleSaveProfileForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSection("profile");
    setPanelError(null);
    try {
      const json = serializeBusinessProfile(profileDraft);
      await onSaveFileContent("empresa/perfil.json", json);
      setProfileDirty(false);
      showSavedFeedback("Datos del negocio guardados");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudieron guardar los cambios.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newRuleText.trim();
    if (!clean) return;
    const nextProfile: ParsedBusinessProfile = {
      ...profileDraft,
      businessRules: [...profileDraft.businessRules, clean],
    };
    setSavingSection("rules");
    setPanelError(null);
    try {
      await onSaveFileContent("empresa/perfil.json", serializeBusinessProfile(nextProfile));
      setProfileDraft(nextProfile);
      setNewRuleText("");
      showSavedFeedback("Regla agregada");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo guardar la regla.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleRemoveRule = async (idx: number) => {
    const nextRules = profileDraft.businessRules.filter((_, i) => i !== idx);
    const nextProfile: ParsedBusinessProfile = {
      ...profileDraft,
      businessRules: nextRules,
    };
    setSavingSection("rules");
    setPanelError(null);
    try {
      await onSaveFileContent("empresa/perfil.json", serializeBusinessProfile(nextProfile));
      setProfileDraft(nextProfile);
      showSavedFeedback("Regla eliminada");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo quitar la regla.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFactText.trim();
    if (!clean) return;
    const nextDoc: ParsedFactListDoc = {
      ...factsDoc,
      items: [...factsDoc.items, clean],
    };
    setSavingSection("memory");
    setPanelError(null);
    try {
      await onSaveFileContent("memoria/hechos.md", serializeMarkdownFactList(nextDoc));
      setFactsDoc(nextDoc);
      setNewFactText("");
      showSavedFeedback("Recuerdo guardado");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo guardar en memoria.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleRemoveFact = async (idx: number) => {
    const nextDoc: ParsedFactListDoc = {
      ...factsDoc,
      items: factsDoc.items.filter((_, i) => i !== idx),
    };
    setSavingSection("memory");
    setPanelError(null);
    try {
      await onSaveFileContent("memoria/hechos.md", serializeMarkdownFactList(nextDoc));
      setFactsDoc(nextDoc);
      showSavedFeedback("Recuerdo quitado");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo actualizar la memoria.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = supName.trim();
    if (!cleanName) return;
    const daysNum = Math.max(1, Math.round(Number(supDays) || 3));
    const nextSupplier: ParsedSupplier = {
      id: "",
      name: cleanName,
      leadTimeDays: daysNum,
      contact: supContact.trim(),
      notes: "",
      rawObj: {},
    };
    const nextList = [...suppliersList, nextSupplier];
    setSavingSection("suppliers");
    setPanelError(null);
    try {
      await onSaveFileContent(
        "empresa/proveedores.json",
        serializeSuppliersFile(nextList, suppliersContainer)
      );
      setSuppliersList(nextList);
      setSupName("");
      setSupDays("3");
      setSupContact("");
      setShowAddSupplier(false);
      showSavedFeedback("Proveedor agregado");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo guardar el proveedor.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleRemoveSupplier = async (idx: number) => {
    const nextList = suppliersList.filter((_, i) => i !== idx);
    setSavingSection("suppliers");
    setPanelError(null);
    try {
      await onSaveFileContent(
        "empresa/proveedores.json",
        serializeSuppliersFile(nextList, suppliersContainer)
      );
      setSuppliersList(nextList);
      showSavedFeedback("Proveedor eliminado");
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "No se pudo eliminar el proveedor.");
    } finally {
      setSavingSection(null);
    }
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
        <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center xook-empty-float">
          <Store aria-hidden="true" className="w-4 h-4 text-zinc-300" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-100">Modo vista previa</p>
          <p className="text-[11px] text-zinc-400 leading-relaxed max-w-[220px]">
            Tu perfil de negocio, recuerdos y archivos reales viven en la app desktop XOOK.
          </p>
        </div>
      </div>
    );
  }

  const patterns = overview?.patterns ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Cabecera limpia del espacio activo + conmutador Simple / Archivos */}
      <div className="px-3 py-2 border-b border-white/[0.06] space-y-2 relative">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            aria-expanded={showSwitcher}
            onClick={() => setShowSwitcher((v) => !v)}
            className="min-h-[30px] flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-lg bg-[#0b0c10] hover:bg-white/[0.06] border border-white/[0.08] hover:border-white/[0.14] transition-colors cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-white/60"
            title="Cambiar o crear negocio"
          >
            <Store aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="text-xs font-medium text-zinc-100 truncate">
              {overview?.active.name ?? "Mi Negocio"}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={`w-3 h-3 text-zinc-400 shrink-0 transition-transform duration-200 ${
                showSwitcher ? "rotate-180" : ""
              }`}
            />
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <div
              role="group"
              aria-label="Modo de visualización"
              className="flex items-center p-0.5 rounded-lg bg-[#0b0c10] border border-white/[0.08]"
            >
              <button
                type="button"
                aria-pressed={viewMode === "simple"}
                onClick={() => setViewMode("simple")}
                className={`min-h-[24px] px-2.5 py-0.5 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
                  viewMode === "simple"
                    ? "bg-white/[0.1] text-white border border-white/[0.12]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                Guía
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "files"}
                onClick={() => setViewMode("files")}
                className={`min-h-[24px] px-2.5 py-0.5 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
                  viewMode === "files"
                    ? "bg-white/[0.1] text-white border border-white/[0.12]"
                    : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                }`}
              >
                Archivos
              </button>
            </div>

            {viewMode === "files" && (
              <button
                type="button"
                aria-expanded={showNewFolder}
                aria-label="Crear carpeta"
                onClick={() => setShowNewFolder((v) => !v)}
                title="Crear carpeta"
                className={`min-w-[28px] min-h-[28px] p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60 ${
                  showNewFolder
                    ? "bg-white/[0.1] border-white/[0.2] text-white"
                    : "bg-[#0b0c10] border-white/[0.08] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
                }`}
              >
                <FolderPlus aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              aria-label="Abrir carpeta en el sistema"
              onClick={() => onOpenFinder()}
              title="Abrir carpeta en Finder"
              className="min-w-[28px] min-h-[28px] p-1.5 rounded-lg bg-[#0b0c10] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60"
            >
              <ExternalLink aria-hidden="true" className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              aria-label="Actualizar información"
              onClick={onRefresh}
              title="Actualizar"
              className="min-w-[28px] min-h-[28px] p-1.5 rounded-lg bg-[#0b0c10] hover:bg-white/[0.06] border border-white/[0.08] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60"
            >
              <RefreshCw
                aria-hidden="true"
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-zinc-200" : ""}`}
              />
            </button>
          </div>
        </div>

        {/* Selector / creador de negocios */}
        {showSwitcher && overview && (
          <div className="panel-fade-in rounded-xl border border-white/[0.1] bg-[#0b0c10] p-2.5 space-y-2 shadow-xl">
            <div className="flex items-center justify-between text-[10.5px] text-zinc-400 font-medium px-0.5">
              <span>Tus espacios</span>
              <button
                type="button"
                onClick={() => {
                  setRenamingWs((v) => !v);
                  setRenameValue(overview.active.name);
                }}
                className="text-zinc-300 hover:text-white flex items-center gap-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 rounded"
              >
                <Pencil aria-hidden="true" className="w-2.5 h-2.5" />
                <span>Renombrar</span>
              </button>
            </div>

            {renamingWs && (
              <form onSubmit={handleRenameSubmit} className="flex gap-1.5">
                <label htmlFor={`${uid}-rename-ws`} className="sr-only">
                  Nuevo nombre del espacio
                </label>
                <input
                  id={`${uid}-rename-ws`}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 px-2.5 py-1 rounded-lg bg-[#07080b] border border-white/[0.12] text-[11.5px] text-white focus:outline-none focus:border-white/[0.24] select-text"
                  placeholder="Nombre del negocio..."
                />
                <button
                  type="submit"
                  disabled={busyAction}
                  aria-label="Confirmar nuevo nombre"
                  className="px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium cursor-pointer"
                >
                  <Check aria-hidden="true" className="w-3.5 h-3.5" />
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
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left text-[11.5px] flex items-center justify-between transition-colors cursor-pointer ${
                      isActive
                        ? "bg-white/[0.09] border border-white/[0.18] text-white"
                        : "bg-white/[0.02] hover:bg-white/[0.06] border border-transparent text-zinc-300"
                    }`}
                  >
                    <span className="truncate font-medium">{ws.name}</span>
                    {isActive && <Check aria-hidden="true" className="w-3.5 h-3.5 text-zinc-200 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {overview.active.rootPath && (
              <div className="text-[10px] text-zinc-400 px-0.5 truncate" title={overview.active.rootPath}>
                Ubicación: {formatCompactPath(overview.active.rootPath)}
              </div>
            )}

            <form
              onSubmit={handleCreateWorkspaceSubmit}
              className="pt-1.5 border-t border-white/[0.06] flex gap-1.5"
            >
              <label htmlFor={`${uid}-new-ws`} className="sr-only">
                Crear un espacio nuevo
              </label>
              <input
                id={`${uid}-new-ws`}
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="Crear otro negocio..."
                className="flex-1 px-2.5 py-1 rounded-lg bg-[#07080b] border border-white/[0.12] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
              />
              <button
                type="submit"
                disabled={busyAction || !newWsName.trim()}
                aria-label="Crear espacio"
                className="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-[11px] text-white disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                <Plus aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}

        {/* Formulario inline: Nueva Carpeta (solo en modo Archivos) */}
        {viewMode === "files" && showNewFolder && (
          <form
            onSubmit={handleCreateFolderSubmit}
            className="panel-fade-in rounded-xl border border-white/[0.08] bg-[#0b0c10] p-2.5 space-y-2"
          >
            <div className="flex items-center justify-between text-[11px] text-zinc-300">
              <span>Nueva carpeta dentro de:</span>
              <button
                type="button"
                aria-label="Cerrar formulario"
                onClick={() => setShowNewFolder(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            </div>
            <label htmlFor={`${uid}-folder-zone`} className="sr-only">
              Carpeta destino
            </label>
            <select
              id={`${uid}-folder-zone`}
              value={newFolderZone}
              onChange={(e) => setNewFolderZone(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.12] text-[11.5px] text-zinc-100 focus:outline-none focus:border-white/[0.24]"
            >
              <option value="agente/proyectos">Espacio de Xox / proyectos</option>
              <option value="agente">Espacio de Xox (raíz)</option>
              <option value="datos">Datos del Negocio</option>
              <option value="memoria">Memoria de Xox</option>
              <option value="empresa/reglas">Empresa y Reglas / reglas</option>
              <option value="habilidades">Habilidades</option>
            </select>
            <div className="flex gap-1.5">
              <label htmlFor={`${uid}-folder-name`} className="sr-only">
                Nombre de la carpeta
              </label>
              <input
                id={`${uid}-folder-name`}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="nombre-carpeta"
                autoFocus
                className="flex-1 px-2.5 py-1 rounded-lg bg-[#07080b] border border-white/[0.12] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
              />
              <button
                type="submit"
                disabled={busyAction || !newFolderName.trim()}
                className="px-3 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium disabled:opacity-40 cursor-pointer"
              >
                Crear
              </button>
            </div>
          </form>
        )}

        {savedToast && (
          <div
            role="status"
            aria-live="polite"
            className="panel-fade-in flex items-center gap-1.5 text-[11px] text-zinc-100 bg-white/[0.06] border border-white/[0.14] rounded-lg px-2.5 py-1.5"
          >
            <Check aria-hidden="true" className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
            <span>{savedToast}</span>
          </div>
        )}

        {panelError && (
          <div
            role="alert"
            className="panel-fade-in text-[11px] text-rose-200 bg-rose-500/10 border border-rose-400/25 rounded-lg px-2.5 py-1.5"
          >
            {panelError}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODO 1 (POR DEFECTO): GUÍA HUMANA LEGIBLE — CERO JSON, CERO CARPETAS     */}
      {/* ========================================================================= */}
      {viewMode === "simple" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {/* 1. Mi Negocio */}
          <details open className="xook-accordion rounded-xl border border-white/[0.08] bg-[#0b0c10]">
            <summary className="xook-accordion-summary min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  aria-hidden="true"
                  className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
                />
                <Store aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">Mi negocio</span>
              </span>
              <span className="text-[10.5px] text-zinc-400 shrink-0 truncate max-w-[115px]">
                {formatCompactBudget(profileDraft.maxBudgetPerOrder, profileDraft.currency)}
              </span>
            </summary>

            <form
              onSubmit={handleSaveProfileForm}
              className="px-3 pb-3 pt-2 border-t border-white/[0.06] space-y-2.5"
            >
              <div className="space-y-1">
                <label
                  htmlFor={`${uid}-company`}
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Nombre del negocio
                </label>
                <input
                  id={`${uid}-company`}
                  name="companyName"
                  type="text"
                  value={profileDraft.companyName}
                  onChange={(e) => {
                    setProfileDraft((p) => ({ ...p, companyName: e.target.value }));
                    setProfileDirty(true);
                  }}
                  className="w-full min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-xs text-zinc-100 focus:outline-none focus:border-white/[0.24] select-text"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-agent`}
                    className="block text-[11px] font-medium text-zinc-400"
                  >
                    Asistente
                  </label>
                  <input
                    id={`${uid}-agent`}
                    name="agentName"
                    type="text"
                    value={profileDraft.agentName}
                    onChange={(e) => {
                      setProfileDraft((p) => ({ ...p, agentName: e.target.value }));
                      setProfileDirty(true);
                    }}
                    className="w-full min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-xs text-zinc-100 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-currency`}
                    className="block text-[11px] font-medium text-zinc-400"
                  >
                    Moneda
                  </label>
                  <select
                    id={`${uid}-currency`}
                    name="currency"
                    value={profileDraft.currency}
                    onChange={(e) => {
                      setProfileDraft((p) => ({ ...p, currency: e.target.value }));
                      setProfileDirty(true);
                    }}
                    className="w-full min-h-[32px] px-2 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-xs text-zinc-100 focus:outline-none focus:border-white/[0.24]"
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-budget`}
                    className="block text-[11px] font-medium text-zinc-400"
                  >
                    Tope por orden
                  </label>
                  <input
                    id={`${uid}-budget`}
                    name="maxBudgetPerOrder"
                    type="text"
                    inputMode="decimal"
                    value={String(profileDraft.maxBudgetPerOrder)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9.]/g, ""));
                      setProfileDraft((p) => ({
                        ...p,
                        maxBudgetPerOrder: Number.isFinite(val) ? val : 0,
                      }));
                      setProfileDirty(true);
                    }}
                    className="w-full min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-xs text-zinc-100 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-stock-days`}
                    className="block text-[11px] font-medium text-zinc-400"
                  >
                    Mín. días stock
                  </label>
                  <input
                    id={`${uid}-stock-days`}
                    name="stockThresholdDays"
                    type="text"
                    inputMode="numeric"
                    value={String(profileDraft.stockThresholdDays)}
                    onChange={(e) => {
                      const val = Math.max(1, parseInt(e.target.value.replace(/\D/g, "") || "1", 10));
                      setProfileDraft((p) => ({ ...p, stockThresholdDays: val }));
                      setProfileDirty(true);
                    }}
                    className="w-full min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-xs text-zinc-100 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-0.5">
                <button
                  type="submit"
                  disabled={!profileDirty || savingSection === "profile"}
                  className={`min-h-[30px] px-3 py-1 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-white/60 ${
                    profileDirty
                      ? "bg-white text-zinc-950 hover:bg-zinc-200"
                      : "bg-white/[0.05] text-zinc-300 border border-white/[0.08]"
                  }`}
                >
                  <Save aria-hidden="true" className="w-3 h-3" />
                  <span>{savingSection === "profile" ? "Guardando..." : "Guardar cambios"}</span>
                </button>
              </div>
            </form>
          </details>

          {/* 2. Reglas para Xox */}
          <details open className="xook-accordion rounded-xl border border-white/[0.08] bg-[#0b0c10]">
            <summary className="xook-accordion-summary min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  aria-hidden="true"
                  className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
                />
                <ListChecks aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">
                  Reglas para {profileDraft.agentName || "Xox"}
                </span>
              </span>
              <span className="text-[10.5px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 shrink-0">
                {profileDraft.businessRules.length}
              </span>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] space-y-2.5">
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Instrucciones claras que el asistente siempre debe seguir.
              </p>

              {profileDraft.businessRules.length > 0 ? (
                <ul className="space-y-1.5">
                  {profileDraft.businessRules.map((rule, idx) => (
                    <li
                      key={`${idx}-${rule.slice(0, 16)}`}
                      className="group flex items-start justify-between gap-2 rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-2 text-[11.5px] text-zinc-200 leading-snug"
                    >
                      <span className="select-text">{rule}</span>
                      <button
                        type="button"
                        disabled={savingSection === "rules"}
                        onClick={() => void handleRemoveRule(idx)}
                        aria-label={`Eliminar regla: ${rule}`}
                        title="Quitar regla"
                        className="min-w-[24px] min-h-[24px] p-1 rounded text-zinc-500 hover:text-rose-200 hover:bg-white/[0.07] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer shrink-0 flex items-center justify-center"
                      >
                        <Trash2 aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400 py-1">
                  Aún no agregas reglas personalizadas.
                </p>
              )}

              <form onSubmit={handleAddRule} className="space-y-1.5 pt-1">
                <label
                  htmlFor={`${uid}-new-rule`}
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Agregar una regla
                </label>
                <div className="flex gap-1.5">
                  <input
                    id={`${uid}-new-rule`}
                    type="text"
                    value={newRuleText}
                    onChange={(e) => setNewRuleText(e.target.value)}
                    placeholder="Ej. Avisar antes de comprar a otro proveedor"
                    className="flex-1 min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                  <button
                    type="submit"
                    disabled={!newRuleText.trim() || savingSection === "rules"}
                    className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-[11px] font-medium text-white disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    <Plus aria-hidden="true" className="w-3.5 h-3.5" />
                    <span>Agregar</span>
                  </button>
                </div>
              </form>
            </div>
          </details>

          {/* 3. Memoria de Xox */}
          <details open className="xook-accordion rounded-xl border border-white/[0.08] bg-[#0b0c10]">
            <summary className="xook-accordion-summary min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  aria-hidden="true"
                  className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
                />
                <Brain aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">
                  Memoria de {profileDraft.agentName || "Xox"}
                </span>
              </span>
              <span className="text-[10.5px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 shrink-0">
                {factsDoc.items.length + patterns.length}
              </span>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] space-y-2.5">
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Anota datos útiles para que no tengas que repetirlos en cada chat.
              </p>

              {factsDoc.items.length > 0 ? (
                <ul className="space-y-1.5">
                  {factsDoc.items.map((fact, idx) => (
                    <li
                      key={`${idx}-${fact.slice(0, 16)}`}
                      className="group flex items-start justify-between gap-2 rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-2 text-[11.5px] text-zinc-200 leading-snug"
                    >
                      <span className="select-text">{fact}</span>
                      <button
                        type="button"
                        disabled={savingSection === "memory"}
                        onClick={() => void handleRemoveFact(idx)}
                        aria-label={`Olvidar recuerdo: ${fact}`}
                        title="Quitar recuerdo"
                        className="min-w-[24px] min-h-[24px] p-1 rounded text-zinc-500 hover:text-rose-200 hover:bg-white/[0.07] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer shrink-0 flex items-center justify-center"
                      >
                        <Trash2 aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg bg-[#07080b] border border-dashed border-white/[0.08] px-2.5 py-2 text-[11px] text-zinc-400">
                  Sin recuerdos guardados aún. Agrega horarios, preferencias o notas abajo.
                </div>
              )}

              <form onSubmit={handleAddFact} className="space-y-1.5">
                <label
                  htmlFor={`${uid}-new-fact`}
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Nuevo recuerdo
                </label>
                <div className="flex gap-1.5">
                  <input
                    id={`${uid}-new-fact`}
                    type="text"
                    value={newFactText}
                    onChange={(e) => setNewFactText(e.target.value)}
                    placeholder="Ej. Cerramos los domingos"
                    className="flex-1 min-h-[32px] px-2.5 py-1.5 rounded-lg bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                  <button
                    type="submit"
                    disabled={!newFactText.trim() || savingSection === "memory"}
                    className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium disabled:opacity-40 cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    Recordar
                  </button>
                </div>
              </form>

              {patterns.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                  <div className="text-[10.5px] font-medium text-zinc-400">
                    Aprendido de tus decisiones
                  </div>
                  <ul className="space-y-1">
                    {patterns.map((pat) => (
                      <li
                        key={pat.pattern_id}
                        className="rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-zinc-200 leading-snug">{pat.description}</span>
                        <span className="text-[10px] tabular-nums text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] shrink-0">
                          {Math.round(pat.confidence * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          {/* 4. Proveedores */}
          <details className="xook-accordion rounded-xl border border-white/[0.08] bg-[#0b0c10]">
            <summary className="xook-accordion-summary min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  aria-hidden="true"
                  className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
                />
                <Truck aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">Proveedores</span>
              </span>
              <span className="text-[10.5px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 shrink-0">
                {suppliersList.length}
              </span>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] space-y-2.5">
              {suppliersList.length > 0 ? (
                <ul className="space-y-1.5">
                  {suppliersList.map((sup, idx) => (
                    <li
                      key={`${sup.id}-${idx}`}
                      className="group flex items-center justify-between gap-2 rounded-lg bg-[#07080b] border border-white/[0.07] px-2.5 py-2 text-[11.5px]"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-100 truncate">{sup.name}</div>
                        <div className="text-[10.5px] text-zinc-400 truncate">
                          Entrega en {sup.leadTimeDays}{" "}
                          {sup.leadTimeDays === 1 ? "día" : "días"}
                          {sup.contact ? ` · ${sup.contact}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={savingSection === "suppliers"}
                        onClick={() => void handleRemoveSupplier(idx)}
                        aria-label={`Quitar proveedor ${sup.name}`}
                        title="Quitar proveedor"
                        className="min-w-[24px] min-h-[24px] p-1 rounded text-zinc-500 hover:text-rose-200 hover:bg-white/[0.07] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer shrink-0 flex items-center justify-center"
                      >
                        <Trash2 aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400">
                  Aún no hay proveedores registrados.
                </p>
              )}

              {showAddSupplier ? (
                <form
                  onSubmit={handleAddSupplier}
                  className="rounded-lg bg-[#07080b] border border-white/[0.08] p-2.5 space-y-2"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-sup-name`}
                      className="block text-[11px] font-medium text-zinc-400"
                    >
                      Nombre del proveedor
                    </label>
                    <input
                      id={`${uid}-sup-name`}
                      type="text"
                      required
                      value={supName}
                      onChange={(e) => setSupName(e.target.value)}
                      placeholder="Ej. Distribuidora Central"
                      className="w-full min-h-[30px] px-2.5 py-1 rounded-lg bg-black/50 border border-white/[0.12] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-sup-days`}
                        className="block text-[11px] font-medium text-zinc-400"
                      >
                        Días de entrega
                      </label>
                      <input
                        id={`${uid}-sup-days`}
                        type="text"
                        inputMode="numeric"
                        value={supDays}
                        onChange={(e) => setSupDays(e.target.value.replace(/\D/g, ""))}
                        className="w-full min-h-[30px] px-2.5 py-1 rounded-lg bg-black/50 border border-white/[0.12] text-[11.5px] text-white focus:outline-none focus:border-white/[0.24] select-text"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-sup-contact`}
                        className="block text-[11px] font-medium text-zinc-400"
                      >
                        Contacto (opcional)
                      </label>
                      <input
                        id={`${uid}-sup-contact`}
                        type="text"
                        value={supContact}
                        onChange={(e) => setSupContact(e.target.value)}
                        placeholder="Tel. o correo"
                        className="w-full min-h-[30px] px-2.5 py-1 rounded-lg bg-black/50 border border-white/[0.12] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowAddSupplier(false)}
                      className="min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={!supName.trim() || savingSection === "suppliers"}
                      className="min-h-[28px] px-3 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium disabled:opacity-40 cursor-pointer"
                    >
                      Guardar
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddSupplier(true)}
                  className="w-full min-h-[32px] px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-[11px] font-medium text-zinc-100 inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
                >
                  <Plus aria-hidden="true" className="w-3.5 h-3.5" />
                  <span>Agregar proveedor</span>
                </button>
              )}
            </div>
          </details>

          {/* 5. Documentos del negocio */}
          <details className="xook-accordion rounded-xl border border-white/[0.08] bg-[#0b0c10]">
            <summary className="xook-accordion-summary min-h-[38px] px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
              <span className="flex items-center gap-2 min-w-0">
                <ChevronRight
                  aria-hidden="true"
                  className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
                />
                <FileText aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-xs font-medium text-zinc-100 truncate">Documentos</span>
              </span>
              <span className="text-[10.5px] tabular-nums px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300 shrink-0">
                {userDocuments.length}
              </span>
            </summary>

            <div className="px-3 pb-3 pt-2 border-t border-white/[0.06] space-y-2">
              {userDocuments.length > 0 ? (
                <ul className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                  {userDocuments.map((entry) => {
                    const isSelected = selectedDocument?.relativePath === entry.relativePath;
                    const isImg = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(
                      entry.extension.toLowerCase()
                    );
                    const isTable = ["csv", "tsv", "xlsx", "xls"].includes(
                      entry.extension.toLowerCase()
                    );
                    return (
                      <li key={entry.relativePath}>
                        <button
                          type="button"
                          onClick={() => onSelectFile(entry)}
                          className={`w-full min-h-[34px] px-2.5 py-1.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
                            isSelected
                              ? "bg-white/[0.09] border-white/[0.18] text-white"
                              : "bg-[#07080b] border-white/[0.07] text-zinc-200 hover:bg-white/[0.05]"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {isImg ? (
                              <ImageIcon aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            ) : isTable ? (
                              <Table2 aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            ) : (
                              <FileText aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            )}
                            <span className="text-[11.5px] truncate">{entry.name}</span>
                          </span>
                          <span className="text-[10px] text-zinc-400 shrink-0">
                            {formatFriendlyZone(entry)} · {formatReadableFileSize(entry.sizeBytes)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Aquí verás tus hojas de cálculo, facturas PDF, reportes o imágenes. Arrastra un archivo al chat o abre la carpeta para guardarlos.
                </p>
              )}

              {selectedDocument && (
                <div className="panel-fade-in rounded-xl border border-white/[0.08] bg-[#07080b] p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-medium text-white truncate">
                        {selectedDocument.pdfSummary?.title || selectedDocument.name}
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {selectedDocument.kind === "pdf" &&
                        typeof selectedDocument.pdfSummary?.page_count === "number"
                          ? `${selectedDocument.pdfSummary.page_count} ${
                              selectedDocument.pdfSummary.page_count === 1 ? "página" : "páginas"
                            } · `
                          : ""}
                        {formatReadableFileSize(selectedDocument.sizeBytes)}
                      </div>
                    </div>
                  </div>

                  {selectedDocument.kind === "image" && selectedDocument.dataUrl && (
                    <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-black/50 p-1.5 flex items-center justify-center">
                      <img
                        src={selectedDocument.dataUrl}
                        alt={selectedDocument.name}
                        className="max-h-36 w-auto object-contain rounded"
                      />
                    </div>
                  )}

                  {selectedDocument.kind !== "image" &&
                    selectedDocument.kind !== "pdf" &&
                    selectedDocument.kind !== "binary" && (
                      <pre className="max-h-28 overflow-auto text-[10.5px] text-zinc-300 bg-black/50 p-2 rounded-lg border border-white/[0.05] whitespace-pre-wrap leading-relaxed select-text">
                        {selectedDocument.content.slice(0, 600) || "(Documento vacío)"}
                      </pre>
                    )}

                  <div className="flex flex-wrap gap-1.5">
                    {(onOpenInDocumentViewer || onPreviewPdf) && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenInDocumentViewer
                              ? onOpenInDocumentViewer(selectedDocument, false)
                              : onPreviewPdf?.(selectedDocument)
                          }
                          className="quick-liquid-btn min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] text-zinc-100 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText aria-hidden="true" className="w-3 h-3" />
                          <span>Ver en visor</span>
                        </button>
                        {onOpenInDocumentViewer &&
                          (selectedDocument.kind === "pdf" || selectedDocument.kind === "text") && (
                            <button
                              type="button"
                              onClick={() => onOpenInDocumentViewer(selectedDocument, true)}
                              className="quick-liquid-btn min-h-[28px] px-2.5 py-1 rounded-lg text-[11px] text-zinc-100 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Pencil aria-hidden="true" className="w-3 h-3" />
                              <span>Modificar</span>
                            </button>
                          )}
                      </>
                    )}
                    {onAskXoxAnalyzeFile && (
                      <button
                        type="button"
                        onClick={() => onAskXoxAnalyzeFile(selectedDocument)}
                        className="min-h-[28px] px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles aria-hidden="true" className="w-3 h-3" />
                        <span>Analizar con Xox</span>
                      </button>
                    )}
                    {onOpenFile && (
                      <button
                        type="button"
                        onClick={() => onOpenFile(selectedDocument.relativePath)}
                        className="min-h-[28px] px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-[11px] text-zinc-200 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ExternalLink aria-hidden="true" className="w-3 h-3" />
                        <span>Abrir</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* 6. Permisos y apps */}
          <WorkspacePermissionsSection
            activeWorkspaceId={overview?.active.id}
            onStatusNotice={onStatusNotice}
          />
        </div>
      ) : (
        /* ========================================================================= */
        /* MODO 2 (OPCIONAL): ARCHIVOS Y CARPETAS TÉCNICAS (PALETA UNIFICADA)        */
        /* ========================================================================= */
        <>
          <div className="px-3 pt-2.5">
            <WorkspacePermissionsSection
              activeWorkspaceId={overview?.active.id}
              onStatusNotice={onStatusNotice}
            />
          </div>

          <div className="max-h-[46%] overflow-y-auto p-2.5 border-b border-white/[0.06] space-y-0.5">
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
                      ? "bg-white/[0.08] border-white/[0.18] text-white"
                      : "bg-transparent border-transparent text-zinc-300 hover:bg-white/[0.04] hover:border-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isDir ? (
                      <>
                        <ChevronRight
                          aria-hidden="true"
                          className={`w-3 h-3 text-zinc-500 shrink-0 xook-chevron ${
                            isExpanded ? "is-open" : ""
                          }`}
                        />
                        {ZoneIcon ? (
                          <ZoneIcon className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                        ) : isExpanded ? (
                          <FolderOpen aria-hidden="true" className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
                        ) : (
                          <Folder aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span
                          className={`truncate ${
                            entry.depth === 0 ? "font-medium text-zinc-100" : "text-zinc-300"
                          }`}
                          title={zoneInfo?.subtitle ?? entry.relativePath}
                        >
                          {zoneInfo ? zoneInfo.label : entry.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-3 shrink-0" />
                        {["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(
                          entry.extension.toLowerCase()
                        ) ? (
                          <ImageIcon aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        ) : (
                          <FileText aria-hidden="true" className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className="truncate font-mono text-[11px] text-zinc-200">
                          {entry.name}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {entry.depth === 0 && entry.writePolicy === "hitl" && (
                      <span title="Zona protegida: Xox pide aprobación antes de cambiar algo">
                        <Lock aria-hidden="true" className="w-2.5 h-2.5 text-zinc-500" />
                      </span>
                    )}
                    {!isDir && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePinFile(entry);
                        }}
                        aria-label={
                          isPinned
                            ? `Quitar ${entry.name} de la memoria activa`
                            : `Incluir ${entry.name} en la memoria activa`
                        }
                        title={
                          isPinned
                            ? "Incluido en consultas de Xox (clic para quitar)"
                            : "Incluir en memoria de chat"
                        }
                        className={`p-0.5 rounded transition-opacity cursor-pointer ${
                          isPinned
                            ? "text-zinc-100 opacity-100"
                            : "text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200"
                        }`}
                      >
                        <Pin aria-hidden="true" className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden bg-black/25">
            {selectedFile ? (
              <>
                <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-zinc-100 truncate">
                      {selectedFile.relativePath}
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      {selectedFile.kind === "pdf" &&
                      typeof selectedFile.pdfSummary?.page_count === "number"
                        ? `${selectedFile.pdfSummary.page_count} pág(s) · `
                        : ""}
                      {formatReadableFileSize(selectedFile.sizeBytes)}
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
                        <ExternalLink aria-hidden="true" className="w-2.5 h-2.5" />
                        <span>Abrir</span>
                      </button>
                    )}
                    {selectedFile.editable && !isEditingFile && (
                      <>
                        {onOpenInDocumentViewer && (
                          <button
                            type="button"
                            onClick={() => onOpenInDocumentViewer(selectedFile, true)}
                            title="Abrir en el visor dedicado para editar cómodamente"
                            className="quick-liquid-btn px-2 py-1 rounded-md text-[10.5px] text-zinc-100 flex items-center gap-1 cursor-pointer"
                          >
                            <FileText aria-hidden="true" className="w-2.5 h-2.5" />
                            <span>Visor</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleStartEdit}
                          className="px-2 py-1 rounded-md text-[10.5px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil aria-hidden="true" className="w-2.5 h-2.5" />
                          <span>Editar</span>
                        </button>
                      </>
                    )}
                    {isEditingFile && (
                      <>
                        <button
                          type="button"
                          disabled={savingFile}
                          onClick={handleSaveEdit}
                          className="px-2 py-1 rounded-md text-[10.5px] bg-white text-zinc-950 hover:bg-zinc-200 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <Save aria-hidden="true" className="w-2.5 h-2.5" />
                          <span>Guardar</span>
                        </button>
                        <button
                          type="button"
                          aria-label="Cancelar edición"
                          disabled={savingFile}
                          onClick={() => setIsEditingFile(false)}
                          className="px-1.5 py-1 rounded-md text-[10.5px] text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <X aria-hidden="true" className="w-3 h-3" />
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
                          <ImageIcon aria-hidden="true" className="w-4 h-4 text-zinc-300 shrink-0" />
                          <span>Imagen disponible en el espacio de trabajo.</span>
                        </div>
                      )}
                      {onAskXoxAnalyzeFile && (
                        <button
                          type="button"
                          onClick={() => onAskXoxAnalyzeFile(selectedFile)}
                          className="px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles aria-hidden="true" className="w-3 h-3" />
                          <span>Usar con Xox</span>
                        </button>
                      )}
                    </div>
                  ) : selectedFile.kind === "pdf" ? (
                    <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-black/45 p-3">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center shrink-0">
                          <FileText aria-hidden="true" className="w-4 h-4 text-zinc-200" />
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
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(onOpenInDocumentViewer || onPreviewPdf) && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenInDocumentViewer
                                ? onOpenInDocumentViewer(selectedFile, false)
                                : onPreviewPdf?.(selectedFile)
                            }
                            className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-white inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <FileText aria-hidden="true" className="w-3 h-3" />
                            <span>Ver en visor</span>
                          </button>
                        )}
                        {onOpenInDocumentViewer && (
                          <button
                            type="button"
                            onClick={() => onOpenInDocumentViewer(selectedFile, true)}
                            className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-zinc-100 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Pencil aria-hidden="true" className="w-3 h-3" />
                            <span>Modificar</span>
                          </button>
                        )}
                        {onAskXoxAnalyzeFile && (
                          <button
                            type="button"
                            onClick={() => onAskXoxAnalyzeFile(selectedFile)}
                            className="px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sparkles aria-hidden="true" className="w-3 h-3" />
                            <span>Analizar con Xox</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : selectedFile.kind === "office" || selectedFile.kind === "binary" ? (
                    <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-black/45 p-3">
                      <p className="text-[11px] text-zinc-300">
                        {selectedFile.name} ({formatReadableFileSize(selectedFile.sizeBytes)})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {onOpenInDocumentViewer && (
                          <button
                            type="button"
                            onClick={() => onOpenInDocumentViewer(selectedFile, false)}
                            className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-white inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <FileText aria-hidden="true" className="w-3 h-3" />
                            <span>Ver en visor</span>
                          </button>
                        )}
                        {onAskXoxAnalyzeFile && (
                          <button
                            type="button"
                            onClick={() => onAskXoxAnalyzeFile(selectedFile)}
                            className="px-2.5 py-1 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sparkles aria-hidden="true" className="w-3 h-3" />
                            <span>Analizar con Xox</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : isEditingFile ? (
                    <textarea
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      className="w-full h-full min-h-[160px] text-[11px] font-mono text-zinc-100 bg-[#07080b] p-2.5 rounded-xl border border-white/[0.2] focus:outline-none resize-none select-text leading-relaxed"
                    />
                  ) : (
                    <pre
                      className={`text-[11px] font-mono text-zinc-300 bg-black/55 p-2.5 rounded-xl border overflow-x-auto whitespace-pre-wrap leading-relaxed select-text transition-colors ${
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
                <FileText aria-hidden="true" className="w-5 h-5 text-zinc-600" />
                <p className="text-[11px] text-zinc-400">
                  Selecciona un archivo para ver o editar su contenido.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
