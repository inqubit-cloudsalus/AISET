/**
 * The OpenRouter model catalogue, used by `/model` to offer a choice instead of
 * asking the user to remember an id. Purely descriptive: nothing here performs
 * a model call, it only names what OpenRouter will accept.
 *
 * The live fetch needs the OpenRouter key — without one no OpenRouter model can
 * be run anyway, so an unkeyed shell gets `FALLBACK_MODELS` instead of a round
 * trip. The key is sent as a bearer header and never returned or logged.
 */
import { z } from "zod";
import { hasCredentials, OPENROUTER_BASE_URL, PROVIDER_ENV } from "./provider.ts";

export interface OpenRouterModel {
  /** `vendor/model`, exactly as OpenRouter expects it. */
  id: string;
  name: string;
  contextLength: number | null;
}

/** Where the list came from — shown to the user so a stale list is never silent. */
export interface ModelCatalogue {
  models: OpenRouterModel[];
  source: "live" | "fallback";
  /** Why the live fetch was not used. Present only when `source` is "fallback". */
  reason?: string;
}

/** Enough to work offline or without a key. Deliberately short, not a mirror. */
export const FALLBACK_MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Anthropic: Claude Sonnet 4.5",
    contextLength: 200_000,
  },
  { id: "anthropic/claude-opus-4.1", name: "Anthropic: Claude Opus 4.1", contextLength: 200_000 },
  { id: "anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5", contextLength: 200_000 },
  { id: "openai/gpt-5", name: "OpenAI: GPT-5", contextLength: 400_000 },
  { id: "openai/gpt-5-mini", name: "OpenAI: GPT-5 mini", contextLength: 400_000 },
  { id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro", contextLength: 1_048_576 },
  { id: "google/gemini-2.5-flash", name: "Google: Gemini 2.5 Flash", contextLength: 1_048_576 },
  { id: "deepseek/deepseek-chat", name: "DeepSeek: DeepSeek V3", contextLength: 64_000 },
  { id: "qwen/qwen3-coder", name: "Qwen: Qwen3 Coder", contextLength: 262_144 },
  { id: "x-ai/grok-4", name: "xAI: Grok 4", contextLength: 256_000 },
];

const ResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().optional(),
      context_length: z.number().nullish(),
    }),
  ),
});

export interface ListModelsOptions {
  /** Injected in tests so no test ever reaches the network. */
  fetchImpl?: typeof fetch;
  /** Skips the module-level cache. */
  refresh?: boolean;
}

let cached: Promise<ModelCatalogue> | null = null;

/** Drops the memoised catalogue. Tests call this between cases. */
export function resetModelCache(): void {
  cached = null;
}

/**
 * Never rejects: a catalogue the user cannot see is worse than a short one, so
 * every failure resolves to `FALLBACK_MODELS` with the reason attached.
 */
export async function listOpenRouterModels(opts: ListModelsOptions = {}): Promise<ModelCatalogue> {
  const fetchImpl = opts.fetchImpl;
  if (fetchImpl) return fetchCatalogue(fetchImpl, false);
  if (opts.refresh) cached = null;
  cached ??= fetchCatalogue(fetch);
  const result = await cached;
  // A fallback is not worth caching — the network may be back by the next open.
  if (result.source === "fallback") cached = null;
  return result;
}

async function fetchCatalogue(fetchImpl: typeof fetch, requireKey = true): Promise<ModelCatalogue> {
  const key = process.env[PROVIDER_ENV.openrouter] || process.env.OPENROUTER_API_KEY;
  if (requireKey && (!hasCredentials("openrouter") || !key)) {
    // Without a key no OpenRouter model can be run anyway, so there is nothing
    // to gain from the round trip — and tests stay off the network by default.
    return fallback(`${PROVIDER_ENV.openrouter} is not set`);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    const response = await fetchImpl(`${OPENROUTER_BASE_URL}/models`, { headers });
    if (!response.ok) {
      return fallback(`openrouter returned HTTP ${response.status}`);
    }
    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) return fallback("openrouter returned an unexpected payload");
    const models = parsed.data.data
      .map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        contextLength: entry.context_length ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (models.length === 0) return fallback("openrouter listed no models");
    return { models, source: "live" };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}

function fallback(reason: string): ModelCatalogue {
  return { models: FALLBACK_MODELS, source: "fallback", reason };
}
