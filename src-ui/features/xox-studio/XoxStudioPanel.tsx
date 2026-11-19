import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RotateCcw,
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
  getXoxCosmosVars,
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
  hideStar?: boolean;
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

const ACCENT_KEYS = Object.keys(XOX_ACCENT_PRESETS) as XoxAccentPreset[];

interface DisclosureGroupProps {
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Sección plegable nativa (<details>) con marcador antes de la etiqueta y animación progresiva. */
const DisclosureGroup: React.FC<DisclosureGroupProps> = ({
  title,
  meta,
  defaultOpen = false,
  children,
  className = "",
}) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (defaultOpen && detailsRef.current) {
      detailsRef.current.open = true;
    }
    // Solo establece el estado inicial al montar para no interferir con la interacción del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <details
      ref={detailsRef}
      className={`xook-accordion rounded-xl border border-white/[0.06] bg-white/[0.018] ${className}`}
    >
      <summary className="xook-accordion-summary min-h-[40px] px-3.5 py-2.5 flex items-center justify-between gap-2.5 text-left hover:bg-white/[0.028] rounded-xl transition-colors cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:-outline-offset-2">
        <span className="inline-flex items-center gap-2 min-w-0">
          <ChevronRight
            className="xook-accordion-chevron w-3.5 h-3.5 text-zinc-400 shrink-0"
            aria-hidden="true"
          />
          <span className="text-[12px] font-medium text-zinc-200 truncate">
            {title}
          </span>
        </span>
        {meta !== undefined && meta !== null && (
          <span className="text-[10.5px] text-zinc-400 truncate max-w-[180px] shrink-0">
            {meta}
          </span>
        )}
      </summary>
      <div className="px-3.5 pb-3.5 pt-2.5 border-t border-white/[0.05] space-y-3">
        {children}
      </div>
    </details>
  );
};

interface LiquidSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  title?: string;
  onToggle: () => void;
}

/** Switch unificado Liquid Glass armonizado con el aura activa de Xox. */
const LiquidSwitch: React.FC<LiquidSwitchProps> = ({
  checked,
  disabled = false,
  label,
  title,
  onToggle,
}) => (
  <button
    type="button"
    role="switch"
    aria-label={label}
    aria-checked={checked}
    title={title}
    disabled={disabled}
    onClick={onToggle}
    className="xook-liquid-switch"
  >
    <span className="xook-liquid-switch-thumb" aria-hidden="true" />
  </button>
);

