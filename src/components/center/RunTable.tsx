import type { RunMetricId, RunSummary } from "./centerAdapter";
import {
  formatMetricValue,
  RUN_METRIC_LABELS,
} from "./centerAdapter";

type Props = {
  runs: RunSummary[];
  metrics: RunMetricId[];
  selectedIds: string[];
  onSelect: (runId: string, additive: boolean) => void;
  onOpen: (runId: string) => void;
};

export function RunTable({
  runs,
  metrics,
  selectedIds,
  onSelect,
  onOpen,
}: Props) {
  const cols = metrics.slice(0, 8);

  return (
    <div className="center-run-table-wrap">
      <table className="center-run-table">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            {cols.map((id) => (
              <th key={id}>{RUN_METRIC_LABELS[id]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const selected = selectedIds.includes(run.runId);
            return (
              <tr
                key={run.runId}
                className={selected ? "is-selected" : undefined}
                onClick={(e) =>
                  onSelect(run.runId, e.metaKey || e.ctrlKey || e.shiftKey)
                }
                onDoubleClick={() => onOpen(run.runId)}
              >
                <td className="mono">{run.title}</td>
                <td>
                  <span className={`center-status center-status--${run.status}`}>
                    {run.status}
                  </span>
                </td>
                {cols.map((id) => {
                  const v = run.metrics[id];
                  return (
                    <td key={id} className="mono">
                      {typeof v === "number" ? formatMetricValue(id, v) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
