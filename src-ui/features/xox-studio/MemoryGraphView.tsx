import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildMemoryGraphSnapshot,
  selectStartupMemoryPayload,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryGraphSnapshot,
  type MemoryTier,
  type UserMemoryCategory,
  type UserMemoryFact,
} from "@xook/contracts";
import {
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
  Zap,
} from "lucide-react";
import {
  XOX_ACCENT_PRESETS,
  XoxSilhouetteIcon,
  resolveXoxAccentPreset,
  type XoxAccentPreset,
} from "../../components/XoxStar";
import type { GlobalXoxProfile } from "./xoxStudioApi";
import type { LocalUserProfile } from "../workspace-store/localStore";
import { MemoryWordEditor, type PreferenceBucket } from "./MemoryWordEditor";

export interface MemoryLivePulse {
  seq: number;
  action: "added" | "updated" | "removed" | "synced";
  label?: string;
  source: "xox" | "user";
}

export interface MemoryGraphViewProps {
  agentName: string;
  accentPreset: XoxAccentPreset;
  profile: GlobalXoxProfile;
  localUser: LocalUserProfile | null;
  userMemoryFacts: UserMemoryFact[];
  workspaceFacts: string[];
  patterns: Array<{ id?: string; description: string; confidence?: number }>;
  activeWorkspaceName?: string | null;
  hasActiveWorkspace?: boolean;
  livePulse?: MemoryLivePulse | null;
  isWideMode?: boolean;
  onToggleWideMode?: () => void;
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

type ScopeFilter = "all" | "global" | "workspace";

interface GhostNode {
  key: string;
  id: string;
  x: number;
  y: number;
  radius: number;
}

interface RippleEntry {
  burstKey: number;
  kind: "added" | "updated";
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  isHub: boolean;
  isCategory: boolean;
  mass: number;
  phaseX: number;
  phaseY: number;
  freqX: number;
  freqY: number;
}

interface SimEdge {
  id: string;
  edgeIndex: number;
  seed: number;
  restLen: number;
  stiffness: number;
  source: SimNode;
  target: SimNode;
  slosh: number;
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

const TIER_SHORT_LABELS: Record<MemoryTier, string> = {
  L0_core: "L0 Fijo",
  L1_contextual: "L1 Contextual",
  L2_ondemand: "L2 Bajo demanda",
};

const WORLD_CENTER_X = 400;
const WORLD_CENTER_Y = 260;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.0;
const FIT_MIN_ZOOM = 0.75;
const FIT_MAX_ZOOM = 1.45;
const VELOCITY_DAMPING = 0.84;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

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

function truncateNodeLabel(text: string, maxLen = 20): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

function stableHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function getEdgeCurveSeed(
  edge: MemoryGraphEdge & { curveSeed?: number },
  idx: number
): number {
  if (
    typeof edge.curveSeed === "number" &&
    Number.isFinite(edge.curveSeed) &&
    edge.curveSeed !== 0
  ) {
    return edge.curveSeed;
  }
  const h = stableHash(edge.id || `edge-${idx}`);
  const mag = 0.28 + ((h % 1000) / 1000) * 0.62;
  const sign = (h & 1) === 0 ? 1 : -1;
  return sign * mag;
}

/**
 * Trazo Bézier cúbico con ondulación acuática suave (S-wave / C-wave)
 * e impulso perpendicular amortiguado (`slosh`) cuando los nodos se mueven o arrastran.
 */
function buildWaterBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  idx: number,
  t: number,
  slosh: number,
  animateWaves: boolean
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) {
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  const nx = -dy / dist;
  const ny = dx / dist;

  const bow = dist * 0.13 * seed;
  const w1 = animateWaves
    ? Math.sin(t * 1.25 + idx * 0.85) * Math.min(12, dist * 0.05)
    : 0;
  const w2 = animateWaves
    ? Math.cos(t * 0.9 - idx * 1.2) * Math.min(9, dist * 0.036)
    : 0;

  const offset1 = bow + w1 + slosh;
  const offset2 = bow * 0.65 - w2 - slosh * 0.55;

  const cx1 = x1 + dx * 0.33 + nx * offset1;
  const cy1 = y1 + dy * 0.33 + ny * offset1;
  const cx2 = x1 + dx * 0.66 + nx * offset2;
  const cy2 = y1 + dy * 0.66 + ny * offset2;

  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function createSimNode(
  node: MemoryGraphNode,
  spawnX: number,
  spawnY: number,
  initVx = 0,
  initVy = 0
): SimNode {
  const h = stableHash(node.id);
  const isHub = node.kind === "hub";
  const isCategory = node.kind === "category";
  return {
    id: node.id,
    x: spawnX,
    y: spawnY,
    vx: initVx,
    vy: initVy,
    baseX: node.x,
    baseY: node.y,
    isHub,
    isCategory,
    mass: isHub ? 1.85 : isCategory ? 1.2 : 1.0,
    phaseX: ((h % 6283) / 1000),
    phaseY: (((h >> 7) % 6283) / 1000),
    freqX: 0.68 + ((h % 45) / 100),
    freqY: 0.62 + (((h >> 5) % 45) / 100),
  };
}

let lastHandledLivePulseSeq = 0;

export const MemoryGraphView: React.FC<MemoryGraphViewProps> = ({
  agentName,
  accentPreset,
  profile,
  localUser,
  userMemoryFacts,
  workspaceFacts,
  patterns,
  activeWorkspaceName,
  hasActiveWorkspace = false,
  livePulse = null,
  isWideMode,
  onToggleWideMode,
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraGroupRef = useRef<SVGGElement>(null);
  const tokenPopoverRef = useRef<HTMLDivElement>(null);

  // Paleta dinámica 100% armonizada con el avatar actual de Xox
  const resolvedPreset = resolveXoxAccentPreset(accentPreset);
  const accent = XOX_ACCENT_PRESETS[resolvedPreset];
  const l2Color = accent.bodyLower ?? accent.deep;

  // Modo amplio estilo Obsidian (controlado desde XoxStudioPanel o con estado interno)
  const [localWideMode, setLocalWideMode] = useState(false);
  const effectiveWideMode = isWideMode ?? localWideMode;
  const handleToggleWideMode = () => {
    if (onToggleWideMode) {
      onToggleWideMode();
    } else {
      setLocalWideMode((v) => !v);
    }
  };

  const [queryText, setQueryText] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [tierFilter, setTierFilter] = useState<"all" | MemoryTier>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Modo de creación en el Word/Obsidian Editor
  const [createMode, setCreateMode] = useState(false);
  const [createPresetScope, setCreatePresetScope] = useState<
    "global" | "workspace"
  >("global");
  const [createPresetCategory, setCreatePresetCategory] =
    useState<UserMemoryCategory>("preference");

  // Popover flotante de desglose L0/L1/L2
  const [tokenPopoverOpen, setTokenPopoverOpen] = useState(false);
  const [tokenPopoverPinned, setTokenPopoverPinned] = useState(false);

  // Preferencia de movimiento reducido
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Cierra el popover de tokens al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!tokenPopoverOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        tokenPopoverRef.current &&
        !tokenPopoverRef.current.contains(e.target as Node)
      ) {
        setTokenPopoverOpen(false);
        setTokenPopoverPinned(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTokenPopoverOpen(false);
        setTokenPopoverPinned(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tokenPopoverOpen]);

  const snapshot: MemoryGraphSnapshot = useMemo(
    () =>
      buildMemoryGraphSnapshot({
        agentName,
        userProfile: localUser,
        userFacts: userMemoryFacts,
        workspaceFacts,
        patterns,
        preferences: {
          likes: profile.likes,
          workflows: profile.workflows,
          donts: profile.donts,
        },
        activeWorkspaceName,
        activeQuery: queryText,
      }),
    [
      agentName,
      localUser,
      userMemoryFacts,
      workspaceFacts,
      patterns,
      profile.likes,
      profile.workflows,
      profile.donts,
      activeWorkspaceName,
      queryText,
    ]
  );

  const startupPayload = useMemo(
    () => selectStartupMemoryPayload(userMemoryFacts, { query: queryText }),
    [userMemoryFacts, queryText]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, MemoryGraphNode>();
    for (const n of snapshot.nodes) {
      map.set(n.id, n);
    }
    return map;
  }, [snapshot.nodes]);

  // --- Filtros de alcance y nivel ---
  const matchingNodeIds = useMemo(() => {
    const allowed = new Set<string>();
    const activeCategories = new Set<string>();

    for (const node of snapshot.nodes) {
      if (node.kind === "hub") {
        allowed.add(node.id);
        continue;
      }
      if (node.kind === "category") continue;

      const scopeOk = scopeFilter === "all" || node.scope === scopeFilter;
      const tierOk = tierFilter === "all" || node.tier === tierFilter;
      if (scopeOk && tierOk) {
        allowed.add(node.id);
        activeCategories.add(`cat_${node.category}`);
      }
    }

    for (const node of snapshot.nodes) {
      if (node.kind === "category") {
        if (
          (scopeFilter === "all" && tierFilter === "all") ||
          activeCategories.has(node.id)
        ) {
          allowed.add(node.id);
        }
      }
    }
    return allowed;
  }, [snapshot.nodes, scopeFilter, tierFilter]);

  // --- Tamaño exacto en píxeles nativos del lienzo (ResizeObserver) ---
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;
  const hasMeasuredCanvasRef = useRef(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = (rawW: number, rawH: number) => {
      const w = Math.max(1, Math.round(rawW));
      const h = Math.max(1, Math.round(rawH));
      if (w <= 1 || h <= 1) return;
      hasMeasuredCanvasRef.current = true;
      setCanvasSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
    };

    const rect = el.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Motor de física 2D con resortes elásticos + flotación en agua (0 re-renders por frame) ---
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const simNodeListRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const hasSimInitializedRef = useRef(false);
  const lastKnownPosRef = useRef<Map<string, { x: number; y: number }>>(
    new Map()
  );

  const nodeGroupRefs = useRef<Map<string, SVGGElement>>(new Map());
  const edgePathRefs = useRef<Map<string, SVGPathElement>>(new Map());

  const draggingSimRef = useRef<{
    id: string;
    targetX: number;
    targetY: number;
  } | null>(null);
  const recenterBoostUntilRef = useRef<number>(0);

  // Impulsos de agua ("slosh") por nodo al arrastrar, hacer clic o recibir eventos en vivo
  const nodeSloshRef = useRef<
    Map<string, { amp: number; updatedAt: number }>
  >(new Map());

  const triggerNodeSlosh = useCallback((nodeId: string, impulse: number) => {
    nodeSloshRef.current.set(nodeId, {
      amp: clamp(impulse, -24, 24),
      updatedAt: performance.now(),
    });
  }, []);

  // Sincroniza `simNodesRef` y `simEdgesRef` cuando cambia el snapshot (preservando posiciones vivas)
  useLayoutEffect(() => {
    const simMap = simNodesRef.current;
    const currentIds = new Set<string>();
    const isInitial = !hasSimInitializedRef.current;

    for (const node of snapshot.nodes) {
      currentIds.add(node.id);
      const existing = simMap.get(node.id);
      if (existing) {
        existing.baseX = node.x;
        existing.baseY = node.y;
        existing.isHub = node.kind === "hub";
        existing.isCategory = node.kind === "category";
        existing.mass = existing.isHub ? 1.85 : existing.isCategory ? 1.2 : 1.0;
      } else if (isInitial) {
        simMap.set(node.id, createSimNode(node, node.x, node.y));
      } else {
        // Nodo nuevo en vivo: nace cerca de su categoría padre o del hub Xox y se desliza hacia su lugar
        const parentSim =
          node.kind !== "hub" && node.kind !== "category"
            ? simMap.get(`cat_${node.category}`) ?? simMap.get("hub_core")
            : simMap.get("hub_core");
        const originX = parentSim ? parentSim.x : WORLD_CENTER_X;
        const originY = parentSim ? parentSim.y : WORLD_CENTER_Y;
        const dx = node.x - originX;
        const dy = node.y - originY;
        const dist = Math.hypot(dx, dy) || 1;
        const spawnX = originX + (dx / dist) * Math.min(26, dist * 0.32);
        const spawnY = originY + (dy / dist) * Math.min(26, dist * 0.32);
        const simNode = createSimNode(
          node,
          spawnX,
          spawnY,
          (dx / dist) * 2.4,
          (dy / dist) * 2.4
        );
        simMap.set(node.id, simNode);
      }
    }

    for (const [id, sim] of simMap.entries()) {
      lastKnownPosRef.current.set(id, { x: sim.x, y: sim.y });
      if (!currentIds.has(id)) {
        simMap.delete(id);
      }
    }

    hasSimInitializedRef.current = true;

    const list: SimNode[] = [];
    for (const node of snapshot.nodes) {
      const sim = simMap.get(node.id);
      if (sim) {
        list.push(sim);
        const gEl = nodeGroupRefs.current.get(node.id);
        if (gEl) {
          gEl.setAttribute(
            "transform",
            `translate(${sim.x.toFixed(2)}, ${sim.y.toFixed(2)})`
          );
        }
      }
    }
    simNodeListRef.current = list;

    const prevEdgeSlosh = new Map<string, number>();
    for (const prevEdge of simEdgesRef.current) {
      prevEdgeSlosh.set(prevEdge.id, prevEdge.slosh);
    }

    const edges: SimEdge[] = [];
    for (let i = 0; i < snapshot.edges.length; i++) {
      const edge = snapshot.edges[i];
      const source = simMap.get(edge.source);
      const target = simMap.get(edge.target);
      if (!source || !target) continue;

      const baseDist = Math.hypot(
        target.baseX - source.baseX,
        target.baseY - source.baseY
      );
      const isHubLink = edge.source === "hub_core" || edge.target === "hub_core";
      const restLen =
        edge.kind === "semantic"
          ? clamp(baseDist || 145, 108, 195)
          : isHubLink
            ? clamp(baseDist || 126, 94, 162)
            : clamp(baseDist || 86, 68, 122);
      const stiffness =
        edge.kind === "semantic" ? 0.018 : isHubLink ? 0.04 : 0.046;

      edges.push({
        id: edge.id,
        edgeIndex: i,
        seed: getEdgeCurveSeed(edge, i),
        restLen,
        stiffness,
        source,
        target,
        slosh: prevEdgeSlosh.get(edge.id) ?? 0,
      });
    }
    simEdgesRef.current = edges;
  }, [snapshot.nodes, snapshot.edges]);

  // Helper síncrono para pintar nodos + aristas (usado en modo reduced-motion o tras reset)
  const syncDomFromSimulation = useCallback((animateWaves: boolean) => {
    const nodes = simNodeListRef.current;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const gEl = nodeGroupRefs.current.get(n.id);
      if (gEl) {
        gEl.setAttribute(
          "transform",
          `translate(${n.x.toFixed(2)}, ${n.y.toFixed(2)})`
        );
      }
    }
    const edges = simEdgesRef.current;
    const t = performance.now() / 1000;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const pathEl = edgePathRefs.current.get(e.id);
      if (!pathEl) continue;
      const d = buildWaterBezierPath(
        e.source.x,
        e.source.y,
        e.target.x,
        e.target.y,
        e.seed,
        e.edgeIndex,
        t,
        e.slosh,
        animateWaves
      );
      pathEl.setAttribute("d", d);
    }
  }, []);

  // --- Cámara 2D en píxeles nativos de pantalla (Pan 1:1 + Zoom hacia cursor + Auto-fit) ---
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const cameraRef = useRef<{ panX: number; panY: number; zoom: number }>({
    panX: 0,
    panY: 0,
    zoom: 1,
  });

  const applyCamera = useCallback((nextPanX: number, nextPanY: number, nextZoom: number) => {
    const rx = Math.round(nextPanX * 100) / 100;
    const ry = Math.round(nextPanY * 100) / 100;
    const rz = Math.round(nextZoom * 1000) / 1000;
    cameraRef.current = { panX: rx, panY: ry, zoom: rz };
    if (cameraGroupRef.current) {
      cameraGroupRef.current.setAttribute(
        "transform",
        `translate(${rx}, ${ry}) scale(${rz})`
      );
    }
    setPan({ x: rx, y: ry });
    setZoom(rz);
  }, []);

  const hasFittedInitialRef = useRef(false);
  const autoFitUntilRef = useRef<number>(0);

  const fitGraphToViewport = useCallback(
    (options?: { useBasePositions?: boolean; resetNodes?: boolean }) => {
      const { width: vw, height: vh } = canvasSizeRef.current;
      if (vw <= 10 || vh <= 10) return;

      const visibleNodes = snapshot.nodes.filter((n) =>
        matchingNodeIds.has(n.id)
      );
      const targetNodes =
        visibleNodes.length > 0 ? visibleNodes : snapshot.nodes;

      if (options?.resetNodes) {
        if (prefersReducedMotion) {
          for (const sim of simNodeListRef.current) {
            sim.x = sim.baseX;
            sim.y = sim.baseY;
            sim.vx = 0;
            sim.vy = 0;
          }
          syncDomFromSimulation(false);
        } else {
          // Pulso suave para que todos los nodos regresen elásticamente a su formación
          recenterBoostUntilRef.current = performance.now() + 850;
          triggerNodeSlosh("hub_core", 10);
        }
      }

      if (targetNodes.length === 0) {
        const nextPanX = vw / 2 - WORLD_CENTER_X;
        const nextPanY = vh / 2 - WORLD_CENTER_Y;
        applyCamera(nextPanX, nextPanY, 1);
        return;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const node of targetNodes) {
        const sim = simNodesRef.current.get(node.id);
        const x =
          options?.useBasePositions || !sim ? node.x : sim.x;
        const y =
          options?.useBasePositions || !sim ? node.y : sim.y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      // Margen extra para radios de nodos y etiquetas debajo de cada punto
      const padX = 58;
      const padY = 48;
      const spanX = Math.max(150, maxX - minX + padX * 2);
      const spanY = Math.max(120, maxY - minY + padY * 2);

      const rawZoom = Math.min((vw * 0.82) / spanX, (vh * 0.82) / spanY);
      const nextZoom = clamp(rawZoom, FIT_MIN_ZOOM, FIT_MAX_ZOOM);

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const nextPanX = vw / 2 - cx * nextZoom;
      const nextPanY = vh / 2 - cy * nextZoom;

      applyCamera(nextPanX, nextPanY, nextZoom);
    },
    [
      snapshot.nodes,
      matchingNodeIds,
      prefersReducedMotion,
      syncDomFromSimulation,
      triggerNodeSlosh,
      applyCamera,
    ]
  );

  // Auto-centrado en la primera medición y durante la transición de cambio de Modo Amplio
  useEffect(() => {
    if (!hasMeasuredCanvasRef.current) return;
    if (!hasFittedInitialRef.current) {
      hasFittedInitialRef.current = true;
      autoFitUntilRef.current = performance.now() + 520;
      fitGraphToViewport({ useBasePositions: true });
      return;
    }
    if (performance.now() < autoFitUntilRef.current) {
      fitGraphToViewport({ useBasePositions: false });
    }
  }, [canvasSize.width, canvasSize.height, fitGraphToViewport]);

  const prevWideModeRef = useRef(effectiveWideMode);
  useEffect(() => {
    if (prevWideModeRef.current === effectiveWideMode) return;
    prevWideModeRef.current = effectiveWideMode;
    autoFitUntilRef.current = performance.now() + 520;
    const rafId = window.requestAnimationFrame(() => {
      fitGraphToViewport({ useBasePositions: false });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [effectiveWideMode, fitGraphToViewport]);

  // Zoom nativo no-pasivo con rueda o pellizco hacia el cursor (bloquea scroll externo)
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      autoFitUntilRef.current = 0;

      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const { panX, panY, zoom: curZoom } = cameraRef.current;
      const sensitivity = e.ctrlKey ? 0.0085 : 0.0022;
      const clampedDelta = clamp(e.deltaY, -120, 120);
      const factor = Math.exp(-clampedDelta * sensitivity);
      const nextZoom = clamp(
        Math.round(curZoom * factor * 1000) / 1000,
        MIN_ZOOM,
        MAX_ZOOM
      );
      if (nextZoom === curZoom) return;

      const worldX = (cursorX - panX) / curZoom;
      const worldY = (cursorY - panY) / curZoom;
      const nextPanX = cursorX - worldX * nextZoom;
      const nextPanY = cursorY - worldY * nextZoom;

      applyCamera(nextPanX, nextPanY, nextZoom);
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [applyCamera]);

  const zoomAroundCenter = (multiplier: number) => {
    autoFitUntilRef.current = 0;
    const { panX, panY, zoom: curZoom } = cameraRef.current;
    const nextZoom = clamp(
      Math.round(curZoom * multiplier * 100) / 100,
      MIN_ZOOM,
      MAX_ZOOM
    );
    const cx = canvasSizeRef.current.width / 2;
    const cy = canvasSizeRef.current.height / 2;
    const worldX = (cx - panX) / curZoom;
    const worldY = (cy - panY) / curZoom;
    applyCamera(cx - worldX * nextZoom, cy - worldY * nextZoom, nextZoom);
  };

  const handleResetView = () => {
    autoFitUntilRef.current = 0;
    fitGraphToViewport({ useBasePositions: true, resetNodes: true });
  };

  // --- Arrastre de fondo (Pan 2D 1:1 en píxeles de pantalla) ---
  const panDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    autoFitUntilRef.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    panDragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: cameraRef.current.panX,
      startPanY: cameraRef.current.panY,
      moved: false,
    };
    setIsPanning(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = panDragRef.current;
    if (!st) return;
    const rawDx = e.clientX - st.startClientX;
    const rawDy = e.clientY - st.startClientY;
    if (!st.moved && Math.hypot(rawDx, rawDy) > 3) {
      st.moved = true;
    }
    if (!st.moved) return;

    applyCamera(
      st.startPanX + rawDx,
      st.startPanY + rawDy,
      cameraRef.current.zoom
    );
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = panDragRef.current;
    panDragRef.current = null;
    setIsPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (st && !st.moved) {
      setHoveredNodeId(null);
    }
  };

  const handleCanvasDoubleClick = () => {
    autoFitUntilRef.current = 0;
    fitGraphToViewport({ useBasePositions: false, resetNodes: false });
  };

  // --- Arrastre elástico de cualquier nodo en 2D (tira de sus vecinos conectados) ---
  const dragStateRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    lastClientX: number;
    lastClientY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    moved: boolean;
  } | null>(null);

  const handleNodePointerDown = (
    e: React.PointerEvent<SVGGElement>,
    node: MemoryGraphNode
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const { panX, panY, zoom: curZoom } = cameraRef.current;
    const worldX = (e.clientX - rect.left - panX) / curZoom;
    const worldY = (e.clientY - rect.top - panY) / curZoom;

    const sim = simNodesRef.current.get(node.id);
    const curX = sim ? sim.x : node.x;
    const curY = sim ? sim.y : node.y;

    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      id: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      grabOffsetX: curX - worldX,
      grabOffsetY: curY - worldY,
      moved: false,
    };
  };

  const handleNodePointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const st = dragStateRef.current;
    if (!st) return;
    e.stopPropagation();

    const rawDx = e.clientX - st.startClientX;
    const rawDy = e.clientY - st.startClientY;
    if (!st.moved && Math.hypot(rawDx, rawDy) > 4) {
      st.moved = true;
      recenterBoostUntilRef.current = 0;
      setDraggingNodeId(st.id);
    }
    if (!st.moved) return;

    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { panX, panY, zoom: curZoom } = cameraRef.current;
    const targetX =
      (e.clientX - rect.left - panX) / curZoom + st.grabOffsetX;
    const targetY =
      (e.clientY - rect.top - panY) / curZoom + st.grabOffsetY;

    const stepVx = e.clientX - st.lastClientX;
    const stepVy = e.clientY - st.lastClientY;
    st.lastClientX = e.clientX;
    st.lastClientY = e.clientY;

    draggingSimRef.current = {
      id: st.id,
      targetX,
      targetY,
    };

    const signedSpeed =
      Math.hypot(stepVx, stepVy) * (stepVx + stepVy >= 0 ? 1 : -1) * 1.1;
    triggerNodeSlosh(st.id, signedSpeed);

    // En modo de movimiento reducido, actualiza inmediatamente nodo y aristas sin loop continuo
    if (prefersReducedMotion) {
      const sim = simNodesRef.current.get(st.id);
      if (sim) {
        sim.x = targetX;
        sim.y = targetY;
        sim.vx = 0;
        sim.vy = 0;
        syncDomFromSimulation(false);
      }
    }
  };

