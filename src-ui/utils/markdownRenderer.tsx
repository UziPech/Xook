import React from "react";
import { CodeBlockCard } from "./CodeBlockCard";
import { parseCodeFenceInfo } from "./codeLanguages";

export type MarkdownVariant = "default" | "liquid";
export type MarkdownTableAlign = "left" | "center" | "right";

export interface MarkdownTableBlock {
  headers: string[];
  alignments: MarkdownTableAlign[];
  rows: string[][];
}

export interface InlineMarkdownOptions {
  variant?: MarkdownVariant;
  codeClassName?: string;
  linkClassName?: string;
  mathClassName?: string;
  onOpenLink?: (url: string) => void;
  preserveLineBreaks?: boolean;
  keyPrefix?: string;
}

export interface MarkdownContentProps {
  text: string;
  variant?: MarkdownVariant;
  compact?: boolean;
  streaming?: boolean;
  caretClassName?: string;
  className?: string;
  onOpenLink?: (url: string) => void;
  renderTable?: (table: MarkdownTableBlock, blockIndex: number) => React.ReactNode;
}

const MAX_INLINE_DEPTH = 6;

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  rarr: "→",
  larr: "←",
  harr: "↔",
  uarr: "↑",
  darr: "↓",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  times: "×",
  divide: "÷",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  ne: "≠",
  approx: "≈",
  asymp: "≈",
  equiv: "≡",
  infin: "∞",
  middot: "·",
  bull: "•",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
  check: "✓",
  cross: "✗",
};

const LATEX_SYMBOLS: Array<[RegExp, string]> = [
  [/\\Longleftrightarrow\b/g, "⇔"],
  [/\\longrightarrow\b/g, "→"],
  [/\\longleftarrow\b/g, "←"],
  [/\\Leftrightarrow\b/g, "⇔"],
  [/\\Rightarrow\b/g, "⇒"],
  [/\\Leftarrow\b/g, "⇐"],
  [/\\leftrightarrow\b/g, "↔"],
  [/\\rightarrow\b/g, "→"],
  [/\\leftarrow\b/g, "←"],
  [/\\implies\b/g, "⇒"],
  [/\\iff\b/g, "⇔"],
  [/\\gets\b/g, "←"],
  [/\\to\b/g, "→"],
  [/\\subseteq\b/g, "⊆"],
  [/\\supseteq\b/g, "⊇"],
  [/\\subset\b/g, "⊂"],
  [/\\supset\b/g, "⊃"],
  [/\\notin\b/g, "∉"],
  [/\\in\b/g, "∈"],
  [/\\forall\b/g, "∀"],
  [/\\exists\b/g, "∃"],
  [/\\approx\b/g, "≈"],
  [/\\equiv\b/g, "≡"],
  [/\\simeq\b/g, "≃"],
  [/\\sim\b/g, "~"],
  [/\\neq\b/g, "≠"],
  [/\\ne\b/g, "≠"],
  [/\\leq\b/g, "≤"],
  [/\\le\b/g, "≤"],
  [/\\geq\b/g, "≥"],
  [/\\ge\b/g, "≥"],
  [/\\pm\b/g, "±"],
  [/\\mp\b/g, "∓"],
  [/\\times\b/g, "×"],
  [/\\div\b/g, "÷"],
  [/\\cdot\b/g, "·"],
  [/\\bullet\b/g, "•"],
  [/\\infty\b/g, "∞"],
  [/\\partial\b/g, "∂"],
  [/\\nabla\b/g, "∇"],
  [/\\cup\b/g, "∪"],
  [/\\cap\b/g, "∩"],
  [/\\emptyset\b/g, "∅"],
  [/\\land\b/g, "∧"],
  [/\\lor\b/g, "∨"],
  [/\\lnot\b/g, "¬"],
  [/\\neg\b/g, "¬"],
  [/\\sum\b/g, "∑"],
  [/\\prod\b/g, "∏"],
  [/\\int\b/g, "∫"],
  [/\\cdots\b/g, "⋯"],
  [/\\ldots\b/g, "…"],
  [/\\dots\b/g, "…"],
  [/\\degree\b/g, "°"],
  [/\^\\circ\b/g, "°"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\gamma\b/g, "γ"],
  [/\\delta\b/g, "δ"],
  [/\\varepsilon\b/g, "ε"],
  [/\\epsilon\b/g, "ε"],
  [/\\theta\b/g, "θ"],
  [/\\lambda\b/g, "λ"],
  [/\\mu\b/g, "μ"],
  [/\\pi\b/g, "π"],
  [/\\rho\b/g, "ρ"],
  [/\\sigma\b/g, "σ"],
  [/\\tau\b/g, "τ"],
  [/\\phi\b/g, "φ"],
  [/\\varphi\b/g, "φ"],
  [/\\omega\b/g, "ω"],
  [/\\Delta\b/g, "Δ"],
  [/\\Sigma\b/g, "Σ"],
  [/\\Omega\b/g, "Ω"],
  [/\\Theta\b/g, "Θ"],
  [/\\Lambda\b/g, "Λ"],
  [/\\Pi\b/g, "Π"],
];

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};

