/**
 * Post-hoc evaluator composition.
 *
 * Every current and future task uses MARBLE + the universal interaction
 * evaluator. Belief/moral components remain only so legacy records load.
 */
import type { ProblemCategory } from "../../problems/types";

export const POSTHOC_COMPONENT_IDS = [
  "marble",
  "belief",
  "moral_dynamics",
  "interaction",
] as const;

export type PostHocComponentId = (typeof POSTHOC_COMPONENT_IDS)[number];

export type PostHocProfile = {
  id: string;
  components: PostHocComponentId[];
};

const UNIVERSAL: PostHocProfile = {
  id: "universal",
  components: ["marble", "interaction"],
};

export function postHocProfileFor(
  _category?: ProblemCategory | string,
): PostHocProfile {
  return UNIVERSAL;
}

export function profileIncludes(
  profile: PostHocProfile,
  component: PostHocComponentId,
): boolean {
  return profile.components.includes(component);
}
