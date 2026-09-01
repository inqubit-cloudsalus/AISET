import { createElement } from "react";
import { AisetError } from "../../core/errors.ts";
import { log } from "../../core/logger.ts";
import { closeSession, openSession } from "../../shell/session.ts";
import { createMouseInput, MOUSE_DISABLE } from "../../ui/mouse.ts";
import { renderApp, resolveOutputMode } from "../../ui/render.tsx";
import type { Context } from "../context.ts";

/** True when the shell can be mounted: an interactive terminal on both ends. */
export function shellIsAvailable(ctx: Context): boolean {
  return resolveOutputMode(ctx) === "tty" && Boolean(process.stdin.isTTY);
}

/**
 * The interactive AISET entrypoint. Holds one database handle for the lifetime
 * of the process — the only long-running surface in the CLI.
 */
export async function runShell(ctx: Context): Promise<number> {
  if (!shellIsAvailable(ctx)) {
    throw new AisetError(
      "the AISET shell needs an interactive terminal",
      "use 'aiset home', or 'aiset runs list --json' for machine-readable output",
    );
  }

  const session = openSession(ctx);
  // Mouse reports are stripped from stdin before Ink parses it: its key parser
  // splits an escape sequence across several events, so a report caught inside
  // the key handler arrives as unrecognisable fragments.
  const mouse = createMouseInput(process.stdin);
  await log("info", "shell.start", { dbPath: ctx.paths.dbPath }, ctx.paths.root);
  try {
    const { ShellView } = await import("../../ui/views/ShellView.tsx");
    await renderApp(createElement(ShellView, { session, onWheel: mouse.onWheel }), {
      stdin: mouse.stdin,
    });
  } finally {
    mouse.dispose();
    // The view disables mouse tracking on unmount; this repeats it for the paths
    // where it never unmounts, so a crash cannot leave the terminal unable to
    // select text.
    process.stdout.write(MOUSE_DISABLE);
    closeSession(session);
    await log("info", "shell.exit", {}, ctx.paths.root);
  }
  return 0;
}