const ESCAPABLE_PUNCTUATION = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  ".",
  "!",
  "|",
  "~",
  "$",
  "^",
  "<",
  ">",
]);

/**
 * Decodes common HTML entities in plain Markdown text while leaving numeric
 * surrogate/control code points untouched.
 */
export function decodeSafeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (full, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        if (code >= 32 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        if (code >= 32 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
          return String.fromCodePoint(code);
        }
        return full;
      }
      return NAMED_HTML_ENTITIES[entity] ?? full;
    }
  );
}

function mapScriptChars(raw: string, map: Record<string, string>): string | null {
  let out = "";
  for (const ch of raw) {
    if (ch === " ") continue;
    const mapped = map[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out || null;
}

/**
 * Translates common LaTeX math commands inside explicit math delimiters into
 * readable Unicode notation without mangling currency `$` signs elsewhere.
 */
export function formatLatexMath(expr: string): string {
  let out = expr.trim();
  if (!out) return "";

  out = out
    .replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:left|right)\s*([()[\]|.])/g, (_, ch: string) => (ch === "." ? "" : ch))
    .replace(/\\(?:,|;|:|!|quad|qquad|\s)/g, " ");

  // Unwrap simple nested/flat fractions and roots iteratively
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(
      /\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g,
      (_, num: string, den: string) => {
        const n = /^[a-zA-Z0-9.]+$/.test(num.trim()) ? num.trim() : `(${num.trim()})`;
        const d = /^[a-zA-Z0-9.]+$/.test(den.trim()) ? den.trim() : `(${den.trim()})`;
        return `${n}/${d}`;
      }
    );
    out = out.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner: string) => {
      const cleaned = inner.trim();
      return /^[a-zA-Z0-9.]+$/.test(cleaned) ? `√${cleaned}` : `√(${cleaned})`;
    });
  }

  for (const [pattern, replacement] of LATEX_SYMBOLS) {
    out = out.replace(pattern, replacement);
  }

  out = out
    .replace(/\^\{([^{}]+)\}/g, (_full, inner: string) => {
      const sup = mapScriptChars(inner, SUPERSCRIPTS);
      return sup ?? (inner.length === 1 ? `^${inner}` : `^(${inner})`);
    })
    .replace(/\^([0-9ni])/g, (full, ch: string) => SUPERSCRIPTS[ch] ?? full)
    .replace(/_\{([^{}]+)\}/g, (_full, inner: string) => {
      const sub = mapScriptChars(inner, SUBSCRIPTS);
      return sub ?? (inner.length === 1 ? `_${inner}` : `_(${inner})`);
    })
    .replace(/_([0-9])/g, (full, ch: string) => SUBSCRIPTS[ch] ?? full)
    .replace(/\\([{}%&_#$])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return out;
}

function sanitizeHref(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

async function openExternalUrl(
  url: string,
  customHandler?: (url: string) => void
): Promise<void> {
  if (customHandler) {
    customHandler(url);
    return;
  }
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // Fall back to standard browser navigation if opener fails outside desktop shell.
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && /[\p{L}\p{N}]/u.test(ch));
}

function skipBacktickSpan(text: string, start: number): number {
  let ticks = 0;
  while (start + ticks < text.length && text[start + ticks] === "`") {
    ticks += 1;
  }
  if (ticks === 0) return -1;
  let cursor = start + ticks;
  while (cursor <= text.length - ticks) {
    if (text[cursor] === "`") {
      let run = 0;
      while (cursor + run < text.length && text[cursor + run] === "`") {
        run += 1;
      }
      if (run === ticks) {
        return cursor + run;
      }
      cursor += run;
      continue;
    }
    cursor += 1;
  }
  return -1;
}

/**
 * Finds the matching closing delimiter (`***`, `**`, `*`, `___`, `__`, `_`, `~~`),
 * skipping escaped chars and inline backtick code spans so nested `` **`code`** `` stays intact.
 */
function findClosingDelimiter(
  text: string,
  startIdx: number,
  delim: string,
  requireIntrawordBoundary: boolean
): number {
  const dLen = delim.length;
  let i = startIdx;
  while (i <= text.length - dLen) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const afterCode = skipBacktickSpan(text, i);
      if (afterCode !== -1) {
        i = afterCode;
        continue;
      }
    }
    if (text.startsWith(delim, i)) {
      const prevChar = i > startIdx ? text[i - 1] : "";
      const nextChar = text[i + dLen];
      // Prevent matching `**` as closing `*` when single-char emphasis ends
      if (dLen === 1 && nextChar === delim[0]) {
        i += 2;
        continue;
      }
      if (prevChar && !/\s/.test(prevChar)) {
        if (!requireIntrawordBoundary || !isWordChar(nextChar)) {
          return i;
        }
      }
    }
    i += 1;
  }
  return -1;
}

