/**
 * Unit + integration tests for asymmetric information splitting and privacy.
 */
import assert from "node:assert/strict";
import {
  assignProblemInformation,
  buildInformationSplitSeed,
  getInformationUnits,
  getSharedContext,
  segmentMoralInformationUnits,
  splitInformationUnits,
  validateInformationSplit,
} from "../src/information";
import { createCommunicationPolicy } from "../src/communication/policy";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { formatReasoningState } from "../src/reasoning/renderState";
import { applyReasoningMutations, emptyReasoningGraph } from "../src/reasoning";
import { MORAL_PHILOSOPHICAL_PROBLEMS } from "../src/problems/moralPhilosophical";
import { loadCrosswordBenchProblems } from "../src/problems/crossword/loadCrosswordBench";
import { loadHiddenProfileProblems } from "../src/problems/hidden_profile/loadHiddenProfile";
import { buildTurnRequestForAgent } from "../src/runtime/renderModelRequest";

function section(title: string) {
  console.log(`\n== ${title} ==`);
}

function assertUnique(ids: string[]) {
  assert.equal(new Set(ids).size, ids.length, `duplicates in ${ids.join(",")}`);
}

section("splitter invariants across N and overlap");
for (const N of [0, 1, 2, 3, 5, 10, 12]) {
  for (const o of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
    const ids = Array.from({ length: N }, (_, i) => `u${i + 1}`);
    const split = splitInformationUnits({
      unitIds: ids,
      overlap: o,
      seed: `seed|N=${N}|o=${o}`,
    });
    const check = validateInformationSplit(ids, split);
    assert.equal(check.ok, true, check.errors.join("; "));
    assertUnique([
      ...split.sharedIds,
      ...split.agentAOnlyIds,
      ...split.agentBOnlyIds,
    ]);
    assert.equal(split.totalUnits, N);
    if (N > 0) {
      assert.equal(
        new Set([...split.agentAIds, ...split.agentBIds]).size,
        N,
        "union incomplete",
      );
    }
    if (o === 1 && N > 0) {
      assert.equal(split.agentAOnlyIds.length, 0);
      assert.equal(split.agentBOnlyIds.length, 0);
      assert.deepEqual(split.agentAIds, split.sharedIds);
      assert.deepEqual(split.agentBIds, split.sharedIds);
    }
    if (o === 0.5 && N >= 2) {
      assert.equal(split.sharedIds.length, 0);
      assert.equal(
        split.agentAOnlyIds.length + split.agentBOnlyIds.length,
        N,
      );
    }
    if (o < 1 && N >= 2) {
      assert.ok(split.agentAOnlyIds.length >= 1, "A needs private when feasible");
      assert.ok(split.agentBOnlyIds.length >= 1, "B needs private when feasible");
    }
  }
}

section("deterministic under same seed; differs under different seed");
{
  const ids = Array.from({ length: 10 }, (_, i) => `f${i}`);
  const a = splitInformationUnits({
    unitIds: ids,
    overlap: 0.7,
    seed: "same-seed",
  });
  const b = splitInformationUnits({
    unitIds: ids,
    overlap: 0.7,
    seed: "same-seed",
  });
  const c = splitInformationUnits({
    unitIds: ids,
    overlap: 0.7,
    seed: "other-seed",
  });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.agentAOnlyIds, c.agentAOnlyIds);
}

section("policy values do not affect allocation seed");
{
  const problemId = "demo_problem";
  const overlap = 0.7;
  const seedA = buildInformationSplitSeed({
    problemId,
    overlapRequested: overlap,
    drawNonce: "draw-1",
  });
  const seedB = buildInformationSplitSeed({
    problemId,
    overlapRequested: overlap,
    drawNonce: "draw-1",
  });
  assert.equal(seedA, seedB);
  assert.ok(!seedA.includes("trust"));
  assert.ok(!seedA.includes("authority"));
  const ids = Array.from({ length: 10 }, (_, i) => `x${i}`);
  const split1 = splitInformationUnits({
    unitIds: ids,
    overlap,
    seed: seedA,
  });
  // Compile different policies — allocation still identical for same seed.
  buildAgentPromptPair(
    createCommunicationPolicy({ trustA: 0, trustB: 0, authority: 0, familiarity: 0 }),
  );
  buildAgentPromptPair(
    createCommunicationPolicy({ trustA: 1, trustB: 1, authority: 1, familiarity: 1 }),
  );
  const split2 = splitInformationUnits({
    unitIds: ids,
    overlap,
    seed: seedB,
  });
  assert.deepEqual(split1, split2);
}

