/**
 * Unit tests for full-puzzle crossword parsing, reconstruction, and metrics.
 * Uses a hand-written 3×3 fixture (not a production puzzle) plus subset checks.
 *
 * Run: npm run test:crossword-grader
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractFinalAnswerFromText } from "../src/evaluation/graders/answerExtraction";
import {
  countFillableCells,
  findClueCrossings,
  gradeCrosswordPuzzle,
  normalizeCrosswordAnswer,
  parseClueAssignments,
  reconstructGridFromAssignments,
} from "../src/evaluation/graders/crosswordGrader";
import { formatCrosswordProblemText } from "../src/problems/crossword/formatCrosswordProblem";
import { loadCrosswordBenchProblems } from "../src/problems/crossword/loadCrosswordBench";
import type {
  CrosswordPuzzle,
  CrosswordSpec,
} from "../src/problems/crossword/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tiny hand-written crossword — every metric outcome is obvious. */
const FIXTURE_PUZZLE: CrosswordPuzzle = {
  id: "fixture_mini",
  sourceId: -1,
  width: 3,
  height: 3,
  difficulty: "3x3",
  category: "fixture",
  grid: ["..#", "...", "#.."],
  solution: ["HI#", "DOG", "#GO"],
  clues: [
    {
      number: 1,
      direction: "across",
      clue: "Greeting",
      row: 0,
      col: 0,
      length: 2,
      answer: "HI",
    },
    {
      number: 3,
      direction: "across",
      clue: "Canine",
      row: 1,
      col: 0,
      length: 3,
      answer: "DOG",
    },
    {
      number: 5,
      direction: "across",
      clue: "Proceed",
      row: 2,
      col: 1,
      length: 2,
      answer: "GO",
    },
    {
      number: 1,
      direction: "down",
      clue: "Headphones abbr.",
      row: 0,
      col: 0,
      length: 2,
      answer: "HD",
    },
    {
      number: 2,
      direction: "down",
      clue: "1 + 0 + G mash",
      row: 0,
      col: 1,
      length: 3,
      answer: "IOG",
    },
    {
      number: 4,
      direction: "down",
      clue: "Proceed (vertical)",
      row: 1,
      col: 2,
      length: 2,
      answer: "GO",
    },
  ],
};

function fixtureSpec(): CrosswordSpec {
  return {
    width: FIXTURE_PUZZLE.width,
    height: FIXTURE_PUZZLE.height,
    difficulty: FIXTURE_PUZZLE.difficulty,
    category: FIXTURE_PUZZLE.category,
    grid: FIXTURE_PUZZLE.grid,
    solution: FIXTURE_PUZZLE.solution,
    clues: FIXTURE_PUZZLE.clues,
    source: "crosswordbench",
    sourceId: FIXTURE_PUZZLE.sourceId,
  };
}

function perfectAnswer(): string {
  return [
    "ACROSS",
    "1: HI",
    "3: DOG",
    "5: GO",
    "DOWN",
    "1: HD",
    "2: IOG",
    "4: GO",
  ].join("\n");
}

function section(title: string) {
  console.log(`  · ${title}`);
}

// --- 1. Dataset parsing ---
section("dataset parsing");
const subset = JSON.parse(
  readFileSync(join(ROOT, "src/problems/data/crosswordbench_subset.json"), "utf8"),
);
assert.equal(subset.count, subset.items.length);
assert.ok(subset.items.length >= 20 && subset.items.length <= 50);
assert.equal(subset.source.huggingface, "CrossWordBenchEval/CrossWordBench");

const problems = loadCrosswordBenchProblems();
assert.equal(problems.length, subset.items.length);
assert.ok(problems.every((p) => p.kind === "crossword_puzzle"));
assert.ok(problems.every((p) => p.crossword?.source === "crosswordbench"));

// --- 2–4. Grid dimensions, clue coordinates, lengths ---
section("grid dimensions / clue coordinates / lengths");
for (const item of subset.items as CrosswordPuzzle[]) {
  assert.equal(item.grid.length, item.height);
  assert.equal(item.solution.length, item.height);
  assert.ok(item.grid.every((r: string) => r.length === item.width));
  assert.ok(item.solution.every((r: string) => r.length === item.width));
  assert.equal(countFillableCells(item.grid), countFillableCells(item.solution));

  for (const clue of item.clues) {
    assert.ok(clue.row >= 0 && clue.row < item.height);
    assert.ok(clue.col >= 0 && clue.col < item.width);
    assert.equal(clue.answer.length, clue.length);
    assert.equal(normalizeCrosswordAnswer(clue.answer), clue.answer);
    assert.equal(item.grid[clue.row][clue.col], ".");
    for (let i = 0; i < clue.length; i++) {
      const r = clue.direction === "across" ? clue.row : clue.row + i;
      const c = clue.direction === "across" ? clue.col + i : clue.col;
      assert.equal(item.solution[r][c], clue.answer[i]);
      assert.equal(item.grid[r][c], ".");
    }
  }
}

// Fixture geometry
assert.equal(FIXTURE_PUZZLE.width, 3);
assert.equal(FIXTURE_PUZZLE.height, 3);
assert.equal(countFillableCells(FIXTURE_PUZZLE.grid), 7);

// --- 5. Reconstruct grid from assignments ---
section("reconstruct grid from clue assignments");
const reconstructed = reconstructGridFromAssignments({
  geometry: FIXTURE_PUZZLE.grid,
  clues: FIXTURE_PUZZLE.clues,
  assignments: parseClueAssignments(perfectAnswer()),
});
assert.deepEqual(reconstructed, FIXTURE_PUZZLE.solution);

