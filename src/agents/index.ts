export type { AgentId, AgentDefinition, AgentPromptPair } from "./types";
export { agentLabel, otherAgentId, otherAgentLabel } from "./identity";
export {
  IDENTITY_HEADER,
  TASK_HEADER,
  POLICY_HEADER,
  PROTOCOL_HEADER,
  REASONING_HEADER,
  buildAgentPrompt,
  buildAgentDefinition,
  agentDefinitionFromPrompt,
  buildAgentPromptPair,
  splitAgentPromptLayers,
} from "./buildAgentPrompt";
export type { AgentPromptLayers } from "./buildAgentPrompt";
