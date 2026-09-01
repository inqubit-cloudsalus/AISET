import type { Db } from "../client.ts";

export interface TableCount {
  name: string;
  rows: number;
}

/**
 * The data tables the shell reports on, in dependency order. Listed explicitly
 * rather than discovered from `sqlite_master` so that internal tables
 * (`schema_migrations`, `sqlite_sequence`) never leak into the UI.
 */
const DATA_TABLES = ["runs", "run_events", "run_artifacts", "run_usage"] as const;

function countTable(db: Db, table: string): number {
  // Table names cannot be bound as parameters; the list above is a closed constant.
  const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | null;
  return row?.n ?? 0;
}

/** Row counts per data table — what `/db-status` and `aiset db status` display. */
export function tableCounts(db: Db): TableCount[] {
  return DATA_TABLES.map((name) => ({ name, rows: countTable(db, name) }));
}

/** Total events across all runs, for the shell's connection banner. */
export function countAllEvents(db: Db): number {
  return countTable(db, "run_events");
}
