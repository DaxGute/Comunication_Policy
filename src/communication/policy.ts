import type { CommunicationPolicy } from "./types";

export const DEFAULT_COMMUNICATION_POLICY: CommunicationPolicy = {
  trustA: 0.5,
  trustB: 0.5,
  authority: 0.5,
  familiarity: 0.5,
};

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function createCommunicationPolicy(
  partial: Partial<CommunicationPolicy> = {},
): CommunicationPolicy {
  return {
    trustA: clamp01(partial.trustA ?? DEFAULT_COMMUNICATION_POLICY.trustA),
    trustB: clamp01(partial.trustB ?? DEFAULT_COMMUNICATION_POLICY.trustB),
    authority: clamp01(
      partial.authority ?? DEFAULT_COMMUNICATION_POLICY.authority,
    ),
    familiarity: clamp01(
      partial.familiarity ?? DEFAULT_COMMUNICATION_POLICY.familiarity,
    ),
  };
}

export function assertValidPolicy(policy: CommunicationPolicy): void {
  for (const key of ["trustA", "trustB", "authority", "familiarity"] as const) {
    const value = policy[key];
    if (typeof value !== "number" || value < 0 || value > 1) {
      throw new Error(
        `CommunicationPolicy.${key} must be in [0, 1], got ${String(value)}`,
      );
    }
  }
}

export function formatPolicyValue(value: number): string {
  return value.toFixed(2);
}

/** Authority weight held by Agent A along the split continuum. */
export function authorityWeightA(authority: number): number {
  return clamp01(1 - authority);
}

/** Authority weight held by Agent B along the split continuum. */
export function authorityWeightB(authority: number): number {
  return clamp01(authority);
}
