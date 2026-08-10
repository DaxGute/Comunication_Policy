/**
 * Smoke tests for collaborative ProofSolver grading + subset integrity.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFinalAnswerFromText } from "../src/evaluation/graders/answerExtraction";
import { gradeProofConversation } from "../src/evaluation/graders/proofGrader";
import { formatProofProblemText } from "../src/problems/proof/formatProofProblem";
import {
  getProofSolverItems,
  getProofSolverSourceMeta,
  loadProofSolverProblems,
} from "../src/problems/proof/loadProofSolver";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const subset = JSON.parse(
  readFileSync(join(ROOT, "src/problems/data/proofsolver_subset.json"), "utf8"),
);

assert(subset.count === subset.items.length, "count mismatch");
assert(subset.items.length >= 40, "subset too small");
assert(
  getProofSolverSourceMeta().huggingface === "WilhelmH/proofsolver-1300",
  "unexpected source",
);

const items = getProofSolverItems();
assert(items.length === subset.count, "loader count mismatch");

for (const item of items) {
  assert(item.id.startsWith("proofsolver_"), `bad id ${item.id}`);
  assert(item.question.length > 40, `missing question ${item.id}`);
  assert(item.referenceProof.length > 80, `missing reference ${item.id}`);
  assert(
    /\bprove\b|\bwith proof\b|\bshow that\b|\bgive a proof\b/i.test(
      item.question,
    ),
    `not a proof task ${item.id}`,
  );

  const text = formatProofProblemText(item);
  assert(text.includes("Conduct this proof together."), "missing collab prompt");
  assert(text.includes(item.question), "question missing from prompt");
  assert(
    !text.includes(item.referenceProof.slice(0, 40)),
    `reference leaked into prompt for ${item.id}`,
  );
}

const problems = loadProofSolverProblems();
assert(problems[0]?.kind === "proof", "expected proof kind");
assert(problems[0]?.proof?.source === "proofsolver", "expected proofsolver source");
assert(problems[0]?.expectedAnswer === undefined, "should not set expectedAnswer");

const short = gradeProofConversation({ finalAnswer: "too short", messages: [] });
assert(short.label === "open", "short proof should be open");

const jointProof = [
  "Suppose, for contradiction, that rx is rational.",
  "Since r is a nonzero rational, 1/r is rational.",
  "Then (1/r)(rx) = x is rational, a contradiction.",
  "Therefore rx is irrational. QED",
].join("\n");

const joint = gradeProofConversation({
  finalAnswer: jointProof,
  messages: [{ content: "Let's try contradiction." }],
});
assert(joint.label === "proof_submitted", "joint proof should submit");
assert(joint.proofMarkerCount >= 3, "expected proof markers");

const extracted = extractFinalAnswerFromText(
  `Here is our write-up.\nFINAL_ANSWER:\n${jointProof}`,
);
assert(extracted === jointProof, "multi-line proof extraction failed");

console.log(
  `ok — ${items.length} ProofSolver items + grader/extraction smoke cases`,
);
