import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  Download,
  Globe,
  ListChecks,
  Loader2,
  Play,
  Plus,
  Save,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserCog,
  Volume2,
  VolumeX,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { JellyPillTrack } from "../../components/JellyPillTrack";
import {
  XOX_ACCENT_PRESETS,
  XoxAccentPreset,
  XoxStar,
  XoxState,
  resolveXoxAccentPreset,
} from "../../components/XoxStar";
import {
  deleteTtsModels,
  downloadTtsModels,
  isTauriTtsRuntime,
  saveTtsConfig,
  ttsPlayer,
  unloadTtsWorker,
  type TtsDownloadProgress,
  type TtsPlaybackSnapshot,
  type TtsStatus,
} from "../tts-voice/ttsClient";
import { cleanTtsErrorMessage } from "../settings/settingsHelpers";
import {
  DEFAULT_GLOBAL_XOX_PROFILE,
  type GlobalXoxProfile,
  type OfficialSkillCandidate,
  type XoxSkillEntry,
  deleteXoxSkill,
  discoverOfficialSkills,
  installOfficialSkill,
  saveGlobalXoxProfile,
  saveXoxSkill,
} from "./xoxStudioApi";
import {
  SKILL_DOMAIN_OPTIONS,
  SKILL_STARTER_TEMPLATES,
  type SkillBlockModel,
  parseSkillToBlocks,
  serializeBlocksToSkillMarkdown,
  slugifySkillName,
} from "./skillBlockSchema";

export type XoxStudioTabId = "identity" | "voice" | "skills" | "rules";

interface XoxStudioPanelProps {
  visible?: boolean;
  initialTab?: XoxStudioTabId;
  highlightedSkillSlug?: string | null;
  glideSeq?: number;
  profile: GlobalXoxProfile;
  skills: XoxSkillEntry[];
  ttsStatus: TtsStatus | null;
  xoxState: XoxState;
  hasActiveWorkspace: boolean;
  activeWorkspaceName?: string | null;
  onProfileChanged: (next: GlobalXoxProfile) => void;
  onPreviewAccentChange?: (preset: XoxAccentPreset) => void;
  onSkillsRefresh: () => Promise<void> | void;
  onTtsStatusChanged: (next: TtsStatus) => void;
  onAskXoxCustomize?: (hintPrompt: string) => void;
  onStatusNotice?: (message: string) => void;
  onClose: () => void;
}

const STUDIO_PREVIEW_MSG_ID = "__xook_studio_voice_preview__";

const TONE_SUGGESTIONS = [
  "Cercano",
  "Directo",
  "Práctico",
  "Didáctico",
  "Ejecutivo",
  "Creativo",
  "Breve",
  "Detallado",
] as const;

interface EditableTextBlockListProps {
  idPrefix: string;
  label: string;
  helperText?: string;
  items: string[];
  placeholder: string;
  addButtonLabel?: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

/** Lista editable por bloques de texto simples reutilizable para pasos, reglas, gustos y límites. */
const EditableTextBlockList: React.FC<EditableTextBlockListProps> = ({
  idPrefix,
  label,
  helperText,
  items,
  placeholder,
  addButtonLabel = "Agregar",
  disabled = false,
  onChange,
}) => {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const clean = draft.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (!items.some((it) => it.toLowerCase() === clean.toLowerCase())) {
      onChange([...items, clean]);
    }
    setDraft("");
  };

  const updateItem = (idx: number, val: string) => {
    const next = [...items];
    next[idx] = val;
    onChange(next);
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`${idPrefix}-add`} className="block text-[11.5px] font-medium text-zinc-200">
          {label}
        </label>
        <span className="text-[10px] font-mono tabular-nums text-zinc-500">
          {items.length}
        </span>
      </div>
      {helperText && (
        <p className="text-[11px] text-zinc-400 leading-snug">{helperText}</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`${idPrefix}-${idx}`}
              className="group flex items-center gap-1.5 rounded-xl bg-[#07080b] border border-white/[0.08] px-2.5 py-1.5 focus-within:border-white/[0.22]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={item}
                disabled={disabled}
                aria-label={`${label} punto ${idx + 1}`}
                onChange={(e) => updateItem(idx, e.target.value)}
                className="flex-1 min-w-0 bg-transparent text-[11.5px] text-zinc-100 focus:outline-none select-text"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeItem(idx)}
                aria-label={`Quitar: ${item}`}
                title="Quitar"
                className="p-1 rounded-lg text-zinc-500 hover:text-rose-200 hover:bg-white/[0.07] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 transition-all cursor-pointer shrink-0"
              >
                <Trash2 aria-hidden="true" className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          id={`${idPrefix}-add`}
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder={placeholder}
          enterKeyHint="done"
          className="flex-1 min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
        />
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={commitDraft}
          className="min-h-[34px] px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-[11px] font-medium text-white disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center gap-1 transition-colors"
        >
          <Plus aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{addButtonLabel}</span>
        </button>
      </div>
    </div>
  );
};