section("N=12 o=0.7 approximate packet sizes");
{
  const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const split = splitInformationUnits({
    unitIds: ids,
    overlap: 0.7,
    seed: "cw-12",
  });
  assert.equal(split.sharedIds.length + split.agentAOnlyIds.length + split.agentBOnlyIds.length, 12);
  assert.ok(Math.abs(split.agentAIds.length - 8.4) < 2);
  assert.ok(Math.abs(split.agentBIds.length - 8.4) < 2);
  assert.ok(Math.abs(split.overlapRealized - 0.4) < 0.15);
}

section("packetDirection swap remains available on splitter");
{
  const ids = Array.from({ length: 6 }, (_, i) => `p${i}`);
  const standard = splitInformationUnits({
    unitIds: ids,
    overlap: 0.5,
    seed: "cb",
    packetDirection: "standard",
  });
  const swapped = splitInformationUnits({
    unitIds: ids,
    overlap: 0.5,
    seed: "cb",
    packetDirection: "swapped",
  });
  assert.deepEqual(standard.agentAOnlyIds, swapped.agentBOnlyIds);
  assert.deepEqual(standard.agentBOnlyIds, swapped.agentAOnlyIds);
}

section("crossword: private clues absent from partner prompt");
{
  const problems = loadCrosswordBenchProblems();
  const problem = problems[0]!;
  const units = getInformationUnits(problem);
  assert.ok(units.length >= 4, "expected multiple clues");
  const shared = getSharedContext(problem);
  assert.ok(!/ACROSS\n\d+\./.test(shared), "shared context should not list all clue texts as a block");
  for (const clue of problem.crossword!.clues) {
    assert.ok(
      !shared.includes(clue.clue),
      `clue text leaked into shared context: ${clue.clue}`,
    );
  }
  const assigned = assignProblemInformation({
    problem,
    overlapRequested: 0.5,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 0.5,
      drawNonce: "test",
    }),
  });
  for (const id of assigned.assignment.agentAOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(assigned.problemTextA.includes(unit.text));
    assert.ok(!assigned.problemTextB.includes(unit.text));
  }
  for (const id of assigned.assignment.agentBOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(assigned.problemTextB.includes(unit.text));
    assert.ok(!assigned.problemTextA.includes(unit.text));
  }
  const prompts = buildAgentPromptPair(createCommunicationPolicy());
  const reqA = buildTurnRequestForAgent({
    agentId: "agent_a",
    agentPrompts: prompts,
    problemText: assigned.problemTextA,
    utterances: [],
    turn: 1,
    maxTurns: 8,
    reasoningGraph: emptyReasoningGraph(),
  });
  const reqB = buildTurnRequestForAgent({
    agentId: "agent_b",
    agentPrompts: prompts,
    problemText: assigned.problemTextB,
    utterances: [],
    turn: 1,
    maxTurns: 8,
    reasoningGraph: emptyReasoningGraph(),
  });
  const textA = reqA.messages.map((m) => m.content).join("\n");
  const textB = reqB.messages.map((m) => m.content).join("\n");
  for (const id of assigned.assignment.agentAOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(textA.includes(unit.text));
    assert.ok(!textB.includes(unit.text));
  }
}

section("moral: private statements absent from partner prompt; not graph-seeded");
{
  const problem = MORAL_PHILOSOPHICAL_PROBLEMS[0]!;
  const units = getInformationUnits(problem);
  assert.ok(units.length >= 4, `expected segmented facts, got ${units.length}`);
  const assigned = assignProblemInformation({
    problem,
    overlapRequested: 0.7,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 0.7,
      drawNonce: "moral-pair",
    }),
  });
  assert.equal(
    assigned.assignment.sharedUnitIds.length +
      assigned.assignment.agentAOnlyUnitIds.length +
      assigned.assignment.agentBOnlyUnitIds.length,
    assigned.assignment.totalUnits,
  );
  for (const id of assigned.assignment.agentAOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(assigned.problemTextA.includes(`[${id}]`));
    assert.ok(!assigned.problemTextB.includes(unit.text));
  }
  // Empty graph serialization must not contain private facts.
  const memory = formatReasoningState(emptyReasoningGraph());
  for (const unit of units) {
    assert.ok(!memory.includes(unit.text));
  }
  // Same problem + overlap + draw nonce yields identical packets.
  const seed = buildInformationSplitSeed({
    problemId: problem.id,
    overlapRequested: 0.7,
    drawNonce: "moral-pair",
  });
  const again = assignProblemInformation({
    problem,
    overlapRequested: 0.7,
    splitSeed: seed,
  });
  assert.deepEqual(
    assigned.assignment.agentAUnitIds,
    again.assignment.agentAUnitIds,
  );
  assert.deepEqual(
    assigned.assignment.agentBUnitIds,
    again.assignment.agentBUnitIds,
  );
}

