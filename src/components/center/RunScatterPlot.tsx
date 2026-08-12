import type { RunMetricId, RunSummary } from "./centerAdapter";
import {
  formatMetricValue,
  RUN_METRIC_LABELS,
} from "./centerAdapter";

type Props = {
  runs: RunSummary[];
  xMetric: RunMetricId;
  yMetric: RunMetricId;
  selectedIds: string[];
  onSelect: (runId: string, additive: boolean) => void;
  onOpen: (runId: string) => void;
};

export function RunScatterPlot({
  runs,
  xMetric,
  yMetric,
  selectedIds,
  onSelect,
  onOpen,
}: Props) {
  const points = runs
    .map((run) => {
      const x = run.metrics[xMetric];
      const y = run.metrics[yMetric];
      if (typeof x !== "number" || typeof y !== "number") return null;
      return { run, x, y };
    })
    .filter((p): p is { run: RunSummary; x: number; y: number } => p !== null);

  if (points.length === 0) {
    return (
      <div className="center-scatter center-scatter--empty muted">
        No numeric values available for {RUN_METRIC_LABELS[xMetric]} ×{" "}
        {RUN_METRIC_LABELS[yMetric]}.
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  const pad = 28;
  const w = 420;
  const h = 260;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  const sx = (v: number) => pad + ((v - minX) / (maxX - minX)) * plotW;
  const sy = (v: number) => pad + plotH - ((v - minY) / (maxY - minY)) * plotH;

  return (
    <div className="center-scatter">
      <svg
        className="center-scatter__svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Scatterplot of runs: ${RUN_METRIC_LABELS[xMetric]} vs ${RUN_METRIC_LABELS[yMetric]}`}
      >
        <line
          x1={pad}
          y1={pad + plotH}
          x2={pad + plotW}
          y2={pad + plotH}
          className="center-scatter__axis"
        />
        <line
          x1={pad}
          y1={pad}
          x2={pad}
          y2={pad + plotH}
          className="center-scatter__axis"
        />
        <text x={pad + plotW / 2} y={h - 6} textAnchor="middle" className="center-scatter__axis-label">
          {RUN_METRIC_LABELS[xMetric]}
        </text>
        <text
          x={12}
          y={pad + plotH / 2}
          textAnchor="middle"
          className="center-scatter__axis-label"
          transform={`rotate(-90 12 ${pad + plotH / 2})`}
        >
          {RUN_METRIC_LABELS[yMetric]}
        </text>

        {points.map(({ run, x, y }) => {
          const selected = selectedIds.includes(run.runId);
          return (
            <g key={run.runId}>
              <circle
                cx={sx(x)}
                cy={sy(y)}
                r={selected ? 7 : 5.5}
                className={
                  selected
                    ? "center-scatter__point center-scatter__point--selected"
                    : "center-scatter__point"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(run.runId, e.metaKey || e.ctrlKey || e.shiftKey);
                }}
                onDoubleClick={() => onOpen(run.runId)}
              >
                <title>
                  {run.title}
                  {"\n"}
                  {RUN_METRIC_LABELS[xMetric]}: {formatMetricValue(xMetric, x)}
                  {"\n"}
                  {RUN_METRIC_LABELS[yMetric]}: {formatMetricValue(yMetric, y)}
                </title>
              </circle>
              <text
                x={sx(x)}
                y={sy(y) - 10}
                textAnchor="middle"
                className="center-scatter__point-label"
              >
                {run.displayIndex}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="center-scatter__hint muted">
        Click to select · ⌘/Ctrl-click for compare · double-click to open
      </p>
    </div>
  );
}
