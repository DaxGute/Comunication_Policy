/**
 * Lossless, compact serialization of canonical state for the model.
 * Current value first, declared provenance, then revision history.
 *
 * Moral graphs present every lane as a consideration. Crossword and Hidden
 * Profile share the same SET/REVISE/REMOVE kernel; Hidden Profile starts empty.
 * keep subject titles. The original task and the final answer are not rows.
 *
 * Agent-facing rows expose stable version ids. Do not copy display chrome
 * into mutations — REVISE with fromVersionId.
 */
import { agentLabel } from "../agents/identity";
import { propositionCommitment } from "./commitment";
import { subjectDisplayTitle } from "./ids";
import {
  versionsForSubject,
  type PropositionVersion,
  type ReasoningGraph,
  type ReasoningSubject,
} from "./types";

export type FormatReasoningStateOptions = Record<string, never>;

function agentName(agentId: PropositionVersion["agentId"]): string {
  return agentLabel(agentId);
}

function subjectTitle(subject: ReasoningSubject): string {
  return subjectDisplayTitle(subject);
}

export function graphUsesConsiderationLanes(graph: ReasoningGraph): boolean {
  const ids = [
    ...(graph.subjects ?? []).map((subject) => subject.id),
    ...graph.versions.map((version) => version.subjectId),
  ];
  return ids.some((id) =>
    id.trim().replace(/\s+/g, "").toLowerCase().startsWith("moral:"),
  );
}

function historyLine(version: PropositionVersion): string {
  return `${version.id} — ${agentName(version.agentId)}, turn ${version.turn} — "${version.content}"`;
}

function formatSubject(
  graph: ReasoningGraph,
  subject: ReasoningSubject,
  asConsideration: boolean,
): string[] {
  const history = versionsForSubject(graph, subject.id);
  const current = history.find((version) => version.status === "active");
  const title = subjectTitle(subject);
  const lines = asConsideration
    ? [`CONSIDERATION: ${title}`]
    : [`[${title}]`];
  if (title !== subject.id) {
    lines.push(`Id: ${subject.id}`);
  }
  if (asConsideration) {
    const first = history[0];
    const who =
      subject.createdBy === "agent_a" || subject.createdBy === "agent_b"
        ? agentLabel(subject.createdBy)
        : first
          ? agentName(first.agentId)
          : "an agent";
    const when =
      typeof subject.createdAtTurn === "number"
        ? `, turn ${subject.createdAtTurn}`
        : first
          ? `, turn ${first.turn}`
          : "";
    lines.push(`Created by: ${who}${when}`);
  }
  if (current) {
    lines.push(`Current version: ${current.id}`);
    if (!asConsideration) {
      const commitment = propositionCommitment(current);
      lines.push(
        `${agentName(current.agentId)}, turn ${current.turn} [${commitment}]`,
      );
    } else {
      lines.push(`${agentName(current.agentId)}, turn ${current.turn}`);
    }
    lines.push("Content:");
    lines.push(`"${current.content}"`);
    const basis = (current.derivedFromVersionIds ?? [])
      .map((id) => graph.versions.find((version) => version.id === id))
      .filter((version): version is PropositionVersion => Boolean(version));
    if (basis.length > 0) {
      lines.push("Derived from:");
      for (const version of basis) {
        const basisSubject = graph.subjects.find(
          (item) => item.id === version.subjectId,
        );
        const basisTitle = subjectDisplayTitle(
          basisSubject ?? { id: version.subjectId },
        );
        lines.push(`- ${version.id} — ${agentName(version.agentId)} (${basisTitle})`);
      }
    }
  } else {
    const removed = [...history].reverse().find((version) => version.status === "removed");
    lines.push("Current: (none)");
    if (removed) lines.push(`Last removed version: ${removed.id}`);
  }
  if (history.length > 0) {
    lines.push("History:");
    for (const version of history) {
      lines.push(historyLine(version));
    }
  }
  return lines;
}

export function formatReasoningState(
  graph: ReasoningGraph,
  _options: FormatReasoningStateOptions = {},
): string {
  const header = "CURRENT SHARED REASONING STATE";
  if (graph.schemaVersion === 1) {
    return `${header}\n\n(legacy dense graph — not used as agent memory)`;
  }
  const subjects = graph.subjects ?? [];
  const known = new Set(subjects.map((subject) => subject.id));
  const extraIds = [
    ...new Set(
      graph.versions
        .map((version) => version.subjectId)
        .filter((id) => !known.has(id)),
    ),
  ];
  const allSubjects: ReasoningSubject[] = [
    ...subjects,
    ...extraIds.map((id) => ({ id, source: "agent" as const })),
  ];
  const emptyMemory = [
    header,
    "",
    "No persistent considerations have been established yet.",
    "",
    "Create only considerations that are important enough to survive after this message leaves context.",
  ].join("\n");

  if (allSubjects.length === 0) {
    return emptyMemory;
  }

  // Moral/consideration graphs must never expose empty pre-created lanes.
  // Crossword may still list task-defined subjects with Current: (none).
  // Hidden Profile / Moral omit empty lanes until agents create them.
  const looksMoral = allSubjects.every((subject) =>
    subject.id.trim().replace(/\s+/g, "").toLowerCase().startsWith("moral:"),
  );
  const withState = allSubjects.filter((subject) => {
    const hasVersions = graph.versions.some(
      (version) => version.subjectId === subject.id,
    );
    if (hasVersions) return true;
    if (looksMoral || graphUsesConsiderationLanes(graph)) return false;
    return subject.source === "task";
  });
  if (withState.length === 0) {
    return emptyMemory;
  }
  const asConsideration =
    graphUsesConsiderationLanes(graph) || looksMoral;
  const lines = [header, ""];
  for (const subject of withState) {
    lines.push(...formatSubject(graph, subject, asConsideration));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function reasoningStateUserMessage(graph: ReasoningGraph): string {
  return formatReasoningState(graph);
}

export function graphSerializationDiagnostics(serialized: string): {
  graphSerializedChars: number;
} {
  return { graphSerializedChars: serialized.length };
}
