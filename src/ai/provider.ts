/**
 * Model access for AISET's *own* small calls — classifying a run failure,
 * summarising an event stream, validating an artifact against a schema.
 *
 * This is deliberately NOT a second agent runtime. OpenCode remains the execution
 * engine for agent runs (charter §4.2, open-source-engine-only). Anything that
 * *performs* engineering work goes through the OpenCode adapter, never through here.
 *
 * Wired but not yet used by a feature: the first consumer arrives with the adapter.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { readConfig } from "../core/config.ts";
import { AisetError } from "../core/errors.ts";

export type ProviderName = "anthropic" | "openai" | "openrouter";

export const PROVIDER_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTE_API_KEY",
};

/** Also-accepted spellings, tried in order after the name in `PROVIDER_ENV`. */
const PROVIDER_ENV_ALIASES: Partial<Record<ProviderName, string[]>> = {
  openrouter: ["OPENROUTER_API_KEY"],
};

export const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-5",
};

/** OpenRouter speaks the OpenAI wire protocol, so it rides the OpenAI client. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** First non-empty key among the provider's env var and its aliases. */
function readApiKey(provider: ProviderName): string | undefined {
  for (const name of [PROVIDER_ENV[provider], ...(PROVIDER_ENV_ALIASES[provider] ?? [])]) {
    const value = process.env[name] ?? "";
    if (value !== "") return value;
  }
  return undefined;
}

export interface ModelSelection {
  provider: ProviderName;
  model: string;
}

/** True when the provider's key is in the environment. The value is never returned. */
export function hasCredentials(provider: ProviderName): boolean {
  return readApiKey(provider) !== undefined;
}

/**
 * Reads the engine's `provider/model` id as one of AISET's own selections.
 * Splits on the first slash, exactly like `splitModel` in the OpenCode client,
 * so `openrouter/anthropic/claude-sonnet-4.5` keeps its vendor. Returns null
 * when the prefix names no provider we can actually call.
 */
export function selectionFromEngineModel(id: string): ModelSelection | null {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  const provider = id.slice(0, slash);
  if (!(provider in PROVIDER_ENV)) return null;
  return { provider: provider as ProviderName, model: id.slice(slash + 1) };
}

/**
 * Resolves the model to use, overridable per call.
 *
 * The model chosen for runs (`opencode.model`, what `/model` writes) wins:
 * one pick drives both the agents and AISET's own calls, which is the whole
 * point of having a single model setting. It is only skipped when its key is
 * absent, in which case the top-level `provider`/`model` pair answers instead.
 * Keys are read from the environment only — never from config, never logged.
 */
export async function resolveSelection(
  override: Partial<ModelSelection> = {},
  root = process.cwd(),
): Promise<ModelSelection> {
  const config = await readConfig(root).catch(() => null);
  if (override.provider === undefined && override.model === undefined) {
    const engine = config?.opencode.model ? selectionFromEngineModel(config.opencode.model) : null;
    if (engine && hasCredentials(engine.provider)) return engine;
  }
  const provider = override.provider ?? config?.provider ?? "anthropic";
  return { provider, model: override.model ?? config?.model ?? DEFAULT_MODEL[provider] };
}

export function getModel(selection: ModelSelection): LanguageModel {
  const apiKey = readApiKey(selection.provider);
  if (!apiKey) {
    throw new AisetError(
      `${PROVIDER_ENV[selection.provider]} is not set`,
      `export ${PROVIDER_ENV[selection.provider]} before using AISET's model calls`,
    );
  }
  switch (selection.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(selection.model);
    case "openai":
      return createOpenAI({ apiKey })(selection.model);
    case "openrouter":
      return createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })(selection.model);
  }
}

/** Convenience: config-driven model, ready to hand to `generateObject` / `streamText`. */
export async function defaultModel(root = process.cwd()): Promise<LanguageModel> {
  return getModel(await resolveSelection({}, root));
}
