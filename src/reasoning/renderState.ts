import { agentLabel } from "../agents/identity";
import type { TaskIssueLedger } from "../problems/adapters/types";
import { stancesForNode } from "./graph";
import { deriveIssueConvergenceStates, reasoningIssues } from "./convergence";
import type {
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningNode,
} from "./types";

const MAX_NODES = 64;
const MAX_TEXT = 320;

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
  return graph.nodes.find(
    (candidate) =>
      candidate.type !== "final_answer" && candidate.supersedes === node.id,
  );
}

function selectRelevantNodes(graph: ReasoningGraph): ReasoningNode[] {
  if (graph.nodes.length <= MAX_NODES) return sortNodes(graph.nodes);
  const degree = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const latestTurn = Math.max(...graph.nodes.map((node) => node.createdAtTurn));
  const recentIds = new Set(
    graph.nodes
      .filter((node) => node.createdAtTurn >= latestTurn - 2)
      .map((node) => node.id),
  );
  const connectedToRecent = new Set<string>();
  for (const edge of graph.edges ?? []) {
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
    outgoing.set(
      edge.sourceNodeId,
      (outgoing.get(edge.sourceNodeId) ?? 0) + 1,
    );
    if (recentIds.has(edge.sourceNodeId)) connectedToRecent.add(edge.targetNodeId);
    if (recentIds.has(edge.targetNodeId)) connectedToRecent.add(edge.sourceNodeId);
  }
  const ranked = [...graph.nodes].sort((a, b) => {
    const score = (node: ReasoningNode) =>
      (node.type === "final_answer" ? 10_000 : 0) +
      (node.status === "open" || node.status === "unresolved" ? 2_000 : 0) +
      (node.type === "issue" ? 500 : 0) +
      (node.status === "accepted" ? 250 : 0) +
      (node.status === "accepted" && !outgoing.has(node.id) ? 900 : 0) +
      (recentIds.has(node.id) ? 1_400 : 0) +
      (connectedToRecent.has(node.id) ? 1_100 : 0) +
      (degree.get(node.id) ?? 0) * 25 +
      node.createdAtTurn -
      (node.status === "superseded" ? 1_000 : 0) -
      (node.status === "rejected" ? 500 : 0);
    return score(b) - score(a) || b.createdAtTurn - a.createdAtTurn;
  });
  return sortNodes(ranked.slice(0, MAX_NODES));
}

function formatIssueIdentity(id: string, label: string, prompt?: string): string[] {
  const lines = [`${label}`, `ID: ${id}`];
  if (prompt) lines.push(`CLUE: ${prompt}`);
  return lines;
}

function agentStatusLine(graph: ReasoningGraph, nodeId: string): string {
  const stances = stancesForNode(graph, nodeId);
  if (stances.length === 0) return "Agent status: unresolved";
  const parts = stances.map((stance) => {
    const who = agentLabel(stance.actor);
    if (stance.kind === "accept") return `accepted by ${who}`;
    if (stance.kind === "reject") return `rejected by ${who}`;
    if (stance.kind === "challenge") return `challenged by ${who}`;
    if (stance.kind === "support") return `supported by ${who}`;
    return `${stance.kind} by ${who}`;
  });
  return `Agent status: ${parts.join("; ")}`;
}

