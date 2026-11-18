import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  Download,
  Eye,
  RotateCcw,
} from "lucide-react";
import { CanvasCustomAppSpec, stripUnsafeExternalHtmlTags } from "../canvasSchema";

export interface CustomAppCanvasViewProps {
  title: string;
  spec: CanvasCustomAppSpec;
  onUpdateSpec: (next: CanvasCustomAppSpec) => void;
  onAction?: (action: { prompt: string; payload?: unknown }) => void;
  isDark?: boolean;
}

interface OpaqueOriginInstance {
  isSameOrigin: (other: OpaqueOriginInstance) => boolean;
}

interface OpaqueOriginConstructor {
  new (): OpaqueOriginInstance;
  from: (candidate: unknown) => OpaqueOriginInstance;
}

function generateChannelToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeScriptTag(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

function escapeStyleTag(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

function sanitizeFileSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "xook-miniapp";
}

function buildSandboxedDocument(options: {
  title: string;
  html: string;
  css: string;
  js: string;
  initialState: Record<string, unknown>;
  channelToken: string;
  isDark: boolean;
}): string {
  const safeHtml = stripUnsafeExternalHtmlTags(options.html || '<div id="app"></div>');
  const safeCss = escapeStyleTag(options.css || "");
  const safeJs = escapeScriptTag(options.js || "");
  const safeStateJson = JSON.stringify(options.initialState ?? {}).replace(/</g, "\\u003c");
  const safeTokenJson = JSON.stringify(options.channelToken);
  const bg = options.isDark ? "#090a0e" : "#ffffff";
  const fg = options.isDark ? "#f4f4f5" : "#18181b";
  const muted = options.isDark ? "#a1a1aa" : "#52525b";
  const border = options.isDark ? "rgba(255,255,255,0.10)" : "rgba(24,24,27,0.12)";
  const surface = options.isDark ? "rgba(255,255,255,0.03)" : "#f4f4f5";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />
<title>${options.title.replace(/</g, "&lt;")}</title>
<style>
  :root {
    --xook-bg: ${bg};
    --xook-fg: ${fg};
    --xook-muted: ${muted};
    --xook-border: ${border};
    --xook-surface: ${surface};
    --xook-accent: #e4e4e7;
    --xook-positive: #34d399;
    --xook-warning: #fbbf24;
    --xook-critical: #fb7185;
    --bg: var(--xook-bg);
    --surface: var(--xook-surface);
    --border: var(--xook-border);
    --text: var(--xook-fg);
    --muted: var(--xook-muted);
    --accent: var(--xook-accent);
    color-scheme: ${options.isDark ? "dark" : "light"};
  }
  *, *::before, *::after { box-sizing: border-box; }
  html {
    height: 100%;
    margin: 0;
    padding: 0;
    background: var(--xook-bg);
    color: var(--xook-fg);
  }
  body {
    min-height: 100%;
    margin: 0;
    padding: 10px 6px 18px;
    background: var(--xook-bg);
    color: var(--xook-fg);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif;
    line-height: 1.45;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.14); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.24); }
  button, input, select, textarea { font: inherit; color: inherit; }
  input[type="range"] {
    width: 100%;
    accent-color: #e4e4e7;
    cursor: pointer;
  }
  input[type="number"], input[type="text"], select, textarea {
    width: 100%;
    padding: 8px 11px;
    border-radius: 10px;
    border: 1px solid var(--xook-border);
    background: #0c0e14;
    color: var(--xook-fg);
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  input[type="number"]:focus, input[type="text"]:focus, select:focus, textarea:focus {
    border-color: rgba(255, 255, 255, 0.28);
  }
  /* XOOK Native UI Kit — Estética sobria monocromática (sin degradados estridentes) */
  .xook-shell { display: flex; flex-direction: column; gap: 14px; }
  .xook-split { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
  .xook-grid-2, .xook-grid-3, .xook-hero-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
  @media (min-width: 460px) {
    .xook-grid-2, .xook-hero-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 600px) {
    .xook-split { grid-template-columns: 1fr 1.15fr; }
    .xook-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .xook-card, .xook-hero-card {
    border-radius: 14px;
    border: 1px solid var(--xook-border);
    background: #0d0f14;
    padding: 14px;
  }
  .xook-hero-card {
    border-color: rgba(255, 255, 255, 0.12);
    background: #101218;
    padding: 15px;
  }
  .xook-label, .xook-hero-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--xook-muted);
  }
  .xook-hero-value {
    margin-top: 4px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .xook-value {
    margin-top: 4px;
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .xook-muted, .xook-hero-sub { font-size: 11.5px; color: var(--xook-muted); margin-top: 4px; }
  .xook-waterfall {
    border-radius: 14px;
    border: 1px solid var(--xook-border);
    background: #0d0f14;
    overflow: hidden;
  }
  .xook-breakdown-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 14px;
    font-size: 12.5px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-variant-numeric: tabular-nums;
  }
  .xook-breakdown-row:last-child { border-bottom: 0; }
  .xook-pill-group {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px;
    border-radius: 12px;
    background: #0b0c10;
    border: 1px solid var(--xook-border);
  }
  .xook-pill {
    flex: 1 1 auto;
    text-align: center;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    color: var(--xook-muted);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .xook-pill:hover {
    color: #e4e4e7;
    background: rgba(255, 255, 255, 0.04);
  }
  .xook-pill.active, .xook-pill[aria-pressed="true"] {
    background: rgba(255, 255, 255, 0.10) !important;
    background-image: none !important;
    border-color: rgba(255, 255, 255, 0.22) !important;
    color: #ffffff !important;
  }
  .xook-progress {
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    overflow: hidden;
    margin-top: 8px;
  }
  .xook-progress-bar {
    height: 100%;
    border-radius: 999px;
    background: #e4e4e7 !important;
    background-image: none !important;
    transition: width 0.2s ease;
  }
  .xook-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
  }
  .is-positive { color: var(--xook-positive) !important; border-color: rgba(52, 211, 153, 0.28) !important; }
  .is-warning { color: var(--xook-warning) !important; border-color: rgba(251, 191, 36, 0.28) !important; }
  .is-critical { color: var(--xook-critical) !important; border-color: rgba(251, 113, 133, 0.30) !important; }
  .is-accent { color: #ffffff !important; border-color: rgba(255, 255, 255, 0.22) !important; }
${safeCss}
  /* Neutralizar degradados estridentes o morados generados en línea por el modelo */
  button, [role="button"], .btn, .xook-pill {
    background-image: none !important;
  }
</style>
</head>
<body>
${safeHtml}
<script>
(function() {
  var CHANNEL = ${safeTokenJson};
  var state = ${safeStateJson};
  var listeners = [];
  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }
  function notify(nextState) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](clone(nextState)); } catch (_) {}
    }
  }
  window.addEventListener("message", function(ev) {
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || typeof data !== "object" || data.__xookChannel !== CHANNEL) return;
    if (data.type === "syncState" && data.state && typeof data.state === "object") {
      state = clone(data.state);
      notify(state);
    }
  });
  window.xook = Object.freeze({
    getState: function() { return clone(state); },
    setState: function(patch) {
      if (patch && typeof patch === "object" && !Array.isArray(patch)) {
        state = Object.assign({}, state, patch);
      }
      notify(state);
      try {
        window.parent.postMessage({ __xookChannel: CHANNEL, type: "state", state: clone(state) }, "*");
      } catch (_) {}
      return clone(state);
    },
    sendToXox: function(message, payload) {
      var text = typeof message === "string" ? message.trim() : "";
      if (!text) return;
      try {
        window.parent.postMessage({
          __xookChannel: CHANNEL,
          type: "sendToXox",
          message: text,
          payload: payload !== undefined ? clone(payload) : undefined,
          state: clone(state)
        }, "*");
      } catch (_) {}
    },
    onStateChange: function(cb) {
      if (typeof cb !== "function") return function() {};
      listeners.push(cb);
      return function() {
        listeners = listeners.filter(function(fn) { return fn !== cb; });
      };
    }
  });
})();
</script>
<script>
try {
${safeJs}
} catch (err) {
  var errBox = document.createElement("pre");
  errBox.style.cssText = "margin-top:12px;padding:10px;border-radius:8px;background:rgba(244,63,94,0.12);border:1px solid rgba(244,63,94,0.35);color:#fda4af;font-size:12px;white-space:pre-wrap;";
  errBox.textContent = "Error en script: " + (err && err.message ? err.message : String(err));
  document.body.appendChild(errBox);
}
</script>
</body>
</html>`;
}

export const CustomAppCanvasView: React.FC<CustomAppCanvasViewProps> = ({
  title,
  spec,
  onUpdateSpec,
  onAction,
  isDark = true,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [mountNonce, setMountNonce] = useState(0);

  // Snapshot inicial para evitar reloads por updates de estado desde el iframe
  const initialStateRef = useRef<Record<string, unknown>>(spec.state ?? {});
  const codeSig = `${spec.html}\n__CSS__\n${spec.css ?? ""}\n__JS__\n${spec.js ?? ""}`;
  const lastCodeSigRef = useRef<string>(codeSig);
  const latestSpecRef = useRef<CanvasCustomAppSpec>(spec);
  latestSpecRef.current = spec;

  useEffect(() => {
    if (lastCodeSigRef.current !== codeSig) {
      lastCodeSigRef.current = codeSig;
      initialStateRef.current = spec.state ?? {};
      setMountNonce((n) => n + 1);
    }
  }, [codeSig, spec.state]);

  const channelToken = useMemo(
    () => generateChannelToken(),
    // Nuevo token por cada montaje limpio de documento
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [codeSig, mountNonce, isDark],
  );

  const srcDoc = useMemo(
    () =>
      buildSandboxedDocument({
        title,
        html: spec.html,
        css: spec.css ?? "",
        js: spec.js ?? "",
        initialState: initialStateRef.current,
        channelToken,
        isDark,
      }),
    [title, spec.html, spec.css, spec.js, channelToken, isDark],
  );

  // Validación estricta de origen opaco con sentinel `new Origin()` + `Origin.from(event).isSameOrigin(...)`
  // y fallback `event.source === iframeWindow` para navegadores sin interfaz `Origin`.
  const pinnedOpaqueOriginRef = useRef<OpaqueOriginInstance | null>(null);
  const hasPinnedOriginRef = useRef(false);

  useEffect(() => {
    const hasOriginApi = "Origin" in globalThis;
    const OriginCtor = hasOriginApi
      ? (globalThis as unknown as { Origin?: OpaqueOriginConstructor }).Origin
      : undefined;
    pinnedOpaqueOriginRef.current = OriginCtor ? new OriginCtor() : null;
    hasPinnedOriginRef.current = false;

    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) return;

      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      if (data.__xookChannel !== channelToken) return;

      if (OriginCtor && pinnedOpaqueOriginRef.current) {
        try {
          const senderOrigin = OriginCtor.from(event);
          if (!hasPinnedOriginRef.current) {
            pinnedOpaqueOriginRef.current = senderOrigin;
            hasPinnedOriginRef.current = true;
          } else if (!senderOrigin.isSameOrigin(pinnedOpaqueOriginRef.current)) {
            return;
          }
        } catch {
          return;
        }
      }

      if (data.type === "state" && data.state && typeof data.state === "object" && !Array.isArray(data.state)) {
        const cur = latestSpecRef.current;
        onUpdateSpec({
          ...cur,
          state: data.state as Record<string, unknown>,
        });
      } else if (data.type === "sendToXox") {
        const msg = typeof data.message === "string" ? data.message.trim() : "";
        if (!msg) return;
        const cur = latestSpecRef.current;
        if (data.state && typeof data.state === "object" && !Array.isArray(data.state)) {
          onUpdateSpec({
            ...cur,
            state: data.state as Record<string, unknown>,
          });
        }
        onAction?.({
          prompt: msg,
          payload: data.payload,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [channelToken, onUpdateSpec, onAction]);

  const handleResetApp = () => {
    onUpdateSpec({
      ...spec,
      state: initialStateRef.current,
    });
    setMountNonce((n) => n + 1);
  };

  const handleDownloadHtml = () => {
    const standaloneDoc = buildSandboxedDocument({
      title,
      html: spec.html,
      css: spec.css ?? "",
      js: spec.js ?? "",
      initialState: spec.state ?? initialStateRef.current,
      channelToken: "standalone-offline",
      isDark,
    });
    const blob = new Blob([standaloneDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFileSlug(title)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const combinedSource = useMemo(() => {
    const parts = [`<!-- HTML -->\n${spec.html}`];
    if (spec.css?.trim()) parts.push(`/* CSS */\n${spec.css}`);
    if (spec.js?.trim()) parts.push(`// JS\n${spec.js}`);
    return parts.join("\n\n");
  }, [spec.html, spec.css, spec.js]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      {spec.description && (
        <p className={`shrink-0 text-xs leading-relaxed ${isDark ? "text-zinc-300" : "text-zinc-700"}`}>
          {spec.description}
        </p>
      )}

      {showSource ? (
        <div
          className={`flex-1 min-h-0 overflow-auto rounded-xl border p-3.5 font-mono text-xs leading-relaxed xook-scroll ${
            isDark
              ? "border-white/10 bg-black/50 text-zinc-200"
              : "border-zinc-200 bg-zinc-950 text-zinc-100"
          }`}
        >
          <pre className="whitespace-pre-wrap break-words">
            <code>{combinedSource}</code>
          </pre>
        </div>
      ) : (
        <div className="flex-1 min-h-[360px] overflow-hidden rounded-xl">
          <iframe
            key={`${mountNonce}-${isDark ? "dark" : "light"}`}
            ref={iframeRef}
            title={title}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            className="block h-full w-full border-0"
          />
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={handleResetApp}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            isDark
              ? "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          <RotateCcw className="h-3 w-3" />
          Reiniciar
        </button>

        <button
          type="button"
          onClick={() => setShowSource((prev) => !prev)}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            isDark
              ? "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          {showSource ? <Eye className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
          {showSource ? "Vista interactiva" : "Código"}
        </button>

        <button
          type="button"
          onClick={handleDownloadHtml}
          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
            isDark
              ? "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200"
              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          }`}
        >
          <Download className="h-3 w-3" />
          HTML
        </button>
      </div>
    </div>
  );
};
