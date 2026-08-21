import type {
  GenericReadiness,
  IssueConflict,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningSubject,
} from "../../reasoning/types";
import type { Problem, ProblemCategory } from "../types";

export type SubjectResolution = {
  id?: string;
  error?: string;
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

export type TaskIssueLedger = {
  issueId: string;
  label: string;
  liveCandidates: Array<{ nodeId: string; normalizedAnswer?: string }>;
  previousCandidates: Array<{ nodeId: string; normalizedAnswer?: string }>;
  triedAnswers: string[];
  conflicts: Array<{ nodeIds: string[]; description?: string }>;
  currentCandidate?: string;
  untouched?: boolean;
};

/**
 * Task adapters own subject identity and optional structural validation.
 * They do not own a second belief ontology.
 */
export type TaskReasoningAdapter = {
  category: ProblemCategory;
  getInitialIssues(problem: Problem): ReasoningSubject[];
  resolveSubject?(problem: Problem, raw: string): SubjectResolution;
  /**
   * When true, SET cannot create subjects that were not seeded (crossword).
   */
  subjectsAreClosed?: boolean;
  messageLooksSubstantive?(problem: Problem, message: string): boolean;
  validateContent?(
    problem: Problem,
    subjectId: string,
    content: string,
  ): { ok: boolean; reasons?: string[]; normalized?: string };
  deriveConflicts?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
  ): IssueConflict[];
  solverStateFingerprint?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
    issueStates: IssueConvergenceState[],
  ): string;
  deriveCandidateLedger?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
  ): TaskIssueLedger[];
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
  deriveTaskDiagnostics?(
    problem: Problem,
    reasoningGraph: ReasoningGraph,
    issueStates: IssueConvergenceState[],
  ): Record<string, unknown>;
};
