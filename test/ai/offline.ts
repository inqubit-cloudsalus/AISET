import { resetModelCache } from "../../src/ai/openrouter-models.ts";

/**
 * Takes the OpenRouter key out of the environment for the duration of a test,
 * so the model catalogue answers from `FALLBACK_MODELS` instead of the network.
 * A developer with a real key in `.env` gets the same run as CI.
 */
export function goOffline(): () => void {
  const saved = [process.env.OPENROUTE_API_KEY, process.env.OPENROUTER_API_KEY] as const;
  delete process.env.OPENROUTE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  resetModelCache();
  return () => {
    resetModelCache();
    if (saved[0] !== undefined) process.env.OPENROUTE_API_KEY = saved[0];
    if (saved[1] !== undefined) process.env.OPENROUTER_API_KEY = saved[1];
  };
}
