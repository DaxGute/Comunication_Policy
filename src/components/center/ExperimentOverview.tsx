import { useMemo, useState } from "react";
import type { RunSummary } from "./centerAdapter";
import {
  defaultScatterAxes,
  getAvailableAxisGroups,
  isEvaluationMetric,
} from "./centerAdapter";
import {
  axisMetricDef,
  axisMetricLabel,
  type AxisMetricGroup,
} from "./axisMetrics";
import { ColumnMenu } from "./ColumnMenu";
import { RunScatterPlot } from "./RunScatterPlot";
import { RunTable } from "./RunTable";

type Props = {
  runs: RunSummary[];
  selectedId?: string;
  onSelectRun: (runId: string) => void;
};

const DEFAULT_METRIC_PREFS = [
  "aggregateScore",
  "accuracy",
  "meanTurns",
  "meanMessages",
  "durationMs",
];

function AxisSelect({
  axis,
  value,
  groups,
  onChange,
  optional = false,
}: {
  axis: "X" | "Y" | "Z";
  value: string;
  groups: AxisMetricGroup[];
  onChange: (id: string) => void;
  optional?: boolean;
}) {
  const current = value ? axisMetricDef(value) : undefined;
  return (
    <label className="center-axis-picker">
      <span className="center-axis-picker__axis">{axis} axis</span>
      <span className="center-axis-picker__group">
        {optional && !value
          ? "Off"
          : (current?.groupLabel ?? "Metric")}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${axis} axis metric`}
      >
        {optional ? <option value="">None</option> : null}
        {groups.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.metrics.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function defaultMetricColumns(ids: string[]): string[] {
  const picked = DEFAULT_METRIC_PREFS.filter((id) => ids.includes(id));
  return picked.length > 0 ? picked : ids.slice(0, 4);
}

function keepAvailable(selected: string[], available: string[]): string[] {
  const allow = new Set(available);
  return selected.filter((id) => allow.has(id));
}

export function ExperimentOverview({
  runs,
  selectedId,
  onSelectRun,
}: Props) {
  const allGroups = useMemo(() => getAvailableAxisGroups(runs), [runs]);
  const policyGroups = useMemo(
    () => getAvailableAxisGroups(runs, ["policy"]),
    [runs],
  );
  const metricGroups = useMemo(
    () => getAvailableAxisGroups(runs, ["task", "evaluation"]),
    [runs],
  );
  const allMetricIds = useMemo(
    () => allGroups.flatMap((g) => g.metrics.map((m) => m.id)),
    [allGroups],
  );
  const policyIds = useMemo(
    () => policyGroups.flatMap((g) => g.metrics.map((m) => m.id)),
    [policyGroups],
  );
  const metricIds = useMemo(
    () => metricGroups.flatMap((g) => g.metrics.map((m) => m.id)),
    [metricGroups],
  );
  const defaults = useMemo(
    () => defaultScatterAxes(allMetricIds, allMetricIds),
    [allMetricIds],
  );
  const [xMetric, setXMetric] = useState(defaults.x);
  const [yMetric, setYMetric] = useState(defaults.y);
  const [zMetric, setZMetric] = useState("");
  const [mode, setMode] = useState<"runs" | "table">("runs");
  const [policyCols, setPolicyCols] = useState<string[]>(policyIds);
  const [metricCols, setMetricCols] = useState<string[]>(() =>
    defaultMetricColumns(metricIds),
  );

  const safeX = allMetricIds.includes(xMetric) ? xMetric : defaults.x;
  const safeY = allMetricIds.includes(yMetric) ? yMetric : defaults.y;
  const safeZ = allMetricIds.includes(zMetric) ? zMetric : "";
  const safePolicyCols = keepAvailable(policyCols, policyIds);
  const safeMetricCols = keepAvailable(metricCols, metricIds);
  const evalAxes = [safeX, safeY, safeZ].filter(
    (id): id is string => Boolean(id) && isEvaluationMetric(id),
  );
  const plottedRuns =
    evalAxes.length > 0
      ? runs.filter((run) =>
          evalAxes.every((id) => typeof run.metrics[id] === "number"),
        )
      : runs;
  const hiddenCount = evalAxes.length > 0 ? runs.length - plottedRuns.length : 0;
  const evalFilterLabel = evalAxes.map(axisMetricLabel).join(" / ");

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
        {mode === "table" ? (
          <div className="center-col-menus">
            <ColumnMenu
              label="Policy"
              groups={policyGroups}
              selected={safePolicyCols}
              onChange={setPolicyCols}
            />
            <ColumnMenu
              label="Metrics"
              groups={metricGroups}
              selected={safeMetricCols}
              onChange={setMetricCols}
              align="end"
            />
          </div>
        ) : null}
      </div>

      {mode === "runs" ? (
        allMetricIds.length > 0 ? (
          <div className="center-scatter-block">
            <div className="center-axis-pickers">
              <AxisSelect
                axis="X"
                value={safeX}
                groups={allGroups}
                onChange={setXMetric}
              />
              <AxisSelect
                axis="Y"
                value={safeY}
                groups={allGroups}
                onChange={setYMetric}
              />
              <AxisSelect
                axis="Z"
                value={safeZ}
                groups={allGroups}
                onChange={setZMetric}
                optional
              />
            </div>
            <RunScatterPlot
              runs={plottedRuns}
              xMetric={safeX}
              yMetric={safeY}
              zMetric={safeZ || undefined}
              selectedId={selectedId}
              onSelect={onSelectRun}
            />
            {evalAxes.length > 0 ? (
              <p className="center-scatter__filter muted">
                {plottedRuns.length === 0
                  ? `No runs have evaluations for ${evalFilterLabel}`
                  : `Showing ${plottedRuns.length} of ${runs.length} run${runs.length === 1 ? "" : "s"} with evaluations`}
                {hiddenCount > 0 && plottedRuns.length > 0
                  ? ` · ${hiddenCount} hidden`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null
      ) : (
        <RunTable
          runs={runs}
          policyColumns={safePolicyCols}
          metricColumns={safeMetricCols}
          selectedId={selectedId}
          onSelect={onSelectRun}
        />
      )}
    </div>
  );
}
