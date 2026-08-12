import { ConversationInspector } from "../components/bottom/ConversationInspector";
import { CenterPane } from "../components/center/CenterPane";
import { CommunicationPolicyPanel } from "../components/left/CommunicationPolicyPanel";
import { EvaluationPanel } from "../components/right/EvaluationPanel";
import { useExperimentStore } from "../experiment/store";
import { WorkbenchLayout } from "./layout/WorkbenchLayout";

export default function App() {
  const store = useExperimentStore();

  const activeRuns = Object.entries(store.state.runProgressById).map(
    ([id, progress]) => {
      const run = store.state.runs.find((r) => r.id === id);
      return {
        id,
        title: run?.title,
        config: run?.config,
        policy: run?.policy,
        progress,
        selected: store.state.selectedRunId === id,
      };
    },
  );

  return (
    <WorkbenchLayout
      left={
        <CommunicationPolicyPanel
          policy={store.state.currentPolicy}
          onChange={store.setPolicy}
          agentAPrompt={store.agentPrompts.agentA}
          agentBPrompt={store.agentPrompts.agentB}
        />
      }
      main={
        <CenterPane
          runs={store.state.runs}
          speakingAgentId={store.state.speakingAgentId}
          selectedRunId={store.state.selectedRunId}
          onSelectRun={store.selectRun}
          onSelectProblem={store.selectProblem}
        />
      }
      right={
        <EvaluationPanel
          config={store.state.currentRunConfig}
          onConfigChange={store.setRunConfig}
          onRun={() => {
            void store.startRun();
          }}
          onCancelRun={store.cancelRun}
          onSelectRun={store.selectRun}
          activeRuns={activeRuns}
        />
      }
      bottom={
        <ConversationInspector
          runs={store.state.runs}
          selectedRun={store.selectedRun}
          selectedProblemId={store.state.selectedProblemId}
          onSelectRun={store.selectRun}
          onSelectProblem={store.selectProblem}
          onDeleteRun={store.deleteRun}
          onRenameRun={store.renameRun}
          onRenameProblem={store.renameProblem}
          evaluationUi={store.evaluationUi}
          onRunEvaluation={store.runConversationEvaluation}
          onRunAllEvaluations={store.runAllConversationEvaluations}
        />
      }
    />
  );
}
