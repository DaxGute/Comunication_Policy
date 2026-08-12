/**
 * Canonical model registry — single source of truth for IDs, pricing,
 * capability tiers, and which surfaces may select each model.
 */

export type ModelTier = "cheap" | "recommended" | "max" | "baseline";

export type ReasoningEffort = "low" | "medium" | "high";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
] as const;

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export interface ModelDefinition {
  id: string;
  displayName: string;
  tier: ModelTier;
  shortLabel: string;
  description: string;
  /** Longer blurb for the info affordance. */
  infoBlurb: string;
  inputPricePerMillion: number;
  cachedInputPricePerMillion?: number;
  outputPricePerMillion: number;
  contextWindow?: number;
  supportsReasoningEffort?: boolean;
  defaultForRun?: boolean;
  defaultForEvaluation?: boolean;
  enabledForRun: boolean;
  enabledForEvaluation: boolean;
}

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  {
    id: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    tier: "cheap",
    shortLabel: "$",
    description: "Fast / cheap — best for large experimental sweeps",
    infoBlurb: "Optimized for inexpensive high-volume runs.",
    inputPricePerMillion: 1.0,
    cachedInputPricePerMillion: 0.1,
    outputPricePerMillion: 6.0,
    contextWindow: 1_050_000,
    supportsReasoningEffort: true,
    enabledForRun: true,
    enabledForEvaluation: true,
  },
  {
    id: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    tier: "recommended",
    shortLabel: "$$",
    description: "Recommended — strong capability / cost tradeoff",
    infoBlurb: "Strong capability/cost tradeoff.",
    inputPricePerMillion: 2.5,
    cachedInputPricePerMillion: 0.25,
    outputPricePerMillion: 15.0,
    contextWindow: 1_050_000,
    supportsReasoningEffort: true,
    defaultForRun: true,
    defaultForEvaluation: true,
    enabledForRun: true,
    enabledForEvaluation: true,
  },
  {
    id: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    tier: "max",
    shortLabel: "$$$",
    description: "Maximum capability — use as an upper-bound condition",
    infoBlurb: "Use as a high-capability experimental condition.",
    inputPricePerMillion: 5.0,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 30.0,
    contextWindow: 1_050_000,
    supportsReasoningEffort: true,
    enabledForRun: true,
    enabledForEvaluation: true,
  },
  {
    id: "gpt-5.4-nano",
    displayName: "GPT-5.4 Nano",
    tier: "baseline",
    shortLabel: "$",
    description: "Weak / inexpensive baseline",
    infoBlurb: "Weak / inexpensive baseline for capability floor comparisons.",
    inputPricePerMillion: 0.2,
    outputPricePerMillion: 1.25,
    supportsReasoningEffort: true,
    enabledForRun: true,
    enabledForEvaluation: true,
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    tier: "baseline",
    shortLabel: "$",
    description: "Legacy inexpensive baseline",
    infoBlurb: "Legacy inexpensive baseline.",
    inputPricePerMillion: 0.25,
    outputPricePerMillion: 2.0,
    supportsReasoningEffort: true,
    enabledForRun: true,
    enabledForEvaluation: true,
  },
] as const;

const BY_ID = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));

export const MOCK_MODEL_ID = "mock-deterministic" as const;

export const DEFAULT_RUN_MODEL_ID =
  MODEL_REGISTRY.find((m) => m.defaultForRun)?.id ?? "gpt-5.6-terra";

export const DEFAULT_EVALUATION_MODEL_ID =
  MODEL_REGISTRY.find((m) => m.defaultForEvaluation)?.id ?? "gpt-5.6-terra";

/** @deprecated Prefer DEFAULT_RUN_MODEL_ID */
export const OPENAI_MODEL_ID = DEFAULT_RUN_MODEL_ID;

export function getModelDefinition(
  modelId: string,
): ModelDefinition | undefined {
  return BY_ID.get(modelId);
}

export function isRegisteredModel(modelId: string): boolean {
  return BY_ID.has(modelId);
}

export function isMockModel(modelId: string): boolean {
  return modelId === MOCK_MODEL_ID || modelId.startsWith("mock");
}

/** Any non-mock ID accepted by the OpenAI proxy (registry models). */
export function isOpenAIModel(modelId: string): boolean {
  return isRegisteredModel(modelId);
}

export function modelsForRun(): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.enabledForRun);
}

export function modelsForEvaluation(): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => m.enabledForEvaluation);
}

export type ModelSelectGroup = {
  id: string;
  label: string;
  models: ModelDefinition[];
};

/** Grouped options for conversation / evaluation selectors. */
export function modelSelectGroups(
  purpose: "run" | "evaluation",
): ModelSelectGroup[] {
  const list = purpose === "run" ? modelsForRun() : modelsForEvaluation();
  const primary = list.filter((m) => m.tier !== "baseline");
  const baselines = list.filter((m) => m.tier === "baseline");
  const groups: ModelSelectGroup[] = [];
  if (primary.length > 0) {
    groups.push({ id: "gpt-5.6", label: "GPT-5.6", models: primary });
  }
  if (baselines.length > 0) {
    groups.push({ id: "baselines", label: "Baselines", models: baselines });
  }
  return groups;
}

export function displayNameForModel(modelId: string): string {
  return getModelDefinition(modelId)?.displayName ?? modelId;
}

export function shortLabelForModel(modelId: string): string {
  return getModelDefinition(modelId)?.shortLabel ?? "";
}

export function tierLabel(tier: ModelTier): string {
  switch (tier) {
    case "cheap":
      return "Fast / cheap";
    case "recommended":
      return "Recommended";
    case "max":
      return "Maximum capability";
    case "baseline":
      return "Baseline";
  }
}

export function formatReasoningEffort(effort: ReasoningEffort): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * GPT-5 and OpenAI reasoning families reject non-default temperature.
 * Only the API default (1) is accepted — the parameter must be omitted.
 */
export function modelSupportsCustomTemperature(model: string): boolean {
  return !/^(gpt-5|o1|o3|o4)([.-]|$)/i.test(model);
}

export function modelSupportsReasoningEffort(modelId: string): boolean {
  return getModelDefinition(modelId)?.supportsReasoningEffort === true;
}

export function supportedOpenAIModelList(): string {
  return MODEL_REGISTRY.map((m) => m.id).join(", ");
}

export type ModelProvider = "mock" | "openai";

export function providerForModel(model: string): ModelProvider {
  if (isMockModel(model)) return "mock";
  if (isOpenAIModel(model)) return "openai";
  // Historical / unknown IDs: treat as openai so old runs still render.
  if (!model.startsWith("mock")) return "openai";
  throw new Error(`Unsupported model: ${model}`);
}

/** UI option shape kept for older imports. */
export type ModelOption = {
  id: string;
  label: string;
  provider: ModelProvider;
};

export const AVAILABLE_MODELS: readonly ModelOption[] = MODEL_REGISTRY.filter(
  (m) => m.enabledForRun || m.enabledForEvaluation,
).map((m) => ({
  id: m.id,
  label: m.displayName,
  provider: "openai" as const,
}));

export const AVAILABLE_MODEL_IDS: readonly string[] = AVAILABLE_MODELS.map(
  (m) => m.id,
);

/** @deprecated Prefer displayNameForModel */
export function labelForModel(model: string): string {
  return displayNameForModel(model);
}

/** Flat list formerly used by smoke tests. */
export const OPENAI_MODELS = MODEL_REGISTRY.map((m) => ({
  id: m.id,
  label: m.displayName,
}));

export type OpenAIModelId = (typeof MODEL_REGISTRY)[number]["id"];
