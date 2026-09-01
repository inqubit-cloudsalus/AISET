import type { ReactElement } from "react";
import { makeTheme, type Theme } from "./theme.ts";

export type OutputMode = "json" | "plain" | "tty";

export interface OutputOptions {
  json?: boolean;
  color?: boolean;
}

/**
 * Ink is mounted only for an interactive terminal with colour enabled.
 * `--json`, a pipe, or NO_COLOR all fall back to deterministic text — which is what
 * makes every command testable and pipeable.
 */
export function resolveOutputMode(opts: OutputOptions = {}): OutputMode {
  if (opts.json) return "json";
  const noColor = (process.env.NO_COLOR ?? "") !== "";
  const colorDisabled = opts.color === false || noColor;
  if (!process.stdout.isTTY || colorDisabled) return "plain";
  return "tty";
}

export function themeFor(mode: OutputMode, opts: OutputOptions = {}): Theme {
  return makeTheme({ color: mode === "tty" && opts.color !== false });
}

export interface View {
  /** Machine-readable payload for `--json`. */
  json: () => unknown;
  /** Deterministic text for pipes, CI and tests. Trailing newline added by the caller. */
  plain: (theme: Theme) => string;
  /** Interactive Ink tree. Imported lazily so plain paths never load React. */
  ink?: (theme: Theme) => Promise<ReactElement>;
  /** Set for a live view (e.g. `runs tail`) that must not auto-unmount. */
  live?: boolean;
}

/** Renders a view in whichever mode the environment and flags select. */
export async function renderView(view: View, opts: OutputOptions = {}): Promise<void> {
  const mode = resolveOutputMode(opts);
  const theme = themeFor(mode, opts);

  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(view.json(), null, 2)}\n`);
    return;
  }

  if (mode === "plain" || !view.ink) {
    process.stdout.write(`${view.plain(theme)}\n`);
    return;
  }

  const { render } = await import("ink");
  const instance = render(await view.ink(theme));
  await instance.waitUntilExit();
}

/**
 * Mounts a long-lived interactive app (the shell) rather than a one-shot View.
 * `renderView`'s json/plain fan-out does not apply: the caller has already
 * established that the environment is an interactive terminal.
 *
 * The app takes the alternate screen, as vim and less do. Without it the first
 * frame is painted wherever the cursor happened to be — usually the bottom line
 * — so the terminal scrolls to make room and the top of the header is cut off
 * until the next redraw. It also means the shell leaves the scrollback it found
 * exactly as it was.
 */
export async function renderApp(
  element: ReactElement,
  opts: { stdin?: NodeJS.ReadStream } = {},
): Promise<void> {
  const { render } = await import("ink");
  const instance = render(element, {
    exitOnCtrlC: false,
    stdin: opts.stdin,
    alternateScreen: true,
  });
  await instance.waitUntilExit();
}
