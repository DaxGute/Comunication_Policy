/**
 * Open-ended moral / philosophical evaluation.
 * These items do not have gold answers — we only record whether a stance
 * was articulated and lightweight transcript signals for later metrics.
 */

export type MoralGrade = {
  label: "stance_reached" | "open";
  stance?: string;
  exploredTensionCount: number;
  notes: string;
};

const TENSION_MARKERS = [
  /however\b/i,
  /on the other hand\b/i,
  /whereas\b/i,
  /trade[- ]?off/i,
  /conflict(?:ing)?\b/i,
  /counter(?:argument)?\b/i,
  /uncertainty\b/i,
  /principle\b/i,
];

export function gradeMoralConversation(args: {
  finalAnswer?: string;
  messages: Array<{ content: string }>;
}): MoralGrade {
  const stance = args.finalAnswer?.trim();
  const transcript = args.messages.map((m) => m.content).join("\n");
  const exploredTensionCount = TENSION_MARKERS.reduce(
    (count, re) => count + (re.test(transcript) ? 1 : 0),
    0,
  );

  if (!stance) {
    return {
      label: "open",
      exploredTensionCount,
      notes:
        "No FINAL_ANSWER stance extracted. Open-ended item — not scored for correctness.",
    };
  }

  return {
    label: "stance_reached",
    stance,
    exploredTensionCount,
    notes:
      "Stance recorded. Open-ended item — not scored for objective correctness.",
  };
}
