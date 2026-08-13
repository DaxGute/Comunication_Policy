import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { RunSummary } from "./centerAdapter";
import { formatMetricValue } from "./centerAdapter";
import { axisMetricDef, axisMetricLabel } from "./axisMetrics";

type Props = {
  runs: RunSummary[];
  xMetric: string;
  yMetric: string;
  zMetric?: string;
  selectedId?: string;
  onSelect: (runId: string) => void;
};

type PlotPoint = {
  run: RunSummary;
  x: number;
  y: number;
  z: number | null;
  xSd: number | null;
  ySd: number | null;
  zSd: number | null;
};

type Vec3 = { x: number; y: number; z: number };
type Proj = { x: number; y: number; depth: number; scale: number };

const CUBE = 0.5;
const FOCAL = 2.55;
const PLOT_SCALE = 158;
const W3 = 560;
const H3 = 400;
const DEFAULT_YAW = 0.72;
const DEFAULT_PITCH = -0.42;
const HIT_R = 14;
const DRAG_SELECT_SLOP = 6;

function runIdFromTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  return (
    target.closest("[data-run-id]")?.getAttribute("data-run-id") ?? undefined
  );
}

function readSd(
  run: RunSummary,
  metricId: string | undefined,
): number | null {
  if (!metricId) return null;
  const v = run.metricSds[metricId];
  return typeof v === "number" && v > 0 ? v : null;
}

function collectPoints(
  runs: RunSummary[],
  xMetric: string,
  yMetric: string,
  zMetric?: string,
): PlotPoint[] {
  return runs
    .map((run) => {
      const x = run.metrics[xMetric];
      const y = run.metrics[yMetric];
      if (typeof x !== "number" || typeof y !== "number") return null;
      const z = zMetric ? run.metrics[zMetric] : undefined;
      return {
        run,
        x,
        y,
        z: typeof z === "number" ? z : null,
        xSd: readSd(run, xMetric),
        ySd: readSd(run, yMetric),
        zSd: readSd(run, zMetric),
      };
    })
    .filter((p): p is PlotPoint => p !== null);
}

function dataExtent(
  pairs: Array<{ v: number; sd: number | null }>,
): [number, number] {
  const lows = pairs.map((p) => p.v - (p.sd ?? 0));
  const highs = pairs.map((p) => p.v + (p.sd ?? 0));
  return [Math.min(...lows), Math.max(...highs)];
}

function niceStep(span: number, target: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target - 1);
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const err = raw / base;
  const mult = err <= 1.5 ? 1 : err <= 3 ? 2 : err <= 7 ? 5 : 10;
  return mult * base;
}

function snap(value: number): number {
  return Number(value.toPrecision(12));
}

function niceDomain(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1 || 1;
    return niceDomain(min - pad, max + pad);
  }
  const step = niceStep(max - min, 5);
  const niceMin = snap(Math.floor(min / step) * step);
  const niceMax = snap(Math.ceil(max / step) * step);
  return [niceMin, niceMax === niceMin ? snap(niceMin + step) : niceMax];
}

function axisDomain(
  id: string,
  pairs: Array<{ v: number; sd: number | null }>,
): [number, number] {
  const format = axisMetricDef(id)?.format;
  if (format === "pct" || format === "score01" || format === "hhi") {
    return [0, 1];
  }
  if (format === "score5") return [0, 5];
  const [rawMin, rawMax] = dataExtent(pairs);
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return [0, 1];
  let min = rawMin;
  let max = rawMax;
  if ((format === "count" || format === "duration") && min >= 0) min = 0;
  return niceDomain(min, max);
}

function axisTicks(id: string, min: number, max: number): number[] {
  const format = axisMetricDef(id)?.format;
  if (format === "pct" || format === "score01" || format === "hhi") {
    return [0, 0.25, 0.5, 0.75, 1];
  }
  if (format === "score5") return [0, 1, 2, 3, 4, 5];
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  let step = niceStep(span, 5);
  if (format === "count" && step < 1) step = 1;
  const ticks: number[] = [];
  const start = snap(Math.ceil((min - step * 1e-9) / step) * step);
  for (let v = start; v <= max + step * 1e-9; v = snap(v + step)) {
    if (v >= min - step * 1e-9 && v <= max + step * 1e-9) ticks.push(v);
  }
  return ticks.length > 0 ? ticks : [min, max];
}

