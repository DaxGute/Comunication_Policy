/**
 * Read-only adapter between experiment store data and the center-pane UI.
 * Visualization components should consume these shapes only — never execution internals.
 */

import type { AgentId } from "../../agents/types";
import type {
  EvaluationResult,
  ProblemEvaluation,
} from "../../evaluation/types";
import { totalTokens, type ModelUsage } from "../../models/usage";
import { displayRunTitle } from "../../experiment/runTitle";
import type {
  ExperimentRun,
  ProblemConversation,
} from "../../experiment/types";
import {
  AXIS_METRIC_CATALOG,
  axisMetricDef,
  collectEvalAxisMetrics,
  groupAvailableAxisMetrics,
  isEvaluationMetric,
  isPolicyMetric,
  latestEvalsForRun,
  type AxisMetricGroup,
  type AxisMetricKind,
} from "./axisMetrics";

export type ProblemStatus =
  | "running"
  | "complete"
  | "incomplete"
  | "failed"
  | "cancelled";

export type RunMetricId =
  | "aggregateScore"
  | "accuracy"
  | "problemCount"
  | "completedProblems"
  | "incompleteProblems"
  | "meanTurns"
  | "medianTurns"
  | "totalMessages"
  | "meanMessages"
  | "totalTokens"
  | "meanTokens"
  | "durationMs"
  | "meanProblemDurationMs"
  | "trustA"
  | "trustB"
  | "authority"
  | "familiarity";

export const RUN_METRIC_LABELS: Record<RunMetricId, string> = {
  aggregateScore: "Aggregate score",
  accuracy: "Accuracy",
  problemCount: "Problems",
  completedProblems: "Completed",
  incompleteProblems: "Incomplete",
  meanTurns: "Mean turns",
  medianTurns: "Median turns",
  totalMessages: "Total messages",
  meanMessages: "Avg run length",
  totalTokens: "Total tokens",
  meanTokens: "Mean tokens",
  durationMs: "Duration",
  meanProblemDurationMs: "Mean problem duration",
  trustA: "Trust A→B",
  trustB: "Trust B→A",
  authority: "Authority",
  familiarity: "Familiarity",
};

export type AttentionKind =
  | "failed"
  | "incomplete"
  | "high_turns"
  | "high_duration"
  | "high_tokens"
  | "low_score"
  | "high_score"
  | "score_outlier"
  | "many_messages";

export type AttentionItem = {
  problemId: string;
  label: string;
  kind: AttentionKind;
  detail: string;
  severity: number;
};

export type ProblemSummary = {
  problemId: string;
  shortLabel: string;
  title: string;
  status: ProblemStatus;
  messageCount: number;
  turnCount: number;
  score?: number;
  /** True when score is binary-ish and equals 1, or crossword exactSolve. */
  isCorrect?: boolean;
  hasScore: boolean;
  tokenTotal?: number;
  durationMs?: number;
  stoppedReason: ProblemConversation["stoppedReason"];
  error?: string;
  lastAgentId?: AgentId;
  /** Live speaker while this problem is running (server-authoritative). */
  speakingAgentId?: AgentId;
  evaluationLabel?: string;
};

export type RunSummary = {
  runId: string;
  displayIndex: number;
  title: string;
  status: ExperimentRun["status"];
  createdAt: string;
  finishedAt?: string;
  trustA: number;
  trustB: number;
  authority: number;
  familiarity: number;
  problemCount: number;
  completedCount: number;
  incompleteCount: number;
  runningCount: number;
  failedCount: number;
  cancelledCount: number;
  correctCount?: number;
  scoredCount: number;
  aggregateScore?: number;
  accuracy?: number;
  meanTurns?: number;
  medianTurns?: number;
  totalMessages: number;
  meanMessages?: number;
  totalTokens?: number;
  meanTokens?: number;
  durationMs?: number;
  meanProblemDurationMs?: number;
  metrics: Partial<Record<string, number>>;
  /** Sample SD (n−1) of per-problem values for the same keys as `metrics`. */
  metricSds: Partial<Record<string, number>>;
  problems: ProblemSummary[];
  attention: AttentionItem[];
  /**
   * True when the selected problem (or sole running problem) can drive the
   * speaking animation from per-problem `speakingAgentId`.
   */
  speakingUnambiguous: boolean;
};

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid];
}

