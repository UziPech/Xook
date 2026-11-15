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

interface CleanSpeechOptions {
  streaming?: boolean;
  maxLength?: number;
  preserveTrailingSpace?: boolean;
}

export function cleanTextForSpeech(raw: string, opts?: CleanSpeechOptions): string {
  const streaming = Boolean(opts?.streaming);
  const maxLength = opts?.maxLength ?? 1800;
  let text = raw || "";

  // Eliminar bloques de razonamiento completos y, en streaming, bloques aún abiertos
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, " ");
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, " ");
  if (streaming) {
    text = text.replace(/<(?:think|thought)\b[\s\S]*$/gi, "");
  }

  // Bloques de código cerrados y, en streaming, bloques aún abiertos al final
  text = text.replace(/```[\s\S]*?```/g, " consulta el bloque de código en pantalla. ");
  if (streaming) {
    text = text.replace(/```[\s\S]*$/g, "");
  }

  // Tablas markdown: evitar leer barras verticales o líneas de guiones
  text = text.replace(/^\|?[\s:|-]+\|[\s:|-]*$/gm, " ");
  text = text.replace(/\|+/g, " ");

  // Enlaces e imágenes: esperar al cierre cuando está en streaming
  if (streaming) {
    text = text.replace(/!?\[[^\]]*(?:\]\([^)]*)?$/g, "");
    text = text.replace(/https?:\/\/\S+$/g, "");
    text = text.replace(/\n\s*(?:\d+[.)]?|[-*•#]+)\s*$/g, "\n");
  }
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => alt || "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/g, "enlace en pantalla");

  // Formato inline y encabezados/listas (quitar backticks sueltos para estabilidad en stream)
  text = text.replace(/`/g, "");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*•]+|\d+[.)])\s+/gm, "");
  text = text.replace(/[-_]{3,}/g, " ");
  text = text.replace(/\*\*/g, "").replace(/__/g, "").replace(/~~/g, "");

  const hadTrailingSpace = /\s$/.test(text);
  text = text.replace(/\s+/g, " ");
  text = opts?.preserveTrailingSpace && hadTrailingSpace ? `${text.trimStart()}` : text.trim();

  if (maxLength > 0 && text.length > maxLength) {
    const slice = text.slice(0, maxLength);
    const punct = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
    text = punct > 400 ? slice.slice(0, punct + 1) : `${slice.trim()}...`;
  }
  return text;
}

function splitSpeechSegments(
  cleanText: string,
  firstMaxChars = 210,
  nextMaxChars = 380
): string[] {
  const sentences = cleanText
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [];
  const segments: string[] = [];
  let buf = "";

  for (const s of sentences) {
    const limit = segments.length === 0 ? firstMaxChars : nextMaxChars;
    if (!buf) {
      buf = s;
    } else if (buf.length + 1 + s.length <= limit) {
      buf = `${buf} ${s}`;
    } else {
      segments.push(buf);
      buf = s;
    }
  }
  if (buf) segments.push(buf);
  return segments;
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
  consumedLen: number;
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
      consumedLen: 0,
      pendingText: "",
      queuedSegments: [],
      queuedCharsTotal: 0,
      hasQueuedAny: false,
      ended: false,
      draining: false,
      waiters: [],
    };
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

    const norm = cleanTextForSpeech(rawAccumulatedText, {
      streaming: true,
      maxLength: 0,
      preserveTrailingSpace: true,
    });
    if (norm.length < session.consumedLen) {
      session.consumedLen = norm.length;
    }

    const tail = norm.slice(session.consumedLen);
    const boundaryRe = /[.!?…](?=\s)/g;
    let lastCut = 0;
    let match: RegExpExecArray | null = null;
    while ((match = boundaryRe.exec(tail)) !== null) {
      const sentence = tail.slice(lastCut, match.index + 1).trim();
      let nextPos = match.index + 1;
      while (nextPos < tail.length && /\s/.test(tail[nextPos])) {
        nextPos += 1;
      }
      lastCut = nextPos;
      if (sentence) {
        session.pendingText = session.pendingText
          ? `${session.pendingText} ${sentence}`
          : sentence;
      }
    }

    if (lastCut > 0) {
      session.consumedLen += lastCut;
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

    let session = this.streamSession;
    if (!session || session.messageId !== messageId || this.playSeq !== session.seq) {
      const cleanedAll = cleanTextForSpeech(finalRawText);
      if (!cleanedAll) {
        return false;
      }
      void this.playMessage(messageId, finalRawText, options);
      return true;
    }

    session.ended = true;
    const cleanedFinal = cleanTextForSpeech(finalRawText, {
      streaming: false,
      maxLength: STREAM_SPEECH_MAX_CHARS,
      preserveTrailingSpace: false,
    });

    const remainder =
      session.consumedLen < cleanedFinal.length
        ? cleanedFinal.slice(session.consumedLen).trim()
        : "";
    const finalPending = [session.pendingText.trim(), remainder]
      .filter(Boolean)
      .join(" ")
      .trim();
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
    if (!clipped) return;

    const pieces = splitSpeechSegments(clipped, session.hasQueuedAny ? 320 : 180, 320);
    for (const piece of pieces) {
      if (!piece) continue;
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
      let prefetchedNext: Promise<TtsSpeechAudio> | null = null;
      let hasStartedAudio = false;

      while (this.playSeq === seq) {
        if (session.queuedSegments.length === 0 && !prefetchedNext) {
          if (session.ended) break;
          await this.waitStreamQueue(session);
          continue;
        }

        if (!isTauriTtsRuntime()) {
          const segment = session.queuedSegments.shift();
          if (!segment) continue;
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
          if (!currentSeg) continue;
          if (!hasStartedAudio) {
            this.updateSnapshot({
              loadingMessageId: messageId,
              playingMessageId: null,
              error: null,
              isPlaying: false,
            });
          }
          prefetchedNext = synthesizeTtsSpeech(currentSeg, voiceId);
        }

        const audioData = await prefetchedNext;
        prefetchedNext = null;
        if (this.playSeq !== seq) return;

        if (session.queuedSegments.length > 0) {
          const nextSeg = session.queuedSegments.shift()!;
          prefetchedNext = synthesizeTtsSpeech(nextSeg, voiceId);
        }

        hasStartedAudio = true;
        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: messageId,
          error: null,
          isPlaying: true,
        });

        await this.playWavSegment(seq, audioData);
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
    if (!cleaned) return;

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
      let nextPromise: Promise<TtsSpeechAudio> | null = synthesizeTtsSpeech(
        segments[0],
        options?.voiceId
      );

      for (let i = 0; i < segments.length; i += 1) {
        if (this.playSeq !== seq) return;
        const audioData = await nextPromise!;
        if (this.playSeq !== seq) return;

        // Pre-generar el siguiente fragmento mientras suena el actual
        nextPromise =
          i + 1 < segments.length
            ? synthesizeTtsSpeech(segments[i + 1], options?.voiceId)
            : null;

        this.updateSnapshot({
          loadingMessageId: null,
          playingMessageId: messageId,
          error: null,
          isPlaying: true,
        });

        await this.playWavSegment(seq, audioData);
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
