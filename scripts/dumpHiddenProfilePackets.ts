/**
 * Dump Agent A/B packets for one HiddenBench task across overlap doses.
 */
import {
  assignProblemInformation,
  buildInformationSplitSeed,
} from "../src/information";
import { loadHiddenProfileProblems } from "../src/problems/hidden_profile/loadHiddenProfile";
import { seedGraphForProblem } from "../src/reasoning";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";

const problem =
  loadHiddenProfileProblems().find((p) =>
    p.id.includes("evacuation_west_city"),
  ) ?? loadHiddenProfileProblems()[0]!;

const seed = buildInformationSplitSeed({
  problemId: problem.id,
  overlapRequested: 0,
  drawNonce: "audit",
  nestAcrossOverlap: true,
});

const seeded = seedGraphForProblem(
  problem,
  taskReasoningAdapterFor(problem),
);

console.log("PROBLEM", problem.id);
console.log("PROVENANCE", problem.hiddenProfile?.hiddenBench);
console.log("EMPTY GRAPH subjects=", seeded.subjects.length);

for (const o of [0, 0.25, 0.5, 0.75, 1]) {
  const assigned = assignProblemInformation({
    problem,
    overlapRequested: o,
    splitSeed: seed,
    promotionSeed: seed,
  });
  const t = assigned.assignment.hiddenProfileTreatment!;
  console.log("\n======== o=" + o + " ========");
  console.log(
    `condition=${t.condition} promotionRate=${t.privatePromotionRate} ` +
      `promoteA=${t.promotedAtoSharedCount}/${t.authoredAPrivateCount} ` +
      `promoteB=${t.promotedBtoSharedCount}/${t.authoredBPrivateCount} ` +
      `shared=${t.realizedSharedCount} aOnly=${t.realizedAPrivateCount} bOnly=${t.realizedBPrivateCount}`,
  );
  console.log("promotedA", t.promotedFromAToSharedIds);
  console.log("promotedB", t.promotedFromBToSharedIds);
  if (o === 0 || o === 1) {
    console.log(assigned.problemTextA.slice(0, 1200));
    console.log("... [truncated] ...");
  }
}
