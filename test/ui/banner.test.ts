import { describe, expect, test } from "bun:test";
import {
  connectionLine,
  headerRows,
  LOGO_HEIGHT,
  LOGO_WIDTH,
  logoArt,
  rowText,
  showsLogo,
  TEAM_WIDTH,
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

const roomy = { columns: 120, rows: 40 };
const cramped = { columns: 60, rows: 14 };

describe("logo art", () => {
  test("every row is the same width, so the art cannot skew", () => {
    for (const theme of [unicode, ascii]) {
      const rows = logoArt(theme);
      expect(rows).toHaveLength(LOGO_HEIGHT);
      for (const row of rows) expect(rowText(row).length).toBe(LOGO_WIDTH);
    }
  });

  test("the wordmark carries a drop shadow, lit faces kept separate from it", () => {
    const rows = logoArt(unicode);
    const shades = new Set(rows.flat().map((s) => s.shade));
    expect(shades.has("lit")).toBe(true);
    expect(shades.has("shadow")).toBe(true);
    // The shadow is real glyphs, not spaces — that is what gives it depth.
    const shadow = rows
      .flat()
      .filter((s) => s.shade === "shadow")
      .map((s) => s.text)
      .join("");
    expect(shadow).toMatch(/[╔╗╚╝║═]/);
  });

  test("the team stands in two ranks, the back one dimmed", () => {
    const rows = logoArt(unicode);
    const team = rows.map((row) => row[0]!);
    expect(team.map((s) => s.shade)).toEqual(["back", "back", "back", "lit", "lit", "lit"]);
    for (const segment of team) expect(segment.text.length).toBe(TEAM_WIDTH);
    // Three figures per rank, six in all.
    expect(rowText([team[2]!]).match(/▟█▙/g)).toHaveLength(3);
    expect(rowText([team[4]!]).match(/▟█▙/g)).toHaveLength(3);
  });

  test("a terminal without box drawing loses the shadow, not the alignment", () => {
    const drawn = logoArt(ascii);
    const text = drawn.map(rowText).join("\n");
    expect(text).not.toMatch(/[█╔╗╚╝║═○●▟▙]/);
    expect(text).toContain("#");
    // Shadow segments become spaces, so widths match the unicode art exactly.
    expect(drawn.map((r) => rowText(r).length)).toEqual(
      logoArt(unicode).map((r) => rowText(r).length),
    );
  });

  test("the letters AISET are all present in the block font", () => {
    // Row 3 is the widest part of every glyph in this font.
    expect(rowText(logoArt(unicode)[2]!)).toContain("███████║██║███████╗█████╗");
  });
});

describe("showsLogo", () => {
  test("needs both the width and the height", () => {
    expect(showsLogo(roomy)).toBe(true);
    expect(showsLogo({ columns: LOGO_WIDTH + 1, rows: 40 })).toBe(false);
    expect(showsLogo({ columns: 120, rows: 23 })).toBe(false);
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
    expect(
      connectionLine({ ...model, current: false }, unicode).startsWith(unicode.symbols.warn),
    ).toBe(true);
  });

  test("a database with no migrations reports no schema rather than null", () => {
    expect(connectionLine({ ...model, schemaVersion: null }, unicode)).toContain("schema none");
  });
});

describe("headerRows", () => {
  test("a roomy terminal gets the logo, the tagline and the connection line", () => {
    const rows = headerRows(model, unicode, roomy);
    expect(rows).toHaveLength(LOGO_HEIGHT + 2);
    expect(rows.slice(0, LOGO_HEIGHT).map(rowText)).toEqual(logoArt(unicode).map(rowText));
    expect(rowText(rows.at(-2)!)).toContain("AI Software Engineering Team");
    expect(rowText(rows.at(-1)!)).toContain("connected to sqlite");
  });

  test("a small terminal spends its rows on data, not on the logo", () => {
    const rows = headerRows(model, unicode, cramped);
    expect(rows).toHaveLength(2);
    expect(rowText(rows[0]!)).toContain("AISET v0.1.0");
    expect(rowText(rows[1]!)).toContain("connected to sqlite");
  });

  test("the version is always shown, at either size", () => {
    for (const opts of [roomy, cramped]) {
      expect(headerRows(model, unicode, opts).map(rowText).join("\n")).toContain("v0.1.0");
    }
  });
});
