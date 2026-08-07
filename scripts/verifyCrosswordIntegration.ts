/**
 * Integration smoke: run one mock problem per category and print crossword diagnostics.
 */
import { evaluateRun } from "../src/evaluation/evaluateRun";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { selectProblems } from "../src/problems/registry";
import { formatCrosswordProblemText } from "../src/problems/crossword/formatCrosswordProblem";
import { getCrosswordBenchPuzzles } from "../src/problems/crossword/loadCrosswordBench";
import { runExperiment } from "../src/runtime/runExperiment";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import type { ProblemCategory } from "../src/problems/types";

async function runCategory(category: ProblemCategory) {
  const run = await runExperiment({
    policy: DEFAULT_COMMUNICATION_POLICY,
    config: {
      problemCategory: category,
      problemCount: 1,
      model: MOCK_MODEL_ID,
      provider: "mock",
      maxTurns: 4,
      temperature: 0.2,
    },
  });
  const evaluation = evaluateRun(run);
  const conv = run.conversations[0];
  const problemEval = evaluation.problems[0];
  console.log(`\n=== ${category} ===`);
  console.log("title:", conv?.problemTitle);
  console.log("stopped:", conv?.stoppedReason);
  console.log("label:", problemEval?.label);
  console.log("score:", problemEval?.score);
  if (problemEval?.details?.grader === "crossword") {
    console.log("letterAccuracy:", problemEval.details.letterAccuracy);
    console.log("wordAccuracy:", problemEval.details.wordAccuracy);
    console.log("completion:", problemEval.details.completion);
    console.log("crossingConsistency:", problemEval.details.crossingConsistency);
    console.log("exactSolve:", problemEval.details.exactSolve);
    console.log("predictedGrid:\n" + problemEval.details.predictedGrid);
  }
  // Print a short transcript sample for crossword
  if (category === "crossword" && conv) {
    console.log("--- transcript sample ---");
    for (const m of conv.messages.slice(0, 2)) {
      console.log(`[${m.agentId} t${m.turnIndex}]`, m.content.split("\n")[0]);
      console.log(m.content.split("\n").slice(1, 4).join(" | "));
    }
  }
  return { run, evaluation, conv };
}

function verifyPromptLeak() {
  const puzzle = getCrosswordBenchPuzzles()[0];
  const text = formatCrosswordProblemText(puzzle);
  const prompts = buildAgentPromptPair(DEFAULT_COMMUNICATION_POLICY);
  for (const clue of puzzle.clues) {
    if (text.includes(clue.answer)) {
      throw new Error(`agent problem text leaked ${clue.answer}`);
    }
    if (prompts.agentA.includes(clue.answer) || prompts.agentB.includes(clue.answer)) {
      throw new Error(`system prompt leaked ${clue.answer}`);
    }
  }
  const selected = selectProblems("crossword", 1)[0];
  if (!selected?.text.includes("ACROSS") || !selected.text.includes("DOWN")) {
    throw new Error("selected crossword is not a full puzzle");
  }
  if (selected.kind !== "crossword_puzzle") {
    throw new Error(`unexpected kind ${selected.kind}`);
  }
  console.log("prompt leak check OK for", puzzle.id);
  console.log("--- agent-facing excerpt ---");
  console.log(selected.text.split("\n").slice(0, 35).join("\n"));
  console.log("...");
}

async function main() {
  verifyPromptLeak();
  await runCategory("crossword");
  await runCategory("moral_philosophical");
  await runCategory("proof");
  console.log("\nintegration OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
