/**
 * Asymmetric information: domain-agnostic units + run/conversation snapshots.
 *
 * Overlap is the control variable (1.0 = identical packets; 0.5 = partitioned).
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

export type InformationUnit = {
  id: string;
  text: string;
  /** Optional domain tag for inspectability; not shown unless useful. */
  type?: InformationUnitType;
  visibilityCategory?: string;
};

/** Public task framing + splitable supporting units. */
export type ProblemInformationStructure = {
  sharedContext: string;
  units: InformationUnit[];
};

/** Discrete overlap values the UI snaps to. */
export const INFORMATION_OVERLAP_STEPS = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0,
] as const;

export type InformationOverlap = (typeof INFORMATION_OVERLAP_STEPS)[number];

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
};