function parseLinkAt(
  text: string,
  start: number
): { label: string; url: string; end: number; isImage: boolean } | null {
  const isImage = text[start] === "!" && text[start + 1] === "[";
  const openBracket = isImage ? start + 1 : start;
  if (text[openBracket] !== "[") return null;

  let i = openBracket + 1;
  let bracketDepth = 1;
  while (i < text.length && bracketDepth > 0) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const afterCode = skipBacktickSpan(text, i);
      if (afterCode !== -1) {
        i = afterCode;
        continue;
      }
    }
    if (text[i] === "[") bracketDepth += 1;
    else if (text[i] === "]") bracketDepth -= 1;
    i += 1;
  }
  if (bracketDepth !== 0) return null;
  const closeBracket = i - 1;
  if (text[closeBracket + 1] !== "(") return null;

  let j = closeBracket + 2;
  if (text[j] === "<") {
    const closeAngle = text.indexOf(">", j + 1);
    if (closeAngle !== -1 && text[closeAngle + 1] === ")") {
      return {
        label: text.slice(openBracket + 1, closeBracket),
        url: text.slice(j + 1, closeAngle),
        end: closeAngle + 2,
        isImage,
      };
    }
  }

  let parenDepth = 1;
  while (j < text.length && parenDepth > 0) {
    if (text[j] === "\\" && j + 1 < text.length) {
      j += 2;
      continue;
    }
    if (text[j] === "(") parenDepth += 1;
    else if (text[j] === ")") parenDepth -= 1;
    if (parenDepth === 0) break;
    j += 1;
  }
  if (parenDepth !== 0) return null;

  const rawDest = text.slice(closeBracket + 2, j).trim();
  const destWithoutTitle = rawDest.replace(/\s+["'][^"']*["']\s*$/, "").trim();
  if (!destWithoutTitle || /\s/.test(destWithoutTitle)) return null;

  return {
    label: text.slice(openBracket + 1, closeBracket),
    url: destWithoutTitle,
    end: j + 1,
    isImage,
  };
}

function getInlineStyles(options: InlineMarkdownOptions) {
  const isLiquid = options.variant === "liquid";
  return {
    code:
      options.codeClassName ??
      (isLiquid
        ? "px-1.5 py-[1px] rounded-[5px] bg-white/[0.11] border border-white/[0.18] text-[0.9em] text-sky-100 font-mono [text-shadow:none]"
        : "px-1.5 py-0.5 rounded-md bg-white/[0.08] border border-white/10 text-[12px] text-zinc-100 font-mono"),
    link:
      options.linkClassName ??
      (isLiquid
        ? "text-sky-300 hover:text-sky-200 underline decoration-sky-300/45 underline-offset-2 transition-colors"
        : "text-sky-300 hover:text-sky-200 underline decoration-sky-400/40 underline-offset-2 transition-colors"),
    math:
      options.mathClassName ??
      (isLiquid
        ? "px-1.5 py-[1px] rounded-[5px] bg-white/[0.08] border border-white/[0.14] text-[0.95em] text-indigo-100 font-medium"
        : "px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-indigo-100 font-medium"),
    kbd: isLiquid
      ? "px-1.5 py-[1px] rounded-[5px] bg-white/[0.12] border border-white/[0.22] text-[0.85em] text-zinc-100 font-mono shadow-[inset_0_-1px_0_rgba(0,0,0,0.28)] [text-shadow:none]"
      : "px-1.5 py-0.5 rounded-md bg-white/[0.09] border border-white/15 text-[11px] text-zinc-100 font-mono shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]",
  };
}

