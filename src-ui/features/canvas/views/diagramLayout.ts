import type {
  CanvasDiagramDirection,
  CanvasDiagramEdge,
  CanvasDiagramNode,
  CanvasDiagramNodeShape,
  CanvasDiagramNodeTone,
  CanvasDiagramSpec,
} from "../canvasSchema";

export interface PositionedDiagramNode {
  node: CanvasDiagramNode;
  x: number; // center x
  y: number; // center y
  width: number;
  height: number;
  labelLines: string[];
  subtitleLine?: string;
  rank: number;
}

export interface PositionedDiagramEdge {
  edge: CanvasDiagramEdge;
  index: number;
  path: string;
  labelX: number;
  labelY: number;
  isBackEdge: boolean;
}

export interface PositionedDiagramGroup {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SequenceLifeline {
  node: CanvasDiagramNode;
  x: number;
  topY: number;
  bottomY: number;
  width: number;
  height: number;
  labelLines: string[];
}

export interface DiagramLayoutResult {
  mode: "graph" | "sequence";
  width: number;
  height: number;
  nodes: PositionedDiagramNode[];
  edges: PositionedDiagramEdge[];
  groups: PositionedDiagramGroup[];
  lifelines: SequenceLifeline[];
}

function wrapTextLines(text: string, maxCharsPerLine: number, maxLines = 3): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxCharsPerLine && !current) {
      lines.push(word.slice(0, maxCharsPerLine - 1) + "…");
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  // Si sobraron palabras, truncar última línea limpiamente
  const usedWords = lines.join(" ").split(" ").length;
  if (usedWords < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length > maxCharsPerLine - 2
        ? `${last.slice(0, maxCharsPerLine - 2)}…`
        : `${last}…`;
  }
  return lines;
}

function measureNodeBox(node: CanvasDiagramNode): {
  width: number;
  height: number;
  labelLines: string[];
  subtitleLine?: string;
} {
  const shape: CanvasDiagramNodeShape = node.shape || "rounded";
  const maxChars = shape === "diamond" ? 16 : 23;
  const labelLines = wrapTextLines(node.label, maxChars, 3);
  const longestLine = Math.max(...labelLines.map((l) => l.length), 6);
  const subTrim = node.subtitle?.trim();
  const subtitleLine = subTrim
    ? subTrim.length > 26
      ? `${subTrim.slice(0, 25)}…`
      : subTrim
    : undefined;

  const textW = Math.max(longestLine * 7.2, subtitleLine ? subtitleLine.length * 6.0 : 0);
  if (shape === "diamond") {
    const w = Math.max(138, Math.min(220, Math.round(textW + 64)));
    const h = Math.max(84, labelLines.length * 16 + 44);
    return { width: w, height: h, labelLines, subtitleLine };
  }

  const w = Math.max(136, Math.min(248, Math.round(textW + 38)));
  const h =
    Math.max(46, labelLines.length * 16 + 22) + (subtitleLine ? 15 : 0);
  return { width: w, height: h, labelLines, subtitleLine };
}

