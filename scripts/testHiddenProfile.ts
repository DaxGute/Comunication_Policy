/**
 * Smoke tests for HiddenBench Hidden Profile pool, grader, FULL vs DISTRIBUTED,
 * endogenous finalization, and information-flow / evidence-quality metrics.
 */
import assert from "node:assert/strict";
import { gradeHiddenProfileDecision } from "../src/evaluation/graders/hiddenProfileGrader";
import { evaluateProblem } from "../src/evaluation/evaluators";
import { computeHiddenProfileEvidenceQualityMetrics } from "../src/evaluation/hiddenProfile/evidenceQuality";
import {
  assignProblemInformation,
  buildInformationSplitSeed,
  buildPrivateInformationFlowTable,
  computeInformationFlowMetrics,
} from "../src/information";
import {
  getHiddenBenchTasks,
  getHiddenProfileSourceMeta,
  loadDiagnosticHiddenProfileItems,
  loadHiddenProfileItems,
  loadHiddenProfileProblems,
} from "../src/problems/hidden_profile/loadHiddenProfile";
import { partitionHiddenFactsForDyad } from "../src/problems/hidden_profile/adaptHiddenBench";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import { PROBLEM_CATEGORIES, getProblemsForCategory } from "../src/problems/registry";
import { evaluateMoralFinalization } from "../src/reasoning/finalizationGate";
import { seedGraphForProblem } from "../src/reasoning";
import type { ProblemConversation } from "../src/experiment/types";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import { createCommunicationPolicy } from "../src/communication/policy";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { runProblem } from "../src/runtime/runProblem";
import { MockModelClient } from "../src/runtime/mockModelClient";
import { MOCK_MODEL_ID } from "../src/runtime/models";

const meta = getHiddenProfileSourceMeta();
assert.equal(meta.name, "HiddenBench");
assert.equal(meta.count, 65);
assert.ok(meta.github.includes("HiddenBench_ICML"));

const rawTasks = getHiddenBenchTasks();
assert.equal(rawTasks.length, 65);

const items = loadHiddenProfileItems();
assert.equal(items.length, 65);
assert.ok(
  items.every((item) =>
    item.evaluatorMetadata.evidenceStructure === "classic_hidden_profile",
  ),
);

const pool = getProblemsForCategory("hidden_profile");
assert.equal(pool.length, 65, "UI pool must be full HiddenBench, not diagnostic");

const diagnostic = loadDiagnosticHiddenProfileItems();
assert.equal(diagnostic.length, 4, "diagnostic remains available but separate");

assert.ok(
  PROBLEM_CATEGORIES.some((c) => c.id === "hidden_profile"),
  "registry must list Hidden Profile",
);
assert.ok(
  !PROBLEM_CATEGORIES.some((c) => (c.id as string) === "proof"),
  "Proof must not remain an active family",
);

{
  const { aPrivate, bPrivate } = partitionHiddenFactsForDyad([
    "h0",
    "h1",
    "h2",
    "h3",
  ]);
  assert.deepEqual(aPrivate, ["h0", "h2"]);
  assert.deepEqual(bPrivate, ["h1", "h3"]);
}

const problems = loadHiddenProfileProblems();
assert.equal(problems.length, 65);
assert.equal(problems[0]?.category, "hidden_profile");
assert.equal(problems[0]?.kind, "hidden_profile");
assert.ok(problems[0]?.hiddenProfile?.goldAnswer);
assert.equal(problems[0]?.hiddenProfile?.source, "hiddenbench");
assert.ok(problems[0]?.hiddenProfile?.hiddenBench?.sourceTaskId);
assert.equal(
  problems[0]?.hiddenProfile?.hiddenBench?.dataset,
  "HiddenBench",
);

