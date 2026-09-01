import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database;

/**
 * Opens (creating if needed) the AISET database.
 * `foreign_keys` is per-connection in SQLite — without it here, ON DELETE CASCADE
 * silently does nothing and the cascade tests would pass falsely.
 */
export function openDb(path: string, opts: { create?: boolean } = {}): Db {
  const create = opts.create ?? true;
  if (create && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create, readwrite: true });
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
