/**
 * Shared scatter-plot geometry, domains, and uncertainty projection.
 *
 * 2D/3D renderers live in Scatter2D / Scatter3D; this module does not draw axes.
 */
import type { RunSummary } from "../runSummary";
import { formatMetricValue } from "../runSummary";
import { axisMetricDef } from "../axisMetrics";

export type PlotPoint = {
  run: RunSummary;
  x: number;
  y: number;
  z: number | null;
  xSd: number | null;
  ySd: number | null;
  zSd: number | null;
};

export type Vec3 = { x: number; y: number; z: number };
export type Proj = { x: number; y: number; depth: number; scale: number };

export const CUBE = 0.5;
export const FOCAL = 2.55;
export const PLOT_SCALE = 158;
export const W3 = 560;
export const H3 = 400;
export const DEFAULT_YAW = 0.72;
export const DEFAULT_PITCH = -0.42;
export const HIT_R = 14;
export const DRAG_SELECT_SLOP = 6;

export function runIdFromTarget(target: EventTarget | null): string | undefined {
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

export function collectPoints(
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

export function axisDomain(
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

export function axisTicks(id: string, min: number, max: number): number[] {
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

export function cubeSd(sd: number | null, min: number, max: number): number {
  if (sd === null || max === min) return 0;
  return (sd / (max - min)) * 2 * CUBE;
}

export type ScreenEllipse = {
  kind: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angleDeg: number;
};

export type ScreenBar = {
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

export function uncertainty3d(
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

export function sdTitle(
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

export function toCube(value: number, min: number, max: number): number {
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

export function project(p: Vec3, yaw: number, pitch: number): Proj {
  const r = rotate(p, yaw, pitch);
  const d = FOCAL / (FOCAL - r.z);
  return {
    x: W3 / 2 + r.x * d * PLOT_SCALE,
    y: H3 / 2 - r.y * d * PLOT_SCALE,
    depth: r.z,
    scale: d,
  };
}

export function sdLabel(metricId: string, sd: number): string {
  const format = axisMetricDef(metricId)?.format;
  if (format === "score5" || format === "score01" || format === "hhi") {
    return sd.toFixed(2);
  }
  return formatMetricValue(metricId, sd);
}
