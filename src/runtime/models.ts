/**
 * Canonical model registry for the experiment workbench.
 * Keep mock vs real OpenAI IDs explicit so the UI never implies unwired providers.
 */

export type ModelProvider = "mock" | "openai";

export type ModelOption = {
  id: string;
  label: string;
  provider: ModelProvider;
};

/** Default OpenAI chat model for preliminary two-agent runs. */
export const OPENAI_MODEL_ID = "gpt-4o-mini" as const;

export const MOCK_MODEL_ID = "mock-deterministic" as const;

/**
 * OpenAI models selectable in the workbench.
 * Only IDs listed here are accepted by the UI and `/api/generate` proxy.
 */
export const OPENAI_MODELS = [
  { id: "gpt-5-nano", label: "OpenAI — gpt-5-nano" },
  { id: "gpt-4.1-nano", label: "OpenAI — gpt-4.1-nano" },
  { id: "gpt-4o-mini", label: "OpenAI — gpt-4o-mini" },
  { id: "gpt-5-mini", label: "OpenAI — gpt-5-mini" },
  { id: "gpt-4.1-mini", label: "OpenAI — gpt-4.1-mini" },
  { id: "gpt-4o", label: "OpenAI — gpt-4o" },
  { id: "gpt-5", label: "OpenAI — gpt-5" },
] as const satisfies readonly { id: string; label: string }[];

export type OpenAIModelId = (typeof OPENAI_MODELS)[number]["id"];

/** Models shown in the run-settings picker (OpenAI only for real experiments). */
export const AVAILABLE_MODELS: readonly ModelOption[] = OPENAI_MODELS.map(
  (m) => ({
    id: m.id,
    label: m.label,
    provider: "openai" as const,
  }),
);

export const AVAILABLE_MODEL_IDS: readonly string[] = AVAILABLE_MODELS.map(
  (m) => m.id,
);

const OPENAI_MODEL_IDS = new Set<string>(OPENAI_MODELS.map((m) => m.id));

export function isMockModel(model: string): boolean {
  return model === MOCK_MODEL_ID || model.startsWith("mock");
}

export function isOpenAIModel(model: string): boolean {
  return OPENAI_MODEL_IDS.has(model);
}

export function supportedOpenAIModelList(): string {
  return OPENAI_MODELS.map((m) => m.id).join(", ");
}

export function providerForModel(model: string): ModelProvider {
  if (isMockModel(model)) return "mock";
  if (isOpenAIModel(model)) return "openai";
  throw new Error(`Unsupported model: ${model}`);
}

export function labelForModel(model: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === model)?.label ?? model;
}
