/**
 * Researcher-only information assignment inspector.
 * Never injected into model prompts.
 */
import { memo } from "react";
import type { InformationAssignment } from "../../information/types";

function UnitList(props: {
  title: string;
  ids: string[];
  unitsById: Map<string, { id: string; text: string }>;
}) {
  return (
    <section className="info-assignment__section">
      <h4>{props.title}</h4>
      {props.ids.length === 0 ? (
        <p className="muted">(none)</p>
      ) : (
        <ul className="info-assignment__list">
          {props.ids.map((id) => {
            const unit = props.unitsById.get(id);
            return (
              <li key={id}>
                <code className="mono">{id}</code>
                {unit ? (
                  <span className="info-assignment__text">{unit.text}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export const InformationAssignmentPanel = memo(
  function InformationAssignmentPanel({
    assignment,
  }: {
    assignment?: InformationAssignment;
  }) {
    if (!assignment) {
      return (
        <div className="info-assignment">
          <p className="muted">
            No information assignment on this conversation (legacy run or not
            yet seeded).
          </p>
        </div>
      );
    }

    const unitsById = new Map(
      (assignment.units ?? []).map((unit) => [unit.id, unit]),
    );
    const requestedPct = Math.round(assignment.overlapRequested * 100);
    const realizedPct = Math.round(assignment.overlapRealized * 100);

    return (
      <div className="info-assignment">
        <header className="info-assignment__header">
          <p>
            Requested overlap: <strong className="mono">{requestedPct}%</strong>
            {" · "}
            Realized overlap: <strong className="mono">{realizedPct}%</strong>
            {" · "}
            Units: <strong className="mono">{assignment.totalUnits}</strong>
          </p>
          <p className="muted mono">seed={assignment.splitSeed}</p>
          {assignment.diagnostics?.warnings?.length ? (
            <p className="info-assignment__warn">
              {assignment.diagnostics.warnings.join(" · ")}
            </p>
          ) : null}
        </header>

        <UnitList
          title="SHARED"
          ids={assignment.sharedUnitIds}
          unitsById={unitsById}
        />
        <UnitList
          title="AGENT A ONLY"
          ids={assignment.agentAOnlyUnitIds}
          unitsById={unitsById}
        />
        <UnitList
          title="AGENT B ONLY"
          ids={assignment.agentBOnlyUnitIds}
          unitsById={unitsById}
        />

        <p className="muted">
          Agent A sees {assignment.agentAUnitIds.length}/{assignment.totalUnits}
          {" · "}
          Agent B sees {assignment.agentBUnitIds.length}/{assignment.totalUnits}
          {" · "}
          Union {assignment.totalUnits}/{assignment.totalUnits}
        </p>
      </div>
    );
  },
);
