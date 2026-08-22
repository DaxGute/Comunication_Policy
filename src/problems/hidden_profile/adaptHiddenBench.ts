/**
 * Adapt official HiddenBench tasks into our two-agent Hidden Profile representation.
 *
 * HiddenBench distributes one private fact per original agent (N∈{3,4}).
 * Our runtime is dyadic, so private facts are partitioned round-robin onto
 * Agent A / Agent B without dropping any official text:
 *   hidden_information[i] → a_private if i even, b_private if i odd.
 *
 * FULL INFORMATION (overlap 1.0) still exposes every unit to both agents.
 * Gold / rationale / evidence labels remain evaluator-only.
 */

import type {
  HiddenProfileEvaluatorMetadata,
  HiddenProfileInformationUnit,
  HiddenProfileItem,
} from "./types";
import type { HiddenBenchSourceMeta, HiddenBenchTask } from "./hiddenBenchTypes";

export const HIDDENBENCH_SOURCE_META: HiddenBenchSourceMeta = {
  name: "HiddenBench",
  license: "MIT",
  github: "https://github.com/Yassellee/HiddenBench_ICML",
  huggingface: "https://huggingface.co/datasets/YuxuanLi1225/HiddenBench",
  file: "data/benchmark.json",
  commit: "3925a194423d",
  commitDate: "2026-05-06T06:15:28Z",
  count: 65,
  note:
    "Vendored full HiddenBench benchmark (65 tasks). N-agent hidden_information is mapped to two agents by round-robin A/B assignment so the union preserves every official private fact. Not benchmark_short.json.",
};

export function hiddenBenchProblemId(task: HiddenBenchTask): string {
  return `hiddenbench_${task.name}`;
}

function titleFromName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Deterministic dyadic partition of HiddenBench private facts.
 * Preserves all strings; never randomly sentence-splits.
 */
export function partitionHiddenFactsForDyad(
  hidden: readonly string[],
): { aPrivate: string[]; bPrivate: string[] } {
  const aPrivate: string[] = [];
  const bPrivate: string[] = [];
  hidden.forEach((text, index) => {
    if (index % 2 === 0) aPrivate.push(text);
    else bPrivate.push(text);
  });
  return { aPrivate, bPrivate };
}

function buildInformation(
  task: HiddenBenchTask,
): HiddenProfileInformationUnit[] {
  const units: HiddenProfileInformationUnit[] = [];
  task.shared_information.forEach((text, index) => {
    units.push({
      id: `S${index + 1}`,
      visibility: "shared",
      type: "fact",
      text,
    });
  });
  const { aPrivate, bPrivate } = partitionHiddenFactsForDyad(
    task.hidden_information,
  );
  aPrivate.forEach((text, index) => {
    units.push({
      id: `A${index + 1}`,
      visibility: "a_private",
      type: "fact",
      text,
    });
  });
  bPrivate.forEach((text, index) => {
    units.push({
      id: `B${index + 1}`,
      visibility: "b_private",
      type: "fact",
      text,
    });
  });
  return units;
}

function buildEvaluatorMetadata(
  task: HiddenBenchTask,
  information: HiddenProfileInformationUnit[],
): HiddenProfileEvaluatorMetadata {
  const privateIds = information
    .filter((unit) => unit.visibility !== "shared")
    .map((unit) => unit.id);
  const evidenceByOption: HiddenProfileEvaluatorMetadata["evidenceByOption"] =
    {};
  for (const option of task.possible_answers) {
    evidenceByOption[option] = {
      supportingUnitIds:
        option === task.correct_answer ? [...privateIds] : [],
    };
  }
  const notes = [
    `HiddenBench original agents=${task.hidden_information.length}; dyadic partition=round_robin (even→A, odd→B).`,
    task.rationale?.trim() ? `Official rationale: ${task.rationale.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    evidenceStructure: "classic_hidden_profile",
    evidenceByOption,
    decisiveInformationIds: privateIds,
    notes,
  };
}

export function adaptHiddenBenchTask(task: HiddenBenchTask): HiddenProfileItem {
  if (!task.possible_answers.includes(task.correct_answer)) {
    throw new Error(
      `HiddenBench task ${task.id} (${task.name}): correct_answer not in possible_answers`,
    );
  }
  if (task.shared_information.length === 0) {
    throw new Error(
      `HiddenBench task ${task.id} (${task.name}): empty shared_information`,
    );
  }
  if (task.hidden_information.length < 2) {
    throw new Error(
      `HiddenBench task ${task.id} (${task.name}): need ≥2 hidden facts for dyadic private packets`,
    );
  }

  const information = buildInformation(task);
  return {
    id: hiddenBenchProblemId(task),
    title: titleFromName(task.name),
    // Official scenario text — not rewritten.
    question: task.description,
    options: [...task.possible_answers],
    information,
    goldAnswer: task.correct_answer,
    evaluatorMetadata: buildEvaluatorMetadata(task, information),
  };
}

export function adaptHiddenBenchTasks(
  tasks: readonly HiddenBenchTask[],
): HiddenProfileItem[] {
  return tasks.map(adaptHiddenBenchTask);
}
