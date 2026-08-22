/**
 * Universal interaction ontology for post-hoc evaluation.
 *
 * Task adapters ground utterances into these objects/events. The evaluator
 * measures agent interaction identically across crossword, hidden profile, and moral
 * tasks. Task-specific fields live only on `taskGrounding`.
 */
import type { AgentId } from "../../agents/types";
import type { ProblemCategory } from "../../problems/types";
import type { BeliefDirectionalFraction, BeliefFraction } from "../types";

export type InteractionAgentId = Extract<AgentId, "agent_a" | "agent_b">;

export type ReasoningObjectKind =
  | "claim"
  | "idea"
  | "evidence"
  | "axiom"
  | "assumption"
  | "proposal"
  | "conclusion"
  | "question"
  | "answer"
  | "task_action";

export type TaskGrounding = {
  kind: string;
  clueId?: string;
  theoremComponent?: string;
  subjectId?: string;
  identity?: string;
  extra?: Record<string, unknown>;
};

export type ReasoningObject = {
  id: string;
  canonicalId: string;
  kind: ReasoningObjectKind;
  text: string;
  originatingAgent: InteractionAgentId | "system";
  firstTurn: number;
  subsequentTurns: number[];
  supportingAgents: InteractionAgentId[];
  challengingAgents: InteractionAgentId[];
  supersedes?: string;
  supersededBy?: string[];
  parentIds: string[];
  childIds: string[];
  inFinalPosition: boolean;
  status: string;
  confidence?: number;
  unsupported: boolean;
  taskGrounding?: TaskGrounding;
};

export type InteractionEventType =
  | "introduced"
  | "supported"
  | "challenged"
  | "verified"
  | "independently_derived"
  | "adopted"
  | "accepted"
  | "rejected"
  | "revised"
  | "corrected"
  | "withdrawn"
  | "superseded"
  | "clarified"
  | "requested_clarification"
  | "repeated"
  | "referenced"
  | "misunderstood"
  | "repaired"
  | "synthesized"
  | "conceded"
  | "proposed_action"
  | "executed_action"
  | "reverted_action"
  | "finalized"
  | "unsupported_adoption";

export type InteractionEventSource =
  | "graph"
  | "transcript"
  | "task_state"
  | "combined"
  | "semantic";

export type InteractionEvent = {
  id: string;
  type: InteractionEventType;
  actor: InteractionAgentId | "system";
  targetAgent?: InteractionAgentId;
  turn: number;
  objectId?: string;
  relatedObjectIds?: string[];
  source: InteractionEventSource;
  evidenceTurns: number[];
  confidence?: number;
};

/**
 * Rate with an explicit opportunity denominator.
 * `rate` is null when there were no opportunities.
 */
export type OpportunityRate = {
  opportunities: number;
  events: number;
  rate: number | null;
};

export type DirectionalOpportunity = {
  aToB: OpportunityRate;
  bToA: OpportunityRate;
  overall: OpportunityRate;
};

export type AgentCounts = {
  agent_a: number;
  agent_b: number;
};

export type SemanticAnnotation = {
  turn: number;
  type: string;
  actor: InteractionAgentId;
  targetAgent?: InteractionAgentId;
  objectId?: string;
  confidence?: number;
  evidence?: string;
};

export type InteractionTrajectoryPoint = {
  turn: number;
  speaker?: InteractionAgentId;
  introduced: number;
  supported: number;
  challenged: number;
  adopted: number;
  revised: number;
  corrected: number;
  withdrawn: number;
  reasoningObjectCount: number;
  activeBranchCount: number;
  graphDepth: number | null;
  mutations: number;
  aInfluence: number;
  bInfluence: number;
  taskProgress?: number | null;
};

export type ContributionMetrics = {
  introducedByAgent: AgentCounts;
  novelByAgent: AgentCounts;
  supportIntroducedByAgent: AgentCounts;
  originShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  survivingShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
  };
  ancestryShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  contributionConcentration: {
    herfindahl: number | null;
    dominantAgent: InteractionAgentId | null;
  };
};

export type AdoptionMetrics = {
  adoption: DirectionalOpportunity;
  latencyTurns: { mean: number | null; samples: number };
  supportedAdoption: DirectionalOpportunity;
  unsupportedAdoption: DirectionalOpportunity;
  challengeBeforeAdoption: DirectionalOpportunity;
  independentDerivationBeforeAdoption: DirectionalOpportunity;
};

export type VerificationMetrics = {
  independentVerification: DirectionalOpportunity;
  verificationBeforeAcceptance: DirectionalOpportunity;
  verificationAfterAcceptance: DirectionalOpportunity;
  unsupportedAcceptance: DirectionalOpportunity;
};

export type ChallengeMetrics = {
  frequency: OpportunityRate;
  directional: DirectionalOpportunity;
  successful: OpportunityRate;
  unsuccessful: OpportunityRate;
  revisionAfterChallenge: OpportunityRate;
  correctionAfterChallenge: OpportunityRate;
};

