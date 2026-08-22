export type {
  HiddenProfileOverlapTreatment,
  InformationAssignment,
  InformationAssignmentMode,
  InformationFlowMetrics,
  InformationOriginalOwner,
  InformationOverlap,
  InformationPacketDirection,
  InformationRealizedVisibility,
  InformationSplitDiagnostics,
  InformationSplitResult,
  InformationStructureConfig,
  InformationUnit,
  InformationUnitType,
  ProblemInformationStructure,
} from "./types";
export { INFORMATION_OVERLAP_STEPS } from "./types";

export {
  clampInformationOverlap,
  hashStringToSeed,
  MIN_INFORMATION_OVERLAP,
  MAX_INFORMATION_OVERLAP,
  mulberry32,
  seededShuffle,
  snapInformationOverlap,
  splitInformationUnits,
  validateInformationSplit,
} from "./split";

export {
  buildHiddenProfilePromotionSeed,
  clampHiddenProfileOverlap,
  distinctPromotionLevels,
  HIDDEN_PROFILE_OVERLAP_STEPS,
  MAX_HIDDEN_PROFILE_OVERLAP,
  MIN_HIDDEN_PROFILE_OVERLAP,
  promoteCountForOverlap,
  snapHiddenProfileOverlap,
  splitHiddenProfileUnits,
} from "./hiddenProfileOverlap";

export {
  assignProblemInformation,
  buildInformationSplitSeed,
  createInformationDrawNonce,
  formatInformationPacket,
  getInformationUnits,
  getProblemInformationStructure,
  getSharedContext,
  segmentMoralInformationUnits,
} from "./assign";

export {
  buildPrivateInformationFlowTable,
  computeInformationFlowMetrics,
  unitVisibleToAgent,
} from "./metrics";
export type { PrivateInformationFlowRow } from "./metrics";

import type { ProblemCategory } from "../problems/types";
import {
  clampInformationOverlap,
  snapInformationOverlap,
} from "./split";
import {
  clampHiddenProfileOverlap,
  HIDDEN_PROFILE_OVERLAP_STEPS,
  snapHiddenProfileOverlap,
} from "./hiddenProfileOverlap";
import { INFORMATION_OVERLAP_STEPS } from "./types";

/** Category-aware clamp for the information-overlap control. */
export function clampOverlapForCategory(
  overlap: number,
  category: ProblemCategory | undefined,
): number {
  if (category === "hidden_profile") {
    return clampHiddenProfileOverlap(overlap);
  }
  return clampInformationOverlap(overlap);
}

/** Category-aware snap onto the discrete UI grid. */
export function snapOverlapForCategory(
  overlap: number,
  category: ProblemCategory | undefined,
): number {
  if (category === "hidden_profile") {
    return snapHiddenProfileOverlap(overlap, HIDDEN_PROFILE_OVERLAP_STEPS);
  }
  return snapInformationOverlap(overlap, INFORMATION_OVERLAP_STEPS);
}