function formatLedger(graph: ReasoningGraph, ledger: TaskIssueLedger): string[] {
  const lines: string[] = [];
  if (ledger.conflicts.length > 0) {
    lines.push("UNRESOLVED CONFLICT");
    for (const conflict of ledger.conflicts) {
      const [left, right] = conflict.nodeIds;
      const leftNode = graph.nodes.find((node) => node.id === left);
      const rightNode = graph.nodes.find((node) => node.id === right);
      const leftAnswer =
        ledger.liveCandidates.find((candidate) => candidate.nodeId === left)
          ?.normalizedAnswer ?? left;
      const rightAnswer =
        ledger.liveCandidates.find((candidate) => candidate.nodeId === right)
          ?.normalizedAnswer ?? right;
      if (left && right && left !== right) {
        lines.push(`${left}: ${leftAnswer}`);
        lines.push("conflicts with");
        lines.push(`${right}: ${rightAnswer}`);
      } else {
        lines.push(conflict.description ?? conflict.nodeIds.join(" vs "));
      }
      if (leftNode && rightNode) {
        lines.push(truncate(conflict.description ?? "", 160));
      }
    }
    lines.push(
      "Resolve this contradiction through challenge, rejection, revision,",
    );
    lines.push(
      "or new evidence before expanding unrelated alternatives.",
    );
    lines.push("");
  }
  lines.push(
    ledger.liveCandidates.length === 1
      ? "CURRENT HYPOTHESIS"
      : "CURRENT LIVE CANDIDATES",
  );
  if (ledger.liveCandidates.length === 0) {
    lines.push("(none)");
  } else {
    if (ledger.currentCandidate) {
      lines.push(`currentCandidate: ${ledger.currentCandidate}`);
    }
    for (const candidate of ledger.liveCandidates) {
      const answer = candidate.normalizedAnswer ?? "(unparsed)";
      lines.push(`${answer}:`);
      lines.push(`  status: ${candidate.live ? "active" : candidate.status}`);
      lines.push(`  node: ${candidate.nodeId}`);
      lines.push(
        `  firstProposed: turn ${candidate.firstProposedTurn ?? candidate.createdAtTurn}`,
      );
      if (candidate.lastTouchedTurn) {
        lines.push(`  lastTouched: turn ${candidate.lastTouchedTurn}`);
      }
      if (candidate.proposedBy && candidate.proposedBy.length > 0) {
        lines.push(`  proposedBy: ${candidate.proposedBy.join(", ")}`);
      }
      if (candidate.supportedBy && candidate.supportedBy.length > 0) {
        lines.push(`  supportedBy: ${candidate.supportedBy.join(", ")}`);
      }
      if (candidate.challengedBy && candidate.challengedBy.length > 0) {
        lines.push(`  challengedBy: ${candidate.challengedBy.join(", ")}`);
      }
      lines.push(`  ${agentStatusLine(graph, candidate.nodeId)}`);
      lines.push(`  TASK COMPATIBILITY: ${candidate.compatibility}`);
      if (candidate.crossingDescription) {
        lines.push(`  crossing: ${truncate(candidate.crossingDescription, 140)}`);
      }
      if (candidate.priorTurns && candidate.priorTurns.length > 0) {
        lines.push(
          `  ${answer} was previously tried on turns ${candidate.priorTurns.join(" and ")}.`,
        );
      }
    }
  }
  if (ledger.previousCandidates.length > 0) {
    lines.push("REPLACED");
    for (const candidate of ledger.previousCandidates) {
      const outcome = candidate.priorOutcome ?? candidate.status;
      const reason = candidate.rejectionReason
        ? ` because ${candidate.rejectionReason}`
        : "";
      lines.push(
        `${candidate.normalizedAnswer ?? "(unparsed)"} — ${outcome}${reason}`,
      );
      lines.push(
        `  firstProposed turn ${candidate.firstProposedTurn ?? candidate.createdAtTurn}` +
          (candidate.lastTouchedTurn
            ? `; lastTouched turn ${candidate.lastTouchedTurn}`
            : ""),
      );
    }
  }
  if (ledger.triedAnswers.length > 0) {
    lines.push("TRIED ANSWERS");
    for (const answer of ledger.triedAnswers) lines.push(answer);
  }
  return lines;
}

