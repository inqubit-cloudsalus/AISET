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
 * Mounts the rich interactive shell in OpenTUI. One-shot views intentionally
 * stay on Ink: they exit after one frame and retain the plain/JSON fallback.
 */
export async function renderOpenTuiApp(element: ReactElement): Promise<void> {
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
  ]);
  const renderer = await createCliRenderer({
    targetFps: 60,
    maxFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    useMouse: true,
    enableMouseMovement: true,
    autoFocus: false,
    openConsoleOnError: false,
    backgroundColor: "#0b0d10",
  });
  const root = createRoot(renderer);

  try {
    root.render(element);
    await new Promise<void>((resolve) => renderer.once("destroy", resolve));
  } finally {
    root.unmount();
    if (!renderer.isDestroyed) renderer.destroy();
  }
}
