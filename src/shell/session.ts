import { type Context, requireDb } from "../cli/context.ts";
import { VERSION } from "../cli/version.ts";
import { appliedVersions, isCurrent } from "../db/migrate.ts";
import { countRuns } from "../db/repositories/runs.ts";
import { countAllEvents } from "../db/repositories/stats.ts";
import type { ShellHeaderModel } from "../ui/models.ts";
import { themeFor } from "../ui/render.tsx";
import type { Session } from "./types.ts";

/**
 * Opens the session's single database handle. `requireDb` is used deliberately:
 * a missing database or a schema behind this binary must fail loudly with its
 * hint before Ink is ever mounted, not inside a half-drawn TUI.
 */
export function openSession(ctx: Context): Session {
  return {
    ctx,
    db: requireDb(ctx),
    theme: themeFor("tty", ctx),
    version: VERSION,
  };
}

export function closeSession(session: Session): void {
  session.db.close();
}

/** The connection banner's model — every field read from the live handle. */
export function shellHeader(session: Session): ShellHeaderModel {
  const versions = [...appliedVersions(session.db).keys()].sort();
  return {
    version: session.version,
    dbPath: session.ctx.paths.dbPath,
    schemaVersion: versions.at(-1) ?? null,
    current: isCurrent(session.db),
    totalRuns: countRuns(session.db),
    totalEvents: countAllEvents(session.db),
  };
}
