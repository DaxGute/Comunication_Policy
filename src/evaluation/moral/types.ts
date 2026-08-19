/**
 * Persisted contract for moral/philosophical post-hoc dynamics.
 *
 * Deterministic metrics are reductions over the live idea/axiom graph plus
 * transcript metadata. The optional judge is a single qualitative call and
 * never receives communication-policy treatment values.
 */
import type { AgentId } from "../../agents/types";
import type {
  BeliefDirectionalFraction,
  BeliefFraction,
} from "../types";

export type MoralAgentId = Extract<AgentId, "agent_a" | "agent_b">;

export type MoralMetricSource =
  | "deterministic"
  | "graph_derived"
  | "llm_judge";

export type MoralEvalEventType =
  | "idea_introduced"
  | "idea_adopted"
  | "idea_challenged"
  | "idea_rejected"
  | "idea_revised"
  | "idea_abandoned"
  | "idea_synthesized"
  | "idea_strengthened"
  | "axiom_introduced"
  | "axiom_adopted"
  | "axiom_challenged"
  | "axiom_abandoned"
  | "concession"
  | "clarification"
  | "correction"
  | "repetition"
  | "unsupported_adoption"
  | "independent_justification";

export type MoralResolutionKind =
  | "acceptance"
  | "rejection"
  | "revision"
  | "synthesis"
  | "unresolved";

export type MoralEvalEvent = {
  type: MoralEvalEventType;
  turn: number;
  actor: MoralAgentId | "system";
  targetAgent?: MoralAgentId;
  ideaId?: string;
  relatedIdeaIds?: string[];
  canonicalIdeaId?: string;
  resolution?: MoralResolutionKind;
};

export type MoralAgentCounts = {
  agent_a: number;
  agent_b: number;
};

export type MoralIdeaRecord = {
  id: string;
  canonicalId: string;
  kind: "idea" | "axiom";
  text: string;
  originatingAgent: MoralAgentId | "system";
  firstTurn: number;
  subsequentTurns: number[];
  supportingAgents: MoralAgentId[];
  challengingAgents: MoralAgentId[];
  supersedes?: string;
  supersededBy?: string[];
  parentIds: string[];
  childIds: string[];
  inFinalPosition: boolean;
  status: string;
  confidence?: number;
  unsupported: boolean;
};

export type MoralContributionMetrics = {
  ideaCountByAgent: MoralAgentCounts;
  novelIdeaCountByAgent: MoralAgentCounts;
  axiomCountByAgent: MoralAgentCounts;
  originShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  finalPositionShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
  };
  survivalByOrigin: BeliefDirectionalFraction;
  uniqueConceptsByAgent: MoralAgentCounts;
  contributionBalance: {
    herfindahl: number | null;
    dominantAgent: MoralAgentId | null;
  };
};

export type MoralAdoptionMetrics = {
  adoption: BeliefDirectionalFraction;
  influenceImbalance: number | null;
  ideaSurvivalByOrigin: BeliefDirectionalFraction;
  axiomSurvivalByOrigin: BeliefDirectionalFraction;
  proposalToFinalConversion: BeliefDirectionalFraction;
  finalTraceShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  downstreamDescendants: MoralAgentCounts;
  influenceCentrality: MoralAgentCounts;
};

export type MoralDisagreementMetrics = {
  challengeCount: number;
  challengeRate: BeliefFraction;
  disagreementEvents: number;
  disagreementsResolved: number;
  disagreementsUnresolved: number;
  resolutionRate: BeliefFraction;
  disagreementSurvivor: {
    agent_a: number;
    agent_b: number;
    synthesis: number;
    unresolved: number;
  };
  concession: BeliefDirectionalFraction;
  mutualSynthesisRate: BeliefFraction;
  resolutions: {
    acceptance: number;
    rejection: number;
    revision: number;
    synthesis: number;
    unresolved: number;
  };
};

export type MoralDevelopmentMetrics = {
  revisions: number;
  abandonedIdeas: number;
  strengthenedIdeas: number;
  weakenedIdeas: number;
  synthesisNodes: number;
  averageGraphDepth: number | null;
  maximumGraphDepth: number | null;
  branchingFactor: number | null;
  independentBranches: number;
  activeIdeaDelta: number | null;
  finalSurvivingBranchCount: number;
  repeatingVsModifying: {
    mutationTurns: number;
    zeroMutationTurns: number;
    mutationRate: BeliefFraction;
  };
};

