/**
 * Category-specific metric chips and analysis-tab details for a single problem.
 *
 * Live crossword grading is crosswordDetails.ts. Open-ended moral / Hidden
 * Profile views are display-only (Hidden Profile also has objective accuracy).
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
        Final answer recorded:{" "}
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
          Final synthesis: {evaluation.finalAnswer}
        </div>
      ) : (
        <div className="muted">No final synthesis recorded.</div>
      )}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

export function HiddenProfileMetrics({
  evaluation,
  messages,
}: {
  evaluation: ProblemEvaluation;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);
  const selected =
    typeof evaluation.details?.selected === "string"
      ? evaluation.details.selected
      : undefined;
  const gold =
    typeof evaluation.details?.goldAnswer === "string"
      ? evaluation.details.goldAnswer
      : undefined;

  return (
    <div className="results-open-metrics mono">
      <div>Selected: {selected ?? "—"}</div>
      <div>Gold: {gold ?? "—"}</div>
      <div>
        Correct:{" "}
        {evaluation.details?.correct === true
          ? "yes"
          : evaluation.details?.correct === false
            ? "no"
            : "—"}
      </div>
      <div>
        Accuracy score:{" "}
        {typeof evaluation.score === "number" ? evaluation.score : "—"}
      </div>
      <div className="results-open-metrics__summary">
        <div>Time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>Tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}</div>
      </div>
    </div>
  );
}

export function HiddenProfileResultDetails({
  evaluation,
}: {
  evaluation: ProblemEvaluation;
}) {
  return (
    <div className="transcript__result-details">
      <div className="mono results-answer">
        Gold:{" "}
        {typeof evaluation.details?.goldAnswer === "string"
          ? evaluation.details.goldAnswer
          : "—"}
        {" · "}
        Selected:{" "}
        {typeof evaluation.details?.selected === "string"
          ? evaluation.details.selected
          : evaluation.finalAnswer ?? "—"}
        {" · "}
        Correct:{" "}
        {evaluation.details?.correct === true
          ? "yes"
          : evaluation.details?.correct === false
            ? "no"
            : "—"}
      </div>
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

