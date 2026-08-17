/**
 * Middle inspector pane: problem header, analysis / conversation / graph tabs.
 *
 * Does not own the run tree or the run-results sidebar.
 */
import { useEffect, useMemo, useState } from "react";
import type { AgentId } from "../../agents/types";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import type { ProblemEvaluation } from "../../evaluation/types";
import { serializeConversation } from "../../experiment/serializeConversation";
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import {
  eventsForMessage,
  hydrateReasoningGraph,
  nodeIdsTouchedByMessage,
} from "../../reasoning";
import type { CrosswordSpec } from "../../problems/crossword/types";
import { CrosswordPreview } from "../crossword/CrosswordBoard";
import { MultiAgentEvaluationPanel } from "../evaluation/MultiAgentEvaluationPanel";
import { ReasoningGraphView } from "../graph/ReasoningGraph";
import { InlineEditableText } from "../ui/InlineEditableText";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { TokenUsagePanel } from "../ui/TokenUsagePanel";
import {
  formatModelRequestForAudit,
  resolveModelRequest,
} from "../../runtime/renderModelRequest";
import {
  CrosswordMetrics,
  MoralOpenMetrics,
  MoralResultDetails,
  ProofOpenMetrics,
  ProofResultDetails,
  ProblemResultDetails,
} from "./problemMetrics";
import { crosswordPredictedGrid, resolveCrosswordDetails } from "./crosswordDetails";
import { CopyJsonButton } from "./shared";
import { messageStatsLabel } from "./format";
import type { InspectorProps, ProblemPaneTab } from "./types";

export function TranscriptView({
  conversation,
  run,
  evaluation,
  evaluationUi,
  onRunEvaluation,
  onRenameProblem,
  crossword,
  tab,
  onTabChange,
  speakingAgentId,
  selectedMessageId,
  selectedNodeId,
  onSelectMessage,
  onSelectNode,
  onOpenConversationTurn,
  onViewReasoning,
}: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  evaluation?: ProblemEvaluation;
  evaluationUi?: InspectorProps["evaluationUi"];
  onRunEvaluation: InspectorProps["onRunEvaluation"];
  onRenameProblem: InspectorProps["onRenameProblem"];
  crossword?: CrosswordSpec;
  tab: ProblemPaneTab;
  onTabChange: (tab: ProblemPaneTab) => void;
  speakingAgentId?: AgentId;
  selectedMessageId?: string;
  selectedNodeId?: string;
  onSelectMessage?: (messageId: string) => void;
  onSelectNode?: (nodeId: string | undefined, messageId?: string) => void;
  onOpenConversationTurn?: (messageId: string, nodeId?: string) => void;
  onViewReasoning?: (messageId: string) => void;
}) {
  const [convoJsonOpen, setConvoJsonOpen] = useState(false);
  const [auditTurn, setAuditTurn] = useState<number | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const crosswordDetails = useMemo(
    () => resolveCrosswordDetails(crossword, conversation, evaluation),
    [conversation, crossword, evaluation],
  );
  const isCrossword = Boolean(crossword) || evaluation?.details?.grader === "crossword";
  const isMoral = evaluation?.details?.grader === "moral_open_ended";
  const isProof = evaluation?.details?.grader === "proof_collaborative";
  const predictedGrid = useMemo(
    () => crosswordPredictedGrid({ crosswordDetails, evaluation }),
    [crosswordDetails, evaluation],
  );

  const convoJsonText = useMemo(
    () => JSON.stringify(serializeConversation(conversation, run), null, 2),
    [conversation, run],
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
        ) : (
          <pre className="transcript__problem mono">
            {conversation.problemText}
          </pre>
        )}
        {!crossword &&
        (hasProblemTokenUsage ||
          (evaluation && (isMoral || isProof))) ? (
          <div className="results-stats-row">
            {evaluation && isMoral ? (
              <MoralOpenMetrics
                evaluation={evaluation}
                messages={conversation.messages}
              />
            ) : null}
            {evaluation && isProof ? (
              <ProofOpenMetrics
                evaluation={evaluation}
                messages={conversation.messages}
              />
            ) : null}
            {problemTokenUsage}
          </div>
        ) : null}
      </header>

      {isIncompleteConversation(conversation) ? (
        <div className="transcript__incomplete" role="status">
          <strong>Incomplete</strong>
          <span>
            Maximum conversation length reached ({run.config.maxTurns} of{" "}
            {run.config.maxTurns} turns) without a final answer.
          </span>
        </div>
      ) : null}

      <div className="problem-tabs" role="tablist" aria-label="Problem views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "analysis"}
          className={tab === "analysis" ? "is-active" : undefined}
          onClick={() => onTabChange("analysis")}
        >
          Analysis
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
          Proposal Graph
        </button>
      </div>

      <div className="problem-tab-panel" role="tabpanel">
        {tab === "analysis" ? (
          <div className="problem-analysis">
            {evaluation && isMoral ? (
              <MoralResultDetails evaluation={evaluation} />
            ) : null}
            {evaluation && isProof ? (
              <ProofResultDetails evaluation={evaluation} />
            ) : null}
            {evaluation && !isCrossword && !isMoral && !isProof ? (
              <ProblemResultDetails evaluation={evaluation} />
            ) : null}
            <MultiAgentEvaluationPanel
              run={run}
              conversation={conversation}
              evaluationUi={evaluationUi}
              onRunEvaluation={onRunEvaluation}
            />
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
                  const graph = hydrateReasoningGraph({
                    reasoningNodes: conversation.reasoningNodes,
                    reasoningEvents: conversation.reasoningEvents,
                  });
                  const turnEvents = eventsForMessage(graph, message.id);
                  const touched = nodeIdsTouchedByMessage(graph, message.id);
                  const rejectedCount = turnEvents.filter(
                    (event) => !event.accepted,
                  ).length;
                  const protocolFailure = turnEvents.some(
                    (event) => event.operation.type === "protocol_failure",
                  );
                  const hasReasoningTurn = turnEvents.length > 0;
                  const opsLabel = [
                    ...touched,
                    rejectedCount > 0 ? `${rejectedCount} rejected` : null,
                    protocolFailure ? "protocol failure" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const selected = message.id === selectedMessageId;
                  const nodeHighlight =
                    Boolean(selectedNodeId) &&
                    touched.includes(selectedNodeId!);
                  const expanded = expandedMessageIds.has(message.id);
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
                            {opsLabel ? (
                              <span className="transcript__msg-ops">
                                {opsLabel}
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
                            {hasReasoningTurn ? (
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
                            ) : null}
                            <button
                              type="button"
                              className="transcript__msg-audit"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setAuditTurn(message.turnIndex);
                              }}
                            >
                              Model request
                            </button>
                          </span>
                        </summary>
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
                      </details>
                    </li>
                  );
                })}
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
            onOpenSourceTurn={(messageId, nodeId) => {
              onOpenConversationTurn?.(messageId, nodeId);
            }}
          />
        ) : null}
      </div>

      {convoJsonOpen ? (
        <TextPreviewModal
          title="Conversation JSON"
          text={convoJsonText}
          onClose={() => setConvoJsonOpen(false)}
        />
      ) : null}
      {auditTurn !== null ? (
        <ModelRequestAuditModal
          conversation={conversation}
          run={run}
          turnIndex={auditTurn}
          onClose={() => setAuditTurn(null)}
        />
      ) : null}
    </div>
  );
}

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
      title={`Model request · turn ${turnIndex} · ${speaker}${stored ? "" : " · reconstructed"}`}
      text={text}
      onClose={onClose}
    />
  );
}
