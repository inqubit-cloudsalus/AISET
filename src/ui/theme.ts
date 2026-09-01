/**
 * The single source of colour and symbol truth for every view.
 * Nothing else in the codebase hard-codes a colour name or a glyph.
 */

export interface Symbols {
  accent: string;
  ok: string;
  warn: string;
  fail: string;
  pending: string;
  cursor: string;
  bullet: string;
  spinner: readonly string[];
}

const UNICODE: Symbols = {
  accent: "◆",
  ok: "✔",
  warn: "⚠",
  fail: "✖",
  pending: "○",
  cursor: "›",
  bullet: "·",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

const ASCII: Symbols = {
  accent: "*",
  ok: "OK",
  warn: "!",
  fail: "X",
  pending: "-",
  cursor: ">",
  bullet: "-",
  spinner: ["|", "/", "-", "\\"],
};

/** Colours are Ink colour names. Grey chrome, cyan accent, status colours reserved. */
export const colors = {
  accent: "cyan",
  chrome: "gray",
  muted: "gray",
  text: "white",
  ok: "green",
  warn: "yellow",
  fail: "red",
  pending: "gray",
} as const;

export type StatusTone = "ok" | "warn" | "fail" | "pending";

/** Maps a run status to its tone. Status is the only thing allowed to carry colour. */
export function toneForStatus(status: string): StatusTone {
  switch (status) {
    case "succeeded":
      return "ok";
    case "running":
      return "warn";
    case "failed":
    case "timeout":
    case "killed":
      return "fail";
    default:
      return "pending";
  }
}

export function toneForVerdict(verdict: string | null): StatusTone {
  switch (verdict) {
    case "GREEN":
      return "ok";
    case "AMBER":
      return "warn";
    case "RED":
      return "fail";
    default:
      return "pending";
  }
}

export function colorForTone(tone: StatusTone): string {
  return colors[tone];
}

export interface Theme {
  symbols: Symbols;
  colors: typeof colors;
  /** False when NO_COLOR is set or output is not a TTY — Ink still needs to know. */
  useColor: boolean;
  /** False on a terminal that cannot render block-drawing glyphs. */
  unicode: boolean;
}

/**
 * NO_COLOR (any non-empty value) disables colour, per the no-color.org convention.
 * A non-UTF-8 terminal codepage falls back to ASCII glyphs.
 */
export function makeTheme(opts: { color?: boolean; unicode?: boolean } = {}): Theme {
  const noColorEnv = (process.env.NO_COLOR ?? "") !== "";
  const useColor = opts.color ?? !noColorEnv;
  const unicode = opts.unicode ?? supportsUnicode();
  return { symbols: unicode ? UNICODE : ASCII, colors, useColor, unicode };
}

export function supportsUnicode(): boolean {
  if (process.platform !== "win32") {
    const locale = process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? "";
    return /UTF-?8/i.test(locale) || locale === "";
  }
  // Windows Terminal and VS Code's terminal render Unicode; the legacy console may not.
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.WSLENV);
}

export function symbolForTone(theme: Theme, tone: StatusTone): string {
  return theme.symbols[
    tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "fail" ? "fail" : "pending"
  ];
}

/** Human-readable duration; `—` while a run is still open. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** ISO timestamp trimmed to `YYYY-MM-DD HH:MM:SS` UTC — stable across locales. */
export function formatTimestamp(iso: string): string {
  return iso
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "");
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}
