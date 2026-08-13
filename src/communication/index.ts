export type {
  AuthorityRelation,
  CommunicationPolicy,
  CompiledAgentPolicy,
  CompiledCommunicationPolicy,
  PolicyBand,
} from "./types";
export {
  DEFAULT_COMMUNICATION_POLICY,
  assertValidPolicy,
  authorityWeightA,
  authorityWeightB,
  clamp01,
  createCommunicationPolicy,
  formatPolicyValue,
} from "./policy";
export { compileCommunicationPolicy } from "./compilePolicy";
export {
  BAND_HIGH_MIN,
  BAND_LOW_MAX,
  authorityRelationFromValue,
  bandFromValue,
  describeAuthoritySlider,
} from "./descriptions";
