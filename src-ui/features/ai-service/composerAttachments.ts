export const PASTE_CARD_CHAR_THRESHOLD = 450;
export const PASTE_CARD_LINE_THRESHOLD = 8;

const BINARY_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;

export type ComposerImageAttachment = {
  id: string;
  kind: "image";
  name: string;
  file: File;
  /** Object URL instantáneo para vista previa inmediata en el composer */
  objectUrl: string;
  /** Miniatura JPEG ligera y persistible para la burbuja enviada */
  thumbUrl?: string;
  /** Imagen escalada (<=1408px) para enviar al modelo multimodal */
  imageDataUrl?: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  mimeType: string;
};

export type ComposerPastedTextAttachment = {
  id: string;
  kind: "pasted_text";
  name: string;
  content: string;
  charCount: number;
  lineCount: number;
  createdAt: number;
};

export type ComposerFileAttachment = {
  id: string;
  kind: "pdf" | "text" | "binary";
  name: string;
  file: File;
  sizeBytes: number;
  mimeType: string;
  ext: string;
};

export type ComposerAttachmentItem =
  | ComposerImageAttachment
  | ComposerPastedTextAttachment
  | ComposerFileAttachment;

export type AttachmentPreviewTarget =
  | {
      kind: "pasted_text";
      id?: string;
      name: string;
      content: string;
      charCount: number;
      lineCount: number;
      editable: boolean;
    }
  | {
      kind: "image";
      id?: string;
      name: string;
      src: string;
      width?: number;
      height?: number;
      sizeBytes?: number;
      removable: boolean;
    };

function makeAttachmentId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function classifyAttachmentFile(
  file: Pick<File, "name" | "type">
): "pdf" | "image" | "text" | "binary" {
  const name = (file.name || "").trim();
  const mime = (file.type || "").toLowerCase();
  if (/\.pdf$/i.test(name) || mime === "application/pdf") return "pdf";
  if (BINARY_IMAGE_EXT_RE.test(name) || mime.startsWith("image/")) return "image";
  if (
    /^(text\/|application\/(json|csv|xml|javascript))/.test(mime) ||
    /\.(txt|md|json|csv|tsv|log|yaml|yml|xml|ts|tsx|js|jsx|py|rs|sql|html|css|sh)$/i.test(name)
  ) {
    return "text";
  }
  return "binary";
}

export function normalizePastedText(rawText: string): {
  content: string;
  charCount: number;
  lineCount: number;
} {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  return {
    content: normalized,
    charCount: normalized.length,
    lineCount: lines.length,
  };
}

export function shouldGroupPastedText(rawText: string): boolean {
  if (!rawText) return false;
  const { content, charCount, lineCount } = normalizePastedText(rawText);
  if (!content.trim()) return false;
  return charCount >= PASTE_CARD_CHAR_THRESHOLD || lineCount >= PASTE_CARD_LINE_THRESHOLD;
}

export function formatCompactCount(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function derivePastedSnippetPreview(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return trimmed
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && idx < arr.length - 1))
    .slice(0, 5)
    .join("\n")
    .slice(0, 260);
}

export function derivePastedCardTitle(content: string, index: number): string {
  const firstMeaningful = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstMeaningful) return `Texto pegado ${index}`;
  const clean = firstMeaningful.replace(/\s+/g, " ").replace(/^[#>*\-•\s]+/, "").trim();
  if (!clean) return `Texto pegado ${index}`;
  return clean.length > 36 ? `${clean.slice(0, 34).trim()}…` : clean;
}

function getExtensionFromMime(mime: string): string {
  const lower = (mime || "").toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  if (lower.includes("heic")) return "heic";
  if (lower.includes("pdf")) return "pdf";
  return "png";
}

function normalizeClipboardFileName(file: File, imageIdx: number): string {
  const raw = (file.name || "").trim();
  const isGeneric = !raw || /^image\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(raw);
  if (!isGeneric) return raw;
  const ext = getExtensionFromMime(file.type);
  return `Imagen ${imageIdx}.${ext}`;
}

export function extractClipboardPayload(clipboardData: DataTransfer | null): {
  files: File[];
  text: string;
} {
  if (!clipboardData) return { files: [], text: "" };

  const text = clipboardData.getData("text/plain") || "";
  const directFiles = Array.from(clipboardData.files ?? []);
  let files: File[] = directFiles;

  // En macOS WKWebView / Safari, a veces las capturas pegadas solo aparecen en clipboardData.items
  if (files.length === 0 && clipboardData.items?.length) {
    const extracted: File[] = [];
    for (const item of Array.from(clipboardData.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) extracted.push(f);
      }
    }
    files = extracted;
  }

  // Evita que al copiar celdas de Excel/Word/Pages (que incluyen text/plain + text/html + image.png sintética)
  // se pegue la captura en lugar del texto real copiado.
  if (files.length > 0 && text.trim().length > 0) {
    const types = Array.from(clipboardData.types ?? []);
    const allSyntheticImages = files.every(
      (f) =>
        (f.type || "").toLowerCase().startsWith("image/") &&
        (!f.name || /^image\.(png|jpe?g|tiff?|bmp)$/i.test(f.name.trim()))
    );
    const textMatchesFileName = files.some(
      (f) => f.name && text.trim().toLowerCase() === f.name.trim().toLowerCase()
    );
    if (allSyntheticImages && !textMatchesFileName && types.includes("text/html")) {
      return { files: [], text };
    }
  }

  return { files, text };
}

