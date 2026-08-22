/**
 * Unit tests for Hidden Profile graded private-promotion overlap treatment.
 */
import assert from "node:assert/strict";
import {
  assignProblemInformation,
  buildHiddenProfilePromotionSeed,
  buildInformationSplitSeed,
  distinctPromotionLevels,
  promoteCountForOverlap,
  splitHiddenProfileUnits,
} from "../src/information";
import type { InformationUnit } from "../src/information/types";
import type { Problem } from "../src/problems/types";
import { loadHiddenProfileProblems } from "../src/problems/hidden_profile/loadHiddenProfile";
import { selectProblems } from "../src/problems/registry";

function section(name: string) {
  console.log(`\n▸ ${name}`);
}

function syntheticUnits(): InformationUnit[] {
  return [
    { id: "S1", text: "shared-1", visibilityCategory: "shared", originalOwner: "shared", originalVisibility: "shared" },
    { id: "S2", text: "shared-2", visibilityCategory: "shared", originalOwner: "shared", originalVisibility: "shared" },
    { id: "A1", text: "a-1", visibilityCategory: "a_private", originalOwner: "A", originalVisibility: "a_private" },
    { id: "A2", text: "a-2", visibilityCategory: "a_private", originalOwner: "A", originalVisibility: "a_private" },
    { id: "A3", text: "a-3", visibilityCategory: "a_private", originalOwner: "A", originalVisibility: "a_private" },
    { id: "A4", text: "a-4", visibilityCategory: "a_private", originalOwner: "A", originalVisibility: "a_private" },
    { id: "B1", text: "b-1", visibilityCategory: "b_private", originalOwner: "B", originalVisibility: "b_private" },
    { id: "B2", text: "b-2", visibilityCategory: "b_private", originalOwner: "B", originalVisibility: "b_private" },
    { id: "B3", text: "b-3", visibilityCategory: "b_private", originalOwner: "B", originalVisibility: "b_private" },
    { id: "B4", text: "b-4", visibilityCategory: "b_private", originalOwner: "B", originalVisibility: "b_private" },
  ];
}

function syntheticProblem(units: InformationUnit[]): Problem {
  return {
    id: "synthetic_hp",
    title: "Synthetic",
    category: "hidden_profile",
    kind: "hidden_profile",
    text: "Decide among options.",
    hiddenProfile: {
      title: "Synthetic",
      question: "Decide among options.",
      options: ["X", "Y", "Z"],
      goldAnswer: "X",
      information: units.map((u) => ({
        id: u.id,
        text: u.text,
        visibility:
          u.visibilityCategory === "a_private"
            ? ("a_private" as const)
            : u.visibilityCategory === "b_private"
              ? ("b_private" as const)
              : ("shared" as const),
      })),
      evaluatorMetadata: {
        evidenceStructure: "classic_hidden_profile",
        evidenceByOption: {},
        decisiveInformationIds: [],
      },
      source: "diagnostic",
      sourceId: "synthetic_hp",
    },
  };
}

section("promoteCountForOverlap rounding");
{
  assert.equal(promoteCountForOverlap(4, 0), 0);
  assert.equal(promoteCountForOverlap(4, 0.25), 1);
  assert.equal(promoteCountForOverlap(4, 0.5), 2);
  assert.equal(promoteCountForOverlap(4, 0.75), 3);
  assert.equal(promoteCountForOverlap(4, 1), 4);
  assert.equal(promoteCountForOverlap(1, 0.25), 0);
  assert.equal(promoteCountForOverlap(1, 0.5), 1);
  assert.equal(promoteCountForOverlap(3, 0.5), 2);
  assert.equal(promoteCountForOverlap(0, 0.5), 0);
}