export const XoxStudioPanel: React.FC<XoxStudioPanelProps> = ({
  visible = true,
  initialTab = "identity",
  highlightedSkillSlug = null,
  glideSeq = 0,
  profile,
  skills,
  ttsStatus,
  xoxState,
  hasActiveWorkspace,
  activeWorkspaceName,
  onProfileChanged,
  onPreviewAccentChange,
  onSkillsRefresh,
  onTtsStatusChanged,
  onAskXoxCustomize,
  onStatusNotice,
  onClose,
}) => {
  const uid = useId();
  const [activeTab, setActiveTab] = useState<XoxStudioTabId>(initialTab);
  const [draft, setDraft] = useState<GlobalXoxProfile>(() => ({
    ...DEFAULT_GLOBAL_XOX_PROFILE,
    ...profile,
  }));
  const [customToneInput, setCustomToneInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [stageCheerState, setStageCheerState] = useState<XoxState | null>(null);
  const [colorRippleSeq, setColorRippleSeq] = useState(0);

  // Estado de Voz local
  const [savingVoice, setSavingVoice] = useState(false);
  const [downloadingVoice, setDownloadingVoice] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<TtsDownloadProgress | null>(null);
  const [confirmDeleteModels, setConfirmDeleteModels] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<TtsPlaybackSnapshot>(() => ttsPlayer.getSnapshot());
  const inTauriVoice = isTauriTtsRuntime();

  // Estado del Editor de Skills por Bloques
  const [editingSkill, setEditingSkill] = useState<SkillBlockModel | null>(null);
  const [isNewSkill, setIsNewSkill] = useState(false);
  const [savingSkill, setSavingSkill] = useState(false);
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null);
  const [showRawPreview, setShowRawPreview] = useState(false);

  // Buscador de skills oficiales verificadas
  const [showOfficialHub, setShowOfficialHub] = useState(false);
  const [officialQuery, setOfficialQuery] = useState("");
  const [searchingOfficial, setSearchingOfficial] = useState(false);
  const [officialResults, setOfficialResults] = useState<OfficialSkillCandidate[]>([]);
  const [officialMessage, setOfficialMessage] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const tabRefs = useRef<Record<XoxStudioTabId, HTMLButtonElement | null>>({
    identity: null,
    voice: null,
    skills: null,
    rules: null,
  });

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setDraft({ ...DEFAULT_GLOBAL_XOX_PROFILE, ...profile });
  }, [profile]);

  useEffect(() => {
    if (highlightedSkillSlug) {
      const target = skills.find((s) => s.slug === highlightedSkillSlug);
      if (target) {
        setActiveTab("skills");
        setEditingSkill(parseSkillToBlocks(target));
        setIsNewSkill(false);
      }
    }
  }, [highlightedSkillSlug, skills]);

  useEffect(() => ttsPlayer.subscribe(setPlayback), []);

  const profileDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify({ ...DEFAULT_GLOBAL_XOX_PROFILE, ...profile });
  }, [draft, profile]);

  const showSaved = (msg: string) => {
    setSaveMessage(msg);
    onStatusNotice?.(msg);
    setTimeout(() => setSaveMessage((curr) => (curr === msg ? null : curr)), 2600);
  };

  const handleSaveGlobalProfile = async (overrideDraft?: GlobalXoxProfile) => {
    const target = overrideDraft ?? draft;
    setSavingProfile(true);
    setErrorMsg(null);
    try {
      const saved = await saveGlobalXoxProfile({
        agentName: target.agentName.trim() || "Xox",
        activeRole: target.activeRole.trim() || "Asistente Co-Constructor",
        personality: target.personality.trim() || "Cercano, claro, práctico y directo.",
        toneTags: target.toneTags,
        initialInstructions: target.initialInstructions.trim(),
        globalRules: target.globalRules,
        likes: target.likes,
        workflows: target.workflows,
        donts: target.donts,
        accentPreset: target.accentPreset,
      });
      onProfileChanged(saved);
      setDraft(saved);
      showSaved(`Cambios de ${saved.agentName} guardados`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudieron guardar los cambios.");
    } finally {
      setSavingProfile(false);
    }
  };

  const toggleToneTag = (tag: string) => {
    const exists = draft.toneTags.some((t) => t.toLowerCase() === tag.toLowerCase());
    setDraft((prev) => ({
      ...prev,
      toneTags: exists
        ? prev.toneTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev.toneTags, tag].slice(0, 8),
    }));
  };

  const addCustomToneTag = () => {
    const clean = customToneInput.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (!draft.toneTags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setDraft((prev) => ({ ...prev, toneTags: [...prev.toneTags, clean].slice(0, 8) }));
    }
    setCustomToneInput("");
  };

  // --- Handlers de Voz ---
  const voiceConfig = ttsStatus?.config ?? {
    enabled: false,
    autoPlay: false,
    voiceId: "lola",
    speed: 1.0,
    idleUnloadMinutes: 5,
  };
  const modelsInstalled = Boolean(ttsStatus?.modelsInstalled);
  const voices = ttsStatus?.voices ?? [];
  const workerRunning = Boolean(ttsStatus?.workerRunning);
  const workerRssMb = ttsStatus?.workerRssMb ?? 0;

  const handleUpdateVoice = async (patch: Partial<typeof voiceConfig>) => {
    setSavingVoice(true);
    setVoiceError(null);
    try {
      const updated = await saveTtsConfig(patch);
      onTtsStatusChanged(updated);
      if (typeof patch.speed === "number") {
        ttsPlayer.setSpeed(patch.speed);
      }
      if (patch.enabled === false) {
        ttsPlayer.stop();
      }
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setSavingVoice(false);
    }
  };

  const handleToggleVoiceEnabled = async (nextEnabled: boolean) => {
    if (nextEnabled && inTauriVoice && !modelsInstalled) {
      await handleDownloadVoices();
      return;
    }
    await handleUpdateVoice({ enabled: nextEnabled });
  };

  const handleDownloadVoices = async () => {
    setDownloadingVoice(true);
    setVoiceError(null);
    setDownloadProgress({
      progress: 3,
      label: "Preparando descarga de voces en español...",
      step: 0,
      totalSteps: 7,
      downloadedBytes: 0,
      totalBytes: 0,
      done: false,
    });
    try {
      const updated = await downloadTtsModels(["lola", "rafael"]);
      onTtsStatusChanged(updated);
      const activeVoice = updated.config.voiceId || "lola";
      const finalStatus = await saveTtsConfig({ enabled: true, voiceId: activeVoice });
      onTtsStatusChanged(finalStatus);
      showSaved("Voces locales listas");
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setDownloadingVoice(false);
      setDownloadProgress(null);
    }
  };

  const handlePreviewVoice = async (voiceId: string) => {
    setVoiceError(null);
    if (
      (playback.playingMessageId === STUDIO_PREVIEW_MSG_ID ||
        playback.loadingMessageId === STUDIO_PREVIEW_MSG_ID) &&
      previewVoiceId === voiceId
    ) {
      ttsPlayer.stop();
      setPreviewVoiceId(null);
      return;
    }
    if (inTauriVoice && !modelsInstalled) {
      setVoiceError("Descarga primero el paquete de voz local para escuchar la muestra.");
      return;
    }
    setPreviewVoiceId(voiceId);
    const agentLabel = draft.agentName.trim() || "Xox";
    try {
      if (!voiceConfig.enabled) {
        const updated = await saveTtsConfig({ enabled: true, voiceId });
        onTtsStatusChanged(updated);
      } else if (voiceConfig.voiceId !== voiceId) {
        const updated = await saveTtsConfig({ voiceId });
        onTtsStatusChanged(updated);
      }
      await ttsPlayer.playMessage(
        STUDIO_PREVIEW_MSG_ID,
        `Hola, soy ${agentLabel}. Así suena esta voz cuando te respondo en XOOK.`,
        { voiceId, speed: voiceConfig.speed }
      );
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
      setPreviewVoiceId(null);
    }
  };

  // --- Handlers de Skills por Bloques ---
  const handleStartNewSkill = (templateIdx?: number) => {
    setErrorMsg(null);
    setShowRawPreview(false);
    setConfirmDeleteSlug(null);
    setIsNewSkill(true);
    if (typeof templateIdx === "number" && SKILL_STARTER_TEMPLATES[templateIdx]) {
      const tpl = SKILL_STARTER_TEMPLATES[templateIdx].model;
      setEditingSkill({
        ...tpl,
        slug: slugifySkillName(tpl.title),
        scope: "global",
        source: "user-studio",
      });
    } else {
      setEditingSkill({
        slug: "",
        title: "",
        description: "",
        role: "",
        domain: "general",
        scope: "global",
        enabled: true,
        source: "user-studio",
        prefs: [],
        steps: [],
        donts: [],
        instructions: "",
      });
    }
  };

  const handleSaveSkillBlocks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSkill) return;
    if (!editingSkill.title.trim()) {
      setErrorMsg("Ponle un nombre a la habilidad para guardarla.");
      return;
    }
    setSavingSkill(true);
    setErrorMsg(null);
    try {
      const targetSlug = isNewSkill
        ? slugifySkillName(editingSkill.title)
        : editingSkill.slug || slugifySkillName(editingSkill.title);
      const nextModel: SkillBlockModel = {
        ...editingSkill,
        slug: targetSlug,
        scope: editingSkill.scope === "workspace" && hasActiveWorkspace ? "workspace" : "global",
      };
      const rawMarkdown = serializeBlocksToSkillMarkdown(nextModel);
      const saved = await saveXoxSkill({
        scope: nextModel.scope === "workspace" ? "workspace" : "global",
        slug: targetSlug,
        name: nextModel.title.trim(),
        rawMarkdown,
      });
      await onSkillsRefresh();
      setEditingSkill(parseSkillToBlocks(saved));
      setIsNewSkill(false);
      showSaved(`Habilidad "${saved.name}" guardada`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo guardar la habilidad.");
    } finally {
      setSavingSkill(false);
    }
  };

  const handleToggleSkillEnabled = async (entry: XoxSkillEntry) => {
    if (entry.scope === "builtin") return;
    setErrorMsg(null);
    try {
      const model = parseSkillToBlocks(entry);
      model.enabled = !entry.enabled;
      const rawMarkdown = serializeBlocksToSkillMarkdown(model);
      await saveXoxSkill({
        scope: entry.scope === "workspace" ? "workspace" : "global",
        slug: entry.slug,
        name: model.title,
        rawMarkdown,
      });
      await onSkillsRefresh();
      showSaved(
        model.enabled
          ? `Habilidad "${entry.name}" activada`
          : `Habilidad "${entry.name}" pausada`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    }
  };

  const handleDeleteSkill = async (model: SkillBlockModel) => {
    if (model.scope === "builtin") return;
    setSavingSkill(true);
    setErrorMsg(null);
    try {
      await deleteXoxSkill(model.scope, model.slug);
      await onSkillsRefresh();
      setEditingSkill(null);
      setConfirmDeleteSlug(null);
      showSaved(`Habilidad "${model.title}" eliminada`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudo eliminar la habilidad.");
    } finally {
      setSavingSkill(false);
    }
  };

  const handleSearchOfficial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!officialQuery.trim()) return;
    setSearchingOfficial(true);
    setOfficialMessage(null);
    try {
      const res = await discoverOfficialSkills(officialQuery.trim(), 8);
      if (!res.ok) {
        setOfficialMessage(res.error || "No se encontraron habilidades.");
        setOfficialResults([]);
      } else {
        const list = res.results ?? [];
        setOfficialResults(list);
        if (list.length === 0) {
          setOfficialMessage("Sin coincidencias de publicadores oficiales verificados.");
        }
      }
    } catch (err) {
      setOfficialMessage(err instanceof Error ? err.message : "Error consultando catálogo oficial.");
    } finally {
      setSearchingOfficial(false);
    }
  };

  const handleInstallOfficial = async (cand: OfficialSkillCandidate) => {
    setInstallingId(cand.id);
    setOfficialMessage(null);
    try {
      const res = await installOfficialSkill(cand.source, cand.skill_id, "global");
      if (!res.ok) {
        setOfficialMessage(res.error || "La habilidad fue bloqueada por seguridad.");
      } else {
        await onSkillsRefresh();
        showSaved(`Habilidad oficial "${cand.name}" agregada`);
      }
    } catch (err) {
      setOfficialMessage(err instanceof Error ? err.message : "No se pudo instalar.");
    } finally {
      setInstallingId(null);
    }
  };

  const tabOrder: XoxStudioTabId[] = ["identity", "voice", "skills", "rules"];
  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabOrder.indexOf(activeTab);
    if (idx < 0) return;
    let next: XoxStudioTabId | null = null;
    if (e.key === "ArrowRight") next = tabOrder[(idx + 1) % tabOrder.length];
    else if (e.key === "ArrowLeft") next = tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length];
    else if (e.key === "Home") next = tabOrder[0];
    else if (e.key === "End") next = tabOrder[tabOrder.length - 1];
    if (next) {
      e.preventDefault();
      setActiveTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  const displayAgentName = draft.agentName.trim() || "Xox";
  const activeAccent = resolveXoxAccentPreset(draft.accentPreset);
  const activeAccentSpec = XOX_ACCENT_PRESETS[activeAccent];
  const activeVoiceName =
    voices.find((v) => v.id === voiceConfig.voiceId)?.name ?? voiceConfig.voiceId;
  const stageXoxState: XoxState =
    playback.playingMessageId === STUDIO_PREVIEW_MSG_ID
      ? "talking"
      : stageCheerState ?? xoxState;

  const handleStageXoxClick = () => {
    setStageCheerState("success");
    window.setTimeout(() => {
      setStageCheerState((curr) => (curr === "success" ? null : curr));
    }, 1500);
  };

  return (
    <aside
      aria-label={`Espacio de ${displayAgentName}`}
      className={`h-full flex flex-col rounded-2xl border border-white/[0.08] bg-[#090b10]/95 backdrop-blur-xl overflow-hidden transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Cabecera del Espacio de Xox + Ventana Escenario en vivo */}
      <header className="px-3.5 pt-2.5 pb-2.5 border-b border-white/[0.07] bg-white/[0.02] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[13.5px] font-semibold text-white truncate">
              Espacio de {displayAgentName}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[10px] text-zinc-300 inline-flex items-center gap-1 shrink-0">
              <Globe className="w-2.5 h-2.5 text-zinc-400" aria-hidden="true" />
              <span>Global</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div role="status" aria-live="polite" className="text-[11px]">
              {saveMessage && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/25 text-emerald-200">
                  <Check className="w-3 h-3" aria-hidden="true" />
                  <span className="hidden sm:inline">{saveMessage}</span>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Cerrar Espacio de ${displayAgentName}`}
              title="Cerrar editor"
              className="quick-liquid-btn w-7 h-7 rounded-full inline-flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Ventana amplia y centrada de Xox (muestra cuerpo completo, aura y chispas sin recortes) */}
        <div
          className="relative rounded-2xl border overflow-hidden min-h-[214px] sm:min-h-[244px] px-4 py-3 flex flex-col items-center justify-center transition-[border-color,background] duration-500"
          style={{
            borderColor: `${activeAccentSpec.glow}38`,
            background: `radial-gradient(85% 95% at 50% 48%, ${activeAccentSpec.glow}26 0%, ${activeAccentSpec.glow}0a 44%, rgba(6, 8, 14, 0.96) 80%)`,
          }}
        >
          {/* Barra superior flotante dentro de la ventana */}
          <div className="relative z-10 w-full flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/45 backdrop-blur-md border border-white/[0.1] text-[10.5px] text-zinc-100">
                <span
                  className="w-2 h-2 rounded-full transition-colors duration-500"
                  style={{ backgroundColor: activeAccentSpec.glow }}
                  aria-hidden="true"
                />
                <span>{activeAccentSpec.label}</span>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-black/35 border border-white/[0.08] text-[10.5px] text-zinc-300 truncate max-w-[190px]">
                {draft.activeRole || "Asistente Co-Constructor"}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (voiceConfig.enabled && (!inTauriVoice || modelsInstalled)) {
                  void handlePreviewVoice(voiceConfig.voiceId || "lola");
                } else {
                  setActiveTab("voice");
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/45 hover:bg-white/[0.12] border border-white/[0.1] text-[10.5px] text-zinc-200 cursor-pointer transition-colors shrink-0"
            >
              <Volume2 className="w-3 h-3 text-zinc-300" aria-hidden="true" />
              <span>
                {voiceConfig.enabled ? `Voz: ${activeVoiceName}` : "Configurar voz"}
              </span>
            </button>
          </div>

          {/* Onda expansiva centrada al cambiar el color de Xox */}
          {colorRippleSeq > 0 && (
            <span
              key={`ripple-${colorRippleSeq}`}
              aria-hidden="true"
              className="xox-window-color-ripple pointer-events-none absolute left-1/2 top-1/2 -ml-[72px] -mt-[72px] w-[144px] h-[144px] rounded-full border"
              style={{ borderColor: `${activeAccentSpec.glow}85` }}
            />
          )}

          {/* Xox completo en el centro de su ventana (sin márgenes negativos que lo recorten) */}
          <div className="xox-window-star-arrive relative z-[1] flex items-center justify-center my-0.5">
            <XoxStar
              state={stageXoxState}
              responsive
              hitArea="star"
              accentPreset={activeAccent}
              glideTrigger={glideSeq}
              glideDir="right"
              active={visible}
              className="w-[178px] h-[178px] sm:w-[202px] sm:h-[202px]"
              onClick={handleStageXoxClick}
            />
          </div>

          {/* Pie sutil dentro de la ventana */}
          <div className="relative z-10 w-full flex items-center justify-between gap-2 text-[10.5px]">
            <span className="text-zinc-300/85 truncate">
              <strong className="font-medium text-white">{displayAgentName}</strong>
              {draft.personality ? ` · ${draft.personality}` : ""}
            </span>
            <span className="text-zinc-500 shrink-0">
              Toca a {displayAgentName}
            </span>
          </div>
        </div>

        {/* Barra de pestañas en una sola fila con navegación por teclado */}
        <div className="overflow-x-auto no-scrollbar">
          <JellyPillTrack
            activeKey={activeTab}
            role="tablist"
            aria-label="Secciones de personalización del asistente"
            pillRadius="9999px"
            variant="quick"
            onKeyDown={handleTabKeyDown}
            className="inline-flex items-center p-0.5 rounded-full gap-0.5 min-w-max"
          >
            {(
              [
                { id: "identity", label: "Identidad", icon: UserCog },
                { id: "voice", label: "Voz", icon: Volume2 },
                { id: "skills", label: `Skills (${skills.length})`, icon: Zap },
                { id: "rules", label: "Reglas y Gustos", icon: ListChecks },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  id={`${uid}-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  className={`xook-jelly-tab relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white/60 ${
                    isSelected
                      ? "text-white border-b-2 border-white/70"
                      : "text-zinc-300/80 hover:text-white border-b-2 border-transparent"
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </JellyPillTrack>
        </div>
      </header>

      {/* Banner de error global del panel */}
      {errorMsg && (
        <div
          role="alert"
          className="mx-3.5 mt-2.5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-start justify-between gap-2 text-[11.5px] text-rose-100 shrink-0"
        >
          <span className="inline-flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            aria-label="Cerrar aviso"
            className="text-rose-200/80 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Contenido scrollable del panel activo */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3.5 space-y-4">
        {/* =================================================================== */}
        {/* TAB 1: IDENTIDAD Y PROMPT INICIAL GLOBAL                            */}
        {/* =================================================================== */}
        {activeTab === "identity" && (
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-identity`}
            className="space-y-4"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveGlobalProfile();
              }}
              className="space-y-4"
            >
              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-agent-name`}
                      className="block text-[11.5px] font-medium text-zinc-200"
                    >
                      Nombre del asistente
                    </label>
                    <input
                      id={`${uid}-agent-name`}
                      name="agentName"
                      type="text"
                      maxLength={40}
                      required
                      value={draft.agentName}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, agentName: e.target.value }))
                      }
                      placeholder="Ej. Xox, Maya, Atlas..."
                      className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-active-role`}
                      className="block text-[11.5px] font-medium text-zinc-200"
                    >
                      Rol principal
                    </label>
                    <input
                      id={`${uid}-active-role`}
                      name="activeRole"
                      type="text"
                      maxLength={80}
                      value={draft.activeRole}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, activeRole: e.target.value }))
                      }
                      placeholder="Ej. Asistente Co-Constructor"
                      className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                    />
                  </div>
                </div>

                {/* Color visual de la estrella */}
                <fieldset className="space-y-1.5">
                  <legend className="text-[11.5px] font-medium text-zinc-200">
                    Aura y color de {displayAgentName}
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(XOX_ACCENT_PRESETS) as XoxAccentPreset[]).map((key) => {
                      const preset = XOX_ACCENT_PRESETS[key];
                      const selected = activeAccent === key;
                      return (
                        <label
                          key={key}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] cursor-pointer transition-all ${
                            selected
                              ? "bg-white/[0.12] border-white/[0.28] text-white font-medium"
                              : "bg-[#07080b] border-white/[0.08] text-zinc-300 hover:bg-white/[0.05]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="accentPreset"
                            value={key}
                            checked={selected}
                            onChange={() => {
                              setDraft((p) => ({ ...p, accentPreset: key }));
                              setColorRippleSeq((n) => n + 1);
                              onPreviewAccentChange?.(key);
                            }}
                            className="sr-only"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: preset.glow }}
                            aria-hidden="true"
                          />
                          <span>{preset.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </section>

              {/* Personalidad y Prompt Inicial */}
              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-3">
                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-personality`}
                    className="block text-[11.5px] font-medium text-zinc-200"
                  >
                    Cómo quieres que sea su carácter
                  </label>
                  <input
                    id={`${uid}-personality`}
                    name="personality"
                    type="text"
                    maxLength={240}
                    value={draft.personality}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, personality: e.target.value }))
                    }
                    placeholder="Ej. Cercano, claro, práctico y con ejemplos simples"
                    className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] font-medium text-zinc-300">
                    Estilo de respuesta (toca para activar o quitar)
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set([...TONE_SUGGESTIONS, ...draft.toneTags])).map((tag) => {
                      const active = draft.toneTags.some(
                        (t) => t.toLowerCase() === tag.toLowerCase()
                      );
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleToneTag(tag)}
                          className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
                            active
                              ? "bg-white text-zinc-950 border-white font-medium"
                              : "bg-[#07080b] text-zinc-300 border-white/[0.09] hover:bg-white/[0.06]"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    <input
                      type="text"
                      value={customToneInput}
                      onChange={(e) => setCustomToneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          addCustomToneTag();
                        }
                      }}
                      placeholder="Agregar otro estilo (ej. Formal, Divertido)"
                      aria-label="Agregar estilo personalizado"
                      className="flex-1 min-h-[30px] px-2.5 py-1 rounded-lg bg-[#07080b] border border-white/[0.08] text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.22] select-text"
                    />
                    <button
                      type="button"
                      onClick={addCustomToneTag}
                      disabled={!customToneInput.trim()}
                      className="min-h-[30px] px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.1] text-[11px] text-white disabled:opacity-40 cursor-pointer"
                    >
                      Agregar
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-initial-instructions`}
                    className="block text-[11.5px] font-medium text-zinc-200"
                  >
                    Instrucciones iniciales globales (cómo quieres que piense siempre)
                  </label>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Este bloque funciona como tu indicación inicial en cualquier espacio de trabajo.
                  </p>
                  <textarea
                    id={`${uid}-initial-instructions`}
                    name="initialInstructions"
                    rows={4}
                    maxLength={3000}
                    value={draft.initialInstructions}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, initialInstructions: e.target.value }))
                    }
                    placeholder={`Ej. Cuando te pregunte algo complejo, explícamelo primero con palabras sencillas como para alguien que no es programador, y luego dame 3 pasos concretos.`}
                    className="w-full px-3 py-2 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] leading-relaxed select-text"
                  />
                </div>
              </section>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                {onAskXoxCustomize && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskXoxCustomize(
                        `Ayúdame a personalizar tu nombre, personalidad e instrucciones iniciales según cómo trabajo.`
                      )
                    }
                    className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.09] text-[11px] text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Pedirle ayuda a {displayAgentName}</span>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={savingProfile || !profileDirty}
                  className={`min-h-[34px] px-4 py-1.5 rounded-xl text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ml-auto ${
                    profileDirty
                      ? "bg-white text-zinc-950 hover:bg-zinc-200"
                      : "bg-white/[0.07] text-zinc-300 border border-white/[0.09]"
                  }`}
                >
                  {savingProfile ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{savingProfile ? "Guardando..." : "Guardar identidad"}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: VOZ LOCAL DE XOX                                             */}
        {/* =================================================================== */}
        {activeTab === "voice" && (
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-voice`}
            className="space-y-3.5"
          >
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                    {voiceConfig.enabled ? (
                      <Volume2 className="w-4 h-4 text-emerald-200" aria-hidden="true" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[12.5px] font-semibold text-white">
                        Voz de {displayAgentName}
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-zinc-300">
                        {!voiceConfig.enabled
                          ? "Apagada · 0 MB RAM"
                          : workerRunning
                            ? `Activa · ~${Math.round(workerRssMb)} MB`
                            : "Lista en reposo"}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Se genera localmente en tu equipo sin enviar audio a internet.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-label={`Activar voz de ${displayAgentName}`}
                  aria-checked={voiceConfig.enabled}
                  disabled={savingVoice || downloadingVoice}
                  onClick={() => void handleToggleVoiceEnabled(!voiceConfig.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
                    voiceConfig.enabled
                      ? "bg-emerald-500/35 border-emerald-300/40"
                      : "bg-white/[0.08] border-white/[0.14]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      voiceConfig.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {(voiceError || playback.error) && (
                <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-start gap-2 text-[11px] text-rose-100">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{voiceError || playback.error}</span>
                </div>
              )}

              <div className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-white">
                    Hablar automáticamente al responder
                  </div>
                  <p className="text-[10.5px] text-zinc-400">
                    Lee sus respuestas frase por frase en cuanto escribe.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Hablar automáticamente al responder"
                  aria-checked={voiceConfig.enabled && voiceConfig.autoPlay}
                  disabled={savingVoice || downloadingVoice}
                  onClick={() =>
                    void handleUpdateVoice({
                      enabled: true,
                      autoPlay: !(voiceConfig.enabled && voiceConfig.autoPlay),
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
                    voiceConfig.enabled && voiceConfig.autoPlay
                      ? "bg-indigo-400/50 border-indigo-300/50"
                      : "bg-white/[0.07] border-white/[0.12]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      voiceConfig.enabled && voiceConfig.autoPlay ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {inTauriVoice && downloadingVoice ? (
                <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-indigo-100">
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      <span>{downloadProgress?.label || "Descargando voces..."}</span>
                    </span>
                    <span className="tabular-nums">{Math.round(downloadProgress?.progress ?? 0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-400 transition-all"
                      style={{ width: `${Math.min(100, Math.max(3, downloadProgress?.progress ?? 3))}%` }}
                    />
                  </div>
                </div>
              ) : inTauriVoice && !modelsInstalled ? (
                <div className="rounded-xl border border-white/[0.08] bg-black/25 p-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-300">
                    Falta descargar el paquete local (~131 MB) para escuchar voces.
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDownloadVoices()}
                    className="quick-liquid-chip-active px-3 py-1 rounded-lg text-[11px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span>Descargar voces</span>
                  </button>
                </div>
              ) : null}
            </section>

            {/* Catálogo de voces */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-zinc-100">
                  Elige qué voz tiene {displayAgentName}
                </h3>
                {workerRunning && (
                  <button
                    type="button"
                    onClick={() => void unloadTtsWorker().then(onTtsStatusChanged).catch(() => {})}
                    className="text-[10.5px] text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Liberar RAM
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {voices.map((voice) => {
                  const selected = voiceConfig.voiceId === voice.id;
                  const isLoading =
                    playback.loadingMessageId === STUDIO_PREVIEW_MSG_ID &&
                    previewVoiceId === voice.id;
                  const isPlaying =
                    playback.playingMessageId === STUDIO_PREVIEW_MSG_ID &&
                    previewVoiceId === voice.id;
                  return (
                    <div
                      key={voice.id}
                      onClick={() => {
                        if (!savingVoice && !downloadingVoice) {
                          void handleUpdateVoice({ voiceId: voice.id });
                        }
                      }}
                      className={`quick-liquid-option rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer transition-all ${
                        selected ? "is-selected text-white" : "text-zinc-200/90"
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-medium text-white">{voice.name}</span>
                          <span className="px-1.5 py-0.2 rounded bg-white/[0.06] border border-white/[0.08] text-[9.5px] text-zinc-300">
                            {voice.gender}
                          </span>
                        </div>
                        <p className="text-[10.5px] text-zinc-400 truncate">{voice.description}</p>
                      </div>

                      <button
                        type="button"
                        disabled={downloadingVoice || (!modelsInstalled && inTauriVoice)}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePreviewVoice(voice.id);
                        }}
                        className={`quick-liquid-btn px-2 py-1 rounded-lg text-[10.5px] inline-flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-40 ${
                          isPlaying ? "text-emerald-200" : "text-zinc-100"
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : isPlaying ? (
                          <Square className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        ) : (
                          <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        )}
                        <span>{isPlaying ? "Parar" : "Probar"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Velocidad */}
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11.5px]">
                <label htmlFor={`${uid}-voice-speed`} className="font-medium text-zinc-200">
                  Velocidad al hablar
                </label>
                <span className="tabular-nums font-mono text-zinc-300">
                  {voiceConfig.speed.toFixed(2)}x
                </span>
              </div>
              <input
                id={`${uid}-voice-speed`}
                type="range"
                min={0.85}
                max={1.25}
                step={0.05}
                value={voiceConfig.speed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  ttsPlayer.setSpeed(v);
                  void handleUpdateVoice({ speed: v });
                }}
                className="w-full accent-indigo-300 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-zinc-400">
                <button type="button" onClick={() => void handleUpdateVoice({ speed: 0.9 })} className="hover:text-white cursor-pointer">
                  Pausada (0.9x)
                </button>
                <button type="button" onClick={() => void handleUpdateVoice({ speed: 1.0 })} className="hover:text-white cursor-pointer">
                  Natural (1.0x)
                </button>
                <button type="button" onClick={() => void handleUpdateVoice({ speed: 1.15 })} className="hover:text-white cursor-pointer">
                  Ágil (1.15x)
                </button>
              </div>

              {inTauriVoice && modelsInstalled && (
                <div className="pt-2 border-t border-white/[0.06] flex justify-end text-[10.5px]">
                  {confirmDeleteModels ? (
                    <span className="inline-flex items-center gap-2 text-rose-200">
                      <span>¿Borrar paquete de voz local?</span>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteTtsModels()
                            .then((st) => {
                              onTtsStatusChanged(st);
                              setConfirmDeleteModels(false);
                            })
                            .catch((err) => setVoiceError(cleanTtsErrorMessage(err)))
                        }
                        className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-400/30 text-rose-100 cursor-pointer"
                      >
                        Sí, borrar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteModels(false)}
                        className="text-zinc-300 hover:text-white cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteModels(true)}
                      className="text-zinc-500 hover:text-rose-200 cursor-pointer"
                    >
                      Eliminar archivos de voz locales
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: SKILLS / HABILIDADES POR BLOQUES DE TEXTO                    */}
        {/* =================================================================== */}
        {activeTab === "skills" && (
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-skills`}
            className="space-y-3.5"
          >
            {editingSkill ? (
              /* --- Vista Editor de Bloques para una Skill --- */
              <form onSubmit={handleSaveSkillBlocks} className="space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSkill(null);
                      setIsNewSkill(false);
                      setConfirmDeleteSlug(null);
                    }}
                    className="inline-flex items-center gap-1 text-[11.5px] text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    <span>Volver a habilidades</span>
                  </button>

                  {editingSkill.scope !== "builtin" && !isNewSkill && (
                    confirmDeleteSlug === editingSkill.slug ? (
                      <div className="inline-flex items-center gap-1.5 text-[11px]">
                        <span className="text-rose-200">¿Eliminar?</span>
                        <button
                          type="button"
                          disabled={savingSkill}
                          onClick={() => void handleDeleteSkill(editingSkill)}
                          className="px-2 py-0.5 rounded-lg bg-rose-500/25 border border-rose-400/40 text-rose-100 cursor-pointer"
                        >
                          Sí, borrar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSlug(null)}
                          className="px-2 py-0.5 rounded-lg bg-white/[0.06] text-zinc-300 cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSlug(editingSkill.slug)}
                        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-200 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Eliminar</span>
                      </button>
                    )
                  )}
                </div>

                {editingSkill.scope === "builtin" && (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300">
                    Esta habilidad viene integrada en XOOK. Puedes consultarla o crear una propia personalizada.
                  </div>
                )}

                <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <label
                        htmlFor={`${uid}-skill-title`}
                        className="block text-[11.5px] font-medium text-zinc-200"
                      >
                        Nombre de la habilidad
                      </label>
                      <input
                        id={`${uid}-skill-title`}
                        type="text"
                        required
                        disabled={editingSkill.scope === "builtin"}
                        value={editingSkill.title}
                        onChange={(e) =>
                          setEditingSkill((p) => (p ? { ...p, title: e.target.value } : p))
                        }
                        placeholder="Ej. Cierre semanal, Redactor de correos..."
                        className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 select-text"
                      />
                    </div>

                    {editingSkill.scope !== "builtin" && (
                      <div className="space-y-1 shrink-0 pt-0.5">
                        <span className="block text-[11px] font-medium text-zinc-300 text-right">
                          Estado
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Habilidad activa"
                          aria-checked={editingSkill.enabled}
                          onClick={() =>
                            setEditingSkill((p) => (p ? { ...p, enabled: !p.enabled } : p))
                          }
                          className={`min-h-[34px] px-2.5 rounded-xl border text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            editingSkill.enabled
                              ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                              : "bg-white/[0.04] border-white/[0.1] text-zinc-400"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              editingSkill.enabled ? "bg-emerald-300" : "bg-zinc-500"
                            }`}
                          />
                          <span>{editingSkill.enabled ? "Activa" : "Pausada"}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-skill-desc`}
                      className="block text-[11.5px] font-medium text-zinc-200"
                    >
                      Para qué sirve (en una frase simple)
                    </label>
                    <input
                      id={`${uid}-skill-desc`}
                      type="text"
                      disabled={editingSkill.scope === "builtin"}
                      value={editingSkill.description}
                      onChange={(e) =>
                        setEditingSkill((p) => (p ? { ...p, description: e.target.value } : p))
                      }
                      placeholder="Ej. Ayuda a revisar facturas y detectar precios repetidos."
                      className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 select-text"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-skill-scope`}
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Dónde se usa
                      </label>
                      <select
                        id={`${uid}-skill-scope`}
                        disabled={editingSkill.scope === "builtin" || !isNewSkill}
                        value={editingSkill.scope}
                        onChange={(e) =>
                          setEditingSkill((p) =>
                            p
                              ? {
                                  ...p,
                                  scope: e.target.value === "workspace" ? "workspace" : "global",
                                }
                              : p
                          )
                        }
                        className="w-full min-h-[32px] px-2.5 py-1 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 disabled:opacity-60"
                      >
                        <option value="global">Global (todos tus espacios)</option>
                        {hasActiveWorkspace && (
                          <option value="workspace">
                            Solo en {activeWorkspaceName || "este espacio"}
                          </option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-skill-domain`}
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Categoría
                      </label>
                      <select
                        id={`${uid}-skill-domain`}
                        disabled={editingSkill.scope === "builtin"}
                        value={editingSkill.domain}
                        onChange={(e) =>
                          setEditingSkill((p) => (p ? { ...p, domain: e.target.value } : p))
                        }
                        className="w-full min-h-[32px] px-2.5 py-1 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 disabled:opacity-60"
                      >
                        {SKILL_DOMAIN_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                {/* Bloques de texto amigables */}
                <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-4">
                  <EditableTextBlockList
                    idPrefix={`${uid}-skill-steps`}
                    label="Pasos que debe seguir"
                    helperText={`Qué hace ${displayAgentName} paso a paso cuando usa esta habilidad.`}
                    items={editingSkill.steps}
                    disabled={editingSkill.scope === "builtin"}
                    placeholder="Ej. Leer el documento completo primero"
                    onChange={(next) =>
                      setEditingSkill((p) => (p ? { ...p, steps: next } : p))
                    }
                  />

                  <EditableTextBlockList
                    idPrefix={`${uid}-skill-donts`}
                    label="Qué debe evitar"
                    helperText="Límites claros o errores que nunca debe cometer."
                    items={editingSkill.donts}
                    disabled={editingSkill.scope === "builtin"}
                    placeholder="Ej. No inventar precios si faltan en el archivo"
                    onChange={(next) =>
                      setEditingSkill((p) => (p ? { ...p, donts: next } : p))
                    }
                  />

                  <EditableTextBlockList
                    idPrefix={`${uid}-skill-prefs`}
                    label="Preferencias de estilo para esta tarea"
                    items={editingSkill.prefs}
                    disabled={editingSkill.scope === "builtin"}
                    placeholder="Ej. Entregar tabla corta al final"
                    onChange={(next) =>
                      setEditingSkill((p) => (p ? { ...p, prefs: next } : p))
                    }
                  />

                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-skill-notes`}
                      className="block text-[11.5px] font-medium text-zinc-200"
                    >
                      Indicaciones adicionales (texto libre)
                    </label>
                    <textarea
                      id={`${uid}-skill-notes`}
                      rows={3}
                      disabled={editingSkill.scope === "builtin"}
                      value={editingSkill.instructions}
                      onChange={(e) =>
                        setEditingSkill((p) => (p ? { ...p, instructions: e.target.value } : p))
                      }
                      placeholder="Cualquier detalle extra, formato o ejemplo de cómo te gustaría recibir el resultado..."
                      className="w-full px-3 py-2 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 leading-relaxed select-text"
                    />
                  </div>
                </section>

                {/* Vista previa opcional discreta para quien quiera ver el texto generado */}
                <div className="rounded-xl border border-white/[0.06] bg-black/20">
                  <button
                    type="button"
                    aria-expanded={showRawPreview}
                    onClick={() => setShowRawPreview((v) => !v)}
                    className="w-full px-3 py-2 flex items-center justify-between text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    <span>Vista previa de texto generado</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showRawPreview ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {showRawPreview && (
                    <pre className="px-3 pb-3 text-[10.5px] font-mono text-zinc-400 whitespace-pre-wrap overflow-x-auto border-t border-white/[0.05] pt-2 select-text">
                      {serializeBlocksToSkillMarkdown(editingSkill)}
                    </pre>
                  )}
                </div>

                {editingSkill.scope !== "builtin" && (
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSkill(null);
                        setIsNewSkill(false);
                      }}
                      className="px-3 py-1.5 rounded-xl text-[11.5px] text-zinc-300 hover:text-white cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingSkill}
                      className="min-h-[34px] px-4 py-1.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-[11.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {savingSkill ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      <span>{savingSkill ? "Guardando..." : "Guardar habilidad"}</span>
                    </button>
                  </div>
                )}
              </form>
            ) : (
              /* --- Lista visual de Skills + Plantillas + Catálogo oficial --- */
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[12.5px] font-semibold text-white">
                      Habilidades de {displayAgentName}
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Enséñale procesos con bloques simples; también puedes pedirle por chat que cree o ajuste una.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartNewSkill()}
                    className="min-h-[32px] px-3 py-1.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-[11.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Nueva habilidad</span>
                  </button>
                </div>

                {/* Plantillas rápidas para usuarios normales */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] text-zinc-400 mr-1">Empezar rápido:</span>
                  {SKILL_STARTER_TEMPLATES.map((tpl, idx) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleStartNewSkill(idx)}
                      className="px-2.5 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[10.5px] text-zinc-200 cursor-pointer transition-colors"
                    >
                      + {tpl.label}
                    </button>
                  ))}
                </div>

                {/* Lista de habilidades instaladas/creadas */}
                {skills.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] p-5 text-center space-y-2">
                    <Sparkles className="w-5 h-5 text-zinc-400 mx-auto" aria-hidden="true" />
                    <p className="text-[12px] font-medium text-zinc-200">
                      Aún no agregas habilidades personalizadas
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      Crea una con bloques simples o dile a {displayAgentName} en el chat cómo quieres que trabaje.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {skills.map((entry) => {
                      const isHighlighted = highlightedSkillSlug === entry.slug;
                      const scopeLabel =
                        entry.scope === "global"
                          ? "Global"
                          : entry.scope === "workspace"
                            ? "Este espacio"
                            : "Integrada";
                      return (
                        <li
                          key={`${entry.scope}-${entry.slug}`}
                          className={`rounded-2xl border p-3 flex items-start justify-between gap-2.5 transition-colors ${
                            isHighlighted
                              ? "xook-node-highlight border"
                              : "bg-white/[0.025] border-white/[0.08] hover:border-white/[0.14]"
                          }`}
                        >
                          <div className="min-w-0 space-y-1 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[12.5px] font-medium truncate ${
                                  entry.enabled ? "text-white" : "text-zinc-400 line-through"
                                }`}
                              >
                                {entry.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[9.5px] text-zinc-300">
                                {scopeLabel}
                              </span>
                              {!entry.enabled && (
                                <span className="px-1.5 py-0.5 rounded-md bg-zinc-800 text-[9.5px] text-zinc-400">
                                  Pausada
                                </span>
                              )}
                            </div>
                            {entry.description && (
                              <p className="text-[11px] text-zinc-400 line-clamp-2 leading-snug">
                                {entry.description}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {entry.scope !== "builtin" && (
                              <button
                                type="button"
                                role="switch"
                                aria-label={`${entry.enabled ? "Pausar" : "Activar"} habilidad ${entry.name}`}
                                aria-checked={entry.enabled}
                                onClick={() => void handleToggleSkillEnabled(entry)}
                                title={entry.enabled ? "Pausar habilidad" : "Activar habilidad"}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full border transition-colors cursor-pointer ${
                                  entry.enabled
                                    ? "bg-emerald-500/35 border-emerald-300/40"
                                    : "bg-white/[0.07] border-white/[0.12]"
                                }`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                    entry.enabled ? "translate-x-4" : "translate-x-0.5"
                                  }`}
                                />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setIsNewSkill(false);
                                setShowRawPreview(false);
                                setEditingSkill(parseSkillToBlocks(entry));
                              }}
                              className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-zinc-100 cursor-pointer"
                            >
                              {entry.scope === "builtin" ? "Ver" : "Editar"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Explorador de skills oficiales verificadas */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={showOfficialHub}
                    onClick={() => setShowOfficialHub((v) => !v)}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2 text-[11.5px] font-medium text-zinc-200">
                      <Search className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                      <span>Buscar habilidades oficiales verificadas</span>
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                        showOfficialHub ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {showOfficialHub && (
                    <div className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.06] space-y-2.5">
                      <search>
                        <form onSubmit={handleSearchOfficial} className="flex gap-1.5">
                          <input
                            type="search"
                            value={officialQuery}
                            onChange={(e) => setOfficialQuery(e.target.value)}
                            placeholder="Ej. pdf, react, ventas, design..."
                            aria-label="Buscar habilidades oficiales"
                            className="flex-1 min-h-[32px] px-3 py-1 rounded-xl bg-[#07080b] border border-white/[0.09] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                          />
                          <button
                            type="submit"
                            disabled={searchingOfficial || !officialQuery.trim()}
                            className="min-h-[32px] px-3 py-1 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.1] text-[11px] font-medium text-white disabled:opacity-40 cursor-pointer shrink-0"
                          >
                            {searchingOfficial ? "Buscando..." : "Buscar"}
                          </button>
                        </form>
                      </search>

                      {officialMessage && (
                        <p className="text-[11px] text-zinc-400">{officialMessage}</p>
                      )}

                      {officialResults.length > 0 && (
                        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                          {officialResults.map((cand) => (
                            <li
                              key={cand.id}
                              className="rounded-xl bg-[#07080b] border border-white/[0.07] px-3 py-2 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="text-[11.5px] font-medium text-white truncate">
                                  {cand.name}
                                </div>
                                <div className="text-[10px] text-zinc-400 truncate">
                                  Verificado por {cand.publisher} · {cand.source}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={installingId === cand.id}
                                onClick={() => void handleInstallOfficial(cand)}
                                className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[10.5px] text-white shrink-0 cursor-pointer disabled:opacity-50"
                              >
                                {installingId === cand.id ? "Agregando..." : "Agregar"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: REGLAS GLOBALES, GUSTOS Y LÍMITES                            */}
        {/* =================================================================== */}
        {activeTab === "rules" && (
          <div
            role="tabpanel"
            aria-labelledby={`${uid}-tab-rules`}
            className="space-y-4"
          >
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 space-y-4">
              <EditableTextBlockList
                idPrefix={`${uid}-global-rules`}
                label={`Reglas obligatorias para ${displayAgentName}`}
                helperText="Instrucciones fijas que siempre debe respetar en cualquier conversación o espacio."
                items={draft.globalRules}
                placeholder="Ej. Responder siempre en español claro y directo"
                onChange={(next) => setDraft((p) => ({ ...p, globalRules: next }))}
              />

              <EditableTextBlockList
                idPrefix={`${uid}-global-likes`}
                label="Cómo te gusta recibir las respuestas"
                items={draft.likes}
                placeholder="Ej. Con ejemplos prácticos y listas cortas"
                onChange={(next) => setDraft((p) => ({ ...p, likes: next }))}
              />

              <EditableTextBlockList
                idPrefix={`${uid}-global-workflows`}
                label="Tu forma preferida de avanzar"
                items={draft.workflows}
                placeholder="Ej. Primero dime el resumen y luego pregunta si profundizamos"
                onChange={(next) => setDraft((p) => ({ ...p, workflows: next }))}
              />

              <EditableTextBlockList
                idPrefix={`${uid}-global-donts`}
                label="Qué NO debe hacer nunca"
                items={draft.donts}
                placeholder="Ej. Nunca inventar datos ni borrar archivos sin avisarme"
                onChange={(next) => setDraft((p) => ({ ...p, donts: next }))}
              />
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {onAskXoxCustomize && (
                <button
                  type="button"
                  onClick={() =>
                    onAskXoxCustomize(
                      `Quiero actualizar mis reglas globales y preferencias: `
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.09] text-[11px] text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Decírselo por chat a {displayAgentName}</span>
                </button>
              )}

              <button
                type="button"
                disabled={savingProfile || !profileDirty}
                onClick={() => void handleSaveGlobalProfile()}
                className={`min-h-[34px] px-4 py-1.5 rounded-xl text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ml-auto ${
                  profileDirty
                    ? "bg-white text-zinc-950 hover:bg-zinc-200"
                    : "bg-white/[0.07] text-zinc-300 border border-white/[0.09]"
                }`}
              >
                {savingProfile ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{savingProfile ? "Guardando..." : "Guardar reglas y gustos"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
