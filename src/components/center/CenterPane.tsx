import { useMemo, useState } from "react";
import type { AgentId } from "../../agents/types";
import type { ExperimentRun } from "../../experiment/types";
import {
  getRunsForCenterPane,
  runCrumbLabel,
  type RunSummary,
} from "./centerAdapter";
import { CenterPaneHeader } from "./CenterPaneHeader";
import { ExperimentOverview } from "./ExperimentOverview";
import { ProblemInspector } from "./ProblemInspector";
import {
  RunOverview,
  type ProblemSort,
  type ResultFilter,
  type StatusFilter,
} from "./RunOverview";
import { RunComparison } from "./RunComparison";

type ViewMode = "experiment" | "run" | "problem" | "compare";

type Props = {
  runs: ExperimentRun[];
  speakingAgentId?: AgentId;
  selectedRunId?: string;
  onSelectRun: (runId: string | undefined) => void;
  onSelectProblem: (problemId: string | undefined) => void;
};

export function CenterPane({
  runs,
  speakingAgentId,
  selectedRunId: storeRunId,
  onSelectRun,
  onSelectProblem,
}: Props) {
  const runSummaries = useMemo(() => getRunsForCenterPane(runs), [runs]);
  const runById = useMemo(() => {
    const map = new Map<string, RunSummary>();
    for (const r of runSummaries) map.set(r.runId, r);
    return map;
  }, [runSummaries]);

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    runSummaries.length <= 1 ? "run" : "experiment",
  );
  const [localRunId, setLocalRunId] = useState<string | undefined>(() => {
    if (runSummaries.length === 1) return runSummaries[0]?.runId;
    if (storeRunId && runSummaries.some((r) => r.runId === storeRunId)) {
      return storeRunId;
    }
    return runSummaries[runSummaries.length - 1]?.runId;
  });
  const [localProblemId, setLocalProblemId] = useState<string | undefined>();
  const [comparisonRunIds, setComparisonRunIds] = useState<string[]>([]);
  const [overviewSelectedIds, setOverviewSelectedIds] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sort, setSort] = useState<ProblemSort>("anomalous");
  const [search, setSearch] = useState("");

  const resolvedRunId =
    (localRunId && runById.has(localRunId) ? localRunId : undefined) ??
    (runSummaries.length === 1 ? runSummaries[0]?.runId : undefined) ??
    (storeRunId && runById.has(storeRunId) ? storeRunId : undefined);

  const selectedRun = resolvedRunId
    ? runById.get(resolvedRunId)
    : undefined;

  const selectedProblem = selectedRun?.problems.find(
    (p) => p.problemId === localProblemId,
  );

  const rawRun = runs.find((r) => r.id === selectedRun?.runId);
  const conversation = rawRun?.conversations.find(
    (c) => c.problemId === localProblemId,
  );

  function openRun(runId: string) {
    setLocalRunId(runId);
    setLocalProblemId(undefined);
    setViewMode("run");
    onSelectRun(runId);
  }

  function openProblem(runId: string, problemId: string) {
    setLocalRunId(runId);
    setLocalProblemId(problemId);
    setViewMode("problem");
    onSelectRun(runId);
    onSelectProblem(problemId);
  }

  function goExperiment() {
    setLocalProblemId(undefined);
    if (runSummaries.length <= 1) {
      setViewMode("run");
      if (runSummaries[0]) setLocalRunId(runSummaries[0].runId);
      return;
    }
    setViewMode("experiment");
  }

  function goRunOverview() {
    setLocalProblemId(undefined);
    setViewMode("run");
  }

  function handleOverviewSelect(runId: string, additive: boolean) {
    if (additive) {
      setOverviewSelectedIds((prev) => {
        if (prev.includes(runId)) return prev.filter((id) => id !== runId);
        if (prev.length >= 2) return [prev[1]!, runId];
        return [...prev, runId];
      });
      return;
    }
    setOverviewSelectedIds([runId]);
  }

  function startCompare() {
    if (overviewSelectedIds.length === 2) {
      setComparisonRunIds(overviewSelectedIds);
      setViewMode("compare");
    }
  }

  if (runSummaries.length === 0) {
    return (
      <div className="center-pane">
        <div className="center-pane__empty">
          <p>Run an experiment to explore interactions.</p>
          <p className="muted">
            The center pane visualizes runs, problems, and two-agent turns from
            existing results.
          </p>
        </div>
      </div>
    );
  }

  let effectiveMode: ViewMode = viewMode;
  if (runSummaries.length === 1 && viewMode === "experiment") {
    effectiveMode = "run";
  } else if (viewMode === "problem" && (!selectedRun || !selectedProblem)) {
    effectiveMode = selectedRun
      ? "run"
      : runSummaries.length > 1
        ? "experiment"
        : "run";
  } else if (viewMode === "run" && !selectedRun) {
    effectiveMode = runSummaries.length > 1 ? "experiment" : "run";
  }

  const crumbs = buildCrumbs({
    mode: effectiveMode,
    runSummaries,
    selectedRun,
    selectedProblem,
    comparisonRunIds,
    runById,
    onExperiment: goExperiment,
    onRun: goRunOverview,
  });

  return (
    <div className="center-pane">
      <CenterPaneHeader crumbs={crumbs} />

      <div className="center-pane__body">
        {effectiveMode === "experiment" ? (
          <ExperimentOverview
            runs={runSummaries}
            selectedIds={overviewSelectedIds}
            onSelectRun={handleOverviewSelect}
            onOpenRun={openRun}
            onCompare={startCompare}
          />
        ) : null}

        {effectiveMode === "run" && selectedRun ? (
          <RunOverview
            run={selectedRun}
            statusFilter={statusFilter}
            resultFilter={resultFilter}
            sort={sort}
            search={search}
            speakingAgentId={speakingAgentId}
            onStatusFilter={setStatusFilter}
            onResultFilter={setResultFilter}
            onSort={setSort}
            onSearch={setSearch}
            onSelectProblem={(problemId) =>
              openProblem(selectedRun.runId, problemId)
            }
          />
        ) : null}

        {effectiveMode === "problem" && selectedRun && selectedProblem ? (
          <ProblemInspector
            run={selectedRun}
            problem={selectedProblem}
            conversation={conversation}
            speakingAgentId={speakingAgentId}
            onBack={goRunOverview}
          />
        ) : null}

        {effectiveMode === "compare" && comparisonRunIds.length === 2 ? (
          (() => {
            const left = runById.get(comparisonRunIds[0]!);
            const right = runById.get(comparisonRunIds[1]!);
            if (!left || !right) {
              return (
                <p className="muted">
                  One of the compared runs is no longer available.
                </p>
              );
            }
            return (
              <RunComparison
                left={left}
                right={right}
                onBack={() => setViewMode("experiment")}
                onInspectProblem={openProblem}
              />
            );
          })()
        ) : null}
      </div>
    </div>
  );
}

