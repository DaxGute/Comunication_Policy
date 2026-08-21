/**
 * Curate a compact Reddit Ethics evaluation subset.
 *
 * Source: agentlans/reddit-ethics (Hugging Face, CC-BY-4.0)
 *   https://huggingface.co/datasets/agentlans/reddit-ethics
 *
 * Uses the full post `text` as the scenario body (not the short
 * `description` summary). Gold answers / resolutions are intentionally
 * NOT included in the problem prompts — these items are open-ended.
 *
 * Usage:
 *   node scripts/curateMoralSubset.mjs
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "data/moral/train.jsonl");
const OUTPUT = join(ROOT, "src/problems/data/reddit_ethics_subset.json");

const MAX_TOTAL = 80;
const MAX_TITLE = 120;
/** Full Reddit post body — keep intact up to a generous prompt budget. */
const MAX_SCENARIO = 12_000;
const MIN_SCENARIO = 200;

function scenarioText(obj) {
  const raw = typeof obj?.text === "string" ? obj.text.trim() : "";
  return raw;
}

function isUsable(obj) {
  if (!obj?.title || !Array.isArray(obj.questions)) return false;
  if (obj.questions.length === 0) return false;
  const scenario = scenarioText(obj);
  if (scenario.length < MIN_SCENARIO || scenario.length > MAX_SCENARIO) {
    return false;
  }
  if (obj.title.length < 8 || obj.title.length > 160) return false;
  return true;
}

function truncate(text, max) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

async function main() {
  const candidates = [];
  const rl = createInterface({
    input: createReadStream(INPUT, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let sourceIndex = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
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

  // Deterministic stride sample across the corpus.
  const step = Math.max(1, Math.floor(candidates.length / MAX_TOTAL));
  const selected = [];
  for (let i = 0; i < candidates.length && selected.length < MAX_TOTAL; i += step) {
    const { sourceIndex: idx, obj } = candidates[i];
    const question = String(obj.questions[0]).trim();
    const scenario = scenarioText(obj);
    selected.push({
      id: `reddit_ethics_${String(selected.length + 1).padStart(4, "0")}`,
      sourceIndex: idx,
      title: truncate(obj.title, MAX_TITLE),
      // Stored as `description` for the app schema; content is the full post.
      description: scenario.length <= MAX_SCENARIO ? scenario : truncate(scenario, MAX_SCENARIO),
      issues: (obj.issues ?? []).slice(0, 4).map(String),
      question,
      // Kept for research inspectability only — never used as gold scoring.
      alternateQuestions: obj.questions.slice(1, 3).map(String),
    });
  }

  const payload = {
    source: {
      name: "Reddit Ethics",
      huggingface: "agentlans/reddit-ethics",
      split: "train",
      license: "cc-by-4.0",
      url: "https://huggingface.co/datasets/agentlans/reddit-ethics",
      note:
        "Curated open-ended ethical dilemmas. Scenario text is the full source post (`text`), not the short summary. Sample answers/resolutions are not used as gold labels.",
    },
    curatedAt: new Date().toISOString().slice(0, 10),
    count: selected.length,
    items: selected,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.count} dilemmas → ${OUTPUT} (from ${candidates.length} usable / ${sourceIndex} rows)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
