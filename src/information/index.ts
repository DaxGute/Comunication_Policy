export type {
  InformationAssignment,
  InformationAssignmentMode,
  InformationFlowMetrics,
  InformationOverlap,
  InformationPacketDirection,
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
  snapInformationOverlap,
  splitInformationUnits,
  validateInformationSplit,
} from "./split";

export {
  assignProblemInformation,
  buildInformationSplitSeed,
  createInformationDrawNonce,
  formatInformationPacket,
  getInformationUnits,
  getProblemInformationStructure,
  getSharedContext,
  segmentMoralInformationUnits,
  segmentProofInformationUnits,
} from "./assign";

export {
  computeInformationFlowMetrics,
  unitVisibleToAgent,
} from "./metrics";
