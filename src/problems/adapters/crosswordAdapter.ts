import { stancesForNode } from "../../reasoning/graph";
import type {
  IssueConflict,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningNode,
} from "../../reasoning/types";
import {
  extractCrosswordFillMoves,
  crosswordMessageLooksSubstantive,
} from "../crossword/extract";
import { findCrosswordCrossings } from "../crossword/geometry";
import { crosswordIssueId, parseCrosswordSubjectRef, resolveCrosswordSubject } from "../crossword/refs";
import type { CrosswordClue } from "../crossword/types";
import type { Problem } from "../types";
import type {
  BasisResolution,
  TaskCandidateRecord,
  TaskEvidenceSeed,
  TaskIssueLedger,
  TaskIssueState,
  TaskReadiness,
  TaskReasoningAdapter,
} from "./types";

export { crosswordIssueId };

export function normalizeCrosswordCandidate(answer: string): string {
  return answer.replace(/[^A-Za-z]/g, "").toUpperCase();
}

export function crosswordCandidateIdentity(
  issueId: string,
  answer: string,
): string {
  return `${issueId}:${normalizeCrosswordCandidate(answer)}`;
}

const CROSSWORD_ANSWER_FORMAT = /^[A-Z]+$/;

export function validateCrosswordCandidate(
  problem: Problem,
  node: {
    type: string;
    text: string;
    subjectId?: string;
    metadata?: Record<string, unknown>;
  },
): { ok: boolean; reasons?: string[] } {
  if (node.type !== "claim" && node.type !== "proposal") {
    return { ok: true };
  }
  if (!node.subjectId) {
    return { ok: false, reasons: ["crossword claim is missing a subject"] };
  }
  const clue = clueForIssue(problem, node.subjectId);
  if (!clue) {
    return { ok: false, reasons: [`unknown crossword entry ${node.subjectId}`] };
  }
  const answer = candidateAnswer(node, clue);
  if (!answer) {
    return {
      ok: false,
      reasons: [`${clueLabel(clue)} has no parseable candidate answer`],
    };
  }
  const reasons: string[] = [];
  if (!CROSSWORD_ANSWER_FORMAT.test(answer)) {
    reasons.push(
      `${clueLabel(clue)} candidate must be letters-only crossword fill`,
    );
  }
  if (answer.length !== clue.length) {
    reasons.push(
      `${clueLabel(clue)} candidate length ${answer.length} does not equal ${clue.length}`,
    );
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function crosswordSolverStateFingerprint(
  problem: Problem,
  graph: ReasoningGraph,
  issueStates: IssueConvergenceState[],
): string {
  const spec = crossword(problem);
  const ledgers = deriveCrosswordCandidateLedger(problem, graph);
  const conflicts = deriveCrosswordConflicts(problem, graph)
    .filter((conflict) => conflict.source === "task_constraint")
    .map((conflict) => conflict.description ?? conflict.nodeIds.slice().sort().join("|"))
    .sort();
  const entries = spec.clues.map((clue) => {
    const issueId = crosswordIssueId(clue.direction, clue.number);
    const ledger = ledgers.find((item) => item.issueId === issueId);
    const state = issueStates.find((item) => item.issueId === issueId);
    return {
      id: issueId,
      leading: ledger?.currentCandidate ?? null,
      live: (ledger?.liveCandidates ?? [])
        .map((candidate) => candidate.normalizedAnswer ?? candidate.identity)
        .filter((item): item is string => Boolean(item))
        .sort(),
      rejected: (ledger?.previousCandidates ?? [])
        .map((candidate) => candidate.normalizedAnswer ?? candidate.identity)
        .filter((item): item is string => Boolean(item))
        .sort(),
      settled: Boolean(state?.settledClaimId),
      unresolved: state?.unresolved ?? true,
      untouched: Boolean(ledger?.untouched),
    };
  });
  return stableStringify({ entries, conflicts });
}

function crossword(problem: Problem) {
  if (!problem.crossword) {
    throw new Error(`Problem ${problem.id} has no crossword specification`);
  }
  return problem.crossword;
}

function live(node: ReasoningNode): boolean {
  return node.status !== "rejected" && node.status !== "superseded";
}

export function crosswordCandidateAnswer(
  node: {
    type: string;
    text: string;
    metadata?: Record<string, unknown>;
  },
  clue: CrosswordClue,
): string | undefined {
  return candidateAnswer(node, clue);
}

function candidateAnswer(
  node: {
    type: string;
    text: string;
    metadata?: Record<string, unknown>;
  },
  clue: CrosswordClue,
): string | undefined {
  if (node.type === "final_answer") return undefined;
  const metadataAnswer = node.metadata?.answer;
  if (typeof metadataAnswer === "string") {
    const normalized = normalizeCrosswordCandidate(metadataAnswer);
    return normalized || undefined;
  }
  const escapedDirection = clue.direction === "across" ? "(?:across|a)" : "(?:down|d)";
  const assignment = node.text.match(
    new RegExp(
      `(?:${escapedDirection}\\s*${clue.number}|${clue.number}\\s*${escapedDirection})\\s*(?:=|is|:)\\s*([A-Za-z][A-Za-z -]*)`,
      "i",
    ),
  );
  const raw = assignment?.[1] ?? (/^[A-Za-z -]+$/.test(node.text.trim()) ? node.text : "");
  const normalized = normalizeCrosswordCandidate(raw);
  return normalized || undefined;
}

function clueForIssue(problem: Problem, issueId: string): CrosswordClue | undefined {
  return crossword(problem).clues.find(
    (clue) => crosswordIssueId(clue.direction, clue.number) === issueId,
  );
}

function liveCandidates(problem: Problem, graph: ReasoningGraph) {
  const byIssue = new Map<
    string,
    Array<{ nodeId: string; answer: string; identity: string }>
  >();
  for (const clue of crossword(problem).clues) {
    const issueId = crosswordIssueId(clue.direction, clue.number);
    const candidates = graph.nodes
      .filter(
        (node) =>
          live(node) &&
          node.type !== "final_answer" &&
          (node.type === "claim" || node.type === "proposal") &&
          node.subjectId === issueId,
      )
      .map((node) => {
        const answer = candidateAnswer(node, clue);
        return answer
          ? {
              nodeId: node.id,
              answer,
              identity: crosswordCandidateIdentity(issueId, answer),
            }
          : undefined;
      })
      .filter(
        (
          candidate,
        ): candidate is { nodeId: string; answer: string; identity: string } =>
          Boolean(candidate),
      );
    byIssue.set(issueId, candidates);
  }
  return byIssue;
}

export function deriveCrosswordConflicts(
  problem: Problem,
  graph: ReasoningGraph,
): IssueConflict[] {
  const spec = crossword(problem);
  const candidates = liveCandidates(problem, graph);
  const conflicts: IssueConflict[] = [];
  for (const crossing of findCrosswordCrossings(spec.clues)) {
    const acrossIssueId = crosswordIssueId("across", crossing.acrossNumber);
    const downIssueId = crosswordIssueId("down", crossing.downNumber);
    for (const across of candidates.get(acrossIssueId) ?? []) {
      for (const down of candidates.get(downIssueId) ?? []) {
        const acrossLetter = across.answer[crossing.acrossIndex];
        const downLetter = down.answer[crossing.downIndex];
        if (!acrossLetter || !downLetter || acrossLetter === downLetter) continue;
        const description =
          `row ${crossing.row + 1}, col ${crossing.col + 1}: ` +
          `${acrossIssueId} has ${acrossLetter}, ${downIssueId} has ${downLetter}`;
        const nodeIds = [across.nodeId, down.nodeId];
        conflicts.push(
          {
            issueId: acrossIssueId,
            nodeIds,
            source: "task_constraint",
            description,
          },
          {
            issueId: downIssueId,
            nodeIds,
            source: "task_constraint",
            description,
          },
        );
      }
    }
  }
  return conflicts;
}

export function deriveCrosswordForcedLetters(
  problem: Problem,
  graph: ReasoningGraph,
) {
  const spec = crossword(problem);
  const candidates = liveCandidates(problem, graph);
  const signals: Array<{
    id: string;
    issueId: string;
    kind: "evidence";
    nodeIds: string[];
    description: string;
  }> = [];
  for (const crossing of findCrosswordCrossings(spec.clues)) {
    const acrossIssueId = crosswordIssueId("across", crossing.acrossNumber);
    const downIssueId = crosswordIssueId("down", crossing.downNumber);
    for (const candidate of candidates.get(acrossIssueId) ?? []) {
      const letter = candidate.answer[crossing.acrossIndex];
      if (!letter) continue;
      signals.push({
        id: `forced:${candidate.nodeId}:${downIssueId}:${crossing.downIndex}`,
        issueId: downIssueId,
        kind: "evidence",
        nodeIds: [candidate.nodeId],
        description: `${acrossIssueId} candidate forces ${downIssueId} letter ${crossing.downIndex + 1} to ${letter}`,
      });
    }
    for (const candidate of candidates.get(downIssueId) ?? []) {
      const letter = candidate.answer[crossing.downIndex];
      if (!letter) continue;
      signals.push({
        id: `forced:${candidate.nodeId}:${acrossIssueId}:${crossing.acrossIndex}`,
        issueId: acrossIssueId,
        kind: "evidence",
        nodeIds: [candidate.nodeId],
        description: `${downIssueId} candidate forces ${acrossIssueId} letter ${crossing.acrossIndex + 1} to ${letter}`,
      });
    }
  }
  return signals;
}

function deriveCrosswordIssueState(
  problem: Problem,
  issue: IssueConvergenceState,
  graph: ReasoningGraph,
): TaskIssueState {
  const clue = clueForIssue(problem, issue.issueId);
  if (!clue) {
    return { issueId: issue.issueId, valid: true, reasons: [] };
  }
  const candidates = liveCandidates(problem, graph).get(issue.issueId) ?? [];
  const current = candidates.find(
    (candidate) => candidate.nodeId === issue.settledClaimId,
  );
  const reasons: string[] = [];
  if (!issue.settledClaimId) reasons.push("generic issue is not settled");
  if (!current) reasons.push("settled claim has no parseable candidate answer");
  if (current && current.answer.length !== clue.length) {
    reasons.push(`candidate length ${current.answer.length} does not equal ${clue.length}`);
  }
  if (issue.conflicts.some((conflict) => conflict.source === "task_constraint")) {
    reasons.push("candidate violates a crossing constraint");
  }
  return {
    issueId: issue.issueId,
    valid: reasons.length === 0,
    reasons,
    details: {
      candidateCount: candidates.length,
      candidateAnswer: current?.answer,
      candidateIdentity: current?.identity,
      requiredLength: clue.length,
      crosswordSettled: reasons.length === 0,
    },
  };
}

function deriveCrosswordReadiness(
  problem: Problem,
  issueStates: IssueConvergenceState[],
  graph: ReasoningGraph,
  generic: TaskReadiness["generic"],
): TaskReadiness {
  const spec = crossword(problem);
  const taskStates = issueStates
    .filter((state) => clueForIssue(problem, state.issueId))
    .map((state) => deriveCrosswordIssueState(problem, state, graph));
  const crossingConflictCount = issueStates.reduce(
    (sum, state) =>
      sum +
      state.conflicts.filter((conflict) => conflict.source === "task_constraint")
        .length,
    0,
  );
  const invalid = taskStates.filter((state) => !state.valid);
  const completeGrid =
    taskStates.length === spec.clues.length &&
    invalid.length === 0 &&
    generic.allRequiredIssuesSettled;
  const reasons = invalid.flatMap((state) =>
    state.reasons.map((reason) => `${state.issueId}: ${reason}`),
  );
  if (taskStates.length !== spec.clues.length) {
    reasons.push("not every clue has a canonical issue state");
  }
  return {
    ready: completeGrid && crossingConflictCount === 0,
    reasons,
    generic,
    details: {
      clueCount: spec.clues.length,
      crosswordSettledClueCount: taskStates.filter((state) => state.valid).length,
      crossingConflictCount,
      completeGrid,
    },
  };
}

export function crosswordCandidateIdentityForNode(
  problem: Problem,
  node: {
    type: string;
    text: string;
    subjectId?: string;
    metadata?: Record<string, unknown>;
  },
): string | undefined {
  if (node.type !== "claim" && node.type !== "proposal") return undefined;
  if (!node.subjectId) return undefined;
  const clue = clueForIssue(problem, node.subjectId);
  if (!clue) return undefined;
  const answer = candidateAnswer(node, clue);
  if (!answer) return undefined;
  return crosswordCandidateIdentity(node.subjectId, answer);
}

function crossingCompatibility(
  problem: Problem,
  graph: ReasoningGraph,
  issueId: string,
  nodeId: string,
  answer: string,
): { compatibility: TaskCandidateRecord["compatibility"]; crossingDescription?: string } {
  const spec = crossword(problem);
  const liveByIssue = liveCandidates(problem, graph);
  const descriptions: string[] = [];
  let checked = 0;
  let incompatible = false;
  for (const crossing of findCrosswordCrossings(spec.clues)) {
    const acrossIssueId = crosswordIssueId("across", crossing.acrossNumber);
    const downIssueId = crosswordIssueId("down", crossing.downNumber);
    if (issueId !== acrossIssueId && issueId !== downIssueId) continue;
    const otherIssueId = issueId === acrossIssueId ? downIssueId : acrossIssueId;
    const ownIndex = issueId === acrossIssueId ? crossing.acrossIndex : crossing.downIndex;
    const otherIndex = issueId === acrossIssueId ? crossing.downIndex : crossing.acrossIndex;
    const ownLetter = answer[ownIndex];
    if (!ownLetter) continue;
    for (const other of liveByIssue.get(otherIssueId) ?? []) {
      if (other.nodeId === nodeId) continue;
      const otherLetter = other.answer[otherIndex];
      if (!otherLetter) continue;
      checked += 1;
      if (otherLetter === ownLetter) continue;
      incompatible = true;
      descriptions.push(
        `${issueId} requires r${crossing.row + 1}c${crossing.col + 1} = ${ownLetter}; ` +
          `${otherIssueId} requires ${otherLetter}`,
      );
    }
  }
  if (incompatible) {
    return { compatibility: "incompatible", crossingDescription: descriptions[0] };
  }
  if (checked > 0) return { compatibility: "compatible" };
  return { compatibility: "unknown" };
}

function priorOutcome(node: ReasoningNode, graph: ReasoningGraph): string | undefined {
  if (node.status === "superseded") return "superseded";
  if (node.status === "rejected") return "rejected";
  const challenged = stancesForNode(graph, node.id).some(
    (stance) => stance.kind === "challenge",
  );
  return challenged ? "contradicted" : undefined;
}

export function deriveCrosswordCandidateLedger(
  problem: Problem,
  graph: ReasoningGraph,
): TaskIssueLedger[] {
  const spec = crossword(problem);
  return spec.clues.map((clue) => {
    const issueId = crosswordIssueId(clue.direction, clue.number);
    const label = `${clue.direction === "across" ? "Across" : "Down"} ${clue.number}`;
    const nodes = graph.nodes
      .filter(
        (node) =>
          node.type !== "final_answer" &&
          (node.type === "claim" || node.type === "proposal") &&
          node.subjectId === issueId,
      )
      .sort((a, b) => a.createdAtTurn - b.createdAtTurn || a.id.localeCompare(b.id));
    const grouped = new Map<
      string,
      {
        answer: string;
        nodes: ReasoningNode[];
      }
    >();
    for (const node of nodes) {
      const answer = candidateAnswer(node, clue);
      if (!answer) continue;
      const identity = crosswordCandidateIdentity(issueId, answer);
      const group = grouped.get(identity) ?? { answer, nodes: [] };
      group.nodes.push(node);
      grouped.set(identity, group);
    }
    const records: TaskCandidateRecord[] = [];
    for (const [identity, group] of grouped) {
      const latest = group.nodes[group.nodes.length - 1]!;
      const liveNode = [...group.nodes].reverse().find((node) => live(node));
      const representative = liveNode ?? latest;
      const proposedBy = [
        ...new Set(
          group.nodes
            .map((node) => node.createdBy)
            .filter((actor) => actor === "agent_a" || actor === "agent_b"),
        ),
      ];
      const supportedBy: string[] = [];
      const challengedBy: string[] = [];
      let lastTouched = representative.createdAtTurn;
      for (const node of group.nodes) {
        for (const stance of stancesForNode(graph, node.id)) {
          lastTouched = Math.max(lastTouched, stance.turnIndex);
          if (stance.kind === "support" && !supportedBy.includes(stance.actor)) {
            supportedBy.push(stance.actor);
          }
          if (stance.kind === "challenge" && !challengedBy.includes(stance.actor)) {
            challengedBy.push(stance.actor);
          }
        }
      }
      const crossing = live(representative)
        ? crossingCompatibility(
            problem,
            graph,
            issueId,
            representative.id,
            group.answer,
          )
        : { compatibility: "unknown" as const };
      const rejectedNode = group.nodes.find((node) => node.status === "rejected");
      const rejectionReason =
        rejectedNode &&
        stancesForNode(graph, rejectedNode.id).find((stance) => stance.kind === "reject")
          ?.reason;
      records.push({
        nodeId: representative.id,
        identity,
        normalizedAnswer: group.answer,
        createdAtTurn: group.nodes[0]!.createdAtTurn,
        firstProposedTurn: group.nodes[0]!.createdAtTurn,
        lastTouchedTurn: lastTouched,
        live: Boolean(liveNode),
        status: representative.status,
        compatibility: crossing.compatibility,
        crossingDescription: crossing.crossingDescription,
        priorTurns: group.nodes
          .slice(0, -1)
          .map((node) => node.createdAtTurn),
        priorOutcome: priorOutcome(representative, graph),
        proposedBy,
        supportedBy,
        challengedBy,
        rejectionReason:
          rejectionReason ??
          (representative.status === "rejected"
            ? crossing.crossingDescription
            : undefined),
      });
    }
    const liveRecords = records.filter((record) => record.live);
    const previous = records.filter((record) => !record.live);
    const leading = [...liveRecords].sort(
      (a, b) =>
        (b.lastTouchedTurn ?? b.createdAtTurn) -
          (a.lastTouchedTurn ?? a.createdAtTurn) ||
        b.nodeId.localeCompare(a.nodeId),
    )[0];
    const tried: string[] = [];
    for (const record of records) {
      if (record.normalizedAnswer && !tried.includes(record.normalizedAnswer)) {
        tried.push(record.normalizedAnswer);
      }
    }
    const conflicts = deriveCrosswordConflicts(problem, graph)
      .filter((conflict) => conflict.issueId === issueId)
      .map((conflict) => ({
        nodeIds: conflict.nodeIds,
        description: conflict.description,
      }));
    return {
      issueId,
      label,
      liveCandidates: liveRecords,
      previousCandidates: previous,
      triedAnswers: tried,
      conflicts,
      currentCandidate: leading?.normalizedAnswer,
      untouched: records.length === 0,
    };
  });
}

function deriveCrosswordTaskDiagnostics(
  problem: Problem,
  graph: ReasoningGraph,
  issueStates: IssueConvergenceState[],
): Record<string, unknown> {
  const ledgers = deriveCrosswordCandidateLedger(problem, graph);
  const liveCandidates = ledgers.reduce(
    (sum, ledger) => sum + ledger.liveCandidates.length,
    0,
  );
  const incompatibleLiveCandidates = ledgers.reduce(
    (sum, ledger) =>
      sum +
      ledger.liveCandidates.filter((candidate) => candidate.compatibility === "incompatible")
        .length,
    0,
  );
  const crossingConflicts = issueStates.reduce(
    (sum, state) =>
      sum +
      state.conflicts.filter((conflict) => conflict.source === "task_constraint").length,
    0,
  );
  const revisits = graph.events.filter((event) =>
    event.diagnostics?.some((item) => item.startsWith("candidate_revisit")),
  );
  return {
    liveCandidates,
    incompatibleLiveCandidates,
    crossingConflicts,
    conflictsRemainingLive: crossingConflicts,
    candidateRevisits: revisits.length,
    revisitsWithNewEvidence: revisits.filter((event) =>
      event.diagnostics?.some((item) => item.includes("with new evidence")),
    ).length,
    revisitsWithoutNewEvidence: revisits.filter((event) =>
      event.diagnostics?.some((item) => item.includes("without new evidence")),
    ).length,
  };
}

function clueLabel(clue: CrosswordClue): string {
  return `${clue.direction === "across" ? "Across" : "Down"} ${clue.number}`;
}

function compactLabel(clue: CrosswordClue): string {
  return `${clue.number}${clue.direction === "across" ? "A" : "D"}`;
}

function evidenceAliases(node: ReasoningNode): string[] {
  const raw = node.metadata?.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function findEvidenceByAlias(
  graph: ReasoningGraph,
  alias: string,
  subjectId?: string,
): ReasoningNode[] {
  const needle = alias.trim().toLowerCase();
  return graph.nodes.filter((node) => {
    if (node.type !== "evidence") return false;
    if (subjectId && node.subjectId !== subjectId) return false;
    return evidenceAliases(node).some((item) => item.trim().toLowerCase() === needle);
  });
}

function crosswordInitialEvidence(problem: Problem): TaskEvidenceSeed[] {
  return crossword(problem).clues.map((clue) => {
    const label = clueLabel(clue);
    const compact = compactLabel(clue);
    return {
      alias: "clue",
      aliases: [
        "clue",
        "the clue",
        "clue text",
        `${label} clue`,
        `${compact} clue`,
      ],
      text: clue.clue,
      subjectId: crosswordIssueId(clue.direction, clue.number),
      origin: "task" as const,
      kind: "clue",
    };
  });
}

function crosswordBasis(
  problem: Problem,
  graph: ReasoningGraph,
  raw: string,
  context?: { subjectId?: string },
): BasisResolution {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "basis is empty" };
  const lower = trimmed.toLowerCase();
  const subjectId =
    context?.subjectId ??
    resolveCrosswordSubject(problem, trimmed).id;

  if (
    lower === "clue" ||
    lower === "the clue" ||
    lower === "clue text" ||
    / clue$/i.test(trimmed)
  ) {
    const scoped = context?.subjectId;
    if (!scoped) {
      return { error: `basis "${trimmed}" is ambiguous without a subject` };
    }
    const matches = findEvidenceByAlias(graph, "clue", scoped);
    if (matches.length === 1) return { id: matches[0]!.id, relation: "grounds" };
    if (matches.length > 1) {
      return { error: `basis "${trimmed}" is ambiguous` };
    }
    return { error: `basis "${trimmed}" does not match task evidence` };
  }

  const crossing = trimmed.match(
    /crossing(?:s)?(?:\s+with)?\s+(.+)$/i,
  );
  const otherRef = crossing
    ? parseCrosswordSubjectRef(crossing[1]!.trim())
    : parseCrosswordSubjectRef(trimmed);
  if (crossing && otherRef && context?.subjectId) {
    const otherIssueId = crosswordIssueId(otherRef.direction, otherRef.number);
    const otherLabel = `${otherRef.direction === "across" ? "Across" : "Down"} ${otherRef.number}`;
    const otherLive = graph.nodes.find(
      (node) =>
        (node.type === "claim" || node.type === "proposal") &&
        node.subjectId === otherIssueId &&
        node.status !== "rejected" &&
        node.status !== "superseded",
    );
    const description = otherLive
      ? `Crossing with ${otherLabel} (${otherLive.text})`
      : `Crossing with ${otherLabel}`;
    return {
      create: {
        alias: `crossing:${context.subjectId}:${otherIssueId}`,
        aliases: [trimmed, `crossing with ${otherLabel}`],
        text: description,
        subjectId: context.subjectId,
        origin: "deterministic",
        kind: "crossing",
      },
      relation: "supports",
    };
  }

  if (subjectId && subjectId !== context?.subjectId) {
    const clueMatches = findEvidenceByAlias(graph, "clue", subjectId);
    if (clueMatches.length === 1) {
      return { id: clueMatches[0]!.id, relation: "grounds" };
    }
    const live = graph.nodes.find(
      (node) =>
        (node.type === "claim" || node.type === "proposal") &&
        node.subjectId === subjectId &&
        node.status !== "rejected" &&
        node.status !== "superseded",
    );
    if (live) return { id: live.id, relation: "grounds" };
  }

  return {};
}

export const crosswordReasoningAdapter: TaskReasoningAdapter = {
  category: "crossword",
  requireSubjectOnClaims: true,
  requireGroundingOnClaims: true,
  getInitialIssues(problem) {
    return crossword(problem).clues.map((clue) => ({
      id: crosswordIssueId(clue.direction, clue.number),
      kind: "task_defined",
      label: clueLabel(clue),
      prompt: clue.clue,
      description: clue.clue,
      source: "task",
      metadata: {
        direction: clue.direction,
        number: clue.number,
        row: clue.row,
        col: clue.col,
        length: clue.length,
      },
    }));
  },
  getInitialEvidence: crosswordInitialEvidence,
  resolveSubject: resolveCrosswordSubject,
  resolveBasis: crosswordBasis,
  extractMoves: (_problem, message) => extractCrosswordFillMoves(message),
  messageLooksSubstantive: (_problem, message) =>
    crosswordMessageLooksSubstantive(message),
  deriveIssueState: deriveCrosswordIssueState,
  deriveConflicts: deriveCrosswordConflicts,
  candidateIdentity: crosswordCandidateIdentityForNode,
  validateCandidate: validateCrosswordCandidate,
  solverStateFingerprint: crosswordSolverStateFingerprint,
  deriveCandidateLedger: deriveCrosswordCandidateLedger,
  deriveTaskDiagnostics: deriveCrosswordTaskDiagnostics,
  deriveDeterministicEvidence(problem, graph) {
    return [
      ...deriveCrosswordForcedLetters(problem, graph),
      ...deriveCrosswordConflicts(problem, graph).map((conflict, index) => ({
        id: `crossword-conflict:${index + 1}`,
        issueId: conflict.issueId,
        kind: "contradiction" as const,
        nodeIds: conflict.nodeIds,
        description: conflict.description,
      })),
    ];
  },
  deriveProblemReadiness: deriveCrosswordReadiness,
};
