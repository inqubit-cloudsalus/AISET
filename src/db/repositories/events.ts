import { nowIso } from "../../core/ids.ts";
import type { Db } from "../client.ts";
import { type EventType, parseRows, type RunEvent, RunEventSchema } from "../types.ts";

const COLUMNS = "id, run_id, seq, ts, type, level, message, data, agent";

export interface AppendEventInput {
  runId: string;
  type: EventType;
  level?: string;
  message?: string | null;
  ts?: string;
  data?: unknown;
  /** OpenCode agent that produced the event; omitted for events AISET itself writes. */
  agent?: string | null;
}

/**
 * Appends an event, allocating `seq` as MAX(seq)+1 for the run inside a transaction
 * so concurrent writers cannot collide on UNIQUE (run_id, seq).
 */
export function appendEvent(db: Db, input: AppendEventInput): RunEvent {
  const insert = db.transaction((): number => {
    const row = db
      .query("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_events WHERE run_id = ?")
      .get(input.runId) as { next: number };
    db.query(
      `INSERT INTO run_events (run_id, seq, ts, type, level, message, data, agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.runId,
      row.next,
      input.ts ?? nowIso(),
      input.type,
      input.level ?? "info",
      input.message ?? null,
      input.data === undefined ? null : JSON.stringify(input.data),
      input.agent ?? null,
    );
    return row.next;
  });
  const seq = insert();
  const rows = db
    .query(`SELECT ${COLUMNS} FROM run_events WHERE run_id = ? AND seq = ?`)
    .all(input.runId, seq);
  return parseRows(RunEventSchema, "run_events", rows)[0]!;
}

export interface ListEventsOptions {
  /** Return only events with seq strictly greater than this — the tail watermark. */
  afterSeq?: number;
  limit?: number;
}

export function listEvents(db: Db, runId: string, opts: ListEventsOptions = {}): RunEvent[] {
  const after = opts.afterSeq ?? 0;
  const limit = opts.limit ?? 500;
  const rows = db
    .query(
      `SELECT ${COLUMNS} FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(runId, after, limit);
  return parseRows(RunEventSchema, "run_events", rows);
}

export function countEvents(db: Db, runId: string): number {
  const row = db.query("SELECT COUNT(*) AS n FROM run_events WHERE run_id = ?").get(runId) as {
    n: number;
  };
  return row.n;
}
