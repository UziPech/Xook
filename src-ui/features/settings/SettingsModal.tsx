import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Download,
  Eye,
  KeyRound,
  Loader2,
  Monitor,
  PauseCircle,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  UserCheck,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { JellyPillTrack } from "../../components/JellyPillTrack";
import { XoxSilhouetteIcon } from "../../components/XoxStar";
import { LiquidGlassBackdrop } from "../../components/LiquidGlassBackdrop";
import { waitTopLayerAnimations } from "../../utils/topLayerDialog";
import {
  AI_PROVIDER_LIST,
  AiConfigStatus,
  formatModelDisplay,
  getProviderSpec,
  type OpenRouterModelOption,
} from "../ai-service/aiClient";
import { normalizeProviderIdClient, ProviderIcon } from "../ai-service/ProviderIcon";
import type { OpenRouterSettingsTab } from "../ai-service/OpenRouterSettingsModal";
import {
  cleanTtsErrorMessage,
} from "./settingsHelpers";
import {
  clearScreenMemory,
  getScreenReaderStatus,
  openScreenPermissionSettings,
  requestScreenPermission,
  setScreenReaderConfig,
  type ScreenReaderStatus,
} from "../workspace-store/workspaceApi";
import type { LocalUserProfile } from "../workspace-store/localStore";
import { WorkspacePermissionsSection } from "../workspace-store/WorkspacePermissionsSection";
import {
  deleteTtsModels,
  downloadTtsModels,
  getTtsStatus,
  isTauriTtsRuntime,
  saveTtsConfig,
  subscribeTtsEvents,
  ttsPlayer,
  unloadTtsWorker,
  type TtsDownloadProgress,
  type TtsPlaybackSnapshot,
  type TtsStatus,
} from "../tts-voice/ttsClient";

export type SettingsTabId = "voice" | "screen" | "ai" | "account";

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTabId;
  onClose: () => void;
  ttsStatus: TtsStatus | null;
  onTtsStatusChanged: (next: TtsStatus) => void;
  aiConfig: AiConfigStatus;
  modelCatalog: OpenRouterModelOption[];
  localUser: LocalUserProfile | null;
  activeWorkspaceId?: string | null;
  onOpenAiSettings: (tab?: OpenRouterSettingsTab) => void;
  onOpenLocalAuth: () => void;
  onStatusNotice?: (msg: string) => void;
  agentName?: string;
  onOpenXoxStudio?: (tab?: "identity" | "voice" | "skills" | "rules") => void;
}

const PREVIEW_MSG_ID = "__xook_voice_preview__";

