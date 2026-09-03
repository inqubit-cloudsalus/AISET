import { describe, expect, test } from "bun:test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { AGENT_ROLES, planTeam, TeamPlanSchema } from "../../src/ai/planner.ts";
import { AisetError } from "../../src/core/errors.ts";

/** A model that answers every call with one canned body — no network, no key. */
export function mockModel(body: unknown) {
  const result: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 20, text: 20, reasoning: 0 },
    },
    warnings: [],
  };
  return new MockLanguageModelV3({ doGenerate: async () => result });
}

const GOOD_PLAN = {
  title: "Next.js demo: dashboard, settings, profile",
  rationale: "Three routes with no shared files, so they can be built in parallel.",
  tasks: [
    {
      agent: "build",
      title: "Scaffold and dashboard route",
      prompt:
        "Scaffold a Next.js app in ./web with the App Router and Tailwind, then build app/dashboard/page.tsx. Run `bun run build` to prove it compiles.",
    },
    {
      agent: "build",
      title: "Settings route",
      prompt:
        "Assume ./web already exists with Next.js and Tailwind. Create only app/settings/page.tsx. Run `bun run build`.",
    },
  ],
};

describe("planTeam", () => {
  test("returns a parsed plan from a well-formed answer", async () => {
    const plan = await planTeam("build me a dashboard and a settings page", {
      model: mockModel(GOOD_PLAN),
    });
    expect(plan.title).toContain("Next.js");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]!.agent).toBe("build");
    expect(AGENT_ROLES).toContain(plan.tasks[0]!.agent);
  });

  test("an agent outside the roster is rejected, not launched", async () => {
    const rogue = {
      ...GOOD_PLAN,
      tasks: [{ ...GOOD_PLAN.tasks[0], agent: "devops" }],
    };
    expect(planTeam("do something", { model: mockModel(rogue) })).rejects.toThrow(AisetError);
  });

  test("an empty task list is rejected", async () => {
    const empty = { ...GOOD_PLAN, tasks: [] };
    expect(planTeam("do something", { model: mockModel(empty) })).rejects.toThrow(AisetError);
  });

  test("prose instead of a plan fails with a hint rather than silence", async () => {
    try {
      await planTeam("do something", { model: mockModel("I would be happy to help!") });
      throw new Error("expected planTeam to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AisetError);
      expect((err as AisetError).hint).toContain("/model");
    }
  });

  test("an empty request never reaches the model", async () => {
    expect(planTeam("   ", { model: mockModel(GOOD_PLAN) })).rejects.toThrow(AisetError);
  });

  test("the schema keeps every prompt substantial enough to act on", () => {
    const thin = {
      ...GOOD_PLAN,
      tasks: [{ agent: "build", title: "do it", prompt: "make a page" }],
    };
    expect(TeamPlanSchema.safeParse(thin).success).toBe(false);
    expect(TeamPlanSchema.safeParse(GOOD_PLAN).success).toBe(true);
  });
});
