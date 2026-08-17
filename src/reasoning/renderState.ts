import { agentLabel } from "../agents/identity";
import { stancesForNode } from "./graph";
import type { ReasoningGraph, ReasoningNode } from "./types";

const MAX_NODES = 48;
const MAX_TEXT = 140;

function truncate(text: string, max = MAX_TEXT): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function sortNodes(nodes: ReasoningNode[]): ReasoningNode[] {
  return [...nodes].sort((a, b) => {
    if (a.createdAtTurn !== b.createdAtTurn) {
      return a.createdAtTurn - b.createdAtTurn;
    }
    return a.id.localeCompare(b.id);
  });
}

function liveRevision(
  graph: ReasoningGraph,
  node: ReasoningNode,
): ReasoningNode | undefined {
  return graph.nodes.find((candidate) => candidate.supersedes === node.id);
}

function formatNodeBlock(
  graph: ReasoningGraph,
  node: ReasoningNode,
): string[] {
  const owner = agentLabel(node.createdBy);
  const lines = [
    `${node.id} [${owner}] ${node.type}`,
    `  "${truncate(node.text)}"`,
  ];

  const stances = stancesForNode(graph, node.id);
  if (stances.length === 0) {
    lines.push(`  ${owner} proposed`);
  } else {
    for (const stance of stances) {
      const who = agentLabel(stance.actor);
      const reason = stance.reason ? `: ${truncate(stance.reason, 80)}` : "";
      lines.push(`  ${who} ${stance.kind}${reason}`);
    }
  }

  if (node.parents.length > 0) {
    lines.push(`  parents: ${node.parents.join(", ")}`);
  }
  if (node.dependencies.length > 0) {
    const waiting = node.dependencies.filter((id) => {
      const dep = graph.nodes.find((n) => n.id === id);
      return !dep || dep.status !== "accepted";
    });
    lines.push(`  depends on: ${node.dependencies.join(", ")}`);
    if (waiting.length > 0 && node.status === "unresolved") {
      lines.push(`  waiting on: ${waiting.join(", ")}`);
    }
  }
  if (node.status === "superseded") {
    const next = liveRevision(graph, node);
    lines.push(next ? `  superseded by ${next.id}` : "  superseded");
  } else if (node.status === "rejected") {
    lines.push("  rejected");
  } else if (node.status === "accepted") {
    lines.push("  jointly accepted");
  }

  return lines;
}

/**
 * Compact, policy-invariant snapshot injected into each agent turn.
 * IDs are the handle agents should cite instead of recreating claims.
 */
export function formatReasoningState(graph: ReasoningGraph): string {
  const header = "CURRENT REASONING STATE";
  if (graph.nodes.length === 0) {
    return `${header}\n\n(empty — no proposals or claims yet)`;
  }

  const live = sortNodes(
    graph.nodes.filter((node) => node.status !== "superseded"),
  );
  const superseded = sortNodes(
    graph.nodes.filter((node) => node.status === "superseded"),
  );
  const ordered = [...live, ...superseded];

  const sections: string[] = [header, ""];
  const visible = ordered.slice(0, MAX_NODES);
  for (const node of visible) {
    sections.push(...formatNodeBlock(graph, node));
    sections.push("");
  }
  const hidden = ordered.length - visible.length;
  if (hidden > 0) {
    sections.push(`… ${hidden} more nodes omitted`);
  }
  return sections.join("\n").trimEnd();
}

export function reasoningStateUserMessage(graph: ReasoningGraph): string {
  return formatReasoningState(graph);
}