function renderPlainSegment(
  segment: string,
  preserveLineBreaks: boolean,
  keyBase: string
): React.ReactNode {
  const decoded = decodeSafeHtmlEntities(segment);
  if (!preserveLineBreaks || !decoded.includes("\n")) {
    return decoded;
  }
  const parts = decoded.split("\n");
  return (
    <React.Fragment key={keyBase}>
      {parts.map((part, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <br />}
          {part}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

/**
 * Renders inline Markdown and safe symbolic constructs (`**bold**`, `*italic*`,
 * `_italic_` with snake_case protection, `` `code` ``, `` **`nested`** ``,
 * `~~strike~~`, `[text](url)`, `<br>`, HTML entities, escaped punctuation, and
 * explicit LaTeX `\(...\)`/`\[...\]`/`$$...$$`) into safe React nodes.
 */
export function renderInlineMarkdown(
  input: string,
  options: InlineMarkdownOptions = {},
  depth = 0
): React.ReactNode[] {
  if (!input) return [];
  const preserveLineBreaks = options.preserveLineBreaks !== false;
  const keyPrefix = options.keyPrefix ?? "md";
  if (depth >= MAX_INLINE_DEPTH) {
    return [renderPlainSegment(input, preserveLineBreaks, `${keyPrefix}-max`)];
  }

  const styles = getInlineStyles(options);
  const nodes: React.ReactNode[] = [];
  let plainBuf = "";
  let tokenIdx = 0;

  const flushPlain = () => {
    if (!plainBuf) return;
    nodes.push(
      renderPlainSegment(plainBuf, preserveLineBreaks, `${keyPrefix}-t-${tokenIdx++}`)
    );
    plainBuf = "";
  };

  let i = 0;
  while (i < input.length) {
    // 1. Explicit LaTeX inline/display delimiters (before backslash escape)
    if (
      input.startsWith("\\(", i) ||
      input.startsWith("\\[", i) ||
      input.startsWith("$$", i)
    ) {
      const closeDelim = input.startsWith("\\(", i)
        ? "\\)"
        : input.startsWith("\\[", i)
          ? "\\]"
          : "$$";
      const closeIdx = input.indexOf(closeDelim, i + 2);
      if (closeIdx !== -1 && closeIdx > i + 2) {
        const inner = input.slice(i + 2, closeIdx);
        flushPlain();
        nodes.push(
          <span key={`${keyPrefix}-m-${tokenIdx++}`} className={styles.math}>
            {formatLatexMath(inner)}
          </span>
        );
        i = closeIdx + closeDelim.length;
        continue;
      }
    }

    // 2. Backslash escapes (\*, \`, \_, \\, \$100, etc.) & backslash line breaks
    if (input[i] === "\\" && i + 1 < input.length) {
      const next = input[i + 1];
      if (next === "\n") {
        flushPlain();
        if (preserveLineBreaks) {
          nodes.push(<br key={`${keyPrefix}-br-${tokenIdx++}`} />);
        } else {
          plainBuf += " ";
        }
        i += 2;
        continue;
      }
      if (ESCAPABLE_PUNCTUATION.has(next)) {
        plainBuf += next;
        i += 2;
        continue;
      }
    }

    // 3. Inline code spans (`code` or ``code with `inside` ``)
    if (input[i] === "`") {
      let ticks = 0;
      while (i + ticks < input.length && input[i + ticks] === "`") {
        ticks += 1;
      }
      const afterCode = skipBacktickSpan(input, i);
      if (afterCode !== -1) {
        let codeText = input.slice(i + ticks, afterCode - ticks);
        if (
          codeText.length >= 2 &&
          codeText.startsWith(" ") &&
          codeText.endsWith(" ") &&
          /[^\s]/.test(codeText)
        ) {
          codeText = codeText.slice(1, -1);
        }
        flushPlain();
        nodes.push(
          <code key={`${keyPrefix}-c-${tokenIdx++}`} className={styles.code}>
            {codeText}
          </code>
        );
        i = afterCode;
        continue;
      }
      plainBuf += input.slice(i, i + ticks);
      i += ticks;
      continue;
    }

    // 4. Safe HTML inline breaks, autolinks, and lightweight inline tags
    if (input[i] === "<") {
      const brMatch = input.slice(i).match(/^<br\s*\/?>/i);
      if (brMatch) {
        flushPlain();
        if (preserveLineBreaks) {
          nodes.push(<br key={`${keyPrefix}-hbr-${tokenIdx++}`} />);
        } else {
          plainBuf += " ";
        }
        i += brMatch[0].length;
        continue;
      }

      const autoLinkMatch = input
        .slice(i)
        .match(/^<((?:https?:\/\/|mailto:)[^>\s]+)>/i);
      if (autoLinkMatch) {
        const safeUrl = sanitizeHref(autoLinkMatch[1]);
        if (safeUrl) {
          flushPlain();
          nodes.push(
            <a
              key={`${keyPrefix}-al-${tokenIdx++}`}
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(safeUrl, options.onOpenLink);
              }}
              className={styles.link}
            >
              {autoLinkMatch[1]}
            </a>
          );
          i += autoLinkMatch[0].length;
          continue;
        }
      }

      const tagMatch = input
        .slice(i)
        .match(/^<(strong|b|em|i|code|kbd|s|del|u)>([\s\S]*?)<\/\1>/i);
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        const inner = tagMatch[2];
        const key = `${keyPrefix}-ht-${tokenIdx++}`;
        flushPlain();
        if (tag === "code") {
          nodes.push(
            <code key={key} className={styles.code}>
              {decodeSafeHtmlEntities(inner)}
            </code>
          );
        } else if (tag === "kbd") {
          nodes.push(
            <kbd key={key} className={styles.kbd}>
              {decodeSafeHtmlEntities(inner)}
            </kbd>
          );
        } else {
          const children = renderInlineMarkdown(
            inner,
            { ...options, keyPrefix: key },
            depth + 1
          );
          if (tag === "strong" || tag === "b") {
            nodes.push(
              <strong key={key} className="font-semibold text-white">
                {children}
              </strong>
            );
          } else if (tag === "em" || tag === "i") {
            nodes.push(
              <em key={key} className="italic text-zinc-100/95">
                {children}
              </em>
            );
          } else if (tag === "u") {
            nodes.push(
              <span key={key} className="underline underline-offset-2">
                {children}
              </span>
            );
          } else {
            nodes.push(
              <del key={key} className="line-through text-zinc-400">
                {children}
              </del>
            );
          }
        }
        i += tagMatch[0].length;
        continue;
      }
    }

    // 5. Markdown links & image fallbacks [label](url) / ![alt](url)
    if (input[i] === "[" || (input[i] === "!" && input[i + 1] === "[")) {
      const link = parseLinkAt(input, i);
      if (link) {
        const safeUrl = sanitizeHref(link.url);
        const key = `${keyPrefix}-lnk-${tokenIdx++}`;
        if (safeUrl) {
          flushPlain();
          const labelContent = link.label
            ? renderInlineMarkdown(link.label, { ...options, keyPrefix: key }, depth + 1)
            : [safeUrl];
          nodes.push(
            <a
              key={key}
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(safeUrl, options.onOpenLink);
              }}
              className={styles.link}
            >
              {link.isImage && !link.label ? "Imagen" : labelContent}
            </a>
          );
          i = link.end;
          continue;
        }
      }
    }

    // 6. Strong / emphasis / strikethrough delimiters
    if (input.startsWith("***", i) || input.startsWith("___", i)) {
      const delim = input.slice(i, i + 3);
      const isUnderscore = delim[0] === "_";
      const prevChar = i > 0 ? input[i - 1] : "";
      const nextChar = input[i + 3];
      const canOpen =
        Boolean(nextChar && !/\s/.test(nextChar)) &&
        (!isUnderscore || !isWordChar(prevChar));
      if (canOpen) {
        const closeIdx = findClosingDelimiter(input, i + 3, delim, isUnderscore);
        if (closeIdx !== -1 && closeIdx > i + 3) {
          const inner = input.slice(i + 3, closeIdx);
          const key = `${keyPrefix}-bi-${tokenIdx++}`;
          flushPlain();
          nodes.push(
            <strong key={key} className="font-semibold text-white">
              <em className="italic">
                {renderInlineMarkdown(inner, { ...options, keyPrefix: key }, depth + 1)}
              </em>
            </strong>
          );
          i = closeIdx + 3;
          continue;
        }
      }
    }

    if (input.startsWith("**", i) || input.startsWith("__", i)) {
      const delim = input.slice(i, i + 2);
      const isUnderscore = delim[0] === "_";
      const prevChar = i > 0 ? input[i - 1] : "";
      const nextChar = input[i + 2];
      const canOpen =
        Boolean(nextChar && !/\s/.test(nextChar)) &&
        (!isUnderscore || !isWordChar(prevChar));
      if (canOpen) {
        const closeIdx = findClosingDelimiter(input, i + 2, delim, isUnderscore);
        if (closeIdx !== -1 && closeIdx > i + 2) {
          const inner = input.slice(i + 2, closeIdx);
          // Leave raw unbackticked Python dunders like __init__ or __name__ intact
          const looksLikeDunder =
            isUnderscore && /^[a-z0-9_]+$/.test(inner) && !inner.includes(" ");
          if (!looksLikeDunder) {
            const key = `${keyPrefix}-b-${tokenIdx++}`;
            flushPlain();
            nodes.push(
              <strong key={key} className="font-semibold text-white">
                {renderInlineMarkdown(inner, { ...options, keyPrefix: key }, depth + 1)}
              </strong>
            );
            i = closeIdx + 2;
            continue;
          }
        }
      }
    }

    if (input.startsWith("~~", i)) {
      const nextChar = input[i + 2];
      if (nextChar && !/\s/.test(nextChar)) {
        const closeIdx = findClosingDelimiter(input, i + 2, "~~", false);
        if (closeIdx !== -1 && closeIdx > i + 2) {
          const inner = input.slice(i + 2, closeIdx);
          const key = `${keyPrefix}-s-${tokenIdx++}`;
          flushPlain();
          nodes.push(
            <del key={key} className="line-through text-zinc-400">
              {renderInlineMarkdown(inner, { ...options, keyPrefix: key }, depth + 1)}
            </del>
          );
          i = closeIdx + 2;
          continue;
        }
      }
    }

    if (input[i] === "*" || input[i] === "_") {
      const delim = input[i];
      const isUnderscore = delim === "_";
      const prevChar = i > 0 ? input[i - 1] : "";
      const nextChar = input[i + 1];
      const canOpen =
        Boolean(nextChar && !/\s/.test(nextChar) && nextChar !== delim) &&
        (!isUnderscore || !isWordChar(prevChar));
      if (canOpen) {
        const closeIdx = findClosingDelimiter(input, i + 1, delim, isUnderscore);
        if (closeIdx !== -1 && closeIdx > i + 1) {
          const inner = input.slice(i + 1, closeIdx);
          const key = `${keyPrefix}-i-${tokenIdx++}`;
          flushPlain();
          nodes.push(
            <em key={key} className="italic text-zinc-100/95">
              {renderInlineMarkdown(inner, { ...options, keyPrefix: key }, depth + 1)}
            </em>
          );
          i = closeIdx + 1;
          continue;
        }
      }
    }

    plainBuf += input[i];
    i += 1;
  }

  flushPlain();
  return nodes;
}

