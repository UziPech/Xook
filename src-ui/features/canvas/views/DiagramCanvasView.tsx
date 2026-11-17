import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  Download,
  GitFork,
  List,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  CanvasDiagramDirection,
  CanvasDiagramNode,
  CanvasDiagramSpec,
} from "../canvasSchema";
import { diagramSpecToMermaid } from "../diagramMermaidParser";
import {
  getDiagramToneColors,
  layoutDiagramSpec,
  type PositionedDiagramNode,
} from "./diagramLayout";

interface DiagramCanvasViewProps {
  title: string;
  diagram: CanvasDiagramSpec;
  onChangeDirection?: (direction: CanvasDiagramDirection) => void;
  onAskNode?: (node: CanvasDiagramNode) => void;
  compactHeader?: boolean;
}

export const DiagramCanvasView: React.FC<DiagramCanvasViewProps> = ({
  title,
  diagram,
  onChangeDirection,
  onAskNode,
  compactHeader = false,
}) => {
  const uid = useId().replace(/:/g, "");
  const markerId = `xook_arrow_${uid}`;
  const markerAccentId = `xook_arrow_acc_${uid}`;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [subTab, setSubTab] = useState<"visual" | "steps" | "mermaid">("visual");
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const movedDuringDragRef = useRef(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [copiedMermaid, setCopiedMermaid] = useState(false);

  // Reiniciar selección y vista cuando cambia el diagrama
  useEffect(() => {
    setSelectedNodeId(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [title, diagram.nodes.length, diagram.edges.length]);

  const layout = useMemo(() => layoutDiagramSpec(diagram), [diagram]);
  const mermaidCode = useMemo(() => diagramSpecToMermaid(diagram), [diagram]);

  const nodeById = useMemo(
    () => new Map(diagram.nodes.map((n) => [n.id, n])),
    [diagram.nodes]
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;

  const connectedEdges = useMemo(() => {
    if (!selectedNodeId) return { incoming: [], outgoing: [] };
    return {
      incoming: diagram.edges.filter((e) => e.to === selectedNodeId),
      outgoing: diagram.edges.filter((e) => e.from === selectedNodeId),
    };
  }, [diagram.edges, selectedNodeId]);

  const handleCopyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(mermaidCode);
      setCopiedMermaid(true);
      window.setTimeout(() => setCopiedMermaid(false), 1800);
    } catch {
      // Ignorar si falla clipboard
    }
  };

  const handleDownloadSvg = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(layout.width));
    clone.setAttribute("height", String(layout.height));
    clone.style.background = "#090a0e";
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "diagrama-xook";
    a.href = url;
    a.download = `${safeName}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element)?.closest("[data-diagram-node='true']")) return;
    movedDuringDragRef.current = false;
    setIsPanning(true);
    panOriginRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !panOriginRef.current) return;
    const dx = e.clientX - panOriginRef.current.x;
    const dy = e.clientY - panOriginRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      movedDuringDragRef.current = true;
    }
    setPan({
      x: panOriginRef.current.panX + dx,
      y: panOriginRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    panOriginRef.current = null;
  };

  const renderNodeShape = (pNode: PositionedDiagramNode, isSelected: boolean, isDimmed: boolean) => {
    const { node, x, y, width, height, labelLines, subtitleLine } = pNode;
    const colors = getDiagramToneColors(node.tone);
    const left = x - width / 2;
    const top = y - height / 2;
    const shape = node.shape || "rounded";
    const strokeColor = isSelected ? "rgba(255,255,255,0.85)" : colors.stroke;
    const strokeWidth = isSelected ? 1.8 : 1.15;

    let shapeEl: React.ReactNode;
    if (shape === "diamond") {
      const pts = `${x},${top} ${left + width},${y} ${x},${top + height} ${left},${y}`;
      shapeEl = (
        <polygon
          points={pts}
          fill={colors.fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
    } else if (shape === "pill") {
      shapeEl = (
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          rx={height / 2}
          fill={colors.fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
      );
    } else if (shape === "cylinder") {
      const ry = 8;
      const bodyPath = [
        `M ${left} ${top + ry}`,
        `A ${width / 2} ${ry} 0 0 1 ${left + width} ${top + ry}`,
        `L ${left + width} ${top + height - ry}`,
        `A ${width / 2} ${ry} 0 0 1 ${left} ${top + height - ry}`,
        "Z",
      ].join(" ");
      shapeEl = (
        <>
          <path
            d={bodyPath}
            fill={colors.fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
          <ellipse
            cx={x}
            cy={top + ry}
            rx={width / 2}
            ry={ry}
            fill="rgba(255,255,255,0.03)"
            stroke={strokeColor}
            strokeWidth={0.95}
          />
        </>
      );
    } else if (shape === "note") {
      shapeEl = (
        <>
          <rect
            x={left}
            y={top}
            width={width}
            height={height}
            rx={10}
            fill={colors.fill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray="4 3"
          />
        </>
      );
    } else {
      shapeEl = (
        <rect
          x={left}
          y={top}
          width={width}
          height={height}
          rx={12}
          fill={colors.fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
        />
      );
    }

    const totalTextH = labelLines.length * 15 + (subtitleLine ? 14 : 0);
    const firstLineY = y - totalTextH / 2 + 11;

    return (
      <g
        key={node.id}
        data-diagram-node="true"
        role="button"
        tabIndex={0}
        aria-label={node.label}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedNodeId((curr) => (curr === node.id ? null : node.id));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelectedNodeId((curr) => (curr === node.id ? null : node.id));
          }
        }}
        style={{
          cursor: "pointer",
          opacity: isDimmed ? 0.35 : 1,
          transition: "opacity 160ms ease",
        }}
      >
        {isSelected && (
          <rect
            x={left - 4}
            y={top - 4}
            width={width + 8}
            height={height + 8}
            rx={shape === "pill" ? (height + 8) / 2 : 15}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.2}
          />
        )}
        {shapeEl}
        {labelLines.map((line, idx) => (
          <text
            key={`${node.id}-l-${idx}`}
            x={x}
            y={firstLineY + idx * 15}
            textAnchor="middle"
            fill={colors.text}
            fontSize="11.5"
            fontWeight="600"
            fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
          >
            {line}
          </text>
        ))}
        {subtitleLine && (
          <text
            x={x}
            y={firstLineY + labelLines.length * 15 + 2}
            textAnchor="middle"
            fill={colors.subText}
            fontSize="9.8"
            fontWeight="400"
            fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
          >
            {subtitleLine}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-[340px] gap-2.5">
      {/* Barra de sub-vistas y controles */}
      {!compactHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 shrink-0">
          <div className="inline-flex items-center gap-0.5 rounded-xl bg-white/[0.03] border border-white/[0.08] p-0.5">
            <button
              type="button"
              onClick={() => setSubTab("visual")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                subTab === "visual"
                  ? "bg-white/[0.11] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <GitFork className="w-3 h-3" />
              <span>Diagrama</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab("steps")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                subTab === "steps"
                  ? "bg-white/[0.11] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <List className="w-3 h-3" />
              <span>Elementos ({diagram.nodes.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab("mermaid")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-colors ${
                subTab === "mermaid"
                  ? "bg-white/[0.11] text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Code2 className="w-3 h-3" />
              <span>Mermaid</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {subTab === "visual" && onChangeDirection && diagram.diagramType !== "sequence" && (
              <button
                type="button"
                onClick={() =>
                  onChangeDirection(diagram.direction === "TD" ? "LR" : "TD")
                }
                title="Cambiar orientación Vertical / Horizontal"
                className="quick-liquid-btn h-7 px-2.5 rounded-lg text-[10.5px] font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                {diagram.direction === "TD" ? "Vertical" : "Horizontal"}
              </button>
            )}

            {subTab === "visual" && (
              <>
                <div className="inline-flex items-center rounded-lg bg-white/[0.03] border border-white/[0.08] p-0.5">
                  <button
                    type="button"
                    aria-label="Alejar diagrama"
                    onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.07] cursor-pointer"
                  >
                    <ZoomOut className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    title="Restablecer vista"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="px-1.5 h-6 text-[10.5px] font-mono tabular-nums text-zinc-300 hover:text-white cursor-pointer"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    aria-label="Acercar diagrama"
                    onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.07] cursor-pointer"
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                  {(pan.x !== 0 || pan.y !== 0 || zoom !== 1) && (
                    <button
                      type="button"
                      aria-label="Centrar diagrama"
                      onClick={() => {
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.07] cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  title="Descargar diagrama como SVG"
                  className="quick-liquid-btn h-7 px-2 rounded-lg inline-flex items-center gap-1 text-[10.5px] font-medium text-zinc-200 hover:text-white cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>SVG</span>
                </button>
              </>
            )}

            {subTab === "mermaid" && (
              <button
                type="button"
                onClick={handleCopyMermaid}
                className="quick-liquid-btn h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-200 hover:text-white cursor-pointer"
              >
                {copiedMermaid ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedMermaid ? "Copiado" : "Copiar código"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cuerpo principal */}
      {subTab === "visual" && (
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => {
            if (!movedDuringDragRef.current) setSelectedNodeId(null);
          }}
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.065) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
          className={`relative flex-1 min-h-[280px] rounded-xl border border-white/[0.08] bg-[#07080c] overflow-auto xook-scroll select-none ${
            isPanning ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
              width: layout.width,
              height: layout.height,
            }}
            className="min-w-full min-h-full flex items-start justify-center p-2 transition-transform duration-75"
          >
            <svg
              ref={svgRef}
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="overflow-visible"
              role="img"
              aria-label={`Diagrama: ${title}`}
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="6.5"
                  markerHeight="6.5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="rgba(212, 212, 216, 0.65)" />
                </marker>
                <marker
                  id={markerAccentId}
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#ffffff" />
                </marker>
              </defs>

              {/* Contenedores de grupos / subgraphs */}
              {layout.groups.map((grp) => (
                <g key={`grp-${grp.name}`}>
                  <rect
                    x={grp.x}
                    y={grp.y}
                    width={grp.width}
                    height={grp.height}
                    rx={14}
                    fill="rgba(255,255,255,0.018)"
                    stroke="rgba(255,255,255,0.10)"
                    strokeWidth={1}
                    strokeDasharray="5 4"
                  />
                  <text
                    x={grp.x + 12}
                    y={grp.y + 16}
                    fill="#a1a1aa"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
                  >
                    {grp.name}
                  </text>
                </g>
              ))}

              {/* Líneas de vida en diagramas de secuencia */}
              {layout.mode === "sequence" &&
                layout.lifelines.map((ll) => (
                  <line
                    key={`ll-${ll.node.id}`}
                    x1={ll.x}
                    y1={ll.topY + ll.height}
                    x2={ll.x}
                    y2={ll.bottomY}
                    stroke="rgba(255,255,255,0.16)"
                    strokeWidth={1.2}
                    strokeDasharray="5 5"
                  />
                ))}

              {/* Conexiones / Flechas */}
              {layout.edges.map((pe) => {
                const isEdgeActive =
                  selectedNodeId !== null &&
                  (pe.edge.from === selectedNodeId || pe.edge.to === selectedNodeId);
                const isEdgeDimmed = selectedNodeId !== null && !isEdgeActive;
                const edgeLabel = pe.edge.label?.trim();
                const pillW = edgeLabel ? Math.min(180, Math.max(44, edgeLabel.length * 6.4 + 18)) : 0;

                return (
                  <g
                    key={pe.edge.id || `edge-${pe.index}`}
                    style={{
                      opacity: isEdgeDimmed ? 0.2 : 1,
                      transition: "opacity 160ms ease",
                    }}
                  >
                    <path
                      d={pe.path}
                      fill="none"
                      stroke={
                        isEdgeActive
                          ? "rgba(255,255,255,0.9)"
                          : "rgba(212,212,216,0.45)"
                      }
                      strokeWidth={isEdgeActive ? 1.75 : 1.25}
                      strokeDasharray={pe.edge.style === "dashed" ? "5 4" : undefined}
                      markerEnd={`url(#${isEdgeActive ? markerAccentId : markerId})`}
                    />
                    {edgeLabel && (
                      <g>
                        <rect
                          x={pe.labelX - pillW / 2}
                          y={pe.labelY - 10}
                          width={pillW}
                          height={20}
                          rx={10}
                          fill="#0b0c11"
                          stroke={
                            isEdgeActive
                              ? "rgba(255,255,255,0.35)"
                              : "rgba(255,255,255,0.14)"
                          }
                          strokeWidth={1}
                        />
                        <text
                          x={pe.labelX}
                          y={pe.labelY + 3.5}
                          textAnchor="middle"
                          fill={isEdgeActive ? "#ffffff" : "#d4d4d8"}
                          fontSize="10"
                          fontWeight="500"
                          fontFamily="Inter, -apple-system, BlinkMacSystemFont, sans-serif"
                        >
                          {edgeLabel.length > 26 ? `${edgeLabel.slice(0, 25)}…` : edgeLabel}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Nodos */}
              {layout.nodes.map((pn) => {
                const isSelected = selectedNodeId === pn.node.id;
                const isNeighbor =
                  selectedNodeId !== null &&
                  diagram.edges.some(
                    (e) =>
                      (e.from === selectedNodeId && e.to === pn.node.id) ||
                      (e.to === selectedNodeId && e.from === pn.node.id)
                  );
                const isDimmed = selectedNodeId !== null && !isSelected && !isNeighbor;
                return renderNodeShape(pn, isSelected, isDimmed);
              })}
            </svg>
          </div>
        </div>
      )}

      {subTab === "steps" && (
        <div className="flex-1 overflow-auto xook-scroll space-y-2 pt-1">
          {diagram.nodes.map((n, idx) => {
            const outs = diagram.edges.filter((e) => e.from === n.id);
            return (
              <div
                key={n.id}
                className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 flex items-start justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-white/[0.05]">
                      {idx + 1}
                    </span>
                    <h4 className="text-[12.5px] font-semibold text-white">{n.label}</h4>
                    {n.group && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-zinc-300">
                        {n.group}
                      </span>
                    )}
                  </div>
                  {(n.subtitle || n.detail) && (
                    <p className="text-[11.5px] text-zinc-300 leading-relaxed">
                      {n.detail || n.subtitle}
                    </p>
                  )}
                  {outs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {outs.map((e, eIdx) => (
                        <span
                          key={e.id || eIdx}
                          className="inline-flex items-center gap-1 text-[10.5px] text-zinc-400 px-2 py-0.5 rounded-lg bg-white/[0.03] border border-white/[0.07]"
                        >
                          <ArrowRight className="w-2.5 h-2.5 text-zinc-400" />
                          {e.label ? <span className="text-zinc-300">{e.label}:</span> : null}
                          <span className="text-zinc-200">
                            {nodeById.get(e.to)?.label ?? e.to}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {onAskNode && (
                  <button
                    type="button"
                    onClick={() => onAskNode(n)}
                    className="quick-liquid-btn px-2.5 py-1 rounded-lg text-[10.5px] font-medium text-zinc-200 hover:text-white shrink-0 cursor-pointer"
                  >
                    Explicar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {subTab === "mermaid" && (
        <div className="flex-1 overflow-auto xook-scroll rounded-xl border border-white/[0.08] bg-[#07080c] p-3.5">
          <pre className="text-[12px] font-mono text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
            {mermaidCode}
          </pre>
        </div>
      )}

      {/* Inspector interactivo del nodo seleccionado */}
      {selectedNode && subTab === "visual" && (
        <div className="rounded-xl border border-white/[0.12] bg-[#0e1016] p-3 space-y-2 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Elemento seleccionado
                </span>
                {selectedNode.group && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-zinc-300">
                    {selectedNode.group}
                  </span>
                )}
              </div>
              <h4 className="text-[13px] font-semibold text-white mt-0.5">
                {selectedNode.label}
              </h4>
              {selectedNode.subtitle && (
                <p className="text-[11px] text-zinc-400">{selectedNode.subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              aria-label="Cerrar inspector de nodo"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {selectedNode.detail && (
            <p className="text-[12px] text-zinc-200 leading-relaxed bg-white/[0.03] border border-white/[0.07] rounded-lg px-2.5 py-2">
              {selectedNode.detail}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-zinc-400">
              <span>Entradas: {connectedEdges.incoming.length}</span>
              <span>·</span>
              <span>Salidas: {connectedEdges.outgoing.length}</span>
            </div>
            {onAskNode && (
              <button
                type="button"
                onClick={() => onAskNode(selectedNode)}
                className="quick-liquid-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>Preguntar a Xox sobre este paso</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
