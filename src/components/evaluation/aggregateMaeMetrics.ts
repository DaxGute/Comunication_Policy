/**
 * Builds mean±sd MAE tables for a run (inspector results) from MARBLE + belief metrics.
 *
 * Shared metric labels/accessors live in evaluation/belief/metricCatalog.ts.
 */
import {
  AUTHORITY_DIRECTIONAL,
  CROSS_POLICY_FRACTIONS,
  FAMILIARITY_FRACTIONS,
  SHOW_CROSS_POLICY_AND_TRUTH,
  TRUST_DIRECTIONAL,
  TRUTH_SPLITS,
  type DirectionalMetricSpec,
  type FractionMetricSpec,
} from "../../evaluation/belief/metricCatalog";
import type {
  BeliefDirectionalFraction,
  BeliefDynamicsMetrics,
  BeliefFraction,
  MarbleEvaluation,
} from "../../evaluation/types";
import type { MoralDeterministicMetrics } from "../../evaluation/moral/types";
import type {
  DirectionalOpportunity,
  InteractionEvaluation,
  OpportunityRate,
} from "../../evaluation/interaction/types";

export type MaeMetricRow = {
  label: string;
  sub?: string;
  mean: string;
  sd: string;
};

export type MaeMetricSection = {
  title: string;
  rows: MaeMetricRow[];
};

type MeanSd = { mean: number | null; sd: number | null };

function numericValues(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v),
  );
}

