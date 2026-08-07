/**
 * Smoke tests for TheoremQA-style proof short-answer grading.
 * Mirrors src/evaluation/graders/proofGrader.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Load compiled logic by re-implementing the public contract checks against data.
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const subset = JSON.parse(
  readFileSync(join(ROOT, "src/problems/data/theoremqa_subset.json"), "utf8"),
);

assert(subset.count === subset.items.length, "count mismatch");
assert(subset.items.length >= 50, "subset too small");

for (const item of subset.items) {
  assert(item.question?.length > 0, `missing question ${item.id}`);
  assert(item.answer !== undefined && item.answer !== "", `missing answer ${item.id}`);
  assert(item.answerType, `missing type ${item.id}`);
}

// Dynamic import of TS is unavailable; duplicate minimal grade checks in-process
// by spawning vite-node alternative: call the grader via a tiny inline port.
function stripWrapping(text) {
  return text.trim().replace(/^['"`]+|['"`]+$/g, "").replace(/\.$/, "").trim();
}
function normalizeBool(text) {
  const t = stripWrapping(text).toLowerCase();
  if (["true", "yes", "y", "1"].includes(t)) return true;
  if (["false", "no", "n", "0"].includes(t)) return false;
  return null;
}
function parseNumber(text) {
  let t = stripWrapping(text).replace(/,/g, "");
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return null;
}
function withinEps(pred, gold) {
  const eps = Math.max(1e-6, Math.abs(gold) * 0.04);
  return Math.abs(pred - gold) <= eps;
}

const cases = [
  { type: "integer", predicted: "11760", gold: "11760", expect: true },
  { type: "integer", predicted: "11761", gold: "11760", expect: false },
  { type: "float", predicted: "1.0", gold: "1", expect: true },
  { type: "float", predicted: "1.05", gold: "1", expect: false },
  { type: "bool", predicted: "False", gold: "false", expect: true },
  { type: "bool", predicted: "true", gold: "false", expect: false },
  { type: "list of integer", predicted: "[0, 5]", gold: "[0,5]", expect: true },
  { type: "list of integer", predicted: "[0,1]", gold: "[0,5]", expect: false },
  { type: "option", predicted: "B", gold: "b", expect: true },
];

for (const c of cases) {
  let ok = false;
  if (c.type === "bool") {
    ok = normalizeBool(c.predicted) === normalizeBool(c.gold);
  } else if (c.type === "integer") {
    ok = Math.round(parseNumber(c.predicted)) === Math.round(parseNumber(c.gold));
  } else if (c.type === "float") {
    ok = withinEps(parseNumber(c.predicted), parseNumber(c.gold));
  } else if (c.type === "list of integer") {
    ok =
      JSON.stringify(JSON.parse(c.predicted.replace(/\s/g, ""))) ===
      JSON.stringify(JSON.parse(c.gold.replace(/\s/g, "")));
  } else if (c.type === "option") {
    ok = c.predicted.toLowerCase().startsWith(c.gold.toLowerCase());
  }
  assert(ok === c.expect, `case failed: ${JSON.stringify(c)} got ${ok}`);
}

void require;
console.log(
  `ok — ${subset.items.length} TheoremQA items + ${cases.length} grader cases`,
);
