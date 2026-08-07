export type {
  AuthorityRelation,
  CommunicationPolicy,
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
  authorityRelationFromValue,
  bandFromValue,
  describeAuthoritySlider,
} from "./descriptions";