function getProfileInitials(name: string): string {
  const clean = name.trim().replace(/[^\p{L}\s]/gu, "");
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "XO";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = "voice",
  onClose,
  ttsStatus,
  onTtsStatusChanged,
  aiConfig,
  modelCatalog,
  localUser,
  activeWorkspaceId,
  onOpenAiSettings,
  onOpenLocalAuth,
  onStatusNotice,
  agentName,
  onOpenXoxStudio,
}) => {
  const displayAgentName = agentName?.trim() || "Xox";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeSeqRef = useRef(0);
  const pressedOutsideRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  isOpenRef.current = isOpen;
  onCloseRef.current = onClose;

  const [dialogRendered, setDialogRendered] = useState(isOpen);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [savingVoice, setSavingVoice] = useState(false);
  const [downloadingVoice, setDownloadingVoice] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<TtsDownloadProgress | null>(null);
  const [confirmDeleteModels, setConfirmDeleteModels] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<TtsPlaybackSnapshot>(() => ttsPlayer.getSnapshot());

  // Estado de lectura de pantalla
  const [screenStatus, setScreenStatus] = useState<ScreenReaderStatus | null>(null);
  const [loadingScreen, setLoadingScreen] = useState(false);

  const shouldRenderBody = isOpen || dialogRendered;
  const inTauri = isTauriTtsRuntime();

  useEffect(() => ttsPlayer.subscribe(setPlayback), []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void getTtsStatus()
      .then((fresh) => {
        if (active) onTtsStatusChanged(fresh);
      })
      .catch(() => {});

    let unsub = () => {};
    void subscribeTtsEvents({
      onDownloadProgress: (p) => {
        if (!active) return;
        setDownloadProgress(p);
        if (p.error) setVoiceError(p.error);
      },
      onStatusUpdated: (st) => {
        if (active) onTtsStatusChanged(st);
      },
    }).then((fn) => {
      unsub = fn;
    });

    return () => {
      active = false;
      unsub();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== "screen") return;
    let active = true;
    setLoadingScreen(true);
    void getScreenReaderStatus()
      .then((st) => {
        if (active) setScreenStatus(st);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingScreen(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, activeTab]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setActiveTab(initialTab);
      setConfirmDeleteModels(false);
      setVoiceError(null);
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (!dialog.open) {
      setDialogRendered(false);
      return;
    }

    const seq = ++closeSeqRef.current;
    void (async () => {
      dialog.setAttribute("data-closing", "");
      await waitTopLayerAnimations(dialog, 240);
      if (closeSeqRef.current !== seq) return;
      dialog.removeAttribute("data-closing");
      if (dialog.open) dialog.close();
      setDialogRendered(false);
    })();
  }, [isOpen, initialTab]);

  const currentConfig = ttsStatus?.config ?? {
    enabled: false,
    autoPlay: false,
    voiceId: "lola",
    speed: 1.0,
    idleUnloadMinutes: 5,
  };
  const modelsInstalled = ttsStatus?.modelsInstalled ?? false;
  const workerRunning = ttsStatus?.workerRunning ?? false;
  const workerRssMb = ttsStatus?.workerRssMb ?? 0;
  const voices = ttsStatus?.voices ?? [];
  const modelSizeMb = Math.round(((ttsStatus?.modelBytes ?? 0) / (1024 * 1024)) * 10) / 10;

  const isPreviewLoading = playback.loadingMessageId === PREVIEW_MSG_ID;
  const isPreviewPlaying = playback.playingMessageId === PREVIEW_MSG_ID;

  const handleToggleEnabled = async (nextEnabled: boolean) => {
    setVoiceError(null);
    if (nextEnabled && inTauri && !modelsInstalled) {
      await handleDownloadAndEnable(false);
      return;
    }

    setSavingVoice(true);
    try {
      if (!nextEnabled) {
        ttsPlayer.stop();
      }
      const next = await saveTtsConfig({
        enabled: nextEnabled,
        autoPlay: nextEnabled ? currentConfig.autoPlay : false,
      });
      onTtsStatusChanged(next);
      onStatusNotice?.(
        nextEnabled
          ? "Voz de Xox activada en este equipo."
          : "Voz desactivada y memoria liberada (0 MB)."
      );
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setSavingVoice(false);
    }
  };

  const handleDownloadAndEnable = async (enableAutoPlay = false) => {
    setVoiceError(null);
    setDownloadingVoice(true);
    setDownloadProgress({
      progress: 1,
      label: "Preparando descarga local...",
      step: 0,
      totalSteps: 8,
      downloadedBytes: 0,
      totalBytes: 131 * 1024 * 1024,
      done: false,
    });
    try {
      await downloadTtsModels(["lola", "rafael"]);
      const updated = await saveTtsConfig({
        enabled: true,
        ...(enableAutoPlay ? { autoPlay: true } : {}),
      });
      onTtsStatusChanged(updated);
      onStatusNotice?.(
        enableAutoPlay
          ? "Voz descargada: el agente hablará al generar texto."
          : "Paquete de voz instalado y listo para hablar."
      );
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setDownloadingVoice(false);
    }
  };

  const handleToggleAutoPlay = async (nextAutoPlay: boolean) => {
    setVoiceError(null);
    if (nextAutoPlay && inTauri && !modelsInstalled) {
      await handleDownloadAndEnable(true);
      return;
    }

    setSavingVoice(true);
    try {
      const updated = await saveTtsConfig(
        nextAutoPlay ? { enabled: true, autoPlay: true } : { autoPlay: false }
      );
      onTtsStatusChanged(updated);
      onStatusNotice?.(
        nextAutoPlay
          ? "Listo: el agente hablará automáticamente al generar texto."
          : "Lectura automática apagada (puedes seguir usando Escuchar)."
      );
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setSavingVoice(false);
    }
  };

  const handleUpdateConfig = async (patch: {
    autoPlay?: boolean;
    voiceId?: string;
    speed?: number;
    idleUnloadMinutes?: number;
  }) => {
    setVoiceError(null);
    if (typeof patch.speed === "number") {
      ttsPlayer.setSpeed(patch.speed);
    }
    setSavingVoice(true);
    try {
      const updated = await saveTtsConfig(patch);
      onTtsStatusChanged(updated);
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setSavingVoice(false);
    }
  };

  const handlePreviewVoice = async (voiceId: string) => {
    setVoiceError(null);
    if (
      (isPreviewPlaying || isPreviewLoading) &&
      previewVoiceId === voiceId
    ) {
      ttsPlayer.stop();
      return;
    }

    if (inTauri && !modelsInstalled) {
      setVoiceError("Descarga primero el paquete de voz local para poder escuchar las voces.");
      return;
    }

    try {
      if (!currentConfig.enabled) {
        const updated = await saveTtsConfig({ enabled: true, voiceId });
        onTtsStatusChanged(updated);
      } else if (currentConfig.voiceId !== voiceId) {
        const updated = await saveTtsConfig({ voiceId });
        onTtsStatusChanged(updated);
      }

      setPreviewVoiceId(voiceId);
      const voiceLabel = voices.find((v) => v.id === voiceId)?.name ?? "Xox";
      await ttsPlayer.playMessage(
        PREVIEW_MSG_ID,
        `Hola, soy ${voiceLabel}, la voz de Shox. Puedo leer tus respuestas con claridad y sin enviar nada a internet.`,
        { voiceId, speed: currentConfig.speed }
      );
      if (inTauri) {
        const fresh = await getTtsStatus();
        onTtsStatusChanged(fresh);
      }
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    }
  };

  const handleUnloadRam = async () => {
    setVoiceError(null);
    ttsPlayer.stop();
    try {
      const updated = await unloadTtsWorker();
      onTtsStatusChanged(updated);
      onStatusNotice?.("Memoria del motor de voz liberada (0 MB).");
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    }
  };

  const handleDeleteModels = async () => {
    setVoiceError(null);
    ttsPlayer.stop();
    setSavingVoice(true);
    try {
      const updated = await deleteTtsModels();
      onTtsStatusChanged(updated);
      setConfirmDeleteModels(false);
      setDownloadProgress(null);
      onStatusNotice?.("Archivos locales de voz eliminados.");
    } catch (err) {
      setVoiceError(cleanTtsErrorMessage(err));
    } finally {
      setSavingVoice(false);
    }
  };

  const activeProvider = normalizeProviderIdClient(aiConfig.provider);
  const activeSpec = getProviderSpec(activeProvider);
  const activeModelDisplay = formatModelDisplay(
    aiConfig.modelId || activeSpec.defaultModelId,
    modelCatalog
  );
  const configuredProvidersCount = AI_PROVIDER_LIST.filter(
    (s) => aiConfig.configuredProviders?.[s.id]?.hasApiKey
  ).length;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="xook-settings-modal-title"
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        if (isOpenRef.current) {
          onCloseRef.current();
        }
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        pressedOutsideRef.current =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        const releasedOutside =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
        if (pressedOutsideRef.current && releasedOutside) {
          onCloseRef.current();
        }
        pressedOutsideRef.current = false;
      }}
      className="xook-liquid-dialog"
    >
      {shouldRenderBody && (
        <>
          <LiquidGlassBackdrop variant="menu" />

          {/* Capas difuminadas obsidiana-grafito coherentes con el perfil */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none overflow-hidden rounded-[inherit]"
          >
            <div className="absolute -top-20 -left-16 w-80 h-52 rounded-full bg-zinc-400/[0.045] blur-3xl" />
            <div className="absolute -bottom-20 -right-14 w-72 h-48 rounded-full bg-zinc-600/[0.04] blur-3xl" />
          </div>

          {/* Cabecera */}
          <header className="relative z-[1] shrink-0 px-5 pt-4 pb-3.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="xook-profile-avatar-glass w-10 h-10 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="relative z-10 w-4 h-4 text-zinc-100" />
              </div>
              <div className="min-w-0">
                <h2
                  id="xook-settings-modal-title"
                  className="text-sm font-semibold text-white tracking-tight"
                >
                  Configuraciones
                </h2>
                <p className="text-[11.5px] text-zinc-400 truncate mt-0.5">
                  {activeTab === "voice"
                    ? `Voz local de ${displayAgentName}`
                    : activeTab === "screen"
                      ? "Contexto visual en memoria local"
                      : activeTab === "ai"
                        ? `${activeSpec.shortName} · ${activeModelDisplay.name}`
                        : "Identidad local y permisos"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <JellyPillTrack
                activeKey={activeTab}
                role="tablist"
                aria-label="Secciones de configuración"
                pillRadius="9999px"
                variant="quick"
                className="xook-profile-role-track inline-flex items-center p-1 rounded-full gap-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "voice"}
                  onClick={() => setActiveTab("voice")}
                  className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium cursor-pointer ${
                    activeTab === "voice"
                      ? "text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Voz</span>
                  {currentConfig.enabled && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "screen"}
                  onClick={() => setActiveTab("screen")}
                  className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium cursor-pointer ${
                    activeTab === "screen"
                      ? "text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Pantalla</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "ai"}
                  onClick={() => setActiveTab("ai")}
                  className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium cursor-pointer ${
                    activeTab === "ai"
                      ? "text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>IA</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "account"}
                  onClick={() => setActiveTab("account")}
                  className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium cursor-pointer ${
                    activeTab === "account"
                      ? "text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>Perfil</span>
                </button>
              </JellyPillTrack>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar configuraciones"
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Contenido principal */}
          <div className="relative z-[1] flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {activeTab === "voice" && (
              <div className="space-y-4">
                {/* Tarjeta maestra dividida en filas limpias */}
                <section className="xook-obsidian-surface rounded-2xl overflow-hidden">
                  {/* Fila 1: Activación general + memoria */}
                  <div className="px-4 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="xook-profile-avatar-glass w-9 h-9 flex items-center justify-center shrink-0">
                        {currentConfig.enabled ? (
                          <Volume2 className="relative z-10 w-4 h-4 text-zinc-100" />
                        ) : (
                          <VolumeX className="relative z-10 w-4 h-4 text-zinc-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-[13px] font-semibold text-white">
                            Voz de {displayAgentName}
                          </h3>
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                !currentConfig.enabled
                                  ? "bg-zinc-600"
                                  : workerRunning
                                    ? "bg-white animate-pulse"
                                    : "bg-emerald-400"
                              }`}
                            />
                            {!currentConfig.enabled
                              ? "Apagada · 0 MB"
                              : workerRunning
                                ? `Activa · ~${Math.round(workerRssMb)} MB`
                                : "En reposo · 0 MB"}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-zinc-400 mt-0.5 truncate">
                          Síntesis en español 100% local, sin conexión a internet.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {workerRunning && (
                        <button
                          type="button"
                          onClick={() => void handleUnloadRam()}
                          className="xook-obsidian-btn px-2.5 py-1 rounded-lg text-[11px] cursor-pointer"
                          title="Cerrar motor de voz para liberar memoria inmediatamente"
                        >
                          Liberar RAM
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-label={`Activar voz de ${displayAgentName}`}
                        aria-checked={currentConfig.enabled}
                        disabled={savingVoice || downloadingVoice}
                        onClick={() => void handleToggleEnabled(!currentConfig.enabled)}
                        className="xook-obsidian-switch"
                        title={
                          currentConfig.enabled
                            ? "Desactivar voz y liberar RAM"
                            : "Activar voz local"
                        }
                      >
                        <span className="xook-obsidian-switch-thumb" />
                      </button>
                    </div>
                  </div>

                  {/* Alerta de error */}
                  {(voiceError || playback.error) && (
                    <div className="mx-4 mb-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 flex items-start gap-2 text-[11.5px] text-rose-200">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{voiceError || playback.error}</span>
                    </div>
                  )}

                  {/* Fila 2: Hablar al generar texto */}
                  <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-zinc-100">
                        Hablar al generar texto
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Lee cada respuesta frase por frase en tiempo real.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Hablar al generar texto"
                      aria-checked={currentConfig.enabled && currentConfig.autoPlay}
                      disabled={savingVoice || downloadingVoice}
                      onClick={() =>
                        void handleToggleAutoPlay(
                          !(currentConfig.enabled && currentConfig.autoPlay)
                        )
                      }
                      className="xook-obsidian-switch"
                    >
                      <span className="xook-obsidian-switch-thumb" />
                    </button>
                  </div>

                  {/* Fila 3: Paquete local */}
                  <div className="px-4 py-2.5 border-t border-white/[0.06]">
                    {!inTauri ? (
                      <p className="text-[11px] text-zinc-400">
                        Vista previa web: descarga el paquete local (~131 MB) en la app de escritorio.
                      </p>
                    ) : downloadingVoice ? (
                      <div className="space-y-1.5 py-0.5">
                        <div className="flex items-center justify-between text-[11.5px] text-zinc-200">
                          <span className="inline-flex items-center gap-2 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                            <span>{downloadProgress?.label || "Descargando voces en español…"}</span>
                          </span>
                          <span className="tabular-nums font-mono text-zinc-300">
                            {Math.round(downloadProgress?.progress ?? 0)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-zinc-400 to-white transition-all duration-200"
                            style={{
                              width: `${Math.min(100, Math.max(2, downloadProgress?.progress ?? 2))}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : !modelsInstalled ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-0.5">
                        <p className="text-[11.5px] text-zinc-300">
                          Paquete de voz requerido en este equipo (~131 MB)
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleDownloadAndEnable()}
                          className="xook-profile-save-btn px-3.5 py-1.5 rounded-xl text-[11.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Descargar voz</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-zinc-300" />
                          <span>Paquete instalado · {modelSizeMb} MB</span>
                        </span>

                        {confirmDeleteModels ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteModels(false)}
                              autoFocus
                              className="xook-obsidian-btn px-2.5 py-1 rounded-lg text-[11px] cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteModels()}
                              className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-200 hover:bg-rose-500/30 cursor-pointer transition-colors"
                            >
                              Sí, eliminar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteModels(true)}
                            className="inline-flex items-center gap-1 text-zinc-500 hover:text-rose-300 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Eliminar archivos</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {/* Selector de voces uniforme */}
                <section className="space-y-2.5">
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 px-0.5">
                    Voz del asistente
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {voices.map((voice) => {
                      const selected = currentConfig.voiceId === voice.id;
                      const isThisLoading = isPreviewLoading && previewVoiceId === voice.id;
                      const isThisPlaying = isPreviewPlaying && previewVoiceId === voice.id;

                      return (
                        <div
                          key={voice.id}
                          onClick={() => {
                            if (!savingVoice && !downloadingVoice) {
                              void handleUpdateConfig({ voiceId: voice.id });
                            }
                          }}
                          className={`xook-obsidian-item rounded-xl px-3.5 py-3 flex items-center justify-between gap-3 cursor-pointer ${
                            selected ? "is-selected" : ""
                          }`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12.5px] font-semibold text-white">
                                {voice.name}
                              </span>
                              <span className="text-[11px] text-zinc-500">
                                · {voice.gender}
                              </span>
                              {!voice.installed && (
                                <span className="text-[10px] font-mono text-zinc-500 ml-0.5">
                                  +{voice.sizeMb} MB
                                </span>
                              )}
                              {selected && (
                                <Check className="w-3 h-3 text-white ml-0.5 shrink-0" />
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-400 truncate">
                              {voice.description}
                            </p>
                          </div>

                          <div
                            className="shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={downloadingVoice || (!modelsInstalled && inTauri)}
                              onClick={() => void handlePreviewVoice(voice.id)}
                              title={
                                isThisPlaying
                                  ? "Detener muestra"
                                  : `Escuchar muestra de ${voice.name}`
                              }
                              className={`xook-obsidian-btn px-2.5 py-1.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                                isThisPlaying ? "!border-white/30 !text-white" : ""
                              }`}
                            >
                              {isThisLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isThisPlaying ? (
                                <Square className="w-3 h-3 fill-current" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                              <span>{isThisPlaying ? "Detener" : "Probar"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Velocidad y reposo */}
                <section className="xook-obsidian-surface rounded-2xl p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-medium text-zinc-200">Velocidad</span>
                        <span className="font-mono tabular-nums text-zinc-300">
                          {currentConfig.speed.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        aria-label="Velocidad de habla"
                        min={0.85}
                        max={1.25}
                        step={0.05}
                        value={currentConfig.speed}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          ttsPlayer.setSpeed(v);
                          void handleUpdateConfig({ speed: v });
                        }}
                        className="xook-obsidian-range w-full"
                      />
                      <div className="flex justify-between text-[10.5px]">
                        {[
                          { v: 0.9, label: "Pausada · 0.9x" },
                          { v: 1.0, label: "Natural · 1.0x" },
                          { v: 1.15, label: "Ágil · 1.15x" },
                        ].map((preset) => (
                          <button
                            key={preset.v}
                            type="button"
                            onClick={() => void handleUpdateConfig({ speed: preset.v })}
                            className={`transition-colors cursor-pointer ${
                              Math.abs(currentConfig.speed - preset.v) < 0.01
                                ? "text-white font-medium"
                                : "text-zinc-500 hover:text-zinc-300"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-medium text-zinc-200 inline-flex items-center gap-1.5">
                          <PauseCircle className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Reposo automático</span>
                        </span>
                      </div>
                      <div className="xook-profile-role-track flex items-center gap-1 p-1 rounded-xl">
                        {[2, 5, 15, 60].map((mins) => {
                          const active = currentConfig.idleUnloadMinutes === mins;
                          return (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => void handleUpdateConfig({ idleUnloadMinutes: mins })}
                              className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                                active
                                  ? "bg-white/[0.13] text-white border border-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                                  : "text-zinc-400 border border-transparent hover:text-zinc-200"
                              }`}
                            >
                              {mins === 60 ? "1 h" : `${mins} min`}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10.5px] text-zinc-500">
                        Libera la RAM al quedar inactiva.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "screen" && (
              <div className="space-y-3">
                <section className="xook-obsidian-surface rounded-2xl overflow-hidden">
                  <div className="px-4 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="xook-profile-avatar-glass w-9 h-9 flex items-center justify-center shrink-0">
                        <Monitor className="relative z-10 w-4 h-4 text-zinc-100" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold text-white">
                          Lectura continua de pantalla
                        </h3>
                        <p className="text-[11.5px] text-zinc-400 mt-0.5">
                          Extrae texto en memoria local y se pausa en apps sensibles o contraseñas.
                        </p>
                      </div>
                    </div>

                    {loadingScreen ? (
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-400 shrink-0" />
                    ) : inTauri && screenStatus ? (
                      <button
                        type="button"
                        role="switch"
                        aria-label="Lectura continua de pantalla"
                        aria-checked={screenStatus.rollingEnabled}
                        onClick={() => {
                          void setScreenReaderConfig({
                            rollingEnabled: !screenStatus.rollingEnabled,
                          }).then((next) => {
                            if (next) setScreenStatus(next);
                          });
                        }}
                        className="xook-obsidian-switch"
                      >
                        <span className="xook-obsidian-switch-thumb" />
                      </button>
                    ) : null}
                  </div>

                  {!inTauri ? (
                    <div className="px-4 py-3 border-t border-white/[0.06] text-[11.5px] text-zinc-400">
                      Disponible únicamente en la aplicación de escritorio macOS.
                    </div>
                  ) : screenStatus ? (
                    <>
                      {!screenStatus.permissionGranted && (
                        <div className="mx-4 mb-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11.5px] text-amber-100">
                            macOS requiere autorización para leer la ventana activa.
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                void requestScreenPermission().then((st) => {
                                  if (st) setScreenStatus(st);
                                });
                              }}
                              className="xook-profile-save-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                            >
                              Autorizar
                            </button>
                            <button
                              type="button"
                              onClick={() => void openScreenPermissionSettings()}
                              className="xook-obsidian-btn px-2.5 py-1 rounded-lg text-[11px] cursor-pointer"
                            >
                              Ajustes de macOS
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="px-4 py-3.5 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-zinc-300">Alcance</p>
                          <div className="xook-profile-role-track flex gap-1 p-1 rounded-xl">
                            {(["window", "display"] as const).map((mode) => {
                              const active = screenStatus.captureMode === mode;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => {
                                    void setScreenReaderConfig({ captureMode: mode }).then((next) => {
                                      if (next) setScreenStatus(next);
                                    });
                                  }}
                                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                                    active
                                      ? "bg-white/[0.13] text-white border border-white/[0.18]"
                                      : "text-zinc-400 border border-transparent hover:text-zinc-200"
                                  }`}
                                >
                                  {mode === "window" ? "Ventana activa" : "Pantalla completa"}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-zinc-300">Retención en memoria</p>
                          <div className="xook-profile-role-track flex gap-1 p-1 rounded-xl">
                            {[15, 30, 60].map((mins) => {
                              const active = screenStatus.retentionMinutes === mins;
                              return (
                                <button
                                  key={mins}
                                  type="button"
                                  onClick={() => {
                                    void setScreenReaderConfig({ retentionMinutes: mins }).then((next) => {
                                      if (next) setScreenStatus(next);
                                    });
                                  }}
                                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all ${
                                    active
                                      ? "bg-white/[0.13] text-white border border-white/[0.18]"
                                      : "text-zinc-400 border border-transparent hover:text-zinc-200"
                                  }`}
                                >
                                  {mins} min
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span>
                          {screenStatus.observationCount} observaciones recientes en memoria
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void clearScreenMemory().then((next) => {
                              if (next) setScreenStatus(next);
                              onStatusNotice?.("Historial visual limpiado.");
                            });
                          }}
                          className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Limpiar historial</span>
                        </button>
                      </div>
                    </>
                  ) : null}
                </section>
              </div>
            )}

            {activeTab === "ai" && (
              <div className="space-y-3">
                <section className="xook-obsidian-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="xook-profile-avatar-glass w-10 h-10 flex items-center justify-center shrink-0">
                      <ProviderIcon provider={activeProvider} size={18} className="relative z-10 text-zinc-100" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-white truncate">
                        {activeSpec.shortName} · {activeModelDisplay.name}
                      </h3>
                      <p className="text-[11.5px] text-zinc-400 mt-0.5">
                        {configuredProvidersCount > 0
                          ? `${configuredProvidersCount} ${configuredProvidersCount === 1 ? "proveedor conectado" : "proveedores conectados"} en bóveda local`
                          : "Sin claves API configuradas"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAiSettings("account");
                      }}
                      className="xook-obsidian-btn px-3 py-1.5 rounded-xl text-[11.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Claves y respaldo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAiSettings("models");
                      }}
                      className="xook-profile-save-btn px-3.5 py-1.5 rounded-xl text-[11.5px] font-semibold cursor-pointer"
                    >
                      Elegir modelo
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "account" && (
              <div className="space-y-3">
                <section className="xook-obsidian-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="xook-profile-avatar-glass w-10 h-10 flex items-center justify-center shrink-0">
                      {localUser ? (
                        <span className="relative z-10 text-xs font-semibold text-white tracking-wider">
                          {getProfileInitials(localUser.name)}
                        </span>
                      ) : (
                        <UserCheck className="relative z-10 w-4 h-4 text-zinc-200" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-white truncate">
                        {localUser ? localUser.name : "Perfil local sin configurar"}
                      </h3>
                      <p className="text-[11.5px] text-zinc-400 truncate mt-0.5">
                        {localUser
                          ? `${localUser.storeName} · ${localUser.role}`
                          : "Personaliza tu nombre, negocio y rol"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLocalAuth();
                    }}
                    className="xook-obsidian-btn px-3.5 py-1.5 rounded-xl text-[11.5px] font-medium cursor-pointer"
                  >
                    {localUser ? "Editar perfil" : "Configurar perfil"}
                  </button>
                </section>

                <WorkspacePermissionsSection
                  activeWorkspaceId={activeWorkspaceId}
                  onStatusNotice={onStatusNotice}
                />

                {onOpenXoxStudio && (
                  <section className="xook-obsidian-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="xook-profile-avatar-glass w-10 h-10 flex items-center justify-center shrink-0">
                        <XoxSilhouetteIcon className="relative z-10 w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold text-white">
                          Espacio de {displayAgentName}
                        </h3>
                        <p className="text-[11.5px] text-zinc-400 mt-0.5">
                          Nombre, instrucciones iniciales, skills y reglas.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenXoxStudio("identity");
                      }}
                      className="xook-obsidian-btn px-3.5 py-1.5 rounded-xl text-[11.5px] font-medium cursor-pointer shrink-0"
                    >
                      Abrir editor
                    </button>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* Pie */}
          <footer className="relative z-[1] shrink-0 px-5 py-3 border-t border-white/[0.06] flex items-center justify-between gap-3 text-[11px] text-zinc-500">
            <span className="truncate">
              {activeTab === "voice"
                ? "Pocket TTS (Kyutai, CC BY 4.0) · Procesamiento local"
                : "Configuración guardada localmente en este equipo"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="xook-profile-save-btn px-4 py-1.5 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
            >
              Listo
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
};