const messy = parseClueAssignments(`
**ACROSS**
1: hi!
3. dog
5 - G O
DOWN
1: H.D.
2: iog
4: go
`);
assert.equal(messy.length, 6);
assert.equal(messy.find((a) => a.direction === "across" && a.number === 1)?.answer, "HI");

// --- 6. Crossing detection ---
section("across/down crossing detection");
const crossings = findClueCrossings(FIXTURE_PUZZLE.clues);
// Cells: (0,0) (0,1) (1,0) (1,1) (1,2) (2,1) (2,2)
assert.equal(crossings.length, 7);

// --- 7–11. Metrics on fixture ---
section("metrics: perfect / one wrong letter / missing word / conflicting crossing");
const spec = fixtureSpec();

const perfect = gradeCrosswordPuzzle({ predicted: perfectAnswer(), spec });
assert.equal(perfect.exactSolve, true);
assert.equal(perfect.letterAccuracy, 1);
assert.equal(perfect.wordAccuracy, 1);
assert.equal(perfect.completion, 1);
assert.equal(perfect.crossingConsistency, 1);
assert.equal(perfect.label, "exact_solve");

const oneWrongLetter = gradeCrosswordPuzzle({
  predicted: [
    "ACROSS",
    "1: HO", // wrong second letter
    "3: DOG",
    "5: GO",
    "DOWN",
    "1: HD",
    "2: OOG", // adjusted to keep some consistency? actually leave conflict
    "4: GO",
  ].join("\n"),
  spec,
});
// Cells: H correct, O wrong at (0,1); rest of DOG/GO/HD/GO correct if placed.
// Across HO places H,O; Down HD places H,D; Down OOG places O,O,G — conflicts at (1,1)
assert.ok(oneWrongLetter.letterAccuracy < 1);
assert.ok(oneWrongLetter.letterAccuracy > 0);
assert.ok(oneWrongLetter.wordAccuracy < 1);
assert.equal(oneWrongLetter.exactSolve, false);

const missingWord = gradeCrosswordPuzzle({
  predicted: [
    "ACROSS",
    "1: HI",
    "3: DOG",
    // missing 5: GO
    "DOWN",
    "1: HD",
    "2: IOG",
    "4: GO",
  ].join("\n"),
  spec,
});
// GO across missing: cells (2,1) and (2,2) may still be filled by downs IOG and GO
assert.equal(missingWord.correctWords, 5);
assert.equal(missingWord.wordAccuracy, 5 / 6);
assert.equal(missingWord.exactSolve, true); // downs still fill those cells correctly
assert.equal(missingWord.completion, 1);

const conflicting = gradeCrosswordPuzzle({
  predicted: [
    "ACROSS",
    "1: HI",
    "3: DIG", // conflicts with down HD (wants D at (1,0) — DIG has D ok) and IOG (wants O at (1,1) but DIG has I)
    "5: GO",
    "DOWN",
    "1: HD",
    "2: IOG",
    "4: GO",
  ].join("\n"),
  spec,
});
assert.ok(
  conflicting.crossingConsistency !== null &&
    conflicting.crossingConsistency < 1,
);
assert.ok(conflicting.crossingsCompared > 0);
assert.ok(conflicting.crossingsAgreeing < conflicting.crossingsCompared);
assert.equal(conflicting.exactSolve, false);

const noAnswer = gradeCrosswordPuzzle({ predicted: undefined, spec });
assert.equal(noAnswer.label, "no_answer");
assert.equal(noAnswer.letterAccuracy, 0);
assert.equal(noAnswer.completion, 0);

// --- 12. Reference answers absent from agent-facing prompt ---
section("reference answers absent from agent-facing prompt");
const prompt = formatCrosswordProblemText(FIXTURE_PUZZLE);
assert.ok(prompt.includes("CROSSWORD"));
assert.ok(prompt.includes("ACROSS"));
assert.ok(prompt.includes("DOWN"));
assert.ok(prompt.includes("Grid:"));
for (const clue of FIXTURE_PUZZLE.clues) {
  assert.ok(prompt.includes(clue.clue));
  // Gold answers must not appear as fills
  assert.ok(
    !new RegExp(`\\b${clue.answer}\\b`).test(prompt),
    `leaked answer ${clue.answer}`,
  );
}
assert.ok(!prompt.includes("HI#"));
assert.ok(!prompt.includes("DOG"));
assert.ok(!prompt.includes("#GO"));

for (const problem of problems.slice(0, 5)) {
  assert.ok(problem.crossword);
  const text = problem.text;
  let scrubbed = text;
  for (const clue of problem.crossword.clues) {
    scrubbed = scrubbed.split(clue.clue).join("");
  }
  for (const clue of problem.crossword.clues) {
    if (clue.answer.length < 3) continue;
    assert.ok(
      !scrubbed.includes(clue.answer),
      `${problem.id} prompt leaked ${clue.answer}`,
    );
  }
  for (const row of problem.crossword.solution) {
    const letters = row.replace(/#/g, "");
    if (letters.length >= 3) {
      assert.ok(!text.includes(letters));
    }
  }
}

// Extraction: multi-line FINAL_ANSWER
section("multi-line FINAL_ANSWER extraction");
const extracted = extractFinalAnswerFromText(
  `We agree.\nFINAL_ANSWER:\n${perfectAnswer()}\n`,
);
assert.ok(extracted);
assert.ok(extracted.includes("ACROSS"));
assert.equal(
  gradeCrosswordPuzzle({ predicted: extracted, spec }).exactSolve,
  true,
);

const single = extractFinalAnswerFromText("FINAL_ANSWER: 42");
assert.equal(single, "42");

console.log(
  `ok — ${subset.items.length} CrossWordBench puzzles + fixture metrics + leak checks`,
);