  const handleNodePointerUp = (
    e: React.PointerEvent<SVGGElement>,
    node: MemoryGraphNode
  ) => {
    e.stopPropagation();
    const st = dragStateRef.current;
    dragStateRef.current = null;

    if (draggingSimRef.current?.id === node.id) {
      const sim = simNodesRef.current.get(node.id);
      if (sim) {
        sim.vx = clamp(sim.vx * 0.45, -14, 14);
        sim.vy = clamp(sim.vy * 0.45, -14, 14);
      }
      draggingSimRef.current = null;
    }
    setDraggingNodeId(null);

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (!st || !st.moved) {
      setSelectedNodeId(node.id);
      setCreateMode(false);
      triggerNodeSlosh(node.id, 7);
      const sim = simNodesRef.current.get(node.id);
      if (sim && !prefersReducedMotion) {
        sim.vy -= 1.1;
      }
    }
  };

  const handleNodePointerCancel = (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    dragStateRef.current = null;
    draggingSimRef.current = null;
    setDraggingNodeId(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // --- Loop 60fps de física elástica entre grafos + ondas de agua en aristas ---
  useEffect(() => {
    if (prefersReducedMotion) {
      syncDomFromSimulation(false);
      return;
    }

    let rafId = 0;
    let running = true;
    let lastTime = performance.now();

    const getSloshAt = (nodeId: string, now: number): number => {
      const entry = nodeSloshRef.current.get(nodeId);
      if (!entry) return 0;
      const age = (now - entry.updatedAt) / 1000;
      if (age > 1.1) {
        nodeSloshRef.current.delete(nodeId);
        return 0;
      }
      return entry.amp * Math.exp(-age * 3.2) * Math.cos(age * 11.2);
    };

    const tick = (now: number) => {
      if (!running) return;
      if (typeof document !== "undefined" && document.hidden) {
        lastTime = now;
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const rawDt = now - lastTime;
      lastTime = now;
      // Normalizado a 60fps con límite seguro contra saltos de pestaña
      const step = clamp(rawDt / 16.667, 0.25, 1.85);
      const t = now / 1000;

      const nodes = simNodeListRef.current;
      const edges = simEdgesRef.current;
      const nodeCount = nodes.length;
      const drag = draggingSimRef.current;
      const isRecentering = now < recenterBoostUntilRef.current;

      // 1. Si hay un nodo arrastrado, fijar posición al puntero y registrar velocidad real
      if (drag) {
        const dragged = simNodesRef.current.get(drag.id);
        if (dragged) {
          const dx = drag.targetX - dragged.x;
          const dy = drag.targetY - dragged.y;
          dragged.vx = clamp(dx / step, -32, 32);
          dragged.vy = clamp(dy / step, -32, 32);
          dragged.x = drag.targetX;
          dragged.y = drag.targetY;
        }
      }

      // Acumuladores de fuerza por nodo (sin allocs extra usando arrays locales reusables en closure? N <= ~80 es diminuto)
      const fx = new Float64Array(nodeCount);
      const fy = new Float64Array(nodeCount);

      // 2. Repulsión de Coulomb + separación mínima (~60px) para que nunca se encimen las etiquetas
      for (let i = 0; i < nodeCount; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodeCount; j++) {
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > 62500) continue; // > 250px: despreciable

          const dist = Math.sqrt(distSq) || 0.01;
          const minDist =
            a.isHub || b.isHub
              ? 80
              : a.isCategory && b.isCategory
                ? 74
                : 60;

          let rep = 140 / Math.max(distSq, 160);
          if (dist < minDist) {
            rep += (minDist - dist) * 0.088;
          }
          rep = Math.min(rep, 4.6);

          const rx = (dx / dist) * rep;
          const ry = (dy / dist) * rep;
          fx[i] -= rx;
          fy[i] -= ry;
          fx[j] += rx;
          fy[j] += ry;
        }
      }

      // Índice rápido id -> idx en el array actual
      const indexByNode = new Map<SimNode, number>();
      for (let i = 0; i < nodeCount; i++) {
        indexByNode.set(nodes[i], i);
      }

      // 3. Resortes de Hooke a lo largo de cada arista (arrastrar un nodo jala elásticamente a sus vecinos)
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const u = edge.source;
        const v = edge.target;
        const ui = indexByNode.get(u);
        const vi = indexByNode.get(v);
        if (ui === undefined || vi === undefined) continue;

        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const displacement = dist - edge.restLen;
        const springForce = clamp(displacement * edge.stiffness, -12, 12);
        const sx = (dx / dist) * springForce;
        const sy = (dy / dist) * springForce;

        fx[ui] += sx;
        fy[ui] += sy;
        fx[vi] -= sx;
        fy[vi] -= sy;
      }

      // 4. Anclaje suave al centro + flotación orgánica submarina + amortiguación viscosa (0.84)
      const dampingFactor = Math.pow(VELOCITY_DAMPING, step);
      const kHome = isRecentering ? 0.048 : drag ? 0.0014 : 0.0028;

      for (let i = 0; i < nodeCount; i++) {
        const node = nodes[i];
        if (drag && node.id === drag.id) {
          const gEl = nodeGroupRefs.current.get(node.id);
          if (gEl) {
            gEl.setAttribute(
              "transform",
              `translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)})`
            );
          }
          continue;
        }

        // Suave gravedad centradora hacia (400, 260) para evitar deriva fuera de pantalla
        const kCenter = node.isHub ? 0.0046 : 0.0016;
        fx[i] += (WORLD_CENTER_X - node.x) * kCenter;
        fy[i] += (WORLD_CENTER_Y - node.y) * kCenter;

        // Suave memoria elástica de postura base
        fx[i] += (node.baseX - node.x) * kHome;
        fy[i] += (node.baseY - node.y) * kHome;

        // Flotación orgánica sutil multifrecuencia (respiración en agua)
        const buoyScale = node.isHub ? 0.45 : 1.0;
        fx[i] +=
          (Math.sin(t * node.freqX + node.phaseX) * 0.045 +
            Math.cos(t * (node.freqY * 0.61) + node.phaseY) * 0.022) *
          buoyScale;
        fy[i] +=
          (Math.cos(t * node.freqY + node.phaseY) * 0.045 +
            Math.sin(t * (node.freqX * 0.59) + node.phaseX) * 0.022) *
          buoyScale;

        const invMass = 1 / node.mass;
        node.vx = (node.vx + fx[i] * invMass * step) * dampingFactor;
        node.vy = (node.vy + fy[i] * invMass * step) * dampingFactor;

        const speed = Math.hypot(node.vx, node.vy);
        if (speed > 26) {
          const s = 26 / speed;
          node.vx *= s;
          node.vy *= s;
        }

        node.x += node.vx * step;
        node.y += node.vy * step;

        const gEl = nodeGroupRefs.current.get(node.id);
        if (gEl) {
          gEl.setAttribute(
            "transform",
            `translate(${node.x.toFixed(2)}, ${node.y.toFixed(2)})`
          );
        }
      }

      // 5. Actualizar aristas Bézier con posiciones vivas + vaivén perpendicular por velocidad
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const pathEl = edgePathRefs.current.get(edge.id);
        if (!pathEl) continue;

        const u = edge.source;
        const v = edge.target;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist;
        const ny = dx / dist;

        const relVx = u.vx - v.vx;
        const relVy = u.vy - v.vy;
        const avgVx = (u.vx + v.vx) * 0.5;
        const avgVy = (u.vy + v.vy) * 0.5;
        const perpTarget = clamp(
          (relVx * nx + relVy * ny) * 2.1 + (avgVx * nx + avgVy * ny) * 1.15,
          -26,
          26
        );

        edge.slosh = edge.slosh * 0.86 + perpTarget * 0.14;
        const impulseSlosh = getSloshAt(u.id, now) - getSloshAt(v.id, now);
        const totalSlosh = clamp(edge.slosh + impulseSlosh * 0.65, -30, 30);

        const d = buildWaterBezierPath(
          u.x,
          u.y,
          v.x,
          v.y,
          edge.seed,
          edge.edgeIndex,
          t,
          totalSlosh,
          true
        );
        pathEl.setAttribute("d", d);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      running = false;
      window.cancelAnimationFrame(rafId);
    };
  }, [prefersReducedMotion, syncDomFromSimulation]);

