/**
 * Center workbench pane: run scatter plot and metric table.
 *
 * Summaries come from runSummary.ts; this file only chooses empty vs populated UI.
 */
import { useMemo } from "react";
import type { ExperimentRun } from "../../experiment/types";
import { getRunsForCenterPane } from "./runSummary";
import { ExperimentOverview } from "./ExperimentOverview";

type Props = {
  runs: ExperimentRun[];
  selectedRunId?: string;
  onSelectRun: (runId: string | undefined) => void;
};

export function CenterPane({
  runs,
  selectedRunId,
  onSelectRun,
}: Props) {
  const runSummaries = useMemo(() => getRunsForCenterPane(runs), [runs]);

  if (runSummaries.length === 0) {
    return (
      <div className="center-pane">
        <div className="center-pane__empty">
          <p>Run an experiment to explore interactions.</p>
          <p className="muted">
            The center pane plots and tabulates runs from existing results.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-pane">
      <div className="center-pane__body overlay-scroll">
        <ExperimentOverview
          runs={runSummaries}
          selectedId={selectedRunId}
          onSelectRun={(runId) => onSelectRun(runId)}
        />
      </div>
    </div>
  );
}
