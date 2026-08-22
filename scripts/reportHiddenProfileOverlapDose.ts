/**
 * Assignment-only paired dose-response check (no LLM).
 * Samples 10 HiddenBench IDs once, then prints treatment tables for
 * o ∈ {0, .25, .50, .75, 1} and flags discrete collisions.
 *
 * Usage:
 *   vite-node scripts/reportHiddenProfileOverlapDose.ts [sampleSeed]
 */
import {
  assignProblemInformation,
  buildInformationSplitSeed,
  distinctPromotionLevels,
} from "../src/information";
import { selectProblems } from "../src/problems/registry";

const sampleSeed = process.argv[2]?.trim() || "hp-dose-report";
const overlaps = [0, 0.25, 0.5, 0.75, 1] as const;
const problems = selectProblems("hidden_profile", 10, { seed: sampleSeed });

console.log(`sampleSeed=${sampleSeed}`);
console.log(`problems=${problems.map((p) => p.id).join(", ")}`);
console.log("");

type Row = {
  problem: string;
  o: number;
  promotionRate: number;
  aRemain: number;
  bRemain: number;
  promoteA: string;
  promoteB: string;
  partitionKey: string;
  sameAsPrev: boolean;
};

const rows: Row[] = [];

for (const problem of problems) {
  const info = problem.hiddenProfile!.information;
  const aN = info.filter((u) => u.visibility === "a_private").length;
  const bN = info.filter((u) => u.visibility === "b_private").length;
  const levels = distinctPromotionLevels({
    aPrivateCount: aN,
    bPrivateCount: bN,
  });
  console.log(
    `${problem.id} authored private A=${aN} B=${bN} · distinct levels=${levels.length} ` +
      `(${levels.map((l) => `o≈${l.overlap}->A${l.promoteA}/B${l.promoteB}`).join("; ")})`,
  );

  const promoSeed = buildInformationSplitSeed({
    problemId: problem.id,
    overlapRequested: 0,
    drawNonce: sampleSeed,
    nestAcrossOverlap: true,
  });

  let prevKey = "";
  for (const o of overlaps) {
    const assigned = assignProblemInformation({
      problem,
      overlapRequested: o,
      splitSeed: promoSeed,
      promotionSeed: promoSeed,
    });
    const t = assigned.assignment.hiddenProfileTreatment!;
    const partitionKey = [
      ...t.realizedSharedIds,
    ].sort().join(",") +
      "|A:" +
      [...t.realizedAPrivateIds].sort().join(",") +
      "|B:" +
      [...t.realizedBPrivateIds].sort().join(",");
    const sameAsPrev = partitionKey === prevKey && prevKey !== "";
    rows.push({
      problem: problem.id,
      o,
      promotionRate: t.privatePromotionRate,
      aRemain: t.realizedAPrivateCount,
      bRemain: t.realizedBPrivateCount,
      promoteA: `${t.promotedAtoSharedCount}/${t.authoredAPrivateCount}`,
      promoteB: `${t.promotedBtoSharedCount}/${t.authoredBPrivateCount}`,
      partitionKey,
      sameAsPrev,
    });
    if (sameAsPrev) {
      console.log(
        `  o=${o}: SAME realized partition as previous requested level (discrete evidence count)`,
      );
    } else {
      console.log(
        `  o=${o}: rate=${t.privatePromotionRate} promote A ${t.promotedAtoSharedCount}/${t.authoredAPrivateCount} ` +
          `B ${t.promotedBtoSharedCount}/${t.authoredBPrivateCount} remain A=${t.realizedAPrivateCount} B=${t.realizedBPrivateCount}`,
      );
    }
    prevKey = partitionKey;
  }
  console.log("");
}

console.log("CSV");
console.log(
  "problem,requested_overlap,private_promotion_rate,promote_A,promote_B,A_private_remaining,B_private_remaining,same_as_prev",
);
for (const r of rows) {
  console.log(
    [
      r.problem,
      r.o,
      r.promotionRate,
      r.promoteA,
      r.promoteB,
      r.aRemain,
      r.bRemain,
      r.sameAsPrev,
    ].join(","),
  );
}
