/**
 * Versioned description of how agent context is constructed.
 *
 * Speaker-representation decision (full-history-v1):
 * Prior utterances are sent as Chat Completions `assistant` messages whose
 * content is prefixed `[Agent A]:` / `[Agent B]:`.
 *
 * Alternatives considered and rejected:
 * - Per-speaker user/assistant role flipping would give A and B different
 *   views of the same transcript, violating information symmetry.
 * - OpenAI's optional message `name` field is not reliably honored across
 *   models (especially reasoning models), is stripped by our generate API
 *   (role+content only), and adding it would change tokenization vs already
 *   collected runs. Prefixes in content are provider-independent and visible
 *   to every model we actually call.
 *
 * Policy sliders (trust / authority / familiarity) compile into the system
 * prompt only. They must never change which history messages are attached.
 */

export type TranscriptSpeakerRepresentation = "prefixed-assistant";

export type TranscriptProtocol = {
  version: "full-history-v1";
  historyMode: "full";
  summarization: false;
  truncation: false;
  crossProblemMemory: false;
  speakerRepresentation: TranscriptSpeakerRepresentation;
};

export const FULL_HISTORY_TRANSCRIPT_PROTOCOL: TranscriptProtocol = {
  version: "full-history-v1",
  historyMode: "full",
  summarization: false,
  truncation: false,
  crossProblemMemory: false,
  speakerRepresentation: "prefixed-assistant",
};

/** Historical runs predate the persisted field but always used this protocol. */
export function resolveTranscriptProtocol(
  raw: unknown,
): TranscriptProtocol {
  if (!raw || typeof raw !== "object") {
    return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
  }
  const parsed = raw as Partial<TranscriptProtocol>;
  if (parsed.version === "full-history-v1") {
    return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
  }
  return { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL };
}
