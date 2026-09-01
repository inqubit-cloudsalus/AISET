import { log } from "../../core/logger.ts";
import { openDb } from "../../db/client.ts";
import { isCurrent, migrate, migrationStatus } from "../../db/migrate.ts";
import { tableCounts } from "../../db/repositories/stats.ts";
import type { DbStatusModel } from "../../ui/models.ts";
import { plainDbStatus } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import { type Context, dbExists, openOrCreateDb } from "../context.ts";

/**
 * There is deliberately no `db reset` and no destructive subcommand here:
 * charter §5 forbids destructive data operations without explicit human approval.
 */
export async function runDbMigrate(ctx: Context): Promise<number> {
  const db = openOrCreateDb(ctx);
  const applied = migrate(db);
  const model: DbStatusModel = {
    dbPath: ctx.paths.dbPath,
    dbExists: true,
    current: isCurrent(db),
    migrations: migrationStatus(db).map((m) => ({
      version: m.version,
      applied: m.applied,
      appliedAt: m.appliedAt,
    })),
    tables: tableCounts(db),
  };
  db.close();
  await log("info", "db.migrate", { applied }, ctx.paths.root);
  await renderView(
    { json: () => ({ ...model, applied }), plain: (theme) => plainDbStatus(model, theme) },
    ctx,
  );
  return 0;
}

export async function runDbStatus(ctx: Context): Promise<number> {
  if (!dbExists(ctx)) {
    const model: DbStatusModel = {
      dbPath: ctx.paths.dbPath,
      dbExists: false,
      current: false,
      migrations: migrationStatus(
        // A throwaway in-memory DB reports every migration as pending.
        openDb(":memory:"),
      ),
    };
    await renderView({ json: () => model, plain: (theme) => plainDbStatus(model, theme) }, ctx);
    return 1;
  }

  // Opened directly rather than via requireDb: reporting a behind schema is this
  // command's whole job, so it must not refuse to run on one.
  const db = openDb(ctx.paths.dbPath, { create: false });
  const model: DbStatusModel = {
    dbPath: ctx.paths.dbPath,
    dbExists: true,
    current: isCurrent(db),
    migrations: migrationStatus(db),
    // Only meaningful once the schema is current; a behind schema may lack tables.
    tables: isCurrent(db) ? tableCounts(db) : undefined,
  };
  db.close();
  await renderView({ json: () => model, plain: (theme) => plainDbStatus(model, theme) }, ctx);
  return model.current ? 0 : 1;
}
