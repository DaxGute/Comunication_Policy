import { normalizeMarbleResult } from "./adapter";
import type { MarbleEvaluation } from "../types";

/** Re-export normalization for the marble package surface. */
export function normalize(raw: unknown): MarbleEvaluation {
  return normalizeMarbleResult(raw);
}
