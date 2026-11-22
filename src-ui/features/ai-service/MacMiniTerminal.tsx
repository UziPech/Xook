import React, { useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";

export interface MacMiniTerminalProps {
  command: string;
  cwdRel?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number | null;
  state: "pending" | "running" | "finished" | "denied" | "blocked" | "error";
  error?: string;
  logPath?: string | null;
  previewOnly?: boolean;
  compact?: boolean;
  surfaceVariant?: "default" | "liquid";
  defaultCollapsed?: boolean;
}

const PREVIEW_LINE_LIMIT = 6;

function resolveTerminalDirMeta(cwdRel?: string): {
  titleDir: string;
  promptDir: string;
  fullPath: string;
} {
  const raw = (cwdRel ?? "").trim();
  if (!raw || raw === ".") {
    return { titleDir: "workspace", promptDir: "~", fullPath: "." };
  }
  if (raw === "~" || raw === "~/") {
    return { titleDir: "~", promptDir: "~", fullPath: "~" };
  }
  const normalized = raw.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] || "~";
  return {
    titleDir: leaf,
    promptDir: leaf,
    fullPath: raw,
  };
}

function normalizeDisplayCommand(command: string): string {
  return command.trim().replace(/^\$\s+/, "");
}

/**
 * Semáforo SVG estilo macOS Terminal con gradiente interno, aro de contraste
 * y glifos sutiles (− / +) interactivos al pasar el cursor.
 */
