/**
 * The AISET wordmark and the shell's persistent header.
 *
 * The header is deliberately not part of the transcript: `/clear` empties the
 * viewport below it, and the identity plus the connection line stay on screen.
 * Everything here is a pure string function so the layout maths in ShellView can
 * measure the header before rendering it.
 */
import type { ShellHeaderModel } from "./models.ts";
import type { Theme } from "./theme.ts";

const WORDMARK = [
  " █████  ██ ███████ ███████ ████████",
  "██   ██ ██ ██      ██         ██   ",
  "███████ ██ ███████ █████      ██   ",
  "██   ██ ██      ██ ██         ██   ",
  "██   ██ ██ ███████ ███████    ██   ",
];

/** The widest wordmark row — what `headerLines` needs the terminal to afford. */
export const WORDMARK_WIDTH = Math.max(...WORDMARK.map((l) => l.length));
export const WORDMARK_HEIGHT = WORDMARK.length;

/** The block glyphs degrade to `#` where the terminal cannot render them. */
export function wordmark(theme: Theme): string[] {
  return theme.unicode ? WORDMARK : WORDMARK.map((line) => line.replaceAll("█", "#"));
}

export interface HeaderOptions {
  columns: number;
  rows: number;
}

/**
 * True when there is room to spend on the wordmark. A small terminal gets the
 * one-line header instead: the run data is worth more rows than the logo is.
 */
export function showsWordmark({ columns, rows }: HeaderOptions): boolean {
  return columns >= WORDMARK_WIDTH + 2 && rows >= 22;
}

/** The connection line — proof of the open handle, never a decoration. */
export function connectionLine(model: ShellHeaderModel, theme: Theme): string {
  const mark = model.current ? theme.symbols.ok : theme.symbols.warn;
  const dot = theme.symbols.bullet;
  const schema = model.schemaVersion ?? "none";
  return `${mark} connected to sqlite ${dot} ${model.dbPath} ${dot} schema ${schema} ${dot} ${model.totalRuns} runs ${dot} ${model.totalEvents} events`;
}

/**
 * The full header, top to bottom. ShellView renders these lines above the
 * viewport and subtracts their count from the space the transcript may use.
 */
export function headerLines(model: ShellHeaderModel, theme: Theme, opts: HeaderOptions): string[] {
  const connection = connectionLine(model, theme);
  if (!showsWordmark(opts)) {
    return [`${theme.symbols.accent} AISET v${model.version}`, connection];
  }
  return [
    ...wordmark(theme),
    `${theme.symbols.bullet} AI Software Engineering Team ${theme.symbols.bullet} v${model.version}`,
    connection,
  ];
}
