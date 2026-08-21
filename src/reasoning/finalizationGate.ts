/**
 * Moral finalization eligibility.
 *
 * Reasoning-phase FINAL_ANSWER is blocked until mutual readyToFinalize
 * against the same graph fingerprint. Crossword and proof keep existing
 * stop-on-FINAL_ANSWER behavior.
 */
import type { AgentId } from "../agents/types";
import type { ProblemCategory } from "../problems/types";
import {
  isUncapturedPartnerTurn,
  type CollaborationTurnMessage,
} from "./collaboration";
import {
  moralConvergenceEligible,
  type MoralConvergenceState,
} from "./moralConvergence";
import type { ReasoningGraph } from "./types";

export type FinalizationBlockKind =
  | "not_converged"
  | "awaiting_finalizer"
  | "partner_must_speak"
  | "empty_graph"
  | "uncaptured_partner"
  | "stale_convergence";

export type FinalizationDecision =
  | { ok: true }
  | {
      ok: false;
      kind: FinalizationBlockKind;
      feedback: string;
      persistRepair?: boolean;
    };

export const NOT_CONVERGED_FEEDBACK = [
  "FINAL_ANSWER is not eligible yet.",
  "",
  "The shared reasoning state has not yet converged.",
  "Continue with local reasoning turns. Set readyToFinalize: true only when",
  "important considerations are sufficiently developed and there is no",
  "specific unresolved issue that another exchange is reasonably likely to",
  "improve. Do not treat broad agreement as convergence.",
  "If your partner's last turn changed persistent state, evaluate the",
  "consequences of that change before judging the graph ready.",
].join("\n");

export const AWAITING_FINALIZER_FEEDBACK = [
  "FINALIZATION PHASE",
  "",
  "Shared reasoning has converged. The designated finalizing agent will",
  "produce the FINAL SYNTHESIS — the first comprehensive treatment of the",
  "entire dilemma — from the active considerations.",
  "Do not emit FINAL_ANSWER on this turn unless you are that agent.",
  "If you must revise persistent state, do so — readiness will reset.",
].join("\n");

export const EMPTY_GRAPH_FEEDBACK = [
  "FINAL_ANSWER is not eligible yet.",
  "",
  "The shared reasoning graph has no active considerations.",
  "Persist the independently revisable considerations that ground your answer,",
  "then synthesize FINAL_ANSWER from that state during FINALIZATION PHASE.",
].join("\n");

export const PERSISTENCE_REQUIRED_FEEDBACK = [
  "PERSISTENCE REQUIRED",
  "",
  "Your partner introduced substantive reasoning that is not yet represented",
  "in canonical state.",
  "",
  "Before finalizing, either:",
  "- incorporate the relevant persistent change into an existing consideration;",
  "- create a new consideration if needed;",
  "- or explicitly determine that the partner's contribution does not alter",
  "  persistent reasoning state (nothingToAdd: true on their turn, or persist",
  "  the delta yourself if you are continuing).",
].join("\n");

export const STALE_CONVERGENCE_FEEDBACK = [
  "FINAL_ANSWER is not eligible yet.",
  "",
  "The graph changed after the prior convergence judgment.",
  "Readiness was reset. Continue reasoning, then re-declare readyToFinalize",
  "only against the current stable state.",
].join("\n");

export function finalizationPhaseCue(finalizerId: AgentId): string {
  const who = finalizerId === "agent_a" ? "Agent A" : "Agent B";
  return [
    "FINALIZATION PHASE",
    "",
    `Shared reasoning has converged. You (${who}) are designated to synthesize.`,
    "This is the first point at which you should attempt a comprehensive treatment of the entire dilemma.",
    "Construct FINAL_ANSWER from CURRENT SHARED REASONING STATE only.",
    "Do not introduce important new reasoning that is absent from active considerations;",
    "if something essential is missing, SET or REVISE it first (this resets readiness).",
    'Include "finalBasis": ["pv-N", ...] naming only the active version ids that materially contributed.',
    "When ready, put FINAL_ANSWER: inside message.",
  ].join("\n");
}

export function evaluateMoralFinalization(args: {
  category: ProblemCategory;
  turn: number;
  speaker: AgentId;
  graph: ReasoningGraph;
  messages: CollaborationTurnMessage[];
  extractedFinalAnswer?: string;
  persistenceRepairDelivered?: boolean;
  convergence?: MoralConvergenceState;
  currentFingerprint?: string;
}): FinalizationDecision {
  if (!args.extractedFinalAnswer?.trim()) return { ok: true };
  if (args.category !== "moral_philosophical") return { ok: true };

  const other: AgentId = args.speaker === "agent_a" ? "agent_b" : "agent_a";
  const partnerSpoke = args.messages.some(
    (message) => message.agentId === other,
  );
  if (!partnerSpoke) {
    return {
      ok: false,
      kind: "partner_must_speak",
      feedback: NOT_CONVERGED_FEEDBACK,
    };
  }

  const activeConsiderations = args.graph.versions.filter(
    (version) => version.status === "active",
  ).length;
  if (activeConsiderations === 0) {
    return {
      ok: false,
      kind: "empty_graph",
      feedback: EMPTY_GRAPH_FEEDBACK,
    };
  }

  const previous = [...args.messages]
    .filter((message) => message.turnIndex < args.turn)
    .sort((a, b) => a.turnIndex - b.turnIndex)
    .at(-1);
  if (
    previous &&
    previous.agentId === other &&
    !args.persistenceRepairDelivered &&
    isUncapturedPartnerTurn(args.graph, previous)
  ) {
    return {
      ok: false,
      kind: "uncaptured_partner",
      feedback: PERSISTENCE_REQUIRED_FEEDBACK,
      persistRepair: true,
    };
  }

  const convergence = args.convergence;
  if (!convergence || !moralConvergenceEligible(convergence)) {
    return {
      ok: false,
      kind: "not_converged",
      feedback: NOT_CONVERGED_FEEDBACK,
    };
  }

  if (
    args.currentFingerprint &&
    convergence.convergedFingerprint &&
    args.currentFingerprint !== convergence.convergedFingerprint
  ) {
    return {
      ok: false,
      kind: "stale_convergence",
      feedback: STALE_CONVERGENCE_FEEDBACK,
    };
  }

  if (convergence.finalizerId && args.speaker !== convergence.finalizerId) {
    return {
      ok: false,
      kind: "awaiting_finalizer",
      feedback: AWAITING_FINALIZER_FEEDBACK,
    };
  }

  return { ok: true };
}
