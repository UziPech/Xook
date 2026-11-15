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
}

const PREVIEW_MSG_ID = "__xook_voice_preview__";

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
}) => {
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
          <LiquidGlassBackdrop variant="modal" />

          {/* Cabecera */}
          <header className="relative z-[1] shrink-0 px-5 pt-4 pb-3 border-b border-white/[0.08] bg-white/[0.02] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="quick-liquid-icon w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                  <SlidersHorizontal className="w-4 h-4 text-white/90" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="xook-settings-modal-title"
                    className="text-sm font-semibold text-white tracking-tight"
                  >
                    Configuraciones
                  </h2>
                  <p className="text-[11px] text-zinc-300/80 truncate">
                    Voz de Xox, lectura de pantalla, modelos e identidad local
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <JellyPillTrack
                  activeKey={activeTab}
                  role="tablist"
                  aria-label="Secciones de configuración"
                  pillRadius="9999px"
                  variant="quick"
                  className="inline-flex items-center p-0.5 rounded-full gap-0.5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "voice"}
                    onClick={() => setActiveTab("voice")}
                    className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer ${
                      activeTab === "voice"
                        ? "text-white"
                        : "text-zinc-300/80 hover:text-white"
                    }`}
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>Voz</span>
                    {currentConfig.enabled && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "screen"}
                    onClick={() => setActiveTab("screen")}
                    className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer ${
                      activeTab === "screen"
                        ? "text-white"
                        : "text-zinc-300/80 hover:text-white"
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
                    className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer ${
                      activeTab === "ai"
                        ? "text-white"
                        : "text-zinc-300/80 hover:text-white"
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
                    className={`xook-jelly-tab inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium cursor-pointer ${
                      activeTab === "account"
                        ? "text-white"
                        : "text-zinc-300/80 hover:text-white"
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
                  className="quick-liquid-btn w-8 h-8 rounded-full inline-flex items-center justify-center text-zinc-200 hover:text-white cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Contenido principal */}
          <div className="relative z-[1] flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {activeTab === "voice" && (
              <div className="space-y-4">
                {/* Tarjeta maestra de encendido + impacto en memoria */}
                <section className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="quick-liquid-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                        {currentConfig.enabled ? (
                          <Volume2 className="w-4 h-4 text-emerald-200" />
                        ) : (
                          <VolumeX className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-[13px] font-semibold text-white">
                            Voz de Xox en este equipo
                          </h3>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium border ${
                              !currentConfig.enabled
                                ? "bg-white/[0.04] text-zinc-300 border-white/[0.08]"
                                : workerRunning
                                  ? "bg-sky-500/15 text-sky-200 border-sky-400/25"
                                  : "bg-emerald-500/15 text-emerald-200 border-emerald-400/25"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                !currentConfig.enabled
                                  ? "bg-zinc-400"
                                  : workerRunning
                                    ? "bg-sky-300 animate-pulse"
                                    : "bg-emerald-300"
                              }`}
                            />
                            {!currentConfig.enabled
                              ? "Desactivada · 0 MB en RAM"
                              : workerRunning
                                ? `Activa · ~${Math.round(workerRssMb)} MB en RAM`
                                : "Lista en reposo · 0 MB en RAM"}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-zinc-300/80 mt-0.5">
                          Voz natural en español generada localmente sin enviar nada a internet.
                          Cuando está apagada no consume memoria.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {workerRunning && (
                        <button
                          type="button"
                          onClick={() => void handleUnloadRam()}
                          className="quick-liquid-btn px-2.5 py-1.5 rounded-xl text-[11px] text-zinc-200 hover:text-white cursor-pointer"
                          title="Cerrar motor de voz para liberar memoria inmediatamente"
                        >
                          Liberar memoria
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={currentConfig.enabled}
                        disabled={savingVoice || downloadingVoice}
                        onClick={() => void handleToggleEnabled(!currentConfig.enabled)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
                          currentConfig.enabled
                            ? "bg-emerald-500/35 border-emerald-300/40"
                            : "bg-white/[0.08] border-white/[0.14]"
                        }`}
                        title={
                          currentConfig.enabled
                            ? "Desactivar voz y liberar RAM"
                            : "Activar voz local"
                        }
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                            currentConfig.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Alerta de error clara */}
                  {(voiceError || playback.error) && (
                    <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 flex items-start gap-2 text-[11.5px] text-rose-100">
                      <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                      <span>{voiceError || playback.error}</span>
                    </div>
                  )}

                  {/* Interruptor principal: hablar automáticamente cuando el agente genere texto */}
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[12.5px] font-medium text-white">
                          Hablar al generar texto
                        </p>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            currentConfig.enabled && currentConfig.autoPlay
                              ? "bg-indigo-500/20 text-indigo-200 border-indigo-400/30"
                              : "bg-white/[0.04] text-zinc-400 border-white/[0.08]"
                          }`}
                        >
                          {currentConfig.enabled && currentConfig.autoPlay
                            ? "Habla en tiempo real"
                            : "Solo al pulsar Escuchar"}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-300/80 mt-0.5 leading-relaxed">
                        Cuando el agente genere una respuesta, empezará a hablar automáticamente
                        frase por frase sin esperar a que termine de escribir.
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
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                        currentConfig.enabled && currentConfig.autoPlay
                          ? "bg-indigo-400/50 border-indigo-300/50"
                          : "bg-white/[0.07] border-white/[0.12]"
                      }`}
                      title={
                        currentConfig.enabled && currentConfig.autoPlay
                          ? "Desactivar lectura automática al generar texto"
                          : "Activar para que el agente hable automáticamente al generar texto"
                      }
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          currentConfig.enabled && currentConfig.autoPlay
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Descarga o gestión del paquete local */}
                  {!inTauri ? (
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-300/85">
                      Vista previa en navegador: en la aplicación de escritorio descarga el paquete local (~131 MB) para hablar sin conexión.
                    </div>
                  ) : downloadingVoice ? (
                    <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11.5px] text-indigo-100">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                          <span>{downloadProgress?.label || "Descargando voces en español..."}</span>
                        </span>
                        <span className="tabular-nums font-medium">
                          {Math.round(downloadProgress?.progress ?? 0)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sky-300 transition-all duration-200"
                          style={{
                            width: `${Math.min(100, Math.max(2, downloadProgress?.progress ?? 2))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : !modelsInstalled ? (
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-[12px] font-medium text-white">
                          Falta descargar el paquete de voz (~131 MB)
                        </p>
                        <p className="text-[11px] text-zinc-300/75">
                          Se guarda solo en este equipo (incluye Lola y Rafael). No afecta el peso del proyecto.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDownloadAndEnable()}
                        className="quick-liquid-chip-active px-3.5 py-1.5 rounded-xl text-[11.5px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Descargar e iniciar voz</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.06] text-[11px] text-zinc-300/80">
                      <span className="inline-flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-300" />
                        <span>
                          Paquete de voz instalado en disco ({modelSizeMb} MB)
                        </span>
                      </span>

                      {confirmDeleteModels ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-rose-200">¿Eliminar archivos?</span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteModels()}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-400/35 text-rose-100 hover:bg-rose-500/30 cursor-pointer"
                          >
                            Sí, eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteModels(false)}
                            className="quick-liquid-btn px-2 py-1 rounded-lg text-zinc-200 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteModels(true)}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-rose-200 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Eliminar archivos locales</span>
                        </button>
                      )}
                    </div>
                  )}
                </section>

                {/* Selector de voces */}
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-semibold text-zinc-100">
                      Voz del asistente
                    </h3>
                    <span className="text-[11px] text-zinc-400">
                      Español natural · Haz clic en Probar para escucharla
                    </span>
                  </div>

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
                          className={`quick-liquid-option rounded-xl p-3 flex items-center justify-between gap-2.5 cursor-pointer transition-all ${
                            selected ? "is-selected text-white" : "text-zinc-200/90"
                          }`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[12.5px] font-medium text-white">
                                {voice.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[10px] text-zinc-300">
                                {voice.gender}
                              </span>
                              {voice.installed ? (
                                <span className="text-[10px] text-emerald-300/90">
                                  Lista
                                </span>
                              ) : (
                                <span className="text-[10px] text-zinc-400">
                                  +{voice.sizeMb} MB
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-zinc-300/75 truncate">
                              {voice.description}
                            </p>
                          </div>

                          <div
                            className="flex items-center gap-1.5 shrink-0"
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
                              className={`quick-liquid-btn px-2.5 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isThisPlaying ? "text-emerald-200" : "text-zinc-100"
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

                {/* Velocidad y limpieza de memoria */}
                <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-medium text-zinc-200">Velocidad de habla</span>
                        <span className="tabular-nums text-zinc-300">
                          {currentConfig.speed.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.85}
                        max={1.25}
                        step={0.05}
                        value={currentConfig.speed}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          ttsPlayer.setSpeed(v);
                          void handleUpdateConfig({ speed: v });
                        }}
                        className="w-full accent-indigo-300 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <button
                          type="button"
                          onClick={() => void handleUpdateConfig({ speed: 0.9 })}
                          className="hover:text-zinc-200 cursor-pointer"
                        >
                          Pausada (0.9x)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUpdateConfig({ speed: 1.0 })}
                          className="hover:text-zinc-200 cursor-pointer"
                        >
                          Natural (1.0x)
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUpdateConfig({ speed: 1.15 })}
                          className="hover:text-zinc-200 cursor-pointer"
                        >
                          Ágil (1.15x)
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-medium text-zinc-200 inline-flex items-center gap-1.5">
                          <PauseCircle className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Dormir motor si no se usa</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[2, 5, 15, 60].map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => void handleUpdateConfig({ idleUnloadMinutes: mins })}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer border transition-colors ${
                              currentConfig.idleUnloadMinutes === mins
                                ? "bg-white/[0.12] text-white border-white/[0.2]"
                                : "bg-white/[0.03] text-zinc-300 border-white/[0.07] hover:bg-white/[0.07]"
                            }`}
                          >
                            {mins === 60 ? "1 h" : `${mins} min`}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10.5px] text-zinc-400">
                        Libera la RAM automáticamente al quedar inactiva.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "screen" && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="quick-liquid-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                        <Monitor className="w-4 h-4 text-zinc-100" />
                      </div>
                      <div>
                        <h3 className="text-[13px] font-semibold text-white">
                          Lectura continua de pantalla
                        </h3>
                        <p className="text-[11.5px] text-zinc-300/80">
                          Solo extrae contexto de texto en memoria local y se pausa en apps sensibles o contraseñas.
                        </p>
                      </div>
                    </div>

                    {loadingScreen && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
                  </div>

                  {!inTauri ? (
                    <p className="text-[11.5px] text-zinc-400">
                      La lectura de pantalla solo está disponible en la aplicación de escritorio macOS.
                    </p>
                  ) : screenStatus ? (
                    <div className="space-y-3 pt-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                        <div className="space-y-0.5">
                          <p className="text-[12px] font-medium text-white">
                            {screenStatus.rollingEnabled ? "Memoria visual activa" : "Lectura bajo demanda"}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {screenStatus.observationCount} observaciones recientes · Retención de {screenStatus.retentionMinutes} min
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void setScreenReaderConfig({
                              rollingEnabled: !screenStatus.rollingEnabled,
                            }).then((next) => {
                              if (next) setScreenStatus(next);
                            });
                          }}
                          className={`px-3 py-1.5 rounded-xl text-[11.5px] font-medium cursor-pointer ${
                            screenStatus.rollingEnabled
                              ? "quick-liquid-chip-active text-white"
                              : "quick-liquid-btn text-zinc-200"
                          }`}
                        >
                          {screenStatus.rollingEnabled ? "Pausar lectura continua" : "Activar lectura continua"}
                        </button>
                      </div>

                      {!screenStatus.permissionGranted && (
                        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
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
                              className="quick-liquid-chip-active px-2.5 py-1 rounded-lg text-[11px] text-white cursor-pointer"
                            >
                              Autorizar
                            </button>
                            <button
                              type="button"
                              onClick={() => void openScreenPermissionSettings()}
                              className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[11px] text-zinc-100 cursor-pointer"
                            >
                              Ajustes de macOS
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                          <p className="text-[11px] font-medium text-zinc-300">Alcance de lectura</p>
                          <div className="flex gap-1.5">
                            {(["window", "display"] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => {
                                  void setScreenReaderConfig({ captureMode: mode }).then((next) => {
                                    if (next) setScreenStatus(next);
                                  });
                                }}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] cursor-pointer ${
                                  screenStatus.captureMode === mode
                                    ? "quick-liquid-chip-active text-white font-medium"
                                    : "quick-liquid-btn text-zinc-300"
                                }`}
                              >
                                {mode === "window" ? "Solo ventana activa" : "Pantalla completa"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                          <p className="text-[11px] font-medium text-zinc-300">Tiempo en historial visual</p>
                          <div className="flex gap-1.5">
                            {[15, 30, 60].map((mins) => (
                              <button
                                key={mins}
                                type="button"
                                onClick={() => {
                                  void setScreenReaderConfig({ retentionMinutes: mins }).then((next) => {
                                    if (next) setScreenStatus(next);
                                  });
                                }}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] cursor-pointer ${
                                  screenStatus.retentionMinutes === mins
                                    ? "quick-liquid-chip-active text-white font-medium"
                                    : "quick-liquid-btn text-zinc-300"
                                }`}
                              >
                                {mins} min
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            void clearScreenMemory().then((next) => {
                              if (next) setScreenStatus(next);
                              onStatusNotice?.("Historial visual limpiado.");
                            });
                          }}
                          className="quick-liquid-btn px-3 py-1.5 rounded-xl text-[11px] text-zinc-200 hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Limpiar memoria de pantalla</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            )}

            {activeTab === "ai" && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="quick-liquid-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                        <ProviderIcon provider={activeProvider} size={18} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-semibold text-white">
                          {activeSpec.shortName} · {activeModelDisplay.name}
                        </h3>
                        <p className="text-[11.5px] text-zinc-300/80">
                          {configuredProvidersCount > 0
                            ? `${configuredProvidersCount} ${configuredProvidersCount === 1 ? "proveedor conectado" : "proveedores conectados"} en la bóveda local`
                            : "Aún no has guardado claves de API"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenAiSettings("models");
                        }}
                        className="quick-liquid-btn px-3 py-1.5 rounded-xl text-[11.5px] text-zinc-100 cursor-pointer"
                      >
                        Elegir modelo
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenAiSettings("account");
                        }}
                        className="quick-liquid-chip-active px-3 py-1.5 rounded-xl text-[11.5px] font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Claves y respaldo</span>
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "account" && (
              <div className="space-y-3">
                <section className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="quick-liquid-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4 text-zinc-100" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold text-white">
                        {localUser ? localUser.name : "Perfil local sin configurar"}
                      </h3>
                      <p className="text-[11.5px] text-zinc-300/80 truncate">
                        {localUser
                          ? `${localUser.storeName} · Guardado únicamente en este equipo`
                          : "Personaliza tu nombre y espacio de trabajo"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenLocalAuth();
                    }}
                    className="quick-liquid-btn px-3 py-1.5 rounded-xl text-[11.5px] text-zinc-100 cursor-pointer"
                  >
                    {localUser ? "Editar perfil" : "Configurar perfil"}
                  </button>
                </section>

                <WorkspacePermissionsSection
                  activeWorkspaceId={activeWorkspaceId}
                  onStatusNotice={onStatusNotice}
                />
              </div>
            )}
          </div>

          {/* Pie */}
          <footer className="relative z-[1] shrink-0 px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
            <span>
              Voz neuronal local basada en Pocket TTS (Kyutai, CC BY 4.0) · Sin conexión tras la descarga.
            </span>
            <button
              type="button"
              onClick={onClose}
              className="quick-liquid-btn px-4 py-1.5 rounded-full text-zinc-100 font-medium cursor-pointer"
            >
              Listo
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
};
