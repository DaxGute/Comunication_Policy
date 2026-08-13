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
  /** How the plotted value is calculated; shown next to the axis picker. */
  description: string;
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
  description: string,
): AxisMetricDef {
  return { id, label, groupLabel, kind, format, description };
}

const EVAL_MEAN =
  " Plotted as the mean across evaluated problems in the run.";
const OVERALL_RATE =
  " The graph uses the overall (pooled) rate; A→B / B→A are shown in the evaluation panel.";

const TRUST_HELP: Record<string, string> = {
  "Proposal acceptance":
    "Share of partner proposals the other agent accepted, reinforced, or deferred to. A→B is A adopting B’s proposals." +
    OVERALL_RATE,
  "Unsupported acceptance":
    "Of proposals the partner adopted, the share accepted without evidence and without independent verification." +
    OVERALL_RATE,
  "Independent verification":
    "Of proposals the partner adopted, the share they also verified (verify action, independent verification, or evidenced support)." +
    OVERALL_RATE,
  "Correction rate":
    "Share of incorrect claims that were later revised or corrected. Overall counts any correction; A→B is A correcting B’s errors." +
    OVERALL_RATE,
  "Error propagation":
    "Share of incorrect claims the partner accepted, reinforced, deferred to, or repeated." +
    OVERALL_RATE,
  "Challenge before acceptance":
    "Of adopted proposals, the share the partner challenged, verified, or clarified at or before the first accept." +
    OVERALL_RATE,
  "Correct-claim uptake":
    "Share of correct proposals the partner adopted (accept / reinforce / defer)." +
    OVERALL_RATE,
  "Incorrect-claim rejection":
    "Share of incorrect claims the partner challenged or rejected and did not later adopt." +
    OVERALL_RATE,
  Reconsideration:
    "Of adopted claims, the share the partner later challenged, rejected, revised, or reconsidered." +
    OVERALL_RATE,
  "Confidence transfer":
    "Of adopted proposals introduced with high confidence (≥ 0.7), the share accepted without evidence. Undefined if confidence was not tagged." +
    OVERALL_RATE,
  "Accept | supported":
    "Share of proposals introduced with evidence that the partner adopted." +
    OVERALL_RATE,
  "Accept | unsupported":
    "Share of proposals introduced without evidence that the partner adopted." +
    OVERALL_RATE,
  "P(accept | correct)":
    "Share of correct proposals the partner adopted — P(accept | claim is correct)." +
    OVERALL_RATE,
  "P(accept | incorrect)":
    "Share of incorrect proposals the partner adopted — P(accept | claim is incorrect)." +
    OVERALL_RATE,
};

const AUTHORITY_HELP: Record<string, string> = {
  "Proposal survival after disagreement":
    "After a challenge, the share of cases where the original introducer’s proposal still wins. A→B is B’s proposal surviving A’s challenge." +
    OVERALL_RATE,
  "Directional deference":
    "Defer events toward the partner’s claims, divided by that partner’s claim count. A→B is A deferring to B." +
    OVERALL_RATE,
  "Challenge rate":
    "Share of the partner’s claims that were challenged or rejected." +
    OVERALL_RATE,
  "Disagreement win rate":
    "Share of decided disagreements won by the challenger. A→B / B→A are each agent’s challenger win rate." +
    OVERALL_RATE,
  "Revision asymmetry":
    "P(introducer revises | partner challenged that claim). A→B is A revising after B challenges A." +
    OVERALL_RATE,
  "Challenge success":
    "Share of challenge events tagged as producing a belief change." +
    OVERALL_RATE,
  "Authority-induced error adoption":
    "When an agent already had a correct claim, the share of later partner-incorrect claims they then adopted." +
    OVERALL_RATE,
  "Authority-induced correction":
    "When an agent already had an incorrect claim, the share of later partner-correct claims they then adopted." +
    OVERALL_RATE,
  "Persistence under counterevidence":
    "Share of claims that remain accepted or reinforced after the partner challenged or rejected them." +
    OVERALL_RATE,
};