export function createComposerFileItems(
  files: File[],
  existingImageCount = 0
): ComposerAttachmentItem[] {
  let imgCounter = existingImageCount;
  return files.map((file) => {
    const kind = classifyAttachmentFile(file);
    if (kind === "image") {
      imgCounter += 1;
      const displayName = normalizeClipboardFileName(file, imgCounter);
      const objectUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(file)
          : "";
      return {
        id: makeAttachmentId("img"),
        kind: "image",
        name: displayName,
        file,
        objectUrl,
        sizeBytes: file.size,
        mimeType: file.type || "image/png",
      };
    }

    const rawName = (file.name || "archivo").trim();
    const ext = rawName.includes(".")
      ? (rawName.split(".").pop() || "").toUpperCase().slice(0, 6)
      : kind === "pdf"
        ? "PDF"
        : "FILE";

    return {
      id: makeAttachmentId("file"),
      kind,
      name: rawName,
      file,
      sizeBytes: file.size,
      mimeType: file.type || (kind === "pdf" ? "application/pdf" : "application/octet-stream"),
      ext,
    };
  });
}

export function createPastedTextItem(
  rawText: string,
  existingPastedCount = 0
): ComposerPastedTextAttachment {
  const { content, charCount, lineCount } = normalizePastedText(rawText);
  return {
    id: makeAttachmentId("paste"),
    kind: "pasted_text",
    name: derivePastedCardTitle(content, existingPastedCount + 1),
    content,
    charCount,
    lineCount,
    createdAt: Date.now(),
  };
}

export function revokeComposerAttachments(items: ComposerAttachmentItem[]): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  for (const item of items) {
    if (item.kind === "image" && item.objectUrl) {
      try {
        URL.revokeObjectURL(item.objectUrl);
      } catch {
        // Ignorar si ya fue revocado
      }
    }
  }
}

export async function prepareImagePayload(file: File): Promise<{
  imageDataUrl?: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
}> {
  if (typeof window === "undefined") return {};
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_decode_failed"));
      el.src = objUrl;
    });
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return {};

    const renderScaled = (maxDim: number, forceJpeg: boolean): string | undefined => {
      const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
      const w = Math.max(1, Math.round(naturalW * scale));
      const h = Math.max(1, Math.round(naturalH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, w, h);
      const keepPng =
        !forceJpeg &&
        (/\.(png|webp|gif)$/i.test(file.name) ||
          /image\/(png|webp|gif)/i.test(file.type || ""));
      return keepPng
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", forceJpeg ? 0.82 : 0.85);
    };

    const imageDataUrl = renderScaled(1408, false);
    const thumbUrl = renderScaled(360, true);
    return { imageDataUrl, thumbUrl, width: naturalW, height: naturalH };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export function composeLlmMessageWithPastedText(
  typedPrompt: string,
  pastedItems: Array<{ name: string; content: string }>,
  otherAttachments: Array<{ name: string; kind: "image" | "pdf" | "text" | "binary" }>
): string {
  const cleanPrompt = typedPrompt.trim();
  const pastedBlocks = pastedItems
    .map((p, idx) => {
      const safeLabel = (p.name || `Texto pegado ${idx + 1}`).replace(/"/g, "'");
      return `<texto_pegado titulo="${safeLabel}">\n${p.content}\n</texto_pegado>`;
    })
    .join("\n\n");

  if (pastedBlocks && cleanPrompt) {
    return `${pastedBlocks}\n\n${cleanPrompt}`;
  }
  if (pastedBlocks) {
    return pastedBlocks;
  }
  if (cleanPrompt) {
    return cleanPrompt;
  }

  if (otherAttachments.length === 1) {
    const first = otherAttachments[0];
    if (first.kind === "image") {
      return `Analiza esta imagen adjunta (${first.name}).`;
    }
    return `Analiza el archivo adjunto (${first.name}).`;
  }
  if (otherAttachments.length > 1) {
    const allImages = otherAttachments.every((a) => a.kind === "image");
    return allImages
      ? `Analiza las ${otherAttachments.length} imágenes adjuntas.`
      : `Analiza los ${otherAttachments.length} archivos adjuntos.`;
  }
  return "";
}
