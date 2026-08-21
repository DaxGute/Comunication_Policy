/**
 * Alternating A↔B turn loop for a single problem.
 *
 * Persistent agent memory is the canonical reasoning graph.
 * conversation.messages is the full transcript for inspection only.
 *
 * Moral runs: conversation length emerges from mutual readyToFinalize
 * against a stable graph fingerprint, then a distinct FINALIZATION phase.
 */
import { otherAgentId } from "../agents/identity";
import type { AgentDefinition, AgentId } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { extractFinalAnswerFromText, hasFinalAnswerMarker } from "../evaluation/graders/answerExtraction";
import type { ConversationMessage } from "../experiment/types";
import type { InformationAssignment } from "../information/types";
import { createId } from "../lib/id";
import type { ReasoningEffort } from "../models/modelRegistry";
import { taskReasoningAdapterFor } from "../problems/adapters/registry";
import type { MoralSubjectSeeding } from "../problems/adapters/openSubjects";
import { normalizeMoralSubjectSeeding } from "../problems/adapters/openSubjects";
import type { Problem } from "../problems/types";
import {
  applyReasoningMutations,
  deriveIssueConvergenceStates,
  parseAgentTurn,
  recoverParsedTurn,
  seedGraphForProblem,
  type ReasoningGraph,
} from "../reasoning";
import {
  evaluateMoralFinalization,
  finalizationPhaseCue,
} from "../reasoning/finalizationGate";
import { resolveFinalBasis } from "../reasoning/finalBasis";
import {
  emptyMoralConvergenceState,
  reduceMoralConvergence,
  type MoralConvergenceState,
} from "../reasoning/moralConvergence";
import {
  DEFAULT_CYCLE_WINDOW_TURNS,
  DEFAULT_LOCAL_LOOP_TURNS,
  DEFAULT_STALL_FAIL_TURNS,
  DEFAULT_STALL_RECOVERY_TURNS,
  freezeProtocolKind,
} from "../reasoning/stall";
import {
  emptySolverProgressState,
  reduceSolverProgress,
  snapshotSolverProgress,
  solverStateFingerprint,
  type SolverProgressSnapshot,
} from "../reasoning/solverProgress";
import { isAbortError, throwIfAborted } from "./abort";
import type { ModelClient } from "./modelClient";
import { buildTurnRequestForAgent } from "./renderModelRequest";
import { utteranceFromMessage } from "./transcript";

export type InteractionLoopCallbacks = {
  onMessage?: (message: ConversationMessage, graph: ReasoningGraph) => void;
  onSpeaking?: (agentId: AgentId | undefined) => void;
  onTurnProgress?: (turnIndex: number, maxTurns: number) => void;
  onReasoning?: (graph: ReasoningGraph) => void;
};

export type InteractionLoopResult = {
  messages: ConversationMessage[];
  finalAnswer?: string;
  finalBasisVersionIds?: string[];
  finalBasisDeclared?: boolean;
  finalBasisErrors?: string[];
  finalSourceInformationIds?: string[];
  reasoning: ReasoningGraph;
  solverProgress?: SolverProgressSnapshot;
  persistenceRepairCount?: number;
  moralConvergence?: MoralConvergenceState;
  stoppedReason:
    | "final_answer"
    | "max_turns"
    | "cancelled"
    | "error"
    | "reasoning_protocol_stalled";
  error?: string;
};

function mutationsFromTurn(
  mutations: Array<{ type: string }>,
): ConversationMessage["reasoningMutations"] {
  const valid = mutations.filter(
    (mutation): mutation is NonNullable<ConversationMessage["reasoningMutations"]>[number] =>
      mutation.type === "SET" || mutation.type === "REVISE" || mutation.type === "REMOVE",
  );
  return valid.length > 0 ? valid : undefined;
}

function assertEmptyMoralGraph(graph: ReasoningGraph): void {
  const canonicalSubjectCount = graph.subjects.length;
  const canonicalVersionCount = graph.versions.length;
  const preseededSubjectCount = graph.subjects.filter(
    (subject) => subject.source === "task",
  ).length;
  const legacyMoralSubjectCount = graph.subjects.filter((subject) =>
    /moral:(question|stance|joint_stance|overall)/i.test(subject.id),
  ).length;
  if (
    canonicalSubjectCount !== 0 ||
    canonicalVersionCount !== 0 ||
    preseededSubjectCount !== 0 ||
    legacyMoralSubjectCount !== 0
  ) {
    throw new Error(
      [
        "moral empty-graph invariant failed before turn 1:",
        `canonicalSubjectCount=${canonicalSubjectCount}`,
        `canonicalVersionCount=${canonicalVersionCount}`,
        `preseededSubjectCount=${preseededSubjectCount}`,
        `legacyMoralSubjectCount=${legacyMoralSubjectCount}`,
      ].join(" "),
    );
  }
}

