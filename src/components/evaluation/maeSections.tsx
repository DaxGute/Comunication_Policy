/**
 * MARBLE and interaction-dynamics result sections.
 *
 * Task-specific graders stay in the inspector results pane. Legacy
 * belief/moral records still render when a unified interaction record is absent.
 */
import type {
  BeliefDirectionalFraction,
  BeliefDynamicsEvaluation,
  BeliefEvent,
  BeliefFraction,
  EvaluationStageState,
  MarbleEvaluation,
} from "../../evaluation/types";
import type { MoralDynamicsEvaluation } from "../../evaluation/moral/types";
import type {
  DirectionalOpportunity,
  InteractionEvaluation,
  OpportunityRate,
} from "../../evaluation/interaction/types";
import {
  AUTHORITY_DIRECTIONAL,
  CROSS_POLICY_FRACTIONS,
  FAMILIARITY_FRACTIONS,
  SHOW_CROSS_POLICY_AND_TRUTH,
  TRUST_DIRECTIONAL,
  TRUTH_SPLITS,
} from "../../evaluation/belief/metricCatalog";

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(0)}%`;
}

function formatFrac(value: BeliefFraction | undefined): string {
  if (!value || value.rate === null || value.denominator === 0) return "N/A";
  return `${formatPct(value.rate)} · ${value.numerator}/${value.denominator}`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return String(value);
}

function hasDefinedRate(value: BeliefFraction | undefined): boolean {
  return Boolean(value && value.rate !== null && value.denominator > 0);
}

function MetricRow({
  label,
  value,
  hint,
  sub,
}: {
  label: string;
  value?: string;
  hint?: string;
  sub?: string;
}) {
  return (
    <div className="mae-metric-row">
      <div className="mae-metric-row__head">
        <dt>
          <span className="mae-metric-row__label">{label}</span>
          {sub ? (
            <span className="mae-metric-row__sub muted mono" title={sub}>
              {sub}
            </span>
          ) : null}
          {hint ? (
            <span className="mae-metric-row__sub muted" title={hint}>
              {hint}
            </span>
          ) : null}
        </dt>
        {value ? <dd className="mono">{value}</dd> : null}
      </div>
    </div>
  );
}

function DirectionalRow({
  label,
  data,
  hint,
}: {
  label: string;
  data: BeliefDirectionalFraction | undefined;
  hint?: string;
}) {
  if (!data) return null;
  const showDir =
    hasDefinedRate(data.aToB) || hasDefinedRate(data.bToA);
  return (
    <MetricRow
      label={label}
      value={formatFrac(data.overall)}
      hint={hint}
      sub={
        showDir
          ? `A→B ${formatFrac(data.aToB)}  B→A ${formatFrac(data.bToA)}`
          : undefined
      }
    />
  );
}

function TruthSplitRow({
  label,
  correct,
  incorrect,
}: {
  label: string;
  correct: BeliefFraction | undefined;
  incorrect: BeliefFraction | undefined;
}) {
  if (!hasDefinedRate(correct) && !hasDefinedRate(incorrect)) return null;
  return (
    <MetricRow
      label={label}
      sub={`correct ${formatFrac(correct)}  incorrect ${formatFrac(incorrect)}`}
    />
  );
}

function eventFlags(event: BeliefEvent): string[] {
  const flags: string[] = [];
  if (event.hasEvidence) flags.push("evidence");
  if (event.isNovel) flags.push("novel");
  if (event.isRepetition) flags.push("repeat");
  if (event.isRedundantRederivation) flags.push("re-derive");
  if (event.reusesEstablishedInfo) flags.push("reuse");
  if (event.isCoordination) flags.push("coordination");
  if (event.usesShorthand || event.referenceStyle === "shorthand") {
    flags.push("shorthand");
  }
  if (event.referenceResolved === false) flags.push("unresolved-ref");
  if (typeof event.expressedConfidence === "number") {
    flags.push(`conf ${event.expressedConfidence.toFixed(2)}`);
  }
  return flags;
}

function formatScore5(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} / 5`;
}

function currentStage(
  stages: EvaluationStageState[],
): EvaluationStageState | undefined {
  return (
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "failed") ??
    stages.at(-1)
  );
}

export function CurrentStep({ stages }: { stages: EvaluationStageState[] }) {
  const stage = currentStage(stages);
  if (!stage) {
    return (
      <div className="mae-current-step">
        <span className="mae-current-step__label">Starting evaluation…</span>
        <span className="mae-current-step__bar" aria-hidden="true" />
      </div>
    );
  }

  const isFailed = stage.status === "failed";
  return (
    <div
      className={`mae-current-step${isFailed ? " mae-current-step--failed" : ""}`}
    >
      <span className="mae-current-step__label">{stage.label}</span>
      {!isFailed ? (
        <span className="mae-current-step__bar" aria-hidden="true" />
      ) : null}
      {stage.detail ? (
        <span className="mae-current-step__detail muted">{stage.detail}</span>
      ) : null}
    </div>
  );
}