export type MoralAxiomMetrics = {
  axiomsIntroduced: number;
  axiomsShared: number;
  axiomsContested: number;
  axiomsAbandoned: number;
  axiomsSurviving: number;
  axiomsByAgent: MoralAgentCounts;
  axiomAdoption: BeliefDirectionalFraction;
  unsupportedAssertions: number;
  averageJustificationDepth: number | null;
  finalClaimsWithAxiomSupport: BeliefFraction;
  axiomDependenceConcentration: number | null;
};

export type MoralEfficiencyMetrics = {
  turns: number;
  wordsPerAgent: MoralAgentCounts;
  tokensPerAgent: {
    agent_a: number | null;
    agent_b: number | null;
  };
  repeatedIdeas: number;
  redundantRestatements: number;
  explicitReferences: number;
  clarificationRequests: number;
  questions: number;
  corrections: number;
  ideaDensityPerTurn: number | null;
  newNodesPerTurn: number | null;
  graphMutationsPerTurn: number | null;
  zeroMutationTurns: number;
};

export type MoralTrustMetrics = {
  proposalAcceptance: BeliefDirectionalFraction;
  unsupportedAcceptance: BeliefDirectionalFraction;
  independentJustification: BeliefDirectionalFraction;
  challengeBeforeAdoption: BeliefDirectionalFraction;
  correctionRate: BeliefDirectionalFraction;
  unsupportedClaimPropagation: BeliefFraction;
  adoptionLatencyTurns: {
    mean: number | null;
    samples: number;
  };
  challengedThenAdopted: BeliefDirectionalFraction;
};

export type MoralAuthorityMetrics = {
  directionalDeference: BeliefDirectionalFraction;
  proposalSurvivalByAgent: BeliefDirectionalFraction;
  disagreementWinRate: BeliefDirectionalFraction;
  challengeRateToward: BeliefDirectionalFraction;
  concessionDirection: BeliefDirectionalFraction;
  decisionConcentration: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
    dominantAgent: MoralAgentId | null;
  };
  finalPositionShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  challengedClaimPersistence: BeliefDirectionalFraction;
  survivalGivenIntroducer: BeliefDirectionalFraction;
};

export type MoralFamiliarityMetrics = {
  repeatedInformation: BeliefFraction;
  redundantExplanation: BeliefFraction;
  explicitReferences: BeliefFraction;
  clarificationFrequency: BeliefFraction;
  correctionFrequency: BeliefFraction;
  ideaDensity: number | null;
  graphReuse: BeliefFraction;
  turnsToSharedPremises: number | null;
  reexplainedEstablishedAxioms: BeliefFraction;
};

export type MoralDeterministicMetrics = {
  contribution: MoralContributionMetrics;
  adoption: MoralAdoptionMetrics;
  disagreement: MoralDisagreementMetrics;
  axioms: MoralAxiomMetrics;
  development: MoralDevelopmentMetrics;
  efficiency: MoralEfficiencyMetrics;
  trust: MoralTrustMetrics;
  authority: MoralAuthorityMetrics;
  familiarity: MoralFamiliarityMetrics;
};

export type MoralSemanticAnnotations = {
  source: "reasoning_graph";
  ideaCount: number;
  axiomCount: number;
  graphNodeCount: number;
  graphEventCount: number;
  extractionCompleteness: "full" | "partial" | "missing";
  ideas: MoralIdeaRecord[];
};

export type MoralJudgeScores = {
  reasoningCoherence: number | null;
  premiseConclusionConsistency: number | null;
  counterargumentEngagement: number | null;
  synthesisQuality: number | null;
  finalPositionSupport: number | null;
  unresolvedContradictions: string[];
  notes: string;
};

export type MoralTurnSnapshot = {
  turn: number;
  cumulativeUniqueIdeas: number;
  activeIdeas: number;
  supportedIdeas: number;
  contestedIdeas: number;
  abandonedIdeas: number;
  sharedAdoptedIdeas: number;
  graphDepth: number | null;
  graphMutations: number;
  survivingFromA: number;
  survivingFromB: number;
};

export type MoralEvalMetadata = {
  provenance: Record<string, MoralMetricSource>;
  graphMissing: boolean;
  graphMalformed: boolean;
  interrupted: boolean;
  earlyFinalAnswer: boolean;
  shortConversation: boolean;
  oneSidedContribution: boolean;
  noDisagreement: boolean;
  noAdoption: boolean;
  noExplicitAxioms: boolean;
  graderVersion: string;
  schemaVersion: string;
  judgeVersion?: string;
};

export type MoralDynamicsEvaluation = {
  deterministic: MoralDeterministicMetrics;
  events: MoralEvalEvent[];
  trajectories: MoralTurnSnapshot[];
  semanticAnnotations: MoralSemanticAnnotations;
  judgeScores?: MoralJudgeScores;
  metadata: MoralEvalMetadata;
  graderVersion: string;
  schemaVersion: string;
};
