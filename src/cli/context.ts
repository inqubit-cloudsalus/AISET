import { existsSync } from "node:fs";
import { AisetError } from "../core/errors.ts";
import { type Paths, resolvePaths } from "../core/paths.ts";
import { type Db, openDb } from "../db/client.ts";
import { isCurrent } from "../db/migrate.ts";
import type { OutputOptions } from "../ui/render.tsx";

/** Global flags, as parsed by commander and shared by every subcommand. */
export interface GlobalOptions {
  json?: boolean;
  color?: boolean;
  db?: string;
}

export interface Context extends OutputOptions {
  paths: Paths;
  json: boolean;
  color: boolean;
}

export function makeContext(opts: GlobalOptions): Context {
  return {
    paths: resolvePaths(process.cwd(), opts.db),
    json: opts.json ?? false,
    color: opts.color ?? true,
  };
}

export function dbExists(ctx: Context): boolean {
  return existsSync(ctx.paths.dbPath);
}

/**
 * Opens the database for reading. Refuses to create one implicitly: a command that
 * reads runs from a database that does not exist is a mistake, not an empty result.
 */
export function requireDb(ctx: Context): Db {
  if (!dbExists(ctx)) {
    throw new AisetError(`no database at ${ctx.paths.dbPath}`, "run 'aiset init' first");
  }
  const db = openDb(ctx.paths.dbPath, { create: false });
  if (!isCurrent(db)) {
    db.close();
    throw new AisetError("the database schema is behind this binary", "run 'aiset db migrate'");
  }
  return db;
}

/** Opens (creating if needed) without the migration check — for `init` and `db migrate`. */
export function openOrCreateDb(ctx: Context): Db {
  return openDb(ctx.paths.dbPath);
}

/**
 * Commander scopes options to the command they are declared on, so `--json` is
 * registered on every leaf and resolved here by walking up the command chain.
 * Only values actually typed on the command line win, so `--no-color`'s default
 * (true) on an inner command cannot override an explicit outer `--no-color`.
 */
export function globalsFrom(leaf: CommandLike): GlobalOptions {
  const out: GlobalOptions = {};
  const keys = ["json", "color", "db"] as const;
  for (let cmd: CommandLike | null = leaf; cmd; cmd = cmd.parent) {
    for (const key of keys) {
      if (out[key] === undefined && cmd.getOptionValueSource(key) === "cli") {
        out[key] = cmd.getOptionValue(key) as never;
      }
    }
  }
  return out;
}

/** The slice of commander's Command that `globalsFrom` needs. */
export interface CommandLike {
  parent: CommandLike | null;
  getOptionValueSource(key: string): string | undefined;
  getOptionValue(key: string): unknown;
}
