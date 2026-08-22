/**
 * Middle inspector pane: problem header, analysis / conversation / graph tabs.
 *
 * Does not own the run tree or the run-results sidebar.
 */
import { memo, useEffect, useMemo, useState } from "react";
import type { AgentId } from "../../agents/types";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import type { ProblemEvaluation } from "../../evaluation/types";
import { isProblemAnalysisRunning } from "../../experiment/evaluationUi";
import { serializeConversation } from "../../experiment/serializeConversation";
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import {
  hydrateReasoningGraph,
  nodeIdsTouchedByMessage,
  computeTurnScopes,
  type ReasoningGraph,
  type TurnScopeDiagnostics,
} from "../../reasoning";
import type { CrosswordSpec } from "../../problems/crossword/types";
import type { HiddenProfileSpec } from "../../problems/hidden_profile/types";
import type { MoralSpec } from "../../problems/moral/types";
import { CrosswordPreview } from "../crossword/CrosswordBoard";
import { MultiAgentEvaluationPanel } from "../evaluation/MultiAgentEvaluationPanel";
import { ReasoningGraphView } from "../graph/ReasoningGraph";
import { HiddenProfilePreview } from "../hiddenProfile/HiddenProfilePreview";
import { InformationFlowInspector } from "../hiddenProfile/InformationFlowInspector";
import { MoralPreview } from "../moral/MoralPreview";
import { InlineEditableText } from "../ui/InlineEditableText";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { TokenUsagePanel } from "../ui/TokenUsagePanel";
import {
  formatModelRequestForAudit,
  formatTurnMemoryForAudit,
  resolveModelRequest,
} from "../../runtime/renderModelRequest";
import {
  CrosswordMetrics,
  HiddenProfileMetrics,
  HiddenProfileResultDetails,
  MoralOpenMetrics,
  MoralResultDetails,
  ProblemResultDetails,
} from "./problemMetrics";
import { crosswordPredictedGrid, resolveCrosswordDetails } from "./crosswordDetails";
import { InformationAssignmentPanel } from "./InformationAssignmentPanel";
import { CopyJsonButton, InspectorBusySpinner } from "./shared";
import { messageStatsLabel } from "./format";
import type { InspectorProps, ProblemPaneTab } from "./types";

