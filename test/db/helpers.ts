import { openDb } from "../../src/db/client.ts";
import { migrate } from "../../src/db/migrate.ts";

/** An in-memory database with all migrations applied. */
export function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}
