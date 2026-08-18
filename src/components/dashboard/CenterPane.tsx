/**
 * Center workbench pane: run scatter plot and metric table.
 *
 * Summaries come from runSummary.ts; this file only chooses empty vs populated UI.
 */
import { memo, useMemo, useRef } from "react";
import type { ExperimentRun } from "../../experiment/types";
import { getRunSummary, type RunSummary } from "./runSummary";
import { ExperimentOverview } from "./ExperimentOverview";

type Props = {
  runs: ExperimentRun[];
  selectedRunId?: string;
  onSelectRun: (runId: string | undefined) => void;
};

export const CenterPane = memo(function CenterPane({
  runs,
  selectedRunId,
  onSelectRun,
}: Props) {
  const summaryCacheRef = useRef(new WeakMap<ExperimentRun, RunSummary>());
  const runSummaries = useMemo(() => {
    const cache = summaryCacheRef.current;
    const chronological = [...runs].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return chronological.map((run, i) => {
      const displayIndex = i + 1;
      const cached = cache.get(run);
      if (cached && cached.displayIndex === displayIndex) return cached;
      const summary = getRunSummary(run, displayIndex);
      cache.set(run, summary);
      return summary;
    });
  }, [runs]);

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
          onSelectRun={onSelectRun}
        />
      </div>
    </div>
  );
});
