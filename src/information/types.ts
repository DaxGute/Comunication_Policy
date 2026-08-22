/**
 * Asymmetric information: domain-agnostic units + run/conversation snapshots.
 *
 * Generic families (crossword / moral): overlap ∈ [0.5, 1.0]
 *   (1.0 = identical packets; 0.5 = partitioned).
 * Hidden Profile: overlap ∈ [0, 1] = fraction of originally-private units
 *   promoted into shared (0 = authored distributed; 1 = full information).
 * Communication policy (trust / authority / familiarity) never enters the split seed.
 */

export type InformationUnitType =
  | "fact"
  | "context"
  | "testimony"
  | "constraint"
  | "premise"
  | "clue"
  | "lemma"
  | "assumption"
  | "definition"
  | "other";

export type InformationOriginalOwner = "shared" | "A" | "B";
export type InformationRealizedVisibility = "shared" | "a_private" | "b_private";

export type InformationUnit = {
  id: string;
  text: string;
  /** Optional domain tag for inspectability; not shown unless useful. */
  type?: InformationUnitType;
  /** Authored / benchmark visibility category (stable under treatment). */
  visibilityCategory?: string;
  /** Benchmark provenance owner (Hidden Profile). */
  originalOwner?: InformationOriginalOwner;
  /** Authored visibility before overlap treatment. */
  originalVisibility?: InformationRealizedVisibility;
  /** Access after overlap treatment (what agents may cite). */
  realizedVisibility?: InformationRealizedVisibility;
};

/** Public task framing + splitable supporting units. */
export type ProblemInformationStructure = {
  sharedContext: string;
  units: InformationUnit[];
};

/** Discrete overlap values the UI snaps to (crossword / moral). */
export const INFORMATION_OVERLAP_STEPS = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0,
] as const;

export type InformationOverlap = (typeof INFORMATION_OVERLAP_STEPS)[number];

/**
 * Hidden Profile overlap treatment snapshot (researcher / reproducibility).
 * Never injected into agent prompts.
 */
export type HiddenProfileOverlapTreatment = {
  /** Fraction of originally-private units now shared (interpretable dose). */
  privatePromotionRate: number;
  originalSharedIds: string[];
  originalAPrivateIds: string[];
  originalBPrivateIds: string[];
  promotedFromAToSharedIds: string[];
  promotedFromBToSharedIds: string[];
  realizedSharedIds: string[];
  realizedAPrivateIds: string[];
  realizedBPrivateIds: string[];
  authoredSharedCount: number;
  authoredAPrivateCount: number;
  authoredBPrivateCount: number;
  promotedAtoSharedCount: number;
  promotedBtoSharedCount: number;
  realizedSharedCount: number;
  realizedAPrivateCount: number;
  realizedBPrivateCount: number;
  condition: "authored_distributed" | "partial_promotion" | "full";
};

export type InformationAssignmentMode = "balanced-cover";

/**
 * Packet swap direction for optional A/B counterbalancing.
 * `standard`: A gets X, B gets Y. `swapped`: A gets Y, B gets X.
 */
export type InformationPacketDirection = "standard" | "swapped";

/** Run-level information structure (requested; realized lives on the conversation). */
export type InformationStructureConfig = {
  overlapRequested: number;
  /** Deterministic seed material; must NOT include communication-policy values. */
  splitSeed: string;
  assignmentMode: InformationAssignmentMode;
  counterbalanced: boolean;
  packetDirection: InformationPacketDirection;
};

/** Realized partition snapshotted onto each conversation. */
export type InformationAssignment = {
  overlapRequested: number;
  /**
   * Realized dose.
   * Hidden Profile: privatePromotionRate.
   * Generic families: sharedCount / totalUnits.
   */
  overlapRealized: number;
  totalUnits: number;
  sharedUnitIds: string[];
  agentAOnlyUnitIds: string[];
  agentBOnlyUnitIds: string[];
  agentAUnitIds: string[];
  agentBUnitIds: string[];
  /** Exact packet text shown to each agent (researcher audit / reproducibility). */
  agentAPacketText?: string;
  agentBPacketText?: string;
  sharedContextText?: string;
  /** Full unit catalog for inspector (ids + text); never injected into partner prompts. */
  units?: InformationUnit[];
  splitSeed: string;
  assignmentMode: InformationAssignmentMode;
  packetDirection: InformationPacketDirection;
  /** Pre-run sufficiency diagnostics. */
  diagnostics?: InformationSplitDiagnostics;
  /** Hidden Profile graded-overlap treatment (absent on crossword/moral). */
  hiddenProfileTreatment?: HiddenProfileOverlapTreatment;
  /** Alias mirrors of treatment id lists for audit schemas. */
  originalSharedIds?: string[];
  originalAPrivateIds?: string[];
  originalBPrivateIds?: string[];
  promotedFromAToSharedIds?: string[];
  promotedFromBToSharedIds?: string[];
  realizedSharedIds?: string[];
  realizedAPrivateIds?: string[];
  realizedBPrivateIds?: string[];
};

export type InformationSplitDiagnostics = {
  unionCoverage: number;
  packetSizeA: number;
  packetSizeB: number;
  privateCountA: number;
  privateCountB: number;
  sharedCount: number;
  missingRequiredUnitIds: string[];
  warnings: string[];
  /** True when A ∪ B covers every unit id. */
  jointlySufficient: boolean;
};

export type InformationSplitResult = {
  sharedIds: string[];
  agentAOnlyIds: string[];
  agentBOnlyIds: string[];
  agentAIds: string[];
  agentBIds: string[];
  overlapRequested: number;
  overlapRealized: number;
  totalUnits: number;
};

/** Deterministic information-flow metrics (citation / graph based). */
export type InformationFlowMetrics = {
  privateUnitsA: number;
  privateUnitsB: number;
  sharedUnits: number;
  privateUnitsCommunicatedA: number;
  privateUnitsCommunicatedB: number;
  privateUnitsPersistedToGraphA: number;
  privateUnitsPersistedToGraphB: number;
  AInfoUsedByB: number;
  BInfoUsedByA: number;
  transferAtoB: number;
  transferBtoA: number;
  crossAgentPrivateInfoTransferRate: number;
  privateInfoSurvivalToFinal: number;
  unusedPrivateInfoCount: number;
  distortedPrivateInfoCount: number;
  privateInfoBypass: boolean;
  /** Alias fields used by Hidden Profile reporting (same underlying counts). */
  privateInformationCountA?: number;
  privateInformationCountB?: number;
  privateInformationRevealedA?: number;
  privateInformationRevealedB?: number;
  privateInformationWithheldA?: number;
  privateInformationWithheldB?: number;
  timeToRevealA?: number | null;
  timeToRevealB?: number | null;
  partnerPrivateInformationUsedA?: number;
  partnerPrivateInformationUsedB?: number;
  timeToPartnerUptake?: number | null;
  crossAgentRevisionCount?: number;
  AtoBInfluence?: number;
  BtoAInfluence?: number;
  finalCoverageOfAPrivateInformation?: number;
  finalCoverageOfBPrivateInformation?: number;
  decisiveInformationCoverage?: number | null;
};
