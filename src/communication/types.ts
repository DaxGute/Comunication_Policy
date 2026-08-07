/**
 * Canonical communication-policy domain object.
 * All UI, runtime, and evaluation code consume this representation.
 */
export type CommunicationPolicy = {
  /**
   * How much Agent A trusts Agent B.
   * 0 = low trust / independent verification; 1 = high trust / collaborative synthesis
   */
  trustA: number;
  /**
   * How much Agent B trusts Agent A.
   * 0 = low trust / independent verification; 1 = high trust / collaborative synthesis
   */
  trustB: number;
  /**
   * Directional authority (split continuum).
   * 0.0 = Agent A has strong authority over Agent B
   * 0.5 = symmetric / peer-to-peer
   * 1.0 = Agent B has strong authority over Agent A
   */
  authority: number;
  /** 0 = strangers (explicit, formal); 1 = long-term collaborators (compressed) */
  familiarity: number;
};

export type PolicyBand = "low" | "moderate" | "high";

export type AuthorityRelation =
  | "a_over_b"
  | "symmetric"
  | "b_over_a";

/** Compiled natural-language instructions derived from a CommunicationPolicy. */
export type CompiledCommunicationPolicy = {
  policy: CommunicationPolicy;
  trustBandA: PolicyBand;
  trustBandB: PolicyBand;
  familiarityBand: PolicyBand;
  authorityRelation: AuthorityRelation;
  /** Shared framing both agents receive about the policy. */
  sharedContext: string;
  /** Agent-specific interpersonal instructions. */
  agentA: string;
  agentB: string;
};
