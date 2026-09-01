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

export type ProviderName = "anthropic" | "openai";

export const PROVIDER_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
};

export interface ModelSelection {
  provider: ProviderName;
  model: string;
}

/** True when the provider's key is in the environment. The value is never returned. */
export function hasCredentials(provider: ProviderName): boolean {
  return (process.env[PROVIDER_ENV[provider]] ?? "") !== "";
}

/**
 * Resolves the model to use from `.aiset/config.json`, overridable per call.
 * Reads the API key from the environment only — never from config, never logged.
 */
export async function resolveSelection(
  override: Partial<ModelSelection> = {},
  root = process.cwd(),
): Promise<ModelSelection> {
  const config = await readConfig(root).catch(() => null);
  const provider = override.provider ?? config?.provider ?? "anthropic";
  return { provider, model: override.model ?? config?.model ?? DEFAULT_MODEL[provider] };
}

export function getModel(selection: ModelSelection): LanguageModel {
  const apiKey = process.env[PROVIDER_ENV[selection.provider]];
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
  }
}

/** Convenience: config-driven model, ready to hand to `generateObject` / `streamText`. */
export async function defaultModel(root = process.cwd()): Promise<LanguageModel> {
  return getModel(await resolveSelection({}, root));
}
