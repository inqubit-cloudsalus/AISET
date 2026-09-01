import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { defaultConfig, writeConfigIfAbsent } from "../../core/config.ts";
import { log } from "../../core/logger.ts";
import { migrate } from "../../db/migrate.ts";
import type { InitModel } from "../../ui/models.ts";
import { plainInit } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import { type Context, openOrCreateDb } from "../context.ts";

/**
 * Creates `.aiset/`, its config and the database, then applies migrations.
 * Idempotent by design: anything that already exists is reported, never overwritten.
 */
export async function runInit(ctx: Context): Promise<number> {
  const { stateDir, dbPath, configPath, logsDir } = ctx.paths;

  const createdStateDir = !existsSync(stateDir);
  await mkdir(stateDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const createdConfig = await writeConfigIfAbsent(
    defaultConfig(basename(ctx.paths.root)),
    ctx.paths.root,
  );

  const createdDb = !existsSync(dbPath);
  const db = openOrCreateDb(ctx);
  const migrationsApplied = migrate(db);
  db.close();

  const model: InitModel = {
    stateDir,
    dbPath,
    configPath,
    createdStateDir,
    createdConfig,
    createdDb,
    migrationsApplied,
  };

  await log("info", "init", { createdDb, migrationsApplied }, ctx.paths.root);
  await renderView({ json: () => model, plain: (theme) => plainInit(model, theme) }, ctx);
  return 0;
}
