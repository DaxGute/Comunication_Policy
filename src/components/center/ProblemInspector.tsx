import { useState } from "react";
import type { AgentId } from "../../agents/types";
import type { ProblemConversation } from "../../experiment/types";
import { TwoAgentGraph } from "../graph/TwoAgentGraph";
import {
  formatScore,
  type ProblemSummary,
  type RunSummary,
} from "./centerAdapter";
import { TurnTimeline } from "./TurnTimeline";

type Props = {
  run: RunSummary;
  problem: ProblemSummary;
  conversation?: ProblemConversation;
  speakingAgentId?: AgentId;
  onBack: () => void;
};

export function ProblemInspector({
  run,
  problem,
  conversation,
  speakingAgentId,
  onBack,
}: Props) {
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<
    number | undefined
  >(undefined);

  const liveSpeak =
    problem.status === "running"
      ? (conversation?.speakingAgentId ??
        problem.speakingAgentId ??
        speakingAgentId)
      : undefined;

  return (
    <div className="center-problem-inspector" data-run-id={run.runId}>
      <div className="center-toolbar">
        <button type="button" className="center-btn center-btn--ghost" onClick={onBack}>
          ‹ Run Overview
        </button>
        <div className="center-problem-inspector__meta">
          <strong>{problem.shortLabel}</strong>
          <span className={`center-status center-status--${problem.status}`}>
            {problem.status}
          </span>
          {problem.hasScore ? (
            <span className="mono">score {formatScore(problem.score!)}</span>
          ) : null}
          <span className="muted">{problem.turnCount} turns</span>
          <span className="muted">{problem.messageCount} msgs</span>
        </div>
      </div>

      <div className="center-problem-inspector__graph">
        <TwoAgentGraph speakingAgentId={liveSpeak} compact />
      </div>

      <section className="center-problem-inspector__timeline">
        <h3>Turn timeline</h3>
        <TurnTimeline
          messages={conversation?.messages ?? []}
          selectedTurnIndex={selectedTurnIndex}
          onSelectTurn={setSelectedTurnIndex}
        />
        {selectedTurnIndex !== undefined ? (
          <p className="muted center-problem-inspector__turn-hint">
            Selected turn {selectedTurnIndex}
            {conversation?.messages.find((m) => m.turnIndex === selectedTurnIndex)
              ? ` · ${
                  conversation.messages.find(
                    (m) => m.turnIndex === selectedTurnIndex,
                  )?.agentId === "agent_a"
                    ? "Agent A"
                    : "Agent B"
                }`
              : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}
