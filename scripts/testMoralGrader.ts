/**
 * Smoke tests for open-ended moral / philosophical grading.
 * No gold answers — only stance extraction + tension signals.
 */
import { extractFinalAnswerFromText } from "../src/evaluation/graders/answerExtraction";
import { gradeMoralConversation } from "../src/evaluation/graders/moralGrader";
import { formatMoralProblemText } from "../src/problems/moral/formatMoralProblem";
import { loadRedditEthicsProblems } from "../src/problems/moral/loadRedditEthics";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const problems = loadRedditEthicsProblems();
assert(problems.length >= 50, `expected ≥50 moral problems, got ${problems.length}`);

for (const problem of problems) {
  assert(problem.category === "moral_philosophical", `bad category ${problem.id}`);
  assert(problem.kind === "moral", `bad kind ${problem.id}`);
  assert(!problem.expectedAnswer, `gold leaked onto ${problem.id}`);
  assert(problem.moral?.question, `missing question ${problem.id}`);
  assert(
    problem.text.includes("no single objectively correct answer"),
    `prompt missing open-ended notice for ${problem.id}`,
  );
  assert(
    !/FINAL_ANSWER:.*correct|gold answer/i.test(problem.text),
    `prompt suggests correctness for ${problem.id}`,
  );
}

const sample = problems[0]!;
const formatted = formatMoralProblemText({
  id: sample.id,
  sourceIndex: sample.moral!.sourceIndex,
  title: sample.moral!.title,
  description: sample.moral!.description,
  issues: sample.moral!.issues,
  question: sample.moral!.question,
  alternateQuestions: [],
});
assert(formatted.includes("Key tensions:"), "formatter missing tensions");
assert(formatted.includes("FINAL_ANSWER:"), "formatter missing FINAL_ANSWER hint");

const prompts = buildAgentPromptPair(DEFAULT_COMMUNICATION_POLICY);
assert(
  prompts.agentA.includes("IDENTITY") &&
    prompts.agentA.includes("COMMUNICATION POLICY") &&
    prompts.agentA.includes("PROTOCOL"),
  "system prompt missing four-layer headers",
);
assert(
  !prompts.agentA.includes("no single objectively correct"),
  "moral framing leaked into the category-agnostic system prompt",
);
assert(
  !prompts.agentA.includes("crossings, clues"),
  "moral system prompt still uses crossword language",
);

const multiLineStance = extractFinalAnswerFromText(
  [
    "We discussed the tensions.",
    "FINAL_ANSWER: Prioritize the child's safety over social ease.",
    "Acknowledge remaining uncertainty about long-term friendship costs.",
  ].join("\n"),
);
assert(
  multiLineStance?.includes("Prioritize the child's safety"),
  "failed to extract first stance line",
);
assert(
  multiLineStance?.includes("remaining uncertainty"),
  "multi-line moral stance was truncated",
);

const openGrade = gradeMoralConversation({
  messages: [{ content: "Maybe autonomy matters more here." }],
});
assert(openGrade.label === "open", "expected open when no FINAL_ANSWER");
assert(typeof openGrade.exploredTensionCount === "number", "missing tension count");

const stanceGrade = gradeMoralConversation({
  finalAnswer: multiLineStance,
  messages: [
    {
      content:
        "On the other hand there is a trade-off with the friendship principle and real uncertainty.",
    },
  ],
});
assert(stanceGrade.label === "stance_reached", "expected stance_reached");
assert(
  stanceGrade.exploredTensionCount >= 2,
  `expected tension signals, got ${stanceGrade.exploredTensionCount}`,
);
assert(
  stanceGrade.notes.includes("not scored for objective correctness"),
  "notes should reject objective scoring",
);

console.log(
  `ok — ${problems.length} Reddit Ethics dilemmas + stance extraction + open-ended grader`,
);