function cubeSd(sd: number | null, min: number, max: number): number {
  if (sd === null || max === min) return 0;
  return (sd / (max - min)) * 2 * CUBE;
}

type ScreenEllipse = {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angleDeg: number;
};

type ScreenBar = {
  kind: "bar";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const RING_STEPS = 40;

function ellipseRing(
  center: Vec3,
  sx: number,
  sy: number,
  sz: number,
  plane: "xy" | "xz" | "yz",
): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= RING_STEPS; i++) {
    const t = (i / RING_STEPS) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    if (plane === "xy") {
      pts.push({ x: center.x + sx * c, y: center.y + sy * s, z: center.z });
    } else if (plane === "xz") {
      pts.push({ x: center.x + sx * c, y: center.y, z: center.z + sz * s });
    } else {
      pts.push({ x: center.x, y: center.y + sy * c, z: center.z + sz * s });
    }
  }
  return pts;
}

function ringToPoints(
  ring: Vec3[],
  yaw: number,
  pitch: number,
): string {
  return ring
    .map((p) => {
      const s = project(p, yaw, pitch);
      return `${s.x},${s.y}`;
    })
    .join(" ");
}

type Unc3 = {
  bars: ScreenBar[];
  rings: string[];
  silhouette: ScreenEllipse | null;
};

function uncertainty3d(
  center: Vec3,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  pitch: number,
): Unc3 {
  const dims = [sx, sy, sz].filter((v) => v > 1e-8).length;
  const empty: Unc3 = { bars: [], rings: [], silhouette: null };
  if (dims === 0) return empty;
  if (dims === 1) {
    const a = project(
      { x: center.x - sx, y: center.y - sy, z: center.z - sz },
      yaw,
      pitch,
    );
    const b = project(
      { x: center.x + sx, y: center.y + sy, z: center.z + sz },
      yaw,
      pitch,
    );
    return {
      bars: [{ kind: "bar", x1: a.x, y1: a.y, x2: b.x, y2: b.y }],
      rings: [],
      silhouette: null,
    };
  }
  const rings: string[] = [];
  if (sx > 1e-8 && sy > 1e-8) {
    rings.push(
      ringToPoints(ellipseRing(center, sx, sy, sz, "xy"), yaw, pitch),
    );
  }
  if (sx > 1e-8 && sz > 1e-8) {
    rings.push(
      ringToPoints(ellipseRing(center, sx, sy, sz, "xz"), yaw, pitch),
    );
  }
  if (sy > 1e-8 && sz > 1e-8) {
    rings.push(
      ringToPoints(ellipseRing(center, sx, sy, sz, "yz"), yaw, pitch),
    );
  }
  const silhouette =
    dims === 3 ? projectedUncertainty(center, sx, sy, sz, yaw, pitch) : null;
  return {
    bars: [],
    rings,
    silhouette: silhouette?.kind === "ellipse" ? silhouette : null,
  };
}

