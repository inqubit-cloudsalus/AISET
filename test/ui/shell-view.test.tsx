/** @jsxImportSource @opentui/react */

import { afterEach, describe, expect, test } from "bun:test";
import type { CliRenderer } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { resolvePaths } from "../../src/core/paths.ts";
import type { Session } from "../../src/shell/types.ts";
import { makeTheme } from "../../src/ui/theme.ts";
import { ShellView } from "../../src/ui/views/ShellView.tsx";
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