function formatNodeBlock(
  graph: ReasoningGraph,
  node: ReasoningNode,
): string[] {
  const owner =
    node.createdBy === "system" ? "Task" : agentLabel(node.createdBy as "agent_a" | "agent_b");
  const lines = [
    `${node.id} [${owner}] ${node.type}`,
    `  "${truncate(node.text)}"`,
  ];

  if (node.type === "final_answer") {
    lines.push(`  supports cited: ${node.supportingNodeIds.join(", ") || "(none)"}`);
    if (node.supportErrors.length > 0) {
      lines.push(`  support errors: ${node.supportErrors.join("; ")}`);
    }
    return lines;
  }

    if (node.evidenceOrigin) {
      lines.push(`  origin: ${node.evidenceOrigin}`);
    }
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
export function formatReasoningState(
  graph: ReasoningGraph,
  suppliedIssueStates?: IssueConvergenceState[],
  taskLedgers?: TaskIssueLedger[],
): string {
  const header = "CURRENT REASONING STATE";
  const subjects = graph.subjects ?? [];
  if (graph.nodes.length === 0 && subjects.length === 0) {
    return `${header}\n\n(empty — no reasoning nodes yet)`;
  }

  const selected = selectRelevantNodes(graph);
  const live = selected.filter((node) => node.status !== "superseded");
  const superseded = selected.filter((node) => node.status === "superseded");
  const ordered = [...live, ...superseded];

  const sections: string[] = [header, ""];
  const issueStates =
    suppliedIssueStates ?? deriveIssueConvergenceStates(graph);
  const issuesById = new Map(reasoningIssues(graph).map((issue) => [issue.id, issue]));
  const ledgersById = new Map((taskLedgers ?? []).map((ledger) => [ledger.issueId, ledger]));
  if (issueStates.length > 0) {
    sections.push("CURRENT ISSUE STATE");
    for (const state of issueStates) {
      const issue = issuesById.get(state.issueId);
      sections.push(
        ...formatIssueIdentity(
          state.issueId,
          issue?.label ?? state.issueId,
          issue?.prompt,
        ),
      );
      sections.push(
        `  STATUS: ${
          state.settledClaimId
            ? "settled"
            : state.reopened
              ? "reopened"
              : "unresolved"
        }`,
      );
      const ledger = ledgersById.get(state.issueId);
      if (ledger) {
        sections.push(...formatLedger(graph, ledger).map((line) => `  ${line}`));
      } else if (state.settledClaimId) {
        const claim = graph.nodes.find((node) => node.id === state.settledClaimId);
        sections.push(`  CURRENT CLAIM: ${state.settledClaimId}: ${truncate(claim?.text ?? "")}`);
      } else if (state.liveClaimIds.length > 0) {
        sections.push(`  LIVE CLAIMS: ${state.liveClaimIds.join(", ")}`);
      }
      for (const conflict of state.conflicts) {
        sections.push(
          `  CONFLICT (${conflict.source}): ${truncate(conflict.description ?? conflict.nodeIds.join(" vs "))}`,
        );
      }
    }
    sections.push("");
  }
  const visible = ordered;
  const groupedIds = new Set<string>();
  if (subjects.length > 0) {
    sections.push("AVAILABLE ISSUES");
    sections.push(
      "Refer to issues by their labels (for example \"Across 5\" or \"5A\"). The application maps these to graph ids.",
    );
    sections.push("");
    for (const subject of subjects) {
      sections.push(
        ...formatIssueIdentity(
          subject.id,
          subject.label,
          subject.prompt ?? subject.description,
        ),
      );
      const attached = visible.filter(
        (node) =>
          node.type !== "final_answer" && node.subjectId === subject.id,
      );
      for (const node of attached) {
        groupedIds.add(node.id);
        sections.push(
          ...formatNodeBlock(graph, node).map((line) => `  ${line}`),
        );
      }
      sections.push("");
    }
  }

  const emergentIssues = visible.filter(
    (node) =>
      node.type === "issue" &&
      visible.some(
        (candidate) =>
          candidate.type !== "final_answer" &&
          candidate.subjectId === node.id,
      ),
  );
  if (emergentIssues.length > 0) {
    sections.push("EMERGENT ISSUES");
    for (const issue of emergentIssues) {
      groupedIds.add(issue.id);
      sections.push(...formatNodeBlock(graph, issue));
      for (const node of visible.filter(
        (candidate) =>
          candidate.type !== "final_answer" &&
          candidate.subjectId === issue.id,
      )) {
        groupedIds.add(node.id);
        sections.push(
          ...formatNodeBlock(graph, node).map((line) => `  ${line}`),
        );
      }
      sections.push("");
    }
  }

  const other = visible.filter((node) => !groupedIds.has(node.id));
  if (other.length > 0) {
    if (subjects.length > 0) sections.push("OTHER REASONING", "");
    for (const node of other) {
      sections.push(...formatNodeBlock(graph, node));
      sections.push("");
    }
  }
  const visibleIds = new Set([
    ...visible.map((node) => node.id),
    ...subjects.map((subject) => subject.id),
  ]);
  const visibleEdges = (graph.edges ?? []).filter(
    (edge) =>
      visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId),
  );
  if (visibleEdges.length > 0) {
    sections.push("TYPED RELATIONSHIPS");
    for (const edge of visibleEdges) {
      const reason = edge.reason ? ` — ${truncate(edge.reason, 100)}` : "";
      sections.push(
        `  ${edge.sourceNodeId} --${edge.type}--> ${edge.targetNodeId}${reason}`,
      );
    }
    sections.push("");
  }
  const hidden = graph.nodes.length - visible.length;
  if (hidden > 0) {
    sections.push(`… ${hidden} more nodes omitted`);
  }
  return sections.join("\n").trimEnd();
}

export function reasoningStateUserMessage(
  graph: ReasoningGraph,
  issueStates?: IssueConvergenceState[],
  taskLedgers?: TaskIssueLedger[],
): string {
  return formatReasoningState(graph, issueStates, taskLedgers);
}
