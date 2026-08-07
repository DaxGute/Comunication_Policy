/**
 * TheoremQA-style short-answer grading for proof / theorem-driven problems.
 * Inspired by TIGER-Lab/TheoremQA number comparison utilities, without
 * external sympy dependencies.
 */

export type ProofGrade = {
  correct: boolean;
  predictedRaw?: string;
  goldRaw: string;
  predictedNormalized: string;
  goldNormalized: string;
  label: "correct" | "incorrect" | "no_answer" | "parse_error";
  notes?: string;
};

function stripWrapping(text: string): string {
  return text
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\.$/, "")
    .trim();
}

function normalizeBool(text: string): boolean | null {
  const t = stripWrapping(text).toLowerCase();
  if (["true", "yes", "y", "1"].includes(t)) return true;
  if (["false", "no", "n", "0"].includes(t)) return false;
  return null;
}

function parseNumber(text: string): number | null {
  let t = stripWrapping(text);
  t = t.replace(/,/g, "");
  t = t.replace(/\\%/g, "%").replace(/%$/, "");
  t = t.replace(/\$/g, "");
  // Common latex fragments
  t = t.replace(/\\dfrac/g, "").replace(/\\frac/g, "");
  t = t.replace(/[{}]/g, "");
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  // Simple fractions a/b
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (b !== 0 && Number.isFinite(a) && Number.isFinite(b)) return a / b;
  }
  return null;
}

function parseNumberList(text: string): number[] | null {
  let t = stripWrapping(text);
  t = t.replace(/^\(|\)$/g, "");
  if (!t.startsWith("[")) t = `[${t}]`;
  try {
    const parsed: unknown = JSON.parse(t.replace(/'/g, '"'));
    if (!Array.isArray(parsed)) return null;
    const nums = parsed.map((x) => {
      if (typeof x === "number") return x;
      return parseNumber(String(x));
    });
    if (nums.some((n) => n === null)) return null;
    return nums as number[];
  } catch {
    const inner = t.replace(/^\[/, "").replace(/\]$/, "");
    const parts = inner.split(/[, ]+/).filter(Boolean);
    if (parts.length === 0) return null;
    const nums = parts.map(parseNumber);
    if (nums.some((n) => n === null)) return null;
    return nums as number[];
  }
}

function withinEps(pred: number, gold: number): boolean {
  if (Object.is(pred, gold)) return true;
  if (Number.isInteger(gold) && Number.isInteger(pred)) {
    return pred === gold;
  }
  const eps = Math.max(1e-6, Math.abs(gold) * 0.04);
  return Math.abs(pred - gold) <= eps;
}

function listsEqual(a: number[], b: number[], looseFloat: boolean): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) =>
    looseFloat ? withinEps(v, b[i]) : Math.round(v) === Math.round(b[i]),
  );
}

function normalizeOption(text: string): string {
  const t = stripWrapping(text).toLowerCase();
  const letter = t.match(/^([a-d])(?:[).:\s]|$)/);
  if (letter) return letter[1];
  return t.replace(/\s+/g, " ");
}

export function gradeProofAnswer(args: {
  predicted?: string;
  gold: string;
  answerType: string;
}): ProofGrade {
  const goldRaw = args.gold;
  const predictedRaw = args.predicted?.trim();

  if (!predictedRaw) {
    return {
      correct: false,
      goldRaw,
      predictedNormalized: "",
      goldNormalized: stripWrapping(goldRaw),
      label: "no_answer",
      notes: "No FINAL_ANSWER extracted from the transcript.",
    };
  }

  const type = args.answerType;

  if (type === "bool") {
    const p = normalizeBool(predictedRaw);
    const g = normalizeBool(goldRaw);
    if (p === null || g === null) {
      return {
        correct: false,
        predictedRaw,
        goldRaw,
        predictedNormalized: stripWrapping(predictedRaw).toLowerCase(),
        goldNormalized: stripWrapping(goldRaw).toLowerCase(),
        label: "parse_error",
        notes: "Could not parse boolean answer.",
      };
    }
    return {
      correct: p === g,
      predictedRaw,
      goldRaw,
      predictedNormalized: String(p),
      goldNormalized: String(g),
      label: p === g ? "correct" : "incorrect",
    };
  }

  if (type === "integer" || type === "float") {
    const p = parseNumber(predictedRaw);
    const g = parseNumber(goldRaw);
    if (p === null || g === null) {
      return {
        correct: false,
        predictedRaw,
        goldRaw,
        predictedNormalized: stripWrapping(predictedRaw),
        goldNormalized: stripWrapping(goldRaw),
        label: "parse_error",
        notes: "Could not parse numeric answer.",
      };
    }
    const ok =
      type === "integer"
        ? Math.round(p) === Math.round(g)
        : withinEps(p, g);
    return {
      correct: ok,
      predictedRaw,
      goldRaw,
      predictedNormalized: String(p),
      goldNormalized: String(g),
      label: ok ? "correct" : "incorrect",
    };
  }

  if (type === "list of integer" || type === "list of float") {
    const p = parseNumberList(predictedRaw);
    const g = parseNumberList(goldRaw);
    if (!p || !g) {
      return {
        correct: false,
        predictedRaw,
        goldRaw,
        predictedNormalized: stripWrapping(predictedRaw),
        goldNormalized: stripWrapping(goldRaw),
        label: "parse_error",
        notes: "Could not parse list answer.",
      };
    }
    const ok = listsEqual(p, g, type === "list of float");
    return {
      correct: ok,
      predictedRaw,
      goldRaw,
      predictedNormalized: JSON.stringify(p),
      goldNormalized: JSON.stringify(g),
      label: ok ? "correct" : "incorrect",
    };
  }

  // option / fallback: case-insensitive string / option letter
  const pOpt = normalizeOption(predictedRaw);
  const gOpt = normalizeOption(goldRaw);
  const ok = pOpt === gOpt || pOpt.includes(gOpt) || gOpt.includes(pOpt);
  return {
    correct: ok,
    predictedRaw,
    goldRaw,
    predictedNormalized: pOpt,
    goldNormalized: gOpt,
    label: ok ? "correct" : "incorrect",
  };
}