  // --- Reacción orgánica en tiempo real al comparar snapshots ---
  const prevNodesRef = useRef<Map<string, MemoryGraphNode>>(new Map());
  const hasDiffInitializedRef = useRef(false);
  const burstCounterRef = useRef(1);
  const burstTimersRef = useRef<Set<number>>(new Set());
  const [rippleMap, setRippleMap] = useState<Map<string, RippleEntry>>(
    new Map()
  );
  const [ghostNodes, setGhostNodes] = useState<GhostNode[]>([]);
  const [hubPulseSeq, setHubPulseSeq] = useState(0);
  const [hubPulseActive, setHubPulseActive] = useState(false);
  const [liveBanner, setLiveBanner] = useState<{
    seq: number;
    text: string;
    detail?: string;
    source: "xox" | "user";
  } | null>(null);

  useEffect(() => {
    const timers = burstTimersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const currentMap = new Map<string, MemoryGraphNode>();
    for (const n of snapshot.nodes) currentMap.set(n.id, n);

    if (!hasDiffInitializedRef.current) {
      hasDiffInitializedRef.current = true;
      prevNodesRef.current = currentMap;
      return;
    }

    const prevMap = prevNodesRef.current;
    const addedIds: string[] = [];
    const updatedIds: string[] = [];
    const removed: GhostNode[] = [];

    for (const node of snapshot.nodes) {
      if (node.kind === "hub" || node.kind === "category") continue;
      const prev = prevMap.get(node.id);
      if (!prev) {
        addedIds.push(node.id);
      } else if (
        prev.detail !== node.detail ||
        prev.label !== node.label ||
        prev.pinned !== node.pinned ||
        (node.tier === "L1_contextual" && prev.tier !== "L1_contextual")
      ) {
        updatedIds.push(node.id);
      }
    }

    for (const [prevId, prevNode] of prevMap.entries()) {
      if (prevNode.kind === "hub" || prevNode.kind === "category") continue;
      if (!currentMap.has(prevId)) {
        const lastPos = lastKnownPosRef.current.get(prevId);
        removed.push({
          key: `${prevId}-${Date.now()}-${burstCounterRef.current++}`,
          id: prevId,
          x: lastPos ? lastPos.x : prevNode.x,
          y: lastPos ? lastPos.y : prevNode.y,
          radius: prevNode.radius,
        });
      }
    }

    prevNodesRef.current = currentMap;

    if (addedIds.length > 0 || updatedIds.length > 0) {
      const burst = burstCounterRef.current++;
      setRippleMap((prev) => {
        const next = new Map(prev);
        for (const id of addedIds) {
          next.set(id, { burstKey: burst, kind: "added" });
          triggerNodeSlosh(id, 16);
        }
        for (const id of updatedIds) {
          next.set(id, { burstKey: burst, kind: "updated" });
          triggerNodeSlosh(id, 12);
        }
        return next;
      });

      const primaryChangedId = addedIds[0] ?? updatedIds[0];
      if (primaryChangedId) {
        setSelectedNodeId(primaryChangedId);
        setCreateMode(false);
      }

      const clearRippleTimer = window.setTimeout(() => {
        burstTimersRef.current.delete(clearRippleTimer);
        setRippleMap((prev) => {
          const next = new Map(prev);
          let mutated = false;
          for (const [id, entry] of next.entries()) {
            if (entry.burstKey === burst) {
              next.delete(id);
              mutated = true;
            }
          }
          return mutated ? next : prev;
        });
      }, 1650);
      burstTimersRef.current.add(clearRippleTimer);
    }

    if (removed.length > 0) {
      const removedKeys = new Set(removed.map((g) => g.key));
      setGhostNodes((prev) => [...prev, ...removed]);
      const clearGhostTimer = window.setTimeout(() => {
        burstTimersRef.current.delete(clearGhostTimer);
        setGhostNodes((prev) => prev.filter((g) => !removedKeys.has(g.key)));
      }, 720);
      burstTimersRef.current.add(clearGhostTimer);
    }
  }, [snapshot.nodes, triggerNodeSlosh]);

