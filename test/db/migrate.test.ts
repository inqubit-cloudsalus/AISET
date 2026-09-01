import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db/client.ts";
import { appliedVersions, isCurrent, migrate, migrationStatus } from "../../src/db/migrate.ts";

describe("migrations", () => {
  test("applies 0001_init and reports current", () => {
    const db = openDb(":memory:");
    const applied = migrate(db);
    expect(applied).toContain("0001_init");
    expect(isCurrent(db)).toBe(true);
    db.close();
  });

  test("is idempotent — running twice leaves one row per version", () => {
    const db = openDb(":memory:");
    migrate(db);
    const second = migrate(db);
    expect(second).toEqual([]);
    const rows = db
      .query("SELECT version, COUNT(*) AS n FROM schema_migrations GROUP BY version")
      .all() as { version: string; n: number }[];
    for (const r of rows) expect(r.n).toBe(1);
    expect(appliedVersions(db).size).toBe(rows.length);
    db.close();
  });

  test("status on an empty database reports nothing applied", () => {
    const db = openDb(":memory:");
    const status = migrationStatus(db);
    expect(status.length).toBeGreaterThan(0);
    expect(status.every((s) => !s.applied)).toBe(true);
    expect(isCurrent(db)).toBe(false);
    db.close();
  });

  test("creates every table the schema promises", () => {
    const db = openDb(":memory:");
    migrate(db);
    const names = (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ["runs", "run_events", "run_artifacts", "run_usage", "schema_migrations"]) {
      expect(names).toContain(t);
    }
    db.close();
  });
});