export type CorrectionMetrics = {
  corrected: OpportunityRate;
  selfCorrection: OpportunityRate;
  crossAgentCorrection: OpportunityRate;
  correctionAcceptance: OpportunityRate;
  correctionRejection: OpportunityRate;
  latencyTurns: { mean: number | null; samples: number };
};

export type DisagreementMetrics = {
  disagreements: OpportunityRate;
  resolved: OpportunityRate;
  unresolved: OpportunityRate;
  concession: DirectionalOpportunity;
  revision: OpportunityRate;
  rejection: OpportunityRate;
  synthesis: OpportunityRate;
  survivor: {
    agent_a: number;
    agent_b: number;
    synthesis: number;
    unresolved: number;
  };
};

export type InfluenceMetrics = {
  downstreamDependencies: AgentCounts;
  centrality: AgentCounts;
  proposalSurvival: DirectionalOpportunity;
  disagreementSurvival: DirectionalOpportunity;
  concessionDirection: DirectionalOpportunity;
  finalAncestry: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
    dominantAgent: InteractionAgentId | null;
  };
};

export type EfficiencyMetrics = {
  turns: number;
  tokensPerAgent: { agent_a: number | null; agent_b: number | null };
  uniqueObjectsPerTurn: number | null;
  graphMutationsPerTurn: number | null;
  productiveEventsPerTurn: number | null;
  repetition: OpportunityRate;
  zeroMutationTurns: number;
  survivingPerToken: number | null;
  clarificationOverhead: OpportunityRate;
};

export type DevelopmentMetrics = {
  graphDepth: { average: number | null; maximum: number | null };
  branchingFactor: number | null;
  revisions: number;
  abandonedBranches: number;
  independentBranches: number;
  survivingBranches: number;
  synthesisNodes: number;
  activeIdeaDelta: number | null;
  mutationRate: OpportunityRate;
};

export type InteractionFamilies = {
  contributions: ContributionMetrics;
  adoption: AdoptionMetrics;
  verification: VerificationMetrics;
  challenges: ChallengeMetrics;
  corrections: CorrectionMetrics;
  disagreement: DisagreementMetrics;
  influence: InfluenceMetrics;
  efficiency: EfficiencyMetrics;
  reasoningDevelopment: DevelopmentMetrics;
};

export type MechanismMetrics = {
  persuasion: OpportunityRate;
  deference: OpportunityRate;
  independentConvergence: OpportunityRate;
  productiveDisagreement: OpportunityRate;
  unproductiveDisagreement: OpportunityRate;
  synthesis: OpportunityRate;
  errorPropagation: OpportunityRate;
};

export type PolicyRelevantOutcomes = {
  trust: {
    adoption: DirectionalOpportunity;
    unsupportedAdoption: DirectionalOpportunity;
    verification: DirectionalOpportunity;
    verificationBeforeAcceptance: DirectionalOpportunity;
    challengeBeforeAdoption: DirectionalOpportunity;
    adoptionLatencyTurns: { mean: number | null; samples: number };
    independentConvergence: OpportunityRate;
    claimPropagation: OpportunityRate;
  };
  authority: {
    directionalInfluence: AgentCounts;
    directionalDeference: DirectionalOpportunity;
    disagreementSurvival: DirectionalOpportunity;
    proposalSurvival: DirectionalOpportunity;
    challengeAsymmetry: DirectionalOpportunity;
    concessionAsymmetry: DirectionalOpportunity;
    finalAncestry: InfluenceMetrics["finalAncestry"];
    decisionConcentration: {
      herfindahl: number | null;
      dominantAgent: InteractionAgentId | null;
    };
  };
  familiarity: {
    repeatedInformation: OpportunityRate;
    explicitReferences: OpportunityRate;
    establishedReuse: OpportunityRate;
    clarificationRequests: OpportunityRate;
    misunderstanding: OpportunityRate;
    repair: OpportunityRate;
    productiveEventsPerTurn: number | null;
    graphMutationsPerTurn: number | null;
    turnsToSharedContext: number | null;
  };
};

export type CrossSourcePattern =
  | "fluent_stagnation"
  | "coordinated_progress"
  | "deferential_coordination"
  | "adversarial_productive";

export type InteractionEvaluation = {
  interaction: InteractionFamilies;
  mechanisms: MechanismMetrics;
  policyRelevantOutcomes: PolicyRelevantOutcomes;
  events: InteractionEvent[];
  trajectory: InteractionTrajectoryPoint[];
  semanticAnnotations: SemanticAnnotation[];
  objects: ReasoningObject[];
  patterns: CrossSourcePattern[];
  metadata: {
    problemType: ProblemCategory | string;
    adapterVersion: string;
    evaluatorVersion: string;
    graphMissing: boolean;
    graphMalformed: boolean;
    interrupted: boolean;
    shortConversation: boolean;
    provenance: Record<string, "deterministic" | "graph_derived" | "llm_semantic">;
  };
  graderVersion: string;
  schemaVersion: string;
};

export type { BeliefDirectionalFraction, BeliefFraction };