for (const problem of problems) {
  const seeded = seedGraphForProblem(problem, taskReasoningAdapterFor(problem));
  assert.equal(seeded.subjects.length, 0, `${problem.id} must start empty`);

  const text = problem.text;
  assert.ok(!text.includes("evidenceStructure"));
  assert.ok(!text.includes("decisiveInformationIds"));
  assert.ok(!text.includes("evaluatorMetadata"));
  assert.ok(!/gold\s*answer/i.test(text));
  assert.ok(!text.includes("classic_hidden_profile"));
  assert.ok(!text.includes("dyadicPartition"));
  assert.ok(
    !text.includes("Official rationale"),
    `${problem.id} must not leak rationale into agent text`,
  );

  const hb = problem.hiddenProfile!.hiddenBench!;
  assert.equal(hb.dataset, "HiddenBench");
  assert.ok(hb.sourceTaskId >= 1 && hb.sourceTaskId <= 65);
  assert.ok(hb.sourceAgentCount === 3 || hb.sourceAgentCount === 4);

  const distributed = assignProblemInformation({
    problem,
    overlapRequested: 0,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 0,
      drawNonce: "hb",
      nestAcrossOverlap: true,
    }),
  });
  assert.ok(distributed.assignment.agentAOnlyUnitIds.length > 0);
  assert.ok(distributed.assignment.agentBOnlyUnitIds.length > 0);
  // Union preserves every official private fact at authored distributed.
  assert.equal(
    distributed.assignment.agentAOnlyUnitIds.length +
      distributed.assignment.agentBOnlyUnitIds.length,
    hb.sourceAgentCount,
  );
  for (const id of distributed.assignment.agentAOnlyUnitIds) {
    assert.ok(distributed.problemTextA.includes(`[${id}]`));
    assert.ok(!distributed.problemTextB.includes(`[${id}]`));
  }
  for (const id of distributed.assignment.agentBOnlyUnitIds) {
    assert.ok(distributed.problemTextB.includes(`[${id}]`));
    assert.ok(!distributed.problemTextA.includes(`[${id}]`));
  }

  const full = assignProblemInformation({
    problem,
    overlapRequested: 1,
    splitSeed: buildInformationSplitSeed({
      problemId: problem.id,
      overlapRequested: 1,
      drawNonce: "hb-full",
      nestAcrossOverlap: true,
    }),
  });
  assert.equal(full.assignment.agentAOnlyUnitIds.length, 0);
  assert.equal(full.assignment.agentBOnlyUnitIds.length, 0);
  assert.ok(full.problemTextA.includes("FULL INFORMATION"));
  for (const unit of problem.hiddenProfile!.information) {
    assert.ok(full.problemTextA.includes(`[${unit.id}]`));
    assert.ok(full.problemTextB.includes(`[${unit.id}]`));
  }

  // Graded promotion: intermediate o promotes some private units.
  const midSeed = buildInformationSplitSeed({
    problemId: problem.id,
    overlapRequested: 0.5,
    drawNonce: "hb-mid",
    nestAcrossOverlap: true,
  });
  const mid = assignProblemInformation({
    problem,
    overlapRequested: 0.5,
    splitSeed: midSeed,
    promotionSeed: midSeed,
  });
  const t = mid.assignment.hiddenProfileTreatment!;
  assert.ok(t.privatePromotionRate > 0 || t.authoredAPrivateCount + t.authoredBPrivateCount === 0);
  assert.ok(t.realizedSharedCount >= t.authoredSharedCount);
  // Nesting vs authored distributed
  for (const id of distributed.assignment.sharedUnitIds) {
    assert.ok(mid.assignment.sharedUnitIds.includes(id));
  }
  for (const id of mid.assignment.sharedUnitIds) {
    assert.ok(full.assignment.sharedUnitIds.includes(id));
  }
}

{
  const grade = gradeHiddenProfileDecision({
    predicted: "West City",
    goldAnswer: "West City",
    options: ["West City", "East Town", "North Hill"],
  });
  assert.equal(grade.label, "correct");
  assert.equal(grade.correct, true);
}

{
  const problem = problems[0]!;
  const conversation: ProblemConversation = {
    problemId: problem.id,
    problemTitle: problem.title,
    problemText: problem.text,
    messages: [
      {
        id: "m1",
        agentId: "agent_a",
        role: "assistant",
        content: `Considering options.\nFINAL_ANSWER: ${problem.hiddenProfile!.goldAnswer}`,
        turnIndex: 1,
      },
    ],
    finalAnswer: problem.hiddenProfile!.goldAnswer,
    stoppedReason: "final_answer",
  };
  const evaluation = evaluateProblem("hidden_profile", conversation, problem);
  assert.equal(evaluation.label, "correct");
  assert.equal(evaluation.score, 1);
  assert.equal(evaluation.details?.grader, "hidden_profile");
}

