import {
  cleanTextForSpeech,
  detectScreenNoticeKind,
  findSafeRawSpeechCutoff,
  hasSpeakableContent,
  splitSpeechSegments,
  type CleanSpeechOptions,
  type ScreenNoticeKind,
} from "./speechSanitizer";

export { cleanTextForSpeech };
export type { CleanSpeechOptions };

export interface TtsConfig {
  enabled: boolean;
  autoPlay: boolean;
  voiceId: string;
  speed: number;
  idleUnloadMinutes: number;
}

export interface TtsVoicePreset {
  id: string;
  name: string;
  gender: string;
  description: string;
  sizeMb: number;
  installed: boolean;
}

export interface TtsStatus {
  config: TtsConfig;
  modelsInstalled: boolean;
  modelBytes: number;
  voices: TtsVoicePreset[];
  workerRunning: boolean;
  workerRssMb: number;
  downloading: boolean;
}

export interface TtsDownloadProgress {
  progress: number;
  label: string;
  step: number;
  totalSteps: number;
  downloadedBytes: number;
  totalBytes: number;
  done: boolean;
  error?: string | null;
}

export interface TtsSpeechAudio {
  wavBase64: string;
  mimeType: string;
  durationMs: number;
  generationMs: number;
  voiceId: string;
  rssMb: number;
}

export interface TtsPlaybackSnapshot {
  loadingMessageId: string | null;
  playingMessageId: string | null;
  error: string | null;
  isPlaying: boolean;
}

const PREVIEW_STORAGE_KEY = "xook_tts_preview_cfg_v1";

const DEFAULT_PREVIEW_CONFIG: TtsConfig = {
  enabled: false,
  autoPlay: false,
  voiceId: "lola",
  speed: 1.0,
  idleUnloadMinutes: 5,
};

const PREVIEW_VOICES: TtsVoicePreset[] = [
  { id: "lola", name: "Lola", gender: "Femenina", description: "Cálida, expresiva y muy natural", sizeMb: 5.7, installed: false },
  { id: "rafael", name: "Rafael", gender: "Masculina", description: "Clara, firme y equilibrada", sizeMb: 5.9, installed: false },
  { id: "alba", name: "Alba", gender: "Femenina", description: "Suave y profesional", sizeMb: 5.9, installed: false },
  { id: "estelle", name: "Estelle", gender: "Femenina", description: "Cercana y conversacional", sizeMb: 7.9, installed: false },
  { id: "marius", name: "Marius", gender: "Masculina", description: "Profunda y pausada", sizeMb: 5.9, installed: false },
  { id: "jean", name: "Jean", gender: "Masculina", description: "Serena y directa", sizeMb: 5.9, installed: false },
];

export function isTauriTtsRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function readPreviewConfig(): TtsConfig {
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREVIEW_CONFIG };
    return { ...DEFAULT_PREVIEW_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREVIEW_CONFIG };
  }
}

