import type { AgentId } from "../../agents/types";

type Props = {
  speakingAgentId?: AgentId;
};

export function TwoAgentGraph({ speakingAgentId }: Props) {
  return (
    <div className="graph-pane">
      <header className="graph-pane__header">
        <h1>Agent A — Agent B</h1>
        <p className="muted">
          Two general-purpose agents. Edge = interpersonal communication under
          the current policy.
        </p>
      </header>

      <div className="graph-canvas" aria-label="Two agent communication graph">
        <svg
          className="graph-svg"
          viewBox="0 0 640 280"
          role="img"
          aria-labelledby="graph-title"
        >
          <title id="graph-title">Agent A connected to Agent B</title>

          <line
            x1="180"
            y1="140"
            x2="460"
            y2="140"
            className="graph-edge"
          />
          <text x="320" y="120" textAnchor="middle" className="graph-edge-label">
            communication
          </text>

          <AgentNode
            cx={140}
            cy={140}
            label="Agent A"
            agent="a"
            active={speakingAgentId === "agent_a"}
          />
          <AgentNode
            cx={500}
            cy={140}
            label="Agent B"
            agent="b"
            active={speakingAgentId === "agent_b"}
          />
        </svg>
      </div>
    </div>
  );
}

function AgentNode({
  cx,
  cy,
  label,
  agent,
  active,
}: {
  cx: number;
  cy: number;
  label: string;
  agent: "a" | "b";
  active: boolean;
}) {
  const classes = [
    "graph-node",
    `graph-node--${agent}`,
    active ? "graph-node--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g className={classes}>
      <circle cx={cx} cy={cy} r={46} />
      <text x={cx} y={cy + 5} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
