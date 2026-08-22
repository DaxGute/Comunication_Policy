import { loadHiddenProfileProblems } from "./hidden_profile/loadHiddenProfile";

/** Hidden Profile pool: official HiddenBench (65 tasks), dyadically adapted. */
export const HIDDEN_PROFILE_PROBLEMS = loadHiddenProfileProblems();