  // Reacción al pulso vivo `livePulse` (cuando Xox o el usuario modifican la memoria)
  useEffect(() => {
    if (!livePulse) return;
    if (livePulse.seq < lastHandledLivePulseSeq) {
      lastHandledLivePulseSeq = 0;
    }
    if (livePulse.seq === lastHandledLivePulseSeq) return;
    lastHandledLivePulseSeq = livePulse.seq;

    setHubPulseSeq((n) => n + 1);
    setHubPulseActive(true);
    triggerNodeSlosh("hub_core", 14);

    const text =
      livePulse.source === "xox"
        ? livePulse.action === "added"
          ? `${agentName} guardó un recuerdo`
          : livePulse.action === "removed"
            ? `${agentName} olvidó un recuerdo`
            : livePulse.action === "synced"
              ? "Memoria sincronizada"
              : `${agentName} actualizó la memoria`
        : livePulse.action === "added"
          ? "Recuerdo añadido"
          : livePulse.action === "removed"
            ? "Recuerdo eliminado"
            : "Memoria actualizada";

    setLiveBanner({
      seq: livePulse.seq,
      text,
      detail: livePulse.label
        ? truncateNodeLabel(livePulse.label, 28)
        : undefined,
      source: livePulse.source,
    });
  }, [livePulse, agentName, triggerNodeSlosh]);

