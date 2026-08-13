import {
  attentionKindLabel,
  formatScore,
  type AttentionItem,
  type ProblemSummary,
  type RunSummary,
} from "./centerAdapter";
import { ProblemMiniCard } from "./ProblemMiniCard";
import type { AgentId } from "../../agents/types";

export type StatusFilter =
  | "all"
  | "running"
  | "complete"
  | "incomplete"
  | "failed";
export type ResultFilter = "all" | "correct" | "incorrect";
export type ProblemSort =
  | "anomalous"
  | "most_turns"
  | "fewest_turns"
  | "highest_score"
  | "lowest_score"
  | "problem_id";

type Props = {
  run: RunSummary;
  statusFilter: StatusFilter;
  resultFilter: ResultFilter;
  sort: ProblemSort;
  search: string;
  speakingAgentId?: AgentId;
  onStatusFilter: (v: StatusFilter) => void;
  onResultFilter: (v: ResultFilter) => void;
  onSort: (v: ProblemSort) => void;
  onSearch: (v: string) => void;
  onSelectProblem: (problemId: string) => void;
};

function anomalyRank(
  attention: AttentionItem[],
  problemId: string,
): number {
  const idx = attention.findIndex((a) => a.problemId === problemId);
  if (idx === -1) return Number.POSITIVE_INFINITY;
  return idx;
}

function filterAndSortProblems(
  run: RunSummary,
  statusFilter: StatusFilter,
  resultFilter: ResultFilter,
  sort: ProblemSort,
  search: string,
): ProblemSummary[] {
  const q = search.trim().toLowerCase();
  let list = run.problems.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (resultFilter === "correct" && p.isCorrect !== true) return false;
    if (resultFilter === "incorrect" && p.isCorrect !== false) return false;
    if (q) {
      const hay = `${p.problemId} ${p.shortLabel} ${p.title}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hasScores = list.some((p) => p.hasScore);
  list = [...list].sort((a, b) => {
    switch (sort) {
      case "anomalous":
        return (
          anomalyRank(run.attention, a.problemId) -
          anomalyRank(run.attention, b.problemId)
        );
      case "most_turns":
        return b.turnCount - a.turnCount;
      case "fewest_turns":
        return a.turnCount - b.turnCount;
      case "highest_score":
        if (!hasScores) return a.problemId.localeCompare(b.problemId);
        return (b.score ?? -Infinity) - (a.score ?? -Infinity);
      case "lowest_score":
        if (!hasScores) return a.problemId.localeCompare(b.problemId);
        return (a.score ?? Infinity) - (b.score ?? Infinity);
      case "problem_id":
      default:
        return a.problemId.localeCompare(b.problemId);
    }
  });
  return list;
}

export function RunOverview({
  run,
  statusFilter,
  resultFilter,
  sort,
  search,
  speakingAgentId,
  onStatusFilter,
  onResultFilter,
  onSort,
  onSearch,
  onSelectProblem,
}: Props) {
  const hasCorrectness = run.problems.some((p) => p.isCorrect !== undefined);
  const hasScores = run.problems.some((p) => p.hasScore);
  const filtered = filterAndSortProblems(
    run,
    statusFilter,
    resultFilter,
    sort,
    search,
  );

  const microSpeak = speakingAgentId;

  return (
    <div className="center-run-overview">
      <div className="center-run-summary">
        <SummaryStat
          label="Completed"
          value={`${run.completedCount} / ${run.problemCount}`}
        />
        {run.incompleteCount > 0 ? (
          <SummaryStat label="Incomplete" value={String(run.incompleteCount)} />
        ) : null}
        {run.correctCount !== undefined ? (
          <SummaryStat
            label="Correct"
            value={`${run.correctCount} / ${run.scoredCount || run.problems.filter((p) => p.isCorrect !== undefined).length}`}
          />
        ) : null}
        {run.aggregateScore !== undefined ? (
          <SummaryStat
            label="Score"
            value={formatScore(run.aggregateScore)}
          />
        ) : null}
        {run.meanMessages !== undefined ? (
          <SummaryStat
            label="Avg run length"
            value={run.meanMessages.toFixed(1)}
          />
        ) : null}
        {run.meanTurns !== undefined ? (
          <SummaryStat label="Mean turns" value={run.meanTurns.toFixed(1)} />
        ) : null}
        {run.totalMessages > 0 ? (
          <SummaryStat label="Messages" value={String(run.totalMessages)} />
        ) : null}
        {run.failedCount > 0 ? (
          <SummaryStat label="Failed" value={String(run.failedCount)} />
        ) : null}
        {run.runningCount > 0 ? (
          <SummaryStat label="Running" value={String(run.runningCount)} />
        ) : null}
      </div>

      {run.attention.length > 0 ? (
        <section className="center-attention">
          <h3>Attention</h3>
          <ul className="center-attention__list">
            {run.attention.map((item) => (
              <li key={`${item.problemId}-${item.kind}`}>
                <button
                  type="button"
                  className="center-attention__item"
                  onClick={() => onSelectProblem(item.problemId)}
                >
                  <span className="center-attention__kind">
                    {attentionKindLabel(item.kind)}
                  </span>
                  <span className="mono">{item.label}</span>
                  <span className="muted">{item.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="center-toolbar center-toolbar--wrap">
        <div className="center-seg" role="group" aria-label="Status filter">
          {(
            [
              ["all", "All"],
              ["running", "Running"],
              ["complete", "Complete"],
              ["incomplete", "Incomplete"],
              ["failed", "Failed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={statusFilter === id ? "is-active" : undefined}
              onClick={() => onStatusFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {hasCorrectness ? (
          <div className="center-seg" role="group" aria-label="Result filter">
            {(
              [
                ["all", "All"],
                ["correct", "Correct"],
                ["incorrect", "Incorrect"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={resultFilter === id ? "is-active" : undefined}
                onClick={() => onResultFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <label className="center-sort">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as ProblemSort)}
          >
            <option value="anomalous">Most anomalous</option>
            <option value="most_turns">Most turns</option>
            <option value="fewest_turns">Fewest turns</option>
            {hasScores ? (
              <>
                <option value="highest_score">Highest score</option>
                <option value="lowest_score">Lowest score</option>
              </>
            ) : null}
            <option value="problem_id">Problem ID</option>
          </select>
        </label>

        <input
          type="search"
          className="center-search"
          placeholder="Search problem ID"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="center-problem-grid" role="list">
        {filtered.map((problem) => (
          <ProblemMiniCard
            key={problem.problemId}
            problem={problem}
            speakingAgentId={
              problem.status === "running"
                ? (problem.speakingAgentId ?? microSpeak)
                : undefined
            }
            onSelect={() => onSelectProblem(problem.problemId)}
          />
        ))}
        {filtered.length === 0 ? (
          <p className="muted center-empty-inline">No problems match filters.</p>
        ) : null}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="center-run-summary__stat">
      <span className="center-run-summary__label">{label}</span>
      <span className="center-run-summary__value mono">{value}</span>
    </div>
  );
}
