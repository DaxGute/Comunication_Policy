/**
 * Cross-source patterns from MARBLE + interaction dynamics.
 * Task-independent labels for later analysis.
 */
import type { MarbleEvaluation } from "../types";
import type { CrossSourcePattern, InteractionEvaluation } from "./types";

export function deriveCrossSourcePatterns(
  interaction: InteractionEvaluation,
  marble?: MarbleEvaluation,
): CrossSourcePattern[] {
  const patterns: CrossSourcePattern[] = [];
  const comm = marble?.communicationScore;
  const coord = marble?.coordinationScore;
  const mutation = interaction.interaction.efficiency.graphMutationsPerTurn;
  const repetition = interaction.interaction.efficiency.repetition.rate;
  const productive = interaction.interaction.efficiency.productiveEventsPerTurn;
  const depth = interaction.interaction.reasoningDevelopment.graphDepth.maximum;
  const adoption = interaction.interaction.adoption.adoption.overall.rate;
  const verification =
    interaction.interaction.verification.independentVerification.overall.rate;
  const challenge = interaction.interaction.challenges.frequency.rate;
  const correction = interaction.interaction.corrections.corrected.rate;

  if (
    typeof comm === "number" &&
    comm >= 3.5 &&
    (mutation === null || mutation < 0.4) &&
    (repetition ?? 0) > 0.3
  ) {
    patterns.push("fluent_stagnation");
  }
  if (
    typeof coord === "number" &&
    coord >= 3.5 &&
    (productive ?? 0) >= 0.5 &&
    (depth ?? 0) >= 1
  ) {
    patterns.push("coordinated_progress");
  }
  if (
    typeof coord === "number" &&
    coord >= 3.5 &&
    (adoption ?? 0) >= 0.5 &&
    (verification === null || verification < 0.25) &&
    (challenge === null || challenge < 0.2)
  ) {
    patterns.push("deferential_coordination");
  }
  if ((challenge ?? 0) >= 0.2 && (correction ?? 0) >= 0.2) {
    patterns.push("adversarial_productive");
  }
  return patterns;
}
