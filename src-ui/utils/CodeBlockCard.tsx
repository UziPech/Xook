import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CircleArrowDown, Copy } from "lucide-react";
import type { Element as HastElement, RootContent } from "hast";
import {
  ensureFullLanguagesLoaded,
  highlightCodeToHast,
  isFullLanguagePackLoaded,
  suggestCodeFilename,
} from "./codeLanguages";
import { downloadCodeArtifact } from "../features/workspace-store/workspaceApi";

declare module "react" {
  interface HTMLAttributes<T> {
    focusgroup?: string;
  }
  interface ButtonHTMLAttributes<T> {
    command?: string;
    commandfor?: string;
  }
}

export interface HighlightedCodeContentProps {
  code: string;
  language?: string | null;
  filenameHint?: string;
  compact?: boolean;
  wrapLines?: boolean;
  tailCaret?: React.ReactNode;
  codeElementId?: string;
  preRef?: React.RefObject<HTMLPreElement | null>;
  className?: string;
  onResolvedMeta?: (meta: { canonicalId: string; displayName: string; extension: string }) => void;
}

export interface CodeBlockCardProps {
  code: string;
  language?: string | null;
  filenameHint?: string;
  variant?: "default" | "liquid";
  compact?: boolean;
  wrapLines?: boolean;
  tailCaret?: React.ReactNode;
  showDownload?: boolean;
}

function renderHastNodes(nodes: RootContent[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "text") {
      return node.value;
    }
    if (node.type === "element") {
      const el = node as HastElement;
      const classList = el.properties?.className;
      const className = Array.isArray(classList)
        ? classList.filter((c): c is string => typeof c === "string").join(" ")
        : typeof classList === "string"
        ? classList
        : undefined;
      return (
        <span key={key} className={className}>
          {renderHastNodes(el.children as RootContent[], key)}
        </span>
      );
    }
    return null;
  });
}

function copyTextFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

/**
 * Syntax-highlighted <pre><code> renderer powered by lowlight (HAST -> React elements, zero innerHTML).
 * Automatically upgrades once lazy extended grammars finish loading if needed.
 */