function meanSd(values: Array<number | null | undefined>): MeanSd {
  const nums = numericValues(values);
  if (nums.length === 0) return { mean: null, sd: null };
  const mean = nums.reduce((sum, v) => sum + v, 0) / nums.length;
  if (nums.length < 2) return { mean, sd: null };
  const variance =
    nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nums.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function formatNum(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatScore5(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}/5`;
}

function formatPctMeanSd(stats: MeanSd): string {
  const mean = formatPct(stats.mean);
  if (mean === "—") return "—";
  const sd = formatPct(stats.sd);
  return sd === "—" ? mean : `${mean} ± ${sd}`;
}

function formatNumMeanSd(stats: MeanSd, digits = 1): string {
  const mean = formatNum(stats.mean, digits);
  if (mean === "—") return "—";
  const sd = formatNum(stats.sd, digits);
  return sd === "—" ? mean : `${mean} ± ${sd}`;
}

function definedOpp(value: OpportunityRate | undefined): number | null {
  if (!value || value.rate === null || value.opportunities === 0) return null;
  return value.rate;
}

function definedRate(value: BeliefFraction | undefined): number | null {
  if (!value || value.rate === null || value.denominator === 0) return null;
  return value.rate;
}

function oppStats(
  items: InteractionEvaluation[],
  pick: (metrics: InteractionEvaluation) => OpportunityRate | undefined,
): MeanSd {
  return meanSd(items.map((m) => definedOpp(pick(m))));
}

function dirOppStats(
  items: InteractionEvaluation[],
  pick: (metrics: InteractionEvaluation) => DirectionalOpportunity | undefined,
): MeanSd {
  return meanSd(items.map((m) => definedOpp(pick(m)?.overall)));
}

function dirOppSub(
  items: InteractionEvaluation[],
  pick: (metrics: InteractionEvaluation) => DirectionalOpportunity | undefined,
): string | undefined {
  const aToB = meanSd(items.map((m) => definedOpp(pick(m)?.aToB)));
  const bToA = meanSd(items.map((m) => definedOpp(pick(m)?.bToA)));
  if (aToB.mean === null && bToA.mean === null) return undefined;
  return `A→B ${formatPctMeanSd(aToB)}  B→A ${formatPctMeanSd(bToA)}`;
}

function pushOpp(
  rows: MaeMetricRow[],
  items: InteractionEvaluation[],
  label: string,
  pick: (metrics: InteractionEvaluation) => OpportunityRate | undefined,
): void {
  pushPct(rows, label, oppStats(items, pick));
}

function pushDirOpp(
  rows: MaeMetricRow[],
  items: InteractionEvaluation[],
  label: string,
  pick: (metrics: InteractionEvaluation) => DirectionalOpportunity | undefined,
): void {
  const overall = dirOppStats(items, pick);
  const sub = dirOppSub(items, pick);
  if (overall.mean === null && !sub) return;
  rows.push({
    label,
    sub,
    mean: formatPct(overall.mean),
    sd: formatPct(overall.sd),
  });
}

function fracStats<T>(
  items: T[],
  pick: (metrics: T) => BeliefFraction | undefined,
): MeanSd {
  return meanSd(items.map((m) => definedRate(pick(m))));
}

function numStats<T>(
  items: T[],
  pick: (metrics: T) => number | null | undefined,
): MeanSd {
  return meanSd(items.map(pick));
}

function dirSub(
  items: BeliefDynamicsMetrics[],
  pick: (metrics: BeliefDynamicsMetrics) => BeliefDirectionalFraction | undefined,
  hint?: string,
): string | undefined {
  const aToB = fracStats(items, (m) => pick(m)?.aToB);
  const bToA = fracStats(items, (m) => pick(m)?.bToA);
  const parts: string[] = [];
  if (aToB.mean !== null || bToA.mean !== null) {
    parts.push(`A→B ${formatPctMeanSd(aToB)}  B→A ${formatPctMeanSd(bToA)}`);
  }
  if (hint) parts.push(hint);
  return parts.length > 0 ? parts.join("  ") : undefined;
}

function pushPct(
  rows: MaeMetricRow[],
  label: string,
  stats: MeanSd,
  sub?: string,
): void {
  if (stats.mean === null) return;
  rows.push({
    label,
    sub,
    mean: formatPct(stats.mean),
    sd: formatPct(stats.sd),
  });
}

function pushNum(
  rows: MaeMetricRow[],
  label: string,
  stats: MeanSd,
  digits = 1,
  sub?: string,
): void {
  if (stats.mean === null) return;
  rows.push({
    label,
    sub,
    mean: formatNum(stats.mean, digits),
    sd: formatNum(stats.sd, digits),
  });
}

function pushDir<T>(
  rows: MaeMetricRow[],
  items: BeliefDynamicsMetrics[],
  spec: DirectionalMetricSpec<T>,
  group: (metrics: BeliefDynamicsMetrics) => T | undefined,
): void {
  const overall = fracStats(items, (m) => {
    const g = group(m);
    return g ? spec.pick(g).overall : undefined;
  });
  const sub = dirSub(
    items,
    (m) => {
      const g = group(m);
      return g ? spec.pick(g) : undefined;
    },
    spec.hint,
  );
  if (overall.mean === null && !sub) return;
  rows.push({
    label: spec.label,
    sub,
    mean: formatPct(overall.mean),
    sd: formatPct(overall.sd),
  });
}

function pushFrac<T>(
  rows: MaeMetricRow[],
  items: BeliefDynamicsMetrics[],
  spec: FractionMetricSpec<T>,
  group: (metrics: BeliefDynamicsMetrics) => T | undefined,
): void {
  pushPct(
    rows,
    spec.label,
    fracStats(items, (m) => {
      const g = group(m);
      return g ? spec.pick(g) : undefined;
    }),
  );
}

function maybeSection(
  title: string,
  rows: MaeMetricRow[],
): MaeMetricSection | null {
  return rows.length > 0 ? { title, rows } : null;
}

function shareSub(
  a: MeanSd,
  b: MeanSd,
): string | undefined {
  if (a.mean === null && b.mean === null) return undefined;
  return `A ${formatPctMeanSd(a)}  B ${formatPctMeanSd(b)}`;
}

const LEGACY_SUMMARY: Array<{
  label: string;
  pick: (metrics: BeliefDynamicsMetrics) => number | null | undefined;
  kind: "pct" | "num";
}> = [
  { label: "Claims", pick: (m) => m.claimsIntroduced, kind: "num" },
  { label: "Incorrect", pick: (m) => m.incorrectClaims, kind: "num" },
  { label: "Correction", pick: (m) => m.errorCorrectionRate, kind: "pct" },
  { label: "Reinforcement", pick: (m) => m.errorReinforcementRate, kind: "pct" },
  { label: "Challenge", pick: (m) => m.challengeRate, kind: "pct" },
  {
    label: "Successful challenge",
    pick: (m) => m.successfulChallengeRate,
    kind: "pct",
  },
  { label: "Critique", pick: (m) => m.independentCritiqueRate, kind: "pct" },
  { label: "Deference", pick: (m) => m.deferenceRate, kind: "pct" },
];

export function buildAggregatedMaeSections(options: {
  marbleEvals: MarbleEvaluation[];
  interactionEvals?: InteractionEvaluation[];
  beliefEvals: BeliefDynamicsMetrics[];
  moralEvals?: MoralDeterministicMetrics[];
}): MaeMetricSection[] {
  const {
    marbleEvals,
    interactionEvals = [],
    beliefEvals,
    moralEvals = [],
  } = options;
  const sections: MaeMetricSection[] = [];
  const hasStructured = beliefEvals.some(
    (m) => m.trust && m.authority && m.familiarity && m.crossPolicy,
  );

  if (marbleEvals.length > 0) {
    const communication = meanSd(marbleEvals.map((m) => m.communicationScore));
    const planning = meanSd(marbleEvals.map((m) => m.planningScore));
    const coordination = meanSd(marbleEvals.map((m) => m.coordinationScore));
    sections.push({
      title: "MARBLE",
      rows: [
        {
          label: "Communication",
          mean: formatScore5(communication.mean),
          sd: formatNum(communication.sd, 1),
        },
        {
          label: "Planning",
          mean: formatScore5(planning.mean),
          sd: formatNum(planning.sd, 1),
        },
        {
          label: "Coordination",
          mean: formatScore5(coordination.mean),
          sd: formatNum(coordination.sd, 1),
        },
      ],
    });
  }

  if (interactionEvals.length > 0) {
    const contributionRows: MaeMetricRow[] = [];
    pushNum(
      contributionRows,
      "Introduced A",
      numStats(interactionEvals, (m) => m.interaction.contributions.introducedByAgent.agent_a),
    );
    pushNum(
      contributionRows,
      "Introduced B",
      numStats(interactionEvals, (m) => m.interaction.contributions.introducedByAgent.agent_b),
    );
    const contributions = maybeSection("Contributions", contributionRows);
    if (contributions) sections.push(contributions);

    const adoptionRows: MaeMetricRow[] = [];
    pushDirOpp(adoptionRows, interactionEvals, "Adoption", (m) => m.interaction.adoption.adoption);
    pushDirOpp(
      adoptionRows,
      interactionEvals,
      "Unsupported adoption",
      (m) => m.interaction.adoption.unsupportedAdoption,
    );
    pushDirOpp(
      adoptionRows,
      interactionEvals,
      "Independent verification",
      (m) => m.interaction.verification.independentVerification,
    );
    const adoption = maybeSection("Adoption & verification", adoptionRows);
    if (adoption) sections.push(adoption);

    const challengeRows: MaeMetricRow[] = [];
    pushOpp(challengeRows, interactionEvals, "Challenge frequency", (m) => m.interaction.challenges.frequency);
    pushOpp(challengeRows, interactionEvals, "Successful challenges", (m) => m.interaction.challenges.successful);
    pushOpp(challengeRows, interactionEvals, "Correction", (m) => m.interaction.corrections.corrected);
    const challenge = maybeSection("Challenge & correction", challengeRows);
    if (challenge) sections.push(challenge);

    const influenceRows: MaeMetricRow[] = [];
    pushDirOpp(
      influenceRows,
      interactionEvals,
      "Proposal survival",
      (m) => m.interaction.influence.proposalSurvival,
    );
    pushDirOpp(
      influenceRows,
      interactionEvals,
      "Disagreement survival",
      (m) => m.interaction.influence.disagreementSurvival,
    );
    pushNum(
      influenceRows,
      "Decision concentration",
      numStats(interactionEvals, (m) => m.interaction.influence.finalAncestry.herfindahl),
      2,
    );
    const influence = maybeSection("Influence / deference", influenceRows);
    if (influence) sections.push(influence);

    const disagreementRows: MaeMetricRow[] = [];
    pushOpp(disagreementRows, interactionEvals, "Disagreements", (m) => m.interaction.disagreement.disagreements);
    pushOpp(disagreementRows, interactionEvals, "Resolved", (m) => m.interaction.disagreement.resolved);
    pushOpp(disagreementRows, interactionEvals, "Synthesis", (m) => m.interaction.disagreement.synthesis);
    const disagreement = maybeSection("Disagreement & resolution", disagreementRows);
    if (disagreement) sections.push(disagreement);

    const developmentRows: MaeMetricRow[] = [];
    pushNum(
      developmentRows,
      "Graph depth (max)",
      numStats(interactionEvals, (m) => m.interaction.reasoningDevelopment.graphDepth.maximum),
    );
    pushOpp(developmentRows, interactionEvals, "Mutation rate", (m) => m.interaction.reasoningDevelopment.mutationRate);
    const development = maybeSection("Reasoning development", developmentRows);
    if (development) sections.push(development);

    const efficiencyRows: MaeMetricRow[] = [];
    pushOpp(efficiencyRows, interactionEvals, "Repetition", (m) => m.interaction.efficiency.repetition);
    pushNum(
      efficiencyRows,
      "Zero-mutation turns",
      numStats(interactionEvals, (m) => m.interaction.efficiency.zeroMutationTurns),
    );
    pushNum(
      efficiencyRows,
      "Productive events / turn",
      numStats(interactionEvals, (m) => m.interaction.efficiency.productiveEventsPerTurn),
    );
    const efficiency = maybeSection("Communication efficiency", efficiencyRows);
    if (efficiency) sections.push(efficiency);

    return sections;
  }

  if (!hasStructured) {
    const rows: MaeMetricRow[] = [];
    for (const spec of LEGACY_SUMMARY) {
      const stats = numStats(beliefEvals, spec.pick);
      if (spec.kind === "pct") pushPct(rows, spec.label, stats);
      else pushNum(rows, spec.label, stats, 1);
    }
    const legacy = maybeSection("Belief Dynamics", rows);
    if (legacy) sections.push(legacy);
  } else {

  const trustRows: MaeMetricRow[] = [];
  for (const spec of TRUST_DIRECTIONAL) {
    pushDir(trustRows, beliefEvals, spec, (m) => m.trust);
  }
  const trust = maybeSection("Trust Behavior", trustRows);
  if (trust) sections.push(trust);

  const authorityRows: MaeMetricRow[] = [];
  for (const spec of AUTHORITY_DIRECTIONAL) {
    pushDir(authorityRows, beliefEvals, spec, (m) => m.authority);
  }
  pushPct(
    authorityRows,
    "Incorrect high-influence persistence",
    fracStats(
      beliefEvals,
      (m) => m.authority?.incorrectHighInfluencePersistence,
    ),
  );
  pushPct(
    authorityRows,
    "Evidence-over-authority",
    fracStats(beliefEvals, (m) => m.authority?.evidenceOverAuthority),
  );
  pushNum(
    authorityRows,
    "Decision concentration",
    numStats(beliefEvals, (m) => m.authority?.decisionConcentration.herfindahl),
    2,
    shareSub(
      fracStats(
        beliefEvals,
        (m) => m.authority?.decisionConcentration.agent_aShare,
      ),
      fracStats(
        beliefEvals,
        (m) => m.authority?.decisionConcentration.agent_bShare,
      ),
    ),
  );
  pushNum(
    authorityRows,
    "Initiative concentration",
    numStats(
      beliefEvals,
      (m) => m.authority?.initiativeConcentration.herfindahl,
    ),
    2,
  );
  pushPct(
    authorityRows,
    "Final-answer ownership",
    fracStats(
      beliefEvals,
      (m) => m.authority?.finalAnswerOwnership.agent_aShare,
    ),
    shareSub(
      fracStats(
        beliefEvals,
        (m) => m.authority?.finalAnswerOwnership.agent_aShare,
      ),
      fracStats(
        beliefEvals,
        (m) => m.authority?.finalAnswerOwnership.agent_bShare,
      ),
    ),
  );
  const speakATokens = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_a.tokens,
  );
  const speakAClaims = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_a.claimsIntroduced,
  );
  const speakAProposals = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_a.proposals,
  );
  if (
    speakATokens.mean !== null ||
    speakAClaims.mean !== null ||
    speakAProposals.mean !== null
  ) {
    authorityRows.push({
      label: "Speaking A",
      sub: `claims ${formatNumMeanSd(speakAClaims, 1)}  proposals ${formatNumMeanSd(speakAProposals, 1)}`,
      mean: formatNum(speakATokens.mean, 0),
      sd: formatNum(speakATokens.sd, 0),
    });
  }
  const speakBTokens = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_b.tokens,
  );
  const speakBClaims = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_b.claimsIntroduced,
  );
  const speakBProposals = numStats(
    beliefEvals,
    (m) => m.authority?.speakingDominance.agent_b.proposals,
  );
  if (
    speakBTokens.mean !== null ||
    speakBClaims.mean !== null ||
    speakBProposals.mean !== null
  ) {
    authorityRows.push({
      label: "Speaking B",
      sub: `claims ${formatNumMeanSd(speakBClaims, 1)}  proposals ${formatNumMeanSd(speakBProposals, 1)}`,
      mean: formatNum(speakBTokens.mean, 0),
      sd: formatNum(speakBTokens.sd, 0),
    });
  }
  pushPct(
    authorityRows,
    "A token share",
    numStats(beliefEvals, (m) => m.authority?.speakingDominance.tokenShareA),
    "Descriptive only — not used as authority",
  );
  const authority = maybeSection("Authority Behavior", authorityRows);
  if (authority) sections.push(authority);

  const familiarityRows: MaeMetricRow[] = [];
  for (const spec of FAMILIARITY_FRACTIONS) {
    pushFrac(familiarityRows, beliefEvals, spec, (m) => m.familiarity);
  }
  const repairTurns = numStats(
    beliefEvals,
    (m) => m.familiarity?.repairCost.meanTurns,
  );
  const repairTokens = numStats(
    beliefEvals,
    (m) => m.familiarity?.repairCost.meanTokens,
  );
  const repairResolved = meanSd(
    beliefEvals.map((m) => {
      const cost = m.familiarity?.repairCost;
      if (!cost || cost.episodes === 0) return null;
      return cost.resolved / cost.episodes;
    }),
  );
  if (repairTurns.mean !== null || repairTokens.mean !== null) {
    familiarityRows.push({
      label: "Repair cost",
      sub: [
        repairTokens.mean !== null
          ? `${formatNumMeanSd(repairTokens, 0)} tok`
          : null,
        repairResolved.mean !== null
          ? `${formatPctMeanSd(repairResolved)} resolved`
          : null,
      ]
        .filter(Boolean)
        .join("  "),
      mean:
        repairTurns.mean !== null
          ? `${formatNum(repairTurns.mean, 1)} t`
          : "—",
      sd: formatNum(repairTurns.sd, 1),
    });
  }
  const familiarity = maybeSection("Familiarity Behavior", familiarityRows);
  if (familiarity) sections.push(familiarity);

  if (SHOW_CROSS_POLICY_AND_TRUTH) {
    const crossRows: MaeMetricRow[] = [];
    for (const spec of CROSS_POLICY_FRACTIONS) {
      pushFrac(crossRows, beliefEvals, spec, (m) => m.crossPolicy);
    }
    pushPct(
      crossRows,
      "Novel contribution balance",
      fracStats(
        beliefEvals,
        (m) => m.crossPolicy?.novelContributionBalance.agent_aShare,
      ),
      shareSub(
        fracStats(
          beliefEvals,
          (m) => m.crossPolicy?.novelContributionBalance.agent_aShare,
        ),
        fracStats(
          beliefEvals,
          (m) => m.crossPolicy?.novelContributionBalance.agent_bShare,
        ),
      ),
    );
    pushNum(
      crossRows,
      "Turns to convergence",
      numStats(beliefEvals, (m) => m.crossPolicy?.turnsToConvergence),
      1,
    );
    const correctConv = numStats(beliefEvals, (m) => m.correctConvergenceCount);
    const erroneousConv = numStats(
      beliefEvals,
      (m) => m.erroneousConvergenceCount,
    );
    if (correctConv.mean !== null || erroneousConv.mean !== null) {
      crossRows.push({
        label: "Correct / erroneous convergence",
        mean: `${formatNum(correctConv.mean, 1)} / ${formatNum(erroneousConv.mean, 1)}`,
        sd: `${formatNum(correctConv.sd, 1)} / ${formatNum(erroneousConv.sd, 1)}`,
      });
    }
    const cross = maybeSection("Cross-Policy Dynamics", crossRows);
    if (cross) sections.push(cross);

    const truthRows: MaeMetricRow[] = [];
    const withTruth = beliefEvals.filter(
      (m) => m.hasCheckableClaims && m.truthConditioned,
    );
    for (const spec of TRUTH_SPLITS) {
      pushPct(
        truthRows,
        `${spec.label} (correct)`,
        fracStats(
          withTruth,
          (m) => m.truthConditioned && spec.pick(m.truthConditioned).correct,
        ),
      );
      pushPct(
        truthRows,
        `${spec.label} (incorrect)`,
        fracStats(
          withTruth,
          (m) => m.truthConditioned && spec.pick(m.truthConditioned).incorrect,
        ),
      );
    }
    pushPct(
      truthRows,
      "Abandonment of correct claims",
      fracStats(withTruth, (m) => m.truthConditioned?.abandonmentOfCorrect),
    );
    pushPct(
      truthRows,
      "Correction of incorrect claims",
      fracStats(withTruth, (m) => m.truthConditioned?.correctionOfIncorrect),
    );
    const truth = maybeSection("Truth-conditioned splits", truthRows);
    if (truth) sections.push(truth);
  }
  }

  if (moralEvals.length > 0) {
    const moralRows: MaeMetricRow[] = [];
    pushPct(
      moralRows,
      "Adoption overall",
      fracStats(moralEvals, (m) => m.adoption.adoption.overall),
    );
    pushPct(
      moralRows,
      "A adopts B",
      fracStats(moralEvals, (m) => m.adoption.adoption.aToB),
    );
    pushPct(
      moralRows,
      "B adopts A",
      fracStats(moralEvals, (m) => m.adoption.adoption.bToA),
    );
    pushPct(
      moralRows,
      "Disagreement resolution",
      fracStats(moralEvals, (m) => m.disagreement.resolutionRate),
    );
    pushPct(
      moralRows,
      "Mutual synthesis",
      fracStats(moralEvals, (m) => m.disagreement.mutualSynthesisRate),
    );
    pushNum(
      moralRows,
      "Challenge count",
      numStats(moralEvals, (m) => m.disagreement.challengeCount),
      1,
    );
    pushPct(
      moralRows,
      "Unsupported acceptance",
      fracStats(moralEvals, (m) => m.trust.unsupportedAcceptance.overall),
    );
    pushPct(
      moralRows,
      "Independent justification",
      fracStats(moralEvals, (m) => m.trust.independentJustification.overall),
    );
    pushPct(
      moralRows,
      "Graph mutation rate",
      fracStats(moralEvals, (m) => m.development.repeatingVsModifying.mutationRate),
    );
    pushNum(
      moralRows,
      "Zero-mutation turns",
      numStats(moralEvals, (m) => m.efficiency.zeroMutationTurns),
      1,
    );
    const moral = maybeSection("Moral / Philosophical Dynamics", moralRows);
    if (moral) sections.push(moral);
  }

  return sections;
}
