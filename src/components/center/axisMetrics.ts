import {
  AUTHORITY_DIRECTIONAL,
  FAMILIARITY_FRACTIONS,
  TRUST_DIRECTIONAL,
} from "../evaluation/aggregateMaeMetrics";
import type {
  BeliefAuthorityMetrics,
  BeliefDirectionalFraction,
  BeliefFamiliarityMetrics,
  BeliefFraction,
  BeliefTrustMetrics,
  MultiAgentEvaluation,
} from "../../evaluation/types";

export type AxisMetricKind = "policy" | "task" | "evaluation";

export type AxisValueFormat =
  | "score01"
  | "pct"
  | "count"
  | "duration"
  | "score5"
  | "hhi";

export type AxisMetricDef = {
  id: string;
  label: string;
  groupLabel: string;
  kind: AxisMetricKind;
  format: AxisValueFormat;
};

export type AxisMetricGroup = {
  id: string;
  label: string;
  kind: AxisMetricKind;
  metrics: AxisMetricDef[];
};

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function evalMetricId(
  group: "marble" | "trust" | "authority" | "familiarity",
  label: string,
): string {
  return `eval_${group}_${slug(label)}`;
}

function def(
  id: string,
  label: string,
  groupLabel: string,
  kind: AxisMetricKind,
  format: AxisValueFormat,
): AxisMetricDef {
  return { id, label, groupLabel, kind, format };
}

const POLICY_METRICS: AxisMetricDef[] = [
  def("trustA", "Trust A→B", "Policy", "policy", "score01"),
  def("trustB", "Trust B→A", "Policy", "policy", "score01"),
  def("authority", "Authority", "Policy", "policy", "score01"),
  def("familiarity", "Familiarity", "Policy", "policy", "score01"),
];

const TASK_METRICS: AxisMetricDef[] = [
  def("aggregateScore", "Aggregate score", "Task", "task", "score01"),
  def("accuracy", "Accuracy", "Task", "task", "pct"),
  def("meanTurns", "Mean turns", "Task", "task", "count"),
  def("medianTurns", "Median turns", "Task", "task", "count"),
  def("meanMessages", "Avg run length", "Task", "task", "count"),
  def("problemCount", "Problems", "Task", "task", "count"),
  def("completedProblems", "Completed", "Task", "task", "count"),
  def("incompleteProblems", "Incomplete", "Task", "task", "count"),
  def("totalMessages", "Messages", "Task", "task", "count"),
  def("totalTokens", "Total tokens", "Task", "task", "count"),
  def("meanTokens", "Mean tokens", "Task", "task", "count"),
  def("durationMs", "Duration", "Task", "task", "duration"),
  def("meanProblemDurationMs", "Mean problem duration", "Task", "task", "duration"),
];

const MARBLE_METRICS: AxisMetricDef[] = [
  def(
    evalMetricId("marble", "Communication"),
    "Communication",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
  ),
  def(
    evalMetricId("marble", "Planning"),
    "Planning",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
  ),
  def(
    evalMetricId("marble", "Coordination"),
    "Coordination",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
  ),
];

const TRUST_METRICS: AxisMetricDef[] = TRUST_DIRECTIONAL.map((spec) =>
  def(
    evalMetricId("trust", spec.label),
    spec.label,
    "Evaluation · Trust",
    "evaluation",
    "pct",
  ),
);

const AUTHORITY_METRICS: AxisMetricDef[] = [
  ...AUTHORITY_DIRECTIONAL.map((spec) =>
    def(
      evalMetricId("authority", spec.label),
      spec.label,
      "Evaluation · Authority",
      "evaluation",
      "pct",
    ),
  ),
  def(
    evalMetricId("authority", "Incorrect high-influence persistence"),
    "Incorrect high-influence persistence",
    "Evaluation · Authority",
    "evaluation",
    "pct",
  ),
  def(
    evalMetricId("authority", "Evidence-over-authority"),
    "Evidence-over-authority",
    "Evaluation · Authority",
    "evaluation",
    "pct",
  ),
  def(
    evalMetricId("authority", "Decision concentration"),
    "Decision concentration",
    "Evaluation · Authority",
    "evaluation",
    "hhi",
  ),
  def(
    evalMetricId("authority", "A token share"),
    "A token share",
    "Evaluation · Authority",
    "evaluation",
    "pct",
  ),
];

const FAMILIARITY_METRICS: AxisMetricDef[] = [
  ...FAMILIARITY_FRACTIONS.map((spec) =>
    def(
      evalMetricId("familiarity", spec.label),
      spec.label,
      "Evaluation · Familiarity",
      "evaluation",
      "pct",
    ),
  ),
  def(
    evalMetricId("familiarity", "Repair turns"),
    "Repair turns",
    "Evaluation · Familiarity",
    "evaluation",
    "count",
  ),
];

export const AXIS_METRIC_CATALOG: AxisMetricDef[] = [
  ...POLICY_METRICS,
  ...TASK_METRICS,
  ...MARBLE_METRICS,
  ...TRUST_METRICS,
  ...AUTHORITY_METRICS,
  ...FAMILIARITY_METRICS,
];

const CATALOG_BY_ID = new Map(AXIS_METRIC_CATALOG.map((m) => [m.id, m]));

