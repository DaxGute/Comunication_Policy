/**
 * Client/server factory for a queued run snapshot shown immediately on Run.
 *
 * Server execution still owns conversations and progress after create; this
 * only gives the UI a stable id + queued record before the HTTP round-trip.
 */
import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../communication/policy";
import type { CommunicationPolicy } from "../communication/types";
import { emptyUsage } from "../models/usage";
import { FULL_HISTORY_TRANSCRIPT_PROTOCOL } from "./transcriptProtocol";
import type { ExperimentRun, RunConfig } from "./types";

const CLIENT_RUN_ID = /^run_[a-z0-9]+_[a-z0-9]+$/;

export function isClientRunId(id: string): boolean {
  return id.length <= 64 && CLIENT_RUN_ID.test(id);
}

export function createQueuedRun(args: {
  id: string;
  policy: CommunicationPolicy;
  config: RunConfig;
  createdAt?: string;
}): ExperimentRun {
  const policy = createCommunicationPolicy(args.policy);
  const config: RunConfig = { ...args.config };
  return {
    id: args.id,
    createdAt: args.createdAt ?? new Date().toISOString(),
    status: "queued",
    policy,
    agentPrompts: buildAgentPromptPair(policy),
    transcriptProtocol: { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL },
    config,
    conversations: [],
    conversationUsage: emptyUsage(),
    conversationCostUsd: null,
    evaluationUsage: emptyUsage(),
    evaluationCostUsd: null,
    totalCostUsd: null,
    progress: {
      fraction: 0,
      completedProblems: 0,
      totalProblems: Math.max(1, config.problemCount),
    },
  };
}
