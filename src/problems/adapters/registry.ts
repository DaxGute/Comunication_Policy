import type { Problem } from "../types";
import { crosswordReasoningAdapter } from "./crosswordAdapter";
import type { TaskEvidenceSeed, TaskReasoningAdapter } from "./types";

function rootIssue(problem: Problem, label: string, prompt: string) {
  return {
    id: `${problem.category}:root`,
    kind: "task_defined" as const,
    label,
    prompt,
    description: prompt,
    source: "task" as const,
    metadata: { role: "root" },
  };
}

function moralEvidence(problem: Problem): TaskEvidenceSeed[] {
  const seeds: TaskEvidenceSeed[] = [];
  const description = problem.moral?.description?.trim();
  if (description) {
    seeds.push({
      alias: "scenario_fact_1",
      aliases: ["scenario_fact_1", "scenario", "scenario fact"],
      text: description,
      subjectId: `${problem.category}:root`,
      origin: "task",
      kind: "scenario_fact",
    });
  }
  for (const [index, issue] of (problem.moral?.issues ?? []).entries()) {
    seeds.push({
      alias: `consideration_${index + 1}`,
      aliases: [`consideration_${index + 1}`, `issue_${index + 1}`],
      text: issue,
      subjectId: `${problem.category}:root`,
      origin: "task",
      kind: "consideration",
    });
  }
  return seeds;
}

function proofEvidence(problem: Problem): TaskEvidenceSeed[] {
  const statement = problem.proof?.question ?? problem.text;
  return [
    {
      alias: "goal",
      aliases: ["goal", "theorem", "statement"],
      text: statement,
      subjectId: `${problem.category}:root`,
      origin: "task",
      kind: "goal",
    },
    {
      alias: "given_1",
      aliases: ["given_1", "given", "premise"],
      text: statement,
      subjectId: `${problem.category}:root`,
      origin: "task",
      kind: "given",
    },
  ];
}

function aliasEvidence(
  seeds: TaskEvidenceSeed[],
  raw: string,
): { id?: string; error?: string } {
  const needle = raw.trim().toLowerCase();
  const matches = seeds.filter((seed) =>
    [seed.alias, ...(seed.aliases ?? [])].some(
      (alias) => alias.trim().toLowerCase() === needle,
    ),
  );
  if (matches.length > 1) return { error: `basis "${raw}" is ambiguous` };
  return {};
}

const moralReasoningAdapter: TaskReasoningAdapter = {
  category: "moral_philosophical",
  getInitialIssues(problem) {
    const prompt =
      problem.moral?.question ?? "What is the morally preferable action?";
    return [rootIssue(problem, "Main moral question", prompt)];
  },
  getInitialEvidence: moralEvidence,
  resolveBasis(problem, graph, raw) {
    const needle = raw.trim().toLowerCase();
    const hits = graph.nodes.filter((node) => {
      if (node.type !== "evidence") return false;
      const aliases = node.metadata?.aliases;
      if (!Array.isArray(aliases)) return false;
      return aliases.some(
        (alias) =>
          typeof alias === "string" && alias.trim().toLowerCase() === needle,
      );
    });
    if (hits.length === 1) return { id: hits[0]!.id, relation: "grounds" };
    if (hits.length > 1) return { error: `basis "${raw}" is ambiguous` };
    return aliasEvidence(moralEvidence(problem), raw);
  },
};

const proofReasoningAdapter: TaskReasoningAdapter = {
  category: "proof",
  getInitialIssues(problem) {
    const prompt = problem.proof?.question ?? problem.text;
    return [rootIssue(problem, "Prove the theorem", prompt)];
  },
  getInitialEvidence: proofEvidence,
  resolveBasis(problem, graph, raw) {
    const needle = raw.trim().toLowerCase();
    const hits = graph.nodes.filter((node) => {
      if (node.type !== "evidence") return false;
      const aliases = node.metadata?.aliases;
      if (!Array.isArray(aliases)) return false;
      return aliases.some(
        (alias) =>
          typeof alias === "string" && alias.trim().toLowerCase() === needle,
      );
    });
    if (hits.length === 1) return { id: hits[0]!.id, relation: "grounds" };
    if (hits.length > 1) return { error: `basis "${raw}" is ambiguous` };
    return aliasEvidence(proofEvidence(problem), raw);
  },
};

export function taskReasoningAdapterFor(
  problem: Problem,
): TaskReasoningAdapter {
  if (problem.category === "crossword" && problem.crossword) {
    return crosswordReasoningAdapter;
  }
  if (problem.category === "moral_philosophical") {
    return moralReasoningAdapter;
  }
  return proofReasoningAdapter;
}
