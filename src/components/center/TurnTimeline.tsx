import type { ConversationMessage } from "../../experiment/types";

type Props = {
  messages: ConversationMessage[];
  selectedTurnIndex?: number;
  onSelectTurn: (turnIndex: number) => void;
};

export function TurnTimeline({
  messages,
  selectedTurnIndex,
  onSelectTurn,
}: Props) {
  if (messages.length === 0) {
    return (
      <p className="muted center-empty-inline">No turns yet.</p>
    );
  }

  const turns = messages.map((m) => ({
    turnIndex: m.turnIndex,
    agentId: m.agentId,
    id: m.id,
  }));

  return (
    <div className="center-turn-timeline" role="list">
      <div className="center-turn-timeline__labels" aria-hidden>
        {turns.map((t) => (
          <span
            key={`l-${t.id}`}
            className={
              t.agentId === "agent_a"
                ? "center-turn-timeline__agent center-turn-timeline__agent--a"
                : "center-turn-timeline__agent center-turn-timeline__agent--b"
            }
          >
            {t.agentId === "agent_a" ? "A" : "B"}
          </span>
        ))}
      </div>
      <div className="center-turn-timeline__track">
        {turns.map((t) => (
          <button
            key={t.id}
            type="button"
            role="listitem"
            className={[
              "center-turn-timeline__dot",
              t.agentId === "agent_a" ? "is-a" : "is-b",
              selectedTurnIndex === t.turnIndex ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={`Turn ${t.turnIndex} · ${t.agentId === "agent_a" ? "Agent A" : "Agent B"}`}
            onClick={() => onSelectTurn(t.turnIndex)}
          >
            <span className="visually-hidden">Turn {t.turnIndex}</span>
          </button>
        ))}
        <div className="center-turn-timeline__line" aria-hidden />
      </div>
      <div className="center-turn-timeline__nums muted" aria-hidden>
        <span>1</span>
        <span>{turns.length}</span>
      </div>
    </div>
  );
}
