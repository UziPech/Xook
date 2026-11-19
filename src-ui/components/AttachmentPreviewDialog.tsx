import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowDownToLine, Check, Copy, Trash2, X } from "lucide-react";
import { LiquidGlassBackdrop } from "./LiquidGlassBackdrop";
import { waitTopLayerAnimations } from "../utils/topLayerDialog";
import {
  type AttachmentPreviewTarget,
  normalizePastedText,
} from "../features/ai-service/composerAttachments";

interface AttachmentPreviewDialogProps {
  target: AttachmentPreviewTarget | null;
  onClose: () => void;
  onSavePastedText?: (id: string, nextContent: string) => void;
  onUnwrapPastedText?: (id: string, content: string) => void;
  onRemoveAttachment?: (id: string) => void;
}

export const AttachmentPreviewDialog: React.FC<AttachmentPreviewDialogProps> = ({
  target,
  onClose,
  onSavePastedText,
  onUnwrapPastedText,
  onRemoveAttachment,
}) => {
  const isOpen = target !== null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const closeSeqRef = useRef(0);
  const pressedOutsideRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  isOpenRef.current = isOpen;
  onCloseRef.current = onClose;

  const lastTargetRef = useRef<AttachmentPreviewTarget | null>(target);
  if (target) lastTargetRef.current = target;
  const displayTarget = target ?? lastTargetRef.current;

  const [dialogRendered, setDialogRendered] = useState(isOpen);
  const [draftText, setDraftText] = useState("");
  const [copied, setCopied] = useState(false);

  const titleId = useId();
  const editorId = useId();
  const shouldRenderBody = (isOpen || dialogRendered) && displayTarget !== null;

  useEffect(() => {
    if (target?.kind === "pasted_text") {
      setDraftText(target.content);
    }
    setCopied(false);
  }, [target]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      if (target?.kind === "pasted_text" && target.editable) {
        const focusTimer = window.setTimeout(() => {
          editorRef.current?.focus({ preventScroll: true });
        }, 80);
        return () => window.clearTimeout(focusTimer);
      }
      const closeFocusTimer = window.setTimeout(() => {
        closeBtnRef.current?.focus({ preventScroll: true });
      }, 40);
      return () => window.clearTimeout(closeFocusTimer);
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
  }, [isOpen, target?.kind, target?.kind === "pasted_text" ? target.editable : false]);

  const activeTextStats =
    displayTarget?.kind === "pasted_text"
      ? normalizePastedText(displayTarget.editable ? draftText : displayTarget.content)
      : null;

  const isDirty =
    displayTarget?.kind === "pasted_text" &&
    displayTarget.editable &&
    draftText.replace(/\r\n?/g, "\n") !== displayTarget.content;

  const handleCopy = async () => {
    if (displayTarget?.kind !== "pasted_text") return;
    const textToCopy = displayTarget.editable ? draftText : displayTarget.content;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignorar si clipboard no está disponible
    }
  };

  const handleSaveAndClose = () => {
    if (
      displayTarget?.kind === "pasted_text" &&
      displayTarget.editable &&
      displayTarget.id &&
      onSavePastedText
    ) {
      const cleaned = draftText.replace(/\r\n?/g, "\n");
      if (!cleaned.trim() && onRemoveAttachment) {
        onRemoveAttachment(displayTarget.id);
      } else {
        onSavePastedText(displayTarget.id, cleaned);
      }
    }
    onClose();
  };

  const handleUnwrap = () => {
    if (
      displayTarget?.kind === "pasted_text" &&
      displayTarget.editable &&
      displayTarget.id &&
      onUnwrapPastedText
    ) {
      onUnwrapPastedText(displayTarget.id, draftText);
      onClose();
    }
  };

  const handleRemove = () => {
    if (displayTarget?.id && onRemoveAttachment) {
      onRemoveAttachment(displayTarget.id);
      onClose();
    }
  };

  const isImage = displayTarget?.kind === "image";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
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
      className={`xook-liquid-dialog xook-att-preview-dialog ${
        isImage ? "is-image-mode" : "is-text-mode"
      } select-none`}
    >
      {shouldRenderBody && displayTarget && (
        <>
          {displayTarget.kind === "image" ? (
            <div className="relative flex items-center justify-center bg-black/50">
              <h2 id={titleId} className="sr-only">
                {displayTarget.name}
              </h2>

              <img
                src={displayTarget.src}
                alt={displayTarget.name}
                className="block max-w-[min(76rem,calc(100vw-3rem))] max-h-[88vh] w-auto h-auto object-contain select-none"
              />

              {/* Controles flotantes mínimos en la esquina superior derecha; Cerrar es la acción segura prioritaria */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
                {displayTarget.removable && displayTarget.id && onRemoveAttachment && (
                  <button
                    type="button"
                    onClick={handleRemove}
                    aria-label="Quitar imagen"
                    title="Quitar imagen"
                    className="w-7 h-7 rounded-full bg-black/45 hover:bg-rose-500/75 backdrop-blur-md border border-white/[0.1] hover:border-rose-300/35 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 focus-visible:outline-offset-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
                <button
                  ref={closeBtnRef}
                  type="button"
                  autoFocus
                  onClick={onClose}
                  aria-label="Cerrar vista previa"
                  title="Cerrar (Esc)"
                  className="w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur-md border border-white/[0.2] text-white flex items-center justify-center shadow-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/55 focus-visible:outline-offset-2"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <LiquidGlassBackdrop variant="menu" />

              {/* Cabecera ultradelgada: solo métricas discretas y acciones compactas */}
              <header className="relative z-[1] px-4 py-2.5 flex items-center justify-between gap-3 border-b border-white/[0.07] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 id={titleId} className="sr-only">
                    {displayTarget.name}
                  </h2>
                  <span className="text-[11px] font-mono text-zinc-400 tabular-nums truncate">
                    {activeTextStats
                      ? `${activeTextStats.lineCount.toLocaleString()} ${
                          activeTextStats.lineCount === 1 ? "línea" : "líneas"
                        } · ${activeTextStats.charCount.toLocaleString()} car.`
                      : ""}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    aria-label={copied ? "Copiado" : "Copiar texto"}
                    title={copied ? "Copiado" : "Copiar"}
                    className="h-7 px-2.5 rounded-full bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.09] text-[11px] text-zinc-300 hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{copied ? "Copiado" : "Copiar"}</span>
                  </button>

                  {displayTarget.editable && displayTarget.id && onUnwrapPastedText && (
                    <button
                      type="button"
                      onClick={handleUnwrap}
                      aria-label="Mover al campo de mensaje"
                      title="Mover al campo de mensaje"
                      className="w-7 h-7 rounded-full bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.09] text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/80"
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}

                  {displayTarget.editable && displayTarget.id && onRemoveAttachment && (
                    <button
                      type="button"
                      onClick={handleRemove}
                      aria-label="Quitar texto pegado"
                      title="Quitar"
                      className="w-7 h-7 rounded-full bg-transparent hover:bg-rose-500/18 border border-transparent hover:border-rose-400/25 text-zinc-500 hover:text-rose-200 flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}

                  <button
                    ref={!displayTarget.editable ? closeBtnRef : undefined}
                    type="button"
                    autoFocus={!displayTarget.editable}
                    onClick={onClose}
                    aria-label="Cerrar vista previa"
                    title="Cerrar (Esc)"
                    className="w-7 h-7 ml-0.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.12] text-zinc-100 hover:text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/55"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </header>

              {/* Superficie de texto limpia a pantalla completa del modal (sin cajas anidadas) */}
              {displayTarget.editable ? (
                <div className="relative z-[1] flex-1 min-h-0 flex flex-col">
                  <label htmlFor={editorId} className="sr-only">
                    Contenido del texto pegado
                  </label>
                  <textarea
                    id={editorId}
                    ref={editorRef}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleSaveAndClose();
                      }
                    }}
                    spellCheck={false}
                    className="w-full flex-1 min-h-[260px] bg-transparent px-5 py-4 text-[13.5px] leading-relaxed font-mono text-zinc-100 focus:outline-none resize-none overflow-y-auto xook-scroll select-text"
                  />
                  {isDirty && (
                    <div className="px-4 py-2.5 border-t border-white/[0.07] flex items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onClose}
                        className="h-7 px-3 rounded-full text-[11.5px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveAndClose}
                        className="quick-liquid-btn-ready h-7 px-3.5 rounded-full text-[11.5px] font-medium text-white cursor-pointer"
                      >
                        Guardar
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative z-[1] flex-1 min-h-0 overflow-y-auto xook-scroll">
                  <pre className="w-full px-5 py-4 text-[13.5px] leading-relaxed font-mono text-zinc-200 whitespace-pre-wrap break-words select-text">
                    {displayTarget.content}
                  </pre>
                </div>
              )}
            </>
          )}
        </>
      )}
    </dialog>
  );
};
