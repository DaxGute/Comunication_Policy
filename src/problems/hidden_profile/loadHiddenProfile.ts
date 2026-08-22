/**
 * Load the live Hidden Profile pool from official HiddenBench (65 tasks).
 * The 4-item diagnostic JSON remains available for optional smoke helpers only.
 */

import hiddenBenchJson from "../data/hiddenbench_benchmark.json";
import diagnosticJson from "../data/hidden_profile_diagnostic.json";
import {
  adaptHiddenBenchTask,
  adaptHiddenBenchTasks,
  HIDDENBENCH_SOURCE_META,
} from "./adaptHiddenBench";
import {
  formatHiddenProfileProblemText,
  formatHiddenProfileTitle,
} from "./formatHiddenProfileProblem";
import type { HiddenBenchTask } from "./hiddenBenchTypes";
import type {
  HiddenProfileItem,
  HiddenProfileSpec,
  HiddenProfileSubsetFile,
  HiddenProfileVisibility,
} from "./types";
import type { Problem } from "../types";

const HIDDENBENCH_TASKS = hiddenBenchJson as HiddenBenchTask[];
const DIAGNOSTIC = diagnosticJson as HiddenProfileSubsetFile;

function assertValidItem(item: HiddenProfileItem): void {
  if (!item.options.includes(item.goldAnswer)) {
    throw new Error(
      `Hidden Profile item ${item.id}: goldAnswer not in options`,
    );
  }
  const ids = new Set<string>();
  for (const unit of item.information) {
    if (ids.has(unit.id)) {
      throw new Error(`Hidden Profile item ${item.id}: duplicate unit ${unit.id}`);
    }
    ids.add(unit.id);
    const vis = unit.visibility as HiddenProfileVisibility;
    if (vis !== "shared" && vis !== "a_private" && vis !== "b_private") {
      throw new Error(
        `Hidden Profile item ${item.id}: invalid visibility on ${unit.id}`,
      );
    }
  }
  const shared = item.information.filter((u) => u.visibility === "shared");
  const aPrivate = item.information.filter((u) => u.visibility === "a_private");
  const bPrivate = item.information.filter((u) => u.visibility === "b_private");
  if (shared.length === 0 || aPrivate.length === 0 || bPrivate.length === 0) {
    throw new Error(
      `Hidden Profile item ${item.id}: need shared, a_private, and b_private units`,
    );
  }
}

export function getHiddenProfileSourceMeta() {
  return {
    name: HIDDENBENCH_SOURCE_META.name,
    license: HIDDENBENCH_SOURCE_META.license,
    note: HIDDENBENCH_SOURCE_META.note,
    github: HIDDENBENCH_SOURCE_META.github,
    huggingface: HIDDENBENCH_SOURCE_META.huggingface,
    commit: HIDDENBENCH_SOURCE_META.commit,
    count: HIDDENBENCH_SOURCE_META.count,
  };
}

/** Official HiddenBench tasks (raw). */
export function getHiddenBenchTasks(): HiddenBenchTask[] {
  return HIDDENBENCH_TASKS;
}

/** Live pool: adapted HiddenBench items. */
export function loadHiddenProfileItems(): HiddenProfileItem[] {
  if (HIDDENBENCH_TASKS.length !== HIDDENBENCH_SOURCE_META.count) {
    throw new Error(
      `HiddenBench expected ${HIDDENBENCH_SOURCE_META.count} tasks, got ${HIDDENBENCH_TASKS.length}`,
    );
  }
  const items = adaptHiddenBenchTasks(HIDDENBENCH_TASKS);
  for (const item of items) assertValidItem(item);
  return items;
}

/** Optional smoke-test items (not the selectable pool). */
export function loadDiagnosticHiddenProfileItems(): HiddenProfileItem[] {
  for (const item of DIAGNOSTIC.items) assertValidItem(item);
  return DIAGNOSTIC.items;
}

export function toHiddenProfileSpec(
  item: HiddenProfileItem,
  provenance?: {
    source: "hiddenbench" | "diagnostic";
    task?: HiddenBenchTask;
  },
): HiddenProfileSpec {
  const source = provenance?.source ?? "hiddenbench";
  const task = provenance?.task;
  return {
    title: item.title,
    question: item.question,
    options: [...item.options],
    information: item.information.map((unit) => ({ ...unit })),
    goldAnswer: item.goldAnswer,
    evaluatorMetadata: {
      ...item.evaluatorMetadata,
      evidenceByOption: { ...item.evaluatorMetadata.evidenceByOption },
      decisiveInformationIds: [
        ...item.evaluatorMetadata.decisiveInformationIds,
      ],
    },
    source,
    sourceId: task?.name ?? item.id,
    ...(source === "hiddenbench" && task
      ? {
          hiddenBench: {
            dataset: "HiddenBench" as const,
            datasetVersion: HIDDENBENCH_SOURCE_META.commit,
            datasetCommitDate: HIDDENBENCH_SOURCE_META.commitDate,
            github: HIDDENBENCH_SOURCE_META.github,
            huggingface: HIDDENBENCH_SOURCE_META.huggingface,
            sourceFile: HIDDENBENCH_SOURCE_META.file,
            sourceTaskId: task.id,
            sourceTaskName: task.name,
            sourceAgentCount: task.hidden_information.length,
            dyadicPartition: "round_robin" as const,
            license: "MIT" as const,
          },
        }
      : {}),
  };
}

function itemToProblem(
  item: HiddenProfileItem,
  provenance?: {
    source: "hiddenbench" | "diagnostic";
    task?: HiddenBenchTask;
  },
): Problem {
  return {
    id: item.id,
    category: "hidden_profile",
    kind: "hidden_profile",
    title: formatHiddenProfileTitle(item),
    text: formatHiddenProfileProblemText(item),
    expectedAnswer: item.goldAnswer,
    hiddenProfile: toHiddenProfileSpec(item, provenance),
  };
}

/** Live Hidden Profile problems = full HiddenBench benchmark. */
export function loadHiddenProfileProblems(): Problem[] {
  return HIDDENBENCH_TASKS.map((task) => {
    const item = adaptHiddenBenchTask(task);
    assertValidItem(item);
    return itemToProblem(item, { source: "hiddenbench", task });
  });
}

/** Diagnostic problems for local smoke tooling only. */
export function loadDiagnosticHiddenProfileProblems(): Problem[] {
  return loadDiagnosticHiddenProfileItems().map((item) =>
    itemToProblem(item, { source: "diagnostic" }),
  );
}
