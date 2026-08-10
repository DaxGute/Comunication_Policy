import { ConversationInspector } from "../components/bottom/ConversationInspector";
import { TwoAgentGraph } from "../components/graph/TwoAgentGraph";
import { CommunicationPolicyPanel } from "../components/left/CommunicationPolicyPanel";
import { EvaluationPanel } from "../components/right/EvaluationPanel";
import { useExperimentStore } from "../experiment/store";
import { WorkbenchLayout } from "./layout/WorkbenchLayout";

export default function App() {
  const store = useExperimentStore();

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
        <TwoAgentGraph speakingAgentId={store.state.speakingAgentId} />
      }
      right={
        <EvaluationPanel
          config={store.state.currentRunConfig}
          onConfigChange={store.setRunConfig}
          onRun={() => {
            void store.startRun();
          }}
          onCancel={store.cancelRun}
          isRunning={store.state.isRunning}
          runProgress={store.state.runProgress}
        />
      }
      bottom={
        <ConversationInspector
          runs={store.state.runs}
          selectedRun={store.selectedRun}
          onSelectRun={store.selectRun}
          onDeleteRun={store.deleteRun}
          evaluationUi={store.evaluationUi}
          onRunEvaluation={store.runConversationEvaluation}
          onRunAllEvaluations={store.runAllConversationEvaluations}
        />
      }
    />
  );
}