const FAMILIARITY_HELP: Record<string, string> = {
  "Repeated information":
    "Share of non-introduce belief events tagged as repeating already-stated information.",
  "Explicit reference":
    "Explicit back-references per turn (referenceStyle = explicit, or a list of referenced claim IDs).",
  "Clarification frequency":
    "Clarify events divided by turn count.",
  "Information density":
    "Novel events (or proposals, if novelty is untagged) divided by tokens when available, otherwise turns.",
  "Misunderstanding frequency":
    "Misunderstand events divided by turn count.",
  "Misunderstanding correction":
    "Share of misunderstandings later followed by a clarification of the same claim.",
  "Redundant re-derivation":
    "Share of non-introduce events tagged as re-deriving something already established.",
  "Common-ground reuse":
    "Share of non-introduce events tagged as reusing established information.",
  "Reference resolution success":
    "Of shorthand references with a resolution tag, the share marked resolved.",
  "Contextual shorthand":
    "Shorthand references divided by turn count.",
  "Coordination overhead":
    "Share of events tagged as coordination / process talk rather than task content.",
  "Duplicate work":
    "Share of non-introduce events tagged as repetition or redundant re-derivation.",
  "Novel information":
    "Share of events tagged novel (or distinct-hypothesis claims if novelty is untagged).",
  "Information reuse efficiency":
    "Of events that reuse established info, the share followed by novel work or revision by the same agent.",
  "Compression failure":
    "Share of shorthand references that failed to resolve or later triggered a misunderstanding or clarification.",
  "Turns-to-progress":
    "Useful claims (correct or surviving proposals) divided by turn count.",
  "Tokens-to-progress":
    "Useful claims (correct or surviving proposals) divided by conversation tokens.",
};

function helpFor(map: Record<string, string>, label: string): string {
  const text = map[label];
  if (!text) {
    throw new Error(`Missing metric description for "${label}"`);
  }
  return text + EVAL_MEAN;
}

const POLICY_METRICS: AxisMetricDef[] = [
  def(
    "trustA",
    "Trust A→B",
    "Policy",
    "policy",
    "score01",
    "Configured trust of Agent A toward Agent B on [0, 1]. This is the policy slider from the run, not a value computed from the transcript. Low = verify independently; high = give substantial weight to B’s claims.",
  ),
  def(
    "trustB",
    "Trust B→A",
    "Policy",
    "policy",
    "score01",
    "Configured trust of Agent B toward Agent A on [0, 1]. This is the policy slider from the run, not a value computed from the transcript. Low = verify independently; high = give substantial weight to A’s claims.",
  ),
  def(
    "authority",
    "Authority",
    "Policy",
    "policy",
    "score01",
    "Configured decision standing on [0, 1]: 0 = A has primacy, 0.5 = equal standing, 1 = B has primacy. This is the policy slider from the run, not computed from the transcript.",
  ),
  def(
    "familiarity",
    "Familiarity",
    "Policy",
    "policy",
    "score01",
    "Configured shared familiarity F on [0, 1], applied symmetrically to both agents. This is the policy slider from the run (strangers ↔ long-term collaborators), not computed from the transcript.",
  ),
];

const TASK_METRICS: AxisMetricDef[] = [
  def(
    "aggregateScore",
    "Aggregate score",
    "Task",
    "task",
    "score01",
    "Mean of per-problem task scores on [0, 1], excluding incomplete (max-turns) problems. Uses the stored evaluation summary score when that summary already excludes incompletes.",
  ),
  def(
    "accuracy",
    "Accuracy",
    "Task",
    "task",
    "pct",
    "Fraction of scored problems marked correct (score = 1, or crossword exact solve). For crosswords, prefers letter accuracy / exact-solve rate from the evaluation summary when present. Incomplete problems are excluded.",
  ),
  def(
    "meanTurns",
    "Mean turns",
    "Task",
    "task",
    "count",
    "Mean of per-problem turn counts. A problem’s turn count is the highest turnIndex in its transcript (or message count if turnIndex is missing). Incomplete problems are excluded.",
  ),
  def(
    "medianTurns",
    "Median turns",
    "Task",
    "task",
    "count",
    "Median of per-problem turn counts (same turn definition as Mean turns). Incomplete problems are excluded.",
  ),
  def(
    "meanMessages",
    "Avg run length",
    "Task",
    "task",
    "count",
    "Mean number of messages per problem: total messages ÷ problem count, excluding incomplete problems.",
  ),
  def(
    "problemCount",
    "Problems",
    "Task",
    "task",
    "count",
    "Number of problems in the run, including complete, incomplete, failed, cancelled, and still-running.",
  ),
  def(
    "completedProblems",
    "Completed",
    "Task",
    "task",
    "count",
    "Count of problems that finished normally — not failed, cancelled, still running, or stopped at max turns.",
  ),
  def(
    "incompleteProblems",
    "Incomplete",
    "Task",
    "task",
    "count",
    "Count of problems that stopped at the max-turn limit without finishing.",
  ),
  def(
    "totalMessages",
    "Messages",
    "Task",
    "task",
    "count",
    "Sum of transcript messages across problems, excluding incomplete problems.",
  ),
  def(
    "totalTokens",
    "Total tokens",
    "Task",
    "task",
    "count",
    "Total model tokens for the run: run-level usage when present, otherwise the sum of per-problem token totals.",
  ),
  def(
    "meanTokens",
    "Mean tokens",
    "Task",
    "task",
    "count",
    "Mean tokens per problem among problems that recorded token usage. Incomplete problems are excluded.",
  ),
  def(
    "durationMs",
    "Duration",
    "Task",
    "task",
    "duration",
    "Wall-clock length of the run: finishedAt − createdAt, or elapsed time so far if the run is still queued or running.",
  ),
  def(
    "meanProblemDurationMs",
    "Mean problem duration",
    "Task",
    "task",
    "duration",
    "Mean per-problem duration. Each problem uses the sum of message durations when available, otherwise the span between the first and last message timestamps.",
  ),
];

