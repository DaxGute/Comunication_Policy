/**
 * Category-specific metric chips and analysis-tab details for a single problem.
 *
 * Live crossword grading is crosswordDetails.ts. Open-ended moral/proof views
 * are display-only.
 */
import type { ProblemEvaluation } from "../../evaluation/types";
import type { ConversationMessage } from "../../experiment/types";
import {
  conversationTotals,
  formatDuration,
  formatPct,
  formatTokenCount,
} from "./format";

export function CrosswordMetrics({
  evaluation,
  messages,
}: {
  evaluation: Pick<ProblemEvaluation, "details">;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);

  return (
    <div className="results-crossword-metrics mono">
      <div>
        Letter accuracy:{" "}
        {formatPct(evaluation.details?.letterAccuracy) ?? "—"}
      </div>
      <div>
        Word accuracy: {formatPct(evaluation.details?.wordAccuracy) ?? "—"}
      </div>
      <div>
        Completion: {formatPct(evaluation.details?.completion) ?? "—"}
      </div>
      <div>
        Crossing consistency:{" "}
        {formatPct(evaluation.details?.crossingConsistency) ?? "n/a"}
      </div>
      <div>
        Exact solve: {evaluation.details?.exactSolve === true ? "Yes" : "No"}
      </div>
      <div className="results-crossword-metrics__summary">
        <div>
          Time:{" "}
          {hasDuration ? formatDuration(totalDurationMs) : "—"}
        </div>
        <div>
          Tokens:{" "}
          {hasTokens ? formatTokenCount(totalTokens) : "—"}
        </div>
      </div>
    </div>
  );
}

export function MoralOpenMetrics({
  evaluation,
  messages,
}: {
  evaluation: ProblemEvaluation;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);
  const tension =
    typeof evaluation.details?.exploredTensionSignals === "number"
      ? evaluation.details.exploredTensionSignals
      : undefined;

  return (
    <div className="results-open-metrics mono">
      <div>
        Stance reached:{" "}
        {evaluation.details?.stanceReached === true ? "Yes" : "No"}
      </div>
      <div>Tension signals: {tension !== undefined ? tension : "—"}</div>
      <div>Gold answer: none (open-ended)</div>
      <div className="results-open-metrics__summary">
        <div>Time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>Tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}</div>
      </div>
    </div>
  );
}

export function MoralResultDetails({ evaluation }: { evaluation: ProblemEvaluation }) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          stance: {evaluation.finalAnswer}
        </div>
      ) : (
        <div className="muted">No joint stance recorded.</div>
      )}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

export function ProofOpenMetrics({
  evaluation,
  messages,
}: {
  evaluation: ProblemEvaluation;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);
  const markers =
    typeof evaluation.details?.proofMarkerCount === "number"
      ? evaluation.details.proofMarkerCount
      : undefined;
  const reference =
    typeof evaluation.details?.referenceProofPreview === "string"
      ? evaluation.details.referenceProofPreview
      : undefined;

  return (
    <div className="results-open-metrics mono">
      <div>
        Proof submitted:{" "}
        {evaluation.details?.proofSubmitted === true ? "Yes" : "No"}
      </div>
      <div>
        Proof-structure signals: {markers !== undefined ? markers : "—"}
      </div>
      <div>Objective score: none (collaborative proof)</div>
      {reference ? (
        <div className="results-open-metrics__reference">
          Reference (inspect only): {reference}
        </div>
      ) : null}
      <div className="results-open-metrics__summary">
        <div>Time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>Tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}</div>
      </div>
    </div>
  );
}

export function ProofResultDetails({ evaluation }: { evaluation: ProblemEvaluation }) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          joint proof: {evaluation.finalAnswer}
        </div>
      ) : (
        <div className="muted">No joint proof recorded.</div>
      )}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

export function ProblemResultDetails({
  evaluation,
}: {
  evaluation: ProblemEvaluation;
}) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          predicted: {evaluation.finalAnswer}
          {typeof evaluation.details?.goldNormalized === "string"
            ? ` · gold: ${evaluation.details.goldNormalized}`
            : ""}
        </div>
      ) : null}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}
