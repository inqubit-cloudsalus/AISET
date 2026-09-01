import { describe, expect, test } from "bun:test";
import {
  connectionLine,
  headerLines,
  showsWordmark,
  WORDMARK_HEIGHT,
  WORDMARK_WIDTH,
  wordmark,
} from "../../src/ui/banner.ts";
import type { ShellHeaderModel } from "../../src/ui/models.ts";
import { makeTheme } from "../../src/ui/theme.ts";

const unicode = makeTheme({ color: false, unicode: true });
const ascii = makeTheme({ color: false, unicode: false });

const model: ShellHeaderModel = {
  version: "0.1.0",
  dbPath: ".aiset/aiset.db",
  schemaVersion: "0001_init",
  current: true,
  totalRuns: 3,
  totalEvents: 21,
};

const roomy = { columns: 100, rows: 40 };

describe("wordmark", () => {
  test("every row is the same width, so the art cannot skew", () => {
    for (const line of wordmark(unicode)) expect(line.length).toBe(WORDMARK_WIDTH);
    expect(wordmark(unicode)).toHaveLength(WORDMARK_HEIGHT);
  });

  test("degrades to hashes where the terminal cannot draw blocks", () => {
    const drawn = wordmark(ascii).join("\n");
    expect(drawn).not.toContain("█");
    expect(drawn).toContain("#");
    // The shape is preserved, only the glyph changes.
    expect(wordmark(ascii).map((l) => l.length)).toEqual(wordmark(unicode).map((l) => l.length));
  });
});

describe("showsWordmark", () => {
  test("needs both the width and the height", () => {
    expect(showsWordmark(roomy)).toBe(true);
    expect(showsWordmark({ columns: WORDMARK_WIDTH + 1, rows: 40 })).toBe(false);
    expect(showsWordmark({ columns: 100, rows: 21 })).toBe(false);
  });
});

describe("connectionLine", () => {
  test("states the handle, the schema and the counts", () => {
    const line = connectionLine(model, unicode);
    expect(line).toContain("connected to sqlite");
    expect(line).toContain(".aiset/aiset.db");
    expect(line).toContain("schema 0001_init");
    expect(line).toContain("3 runs");
    expect(line).toContain("21 events");
    expect(line.startsWith(unicode.symbols.ok)).toBe(true);
  });

  test("warns instead of ticking when the schema is behind", () => {
    const behind = connectionLine({ ...model, current: false }, unicode);
    expect(behind.startsWith(unicode.symbols.warn)).toBe(true);
  });

  test("a database with no migrations reports no schema rather than null", () => {
    expect(connectionLine({ ...model, schemaVersion: null }, unicode)).toContain("schema none");
  });
});

describe("headerLines", () => {
  test("a roomy terminal gets the art, the tagline and the connection line", () => {
    const lines = headerLines(model, unicode, roomy);
    expect(lines).toHaveLength(WORDMARK_HEIGHT + 2);
    expect(lines.slice(0, WORDMARK_HEIGHT)).toEqual(wordmark(unicode));
    expect(lines.at(-2)).toContain("AI Software Engineering Team");
    expect(lines.at(-1)).toContain("connected to sqlite");
  });

  test("a small terminal spends its rows on data, not on the logo", () => {
    const lines = headerLines(model, unicode, { columns: 60, rows: 14 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("AISET v0.1.0");
    expect(lines[1]).toContain("connected to sqlite");
  });

  test("the version is always shown, at either size", () => {
    for (const opts of [roomy, { columns: 60, rows: 14 }]) {
      expect(headerLines(model, unicode, opts).join("\n")).toContain("v0.1.0");
    }
  });
});