function stdDev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const m = mean(values);
  if (m === undefined) return undefined;
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sampleSd(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const m = mean(values);
  if (m === undefined) return undefined;
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function usageTotal(usage?: ModelUsage): number | undefined {
  if (!usage) return undefined;
  const n = totalTokens(usage);
  return n > 0 ? n : undefined;
}

function conversationDurationMs(
  conversation: ProblemConversation,
): number | undefined {
  const fromMessages = conversation.messages.reduce((sum, m) => {
    return sum + (typeof m.durationMs === "number" ? m.durationMs : 0);
  }, 0);
  if (fromMessages > 0) return fromMessages;

  const stamps = conversation.messages
    .map((m) => m.timestamp)
    .filter((t): t is string => Boolean(t))
    .map((t) => Date.parse(t))
    .filter((n) => Number.isFinite(n));
  if (stamps.length >= 2) {
    return Math.max(...stamps) - Math.min(...stamps);
  }
  return undefined;
}

function turnCountFor(conversation: ProblemConversation): number {
  if (conversation.messages.length === 0) return 0;
  let max = 0;
  for (const m of conversation.messages) {
    if (m.turnIndex > max) max = m.turnIndex;
  }
  return max > 0 ? max : conversation.messages.length;
}

function problemStatus(conversation: ProblemConversation): ProblemStatus {
  if (conversation.status === "running") return "running";
  if (conversation.stoppedReason === "error") return "failed";
  if (conversation.stoppedReason === "cancelled") return "cancelled";
  if (conversation.stoppedReason === "max_turns") return "incomplete";
  return "complete";
}

function evalByProblemId(
  evaluation?: EvaluationResult,
): Map<string, ProblemEvaluation> {
  const map = new Map<string, ProblemEvaluation>();
  if (!evaluation) return map;
  for (const p of evaluation.problems) {
    map.set(p.problemId, p);
  }
  return map;
}

function shortProblemLabel(problemId: string, index: number): string {
  const compact = problemId.replace(/^problem[_-]?/i, "").slice(0, 12);
  if (compact && compact !== problemId) {
    return compact.length >= 3 ? compact : `P${String(index + 1).padStart(3, "0")}`;
  }
  if (problemId.length <= 10) return problemId;
  return `P${String(index + 1).padStart(3, "0")}`;
}

function correctnessFromEval(
  evaluation: ProblemEvaluation | undefined,
): boolean | undefined {
  if (!evaluation) return undefined;
  if (evaluation.details?.exactSolve === true) return true;
  if (evaluation.details?.exactSolve === false) return false;
  if (typeof evaluation.score === "number") {
    // Binary graders use 0/1; continuous scores treat exact 1 as correct.
    if (evaluation.score === 1) return true;
    if (evaluation.score === 0) return false;
  }
  return undefined;
}

function runDurationMs(run: ExperimentRun): number | undefined {
  if (run.finishedAt) {
    const start = Date.parse(run.createdAt);
    const end = Date.parse(run.finishedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return end - start;
    }
  }
  if (run.status === "running" || run.status === "queued") {
    const start = Date.parse(run.startedAt ?? run.createdAt);
    if (Number.isFinite(start)) return Date.now() - start;
  }
  return undefined;
}

function numericSummaryField(
  summary: Record<string, number | string> | undefined,
  key: string,
): number | undefined {
  if (!summary) return undefined;
  const v = summary[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function getProblemSummary(
  conversation: ProblemConversation,
  index: number,
  evaluation?: ProblemEvaluation,
): ProblemSummary {
  const status = problemStatus(conversation);
  const score =
    status === "incomplete"
      ? undefined
      : typeof evaluation?.score === "number"
        ? evaluation.score
        : undefined;
  const isCorrect =
    status === "incomplete" ? undefined : correctnessFromEval(evaluation);
  const tokenTotal = usageTotal(conversation.conversationUsage);
  const durationMs = conversationDurationMs(conversation);
  const last = conversation.messages[conversation.messages.length - 1];

  return {
    problemId: conversation.problemId,
    shortLabel: shortProblemLabel(conversation.problemId, index),
    title: conversation.problemTitle,
    status,
    messageCount: conversation.messages.length,
    turnCount: turnCountFor(conversation),
    score,
    isCorrect,
    hasScore: score !== undefined,
    tokenTotal,
    durationMs,
    stoppedReason: conversation.stoppedReason,
    error: conversation.error,
    lastAgentId: last?.agentId,
    speakingAgentId:
      status === "running" ? conversation.speakingAgentId : undefined,
    evaluationLabel: evaluation?.label,
  };
}

function buildAttention(problems: ProblemSummary[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const finished = problems.filter(
    (p) => p.status !== "running" && p.status !== "incomplete",
  );

  for (const p of problems) {
    if (p.status === "failed") {
      items.push({
        problemId: p.problemId,
        label: p.shortLabel,
        kind: "failed",
        detail: p.error?.slice(0, 80) || "Failed",
        severity: 100,
      });
    }
    if (p.status === "incomplete") {
      items.push({
        problemId: p.problemId,
        label: p.shortLabel,
        kind: "incomplete",
        detail: "Reached max turns",
        severity: 80,
      });
    }
  }

  const turnVals = finished.map((p) => p.turnCount);
  const turnMean = mean(turnVals);
  const turnSd = stdDev(turnVals);
  if (turnMean !== undefined && turnSd !== undefined && turnSd > 0) {
    for (const p of finished) {
      if (p.turnCount > turnMean + 1.5 * turnSd) {
        items.push({
          problemId: p.problemId,
          label: p.shortLabel,
          kind: "high_turns",
          detail: `${p.turnCount} turns (mean ${turnMean.toFixed(1)})`,
          severity: 40 + (p.turnCount - turnMean) / turnSd,
        });
      }
    }
  }

  const durVals = finished
    .map((p) => p.durationMs)
    .filter((v): v is number => typeof v === "number");
  const durMean = mean(durVals);
  const durSd = stdDev(durVals);
  if (durMean !== undefined && durSd !== undefined && durSd > 0) {
    for (const p of finished) {
      if (
        typeof p.durationMs === "number" &&
        p.durationMs > durMean + 1.5 * durSd
      ) {
        items.push({
          problemId: p.problemId,
          label: p.shortLabel,
          kind: "high_duration",
          detail: `Long duration (${formatDuration(p.durationMs)})`,
          severity: 35 + (p.durationMs - durMean) / durSd,
        });
      }
    }
  }

  const tokVals = finished
    .map((p) => p.tokenTotal)
    .filter((v): v is number => typeof v === "number");
  const tokMean = mean(tokVals);
  const tokSd = stdDev(tokVals);
  if (tokMean !== undefined && tokSd !== undefined && tokSd > 0) {
    for (const p of finished) {
      if (
        typeof p.tokenTotal === "number" &&
        p.tokenTotal > tokMean + 1.5 * tokSd
      ) {
        items.push({
          problemId: p.problemId,
          label: p.shortLabel,
          kind: "high_tokens",
          detail: `${p.tokenTotal.toLocaleString()} tokens`,
          severity: 30 + (p.tokenTotal - tokMean) / tokSd,
        });
      }
    }
  }

  const msgVals = finished.map((p) => p.messageCount);
  const msgMean = mean(msgVals);
  const msgSd = stdDev(msgVals);
  if (msgMean !== undefined && msgSd !== undefined && msgSd > 0) {
    for (const p of finished) {
      if (p.messageCount > msgMean + 1.5 * msgSd) {
        items.push({
          problemId: p.problemId,
          label: p.shortLabel,
          kind: "many_messages",
          detail: `${p.messageCount} messages`,
          severity: 25 + (p.messageCount - msgMean) / msgSd,
        });
      }
    }
  }

  const scored = finished.filter((p) => p.hasScore && p.score !== undefined);
  if (scored.length > 0) {
    const byScore = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
    const lowest = byScore[0]!;
    const highest = byScore[byScore.length - 1]!;
    if (lowest.problemId !== highest.problemId || scored.length === 1) {
      items.push({
        problemId: lowest.problemId,
        label: lowest.shortLabel,
        kind: "low_score",
        detail: `Lowest score ${formatScore(lowest.score!)}`,
        severity: 55,
      });
      if (highest.problemId !== lowest.problemId) {
        items.push({
          problemId: highest.problemId,
          label: highest.shortLabel,
          kind: "high_score",
          detail: `Highest score ${formatScore(highest.score!)}`,
          severity: 20,
        });
      }
    }

    const scores = scored.map((p) => p.score!);
    const sMean = mean(scores);
    const sSd = stdDev(scores);
    if (sMean !== undefined && sSd !== undefined && sSd > 0) {
      for (const p of scored) {
        const delta = Math.abs(p.score! - sMean);
        if (delta > 1.5 * sSd) {
          items.push({
            problemId: p.problemId,
            label: p.shortLabel,
            kind: "score_outlier",
            detail: `Score ${formatScore(p.score!)} vs mean ${formatScore(sMean)}`,
            severity: 45 + delta / sSd,
          });
        }
      }
    }
  }

  // Dedupe by problemId, keep highest severity
  const best = new Map<string, AttentionItem>();
  for (const item of items) {
    const prev = best.get(item.problemId);
    if (!prev || item.severity > prev.severity) best.set(item.problemId, item);
  }
  return [...best.values()].sort((a, b) => b.severity - a.severity).slice(0, 12);
}

export function getRunSummary(
  run: ExperimentRun,
  displayIndex: number,
): RunSummary {
  const evalMap = evalByProblemId(run.evaluation);
  const problems = run.conversations.map((c, i) =>
    getProblemSummary(c, i, evalMap.get(c.problemId)),
  );

  const completedCount = problems.filter((p) => p.status === "complete").length;
  const incompleteCount = problems.filter(
    (p) => p.status === "incomplete",
  ).length;
  const runningCount = problems.filter((p) => p.status === "running").length;
  const failedCount = problems.filter((p) => p.status === "failed").length;
  const cancelledCount = problems.filter((p) => p.status === "cancelled").length;

  const statProblems = problems.filter((p) => p.status !== "incomplete");

  const withCorrectness = statProblems.filter((p) => p.isCorrect !== undefined);
  const correctCount =
    withCorrectness.length > 0
      ? withCorrectness.filter((p) => p.isCorrect).length
      : undefined;

  const scored = statProblems.filter((p) => p.hasScore);
  const scoreFromProblems = mean(scored.map((p) => p.score!));
  const storedExcludesIncomplete =
    typeof run.evaluation?.summary.incompleteProblems === "number";
  const summaryScore = storedExcludesIncomplete
    ? numericSummaryField(run.evaluation?.summary, "score")
    : undefined;
  const aggregateScore = summaryScore ?? scoreFromProblems;

  const accuracy =
    (storedExcludesIncomplete
      ? (numericSummaryField(
          run.evaluation?.summary,
          "crosswordLetterAccuracy",
        ) ??
        numericSummaryField(
          run.evaluation?.summary,
          "crosswordExactSolveRate",
        ))
      : undefined) ??
    (correctCount !== undefined && withCorrectness.length > 0
      ? correctCount / withCorrectness.length
      : undefined);

  const turnVals = statProblems
    .filter((p) => p.status !== "running" || p.turnCount > 0)
    .map((p) => p.turnCount);
  const meanTurns = mean(turnVals);
  const medianTurns = median(turnVals);

  const totalMessages = statProblems.reduce((s, p) => s + p.messageCount, 0);
  const meanMessages =
    statProblems.length > 0 ? totalMessages / statProblems.length : undefined;

  const runTok = usageTotal(run.conversationUsage);
  const problemToks = statProblems
    .map((p) => p.tokenTotal)
    .filter((v): v is number => typeof v === "number");
  const totalTok =
    runTok ??
    (problemToks.length > 0
      ? problemToks.reduce((a, b) => a + b, 0)
      : undefined);
  const meanTok = mean(problemToks);

  const durationMs = runDurationMs(run);
  const problemDurs = statProblems
    .map((p) => p.durationMs)
    .filter((v): v is number => typeof v === "number");
  const meanProblemDurationMs = mean(problemDurs);

  const metrics: Partial<Record<string, number>> = {
    trustA: run.policy.trustA,
    trustB: run.policy.trustB,
    authority: run.policy.authority,
    familiarity: run.policy.familiarity,
    problemCount: problems.length,
    completedProblems: completedCount,
    incompleteProblems: incompleteCount,
  };
  if (aggregateScore !== undefined) metrics.aggregateScore = aggregateScore;
  if (accuracy !== undefined) metrics.accuracy = accuracy;
  if (meanTurns !== undefined) metrics.meanTurns = meanTurns;
  if (medianTurns !== undefined) metrics.medianTurns = medianTurns;
  if (totalMessages > 0) metrics.totalMessages = totalMessages;
  if (meanMessages !== undefined) metrics.meanMessages = meanMessages;
  if (totalTok !== undefined) metrics.totalTokens = totalTok;
  if (meanTok !== undefined) metrics.meanTokens = meanTok;
  if (durationMs !== undefined) metrics.durationMs = durationMs;
  if (meanProblemDurationMs !== undefined) {
    metrics.meanProblemDurationMs = meanProblemDurationMs;
  }

  const metricSds: Partial<Record<string, number>> = {};
  const setSd = (id: string, values: number[]) => {
    const sd = sampleSd(values);
    if (sd !== undefined) metricSds[id] = sd;
  };
  setSd("meanTurns", turnVals);
  setSd("meanMessages", statProblems.map((p) => p.messageCount));
  setSd(
    "aggregateScore",
    scored.map((p) => p.score!),
  );
  setSd(
    "accuracy",
    withCorrectness.map((p) => (p.isCorrect ? 1 : 0)),
  );
  setSd("meanTokens", problemToks);
  setSd("meanProblemDurationMs", problemDurs);

  const latestEvals = latestEvalsForRun({
    problemIds: run.conversations.map((c) => c.problemId),
    evaluations: run.multiAgentEvaluations,
  });
  const evalAxis = collectEvalAxisMetrics(latestEvals);
  Object.assign(metrics, evalAxis.means);
  Object.assign(metricSds, evalAxis.sds);

  return {
    runId: run.id,
    displayIndex,
    title: displayRunTitle(run),
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    trustA: run.policy.trustA,
    trustB: run.policy.trustB,
    authority: run.policy.authority,
    familiarity: run.policy.familiarity,
    problemCount: problems.length,
    completedCount,
    incompleteCount,
    runningCount,
    failedCount,
    cancelledCount,
    correctCount,
    scoredCount: scored.length,
    aggregateScore,
    accuracy,
    meanTurns,
    medianTurns,
    totalMessages,
    meanMessages,
    totalTokens: totalTok,
    meanTokens: meanTok,
    durationMs,
    meanProblemDurationMs,
    metrics,
    metricSds,
    problems,
    attention: buildAttention(problems),
    // Per-problem speakingAgentId is authoritative; always allow live viz.
    speakingUnambiguous: true,
  };
}

export function getRunsForCenterPane(runs: ExperimentRun[]): RunSummary[] {
  const chronological = [...runs].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return chronological.map((run, i) => getRunSummary(run, i + 1));
}

export function getAvailableRunMetrics(runs: RunSummary[]): RunMetricId[] {
  const order: RunMetricId[] = [
    "aggregateScore",
    "accuracy",
    "meanTurns",
    "medianTurns",
    "problemCount",
    "completedProblems",
    "incompleteProblems",
    "totalMessages",
    "meanMessages",
    "totalTokens",
    "meanTokens",
    "durationMs",
    "meanProblemDurationMs",
    "trustA",
    "trustB",
    "authority",
    "familiarity",
  ];
  return order.filter((id) =>
    runs.some((r) => typeof r.metrics[id] === "number"),
  );
}

export function getAvailableAxisGroups(
  runs: RunSummary[],
  kinds?: AxisMetricKind[],
): AxisMetricGroup[] {
  const present = new Set<string>();
  for (const def of AXIS_METRIC_CATALOG) {
    if (kinds && !kinds.includes(def.kind)) continue;
    if (runs.some((r) => typeof r.metrics[def.id] === "number")) {
      present.add(def.id);
    }
  }
  return groupAvailableAxisMetrics(present);
}

export function defaultScatterAxes(
  xMetrics: string[],
  yMetrics: string[],
): {
  x: string;
  y: string;
} {
  const pick = (pool: string[], ...prefs: string[]): string => {
    for (const p of prefs) {
      if (pool.includes(p)) return p;
    }
    return pool[0] ?? "problemCount";
  };
  return {
    x: pick(xMetrics, "trustA", "authority", "familiarity", "trustB"),
    y: pick(
      yMetrics,
      "aggregateScore",
      "accuracy",
      "meanTurns",
      "meanMessages",
    ),
  };
}

export function formatScore(n: number): string {
  if (n >= 0 && n <= 1) return n.toFixed(2);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

export function formatMetricValue(id: string, value: number): string {
  const format = axisMetricDef(id)?.format;
  switch (format) {
    case "pct":
      return `${(value * 100).toFixed(0)}%`;
    case "score5":
      return `${value.toFixed(1)}/5`;
    case "hhi":
      return value.toFixed(2);
    case "score01":
      return formatScore(value);
    case "duration":
      return formatDuration(value);
    case "count":
      if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    default:
      break;
  }
  switch (id) {
    case "aggregateScore":
    case "accuracy":
    case "trustA":
    case "trustB":
    case "authority":
    case "familiarity":
      return formatScore(value);
    case "meanTurns":
    case "medianTurns":
    case "meanMessages":
      return value.toFixed(1);
    case "durationMs":
    case "meanProblemDurationMs":
      return formatDuration(value);
    case "totalTokens":
    case "meanTokens":
      return Math.round(value).toLocaleString();
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
}

export { isEvaluationMetric, isPolicyMetric };

export function attentionKindLabel(kind: AttentionKind): string {
  switch (kind) {
    case "failed":
      return "Failed";
    case "incomplete":
      return "Incomplete";
    case "high_turns":
      return "High turns";
    case "high_duration":
      return "Long duration";
    case "high_tokens":
      return "High tokens";
    case "low_score":
      return "Lowest score";
    case "high_score":
      return "Highest score";
    case "score_outlier":
      return "Score outlier";
    case "many_messages":
      return "Many messages";
  }
}

export type MatchedProblemRow = {
  problemId: string;
  shortLabel: string;
  left?: ProblemSummary;
  right?: ProblemSummary;
};

export function matchProblemsAcrossRuns(
  left: RunSummary,
  right: RunSummary,
): MatchedProblemRow[] {
  const ids = new Set<string>();
  for (const p of left.problems) ids.add(p.problemId);
  for (const p of right.problems) ids.add(p.problemId);
  const leftMap = new Map(left.problems.map((p) => [p.problemId, p]));
  const rightMap = new Map(right.problems.map((p) => [p.problemId, p]));
  return [...ids].sort().map((problemId) => {
    const l = leftMap.get(problemId);
    const r = rightMap.get(problemId);
    return {
      problemId,
      shortLabel: l?.shortLabel ?? r?.shortLabel ?? problemId,
      left: l,
      right: r,
    };
  });
}

export function runCrumbLabel(run: RunSummary): string {
  return run.title.startsWith("Run ") ? run.title : `Run ${run.displayIndex}`;
}
