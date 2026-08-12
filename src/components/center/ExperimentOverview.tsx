import { useMemo, useState } from "react";
import type { RunMetricId, RunSummary } from "./centerAdapter";
import {
  defaultScatterAxes,
  getAvailableRunMetrics,
  RUN_METRIC_LABELS,
} from "./centerAdapter";
import { RunCard } from "./RunCard";
import { RunScatterPlot } from "./RunScatterPlot";
import { RunTable } from "./RunTable";

type Props = {
  runs: RunSummary[];
  selectedIds: string[];
  onSelectRun: (runId: string, additive: boolean) => void;
  onOpenRun: (runId: string) => void;
  onCompare: () => void;
};

export function ExperimentOverview({
  runs,
  selectedIds,
  onSelectRun,
  onOpenRun,
  onCompare,
}: Props) {
  const metrics = useMemo(() => getAvailableRunMetrics(runs), [runs]);
  const defaults = useMemo(() => defaultScatterAxes(metrics), [metrics]);
  const [xMetric, setXMetric] = useState<RunMetricId>(defaults.x);
  const [yMetric, setYMetric] = useState<RunMetricId>(defaults.y);
  const [mode, setMode] = useState<"runs" | "table">("runs");

  const safeX = metrics.includes(xMetric) ? xMetric : defaults.x;
  const safeY = metrics.includes(yMetric) ? yMetric : defaults.y;

  return (
    <div className="center-experiment">
      <div className="center-toolbar">
        <div className="center-seg" role="group" aria-label="Overview mode">
          <button
            type="button"
            className={mode === "runs" ? "is-active" : undefined}
            onClick={() => setMode("runs")}
          >
            Runs
          </button>
          <button
            type="button"
            className={mode === "table" ? "is-active" : undefined}
            onClick={() => setMode("table")}
          >
            Table
          </button>
        </div>

        {mode === "runs" && metrics.length >= 2 ? (
          <div className="center-toolbar__metrics">
            <label>
              X
              <select
                value={safeX}
                onChange={(e) => setXMetric(e.target.value as RunMetricId)}
              >
                {metrics.map((id) => (
                  <option key={id} value={id}>
                    {RUN_METRIC_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Y
              <select
                value={safeY}
                onChange={(e) => setYMetric(e.target.value as RunMetricId)}
              >
                {metrics.map((id) => (
                  <option key={id} value={id}>
                    {RUN_METRIC_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {selectedIds.length === 2 ? (
          <button type="button" className="center-btn" onClick={onCompare}>
            Compare Runs
          </button>
        ) : (
          <span className="muted center-toolbar__hint">
            Select 2 runs to compare
          </span>
        )}
      </div>

      {mode === "runs" ? (
        <>
          <RunScatterPlot
            runs={runs}
            xMetric={safeX}
            yMetric={safeY}
            selectedIds={selectedIds}
            onSelect={onSelectRun}
            onOpen={onOpenRun}
          />
          <div className="center-run-cards">
            {[...runs].reverse().map((run) => (
              <RunCard
                key={run.runId}
                run={run}
                selected={selectedIds.includes(run.runId)}
                compareMarked={selectedIds.includes(run.runId)}
                onSelect={(additive) => onSelectRun(run.runId, additive)}
                onOpen={() => onOpenRun(run.runId)}
              />
            ))}
          </div>
        </>
      ) : (
        <RunTable
          runs={[...runs].reverse()}
          metrics={metrics}
          selectedIds={selectedIds}
          onSelect={onSelectRun}
          onOpen={onOpenRun}
        />
      )}
    </div>
  );
}
