/**
 * Curate a compact TheoremQA evaluation subset.
 *
 * Source: TIGER-Lab/TheoremQA (MIT)
 *   https://huggingface.co/datasets/TIGER-Lab/TheoremQA
 *   https://github.com/TIGER-AI-Lab/TheoremQA
 *
 * Usage:
 *   node scripts/curateProofSubset.mjs
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "data/proof/theoremqa_test.json");
const OUTPUT = join(ROOT, "src/problems/data/theoremqa_subset.json");

const MAX_TOTAL = 100;
const TARGET_TYPES = {
  integer: 30,
  float: 30,
  bool: 20,
  "list of integer": 12,
  option: 8,
};

function isUsable(item) {
  if (!item?.Question || item.Answer === undefined || item.Answer === null) {
    return false;
  }
  if (item.Picture) return false;
  if (!["Math", "EECS"].includes(item.field)) return false;
  if (item.Question.length < 20 || item.Question.length > 500) return false;
  if (!TARGET_TYPES[item.Answer_type]) return false;
  return true;
}

function serializeAnswer(answer) {
  if (typeof answer === "string") return answer;
  return JSON.stringify(answer);
}

async function main() {
  const raw = JSON.parse(await readFile(INPUT, "utf8"));
  const buckets = new Map();
  for (const type of Object.keys(TARGET_TYPES)) {
    buckets.set(type, []);
  }

  raw.forEach((item, index) => {
    if (!isUsable(item)) return;
    buckets.get(item.Answer_type)?.push({ item, index });
  });

  const selected = [];
  for (const [type, target] of Object.entries(TARGET_TYPES)) {
    const pool = buckets.get(type) ?? [];
    if (pool.length === 0) continue;
    const step = Math.max(1, Math.floor(pool.length / target));
    for (let i = 0; i < pool.length && selected.length < MAX_TOTAL; i += step) {
      const taken = selected.filter((x) => x.answerType === type).length;
      if (taken >= target) break;
      const { item, index } = pool[i];
      selected.push({
        id: `theoremqa_${String(selected.length + 1).padStart(4, "0")}`,
        sourceId: item.id ?? String(index),
        sourceIndex: index,
        question: item.Question.trim(),
        answer: serializeAnswer(item.Answer),
        answerType: item.Answer_type,
        theorem: item.theorem ?? "",
        field: item.field,
        subfield: item.subfield ?? "",
      });
    }
  }

  selected.sort((a, b) => a.sourceIndex - b.sourceIndex);
  selected.forEach((item, i) => {
    item.id = `theoremqa_${String(i + 1).padStart(4, "0")}`;
  });

  const payload = {
    source: {
      name: "TheoremQA",
      huggingface: "TIGER-Lab/TheoremQA",
      paper: "TheoremQA: A Theorem-driven Question Answering dataset (EMNLP 2023)",
      license: "mit",
      url: "https://huggingface.co/datasets/TIGER-Lab/TheoremQA",
      note: "Text-only Math/EECS subset. Short answers are graded; full proofs are not required for the score.",
    },
    curatedAt: new Date().toISOString().slice(0, 10),
    count: selected.length,
    items: selected,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const hist = {};
  for (const item of selected) {
    hist[item.answerType] = (hist[item.answerType] ?? 0) + 1;
  }
  console.log(`Wrote ${payload.count} items → ${OUTPUT}`);
  console.log("Type histogram:", hist);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
