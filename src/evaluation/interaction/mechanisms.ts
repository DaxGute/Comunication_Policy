/**
 * Higher-order interaction mechanisms shared across all tasks.
 */
import { opportunity } from "./rates";
import type {
  InteractionEvent,
  MechanismMetrics,
  ReasoningObject,
} from "./types";
import type { DisagreementRecord } from "./metrics";

function ofType(
  events: InteractionEvent[],
  type: InteractionEvent["type"],
): InteractionEvent[] {
  return events.filter((event) => event.type === type);
}

export function computeMechanisms(options: {
  objects: ReasoningObject[];
  events: InteractionEvent[];
  disagreements: DisagreementRecord[];
}): MechanismMetrics {
  const { objects, events, disagreements } = options;
  const adoptions = ofType(events, "adopted");
  const persuasion = adoptions.filter((adopt) =>
    events.some(
      (item) =>
        item.objectId === adopt.objectId &&
        item.turn <= adopt.turn &&
        (item.type === "challenged" ||
          item.type === "verified" ||
          item.type === "independently_derived" ||
          item.type === "supported"),
    ),
  ).length;
  const deference = ofType(events, "unsupported_adoption").length;
  const canonicalByAgent = new Map<string, Set<string>>();
  for (const object of objects) {
    if (object.originatingAgent === "system") continue;
    const set = canonicalByAgent.get(object.canonicalId) ?? new Set();
    set.add(object.originatingAgent);
    canonicalByAgent.set(object.canonicalId, set);
  }
  const independentConvergence = [...canonicalByAgent.values()].filter(
    (agents) => agents.has("agent_a") && agents.has("agent_b"),
  ).length;
  const productive = disagreements.filter(
    (d) =>
      d.resolution === "revision" ||
      d.resolution === "synthesis" ||
      d.resolution === "rejection",
  ).length;
  const unproductive = disagreements.filter(
    (d) => d.resolution === "unresolved",
  ).length;
  const synthesis = ofType(events, "synthesized").length;
  const propagated = objects.filter(
    (object) =>
      object.unsupported &&
      object.supportingAgents.length > 0 &&
      object.inFinalPosition,
  ).length;
  const unsupported = objects.filter((object) => object.unsupported);
  return {
    persuasion: opportunity(persuasion, adoptions.length),
    deference: opportunity(deference, adoptions.length),
    independentConvergence: opportunity(
      independentConvergence,
      canonicalByAgent.size,
    ),
    productiveDisagreement: opportunity(productive, disagreements.length),
    unproductiveDisagreement: opportunity(unproductive, disagreements.length),
    synthesis: opportunity(synthesis, objects.length),
    errorPropagation: opportunity(propagated, unsupported.length),
  };
}
