/**
 * Shared inspector prop types.
 *
 * The inspector shell, transcript pane, and run-results pane all take the same
 * evaluation callbacks from the experiment store.
 */
import type { AgentId } from "../../agents/types";
import type { MultiAgentEvaluation } from "../../evaluation/types";
import type { EvaluationUiState } from "../../experiment/store";
import type {
  DraggedTreeItem,
  DropTarget,
  RunTree,
} from "../../experiment/runTree";
import type { ExperimentRun } from "../../experiment/types";

export type ProblemPaneTab = "analysis" | "conversation" | "graph";

export type InspectorProps = {
  runs: ExperimentRun[];
  runTree: RunTree;
  selectedRun?: ExperimentRun;
  selectedProblemId?: string;
  /** Bumped when a run is chosen from the scatter plot so the inspector reveals it. */
  inspectorFocus?: number;
  speakingAgentId?: AgentId;
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string, runId?: string) => void;
  onDeleteRun: (runId: string) => void;
  onRenameRun: (runId: string, title: string) => void;
  onRenameProblem: (runId: string, problemId: string, title: string) => void;
  onCreateFolder: () => string;
  onRenameFolder: (folderId: string, title: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveTreeItem: (dragged: DraggedTreeItem, target: DropTarget) => void;
  evaluationUi?: EvaluationUiState;
  onRunEvaluation: (options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
    retryFrom?: MultiAgentEvaluation;
    overrideExisting?: boolean;
  }) => Promise<unknown>;
  onRunAllEvaluations: (options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
    overrideExisting?: boolean;
  }) => Promise<unknown>;
};