export const HighlightedCodeContent: React.FC<HighlightedCodeContentProps> = ({
  code,
  language,
  filenameHint,
  compact = false,
  wrapLines = false,
  tailCaret,
  codeElementId,
  preRef,
  className = "",
  onResolvedMeta,
}) => {
  const [packTick, setPackTick] = useState(0);

  const result = useMemo(
    () => highlightCodeToHast(code, language, filenameHint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, language, filenameHint, packTick]
  );

  useEffect(() => {
    onResolvedMeta?.({
      canonicalId: result.canonicalId,
      displayName: result.displayName,
      extension: result.extension,
    });
  }, [result.canonicalId, result.displayName, result.extension, onResolvedMeta]);

  useEffect(() => {
    if (!result.needsExtendedPack || isFullLanguagePackLoaded()) return;
    let cancelled = false;
    void ensureFullLanguagesLoaded().then((loaded) => {
      if (!cancelled && loaded) {
        setPackTick((t) => t + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [result.needsExtendedPack]);

  const children = useMemo(
    () => renderHastNodes(result.hast.children, "h"),
    [result.hast]
  );

  return (
    <pre
      ref={preRef}
      id={codeElementId}
      tabIndex={0}
      aria-label={`Bloque de código en ${result.displayName}`}
      className={`xook-code ${
        wrapLines ? "whitespace-pre-wrap break-words" : "overflow-x-auto"
      } xook-scroll font-mono text-[#e4e7ec] leading-[1.6] select-text focus:outline-none ${
        compact ? "px-3 py-2.5 text-[11.5px]" : "px-4 py-3.5 text-[12.5px]"
      } ${className}`}
    >
      <code className={result.canonicalId ? `language-${result.canonicalId}` : undefined}>
        {children}
      </code>
      {tailCaret}
    </pre>
  );
};

export const CodeBlockCard: React.FC<CodeBlockCardProps> = ({
  code,
  language,
  filenameHint,
  variant = "default",
  compact = false,
  wrapLines = false,
  tailCaret,
  showDownload = true,
}) => {
  const isLiquid = variant === "liquid";
  const rawId = useId();
  const codeElementId = `xook-code-${rawId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  const preRef = useRef<HTMLPreElement | null>(null);
  const downloadBtnRef = useRef<HTMLButtonElement | null>(null);
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);

  const [resolvedMeta, setResolvedMeta] = useState<{
    canonicalId: string;
    displayName: string;
    extension: string;
  }>(() => {
    const initial = highlightCodeToHast(code, language, filenameHint);
    return {
      canonicalId: initial.canonicalId,
      displayName: initial.displayName,
      extension: initial.extension,
    };
  });

  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const statusRepeatRef = useRef(0);
  const copyTimerRef = useRef<number | null>(null);
  const downloadTimerRef = useRef<number | null>(null);

  // Feature-detect Invoker Commands API (Chrome 135+ / modern WebKit) and native focusgroup
  const supportsCommand = useMemo(
    () => typeof window !== "undefined" && "CommandEvent" in window,
    []
  );
  const supportsFocusgroup = useMemo(
    () => typeof HTMLElement !== "undefined" && "focusGroup" in HTMLElement.prototype,
    []
  );

  // Roving tabindex index when native focusgroup is unavailable
  const [focusedToolbarIdx, setFocusedToolbarIdx] = useState<0 | 1>(showDownload ? 0 : 1);

  const announceStatus = useCallback((baseMessage: string) => {
    statusRepeatRef.current = (statusRepeatRef.current + 1) % 2;
    const suffix = statusRepeatRef.current === 1 ? "\u00A0" : "";
    setStatusMessage(`${baseMessage}${suffix}`);
  }, []);

  const handleCopy = useCallback(async () => {
    let ok = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else {
        ok = copyTextFallback(code);
      }
    } catch {
      ok = copyTextFallback(code);
    }
    if (!ok) {
      announceStatus("No se pudo copiar el código");
      return;
    }
    setCopied(true);
    announceStatus(`Código ${resolvedMeta.displayName} copiado al portapapeles`);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [announceStatus, code, resolvedMeta.displayName]);

  const suggestedFilename = useMemo(
    () => suggestCodeFilename(code, language, filenameHint, resolvedMeta.canonicalId),
    [code, language, filenameHint, resolvedMeta.canonicalId]
  );

  const handleDownload = useCallback(async () => {
    try {
      const res = await downloadCodeArtifact(suggestedFilename, code);
      if (res.ok) {
        setDownloaded(true);
        announceStatus(`Archivo ${res.filename} descargado`);
        if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current);
        downloadTimerRef.current = window.setTimeout(() => {
          setDownloaded(false);
        }, 2000);
      } else {
        announceStatus("No se pudo descargar el archivo");
      }
    } catch {
      announceStatus("No se pudo descargar el archivo");
    }
  }, [announceStatus, code, suggestedFilename]);

  // Keep latest handleCopy accessible to the native `command` listener
  const latestCopyRef = useRef(handleCopy);
  latestCopyRef.current = handleCopy;

  useEffect(() => {
    if (!supportsCommand) return;
    const el = preRef.current;
    if (!el) return;
    const onCommand = (event: Event) => {
      const cmdEvent = event as Event & { command?: string };
      if (cmdEvent.command === "--copy") {
        void latestCopyRef.current();
      }
    };
    el.addEventListener("command", onCommand);
    return () => {
      el.removeEventListener("command", onCommand);
    };
  }, [supportsCommand]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (downloadTimerRef.current !== null) window.clearTimeout(downloadTimerRef.current);
    };
  }, []);

  const handleToolbarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (supportsFocusgroup || !showDownload) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      let nextIdx: 0 | 1 = focusedToolbarIdx;
      if (e.key === "ArrowLeft" || e.key === "Home") nextIdx = 0;
      if (e.key === "ArrowRight" || e.key === "End") nextIdx = 1;
      if (e.key === "ArrowLeft" && focusedToolbarIdx === 0) nextIdx = 1;
      if (e.key === "ArrowRight" && focusedToolbarIdx === 1) nextIdx = 0;
      setFocusedToolbarIdx(nextIdx);
      const target = nextIdx === 0 ? downloadBtnRef.current : copyBtnRef.current;
      target?.focus();
    },
    [focusedToolbarIdx, showDownload, supportsFocusgroup]
  );

  const headerClasses = isLiquid
    ? "flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/[0.1] bg-white/[0.03]"
    : "flex items-center justify-between gap-2 px-3.5 py-2 border-b border-white/[0.06] bg-[#18191e]";

  return (
    <div
      data-no-drag="true"
      className={
        isLiquid
          ? "my-1.5 rounded-xl quick-liquid-subcard overflow-hidden [text-shadow:none]"
          : "my-2.5 rounded-2xl bg-[#131417] border border-white/[0.08] overflow-hidden shadow-[0_6px_24px_rgba(0,0,0,0.32)]"
      }
    >
      <div className={headerClasses}>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={
              isLiquid
                ? "text-[11px] font-medium tracking-[-0.01em] text-sky-100/85 truncate"
                : "text-[12px] font-medium tracking-[-0.01em] text-zinc-200 truncate"
            }
          >
            {resolvedMeta.displayName}
          </span>
          {filenameHint && (
            <span
              className="text-[10.5px] font-mono text-zinc-400/90 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded-md truncate max-w-[180px]"
              title={filenameHint}
            >
              {filenameHint.split("/").pop()}
            </span>
          )}
        </div>

        <div
          role="toolbar"
          aria-label={`Acciones para código ${resolvedMeta.displayName}`}
          focusgroup={supportsFocusgroup ? "toolbar wrap" : undefined}
          onKeyDown={handleToolbarKeyDown}
          className="flex items-center gap-1 shrink-0"
        >
          {showDownload && (
            <button
              ref={downloadBtnRef}
              type="button"
              tabIndex={supportsFocusgroup ? undefined : focusedToolbarIdx === 0 ? 0 : -1}
              onClick={() => void handleDownload()}
              onFocus={() => setFocusedToolbarIdx(0)}
              aria-label={`Descargar como ${suggestedFilename}`}
              title={downloaded ? `Descargado (${suggestedFilename})` : `Descargar (${suggestedFilename})`}
              className="xook-code-action-btn"
            >
              {downloaded ? (
                <Check size={15} className="text-emerald-400" aria-hidden="true" />
              ) : (
                <CircleArrowDown size={15} aria-hidden="true" />
              )}
            </button>
          )}
          <button
            ref={copyBtnRef}
            type="button"
            tabIndex={supportsFocusgroup ? undefined : focusedToolbarIdx === 1 || !showDownload ? 0 : -1}
            command={supportsCommand ? "--copy" : undefined}
            commandfor={supportsCommand ? codeElementId : undefined}
            onClick={supportsCommand ? undefined : () => void handleCopy()}
            onFocus={() => setFocusedToolbarIdx(1)}
            aria-label={copied ? "Código copiado" : `Copiar código ${resolvedMeta.displayName}`}
            title={copied ? "Copiado" : "Copiar código"}
            className="xook-code-action-btn"
          >
            {copied ? (
              <Check size={14} className="text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Live region placed outside buttons per accessibility guidance */}
      <span className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </span>

      <HighlightedCodeContent
        code={code}
        language={language}
        filenameHint={filenameHint}
        compact={compact}
        wrapLines={wrapLines}
        tailCaret={tailCaret}
        codeElementId={codeElementId}
        preRef={preRef}
        onResolvedMeta={setResolvedMeta}
      />
    </div>
  );
};
