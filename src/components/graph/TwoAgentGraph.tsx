import { useEffect, useRef, useState } from "react";
import type { AgentId } from "../../agents/types";

type Props = {
  speakingAgentId?: AgentId;
  /** Compact embedding inside Problem Inspector (no page-level header). */
  compact?: boolean;
};

type HandoffDirection = "a-to-b" | "b-to-a";

const HANDOFF_MS = 900;

export function TwoAgentGraph({ speakingAgentId, compact }: Props) {
  const prevSpeakingRef = useRef<AgentId | undefined>(undefined);
  const [handoff, setHandoff] = useState<HandoffDirection | null>(null);

  useEffect(() => {
    const prev = prevSpeakingRef.current;
    prevSpeakingRef.current = speakingAgentId;

    if (!prev || !speakingAgentId || prev === speakingAgentId) {
      return;
    }

    const direction: HandoffDirection | null =
      prev === "agent_a" && speakingAgentId === "agent_b"
        ? "a-to-b"
        : prev === "agent_b" && speakingAgentId === "agent_a"
          ? "b-to-a"
          : null;
    if (!direction) return;

    setHandoff(direction);
    const timer = window.setTimeout(() => setHandoff(null), HANDOFF_MS);
    return () => window.clearTimeout(timer);
  }, [speakingAgentId]);

  return (
    <div className={compact ? "graph-pane graph-pane--compact" : "graph-pane"}>
      {compact ? null : (
        <header className="graph-pane__header">
          <h1>Agent A — Agent B</h1>
          <p className="muted">
            Two general-purpose agents. Edge = interpersonal communication under
            the current policy.
          </p>
        </header>
      )}

      <div className="graph-canvas" aria-label="Two agent communication graph">
        <svg
          className="graph-svg"
          viewBox="0 0 640 280"
          role="img"
          aria-labelledby="graph-title"
        >
          <title id="graph-title">Agent A connected to Agent B</title>

          <line x1="180" y1="140" x2="460" y2="140" className="graph-edge" />
          {handoff ? (
            <line
              x1="180"
              y1="140"
              x2="460"
              y2="140"
              className={`graph-edge-pulse graph-edge-pulse--${handoff}`}
            />
          ) : null}
          <text x="320" y="120" textAnchor="middle" className="graph-edge-label">
            communication
          </text>

          <AgentNode
            cx={140}
            cy={140}
            label="Agent A"
            agent="a"
            active={speakingAgentId === "agent_a"}
            handoff={Boolean(handoff)}
          />
          <AgentNode
            cx={500}
            cy={140}
            label="Agent B"
            agent="b"
            active={speakingAgentId === "agent_b"}
            handoff={Boolean(handoff)}
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
  handoff,
}: {
  cx: number;
  cy: number;
  label: string;
  agent: "a" | "b";
  active: boolean;
  handoff: boolean;
}) {
  const classes = [
    "graph-node",
    `graph-node--${agent}`,
    active ? "graph-node--active" : "",
    handoff ? "graph-node--handoff" : "",
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
