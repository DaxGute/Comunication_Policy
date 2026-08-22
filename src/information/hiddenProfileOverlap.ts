/**
 * Hidden Profile / HiddenBench information-overlap treatment.
 *
 * o = 0 → authored distributed profile (benchmark private packets intact)
 * o = 1 → full information (all units shared)
 * Intermediate o → stratified, nested promotion of originally-private units
 * into shared. Authored shared units always remain shared.
 *
 * Realized dose = privatePromotionRate =
 *   (# originally-private units now shared) / (# originally-private units)
 */

import {
  seededShuffle,
} from "./split";
import type {
  HiddenProfileOverlapTreatment,
  InformationPacketDirection,
  InformationSplitResult,
  InformationUnit,
} from "./types";

export const MIN_HIDDEN_PROFILE_OVERLAP = 0;
export const MAX_HIDDEN_PROFILE_OVERLAP = 1;

/** Discrete UI snaps for Hidden Profile (matches dose examples). */
export const HIDDEN_PROFILE_OVERLAP_STEPS = [
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65,
  0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0,
] as const;

export function clampHiddenProfileOverlap(overlap: number): number {
  if (!Number.isFinite(overlap)) return MAX_HIDDEN_PROFILE_OVERLAP;
  return Math.min(
    MAX_HIDDEN_PROFILE_OVERLAP,
    Math.max(MIN_HIDDEN_PROFILE_OVERLAP, overlap),
  );
}

export function snapHiddenProfileOverlap(
  overlap: number,
  steps: readonly number[] = HIDDEN_PROFILE_OVERLAP_STEPS,
): number {
  const clamped = clampHiddenProfileOverlap(overlap);
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

/**
 * Promotion order seed: independent of overlap so treatments nest.
 * Policy values must never enter this string.
 */
export function buildHiddenProfilePromotionSeed(args: {
  problemId: string;
  drawNonce: string;
}): string {
  const nonce = args.drawNonce.trim() || "draw";
  return `hp-promote|${args.problemId}|draw=${nonce}`;
}

/** How many private units to promote at requested overlap (per owner). */
export function promoteCountForOverlap(
  privateCount: number,
  overlapRequested: number,
): number {
  const o = clampHiddenProfileOverlap(overlapRequested);
  if (privateCount <= 0) return 0;
  if (o >= 0.999) return privateCount;
  if (o <= 0) return 0;
  return Math.min(privateCount, Math.max(0, Math.round(o * privateCount)));
}

export type HiddenProfileSplitResult = InformationSplitResult & {
  treatment: HiddenProfileOverlapTreatment;
};

/**
 * Stratified nested private→shared promotion for authored Hidden Profile units.
 */
export function splitHiddenProfileUnits(args: {
  units: readonly InformationUnit[];
  overlapRequested: number;
  packetDirection: InformationPacketDirection;
  /** Nesting-stable seed (must not encode overlap). */
  promotionSeed: string;
}): HiddenProfileSplitResult {
  const overlapRequested = clampHiddenProfileOverlap(args.overlapRequested);
  const allIds = args.units.map((unit) => unit.id);

  let authoredSharedIds = args.units
    .filter((unit) => unit.visibilityCategory === "shared")
    .map((unit) => unit.id);
  let authoredAPrivateIds = args.units
    .filter((unit) => unit.visibilityCategory === "a_private")
    .map((unit) => unit.id);
  let authoredBPrivateIds = args.units
    .filter((unit) => unit.visibilityCategory === "b_private")
    .map((unit) => unit.id);

  if (args.packetDirection === "swapped") {
    const tmp = authoredAPrivateIds;
    authoredAPrivateIds = authoredBPrivateIds;
    authoredBPrivateIds = tmp;
  }

  const orderA = seededShuffle(authoredAPrivateIds, `${args.promotionSeed}|A`);
  const orderB = seededShuffle(authoredBPrivateIds, `${args.promotionSeed}|B`);

  const promoteA = promoteCountForOverlap(orderA.length, overlapRequested);
  const promoteB = promoteCountForOverlap(orderB.length, overlapRequested);

  const promotedFromAToSharedIds = orderA.slice(0, promoteA);
  const promotedFromBToSharedIds = orderB.slice(0, promoteB);
  const realizedAPrivateIds = orderA.slice(promoteA);
  const realizedBPrivateIds = orderB.slice(promoteB);

  const sharedIds = [
    ...authoredSharedIds,
    ...promotedFromAToSharedIds,
    ...promotedFromBToSharedIds,
  ];

  const originallyPrivate =
    authoredAPrivateIds.length + authoredBPrivateIds.length;
  const promotedCount =
    promotedFromAToSharedIds.length + promotedFromBToSharedIds.length;
  const privatePromotionRate =
    originallyPrivate === 0
      ? 1
      : Number((promotedCount / originallyPrivate).toFixed(4));

  let condition: HiddenProfileOverlapTreatment["condition"];
  if (realizedAPrivateIds.length === 0 && realizedBPrivateIds.length === 0) {
    condition = "full";
  } else if (promotedCount === 0) {
    condition = "authored_distributed";
  } else {
    condition = "partial_promotion";
  }

  const treatment: HiddenProfileOverlapTreatment = {
    privatePromotionRate,
    originalSharedIds: [...authoredSharedIds],
    originalAPrivateIds: [...authoredAPrivateIds],
    originalBPrivateIds: [...authoredBPrivateIds],
    promotedFromAToSharedIds: [...promotedFromAToSharedIds],
    promotedFromBToSharedIds: [...promotedFromBToSharedIds],
    realizedSharedIds: [...sharedIds],
    realizedAPrivateIds: [...realizedAPrivateIds],
    realizedBPrivateIds: [...realizedBPrivateIds],
    authoredSharedCount: authoredSharedIds.length,
    authoredAPrivateCount: authoredAPrivateIds.length,
    authoredBPrivateCount: authoredBPrivateIds.length,
    promotedAtoSharedCount: promotedFromAToSharedIds.length,
    promotedBtoSharedCount: promotedFromBToSharedIds.length,
    realizedSharedCount: sharedIds.length,
    realizedAPrivateCount: realizedAPrivateIds.length,
    realizedBPrivateCount: realizedBPrivateIds.length,
    condition,
  };

  return {
    sharedIds,
    agentAOnlyIds: realizedAPrivateIds,
    agentBOnlyIds: realizedBPrivateIds,
    agentAIds: [...sharedIds, ...realizedAPrivateIds],
    agentBIds: [...sharedIds, ...realizedBPrivateIds],
    overlapRequested,
    overlapRealized: privatePromotionRate,
    totalUnits: allIds.length,
    treatment,
  };
}

/** Distinct realized promotion (A-count, B-count) pairs supportable by packet sizes. */
export function distinctPromotionLevels(args: {
  aPrivateCount: number;
  bPrivateCount: number;
}): Array<{ overlap: number; promoteA: number; promoteB: number }> {
  const seen = new Set<string>();
  const levels: Array<{
    overlap: number;
    promoteA: number;
    promoteB: number;
  }> = [];
  for (const o of HIDDEN_PROFILE_OVERLAP_STEPS) {
    const promoteA = promoteCountForOverlap(args.aPrivateCount, o);
    const promoteB = promoteCountForOverlap(args.bPrivateCount, o);
    const key = `${promoteA}:${promoteB}`;
    if (seen.has(key)) continue;
    seen.add(key);
    levels.push({ overlap: o, promoteA, promoteB });
  }
  return levels;
}