export function axisMetricDef(id: string): AxisMetricDef | undefined {
  return CATALOG_BY_ID.get(id);
}

export function axisMetricLabel(id: string): string {
  return CATALOG_BY_ID.get(id)?.label ?? id;
}

export function isEvaluationMetric(id: string): boolean {
  return CATALOG_BY_ID.get(id)?.kind === "evaluation";
}

export function isPolicyMetric(id: string): boolean {
  return CATALOG_BY_ID.get(id)?.kind === "policy";
}

function meanSd(values: Array<number | null | undefined>): {
  mean: number | null;
  sd: number | null;
} {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (nums.length === 0) return { mean: null, sd: null };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (nums.length < 2) return { mean, sd: null };
  const variance =
    nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nums.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

function fracRate(value: BeliefFraction | undefined): number | undefined {
  if (!value || value.rate === null || value.denominator <= 0) return undefined;
  return value.rate;
}

function dirRate(
  value: BeliefDirectionalFraction | undefined,
): number | undefined {
  return fracRate(value?.overall);
}

export function collectEvalAxisMetrics(
  evals: MultiAgentEvaluation[],
): { means: Record<string, number>; sds: Record<string, number> } {
  const means: Record<string, number> = {};
  const sds: Record<string, number> = {};
  const set = (id: string, values: Array<number | null | undefined>) => {
    const { mean, sd } = meanSd(values);
    if (mean !== null) means[id] = mean;
    if (sd !== null) sds[id] = sd;
  };

  set(
    evalMetricId("marble", "Communication"),
    evals.map((e) => e.marble?.normalized.communicationScore),
  );
  set(
    evalMetricId("marble", "Planning"),
    evals.map((e) => e.marble?.normalized.planningScore),
  );
  set(
    evalMetricId("marble", "Coordination"),
    evals.map((e) => e.marble?.normalized.coordinationScore),
  );

  const belief = evals.map((e) => e.beliefDynamics?.normalized.metrics);

  const pickTrust = (pick: (t: BeliefTrustMetrics) => BeliefDirectionalFraction) =>
    belief.map((m) => {
      const t = m?.trust;
      return t ? dirRate(pick(t)) : undefined;
    });
  for (const spec of TRUST_DIRECTIONAL) {
    set(evalMetricId("trust", spec.label), pickTrust(spec.pick));
  }

  const pickAuth = (
    pick: (a: BeliefAuthorityMetrics) => BeliefDirectionalFraction,
  ) =>
    belief.map((m) => {
      const a = m?.authority;
      return a ? dirRate(pick(a)) : undefined;
    });
  for (const spec of AUTHORITY_DIRECTIONAL) {
    set(evalMetricId("authority", spec.label), pickAuth(spec.pick));
  }
  set(
    evalMetricId("authority", "Incorrect high-influence persistence"),
    belief.map((m) => fracRate(m?.authority?.incorrectHighInfluencePersistence)),
  );
  set(
    evalMetricId("authority", "Evidence-over-authority"),
    belief.map((m) => fracRate(m?.authority?.evidenceOverAuthority)),
  );
  set(
    evalMetricId("authority", "Decision concentration"),
    belief.map((m) => m?.authority?.decisionConcentration.herfindahl),
  );
  set(
    evalMetricId("authority", "A token share"),
    belief.map((m) => m?.authority?.speakingDominance.tokenShareA),
  );

  const pickFam = (pick: (f: BeliefFamiliarityMetrics) => BeliefFraction) =>
    belief.map((m) => {
      const f = m?.familiarity;
      return f ? fracRate(pick(f)) : undefined;
    });
  for (const spec of FAMILIARITY_FRACTIONS) {
    set(evalMetricId("familiarity", spec.label), pickFam(spec.pick));
  }
  set(
    evalMetricId("familiarity", "Repair turns"),
    belief.map((m) => m?.familiarity?.repairCost.meanTurns),
  );

  return { means, sds };
}

export function groupAvailableAxisMetrics(
  presentIds: Iterable<string>,
): AxisMetricGroup[] {
  const present = new Set(presentIds);
  const byGroup = new Map<string, AxisMetricGroup>();
  for (const metric of AXIS_METRIC_CATALOG) {
    if (!present.has(metric.id)) continue;
    const existing = byGroup.get(metric.groupLabel);
    if (existing) {
      existing.metrics.push(metric);
    } else {
      byGroup.set(metric.groupLabel, {
        id: metric.groupLabel,
        label: metric.groupLabel,
        kind: metric.kind,
        metrics: [metric],
      });
    }
  }
  return [...byGroup.values()];
}

export function latestEvalsForRun(options: {
  problemIds: string[];
  evaluations: MultiAgentEvaluation[] | undefined;
}): MultiAgentEvaluation[] {
  const allowed = new Set(options.problemIds);
  const byProblem = new Map<string, MultiAgentEvaluation>();
  for (const evaluation of options.evaluations ?? []) {
    if (!allowed.has(evaluation.problemId)) continue;
    const prev = byProblem.get(evaluation.problemId);
    if (!prev || evaluation.createdAt > prev.createdAt) {
      byProblem.set(evaluation.problemId, evaluation);
    }
  }
  return [...byProblem.values()];
}
