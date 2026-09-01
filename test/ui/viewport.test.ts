import { describe, expect, test } from "bun:test";
import type { ShellBlock } from "../../src/shell/types.ts";
import {
  CHROME_ROWS,
  clampOffset,
  MIN_VIEWPORT_ROWS,
  maxOffset,
  scrollStatus,
  totalRows,
  toViewportLines,
  viewportHeight,
  visibleLines,
  wrapText,
} from "../../src/ui/viewport.ts";

const block = (text: string, kind: ShellBlock["kind"] = "output"): ShellBlock => ({ kind, text });

function texts(lines: { text: string }[]): string[] {
  return lines.map((l) => l.text);
}

describe("wrapText", () => {
  test("keeps short lines and splits on existing newlines", () => {
    expect(wrapText("one\ntwo", 10)).toEqual(["one", "two"]);
  });

  test("hard-wraps at the column so aligned columns stay aligned", () => {
    expect(wrapText("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });

  test("a line exactly the width is not wrapped", () => {
    expect(wrapText("abc", 3)).toEqual(["abc"]);
  });

  test("a non-positive width is returned untouched rather than looping forever", () => {
    expect(wrapText("abc", 0)).toEqual(["abc"]);
  });
});

describe("toViewportLines", () => {
  test("separates blocks with a blank line and carries each block's kind", () => {
    const lines = toViewportLines([block("a"), block("b", "error")], 10);
    expect(texts(lines)).toEqual(["a", "", "b"]);
    expect(lines.map((l) => l.kind)).toEqual(["output", "blank", "error"]);
  });

  test("no leading blank before the first block", () => {
    expect(texts(toViewportLines([block("only")], 10))).toEqual(["only"]);
  });

  test("wrapping is applied per block", () => {
    expect(texts(toViewportLines([block("abcd")], 2))).toEqual(["ab", "cd"]);
  });

  test("no blocks is no lines — what /clear leaves behind", () => {
    expect(toViewportLines([], 10)).toEqual([]);
  });
});

describe("scrolling", () => {
  const lines = toViewportLines(
    ["a", "b", "c", "d", "e"].map((t) => block(t)),
    10,
  );
  // Five blocks separated by blanks: a _ b _ c _ d _ e => 9 lines.
  const total = lines.length;

  test("the blocks flatten to the expected line count", () => {
    expect(total).toBe(9);
  });

  test("maxOffset never goes negative when the content is shorter than the box", () => {
    expect(maxOffset(3, 10)).toBe(0);
    expect(maxOffset(9, 4)).toBe(5);
  });

  test("clampOffset pins to both ends", () => {
    expect(clampOffset(-5, total, 4)).toBe(0);
    expect(clampOffset(99, total, 4)).toBe(5);
    expect(clampOffset(2, total, 4)).toBe(2);
  });

  test("a null offset follows the tail", () => {
    expect(texts(visibleLines(lines, null, 3))).toEqual(["d", "", "e"]);
  });

  test("an explicit offset shows that window", () => {
    expect(texts(visibleLines(lines, 0, 3))).toEqual(["a", "", "b"]);
    expect(texts(visibleLines(lines, 2, 3))).toEqual(["b", "", "c"]);
  });

  test("content shorter than the box shows everything", () => {
    expect(texts(visibleLines(lines, null, 50))).toEqual(texts(lines));
  });

  test("status reports a 1-based range and whether it is pinned to the tail", () => {
    expect(scrollStatus(total, null, 3)).toEqual({
      first: 7,
      last: 9,
      total: 9,
      following: true,
    });
    expect(scrollStatus(total, 0, 3)).toEqual({
      first: 1,
      last: 3,
      total: 9,
      following: false,
    });
  });

  test("an empty viewport reports zero rather than line one", () => {
    expect(scrollStatus(0, null, 5)).toEqual({ first: 0, last: 0, total: 0, following: true });
  });

  test("scrolling to the very bottom counts as following again", () => {
    expect(scrollStatus(total, 6, 3).following).toBe(true);
  });
});

describe("layout budget", () => {
  test("the shell fits inside the terminal at every usable size", () => {
    // The first frame is painted in one go: drawing more rows than the terminal
    // has makes it scroll, which is what cut the top off the header on launch.
    // The logo header is only chosen at 24 rows or more (see showsLogo), and
    // the compact one needs the chrome plus a minimum transcript.
    const smallest = { 2: MIN_VIEWPORT_ROWS + 2 + CHROME_ROWS, 8: 24 } as const;
    for (const headerRows of [2, 8] as const) {
      for (let rows = smallest[headerRows]; rows <= 80; rows++) {
        expect(totalRows(rows, headerRows)).toBeLessThanOrEqual(rows);
      }
    }
  });

  test("a terminal too short for the budget keeps a usable transcript", () => {
    // Below the budget the viewport stops shrinking, so the prompt stays
    // reachable even though the frame can no longer fit.
    expect(viewportHeight(6, 7)).toBe(MIN_VIEWPORT_ROWS);
    expect(viewportHeight(1, 2)).toBe(MIN_VIEWPORT_ROWS);
  });

  test("every spare row goes to the transcript", () => {
    expect(viewportHeight(24, 8)).toBe(24 - 8 - CHROME_ROWS);
    expect(totalRows(24, 8)).toBe(24);
    // A compact header hands its saved rows straight to the viewport.
    expect(viewportHeight(24, 2)).toBe(viewportHeight(24, 8) + 6);
  });
});
