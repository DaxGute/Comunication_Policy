import type {
  DeterministicReasoningSignal,
  GenericReadiness,
  IssueConflict,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningMove,
  ReasoningNodeStatus,
  ReasoningSubject,
  TaskCompatibility,
} from "../../reasoning/types";
import type { Problem, ProblemCategory } from "../types";

export type TaskEvidenceSeed = {
  alias: string;
  aliases?: string[];
  text: string;
  subjectId?: string;
  origin: "task" | "deterministic";
  kind?: string;
};

export type BasisResolution = {
  id?: string;
  create?: TaskEvidenceSeed;
  relation?: "grounds" | "supports";
  error?: string;
};

export type SubjectResolution = {
  id?: string;
  error?: string;
};

export type TaskCandidateRecord = {
  nodeId: string;
  identity?: string;
  normalizedAnswer?: string;
  createdAtTurn: number;
  live: boolean;
  status: ReasoningNodeStatus;
  compatibility: TaskCompatibility;
  crossingDescription?: string;
  priorTurns?: number[];
  priorOutcome?: string;
  firstProposedTurn?: number;
  lastTouchedTurn?: number;
  proposedBy?: string[];
  supportedBy?: string[];
  challengedBy?: string[];
  rejectionReason?: string;
};

export type TaskIssueLedger = {
  issueId: string;
  label: string;
  liveCandidates: TaskCandidateRecord[];
  previousCandidates: TaskCandidateRecord[];
  triedAnswers: string[];
  conflicts: Array<{ nodeIds: string[]; description?: string }>;
  currentCandidate?: string;
  untouched?: boolean;
};

export type TaskIssueState = {
  issueId: string;
  valid: boolean;
  reasons: string[];
  details?: Record<string, unknown>;
};

export type TaskReadiness = {
  ready: boolean;
  reasons: string[];
  generic: GenericReadiness;
  details?: Record<string, unknown>;
};

export type TaskReasoningAdapter = {
  category: ProblemCategory;
  getInitialIssues(problem: Problem): ReasoningSubject[];
  getInitialEvidence?(problem: Problem): TaskEvidenceSeed[];
  resolveSubject?(problem: Problem, raw: string): SubjectResolution;
  resolveBasis?(
    problem: Problem,
    graph: ReasoningGraph,
    raw: string,
    context?: { subjectId?: string },
  ): BasisResolution;
  extractMoves?(problem: Problem, message: string): ReasoningMove[];
  messageLooksSubstantive?(problem: Problem, message: string): boolean;
  /** When true, new claims should attach to a known issue. */
  requireSubjectOnClaims?: boolean;
  /** When true, missing basis is auto-grounded to task evidence when unique. */
  requireGroundingOnClaims?: boolean;
  deriveIssueState?(
    problem: Problem,
    issue: IssueConvergenceState,
    reasoningGraph: ReasoningGraph,
  ): TaskIssueState;
  deriveProblemReadiness?(
    problem: Problem,
    issueStates: IssueConvergenceState[],
    reasoningGraph: ReasoningGraph,
    genericReadiness: GenericReadiness,
  ): TaskReadiness;
  deriveDeterministicEvidence?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
  ): DeterministicReasoningSignal[];
  deriveConflicts?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
  ): IssueConflict[];
  /**
   * Adapter-owned candidate identity (e.g. crossword subjectId + answer).
   * The generic engine uses this for duplicates and revisits.
   */
  candidateIdentity?(
    problem: Problem,
    node: {
      type: string;
      text: string;
      subjectId?: string;
      metadata?: Record<string, unknown>;
    },
  ): string | undefined;
  /**
   * Structural candidate checks (length, format) before a claim becomes live.
   * Generic graph identity stays adapter-agnostic; this is the task gate.
   */
  validateCandidate?(
    problem: Problem,
    node: {
      type: string;
      text: string;
      subjectId?: string;
      metadata?: Record<string, unknown>;
    },
  ): { ok: boolean; reasons?: string[] };
  /**
   * Compact canonical solver-state fingerprint. Conversation length must not
   * change this unless live hypotheses, conflicts, or settlement change.
   */
  solverStateFingerprint?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
    issueStates: IssueConvergenceState[],
  ): string;
  deriveCandidateLedger?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
  ): TaskIssueLedger[];
  deriveTaskDiagnostics?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
    issueStates: IssueConvergenceState[],
  ): Record<string, unknown>;
};