function projectedUncertainty(
  center: Vec3,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  pitch: number,
): ScreenEllipse | ScreenBar | null {
  const dims = [sx, sy, sz].filter((v) => v > 1e-8).length;
  if (dims === 0) return null;
  if (dims === 1) {
    const a = project(
      { x: center.x - sx, y: center.y - sy, z: center.z - sz },
      yaw,
      pitch,
    );
    const b = project(
      { x: center.x + sx, y: center.y + sy, z: center.z + sz },
      yaw,
      pitch,
    );
    return { kind: "bar", x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  const s0 = project(center, yaw, pitch);
  const eps = 1e-4;
  const jx = project({ ...center, x: center.x + eps }, yaw, pitch);
  const jy = project({ ...center, y: center.y + eps }, yaw, pitch);
  const jz = project({ ...center, z: center.z + eps }, yaw, pitch);
  const m00 = ((jx.x - s0.x) / eps) * sx;
  const m01 = ((jy.x - s0.x) / eps) * sy;
  const m02 = ((jz.x - s0.x) / eps) * sz;
  const m10 = ((jx.y - s0.y) / eps) * sx;
  const m11 = ((jy.y - s0.y) / eps) * sy;
  const m12 = ((jz.y - s0.y) / eps) * sz;
  const a = m00 * m00 + m01 * m01 + m02 * m02;
  const b = m00 * m10 + m01 * m11 + m02 * m12;
  const c = m10 * m10 + m11 * m11 + m12 * m12;
  const trace = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const l1 = Math.max(0, (trace + disc) / 2);
  const l2 = Math.max(0, (trace - disc) / 2);
  const rx = Math.sqrt(l1);
  const ry = Math.sqrt(l2);
  if (rx < 0.6) return null;
  const angleDeg = (Math.atan2(2 * b, a - c) * 90) / Math.PI;
  return {
    kind: "ellipse",
    cx: s0.x,
    cy: s0.y,
    rx,
    ry: Math.max(ry, 0.5),
    angleDeg,
  };
}

function sdTitle(
  xMetric: string,
  yMetric: string,
  zMetric: string | undefined,
  p: PlotPoint,
): string {
  const bits: string[] = [];
  if (p.xSd !== null) bits.push(`X SD ${sdLabel(xMetric, p.xSd)}`);
  if (p.ySd !== null) bits.push(`Y SD ${sdLabel(yMetric, p.ySd)}`);
  if (zMetric && p.zSd !== null) bits.push(`Z SD ${sdLabel(zMetric, p.zSd)}`);
  return bits.length > 0 ? `\n${bits.join(" · ")}` : "";
}

function toCube(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((value - min) / (max - min)) * 2 * CUBE - CUBE;
}

function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: x1,
    y: p.y * cp - z1 * sp,
    z: p.y * sp + z1 * cp,
  };
}

function project(p: Vec3, yaw: number, pitch: number): Proj {
  const r = rotate(p, yaw, pitch);
  const d = FOCAL / (FOCAL - r.z);
  return {
    x: W3 / 2 + r.x * d * PLOT_SCALE,
    y: H3 / 2 - r.y * d * PLOT_SCALE,
    depth: r.z,
    scale: d,
  };
}

function sdLabel(metricId: string, sd: number): string {
  const format = axisMetricDef(metricId)?.format;
  if (format === "score5" || format === "score01" || format === "hhi") {
    return sd.toFixed(2);
  }
  return formatMetricValue(metricId, sd);
}

