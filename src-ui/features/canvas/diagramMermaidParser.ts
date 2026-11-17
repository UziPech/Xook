import type {
  CanvasDiagramDirection,
  CanvasDiagramEdge,
  CanvasDiagramNode,
  CanvasDiagramNodeShape,
  CanvasDiagramSpec,
  CanvasDiagramType,
} from "./canvasSchema";

function cleanNodeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNodeToken(token: string): {
  id: string;
  label?: string;
  shape?: CanvasDiagramNodeShape;
} {
  let clean = token.trim();
  // Quitar sufijo de clase Mermaid :::clase
  clean = clean.replace(/:::[a-zA-Z0-9_-]+$/, "").trim();

  // Patrones ordenados de delimitadores más específicos a más simples
  const patterns: Array<{ re: RegExp; shape: CanvasDiagramNodeShape }> = [
    { re: /^([A-Za-z0-9_.-]+)\(\[([\s\S]+)\]\)$/, shape: "pill" },
    { re: /^([A-Za-z0-9_.-]+)\(\(([\s\S]+)\)\)$/, shape: "pill" },
    { re: /^([A-Za-z0-9_.-]+)\[\(([\s\S]+)\)\]$/, shape: "cylinder" },
    { re: /^([A-Za-z0-9_.-]+)\[\[([\s\S]+)\]\]$/, shape: "note" },
    { re: /^([A-Za-z0-9_.-]+)\{\{([\s\S]+)\}\}$/, shape: "diamond" },
    { re: /^([A-Za-z0-9_.-]+)\{([\s\S]+)\}$/, shape: "diamond" },
    { re: /^([A-Za-z0-9_.-]+)\(([\s\S]+)\)$/, shape: "pill" },
    { re: /^([A-Za-z0-9_.-]+)\[([\s\S]+)\]$/, shape: "rounded" },
    { re: /^([A-Za-z0-9_.-]+)>([\s\S]+)\]$/, shape: "note" },
  ];

  for (const { re, shape } of patterns) {
    const m = clean.match(re);
    if (m) {
      return {
        id: m[1].trim(),
        label: cleanNodeLabel(m[2]),
        shape,
      };
    }
  }

  const bareId = clean.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^_+|_+$/g, "");
  return { id: bareId || clean };
}

function splitEdgeChain(line: string): Array<{
  rawNode: string;
  edgeFromPrev?: { label?: string; style: "solid" | "dashed" };
}> {
  // Reconoce flechas Mermaid comunes con etiqueta opcional:
  // -->|texto|, -- texto -->, -.->|texto|, -. texto .->, ==>|texto|, == texto ==>, ---
  const arrowRe =
    /(?:<)?(?:-\.+(?:([^.\->\n]+)\.)?->|={2,}(?:([^=>\n]+)=>)?|-{2,}(?:([^-<\n>]+)->)?|>|\.-+->)(?:\|([^|\n]+)\|)?/g;

  const segments: Array<{
    rawNode: string;
    edgeFromPrev?: { label?: string; style: "solid" | "dashed" };
  }> = [];

  let lastIdx = 0;
  let pendingEdge: { label?: string; style: "solid" | "dashed" } | undefined;

  // Tokenizador robusto por operadores Mermaid estándar
  const opRe =
    /(-->\s*\|[^|]+\||-\.->\s*\|[^|]+\||==>\s*\|[^|]+\||--\s+[^-\n]+\s+-->|-\.\s+[^.\n]+\s+\.->|==\s+[^=\n]+\s+==>|-\.->|-->|==>|---)/g;

  let m: RegExpExecArray | null;
  while ((m = opRe.exec(line)) !== null) {
    const chunk = line.slice(lastIdx, m.index).trim();
    if (chunk) {
      segments.push({ rawNode: chunk, edgeFromPrev: pendingEdge });
    }
    const op = m[1];
    const isDashed = op.includes(".");
    let edgeLabel: string | undefined;

    const pipeMatch = op.match(/\|([^|]+)\|/);
    if (pipeMatch) {
      edgeLabel = cleanNodeLabel(pipeMatch[1]);
    } else {
      const inlineMatch =
        op.match(/^--\s+(.+?)\s+-->$/) ||
        op.match(/^-\.\s+(.+?)\s+\.->$/) ||
        op.match(/^==\s+(.+?)\s+==>$/);
      if (inlineMatch) {
        edgeLabel = cleanNodeLabel(inlineMatch[1]);
      }
    }

    pendingEdge = {
      label: edgeLabel || undefined,
      style: isDashed ? "dashed" : "solid",
    };
    lastIdx = opRe.lastIndex;
  }

  const tail = line.slice(lastIdx).trim();
  if (tail && pendingEdge) {
    segments.push({ rawNode: tail, edgeFromPrev: pendingEdge });
  } else if (segments.length === 0 && tail) {
    // Línea con solo definición de nodo
    segments.push({ rawNode: tail });
  }

  void arrowRe;
  return segments;
}