export function MarbleSection({ data }: { data: MarbleEvaluation }) {
  return (
    <section className="mae-section">
      <h4>MultiAgentBench / MARBLE</h4>
      <p className="mae-canon-label">Standardized coordination metrics</p>
      <dl className="mae-metrics">
        <div>
          <dt>Communication</dt>
          <dd className="mono">{formatScore5(data.communicationScore)}</dd>
        </div>
        <div>
          <dt>Planning</dt>
          <dd className="mono">{formatScore5(data.planningScore)}</dd>
        </div>
        <div>
          <dt>Coordination</dt>
          <dd className="mono">{formatScore5(data.coordinationScore)}</dd>
        </div>
      </dl>
      <details className="mae-details">
        <summary>MARBLE adapter notes</summary>
        <ul>
          {data.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="muted mono">
          commit {data.marbleCommit?.slice(0, 8)} · adapter {data.adapterVersion}
        </p>
      </details>
    </section>
  );
}

export function BeliefSection({ data }: { data: BeliefDynamicsEvaluation }) {
  const m = data.metrics;
  const trust = m.trust;
  const authority = m.authority;
  const familiarity = m.familiarity;
  const crossPolicy = m.crossPolicy;
  const truth = m.truthConditioned;
  return (
    <section className="mae-section">
      <h4>Belief Dynamics</h4>
      <p className="mae-canon-label">
        Trajectory metrics from claims/events — policy sliders were not shown to
        the evaluator
      </p>
      {!trust || !authority || !familiarity || !crossPolicy ? (
        <dl className="mae-metrics">
          <div>
            <dt>Claims introduced</dt>
            <dd className="mono">{m.claimsIntroduced}</dd>
          </div>
          <div>
            <dt>Incorrect claims</dt>
            <dd className="mono">{m.incorrectClaims}</dd>
          </div>
          <div>
            <dt>Correction rate</dt>
            <dd className="mono">{formatPct(m.errorCorrectionRate)}</dd>
          </div>
          <div>
            <dt>Reinforcement rate</dt>
            <dd className="mono">{formatPct(m.errorReinforcementRate)}</dd>
          </div>
          <div>
            <dt>Challenges</dt>
            <dd className="mono">{m.challenges}</dd>
          </div>
          <div>
            <dt>Successful challenges</dt>
            <dd className="mono">{m.successfulChallenges}</dd>
          </div>
          <div>
            <dt>Independent critique</dt>
            <dd className="mono">{formatPct(m.independentCritiqueRate)}</dd>
          </div>
          <div>
            <dt>Deference</dt>
            <dd className="mono">{formatPct(m.deferenceRate)}</dd>
          </div>
          <div>
            <dt>Correct convergence</dt>
            <dd className="mono">{m.correctConvergenceCount}</dd>
          </div>
          <div>
            <dt>Erroneous convergence</dt>
            <dd className="mono">{m.erroneousConvergenceCount}</dd>
          </div>
        </dl>
      ) : (
        <>
          <div className="mae-metric-group">
            <h5>Trust Behavior</h5>
            <dl className="mae-metric-list">
              {TRUST_DIRECTIONAL.map((spec) => (
                <DirectionalRow
                  key={spec.label}
                  label={spec.label}
                  data={spec.pick(trust)}
                  hint={spec.hint}
                />
              ))}
            </dl>
          </div>

          <div className="mae-metric-group">
            <h5>Authority Behavior</h5>
            <dl className="mae-metric-list">
              {AUTHORITY_DIRECTIONAL.map((spec) => (
                <DirectionalRow
                  key={spec.label}
                  label={spec.label}
                  data={spec.pick(authority)}
                  hint={spec.hint}
                />
              ))}
              <MetricRow
                label="Incorrect high-influence persistence"
                value={formatFrac(
                  authority.incorrectHighInfluencePersistence,
                )}
              />
              <MetricRow
                label="Evidence-over-authority"
                value={formatFrac(authority.evidenceOverAuthority)}
              />
              <MetricRow
                label="Decision concentration"
                value={
                  authority.decisionConcentration.herfindahl === null
                    ? "N/A"
                    : `HHI ${authority.decisionConcentration.herfindahl.toFixed(2)}${
                        authority.decisionConcentration.dominantAgent
                          ? ` · ${authority.decisionConcentration.dominantAgent}`
                          : ""
                      }`
                }
                sub={`A share ${formatFrac(authority.decisionConcentration.agent_aShare)}  B share ${formatFrac(authority.decisionConcentration.agent_bShare)}`}
              />
              <MetricRow
                label="Initiative concentration"
                value={
                  authority.initiativeConcentration.herfindahl === null
                    ? "N/A"
                    : `HHI ${authority.initiativeConcentration.herfindahl.toFixed(2)}`
                }
              />
              <MetricRow
                label="Final-answer ownership"
                value={`A ${formatFrac(authority.finalAnswerOwnership.agent_aShare)} · B ${formatFrac(authority.finalAnswerOwnership.agent_bShare)}`}
              />
              <MetricRow
                label="Speaking A"
                value={`${formatCount(authority.speakingDominance.agent_a.tokens)} tok · ${authority.speakingDominance.agent_a.claimsIntroduced} claims · ${authority.speakingDominance.agent_a.proposals} proposals`}
                hint="Descriptive only — authority is taken from disagreement/deference, not token share"
              />
              <MetricRow
                label="Speaking B"
                value={`${formatCount(authority.speakingDominance.agent_b.tokens)} tok · ${authority.speakingDominance.agent_b.claimsIntroduced} claims · ${authority.speakingDominance.agent_b.proposals} proposals`}
                sub={
                  authority.speakingDominance.tokenShareA !== null
                    ? `A token share ${formatPct(authority.speakingDominance.tokenShareA)}`
                    : undefined
                }
              />
            </dl>
          </div>

          <div className="mae-metric-group">
            <h5>Familiarity Behavior</h5>
            <dl className="mae-metric-list">
              {FAMILIARITY_FRACTIONS.map((spec) => (
                <MetricRow
                  key={spec.label}
                  label={spec.label}
                  value={formatFrac(spec.pick(familiarity))}
                />
              ))}
              <MetricRow
                label="Repair cost"
                value={
                  familiarity.repairCost.episodes === 0
                    ? "N/A"
                    : `${formatCount(familiarity.repairCost.meanTurns)} turns · ${formatCount(familiarity.repairCost.meanTokens)} tok · ${familiarity.repairCost.resolved}/${familiarity.repairCost.episodes} resolved`
                }
              />
            </dl>
          </div>

          {SHOW_CROSS_POLICY_AND_TRUTH ? (
            <div className="mae-metric-group">
              <h5>Cross-Policy Dynamics</h5>
              <dl className="mae-metric-list">
                {CROSS_POLICY_FRACTIONS.map((spec) => (
                  <MetricRow
                    key={spec.label}
                    label={spec.label}
                    value={formatFrac(spec.pick(crossPolicy))}
                  />
                ))}
                <MetricRow
                  label="Novel contribution balance"
                  value={`A ${formatFrac(crossPolicy.novelContributionBalance.agent_aShare)} · B ${formatFrac(crossPolicy.novelContributionBalance.agent_bShare)}`}
                />
                <MetricRow
                  label="Turns to convergence"
                  value={formatCount(crossPolicy.turnsToConvergence)}
                />
                <MetricRow
                  label="Correct / erroneous convergence"
                  value={`${m.correctConvergenceCount} / ${m.erroneousConvergenceCount}`}
                />
              </dl>
            </div>
          ) : null}

          {SHOW_CROSS_POLICY_AND_TRUTH && m.hasCheckableClaims && truth ? (
            <div className="mae-metric-group">
              <h5>Truth-conditioned splits</h5>
              <dl className="mae-metric-list">
                {TRUTH_SPLITS.map((spec) => {
                  const split = spec.pick(truth);
                  return (
                    <TruthSplitRow
                      key={spec.label}
                      label={spec.label}
                      correct={split.correct}
                      incorrect={split.incorrect}
                    />
                  );
                })}
                <MetricRow
                  label="Abandonment of correct claims"
                  value={formatFrac(truth.abandonmentOfCorrect)}
                />
                <MetricRow
                  label="Correction of incorrect claims"
                  value={formatFrac(truth.correctionOfIncorrect)}
                />
              </dl>
            </div>
          ) : null}
        </>
      )}
      <details className="mae-details">
        <summary>Inspect Interaction Events</summary>
        <div className="mae-events">
          {data.claims.map((claim) => (
            <div key={claim.id} className="mae-claim">
              <div className="mae-claim__head">
                <strong>{claim.id}</strong>
                <span className="mono">
                  {(claim.kind ?? "claim").toUpperCase()} ·{" "}
                  {claim.correctness.toUpperCase()} · {claim.finalStatus}
                  {claim.survivedIntoFinalAnswer ? " · final" : ""}
                </span>
              </div>
              <p>{claim.text}</p>
              {claim.evidence ? (
                <p className="muted">Evidence: {claim.evidence}</p>
              ) : null}
              <ul>
                {claim.events.map((event, idx) => (
                  <li key={`${claim.id}-${idx}-${event.turn}`}>
                    <span className="mono">
                      TURN {event.turn} · {event.agent} · {event.action.toUpperCase()}
                    </span>
                    {event.evidence ? (
                      <div className="muted">{event.evidence}</div>
                    ) : null}
                    {eventFlags(event).length > 0 ? (
                      <div className="mae-tag">{eventFlags(event).join(" · ")}</div>
                    ) : null}
                    {event.resultingBeliefChange === true ? (
                      <div className="mae-tag">successful change</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function formatDir(data: BeliefDirectionalFraction | undefined): string {
  if (!data) return "N/A";
  return `A adopts B ${formatFrac(data.aToB)} · B adopts A ${formatFrac(data.bToA)}`;
}

function CountRateRow({
  label,
  count,
  rate,
  hint,
}: {
  label: string;
  count?: number;
  rate?: BeliefFraction;
  hint?: string;
}) {
  const countText = count === undefined ? undefined : formatCount(count);
  const rateText = rate ? formatFrac(rate) : undefined;
  const value =
    countText && rateText
      ? `${countText} · ${rateText}`
      : countText ?? rateText;
  return <MetricRow label={label} value={value} hint={hint} />;
}

export function MoralSection({ data }: { data: MoralDynamicsEvaluation }) {
  const d = data.deterministic;
  const judge = data.judgeScores;
  const notes = [
    data.metadata.graphMissing
      ? "No idea/axiom graph on this conversation."
      : null,
    data.metadata.interrupted ? "Run was interrupted." : null,
    data.metadata.noDisagreement ? "No disagreement events." : null,
    data.metadata.noAdoption ? "No cross-agent adoption." : null,
    data.metadata.noExplicitAxioms ? "No agent-introduced axioms." : null,
    data.metadata.oneSidedContribution
      ? "Only one agent contributed ideas."
      : null,
  ].filter(Boolean);

  return (
    <section className="mae-section">
      <h4>Moral / Philosophical Dynamics</h4>
      <p className="mae-canon-label">
        Deterministic reductions over the idea/axiom graph — policy sliders were
        not shown to the evaluator
      </p>
      {notes.length > 0 ? (
        <p className="mae-notes muted">{notes.join(" ")}</p>
      ) : null}

      <div className="mae-metric-group">
        <h5>Contributions</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Ideas originated"
            value={`A ${d.contribution.ideaCountByAgent.agent_a} · B ${d.contribution.ideaCountByAgent.agent_b}`}
          />
          <MetricRow
            label="Novel ideas"
            value={`A ${d.contribution.novelIdeaCountByAgent.agent_a} · B ${d.contribution.novelIdeaCountByAgent.agent_b}`}
          />
          <MetricRow
            label="Axioms originated"
            value={`A ${d.contribution.axiomCountByAgent.agent_a} · B ${d.contribution.axiomCountByAgent.agent_b}`}
          />
          <MetricRow
            label="Origin share"
            value={`A ${formatFrac(d.contribution.originShare.agent_aShare)} · B ${formatFrac(d.contribution.originShare.agent_bShare)}`}
          />
          <MetricRow
            label="Final-position share"
            value={`A ${formatFrac(d.contribution.finalPositionShare.agent_aShare)} · B ${formatFrac(d.contribution.finalPositionShare.agent_bShare)}`}
            sub={
              d.contribution.finalPositionShare.herfindahl === null
                ? undefined
                : `HHI ${d.contribution.finalPositionShare.herfindahl.toFixed(2)}`
            }
          />
          <MetricRow
            label="Idea survival by origin"
            value={`A ${formatFrac(d.contribution.survivalByOrigin.aToB)} · B ${formatFrac(d.contribution.survivalByOrigin.bToA)}`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Influence / Adoption</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Adoption"
            value={formatFrac(d.adoption.adoption.overall)}
            sub={formatDir(d.adoption.adoption)}
            hint="A adopts B is flow B→A. B adopts A is flow A→B."
          />
          <MetricRow
            label="Influence imbalance"
            value={
              d.adoption.influenceImbalance === null
                ? "N/A"
                : d.adoption.influenceImbalance.toFixed(2)
            }
            hint="A-adopts-B rate minus B-adopts-A rate. Positive means B's ideas are adopted more."
          />
          <MetricRow
            label="Downstream descendants"
            value={`A ${d.adoption.downstreamDescendants.agent_a} · B ${d.adoption.downstreamDescendants.agent_b}`}
          />
          <MetricRow
            label="Influence centrality"
            value={`A ${d.adoption.influenceCentrality.agent_a} · B ${d.adoption.influenceCentrality.agent_b}`}
          />
          <MetricRow
            label="Final-trace share"
            value={`A ${formatFrac(d.adoption.finalTraceShare.agent_aShare)} · B ${formatFrac(d.adoption.finalTraceShare.agent_bShare)}`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Disagreement / Resolution</h5>
        <dl className="mae-metric-list">
          <CountRateRow
            label="Challenges"
            count={d.disagreement.challengeCount}
            rate={d.disagreement.challengeRate}
          />
          <CountRateRow
            label="Disagreements resolved"
            count={d.disagreement.disagreementsResolved}
            rate={d.disagreement.resolutionRate}
          />
          <MetricRow
            label="Unresolved"
            value={formatCount(d.disagreement.disagreementsUnresolved)}
          />
          <MetricRow
            label="Who survives"
            value={`A ${d.disagreement.disagreementSurvivor.agent_a} · B ${d.disagreement.disagreementSurvivor.agent_b} · synthesis ${d.disagreement.disagreementSurvivor.synthesis}`}
          />
          <DirectionalRow
            label="Concession"
            data={d.disagreement.concession}
            hint="A→B = A concedes to B"
          />
          <CountRateRow
            label="Mutual synthesis"
            count={d.disagreement.resolutions.synthesis}
            rate={d.disagreement.mutualSynthesisRate}
          />
          <MetricRow
            label="Resolution kinds"
            value={`accept ${d.disagreement.resolutions.acceptance} · reject ${d.disagreement.resolutions.rejection} · revise ${d.disagreement.resolutions.revision} · synth ${d.disagreement.resolutions.synthesis} · open ${d.disagreement.resolutions.unresolved}`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Axioms / Justification</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Axioms"
            value={`${d.axioms.axiomsIntroduced} introduced · ${d.axioms.axiomsSurviving} surviving · ${d.axioms.axiomsShared} shared`}
            sub={`A ${d.axioms.axiomsByAgent.agent_a} · B ${d.axioms.axiomsByAgent.agent_b}`}
          />
          <MetricRow
            label="Contested / abandoned"
            value={`${d.axioms.axiomsContested} contested · ${d.axioms.axiomsAbandoned} abandoned`}
          />
          <DirectionalRow label="Axiom adoption" data={d.axioms.axiomAdoption} />
          <MetricRow
            label="Unsupported assertions"
            value={formatCount(d.axioms.unsupportedAssertions)}
          />
          <MetricRow
            label="Avg justification depth"
            value={
              d.axioms.averageJustificationDepth === null
                ? "N/A"
                : d.axioms.averageJustificationDepth.toFixed(2)
            }
          />
          <MetricRow
            label="Final claims with axiom support"
            value={formatFrac(d.axioms.finalClaimsWithAxiomSupport)}
          />
          <MetricRow
            label="Axiom dependence concentration"
            value={
              d.axioms.axiomDependenceConcentration === null
                ? "N/A"
                : d.axioms.axiomDependenceConcentration.toFixed(2)
            }
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Reasoning Development</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Revisions / abandoned"
            value={`${d.development.revisions} revised · ${d.development.abandonedIdeas} abandoned`}
          />
          <MetricRow
            label="Strengthened / weakened"
            value={`${d.development.strengthenedIdeas} supported later · ${d.development.weakenedIdeas} challenged`}
          />
          <MetricRow
            label="Synthesis nodes"
            value={formatCount(d.development.synthesisNodes)}
          />
          <MetricRow
            label="Graph depth"
            value={
              d.development.maximumGraphDepth === null
                ? "N/A"
                : `avg ${d.development.averageGraphDepth?.toFixed(2) ?? "N/A"} · max ${d.development.maximumGraphDepth}`
            }
          />
          <MetricRow
            label="Branches"
            value={`${d.development.independentBranches} independent · ${d.development.finalSurvivingBranchCount} surviving`}
            sub={
              d.development.branchingFactor === null
                ? undefined
                : `branching ${d.development.branchingFactor.toFixed(2)}`
            }
          />
          <CountRateRow
            label="Graph mutation turns"
            count={d.development.repeatingVsModifying.mutationTurns}
            rate={d.development.repeatingVsModifying.mutationRate}
            hint={`${d.development.repeatingVsModifying.zeroMutationTurns} zero-mutation turns`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Communication Efficiency</h5>
        <dl className="mae-metric-list">
          <MetricRow label="Turns" value={formatCount(d.efficiency.turns)} />
          <MetricRow
            label="Words"
            value={`A ${d.efficiency.wordsPerAgent.agent_a} · B ${d.efficiency.wordsPerAgent.agent_b}`}
          />
          <MetricRow
            label="Repeated ideas"
            value={`${d.efficiency.repeatedIdeas} repeats · ${d.efficiency.redundantRestatements} restatements`}
          />
          <MetricRow
            label="References / questions"
            value={`${d.efficiency.explicitReferences} refs · ${d.efficiency.questions} questions · ${d.efficiency.clarificationRequests} clarifications`}
          />
          <MetricRow
            label="Idea density / turn"
            value={
              d.efficiency.ideaDensityPerTurn === null
                ? "N/A"
                : d.efficiency.ideaDensityPerTurn.toFixed(2)
            }
          />
          <MetricRow
            label="Graph mutations / turn"
            value={
              d.efficiency.graphMutationsPerTurn === null
                ? "N/A"
                : d.efficiency.graphMutationsPerTurn.toFixed(2)
            }
            sub={`${d.efficiency.zeroMutationTurns} zero-mutation turns`}
          />
        </dl>
      </div>

      {judge ? (
        <div className="mae-metric-group">
          <h5>Optional LLM Judge</h5>
          <dl className="mae-metric-list">
            <MetricRow
              label="Reasoning coherence"
              value={formatPct(judge.reasoningCoherence)}
            />
            <MetricRow
              label="Premise–conclusion consistency"
              value={formatPct(judge.premiseConclusionConsistency)}
            />
            <MetricRow
              label="Counterargument engagement"
              value={formatPct(judge.counterargumentEngagement)}
            />
            <MetricRow
              label="Synthesis quality"
              value={formatPct(judge.synthesisQuality)}
            />
            <MetricRow
              label="Final-position support"
              value={formatPct(judge.finalPositionSupport)}
            />
          </dl>
          {judge.notes ? <p className="mae-notes">{judge.notes}</p> : null}
          {judge.unresolvedContradictions.length > 0 ? (
            <ul className="mae-notes">
              {judge.unresolvedContradictions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="mae-notes muted">
          LLM judge was not run. Metrics above are graph/transcript reductions.
        </p>
      )}

      <details className="mae-details">
        <summary>
          Events ({data.events.length}) · trajectory ({data.trajectories.length}{" "}
          turns)
        </summary>
        <ul>
          {data.events.slice(0, 40).map((event, idx) => (
            <li key={`${event.type}-${event.turn}-${idx}`}>
              <span className="mono">
                t{event.turn} · {event.actor} · {event.type}
                {event.ideaId ? ` · ${event.ideaId}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {data.events.length > 40 ? (
          <p className="muted">
            Showing first 40 events. Full list is in JSON export.
          </p>
        ) : null}
      </details>
    </section>
  );
}

function formatOpp(value: OpportunityRate | undefined): string {
  if (!value || value.opportunities === 0 || value.rate === null) return "N/A";
  return `${formatPct(value.rate)} · ${value.events}/${value.opportunities}`;
}

function formatOppDir(data: DirectionalOpportunity | undefined): string {
  if (!data) return "N/A";
  return `A→B ${formatOpp(data.aToB)}  B→A ${formatOpp(data.bToA)}`;
}

function OppRow({
  label,
  data,
  hint,
}: {
  label: string;
  data: OpportunityRate | undefined;
  hint?: string;
}) {
  return <MetricRow label={label} value={formatOpp(data)} hint={hint} />;
}

function OppDirRow({
  label,
  data,
  hint,
}: {
  label: string;
  data: DirectionalOpportunity | undefined;
  hint?: string;
}) {
  if (!data) return null;
  return (
    <MetricRow
      label={label}
      value={formatOpp(data.overall)}
      sub={formatOppDir(data)}
      hint={hint}
    />
  );
}

export function InteractionSection({
  data,
}: {
  data: InteractionEvaluation;
}) {
  const i = data.interaction;
  const m = data.mechanisms;
  const p = data.policyRelevantOutcomes;
  const notes = [
    data.metadata.graphMissing ? "No reasoning graph on this conversation." : null,
    data.metadata.graphMalformed ? "Reasoning graph could not be parsed." : null,
    data.metadata.interrupted ? "Run was interrupted." : null,
    data.metadata.shortConversation ? "Short conversation." : null,
    data.patterns.length > 0
      ? `Patterns: ${data.patterns.join(", ").replaceAll("_", " ")}.`
      : null,
  ].filter(Boolean);

  return (
    <section className="mae-section">
      <h4>Interaction Dynamics</h4>
      <p className="mae-canon-label">
        Universal behavioral metrics — same taxonomy for crossword, proof, and
        philosophy. Task correctness is scored separately.
      </p>
      {notes.length > 0 ? (
        <p className="mae-notes muted">{notes.join(" ")}</p>
      ) : null}

      <div className="mae-metric-group">
        <h5>Contributions</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Introduced"
            value={`A ${i.contributions.introducedByAgent.agent_a} · B ${i.contributions.introducedByAgent.agent_b}`}
          />
          <MetricRow
            label="Novel"
            value={`A ${i.contributions.novelByAgent.agent_a} · B ${i.contributions.novelByAgent.agent_b}`}
          />
          <MetricRow
            label="Support introduced"
            value={`A ${i.contributions.supportIntroducedByAgent.agent_a} · B ${i.contributions.supportIntroducedByAgent.agent_b}`}
          />
          <MetricRow
            label="Origin share"
            value={`A ${formatFrac(i.contributions.originShare.agent_aShare)} · B ${formatFrac(i.contributions.originShare.agent_bShare)}`}
          />
          <MetricRow
            label="Surviving share"
            value={`A ${formatFrac(i.contributions.survivingShare.agent_aShare)} · B ${formatFrac(i.contributions.survivingShare.agent_bShare)}`}
            sub={
              i.contributions.survivingShare.herfindahl === null
                ? undefined
                : `HHI ${i.contributions.survivingShare.herfindahl.toFixed(2)}`
            }
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Adoption & verification</h5>
        <dl className="mae-metric-list">
          <OppDirRow
            label="Adoption"
            data={i.adoption.adoption}
            hint="Denominator: partner-originated reasoning objects."
          />
          <OppDirRow label="Supported adoption" data={i.adoption.supportedAdoption} />
          <OppDirRow
            label="Unsupported adoption"
            data={i.adoption.unsupportedAdoption}
          />
          <OppDirRow
            label="Challenge before adoption"
            data={i.adoption.challengeBeforeAdoption}
          />
          <OppDirRow
            label="Independent verification"
            data={i.verification.independentVerification}
          />
          <OppDirRow
            label="Verification before acceptance"
            data={i.verification.verificationBeforeAcceptance}
          />
          <OppDirRow
            label="Unsupported acceptance"
            data={i.verification.unsupportedAcceptance}
          />
          <MetricRow
            label="Adoption latency"
            value={
              i.adoption.latencyTurns.mean === null
                ? "N/A"
                : `${i.adoption.latencyTurns.mean.toFixed(1)} turns`
            }
            sub={`${i.adoption.latencyTurns.samples} samples`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Challenge & correction</h5>
        <dl className="mae-metric-list">
          <OppRow label="Challenge frequency" data={i.challenges.frequency} />
          <OppDirRow label="Directional challenge" data={i.challenges.directional} />
          <OppRow label="Successful challenges" data={i.challenges.successful} />
          <OppRow label="Unsuccessful challenges" data={i.challenges.unsuccessful} />
          <OppRow
            label="Revision after challenge"
            data={i.challenges.revisionAfterChallenge}
          />
          <OppRow label="Correction" data={i.corrections.corrected} />
          <OppRow label="Self-correction" data={i.corrections.selfCorrection} />
          <OppRow
            label="Cross-agent correction"
            data={i.corrections.crossAgentCorrection}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Influence / deference</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Centrality"
            value={`A ${i.influence.centrality.agent_a} · B ${i.influence.centrality.agent_b}`}
          />
          <OppDirRow label="Proposal survival" data={i.influence.proposalSurvival} />
          <OppDirRow
            label="Disagreement survival"
            data={i.influence.disagreementSurvival}
          />
          <OppDirRow
            label="Concession direction"
            data={i.influence.concessionDirection}
          />
          <MetricRow
            label="Final ancestry"
            value={`A ${formatFrac(i.influence.finalAncestry.agent_aShare)} · B ${formatFrac(i.influence.finalAncestry.agent_bShare)}`}
          />
          <OppDirRow
            label="Deference (unsupported acceptance)"
            data={p.authority.directionalDeference}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Disagreement & resolution</h5>
        <dl className="mae-metric-list">
          <OppRow
            label="Disagreements"
            data={i.disagreement.disagreements}
            hint="Denominator: partner-originated objects."
          />
          <OppRow label="Resolved" data={i.disagreement.resolved} />
          <OppRow label="Unresolved" data={i.disagreement.unresolved} />
          <OppDirRow label="Concession" data={i.disagreement.concession} />
          <OppRow label="Revision" data={i.disagreement.revision} />
          <OppRow label="Rejection" data={i.disagreement.rejection} />
          <OppRow label="Synthesis" data={i.disagreement.synthesis} />
          <MetricRow
            label="Who survives"
            value={`A ${i.disagreement.survivor.agent_a} · B ${i.disagreement.survivor.agent_b} · synth ${i.disagreement.survivor.synthesis} · open ${i.disagreement.survivor.unresolved}`}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Reasoning development</h5>
        <dl className="mae-metric-list">
          <MetricRow
            label="Graph depth"
            value={
              i.reasoningDevelopment.graphDepth.maximum === null
                ? "N/A"
                : `avg ${i.reasoningDevelopment.graphDepth.average?.toFixed(2) ?? "N/A"} · max ${i.reasoningDevelopment.graphDepth.maximum}`
            }
          />
          <MetricRow
            label="Revisions / abandoned"
            value={`${i.reasoningDevelopment.revisions} revised · ${i.reasoningDevelopment.abandonedBranches} abandoned`}
          />
          <MetricRow
            label="Branches"
            value={`${i.reasoningDevelopment.independentBranches} independent · ${i.reasoningDevelopment.survivingBranches} surviving`}
          />
          <MetricRow
            label="Synthesis nodes"
            value={formatCount(i.reasoningDevelopment.synthesisNodes)}
          />
          <OppRow label="Mutation rate" data={i.reasoningDevelopment.mutationRate} />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Communication efficiency</h5>
        <dl className="mae-metric-list">
          <MetricRow label="Turns" value={formatCount(i.efficiency.turns)} />
          <MetricRow
            label="Tokens"
            value={`A ${formatCount(i.efficiency.tokensPerAgent.agent_a)} · B ${formatCount(i.efficiency.tokensPerAgent.agent_b)}`}
          />
          <MetricRow
            label="Unique objects / turn"
            value={
              i.efficiency.uniqueObjectsPerTurn === null
                ? "N/A"
                : i.efficiency.uniqueObjectsPerTurn.toFixed(2)
            }
          />
          <MetricRow
            label="Mutations / turn"
            value={
              i.efficiency.graphMutationsPerTurn === null
                ? "N/A"
                : i.efficiency.graphMutationsPerTurn.toFixed(2)
            }
          />
          <MetricRow
            label="Productive events / turn"
            value={
              i.efficiency.productiveEventsPerTurn === null
                ? "N/A"
                : i.efficiency.productiveEventsPerTurn.toFixed(2)
            }
          />
          <OppRow label="Repetition" data={i.efficiency.repetition} />
          <MetricRow
            label="Zero-mutation turns"
            value={formatCount(i.efficiency.zeroMutationTurns)}
          />
          <OppRow
            label="Clarification overhead"
            data={i.efficiency.clarificationOverhead}
          />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Mechanisms</h5>
        <dl className="mae-metric-list">
          <OppRow label="Persuasion" data={m.persuasion} />
          <OppRow label="Deference" data={m.deference} />
          <OppRow label="Independent convergence" data={m.independentConvergence} />
          <OppRow label="Productive disagreement" data={m.productiveDisagreement} />
          <OppRow
            label="Unproductive disagreement"
            data={m.unproductiveDisagreement}
          />
          <OppRow label="Synthesis" data={m.synthesis} />
          <OppRow label="Error propagation" data={m.errorPropagation} />
        </dl>
      </div>

      <div className="mae-metric-group">
        <h5>Trust / Authority / Familiarity</h5>
        <dl className="mae-metric-list">
          <OppDirRow label="Trust: adoption" data={p.trust.adoption} />
          <OppDirRow
            label="Trust: unsupported adoption"
            data={p.trust.unsupportedAdoption}
          />
          <OppDirRow label="Trust: verification" data={p.trust.verification} />
          <OppRow
            label="Familiarity: repeated information"
            data={p.familiarity.repeatedInformation}
          />
          <OppRow
            label="Familiarity: explicit references"
            data={p.familiarity.explicitReferences}
          />
          <OppRow
            label="Familiarity: clarification"
            data={p.familiarity.clarificationRequests}
          />
        </dl>
      </div>

      <details className="mae-details">
        <summary>
          Timeline / events ({data.events.length}) · trajectory (
          {data.trajectory.length} turns)
        </summary>
        <ul>
          {data.events.slice(0, 40).map((event) => (
            <li key={event.id}>
              <span className="mono">
                t{event.turn} · {event.actor} · {event.type}
                {event.objectId ? ` · ${event.objectId}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {data.events.length > 40 ? (
          <p className="muted">
            Showing first 40 events. Full list is in JSON export.
          </p>
        ) : null}
      </details>
    </section>
  );
}