const MacTrafficLightsSvg: React.FC<{
  muted?: boolean;
  canToggleBody?: boolean;
  canExpandOutput?: boolean;
  collapsed?: boolean;
  expanded?: boolean;
  onToggleCollapse?: () => void;
  onToggleExpand?: () => void;
}> = ({
  muted = false,
  canToggleBody = false,
  canExpandOutput = false,
  collapsed = false,
  expanded = false,
  onToggleCollapse,
  onToggleExpand,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className="group/lights inline-flex items-center gap-[6px] shrink-0">
      {/* Rojo decorativo */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <radialGradient id={`mac-red-${uid}`} cx="38%" cy="30%" r="72%">
            <stop offset="0%" stopColor={muted ? "#6b6e76" : "#ff7b73"} />
            <stop offset="55%" stopColor={muted ? "#52555c" : "#ff5f56"} />
            <stop offset="100%" stopColor={muted ? "#3f4248" : "#df463e"} />
          </radialGradient>
        </defs>
        <circle
          cx="6"
          cy="6"
          r="5.2"
          fill={`url(#mac-red-${uid})`}
          stroke={muted ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.34)"}
          strokeWidth="0.7"
        />
        <ellipse
          cx="4.7"
          cy="3.7"
          rx="1.8"
          ry="0.9"
          fill="rgba(255,255,255,0.28)"
        />
      </svg>

      {/* Amarillo: colapsa/abre el cuerpo de la mini terminal */}
      <button
        type="button"
        disabled={!canToggleBody}
        onClick={onToggleCollapse}
        title={collapsed ? "Mostrar consola" : "Minimizar consola"}
        aria-label={collapsed ? "Mostrar consola" : "Minimizar consola"}
        className={`p-0 m-0 border-0 bg-transparent inline-flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-white/60 ${
          canToggleBody ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <defs>
            <radialGradient id={`mac-yel-${uid}`} cx="38%" cy="30%" r="72%">
              <stop offset="0%" stopColor={muted ? "#6b6e76" : "#ffd25c"} />
              <stop offset="55%" stopColor={muted ? "#52555c" : "#ffbd2e"} />
              <stop offset="100%" stopColor={muted ? "#3f4248" : "#d99b1e"} />
            </radialGradient>
          </defs>
          <circle
            cx="6"
            cy="6"
            r="5.2"
            fill={`url(#mac-yel-${uid})`}
            stroke={muted ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.32)"}
            strokeWidth="0.7"
          />
          <ellipse
            cx="4.7"
            cy="3.7"
            rx="1.8"
            ry="0.9"
            fill="rgba(255,255,255,0.28)"
          />
          {canToggleBody && (
            <line
              x1="3.4"
              y1="6"
              x2="8.6"
              y2="6"
              stroke="rgba(66,40,0,0.78)"
              strokeWidth="1.2"
              strokeLinecap="round"
              className="opacity-0 group-hover/lights:opacity-100 transition-opacity duration-150"
            />
          )}
        </svg>
      </button>

      {/* Verde: expande/contrae la salida larga */}
      <button
        type="button"
        disabled={!canExpandOutput}
        onClick={onToggleExpand}
        title={expanded ? "Vista compacta" : "Expandir salida completa"}
        aria-label={expanded ? "Vista compacta" : "Expandir salida completa"}
        className={`p-0 m-0 border-0 bg-transparent inline-flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-white/60 ${
          canExpandOutput ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <defs>
            <radialGradient id={`mac-grn-${uid}`} cx="38%" cy="30%" r="72%">
              <stop offset="0%" stopColor={muted ? "#6b6e76" : "#53df68"} />
              <stop offset="55%" stopColor={muted ? "#52555c" : "#27c93f"} />
              <stop offset="100%" stopColor={muted ? "#3f4248" : "#1aa22f"} />
            </radialGradient>
          </defs>
          <circle
            cx="6"
            cy="6"
            r="5.2"
            fill={`url(#mac-grn-${uid})`}
            stroke={muted ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.32)"}
            strokeWidth="0.7"
          />
          <ellipse
            cx="4.7"
            cy="3.7"
            rx="1.8"
            ry="0.9"
            fill="rgba(255,255,255,0.28)"
          />
          {canExpandOutput && (
            <path
              d={
                expanded
                  ? "M4.1 6H7.9"
                  : "M6 3.5V8.5M3.5 6H8.5"
              }
              stroke="rgba(4,54,14,0.8)"
              strokeWidth="1.15"
              strokeLinecap="round"
              className="opacity-0 group-hover/lights:opacity-100 transition-opacity duration-150"
            />
          )}
        </svg>
      </button>
    </div>
  );
};

/** Ícono vectorial de carpeta estilo barra de título de macOS Terminal.app. */
const MacFolderGlyphSvg: React.FC = () => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      width="14"
      height="12"
      viewBox="0 0 16 13"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={`mac-fld-back-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9aa0aa" />
          <stop offset="100%" stopColor="#727882" />
        </linearGradient>
        <linearGradient id={`mac-fld-front-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b5bcc6" />
          <stop offset="100%" stopColor="#858c96" />
        </linearGradient>
      </defs>
      <path
        d="M1.2 2.4C1.2 1.63 1.83 1 2.6 1H5.75C6.18 1 6.58 1.2 6.84 1.54L7.48 2.38C7.66 2.61 7.93 2.75 8.22 2.75H13.4C14.17 2.75 14.8 3.38 14.8 4.15V5.2H1.2V2.4Z"
        fill={`url(#mac-fld-back-${uid})`}
      />
      <rect
        x="1"
        y="3.6"
        width="14"
        height="8.4"
        rx="1.6"
        fill={`url(#mac-fld-front-${uid})`}
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="0.55"
      />
      <line
        x1="2.2"
        y1="4.45"
        x2="13.8"
        y2="4.45"
        stroke="rgba(255,255,255,0.34)"
        strokeWidth="0.6"
        strokeLinecap="round"
      />
    </svg>
  );
};

/** Cursor rectangular de bloque estilo Terminal.app de macOS. */
const MacTerminalCursorSvg: React.FC<{ blinking?: boolean }> = ({ blinking = true }) => (
  <svg
    width="7"
    height="13"
    viewBox="0 0 7 13"
    aria-hidden="true"
    className={`inline-block align-[-2px] ml-1 shrink-0 ${
      blinking ? "xook-term-cursor-blink" : "opacity-65"
    }`}
  >
    <rect x="0.5" y="1" width="6" height="11" rx="0.9" fill="#9ea3ad" />
  </svg>
);

export const MacMiniTerminal: React.FC<MacMiniTerminalProps> = ({
  command,
  cwdRel,
  stdout,
  stderr,
  exitCode,
  durationMs,
  state,
  error,
  logPath,
  previewOnly = false,
  compact = false,
  surfaceVariant = "default",
  defaultCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const rimGradId = `xook-mac-term-rim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const dir = useMemo(() => resolveTerminalDirMeta(cwdRel), [cwdRel]);
  const cleanCommand = useMemo(() => normalizeDisplayCommand(command), [command]);
  const isRunning = state === "running";
  const isPending = state === "pending";
  const isDenied = state === "denied";
  const isBlocked = state === "blocked";
  const isError = state === "error" || (state === "finished" && exitCode != null && exitCode !== 0);
  const isLiquid = surfaceVariant === "liquid";

  const stdoutLines = useMemo(() => {
    const trimmed = (stdout ?? "").replace(/\s+$/, "");
    return trimmed ? trimmed.split("\n") : [];
  }, [stdout]);

  const stderrLines = useMemo(() => {
    const trimmed = (stderr ?? "").replace(/\s+$/, "");
    return trimmed ? trimmed.split("\n") : [];
  }, [stderr]);

  const totalOutputLines = stdoutLines.length + stderrLines.length;
  const hasOutput = totalOutputLines > 0;
  const isTruncatedPreview = !expanded && totalOutputLines > PREVIEW_LINE_LIMIT;
  const hiddenLineCount = Math.max(0, totalOutputLines - PREVIEW_LINE_LIMIT);

  const visibleStdout = useMemo(() => {
    if (!isTruncatedPreview) return stdoutLines;
    return stdoutLines.slice(0, PREVIEW_LINE_LIMIT);
  }, [isTruncatedPreview, stdoutLines]);

  const visibleStderr = useMemo(() => {
    if (!isTruncatedPreview) return stderrLines;
    const remaining = Math.max(0, PREVIEW_LINE_LIMIT - visibleStdout.length);
    return stderrLines.slice(0, remaining);
  }, [isTruncatedPreview, stderrLines, visibleStdout.length]);

  const handleCopy = async () => {
    const pieces = [cleanCommand];
    const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n");
    if (out) pieces.push(out);
    try {
      await navigator.clipboard.writeText(pieces.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignorar si clipboard no está disponible
    }
  };

  const statusPill = (() => {
    if (isPending) {
      return (
        <span className="text-[10px] font-mono text-zinc-400">esperando permiso</span>
      );
    }
    if (isRunning) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/90 animate-pulse" />
          <span>ejecutando</span>
        </span>
      );
    }
    if (isBlocked) {
      return <span className="text-[10px] font-mono text-rose-300/90">bloqueado</span>;
    }
    if (isDenied) {
      return <span className="text-[10px] font-mono text-amber-300/85">rechazado</span>;
    }
    if (isError) {
      return (
        <span className="text-[10px] font-mono text-rose-300/90">
          {exitCode != null ? `exit ${exitCode}` : "error"}
        </span>
      );
    }
    if (durationMs != null) {
      return <span className="text-[10px] font-mono text-zinc-500 tabular-nums">{durationMs} ms</span>;
    }
    return null;
  })();

  const frameClass = isLiquid
    ? "xook-mac-terminal rounded-[11px] overflow-hidden border border-white/[0.13] bg-[#141519]/88 backdrop-blur-xl shadow-[0_12px_28px_-14px_rgba(0,0,0,0.75)] [text-shadow:none]"
    : "xook-mac-terminal rounded-[11px] overflow-hidden border border-white/[0.1] bg-[#16171a] shadow-[0_14px_30px_-18px_rgba(0,0,0,0.88),inset_0_1px_0_rgba(255,255,255,0.06)]";

  const titlebarClass = isLiquid
    ? "relative flex items-center justify-between gap-2 px-3 py-[6px] bg-gradient-to-b from-[#2b2d34]/92 to-[#212329]/92 border-b border-black/45"
    : "relative flex items-center justify-between gap-2 px-3 py-[6px] bg-gradient-to-b from-[#28292e] to-[#1f2024] border-b border-black/55";

  return (
    <div data-no-drag="true" className={`${frameClass} panel-fade-in`}>
      {/* Barra superior estilo ventana macOS Terminal.app */}
      <div className={titlebarClass}>
        {/* Brillo especular SVG ultra sutil en el borde superior de la barra macOS */}
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          viewBox="0 0 100 2"
          className="pointer-events-none absolute inset-x-0 top-0 w-full h-[1.5px]"
        >
          <defs>
            <linearGradient id={rimGradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.14)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="2" fill={`url(#${rimGradId})`} />
        </svg>

        <div className="flex items-center gap-2.5 min-w-0">
          <MacTrafficLightsSvg
            muted={isDenied || isBlocked}
            canToggleBody={!previewOnly}
            canExpandOutput={!previewOnly && totalOutputLines > PREVIEW_LINE_LIMIT}
            collapsed={collapsed}
            expanded={expanded}
            onToggleCollapse={() => setCollapsed((v) => !v)}
            onToggleExpand={() => {
              setCollapsed(false);
              setExpanded((v) => !v);
            }}
          />

          <div
            className="flex items-center gap-1.5 min-w-0 text-[11px] font-medium tracking-[-0.005em] text-zinc-300/90 select-none"
            title={dir.fullPath}
          >
            <MacFolderGlyphSvg />
            <span className="truncate">
              {dir.titleDir} <span className="text-zinc-500 font-normal">— -zsh</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {statusPill}
          {cleanCommand && (
            <button
              type="button"
              onClick={() => void handleCopy()}
              title={copied ? "Copiado" : "Copiar comando y salida"}
              aria-label={copied ? "Copiado" : "Copiar comando y salida"}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Cuerpo de consola estilo Terminal.app (SF Mono / Menlo) */}
      {!collapsed && (
        <div
          className={`font-mono select-text ${
            compact ? "px-3 py-2 text-[11px]" : "px-3.5 py-2.5 text-[11.5px]"
          } leading-[1.55] bg-[#151619]`}
        >
          {/* Línea de prompt zsh */}
          {cleanCommand && (
            <div className="flex items-start gap-1.5 text-zinc-100 break-all">
              <span className="text-zinc-500 shrink-0 select-none">
                {dir.promptDir} %
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[#eceef2]">
                {cleanCommand}
                {(isRunning || isPending) && <MacTerminalCursorSvg blinking={isRunning} />}
              </span>
            </div>
          )}

          {/* Salida stdout / stderr */}
          {!previewOnly && hasOutput && (
            <div
              className={`mt-1.5 pt-1.5 border-t border-white/[0.05] ${
                expanded ? "max-h-72 overflow-y-auto xook-scroll pr-1" : ""
              }`}
            >
              {visibleStdout.length > 0 && (
                <pre className="m-0 whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-zinc-300/90 font-mono">
                  {visibleStdout.join("\n")}
                </pre>
              )}
              {visibleStderr.length > 0 && (
                <pre
                  className={`m-0 whitespace-pre-wrap break-words text-[11px] leading-[1.5] text-rose-300/85 font-mono ${
                    visibleStdout.length > 0 ? "mt-1.5 pt-1.5 border-t border-rose-400/10" : ""
                  }`}
                >
                  {visibleStderr.join("\n")}
                </pre>
              )}
            </div>
          )}

          {/* Estados terminales sin salida */}
          {!previewOnly && !hasOutput && (isDenied || isBlocked || (isError && error)) && (
            <div
              className={`mt-1.5 text-[11px] ${
                isDenied ? "text-amber-300/80" : "text-rose-300/85"
              }`}
            >
              zsh: {error || (isDenied ? "permiso rechazado por el usuario" : "bloqueado por seguridad")}
            </div>
          )}

          {/* Expansor para salidas largas */}
          {!previewOnly && totalOutputLines > PREVIEW_LINE_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-sans text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>Mostrar menos</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>
                    Ver {hiddenLineCount} {hiddenLineCount === 1 ? "línea más" : "líneas más"}
                  </span>
                </>
              )}
            </button>
          )}

          {!previewOnly && logPath && (
            <div className="mt-1.5 pt-1 border-t border-white/[0.04] text-[10px] font-sans text-zinc-500 truncate">
              Log completo: <span className="font-mono text-zinc-400">{logPath}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
