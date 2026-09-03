import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSelection, selectionFromEngineModel } from "../../src/ai/provider.ts";
import { defaultConfig, updateConfig, writeConfigIfAbsent } from "../../src/core/config.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "aiset-provider-"));
  await writeConfigIfAbsent(defaultConfig("provider-test"), root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("selectionFromEngineModel", () => {
  test("splits on the first slash so an OpenRouter vendor survives", () => {
    expect(selectionFromEngineModel("openrouter/anthropic/claude-sonnet-4.5")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
    });
    expect(selectionFromEngineModel("anthropic/claude-sonnet-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  test("rejects anything that is not <known provider>/<model>", () => {
    expect(selectionFromEngineModel("gpt-5")).toBeNull();
    expect(selectionFromEngineModel("ollama/llama3")).toBeNull();
    expect(selectionFromEngineModel("/leading")).toBeNull();
    expect(selectionFromEngineModel("trailing/")).toBeNull();
  });
});

describe("resolveSelection", () => {
  test("the model /model picked wins over the top-level pair", async () => {
    process.env.OPENROUTE_API_KEY = "sk-or-test";
    try {
      await updateConfig(
        (config) => ({
          ...config,
          opencode: { ...config.opencode, model: "openrouter/anthropic/claude-sonnet-4.5" },
        }),
        root,
      );
      // The top-level pair still says anthropic/claude-sonnet-5 here.
      expect(await resolveSelection({}, root)).toEqual({
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
      });
    } finally {
      delete process.env.OPENROUTE_API_KEY;
    }
  });

  test("falls back to the top-level pair when the engine model's key is absent", async () => {
    delete process.env.OPENROUTE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    await updateConfig(
      (config) => ({
        ...config,
        opencode: { ...config.opencode, model: "openrouter/anthropic/claude-sonnet-4.5" },
      }),
      root,
    );
    expect(await resolveSelection({}, root)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });

  test("an explicit override beats everything", async () => {
    process.env.OPENROUTE_API_KEY = "sk-or-test";
    try {
      await updateConfig(
        (config) => ({
          ...config,
          opencode: { ...config.opencode, model: "openrouter/anthropic/claude-sonnet-4.5" },
        }),
        root,
      );
      expect(await resolveSelection({ provider: "openai", model: "gpt-5" }, root)).toEqual({
        provider: "openai",
        model: "gpt-5",
      });
    } finally {
      delete process.env.OPENROUTE_API_KEY;
    }
  });

  test("a config with no engine model keeps the top-level pair", async () => {
    expect(await resolveSelection({}, root)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
  });
});