function buildCrumbs(args: {
  mode: ViewMode;
  runSummaries: RunSummary[];
  selectedRun?: RunSummary;
  selectedProblem?: { shortLabel: string };
  comparisonRunIds: string[];
  runById: Map<string, RunSummary>;
  onExperiment: () => void;
  onRun: () => void;
}): { label: string; onClick?: () => void }[] {
  const {
    mode,
    runSummaries,
    selectedRun,
    selectedProblem,
    comparisonRunIds,
    runById,
    onExperiment,
    onRun,
  } = args;

  const crumbs: { label: string; onClick?: () => void }[] = [
    {
      label: "Experiment",
      onClick:
        mode !== "experiment" && runSummaries.length > 1
          ? onExperiment
          : undefined,
    },
  ];

  if (mode === "compare" && comparisonRunIds.length === 2) {
    const a = runById.get(comparisonRunIds[0]!);
    const b = runById.get(comparisonRunIds[1]!);
    crumbs.push({
      label: `Compare ${a?.displayIndex ?? "?"} vs ${b?.displayIndex ?? "?"}`,
    });
    return crumbs;
  }

  if (selectedRun && (mode === "run" || mode === "problem")) {
    crumbs.push({
      label: runCrumbLabel(selectedRun),
      onClick: mode === "problem" ? onRun : undefined,
    });
  }

  if (mode === "problem" && selectedProblem) {
    crumbs.push({ label: `Problem ${selectedProblem.shortLabel}` });
  }

  return crumbs;
}
