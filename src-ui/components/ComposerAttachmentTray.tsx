import React from "react";
import {
  FileCode2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  X,
} from "lucide-react";
import {
  type ComposerAttachmentItem,
  derivePastedSnippetPreview,
  formatCompactCount,
  formatFileSize,
} from "../features/ai-service/composerAttachments";

interface ComposerAttachmentTrayProps {
  items: ComposerAttachmentItem[];
  onRemove: (id: string) => void;
  onInspect: (item: ComposerAttachmentItem) => void;
  compact?: boolean;
  disabled?: boolean;
}

export const ComposerAttachmentTray: React.FC<ComposerAttachmentTrayProps> = ({
  items,
  onRemove,
  onInspect,
  compact = false,
  disabled = false,
}) => {
  if (items.length === 0) return null;

  const imageSizeClass = compact ? "w-[64px] h-[64px]" : "w-[108px] h-[108px]";
  const pastedSizeClass = compact ? "w-[138px] h-[64px]" : "w-[128px] h-[108px]";
  const fileSizeClass = compact ? "w-[138px] h-[64px]" : "w-[128px] h-[108px]";

  return (
    <div
      role="list"
      aria-label="Adjuntos y textos pegados"
      className={`flex flex-wrap items-stretch ${
        compact
          ? "gap-2.5 px-2 pt-2 pb-1.5 max-h-[156px]"
          : "gap-3 px-2 pt-2.5 pb-2 max-h-[256px]"
      } overflow-y-auto xook-scroll`}
    >
      {items.map((item) => {
        if (item.kind === "image") {
          const previewSrc = item.objectUrl || item.thumbUrl;
          return (
            <div
              key={item.id}
              role="listitem"
              className={`xook-att-card toast-in group/att relative shrink-0 ${imageSizeClass} rounded-2xl`}
            >
              <button
                type="button"
                onClick={() => onInspect(item)}
                title={`${item.name}${
                  item.width && item.height ? ` (${item.width}×${item.height})` : ""
                } · Clic para ampliar`}
                aria-label={`Ver imagen ${item.name}`}
                className="relative block w-full h-full rounded-[inherit] overflow-hidden border border-white/[0.13] bg-[#0c0e14]/90 hover:border-white/[0.28] transition-[border-color,transform] duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2"
              >
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt={item.name}
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-200 group-hover/att:scale-[1.03]"
                  />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-sky-300/80">
                    <ImageIcon className="w-6 h-6" aria-hidden="true" />
                  </span>
                )}
              </button>

              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  aria-label={`Quitar imagen ${item.name}`}
                  title={`Quitar ${item.name}`}
                  className="xook-att-remove absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-[#11131a]/95 hover:bg-zinc-900 border border-white/[0.22] hover:border-white/[0.42] text-zinc-200 hover:text-white flex items-center justify-center shadow-md cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-white/85"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        }

        if (item.kind === "pasted_text") {
          const snippet = derivePastedSnippetPreview(item.content);
          const statTooltip = `${item.lineCount} ${
            item.lineCount === 1 ? "línea" : "líneas"
          } · ${item.charCount.toLocaleString()} caracteres`;

          return (
            <div
              key={item.id}
              role="listitem"
              className={`xook-att-card toast-in group/att relative shrink-0 ${pastedSizeClass} rounded-2xl`}
            >
              <button
                type="button"
                onClick={() => onInspect(item)}
                title={`${item.name} (${statTooltip}) · Clic para ver o editar`}
                aria-label={`Ver o editar texto pegado: ${item.name} (${item.charCount} caracteres)`}
                className={`w-full h-full rounded-[inherit] border border-white/[0.12] hover:border-white/[0.24] bg-[#0c0e14]/92 hover:bg-[#11141d]/95 text-left flex flex-col justify-between ${
                  compact ? "p-2" : "p-2.5"
                } overflow-hidden transition-[border-color,background-color] duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80 focus-visible:outline-offset-2`}
              >
                <div className="relative flex-1 min-h-0 overflow-hidden">
                  <p
                    className={`${
                      compact
                        ? "text-[9.5px] leading-[1.3] line-clamp-2"
                        : "text-[10.5px] leading-[1.36] line-clamp-4"
                    } text-zinc-300/85 whitespace-pre-wrap break-words font-normal`}
                  >
                    {snippet}
                  </p>
                  <div
                    aria-hidden="true"
                    className="xook-att-text-fade pointer-events-none absolute inset-x-0 bottom-0 h-3.5"
                  />
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-1.5 shrink-0">
                  <span
                    title={statTooltip}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.08] border border-white/[0.09] text-[9px] font-semibold uppercase tracking-[0.06em] text-zinc-300 shrink-0"
                  >
                    PEGADO
                  </span>
                  {compact ? (
                    <span className="text-[9px] font-mono text-zinc-400 tabular-nums truncate">
                      {formatCompactCount(item.charCount)}
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="w-6 h-6 rounded-lg bg-white/[0.08] group-hover/att:bg-white/[0.14] border border-white/[0.1] flex items-center justify-center text-zinc-300 group-hover/att:text-white transition-colors shrink-0"
                    >
                      <Pencil className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </button>

              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  aria-label={`Quitar texto pegado ${item.name}`}
                  title="Quitar texto pegado"
                  className="xook-att-remove absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-[#11131a]/95 hover:bg-zinc-900 border border-white/[0.22] hover:border-white/[0.42] text-zinc-200 hover:text-white flex items-center justify-center shadow-md cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-white/85"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        }

        // PDF / Texto / Binario
        const sizeLabel = formatFileSize(item.sizeBytes);
        return (
          <div
            key={item.id}
            role="listitem"
            className={`xook-att-card toast-in group/att relative shrink-0 ${fileSizeClass} rounded-2xl`}
          >
            <div
              title={`${item.name}${sizeLabel ? ` · ${sizeLabel}` : ""}`}
              className={`w-full h-full rounded-[inherit] border border-white/[0.12] bg-[#0c0e14]/92 flex flex-col justify-between ${
                compact ? "p-2" : "p-2.5"
              } overflow-hidden`}
            >
              <div className="flex flex-col gap-1.5 min-w-0">
                <span
                  className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 ${
                    item.kind === "pdf"
                      ? "bg-rose-500/12 border-rose-400/25 text-rose-300"
                      : item.kind === "text"
                        ? "bg-sky-500/12 border-sky-400/25 text-sky-300"
                        : "bg-white/[0.06] border-white/[0.12] text-zinc-300"
                  }`}
                >
                  {item.kind === "pdf" ? (
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : item.kind === "text" ? (
                    <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </span>
                <span
                  className={`${
                    compact ? "text-[10px] line-clamp-1" : "text-[10.5px] line-clamp-2"
                  } font-medium text-zinc-200 leading-snug break-all`}
                >
                  {item.name}
                </span>
              </div>

              <div className="flex items-center justify-between gap-1.5 pt-1 shrink-0">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/[0.08] border border-white/[0.09] text-[8.5px] font-semibold uppercase tracking-[0.06em] text-zinc-200 shrink-0">
                  {item.ext}
                </span>
                {sizeLabel && (
                  <span className="text-[9px] font-mono text-zinc-400 tabular-nums truncate">
                    {sizeLabel}
                  </span>
                )}
              </div>
            </div>

            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                aria-label={`Quitar archivo ${item.name}`}
                title={`Quitar ${item.name}`}
                className="xook-att-remove absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-[#11131a]/95 hover:bg-zinc-900 border border-white/[0.22] hover:border-white/[0.42] text-zinc-200 hover:text-white flex items-center justify-center shadow-md cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-white/85"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
