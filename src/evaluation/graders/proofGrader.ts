/**
 * Collaborative proof evaluation.
 * These items do not have objectively scored gold answers — we record whether
 * a joint proof was submitted and lightweight proof-structure signals.
 */

export type ProofGrade = {
  label: "proof_submitted" | "open";
  proof?: string;
  proofMarkerCount: number;
  notes: string;
};

const PROOF_MARKERS = [
  /\bassume\b/i,
  /\bsuppose\b/i,
  /\blet\b/i,
  /\btherefore\b/i,
  /\bthus\b/i,
  /\bhence\b/i,
  /\bcontradiction\b/i,
  /\bq\.?e\.?d\.?\b/i,
  /\blemma\b/i,
  /\bdefinition\b/i,
  /\bby induction\b/i,
  /\bwithout loss of generality\b/i,
  /\bit follows\b/i,
  /\bwe show\b/i,
  /\bwe claim\b/i,
  /\bprove\b/i,
];

const MIN_PROOF_CHARS = 80;

export function gradeProofConversation(args: {
  finalAnswer?: string;
  messages: Array<{ content: string }>;
}): ProofGrade {
  const proof = args.finalAnswer?.trim();
  const transcript = [
    ...args.messages.map((m) => m.content),
    proof ?? "",
  ].join("\n");
  const proofMarkerCount = PROOF_MARKERS.reduce(
    (count, re) => count + (re.test(transcript) ? 1 : 0),
    0,
  );

  if (!proof || proof.length < MIN_PROOF_CHARS) {
    return {
      label: "open",
      proofMarkerCount,
      notes:
        proof && proof.length > 0
          ? `FINAL_ANSWER too short for a joint proof (${proof.length} chars). Not scored for correctness.`
          : "No FINAL_ANSWER proof extracted. Collaborative proof item — not scored for correctness.",
    };
  }

  return {
    label: "proof_submitted",
    proof,
    proofMarkerCount,
    notes: `Joint proof recorded (${proof.length} chars, ${proofMarkerCount} proof-structure signals). Reference solution kept for inspectability only — not scored for objective correctness.`,
  };
}
