import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface Migration {
  version: string;
  sql: string;
}

export interface MigrationStatus {
  version: string;
  applied: boolean;
  appliedAt: string | null;
}

/** All migrations on disk, ordered by filename (which encodes the version). */
export function availableMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      version: f.replace(/\.sql$/, ""),
      sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
    }));
}

function hasMigrationsTable(db: Db): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  return row !== null;
}

export function appliedVersions(db: Db): Map<string, string> {
  if (!hasMigrationsTable(db)) return new Map();
  const rows = db
    .query("SELECT version, applied_at FROM schema_migrations ORDER BY version")
    .all() as { version: string; applied_at: string }[];
  return new Map(rows.map((r) => [r.version, r.applied_at]));
}

/**
 * Applies every migration not yet recorded, each inside a transaction.
 * Idempotent: running twice leaves exactly one row per version.
 * Returns the versions applied by this call.
 */
export function migrate(db: Db): string[] {
  const done = appliedVersions(db);
  const applied: string[] = [];
  for (const m of availableMigrations()) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        m.version,
        new Date().toISOString(),
      );
    })();
    applied.push(m.version);
  }
  return applied;
}

export function migrationStatus(db: Db): MigrationStatus[] {
  const done = appliedVersions(db);
  return availableMigrations().map((m) => ({
    version: m.version,
    applied: done.has(m.version),
    appliedAt: done.get(m.version) ?? null,
  }));
}

export function isCurrent(db: Db): boolean {
  return migrationStatus(db).every((s) => s.applied);
}