section("synthetic nested promotion 4+4");
{
  const units = syntheticUnits();
  const seed = "nest-seed-1";
  const levels = [0, 0.25, 0.5, 0.75, 1] as const;
  const splits = levels.map((o) =>
    splitHiddenProfileUnits({
      units,
      overlapRequested: o,
      packetDirection: "standard",
      promotionSeed: seed,
    }),
  );

  const at0 = splits[0]!;
  assert.deepEqual(at0.sharedIds.sort(), ["S1", "S2"]);
  assert.equal(at0.agentAOnlyIds.length, 4);
  assert.equal(at0.agentBOnlyIds.length, 4);
  assert.equal(at0.overlapRealized, 0);
  assert.equal(at0.treatment.condition, "authored_distributed");

  const at25 = splits[1]!;
  assert.equal(at25.treatment.promotedAtoSharedCount, 1);
  assert.equal(at25.treatment.promotedBtoSharedCount, 1);
  assert.equal(at25.sharedIds.length, 4);
  assert.ok(at25.sharedIds.includes("S1") && at25.sharedIds.includes("S2"));

  const at50 = splits[2]!;
  assert.equal(at50.treatment.promotedAtoSharedCount, 2);
  assert.equal(at50.treatment.promotedBtoSharedCount, 2);
  // Nesting: o=.25 promoted ⊆ o=.50 promoted
  for (const id of at25.treatment.promotedFromAToSharedIds) {
    assert.ok(at50.treatment.promotedFromAToSharedIds.includes(id));
  }
  for (const id of at25.treatment.promotedFromBToSharedIds) {
    assert.ok(at50.treatment.promotedFromBToSharedIds.includes(id));
  }
  for (const id of at50.treatment.promotedFromAToSharedIds) {
    assert.ok(splits[3]!.treatment.promotedFromAToSharedIds.includes(id));
  }
  for (const id of at50.treatment.promotedFromBToSharedIds) {
    assert.ok(splits[3]!.treatment.promotedFromBToSharedIds.includes(id));
  }

  const at1 = splits[4]!;
  assert.equal(at1.agentAOnlyIds.length, 0);
  assert.equal(at1.agentBOnlyIds.length, 0);
  assert.equal(at1.sharedIds.length, 10);
  assert.equal(at1.overlapRealized, 1);
  assert.equal(at1.treatment.condition, "full");

  // Authored shared never demoted
  for (const split of splits) {
    assert.ok(split.sharedIds.includes("S1"));
    assert.ok(split.sharedIds.includes("S2"));
  }
}

section("deterministic replay + different seeds may reorder");
{
  const units = syntheticUnits();
  const a = splitHiddenProfileUnits({
    units,
    overlapRequested: 0.5,
    packetDirection: "standard",
    promotionSeed: "seed-a",
  });
  const b = splitHiddenProfileUnits({
    units,
    overlapRequested: 0.5,
    packetDirection: "standard",
    promotionSeed: "seed-a",
  });
  assert.deepEqual(a.treatment.promotedFromAToSharedIds, b.treatment.promotedFromAToSharedIds);
  assert.deepEqual(a.treatment.promotedFromBToSharedIds, b.treatment.promotedFromBToSharedIds);

  const c = splitHiddenProfileUnits({
    units,
    overlapRequested: 0.5,
    packetDirection: "standard",
    promotionSeed: "seed-b",
  });
  assert.equal(c.treatment.promotedAtoSharedCount, 2);
  assert.equal(c.treatment.promotedBtoSharedCount, 2);
  // Different seed may change which units, but counts match
  const sameOrder =
    JSON.stringify(a.treatment.promotedFromAToSharedIds) ===
    JSON.stringify(c.treatment.promotedFromAToSharedIds);
  // Not required to differ, but usually does; if equal that's ok for this seed pair
  void sameOrder;
}

section("uneven packets + edge sizes");
{
  const cases: Array<{ a: string[]; b: string[] }> = [
    { a: ["A1"], b: ["B1"] },
    { a: ["A1"], b: ["B1", "B2", "B3"] },
    { a: [], b: ["B1", "B2"] },
  ];
  for (const { a, b } of cases) {
    const units: InformationUnit[] = [
      { id: "S1", text: "s", visibilityCategory: "shared" },
      ...a.map((id) => ({
        id,
        text: id,
        visibilityCategory: "a_private" as const,
      })),
      ...b.map((id) => ({
        id,
        text: id,
        visibilityCategory: "b_private" as const,
      })),
    ];
    for (const o of [0, 0.25, 0.5, 0.75, 1]) {
      const split = splitHiddenProfileUnits({
        units,
        overlapRequested: o,
        packetDirection: "standard",
        promotionSeed: `edge|${a.length}|${b.length}`,
      });
      assert.equal(
        split.treatment.promotedAtoSharedCount,
        promoteCountForOverlap(a.length, o),
      );
      assert.equal(
        split.treatment.promotedBtoSharedCount,
        promoteCountForOverlap(b.length, o),
      );
      assert.equal(
        split.sharedIds.length,
        1 +
          split.treatment.promotedAtoSharedCount +
          split.treatment.promotedBtoSharedCount,
      );
    }
  }
}