function parseFlowchartLines(
  lines: string[],
  direction: CanvasDiagramDirection
): CanvasDiagramSpec | null {
  const nodeMap = new Map<string, CanvasDiagramNode>();
  const edges: CanvasDiagramEdge[] = [];
  const groupStack: string[] = [];

  const ensureNode = (rawToken: string): string => {
    const parsed = parseNodeToken(rawToken);
    if (!parsed.id) return "";
    const existing = nodeMap.get(parsed.id);
    const currentGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
    if (!existing) {
      nodeMap.set(parsed.id, {
        id: parsed.id,
        label: parsed.label || parsed.id,
        shape: parsed.shape || "rounded",
        tone: parsed.shape === "diamond" ? "warning" : parsed.shape === "pill" ? "accent" : "neutral",
        ...(currentGroup ? { group: currentGroup } : {}),
      });
    } else {
      if (parsed.label && existing.label === existing.id) {
        existing.label = parsed.label;
      }
      if (parsed.shape && existing.shape === "rounded") {
        existing.shape = parsed.shape;
      }
      if (!existing.group && currentGroup) {
        existing.group = currentGroup;
      }
    }
    return parsed.id;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/;+$/, "").trim();
    if (!line || line.startsWith("%%")) continue;
    if (/^(flowchart|graph|direction|style|classDef|class|linkStyle|click)\b/i.test(line)) {
      if (/^direction\s+(LR|RL)\b/i.test(line)) direction = "LR";
      if (/^direction\s+(TD|TB|BT)\b/i.test(line)) direction = "TD";
      continue;
    }
    if (/^subgraph\b/i.test(line)) {
      const subRest = line.replace(/^subgraph\b/i, "").trim();
      const bracketMatch = subRest.match(/^[A-Za-z0-9_.-]+\s*\[([^\]]+)\]/);
      const groupName = cleanNodeLabel(bracketMatch ? bracketMatch[1] : subRest) || "Grupo";
      groupStack.push(groupName);
      continue;
    }
    if (/^end$/i.test(line)) {
      groupStack.pop();
      continue;
    }

    const chain = splitEdgeChain(line);
    if (chain.length === 0) continue;

    let prevIds: string[] = [];
    for (const seg of chain) {
      const groupTokens = seg.rawNode
        .split(/\s*&\s*/)
        .map((t) => t.trim())
        .filter(Boolean);
      const currentIds = groupTokens.map(ensureNode).filter(Boolean);
      if (seg.edgeFromPrev && prevIds.length > 0 && currentIds.length > 0) {
        for (const fromId of prevIds) {
          for (const toId of currentIds) {
            edges.push({
              id: `e_${edges.length + 1}`,
              from: fromId,
              to: toId,
              label: seg.edgeFromPrev.label,
              style: seg.edgeFromPrev.style,
            });
          }
        }
      }
      prevIds = currentIds;
    }
  }

  const nodes = Array.from(nodeMap.values());
  if (nodes.length === 0) return null;

  return {
    diagramType: "flowchart",
    direction,
    nodes,
    edges,
  };
}

function parseSequenceLines(lines: string[]): CanvasDiagramSpec | null {
  const nodeMap = new Map<string, CanvasDiagramNode>();
  const edges: CanvasDiagramEdge[] = [];

  const ensureActor = (rawId: string, label?: string) => {
    const id = rawId.trim();
    if (!id) return "";
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        label: label ? cleanNodeLabel(label) : id,
        shape: "pill",
        tone: "neutral",
      });
    } else if (label) {
      const prev = nodeMap.get(id)!;
      if (prev.label === prev.id) prev.label = cleanNodeLabel(label);
    }
    return id;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%") || /^sequenceDiagram\b/i.test(line)) continue;
    const partMatch = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i);
    if (partMatch) {
      ensureActor(partMatch[1], partMatch[2]);
      continue;
    }
    const msgMatch = line.match(
      /^([A-Za-z0-9_.-]+?)\s*(--?>>|--?>|->>|->)\s*[+-]?([A-Za-z0-9_.-]+?)\s*:\s*(.+)$/
    );
    if (msgMatch) {
      const from = ensureActor(msgMatch[1]);
      const arrow = msgMatch[2];
      const to = ensureActor(msgMatch[3]);
      const msg = cleanNodeLabel(msgMatch[4]);
      if (from && to) {
        edges.push({
          id: `seq_${edges.length + 1}`,
          from,
          to,
          label: msg,
          style: arrow.startsWith("--") ? "dashed" : "solid",
        });
      }
    }
  }

  const nodes = Array.from(nodeMap.values());
  if (nodes.length === 0) return null;

  return {
    diagramType: "sequence",
    direction: "LR",
    nodes,
    edges,
  };
}

