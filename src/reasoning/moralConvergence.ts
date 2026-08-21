/**
 * Moral conversation length emerges from mutual readiness against a stable
 * graph fingerprint — not from a hardcoded minimum turn count.
 *
 * Readiness is protocol metadata (readyToFinalize). Material accepted
 * SET / REVISE / REMOVE invalidates prior readiness for both agents.
 */
import type { AgentId } from "../agents/types";

export type MoralInteractionPhase = "reasoning" | "finalization";

export type AgentReadiness = {
  fingerprint: string;
  turn: number;
};

export type MoralConvergenceState = {
  phase: MoralInteractionPhase;
  /** Readiness judgments bound to a graph fingerprint. Cleared on material change. */
  ready: Partial<Record<AgentId, AgentReadiness>>;
  /** Agent who confirmed convergence second; synthesizes FINAL_ANSWER. */
  finalizerId?: AgentId;
  /** Fingerprint of the stable state when mutual readiness was achieved. */
  convergedFingerprint?: string;
  convergenceAttempts: number;
  convergenceResets: number;
  lastMaterialChangeTurn?: number;
  graphStateTransitionCount: number;
  materialGraphChangeTurns: number[];
  readinessByTurn: Array<{
    turn: number;
    agentId: AgentId;
    ready: boolean;
    fingerprint: string;
    invalidatedByMaterialChange?: boolean;
  }>;
};

export function emptyMoralConvergenceState(): MoralConvergenceState {
  return {
    phase: "reasoning",
    ready: {},
    convergenceAttempts: 0,
    convergenceResets: 0,
    graphStateTransitionCount: 0,
    materialGraphChangeTurns: [],
    readinessByTurn: [],
  };
}

export function reduceMoralConvergence(
  state: MoralConvergenceState,
  args: {
    turn: number;
    speaker: AgentId;
    fingerprint: string;
    materialChange: boolean;
    readyToFinalize: boolean;
  },
): {
  state: MoralConvergenceState;
  justConverged: boolean;
  readinessInvalidated: boolean;
} {
  const next: MoralConvergenceState = {
    ...state,
    ready: { ...state.ready },
    materialGraphChangeTurns: [...state.materialGraphChangeTurns],
    readinessByTurn: [...state.readinessByTurn],
  };

  let readinessInvalidated = false;

  if (args.materialChange) {
    next.lastMaterialChangeTurn = args.turn;
    next.graphStateTransitionCount += 1;
    next.materialGraphChangeTurns.push(args.turn);
    if (Object.keys(next.ready).length > 0 || next.phase === "finalization") {
      next.convergenceResets += 1;
      readinessInvalidated = true;
    }
    next.ready = {};
    next.phase = "reasoning";
    next.finalizerId = undefined;
    next.convergedFingerprint = undefined;
    next.readinessByTurn.push({
      turn: args.turn,
      agentId: args.speaker,
      ready: false,
      fingerprint: args.fingerprint,
      invalidatedByMaterialChange: true,
    });
    return { state: next, justConverged: false, readinessInvalidated };
  }

  if (args.readyToFinalize) {
    next.convergenceAttempts += 1;
    next.ready[args.speaker] = {
      fingerprint: args.fingerprint,
      turn: args.turn,
    };
    next.readinessByTurn.push({
      turn: args.turn,
      agentId: args.speaker,
      ready: true,
      fingerprint: args.fingerprint,
    });
  } else {
    next.readinessByTurn.push({
      turn: args.turn,
      agentId: args.speaker,
      ready: false,
      fingerprint: args.fingerprint,
    });
  }

  const a = next.ready.agent_a;
  const b = next.ready.agent_b;
  const mutual =
    Boolean(a) &&
    Boolean(b) &&
    a!.fingerprint === args.fingerprint &&
    b!.fingerprint === args.fingerprint;

  let justConverged = false;
  if (mutual && next.phase !== "finalization") {
    next.phase = "finalization";
    next.finalizerId = args.speaker;
    next.convergedFingerprint = args.fingerprint;
    justConverged = true;
  }

  return { state: next, justConverged, readinessInvalidated };
}

export function moralConvergenceEligible(state: MoralConvergenceState): boolean {
  return (
    state.phase === "finalization" &&
    Boolean(state.finalizerId) &&
    Boolean(state.convergedFingerprint)
  );
}