export async function getTtsStatus(): Promise<TtsStatus> {
  if (!isTauriTtsRuntime()) {
    return {
      config: readPreviewConfig(),
      modelsInstalled: false,
      modelBytes: 0,
      voices: PREVIEW_VOICES,
      workerRunning: false,
      workerRssMb: 0,
      downloading: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsStatus>("get_tts_status_cmd");
}

export async function saveTtsConfig(
  payload: Partial<TtsConfig>
): Promise<TtsStatus> {
  if (!isTauriTtsRuntime()) {
    const next = { ...readPreviewConfig(), ...payload };
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento disponible
    }
    return {
      config: next,
      modelsInstalled: false,
      modelBytes: 0,
      voices: PREVIEW_VOICES,
      workerRunning: false,
      workerRssMb: 0,
      downloading: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsStatus>("save_tts_config_cmd", { payload });
}

export async function downloadTtsModels(voices?: string[]): Promise<TtsStatus> {
  if (!isTauriTtsRuntime()) {
    throw new Error("La descarga local requiere ejecutar XOOK como aplicación de escritorio.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsStatus>("download_tts_models_cmd", {
    voices: voices && voices.length > 0 ? voices : null,
  });
}

export async function deleteTtsModels(): Promise<TtsStatus> {
  if (!isTauriTtsRuntime()) {
    return getTtsStatus();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsStatus>("delete_tts_models_cmd");
}

export async function unloadTtsWorker(): Promise<TtsStatus> {
  if (!isTauriTtsRuntime()) {
    return getTtsStatus();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsStatus>("unload_tts_worker_cmd");
}

export async function synthesizeTtsSpeech(
  text: string,
  voiceId?: string
): Promise<TtsSpeechAudio> {
  if (!isTauriTtsRuntime()) {
    throw new Error("La síntesis neural local requiere ejecutar XOOK en escritorio.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TtsSpeechAudio>("synthesize_tts_speech_cmd", {
    text,
    voiceId: voiceId ?? null,
  });
}

export async function subscribeTtsEvents(handlers: {
  onDownloadProgress?: (progress: TtsDownloadProgress) => void;
  onStatusUpdated?: (status: TtsStatus) => void;
}): Promise<() => void> {
  if (!isTauriTtsRuntime()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisteners: Array<() => void> = [];

  if (handlers.onDownloadProgress) {
    unlisteners.push(
      await listen<TtsDownloadProgress>("tts://download-progress", (ev) => {
        handlers.onDownloadProgress?.(ev.payload);
      })
    );
  }
  if (handlers.onStatusUpdated) {
    unlisteners.push(
      await listen<TtsStatus>("tts://status-updated", (ev) => {
        handlers.onStatusUpdated?.(ev.payload);
      })
    );
  }

  return () => {
    for (const fn of unlisteners) fn();
  };
}

function isNonSpeakableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /no hay texto legible|no contiene contenido pronunciable/i.test(msg);
}

type SegmentSynthOutcome =
  | { ok: true; audio: TtsSpeechAudio }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false; error: unknown };

function synthesizeSegmentSafe(
  segment: string,
  voiceId?: string
): Promise<SegmentSynthOutcome> {
  if (!hasSpeakableContent(segment)) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  return synthesizeTtsSpeech(segment, voiceId).then(
    (audio) => ({ ok: true as const, audio }),
    (error) =>
      isNonSpeakableError(error)
        ? { ok: false as const, skipped: true as const }
        : { ok: false as const, skipped: false as const, error }
  );
}

function base64WavToObjectUrl(wavBase64: string, mimeType = "audio/wav"): string {
  const binary = atob(wavBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

interface StreamSpeechSession {
  seq: number;
  messageId: string;
  voiceId?: string;
  consumedRawLen: number;
  lastRawText: string;
  lastNoticeKind: ScreenNoticeKind;
  pendingText: string;
  queuedSegments: string[];
  queuedCharsTotal: number;
  hasQueuedAny: boolean;
  ended: boolean;
  draining: boolean;
  waiters: Array<() => void>;
}

const STREAM_SPEECH_MAX_CHARS = 2200;

class TtsAudioController {
  private snapshot: TtsPlaybackSnapshot = {
    loadingMessageId: null,
    playingMessageId: null,
    error: null,
    isPlaying: false,
  };
  private listeners = new Set<(snap: TtsPlaybackSnapshot) => void>();
  private audioEl: HTMLAudioElement | null = null;
  private activeObjectUrl: string | null = null;
  private playSeq = 0;
  private playbackSpeed = 1.0;
  private streamSession: StreamSpeechSession | null = null;

  getSnapshot(): TtsPlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snap: TtsPlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSpeed(speed: number): void {
    const clamped = Math.min(1.35, Math.max(0.8, speed));
    this.playbackSpeed = clamped;
    if (this.audioEl) {
      this.audioEl.playbackRate = clamped;
      this.audioEl.preservesPitch = true;
    }
  }

  stop(): void {
    this.playSeq += 1;
    const prevStream = this.streamSession;
    this.streamSession = null;
    if (prevStream) {
      prevStream.ended = true;
      this.wakeStreamWaiters(prevStream);
    }
    this.cleanupAudioElement();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignorar en entornos restringidos
      }
    }
    this.updateSnapshot({
      loadingMessageId: null,
      playingMessageId: null,
      error: null,
      isPlaying: false,
    });
  }

  beginStreamSession(
    messageId: string,
    options?: { voiceId?: string; speed?: number }
  ): void {
    this.stop();
    if (typeof options?.speed === "number") {
      this.playbackSpeed = Math.min(1.35, Math.max(0.8, options.speed));
    }
    const seq = ++this.playSeq;
    this.streamSession = {
      seq,
      messageId,
      voiceId: options?.voiceId,
      consumedRawLen: 0,
      lastRawText: "",
      lastNoticeKind: null,
      pendingText: "",
      queuedSegments: [],
      queuedCharsTotal: 0,
      hasQueuedAny: false,
      ended: false,
      draining: false,
      waiters: [],
    };
  }

  private appendCleanChunkToSession(session: StreamSpeechSession, rawChunk: string): void {
    if (!rawChunk || !rawChunk.trim()) return;
    const cleaned = cleanTextForSpeech(rawChunk, {
      streaming: false,
      maxLength: 0,
      preserveTrailingSpace: false,
    });
    if (!cleaned || !hasSpeakableContent(cleaned)) return;

    const noticeKind = detectScreenNoticeKind(cleaned);
    if (noticeKind && session.lastNoticeKind === noticeKind) {
      return;
    }
    session.lastNoticeKind = noticeKind;

    session.pendingText = session.pendingText
      ? `${session.pendingText} ${cleaned}`
      : cleaned;
  }

  pushStreamText(messageId: string, rawAccumulatedText: string): void {
    const session = this.streamSession;
    if (
      !session ||
      session.messageId !== messageId ||
      session.ended ||
      this.playSeq !== session.seq
    ) {
      return;
    }
    if (session.queuedCharsTotal >= STREAM_SPEECH_MAX_CHARS) {
      return;
    }

    const raw = rawAccumulatedText || "";
    // Si el texto crudo se reinició o encogió inesperadamente, alinear offset con seguridad
    if (raw.length < session.consumedRawLen) {
      session.consumedRawLen = raw.length;
    }
    session.lastRawText = raw;

    const safeCutoff = findSafeRawSpeechCutoff(raw, session.consumedRawLen);
    if (safeCutoff > session.consumedRawLen) {
      const completedRaw = raw.slice(session.consumedRawLen, safeCutoff);
      session.consumedRawLen = safeCutoff;
      this.appendCleanChunkToSession(session, completedRaw);
    }

    const pendingTrimmed = session.pendingText.trim();
    const minFlushChars = session.hasQueuedAny ? 160 : 18;
    if (pendingTrimmed.length >= minFlushChars) {
      this.enqueueStreamText(session, pendingTrimmed);
      session.pendingText = "";
    }

    if (session.queuedSegments.length > 0 && !session.draining) {
      void this.drainStreamSession(session);
    } else {
      this.wakeStreamWaiters(session);
    }
  }

  finishStreamSession(
    messageId: string,
    finalRawText: string,
    options?: { voiceId?: string; speed?: number }
  ): boolean {
    if (typeof options?.speed === "number") {
      this.playbackSpeed = Math.min(1.35, Math.max(0.8, options.speed));
    }

    const session = this.streamSession;
    if (!session || session.messageId !== messageId || this.playSeq !== session.seq) {
      const cleanedAll = cleanTextForSpeech(finalRawText);
      if (!cleanedAll || !hasSpeakableContent(cleanedAll)) {
        return false;
      }
      void this.playMessage(messageId, finalRawText, options);
      return true;
    }

    session.ended = true;
    const rawFinal = finalRawText || "";

    // Determinar el remanente no consumido sin duplicar ni cortar palabras
    let rawRemainder = "";
    if (session.consumedRawLen === 0) {
      rawRemainder = rawFinal;
    } else {
      const consumedPrefix = session.lastRawText.slice(0, session.consumedRawLen);
      if (rawFinal.startsWith(consumedPrefix)) {
        rawRemainder = rawFinal.slice(session.consumedRawLen);
      } else {
        const trimmedPrefix = consumedPrefix.trimStart();
        const trimmedFinal = rawFinal.trimStart();
        if (trimmedPrefix && trimmedFinal.startsWith(trimmedPrefix)) {
          rawRemainder = trimmedFinal.slice(trimmedPrefix.length);
        } else if (session.lastRawText.length > session.consumedRawLen) {
          rawRemainder = session.lastRawText.slice(session.consumedRawLen);
        } else if (!session.hasQueuedAny) {
          rawRemainder = rawFinal;
        }
      }
    }

    if (rawRemainder.trim()) {
      this.appendCleanChunkToSession(session, rawRemainder);
    }

    const finalPending = session.pendingText.trim();
    session.pendingText = "";

    if (finalPending && session.queuedCharsTotal < STREAM_SPEECH_MAX_CHARS) {
      this.enqueueStreamText(session, finalPending);
    }

    const hadAnySpeech =
      session.hasQueuedAny ||
      session.queuedSegments.length > 0 ||
      this.snapshot.playingMessageId === messageId ||
      this.snapshot.loadingMessageId === messageId;

    if (!hadAnySpeech) {
      this.stop();
      return false;
    }

    if (session.queuedSegments.length > 0 && !session.draining) {
      void this.drainStreamSession(session);
    } else {
      this.wakeStreamWaiters(session);
    }
    return true;
  }

  private enqueueStreamText(session: StreamSpeechSession, text: string): void {
    const remainingBudget = Math.max(0, STREAM_SPEECH_MAX_CHARS - session.queuedCharsTotal);
    if (remainingBudget <= 0) return;

    const clipped =
      text.length > remainingBudget ? text.slice(0, remainingBudget).trim() : text.trim();
    if (!clipped || !hasSpeakableContent(clipped)) return;

    const pieces = splitSpeechSegments(clipped, session.hasQueuedAny ? 300 : 180, 300);
    for (const piece of pieces) {
      if (!piece || !hasSpeakableContent(piece)) continue;
      session.queuedSegments.push(piece);
      session.queuedCharsTotal += piece.length;
      session.hasQueuedAny = true;
    }
    this.wakeStreamWaiters(session);
  }

  private wakeStreamWaiters(session: StreamSpeechSession): void {
    const pending = session.waiters.splice(0, session.waiters.length);
    for (const resolve of pending) {
      resolve();
    }
  }

  private waitStreamQueue(session: StreamSpeechSession): Promise<void> {
    if (
      session.queuedSegments.length > 0 ||
      session.ended ||
      this.playSeq !== session.seq
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      session.waiters.push(resolve);
    });
  }

  private async drainStreamSession(session: StreamSpeechSession): Promise<void> {
    if (session.draining) return;
    session.draining = true;
    const { seq, messageId, voiceId } = session;

    try {
      let prefetchedNext: Promise<SegmentSynthOutcome> | null = null;
      let hasStartedAudio = false;

      while (this.playSeq === seq) {
        if (session.queuedSegments.length === 0 && !prefetchedNext) {
          if (session.ended) break;
          await this.waitStreamQueue(session);
          continue;
        }

        if (!isTauriTtsRuntime()) {
          const segment = session.queuedSegments.shift();
          if (!segment || !hasSpeakableContent(segment)) continue;
          if (!hasStartedAudio) {
            this.updateSnapshot({
              loadingMessageId: messageId,
              playingMessageId: null,
              error: null,
              isPlaying: false,
            });
          }
          await this.playBrowserFallback(seq, messageId, segment, {
            keepAliveSnapshot: !session.ended || session.queuedSegments.length > 0,
          });
          hasStartedAudio = true;
          continue;
        }

        if (!prefetchedNext) {
          const currentSeg = session.queuedSegments.shift();
          if (!currentSeg || !hasSpeakableContent(currentSeg)) continue;
          if (!hasStartedAudio) {
            this.updateSnapshot({
              loadingMessageId: messageId,
              playingMessageId: null,
              error: null,
              isPlaying: false,
            });
          }
          prefetchedNext = synthesizeSegmentSafe(currentSeg, voiceId);
        }

        const outcome = await prefetchedNext;
        prefetchedNext = null;
        if (this.playSeq !== seq) return;

        if (!outcome.ok) {
          if (outcome.skipped) {
            continue;
          }
          throw outcome.error;
        }

        if (session.queuedSegments.length > 0) {
          const nextSeg = session.queuedSegments.shift()!;
          if (hasSpeakableContent(nextSeg)) {
            prefetchedNext = synthesizeSegmentSafe(nextSeg, voiceId);
          }
        }

        hasStartedAudio = true;
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: messageId,
          error: null,
          isPlaying: true,
        });

        await this.playWavSegment(seq, outcome.audio);
      }

      if (this.playSeq === seq) {
        this.cleanupAudioElement();
        if (this.streamSession?.seq === seq) {
          this.streamSession = null;
        }
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: null,
          error: null,
          isPlaying: false,
        });
      }
    } catch (err) {
      if (this.playSeq !== seq) return;
      this.cleanupAudioElement();
      if (this.streamSession?.seq === seq) {
        this.streamSession = null;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.updateSnapshot({
        loadingMessageId: null,
        playingMessageId: null,
        error: message,
        isPlaying: false,
      });
    } finally {
      session.draining = false;
    }
  }

  async playMessage(
    messageId: string,
    rawText: string,
    options?: { voiceId?: string; speed?: number }
  ): Promise<void> {
    const isSameActive =
      this.snapshot.playingMessageId === messageId ||
      this.snapshot.loadingMessageId === messageId;
    if (isSameActive) {
      this.stop();
      return;
    }

    this.stop();
    if (typeof options?.speed === "number") {
      this.playbackSpeed = Math.min(1.35, Math.max(0.8, options.speed));
    }

    const cleaned = cleanTextForSpeech(rawText);
    if (!cleaned || !hasSpeakableContent(cleaned)) return;

    const seq = ++this.playSeq;
    this.updateSnapshot({
      loadingMessageId: messageId,
      playingMessageId: null,
      error: null,
      isPlaying: false,
    });

    if (!isTauriTtsRuntime()) {
      await this.playBrowserFallback(seq, messageId, cleaned);
      return;
    }

    const segments = splitSpeechSegments(cleaned);
    if (segments.length === 0) {
      this.stop();
      return;
    }

    try {
      let nextPromise: Promise<SegmentSynthOutcome> | null = synthesizeSegmentSafe(
        segments[0],
        options?.voiceId
      );

      for (let i = 0; i < segments.length; i += 1) {
        if (this.playSeq !== seq) return;
        const outcome = await nextPromise!;
        if (this.playSeq !== seq) return;

        // Pre-generar el siguiente fragmento mientras suena el actual
        nextPromise =
          i + 1 < segments.length
            ? synthesizeSegmentSafe(segments[i + 1], options?.voiceId)
            : null;

        if (!outcome.ok) {
          if (outcome.skipped) {
            continue;
          }
          throw outcome.error;
        }

        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: messageId,
          error: null,
          isPlaying: true,
        });

        await this.playWavSegment(seq, outcome.audio);
      }

      if (this.playSeq === seq) {
        this.cleanupAudioElement();
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: null,
          error: null,
          isPlaying: false,
        });
      }
    } catch (err) {
      if (this.playSeq !== seq) return;
      this.cleanupAudioElement();
      const message = err instanceof Error ? err.message : String(err);
      this.updateSnapshot({
        loadingMessageId: null,
        playingMessageId: null,
        error: message,
        isPlaying: false,
      });
    }
  }

  private playWavSegment(seq: number, data: TtsSpeechAudio): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.playSeq !== seq) {
        resolve();
        return;
      }

      this.cleanupAudioElement();
      const url = base64WavToObjectUrl(data.wavBase64, data.mimeType || "audio/wav");
      this.activeObjectUrl = url;

      const audio = new Audio(url);
      this.audioEl = audio;
      audio.playbackRate = this.playbackSpeed;
      audio.preservesPitch = true;

      const settle = (err?: unknown) => {
        audio.onended = null;
        audio.onerror = null;
        if (err) reject(err);
        else resolve();
      };

      audio.onended = () => settle();
      audio.onerror = () => settle(new Error("No se pudo reproducir el audio generado."));

      audio.play().catch((err) => settle(err));
    });
  }

  private playBrowserFallback(
    seq: number,
    messageId: string,
    cleaned: string,
    options?: { keepAliveSnapshot?: boolean }
  ): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: null,
          error: "El navegador no soporta síntesis de audio.",
          isPlaying: false,
        });
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(cleaned);
      utter.lang = "es-MX";
      utter.rate = this.playbackSpeed;
      utter.onstart = () => {
        if (this.playSeq !== seq) return;
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: messageId,
          error: null,
          isPlaying: true,
        });
      };
      utter.onend = () => {
        if (this.playSeq === seq && !options?.keepAliveSnapshot) {
          this.updateSnapshot({
            loadingMessageId: null,
            playingMessageId: null,
            error: null,
            isPlaying: false,
          });
        }
        resolve();
      };
      utter.onerror = () => {
        if (this.playSeq === seq && !options?.keepAliveSnapshot) {
          this.updateSnapshot({
            loadingMessageId: null,
            playingMessageId: null,
            error: null,
            isPlaying: false,
          });
        }
        resolve();
      };
      window.speechSynthesis.speak(utter);
    });
  }

  private cleanupAudioElement(): void {
    if (this.audioEl) {
      this.audioEl.onended = null;
      this.audioEl.onerror = null;
      try {
        this.audioEl.pause();
      } catch {
        // Ignorar
      }
      this.audioEl = null;
    }
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
  }

  private updateSnapshot(next: TtsPlaybackSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

export const ttsPlayer = new TtsAudioController();
