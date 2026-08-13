import type { AgentId } from "./types";

export function agentLabel(id: AgentId): string {
  return id === "agent_a" ? "Agent A" : "Agent B";
}

export function otherAgentId(id: AgentId): AgentId {
  return id === "agent_a" ? "agent_b" : "agent_a";
}

export function otherAgentLabel(id: AgentId): string {
  return agentLabel(otherAgentId(id));
}
