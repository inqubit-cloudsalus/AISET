import { describe, expect, test } from "bun:test";
import {
  initialPromptState,
  type PromptAction,
  type PromptState,
  promptCompletions,
  reducePrompt,
} from "../../src/shell/prompt-state.ts";

function apply(state: PromptState, ...actions: PromptAction[]): PromptState {
  return actions.reduce(reducePrompt, state);
}

function typed(text: string): PromptState {
  return apply(initialPromptState(), { type: "insert", text });
}

describe("editing", () => {
  test("insert appends and advances the cursor", () => {
    const state = typed("/runs");
    expect(state.buffer).toBe("/runs");
    expect(state.cursor).toBe(5);
  });

  test("backspace deletes before the cursor and is a no-op at the start", () => {
    expect(apply(typed("/run"), { type: "backspace" }).buffer).toBe("/ru");
    const atStart = apply(typed("/run"), { type: "home" }, { type: "backspace" });
    expect(atStart.buffer).toBe("/run");
    expect(atStart.cursor).toBe(0);
  });

  test("cursor movement clamps at both ends and insert happens in place", () => {
    const state = apply(
      typed("/rns"),
      { type: "left" },
      { type: "left" },
      { type: "insert", text: "u" },
    );
    expect(state.buffer).toBe("/runs");
    expect(state.cursor).toBe(3);

    const clamped = apply(typed("ab"), { type: "right" }, { type: "right" }, { type: "right" });
    expect(clamped.cursor).toBe(2);
    expect(apply(clamped, { type: "home" }, { type: "left" }).cursor).toBe(0);
  });

  test("delete removes at the cursor; end jumps past the last character", () => {
    const state = apply(typed("/runs"), { type: "home" }, { type: "delete" });
    expect(state.buffer).toBe("runs");
    expect(apply(state, { type: "end" }).cursor).toBe(4);
  });

  test("clearLine empties the buffer", () => {
    expect(apply(typed("/doctor"), { type: "clearLine" }).buffer).toBe("");
  });
});

describe("history", () => {
  test("submit records the line, trimmed, and resets the buffer", () => {
    const state = apply(typed("  /doctor  "), { type: "submit" });
    expect(state.buffer).toBe("");
    expect(state.history).toEqual(["/doctor"]);
  });

  test("blank lines and consecutive duplicates are not recorded", () => {
    let state = apply(typed("   "), { type: "submit" });
    expect(state.history).toEqual([]);
    state = apply(state, { type: "insert", text: "/runs" }, { type: "submit" });
    state = apply(state, { type: "insert", text: "/runs" }, { type: "submit" });
    expect(state.history).toEqual(["/runs"]);
  });

  test("up walks backwards, down returns to the draft that was interrupted", () => {
    let state = apply(typed("/runs"), { type: "submit" });
    state = apply(state, { type: "insert", text: "/doctor" }, { type: "submit" });
    state = apply(state, { type: "insert", text: "/dr" });

    state = apply(state, { type: "historyUp" });
    expect(state.buffer).toBe("/doctor");
    expect(state.cursor).toBe(7);

    state = apply(state, { type: "historyUp" });
    expect(state.buffer).toBe("/runs");

    // Already at the oldest entry: another up changes nothing.
    expect(apply(state, { type: "historyUp" }).buffer).toBe("/runs");

    state = apply(state, { type: "historyDown" }, { type: "historyDown" });
    expect(state.buffer).toBe("/dr");
    expect(state.historyIndex).toBeNull();
  });

  test("up on empty history and down while not browsing do nothing", () => {
    const fresh = initialPromptState();
    expect(apply(fresh, { type: "historyUp" })).toEqual(fresh);
    expect(apply(typed("/x"), { type: "historyDown" }).buffer).toBe("/x");
  });
});

describe("completion", () => {
  test("candidates are offered only for a lone slash word", () => {
    expect(promptCompletions(typed("/do"))).toEqual(["/doctor"]);
    expect(promptCompletions(typed("/runs --status x"))).toEqual([]);
    expect(promptCompletions(typed("hello"))).toEqual([]);
  });

  test("a unique match completes and adds a space ready for arguments", () => {
    const state = apply(typed("/do"), { type: "complete" });
    expect(state.buffer).toBe("/doctor ");
    expect(state.cursor).toBe(8);
  });

  test("several matches extend only as far as they agree", () => {
    const state = apply(typed("/r"), { type: "complete" });
    expect(state.buffer).toBe("/run");
    expect(promptCompletions(state)).toEqual(["/runs", "/run"]);
  });

  test("completing nothing leaves the buffer untouched", () => {
    const state = typed("/zzz");
    expect(apply(state, { type: "complete" })).toEqual(state);
  });
});
