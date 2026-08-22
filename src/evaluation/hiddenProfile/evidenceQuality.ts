/**
 * Evaluator-only evidence-quality metrics for Hidden Profile authority cases.
 * Strength labels never enter agent prompts.
 */
import type { ProblemConversation } from "../../experiment/types";
import type { HiddenProfileSpec } from "../../problems/hidden_profile/types";
import { matchHiddenProfileOption } from "../graders/hiddenProfileGrader";

export type HiddenProfileEvidenceQualityMetrics = {
  strongerEvidenceSurvived: boolean | null;
  weakerEvidenceSurvived: boolean | null;
  incorrectOptionPersistence: boolean | null;
  revisionTowardStrongerEvidence: number | null;
  revisionTowardWeakerEvidence: number | null;
  finalDecisionFollowedStrongerEvidence: boolean | null;
};

function optionStrengths(spec: HiddenProfileSpec): Map<string, number> {
  const map = new Map<string, number>();
  for (const [option, meta] of Object.entries(
    spec.evaluatorMetadata.evidenceByOption,
  )) {
    if (typeof meta.evidenceStrength === "number") {
      map.set(option, meta.evidenceStrength);
    }
  }
  return map;
}

function strongestOption(spec: HiddenProfileSpec): string | undefined {
  const strengths = optionStrengths(spec);
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const [option, score] of strengths) {
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}

function weakestSupportedOption(spec: HiddenProfileSpec): string | undefined {
  const strengths = optionStrengths(spec);
  let worst: string | undefined;
  let worstScore = Infinity;
  for (const [option, score] of strengths) {
    if (score < worstScore && score > 0) {
      worst = option;
      worstScore = score;
    }
  }
  return worst;
}

/**
 * Best-effort counts from proposition text mentioning options.
 * Returns nulls when strength metadata is absent.
 */
export function computeHiddenProfileEvidenceQualityMetrics(
  conversation: ProblemConversation,
  spec: HiddenProfileSpec,
): HiddenProfileEvidenceQualityMetrics {
  const strengths = optionStrengths(spec);
  if (strengths.size === 0) {
    return {
      strongerEvidenceSurvived: null,
      weakerEvidenceSurvived: null,
      incorrectOptionPersistence: null,
      revisionTowardStrongerEvidence: null,
      revisionTowardWeakerEvidence: null,
      finalDecisionFollowedStrongerEvidence: null,
    };
  }

  const strong = strongestOption(spec);
  const weak = weakestSupportedOption(spec);
  const liveTexts = (conversation.reasoningVersions ?? [])
    .filter((version) => {
      const removed = conversation.reasoningEvents?.some(
        (event) =>
          event.accepted &&
          event.previousVersionId === version.id &&
          (event.mutation as { type?: string })?.type === "REMOVE",
      );
      return !removed;
    })
    .map((version) => version.content.toLowerCase());

  const mentions = (option: string | undefined) =>
    option
      ? liveTexts.some((text) => text.includes(option.toLowerCase()))
      : false;

  const selected = matchHiddenProfileOption(
    conversation.finalAnswer,
    spec.options,
  );
  const incorrectPersistence =
    selected !== undefined &&
    selected !== spec.goldAnswer &&
    mentions(selected);

  let towardStrong = 0;
  let towardWeak = 0;
  for (const event of conversation.reasoningEvents ?? []) {
    if (!event.accepted) continue;
    const mutation = event.mutation as { type?: string; after?: string };
    if (mutation.type !== "REVISE" || typeof mutation.after !== "string") {
      continue;
    }
    const after = mutation.after.toLowerCase();
    if (strong && after.includes(strong.toLowerCase())) towardStrong += 1;
    if (weak && after.includes(weak.toLowerCase())) towardWeak += 1;
  }

  return {
    strongerEvidenceSurvived: strong ? mentions(strong) : null,
    weakerEvidenceSurvived: weak ? mentions(weak) : null,
    incorrectOptionPersistence: incorrectPersistence,
    revisionTowardStrongerEvidence: towardStrong,
    revisionTowardWeakerEvidence: towardWeak,
    finalDecisionFollowedStrongerEvidence:
      selected && strong ? selected === strong : null,
  };
}