section("hidden profile: authored private units absent from partner prompt");
{
  const problem = loadHiddenProfileProblems()[0]!;
  const units = getInformationUnits(problem);
  assert.ok(units.length >= 4, "expected authored hidden-profile units");
  const distributed = assignProblemInformation({
    problem,
    overlapRequested: 0,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 0,
      drawNonce: "hp-distributed",
      nestAcrossOverlap: true,
    }),
  });
  assert.ok(
    distributed.assignment.diagnostics?.warnings.some((w) =>
      w.includes("authored_distributed") || w.includes("AUTHORED DISTRIBUTED"),
    ),
  );
  for (const id of distributed.assignment.agentAOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(distributed.problemTextA.includes(unit.text));
    assert.ok(!distributed.problemTextB.includes(unit.text));
  }
  for (const id of distributed.assignment.agentBOnlyUnitIds) {
    const unit = units.find((u) => u.id === id)!;
    assert.ok(distributed.problemTextB.includes(unit.text));
    assert.ok(!distributed.problemTextA.includes(unit.text));
  }
  assert.ok(!distributed.problemTextA.includes(problem.hiddenProfile!.goldAnswer) ||
    problem.hiddenProfile!.options.some((o) =>
      distributed.problemTextA.includes(o),
    ));
  // Gold must not appear as evaluator metadata dump.
  assert.ok(!distributed.problemTextA.includes("evidenceStructure"));
  assert.ok(!distributed.problemTextB.includes("decisiveInformationIds"));

  const full = assignProblemInformation({
    problem,
    overlapRequested: 1,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 1,
      drawNonce: "hp-full",
    }),
  });
  assert.equal(full.assignment.agentAOnlyUnitIds.length, 0);
  assert.equal(full.assignment.agentBOnlyUnitIds.length, 0);
  for (const unit of units) {
    assert.ok(full.problemTextA.includes(unit.text));
    assert.ok(full.problemTextB.includes(unit.text));
  }
}

section("sourceInformationIds privacy gate");
{
  const graph = emptyReasoningGraph();
  const allowed = new Set(["fact_1"]);
  const rejected = applyReasoningMutations(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:autonomy",
        content: "Autonomy matters.",
        sourceInformationIds: ["fact_secret"],
      },
    ],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg_1",
      allowedSourceInformationIds: allowed,
    },
  );
  assert.equal(rejected.events[0]?.accepted, false);
  const accepted = applyReasoningMutations(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:autonomy",
        content: "Autonomy matters.",
        sourceInformationIds: ["fact_1"],
        basis: [],
      },
    ],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg_2",
      allowedSourceInformationIds: allowed,
    },
  );
  assert.equal(accepted.events[0]?.accepted, true);
  assert.deepEqual(accepted.events[0]?.sourceInformationIds, ["fact_1"]);
  const memory = formatReasoningState(accepted.graph);
  assert.ok(!memory.includes("fact_1"), "private evidence ids must not appear in shared graph serialization");
}

section("moral segmentation is deterministic");
{
  const text =
    "The teacher personally witnessed one incident involving the student. " +
    "The student had already asked the classmate to stop three times before reporting it. " +
    "Institutional policy requires staff intervention when repeated harassment is documented.";
  const a = segmentMoralInformationUnits(text, { idPrefix: "fact" });
  const b = segmentMoralInformationUnits(text, { idPrefix: "fact" });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 2);
}

section("run config default preserves full overlap");
{
  assert.equal(DEFAULT_RUN_CONFIG.informationOverlap, 1);
}

console.log("\nAll asymmetric-information tests passed.");
