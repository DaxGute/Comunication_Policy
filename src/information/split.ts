/**
 * Deterministic information-unit partitioner.
 *
 * Rounding policy (documented, fixed):
 * 1. Clamp overlap o to [0.5, 1.0].
 * 2. shared = round((2o − 1) · N), clamped to [0, N].
 * 3. When o < 1 and N ≥ 2, ensure at least one private unit per agent when
 *    feasible: if remaining after shared is < 2, reduce shared until
 *    remaining ≥ 2 (or shared = 0).
 * 4. Split the remaining N − shared units as evenly as possible into A-only
 *    and B-only. When the remainder is odd, the extra private unit goes to A
 *    under packetDirection "standard", or to B under "swapped" (before the
 *    optional full packet swap).
 * 5. Unit order is a seeded shuffle of the input ids (stable under the same
 *    seed). Communication-policy values must never enter the seed.
 *
 * Invariants: A ∪ B = all units; A ∩ B = shared; A-only ∩ B-only = ∅;
 * no duplicates; |A ∪ B| coverage = 100%.
 */

import type {
  InformationPacketDirection,
  InformationSplitResult,
} from "./types";

export const MIN_INFORMATION_OVERLAP = 0.5;
export const MAX_INFORMATION_OVERLAP = 1.0;

/** Mulberry32 — small deterministic PRNG from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of an arbitrary string (for split seeds). */
export function hashStringToSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function clampInformationOverlap(overlap: number): number {
  if (!Number.isFinite(overlap)) return MAX_INFORMATION_OVERLAP;
  return Math.min(
    MAX_INFORMATION_OVERLAP,
    Math.max(MIN_INFORMATION_OVERLAP, overlap),
  );
}

/** Snap UI/continuous values onto the discrete grid (nearest). */
export function snapInformationOverlap(
  overlap: number,
  steps: readonly number[] = [
    0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0,
  ],
): number {
  const clamped = clampInformationOverlap(overlap);
  let best = steps[0]!;
  let bestDist = Math.abs(best - clamped);
  for (const step of steps) {
    const dist = Math.abs(step - clamped);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

/** Deterministic Fisher–Yates shuffle (stable under the same seed string). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashStringToSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export type SplitInformationUnitsArgs = {
  unitIds: readonly string[];
  overlap: number;
  /** problemId + overlap + experiment pairing seed (never policy). */
  seed: string;
  packetDirection?: InformationPacketDirection;
};

/**
 * Partition unit ids so each agent receives ~oN units, union covers all,
 * and shared ≈ (2o − 1)N.
 */
export function splitInformationUnits(
  args: SplitInformationUnitsArgs,
): InformationSplitResult {
  const overlapRequested = clampInformationOverlap(args.overlap);
  const uniqueIds = [...new Set(args.unitIds.map((id) => id.trim()).filter(Boolean))];
  const N = uniqueIds.length;
  const direction = args.packetDirection ?? "standard";

  if (N === 0) {
    return {
      sharedIds: [],
      agentAOnlyIds: [],
      agentBOnlyIds: [],
      agentAIds: [],
      agentBIds: [],
      overlapRequested,
      overlapRealized: 1,
      totalUnits: 0,
    };
  }

  const ordered = seededShuffle(uniqueIds, args.seed);

  if (overlapRequested >= 1 || N === 1) {
    // Full overlap (or single unit): both agents see everything.
    const all = [...ordered];
    return {
      sharedIds: all,
      agentAOnlyIds: [],
      agentBOnlyIds: [],
      agentAIds: all,
      agentBIds: all,
      overlapRequested,
      overlapRealized: 1,
      totalUnits: N,
    };
  }

  let sharedCount = Math.round((2 * overlapRequested - 1) * N);
  sharedCount = Math.min(N, Math.max(0, sharedCount));

  // Preserve at least one private clue/fact per agent when asymmetry < 1 and N≥2.
  if (N >= 2 && N - sharedCount < 2) {
    sharedCount = Math.max(0, N - 2);
  }

  const remaining = N - sharedCount;
  // Odd remainder: A receives the extra private unit under "standard";
  // "swapped" exchanges the private packets afterward so B receives it.
  const aOnlyCount = Math.ceil(remaining / 2);
  const bOnlyCount = remaining - aOnlyCount;

  const sharedIds = ordered.slice(0, sharedCount);
  let agentAOnlyIds = ordered.slice(sharedCount, sharedCount + aOnlyCount);
  let agentBOnlyIds = ordered.slice(
    sharedCount + aOnlyCount,
    sharedCount + aOnlyCount + bOnlyCount,
  );

  if (direction === "swapped") {
    const tmp = agentAOnlyIds;
    agentAOnlyIds = agentBOnlyIds;
    agentBOnlyIds = tmp;
  }

  const agentAIds = [...sharedIds, ...agentAOnlyIds];
  const agentBIds = [...sharedIds, ...agentBOnlyIds];
  const overlapRealized = sharedIds.length / N;

  return {
    sharedIds,
    agentAOnlyIds,
    agentBOnlyIds,
    agentAIds,
    agentBIds,
    overlapRequested,
    overlapRealized,
    totalUnits: N,
  };
}

export function validateInformationSplit(
  unitIds: readonly string[],
  split: InformationSplitResult,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = new Set(unitIds);
  const shared = new Set(split.sharedIds);
  const aOnly = new Set(split.agentAOnlyIds);
  const bOnly = new Set(split.agentBOnlyIds);
  const a = new Set(split.agentAIds);
  const b = new Set(split.agentBIds);

  for (const id of all) {
    const inA = a.has(id);
    const inB = b.has(id);
    if (!inA && !inB) {
      errors.push(`unit ${id} missing from both packets (union incomplete)`);
    }
  }

  for (const id of a) {
    if (!all.has(id)) errors.push(`agent A packet contains unknown id ${id}`);
  }
  for (const id of b) {
    if (!all.has(id)) errors.push(`agent B packet contains unknown id ${id}`);
  }

  for (const id of shared) {
    if (!a.has(id) || !b.has(id)) {
      errors.push(`shared id ${id} not present in both agent packets`);
    }
    if (aOnly.has(id) || bOnly.has(id)) {
      errors.push(`shared id ${id} also listed as private`);
    }
  }

  for (const id of aOnly) {
    if (bOnly.has(id)) errors.push(`id ${id} in both A-only and B-only`);
    if (b.has(id) && !shared.has(id)) {
      errors.push(`A-only id ${id} also appears in B packet`);
    }
  }
  for (const id of bOnly) {
    if (a.has(id) && !shared.has(id)) {
      errors.push(`B-only id ${id} also appears in A packet`);
    }
  }

  const seen = new Set<string>();
  for (const list of [split.sharedIds, split.agentAOnlyIds, split.agentBOnlyIds]) {
    for (const id of list) {
      if (seen.has(id)) errors.push(`duplicate partition id ${id}`);
      seen.add(id);
    }
  }

  if (split.overlapRequested < 1 && all.size >= 2) {
    if (split.agentAOnlyIds.length === 0) {
      warnings.push("asymmetry requested but agent A has no private units");
    }
    if (split.agentBOnlyIds.length === 0) {
      warnings.push("asymmetry requested but agent B has no private units");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
