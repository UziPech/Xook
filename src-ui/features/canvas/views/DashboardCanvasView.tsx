import React, { useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Filter,
  Info,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import type {
  CanvasChartSeries,
  CanvasChartSpec,
  CanvasChartType,
  CanvasDashboardSpec,
  CanvasInsightItem,
  CanvasKpiItem,
  CanvasMetricTone,
  CanvasValueFormat,
} from "../canvasSchema";

interface DashboardCanvasViewProps {
  dashboard: CanvasDashboardSpec;
  expanded?: boolean;
  hasBackingTable?: boolean;
  onFilterTable?: (query: string) => void;
  onAskItem?: (label: string, detail?: string) => void;
  tableSection?: React.ReactNode;
}

const SERIES_PALETTE = [
  "#e4e4e7",
  "#7dd3fc",
  "#6ee7b7",
  "#fcd34d",
  "#c4b5fd",
  "#fda4af",
];

function resolveSeriesColor(series: CanvasChartSeries, idx: number): string {
  switch (series.tone) {
    case "positive":
      return "#34d399";
    case "warning":
      return "#fbbf24";
    case "critical":
      return "#fb7185";
    case "neutral":
      return "#a1a1aa";
    case "accent":
      return SERIES_PALETTE[idx % SERIES_PALETTE.length];
    default:
      return SERIES_PALETTE[idx % SERIES_PALETTE.length];
  }
}

function getKpiToneClasses(tone?: CanvasMetricTone): string {
  switch (tone) {
    case "positive":
      return "border-emerald-400/25 bg-emerald-500/[0.04]";
    case "warning":
      return "border-amber-400/25 bg-amber-500/[0.04]";
    case "critical":
      return "border-rose-400/25 bg-rose-500/[0.04]";
    default:
      return "border-white/[0.09] bg-white/[0.03]";
  }
}

function getInsightMeta(tone?: CanvasInsightItem["tone"]) {
  switch (tone) {
    case "positive":
      return {
        cls: "border-emerald-400/25 bg-emerald-500/[0.05] text-emerald-100",
        Icon: CheckCircle2,
        iconCls: "text-emerald-300",
      };
    case "warning":
      return {
        cls: "border-amber-400/25 bg-amber-500/[0.05] text-amber-100",
        Icon: AlertTriangle,
        iconCls: "text-amber-300",
      };
    case "critical":
      return {
        cls: "border-rose-400/25 bg-rose-500/[0.05] text-rose-100",
        Icon: AlertTriangle,
        iconCls: "text-rose-300",
      };
    default:
      return {
        cls: "border-white/[0.09] bg-white/[0.03] text-zinc-200",
        Icon: Info,
        iconCls: "text-zinc-300",
      };
  }
}

function formatMetricValue(
  value: number,
  format: CanvasValueFormat = "number",
  unit?: string,
  compact = false
): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);

  if (format === "percent") {
    const formatted = value.toLocaleString("es-MX", { maximumFractionDigits: 1 });
    return `${formatted}%`;
  }

  if (compact && abs >= 1000) {
    const suffix = abs >= 1_000_000 ? "M" : "K";
    const div = abs >= 1_000_000 ? 1_000_000 : 1_000;
    const shortNum = (value / div).toLocaleString("es-MX", { maximumFractionDigits: 1 });
    return format === "currency" ? `$${shortNum}${suffix}` : `${shortNum}${suffix}`;
  }

  const base = value.toLocaleString("es-MX", {
    maximumFractionDigits: abs < 10 ? 2 : 0,
  });
  if (format === "currency") {
    return `$${base}${unit && !/^\$|mxn|usd|eur/i.test(unit) ? ` ${unit}` : ""}`;
  }
  return unit && !compact ? `${base} ${unit}` : base;
}

function computeNiceTicks(rawMin: number, rawMax: number, tickCount = 4): {
  min: number;
  max: number;
  ticks: number[];
} {
  let lo = Math.min(0, rawMin);
  let hi = Math.max(0, rawMax);
  if (lo === hi) hi = lo + 10;
  const span = hi - lo;
  const rawStep = span / Math.max(1, tickCount - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = niceNorm * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min, max, ticks };
}

function describeDonutArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + outerR * Math.cos(rad(startAngle));
  const y1 = cy + outerR * Math.sin(rad(startAngle));
  const x2 = cx + outerR * Math.cos(rad(endAngle));
  const y2 = cy + outerR * Math.sin(rad(endAngle));
  const x3 = cx + innerR * Math.cos(rad(endAngle));
  const y3 = cy + innerR * Math.sin(rad(endAngle));
  const x4 = cx + innerR * Math.cos(rad(startAngle));
  const y4 = cy + innerR * Math.sin(rad(startAngle));
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

interface ChartCardProps {
  chart: CanvasChartSpec;
  hasBackingTable?: boolean;
  onFilterTable?: (query: string) => void;
  onAskItem?: (label: string, detail?: string) => void;
}

const ChartCard: React.FC<ChartCardProps> = ({
  chart,
  hasBackingTable,
  onFilterTable,
  onAskItem,
}) => {
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeType, setActiveType] = useState<CanvasChartType>(chart.chartType);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const focusIdx = hoveredIdx ?? selectedIdx;

  const handleDownloadSvg = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.style.background = "#090a0e";
    const serialized = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug =
      chart.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "grafica-xook";
    a.href = url;
    a.download = `${slug}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allValues = useMemo(() => {
    const nums = chart.series.flatMap((s) => s.values);
    if (chart.targetValue !== undefined) nums.push(chart.targetValue);
    return nums;
  }, [chart.series, chart.targetValue]);

  const { min: yMin, max: yMax, ticks } = useMemo(
    () =>
      computeNiceTicks(
        Math.min(0, ...allValues),
        Math.max(1, ...allValues),
        4
      ),
    [allValues]
  );

  const selectedCategory =
    selectedIdx !== null ? chart.categories[selectedIdx] ?? null : null;

  const renderCartesianSvg = () => {
    const W = 520;
    const H = 224;
    const padL = 56;
    const padR = 16;
    const padT = 18;
    const padB = chart.categories.length > 7 ? 48 : 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const range = yMax - yMin || 1;
    const yOf = (val: number) => padT + plotH - ((val - yMin) / range) * plotH;
    const nCats = Math.max(1, chart.categories.length);
    const slotW = plotW / nCats;

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none overflow-visible"
        role="img"
        aria-label={chart.title}
      >
        <defs>
          {chart.series.map((s, sIdx) => {
            const col = resolveSeriesColor(s, sIdx);
            return (
              <linearGradient
                key={`grad-${s.id}`}
                id={`area_grad_${uid}_${sIdx}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={col} stopOpacity="0.28" />
                <stop offset="100%" stopColor={col} stopOpacity="0.01" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Líneas guía horizontales y escala Y */}
        {ticks.map((tk) => {
          const y = yOf(tk);
          return (
            <g key={`tk-${tk}`}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke={tk === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)"}
                strokeDasharray={tk === 0 ? undefined : "3 4"}
              />
              <text
                x={padL - 8}
                y={y + 3.5}
                textAnchor="end"
                fill="#71717a"
                fontSize="10"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatMetricValue(tk, chart.valueFormat, chart.unit, true)}
              </text>
            </g>
          );
        })}

        {/* Línea objetivo / umbral si existe */}
        {chart.targetValue !== undefined && (
          <g>
            <line
              x1={padL}
              y1={yOf(chart.targetValue)}
              x2={W - padR}
              y2={yOf(chart.targetValue)}
              stroke="rgba(251, 191, 36, 0.72)"
              strokeWidth={1.25}
              strokeDasharray="5 4"
            />
            <text
              x={W - padR - 4}
              y={yOf(chart.targetValue) - 5}
              textAnchor="end"
              fill="#fde68a"
              fontSize="9.5"
              fontWeight="600"
            >
              {chart.targetLabel ||
                `Meta: ${formatMetricValue(chart.targetValue, chart.valueFormat, chart.unit, true)}`}
            </text>
          </g>
        )}

        {/* Barras verticales agrupadas */}
        {activeType === "bar" &&
          chart.categories.map((cat, cIdx) => {
            const groupW = Math.min(48, slotW * 0.72);
            const barW = Math.max(6, groupW / chart.series.length - (chart.series.length > 1 ? 2 : 0));
            const groupStart = padL + cIdx * slotW + (slotW - groupW) / 2;
            const zeroY = yOf(0);
            const isActive = focusIdx === cIdx;
            const isDim = focusIdx !== null && !isActive;

            return (
              <g
                key={`bar-cat-${cIdx}`}
                onMouseEnter={() => setHoveredIdx(cIdx)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => setSelectedIdx((curr) => (curr === cIdx ? null : cIdx))}
                style={{ cursor: "pointer", opacity: isDim ? 0.45 : 1, transition: "opacity 140ms ease" }}
              >
                {/* Hitbox invisible de toda la columna */}
                <rect
                  x={padL + cIdx * slotW}
                  y={padT}
                  width={slotW}
                  height={plotH}
                  fill="transparent"
                />
                {chart.series.map((s, sIdx) => {
                  const val = s.values[cIdx] ?? 0;
                  const valY = yOf(val);
                  const barTop = Math.min(valY, zeroY);
                  const barH = Math.max(2, Math.abs(zeroY - valY));
                  const bx = groupStart + sIdx * (barW + (chart.series.length > 1 ? 2 : 0));
                  const color = resolveSeriesColor(s, sIdx);
                  return (
                    <rect
                      key={`${s.id}-${cIdx}`}
                      x={bx}
                      y={barTop}
                      width={barW}
                      height={barH}
                      rx={4}
                      fill={color}
                      fillOpacity={isActive ? 0.96 : 0.78}
                    />
                  );
                })}
                <text
                  x={padL + cIdx * slotW + slotW / 2}
                  y={H - padB + 15}
                  textAnchor={chart.categories.length > 7 ? "end" : "middle"}
                  transform={
                    chart.categories.length > 7
                      ? `rotate(-26 ${padL + cIdx * slotW + slotW / 2} ${H - padB + 15})`
                      : undefined
                  }
                  fill={isActive ? "#ffffff" : "#a1a1aa"}
                  fontSize="10"
                >
                  {cat.length > 13 ? `${cat.slice(0, 12)}…` : cat}
                </text>
              </g>
            );
          })}

        {/* Línea / Área */}
        {(activeType === "line" || activeType === "area") && (
          <>
            {focusIdx !== null && (
              <line
                x1={padL + focusIdx * slotW + slotW / 2}
                y1={padT}
                x2={padL + focusIdx * slotW + slotW / 2}
                y2={padT + plotH}
                stroke="rgba(255,255,255,0.22)"
                strokeDasharray="3 3"
              />
            )}

            {chart.series.map((s, sIdx) => {
              const pts = chart.categories.map((_, cIdx) => ({
                x: padL + cIdx * slotW + slotW / 2,
                y: yOf(s.values[cIdx] ?? 0),
              }));
              const linePath = pts
                .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
                .join(" ");
              const baseZeroY = yOf(Math.max(yMin, 0));
              const areaPath =
                pts.length > 0
                  ? `${linePath} L ${pts[pts.length - 1].x} ${baseZeroY} L ${pts[0].x} ${baseZeroY} Z`
                  : "";
              const col = resolveSeriesColor(s, sIdx);

              return (
                <g key={`line-${s.id}`}>
                  {activeType === "area" && areaPath && (
                    <path d={areaPath} fill={`url(#area_grad_${uid}_${sIdx})`} />
                  )}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={col}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {pts.map((p, cIdx) => {
                    const isAct = focusIdx === cIdx;
                    return (
                      <circle
                        key={`${s.id}-pt-${cIdx}`}
                        cx={p.x}
                        cy={p.y}
                        r={isAct ? 4.5 : 2.8}
                        fill={isAct ? "#ffffff" : col}
                        stroke="#090a0e"
                        strokeWidth={1.5}
                      />
                    );
                  })}
                </g>
              );
            })}

            {chart.categories.map((cat, cIdx) => {
              const cx = padL + cIdx * slotW + slotW / 2;
              const isAct = focusIdx === cIdx;
              return (
                <g
                  key={`hit-${cIdx}`}
                  onMouseEnter={() => setHoveredIdx(cIdx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={() => setSelectedIdx((curr) => (curr === cIdx ? null : cIdx))}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={padL + cIdx * slotW}
                    y={padT}
                    width={slotW}
                    height={plotH}
                    fill="transparent"
                  />
                  <text
                    x={cx}
                    y={H - padB + 15}
                    textAnchor={chart.categories.length > 7 ? "end" : "middle"}
                    transform={
                      chart.categories.length > 7
                        ? `rotate(-26 ${cx} ${H - padB + 15})`
                        : undefined
                    }
                    fill={isAct ? "#ffffff" : "#a1a1aa"}
                    fontSize="10"
                  >
                    {cat.length > 13 ? `${cat.slice(0, 12)}…` : cat}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>
    );
  };

  const renderHorizontalBarSvg = () => {
    const primary = chart.series[0];
    const vals = primary?.values ?? [];
    const maxVal = Math.max(1, ...vals, chart.targetValue ?? 0);
    const rowH = 30;
    const W = 520;
    const padL = 132;
    const padR = 76;
    const padT = 12;
    const padB = 14;
    const plotW = W - padL - padR;
    const H = Math.max(120, padT + padB + chart.categories.length * rowH);
    const color = resolveSeriesColor(primary, 0);

    return (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none overflow-visible"
        role="img"
        aria-label={chart.title}
      >
        {chart.categories.map((cat, idx) => {
          const val = Math.max(0, vals[idx] ?? 0);
          const barW = Math.max(3, (val / maxVal) * plotW);
          const y = padT + idx * rowH;
          const isAct = focusIdx === idx;
          const isDim = focusIdx !== null && !isAct;
          return (
            <g
              key={`hbar-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => setSelectedIdx((curr) => (curr === idx ? null : idx))}
              style={{ cursor: "pointer", opacity: isDim ? 0.45 : 1, transition: "opacity 140ms ease" }}
            >
              <text
                x={padL - 10}
                y={y + 15}
                textAnchor="end"
                fill={isAct ? "#ffffff" : "#d4d4d8"}
                fontSize="10.8"
                fontWeight={isAct ? "600" : "400"}
              >
                {cat.length > 18 ? `${cat.slice(0, 17)}…` : cat}
              </text>
              <rect
                x={padL}
                y={y + 5}
                width={plotW}
                height={14}
                rx={7}
                fill="rgba(255,255,255,0.04)"
              />
              <rect
                x={padL}
                y={y + 5}
                width={barW}
                height={14}
                rx={7}
                fill={color}
                fillOpacity={isAct ? 0.96 : 0.78}
              />
              <text
                x={padL + plotW + 8}
                y={y + 15}
                textAnchor="start"
                fill={isAct ? "#ffffff" : "#a1a1aa"}
                fontSize="10.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatMetricValue(val, chart.valueFormat, chart.unit, true)}
              </text>
            </g>
          );
        })}

        {chart.targetValue !== undefined && chart.targetValue > 0 && (
          <g>
            <line
              x1={padL + Math.min(1, chart.targetValue / maxVal) * plotW}
              y1={padT}
              x2={padL + Math.min(1, chart.targetValue / maxVal) * plotW}
              y2={H - padB}
              stroke="rgba(251, 191, 36, 0.78)"
              strokeWidth={1.3}
              strokeDasharray="4 4"
            />
          </g>
        )}
      </svg>
    );
  };

  const renderDonutView = () => {
    const primary = chart.series[0];
    const rawVals = primary?.values.map((v) => Math.max(0, v)) ?? [];
    const total = rawVals.reduce((sum, v) => sum + v, 0) || 1;
    const cx = 100;
    const cy = 100;
    const outerR = 82;
    const innerR = 52;

    let cursorAngle = 0;
    const slices = chart.categories.map((cat, idx) => {
      const val = rawVals[idx] ?? 0;
      const pct = (val / total) * 100;
      const sweep = (val / total) * 360;
      const start = cursorAngle;
      const end = cursorAngle + sweep;
      cursorAngle = end;
      return {
        idx,
        cat,
        val,
        pct,
        start,
        end,
        color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
      };
    });

    const activeSlice = focusIdx !== null ? slices[focusIdx] ?? null : null;
    const positiveSlices = slices.filter((s) => s.val > 0);

    return (
      <div className="flex flex-col sm:flex-row items-center gap-4 pt-1">
        <div className="w-[180px] h-[180px] shrink-0">
          <svg
            ref={svgRef}
            viewBox="0 0 200 200"
            className="w-full h-full select-none"
            role="img"
            aria-label={chart.title}
          >
            {positiveSlices.length === 1 ? (
              <circle
                cx={cx}
                cy={cy}
                r={(outerR + innerR) / 2}
                fill="none"
                stroke={positiveSlices[0].color}
                strokeWidth={outerR - innerR}
                onClick={() =>
                  setSelectedIdx((curr) =>
                    curr === positiveSlices[0].idx ? null : positiveSlices[0].idx
                  )
                }
                style={{ cursor: "pointer" }}
              />
            ) : (
              slices.map((sl) => {
                if (sl.val <= 0) return null;
                const isAct = focusIdx === sl.idx;
                const isDim = focusIdx !== null && !isAct;
                return (
                  <path
                    key={`sl-${sl.idx}`}
                    d={describeDonutArc(
                      cx,
                      cy,
                      isAct ? outerR + 3 : outerR,
                      innerR,
                      sl.start,
                      sl.end - 0.8
                    )}
                    fill={sl.color}
                    fillOpacity={isDim ? 0.35 : 0.88}
                    onMouseEnter={() => setHoveredIdx(sl.idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onClick={() => setSelectedIdx((curr) => (curr === sl.idx ? null : sl.idx))}
                    style={{ cursor: "pointer", transition: "opacity 140ms ease" }}
                  />
                );
              })
            )}

            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="14.5"
              fontWeight="700"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {activeSlice
                ? `${activeSlice.pct.toFixed(1)}%`
                : formatMetricValue(total, chart.valueFormat, chart.unit, true)}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              fill="#a1a1aa"
              fontSize="9.8"
            >
              {activeSlice
                ? activeSlice.cat.length > 15
                  ? `${activeSlice.cat.slice(0, 14)}…`
                  : activeSlice.cat
                : "Total"}
            </text>
          </svg>
        </div>

        <div className="flex-1 w-full min-w-0 space-y-1.5 max-h-[190px] overflow-auto xook-scroll pr-1">
          {slices.map((sl) => {
            const isAct = focusIdx === sl.idx;
            return (
              <button
                key={`leg-${sl.idx}`}
                type="button"
                onMouseEnter={() => setHoveredIdx(sl.idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => setSelectedIdx((curr) => (curr === sl.idx ? null : sl.idx))}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-left text-[11px] transition-colors cursor-pointer ${
                  isAct ? "bg-white/[0.08] text-white" : "hover:bg-white/[0.04] text-zinc-300"
                }`}
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: sl.color }}
                  />
                  <span className="truncate">{sl.cat}</span>
                </span>
                <span className="font-mono tabular-nums text-zinc-200 shrink-0">
                  {formatMetricValue(sl.val, chart.valueFormat, chart.unit, true)}{" "}
                  <span className="text-zinc-500">({sl.pct.toFixed(0)}%)</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c0d13] p-3.5 space-y-2.5">
      {/* Cabecera de la Gráfica */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-semibold text-white leading-snug">
            {chart.title}
          </h4>
          {chart.subtitle && (
            <p className="text-[10.5px] text-zinc-400 mt-0.5">{chart.subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="inline-flex items-center rounded-lg bg-white/[0.03] border border-white/[0.08] p-0.5">
            {(
              [
                { id: "bar", label: "Barras" },
                { id: "horizontal_bar", label: "Horiz." },
                { id: "line", label: "Línea" },
                { id: "area", label: "Área" },
                ...(chart.series.length === 1 ? [{ id: "donut", label: "Dona" }] : []),
              ] as Array<{ id: CanvasChartType; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setActiveType(opt.id)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${
                  activeType === opt.id
                    ? "bg-white/[0.12] text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleDownloadSvg}
            title="Descargar gráfica como SVG"
            aria-label="Descargar gráfica como SVG"
            className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.07] cursor-pointer transition-colors"
          >
            <Download className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Leyenda multi-serie + lectura rápida al pasar el cursor */}
      <div className="flex flex-wrap items-center justify-between gap-2 min-h-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          {activeType !== "donut" &&
            chart.series.map((s, sIdx) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 text-[10.5px] text-zinc-300"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: resolveSeriesColor(s, sIdx) }}
                />
                <span>{s.name}</span>
              </span>
            ))}
        </div>

        {focusIdx !== null && chart.categories[focusIdx] && (
          <div className="inline-flex flex-wrap items-center gap-2 text-[10.5px] px-2 py-0.5 rounded-lg bg-white/[0.05] border border-white/[0.1] text-zinc-100">
            <span className="font-medium">{chart.categories[focusIdx]}:</span>
            {chart.series.map((s) => (
              <span key={s.id} className="font-mono tabular-nums text-zinc-200">
                {chart.series.length > 1 ? `${s.name} ` : ""}
                {formatMetricValue(s.values[focusIdx] ?? 0, chart.valueFormat, chart.unit)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Gráfica SVG */}
      {activeType === "donut"
        ? renderDonutView()
        : activeType === "horizontal_bar"
          ? renderHorizontalBarSvg()
          : renderCartesianSvg()}

      {/* Barra contextual cuando hay un elemento seleccionado */}
      {selectedCategory && (
        <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-300">
            Seleccionado: <strong className="text-white">{selectedCategory}</strong>
          </span>
          <div className="flex items-center gap-1.5">
            {hasBackingTable && onFilterTable && (
              <button
                type="button"
                onClick={() => onFilterTable(selectedCategory)}
                className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-medium text-zinc-100 hover:text-white cursor-pointer"
              >
                <Filter className="w-3 h-3" />
                <span>Filtrar tabla</span>
              </button>
            )}
            {onAskItem && (
              <button
                type="button"
                onClick={() =>
                  onAskItem(
                    selectedCategory,
                    chart.series
                      .map(
                        (s) =>
                          `${s.name}: ${formatMetricValue(
                            s.values[selectedIdx!] ?? 0,
                            chart.valueFormat,
                            chart.unit
                          )}`
                      )
                      .join(", ")
                  )
                }
                className="quick-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-medium text-white cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>Preguntar a Xox</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIdx(null)}
              aria-label="Limpiar selección"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const DashboardCanvasView: React.FC<DashboardCanvasViewProps> = ({
  dashboard,
  expanded = false,
  hasBackingTable = false,
  onFilterTable,
  onAskItem,
  tableSection,
}) => {
  return (
    <div className="space-y-3.5 pt-3">
      {/* Tira de KPIs ejecutivos */}
      {dashboard.kpis.length > 0 && (
        <div
          className={`grid gap-2.5 ${
            expanded ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"
          }`}
        >
          {dashboard.kpis.map((kpi: CanvasKpiItem) => (
            <div
              key={kpi.id}
              className={`rounded-xl border p-3 space-y-1.5 transition-colors ${getKpiToneClasses(
                kpi.tone
              )}`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[10.5px] font-medium text-zinc-400 truncate">
                  {kpi.label}
                </span>
                {kpi.delta && (
                  <span
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-mono font-medium shrink-0 ${
                      kpi.deltaTone === "positive"
                        ? "bg-emerald-500/15 text-emerald-200"
                        : kpi.deltaTone === "negative"
                          ? "bg-rose-500/15 text-rose-200"
                          : "bg-white/[0.07] text-zinc-300"
                    }`}
                  >
                    {kpi.deltaTone === "positive" && <TrendingUp className="w-2.5 h-2.5" />}
                    {kpi.deltaTone === "negative" && <TrendingDown className="w-2.5 h-2.5" />}
                    <span>{kpi.delta}</span>
                  </span>
                )}
              </div>

              <div className="text-[18px] font-semibold tracking-[-0.02em] text-white font-mono tabular-nums leading-tight">
                {kpi.value}
              </div>

              {kpi.progress !== undefined && (
                <div className="w-full h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      kpi.tone === "critical"
                        ? "bg-rose-400"
                        : kpi.tone === "warning"
                          ? "bg-amber-400"
                          : kpi.tone === "positive"
                            ? "bg-emerald-400"
                            : "bg-zinc-200"
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, kpi.progress))}%` }}
                  />
                </div>
              )}

              {kpi.caption && (
                <p className="text-[10px] text-zinc-400 leading-snug truncate">
                  {kpi.caption}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gráficas interactivas */}
      {dashboard.charts.length > 0 && (
        <div
          className={`grid gap-3 ${
            expanded && dashboard.charts.length > 1 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
          }`}
        >
          {dashboard.charts.map((chart) => (
            <ChartCard
              key={chart.id}
              chart={chart}
              hasBackingTable={hasBackingTable}
              onFilterTable={onFilterTable}
              onAskItem={onAskItem}
            />
          ))}
        </div>
      )}

      {/* Hallazgos clave / Recomendaciones para decidir */}
      {dashboard.insights && dashboard.insights.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-0.5">
            <BarChart3 className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-zinc-400">
              Hallazgos y Decisiones
            </span>
          </div>
          <div className="grid gap-2 grid-cols-1">
            {dashboard.insights.map((ins, idx) => {
              const meta = getInsightMeta(ins.tone);
              const Icon = meta.Icon;
              return (
                <div
                  key={`ins-${idx}`}
                  className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 text-[12px] ${meta.cls}`}
                >
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${meta.iconCls}`} />
                  <div className="min-w-0 space-y-0.5">
                    {ins.title && (
                      <p className="font-semibold text-white text-[12px]">{ins.title}</p>
                    )}
                    <p className="leading-relaxed select-text opacity-95">{ins.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla de respaldo (filtrable desde las gráficas) */}
      {tableSection}
    </div>
  );
};
