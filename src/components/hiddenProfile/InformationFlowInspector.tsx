import type { ProblemConversation } from "../../experiment/types";
import { buildPrivateInformationFlowTable } from "../../information";

/** Researcher timeline of private-unit communication and partner uptake. */
export function InformationFlowInspector({
  conversation,
}: {
  conversation: ProblemConversation;
}) {
  const rows = buildPrivateInformationFlowTable(conversation);
  const eq = conversation.evidenceQualityMetrics;
  const flow = conversation.informationFlowMetrics;

  return (
    <div className="information-flow-inspector">
      <h4>Information flow</h4>
      {flow ? (
        <div className="information-flow-inspector__summary mono muted">
          private A/B {flow.privateInformationCountA ?? flow.privateUnitsA}/
          {flow.privateInformationCountB ?? flow.privateUnitsB}
          {" · "}
          revealed A/B {flow.privateInformationRevealedA ?? 0}/
          {flow.privateInformationRevealedB ?? 0}
          {" · "}
          partner uptake turn {flow.timeToPartnerUptake ?? "—"}
          {" · "}
          cross-agent revisions {flow.crossAgentRevisionCount ?? 0}
          {" · "}
          decisive coverage{" "}
          {flow.decisiveInformationCoverage == null
            ? "—"
            : flow.decisiveInformationCoverage.toFixed(2)}
        </div>
      ) : null}
      {eq ? (
        <div className="information-flow-inspector__summary mono muted">
          stronger survived: {String(eq.strongerEvidenceSurvived)}
          {" · "}
          weaker survived: {String(eq.weakerEvidenceSurvived)}
          {" · "}
          followed stronger: {String(eq.finalDecisionFollowedStrongerEvidence)}
          {" · "}
          revise→strong/weak: {eq.revisionTowardStrongerEvidence ?? "—"}/
          {eq.revisionTowardWeakerEvidence ?? "—"}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="muted">
          No private information units on this conversation.
        </div>
      ) : (
        <table className="information-flow-inspector__table mono">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Initially</th>
              <th>First communicated</th>
              <th>Entered graph</th>
              <th>First used by partner</th>
              <th>Final answer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.unitId}>
                <td>{row.unitId}</td>
                <td>{row.initially}</td>
                <td>
                  {row.firstCommunicatedTurn === null
                    ? "—"
                    : `Turn ${row.firstCommunicatedTurn}${
                        row.firstCommunicatedBy
                          ? ` by ${row.firstCommunicatedBy === "agent_a" ? "A" : "B"}`
                          : ""
                      }`}
                </td>
                <td>{row.enteredGraphVersionId ?? "—"}</td>
                <td>
                  {row.firstUsedByPartnerTurn === null
                    ? "—"
                    : `Turn ${row.firstUsedByPartnerTurn}`}
                </td>
                <td>{row.usedInFinalAnswer ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
