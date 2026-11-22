import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  MemoryGraphNode,
  MemoryTier,
  UserMemoryCategory,
  UserMemoryFact,
} from "@xook/contracts";
import {
  Bold,
  Check,
  Eye,
  FolderOpen,
  GitBranch,
  Globe,
  Heading,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  XOX_ACCENT_PRESETS,
  XoxSilhouetteIcon,
  resolveXoxAccentPreset,
  type XoxAccentPreset,
  type XoxAccentSpec,
} from "../../components/XoxStar";
import type { GlobalXoxProfile } from "./xoxStudioApi";

export type PreferenceBucket = "likes" | "workflows" | "donts";

export interface MemoryWordEditorProps {
  agentName: string;
  accentColor: string;
  accentPreset?: XoxAccentPreset;
  selectedNode: MemoryGraphNode | null;
  allNodes: MemoryGraphNode[];
  connectedNodes?: MemoryGraphNode[];
  isWideMode?: boolean;
  userMemoryFacts: UserMemoryFact[];
  workspaceFacts: string[];
  profile: GlobalXoxProfile;
  activeWorkspaceName?: string | null;
  hasActiveWorkspace?: boolean;
  createMode: boolean;
  initialCreateScope?: "global" | "workspace";
  initialCreateCategory?: UserMemoryCategory;
  onExitCreateMode: () => void;
  onEnterCreateMode: (opts?: {
    scope?: "global" | "workspace";
    category?: UserMemoryCategory;
  }) => void;
  onSelectNode: (nodeId: string) => void;
  onSaveFact: (input: {
    value: string;
    key?: string;
    category?: UserMemoryCategory;
    pinned?: boolean;
  }) => Promise<void>;
  onTogglePinFact: (fact: UserMemoryFact) => Promise<void>;
  onDeleteFact: (idOrKey: string) => Promise<void>;
  onUpdateWorkspaceFact?: (rawOldLine: string, nextText: string) => Promise<void>;
  onDeleteWorkspaceFact?: (rawLine: string) => Promise<void>;
  onAddWorkspaceFact?: (text: string) => Promise<void>;
  onUpdatePreference?: (
    bucket: PreferenceBucket,
    index: number,
    nextText: string
  ) => Promise<void>;
  onDeletePreference?: (
    bucket: PreferenceBucket,
    index: number
  ) => Promise<void>;
  onAskXoxEditMemory?: (prefillPrompt: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  identity: "Identidad",
  preference: "Preferencias",
  work: "Trabajo",
  contact: "Contactos",
  routine: "Rutina",
  project: "Proyectos",
  other: "Otros",
  workspace: "Espacio",
  pattern: "Patrones",
};

const USER_FACT_CATEGORY_OPTIONS: Array<{
  id: UserMemoryCategory;
  label: string;
}> = [
  { id: "preference", label: "Preferencia" },
  { id: "work", label: "Trabajo" },
  { id: "project", label: "Proyecto" },
  { id: "routine", label: "Rutina" },
  { id: "contact", label: "Contacto" },
  { id: "identity", label: "Identidad (L0)" },
  { id: "other", label: "Otro" },
];

const PREF_BUCKET_LABELS: Record<PreferenceBucket, string> = {
  likes: "Gusto",
  workflows: "Flujo",
  donts: "Evitar",
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (full.length !== 6) return `rgba(176, 158, 248, ${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getTierAccentStyle(
  tier: MemoryTier,
  accent: XoxAccentSpec
): {
  short: string;
  dotStyle: React.CSSProperties;
  badgeStyle: React.CSSProperties;
} {
  const l2Color = accent.bodyLower ?? accent.deep;
  if (tier === "L0_core") {
    return {
      short: "L0",
      dotStyle: {
        backgroundColor: accent.blushCore,
        boxShadow: `0 0 0 1.5px ${hexToRgba(accent.glow, 0.55)}`,
      },
      badgeStyle: {
        backgroundColor: hexToRgba(accent.glow, 0.16),
        borderColor: hexToRgba(accent.rim, 0.42),
        color: accent.blushCore,
      },
    };
  }
  if (tier === "L1_contextual") {
    return {
      short: "L1",
      dotStyle: {
        backgroundColor: accent.celebrateMid,
        boxShadow: `0 0 0 1.5px ${hexToRgba(accent.accessory, 0.5)}`,
      },
      badgeStyle: {
        backgroundColor: hexToRgba(accent.accessory, 0.16),
        borderColor: hexToRgba(accent.accessory, 0.42),
        color: accent.celebrateMid,
      },
    };
  }
  return {
    short: "L2",
    dotStyle: {
      backgroundColor: l2Color,
    },
    badgeStyle: {
      backgroundColor: hexToRgba(l2Color, 0.16),
      borderColor: hexToRgba(l2Color, 0.38),
      color: "#d4d4d8",
    },
  };
}

function stripPreferencePrefix(text: string): string {
  return text.replace(/^(?:Gustos?|Flujo|Evitar)\s*:\s*/i, "").trim();
}

function inferPreferenceBucket(node: MemoryGraphNode): PreferenceBucket | null {
  if (node.preferenceBucket) return node.preferenceBucket;
  const detail = node.detail.trim();
  if (/^Evitar\s*:/i.test(detail)) return "donts";
  if (/^Flujo\s*:/i.test(detail)) return "workflows";
  if (/^Gustos?\s*:/i.test(detail)) return "likes";
  const fk = (node.factKey || "").toLowerCase();
  if (fk.includes("evitar") || fk.includes("dont")) return "donts";
  if (fk.includes("flujo") || fk.includes("workflow")) return "workflows";
  if (fk.includes("gusto") || fk.includes("like")) return "likes";
  return null;
}

type ResolvedSource =
  | { kind: "user_fact"; fact: UserMemoryFact; initialText: string; initialKey: string }
  | { kind: "workspace_fact"; rawLine: string; initialText: string }
  | {
      kind: "preference";
      bucket: PreferenceBucket;
      index: number;
      initialText: string;
    }
  | { kind: "pattern"; initialText: string }
  | { kind: "readonly"; initialText: string };

function resolveNodeSource(
  node: MemoryGraphNode,
  userMemoryFacts: UserMemoryFact[],
  workspaceFacts: string[],
  profile: GlobalXoxProfile
): ResolvedSource {
  const effectiveKind =
    node.sourceKind ?? (node.kind === "fact" ? "user_fact" : node.kind);

  if (effectiveKind === "user_fact") {
    const targetRaw = (node.rawText ?? node.detail).trim();
    const matched =
      userMemoryFacts.find(
        (f) =>
          (node.factId && f.id === node.factId) ||
          (node.factKey && f.key === node.factKey) ||
          f.value.trim() === targetRaw
      ) ?? null;
    if (matched) {
      return {
        kind: "user_fact",
        fact: matched,
        initialText: matched.value,
        initialKey: matched.key || node.label,
      };
    }
    return { kind: "readonly", initialText: node.detail };
  }

  if (effectiveKind === "workspace_fact") {
    let rawLine = node.rawText?.trim() || "";
    if (
      !rawLine &&
      typeof node.sourceIndex === "number" &&
      workspaceFacts[node.sourceIndex]
    ) {
      rawLine = workspaceFacts[node.sourceIndex];
    }
    if (!rawLine) {
      const cleanTarget = node.detail.trim();
      const matched = workspaceFacts.find((line) => {
        const stripped = line.replace(/^[-*•]\s*/, "").trim();
        return stripped === cleanTarget || stripped.includes(cleanTarget);
      });
      rawLine = matched ?? node.detail;
    }
    return {
      kind: "workspace_fact",
      rawLine,
      initialText: node.detail.trim(),
    };
  }

  if (effectiveKind === "preference") {
    const bucket = inferPreferenceBucket(node);
    const cleanText = (node.rawText ?? stripPreferencePrefix(node.detail)).trim();
    if (bucket) {
      const list = profile[bucket] ?? [];
      let idx =
        typeof node.sourceIndex === "number" &&
        node.sourceIndex >= 0 &&
        node.sourceIndex < list.length
          ? node.sourceIndex
          : -1;
      if (idx < 0) {
        idx = list.findIndex(
          (item) => item.replace(/\s+/g, " ").trim() === cleanText
        );
      }
      if (idx >= 0) {
        return {
          kind: "preference",
          bucket,
          index: idx,
          initialText: list[idx] ?? cleanText,
        };
      }
    }
    return { kind: "readonly", initialText: cleanText || node.detail };
  }

  if (effectiveKind === "pattern") {
    return { kind: "pattern", initialText: node.detail };
  }

  return { kind: "readonly", initialText: node.detail };
}

/** Renderizador seguro y ligero de inline markdown (**negrita**, *cursiva*) sin HTML crudo. */
function renderInlineMarkdown(line: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-b-${idx++}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <em key={`${keyPrefix}-i-${idx++}`} className="italic text-zinc-200">
          {token.slice(1, -1)}
        </em>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [line];
}

function renderMiniMarkdownPreview(text: string): React.ReactNode {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-[11.5px] leading-relaxed text-zinc-200 select-text">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          return <div key={`sp-${idx}`} className="h-1" />;
        }
        const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
        if (headingMatch) {
          return (
            <div
              key={`h-${idx}`}
              className="text-[12px] font-semibold text-white tracking-tight"
            >
              {renderInlineMarkdown(headingMatch[1], `h-${idx}`)}
            </div>
          );
        }
        const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div key={`ul-${idx}`} className="flex items-start gap-1.5 pl-0.5">
              <span className="text-zinc-400 select-none">•</span>
              <span className="flex-1">
                {renderInlineMarkdown(bulletMatch[1], `ul-${idx}`)}
              </span>
            </div>
          );
        }
        const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (orderedMatch) {
          return (
            <div key={`ol-${idx}`} className="flex items-start gap-1.5 pl-0.5">
              <span className="text-zinc-400 font-mono text-[10.5px] tabular-nums select-none">
                {orderedMatch[1]}.
              </span>
              <span className="flex-1">
                {renderInlineMarkdown(orderedMatch[2], `ol-${idx}`)}
              </span>
            </div>
          );
        }
        return <p key={`p-${idx}`}>{renderInlineMarkdown(line, `p-${idx}`)}</p>;
      })}
    </div>
  );
}

export const MemoryWordEditor: React.FC<MemoryWordEditorProps> = ({
  agentName,
  accentPreset,
  selectedNode,
  allNodes,
  connectedNodes = [],
  isWideMode = false,
  userMemoryFacts,
  workspaceFacts,
  profile,
  activeWorkspaceName,
  hasActiveWorkspace = false,
  createMode,
  initialCreateScope = "global",
  initialCreateCategory = "preference",
  onExitCreateMode,
  onEnterCreateMode,
  onSelectNode,
  onSaveFact,
  onTogglePinFact,
  onDeleteFact,
  onUpdateWorkspaceFact,
  onDeleteWorkspaceFact,
  onAddWorkspaceFact,
  onUpdatePreference,
  onDeletePreference,
  onAskXoxEditMemory,
}) => {
  const uid = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accent = XOX_ACCENT_PRESETS[resolveXoxAccentPreset(accentPreset)];
  const l2Color = accent.bodyLower ?? accent.deep;

  const isHubSelected = !createMode && selectedNode?.kind === "hub";
  const isCreating = createMode || !selectedNode || selectedNode.kind === "hub";
  const isCategory = !isCreating && selectedNode?.kind === "category";

  // Estado del editor en modo hoja (leaf)
  const resolvedSource = useMemo(() => {
    if (!selectedNode || isCreating || isCategory) return null;
    return resolveNodeSource(
      selectedNode,
      userMemoryFacts,
      workspaceFacts,
      profile
    );
  }, [
    selectedNode,
    isCreating,
    isCategory,
    userMemoryFacts,
    workspaceFacts,
    profile,
  ]);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [previewMode, setPreviewMode] = useState(false);

  // Estado del editor en modo creación
  const [newScope, setNewScope] = useState<"global" | "workspace">(
    initialCreateScope
  );
  const [newCategory, setNewCategory] = useState<UserMemoryCategory>(
    initialCreateCategory
  );
  const [newPinned, setNewPinned] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canAddWorkspace = Boolean(
    onAddWorkspaceFact && (hasActiveWorkspace || activeWorkspaceName)
  );

  // Sincroniza borradores al cambiar de nodo seleccionado o entrar a modo creación
  const lastNodeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    setErrorMsg(null);
    if (isCreating) {
      lastNodeKeyRef.current = "__create__";
      setPreviewMode(false);
      return;
    }
    if (isCategory) {
      lastNodeKeyRef.current = selectedNode?.id ?? null;
      return;
    }
    if (selectedNode && resolvedSource) {
      const initialKey =
        resolvedSource.kind === "user_fact"
          ? resolvedSource.initialKey
          : selectedNode.label;
      const nodeSignature = `${selectedNode.id}::${initialKey}::${resolvedSource.initialText}`;
      if (lastNodeKeyRef.current !== nodeSignature) {
        lastNodeKeyRef.current = nodeSignature;
        setDraftTitle(initialKey);
        setDraftText(resolvedSource.initialText);
        setPreviewMode(false);
      }
    }
  }, [isCreating, isCategory, selectedNode, resolvedSource]);

  useEffect(() => {
    if (createMode) {
      setNewScope(
        initialCreateScope === "workspace" && canAddWorkspace
          ? "workspace"
          : "global"
      );
      setNewCategory(initialCreateCategory);
      setNewPinned(initialCreateCategory === "identity");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [createMode, initialCreateScope, initialCreateCategory, canAddWorkspace]);

  // --- Helpers de formato estilo Mini Word ---
  const activeValue = isCreating ? newText : draftText;
  const setActiveValue = isCreating ? setNewText : setDraftText;

  const focusAndSelect = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const applyWrapFormat = (marker: "**" | "*", placeholder: string) => {
    setPreviewMode(false);
    const el = textareaRef.current;
    const text = activeValue;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    const len = marker.length;

    if (start !== end) {
      const selected = text.slice(start, end);
      if (
        selected.startsWith(marker) &&
        selected.endsWith(marker) &&
        selected.length > len * 2
      ) {
        const inner = selected.slice(len, -len);
        const next = text.slice(0, start) + inner + text.slice(end);
        setActiveValue(next);
        focusAndSelect(start, start + inner.length);
        return;
      }
      if (
        start >= len &&
        text.slice(start - len, start) === marker &&
        text.slice(end, end + len) === marker
      ) {
        const next =
          text.slice(0, start - len) + selected + text.slice(end + len);
        setActiveValue(next);
        focusAndSelect(start - len, end - len);
        return;
      }
      const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
      setActiveValue(next);
      focusAndSelect(start + len, end + len);
      return;
    }

    const next = `${text.slice(0, start)}${marker}${placeholder}${marker}${text.slice(end)}`;
    setActiveValue(next);
    focusAndSelect(start + len, start + len + placeholder.length);
  };

  const applyLinePrefix = (mode: "bullet" | "numbered" | "heading") => {
    setPreviewMode(false);
    const el = textareaRef.current;
    const text = activeValue;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;

    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const rawLineEnd = text.indexOf("\n", end);
    const lineEnd = rawLineEnd === -1 ? text.length : rawLineEnd;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split("\n");

    let transformed: string[];
    if (mode === "bullet") {
      const allBulleted = lines.every((l) => !l.trim() || /^[-*•]\s+/.test(l));
      transformed = lines.map((l) => {
        if (!l.trim()) return l;
        if (allBulleted) return l.replace(/^[-*•]\s+/, "");
        return `- ${l.replace(/^(?:[-*•]|\d+\.|#{1,3})\s+/, "")}`;
      });
    } else if (mode === "numbered") {
      const allNumbered = lines.every((l) => !l.trim() || /^\d+\.\s+/.test(l));
      let n = 1;
      transformed = lines.map((l) => {
        if (!l.trim()) return l;
        if (allNumbered) return l.replace(/^\d+\.\s+/, "");
        return `${n++}. ${l.replace(/^(?:[-*•]|\d+\.|#{1,3})\s+/, "")}`;
      });
    } else {
      const allHeadings = lines.every((l) => !l.trim() || /^#{1,3}\s+/.test(l));
      transformed = lines.map((l) => {
        if (!l.trim()) return l;
        if (allHeadings) return l.replace(/^#{1,3}\s+/, "");
        return `### ${l.replace(/^(?:[-*•]|\d+\.|#{1,3})\s+/, "")}`;
      });
    }

    const replaced = transformed.join("\n");
    const next = text.slice(0, lineStart) + replaced + text.slice(lineEnd);
    setActiveValue(next);
    focusAndSelect(lineStart, lineStart + replaced.length);
  };

  // --- Acciones CRUD ---
  const canEditLeaf = useMemo(() => {
    if (!resolvedSource) return false;
    if (resolvedSource.kind === "user_fact") return true;
    if (resolvedSource.kind === "workspace_fact")
      return Boolean(onUpdateWorkspaceFact);
    if (resolvedSource.kind === "preference") return Boolean(onUpdatePreference);
    return false;
  }, [resolvedSource, onUpdateWorkspaceFact, onUpdatePreference]);

  const canDeleteLeaf = useMemo(() => {
    if (!resolvedSource) return false;
    if (resolvedSource.kind === "user_fact") return true;
    if (resolvedSource.kind === "workspace_fact")
      return Boolean(onDeleteWorkspaceFact);
    if (resolvedSource.kind === "preference") return Boolean(onDeletePreference);
    return false;
  }, [resolvedSource, onDeleteWorkspaceFact, onDeletePreference]);

  const isLeafDirty =
    !isCreating &&
    !isCategory &&
    Boolean(resolvedSource) &&
    (draftText.trim() !== resolvedSource!.initialText.trim() ||
      (resolvedSource!.kind === "user_fact" &&
        draftTitle.trim() !== "" &&
        draftTitle.trim() !== resolvedSource!.initialKey.trim()));

  const handleSaveLeaf = async () => {
    if (!resolvedSource || !canEditLeaf) return;
    const trimmed = draftText.trim();
    if (!trimmed) return;
    setBusyKey("save");
    setErrorMsg(null);
    try {
      if (resolvedSource.kind === "user_fact") {
        const nextKey = draftTitle.trim() || resolvedSource.fact.key;
        await onSaveFact({
          value: trimmed,
          key: nextKey,
          category: resolvedSource.fact.category,
          pinned: resolvedSource.fact.pinned,
        });
        lastNodeKeyRef.current = `${selectedNode?.id ?? ""}::${nextKey}::${trimmed}`;
      } else if (
        resolvedSource.kind === "workspace_fact" &&
        onUpdateWorkspaceFact
      ) {
        await onUpdateWorkspaceFact(resolvedSource.rawLine, trimmed);
        lastNodeKeyRef.current = `${selectedNode?.id ?? ""}::${selectedNode?.label ?? ""}::${trimmed}`;
      } else if (resolvedSource.kind === "preference" && onUpdatePreference) {
        await onUpdatePreference(
          resolvedSource.bucket,
          resolvedSource.index,
          trimmed
        );
        lastNodeKeyRef.current = `${selectedNode?.id ?? ""}::${selectedNode?.label ?? ""}::${trimmed}`;
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudieron guardar los cambios."
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteNode = async (node: MemoryGraphNode) => {
    const src = resolveNodeSource(
      node,
      userMemoryFacts,
      workspaceFacts,
      profile
    );
    setBusyKey(`del:${node.id}`);
    setErrorMsg(null);
    try {
      if (src.kind === "user_fact") {
        await onDeleteFact(src.fact.id || src.fact.key);
      } else if (src.kind === "workspace_fact" && onDeleteWorkspaceFact) {
        await onDeleteWorkspaceFact(src.rawLine);
      } else if (src.kind === "preference" && onDeletePreference) {
        await onDeletePreference(src.bucket, src.index);
      }
      if (selectedNode?.id === node.id) {
        onSelectNode("hub_core");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo eliminar el recuerdo."
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleTogglePin = async () => {
    if (!resolvedSource || resolvedSource.kind !== "user_fact") return;
    setBusyKey("pin");
    setErrorMsg(null);
    try {
      await onTogglePinFact(resolvedSource.fact);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo actualizar L0."
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreateSubmit = async () => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setBusyKey("create");
    setErrorMsg(null);
    try {
      if (newScope === "workspace" && onAddWorkspaceFact) {
        await onAddWorkspaceFact(trimmed);
      } else {
        await onSaveFact({
          value: trimmed,
          key: newTitle.trim() ? newTitle.trim() : undefined,
          category: newCategory,
          pinned: newPinned || newCategory === "identity",
        });
      }
      setNewTitle("");
      setNewText("");
      setNewPinned(false);
      setPreviewMode(false);
      onExitCreateMode();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el recuerdo."
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleAskXox = () => {
    if (!onAskXoxEditMemory) return;
    if (isCreating) {
      onAskXoxEditMemory(
        `Guarda esto en mi memoria (${newScope === "workspace" ? "espacio actual" : "global"}): ${newText.trim() || ""}`
      );
      return;
    }
    if (!selectedNode) return;
    if (isCategory) {
      const catName =
        CATEGORY_LABELS[selectedNode.category] || selectedNode.label;
      onAskXoxEditMemory(
        `Revisa y organiza mis recuerdos de la categoría "${catName}" en mi memoria: `
      );
      return;
    }
    if (resolvedSource?.kind === "workspace_fact") {
      onAskXoxEditMemory(
        `Actualiza o refina este hecho de mi espacio ("${resolvedSource.initialText}"): `
      );
    } else if (resolvedSource?.kind === "preference") {
      onAskXoxEditMemory(
        `Actualiza esta preferencia (${PREF_BUCKET_LABELS[resolvedSource.bucket]}: "${resolvedSource.initialText}"): `
      );
    } else if (resolvedSource?.kind === "pattern") {
      onAskXoxEditMemory(
        `Revisa este patrón que detectaste ("${resolvedSource.initialText}"): `
      );
    } else {
      onAskXoxEditMemory(
        `Actualiza este recuerdo en mi memoria ("${draftText.trim() || selectedNode.detail}"): `
      );
    }
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        applyWrapFormat("**", "negrita");
      } else if (k === "i") {
        e.preventDefault();
        applyWrapFormat("*", "cursiva");
      } else if (k === "enter") {
        e.preventDefault();
        if (isCreating && newText.trim()) {
          void handleCreateSubmit();
        } else if (!isCreating && isLeafDirty && canEditLeaf) {
          void handleSaveLeaf();
        }
      }
    }
  };

  // --- Sección reusable: Enlaces en el grafo (Backlinks / Nodos conectados estilo Obsidian) ---
  const renderBacklinksFooter = () => {
    if (!connectedNodes || connectedNodes.length === 0) return null;
    return (
      <div className="px-2.5 py-1.5 bg-[#0e1015] border-t border-white/[0.06] space-y-1 shrink-0">
        <div className="flex items-center justify-between gap-2 text-[9.5px] font-medium uppercase tracking-wider text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <GitBranch className="w-2.5 h-2.5 text-zinc-500" aria-hidden="true" />
            <span>Enlaces en el grafo</span>
          </span>
          <span className="font-mono text-zinc-500">
            {connectedNodes.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1 max-h-[68px] overflow-y-auto">
          {connectedNodes.map((neighbor) => {
            const isNeighborHub = neighbor.kind === "hub";
            const isNeighborCat = neighbor.kind === "category";
            const neighborLabel = isNeighborHub
              ? agentName
              : isNeighborCat
                ? `#${(CATEGORY_LABELS[neighbor.category] || neighbor.label).toLowerCase()}`
                : neighbor.label;

            const dotStyle: React.CSSProperties = isNeighborCat
              ? { backgroundColor: accent.rim }
              : neighbor.tier === "L0_core"
                ? {
                    backgroundColor: accent.blushCore,
                    boxShadow: `0 0 0 1.5px ${hexToRgba(accent.glow, 0.5)}`,
                  }
                : neighbor.tier === "L1_contextual"
                  ? {
                      backgroundColor: accent.celebrateMid,
                      boxShadow: `0 0 0 1.5px ${hexToRgba(accent.accessory, 0.45)}`,
                    }
                  : { backgroundColor: l2Color };

            return (
              <button
                key={neighbor.id}
                type="button"
                onClick={() => onSelectNode(neighbor.id)}
                title={`Saltar a ${neighborLabel}: ${neighbor.detail}`}
                className="h-5 px-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.11] border border-white/[0.07] hover:border-white/[0.18] text-[10px] text-zinc-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer max-w-[180px]"
              >
                {isNeighborHub ? (
                  <XoxSilhouetteIcon className="w-3 h-3 text-white shrink-0" />
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={dotStyle}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">{neighborLabel}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // --- MODO CATEGORÍA: lista compacta para inspeccionar / podar nodos hijos ---
  const categoryChildren = useMemo(() => {
    if (!isCategory || !selectedNode) return [];
    return allNodes.filter(
      (n) =>
        n.kind !== "hub" &&
        n.kind !== "category" &&
        n.category === selectedNode.category
    );
  }, [isCategory, selectedNode, allNodes]);

  if (isCategory && selectedNode) {
    const catLabel =
      CATEGORY_LABELS[selectedNode.category] || selectedNode.label;
    const catTokens = categoryChildren.reduce(
      (sum, n) => sum + n.tokenEstimate,
      0
    );
    const isWorkspaceCat = selectedNode.category === "workspace";
    const defaultCat: UserMemoryCategory =
      selectedNode.category === "workspace" ||
      selectedNode.category === "pattern"
        ? "other"
        : selectedNode.category;

    return (
      <section
        aria-label={`Categoría ${catLabel}`}
        className={`rounded-xl border border-white/[0.08] bg-[#121318] flex flex-col justify-between ${
          isWideMode
            ? "h-full min-h-0 overflow-hidden"
            : "shrink-0 max-h-[44%] overflow-y-auto"
        }`}
      >
        <div className={isWideMode ? "flex-1 min-h-0 flex flex-col" : ""}>
          <div className="px-3 py-2 bg-[#16181f] border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10.5px] font-medium truncate"
                style={{
                  backgroundColor: hexToRgba(accent.rim, 0.14),
                  borderColor: hexToRgba(accent.rim, 0.36),
                  color: accent.rim,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: accent.rim }}
                  aria-hidden="true"
                />
                <span>#{catLabel.toLowerCase()}</span>
              </span>
              <span className="text-[10.5px] font-mono text-zinc-400 shrink-0">
                {categoryChildren.length}{" "}
                {categoryChildren.length === 1 ? "nota" : "notas"} · ~{catTokens} tok
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onAskXoxEditMemory && (
                <button
                  type="button"
                  onClick={handleAskXox}
                  title={`Pedirle a ${agentName} que edite esta categoría`}
                  className="h-6 px-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.09] text-[10.5px] text-zinc-100 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <XoxSilhouetteIcon className="w-3.5 h-3.5 text-white shrink-0" />
                  <span>Con {agentName}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onEnterCreateMode({
                    scope:
                      isWorkspaceCat && canAddWorkspace ? "workspace" : "global",
                    category: defaultCat,
                  })
                }
                className="h-6 px-2 rounded-lg bg-white text-zinc-950 hover:bg-zinc-200 text-[10.5px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                <span>Nuevo</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="px-3 py-1.5 bg-rose-500/10 border-b border-rose-400/20 text-[10.5px] text-rose-200 shrink-0">
              {errorMsg}
            </div>
          )}

          {categoryChildren.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-zinc-400 flex-1 flex items-center justify-center">
              Sin notas activas en esta etiqueta.
            </div>
          ) : (
            <ul
              className={`${
                isWideMode ? "flex-1 min-h-0" : "max-h-[156px]"
              } overflow-y-auto divide-y divide-white/[0.05]`}
            >
              {categoryChildren.map((child) => {
                const tierMeta = getTierAccentStyle(child.tier, accent);
                const childSource = resolveNodeSource(
                  child,
                  userMemoryFacts,
                  workspaceFacts,
                  profile
                );
                const deletable =
                  childSource.kind === "user_fact" ||
                  (childSource.kind === "workspace_fact" &&
                    Boolean(onDeleteWorkspaceFact)) ||
                  (childSource.kind === "preference" &&
                    Boolean(onDeletePreference));
                const isDeleting = busyKey === `del:${child.id}`;

                return (
                  <li
                    key={child.id}
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.035] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNode(child.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={tierMeta.dotStyle}
                        aria-hidden="true"
                      />
                      <span className="text-[11.5px] text-zinc-200 group-hover:text-white truncate flex-1">
                        {child.detail}
                      </span>
                      <span className="text-[9.5px] font-mono text-zinc-500 shrink-0">
                        {tierMeta.short} · ~{child.tokenEstimate}t
                      </span>
                    </button>

                    {deletable && (
                      <button
                        type="button"
                        disabled={Boolean(busyKey)}
                        onClick={() => void handleDeleteNode(child)}
                        title="Quitar nota del grafo"
                        aria-label={`Quitar: ${child.label}`}
                        className="w-5 h-5 rounded-md inline-flex items-center justify-center text-zinc-500 hover:text-rose-200 hover:bg-rose-500/15 transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                      >
                        {isDeleting ? (
                          <Loader2
                            className="w-3 h-3 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <X className="w-3 h-3" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {renderBacklinksFooter()}
      </section>
    );
  }

  // --- MODO CREAR O EDITAR HOJA (MINI WORD / OBSIDIAN NOTE EDITOR) ---
  const showToolbarFormatting = isCreating || canEditLeaf;
  const userFactSource =
    !isCreating && resolvedSource?.kind === "user_fact"
      ? resolvedSource.fact
      : null;
  const prefBucketLabel =
    !isCreating && resolvedSource?.kind === "preference"
      ? PREF_BUCKET_LABELS[resolvedSource.bucket]
      : null;
  const showEditableTitle =
    (isCreating && newScope === "global") || Boolean(userFactSource);

  const selectedTierStyle = selectedNode
    ? getTierAccentStyle(selectedNode.tier, accent)
    : null;
  const isCreateL0Active = newPinned || newCategory === "identity";
  const isLeafL0Active = Boolean(
    userFactSource &&
      (userFactSource.pinned || userFactSource.category === "identity")
  );

  return (
    <section
      aria-label={
        isCreating ? "Nuevo recuerdo de memoria" : "Editor de recuerdo"
      }
      className={`rounded-xl border border-white/[0.08] bg-[#121318] flex flex-col justify-between ${
        isWideMode
          ? "h-full min-h-0 overflow-hidden"
          : "shrink-0 max-h-[44%] overflow-y-auto"
      }`}
    >
      <div className={isWideMode ? "flex-1 min-h-0 flex flex-col" : ""}>
        {/* Inspector del Hub central de Xox cuando el nodo central está seleccionado */}
        {isHubSelected && selectedNode && (
          <div className="px-2.5 py-1.5 bg-[#171920] border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <XoxSilhouetteIcon className="w-3.5 h-3.5 text-white shrink-0" />
              <span className="text-[10.5px] font-semibold text-white truncate">
                {agentName} · Núcleo de memoria
              </span>
              <span className="text-[10px] font-mono text-zinc-400 truncate hidden sm:inline">
                ({selectedNode.detail})
              </span>
            </div>
            <span className="text-[9.5px] font-mono text-zinc-400 shrink-0">
              Red central Obsidian
            </span>
          </div>
        )}

        {/* 1. Cabecera compacta de metadatos o selector de nuevo recuerdo */}
        <div className="px-2.5 py-1.5 bg-[#15171e] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-1.5 shrink-0">
          {isCreating ? (
            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-white">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: accent.rim }}
                  aria-hidden="true"
                />
                <span>Nueva nota</span>
              </span>

              {/* Selector Global / Espacio */}
              <div
                role="group"
                aria-label="Alcance del nuevo recuerdo"
                className="inline-flex items-center p-0.5 rounded-lg bg-black/45 border border-white/[0.08]"
              >
                <button
                  type="button"
                  aria-pressed={newScope === "global"}
                  onClick={() => setNewScope("global")}
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                    newScope === "global"
                      ? "bg-white/[0.14] text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Globe className="w-2.5 h-2.5" aria-hidden="true" />
                  <span>Global</span>
                </button>
                {canAddWorkspace && (
                  <button
                    type="button"
                    aria-pressed={newScope === "workspace"}
                    onClick={() => setNewScope("workspace")}
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      newScope === "workspace"
                        ? "bg-white/[0.14] text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <FolderOpen className="w-2.5 h-2.5" aria-hidden="true" />
                    <span>Espacio</span>
                  </button>
                )}
              </div>

              {newScope === "global" ? (
                <>
                  <select
                    aria-label="Categoría del recuerdo"
                    value={newCategory}
                    onChange={(e) => {
                      const cat = e.target.value as UserMemoryCategory;
                      setNewCategory(cat);
                      if (cat === "identity") setNewPinned(true);
                    }}
                    className="h-6 px-1.5 rounded-lg bg-black/50 border border-white/[0.09] text-[10.5px] text-zinc-200 focus:outline-none focus:border-white/25"
                  >
                    {USER_FACT_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={newCategory === "identity"}
                    aria-pressed={isCreateL0Active}
                    onClick={() => setNewPinned((v) => !v)}
                    title="Fijar en núcleo L0 para que siempre esté disponible al inicio"
                    className={`h-6 px-2 rounded-lg border text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-65 ${
                      isCreateL0Active
                        ? ""
                        : "bg-black/40 border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                    }`}
                    style={
                      isCreateL0Active
                        ? {
                            backgroundColor: hexToRgba(accent.glow, 0.18),
                            borderColor: hexToRgba(accent.rim, 0.42),
                            color: accent.blushCore,
                          }
                        : undefined
                    }
                  >
                    <Pin className="w-2.5 h-2.5" aria-hidden="true" />
                    <span>L0</span>
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-zinc-400 truncate max-w-[140px]">
                  {activeWorkspaceName || "Espacio actual"}
                </span>
              )}
            </div>
          ) : (
            selectedNode &&
            selectedTierStyle && (
              <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onSelectNode(`cat_${selectedNode.category}`)}
                  title="Ver etiqueta en el grafo"
                  className="px-1.5 py-0.5 rounded-md border text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: hexToRgba(accent.rim, 0.14),
                    borderColor: hexToRgba(accent.rim, 0.36),
                    color: accent.rim,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: accent.rim }}
                    aria-hidden="true"
                  />
                  <span>
                    #
                    {(
                      CATEGORY_LABELS[selectedNode.category] ||
                      selectedNode.category
                    ).toLowerCase()}
                  </span>
                </button>
                {prefBucketLabel && (
                  <span className="px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-zinc-300">
                    {prefBucketLabel}
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.07] text-[10px] text-zinc-400">
                  {selectedNode.scope === "workspace"
                    ? activeWorkspaceName || "Espacio"
                    : "Global"}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-medium inline-flex items-center gap-1"
                  style={selectedTierStyle.badgeStyle}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={selectedTierStyle.dotStyle}
                    aria-hidden="true"
                  />
                  <span>{selectedTierStyle.short}</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {selectedNode.tier === "L2_ondemand"
                    ? `0t inicio (~${selectedNode.tokenEstimate}t)`
                    : `~${selectedNode.tokenEstimate} tok`}
                </span>
                {typeof selectedNode.confidence === "number" && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    · {Math.round(selectedNode.confidence * 100)}%
                  </span>
                )}
              </div>
            )
          )}

          {isCreating && createMode && (
            <button
              type="button"
              onClick={onExitCreateMode}
              aria-label="Cerrar modo nuevo recuerdo"
              className="w-5 h-5 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* 2. Cinta de herramientas estilo Mini Word / Obsidian Ribbon */}
        <div
          role="toolbar"
          aria-label="Formato y acciones de memoria"
          className="px-2 py-1 bg-[#16181f] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-1.5 shrink-0"
        >
          <div className="inline-flex items-center gap-0.5">
            {showToolbarFormatting ? (
              <>
                <button
                  type="button"
                  onClick={() => applyWrapFormat("**", "negrita")}
                  title="Negrita (Ctrl/Cmd+B)"
                  aria-label="Negrita"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <Bold className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => applyWrapFormat("*", "cursiva")}
                  title="Cursiva (Ctrl/Cmd+I)"
                  aria-label="Cursiva"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <Italic className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => applyLinePrefix("bullet")}
                  title="Lista con viñetas"
                  aria-label="Lista con viñetas"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <List className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => applyLinePrefix("numbered")}
                  title="Lista numerada"
                  aria-label="Lista numerada"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => applyLinePrefix("heading")}
                  title="Encabezado (###)"
                  aria-label="Encabezado"
                  className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                >
                  <Heading className="w-3.5 h-3.5" aria-hidden="true" />
                </button>

                <span
                  className="w-px h-3.5 bg-white/[0.09] mx-1"
                  aria-hidden="true"
                />

                <button
                  type="button"
                  aria-pressed={previewMode}
                  onClick={() => setPreviewMode((v) => !v)}
                  title={
                    previewMode ? "Volver a editar" : "Vista previa con formato"
                  }
                  className={`h-6 px-1.5 rounded-md text-[10px] inline-flex items-center gap-1 transition-colors cursor-pointer ${
                    previewMode
                      ? "bg-white/[0.12] text-white"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.07]"
                  }`}
                >
                  {previewMode ? (
                    <>
                      <Pencil className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Editar</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Vista</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <span className="text-[10px] text-zinc-400 px-1">
                Solo lectura
              </span>
            )}
          </div>

          {/* Acciones contextuales derechas */}
          <div className="inline-flex items-center gap-1">
            {userFactSource && (
              <button
                type="button"
                disabled={
                  busyKey === "pin" || userFactSource.category === "identity"
                }
                onClick={() => void handleTogglePin()}
                title={
                  userFactSource.category === "identity"
                    ? "Identidad siempre permanece en L0"
                    : userFactSource.pinned
                      ? "Desfijar de L0 (mover a L2 bajo demanda)"
                      : "Fijar en L0 (siempre presente al inicio)"
                }
                className={`h-6 px-1.5 rounded-md border text-[10px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-45 ${
                  isLeafL0Active
                    ? ""
                    : "bg-white/[0.03] border-white/[0.08] text-zinc-300 hover:text-white hover:bg-white/[0.08]"
                }`}
                style={
                  isLeafL0Active
                    ? {
                        backgroundColor: hexToRgba(accent.glow, 0.18),
                        borderColor: hexToRgba(accent.rim, 0.42),
                        color: accent.blushCore,
                      }
                    : undefined
                }
              >
                {busyKey === "pin" ? (
                  <Loader2
                    className="w-2.5 h-2.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : userFactSource.pinned ? (
                  <PinOff className="w-2.5 h-2.5" aria-hidden="true" />
                ) : (
                  <Pin className="w-2.5 h-2.5" aria-hidden="true" />
                )}
                <span>L0</span>
              </button>
            )}

            {onAskXoxEditMemory && (
              <button
                type="button"
                onClick={handleAskXox}
                title={`Editar o refinar con ${agentName} en vivo`}
                className="h-6 px-2 rounded-md bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.1] text-[10px] font-medium text-zinc-100 hover:text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <XoxSilhouetteIcon className="w-3.5 h-3.5 text-white shrink-0" />
                <span>Con {agentName}</span>
              </button>
            )}

            {!isCreating && canDeleteLeaf && selectedNode && (
              <button
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => void handleDeleteNode(selectedNode)}
                title="Eliminar recuerdo"
                aria-label="Eliminar recuerdo"
                className="h-6 w-6 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/25 text-rose-200 inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-45"
              >
                {busyKey === `del:${selectedNode.id}` ? (
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                )}
              </button>
            )}

            {isCreating ? (
              <button
                type="button"
                disabled={!newText.trim() || Boolean(busyKey)}
                onClick={() => void handleCreateSubmit()}
                className="h-6 px-2.5 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40"
              >
                {busyKey === "create" ? (
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Check className="w-3 h-3" aria-hidden="true" />
                )}
                <span>Guardar en grafo</span>
              </button>
            ) : (
              canEditLeaf && (
                <button
                  type="button"
                  disabled={
                    !isLeafDirty || !draftText.trim() || Boolean(busyKey)
                  }
                  onClick={() => void handleSaveLeaf()}
                  className="h-6 px-2.5 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-35"
                >
                  {busyKey === "save" ? (
                    <Loader2
                      className="w-3 h-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Check className="w-3 h-3" aria-hidden="true" />
                  )}
                  <span>Guardar</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Título / Clave editable de la nota estilo Obsidian */}
        {showEditableTitle && (
          <div className="px-3 pt-2 pb-1 bg-[#101217] border-b border-white/[0.04] shrink-0">
            <input
              id={`${uid}-memory-note-title`}
              type="text"
              value={isCreating ? newTitle : draftTitle}
              onChange={(e) =>
                isCreating
                  ? setNewTitle(e.target.value)
                  : setDraftTitle(e.target.value)
              }
              placeholder={
                isCreating
                  ? "Título o clave de la nota (opcional)…"
                  : "Título / clave de la nota…"
              }
              aria-label="Título o clave de la nota"
              className="w-full bg-transparent text-[12px] font-semibold text-white placeholder:text-zinc-500 focus:outline-none select-text"
            />
          </div>
        )}

        {/* 3. Cuerpo editable tipo Obsidian / Word */}
        <div
          className={`bg-[#101217] ${
            isWideMode ? "flex-1 min-h-0 flex flex-col" : ""
          }`}
        >
          {previewMode && showToolbarFormatting ? (
            <div
              className={`px-3 py-2 ${
                isWideMode ? "flex-1 min-h-0" : "min-h-[76px] max-h-[116px]"
              } overflow-y-auto`}
            >
              {activeValue.trim() ? (
                renderMiniMarkdownPreview(activeValue)
              ) : (
                <p className="text-[11px] text-zinc-500 italic">
                  Escribe una nota para ver el formato aquí…
                </p>
              )}
            </div>
          ) : showToolbarFormatting ? (
            <textarea
              ref={textareaRef}
              id={`${uid}-memory-word-body`}
              rows={isWideMode ? 8 : 3}
              maxLength={800}
              value={activeValue}
              onChange={(e) => setActiveValue(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={
                isCreating
                  ? newScope === "workspace"
                    ? "Ej. Las entregas del proyecto se validan cada viernes antes de las 17:00..."
                    : "Ej. Prefiero respuestas breves con pasos numerados y sin rodeos..."
                  : "Edita esta nota en Markdown…"
              }
              aria-label={
                isCreating
                  ? "Contenido del nuevo recuerdo"
                  : "Contenido del recuerdo"
              }
              className={`w-full ${
                isWideMode
                  ? "flex-1 min-h-[160px] h-full"
                  : "min-h-[76px] max-h-[116px]"
              } px-3 py-2 bg-transparent text-[11.5px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none select-text`}
            />
          ) : (
            <div
              className={`px-3 py-2.5 ${
                isWideMode ? "flex-1 min-h-0" : "min-h-[60px] max-h-[108px]"
              } overflow-y-auto text-[11.5px] leading-relaxed text-zinc-200 select-text`}
            >
              {resolvedSource?.initialText || selectedNode?.detail}
            </div>
          )}
        </div>
      </div>

      {/* 4. Enlaces en el grafo (Backlinks / Nodos conectados estilo Obsidian) */}
      {renderBacklinksFooter()}

      {errorMsg && (
        <div
          role="alert"
          className="px-3 py-1.5 border-t border-rose-400/20 bg-rose-500/10 text-[10.5px] text-rose-200 flex items-center justify-between gap-2 shrink-0"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-200/75 hover:text-white cursor-pointer"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
};
