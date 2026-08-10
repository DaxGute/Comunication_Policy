import type { ExperimentRun } from "../experiment/types";
import { getProblemsForCategory } from "../problems/registry";
import { evaluateProblem } from "./evaluators";
import type { EvaluationResult } from "./types";

export function evaluateRun(run: ExperimentRun): EvaluationResult {
  const pool = getProblemsForCategory(run.config.problemCategory);
  const byId = new Map(pool.map((p) => [p.id, p]));

  const problems = run.conversations.map((conversation) =>
    evaluateProblem(
      run.config.problemCategory,
      conversation,
      byId.get(conversation.problemId),
    ),
  );

  const completed = problems.length;
  const withScores = problems.filter((p) => typeof p.score === "number");
  const crossword = problems.filter((p) => p.details?.grader === "crossword");
  const moral = problems.filter(
    (p) => p.details?.grader === "moral_open_ended",
  );
  const proof = problems.filter(
    (p) =>
      p.details?.grader === "proof_collaborative" ||
      p.details?.grader === "proof",
  );
  const avgTurns =
    completed === 0
      ? 0
      : problems.reduce((sum, p) => sum + p.turns, 0) / completed;

  const summary: Record<string, number | string> = {
    problemsCompleted: completed,
    averageTurns: Number(avgTurns.toFixed(2)),
    category: run.config.problemCategory,
  };

  if (crossword.length > 0) {
    const mean = (key: string) => {
      const vals = crossword
        .map((p) => p.details?.[key])
        .filter((v): v is number => typeof v === "number");
      if (vals.length === 0) return 0;
      return Number(
        (vals.reduce((sum, v) => sum + v, 0) / vals.length).toFixed(4),
      );
    };
    const exact = crossword.filter((p) => p.details?.exactSolve === true).length;
    summary.crosswordPuzzles = crossword.length;
    summary.crosswordLetterAccuracy = mean("letterAccuracy");
    summary.crosswordWordAccuracy = mean("wordAccuracy");
    summary.crosswordCompletion = mean("completion");
    summary.crosswordCrossingConsistency = mean("crossingConsistency");
    summary.crosswordExactSolveRate = Number(
      (exact / crossword.length).toFixed(4),
    );
    summary.grader =
      "crossword (letter accuracy primary; full-puzzle metrics)";
  }

  if (moral.length > 0) {
    const stances = moral.filter((p) => p.label === "stance_reached").length;
    const tensionVals = moral
      .map((p) => p.details?.exploredTensionSignals)
      .filter((v): v is number => typeof v === "number");
    const meanTension =
      tensionVals.length === 0
        ? 0
        : Number(
            (
              tensionVals.reduce((sum, v) => sum + v, 0) / tensionVals.length
            ).toFixed(2),
          );
    summary.moralDilemmas = moral.length;
    summary.stancesReached = stances;
    summary.stanceRate = Number((stances / moral.length).toFixed(3));
    summary.meanTensionSignals = meanTension;
    summary.grader = "moral (open-ended; no gold answer)";
  }

  if (proof.length > 0) {
    const submitted = proof.filter((p) => p.label === "proof_submitted").length;
    summary.proofProblems = proof.length;
    summary.proofsSubmitted = submitted;
    summary.proofSubmitRate = Number((submitted / proof.length).toFixed(3));
    summary.grader =
      "proof (collaborative write-up; reference not scored)";
  }

  if (withScores.length > 0) {
    const total = withScores.reduce((sum, p) => sum + (p.score ?? 0), 0);
    summary.score = Number((total / withScores.length).toFixed(2));
    summary.scoredProblems = withScores.length;
  } else {
    summary.score = "n/a (category not objectively scored)";
  }

  return { summary, problems };
}
