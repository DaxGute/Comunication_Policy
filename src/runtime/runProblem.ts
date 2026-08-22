/**
 * Runs one problem: builds agent prompts, then delegates to the interaction loop.
 *
 * Does not own model scheduling or post-hoc multi-agent evaluation.
 */
import {
  agentDefinitionFromPrompt,
  buildAgentPromptPair,
} from "../agents/buildAgentPrompt";
import type { AgentPromptPair } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { deriveConversationEfficiency } from "../experiment/conversationEfficiency";
import type { ProblemConversation, RunConfig } from "../experiment/types";
import {
  assignProblemInformation,
  buildInformationSplitSeed,
  computeInformationFlowMetrics,
  createInformationDrawNonce,
  snapOverlapForCategory,
} from "../information";
import { computeHiddenProfileEvidenceQualityMetrics } from "../evaluation/hiddenProfile/evidenceQuality";
import { calculateModelCost } from "../models/cost";
import { normalizeUsage, sumUsage } from "../models/usage";
import { taskReasoningAdapterFor } from "../problems/adapters/registry";
import type { Problem } from "../problems/types";
import {
  computeMoralSynthesisDiagnostics,
  computeReasoningGraphDiagnostics,
  deriveGenericReadiness,
  deriveIssueConvergenceStates,
  deriveReasoningProgress,
  REASONING_SCHEMA_VERSION,
} from "../reasoning";
import {
  runInteractionLoop,
  type InteractionLoopCallbacks,
} from "./interactionLoop";
import type { ModelClient } from "./modelClient";

