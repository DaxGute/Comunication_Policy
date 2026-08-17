/**
 * 3D scatter renderer with orbit controls and projected uncertainty.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { formatMetricValue } from "../runSummary";
import { ScatterBar } from "./ScatterBar";
import {
  CUBE,
  DEFAULT_PITCH,
  DEFAULT_YAW,
  DRAG_SELECT_SLOP,
  H3,
  HIT_R,
  W3,
  axisDomain,
  axisTicks,
  cubeSd,
  project,
  runIdFromTarget,
  sdTitle,
  toCube,
  uncertainty3d,
  type PlotPoint,
  type Proj,
  type Vec3,
} from "./plotShared";

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

export function Scatter3D({
  points,
  xMetric,
  yMetric,
  zMetric,
  xLabel,
  yLabel,
  zLabel,
  selectedId,
  onSelect,
  status,
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
  status?: string;
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

  const proj = useCallback(
    (p: Vec3) => project(p, yaw, pitch),
    [yaw, pitch],
  );

  const floorPoly = useMemo(() => {
    const s = CUBE;
    const corners = [
      { x: -s, y: -s, z: -s },
      { x: s, y: -s, z: -s },
      { x: s, y: -s, z: s },
      { x: -s, y: -s, z: s },
    ].map((p) => proj(p));
    return corners.map((p) => `${p.x},${p.y}`).join(" ");
  }, [proj]);

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
  }, [proj, ticksX, ticksZ, minX, maxX, minZ, maxZ]);

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
    proj,
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
    [proj],
  );

  const axisTips = useMemo(() => {
    const s = CUBE;
    const origin = { x: -s, y: -s, z: -s };
    return {
      x: { from: proj(origin), to: proj({ x: s, y: -s, z: -s }) },
      y: { from: proj(origin), to: proj({ x: -s, y: s, z: -s }) },
      z: { from: proj(origin), to: proj({ x: -s, y: -s, z: s }) },
    };
  }, [proj]);

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
  }, [points, minX, maxX, minY, maxY, minZ, maxZ, yaw, pitch, proj]);

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
      <ScatterBar
        legend={`Drag to rotate · stems drop to the ${xLabel} × ${zLabel} floor · ellipsoids ±1 SD · click to select`}
        status={status}
      />
    </div>
  );
}
