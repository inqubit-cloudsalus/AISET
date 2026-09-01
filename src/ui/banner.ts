/**
 * The AISET logo and the shell's persistent header.
 *
 * The header is deliberately not part of the transcript: `/clear` empties the
 * viewport below it, and the identity plus the connection line stay on screen.
 * Everything here is a pure string function so the layout maths in ShellView can
 * measure the header before rendering it.
 *
 * Depth comes from two places. The wordmark is a shadowed block font whose
 * shadow glyphs are emitted as their own segments, so the view can dim them
 * against the lit faces. The team mark is two ranks of figures, the back rank
 * dimmed, which reads as a group standing behind the front row.
 */
import type { ShellHeaderModel } from "./models.ts";
import type { Theme } from "./theme.ts";

/** How a segment is lit. The view maps these onto colours. */
export type Shade = "lit" | "shadow" | "back";

export interface ArtSegment {
  text: string;
  shade: Shade;
}

export type ArtRow = ArtSegment[];

/** Glyphs that form the drop shadow rather than the face of a letter. */
const SHADOW_GLYPHS = new Set(["╗", "╝", "╔", "╚", "║", "═"]);

const WORDMARK = [
  " █████╗ ██╗███████╗███████╗████████╗",
  "██╔══██╗██║██╔════╝██╔════╝╚══██╔══╝",
  "███████║██║███████╗█████╗     ██║   ",
  "██╔══██║██║╚════██║██╔══╝     ██║   ",
  "██║  ██║██║███████║███████╗   ██║   ",
  "╚═╝  ╚═╝╚═╝╚══════╝╚══════╝   ╚═╝   ",
];

/**
 * Six figures in two ranks — the team the project is named for. The back rank
 * is drawn first and dimmed, so the group has depth rather than reading as one
 * flat row of icons.
 */
const TEAM = [
  { text: "         ", shade: "back" },
  { text: " ○  ○  ○ ", shade: "back" },
  { text: "▟█▙▟█▙▟█▙", shade: "back" },
  { text: " ●  ●  ● ", shade: "lit" },
  { text: "▟█▙▟█▙▟█▙", shade: "lit" },
  { text: "         ", shade: "lit" },
] as const;

const ASCII_TEAM = [
  { text: "         ", shade: "back" },
  { text: " o  o  o ", shade: "back" },
  { text: "/|\\/|\\/|\\", shade: "back" },
  { text: " O  O  O ", shade: "lit" },
  { text: "/|\\/|\\/|\\", shade: "lit" },
  { text: "         ", shade: "lit" },
] as const;

/** Columns between the team mark and the wordmark. */
const GAP = "  ";

export const LOGO_HEIGHT = WORDMARK.length;
export const TEAM_WIDTH = TEAM[0].text.length;
export const WORDMARK_WIDTH = Math.max(...WORDMARK.map((l) => l.length));
export const LOGO_WIDTH = TEAM_WIDTH + GAP.length + WORDMARK_WIDTH;

/**
 * Splits one wordmark row into lit faces and shadow, preserving order so the
 * row can be reassembled at exactly its original width.
 */
function shadeWordmarkRow(row: string, unicode: boolean): ArtSegment[] {
  const segments: ArtSegment[] = [];
  for (const glyph of row) {
    const shadow = SHADOW_GLYPHS.has(glyph);
    // A terminal without box drawing gets the block letters with no shadow;
    // spaces keep every row the same width, so the art cannot skew.
    const text = shadow ? (unicode ? glyph : " ") : unicode ? glyph : glyph.replace("█", "#");
    const shade: Shade = shadow ? "shadow" : "lit";
    const last = segments.at(-1);
    if (last && last.shade === shade) last.text += text;
    else segments.push({ text, shade });
  }
  return segments;
}

/** The full logo: the team mark, a gap, then the shadowed wordmark. */
export function logoArt(theme: Theme): ArtRow[] {
  const team = theme.unicode ? TEAM : ASCII_TEAM;
  return WORDMARK.map((row, index) => {
    const figure = team[index]!;
    return [
      { text: figure.text, shade: figure.shade as Shade },
      { text: GAP, shade: "shadow" as Shade },
      ...shadeWordmarkRow(row, theme.unicode),
    ];
  });
}

export interface HeaderOptions {
  columns: number;
  rows: number;
}

/**
 * True when there is room to spend on the logo. A small terminal gets the
 * one-line header instead: the run data is worth more rows than the logo is.
 */
export function showsLogo({ columns, rows }: HeaderOptions): boolean {
  return columns >= LOGO_WIDTH + 2 && rows >= 24;
}

/** The connection line — proof of the open handle, never a decoration. */
export function connectionLine(model: ShellHeaderModel, theme: Theme): string {
  const mark = model.current ? theme.symbols.ok : theme.symbols.warn;
  const dot = theme.symbols.bullet;
  const schema = model.schemaVersion ?? "none";
  return `${mark} connected to sqlite ${dot} ${model.dbPath} ${dot} schema ${schema} ${dot} ${model.totalRuns} runs ${dot} ${model.totalEvents} events`;
}

/**
 * The header, top to bottom, as shaded rows. ShellView renders these and
 * subtracts their count from the space the transcript may use.
 */
export function headerRows(model: ShellHeaderModel, theme: Theme, opts: HeaderOptions): ArtRow[] {
  const connection: ArtRow = [{ text: connectionLine(model, theme), shade: "shadow" }];
  if (!showsLogo(opts)) {
    return [
      [{ text: `${theme.symbols.accent} AISET v${model.version}`, shade: "lit" }],
      connection,
    ];
  }
  return [
    ...logoArt(theme),
    [
      {
        text: `${theme.symbols.bullet} AI Software Engineering Team ${theme.symbols.bullet} v${model.version}`,
        shade: "shadow",
      },
    ],
    connection,
  ];
}

/** The plain text of a row — used for width checks and tests. */
export function rowText(row: ArtRow): string {
  return row.map((segment) => segment.text).join("");
}