// ---------- Block-level Markdown parser ----------

type ListItem = {
  ordered: boolean;
  numberLabel?: string;
  checked?: boolean;
  indentLevel: number;
  text: string;
};

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string; filenameHint?: string; code: string }
  | { type: "math"; expr: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; items: ListItem[] }
  | { type: "hr" }
  | { type: "table"; table: MarkdownTableBlock };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const TASK_LIST_RE = /^(\s*)(?:[-*+•]\s+)?\[([ xX])\]\s+(.*)$/;
const BULLET_LIST_RE = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HR_RE = /^\s*(?:[-*_]\s*){3,}$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * Splits a Markdown table row by unescaped `|` while respecting inline backtick code spans.
 */
function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells: string[] = [];
  let current = "";
  let i = 0;
  let inCodeTicks = 0;

  while (i < trimmed.length) {
    if (trimmed[i] === "\\" && i + 1 < trimmed.length && trimmed[i + 1] === "|") {
      current += "|";
      i += 2;
      continue;
    }
    if (trimmed[i] === "`") {
      let run = 0;
      while (i + run < trimmed.length && trimmed[i + run] === "`") {
        run += 1;
      }
      if (inCodeTicks === 0) inCodeTicks = run;
      else if (inCodeTicks === run) inCodeTicks = 0;
      current += trimmed.slice(i, i + run);
      i += run;
      continue;
    }
    if (trimmed[i] === "|" && inCodeTicks === 0) {
      cells.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += trimmed[i];
    i += 1;
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function parseTableAlignments(line: string, colCount: number): MarkdownTableAlign[] {
  const raw = splitMarkdownTableRow(line);
  return Array.from({ length: colCount }, (_, idx) => {
    const spec = (raw[idx] ?? "").trim();
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function matchOpeningFence(
  line: string
): { fenceChar: string; fenceLen: number; indentLen: number; language: string; filenameHint?: string } | null {
  const m = line.match(FENCE_RE);
  if (!m) return null;
  const fenceChar = m[2][0];
  const info = m[3];
  // Per CommonMark, backtick fence info strings cannot contain backticks (prevents ```inline``` spans).
  if (fenceChar === "`" && info.includes("`")) {
    return null;
  }
  const parsed = parseCodeFenceInfo(info);
  return {
    fenceChar,
    fenceLen: m[2].length,
    indentLen: m[1].length,
    language: parsed.language,
    filenameHint: parsed.filenameHint,
  };
}

function isBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (matchOpeningFence(line)) return true;
  if (trimmed === "$$" || trimmed === "\\[") return true;
  if (HEADING_RE.test(trimmed)) return true;
  if (HR_RE.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (TASK_LIST_RE.test(line) || BULLET_LIST_RE.test(line) || ORDERED_LIST_RE.test(line)) {
    return true;
  }
  if (
    idx + 1 < lines.length &&
    line.includes("|") &&
    isTableSeparatorLine(lines[idx + 1])
  ) {
    return true;
  }
  return false;
}

function parseMarkdownBlocks(rawText: string): MarkdownBlock[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (closed or unclosed while streaming)
    const fence = matchOpeningFence(line);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length) {
        const closeLine = lines[i].trim();
        if (
          closeLine.startsWith(fence.fenceChar.repeat(fence.fenceLen)) &&
          new RegExp(`^${fence.fenceChar}{${fence.fenceLen},}\\s*$`).test(closeLine)
        ) {
          i += 1;
          break;
        }
        let contentLine = lines[i];
        if (fence.indentLen > 0) {
          let strip = 0;
          while (strip < fence.indentLen && strip < contentLine.length && contentLine[strip] === " ") {
            strip += 1;
          }
          if (strip > 0) {
            contentLine = contentLine.slice(strip);
          }
        }
        codeLines.push(contentLine);
        i += 1;
      }
      blocks.push({
        type: "code",
        language: fence.language,
        filenameHint: fence.filenameHint,
        code: codeLines.join("\n"),
      });
      continue;
    }

    // 2. Standalone multiline math block ($$ ... $$ or \[ ... \])
    if (trimmed === "$$" || trimmed === "\\[") {
      const closeToken = trimmed === "$$" ? "$$" : "\\]";
      const mathLines: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === closeToken) {
          i += 1;
          closed = true;
          break;
        }
        mathLines.push(lines[i]);
        i += 1;
      }
      if (closed || mathLines.length > 0) {
        blocks.push({ type: "math", expr: mathLines.join("\n") });
        continue;
      }
    }

    // 3. Markdown table
    if (i + 1 < lines.length && line.includes("|") && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitMarkdownTableRow(line);
      const alignments = parseTableAlignments(lines[i + 1], headers.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes("|") || isTableSeparatorLine(rowLine)) {
          break;
        }
        if (matchOpeningFence(rowLine) || HEADING_RE.test(rowTrimmed) || /^\s*>/.test(rowLine)) {
          break;
        }
        const cells = splitMarkdownTableRow(rowLine);
        while (cells.length < headers.length) cells.push("");
        rows.push(cells.slice(0, headers.length));
        i += 1;
      }
      blocks.push({ type: "table", table: { headers, alignments, rows } });
      continue;
    }

    // 4. Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // 5. Headings (# .. ######)
    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim().replace(/\s+#+\s*$/, ""),
      });
      i += 1;
      continue;
    }

    // 6. Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // 7. Lists (task, bullet, ordered) with indentation preservation
    const parseListLine = (raw: string): ListItem | null => {
      const task = raw.match(TASK_LIST_RE);
      if (task) {
        return {
          ordered: false,
          checked: task[2].toLowerCase() === "x",
          indentLevel: Math.min(Math.floor(task[1].length / 2), 4),
          text: task[3],
        };
      }
      const ord = raw.match(ORDERED_LIST_RE);
      if (ord) {
        return {
          ordered: true,
          numberLabel: ord[2],
          indentLevel: Math.min(Math.floor(ord[1].length / 2), 4),
          text: ord[3],
        };
      }
      const bul = raw.match(BULLET_LIST_RE);
      if (bul) {
        return {
          ordered: false,
          indentLevel: Math.min(Math.floor(bul[1].length / 2), 4),
          text: bul[2],
        };
      }
      return null;
    };

    const firstItem = parseListLine(line);
    if (firstItem) {
      const items: ListItem[] = [firstItem];
      i += 1;
      while (i < lines.length) {
        const nextItem = parseListLine(lines[i]);
        if (nextItem) {
          items.push(nextItem);
          i += 1;
          continue;
        }
        // Continuation line (indented or lazy paragraph continuation) under the current list item
        if (!/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) {
          items[items.length - 1].text += `\n${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // 8. Paragraph: group consecutive plain lines so wrapped **bold\nspans** match cleanly
    const paraLines: string[] = [line.trimEnd()];
    i += 1;
    while (i < lines.length && !isBlockStart(lines, i)) {
      paraLines.push(lines[i].trimEnd());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }

  return blocks;
}

function headingClassFor(level: number, compact: boolean): string {
  if (compact) {
    if (level <= 2) return "font-semibold text-white text-[13.5px] tracking-tight pt-0.5";
    return "font-semibold text-zinc-100 text-[13px] pt-0.5";
  }
  switch (level) {
    case 1:
      return "text-[16px] font-bold text-white tracking-tight pt-1.5";
    case 2:
      return "text-[15px] font-semibold text-white tracking-tight pt-1";
    case 3:
      return "text-[14px] font-semibold text-zinc-100 pt-1";
    default:
      return "text-[13px] font-semibold text-zinc-200 pt-0.5";
  }
}

/**
 * Full block + inline Markdown renderer shared across QuickBar, ChatMessageList,
 * and Markdown previews. Never emits raw HTML via `dangerouslySetInnerHTML`.
 */
export function MarkdownContent({
  text,
  variant = "default",
  compact = false,
  streaming = false,
  caretClassName,
  className,
  onOpenLink,
  renderTable,
}: MarkdownContentProps): React.ReactElement | null {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return streaming ? (
      <span
        className={
          caretClassName ??
          "inline-block w-1.5 h-3.5 align-middle bg-indigo-300/80 animate-pulse rounded-xs"
        }
      />
    ) : null;
  }

  const blocks = parseMarkdownBlocks(text);
  const isLiquid = variant === "liquid";
  const inlineOpts: InlineMarkdownOptions = {
    variant,
    onOpenLink,
    preserveLineBreaks: true,
  };

  const caretNode = streaming ? (
    <span
      className={
        caretClassName ??
        (isLiquid
          ? "inline-block w-1.5 h-3 ml-1 align-middle bg-indigo-200/85 animate-pulse rounded-xs"
          : "inline-block w-1.5 h-3.5 ml-1 align-middle bg-indigo-300/80 animate-pulse rounded-xs")
      }
    />
  ) : null;

  return (
    <div
      className={
        className ??
        (compact ? "space-y-1.5" : "space-y-2 text-[13.5px] leading-relaxed text-zinc-200")
      }
    >
      {blocks.map((block, bIdx) => {
        const isLastBlock = bIdx === blocks.length - 1;
        const tailCaret = isLastBlock ? caretNode : null;

        if (block.type === "hr") {
          return (
            <hr
              key={bIdx}
              className={isLiquid ? "my-1.5 border-white/15" : "my-2 border-white/10"}
            />
          );
        }

        if (block.type === "heading") {
          return (
            <p key={bIdx} className={headingClassFor(block.level, compact)}>
              {renderInlineMarkdown(block.text, {
                ...inlineOpts,
                keyPrefix: `h-${bIdx}`,
              })}
              {tailCaret}
            </p>
          );
        }

        if (block.type === "code") {
          return (
            <CodeBlockCard
              key={bIdx}
              code={block.code}
              language={block.language}
              filenameHint={block.filenameHint}
              variant={isLiquid ? "liquid" : "default"}
              compact={compact}
              tailCaret={tailCaret}
            />
          );
        }

        if (block.type === "math") {
          return (
            <div
              key={bIdx}
              className={
                isLiquid
                  ? "my-1 px-3 py-1.5 rounded-lg quick-liquid-subcard text-indigo-100 font-medium text-center overflow-x-auto"
                  : "my-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-indigo-100 font-medium text-center overflow-x-auto"
              }
            >
              {formatLatexMath(block.expr)}
              {tailCaret}
            </div>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={bIdx}
              className={
                isLiquid
                  ? "border-l-2 border-sky-300/45 bg-white/[0.045] pl-2.5 pr-2 py-1 rounded-r-lg text-zinc-200/95 space-y-1"
                  : "border-l-2 border-indigo-400/50 bg-white/[0.03] pl-3 pr-2.5 py-1.5 rounded-r-lg text-zinc-300 space-y-1"
              }
            >
              <MarkdownContent
                text={block.lines.join("\n")}
                variant={variant}
                compact={compact}
                streaming={isLastBlock ? streaming : false}
                caretClassName={caretClassName}
                onOpenLink={onOpenLink}
                className="space-y-1"
              />
            </blockquote>
          );
        }

        if (block.type === "list") {
          return (
            <div key={bIdx} className={compact ? "space-y-1" : "space-y-1.5"}>
              {block.items.map((item, itemIdx) => {
                const isLastItem = isLastBlock && itemIdx === block.items.length - 1;
                const indentPx = item.indentLevel * 14;
                return (
                  <div
                    key={itemIdx}
                    style={indentPx > 0 ? { paddingLeft: `${indentPx}px` } : undefined}
                    className="flex items-start gap-2"
                  >
                    {item.checked !== undefined ? (
                      <span
                        aria-hidden="true"
                        className={`mt-[3px] w-3.5 h-3.5 rounded-[4px] border inline-flex items-center justify-center shrink-0 ${
                          item.checked
                            ? isLiquid
                              ? "bg-sky-400/30 border-sky-300/60 text-sky-100"
                              : "bg-indigo-500/30 border-indigo-400/60 text-indigo-200"
                            : isLiquid
                              ? "bg-white/[0.06] border-white/25"
                              : "bg-white/[0.03] border-white/20"
                        }`}
                      >
                        {item.checked && (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none">
                            <path
                              d="M2.5 6.2L5 8.6L9.5 3.4"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    ) : item.ordered ? (
                      <span
                        className={`shrink-0 font-semibold tabular-nums ${
                          isLiquid ? "text-sky-100/90" : "text-zinc-400"
                        }`}
                      >
                        {item.numberLabel}.
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`shrink-0 leading-relaxed ${
                          isLiquid ? "text-sky-200/80" : "text-zinc-500"
                        }`}
                      >
                        {item.indentLevel > 0 ? "◦" : "•"}
                      </span>
                    )}
                    <div
                      className={`min-w-0 flex-1 ${
                        item.checked ? "line-through text-zinc-400/90" : ""
                      }`}
                    >
                      {renderInlineMarkdown(item.text, {
                        ...inlineOpts,
                        keyPrefix: `li-${bIdx}-${itemIdx}`,
                      })}
                      {isLastItem ? tailCaret : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        if (block.type === "table") {
          if (renderTable) {
            return (
              <React.Fragment key={bIdx}>
                {renderTable(block.table, bIdx)}
                {tailCaret}
              </React.Fragment>
            );
          }
          const { headers, alignments, rows } = block.table;
          return (
            <div
              key={bIdx}
              data-no-drag="true"
              className={`my-1.5 rounded-xl overflow-hidden ${
                isLiquid ? "quick-liquid-table" : "xook-liquid-table"
              }`}
            >
              <div
                tabIndex={0}
                role="region"
                aria-label="Tabla"
                className="overflow-x-auto xook-scroll"
              >
                <table className="w-full border-separate border-spacing-0 text-xs">
                  <thead
                    className={
                      isLiquid ? "quick-liquid-table-head" : "xook-liquid-table-head"
                    }
                  >
                    <tr>
                      {headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          scope="col"
                          className={`px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.04em] whitespace-nowrap ${
                            isLiquid ? "text-zinc-100/95" : "text-zinc-200/90"
                          } ${
                            alignments[hIdx] === "right"
                              ? "text-right"
                              : alignments[hIdx] === "center"
                                ? "text-center"
                                : "text-left"
                          }`}
                        >
                          {renderInlineMarkdown(header, {
                            ...inlineOpts,
                            keyPrefix: `th-${bIdx}-${hIdx}`,
                          })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={`xook-liquid-row ${rIdx % 2 === 1 ? "is-alt" : ""}`}
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`px-3 py-2 align-top text-zinc-100 ${
                              cIdx === 0 ? "font-medium text-white" : "text-zinc-200/95"
                            } ${
                              alignments[cIdx] === "right"
                                ? "text-right"
                                : alignments[cIdx] === "center"
                                  ? "text-center"
                                  : "text-left"
                            }`}
                          >
                            {cell
                              ? renderInlineMarkdown(cell, {
                                  ...inlineOpts,
                                  keyPrefix: `td-${bIdx}-${rIdx}-${cIdx}`,
                                })
                              : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tailCaret}
            </div>
          );
        }

        return (
          <p key={bIdx}>
            {renderInlineMarkdown(block.text, {
              ...inlineOpts,
              keyPrefix: `p-${bIdx}`,
            })}
            {tailCaret}
          </p>
        );
      })}
    </div>
  );
}
