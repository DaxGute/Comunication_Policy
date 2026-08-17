/**
 * Shared labels and accessors for belief-dynamics metrics.
 *
 * Both evaluation UI and dashboard axes consume this catalog. Keeping it in
 * the evaluation domain prevents pure metric metadata from depending on React.
 */
import type {
  BeliefAuthorityMetrics,
  BeliefCrossPolicyMetrics,
  BeliefDirectionalFraction,
  BeliefDynamicsMetrics,
  BeliefFamiliarityMetrics,
  BeliefFraction,
  BeliefTrustMetrics,
  BeliefTruthSplit,
} from "../types";

/** Hidden in the UI until we decide how to present these groups. */
export const SHOW_CROSS_POLICY_AND_TRUTH = false;

export type DirectionalMetricSpec<T> = {
  label: string;
  pick: (metrics: T) => BeliefDirectionalFraction;
  hint?: string;
};

export type FractionMetricSpec<T> = {
  label: string;
  pick: (metrics: T) => BeliefFraction;
};

export type TruthSplitMetricSpec = {
  label: string;
  pick: (
    metrics: NonNullable<BeliefDynamicsMetrics["truthConditioned"]>,
  ) => BeliefTruthSplit;
};

export const TRUST_DIRECTIONAL: DirectionalMetricSpec<BeliefTrustMetrics>[] = [
  { label: "Proposal acceptance", pick: (t) => t.proposalAcceptance },
  { label: "Unsupported acceptance", pick: (t) => t.unsupportedAcceptance },
  { label: "Independent verification", pick: (t) => t.independentVerification },
  { label: "Correction rate", pick: (t) => t.correctionRate },
  { label: "Error propagation", pick: (t) => t.errorPropagation },
  { label: "Challenge before acceptance", pick: (t) => t.challengeBeforeAcceptance },
  { label: "Correct-claim uptake", pick: (t) => t.correctClaimUptake },
  { label: "Incorrect-claim rejection", pick: (t) => t.incorrectClaimRejection },
  { label: "Reconsideration", pick: (t) => t.reconsiderationRate },
  { label: "Confidence transfer", pick: (t) => t.confidenceTransfer },
  { label: "Accept | supported", pick: (t) => t.evidenceSensitivity.supported },
  { label: "Accept | unsupported", pick: (t) => t.evidenceSensitivity.unsupported },
  {
    label: "P(accept | correct)",
    pick: (t) => t.trustCalibration.acceptGivenCorrect,
  },
  {
    label: "P(accept | incorrect)",
    pick: (t) => t.trustCalibration.acceptGivenIncorrect,
  },
];

export const AUTHORITY_DIRECTIONAL: DirectionalMetricSpec<BeliefAuthorityMetrics>[] = [
  {
    label: "Proposal survival after disagreement",
    pick: (a) => a.proposalSurvivalAfterDisagreement,
  },
  { label: "Directional deference", pick: (a) => a.directionalDeference },
  { label: "Challenge rate", pick: (a) => a.challengeRate },
  {
    label: "Disagreement win rate",
    pick: (a) => a.disagreementWinRate,
    hint: "A→B / B→A = challenger win rate; overall = challenger wins",
  },
  {
    label: "Revision asymmetry",
    pick: (a) => a.revisionAsymmetry,
    hint: "P(A revises | B challenges) vs P(B revises | A challenges)",
  },
  { label: "Challenge success", pick: (a) => a.challengeSuccessAsymmetry },
  {
    label: "Authority-induced error adoption",
    pick: (a) => a.authorityInducedErrorAdoption,
  },
  {
    label: "Authority-induced correction",
    pick: (a) => a.authorityInducedCorrection,
  },
  {
    label: "Persistence under counterevidence",
    pick: (a) => a.persistenceUnderCounterevidence,
  },
];

export const FAMILIARITY_FRACTIONS: FractionMetricSpec<BeliefFamiliarityMetrics>[] = [
  { label: "Repeated information", pick: (f) => f.repeatedInformationRate },
  { label: "Explicit reference", pick: (f) => f.explicitReferenceRate },
  { label: "Clarification frequency", pick: (f) => f.clarificationFrequency },
  { label: "Information density", pick: (f) => f.informationDensity },
  { label: "Misunderstanding frequency", pick: (f) => f.misunderstandingFrequency },
  {
    label: "Misunderstanding correction",
    pick: (f) => f.misunderstandingCorrectionRate,
  },
  { label: "Redundant re-derivation", pick: (f) => f.redundantRederivationRate },
  { label: "Common-ground reuse", pick: (f) => f.commonGroundReuse },
  {
    label: "Reference resolution success",
    pick: (f) => f.referenceResolutionSuccess,
  },
  { label: "Contextual shorthand", pick: (f) => f.contextualShorthandRate },
  { label: "Coordination overhead", pick: (f) => f.coordinationOverhead },
  { label: "Duplicate work", pick: (f) => f.duplicateWorkRate },
  { label: "Novel information", pick: (f) => f.novelInformationRate },
  {
    label: "Information reuse efficiency",
    pick: (f) => f.informationReuseEfficiency,
  },
  { label: "Compression failure", pick: (f) => f.compressionFailureRate },
  { label: "Turns-to-progress", pick: (f) => f.turnToProgressEfficiency },
  { label: "Tokens-to-progress", pick: (f) => f.tokenToProgressEfficiency },
];

export const CROSS_POLICY_FRACTIONS: FractionMetricSpec<BeliefCrossPolicyMetrics>[] = [
  { label: "Epistemic diversity", pick: (c) => c.epistemicDiversity },
  { label: "Premature convergence", pick: (c) => c.prematureConvergence },
  {
    label: "Recovery from false consensus",
    pick: (c) => c.recoveryFromFalseConsensus,
  },
  { label: "Useful disagreement", pick: (c) => c.usefulDisagreementRate },
  { label: "Wasted disagreement", pick: (c) => c.wastedDisagreementRate },
  {
    label: "P(consensus | correct)",
    pick: (c) => c.convergenceQuality.correctConsensus,
  },
  {
    label: "P(consensus | incorrect)",
    pick: (c) => c.convergenceQuality.falseConsensus,
  },
];

export const TRUTH_SPLITS: TruthSplitMetricSpec[] = [
  { label: "Partner acceptance", pick: (t) => t.partnerAcceptance },
  { label: "Partner reinforcement", pick: (t) => t.partnerReinforcement },
  { label: "Partner deference", pick: (t) => t.partnerDeference },
  { label: "Proposal survival", pick: (t) => t.proposalSurvival },
  { label: "Challenges against", pick: (t) => t.challengesAgainst },
];
