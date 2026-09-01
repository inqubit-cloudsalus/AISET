import { describe, expect, test } from "bun:test";
import {
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  parseWheel,
  splitMouseInput,
  stripMouseSequences,
  WHEEL_LINES,
} from "../../src/ui/mouse.ts";

const ESC = String.fromCharCode(27);
const sgr = (button: number, final = "M") => `${ESC}[<${button};20;5${final}`;

describe("tracking sequences", () => {
  test("enable and disable are exact inverses, innermost mode reset last", () => {
    expect(MOUSE_ENABLE).toBe(`${ESC}[?1000h${ESC}[?1006h`);
    expect(MOUSE_DISABLE).toBe(`${ESC}[?1006l${ESC}[?1000l`);
  });

  test("a wheel notch moves more than one line but less than a page", () => {
    expect(WHEEL_LINES).toBeGreaterThan(1);
    expect(WHEEL_LINES).toBeLessThan(10);
  });
});

describe("parseWheel", () => {
  test("64 is up and 65 is down", () => {
    expect(parseWheel(sgr(64))).toEqual(["up"]);
    expect(parseWheel(sgr(65))).toEqual(["down"]);
  });

  test("modifier bits ride along and are ignored", () => {
    // shift(4) + ctrl(16) + wheel up(64) = 84; shift + wheel down = 69.
    expect(parseWheel(sgr(84))).toEqual(["up"]);
    expect(parseWheel(sgr(69))).toEqual(["down"]);
  });

  test("ordinary clicks and drags are not wheel events", () => {
    expect(parseWheel(sgr(0))).toEqual([]);
    expect(parseWheel(sgr(2))).toEqual([]);
    expect(parseWheel(sgr(32))).toEqual([]);
  });

  test("the release report is not counted a second time", () => {
    expect(parseWheel(`${sgr(64, "M")}${sgr(64, "m")}`)).toEqual(["up"]);
  });

  test("a chunk carrying several notches yields them in order", () => {
    expect(parseWheel(`${sgr(64)}${sgr(64)}${sgr(65)}`)).toEqual(["up", "up", "down"]);
  });

  test("plain typing produces nothing", () => {
    expect(parseWheel("/db-status\r")).toEqual([]);
    expect(parseWheel("")).toEqual([]);
  });
});

describe("stripMouseSequences", () => {
  test("removes the report and keeps the text around it", () => {
    expect(stripMouseSequences(`/db-st${sgr(64)}atus`)).toBe("/db-status");
  });

  test("removes the legacy X10 encoding, payload bytes and all", () => {
    // ESC [ M then exactly three payload bytes: button, column, row.
    expect(stripMouseSequences(`a${ESC}[M !"b`)).toBe("ab");
  });

  test("leaves ordinary input untouched", () => {
    expect(stripMouseSequences("/runs --status succeeded")).toBe("/runs --status succeeded");
  });

  test("what it strips is exactly what parseWheel reads", () => {
    const noisy = `/help${sgr(64)}${sgr(65, "m")}`;
    expect(stripMouseSequences(noisy)).toBe("/help");
    expect(parseWheel(noisy)).toEqual(["up"]);
  });
});

describe("splitMouseInput", () => {
  test("a whole report in one chunk leaves no tail", () => {
    expect(splitMouseInput(`a${sgr(64)}b`)).toEqual({ text: "ab", wheel: ["up"], rest: "" });
  });

  test("a report cut in half is held until the rest arrives", () => {
    const whole = sgr(64);
    const first = splitMouseInput(whole.slice(0, 7));
    // This is the bug that leaked `[<64;37;22M` into the prompt: the fragment
    // must be withheld, not passed on as text.
    expect(first.text).toBe("");
    expect(first.wheel).toEqual([]);
    expect(first.rest).toBe(whole.slice(0, 7));

    const second = splitMouseInput(first.rest + whole.slice(7));
    expect(second).toEqual({ text: "", wheel: ["up"], rest: "" });
  });

  test("every split point of a report is handled", () => {
    const whole = sgr(65);
    for (let cut = 1; cut < whole.length; cut++) {
      const first = splitMouseInput(whole.slice(0, cut));
      const second = splitMouseInput(first.rest + whole.slice(cut));
      expect([...first.text, ...second.text].join("")).toBe("");
      expect([...first.wheel, ...second.wheel]).toEqual(["down"]);
      expect(second.rest).toBe("");
    }
  });

  test("keystrokes before a partial report are passed through immediately", () => {
    const result = splitMouseInput(`/runs${sgr(64).slice(0, 4)}`);
    expect(result.text).toBe("/runs");
    expect(result.rest).toBe(sgr(64).slice(0, 4));
  });

  test("a lone escape is held back so it can be flushed on the timer", () => {
    expect(splitMouseInput(ESC).rest).toBe(ESC);
  });

  test("ordinary typing is never withheld", () => {
    expect(splitMouseInput("/db-status\r")).toEqual({
      text: "/db-status\r",
      wheel: [],
      rest: "",
    });
  });

  test("an arrow key is passed straight through, not mistaken for a mouse tail", () => {
    expect(splitMouseInput(`${ESC}[A`).text).toBe(`${ESC}[A`);
  });
});
