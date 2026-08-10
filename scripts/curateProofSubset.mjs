/**
 * Curate a compact ProofSolver evaluation subset.
 *
 * Source: WilhelmH/proofsolver-1300 (MIT)
 *   https://huggingface.co/datasets/WilhelmH/proofsolver-1300
 *
 * These are prove-that / with-proof statements. Agents collaborate to write
 * a joint proof. Reference solutions are kept for inspectability only and
 * are never shown in agent prompts or used as objective scores.
 *
 * Usage:
 *   node scripts/curateProofSubset.mjs
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "data/proof/proofsolver_train.jsonl");
const OUTPUT = join(ROOT, "src/problems/data/proofsolver_subset.json");

const MAX_TOTAL = 80;
const MIN_QUESTION = 60;
const MAX_QUESTION = 520;
const MIN_ANSWER = 120;
const MAX_ANSWER = 1200;

function isProofTask(question) {
  const q = question.toLowerCase();
  return (
    /\bprove\b/.test(q) ||
    /\bwith proof\b/.test(q) ||
    /\bshow that\b/.test(q) ||
    /\bgive a proof\b/.test(q)
  );
}

function isUsable(obj) {
  if (!obj?.question || !obj?.answer) return false;
  const question = String(obj.question).trim();
  const answer = String(obj.answer).trim();
  if (!isProofTask(question)) return false;
  if (question.length < MIN_QUESTION || question.length > MAX_QUESTION) {
    return false;
  }
  if (answer.length < MIN_ANSWER || answer.length > MAX_ANSWER) return false;
  return true;
}

function shortTitle(question) {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 64) return cleaned;
  return `${cleaned.slice(0, 61).trimEnd()}…`;
}

async function main() {
  const candidates = [];
  const rl = createInterface({
    input: createReadStream(INPUT, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let sourceIndex = 0;
  for await (const line of rl) {
    if (!line.trim()) {
      sourceIndex += 1;
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      sourceIndex += 1;
      continue;
    }
    if (isUsable(obj)) {
      candidates.push({ sourceIndex, obj });
    }
    sourceIndex += 1;
  }

  const step = Math.max(1, Math.floor(candidates.length / MAX_TOTAL));
  const selected = [];
  for (
    let i = 0;
    i < candidates.length && selected.length < MAX_TOTAL;
    i += step
  ) {
    const { sourceIndex: idx, obj } = candidates[i];
    const question = String(obj.question).trim();
    selected.push({
      id: `proofsolver_${String(selected.length + 1).padStart(4, "0")}`,
      sourceIndex: idx,
      titleHint: shortTitle(question),
      question,
      // Reference proof for research inspectability only — never agent-facing.
      referenceProof: String(obj.answer).trim(),
    });
  }

  selected.forEach((item, i) => {
    item.id = `proofsolver_${String(i + 1).padStart(4, "0")}`;
  });

  const payload = {
    source: {
      name: "ProofSolver-1300",
      huggingface: "WilhelmH/proofsolver-1300",
      split: "train",
      license: "mit",
      url: "https://huggingface.co/datasets/WilhelmH/proofsolver-1300",
      note:
        "Prove-that / with-proof statements. Agents write a joint proof; reference solutions are not used as gold scores.",
    },
    curatedAt: new Date().toISOString().slice(0, 10),
    count: selected.length,
    items: selected,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.count} proofs → ${OUTPUT} (from ${candidates.length} usable / ${sourceIndex} rows)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
