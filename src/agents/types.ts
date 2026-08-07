export type AgentId = "agent_a" | "agent_b";

/**
 * Minimal runtime representation of an agent.
 * Identity is problem-independent; interaction behavior comes from the policy.
 */
export type AgentDefinition = {
  id: AgentId;
  label: string;
  systemPrompt: string;
};

export type AgentPromptPair = {
  agentA: string;
  agentB: string;
};
