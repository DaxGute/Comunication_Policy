import type { AgentId } from "../../agents/types";
import type { ProblemSummary } from "./centerAdapter";
import { formatScore } from "./centerAdapter";

type Props = {
  problem: ProblemSummary;
  /** Only set when speaking is unambiguous for this running problem. */
  speakingAgentId?: AgentId;
  selected?: boolean;
  onSelect: () => void;
};

function statusGlyph(status: ProblemSummary["status"]): string {
  switch (status) {
    case "complete":
      return "✓";
    case "running":
      return "●";
    case "failed":
      return "✗";
    case "cancelled":
      return "⚠";
  }
}

export function ProblemMiniCard({
  problem,
  speakingAgentId,
  selected,
  onSelect,
}: Props) {
  const showMicro =
    problem.status === "running" && speakingAgentId !== undefined;

  return (
    <button
      type="button"
      className={[
        "center-problem-card",
        `center-problem-card--${problem.status}`,
        selected ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      title={problem.title}
    >
      <span className="center-problem-card__id mono">{problem.shortLabel}</span>
      <span className="center-problem-card__glyph" aria-hidden>
        {statusGlyph(problem.status)}
      </span>
      <span className="center-problem-card__meta muted">
        {problem.turnCount > 0 ? `${problem.turnCount}t` : "—"}
        {problem.hasScore ? ` · ${formatScore(problem.score!)}` : ""}
      </span>
      {showMicro ? (
        <span className="center-problem-card__speak" aria-hidden>
          <span
            className={
              speakingAgentId === "agent_a"
                ? "is-speaking center-speak-a"
                : "center-speak-a"
            }
          >
            A
          </span>
          <span className="center-speak-sep">↔</span>
          <span
            className={
              speakingAgentId === "agent_b"
                ? "is-speaking center-speak-b"
                : "center-speak-b"
            }
          >
            B
          </span>
        </span>
      ) : null}
    </button>
  );
}