/** Validate the object that is actually sent — not config metadata alone. */
function assertMoralTurn1RequestUnseeded(
  requestMessages: Array<{ role: string; content: string }>,
): void {
  const memory = requestMessages.find((message) =>
    message.content.startsWith("CURRENT SHARED REASONING STATE"),
  )?.content;
  const problem = requestMessages.find((message) =>
    message.content.startsWith("Shared problem:"),
  )?.content;
  const cue = requestMessages.find((message) =>
    message.content.startsWith("It is your turn"),
  )?.content;
  const system = requestMessages.find((message) => message.role === "system")
    ?.content;
  if (!memory) {
    throw new Error("moral turn-1 request missing CURRENT SHARED REASONING STATE");
  }
  if (!/No persistent considerations have been established yet/i.test(memory)) {
    throw new Error(
      "moral turn-1 memory is not empty; expected 'No persistent considerations have been established yet'",
    );
  }
  if (/\bCONSIDERATION:/i.test(memory)) {
    throw new Error("moral turn-1 memory still lists consideration lanes");
  }
  const agentVisible = `${memory}\n${problem ?? ""}\n${cue ?? ""}`;
  const forbiddenInAgentVisible = [
    [/Origin:\s*seeded from task/i, "Origin: seeded from task"],
    [/\bmoral:question\b/i, "moral:question"],
    [/\bmoral:stance\b/i, "moral:stance"],
    [/\bmoral:joint_stance\b/i, "moral:joint_stance"],
    [/Id:\s*moral:/i, "predefined moral: id row"],
  ] as const;
  for (const [pattern, label] of forbiddenInAgentVisible) {
    if (pattern.test(agentVisible)) {
      throw new Error(
        `moral turn-1 request still contains forbidden seeded content (${label})`,
      );
    }
  }
  const protocolSurface = `${system ?? ""}\n${cue ?? ""}\n${problem ?? ""}`;
  if (!/readyToFinalize/i.test(protocolSurface)) {
    throw new Error(
      "moral turn-1 request missing readyToFinalize protocol (mutual convergence not served)",
    );
  }
}

