/**
 * 2D scatter renderer with ±1 SD bars/ellipses.
 */
import { formatMetricValue } from "../runSummary";
import { ScatterBar } from "./ScatterBar";
import {
  HIT_R,
  axisDomain,
  axisTicks,
  sdTitle,
  type PlotPoint,
} from "./plotShared";

export function Scatter2D({
  points,
  xMetric,
  yMetric,
  xLabel,
  yLabel,
  selectedId,
  onSelect,
  status,
}: {
  points: PlotPoint[];
  xMetric: string;
  yMetric: string;
  xLabel: string;
  yLabel: string;
  selectedId?: string;
  onSelect: (runId: string) => void;
  status?: string;
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
      <ScatterBar
        legend="Error bars / ellipses ±1 SD across problems · click to select"
        status={status}
      />
    </div>
  );
}
