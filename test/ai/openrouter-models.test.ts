import { describe, expect, test } from "bun:test";
import {
  FALLBACK_MODELS,
  listOpenRouterModels,
  resetModelCache,
} from "../../src/ai/openrouter-models.ts";

const PAYLOAD = {
  data: [
    { id: "openai/gpt-5", name: "OpenAI: GPT-5", context_length: 400000 },
    {
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      context_length: 200000,
    },
    { id: "vendor/no-context", context_length: null },
  ],
};

function jsonResponse(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("openrouter model catalogue", () => {
  test("maps a live payload, sorts by id and tolerates a missing name", async () => {
    resetModelCache();
    const catalogue = await listOpenRouterModels({ fetchImpl: jsonResponse(PAYLOAD) });
    expect(catalogue.source).toBe("live");
    expect(catalogue.reason).toBeUndefined();
    expect(catalogue.models.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5",
      "vendor/no-context",
    ]);
    expect(catalogue.models[2]).toEqual({
      id: "vendor/no-context",
      name: "vendor/no-context",
      contextLength: null,
    });
  });

  test("a non-200 falls back with the status in the reason", async () => {
    resetModelCache();
    const catalogue = await listOpenRouterModels({ fetchImpl: jsonResponse({}, 500) });
    expect(catalogue.source).toBe("fallback");
    expect(catalogue.reason).toContain("500");
    expect(catalogue.models).toEqual(FALLBACK_MODELS);
  });

  test("an unexpected payload falls back rather than throwing", async () => {
    resetModelCache();
    const catalogue = await listOpenRouterModels({ fetchImpl: jsonResponse({ models: [] }) });
    expect(catalogue.source).toBe("fallback");
    expect(catalogue.models).toEqual(FALLBACK_MODELS);
  });

  test("a network error falls back rather than throwing", async () => {
    resetModelCache();
    const boom = (async () => {
      throw new Error("getaddrinfo ENOTFOUND openrouter.ai");
    }) as unknown as typeof fetch;
    const catalogue = await listOpenRouterModels({ fetchImpl: boom });
    expect(catalogue.source).toBe("fallback");
    expect(catalogue.reason).toContain("ENOTFOUND");
  });

  test("the key is never carried into the returned catalogue", async () => {
    resetModelCache();
    process.env.OPENROUTE_API_KEY = "sk-or-secret-value";
    try {
      const catalogue = await listOpenRouterModels({ fetchImpl: jsonResponse(PAYLOAD) });
      expect(JSON.stringify(catalogue)).not.toContain("sk-or-secret-value");
    } finally {
      delete process.env.OPENROUTE_API_KEY;
    }
  });

  test("every fallback id is in vendor/model form", () => {
    for (const model of FALLBACK_MODELS) {
      expect(model.id.split("/").length).toBe(2);
    }
  });
});