export async function runProblem(args: {
  problem: Problem;
  policy: CommunicationPolicy;
  config: RunConfig;
  client: ModelClient;
  /**
   * Snapshotted prompts for this run. When omitted, compiled from `policy`.
   * Prefer passing the run snapshot so A/B prompts cannot drift from metadata.
   */
  agentPrompts?: AgentPromptPair;
  signal?: AbortSignal;
  callbacks?: InteractionLoopCallbacks;
}): Promise<ProblemConversation> {
  const { problem, policy, config, client, signal, callbacks } = args;

  const prompts = args.agentPrompts ?? buildAgentPromptPair(policy);
  const agentA = agentDefinitionFromPrompt("agent_a", prompts.agentA);
  const agentB = agentDefinitionFromPrompt("agent_b", prompts.agentB);

  const isHiddenProfile =
    problem.category === "hidden_profile" ||
    problem.kind === "hidden_profile" ||
    Boolean(problem.hiddenProfile);
  const overlapRequested = snapOverlapForCategory(
    config.informationOverlap ?? 1,
    config.problemCategory ?? problem.category,
  );
  const drawNonce =
    config.informationStructure?.splitSeed?.trim() ||
    createInformationDrawNonce();
  const splitSeed = buildInformationSplitSeed({
    problemId: problem.id,
    overlapRequested,
    drawNonce,
    nestAcrossOverlap: isHiddenProfile,
  });

  const assigned = assignProblemInformation({
    problem,
    overlapRequested,
    splitSeed,
    promotionSeed: isHiddenProfile ? splitSeed : undefined,
  });

  const treatment = assigned.assignment.hiddenProfileTreatment;
  console.info(
    `[info-asymmetry] problem=${problem.id} overlap=${overlapRequested} ` +
      `units=${assigned.assignment.totalUnits} shared=${assigned.assignment.sharedUnitIds.length} ` +
      `aOnly=${assigned.assignment.agentAOnlyUnitIds.length} ` +
      `bOnly=${assigned.assignment.agentBOnlyUnitIds.length} ` +
      `realized=${assigned.assignment.overlapRealized.toFixed(2)}` +
      (treatment
        ? ` promoteA=${treatment.promotedAtoSharedCount}/${treatment.authoredAPrivateCount}` +
          ` promoteB=${treatment.promotedBtoSharedCount}/${treatment.authoredBPrivateCount}` +
          ` condition=${treatment.condition}`
        : ""),
  );

  const result = await runInteractionLoop({
    problem,
    agentA,
    agentB,
    policy,
    model: config.runModel,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    stallRecoveryTurns: config.stallRecoveryTurns,
    stallFailTurns: config.stallFailTurns,
    localLoopTurns: config.localLoopTurns,
    cycleWindowTurns: config.cycleWindowTurns,
    moralSubjectSeeding: config.moralSubjectSeeding,
    reasoningEffort: config.runReasoningEffort,
    client,
    signal,
    callbacks,
    problemTextByAgent: {
      agent_a: assigned.problemTextA,
      agent_b: assigned.problemTextB,
    },
    informationAssignment: assigned.assignment,
  });

  const conversationUsage = sumUsage(
    result.messages.map((m) => normalizeUsage(m.usage ?? { totalTokens: 0 })),
  );
  const hasUsage = result.messages.some((m) => m.usage);
  // Price each message call with the run model (preserves per-call accounting).
  let conversationCostUsd: number | null = null;
  if (hasUsage) {
    let sum = 0;
    let anyPriced = false;
    for (const message of result.messages) {
      if (!message.usage) continue;
      const usage = normalizeUsage(message.usage);
      if (!usage) continue;
      const priced = calculateModelCost(config.runModel, usage);
      if (priced === null) continue;
      sum += priced;
      anyPriced = true;
    }
    conversationCostUsd = anyPriced ? sum : null;
  }
  const adapter = taskReasoningAdapterFor(problem, {
    moralSubjectSeeding: config.moralSubjectSeeding,
  });
  const conflicts = adapter.deriveConflicts?.(problem, result.reasoning) ?? [];
  const issueStates = deriveIssueConvergenceStates(result.reasoning, {
    conflicts,
    currentTurn: result.messages.length,
  });
  const genericReadiness = deriveGenericReadiness(issueStates);
  const progress = deriveReasoningProgress(result.reasoning, issueStates, {
    currentTurn: result.messages.length,
  });
  const taskReadiness = adapter.deriveProblemReadiness?.(
    problem,
    issueStates,
    result.reasoning,
    genericReadiness,
  );

  const conversation: ProblemConversation = {
    problemId: problem.id,
    problemTitle: problem.title,
    // Shared public framing for inspector headers; per-agent packets below.
    problemText: assigned.sharedContext,
    problemTextByAgent: {
      agent_a: assigned.problemTextA,
      agent_b: assigned.problemTextB,
    },
    informationAssignment: assigned.assignment,
    messages: result.messages,
    finalAnswer: result.finalAnswer,
    finalBasisVersionIds: result.finalBasisVersionIds,
    finalBasisDeclared: result.finalBasisDeclared,
    finalBasisErrors: result.finalBasisErrors,
    finalSourceInformationIds: result.finalSourceInformationIds,
    finalAnswerSupport:
      result.finalBasisDeclared === true ||
      (result.finalBasisVersionIds?.length ?? 0) > 0 ||
      (result.finalBasisErrors?.length ?? 0) > 0
        ? {
            text: result.finalAnswer,
            basisVersionIds: result.finalBasisVersionIds,
            declared: result.finalBasisDeclared,
            errors: result.finalBasisErrors ?? [],
          }
        : undefined,
    reasoningSchemaVersion: REASONING_SCHEMA_VERSION,
    reasoningSubjects: result.reasoning.subjects,
    reasoningVersions: result.reasoning.versions,
    reasoningEvents: result.reasoning.events,
    finalGraphState: {
      subjects: result.reasoning.subjects,
      versions: result.reasoning.versions,
    },
    reasoningDiagnostics: computeReasoningGraphDiagnostics(result.reasoning, {
      turnCount: result.messages.length,
      finalAnswer: result.finalAnswer,
      messages: result.messages.map((message) => ({
        id: message.id,
        turnIndex: message.turnIndex,
        content: message.content,
        agentId: message.agentId,
        nothingToAdd: message.nothingToAdd,
        readyToFinalize: message.readyToFinalize,
        materialGraphChange: message.materialGraphChange,
        readinessInvalidated: message.readinessInvalidated,
        focusSubjectIds: message.focusSubjectIds,
      })),
      issueStates,
      genericReadiness,
      progress,
      protocolStallStreak: result.solverProgress?.unchangedStreak,
      persistenceRepairCount: result.persistenceRepairCount,
      stoppedReason: result.stoppedReason,
      convergenceAttempts: result.moralConvergence?.convergenceAttempts,
      convergenceResets: result.moralConvergence?.convergenceResets,
      materialGraphChangeTurns: result.moralConvergence?.materialGraphChangeTurns,
      lastMaterialChangeTurn: result.moralConvergence?.lastMaterialChangeTurn,
      moralSynthesis:
        problem.category === "moral_philosophical"
          ? computeMoralSynthesisDiagnostics(result.reasoning, {
              finalBasisVersionIds: result.finalBasisVersionIds,
              finalBasisDeclared: result.finalBasisDeclared,
              referenceConsiderations: problem.moral?.issues,
            })
          : undefined,
      solverProgress: result.solverProgress
        ? {
            rawMutationCount: result.solverProgress.rawMutationCount,
            meaningfulStateTransitionCount:
              result.solverProgress.meaningfulStateTransitionCount,
            noOpMutationCount: result.solverProgress.noOpMutationCount,
            repeatedStateCount: result.solverProgress.repeatedStateCount,
            cycleDetectionCount: result.solverProgress.cycleDetectionCount,
            localLoopInterventions: result.solverProgress.localLoopInterventions,
            diversificationInterventions:
              result.solverProgress.diversificationInterventions,
            fingerprintCount: result.solverProgress.fingerprintCount,
            lastFingerprint: result.solverProgress.lastFingerprint,
            semanticStallReason: result.solverProgress.semanticStallReason,
            freezeType: result.solverProgress.freezeType,
            freezeDetectedTurn: result.solverProgress.freezeDetectedTurn,
            stallWarningCount: result.solverProgress.stallWarningCount,
            closureWarningCount: result.solverProgress.closureWarningCount,
            finalizationRequiredCount:
              result.solverProgress.finalizationRequiredCount,
            stallWarningTurn: result.solverProgress.stallWarningTurn,
            stallWarningKind: result.solverProgress.stallWarningKind,
            stallWarningFingerprint:
              result.solverProgress.stallWarningFingerprint,
            warningDeliveredTurn: result.solverProgress.warningDeliveredTurn,
            closureWarningTurn: result.solverProgress.closureWarningTurn,
            closureWarningReason: result.solverProgress.closureWarningReason,
            closureWarningDeliveredTurn:
              result.solverProgress.closureWarningDeliveredTurn,
            finalizationRequiredTurn:
              result.solverProgress.finalizationRequiredTurn,
            finalizationDeliveredTurn:
              result.solverProgress.finalizationDeliveredTurn,
            recoveryTurnCount: result.solverProgress.recoveryTurnCount,
            recoveryTurnsBeforeFinalization:
              result.solverProgress.recoveryTurnsBeforeFinalization,
            progressResumedAfterWarning:
              result.solverProgress.progressResumedAfterWarning,
            finalAnswerAfterWarning:
              result.solverProgress.finalAnswerAfterWarning,
            finalAnswerAfterFinalization:
              result.solverProgress.finalAnswerAfterFinalization,
            turnsFromWarningToFinalAnswer:
              result.solverProgress.turnsFromWarningToFinalAnswer,
            terminatedAsProtocolStall:
              result.solverProgress.terminatedAsProtocolStall,
            terminatedAsMaxTurns: result.solverProgress.terminatedAsMaxTurns,
            phase: result.solverProgress.phase,
          }
        : undefined,
      task: taskReadiness
        ? {
            readiness: taskReadiness,
            issueStates: issueStates.map((issue) =>
              adapter.deriveIssueState?.(problem, issue, result.reasoning),
            ),
            ...(adapter.deriveTaskDiagnostics
              ? {
                  lineage: adapter.deriveTaskDiagnostics(
                    problem,
                    result.reasoning,
                    issueStates,
                  ),
                }
              : {}),
          }
        : undefined,
    }),
    stoppedReason: result.stoppedReason,
    error: result.error,
    conversationUsage: hasUsage ? conversationUsage : undefined,
    conversationCostUsd,
  };
  conversation.conversationEfficiency =
    deriveConversationEfficiency(conversation);
  conversation.informationFlowMetrics =
    computeInformationFlowMetrics(conversation, problem);
  if (problem.hiddenProfile) {
    conversation.evidenceQualityMetrics =
      computeHiddenProfileEvidenceQualityMetrics(
        conversation,
        problem.hiddenProfile,
      );
  }
  return conversation;
}
