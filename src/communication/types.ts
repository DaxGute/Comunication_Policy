/**
 * Canonical communication-policy domain object.
 * All UI, runtime, and evaluation code consume this representation.
 *
 * Numeric values are experimental metadata. Agents never see them —
 * only the compiled natural-language behavioral policy.
 */
export type CommunicationPolicy = {
  /**
   * T_AB: how much Agent A trusts Agent B.
   * 0 = treat partner claims as unreliable until independently supported;
   * 1 = give substantial weight to partner claims.
   */
  trustA: number;
  /**
   * T_BA: how much Agent B trusts Agent A.
   * Independent of trustA.
   */
  trustB: number;
  /**
   * Relational authority a ∈ [0, 1].
   * Authority_A = 1 − a, Authority_B = a.
   * 0.0 = A has decision primacy; 0.5 = equal standing; 1.0 = B has primacy.
   */
  authority: number;
  /**
   * Shared familiarity F ∈ [0, 1]. Symmetric: both agents receive
   * complementary wording of the same condition.
   * 0 = little shared conversational context; 1 = strong shared context / shorthand.
   */
  familiarity: number;
};

/**
 * Discrete behavioral anchor compiled from a continuous [0, 1] slider.
 * Mapping: [0, 1/3) → low (0.0), [1/3, 2/3) → moderate (0.5), [2/3, 1] → high (1.0).
 */
export type PolicyBand = "low" | "moderate" | "high";

export type AuthorityRelation =
  | "a_over_b"
  | "symmetric"
  | "b_over_a";

/** One agent's compiled Trust / Authority / Familiarity instructions. */
export type CompiledAgentPolicy = {
  trust: string;
  authority: string;
  familiarity: string;
  /** Deterministic concatenation of the three sections. */
  block: string;
};

/** Compiled natural-language instructions derived from a CommunicationPolicy. */
export type CompiledCommunicationPolicy = {
  policy: CommunicationPolicy;
  trustBandA: PolicyBand;
  trustBandB: PolicyBand;
  familiarityBand: PolicyBand;
  authorityRelation: AuthorityRelation;
  agentA: CompiledAgentPolicy;
  agentB: CompiledAgentPolicy;
};
