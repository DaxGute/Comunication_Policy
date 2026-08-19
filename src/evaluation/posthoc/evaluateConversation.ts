/**
 * Task-aware semantic grounding, then the universal interaction evaluator.
 *
 * MARBLE stays in the orchestrator. Belief/moral extraction is no longer
 * selected by problem type.
 */
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { ReasoningEffort } from "../../models/modelRegistry";
import type { Problem, ProblemCategory } from "../../problems/types";
import type { ModelClient } from "../../runtime/modelClient";
import { evaluateInteraction } from "../interaction/evaluator";
import type { InteractionEvaluation } from "../interaction/types";
import type { EvaluationArtifact, EvaluationCost, MarbleEvaluation } from "../types";

export type ConversationPostHocInput = {
  problemType: ProblemCategory;
  conversation: ProblemConversation;
  run: ExperimentRun;
  problem?: Problem;
  priorTaskLabel?: string;
  priorTaskNotes?: string;
  evaluatorModel: string;
  reasoningEffort?: ReasoningEffort;
  client?: ModelClient;
  signal?: AbortSignal;
  marble?: MarbleEvaluation;
};

export type ConversationPostHocResult = {
  interaction?: {
    artifact: EvaluationArtifact<InteractionEvaluation>;
    cost: EvaluationCost;
  };
};

export async function evaluateConversation(
  input: ConversationPostHocInput,
): Promise<ConversationPostHocResult> {
  const interaction = await evaluateInteraction({
    conversation: input.conversation,
    problemType: input.problemType,
    evaluatorModel: input.evaluatorModel,
    reasoningEffort: input.reasoningEffort,
    client: input.client,
    signal: input.signal,
    marble: input.marble,
  });
  return { interaction };
}