function layoutSequenceDiagram(spec: CanvasDiagramSpec): DiagramLayoutResult {
  const padX = 40;
  const padY = 34;
  const headerH = 48;
  const colGap = 185;
  const rowGap = 62;
  const nodes = spec.nodes;
  const edges = spec.edges;

  const lifelines: SequenceLifeline[] = nodes.map((node, idx) => {
    const labelLines = wrapTextLines(node.label, 18, 2);
    const w = Math.max(118, Math.min(168, Math.max(...labelLines.map((l) => l.length)) * 7.5 + 28));
    const x = padX + 80 + idx * colGap;
    return {
      node,
      x,
      topY: padY,
      bottomY: padY + headerH + Math.max(1, edges.length) * rowGap + 36,
      width: w,
      height: headerH,
      labelLines,
    };
  });

  const lifelineById = new Map(lifelines.map((l) => [l.node.id, l]));
  const positionedNodes: PositionedDiagramNode[] = lifelines.map((l, idx) => ({
    node: l.node,
    x: l.x,
    y: l.topY + l.height / 2,
    width: l.width,
    height: l.height,
    labelLines: l.labelLines,
    rank: idx,
  }));

  const positionedEdges: PositionedDiagramEdge[] = [];
  edges.forEach((edge, idx) => {
    const src = lifelineById.get(edge.from);
    const dst = lifelineById.get(edge.to);
    if (!src || !dst) return;
    const y = padY + headerH + 42 + idx * rowGap;
    if (src.node.id === dst.node.id) {
      const loopW = 46;
      const loopH = 26;
      const path = `M ${src.x} ${y} L ${src.x + loopW} ${y} L ${src.x + loopW} ${y + loopH} L ${src.x + 4} ${y + loopH}`;
      positionedEdges.push({
        edge,
        index: idx,
        path,
        labelX: src.x + loopW + 12,
        labelY: y + loopH / 2,
        isBackEdge: false,
      });
      return;
    }
    const dir = dst.x >= src.x ? 1 : -1;
    const startX = src.x + dir * 4;
    const endX = dst.x - dir * 6;
    const path = `M ${startX} ${y} L ${endX} ${y}`;
    positionedEdges.push({
      edge,
      index: idx,
      path,
      labelX: (startX + endX) / 2,
      labelY: y - 14,
      isBackEdge: dir < 0,
    });
  });

  const totalW = Math.max(420, padX * 2 + Math.max(1, lifelines.length - 1) * colGap + 160);
  const totalH = Math.max(260, padY * 2 + headerH + Math.max(1, edges.length) * rowGap + 48);

  return {
    mode: "sequence",
    width: totalW,
    height: totalH,
    nodes: positionedNodes,
    edges: positionedEdges,
    groups: [],
    lifelines,
  };
}

