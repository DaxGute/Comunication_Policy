/**
 * Replay stored trustA-sweep conversations through the current stall
 * protocol. Compares original intervention timing with what the updated
 * reducer would have done from the same per-turn solver state.
 *
 * Run: npx vite-node scripts/replayStallProtocol.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { extractFinalAnswerFromText, hasFinalAnswerMarker } from "../src/evaluation/graders/answerExtraction.ts";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter.ts";
import { loadCrosswordBenchProblems } from "../src/problems/crossword/loadCrosswordBench.ts";
import {
  deriveIssueConvergenceStates,
  emptySolverProgressState,
  reduceSolverProgress,
  snapshotBeforeTurn,
  solverStateFingerprint,
  type ReasoningGraph,
} from "../src/reasoning/index.ts";

const RUNS_PATH = resolve(process.cwd(), ".data/runs.json");

const FOCUS = new Set([
  "crosswordbench_0015",
  "crosswordbench_0026",
  "crosswordbench_0030",
  "crosswordbench_0006",
  "crosswordbench_0003",
  "crosswordbench_0035",
  "crosswordbench_0002",
]);

type StoredRun = {
  id: string;
  createdAt: string;
  policy?: { trustA?: number; authority?: number };
  config?: { maxTurns?: number };
  conversations?: Array<{
    problemId: string;
    messages: Array<{
      turnIndex: number;
      content: string;
      rawContent?: string;
    }>;
    reasoningSubjects?: ReasoningGraph["subjects"];
    reasoningEvents?: ReasoningGraph["events"];
    stoppedReason?: string;
    reasoningDiagnostics?: {
      solverProgress?: {
        stallWarningTurn?: number;
        stallWarningKind?: string;
        finalizationRequiredTurn?: number;
        closureWarningTurn?: number;
        progressResumedAfterWarning?: boolean;
        semanticStallReason?: string;
      };
    };
  }>;
};

function latestSweep(runs: StoredRun[]): StoredRun[] {
  return [...runs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
}

function replayConversation(
  problem: NonNullable<ReturnType<typeof loadCrosswordBenchProblems>[number]>,
  conversation: NonNullable<StoredRun["conversations"]>[number],
  maxTurns: number,
) {
  const adapter = crosswordReasoningAdapter;
  const full: ReasoningGraph = {
    subjects: conversation.reasoningSubjects,
    nodes: [],
    events: conversation.reasoningEvents ?? [],
  };
  let state = emptySolverProgressState();
  const seedGraph = snapshotBeforeTurn(full, 1);
  const seedConflicts = adapter.deriveConflicts?.(problem, seedGraph) ?? [];
  const seedSignals = adapter.deriveDeterministicEvidence?.(problem, seedGraph) ?? [];
  state.fingerprints = [
    solverStateFingerprint({
      problem,
      adapter,
      graph: seedGraph,
      issueStates: deriveIssueConvergenceStates(seedGraph, {
        conflicts: seedConflicts,
        deterministicSignals: seedSignals,
        currentTurn: 0,
      }),
    }),
  ];

  const timeline: Array<{
    turn: number;
    feedback?: string;
    phase: string;
    resumed?: boolean;
  }> = [];

  for (const message of conversation.messages) {
    const turn = message.turnIndex;
    const graph = snapshotBeforeTurn(full, turn + 1);
    const events = (conversation.reasoningEvents ?? []).filter(
      (event) => event.turnIndex === turn,
    );
    const conflicts = adapter.deriveConflicts?.(problem, graph) ?? [];
    const signals = adapter.deriveDeterministicEvidence?.(problem, graph) ?? [];
    const issueStates = deriveIssueConvergenceStates(graph, {
      conflicts,
      deterministicSignals: signals,
      currentTurn: turn,
    });
    const ledgers = adapter.deriveCandidateLedger?.(problem, graph);
    const extracted = extractFinalAnswerFromText(message.content);
    const result = reduceSolverProgress(state, {
      turnIndex: turn,
      maxTurns,
      graph,
      events,
      issueStates,
      ledgers,
      fingerprint: solverStateFingerprint({
        problem,
        adapter,
        graph,
        issueStates,
      }),
      substantive: true,
      structuredReasoningMissing: false,
      attemptedFinalAnswer:
        !extracted && hasFinalAnswerMarker(message.content),
    });
    state = result.state;
    const tag = result.protocolFeedback?.split("\n")[0];
    if (extracted) {
      timeline.push({
        turn,
        feedback: "FINAL_ANSWER",
        phase: result.state.phase,
        resumed: result.state.counters.progressResumedAfterWarning,
      });
      break;
    }
    if (tag || result.stalled) {
      timeline.push({
        turn,
        feedback: tag ?? (result.stalled ? "STALLED" : undefined),
        phase: result.state.phase,
        resumed: result.state.counters.progressResumedAfterWarning,
      });
    }
    if (result.stalled) break;
  }

  return { state, timeline };
}

function main(): void {
  if (!existsSync(RUNS_PATH)) {
    console.log("no .data/runs.json — skip replay");
    return;
  }
  const runs = JSON.parse(readFileSync(RUNS_PATH, "utf8")) as StoredRun[];
  const sweep = latestSweep(runs);
  const problems = new Map(
    loadCrosswordBenchProblems().map((problem) => [problem.id, problem]),
  );
  console.log(
    "replaying latest sweep",
    sweep.map((run) => `${run.id} trustA=${run.policy?.trustA}`).join(", "),
  );

  for (const run of sweep) {
    const trustA = run.policy?.trustA;
    for (const conversation of run.conversations ?? []) {
      if (!FOCUS.has(conversation.problemId)) continue;
      const problem = problems.get(conversation.problemId);
      if (!problem) continue;
      const original =
        conversation.reasoningDiagnostics?.solverProgress ?? {};
      const { state, timeline } = replayConversation(
        problem,
        conversation,
        run.config?.maxTurns ?? 40,
      );
      console.log(
        [
          `trustA=${trustA}`,
          conversation.problemId,
          `orig warn=${original.stallWarningTurn ?? "-"} kind=${original.stallWarningKind ?? "-"} fin=${original.finalizationRequiredTurn ?? "-"} close=${original.closureWarningTurn ?? "-"} resumed=${original.progressResumedAfterWarning ?? "-"}`,
          `new  warn=${state.stallWarningTurn ?? "-"} kind=${state.stallWarningKind ?? "-"} fin=${state.finalizationRequiredTurn ?? "-"} close=${state.closureWarningTurn ?? "-"} resumed=${state.counters.progressResumedAfterWarning ?? "-"} freeze=${state.freezeType ?? "-"}`,
          `timeline ${timeline.map((item) => `T${item.turn}:${item.feedback}`).join(" → ") || "(none)"}`,
        ].join("\n  "),
      );
    }
  }
}

main();
