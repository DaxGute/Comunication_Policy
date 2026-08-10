/**
 * Verifies MARBLE post-hoc wiring can locate the checkout and script.
 * Does not call paid LLMs unless --live is passed.
 *
 * Run: npm run test:marble-posthoc
 * Live: npm run test:marble-posthoc -- --live
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toMarblePosthocRequest } from "../src/evaluation/marble/adapter";
import { MARBLE_COMMIT } from "../src/evaluation/versions";
import type { ExperimentRun, ProblemConversation } from "../src/experiment/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/marble/posthoc_evaluate.py");

function resolveMarbleRoot(): string | undefined {
  if (process.env.MARBLE_ROOT) return process.env.MARBLE_ROOT;
  const candidates = [
    path.join(root, "deps/MARBLE"),
    path.join(root, "../Summer_CESTA/deps/MARBLE"),
    path.join(homedir(), "Desktop/Summer_CESTA/deps/MARBLE"),
  ];
  return candidates.find((c) =>
    existsSync(path.join(c, "marble/evaluator/evaluator.py")),
  );
}

function resolvePython(_marbleRoot: string): string {
  if (process.env.MARBLE_PYTHON) return process.env.MARBLE_PYTHON;
  const candidates = [
    path.join(root, "../Summer_CESTA/.venv-marble/bin/python"),
    path.join(homedir(), "Desktop/Summer_CESTA/.venv-marble/bin/python"),
  ];
  return candidates.find((c) => existsSync(c)) ?? "python3";
}

const conversation: ProblemConversation = {
  problemId: "p1",
  problemTitle: "Tiny task",
  problemText: "What is 2+2?",
  messages: [
    {
      id: "1",
      agentId: "agent_a",
      role: "assistant",
      content: "I think the answer is 4.",
      turnIndex: 1,
    },
    {
      id: "2",
      agentId: "agent_b",
      role: "assistant",
      content: "Agreed. FINAL_ANSWER: 4",
      turnIndex: 2,
    },
  ],
  finalAnswer: "4",
  stoppedReason: "final_answer",
};

const run = {
  id: "run1",
  createdAt: new Date().toISOString(),
  policy: { trustA: 0.5, trustB: 0.5, authority: 0.5, familiarity: 0.5 },
  agentPrompts: { agentA: "You are A", agentB: "You are B" },
  config: {
    problemCategory: "proof",
    problemCount: 1,
    model: "gpt-4o-mini",
    provider: "openai",
    maxTurns: 4,
    temperature: 0.2,
  },
  conversations: [conversation],
  status: "completed",
} as ExperimentRun;

assert.ok(existsSync(script), "posthoc_evaluate.py missing");
const marbleRoot = resolveMarbleRoot();
assert.ok(marbleRoot, "MARBLE checkout not found — set MARBLE_ROOT");
console.log(`✓ MARBLE root: ${marbleRoot}`);
console.log(`✓ pinned commit expectation: ${MARBLE_COMMIT}`);

const request = toMarblePosthocRequest({
  run,
  conversation,
  evaluatorModel: "gpt-4o-mini",
});
assert.ok(request.task.includes("2+2"));
assert.equal(request.messages.length, 2);
// Policy values must not appear in MARBLE prompt fields.
assert.ok(!JSON.stringify(request).includes("trustA"));
assert.ok(!JSON.stringify(request).includes("authority"));
console.log("✓ adapter maps transcript without policy leakage");

const live = process.argv.includes("--live");
if (!live) {
  // Import path smoke: python can at least locate marble package.
  const python = resolvePython(marbleRoot!);
  const probe = spawnSync(
    python,
    [
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); from marble.evaluator.evaluator import Evaluator; print(Evaluator.__module__)",
      marbleRoot!,
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.ok((probe.stdout || "").includes("marble.evaluator"));
  console.log("✓ official marble.evaluator.Evaluator importable");
  console.log("Skip live LLM call (pass --live to invoke posthoc_evaluate.py).");
  process.exit(0);
}

const python = resolvePython(marbleRoot!);
const result = spawnSync(python, [script, "--input", "-"], {
  cwd: marbleRoot,
  env: {
    ...process.env,
    MARBLE_ROOT: marbleRoot,
    MARBLE_COMMIT,
  },
  input: JSON.stringify(request),
  encoding: "utf8",
  timeout: 180_000,
});

assert.ok(result.stdout, result.stderr);
const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
assert.equal(parsed.ok, true, JSON.stringify(parsed));
assert.ok(parsed.normalized);
assert.ok(parsed.raw);
assert.ok(
  parsed.raw.evaluator_class === "marble.evaluator.evaluator.Evaluator",
);
console.log("✓ live MARBLE post-hoc returned native metrics");
console.log(
  `  communication=${parsed.normalized.communicationScore} planning=${parsed.normalized.planningScore} coordination=${parsed.normalized.coordinationScore}`,
);