function layoutGraphDiagram(spec: CanvasDiagramSpec): DiagramLayoutResult {
  const direction: CanvasDiagramDirection = spec.direction === "LR" ? "LR" : "TD";
  const nodes = spec.nodes;
  const edges = spec.edges;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  nodes.forEach((n) => {
    outAdj.set(n.id, []);
    inAdj.set(n.id, []);
  });
  validEdges.forEach((e) => {
    if (e.from !== e.to) {
      outAdj.get(e.from)?.push(e.to);
      inAdj.get(e.to)?.push(e.from);
    }
  });

  // Asignación de rangos tolerante a ciclos (DFS + relajación acíclica)
  const rank = new Map<string, number>();
  nodes.forEach((n) => rank.set(n.id, 0));

  const roots = nodes.filter((n) => (inAdj.get(n.id)?.length ?? 0) === 0);
  const startOrder = roots.length > 0 ? roots : [nodes[0]];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const backEdges = new Set<string>();

  const dfs = (id: string) => {
    visiting.add(id);
    for (const nxt of outAdj.get(id) ?? []) {
      if (visiting.has(nxt)) {
        backEdges.add(`${id}->${nxt}`);
      } else if (!visited.has(nxt)) {
        dfs(nxt);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const r of startOrder) {
    if (!visited.has(r.id)) dfs(r.id);
  }
  for (const n of nodes) {
    if (!visited.has(n.id)) dfs(n.id);
  }

  // Relajación de camino más largo ignorando backEdges
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of validEdges) {
      if (e.from === e.to || backEdges.has(`${e.from}->${e.to}`)) continue;
      const rFrom = rank.get(e.from) ?? 0;
      const rTo = rank.get(e.to) ?? 0;
      if (rTo < rFrom + 1) {
        rank.set(e.to, rFrom + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const maxRank = Math.max(0, ...Array.from(rank.values()));
  const layers: CanvasDiagramNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  nodes.forEach((n) => {
    const r = rank.get(n.id) ?? 0;
    layers[r].push(n);
  });

  // Ordenamiento por baricentro para reducir cruces de líneas
  const orderInLayer = new Map<string, number>();
  layers.forEach((layer) => {
    layer.forEach((n, idx) => orderInLayer.set(n.id, idx));
  });

  for (let iter = 0; iter < 3; iter += 1) {
    for (let r = 1; r < layers.length; r += 1) {
      layers[r].sort((a, b) => {
        const parentsA = (inAdj.get(a.id) ?? []).filter((p) => (rank.get(p) ?? 0) < r);
        const parentsB = (inAdj.get(b.id) ?? []).filter((p) => (rank.get(p) ?? 0) < r);
        const avgA =
          parentsA.length > 0
            ? parentsA.reduce((s, p) => s + (orderInLayer.get(p) ?? 0), 0) / parentsA.length
            : orderInLayer.get(a.id) ?? 0;
        const avgB =
          parentsB.length > 0
            ? parentsB.reduce((s, p) => s + (orderInLayer.get(p) ?? 0), 0) / parentsB.length
            : orderInLayer.get(b.id) ?? 0;
        return avgA - avgB;
      });
      layers[r].forEach((n, idx) => orderInLayer.set(n.id, idx));
    }
    for (let r = layers.length - 2; r >= 0; r -= 1) {
      layers[r].sort((a, b) => {
        const kidsA = (outAdj.get(a.id) ?? []).filter((c) => (rank.get(c) ?? 0) > r);
        const kidsB = (outAdj.get(b.id) ?? []).filter((c) => (rank.get(c) ?? 0) > r);
        const avgA =
          kidsA.length > 0
            ? kidsA.reduce((s, c) => s + (orderInLayer.get(c) ?? 0), 0) / kidsA.length
            : orderInLayer.get(a.id) ?? 0;
        const avgB =
          kidsB.length > 0
            ? kidsB.reduce((s, c) => s + (orderInLayer.get(c) ?? 0), 0) / kidsB.length
            : orderInLayer.get(b.id) ?? 0;
        return avgA - avgB;
      });
      layers[r].forEach((n, idx) => orderInLayer.set(n.id, idx));
    }
  }

  const measured = new Map(nodes.map((n) => [n.id, measureNodeBox(n)]));
  const padX = 48;
  const padY = 42;
  const itemGap = direction === "TD" ? 34 : 26;
  const layerGap = direction === "TD" ? 64 : 84;

  const positionedNodes: PositionedDiagramNode[] = [];
  const posById = new Map<string, PositionedDiagramNode>();

  if (direction === "TD") {
    const layerSizes = layers.map((layer) => {
      const totalW =
        layer.reduce((sum, n) => sum + (measured.get(n.id)?.width ?? 150), 0) +
        Math.max(0, layer.length - 1) * itemGap;
      const maxH = Math.max(46, ...layer.map((n) => measured.get(n.id)?.height ?? 52));
      return { totalW, maxH };
    });
    const maxSpanW = Math.max(280, ...layerSizes.map((s) => s.totalW));
    let curY = padY;

    layers.forEach((layer, rIdx) => {
      const { totalW, maxH } = layerSizes[rIdx];
      let curX = padX + (maxSpanW - totalW) / 2;
      const centerY = curY + maxH / 2;
      layer.forEach((node) => {
        const m = measured.get(node.id)!;
        const pNode: PositionedDiagramNode = {
          node,
          x: curX + m.width / 2,
          y: centerY,
          width: m.width,
          height: m.height,
          labelLines: m.labelLines,
          subtitleLine: m.subtitleLine,
          rank: rIdx,
        };
        positionedNodes.push(pNode);
        posById.set(node.id, pNode);
        curX += m.width + itemGap;
      });
      curY += maxH + layerGap;
    });
  } else {
    const layerSizes = layers.map((layer) => {
      const totalH =
        layer.reduce((sum, n) => sum + (measured.get(n.id)?.height ?? 52), 0) +
        Math.max(0, layer.length - 1) * itemGap;
      const maxW = Math.max(140, ...layer.map((n) => measured.get(n.id)?.width ?? 150));
      return { totalH, maxW };
    });
    const maxSpanH = Math.max(200, ...layerSizes.map((s) => s.totalH));
    let curX = padX;

    layers.forEach((layer, rIdx) => {
      const { totalH, maxW } = layerSizes[rIdx];
      let curY = padY + (maxSpanH - totalH) / 2;
      const centerX = curX + maxW / 2;
      layer.forEach((node) => {
        const m = measured.get(node.id)!;
        const pNode: PositionedDiagramNode = {
          node,
          x: centerX,
          y: curY + m.height / 2,
          width: m.width,
          height: m.height,
          labelLines: m.labelLines,
          subtitleLine: m.subtitleLine,
          rank: rIdx,
        };
        positionedNodes.push(pNode);
        posById.set(node.id, pNode);
        curY += m.height + itemGap;
      });
      curX += maxW + layerGap;
    });
  }

  // Contenedores visuales por grupo (`group`)
  const groupBoxes = new Map<string, PositionedDiagramNode[]>();
  positionedNodes.forEach((pn) => {
    const g = pn.node.group?.trim();
    if (!g) return;
    const arr = groupBoxes.get(g) ?? [];
    arr.push(pn);
    groupBoxes.set(g, arr);
  });

  const groups: PositionedDiagramGroup[] = [];
  groupBoxes.forEach((items, name) => {
    if (items.length < 1) return;
    const minX = Math.min(...items.map((i) => i.x - i.width / 2)) - 14;
    const maxX = Math.max(...items.map((i) => i.x + i.width / 2)) + 14;
    const minY = Math.min(...items.map((i) => i.y - i.height / 2)) - 26;
    const maxY = Math.max(...items.map((i) => i.y + i.height / 2)) + 14;
    groups.push({
      name,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  });

  // Posicionamiento de aristas (con curvas Bezier y desvío limpio en aristas de retorno)
  const positionedEdges: PositionedDiagramEdge[] = [];
  let maxExtraRight = 0;
  let maxExtraBottom = 0;

  validEdges.forEach((edge, idx) => {
    const src = posById.get(edge.from);
    const dst = posById.get(edge.to);
    if (!src || !dst) return;

    const isSelf = src.node.id === dst.node.id;
    const isBack = !isSelf && dst.rank <= src.rank;

    if (isSelf) {
      const rx = src.x + src.width / 2;
      const ry = src.y;
      const path = `M ${rx} ${ry - 10} C ${rx + 46} ${ry - 24}, ${rx + 46} ${ry + 24}, ${rx + 4} ${ry + 12}`;
      positionedEdges.push({
        edge,
        index: idx,
        path,
        labelX: rx + 36,
        labelY: ry,
        isBackEdge: true,
      });
      maxExtraRight = Math.max(maxExtraRight, rx + 62);
      return;
    }

    if (direction === "TD") {
      if (isBack) {
        const rightEdge = Math.max(src.x + src.width / 2, dst.x + dst.width / 2) + 48 + (idx % 3) * 18;
        const x1 = src.x + src.width / 2;
        const y1 = src.y;
        const x2 = dst.x + dst.width / 2 + 4;
        const y2 = dst.y;
        const path = `M ${x1} ${y1} C ${rightEdge} ${y1}, ${rightEdge} ${y2}, ${x2} ${y2}`;
        positionedEdges.push({
          edge,
          index: idx,
          path,
          labelX: (Math.max(x1, x2) + rightEdge) / 2,
          labelY: (y1 + y2) / 2,
          isBackEdge: true,
        });
        maxExtraRight = Math.max(maxExtraRight, rightEdge + 24);
      } else {
        const x1 = src.x;
        const y1 = src.y + src.height / 2;
        const x2 = dst.x;
        const y2 = dst.y - dst.height / 2 - 4;
        const midY = (y1 + y2) / 2;
        const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        positionedEdges.push({
          edge,
          index: idx,
          path,
          labelX: (x1 + x2) / 2,
          labelY: midY,
          isBackEdge: false,
        });
      }
    } else {
      if (isBack) {
        const bottomEdge = Math.max(src.y + src.height / 2, dst.y + dst.height / 2) + 46 + (idx % 3) * 16;
        const x1 = src.x;
        const y1 = src.y + src.height / 2;
        const x2 = dst.x;
        const y2 = dst.y + dst.height / 2 + 4;
        const path = `M ${x1} ${y1} C ${x1} ${bottomEdge}, ${x2} ${bottomEdge}, ${x2} ${y2}`;
        positionedEdges.push({
          edge,
          index: idx,
          path,
          labelX: (x1 + x2) / 2,
          labelY: (Math.max(y1, y2) + bottomEdge) / 2,
          isBackEdge: true,
        });
        maxExtraBottom = Math.max(maxExtraBottom, bottomEdge + 24);
      } else {
        const x1 = src.x + src.width / 2;
        const y1 = src.y;
        const x2 = dst.x - dst.width / 2 - 4;
        const y2 = dst.y;
        const midX = (x1 + x2) / 2;
        const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        positionedEdges.push({
          edge,
          index: idx,
          path,
          labelX: midX,
          labelY: (y1 + y2) / 2,
          isBackEdge: false,
        });
      }
    }
  });

  const maxNodeX = Math.max(
    360,
    ...positionedNodes.map((n) => n.x + n.width / 2 + padX),
    ...groups.map((g) => g.x + g.width + padX),
    maxExtraRight
  );
  const maxNodeY = Math.max(
    240,
    ...positionedNodes.map((n) => n.y + n.height / 2 + padY),
    ...groups.map((g) => g.y + g.height + padY),
    maxExtraBottom
  );

  return {
    mode: "graph",
    width: Math.round(maxNodeX),
    height: Math.round(maxNodeY),
    nodes: positionedNodes,
    edges: positionedEdges,
    groups,
    lifelines: [],
  };
}

export function layoutDiagramSpec(spec: CanvasDiagramSpec): DiagramLayoutResult {
  if (spec.diagramType === "sequence") {
    return layoutSequenceDiagram(spec);
  }
  return layoutGraphDiagram(spec);
}

export function getDiagramToneColors(tone?: CanvasDiagramNodeTone): {
  fill: string;
  stroke: string;
  text: string;
  subText: string;
} {
  switch (tone) {
    case "accent":
      return {
        fill: "rgba(255, 255, 255, 0.095)",
        stroke: "rgba(255, 255, 255, 0.34)",
        text: "#ffffff",
        subText: "#d4d4d8",
      };
    case "success":
      return {
        fill: "rgba(16, 185, 129, 0.11)",
        stroke: "rgba(52, 211, 153, 0.42)",
        text: "#ecfdf5",
        subText: "#a7f3d0",
      };
    case "warning":
      return {
        fill: "rgba(245, 158, 11, 0.11)",
        stroke: "rgba(251, 191, 36, 0.42)",
        text: "#fffbeb",
        subText: "#fde68a",
      };
    case "critical":
      return {
        fill: "rgba(244, 63, 94, 0.11)",
        stroke: "rgba(251, 113, 133, 0.42)",
        text: "#fff1f2",
        subText: "#fecdd3",
      };
    default:
      return {
        fill: "rgba(255, 255, 255, 0.04)",
        stroke: "rgba(255, 255, 255, 0.16)",
        text: "#f4f4f5",
        subText: "#a1a1aa",
      };
  }
}
