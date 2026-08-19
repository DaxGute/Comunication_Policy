/**
 * Universal per-turn interaction trajectories.
 */
import { snapshotBeforeTurn } from "../../reasoning";
import type { ConversationMessage } from "../../experiment/types";
import type { ReasoningGraph } from "../../reasoning/types";
import { buildInteractionView, eventChangedState, isAgent, maxGraphDepth } from "./objects";
import type {
  InteractionEvent,
  InteractionTrajectoryPoint,
} from "./types";

export function computeInteractionTrajectory(options: {
  graph: ReasoningGraph;
  events: InteractionEvent[];
  messages: ConversationMessage[];
  category?: string;
}): InteractionTrajectoryPoint[] {
  const turns = [
    ...new Set(options.messages.map((m) => m.turnIndex).filter((t) => t > 0)),
  ].sort((a, b) => a - b);
  const speakerAt = new Map(
    options.messages.map((m) => [m.turnIndex, m.agentId] as const),
  );
  const points: InteractionTrajectoryPoint[] = [];
  for (const turn of turns) {
    const slice = snapshotBeforeTurn(options.graph, turn + 1);
    const view = buildInteractionView(slice, options.category);
    const atTurn = options.events.filter((e) => e.turn === turn);
    const count = (type: InteractionEvent["type"]) =>
      atTurn.filter((e) => e.type === type).length;
    const speaker = speakerAt.get(turn);
    points.push({
      turn,
      speaker: isAgent(speaker) ? speaker : undefined,
      introduced: count("introduced"),
      supported: count("supported"),
      challenged: count("challenged"),
      adopted: count("adopted"),
      revised: count("revised"),
      corrected: count("corrected"),
      withdrawn: count("withdrawn"),
      reasoningObjectCount: view.objects.filter(
        (o) => o.originatingAgent !== "system",
      ).length,
      activeBranchCount: view.objects.filter(
        (o) =>
          o.originatingAgent !== "system" &&
          o.status !== "rejected" &&
          o.status !== "superseded",
      ).length,
      graphDepth: maxGraphDepth(
        view.objects.map((o) => o.id),
        view.graph.edges ?? [],
      ),
      mutations: slice.events.filter(
        (e) => e.turnIndex === turn && eventChangedState(e),
      ).length,
      aInfluence: view.objects.filter(
        (o) => o.originatingAgent === "agent_a" && o.inFinalPosition,
      ).length,
      bInfluence: view.objects.filter(
        (o) => o.originatingAgent === "agent_b" && o.inFinalPosition,
      ).length,
    });
  }
  return points;
}