export const TranscriptView = memo(function TranscriptView({
  conversation,
  run,
  evaluation,
  evaluationUi,
  onRunEvaluation,
  onRenameProblem,
  crossword,
  moral,
  hiddenProfile,
  tab,
  onTabChange,
  speakingAgentId,
  selectedMessageId,
  selectedNodeId,
  onSelectMessage,
  onSelectNode,
  onViewReasoning,
}: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  evaluation?: ProblemEvaluation;
  evaluationUi?: InspectorProps["evaluationUi"];
  onRunEvaluation: InspectorProps["onRunEvaluation"];
  onRenameProblem: InspectorProps["onRenameProblem"];
  crossword?: CrosswordSpec;
  moral?: MoralSpec;
  hiddenProfile?: HiddenProfileSpec;
  tab: ProblemPaneTab;
  onTabChange: (tab: ProblemPaneTab) => void;
  speakingAgentId?: AgentId;
  selectedMessageId?: string;
  selectedNodeId?: string;
  onSelectMessage?: (messageId: string) => void;
  onSelectNode?: (nodeId: string | undefined, messageId?: string) => void;
  onViewReasoning?: (messageId: string) => void;
}) {
  const [convoJsonOpen, setConvoJsonOpen] = useState(false);
  const [audit, setAudit] = useState<{
    kind: "request" | "memory";
    turn: number;
  } | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const crosswordDetails = useMemo(
    () => resolveCrosswordDetails(crossword, conversation, evaluation),
    [conversation, crossword, evaluation],
  );
  const isCrossword = Boolean(crossword) || evaluation?.details?.grader === "crossword";
  const isMoral =
    Boolean(moral) ||
    evaluation?.details?.grader === "moral_open_ended" ||
    run.config.problemCategory === "moral_philosophical";
  const isHiddenProfile =
    Boolean(hiddenProfile) ||
    evaluation?.details?.grader === "hidden_profile" ||
    run.config.problemCategory === "hidden_profile";
  const usesEndogenousFinalization = isMoral || isHiddenProfile;
  const predictedGrid = useMemo(
    () => crosswordPredictedGrid({ crosswordDetails, evaluation }),
    [crosswordDetails, evaluation],
  );
  const moralAnswer =
    evaluation?.finalAnswer?.trim() ||
    conversation.finalAnswer?.trim() ||
    undefined;

  const reasoningGraph = useMemo(
    () =>
      hydrateReasoningGraph({
        reasoningSchemaVersion: conversation.reasoningSchemaVersion,
        reasoningSubjects: conversation.reasoningSubjects,
        reasoningVersions: conversation.reasoningVersions,
        reasoningEvents: conversation.reasoningEvents,
      }),
    [
      conversation.reasoningSchemaVersion,
      conversation.reasoningSubjects,
      conversation.reasoningVersions,
      conversation.reasoningEvents,
    ],
  );
  const turnScopesByTurn = useMemo(() => {
    if (!usesEndogenousFinalization) return new Map<number, TurnScopeDiagnostics>();
    const scopes =
      conversation.reasoningDiagnostics?.collaboration?.turnScopes ??
      computeTurnScopes(
        reasoningGraph,
        conversation.messages.map((message) => ({
          turnIndex: message.turnIndex,
          agentId: message.agentId,
          content: message.content,
          nothingToAdd: message.nothingToAdd,
          readyToFinalize: message.readyToFinalize,
          materialGraphChange: message.materialGraphChange,
          readinessInvalidated: message.readinessInvalidated,
          focusSubjectIds: message.focusSubjectIds,
        })),
      );
    return new Map(scopes.map((scope) => [scope.turnIndex, scope]));
  }, [
    usesEndogenousFinalization,
    conversation.reasoningDiagnostics?.collaboration?.turnScopes,
    conversation.messages,
    reasoningGraph,
  ]);
  const convoJsonText = useMemo(
    () =>
      convoJsonOpen
        ? JSON.stringify(serializeConversation(conversation, run), null, 2)
        : "",
    [convoJsonOpen, conversation, run],
  );

  useEffect(() => {
    if (tab !== "conversation" || !selectedMessageId) return;
    setExpandedMessageIds((prev) => {
      if (prev.has(selectedMessageId)) return prev;
      const next = new Set(prev);
      next.add(selectedMessageId);
      return next;
    });
    const el = document.querySelector(
      `[data-message-id="${CSS.escape(selectedMessageId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedMessageId, tab]);

  const messageIds = conversation.messages.map((m) => m.id);
  const allMessagesExpanded =
    messageIds.length > 0 && messageIds.every((id) => expandedMessageIds.has(id));
  const allMessagesCollapsed = expandedMessageIds.size === 0;

  const expandAllMessages = () => {
    setExpandedMessageIds(new Set(messageIds));
  };
  const collapseAllMessages = () => {
    setExpandedMessageIds(new Set());
  };
  const toggleMessageExpanded = (messageId: string, open: boolean) => {
    setExpandedMessageIds((prev) => {
      if (open === prev.has(messageId)) return prev;
      const next = new Set(prev);
      if (open) next.add(messageId);
      else next.delete(messageId);
      return next;
    });
  };

  const problemEvals = (run.multiAgentEvaluations ?? []).filter(
    (e) => e.problemId === conversation.problemId,
  );
  const latestProblemEval = [...problemEvals].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const analysisRunning = isProblemAnalysisRunning(
    run,
    conversation.problemId,
    evaluationUi,
  );
  const hasProblemTokenUsage =
    !!conversation.conversationUsage ||
    !!latestProblemEval?.usage ||
    typeof conversation.conversationCostUsd === "number" ||
    typeof latestProblemEval?.costUsd === "number";
  const problemTokenUsage = (
    <TokenUsagePanel
      conversationUsage={conversation.conversationUsage}
      conversationCostUsd={conversation.conversationCostUsd}
      evaluationUsage={latestProblemEval?.usage}
      evaluationCostUsd={latestProblemEval?.costUsd}
      totalCostUsd={
        typeof conversation.conversationCostUsd === "number" ||
        typeof latestProblemEval?.costUsd === "number"
          ? (conversation.conversationCostUsd ?? 0) +
            (latestProblemEval?.costUsd ?? 0)
          : null
      }
    />
  );

  return (
    <div className="transcript">
      <header className="transcript__header">
        <div className="transcript__title-row">
          <InlineEditableText
            as="h3"
            value={conversation.problemTitle}
            className="transcript__editable-title"
            inputClassName="transcript__editable-input"
            ariaLabel={`Rename problem ${conversation.problemTitle}`}
            onCommit={(next) =>
              onRenameProblem(run.id, conversation.problemId, next)
            }
          />
          <CopyJsonButton
            label="Copy Convo JSON"
            onClick={() => setConvoJsonOpen(true)}
          />
        </div>
        {crossword ? (
          <CrosswordPreview
            crossword={crossword}
            predictedGrid={predictedGrid}
            aside={
              crosswordDetails || hasProblemTokenUsage ? (
                <div className="results-stats-row">
                  {crosswordDetails ? (
                    <CrosswordMetrics
                      evaluation={{ details: crosswordDetails }}
                      messages={conversation.messages}
                    />
                  ) : null}
                  {problemTokenUsage}
                </div>
              ) : undefined
            }
          />
        ) : moral ? (
          <>
            <MoralPreview moral={moral} answer={moralAnswer} />
            {hasProblemTokenUsage || evaluation ? (
              <div className="results-stats-row">
                {evaluation ? (
                  <MoralOpenMetrics
                    evaluation={evaluation}
                    messages={conversation.messages}
                  />
                ) : null}
                {problemTokenUsage}
              </div>
            ) : null}
          </>
        ) : hiddenProfile ? (
          <>
            <HiddenProfilePreview
              spec={hiddenProfile}
              selected={
                typeof evaluation?.details?.selected === "string"
                  ? evaluation.details.selected
                  : evaluation?.finalAnswer
              }
              gold={
                typeof evaluation?.details?.goldAnswer === "string"
                  ? evaluation.details.goldAnswer
                  : hiddenProfile.goldAnswer
              }
              correct={
                typeof evaluation?.details?.correct === "boolean"
                  ? evaluation.details.correct
                  : undefined
              }
            />
            {hasProblemTokenUsage || evaluation ? (
              <div className="results-stats-row">
                {evaluation ? (
                  <HiddenProfileMetrics
                    evaluation={evaluation}
                    messages={conversation.messages}
                  />
                ) : null}
                {problemTokenUsage}
              </div>
            ) : null}
          </>
        ) : (
          <pre className="transcript__problem mono">
            {conversation.problemText}
          </pre>
        )}
      </header>

      {isIncompleteConversation(conversation) ? (
        <div className="transcript__incomplete" role="status">
          <strong>Incomplete</strong>
          <span>
            Maximum conversation length reached ({run.config.maxTurns} of{" "}
            {run.config.maxTurns} turns) without a final answer
            {conversation.stoppedReason === "reasoning_protocol_stalled"
              ? conversation.reasoningDiagnostics?.solverProgress
                  ?.semanticStallReason
                ? ` because the solver stalled (${conversation.reasoningDiagnostics.solverProgress.semanticStallReason.replaceAll("_", " ")}).`
                : " because canonical solver state stalled."
              : "."}
          </span>
        </div>
      ) : null}

      <div className="problem-tabs" role="tablist" aria-label="Problem views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "analysis"}
          aria-busy={analysisRunning || undefined}
          className={tab === "analysis" ? "is-active" : undefined}
          onClick={() => onTabChange("analysis")}
        >
          Analysis
          {analysisRunning ? (
            <InspectorBusySpinner kind="analysis" />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "conversation"}
          className={tab === "conversation" ? "is-active" : undefined}
          onClick={() => onTabChange("conversation")}
        >
          Conversation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "graph"}
          className={tab === "graph" ? "is-active" : undefined}
          onClick={() => onTabChange("graph")}
        >
          Reasoning Graph
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "information"}
          className={tab === "information" ? "is-active" : undefined}
          onClick={() => onTabChange("information")}
        >
          Information
        </button>
      </div>

      <div className="problem-tab-panel" role="tabpanel">
        {tab === "analysis" ? (
          <div className="problem-analysis">
            {evaluation && isMoral ? (
              <MoralResultDetails evaluation={evaluation} />
            ) : null}
            {evaluation && isHiddenProfile ? (
              <HiddenProfileResultDetails evaluation={evaluation} />
            ) : null}
            {evaluation &&
            !isCrossword &&
            !isMoral &&
            !isHiddenProfile ? (
              <ProblemResultDetails evaluation={evaluation} />
            ) : null}
            <MultiAgentEvaluationPanel
              run={run}
              conversation={conversation}
              evaluationUi={evaluationUi}
              onRunEvaluation={onRunEvaluation}
            />
            {conversation.reasoningDiagnostics?.solverProgress ? (
              <details className="protocol-diagnostics muted">
                <summary>Solver progress diagnostics</summary>
                <pre className="mono">
                  {JSON.stringify(
                    {
                      rawMutationCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .rawMutationCount,
                      meaningfulStateTransitionCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .meaningfulStateTransitionCount,
                      noOpMutationCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .noOpMutationCount,
                      repeatedStateCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .repeatedStateCount,
                      cycleDetectionCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .cycleDetectionCount,
                      localLoopInterventions:
                        conversation.reasoningDiagnostics.solverProgress
                          .localLoopInterventions,
                      diversificationInterventions:
                        conversation.reasoningDiagnostics.solverProgress
                          .diversificationInterventions,
                      semanticStallReason:
                        conversation.reasoningDiagnostics.solverProgress
                          .semanticStallReason,
                      freezeType:
                        conversation.reasoningDiagnostics.solverProgress
                          .freezeType,
                      freezeDetectedTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .freezeDetectedTurn,
                      stallWarningTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .stallWarningTurn,
                      stallWarningKind:
                        conversation.reasoningDiagnostics.solverProgress
                          .stallWarningKind,
                      stallWarningFingerprint:
                        conversation.reasoningDiagnostics.solverProgress
                          .stallWarningFingerprint,
                      warningDeliveredTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .warningDeliveredTurn,
                      closureWarningTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .closureWarningTurn,
                      closureWarningReason:
                        conversation.reasoningDiagnostics.solverProgress
                          .closureWarningReason,
                      finalizationRequiredTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .finalizationRequiredTurn,
                      finalizationDeliveredTurn:
                        conversation.reasoningDiagnostics.solverProgress
                          .finalizationDeliveredTurn,
                      recoveryTurnCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .recoveryTurnCount,
                      recoveryTurnsBeforeFinalization:
                        conversation.reasoningDiagnostics.solverProgress
                          .recoveryTurnsBeforeFinalization,
                      progressResumedAfterWarning:
                        conversation.reasoningDiagnostics.solverProgress
                          .progressResumedAfterWarning,
                      finalAnswerAfterWarning:
                        conversation.reasoningDiagnostics.solverProgress
                          .finalAnswerAfterWarning,
                      finalAnswerAfterFinalization:
                        conversation.reasoningDiagnostics.solverProgress
                          .finalAnswerAfterFinalization,
                      turnsFromWarningToFinalAnswer:
                        conversation.reasoningDiagnostics.solverProgress
                          .turnsFromWarningToFinalAnswer,
                      terminatedAsProtocolStall:
                        conversation.reasoningDiagnostics.solverProgress
                          .terminatedAsProtocolStall,
                      terminatedAsMaxTurns:
                        conversation.reasoningDiagnostics.solverProgress
                          .terminatedAsMaxTurns,
                      stallWarningCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .stallWarningCount,
                      closureWarningCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .closureWarningCount,
                      finalizationRequiredCount:
                        conversation.reasoningDiagnostics.solverProgress
                          .finalizationRequiredCount,
                      protocolStallStreak:
                        conversation.reasoningDiagnostics.protocolStallStreak,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {tab === "conversation" ? (
          <div className="transcript__conversation">
            <header className="transcript__conversation-header">
              <h3>Conversation</h3>
              {conversation.messages.length > 0 ? (
                <div className="transcript__conversation-controls">
                  <button
                    type="button"
                    className="transcript__conversation-toggle"
                    disabled={allMessagesExpanded}
                    onClick={expandAllMessages}
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className="transcript__conversation-toggle"
                    disabled={allMessagesCollapsed}
                    onClick={collapseAllMessages}
                  >
                    Collapse all
                  </button>
                </div>
              ) : null}
            </header>
            {conversation.messages.length === 0 ? (
              <p className="muted">No turns yet.</p>
            ) : (
              <ol className="transcript__messages">
                {conversation.messages.map((message) => {
                  const agentLabel =
                    message.agentId === "agent_a" ? "Agent A" : "Agent B";
                  const stats = messageStatsLabel(message);
                  const touched = nodeIdsTouchedByMessage(reasoningGraph, message.id);
                  const selected = message.id === selectedMessageId;
                  const nodeHighlight =
                    Boolean(selectedNodeId) &&
                    touched.includes(selectedNodeId!);
                  const expanded = expandedMessageIds.has(message.id);
                  const turnScope = turnScopesByTurn.get(message.turnIndex);
                  return (
                    <li
                      key={message.id}
                      data-message-id={message.id}
                      className={[
                        "transcript__msg",
                        message.agentId === "agent_a"
                          ? "transcript__msg--a"
                          : "transcript__msg--b",
                        selected || nodeHighlight
                          ? "transcript__msg--linked"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onSelectMessage?.(message.id)}
                    >
                      <details
                        className="transcript__msg-fold"
                        open={expanded}
                        onToggle={(event) => {
                          toggleMessageExpanded(
                            message.id,
                            event.currentTarget.open,
                          );
                        }}
                      >
                        <summary className="transcript__msg-head">
                          <span className="transcript__msg-head-main">
                            <svg
                              className="transcript__msg-chevron"
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              aria-hidden="true"
                            >
                              <path
                                d="M3 4.5 6 7.5 9 4.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <strong>
                              Turn {message.turnIndex} · {agentLabel}
                            </strong>
                            {usesEndogenousFinalization ? (
                              <span className="transcript__msg-protocol muted">
                                {message.materialGraphChange
                                  ? "Graph changed"
                                  : "No material change"}
                                {message.readyToFinalize === true
                                  ? " · Ready to finalize"
                                  : ""}
                                {message.readinessInvalidated
                                  ? " · Readiness reset"
                                  : ""}
                              </span>
                            ) : null}
                            {usesEndogenousFinalization && turnScope ? (
                              <span className="transcript__msg-scope muted mono">
                                created {turnScope.considerationsCreated} ·
                                revised {turnScope.considerationsRevised} ·
                                touched {turnScope.considerationsTouched} ·
                                {turnScope.messageChars} chars ·
                                {turnScope.graphChanged
                                  ? " graphΔ"
                                  : " no graphΔ"}
                                {turnScope.partnerPriorGraphChange
                                  ? " · partnerΔ prior"
                                  : ""}
                                {turnScope.readyToFinalize === true
                                  ? " · ready"
                                  : turnScope.readyToFinalize === false
                                    ? " · not ready"
                                    : ""}
                                {turnScope.focusSubjectIds?.length
                                  ? ` · focus ${turnScope.focusSubjectIds.join(", ")}`
                                  : ""}
                              </span>
                            ) : null}
                          </span>
                          <span className="transcript__msg-head-meta muted mono">
                            {stats ? <span>{stats}</span> : null}
                            {message.timestamp ? (
                              <span>
                                {new Date(
                                  message.timestamp,
                                ).toLocaleTimeString()}
                              </span>
                            ) : null}
                            <button
                                type="button"
                                className="transcript__msg-audit"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onSelectMessage?.(message.id);
                                  onViewReasoning?.(message.id);
                                }}
                              >
                                View reasoning
                              </button>
                            <button
                              type="button"
                              className="transcript__msg-audit"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setAudit({
                                  kind: "memory",
                                  turn: message.turnIndex,
                                });
                              }}
                            >
                              Memory
                            </button>
                            <button
                              type="button"
                              className="transcript__msg-audit"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setAudit({
                                  kind: "request",
                                  turn: message.turnIndex,
                                });
                              }}
                            >
                              Model request
                            </button>
                          </span>
                        </summary>
                        {expanded ? (
                          <>
                            <pre className="transcript__msg-body">
                              {message.content}
                            </pre>
                            {message.rawContent ? (
                              <details className="transcript__raw">
                                <summary>Raw model output</summary>
                                <pre className="transcript__msg-body">
                                  {message.rawContent}
                                </pre>
                              </details>
                            ) : null}
                          </>
                        ) : null}
                      </details>
                    </li>
                  );
                })}
                {usesEndogenousFinalization &&
                conversation.stoppedReason === "final_answer" ? (
                  <li className="transcript__msg transcript__msg--protocol">
                    <div className="transcript__convergence">
                      CONVERGED · FINAL SYNTHESIS
                      {conversation.messages.at(-1)?.agentId === "agent_a"
                        ? " · Agent A"
                        : conversation.messages.at(-1)?.agentId === "agent_b"
                          ? " · Agent B"
                          : ""}
                    </div>
                  </li>
                ) : null}
              </ol>
            )}
          </div>
        ) : null}

        {tab === "graph" ? (
          <ReasoningGraphView
            conversation={conversation}
            speakingAgentId={
              conversation.status === "running" ? speakingAgentId : undefined
            }
            selectedNodeId={selectedNodeId}
            selectedMessageId={selectedMessageId}
            compact
            onSelectNode={onSelectNode}
          />
        ) : null}

        {tab === "information" ? (
          <>
            <InformationAssignmentPanel
              assignment={conversation.informationAssignment}
            />
            {isHiddenProfile ? (
              <InformationFlowInspector conversation={conversation} />
            ) : null}
          </>
        ) : null}
      </div>

      {convoJsonOpen ? (
        <TextPreviewModal
          title="Conversation JSON"
          text={convoJsonText}
          onClose={() => setConvoJsonOpen(false)}
        />
      ) : null}
      {audit?.kind === "request" ? (
        <ModelRequestAuditModal
          conversation={conversation}
          run={run}
          turnIndex={audit.turn}
          onClose={() => setAudit(null)}
        />
      ) : null}
      {audit?.kind === "memory" ? (
        <TurnMemoryAuditModal
          conversation={conversation}
          graph={reasoningGraph}
          turnIndex={audit.turn}
          onClose={() => setAudit(null)}
        />
      ) : null}
    </div>
  );
});

function ModelRequestAuditModal({
  conversation,
  run,
  turnIndex,
  onClose,
}: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  turnIndex: number;
  onClose: () => void;
}) {
  const message = conversation.messages.find((m) => m.turnIndex === turnIndex);
  const speaker =
    message?.agentId === "agent_a"
      ? "Agent A"
      : message?.agentId === "agent_b"
        ? "Agent B"
        : "unknown";
  const text = message
    ? formatModelRequestForAudit(
        resolveModelRequest({ message, conversation, run }),
      )
    : "No message for this turn.";
  const stored = Boolean(message?.modelRequest && message.modelRequest.length > 0);

  return (
    <TextPreviewModal
      title={`Model request · turn ${turnIndex} · ${speaker}${stored ? " · persisted" : " · RECONSTRUCTED WITH CURRENT SERIALIZER"}`}
      text={text}
      onClose={onClose}
    />
  );
}

function TurnMemoryAuditModal({
  conversation,
  graph,
  turnIndex,
  onClose,
}: {
  conversation: ProblemConversation;
  graph: ReasoningGraph;
  turnIndex: number;
  onClose: () => void;
}) {
  const message = conversation.messages.find((m) => m.turnIndex === turnIndex);
  const speaker =
    message?.agentId === "agent_a"
      ? "Agent A"
      : message?.agentId === "agent_b"
        ? "Agent B"
        : "unknown";
  const stored = Boolean(
    message?.modelRequest?.some((item) =>
      item.content.startsWith("CURRENT SHARED REASONING STATE"),
    ),
  );
  return (
    <TextPreviewModal
      title={`Memory · turn ${turnIndex} · ${speaker}${stored ? " · persisted" : " · RECONSTRUCTED WITH CURRENT SERIALIZER"}`}
      text={formatTurnMemoryForAudit({
        graph,
        conversation,
        turn: turnIndex,
      })}
      onClose={onClose}
    />
  );
}