  useEffect(() => {
    if (!hubPulseActive) return;
    const timer = window.setTimeout(() => {
      setHubPulseActive(false);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [hubPulseActive, hubPulseSeq]);

  useEffect(() => {
    if (!liveBanner) return;
    const bannerSeq = liveBanner.seq;
    const timer = window.setTimeout(() => {
      setLiveBanner((curr) => (curr?.seq === bannerSeq ? null : curr));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [liveBanner]);

  const selectedNode: MemoryGraphNode | null = useMemo(() => {
    if (selectedNodeId && nodeMap.has(selectedNodeId)) {
      return nodeMap.get(selectedNodeId)!;
    }
    const firstLeaf = snapshot.nodes.find(
      (n) =>
        n.kind !== "hub" && n.kind !== "category" && matchingNodeIds.has(n.id)
    );
    return firstLeaf ?? nodeMap.get("hub_core") ?? snapshot.nodes[0] ?? null;
  }, [selectedNodeId, nodeMap, snapshot.nodes, matchingNodeIds]);

  const activeFocusNodeId =
    draggingNodeId ?? hoveredNodeId ?? selectedNode?.id ?? null;

  const connectedNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeFocusNodeId) return set;
    set.add(activeFocusNodeId);
    for (const edge of snapshot.edges) {
      if (edge.source === activeFocusNodeId) set.add(edge.target);
      if (edge.target === activeFocusNodeId) set.add(edge.source);
    }
    return set;
  }, [snapshot.edges, activeFocusNodeId]);

  // Nodos vecinos conectados al nodo seleccionado (para Backlinks en el editor Obsidian)
  const selectedConnectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    const neighborIds = new Set<string>();
    for (const edge of snapshot.edges) {
      if (edge.source === selectedNode.id) neighborIds.add(edge.target);
      if (edge.target === selectedNode.id) neighborIds.add(edge.source);
    }
    const list: MemoryGraphNode[] = [];
    for (const id of neighborIds) {
      const n = nodeMap.get(id);
      if (n) list.push(n);
    }
    return list;
  }, [selectedNode, snapshot.edges, nodeMap]);

  // Enlaces iluminados al arrastrar, seleccionar, pasar el cursor o durante un pulso
  const energizedEdgeIds = useMemo(() => {
    const energized = new Set<string>();
    const activeCatIds = new Set<string>();

    if (activeFocusNodeId) {
      const focusNode = nodeMap.get(activeFocusNodeId);
      if (
        focusNode &&
        focusNode.kind !== "hub" &&
        focusNode.kind !== "category"
      ) {
        activeCatIds.add(`cat_${focusNode.category}`);
      }
    }
    for (const rippleId of rippleMap.keys()) {
      const rn = nodeMap.get(rippleId);
      if (rn && rn.kind !== "hub" && rn.kind !== "category") {
        activeCatIds.add(`cat_${rn.category}`);
      }
    }

    for (const edge of snapshot.edges) {
      const touchesFocus =
        activeFocusNodeId !== null &&
        (edge.source === activeFocusNodeId ||
          edge.target === activeFocusNodeId);
      const touchesRipple =
        rippleMap.has(edge.source) || rippleMap.has(edge.target);
      const isHubToActiveCat =
        edge.kind === "hierarchy" &&
        edge.source === "hub_core" &&
        activeCatIds.has(edge.target);
      const isHubPulseEdge =
        hubPulseActive &&
        edge.kind === "hierarchy" &&
        edge.source === "hub_core";
      if (touchesFocus || touchesRipple || isHubToActiveCat || isHubPulseEdge) {
        energized.add(edge.id);
      }
    }
    return energized;
  }, [snapshot.edges, nodeMap, activeFocusNodeId, rippleMap, hubPulseActive]);

  const leafCount = useMemo(
    () =>
      snapshot.nodes.filter(
        (n) =>
          n.kind !== "hub" && n.kind !== "category" && matchingNodeIds.has(n.id)
      ).length,
    [snapshot.nodes, matchingNodeIds]
  );

  const { stats } = snapshot;
  const userLabel = localUser?.preferredName || localUser?.name || "Usuario";

  return (
    <div className="h-full flex-1 min-h-0 flex flex-col gap-2">
      {/* =================================================================== */}
      {/* 1. BARRA SUPERIOR COMPACTA DE UNA SOLA FILA                         */}
      {/* =================================================================== */}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {/* Buscador / simulador de consulta L1 */}
        <div className="relative flex-1 min-w-[126px]">
          <Search
            className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id={`${uid}-memory-query`}
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Buscar o simular consulta..."
            aria-label="Buscar o simular consulta"
            className="w-full h-8 pl-7 pr-6 rounded-lg bg-[#121318] border border-white/[0.08] text-[11px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/[0.24] select-text"
          />
          {queryText && (
            <button
              type="button"
              onClick={() => setQueryText("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filtro segmentado Todo / Global / Espacio */}
        <div
          role="group"
          aria-label="Filtrar alcance"
          className="inline-flex items-center h-8 p-0.5 rounded-lg bg-[#121318] border border-white/[0.08] shrink-0"
        >
          {(
            [
              { id: "all", label: "Todo" },
              { id: "global", label: "Global" },
              { id: "workspace", label: "Espacio" },
            ] as const
          ).map((item) => {
            const active = scopeFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setScopeFilter(item.id)}
                className={`h-full px-2 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-white/[0.14] text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Píldora compacta de ahorro de tokens + popover flotante L0/L1/L2 */}
        <div
          ref={tokenPopoverRef}
          className="relative shrink-0"
          onMouseEnter={() => setTokenPopoverOpen(true)}
          onMouseLeave={() => {
            if (!tokenPopoverPinned) setTokenPopoverOpen(false);
          }}
        >
          <button
            type="button"
            aria-expanded={tokenPopoverOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setTokenPopoverPinned((p) => {
                const next = !p;
                setTokenPopoverOpen(next);
                return next;
              });
            }}
            className="h-8 px-2 rounded-lg border text-[10.5px] font-mono font-medium inline-flex items-center gap-1 transition-colors cursor-pointer bg-[#121318] border-white/[0.09] hover:border-white/[0.18] text-zinc-200"
            style={
              tierFilter !== "all"
                ? {
                    backgroundColor: hexToRgba(accent.glow, 0.16),
                    borderColor: hexToRgba(accent.rim, 0.42),
                    color: accent.blushCore,
                  }
                : undefined
            }
            title="Ver desglose de tokens L0 / L1 / L2"
          >
            <Zap
              className="w-3 h-3 shrink-0"
              style={{ color: accent.rim }}
              aria-hidden="true"
            />
            <span>~{stats.optimizedTokensEstimate} tok</span>
            {stats.savedPct > 0 && (
              <span style={{ color: accent.rim }}>· -{stats.savedPct}%</span>
            )}
          </button>

          {tokenPopoverOpen && (
            <div
              role="dialog"
              aria-label="Desglose de tokens de inicio L0, L1 y L2"
              className="absolute right-0 top-full mt-1.5 z-40 w-[244px] rounded-xl border border-white/[0.12] bg-[#121318]/98 backdrop-blur-xl shadow-[0_18px_42px_-12px_rgba(0,0,0,0.9)] p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 text-[10.5px]">
                <span className="font-medium text-white">
                  Presupuesto de inicio
                </span>
                <span className="font-mono text-zinc-400">
                  <span style={{ color: accent.rim }}>
                    ~{stats.optimizedTokensEstimate}t
                  </span>{" "}
                  <span className="line-through text-zinc-600">
                    ~{stats.naiveTokensEstimate}t
                  </span>
                </span>
              </div>

              <div className="space-y-1">
                {(
                  [
                    {
                      id: "L0_core",
                      label: "L0 Fijos",
                      count: stats.l0Count,
                      meta: `~${stats.l0Tokens} tok`,
                      dotStyle: {
                        backgroundColor: accent.blushCore,
                        boxShadow: `0 0 0 2px ${hexToRgba(accent.glow, 0.48)}`,
                      },
                    },
                    {
                      id: "L1_contextual",
                      label: "L1 Contextuales",
                      count: stats.l1Count,
                      meta: `~${stats.l1Tokens} tok`,
                      dotStyle: {
                        backgroundColor: accent.celebrateMid,
                        boxShadow: `0 0 0 1.5px ${hexToRgba(accent.accessory, 0.5)}`,
                      },
                    },
                    {
                      id: "L2_ondemand",
                      label: "L2 Bajo demanda",
                      count: stats.l2Count,
                      meta: "0 tok",
                      dotStyle: {
                        backgroundColor: l2Color,
                      },
                    },
                  ] as const
                ).map((row) => {
                  const isActive = tierFilter === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() =>
                        setTierFilter((curr) =>
                          curr === row.id ? "all" : row.id
                        )
                      }
                      className={`w-full px-2 py-1 rounded-lg border flex items-center justify-between gap-2 text-[10.5px] transition-colors cursor-pointer ${
                        isActive
                          ? "bg-white/[0.12] border-white/25 text-white"
                          : "bg-black/35 border-white/[0.06] text-zinc-300 hover:border-white/[0.15]"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={row.dotStyle}
                          aria-hidden="true"
                        />
                        <span>
                          {row.label} ({row.count})
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {row.meta}
                      </span>
                    </button>
                  );
                })}
              </div>

              {tierFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setTierFilter("all")}
                  className="w-full py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-[10px] text-zinc-200 cursor-pointer"
                >
                  Mostrar todos los niveles
                </button>
              )}

              {startupPayload.l2IndexLine && (
                <div className="rounded-md bg-black/45 border border-white/[0.05] px-2 py-1 text-[9.5px] font-mono text-zinc-400 truncate">
                  {startupPayload.l2IndexLine}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botón Modo amplio / Compactar (Obsidian Workspace) */}
        <button
          type="button"
          onClick={handleToggleWideMode}
          aria-pressed={effectiveWideMode}
          title={
            effectiveWideMode
              ? "Compactar vista de grafo"
              : "Abrir Modo amplio estilo Obsidian (grafo + editor lado a lado)"
          }
          className={`h-8 px-2.5 rounded-lg border text-[10.5px] font-medium inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors ${
            effectiveWideMode
              ? "bg-white/[0.14] border-white/25 text-white"
              : "bg-[#121318] border-white/[0.09] hover:border-white/[0.18] text-zinc-200 hover:text-white"
          }`}
        >
          {effectiveWideMode ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Compactar</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Modo amplio</span>
            </>
          )}
        </button>

        {/* Botón único + Nuevo */}
        <button
          type="button"
          onClick={() => {
            setCreateMode((prev) => {
              const next = !prev;
              if (next) {
                setCreatePresetScope(
                  scopeFilter === "workspace" ? "workspace" : "global"
                );
                setCreatePresetCategory("preference");
              }
              return next;
            });
          }}
          aria-pressed={createMode}
          className={`h-8 px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors ${
            createMode
              ? "bg-white/[0.16] text-white border border-white/25"
              : "bg-white text-zinc-950 hover:bg-zinc-200"
          }`}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Nuevo</span>
        </button>
      </div>

      {/* =================================================================== */}
      {/* 2. WORKSPACE OBSIDIAN A ALTURA COMPLETA                             */}
      {/* =================================================================== */}
      <div
        className={
          effectiveWideMode
            ? "grid grid-cols-1 grid-rows-[minmax(240px,1.35fr)_minmax(180px,0.65fr)] lg:grid-cols-[1.5fr_0.85fr] lg:grid-rows-[minmax(0,1fr)] flex-1 min-h-0 h-full gap-2.5"
            : "flex-1 min-h-0 flex flex-col gap-2"
        }
      >
        {/* LIENZO SVG DEL GRAFO DE MEMORIA CON FÍSICA ELÁSTICA EN TIEMPO REAL */}
        <section
          aria-label="Grafo interactivo de memoria"
          className={`rounded-xl border border-white/[0.08] bg-[#111318] overflow-hidden relative flex flex-col ${
            effectiveWideMode ? "min-h-0 h-full" : "flex-1 min-h-[240px]"
          }`}
        >
          {/* Cabecera mínima: conteo + leyenda armonizada con el avatar de Xox */}
          <div className="px-3 py-1.5 border-b border-white/[0.06] bg-[#13151b] flex items-center justify-between gap-2 text-[10px] shrink-0">
            <span className="font-mono text-zinc-400">
              {leafCount} {leafCount === 1 ? "recuerdo" : "recuerdos"}
              {tierFilter !== "all" ? ` · ${TIER_SHORT_LABELS[tierFilter]}` : ""}
            </span>

            <div
              role="group"
              aria-label="Leyenda y filtro rápido por nivel"
              className="inline-flex items-center gap-2.5 text-zinc-400"
            >
              <span
                className="inline-flex items-center gap-1 text-zinc-400"
                title="Nodos de etiqueta (#categoría)"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: accent.rim }}
                  aria-hidden="true"
                />
                <span>#tag</span>
              </span>

              {(
                [
                  {
                    id: "L0_core",
                    label: "L0",
                    dotStyle: {
                      backgroundColor: accent.blushCore,
                      boxShadow: `0 0 0 2px ${hexToRgba(accent.glow, 0.48)}`,
                    },
                    title: "L0 Fijo en inicio",
                  },
                  {
                    id: "L1_contextual",
                    label: "L1",
                    dotStyle: {
                      backgroundColor: accent.celebrateMid,
                      boxShadow: `0 0 0 1.5px ${hexToRgba(accent.accessory, 0.5)}`,
                    },
                    title: "L1 Contextual por consulta",
                  },
                  {
                    id: "L2_ondemand",
                    label: "L2",
                    dotStyle: {
                      backgroundColor: l2Color,
                    },
                    title: "L2 Bajo demanda (0 tok al inicio)",
                  },
                ] as const
              ).map((item) => {
                const active = tierFilter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.title}
                    aria-pressed={active}
                    onClick={() =>
                      setTierFilter((curr) =>
                        curr === item.id ? "all" : item.id
                      )
                    }
                    className={`inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      active ? "text-white font-semibold" : "hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={item.dotStyle}
                      aria-hidden="true"
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Píldora flotante en vivo cuando Xox (o el usuario) modifica memoria */}
          {liveBanner && (
            <div
              key={liveBanner.seq}
              role="status"
              aria-live="polite"
              className="xook-live-pill pointer-events-none absolute top-9 left-2.5 z-20 max-w-[82%] px-2.5 py-1 rounded-full bg-[#121318]/95 border border-white/[0.15] backdrop-blur-md shadow-[0_10px_28px_-10px_rgba(0,0,0,0.9)] inline-flex items-center gap-1.5 text-[10.5px]"
            >
              <span
                className="xook-live-dot w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    liveBanner.source === "xox" ? "#FFFFFF" : accent.rim,
                }}
                aria-hidden="true"
              />
              {liveBanner.source === "xox" && (
                <XoxSilhouetteIcon className="w-3.5 h-3.5 text-white shrink-0" />
              )}
              <span className="font-medium text-white truncate">
                {liveBanner.text}
              </span>
              {liveBanner.detail && (
                <span className="text-zinc-400 truncate hidden sm:inline">
                  · {liveBanner.detail}
                </span>
              )}
            </div>
          )}

          {/* Contenedor responsivo 100% de altura medido por ResizeObserver */}
          <div
            ref={viewportRef}
            className="relative flex-1 min-h-0 w-full overflow-hidden"
          >
            <svg
              ref={svgRef}
              width={Math.max(1, canvasSize.width)}
              height={Math.max(1, canvasSize.height)}
              role="img"
              aria-label={`Grafo de memoria Obsidian de ${agentName} y ${userLabel}`}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              onDoubleClick={handleCanvasDoubleClick}
              className={`absolute inset-0 block w-full h-full select-none touch-none ${
                isPanning ? "cursor-grabbing" : "cursor-grab"
              }`}
            >
              <defs>
                <radialGradient
                  id={`${uid}-obsidian-bg`}
                  cx="50%"
                  cy="50%"
                  r="68%"
                >
                  <stop offset="0%" stopColor="#171922" />
                  <stop offset="68%" stopColor="#111318" />
                  <stop offset="100%" stopColor="#0d0f14" />
                </radialGradient>
                <radialGradient
                  id={`${uid}-hub-halo`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={accent.glow} stopOpacity="0.42" />
                  <stop offset="52%" stopColor={accent.glow} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={accent.glow} stopOpacity="0" />
                </radialGradient>
                <radialGradient
                  id={`${uid}-tag-halo`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={accent.rim} stopOpacity="0.38" />
                  <stop offset="100%" stopColor={accent.rim} stopOpacity="0" />
                </radialGradient>
                <radialGradient
                  id={`${uid}-l0-halo`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={accent.glow} stopOpacity="0.42" />
                  <stop offset="55%" stopColor={accent.glow} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={accent.glow} stopOpacity="0" />
                </radialGradient>
                <radialGradient
                  id={`${uid}-l1-halo`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop
                    offset="0%"
                    stopColor={accent.accessory}
                    stopOpacity="0.46"
                  />
                  <stop
                    offset="100%"
                    stopColor={accent.accessory}
                    stopOpacity="0"
                  />
                </radialGradient>
                <radialGradient
                  id={`${uid}-l2-halo`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                >
                  <stop offset="0%" stopColor={l2Color} stopOpacity="0.34" />
                  <stop offset="100%" stopColor={l2Color} stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Fondo mate Obsidian de pantalla completa */}
              <rect
                x={0}
                y={0}
                width={Math.max(1, canvasSize.width)}
                height={Math.max(1, canvasSize.height)}
                fill={`url(#${uid}-obsidian-bg)`}
              />

              {/* Grupo de cámara 2D en píxeles nativos (Pan + Zoom) */}
              <g
                ref={cameraGroupRef}
                transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
              >
                {/* 1. ENLACES CURVOS EN AGUA (BÉZIER CÚBICOS CON FÍSICA VIVA) */}
                <g aria-hidden="true">
                  {snapshot.edges.map((edge, edgeIndex) => {
                    const source = nodeMap.get(edge.source);
                    const target = nodeMap.get(edge.target);
                    if (!source || !target) return null;

                    const simS = simNodesRef.current.get(edge.source);
                    const simT = simNodesRef.current.get(edge.target);
                    const sx = simS ? simS.x : source.x;
                    const sy = simS ? simS.y : source.y;
                    const tx = simT ? simT.x : target.x;
                    const ty = simT ? simT.y : target.y;

                    const seed = getEdgeCurveSeed(edge, edgeIndex);
                    const initialD = buildWaterBezierPath(
                      sx,
                      sy,
                      tx,
                      ty,
                      seed,
                      edgeIndex,
                      0,
                      0,
                      false
                    );

                    const isEnergized = energizedEdgeIds.has(edge.id);
                    const bothVisible =
                      matchingNodeIds.has(edge.source) &&
                      matchingNodeIds.has(edge.target);
                    const isHoverDimmed =
                      (hoveredNodeId !== null || draggingNodeId !== null) &&
                      !isEnergized;

                    const strokeColor = isEnergized
                      ? accent.celebrateMid
                      : accent.rim;
                    const strokeOpacity = !bothVisible
                      ? 0.04
                      : isEnergized
                        ? 0.68
                        : isHoverDimmed
                          ? 0.07
                          : 0.2;

                    return (
                      <path
                        key={edge.id}
                        ref={(el) => {
                          if (el) {
                            edgePathRefs.current.set(edge.id, el);
                          } else {
                            edgePathRefs.current.delete(edge.id);
                          }
                        }}
                        d={initialD}
                        fill="none"
                        stroke={strokeColor}
                        strokeOpacity={strokeOpacity}
                        strokeWidth={isEnergized ? 1.55 : 1.15}
                        strokeLinecap="round"
                        className="xook-graph-edge"
                      />
                    );
                  })}
                </g>

                {/* 2. ONDAS FANTASMA DE NODOS ELIMINADOS (700ms disolución) */}
                <g aria-hidden="true" className="pointer-events-none">
                  {ghostNodes.map((ghost) => (
                    <g
                      key={ghost.key}
                      transform={`translate(${ghost.x.toFixed(2)}, ${ghost.y.toFixed(2)})`}
                    >
                      <circle
                        cx={0}
                        cy={0}
                        r={8}
                        fill="none"
                        stroke={accent.rim}
                        strokeWidth={1.5}
                        className="xook-node-dissolve"
                      />
                    </g>
                  ))}
                </g>

                {/* 3. NODOS SÓLIDOS ARMONIZADOS CON EL AVATAR DE XOX */}
                <g>
                  {snapshot.nodes.map((node) => {
                    const sim = simNodesRef.current.get(node.id);
                    const px = sim ? sim.x : node.x;
                    const py = sim ? sim.y : node.y;

                    const isSelected =
                      !createMode && selectedNode?.id === node.id;
                    const isHovered = hoveredNodeId === node.id;
                    const isDragging = draggingNodeId === node.id;
                    const isNeighbor = connectedNodeIds.has(node.id);
                    const isMatchingFilter = matchingNodeIds.has(node.id);
                    const isHub = node.kind === "hub";
                    const isCategory = node.kind === "category";
                    const isL0 = !isHub && !isCategory && node.tier === "L0_core";
                    const isL1 =
                      !isHub && !isCategory && node.tier === "L1_contextual";
                    const ripple = rippleMap.get(node.id);

                    const nodeOpacity = !isMatchingFilter
                      ? 0.14
                      : (hoveredNodeId !== null || draggingNodeId !== null) &&
                          !isNeighbor &&
                          !isHub
                        ? 0.28
                        : activeFocusNodeId && !isNeighbor && !isHub
                          ? 0.85
                          : 1;

                    const catLabel =
                      CATEGORY_LABELS[node.category] || node.label;
                    const tagLabel = `#${catLabel.toLowerCase()}`;

                    const dotRadius = isHub
                      ? 16
                      : isCategory
                        ? isSelected || isHovered || isDragging
                          ? 8.5
                          : 7.5
                        : isL0
                          ? isSelected || isHovered || isDragging
                            ? 7.8
                            : 7.0
                          : isL1
                            ? isSelected || isHovered || isDragging
                              ? 7.4
                              : 6.5
                            : isSelected || isHovered || isDragging
                              ? 6.7
                              : 5.9;

                    const labelY = isHub
                      ? 28
                      : isCategory
                        ? dotRadius + 13
                        : dotRadius + 12.5;

                    return (
                      <g
                        key={node.id}
                        ref={(el) => {
                          if (el) {
                            nodeGroupRefs.current.set(node.id, el);
                          } else {
                            nodeGroupRefs.current.delete(node.id);
                          }
                        }}
                        data-selected={isSelected ? "true" : "false"}
                        data-dragging={isDragging ? "true" : "false"}
                        transform={`translate(${px.toFixed(2)}, ${py.toFixed(2)})`}
                        style={{ opacity: nodeOpacity }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${
                          isCategory ? tagLabel : node.label
                        }: ${node.detail}`}
                        onPointerDown={(e) => handleNodePointerDown(e, node)}
                        onPointerMove={handleNodePointerMove}
                        onPointerUp={(e) => handleNodePointerUp(e, node)}
                        onPointerCancel={handleNodePointerCancel}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() =>
                          setHoveredNodeId((curr) =>
                            curr === node.id ? null : curr
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedNodeId(node.id);
                            setCreateMode(false);
                          }
                        }}
                        className={`xook-graph-node focus:outline-none ${
                          isDragging ? "cursor-grabbing" : "cursor-pointer"
                        }`}
                      >
                        {/* Área táctil invisible para facilitar clic y arrastre */}
                        <circle
                          cx={0}
                          cy={0}
                          r={Math.max(16, dotRadius + 7)}
                          fill="transparent"
                        />

                        {/* Ondas sonar cuando Xox o el usuario agregan / editan un nodo */}
                        {ripple && (
                          <>
                            <circle
                              key={`r1-${ripple.burstKey}`}
                              cx={0}
                              cy={0}
                              r={dotRadius + 2}
                              fill="none"
                              stroke={
                                ripple.kind === "added"
                                  ? accent.rim
                                  : accent.accessory
                              }
                              strokeWidth={1.6}
                              className="xook-node-ripple"
                            />
                            <circle
                              key={`r2-${ripple.burstKey}`}
                              cx={0}
                              cy={0}
                              r={dotRadius + 2}
                              fill="none"
                              stroke={
                                ripple.kind === "added"
                                  ? accent.blushCore
                                  : accent.celebrateMid
                              }
                              strokeWidth={1.1}
                              className="xook-node-ripple-delayed"
                            />
                          </>
                        )}

                        {isHub ? (
                          /* NODO CENTRAL XOX: Silueta blanca nítida con dimensiones SVG explícitas */
                          <>
                            <circle
                              cx={0}
                              cy={0}
                              r={28}
                              fill={`url(#${uid}-hub-halo)`}
                              className="xook-hub-breathe"
                            />
                            {hubPulseSeq > 0 && (
                              <circle
                                key={`hub-ripple-${hubPulseSeq}`}
                                cx={0}
                                cy={0}
                                r={17}
                                fill="none"
                                stroke={accent.blushCore}
                                strokeWidth={1.6}
                                className="xook-node-ripple"
                              />
                            )}
                            <circle
                              cx={0}
                              cy={0}
                              r={16}
                              fill="#111318"
                              stroke={
                                isSelected || isHovered || isDragging
                                  ? accent.blushCore
                                  : accent.rim
                              }
                              strokeOpacity={
                                isSelected || isHovered || isDragging
                                  ? 0.88
                                  : 0.45
                              }
                              strokeWidth={isSelected ? 1.55 : 1.15}
                            />
                            <XoxSilhouetteIcon
                              x={-11}
                              y={-11}
                              width={22}
                              height={22}
                              className="text-white"
                            />
                          </>
                        ) : isCategory ? (
                          /* NODO DE CATEGORÍA / TAG (#categoria): accent.rim */
                          <>
                            {(isSelected || isHovered || isDragging) && (
                              <circle
                                cx={0}
                                cy={0}
                                r={dotRadius + 7.5}
                                fill={`url(#${uid}-tag-halo)`}
                              />
                            )}
                            <circle
                              cx={0}
                              cy={0}
                              r={dotRadius}
                              fill={accent.rim}
                              stroke={
                                isSelected
                                  ? "#FFFFFF"
                                  : isHovered || isDragging
                                    ? accent.blushCore
                                    : "none"
                              }
                              strokeWidth={isSelected ? 1.6 : 1.1}
                            />
                          </>
                        ) : isL0 ? (
                          /* NODO L0 FIJO: accent.blushCore con aura delicada en accent.glow */
                          <>
                            <circle
                              cx={0}
                              cy={0}
                              r={
                                dotRadius +
                                (isSelected || isHovered || isDragging
                                  ? 7.5
                                  : 5.5)
                              }
                              fill={`url(#${uid}-l0-halo)`}
                            />
                            <circle
                              cx={0}
                              cy={0}
                              r={dotRadius}
                              fill={accent.blushCore}
                              stroke={
                                isSelected
                                  ? "#FFFFFF"
                                  : isHovered || isDragging
                                    ? accent.rim
                                    : hexToRgba(accent.glow, 0.55)
                              }
                              strokeWidth={isSelected ? 1.6 : 1.0}
                            />
                          </>
                        ) : isL1 ? (
                          /* NODO L1 CONTEXTUAL: accent.celebrateMid con pulso vivo en accent.accessory */
                          <>
                            <circle
                              cx={0}
                              cy={0}
                              r={
                                dotRadius +
                                (isSelected || isHovered || isDragging
                                  ? 7.5
                                  : 5.5)
                              }
                              fill={`url(#${uid}-l1-halo)`}
                            />
                            <circle
                              cx={0}
                              cy={0}
                              r={dotRadius + 2.2}
                              fill="none"
                              stroke={accent.accessory}
                              strokeWidth={1.35}
                              className="xook-l1-pulse"
                            />
                            <circle
                              cx={0}
                              cy={0}
                              r={dotRadius}
                              fill={accent.celebrateMid}
                              stroke={
                                isSelected
                                  ? "#FFFFFF"
                                  : isHovered || isDragging
                                    ? accent.blushCore
                                    : accent.accessory
                              }
                              strokeWidth={isSelected ? 1.5 : 1.0}
                            />
                          </>
                        ) : (
                          /* NODO L2 BAJO DEMANDA: accent.bodyLower / accent.deep */
                          <>
                            {(isSelected || isHovered || isDragging) && (
                              <circle
                                cx={0}
                                cy={0}
                                r={dotRadius + 6.5}
                                fill={`url(#${uid}-l2-halo)`}
                              />
                            )}
                            <circle
                              cx={0}
                              cy={0}
                              r={dotRadius}
                              fill={l2Color}
                              stroke={
                                isSelected
                                  ? "#FFFFFF"
                                  : isHovered || isDragging
                                    ? accent.rim
                                    : "none"
                              }
                              strokeWidth={isSelected ? 1.5 : 1.0}
                            />
                          </>
                        )}

                        {/* Etiqueta limpia debajo del nodo estilo Obsidian */}
                        <text
                          x={0}
                          y={labelY}
                          textAnchor="middle"
                          fill={
                            isSelected || isHovered || isDragging
                              ? "#F4F4F5"
                              : isHub
                                ? "#E4E4E7"
                                : isCategory
                                  ? "#C4C9D6"
                                  : "#9CA3AF"
                          }
                          fontSize={isHub ? "11" : "10.5"}
                          fontWeight={
                            isSelected || isHub || isCategory ? "500" : "400"
                          }
                          paintOrder="stroke"
                          stroke="#111318"
                          strokeWidth={3.2}
                          strokeLinejoin="round"
                        >
                          {isHub
                            ? `${truncateNodeLabel(agentName, 12)} · ${truncateNodeLabel(userLabel, 12)}`
                            : isCategory
                              ? tagLabel
                              : truncateNodeLabel(node.label, 20)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>

            {/* Controles HUD flotantes (esquina inferior derecha del lienzo) */}
            <div
              role="group"
              aria-label="Controles de cámara del grafo"
              className="absolute bottom-2.5 right-2.5 z-20 inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#0f1116]/92 border border-white/[0.1] backdrop-blur-md shadow-[0_8px_22px_-8px_rgba(0,0,0,0.85)]"
            >
              <button
                type="button"
                onClick={() => zoomAroundCenter(1 / 1.22)}
                title="Alejar grafo"
                aria-label="Alejar grafo"
                className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <Minus className="w-3 h-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleResetView}
                title="Centrar y encuadrar grafo"
                aria-label="Centrar grafo"
                className="h-6 px-2 rounded-md inline-flex items-center gap-1 text-[10px] font-mono text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
                <span>Centrar</span>
                <span className="text-zinc-500">·</span>
                <span>{Math.round(zoom * 100)}%</span>
              </button>
              <button
                type="button"
                onClick={() => zoomAroundCenter(1.22)}
                title="Acercar grafo"
                aria-label="Acercar grafo"
                className="w-6 h-6 rounded-md inline-flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        {/* ================================================================= */}
        {/* 3. EDITOR DE NOTAS OBSIDIAN / MINI WORD                           */}
        {/* ================================================================= */}
        <MemoryWordEditor
          agentName={agentName}
          accentColor={accent.mid}
          accentPreset={resolvedPreset}
          selectedNode={selectedNode}
          allNodes={snapshot.nodes}
          connectedNodes={selectedConnectedNodes}
          isWideMode={effectiveWideMode}
          userMemoryFacts={userMemoryFacts}
          workspaceFacts={workspaceFacts}
          profile={profile}
          activeWorkspaceName={activeWorkspaceName}
          hasActiveWorkspace={hasActiveWorkspace}
          createMode={createMode}
          initialCreateScope={createPresetScope}
          initialCreateCategory={createPresetCategory}
          onExitCreateMode={() => setCreateMode(false)}
          onEnterCreateMode={(opts) => {
            setCreatePresetScope(opts?.scope ?? "global");
            setCreatePresetCategory(opts?.category ?? "preference");
            setCreateMode(true);
          }}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setCreateMode(false);
          }}
          onSaveFact={onSaveFact}
          onTogglePinFact={onTogglePinFact}
          onDeleteFact={onDeleteFact}
          onUpdateWorkspaceFact={onUpdateWorkspaceFact}
          onDeleteWorkspaceFact={onDeleteWorkspaceFact}
          onAddWorkspaceFact={onAddWorkspaceFact}
          onUpdatePreference={onUpdatePreference}
          onDeletePreference={onDeletePreference}
          onAskXoxEditMemory={onAskXoxEditMemory}
        />
      </div>
    </div>
  );
};
