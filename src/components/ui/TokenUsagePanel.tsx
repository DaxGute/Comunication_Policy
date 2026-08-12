import { formatActualUsd } from "../../experiment/runCost";
import type { ModelUsage } from "../../models/usage";

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString();
}

type UsageBlockProps = {
  title: string;
  usage?: ModelUsage | null;
  costUsd?: number | null;
  showCached?: boolean;
  costFallback?: string;
};

function UsageBlock({
  title,
  usage,
  costUsd,
  showCached,
  costFallback,
}: UsageBlockProps) {
  if (
    !usage &&
    (costUsd === null || costUsd === undefined) &&
    !costFallback
  ) {
    return null;
  }
  return (
    <div className="token-usage__block">
      <h5>{title}</h5>
      <dl>
        <dt>Input</dt>
        <dd className="mono">{formatCount(usage?.inputTokens)}</dd>
        {showCached || (usage?.cachedInputTokens ?? 0) > 0 ? (
          <>
            <dt>Cached</dt>
            <dd className="mono">{formatCount(usage?.cachedInputTokens ?? 0)}</dd>
          </>
        ) : null}
        <dt>Output</dt>
        <dd className="mono">{formatCount(usage?.outputTokens)}</dd>
        <dt>Cost</dt>
        <dd className="mono">
          {typeof costUsd === "number"
            ? formatActualUsd(costUsd)
            : (costFallback ?? "—")}
        </dd>
      </dl>
    </div>
  );
}

export function TokenUsagePanel({
  conversationUsage,
  conversationCostUsd,
  evaluationUsage,
  evaluationCostUsd,
  totalCostUsd,
  usageIncomplete,
  evaluationsRan,
}: {
  conversationUsage?: ModelUsage | null;
  conversationCostUsd?: number | null;
  evaluationUsage?: ModelUsage | null;
  evaluationCostUsd?: number | null;
  totalCostUsd?: number | null;
  usageIncomplete?: boolean;
  /** When false/undefined and no eval usage, show Evaluations as Not run. */
  evaluationsRan?: boolean;
}) {
  const hasEval =
    evaluationsRan === true ||
    !!evaluationUsage ||
    typeof evaluationCostUsd === "number";
  const hasAnything =
    conversationUsage ||
    evaluationUsage ||
    typeof conversationCostUsd === "number" ||
    typeof evaluationCostUsd === "number" ||
    typeof totalCostUsd === "number" ||
    evaluationsRan === false;
  if (!hasAnything) return null;

  return (
    <div className="token-usage">
      <div className="token-usage__columns">
        <UsageBlock
          title="Conversation"
          usage={conversationUsage}
          costUsd={conversationCostUsd}
          showCached
        />
        <UsageBlock
          title="Evaluation"
          usage={hasEval ? evaluationUsage : null}
          costUsd={hasEval ? evaluationCostUsd : null}
          costFallback={hasEval ? undefined : "Not run"}
        />
      </div>
      {typeof totalCostUsd === "number" ? (
        <p className="token-usage__total mono">
          {usageIncomplete ? "Total recorded cost" : "Total actual cost"}{" "}
          {formatActualUsd(totalCostUsd)}
        </p>
      ) : null}
      {usageIncomplete ? (
        <p className="token-usage__incomplete muted">Some usage unavailable</p>
      ) : null}
    </div>
  );
}