const MARBLE_METRICS: AxisMetricDef[] = [
  def(
    evalMetricId("marble", "Communication"),
    "Communication",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
    "MARBLE Graph evaluator communication score (C_score): an LLM judge on a 1–5 scale (0 if there was no communication)." +
      EVAL_MEAN,
  ),
  def(
    evalMetricId("marble", "Planning"),
    "Planning",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
    "MARBLE Graph evaluator planning score (P_score): an LLM judge on a 1–5 scale for role clarity, task alignment, and autonomy." +
      EVAL_MEAN,
  ),
  def(
    evalMetricId("marble", "Coordination"),
    "Coordination",
    "Evaluation · MARBLE",
    "evaluation",
    "score5",
    "MARBLE coordination score (CS): the average of communication and planning scores." +
      EVAL_MEAN,
  ),
];

const TRUST_METRICS: AxisMetricDef[] = TRUST_DIRECTIONAL.map((spec) =>
  def(
    evalMetricId("trust", spec.label),
    spec.label,
    "Evaluation · Trust",
    "evaluation",
    "pct",
    helpFor(TRUST_HELP, spec.label),
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
      helpFor(AUTHORITY_HELP, spec.label),
    ),
  ),
  def(
    evalMetricId("authority", "Incorrect high-influence persistence"),
    "Incorrect high-influence persistence",
    "Evaluation · Authority",
    "evaluation",
    "pct",
    "Of incorrect claims from the behaviorally dominant agent that were challenged, the share that remained accepted or reinforced. Dominance is scored from disagreement wins, incoming deference, and surviving claims." +
      EVAL_MEAN,
  ),
  def(
    evalMetricId("authority", "Evidence-over-authority"),
    "Evidence-over-authority",
    "Evaluation · Authority",
    "evaluation",
    "pct",
    "Of disagreements where evidence favors one side and there is a winner, the share where the winner matches the evidence rather than status." +
      EVAL_MEAN,
  ),
  def(
    evalMetricId("authority", "Decision concentration"),
    "Decision concentration",
    "Evaluation · Authority",
    "evaluation",
    "hhi",
    "Herfindahl index of surviving-claim ownership: s_A² + s_B². 0.5 is an even split; 1 means one agent owns every surviving claim." +
      EVAL_MEAN,
  ),
  def(
    evalMetricId("authority", "A token share"),
    "A token share",
    "Evaluation · Authority",
    "evaluation",
    "pct",
    "Agent A’s share of conversation tokens: tokens_A / (tokens_A + tokens_B). Descriptive volume, not the authority policy slider." +
      EVAL_MEAN,
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
      helpFor(FAMILIARITY_HELP, spec.label),
    ),
  ),
  def(
    evalMetricId("familiarity", "Repair turns"),
    "Repair turns",
    "Evaluation · Familiarity",
    "evaluation",
    "count",
    "Mean turns from a misunderstanding event to the clarifying repair of the same claim, averaged over resolved repair episodes." +
      EVAL_MEAN,
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

export function axisMetricDescription(id: string): string | undefined {
  return CATALOG_BY_ID.get(id)?.description;
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
