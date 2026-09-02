import { createElement } from "react";
import { AisetError } from "../../core/errors.ts";
import { log } from "../../core/logger.ts";
import { closeSession, openSession } from "../../shell/session.ts";
import { renderOpenTuiApp, resolveOutputMode } from "../../ui/render.tsx";
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
  await log("info", "shell.start", { dbPath: ctx.paths.dbPath }, ctx.paths.root);
  try {
    const { ShellView } = await import("../../ui/views/ShellView.tsx");
    await renderOpenTuiApp(createElement(ShellView, { session }));
  } finally {
    closeSession(session);
    await log("info", "shell.exit", {}, ctx.paths.root);
  }
  return 0;
}
