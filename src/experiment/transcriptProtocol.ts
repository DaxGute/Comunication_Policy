/**
 * Versioned description of how agent context is constructed.
 *
 * graph-memory-v3 (current):
 * Persistent conversational memory is the canonical reasoning graph.
 * The model also receives the immediately previous partner utterance.
 * REVISE uses fromVersionId. Moral graphs start empty (agent-created
 * considerations only). Legacy seeding aliases are not an active mode.
 * considerations); question/stance are not subjects.
 *
 * graph-memory-v2:
 * Same revise contract, but moral runs could seed explicit-task considerations.
 *
 * graph-memory-v1:
 * REVISE required an exact `before` string; moral runs often seeded
 * question/stance lanes.
 *
 * full-history-v1 (legacy runs):
 * Prior utterances were sent as Chat Completions `assistant` messages whose
 * content was prefixed `[Agent A]:` / `[Agent B]:`.
 *
 * Policy sliders (trust / authority / familiarity) compile into the system
 * prompt only. They must never change which history messages are attached.
 */

export type TranscriptSpeakerRepresentation =
  | "prefixed-assistant"
  | "previous-partner-user";

export type ReviseContract = "exact-before" | "from-version-id";

export type MoralSubjectPolicy =
  | "question-stance-tensions"
  | "considerations-only"
  | "agent-created";

export type MoralInitialization = "agent-created";

export type TranscriptProtocol =
  | {
      version: "full-history-v1";
      historyMode: "full";
      summarization: false;
      truncation: false;
      crossProblemMemory: false;
      speakerRepresentation: "prefixed-assistant";
    }
  | {
      version: "graph-memory-v1";
      historyMode: "previous-utterance";
      persistentMemory: "canonical-graph";
      summarization: false;
      truncation: false;
      crossProblemMemory: false;
      speakerRepresentation: "previous-partner-user";
      reviseContract: "exact-before";
      moralSubjectPolicy: "question-stance-tensions";
      moralInitialization?: never;
      moralLegacySubjects?: never;
    }
  | {
      version: "graph-memory-v2";
      historyMode: "previous-utterance";
      persistentMemory: "canonical-graph";
      summarization: false;
      truncation: false;
      crossProblemMemory: false;
      speakerRepresentation: "previous-partner-user";
      reviseContract: "from-version-id";
      moralSubjectPolicy: "considerations-only";
      moralInitialization?: "explicit-task-seeded";
      moralLegacySubjects?: false;
    }
  | {
      version: "graph-memory-v3";
      historyMode: "previous-utterance";
      persistentMemory: "canonical-graph";
      summarization: false;
      truncation: false;
      crossProblemMemory: false;
      speakerRepresentation: "previous-partner-user";
      reviseContract: "from-version-id";
      moralSubjectPolicy: "agent-created" | "considerations-only";
      moralInitialization: MoralInitialization;
      moralLegacySubjects: false;
    };

export const FULL_HISTORY_TRANSCRIPT_PROTOCOL: Extract<
  TranscriptProtocol,
  { version: "full-history-v1" }
> = {
  version: "full-history-v1",
  historyMode: "full",
  summarization: false,
  truncation: false,
  crossProblemMemory: false,
  speakerRepresentation: "prefixed-assistant",
};

export const GRAPH_MEMORY_V1_TRANSCRIPT_PROTOCOL: Extract<
  TranscriptProtocol,
  { version: "graph-memory-v1" }
> = {
  version: "graph-memory-v1",
  historyMode: "previous-utterance",
  persistentMemory: "canonical-graph",
  summarization: false,
  truncation: false,
  crossProblemMemory: false,
  speakerRepresentation: "previous-partner-user",
  reviseContract: "exact-before",
  moralSubjectPolicy: "question-stance-tensions",
};

/** @deprecated Use GRAPH_MEMORY_V1_TRANSCRIPT_PROTOCOL for historical v1 shape. */
export const GRAPH_MEMORY_V1_PROTOCOL = GRAPH_MEMORY_V1_TRANSCRIPT_PROTOCOL;

export const GRAPH_MEMORY_V2_TRANSCRIPT_PROTOCOL: Extract<
  TranscriptProtocol,
  { version: "graph-memory-v2" }
> = {
  version: "graph-memory-v2",
  historyMode: "previous-utterance",
  persistentMemory: "canonical-graph",
  summarization: false,
  truncation: false,
  crossProblemMemory: false,
  speakerRepresentation: "previous-partner-user",
  reviseContract: "from-version-id",
  moralSubjectPolicy: "considerations-only",
  moralInitialization: "explicit-task-seeded",
  moralLegacySubjects: false,
};

export const GRAPH_MEMORY_TRANSCRIPT_PROTOCOL: Extract<
  TranscriptProtocol,
  { version: "graph-memory-v3" }
> = {
  version: "graph-memory-v3",
  historyMode: "previous-utterance",
  persistentMemory: "canonical-graph",
  summarization: false,
  truncation: false,
  crossProblemMemory: false,
  speakerRepresentation: "previous-partner-user",
  reviseContract: "from-version-id",
  moralSubjectPolicy: "agent-created",
  moralInitialization: "agent-created",
  moralLegacySubjects: false,
};

/** Snapshot protocol for a new run. Moral graphs are always agent-created. */
export function graphMemoryProtocolFor(_args?: {
  moralInitialization?: MoralInitialization;
}): Extract<TranscriptProtocol, { version: "graph-memory-v3" }> {
  return { ...GRAPH_MEMORY_TRANSCRIPT_PROTOCOL };
}

/** Historical runs without the field used full-history prefixed-assistant. */
export function resolveTranscriptProtocol(raw: unknown): TranscriptProtocol {
  if (!raw || typeof raw !== "object") {
    return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
  }
  const parsed = raw as Partial<TranscriptProtocol> & { version?: string };
  if (parsed.version === "graph-memory-v3") {
    return { ...GRAPH_MEMORY_TRANSCRIPT_PROTOCOL };
  }
  if (parsed.version === "graph-memory-v2") {
    return { ...GRAPH_MEMORY_V2_TRANSCRIPT_PROTOCOL };
  }
  if (parsed.version === "graph-memory-v1") {
    return { ...GRAPH_MEMORY_V1_TRANSCRIPT_PROTOCOL };
  }
  if (parsed.version === "full-history-v1") {
    return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
  }
  return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
}

export function isGraphMemoryProtocol(
  protocol: TranscriptProtocol,
): protocol is Extract<
  TranscriptProtocol,
  { version: "graph-memory-v1" | "graph-memory-v2" | "graph-memory-v3" }
> {
  return (
    protocol.version === "graph-memory-v1" ||
    protocol.version === "graph-memory-v2" ||
    protocol.version === "graph-memory-v3"
  );
}