interface EditableTextBlockListProps {
  idPrefix: string;
  label: string;
  helperText?: string;
  hideHeader?: boolean;
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
  hideHeader = false,
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
    <div className="space-y-2">
      {!hideHeader && (
        <div className="flex items-baseline justify-between gap-2">
          <label
            htmlFor={`${idPrefix}-add`}
            className="block text-[11.5px] font-medium text-zinc-200"
          >
            {label}
          </label>
          <span className="text-[10px] font-mono tabular-nums text-zinc-500">
            {items.length}
          </span>
        </div>
      )}
      {helperText && (
        <p className="text-[11px] text-zinc-400 leading-snug">{helperText}</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, idx) => (
            <li
              key={`${idPrefix}-${idx}`}
              className="group flex items-center gap-1.5 rounded-xl bg-black/35 border border-white/[0.07] px-2.5 py-1.5 focus-within:border-white/[0.2]"
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0"
                aria-hidden="true"
              />
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
          aria-label={hideHeader ? label : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder={placeholder}
          enterKeyHint="done"
          className="flex-1 min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.22] select-text"
        />
        <button
          type="button"
          disabled={disabled || !draft.trim()}
          onClick={commitDraft}
          className="min-h-[34px] px-3 py-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.09] text-[11px] font-medium text-white disabled:opacity-40 cursor-pointer shrink-0 inline-flex items-center gap-1 transition-colors"
        >
          <Plus aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{addButtonLabel}</span>
        </button>
      </div>
    </div>
  );
};

type XoxAnimCatalogOption = "auto" | XoxState;

const XOX_ANIMATION_CATALOG: Array<{
  id: XoxAnimCatalogOption;
  label: string;
  detail: string;
}> = [
  { id: "auto", label: "En vivo", detail: "Sigue la actividad actual o toca a Xox" },
  { id: "idle", label: "Reposo", detail: "Respiración orgánica y mirada al cursor" },
  { id: "success", label: "Feliz", detail: "Pirueta, ojos ^^ y sonrisa cálida" },
  { id: "thinking", label: "Pensando", detail: "Anillo orbital de datos y núcleo profundo" },
  { id: "reading", label: "Leyendo", detail: "Lupa escaneando el entorno con curiosidad" },
  { id: "coding", label: "Programando", detail: "Mini-laptop editando código y terminal" },
  { id: "talking", label: "Hablando", detail: "Boca articulada con ondas armónicas de voz" },
  { id: "syncing", label: "Sincronizando", detail: "Doble aro giratorio y piruetas periódicas" },
  { id: "alert", label: "Alerta", detail: "Aviso en rojo semántico y señal '!'" },
];

export const XoxStudioPanel: React.FC<XoxStudioPanelProps> = ({
  visible = true,
  hideStar = false,
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
  const animPopoverId = `${uid}-anim-popover`;
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
  const stageCheerTimerRef = useRef<number | null>(null);
  const [catalogAnim, setCatalogAnim] = useState<XoxAnimCatalogOption>("auto");
  const [stageReplaySeq, setStageReplaySeq] = useState(0);

  // Estado del popover compacto de animaciones en el dock
  const supportsNativePopover = useMemo(
    () =>
      typeof HTMLElement !== "undefined" &&
      Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover"),
    []
  );
  const [animPopoverOpen, setAnimPopoverOpen] = useState(false);
  const animTriggerRef = useRef<HTMLButtonElement>(null);
  const animPopoverRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (stageCheerTimerRef.current) window.clearTimeout(stageCheerTimerRef.current);
    },
    []
  );

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

  // Buscador de skills oficiales verificadas
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
  const animBtnRefs = useRef<Record<XoxAnimCatalogOption, HTMLButtonElement | null>>({
    auto: null,
    idle: null,
    success: null,
    thinking: null,
    reading: null,
    coding: null,
    talking: null,
    syncing: null,
    alert: null,
  });
  const accentBtnRefs = useRef<Record<XoxAccentPreset, HTMLButtonElement | null>>({
    classic: null,
    violet: null,
    emerald: null,
    amber: null,
    rose: null,
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

  // Posicionamiento fallback del popover cuando CSS Anchor Positioning (position-area) no existe
  const positionFallbackPopover = useCallback(() => {
    const pop = animPopoverRef.current;
    const trigger = animTriggerRef.current;
    if (!pop || !trigger) return;
    const supportsAnchor =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("position-area: block-end");
    if (supportsAnchor) {
      pop.style.removeProperty("inset");
      pop.style.removeProperty("margin");
      pop.style.removeProperty("left");
      pop.style.removeProperty("top");
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const popWidth = Math.min(316, window.innerWidth - 24);
    const estHeight = pop.offsetHeight || 210;
    const left = Math.max(
      12,
      Math.min(rect.left + rect.width / 2 - popWidth / 2, window.innerWidth - popWidth - 12)
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const top =
      spaceBelow >= estHeight || rect.top < estHeight + 16
        ? Math.min(rect.bottom + 8, window.innerHeight - estHeight - 12)
        : Math.max(12, rect.top - estHeight - 8);
    pop.style.inset = "auto";
    pop.style.margin = "0";
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, []);

  useEffect(() => {
    const pop = animPopoverRef.current;
    if (!pop || !supportsNativePopover) return;

    const onBeforeToggle = (event: Event) => {
      const te = event as ToggleEvent;
      if (te.newState === "open") {
        positionFallbackPopover();
      }
    };
    const onToggle = (event: Event) => {
      const te = event as ToggleEvent;
      const isOpen = te.newState === "open";
      setAnimPopoverOpen(isOpen);
      if (isOpen) {
        requestAnimationFrame(() => positionFallbackPopover());
      }
    };

    pop.addEventListener("beforetoggle", onBeforeToggle);
    pop.addEventListener("toggle", onToggle);
    return () => {
      pop.removeEventListener("beforetoggle", onBeforeToggle);
      pop.removeEventListener("toggle", onToggle);
    };
  }, [supportsNativePopover, positionFallbackPopover]);

  // Cierra el popover al desplazarse para evitar desanclaje en motores sin CSS Anchor Positioning
  useEffect(() => {
    if (!animPopoverOpen) return;
    const scroller = scrollContainerRef.current;
    const closePopover = () => {
      const pop = animPopoverRef.current;
      if (supportsNativePopover && pop && typeof pop.hidePopover === "function") {
        try {
          pop.hidePopover();
        } catch {
          // Ignorar si ya está cerrado
        }
      } else {
        setAnimPopoverOpen(false);
      }
    };
    scroller?.addEventListener("scroll", closePopover, { passive: true });
    window.addEventListener("resize", positionFallbackPopover, { passive: true });
    return () => {
      scroller?.removeEventListener("scroll", closePopover);
      window.removeEventListener("resize", positionFallbackPopover);
    };
  }, [animPopoverOpen, supportsNativePopover, positionFallbackPopover]);

  // Cierra el popover si el panel se oculta
  useEffect(() => {
    if (!visible && animPopoverOpen) {
      const pop = animPopoverRef.current;
      if (supportsNativePopover && pop && typeof pop.hidePopover === "function") {
        try {
          pop.hidePopover();
        } catch {
          // noop
        }
      }
      setAnimPopoverOpen(false);
    }
  }, [visible, animPopoverOpen, supportsNativePopover]);

  const normalizedSavedProfile = useMemo(
    () => ({ ...DEFAULT_GLOBAL_XOX_PROFILE, ...profile }),
    [profile]
  );

  const profileDirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(normalizedSavedProfile);
  }, [draft, normalizedSavedProfile]);

  const showSaved = (msg: string) => {
    setSaveMessage(msg);
    onStatusNotice?.(msg);
    setTimeout(() => setSaveMessage((curr) => (curr === msg ? null : curr)), 2600);
  };

  const handleDiscardProfile = () => {
    setDraft(normalizedSavedProfile);
    setErrorMsg(null);
    onPreviewAccentChange?.(resolveXoxAccentPreset(normalizedSavedProfile.accentPreset));
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
  const [speedDraft, setSpeedDraft] = useState<number>(voiceConfig.speed);
  useEffect(() => {
    setSpeedDraft(voiceConfig.speed);
  }, [voiceConfig.speed]);

  const speedProgressPct = Math.max(
    0,
    Math.min(100, ((speedDraft - 0.85) / (1.25 - 0.85)) * 100)
  );
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
      setOfficialMessage(
        err instanceof Error ? err.message : "Error consultando catálogo oficial."
      );
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
    else if (e.key === "ArrowLeft")
      next = tabOrder[(idx - 1 + tabOrder.length) % tabOrder.length];
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
  const isStageVoicePlaying = playback.playingMessageId === STUDIO_PREVIEW_MSG_ID;
  const isStageVoiceLoading = playback.loadingMessageId === STUDIO_PREVIEW_MSG_ID;
  const stageXoxState: XoxState = isStageVoicePlaying
    ? "talking"
    : stageCheerState ?? (catalogAnim !== "auto" ? catalogAnim : xoxState);
  const activeCatalogMeta =
    XOX_ANIMATION_CATALOG.find((item) => item.id === catalogAnim) ??
    XOX_ANIMATION_CATALOG[0];

  const totalRulesCount =
    draft.globalRules.length +
    draft.likes.length +
    draft.workflows.length +
    draft.donts.length;

  const toneSummary =
    draft.toneTags.length === 0
      ? "Opcional"
      : draft.toneTags.length <= 2
        ? draft.toneTags.join(", ")
        : `${draft.toneTags.slice(0, 2).join(", ")} +${draft.toneTags.length - 2}`;

  const selectAccent = (key: XoxAccentPreset) => {
    setDraft((p) => ({ ...p, accentPreset: key }));
    onPreviewAccentChange?.(key);
  };

  const handleAccentKeyDown = (e: React.KeyboardEvent) => {
    const idx = ACCENT_KEYS.indexOf(activeAccent);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % ACCENT_KEYS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + ACCENT_KEYS.length) % ACCENT_KEYS.length;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const nextKey = ACCENT_KEYS[nextIdx];
      selectAccent(nextKey);
      accentBtnRefs.current[nextKey]?.focus();
    }
  };

  const handleAnimCatalogKeyDown = (e: React.KeyboardEvent) => {
    const idx = XOX_ANIMATION_CATALOG.findIndex((item) => item.id === catalogAnim);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % XOX_ANIMATION_CATALOG.length;
    else if (e.key === "ArrowLeft") {
      nextIdx = (idx - 1 + XOX_ANIMATION_CATALOG.length) % XOX_ANIMATION_CATALOG.length;
    } else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = XOX_ANIMATION_CATALOG.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const targetId = XOX_ANIMATION_CATALOG[nextIdx].id;
      setCatalogAnim(targetId);
      setStageCheerState(null);
      animBtnRefs.current[targetId]?.focus();
    }
  };

  const handleStageXoxClick = () => {
    setStageReplaySeq((n) => n + 1);
    if (catalogAnim !== "auto" && catalogAnim !== "idle") {
      return;
    }
    setStageCheerState("success");
    if (stageCheerTimerRef.current) window.clearTimeout(stageCheerTimerRef.current);
    stageCheerTimerRef.current = window.setTimeout(() => {
      setStageCheerState((curr) => (curr === "success" ? null : curr));
      stageCheerTimerRef.current = null;
    }, 1800);
  };

  const chatCustomizeHint =
    activeTab === "rules"
      ? "Quiero actualizar mis reglas globales y preferencias: "
      : `Ayúdame a personalizar tu nombre, carácter e instrucciones iniciales según cómo trabajo.`;

  return (
    <aside
      aria-label={`Espacio de ${displayAgentName}`}
      style={
        { "--xox-control-accent": activeAccentSpec.glow } as React.CSSProperties
      }
      className={`relative h-full flex flex-col rounded-2xl border border-white/[0.08] bg-[#080a0f] overflow-hidden transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Controles flotantes en esquina superior derecha: siempre accesibles sin apilar doble barra fija */}
      <div className="absolute top-2.5 right-3 z-30 flex items-center gap-1.5">
        {onAskXoxCustomize && (
          <button
            type="button"
            onClick={() => onAskXoxCustomize(chatCustomizeHint)}
            aria-label={`Personalizar por chat con ${displayAgentName}`}
            title={`Pedirle ayuda a ${displayAgentName} por chat`}
            className="quick-liquid-btn w-7 h-7 rounded-full inline-flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Cerrar Espacio de ${displayAgentName}`}
          title="Cerrar espacio"
          className="quick-liquid-btn w-7 h-7 rounded-full inline-flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Lienzo continuo: Santuario cósmico full-bleed -> pestañas -> contenido agrupado */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto scroll-smooth"
      >
        {/* =================================================================== */}
        {/* SANTUARIO VIVO DE XOX (FULL-BLEED, SIN CAJA ENCERRADA)              */}
        {/* =================================================================== */}
        <section
          id={`${uid}-xox-stage`}
          aria-label={`Escenario de ${displayAgentName}`}
          className="xook-xox-sanctuary relative px-4 pt-3 pb-4 flex flex-col items-center text-center"
          style={getXoxCosmosVars(activeAccent)}
        >
          {/* Etiqueta discreta de alcance arriba a la izquierda */}
          <div className="relative z-10 w-full flex items-center justify-start pr-20 min-h-[28px]">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-300/75">
              <Globe className="w-3 h-3 text-zinc-400/75" aria-hidden="true" />
              <span>Espacio global</span>
            </span>
          </div>

          {/* Estrella Xox protagonista en su propio espacio (oculta durante el vuelo para evitar duplicado) */}
          <div
            data-xox-stage="studio"
            className={`relative z-[1] flex items-center justify-center -my-7 sm:-my-8 ${
              hideStar ? "opacity-0 pointer-events-none" : "opacity-100"
            }`}
          >
            <XoxStar
              state={stageXoxState}
              responsive
              hitArea="star"
              accentPreset={activeAccent}
              glideTrigger={hideStar ? 0 : glideSeq}
              glideDir="right"
              summonTrigger={stageReplaySeq}
              active={visible && !hideStar}
              className="w-[228px] h-[228px] sm:w-[258px] sm:h-[258px]"
              onClick={handleStageXoxClick}
            />
          </div>

          {/* Firma centrada de Xox */}
          <div
            className="xox-studio-enter-stagger relative z-10 mt-1 flex flex-col items-center max-w-full px-2"
            style={{ animationDelay: "50ms" }}
          >
            <h2 className="text-[19px] font-semibold tracking-tight text-white leading-tight truncate max-w-full">
              {displayAgentName}
            </h2>
            <p className="text-[11.5px] text-zinc-300/80 mt-0.5 truncate max-w-[340px]">
              {draft.activeRole.trim() || "Asistente Co-Constructor"}
            </p>
          </div>

          {/* Dock discreto en el escenario: Aura + Selector de gestos (popover) + Voz */}
          <div
            className="xox-studio-enter-stagger relative z-10 mt-3.5 inline-flex items-center gap-1 p-1 rounded-full bg-black/45 backdrop-blur-xl border border-white/[0.1] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.85)] max-w-full"
            style={{ animationDelay: "90ms" }}
          >
            {/* 1. Puntos de color del Aura en vivo */}
            <div
              role="radiogroup"
              aria-label={`Aura y color de ${displayAgentName}`}
              onKeyDown={handleAccentKeyDown}
              className="inline-flex items-center gap-0.5 px-1"
            >
              {ACCENT_KEYS.map((key) => {
                const preset = XOX_ACCENT_PRESETS[key];
                const selected = activeAccent === key;
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      accentBtnRefs.current[key] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Aura ${preset.label}`}
                    title={`Aura ${preset.label}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectAccent(key)}
                    className={`w-5 h-5 rounded-full inline-flex items-center justify-center transition-transform cursor-pointer focus-visible:outline-2 focus-visible:outline-white/75 ${
                      selected ? "scale-110" : "opacity-75 hover:opacity-100 hover:scale-105"
                    }`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full transition-shadow ${
                        selected ? "ring-[1.5px] ring-white/90 ring-offset-1 ring-offset-[#0a0e1a]" : ""
                      }`}
                      style={{
                        backgroundColor: preset.glow,
                        boxShadow: selected ? `0 0 10px ${preset.glow}` : undefined,
                      }}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>

            <span className="w-px h-3.5 bg-white/[0.1] shrink-0" aria-hidden="true" />

            {/* 2. Discreto selector de animaciones en popover */}
            <button
              ref={animTriggerRef}
              type="button"
              {...(supportsNativePopover ? { popoverTarget: animPopoverId } : {})}
              aria-expanded={animPopoverOpen}
              aria-controls={animPopoverId}
              title={`Probar animaciones (${activeCatalogMeta.label})`}
              onClick={
                supportsNativePopover
                  ? undefined
                  : () => setAnimPopoverOpen((prev) => !prev)
              }
              className="h-6 px-2 rounded-full inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-white/70"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  catalogAnim === "auto" && stageXoxState !== "idle" ? "animate-pulse" : ""
                }`}
                style={{
                  backgroundColor:
                    catalogAnim === "alert" ? "#EF4444" : activeAccentSpec.glow,
                }}
                aria-hidden="true"
              />
              <span>{activeCatalogMeta.label}</span>
              <ChevronDown
                className={`w-3 h-3 text-zinc-400 transition-transform ${
                  animPopoverOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            <span className="w-px h-3.5 bg-white/[0.1] shrink-0" aria-hidden="true" />

            {/* 3. Botón sutil de prueba/acceso a voz */}
            <button
              type="button"
              onClick={() => {
                if (voiceConfig.enabled && (!inTauriVoice || modelsInstalled)) {
                  void handlePreviewVoice(voiceConfig.voiceId || "lola");
                } else {
                  setActiveTab("voice");
                }
              }}
              title={
                voiceConfig.enabled
                  ? isStageVoicePlaying
                    ? "Detener muestra de voz"
                    : `Escuchar voz ${activeVoiceName}`
                  : "Configurar voz local"
              }
              className={`h-6 px-2 rounded-full inline-flex items-center gap-1 text-[11px] transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-white/70 ${
                isStageVoicePlaying
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-zinc-200 hover:text-white hover:bg-white/[0.08]"
              }`}
            >
              {isStageVoiceLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : isStageVoicePlaying ? (
                <Square className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3 h-3 text-zinc-300" aria-hidden="true" />
              )}
              <span className="truncate max-w-[78px]">
                {voiceConfig.enabled ? activeVoiceName : "Voz"}
              </span>
            </button>
          </div>

          {/* Popover compacto bajo demanda para las 9 animaciones de Xox */}
          <div
            ref={animPopoverRef}
            id={animPopoverId}
            {...(supportsNativePopover ? { popover: "auto" } : {})}
            hidden={!supportsNativePopover && !animPopoverOpen}
            className={`xook-stage-popover w-[292px] sm:w-[316px] text-left ${
              !supportsNativePopover && animPopoverOpen
                ? "absolute left-1/2 -translate-x-1/2 top-full mt-2 z-40"
                : ""
            }`}
          >
            <div className="p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-white">
                    Gestos y estados
                  </div>
                  <p className="text-[10.5px] text-zinc-400 truncate mt-0.5">
                    {activeCatalogMeta.detail}
                  </p>
                </div>
                {catalogAnim !== "auto" && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogAnim("auto");
                      setStageCheerState(null);
                    }}
                    className="text-[10px] text-zinc-400 hover:text-white px-1.5 py-0.5 rounded-md hover:bg-white/[0.07] cursor-pointer shrink-0"
                  >
                    Volver a vivo
                  </button>
                )}
              </div>

              <div
                role="toolbar"
                aria-label={`Gestos y animaciones de ${displayAgentName}`}
                aria-controls={`${uid}-xox-stage`}
                onKeyDown={handleAnimCatalogKeyDown}
                className="grid grid-cols-3 gap-1.5"
              >
                {XOX_ANIMATION_CATALOG.map((item) => {
                  const selected = catalogAnim === item.id;
                  const isAlertOpt = item.id === "alert";
                  const isLiveActive = item.id === "auto" && stageXoxState !== "idle";
                  return (
                    <button
                      key={item.id}
                      ref={(el) => {
                        animBtnRefs.current[item.id] = el;
                      }}
                      type="button"
                      aria-pressed={selected}
                      tabIndex={selected ? 0 : -1}
                      title={item.detail}
                      onClick={() => {
                        setStageCheerState(null);
                        if (catalogAnim === item.id && item.id !== "auto") {
                          setStageReplaySeq((n) => n + 1);
                        } else {
                          setCatalogAnim(item.id);
                        }
                      }}
                      className="min-h-[28px] px-2 py-1 rounded-xl border text-[10.5px] inline-flex items-center gap-1.5 cursor-pointer transition-colors bg-white/[0.03] border-white/[0.07] text-zinc-300 hover:bg-white/[0.08] hover:text-white aria-[pressed=true]:bg-white/[0.14] aria-[pressed=true]:border-white/[0.3] aria-[pressed=true]:text-white aria-[pressed=true]:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 truncate"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isLiveActive ? "animate-pulse" : ""
                        }`}
                        style={{
                          backgroundColor: isAlertOpt
                            ? "#EF4444"
                            : selected
                              ? activeAccentSpec.glow
                              : "rgba(255,255,255,0.32)",
                        }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* =================================================================== */}
        {/* NAVEGACIÓN PRINCIPAL CENTRADA EN UNA SOLA FILA STICKY               */}
        {/* =================================================================== */}
        <div
          className="xox-studio-enter-stagger sticky top-0 z-20 px-4 py-2 bg-[#080a0f]/95 border-b border-white/[0.06] overflow-x-auto no-scrollbar"
          style={{ animationDelay: "120ms" }}
        >
          <div className="w-max mx-auto">
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
                { id: "identity", label: "Identidad", icon: UserCog, badge: null },
                { id: "voice", label: "Voz", icon: Volume2, badge: null },
                {
                  id: "skills",
                  label: "Skills",
                  icon: Zap,
                  badge: skills.length > 0 ? skills.length : null,
                },
                {
                  id: "rules",
                  label: "Reglas",
                  icon: ListChecks,
                  badge: totalRulesCount > 0 ? totalRulesCount : null,
                },
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
                  className={`xook-jelly-tab relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer shrink-0 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white/60 ${
                    isSelected
                      ? "text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {tab.badge !== null && (
                    <span className="text-[9.5px] font-mono tabular-nums text-zinc-400">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
            </JellyPillTrack>
          </div>
        </div>

        {/* Banner de error global del panel */}
        {errorMsg && (
          <div
            role="alert"
            className="mx-4 mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-start justify-between gap-2 text-[11.5px] text-rose-100"
          >
            <span className="inline-flex items-start gap-2">
              <AlertCircle
                className="w-4 h-4 text-rose-300 shrink-0 mt-0.5"
                aria-hidden="true"
              />
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

        {/* Contenido de la pestaña activa */}
        <div
          className="xox-studio-enter-stagger px-4 pt-4 pb-10 space-y-3.5"
          style={{ animationDelay: "155ms" }}
        >
          {/* ================================================================= */}
          {/* TAB 1: IDENTIDAD (ESENCIAL VISIBLE + DETALLE PLEGABLE)            */}
          {/* ================================================================= */}
          {activeTab === "identity" && (
            <div
              role="tabpanel"
              aria-labelledby={`${uid}-tab-identity`}
              className="space-y-3"
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveGlobalProfile();
                }}
                className="space-y-3"
              >
                {/* Bloque esencial: Nombre, Rol y Carácter */}
                <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-agent-name`}
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Nombre
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
                        className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor={`${uid}-active-role`}
                        className="block text-[11px] font-medium text-zinc-300"
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
                        className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor={`${uid}-personality`}
                      className="block text-[11px] font-medium text-zinc-300"
                    >
                      Carácter
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
                      placeholder="Ej. Cercano, claro, práctico y directo."
                      className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                    />
                  </div>
                </section>

                {/* Agrupación progresiva: Estilo de respuesta */}
                <DisclosureGroup title="Estilo de respuesta" meta={toneSummary}>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set([...TONE_SUGGESTIONS, ...draft.toneTags])).map(
                      (tag) => {
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
                                : "bg-black/35 text-zinc-300 border-white/[0.08] hover:bg-white/[0.06]"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      }
                    )}
                  </div>
                  <div className="flex gap-1.5">
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
                      placeholder="Otro estilo (ej. Formal, Divertido)"
                      aria-label="Agregar estilo personalizado"
                      className="flex-1 min-h-[32px] px-2.5 py-1 rounded-xl bg-black/35 border border-white/[0.08] text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.22] select-text"
                    />
                    <button
                      type="button"
                      onClick={addCustomToneTag}
                      disabled={!customToneInput.trim()}
                      className="min-h-[32px] px-3 py-1 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.09] text-[11px] text-white disabled:opacity-40 cursor-pointer"
                    >
                      Agregar
                    </button>
                  </div>
                </DisclosureGroup>

                {/* Agrupación progresiva: Instrucciones iniciales globales */}
                <DisclosureGroup
                  title="Instrucciones iniciales globales"
                  meta={draft.initialInstructions.trim() ? "Configuradas" : "Opcional"}
                >
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Funciona como tu indicación base para {displayAgentName} en cualquier espacio.
                  </p>
                  <textarea
                    id={`${uid}-initial-instructions`}
                    name="initialInstructions"
                    aria-label="Instrucciones iniciales globales"
                    rows={4}
                    maxLength={3000}
                    value={draft.initialInstructions}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, initialInstructions: e.target.value }))
                    }
                    placeholder="Ej. Cuando te pregunte algo complejo, explícamelo primero con palabras sencillas y luego dame 3 pasos concretos."
                    className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] leading-relaxed select-text"
                  />
                </DisclosureGroup>
              </form>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: VOZ LOCAL (ACTIVAR + ELEGIR VOZ / AJUSTES PLEGABLES)       */}
          {/* ================================================================= */}
          {activeTab === "voice" && (
            <div
              role="tabpanel"
              aria-labelledby={`${uid}-tab-voice`}
              className="space-y-3.5"
            >
              <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-3">
                {/* Fila principal: activar voz */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                      {voiceConfig.enabled ? (
                        <Volume2
                          className="w-4 h-4 transition-colors"
                          style={{ color: activeAccentSpec.mid }}
                          aria-hidden="true"
                        />
                      ) : (
                        <VolumeX className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[12.5px] font-semibold text-white">
                          Voz local
                        </h3>
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400">
                          {voiceConfig.enabled && (
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: activeAccentSpec.glow }}
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {!voiceConfig.enabled
                              ? "Apagada"
                              : workerRunning
                                ? "Activa"
                                : "Lista"}
                          </span>
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate">
                        Generada en tu equipo, sin enviar audio a internet.
                      </p>
                    </div>
                  </div>

                  <LiquidSwitch
                    checked={voiceConfig.enabled}
                    disabled={savingVoice || downloadingVoice}
                    label={`Activar voz de ${displayAgentName}`}
                    onToggle={() => void handleToggleVoiceEnabled(!voiceConfig.enabled)}
                  />
                </div>

                {(voiceError || playback.error) && (
                  <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-start gap-2 text-[11px] text-rose-100">
                    <AlertCircle
                      className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <span>{voiceError || playback.error}</span>
                  </div>
                )}

                {inTauriVoice && downloadingVoice ? (
                  <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-indigo-100">
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        <span>{downloadProgress?.label || "Descargando voces..."}</span>
                      </span>
                      <span className="tabular-nums">
                        {Math.round(downloadProgress?.progress ?? 0)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(3, downloadProgress?.progress ?? 3))}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : inTauriVoice && !modelsInstalled ? (
                  <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-300">
                      Descarga el paquete local (~131 MB) para escuchar voces.
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
                ) : (
                  <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11.5px] font-medium text-zinc-100">
                        Hablar automáticamente al responder
                      </div>
                      <p className="text-[10.5px] text-zinc-400">
                        Lee sus respuestas frase por frase en cuanto escribe.
                      </p>
                    </div>
                    <LiquidSwitch
                      checked={voiceConfig.enabled && voiceConfig.autoPlay}
                      disabled={savingVoice || downloadingVoice}
                      label="Hablar automáticamente al responder"
                      onToggle={() =>
                        void handleUpdateVoice({
                          enabled: true,
                          autoPlay: !(voiceConfig.enabled && voiceConfig.autoPlay),
                        })
                      }
                    />
                  </div>
                )}
              </section>

              {/* Catálogo de voces */}
              <section className="space-y-2">
                <h3 className="text-[11.5px] font-medium text-zinc-300 px-0.5">
                  Elige una voz
                </h3>
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
                            <span className="text-[12px] font-medium text-white">
                              {voice.name}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              · {voice.gender}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-zinc-400 truncate">
                            {voice.description}
                          </p>
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

              {/* Agrupación progresiva: Velocidad, memoria y archivos locales */}
              <DisclosureGroup
                title="Velocidad y ajustes locales"
                meta={
                  workerRunning
                    ? `${speedDraft.toFixed(2)}x · ~${Math.round(workerRssMb)} MB`
                    : `${speedDraft.toFixed(2)}x`
                }
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11.5px]">
                    <label htmlFor={`${uid}-voice-speed`} className="font-medium text-zinc-200">
                      Velocidad al hablar
                    </label>
                    <span className="tabular-nums font-mono text-[11px] px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.07] text-zinc-200">
                      {speedDraft.toFixed(2)}x
                    </span>
                  </div>

                  <input
                    id={`${uid}-voice-speed`}
                    type="range"
                    min={0.85}
                    max={1.25}
                    step={0.05}
                    value={speedDraft}
                    style={
                      {
                        "--range-progress": `${speedProgressPct}%`,
                      } as React.CSSProperties
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSpeedDraft(v);
                      ttsPlayer.setSpeed(v);
                      void handleUpdateVoice({ speed: v });
                    }}
                    className="xook-liquid-range"
                  />

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        { label: "Pausada", value: 0.9 },
                        { label: "Natural", value: 1.0 },
                        { label: "Ágil", value: 1.15 },
                      ] as const
                    ).map((preset) => {
                      const isActive = Math.abs(speedDraft - preset.value) < 0.01;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => {
                            setSpeedDraft(preset.value);
                            ttsPlayer.setSpeed(preset.value);
                            void handleUpdateVoice({ speed: preset.value });
                          }}
                          className={`px-2.5 py-1 rounded-full text-[10.5px] border transition-colors cursor-pointer ${
                            isActive
                              ? "bg-white/[0.12] border-white/[0.24] text-white font-medium"
                              : "bg-white/[0.025] border-white/[0.07] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]"
                          }`}
                        >
                          {preset.label} · {preset.value.toFixed(preset.value === 1.15 ? 2 : 1)}x
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(workerRunning || (inTauriVoice && modelsInstalled)) && (
                  <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <span>
                        {workerRunning
                          ? `Motor activo (~${Math.round(workerRssMb)} MB RAM)`
                          : "Motor en reposo (0 MB RAM)"}
                      </span>
                      {workerRunning && (
                        <button
                          type="button"
                          onClick={() =>
                            void unloadTtsWorker().then(onTtsStatusChanged).catch(() => {})
                          }
                          className="px-2 py-0.5 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 hover:text-white transition-colors cursor-pointer"
                        >
                          Liberar RAM
                        </button>
                      )}
                    </div>

                    {inTauriVoice && modelsInstalled && (
                      confirmDeleteModels ? (
                        <span className="inline-flex items-center gap-2 text-rose-200">
                          <span>¿Borrar paquete local?</span>
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
                          Eliminar archivos locales
                        </button>
                      )
                    )}
                  </div>
                )}
              </DisclosureGroup>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: SKILLS / HABILIDADES POR BLOQUES DE TEXTO                  */}
          {/* ================================================================= */}
          {activeTab === "skills" && (
            <div
              role="tabpanel"
              aria-labelledby={`${uid}-tab-skills`}
              className="space-y-3"
            >
              {editingSkill ? (
                /* --- Vista Editor de Bloques para una Skill --- */
                <form onSubmit={handleSaveSkillBlocks} className="space-y-3">
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

                  {/* Datos básicos de la skill */}
                  <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-1">
                        <label
                          htmlFor={`${uid}-skill-title`}
                          className="block text-[11px] font-medium text-zinc-300"
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
                          className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 select-text"
                        />
                      </div>

                      {editingSkill.scope !== "builtin" && (
                        <div className="space-y-1 shrink-0">
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
                        className="block text-[11px] font-medium text-zinc-300"
                      >
                        Para qué sirve
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
                        className="w-full min-h-[34px] px-3 py-1.5 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 select-text"
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
                                    scope:
                                      e.target.value === "workspace" ? "workspace" : "global",
                                  }
                                : p
                            )
                          }
                          className="w-full min-h-[32px] px-2.5 py-1 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-zinc-100 disabled:opacity-60"
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
                          className="w-full min-h-[32px] px-2.5 py-1 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-zinc-100 disabled:opacity-60"
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

                  {/* Pasos principales siempre visibles */}
                  <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
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
                  </section>

                  {/* Detalles secundarios agrupados */}
                  <DisclosureGroup
                    title="Qué debe evitar"
                    meta={editingSkill.donts.length > 0 ? `${editingSkill.donts.length}` : "Opcional"}
                    defaultOpen={editingSkill.donts.length > 0}
                  >
                    <EditableTextBlockList
                      idPrefix={`${uid}-skill-donts`}
                      label="Qué debe evitar"
                      hideHeader
                      helperText="Límites claros o errores que nunca debe cometer."
                      items={editingSkill.donts}
                      disabled={editingSkill.scope === "builtin"}
                      placeholder="Ej. No inventar precios si faltan en el archivo"
                      onChange={(next) =>
                        setEditingSkill((p) => (p ? { ...p, donts: next } : p))
                      }
                    />
                  </DisclosureGroup>

                  <DisclosureGroup
                    title="Preferencias y notas adicionales"
                    meta={
                      editingSkill.prefs.length > 0 || editingSkill.instructions.trim()
                        ? "Configuradas"
                        : "Opcional"
                    }
                    defaultOpen={
                      editingSkill.prefs.length > 0 || Boolean(editingSkill.instructions.trim())
                    }
                  >
                    <EditableTextBlockList
                      idPrefix={`${uid}-skill-prefs`}
                      label="Preferencias de estilo"
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
                        Indicaciones adicionales
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
                        className="w-full px-3 py-2 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] disabled:opacity-60 leading-relaxed select-text"
                      />
                    </div>
                  </DisclosureGroup>

                  <DisclosureGroup title="Vista previa de texto generado">
                    <pre className="text-[10.5px] font-mono text-zinc-400 whitespace-pre-wrap overflow-x-auto select-text">
                      {serializeBlocksToSkillMarkdown(editingSkill)}
                    </pre>
                  </DisclosureGroup>

                  {editingSkill.scope !== "builtin" && (
                    <div className="flex justify-end gap-2 pt-1">
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
                /* --- Lista visual limpia de Skills + descubrimiento plegable --- */
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[12.5px] font-semibold text-white">
                        Habilidades de {displayAgentName}
                      </h3>
                      <p className="text-[11px] text-zinc-400 truncate">
                        Procesos reutilizables con bloques simples.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStartNewSkill()}
                      className="min-h-[32px] px-3 py-1.5 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-[11.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Nueva</span>
                    </button>
                  </div>

                  {skills.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.015] p-5 text-center space-y-3">
                      <Sparkles className="w-5 h-5 text-zinc-400 mx-auto" aria-hidden="true" />
                      <div className="space-y-1">
                        <p className="text-[12px] font-medium text-zinc-200">
                          Aún no agregas habilidades personalizadas
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          Empieza con una plantilla rápida o crea una desde cero.
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                        {SKILL_STARTER_TEMPLATES.map((tpl, idx) => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => handleStartNewSkill(idx)}
                            className="px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.09] text-[10.5px] text-zinc-200 cursor-pointer transition-colors"
                          >
                            + {tpl.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
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
                                  : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.13]"
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
                                  <span className="text-[10px] text-zinc-500">
                                    · {scopeLabel}
                                  </span>
                                  {!entry.enabled && (
                                    <span className="px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-[9.5px] text-zinc-400">
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

                              <div className="flex items-center gap-2 shrink-0">
                                {entry.scope !== "builtin" && (
                                  <LiquidSwitch
                                    checked={entry.enabled}
                                    label={`${entry.enabled ? "Pausar" : "Activar"} habilidad ${entry.name}`}
                                    title={entry.enabled ? "Pausar habilidad" : "Activar habilidad"}
                                    onToggle={() => void handleToggleSkillEnabled(entry)}
                                  />
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsNewSkill(false);
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

                      {/* Plantillas rápidas agrupadas para no recargar la vista */}
                      <DisclosureGroup
                        title="Plantillas rápidas"
                        meta={`${SKILL_STARTER_TEMPLATES.length} bases`}
                      >
                        <div className="flex flex-wrap gap-1.5">
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
                      </DisclosureGroup>
                    </>
                  )}

                  {/* Explorador de skills oficiales verificadas */}
                  <DisclosureGroup
                    title="Explorar habilidades oficiales"
                    meta="Verificadas"
                  >
                    <search>
                      <form onSubmit={handleSearchOfficial} className="flex gap-1.5">
                        <div className="relative flex-1">
                          <Search
                            className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                            aria-hidden="true"
                          />
                          <input
                            type="search"
                            value={officialQuery}
                            onChange={(e) => setOfficialQuery(e.target.value)}
                            placeholder="Ej. pdf, react, ventas, design..."
                            aria-label="Buscar habilidades oficiales"
                            className="w-full min-h-[32px] pl-8 pr-3 py-1 rounded-xl bg-black/35 border border-white/[0.08] text-[11.5px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
                          />
                        </div>
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
                            className="rounded-xl bg-black/35 border border-white/[0.07] px-3 py-2 flex items-center justify-between gap-2"
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
                  </DisclosureGroup>
                </>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: REGLAS GLOBALES Y PREFERENCIAS (ACORDEÓN PROGRESIVO)       */}
          {/* ================================================================= */}
          {activeTab === "rules" && (
            <div
              role="tabpanel"
              aria-labelledby={`${uid}-tab-rules`}
              className="space-y-2.5"
            >
              <p className="text-[11px] text-zinc-400 px-0.5">
                Límites y preferencias fijas que {displayAgentName} respeta en todos tus espacios.
              </p>

              <DisclosureGroup
                title="Reglas obligatorias"
                meta={draft.globalRules.length > 0 ? `${draft.globalRules.length}` : "Vacío"}
                defaultOpen
              >
                <EditableTextBlockList
                  idPrefix={`${uid}-global-rules`}
                  label={`Reglas obligatorias para ${displayAgentName}`}
                  hideHeader
                  items={draft.globalRules}
                  placeholder="Ej. Responder siempre en español claro y directo"
                  onChange={(next) => setDraft((p) => ({ ...p, globalRules: next }))}
                />
              </DisclosureGroup>

              <DisclosureGroup
                title="Cómo te gusta recibir respuestas"
                meta={draft.likes.length > 0 ? `${draft.likes.length}` : "Vacío"}
                defaultOpen={draft.likes.length > 0}
              >
                <EditableTextBlockList
                  idPrefix={`${uid}-global-likes`}
                  label="Cómo te gusta recibir las respuestas"
                  hideHeader
                  items={draft.likes}
                  placeholder="Ej. Con ejemplos prácticos y listas cortas"
                  onChange={(next) => setDraft((p) => ({ ...p, likes: next }))}
                />
              </DisclosureGroup>

              <DisclosureGroup
                title="Tu forma preferida de avanzar"
                meta={draft.workflows.length > 0 ? `${draft.workflows.length}` : "Vacío"}
                defaultOpen={draft.workflows.length > 0}
              >
                <EditableTextBlockList
                  idPrefix={`${uid}-global-workflows`}
                  label="Tu forma preferida de avanzar"
                  hideHeader
                  items={draft.workflows}
                  placeholder="Ej. Primero dime el resumen y luego pregunta si profundizamos"
                  onChange={(next) => setDraft((p) => ({ ...p, workflows: next }))}
                />
              </DisclosureGroup>

              <DisclosureGroup
                title="Qué NO debe hacer nunca"
                meta={draft.donts.length > 0 ? `${draft.donts.length}` : "Vacío"}
                defaultOpen={draft.donts.length > 0}
              >
                <EditableTextBlockList
                  idPrefix={`${uid}-global-donts`}
                  label="Qué NO debe hacer nunca"
                  hideHeader
                  items={draft.donts}
                  placeholder="Ej. Nunca inventar datos ni borrar archivos sin avisarme"
                  onChange={(next) => setDraft((p) => ({ ...p, donts: next }))}
                />
              </DisclosureGroup>
            </div>
          )}
        </div>
      </div>

      {/* Confirmación discreta flotante cuando se guardan cambios */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-30"
      >
        {saveMessage && !profileDirty && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0d1414]/95 border border-emerald-400/30 text-[11px] text-emerald-200 shadow-lg backdrop-blur-md">
            <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{saveMessage}</span>
          </span>
        )}
      </div>

      {/* Barra unificada de guardado: aparece solo cuando hay cambios pendientes */}
      {profileDirty && (
        <div className="shrink-0 px-4 py-2.5 border-t border-white/[0.08] bg-[#0b0e16]/95 backdrop-blur-xl flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-[11.5px] text-zinc-200 min-w-0">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: activeAccentSpec.glow }}
              aria-hidden="true"
            />
            <span className="truncate">Cambios sin guardar</span>
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={savingProfile}
              onClick={handleDiscardProfile}
              className="min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] text-zinc-300 hover:text-white hover:bg-white/[0.07] inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-45"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Descartar</span>
            </button>

            <button
              type="button"
              disabled={savingProfile}
              onClick={() => void handleSaveGlobalProfile()}
              className="min-h-[30px] px-3.5 py-1 rounded-xl bg-white text-zinc-950 hover:bg-zinc-200 text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingProfile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{savingProfile ? "Guardando..." : "Guardar"}</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
