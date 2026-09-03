/** @jsxImportSource @opentui/react */

import { afterEach, describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resolvePaths } from "../../src/core/paths.ts";
import type { Session } from "../../src/shell/types.ts";
import { makeTheme } from "../../src/ui/theme.ts";
import { ShellView } from "../../src/ui/views/ShellView.tsx";
import { goOffline } from "../ai/offline.ts";
import { freshDb } from "../db/helpers.ts";

let renderer: CliRenderer | undefined;
let session: Session | undefined;

afterEach(async () => {
  await act(async () => {
    if (renderer && !renderer.isDestroyed) renderer.destroy();
  });
  session?.db.close();
  renderer = undefined;
  session = undefined;
});

async function mount(width = 100, height = 28) {
  session = {
    ctx: {
      paths: resolvePaths("O:\\aiset-test"),
      json: false,
      color: true,
    },
    db: freshDb(),
    theme: makeTheme({ color: true, unicode: true }),
    version: "test",
  };
  const setup = await testRender(<ShellView session={session} />, { width, height });
  renderer = setup.renderer;
  await setup.flush();
  return setup;
}

describe("OpenTUI shell", () => {
  test("renders the responsive application chrome, transcript, and focused prompt", async () => {
    const setup = await mount(120, 36);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("◆ AISET");
    expect(frame).toContain("███████╗");
    expect(frame).toContain("▄███▄");
    expect(frame).not.toContain("LEAD");
    expect(frame).not.toContain("VERIFY");
    expect(frame).toContain("DESIGN · BUILD · REVIEW · SHIP");
    expect(frame).toContain("connected");
    expect(frame).toContain("Welcome to AISET");
    expect(frame).toContain("Type /help or /launch <prompt>");
    expect(frame).toContain("FOLLOWING");
  });

  test("routes typed commands through the existing dispatcher", async () => {
    const setup = await mount(110, 32);
    await act(async () => {
      await setup.mockInput.typeText("/help");
      setup.mockInput.pressEnter();
    });

    const frame = await setup.waitForFrame((value) => value.includes("/seed --demo"));
    expect(frame).toContain("/seed --demo");
    expect(frame).toContain("/clear");
    expect(frame).toContain("/quit");
  });

  test("collapses the action rail in a short terminal without losing the prompt", async () => {
    const setup = await mount(72, 18);
    const frame = setup.captureCharFrame();

    expect(frame).not.toContain("Bottom ctrl+end");
    expect(frame).toContain("Type /help or /launch <prompt>");
    expect(frame).toContain("Welcome to AISET");
  });
});

describe("model picker", () => {
  test("bare /model opens the picker, and escape closes it without dispatching", async () => {
    const restore = goOffline();
    try {
      const setup = await mount(110, 34);
      await act(async () => {
        await setup.mockInput.typeText("/model");
        setup.mockInput.pressEnter();
      });

      const opened = await setup.waitForFrame((value) => value.includes("select model"));
      expect(opened).toContain("anthropic/claude-sonnet-4.5");
      expect(opened).toContain("esc cancel");

      await act(async () => {
        setup.mockInput.pressEscape();
      });
      const closed = await setup.waitForFrame((value) => !value.includes("select model"));
      expect(closed).toContain("Type /help or /launch <prompt>");
    } finally {
      restore();
    }
  });

  test("choosing a row routes the pick back through /model", async () => {
    const restore = goOffline();
    try {
      const setup = await mount(110, 34);
      await act(async () => {
        await setup.mockInput.typeText("/model");
        setup.mockInput.pressEnter();
      });
      await setup.waitForFrame((value) => value.includes("select model"));

      await act(async () => {
        setup.mockInput.pressArrow("down");
      });
      await act(async () => {
        setup.mockInput.pressEnter();
      });

      // The test root has no .aiset/config.json, so the write fails loudly —
      // which is exactly the proof that the pick reached the real command.
      const frame = await setup.waitForFrame((value) => value.includes("config.json"));
      expect(frame).toContain("/model anthropic/claude-opus-4.1");
    } finally {
      restore();
    }
  });
});
