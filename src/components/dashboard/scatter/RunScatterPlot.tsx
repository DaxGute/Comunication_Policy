/**
 * Chooses 2D vs 3D scatter based on whether a Z metric is set.
 *
 * Axis catalogs live in dashboard/axisMetrics; run metric values come from
 * dashboard/runSummary.
 */
import { useMemo } from "react";
import type { RunSummary } from "../runSummary";
import { axisMetricLabel } from "../axisMetrics";
import { Scatter2D } from "./Scatter2D";
import { Scatter3D } from "./Scatter3D";
import { collectPoints } from "./plotShared";

type Props = {
  runs: RunSummary[];
  xMetric: string;
  yMetric: string;
  zMetric?: string;
  selectedId?: string;
  onSelect: (runId: string) => void;
  status?: string;
};

export function RunScatterPlot({
  runs,
  xMetric,
  yMetric,
  zMetric,
  selectedId,
  onSelect,
  status,
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
        status={status}
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
      status={status}
      onSelect={onSelect}
    />
  );
}