function parseMindmapLines(lines: string[]): CanvasDiagramSpec | null {
  const nodes: CanvasDiagramNode[] = [];
  const edges: CanvasDiagramEdge[] = [];
  const stack: Array<{ indent: number; id: string }> = [];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("%%")) continue;
    if (/^mindmap\b/i.test(rawLine.trim())) continue;
    const indent = rawLine.search(/\S/);
    let label = rawLine.trim();
    // Limpiar wrappers Mermaid mindmap: root((Texto)), (Texto), [Texto], {{Texto}}
    label = label
      .replace(/^root\s*/i, "")
      .replace(/^(?:\(\(|\[|\{\{|\(|\)\)|\]|\}\}|\))+/g, "")
      .replace(/(?:\)\)|\]|\}\}|\))+$/g, "")
      .trim();
    label = cleanNodeLabel(label);
    if (!label) continue;

    const id = `mm_${nodes.length + 1}`;
    const isRoot = nodes.length === 0;
    nodes.push({
      id,
      label,
      shape: isRoot ? "pill" : "rounded",
      tone: isRoot ? "accent" : "neutral",
    });

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length > 0) {
      edges.push({
        id: `mme_${edges.length + 1}`,
        from: stack[stack.length - 1].id,
        to: id,
        style: "solid",
      });
    }
    stack.push({ indent, id });
  }

  if (nodes.length === 0) return null;
  return {
    diagramType: "mindmap",
    direction: "LR",
    nodes,
    edges,
  };
}

export function parseMermaidToDiagramSpec(rawMermaid: string): CanvasDiagramSpec | null {
  const cleaned = (rawMermaid || "")
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!cleaned) return null;

  const lines = cleaned.split(/\r?\n/);
  const firstMeaningful =
    lines.find((l) => l.trim() && !l.trim().startsWith("%%"))?.trim() ?? "";

  if (/^sequenceDiagram\b/i.test(firstMeaningful)) {
    const parsed = parseSequenceLines(lines);
    if (parsed) return { ...parsed, mermaid: cleaned };
  }

  if (/^mindmap\b/i.test(firstMeaningful)) {
    const parsed = parseMindmapLines(lines);
    if (parsed) return { ...parsed, mermaid: cleaned };
  }

  let direction: CanvasDiagramDirection = "TD";
  const dirMatch = firstMeaningful.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i);
  if (dirMatch) {
    const rawDir = dirMatch[1].toUpperCase();
    direction = rawDir === "LR" || rawDir === "RL" ? "LR" : "TD";
  }

  const parsedFlow = parseFlowchartLines(lines, direction);
  if (parsedFlow) {
    return { ...parsedFlow, mermaid: cleaned };
  }

  return null;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\r?\n/g, " ");
}

function formatMermaidNode(node: CanvasDiagramNode): string {
  const safeId = node.id.replace(/[^A-Za-z0-9_]/g, "_") || "N";
  const txt = `"${escapeMermaidLabel(node.label)}"`;
  switch (node.shape) {
    case "diamond":
      return `${safeId}{${txt}}`;
    case "pill":
      return `${safeId}([${txt}])`;
    case "cylinder":
      return `${safeId}[(${txt})]`;
    case "note":
      return `${safeId}[[${txt}]]`;
    default:
      return `${safeId}[${txt}]`;
  }
}

export function diagramSpecToMermaid(spec: CanvasDiagramSpec): string {
  if (spec.mermaid && spec.mermaid.trim()) {
    return spec.mermaid.trim();
  }

  const type: CanvasDiagramType = spec.diagramType || "flowchart";
  if (type === "sequence") {
    const lines = ["sequenceDiagram"];
    spec.nodes.forEach((n) => {
      const sid = n.id.replace(/[^A-Za-z0-9_]/g, "_") || "P";
      lines.push(`  participant ${sid} as ${escapeMermaidLabel(n.label)}`);
    });
    spec.edges.forEach((e) => {
      const f = e.from.replace(/[^A-Za-z0-9_]/g, "_");
      const t = e.to.replace(/[^A-Za-z0-9_]/g, "_");
      const arrow = e.style === "dashed" ? "-->>" : "->>";
      lines.push(`  ${f}${arrow}${t}: ${escapeMermaidLabel(e.label || "Paso")}`);
    });
    return lines.join("\n");
  }

  const dir = spec.direction === "LR" ? "LR" : "TD";
  const lines = [`flowchart ${dir}`];
  const declared = new Set<string>();
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));

  spec.nodes.forEach((n) => {
    lines.push(`  ${formatMermaidNode(n)}`);
    declared.add(n.id);
  });

  spec.edges.forEach((e) => {
    const fNode = nodeById.get(e.from);
    const tNode = nodeById.get(e.to);
    const fId = (fNode ? fNode.id : e.from).replace(/[^A-Za-z0-9_]/g, "_");
    const tId = (tNode ? tNode.id : e.to).replace(/[^A-Za-z0-9_]/g, "_");
    const arrow = e.style === "dashed" ? "-.->" : "-->";
    if (e.label && e.label.trim()) {
      lines.push(`  ${fId} ${arrow}|"${escapeMermaidLabel(e.label.trim())}"| ${tId}`);
    } else {
      lines.push(`  ${fId} ${arrow} ${tId}`);
    }
    if (!declared.has(e.from)) declared.add(e.from);
    if (!declared.has(e.to)) declared.add(e.to);
  });

  return lines.join("\n");
}