{
  const gate = evaluateMoralFinalization({
    category: "hidden_profile",
    turn: 1,
    speaker: "agent_a",
    graph: { subjects: [], versions: [], events: [] },
    messages: [],
    extractedFinalAnswer: "West City",
  });
  assert.equal(gate.ok, false);
  if (!gate.ok) assert.equal(gate.kind, "partner_must_speak");
}

{
  const problem = problems[0]!;
  const conversation: ProblemConversation = {
    problemId: problem.id,
    problemTitle: problem.title,
    problemText: problem.text,
    messages: [],
    finalAnswer: problem.hiddenProfile!.goldAnswer,
    reasoningVersions: [
      {
        id: "pv-1",
        subjectId: "decision:leading_option",
        content: `Prefer ${problem.hiddenProfile!.goldAnswer}.`,
        agentId: "agent_b",
        turn: 2,
        sourceUtteranceTurn: 2,
        status: "active",
      },
    ],
    reasoningEvents: [],
  };
  const eq = computeHiddenProfileEvidenceQualityMetrics(
    conversation,
    problem.hiddenProfile!,
  );
  assert.equal(typeof eq.finalDecisionFollowedStrongerEvidence, "object");
}

const policy = createCommunicationPolicy({});
const prompts = buildAgentPromptPair(policy);

function configForOverlap(overlap: number) {
  return normalizeRunConfig(
    {
      problemCategory: "hidden_profile",
      problemCount: 1,
      runModel: MOCK_MODEL_ID,
      maxTurns: 12,
      temperature: 0,
      informationOverlap: overlap,
      informationStructure: {
        overlapRequested: overlap,
        splitSeed: `hb-sanity-o${overlap}`,
        assignmentMode: "balanced-cover",
        counterbalanced: false,
        packetDirection: "standard",
      },
    },
    DEFAULT_RUN_CONFIG,
  );
}

/** Sample across original agent counts rather than mocking all 65. */
const sanityProblems = [
  problems.find((p) => p.hiddenProfile?.hiddenBench?.sourceAgentCount === 4)!,
  problems.find((p) => p.hiddenProfile?.hiddenBench?.sourceAgentCount === 3)!,
].filter(Boolean);

assert.equal(sanityProblems.length, 2);

for (const problem of sanityProblems) {
  for (const overlap of [0, 1.0] as const) {
    const conversation = await runProblem({
      problem,
      policy,
      config: configForOverlap(overlap),
      client: new MockModelClient(),
      agentPrompts: prompts,
    });
    const metrics = computeInformationFlowMetrics(conversation, problem);
    assert.ok(conversation.evidenceQualityMetrics);

    if (overlap < 1) {
      assert.ok((metrics?.privateInformationCountA ?? 0) > 0);
      assert.ok((metrics?.privateInformationCountB ?? 0) > 0);
      assert.ok(buildPrivateInformationFlowTable(conversation).length > 0);
      const aPacket = conversation.problemTextByAgent?.agent_a ?? "";
      const bPacket = conversation.problemTextByAgent?.agent_b ?? "";
      for (const id of conversation.informationAssignment?.agentAOnlyUnitIds ?? []) {
        assert.ok(!bPacket.includes(`[${id}]`));
      }
      for (const id of conversation.informationAssignment?.agentBOnlyUnitIds ?? []) {
        assert.ok(!aPacket.includes(`[${id}]`));
      }
      assert.equal(
        conversation.informationAssignment?.hiddenProfileTreatment?.condition,
        "authored_distributed",
      );
    } else {
      assert.equal(metrics?.privateInformationCountA ?? 0, 0);
      assert.equal(metrics?.privateInformationCountB ?? 0, 0);
      assert.ok(
        (conversation.problemTextByAgent?.agent_a ?? "").includes(
          "FULL INFORMATION",
        ),
      );
    }
  }
}

// Selecting 10 must be feasible against the 65-task pool.
assert.ok(pool.length >= 10);
assert.equal(new Set(pool.slice(0, 10).map((p) => p.id)).size, 10);

console.log(
  `ok — HiddenBench pool=${problems.length}, empty graph, FULL/DISTRIBUTED privacy, grader, finalization, provenance`,
);
