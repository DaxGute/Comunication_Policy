/**
 * Per-turn moral-dynamics trajectories over the reasoning graph.
 */
import { snapshotBeforeTurn } from "../../reasoning";
import {
  buildMoralGraphView,
  eventChangedState,
  maxGraphDepth,
} from "./graphView";
import type { MoralEvalEvent, MoralTurnSnapshot } from "./types";
import type { ReasoningGraph } from "../../reasoning/types";

export function computeMoralTrajectories(
  graph: ReasoningGraph,
  events: MoralEvalEvent[],
  turns: number[],
): MoralTurnSnapshot[] {
  const orderedTurns = [...new Set(turns.filter((turn) => turn > 0))].sort(
    (a, b) => a - b,
  );
  const snapshots: MoralTurnSnapshot[] = [];
  const seenCanonical = new Set<string>();
  let abandoned = 0;

  for (const turn of orderedTurns) {
    const slice = snapshotBeforeTurn(graph, turn + 1);
    const view = buildMoralGraphView(slice);
    for (const idea of view.ideas) {
      if (idea.originatingAgent === "system") continue;
      seenCanonical.add(idea.canonicalId);
    }
    abandoned += events.filter(
      (event) =>
        event.turn === turn &&
        (event.type === "idea_abandoned" || event.type === "axiom_abandoned"),
    ).length;
    const active = view.ideas.filter(
      (idea) =>
        idea.originatingAgent !== "system" &&
        idea.status !== "rejected" &&
        idea.status !== "superseded",
    );
    const supported = active.filter((idea) => idea.parentIds.length > 0);
    const contested = active.filter((idea) => idea.challengingAgents.length > 0);
    const shared = view.ideas.filter(
      (idea) =>
        idea.originatingAgent !== "system" &&
        (idea.supportingAgents.length > 0 ||
          events.some(
            (event) =>
              event.turn <= turn &&
              event.ideaId === idea.id &&
              (event.type === "idea_adopted" || event.type === "axiom_adopted"),
          )),
    );
    const mutations = slice.events.filter(
      (event) => event.turnIndex === turn && eventChangedState(event),
    ).length;
    const survivingFromA = view.ideas.filter(
      (idea) =>
        idea.originatingAgent === "agent_a" && idea.inFinalPosition,
    ).length;
    const survivingFromB = view.ideas.filter(
      (idea) =>
        idea.originatingAgent === "agent_b" && idea.inFinalPosition,
    ).length;
    snapshots.push({
      turn,
      cumulativeUniqueIdeas: seenCanonical.size,
      activeIdeas: active.length,
      supportedIdeas: supported.length,
      contestedIdeas: contested.length,
      abandonedIdeas: abandoned,
      sharedAdoptedIdeas: shared.length,
      graphDepth: maxGraphDepth(
        view.ideas.map((idea) => idea.id),
        view.graph.edges ?? [],
      ),
      graphMutations: mutations,
      survivingFromA,
      survivingFromB,
    });
  }
  return snapshots;
}