section("assignProblemInformation stamps provenance + FULL chrome");
{
  const problem = syntheticProblem(syntheticUnits());
  const seed = buildInformationSplitSeed({
    problemId: problem.id,
    overlapRequested: 0.5,
    drawNonce: "assign-test",
    nestAcrossOverlap: true,
  });
  const mid = assignProblemInformation({
    problem,
    overlapRequested: 0.5,
    splitSeed: seed,
    promotionSeed: seed,
  });
  assert.ok(mid.assignment.hiddenProfileTreatment);
  assert.equal(mid.assignment.overlapRealized, 0.5);
  assert.equal(mid.assignment.hiddenProfileTreatment!.promotedAtoSharedCount, 2);
  for (const unit of mid.assignment.units ?? []) {
    assert.ok(unit.originalOwner);
    assert.ok(unit.originalVisibility);
    assert.ok(unit.realizedVisibility);
  }
  // Promoted A unit: original a_private, realized shared
  const promotedId = mid.assignment.promotedFromAToSharedIds![0]!;
  const promotedUnit = mid.assignment.units!.find((u) => u.id === promotedId)!;
  assert.equal(promotedUnit.originalVisibility, "a_private");
  assert.equal(promotedUnit.realizedVisibility, "shared");
  assert.ok(mid.problemTextA.includes(promotedUnit.text));
  assert.ok(mid.problemTextB.includes(promotedUnit.text));
  // Agents must not see treatment metadata
  assert.ok(!mid.problemTextA.includes("privatePromotionRate"));
  assert.ok(!mid.problemTextA.includes("promoted →"));
  assert.ok(!mid.problemTextA.includes("originalOwner"));

  const full = assignProblemInformation({
    problem,
    overlapRequested: 1,
    splitSeed: seed,
    promotionSeed: seed,
  });
  assert.ok(full.problemTextA.includes("FULL INFORMATION"));
  assert.ok(!full.problemTextA.includes("PRIVATE INFORMATION (Agent A only)"));
  assert.ok(!full.problemTextA.includes("(none)"));
}

section("nestAcrossOverlap seed independent of requested o");
{
  const s0 = buildInformationSplitSeed({
    problemId: "p",
    overlapRequested: 0,
    drawNonce: "n",
    nestAcrossOverlap: true,
  });
  const s1 = buildInformationSplitSeed({
    problemId: "p",
    overlapRequested: 1,
    drawNonce: "n",
    nestAcrossOverlap: true,
  });
  assert.equal(s0, s1);
  assert.equal(s0, buildHiddenProfilePromotionSeed({ problemId: "p", drawNonce: "n" }));
}

section("problem sampling is seeded / lockable");
{
  const a = selectProblems("hidden_profile", 10, { seed: "sweep-1" }).map(
    (p) => p.id,
  );
  const b = selectProblems("hidden_profile", 10, { seed: "sweep-1" }).map(
    (p) => p.id,
  );
  const c = selectProblems("hidden_profile", 10, { seed: "sweep-2" }).map(
    (p) => p.id,
  );
  assert.deepEqual(a, b);
  assert.equal(a.length, 10);
  // Different seed should usually differ
  assert.notDeepEqual(a, c);

  const locked = selectProblems("hidden_profile", 99, {
    problemIds: a.slice(0, 3),
  }).map((p) => p.id);
  assert.deepEqual(locked, a.slice(0, 3));
}

section("HiddenBench corpus: discrete promotion granularity");
{
  const problems = loadHiddenProfileProblems();
  const levelCounts = new Map<number, number>();
  let minLevels = Infinity;
  let maxLevels = 0;
  for (const problem of problems) {
    const info = problem.hiddenProfile!.information;
    const a = info.filter((u) => u.visibility === "a_private").length;
    const b = info.filter((u) => u.visibility === "b_private").length;
    const levels = distinctPromotionLevels({
      aPrivateCount: a,
      bPrivateCount: b,
    });
    levelCounts.set(levels.length, (levelCounts.get(levels.length) ?? 0) + 1);
    minLevels = Math.min(minLevels, levels.length);
    maxLevels = Math.max(maxLevels, levels.length);

    // Real corpus: o=0 vs o=0.5 should differ when ≥2 private per side typically
    const seed = buildHiddenProfilePromotionSeed({
      problemId: problem.id,
      drawNonce: "corpus",
    });
    const d0 = assignProblemInformation({
      problem,
      overlapRequested: 0,
      splitSeed: seed,
      promotionSeed: seed,
    });
    const d1 = assignProblemInformation({
      problem,
      overlapRequested: 1,
      splitSeed: seed,
      promotionSeed: seed,
    });
    assert.ok(d0.assignment.agentAOnlyUnitIds.length > 0 || d0.assignment.agentBOnlyUnitIds.length > 0);
    assert.equal(d1.assignment.agentAOnlyUnitIds.length, 0);
    assert.equal(d1.assignment.agentBOnlyUnitIds.length, 0);
  }
  console.log(
    `  distinct realized levels per task: min=${minLevels} max=${maxLevels}`,
  );
  console.log(
    "  histogram:",
    [...levelCounts.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([k, v]) => `${k}levels×${v}`)
      .join(", "),
  );
}

console.log("\nAll Hidden Profile overlap treatment tests passed.");
