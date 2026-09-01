/**
 * The transcript viewport's geometry — pure functions, no React.
 *
 * The shell renders into a fixed-height box rather than the terminal's own
 * scrollback, so it has to do its own wrapping and scrolling. Keeping that maths
 * here means it is testable without a terminal, and `/clear` genuinely empties
 * the box instead of leaving committed output behind.
 */
import type { ShellBlock } from "../shell/types.ts";

export interface ViewportLine {
  text: string;
  kind: ShellBlock["kind"] | "blank";
}

/**
 * Hard-wraps at the column, rather than on word boundaries: almost everything the
 * shell prints is column-aligned (tables, key/value pairs), and word wrapping
 * would break that alignment on the continuation rows.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
  }
  return out;
}

/** Flattens blocks into wrapped display lines, one blank line between blocks. */
export function toViewportLines(blocks: ShellBlock[], width: number): ViewportLine[] {
  const lines: ViewportLine[] = [];
  for (const block of blocks) {
    if (lines.length > 0) lines.push({ text: "", kind: "blank" });
    for (const text of wrapText(block.text, width)) lines.push({ text, kind: block.kind });
  }
  return lines;
}

/** The largest scroll offset that still fills the viewport. */
export function maxOffset(total: number, height: number): number {
  return Math.max(0, total - height);
}

export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, maxOffset(total, height)));
}

/**
 * The slice on screen. `offset` of `null` means "follow the tail" — the default,
 * so new output is always visible until the reader scrolls up deliberately.
 */
export function visibleLines(
  lines: ViewportLine[],
  offset: number | null,
  height: number,
): ViewportLine[] {
  const start =
    offset === null ? maxOffset(lines.length, height) : clampOffset(offset, lines.length, height);
  return lines.slice(start, start + height);
}

export interface ScrollStatus {
  first: number;
  last: number;
  total: number;
  following: boolean;
}

/** What the status line reports: a 1-based line range, and whether it is pinned. */
export function scrollStatus(total: number, offset: number | null, height: number): ScrollStatus {
  const start = offset === null ? maxOffset(total, height) : clampOffset(offset, total, height);
  const last = Math.min(total, start + height);
  return {
    first: total === 0 ? 0 : start + 1,
    last,
    total,
    following: offset === null || start >= maxOffset(total, height),
  };
}

/**
 * Rows the chrome needs below the header: the viewport's border (2), the status
 * line (1), the prompt box (3), and its one optional line of menu-or-hint (1).
 * The menu and the hint can never both show, which is what keeps this constant.
 */
export const CHROME_ROWS = 7;

/** Never collapse the transcript entirely, however short the terminal is. */
export const MIN_VIEWPORT_ROWS = 3;

/**
 * How many transcript rows fit. The total drawn is `headerRows + height +
 * CHROME_ROWS`, which stays under the terminal height so the first frame does
 * not scroll the top of the header off the screen.
 */
export function viewportHeight(rows: number, headerRows: number): number {
  return Math.max(MIN_VIEWPORT_ROWS, rows - headerRows - CHROME_ROWS);
}

/** Total rows the shell draws — what must fit inside the terminal. */
export function totalRows(rows: number, headerRows: number): number {
  return headerRows + viewportHeight(rows, headerRows) + CHROME_ROWS;
}