export async function runInteractionLoop(args: {
  problem: Problem;
  agentA: AgentDefinition;
  agentB: AgentDefinition;
  policy: CommunicationPolicy;
  model: string;
  temperature: number;
  maxTurns: number;
  stallRecoveryTurns?: number;
  stallFailTurns?: number;
  localLoopTurns?: number;
  cycleWindowTurns?: number;
  moralSubjectSeeding?: MoralSubjectSeeding;
  reasoningEffort?: ReasoningEffort;
  client: ModelClient;
  signal?: AbortSignal;
  callbacks?: InteractionLoopCallbacks;
  /**
   * Per-agent problem text (shared context + that agent's information packet).
   * When omitted, both agents receive `problem.text` (legacy / full overlap).
   */
  problemTextByAgent?: { agent_a: string; agent_b: string };
  /** Realized assignment; used to validate sourceInformationIds privacy. */
  informationAssignment?: InformationAssignment;
}): Promise<InteractionLoopResult> {
  const {
    problem,
    agentA,
    agentB,
    policy,
    model,
    temperature,
    maxTurns,
    stallRecoveryTurns = DEFAULT_STALL_RECOVERY_TURNS,
    stallFailTurns = DEFAULT_STALL_FAIL_TURNS,
    localLoopTurns = DEFAULT_LOCAL_LOOP_TURNS,
    cycleWindowTurns = DEFAULT_CYCLE_WINDOW_TURNS,
    moralSubjectSeeding,
    reasoningEffort,
    client,
    signal,
    callbacks,
    problemTextByAgent,
    informationAssignment,
  } = args;

  const problemTextFor = (agentId: AgentId): string =>
    problemTextByAgent?.[agentId] ?? problem.text;

  const allowedSourcesFor = (agentId: AgentId): ReadonlySet<string> | undefined => {
    if (!informationAssignment) return undefined;
    const ids =
      agentId === "agent_a"
        ? informationAssignment.agentAUnitIds
        : informationAssignment.agentBUnitIds;
    return new Set(ids);
  };

  const order: AgentId[] = ["agent_a", "agent_b"];
  const messages: ConversationMessage[] = [];
  const taskAdapter = taskReasoningAdapterFor(problem, { moralSubjectSeeding });
  let graph = seedGraphForProblem(problem, taskAdapter);
  let capturedFinalBasis: {
    versionIds?: string[];
    declared?: boolean;
    errors?: string[];
  } = {};
  let capturedFinalSourceInformationIds: string[] | undefined;
  let protocolFeedback: string | undefined;
  let solverProgress = emptySolverProgressState();
  let persistenceRepairDelivered = false;
  let persistenceRepairCount = 0;
  let moralConvergence = emptyMoralConvergenceState();
  const isMoral = problem.category === "moral_philosophical";

  if (isMoral) {
    const init = normalizeMoralSubjectSeeding(moralSubjectSeeding);
    if (init !== "agent-created") {
      throw new Error(`unexpected moralSubjectInitialization=${init}`);
    }
    assertEmptyMoralGraph(graph);
    const prompts = `${agentA.systemPrompt}\n${agentB.systemPrompt}`;
    if (/seed the question, stance/i.test(prompts)) {
      throw new Error(
        "moral prompt snapshot still seeds question/stance; expected agent-created considerations",
      );
    }
    if (/starting organizational units|Seeded dimensions|moralSubjectSeeding=explicit/i.test(prompts)) {
      throw new Error(
        "moral prompt snapshot still describes task-seeded considerations",
      );
    }
  }
  const seedConflicts = taskAdapter.deriveConflicts?.(problem, graph) ?? [];
  solverProgress.fingerprints = [
    solverStateFingerprint({
      problem,
      adapter: taskAdapter,
      graph,
      issueStates: deriveIssueConvergenceStates(graph, {
        conflicts: seedConflicts,
        currentTurn: 0,
      }),
    }),
  ];

  const stop = (
    reason: InteractionLoopResult["stoppedReason"],
    error?: string,
  ): InteractionLoopResult => {
    callbacks?.onSpeaking?.(undefined);
    return {
      messages,
      finalAnswer:
        graph.finalAnswer?.text ??
        extractFinalAnswerFromText(messages[messages.length - 1]?.content ?? ""),
      finalBasisVersionIds: capturedFinalBasis.versionIds,
      finalBasisDeclared: capturedFinalBasis.declared,
      finalBasisErrors: capturedFinalBasis.errors,
      finalSourceInformationIds: capturedFinalSourceInformationIds,
      reasoning: graph,
      solverProgress: snapshotSolverProgress(solverProgress),
      persistenceRepairCount,
      moralConvergence: isMoral ? moralConvergence : undefined,
      stoppedReason: reason,
      error,
    };
  };

  for (let turn = 1; turn <= maxTurns; turn++) {
    try {
      throwIfAborted(signal);
    } catch {
      return stop("cancelled");
    }

    let agentId = order[(turn - 1) % 2];
    if (
      isMoral &&
      moralConvergence.phase === "finalization" &&
      moralConvergence.finalizerId
    ) {
      agentId = moralConvergence.finalizerId;
    }

    callbacks?.onSpeaking?.(agentId);
    callbacks?.onTurnProgress?.(turn, maxTurns);

    const deliveredKind = freezeProtocolKind(protocolFeedback);
    if (deliveredKind === "local_loop" || deliveredKind === "semantic_stall") {
      if (solverProgress.counters.warningDeliveredTurn === undefined) {
        solverProgress.counters.warningDeliveredTurn = turn;
      }
    } else if (deliveredKind === "closure") {
      if (solverProgress.counters.closureWarningDeliveredTurn === undefined) {
        solverProgress.counters.closureWarningDeliveredTurn = turn;
      }
      if (solverProgress.counters.warningDeliveredTurn === undefined) {
        solverProgress.counters.warningDeliveredTurn = turn;
      }
    } else if (deliveredKind === "finalization") {
      solverProgress.counters.finalizationDeliveredTurn = turn;
    }

    const { messages: requestMessages, telemetry } = buildTurnRequestForAgent({
      agentId,
      agentPrompts: {
        agentA: agentA.systemPrompt,
        agentB: agentB.systemPrompt,
      },
      problemText: problemTextFor(agentId),
      utterances: messages.map(utteranceFromMessage),
      turn,
      maxTurns,
      reasoningGraph: graph,
      protocolFeedback,
      moralPhase: isMoral ? moralConvergence.phase : undefined,
      readyToFinalizeHint: isMoral,
    });

    if (isMoral && turn === 1) {
      assertEmptyMoralGraph(graph);
      assertMoralTurn1RequestUnseeded(requestMessages);
    }

    let response;
    try {
      response = await client.generate({
        model,
        temperature,
        reasoningEffort,
        messages: requestMessages,
        signal,
        meta: {
          agentId,
          turnIndex: turn,
          problem,
          policy,
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        return stop("cancelled");
      }
      return stop(
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }

    const parsed = recoverParsedTurn(
      parseAgentTurn(response.content, agentId, turn),
      { problem, adapter: taskAdapter, graph },
    );
    const extraDiagnostics = [
      ...(parsed.normalizedFromMalformedShape
        ? ["normalizedFromMalformedShape"]
        : []),
      ...(parsed.structuredReasoningMissing
        ? ["structured_reasoning_missing"]
        : []),
    ];
    const messageId = createId("msg");
    const applied = applyReasoningMutations(graph, parsed.mutations, {
      actor: agentId,
      turnIndex: turn,
      messageId,
      protocolFailure: parsed.protocolFailure,
      extraDiagnostics,
      subjectsAreClosed: taskAdapter.subjectsAreClosed,
      resolveSubject: (raw) =>
        taskAdapter.resolveSubject?.(problem, raw) ?? {},
      validateContent: taskAdapter.validateContent
        ? (subjectId, content) =>
            taskAdapter.validateContent!(problem, subjectId, content)
        : undefined,
      allowedSourceInformationIds: allowedSourcesFor(agentId),
    });
    graph = applied.graph;
    callbacks?.onReasoning?.(graph);

    if (isMoral) {
      for (const subject of graph.subjects) {
        if (
          subject.source === "agent" &&
          (subject.createdAtTurn === undefined ||
            subject.createdAtTurn < 1 ||
            !subject.createdBy)
        ) {
          throw new Error(
            `moral subject ${subject.id} lacks agent provenance (createdAtTurn/createdBy)`,
          );
        }
      }
    }

    const inputTokens =
      response.usage?.inputTokens ?? response.usage?.promptTokens;
    const outputTokens =
      response.usage?.outputTokens ?? response.usage?.completionTokens;

    const materialChange = applied.events.some(
      (event) =>
        event.accepted &&
        event.stateChanged !== false &&
        (event.mutation.type === "SET" ||
          event.mutation.type === "REVISE" ||
          event.mutation.type === "REMOVE"),
    );

    const nextConflicts = taskAdapter.deriveConflicts?.(problem, graph) ?? [];
    const nextIssueStates = deriveIssueConvergenceStates(graph, {
      conflicts: nextConflicts,
      currentTurn: turn,
    });
    const fingerprint = solverStateFingerprint({
      problem,
      adapter: taskAdapter,
      graph,
      issueStates: nextIssueStates,
    });

    let readinessInvalidated = false;
    let justConverged = false;
    if (isMoral) {
      const reduced = reduceMoralConvergence(moralConvergence, {
        turn,
        speaker: agentId,
        fingerprint,
        materialChange,
        readyToFinalize: parsed.readyToFinalize === true && !materialChange,
      });
      moralConvergence = reduced.state;
      readinessInvalidated = reduced.readinessInvalidated;
      justConverged = reduced.justConverged;
    }

    const message: ConversationMessage = {
      id: messageId,
      agentId,
      sender: agentId,
      recipient: otherAgentId(agentId),
      role: "assistant",
      content: parsed.message,
      rawContent:
        parsed.raw !== parsed.message ? parsed.raw : undefined,
      reasoningMutations: mutationsFromTurn(parsed.mutations),
      ...(parsed.nothingToAdd ? { nothingToAdd: true } : {}),
      ...(parsed.readyToFinalize === true ? { readyToFinalize: true } : {}),
      ...(parsed.readyToFinalize === false ? { readyToFinalize: false } : {}),
      ...(parsed.focusSubjectIds && parsed.focusSubjectIds.length > 0
        ? { focusSubjectIds: parsed.focusSubjectIds }
        : {}),
      ...(materialChange ? { materialGraphChange: true } : {}),
      ...(readinessInvalidated ? { readinessInvalidated: true } : {}),
      timestamp: new Date().toISOString(),
      turnIndex: turn,
      durationMs: response.durationMs,
      usage: response.usage
        ? {
            inputTokens,
            promptTokens: inputTokens,
            cachedInputTokens: response.usage.cachedInputTokens,
            outputTokens,
            completionTokens: outputTokens,
            totalTokens: response.usage.totalTokens,
            source: response.usage.source,
          }
        : undefined,
      requestTelemetry: telemetry,
      modelRequest: requestMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    messages.push(message);
    callbacks?.onMessage?.(message, graph);

    const mutationCount = applied.events.filter(
      (event) =>
        event.accepted &&
        event.stateChanged !== false &&
        (event.mutation.type === "SET" ||
          event.mutation.type === "REVISE" ||
          event.mutation.type === "REMOVE"),
    ).length;
    const extractedFinalAnswer =
      parsed.finalAnswerText ?? extractFinalAnswerFromText(parsed.message);
    const progressTurn = reduceSolverProgress(solverProgress, {
      turnIndex: turn,
      maxTurns,
      graph,
      events: applied.events,
      issueStates: nextIssueStates,
      fingerprint,
      substantive: mutationCount > 0 || Boolean(parsed.structuredReasoningMissing),
      structuredReasoningMissing: Boolean(parsed.structuredReasoningMissing),
      attemptedFinalAnswer:
        !extractedFinalAnswer &&
        (hasFinalAnswerMarker(parsed.message) || Boolean(parsed.finalAnswerText)),
      stallRecoveryTurns,
      stallFailTurns,
      localLoopTurns,
      cycleWindowTurns,
    });
    solverProgress = progressTurn.state;

    if (justConverged && isMoral && moralConvergence.finalizerId) {
      protocolFeedback = finalizationPhaseCue(moralConvergence.finalizerId);
    }

    const finalAnswer = extractedFinalAnswer;
    if (finalAnswer) {
      const gate = evaluateMoralFinalization({
        category: problem.category,
        turn,
        speaker: agentId,
        graph,
        messages: messages.map((item) => ({
          turnIndex: item.turnIndex,
          agentId: item.agentId,
          content: item.content,
          nothingToAdd: item.nothingToAdd,
          readyToFinalize: item.readyToFinalize,
          materialGraphChange: item.materialGraphChange,
        })),
        extractedFinalAnswer: finalAnswer,
        persistenceRepairDelivered,
        convergence: isMoral ? moralConvergence : undefined,
        currentFingerprint: fingerprint,
      });
      if (!gate.ok) {
        // Premature FINAL_ANSWER is protocol feedback, not a stall.
        protocolFeedback = gate.feedback;
        if (gate.persistRepair) {
          persistenceRepairDelivered = true;
          persistenceRepairCount += 1;
        }
      } else {
        const recorded = applyReasoningMutations(graph, [], {
          actor: agentId,
          turnIndex: turn,
          messageId,
          finalAnswerText: finalAnswer,
        });
        graph = recorded.graph;
        callbacks?.onReasoning?.(graph);
        const resolved = resolveFinalBasis(
          parsed.finalBasisRefs,
          parsed.finalBasisDeclared === true,
          graph,
        );
        capturedFinalBasis = {
          versionIds: resolved.versionIds,
          declared: resolved.declared,
          errors: resolved.errors,
        };
        if (parsed.finalSourceInformationIds?.length) {
          const allowed = allowedSourcesFor(agentId);
          capturedFinalSourceInformationIds = allowed
            ? parsed.finalSourceInformationIds.filter((id) => allowed.has(id))
            : [...parsed.finalSourceInformationIds];
        }
        const deliveredWarningTurn = solverProgress.counters.warningDeliveredTurn;
        if (deliveredWarningTurn !== undefined) {
          solverProgress.counters.finalAnswerAfterWarning = true;
          solverProgress.counters.turnsFromWarningToFinalAnswer =
            turn - deliveredWarningTurn;
        } else if (
          solverProgress.stallWarningTurn !== undefined ||
          solverProgress.closureWarningTurn !== undefined
        ) {
          solverProgress.counters.turnsFromWarningToFinalAnswer = 0;
        }
        if (solverProgress.finalizationRequiredTurn !== undefined) {
          solverProgress.counters.finalAnswerAfterFinalization = true;
        }
        return stop("final_answer");
      }
    } else if (!(justConverged && isMoral)) {
      protocolFeedback = progressTurn.protocolFeedback;
    } else if (
      isMoral &&
      moralConvergence.phase === "finalization" &&
      moralConvergence.finalizerId === agentId &&
      !finalAnswer
    ) {
      protocolFeedback = finalizationPhaseCue(moralConvergence.finalizerId);
    }

    if (progressTurn.stalled) {
      solverProgress.counters.terminatedAsProtocolStall = true;
      return stop("reasoning_protocol_stalled");
    }
  }

  solverProgress.counters.terminatedAsMaxTurns = true;
  return stop("max_turns");
}
