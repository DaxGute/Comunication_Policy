import {
  formatMetricValue,
  formatScore,
  matchProblemsAcrossRuns,
  type ProblemSummary,
  type RunMetricId,
  type RunSummary,
} from "./centerAdapter";

type Props = {
  left: RunSummary;
  right: RunSummary;
  onInspectProblem: (runId: string, problemId: string) => void;
  onBack: () => void;
};

const COMPARE_METRICS: { id: RunMetricId; label: string }[] = [
  { id: "aggregateScore", label: "Score" },
  { id: "accuracy", label: "Accuracy" },
  { id: "meanTurns", label: "Mean turns" },
  { id: "medianTurns", label: "Median turns" },
  { id: "problemCount", label: "Problems" },
  { id: "completedProblems", label: "Completed" },
  { id: "incompleteProblems", label: "Incomplete" },
  { id: "totalMessages", label: "Messages" },
  { id: "totalTokens", label: "Tokens" },
  { id: "durationMs", label: "Duration" },
  { id: "trustA", label: "Trust A→B" },
  { id: "trustB", label: "Trust B→A" },
  { id: "authority", label: "Authority" },
  { id: "familiarity", label: "Familiarity" },
];

function resultGlyph(p?: ProblemSummary): string {
  if (!p) return "—";
  if (p.status === "failed") return "✗";
  if (p.status === "running") return "●";
  if (p.status === "cancelled") return "⚠";
  if (p.status === "incomplete") return "○";
  if (p.isCorrect === true) return "✓";
  if (p.isCorrect === false) return "✗";
  if (p.hasScore) return formatScore(p.score!);
  return "✓";
}

export function RunComparison({
  left,
  right,
  onInspectProblem,
  onBack,
}: Props) {
  const rows = COMPARE_METRICS.filter(
    (m) =>
      typeof left.metrics[m.id] === "number" ||
      typeof right.metrics[m.id] === "number",
  );

  const matched = matchProblemsAcrossRuns(left, right);
  const shared = matched.filter((r) => r.left && r.right);

  return (
    <div className="center-compare">
      <div className="center-toolbar">
        <button type="button" className="center-btn center-btn--ghost" onClick={onBack}>
          ‹ Experiment
        </button>
        <span className="muted">
          Comparing {left.title} vs {right.title}
        </span>
      </div>

      <table className="center-compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>{left.title}</th>
            <th>{right.title}</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, label }) => {
            const a = left.metrics[id];
            const b = right.metrics[id];
            const delta =
              typeof a === "number" && typeof b === "number" ? b - a : undefined;
            return (
              <tr key={id}>
                <td>{label}</td>
                <td className="mono">
                  {typeof a === "number" ? formatMetricValue(id, a) : "—"}
                </td>
                <td className="mono">
                  {typeof b === "number" ? formatMetricValue(id, b) : "—"}
                </td>
                <td className="mono">
                  {delta === undefined
                    ? "—"
                    : `${delta > 0 ? "+" : ""}${formatMetricValue(id, delta)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {shared.length > 0 ? (
        <section className="center-compare-matched">
          <h3>Matched problems ({shared.length})</h3>
          <div className="center-run-table-wrap">
            <table className="center-run-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th>{left.title}</th>
                  <th>{right.title}</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((row) => (
                  <tr key={row.problemId}>
                    <td className="mono">{row.shortLabel}</td>
                    <td>
                      <button
                        type="button"
                        className="center-link-btn"
                        onClick={() =>
                          onInspectProblem(left.runId, row.problemId)
                        }
                      >
                        {resultGlyph(row.left)}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="center-link-btn"
                        onClick={() =>
                          onInspectProblem(right.runId, row.problemId)
                        }
                      >
                        {resultGlyph(row.right)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="muted">No shared problem IDs between these runs.</p>
      )}
    </div>
  );
}