export function RunScatterPlot({
  runs,
  xMetric,
  yMetric,
  zMetric,
  selectedId,
  onSelect,
}: Props) {
  const xLabel = axisMetricLabel(xMetric);
  const yLabel = axisMetricLabel(yMetric);
  const zLabel = zMetric ? axisMetricLabel(zMetric) : undefined;
  const points = useMemo(
    () => collectPoints(runs, xMetric, yMetric, zMetric),
    [runs, xMetric, yMetric, zMetric],
  );

  if (points.length === 0) {
    return (
      <div className="center-scatter center-scatter--empty muted">
        No numeric values available for {xLabel} × {yLabel}
        {zLabel ? ` × ${zLabel}` : ""}.
      </div>
    );
  }

  if (zMetric && zLabel) {
    return (
      <Scatter3D
        points={points}
        xMetric={xMetric}
        yMetric={yMetric}
        zMetric={zMetric}
        xLabel={xLabel}
        yLabel={yLabel}
        zLabel={zLabel}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    );
  }

  return (
    <Scatter2D
      points={points}
      xMetric={xMetric}
      yMetric={yMetric}
      xLabel={xLabel}
      yLabel={yLabel}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}

function Scatter2D({
  points,
  xMetric,
  yMetric,
  xLabel,
  yLabel,
  selectedId,
  onSelect,
}: {
  points: PlotPoint[];
  xMetric: string;
  yMetric: string;
  xLabel: string;
  yLabel: string;
  selectedId?: string;
  onSelect: (runId: string) => void;
}) {
  const [minX, maxX] = axisDomain(
    xMetric,
    points.map((p) => ({ v: p.x, sd: p.xSd })),
  );
  const [minY, maxY] = axisDomain(
    yMetric,
    points.map((p) => ({ v: p.y, sd: p.ySd })),
  );
  const ticksX = axisTicks(xMetric, minX, maxX);
  const ticksY = axisTicks(yMetric, minY, maxY);

  const w = 520;
  const h = 320;
  const padL = 76;
  const padR = 24;
  const padT = 24;
  const padB = 52;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const sx = (v: number) => padL + ((v - minX) / (maxX - minX)) * plotW;
  const sy = (v: number) => padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

  return (
    <div className="center-scatter">
      <svg
        className="center-scatter__svg"
        viewBox={`0 0 ${w} ${h}`}
        role="group"
        aria-label={`Scatterplot of runs: ${xLabel} vs ${yLabel}`}
      >
        {ticksX.map((v) => (
          <line
            key={`gx-${v}`}
            x1={sx(v)}
            y1={padT}
            x2={sx(v)}
            y2={padT + plotH}
            className="center-scatter__grid"
          />
        ))}
        {ticksY.map((v) => (
          <line
            key={`gy-${v}`}
            x1={padL}
            y1={sy(v)}
            x2={padL + plotW}
            y2={sy(v)}
            className="center-scatter__grid"
          />
        ))}
        <line
          x1={padL}
          y1={padT + plotH}
          x2={padL + plotW}
          y2={padT + plotH}
          className="center-scatter__axis"
        />
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={padT + plotH}
          className="center-scatter__axis"
        />
        {ticksX.map((v) => (
          <g key={`tx-${v}`}>
            <line
              x1={sx(v)}
              y1={padT + plotH}
              x2={sx(v)}
              y2={padT + plotH + 5}
              className="center-scatter__tick-mark"
            />
            <text
              x={sx(v)}
              y={padT + plotH + 17}
              textAnchor="middle"
              className="center-scatter__tick"
            >
              {formatMetricValue(xMetric, v)}
            </text>
          </g>
        ))}
        {ticksY.map((v) => (
          <g key={`ty-${v}`}>
            <line
              x1={padL}
              y1={sy(v)}
              x2={padL - 5}
              y2={sy(v)}
              className="center-scatter__tick-mark"
            />
            <text
              x={padL - 8}
              y={sy(v) + 3}
              textAnchor="end"
              className="center-scatter__tick"
            >
              {formatMetricValue(yMetric, v)}
            </text>
          </g>
        ))}
        <text
          x={padL + plotW / 2}
          y={h - 8}
          textAnchor="middle"
          className="center-scatter__axis-label"
        >
          {xLabel}
        </text>
        <text
          x={14}
          y={padT + plotH / 2}
          textAnchor="middle"
          className="center-scatter__axis-label"
          transform={`rotate(-90 14 ${padT + plotH / 2})`}
        >
          {yLabel}
        </text>

        {points.map((p) => {
          const selected = p.run.runId === selectedId;
          const cx = sx(p.x);
          const cy = sy(p.y);
          const cap = 4;
          const rx = p.xSd !== null ? Math.abs(sx(p.x + p.xSd) - cx) : 0;
          const ry = p.ySd !== null ? Math.abs(sy(p.y + p.ySd) - cy) : 0;
          const useEllipse = rx > 1.5 && ry > 1.5;
          const yTop = p.ySd !== null ? sy(p.y + p.ySd) : cy;
          const errClass = selected
            ? "center-scatter__error center-scatter__error--selected"
            : "center-scatter__error";
          const ellClass = selected
            ? "center-scatter__ellipse center-scatter__ellipse--selected"
            : "center-scatter__ellipse";
          return (
            <g
              key={p.run.runId}
              data-run-id={p.run.runId}
              className="center-scatter__mark"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(p.run.runId);
              }}
            >
              {useEllipse ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  className={ellClass}
                />
              ) : (
                <g className={errClass}>
                  {p.ySd !== null ? (
                    <>
                      <line x1={cx} y1={yTop} x2={cx} y2={sy(p.y - p.ySd)} />
                      <line
                        x1={cx - cap}
                        y1={yTop}
                        x2={cx + cap}
                        y2={yTop}
                      />
                      <line
                        x1={cx - cap}
                        y1={sy(p.y - p.ySd)}
                        x2={cx + cap}
                        y2={sy(p.y - p.ySd)}
                      />
                    </>
                  ) : null}
                  {p.xSd !== null ? (
                    <>
                      <line
                        x1={sx(p.x - p.xSd)}
                        y1={cy}
                        x2={sx(p.x + p.xSd)}
                        y2={cy}
                      />
                      <line
                        x1={sx(p.x - p.xSd)}
                        y1={cy - cap}
                        x2={sx(p.x - p.xSd)}
                        y2={cy + cap}
                      />
                      <line
                        x1={sx(p.x + p.xSd)}
                        y1={cy - cap}
                        x2={sx(p.x + p.xSd)}
                        y2={cy + cap}
                      />
                    </>
                  ) : null}
                </g>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={selected ? 7 : 5.5}
                className={
                  selected
                    ? "center-scatter__point center-scatter__point--selected"
                    : "center-scatter__point"
                }
              />
              <circle
                cx={cx}
                cy={cy}
                r={HIT_R}
                className="center-scatter__hit"
              >
                <title>
                  {p.run.title}
                  {"\n"}
                  {xLabel}: {formatMetricValue(xMetric, p.x)}
                  {"\n"}
                  {yLabel}: {formatMetricValue(yMetric, p.y)}
                  {sdTitle(xMetric, yMetric, undefined, p)}
                </title>
              </circle>
              <text
                x={cx}
                y={Math.min(cy, yTop) - (useEllipse ? ry : 0) - 10}
                textAnchor="middle"
                className="center-scatter__point-label"
              >
                {p.run.displayIndex}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="center-scatter__hint muted">
        Error bars / ellipses ±1 SD across problems · click to select
      </p>
    </div>
  );
}

const CUBE_EDGES: Array<[Vec3, Vec3, "floor" | "frame"]> = (() => {
  const s = CUBE;
  const floor: Vec3[] = [
    { x: -s, y: -s, z: -s },
    { x: s, y: -s, z: -s },
    { x: s, y: -s, z: s },
    { x: -s, y: -s, z: s },
  ];
  const ceil: Vec3[] = floor.map((p) => ({ ...p, y: s }));
  const edges: Array<[Vec3, Vec3, "floor" | "frame"]> = [
    [floor[0]!, floor[1]!, "floor"],
    [floor[1]!, floor[2]!, "floor"],
    [floor[2]!, floor[3]!, "floor"],
    [floor[3]!, floor[0]!, "floor"],
    [ceil[0]!, ceil[1]!, "frame"],
    [ceil[1]!, ceil[2]!, "frame"],
    [ceil[2]!, ceil[3]!, "frame"],
    [ceil[3]!, ceil[0]!, "frame"],
    [floor[0]!, ceil[0]!, "frame"],
    [floor[1]!, ceil[1]!, "frame"],
    [floor[2]!, ceil[2]!, "frame"],
    [floor[3]!, ceil[3]!, "frame"],
  ];
  return edges;
})();

function Scatter3D({
  points,
  xMetric,
  yMetric,
  zMetric,
  xLabel,
  yLabel,
  zLabel,
  selectedId,
  onSelect,
}: {
  points: PlotPoint[];
  xMetric: string;
  yMetric: string;
  zMetric: string;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  selectedId?: string;
  onSelect: (runId: string) => void;
}) {
  const [yaw, setYaw] = useState(DEFAULT_YAW);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const drag = useRef<{
    px: number;
    py: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const didDrag = useRef(false);
  const pendingSelect = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => document.body.classList.remove("is-rotating-plot");
  }, []);

  const [minX, maxX] = axisDomain(
    xMetric,
    points.map((p) => ({ v: p.x, sd: p.xSd })),
  );
  const [minY, maxY] = axisDomain(
    yMetric,
    points.map((p) => ({ v: p.y, sd: p.ySd })),
  );
  const zPairs = points
    .filter((p): p is PlotPoint & { z: number } => p.z !== null)
    .map((p) => ({ v: p.z, sd: p.zSd }));
  const [minZ, maxZ] = axisDomain(
    zMetric,
    zPairs.length > 0 ? zPairs : [{ v: 0, sd: null }],
  );
  const ticksX = axisTicks(xMetric, minX, maxX);
  const ticksY = axisTicks(yMetric, minY, maxY);
  const ticksZ = axisTicks(zMetric, minZ, maxZ);

  const proj = (p: Vec3) => project(p, yaw, pitch);

  const floorPoly = useMemo(() => {
    const s = CUBE;
    const corners = [
      { x: -s, y: -s, z: -s },
      { x: s, y: -s, z: -s },
      { x: s, y: -s, z: s },
      { x: -s, y: -s, z: s },
    ].map((p) => proj(p));
    return corners.map((p) => `${p.x},${p.y}`).join(" ");
    // proj closes over yaw/pitch
  }, [yaw, pitch]);

  const grid = useMemo(() => {
    const s = CUBE;
    const lines: Array<{ a: Proj; b: Proj }> = [];
    for (const v of ticksX) {
      const t = toCube(v, minX, maxX);
      lines.push({
        a: proj({ x: t, y: -s, z: -s }),
        b: proj({ x: t, y: -s, z: s }),
      });
    }
    for (const v of ticksZ) {
      const t = toCube(v, minZ, maxZ);
      lines.push({
        a: proj({ x: -s, y: -s, z: t }),
        b: proj({ x: s, y: -s, z: t }),
      });
    }
    return lines;
  }, [yaw, pitch, ticksX, ticksZ, minX, maxX, minZ, maxZ]);

  const axisMarkings = useMemo(() => {
    const s = CUBE;
    const tickLen = 0.05;
    const marks: Array<{ a: Proj; b: Proj }> = [];
    const labels: Array<{ p: { x: number; y: number }; text: string }> = [];
    const labelBeyond = (a: Proj, b: Proj) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: b.x + (dx / len) * 11, y: b.y + (dy / len) * 11 };
    };
    const add = (from: Vec3, to: Vec3, text: string) => {
      const a = proj(from);
      const b = proj(to);
      marks.push({ a, b });
      labels.push({ p: labelBeyond(a, b), text });
    };
    for (const v of ticksX) {
      const t = toCube(v, minX, maxX);
      add(
        { x: t, y: -s, z: -s },
        { x: t, y: -s, z: -s - tickLen },
        formatMetricValue(xMetric, v),
      );
    }
    for (const v of ticksY) {
      const t = toCube(v, minY, maxY);
      add(
        { x: -s, y: t, z: -s },
        { x: -s - tickLen, y: t, z: -s },
        formatMetricValue(yMetric, v),
      );
    }
    for (const v of ticksZ) {
      const t = toCube(v, minZ, maxZ);
      add(
        { x: -s, y: -s, z: t },
        { x: -s, y: -s - tickLen, z: t },
        formatMetricValue(zMetric, v),
      );
    }
    return { marks, labels };
  }, [
    yaw,
    pitch,
    ticksX,
    ticksY,
    ticksZ,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    xMetric,
    yMetric,
    zMetric,
  ]);

  const frame = useMemo(
    () =>
      CUBE_EDGES.map(([a, b, kind]) => ({
        a: proj(a),
        b: proj(b),
        kind,
        depth: (proj(a).depth + proj(b).depth) / 2,
      })).sort((p, q) => p.depth - q.depth),
    [yaw, pitch],
  );

  const axisTips = useMemo(() => {
    const s = CUBE;
    const origin = { x: -s, y: -s, z: -s };
    return {
      x: { from: proj(origin), to: proj({ x: s, y: -s, z: -s }) },
      y: { from: proj(origin), to: proj({ x: -s, y: s, z: -s }) },
      z: { from: proj(origin), to: proj({ x: -s, y: -s, z: s }) },
    };
  }, [yaw, pitch]);

  const plotted = useMemo(() => {
    return points
      .map((p) => {
        const z = p.z ?? (minZ + maxZ) / 2;
        const world: Vec3 = {
          x: toCube(p.x, minX, maxX),
          y: toCube(p.y, minY, maxY),
          z: toCube(z, minZ, maxZ),
        };
        const floor: Vec3 = { ...world, y: -CUBE };
        const screen = proj(world);
        const floorPt = proj(floor);
        const unc = uncertainty3d(
          world,
          cubeSd(p.xSd, minX, maxX),
          cubeSd(p.ySd, minY, maxY),
          cubeSd(p.zSd, minZ, maxZ),
          yaw,
          pitch,
        );
        return { ...p, screen, floorPt, unc, missingZ: p.z === null };
      })
      .sort((a, b) => a.screen.depth - b.screen.depth);
  }, [points, minX, maxX, minY, maxY, minZ, maxZ, yaw, pitch]);

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingSelect.current = runIdFromTarget(e.target);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, yaw, pitch };
    didDrag.current = false;
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    if (!start) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    if (Math.hypot(dx, dy) <= DRAG_SELECT_SLOP) return;
    if (!didDrag.current) {
      didDrag.current = true;
      document.body.classList.add("is-rotating-plot");
      window.getSelection()?.removeAllRanges();
    }
    setYaw(start.yaw + dx * 0.008);
    setPitch(Math.max(-1.15, Math.min(0.18, start.pitch + dy * 0.008)));
  }

  function endRotate() {
    pendingSelect.current = undefined;
    drag.current = null;
    document.body.classList.remove("is-rotating-plot");
  }

  function onPointerUp() {
    const runId = pendingSelect.current;
    const dragged = didDrag.current;
    endRotate();
    if (!dragged && runId) onSelect(runId);
  }

  function labelPos(tip: Proj, from: Proj): { x: number; y: number } {
    const dx = tip.x - from.x;
    const dy = tip.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: tip.x + (dx / len) * 14, y: tip.y + (dy / len) * 14 };
  }

  const xTip = labelPos(axisTips.x.to, axisTips.x.from);
  const yTip = labelPos(axisTips.y.to, axisTips.y.from);
  const zTip = labelPos(axisTips.z.to, axisTips.z.from);

  return (
    <div className="center-scatter center-scatter--3d">
      <svg
        className="center-scatter__svg center-scatter__svg--3d"
        viewBox={`0 0 ${W3} ${H3}`}
        role="group"
        aria-label={`3D scatterplot of runs: ${xLabel}, ${yLabel}, ${zLabel}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endRotate}
        onSelectStart={(e) => e.preventDefault()}
      >
        <polygon
          points={floorPoly}
          className="center-scatter__floor"
        />
        {grid.map((line, i) => (
          <line
            key={`g${i}`}
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            className="center-scatter__grid"
          />
        ))}
        {frame.map((edge, i) => (
          <line
            key={`e${i}`}
            x1={edge.a.x}
            y1={edge.a.y}
            x2={edge.b.x}
            y2={edge.b.y}
            className={
              edge.kind === "floor"
                ? "center-scatter__cube center-scatter__cube--floor"
                : "center-scatter__cube"
            }
          />
        ))}
        <line
          x1={axisTips.x.from.x}
          y1={axisTips.x.from.y}
          x2={axisTips.x.to.x}
          y2={axisTips.x.to.y}
          className="center-scatter__axis3 center-scatter__axis3--x"
        />
        <line
          x1={axisTips.y.from.x}
          y1={axisTips.y.from.y}
          x2={axisTips.y.to.x}
          y2={axisTips.y.to.y}
          className="center-scatter__axis3 center-scatter__axis3--y"
        />
        <line
          x1={axisTips.z.from.x}
          y1={axisTips.z.from.y}
          x2={axisTips.z.to.x}
          y2={axisTips.z.to.y}
          className="center-scatter__axis3 center-scatter__axis3--z"
        />
        <text
          x={xTip.x}
          y={xTip.y}
          textAnchor="middle"
          className="center-scatter__axis-label"
        >
          {xLabel}
        </text>
        <text
          x={yTip.x}
          y={yTip.y}
          textAnchor="middle"
          className="center-scatter__axis-label"
        >
          {yLabel}
        </text>
        <text
          x={zTip.x}
          y={zTip.y}
          textAnchor="middle"
          className="center-scatter__axis-label"
        >
          {zLabel}
        </text>
        {axisMarkings.marks.map((mark, i) => (
          <line
            key={`tm${i}`}
            x1={mark.a.x}
            y1={mark.a.y}
            x2={mark.b.x}
            y2={mark.b.y}
            className="center-scatter__tick-mark"
          />
        ))}
        {axisMarkings.labels.map((label, i) => (
          <text
            key={`tl${i}`}
            x={label.p.x}
            y={label.p.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="center-scatter__tick"
          >
            {label.text}
          </text>
        ))}

        {plotted.map((p) => {
          const selected = p.run.runId === selectedId;
          const r = (selected ? 6.4 : 5) * (0.82 + 0.28 * p.screen.scale);
          return (
            <g
              key={p.run.runId}
              data-run-id={p.run.runId}
              className="center-scatter__mark"
            >
              <line
                x1={p.screen.x}
                y1={p.screen.y}
                x2={p.floorPt.x}
                y2={p.floorPt.y}
                className={
                  selected
                    ? "center-scatter__stem center-scatter__stem--selected"
                    : "center-scatter__stem"
                }
              />
              {p.unc.silhouette ? (
                <ellipse
                  cx={p.unc.silhouette.cx}
                  cy={p.unc.silhouette.cy}
                  rx={p.unc.silhouette.rx}
                  ry={p.unc.silhouette.ry}
                  transform={`rotate(${p.unc.silhouette.angleDeg} ${p.unc.silhouette.cx} ${p.unc.silhouette.cy})`}
                  className={
                    selected
                      ? "center-scatter__ellipse center-scatter__ellipse--selected"
                      : "center-scatter__ellipse"
                  }
                />
              ) : null}
              {p.unc.rings.map((pts, i) => (
                <polyline
                  key={`r${i}`}
                  points={pts}
                  className={
                    selected
                      ? "center-scatter__ellipsoid center-scatter__ellipsoid--selected"
                      : "center-scatter__ellipsoid"
                  }
                />
              ))}
              {p.unc.bars.map((bar, i) => (
                <line
                  key={`b${i}`}
                  x1={bar.x1}
                  y1={bar.y1}
                  x2={bar.x2}
                  y2={bar.y2}
                  className={
                    selected
                      ? "center-scatter__error center-scatter__error--selected"
                      : "center-scatter__error"
                  }
                />
              ))}
              <circle
                cx={p.screen.x}
                cy={p.screen.y}
                r={r}
                className={[
                  "center-scatter__point",
                  selected ? "center-scatter__point--selected" : "",
                  p.missingZ ? "center-scatter__point--missing-z" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
              <circle
                cx={p.screen.x}
                cy={p.screen.y}
                r={Math.max(HIT_R, r + 6)}
                className="center-scatter__hit"
              >
                <title>
                  {p.run.title}
                  {"\n"}
                  {xLabel}: {formatMetricValue(xMetric, p.x)}
                  {"\n"}
                  {yLabel}: {formatMetricValue(yMetric, p.y)}
                  {"\n"}
                  {zLabel}:{" "}
                  {p.z !== null ? formatMetricValue(zMetric, p.z) : "—"}
                  {sdTitle(xMetric, yMetric, zMetric, p)}
                </title>
              </circle>
              <text
                x={p.screen.x}
                y={p.screen.y - r - 5}
                textAnchor="middle"
                className="center-scatter__point-label"
              >
                {p.run.displayIndex}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="center-scatter__hint muted">
        Drag to rotate · stems drop to the {xLabel} × {zLabel} floor ·
        ellipsoids ±1 SD · click to select
      </p>
    </div>
  );
}
