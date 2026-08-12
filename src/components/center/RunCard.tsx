import { formatPolicyValue } from "../../communication";
import type { RunSummary } from "./centerAdapter";
import { formatMetricValue, formatScore } from "./centerAdapter";

type Props = {
  run: RunSummary;
  selected: boolean;
  compareMarked: boolean;
  onSelect: (additive: boolean) => void;
  onOpen: () => void;
};

export function RunCard({
  run,
  selected,
  compareMarked,
  onSelect,
  onOpen,
}: Props) {
  return (
    <button
      type="button"
      className={[
        "center-run-card",
        selected ? "is-selected" : "",
        compareMarked ? "is-compare" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => onSelect(e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={onOpen}
    >
      <div className="center-run-card__top">
        <span className="center-run-card__title">{run.title}</span>
        <span className={`center-status center-status--${run.status}`}>
          {run.status}
        </span>
      </div>
      <div className="center-run-card__meta muted">
        <span>Tₐ {formatPolicyValue(run.trustA)}</span>
        <span>Tᵦ {formatPolicyValue(run.trustB)}</span>
        <span>Auth {formatPolicyValue(run.authority)}</span>
        <span>F {formatPolicyValue(run.familiarity)}</span>
      </div>
      <div className="center-run-card__stats">
        <span>
          Problems {run.completedCount}/{run.problemCount}
        </span>
        {run.incompleteCount > 0 ? (
          <span>Incomplete {run.incompleteCount}</span>
        ) : null}
        {run.aggregateScore !== undefined ? (
          <span>Score {formatScore(run.aggregateScore)}</span>
        ) : null}
        {run.meanTurns !== undefined ? (
          <span>Turns {run.meanTurns.toFixed(1)}</span>
        ) : null}
        {run.durationMs !== undefined ? (
          <span>{formatMetricValue("durationMs", run.durationMs)}</span>
        ) : null}
      </div>
    </button>
  );
}
