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
  badgeForId?: (id: string) => string | undefined;
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
            const badge = props.badgeForId?.(id);
            return (
              <li key={id}>
                <code className="mono">{id}</code>
                {badge ? (
                  <span className="info-assignment__badge muted">{badge}</span>
                ) : null}
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
    const treatment = assignment.hiddenProfileTreatment;
    const promotedA = new Set(treatment?.promotedFromAToSharedIds ?? []);
    const promotedB = new Set(treatment?.promotedFromBToSharedIds ?? []);

    return (
      <div className="info-assignment">
        <header className="info-assignment__header">
          <p>
            Requested overlap: <strong className="mono">{requestedPct}%</strong>
            {" · "}
            {treatment ? (
              <>
                Private promotion rate:{" "}
                <strong className="mono">{realizedPct}%</strong>
              </>
            ) : (
              <>
                Realized overlap: <strong className="mono">{realizedPct}%</strong>
              </>
            )}
            {" · "}
            Units: <strong className="mono">{assignment.totalUnits}</strong>
          </p>
          <p className="muted mono">seed={assignment.splitSeed}</p>
          {treatment ? (
            <p className="mono">
              condition={treatment.condition}
              {" · "}
              promoted A {treatment.promotedAtoSharedCount}/
              {treatment.authoredAPrivateCount}
              {" · "}
              B {treatment.promotedBtoSharedCount}/
              {treatment.authoredBPrivateCount}
              {" · "}
              remaining private A {treatment.realizedAPrivateCount} · B{" "}
              {treatment.realizedBPrivateCount}
            </p>
          ) : null}
          {assignment.diagnostics?.warnings?.length ? (
            <p className="info-assignment__warn">
              {assignment.diagnostics.warnings.join(" · ")}
            </p>
          ) : null}
        </header>

        {treatment ? (
          <>
            <UnitList
              title="ORIGINALLY SHARED"
              ids={treatment.originalSharedIds}
              unitsById={unitsById}
            />
            <UnitList
              title="ORIGINALLY A-PRIVATE"
              ids={treatment.originalAPrivateIds}
              unitsById={unitsById}
              badgeForId={(id) =>
                promotedA.has(id)
                  ? "promoted → shared"
                  : "still A-only"
              }
            />
            <UnitList
              title="ORIGINALLY B-PRIVATE"
              ids={treatment.originalBPrivateIds}
              unitsById={unitsById}
              badgeForId={(id) =>
                promotedB.has(id)
                  ? "promoted → shared"
                  : "still B-only"
              }
            />
            <UnitList
              title="REALIZED SHARED (agent access)"
              ids={assignment.sharedUnitIds}
              unitsById={unitsById}
            />
            <UnitList
              title="REALIZED A-ONLY"
              ids={assignment.agentAOnlyUnitIds}
              unitsById={unitsById}
            />
            <UnitList
              title="REALIZED B-ONLY"
              ids={assignment.agentBOnlyUnitIds}
              unitsById={unitsById}
            />
          </>
        ) : (
          <>
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
          </>
        )}

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
