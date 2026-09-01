import { NotFoundError } from "../../core/errors.ts";
import { newRunId, nowIso } from "../../core/ids.ts";
import type { Db } from "../client.ts";
import {
  parseRow,
  parseRows,
  type Run,
  RunSchema,
  type RunStatus,
  type Verdict,
} from "../types.ts";

const COLUMNS = `id, task_id, task_title, engine, model, status, verdict, started_at,
  ended_at, exit_code, workdir, parent_run_id, opencode_session_id, cancel_requested_at,
  schema_version, meta`;

export interface CreateRunInput {
  id?: string;
  taskId?: string | null;
  taskTitle: string;
  engine: "opencode" | "mock";
  model?: string | null;
  status?: RunStatus;
  startedAt?: string;
  workdir?: string | null;
  parentRunId?: string | null;
  opencodeSessionId?: string | null;
  meta?: unknown;
}

export function createRun(db: Db, input: CreateRunInput): Run {
  const id = input.id ?? newRunId();
  db.query(
    `INSERT INTO runs (id, task_id, task_title, engine, model, status, started_at,
       workdir, parent_run_id, opencode_session_id, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.taskId ?? null,
    input.taskTitle,
    input.engine,
    input.model ?? null,
    input.status ?? "pending",
    input.startedAt ?? nowIso(),
    input.workdir ?? null,
    input.parentRunId ?? null,
    input.opencodeSessionId ?? null,
    input.meta === undefined ? null : JSON.stringify(input.meta),
  );
  return getRun(db, id);
}

export function findRun(db: Db, id: string): Run | null {
  const row = db.query(`SELECT ${COLUMNS} FROM runs WHERE id = ?`).get(id);
  return row === null ? null : parseRow(RunSchema, "runs", row);
}

export function getRun(db: Db, id: string): Run {
  const run = findRun(db, id);
  if (!run) throw new NotFoundError("run", id);
  return run;
}

export interface ListRunsOptions {
  status?: RunStatus;
  limit?: number;
}

export function listRuns(db: Db, opts: ListRunsOptions = {}): Run[] {
  const limit = opts.limit ?? 20;
  const rows = opts.status
    ? db
        .query(
          `SELECT ${COLUMNS} FROM runs WHERE status = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
        )
        .all(opts.status, limit)
    : db.query(`SELECT ${COLUMNS} FROM runs ORDER BY started_at DESC, id DESC LIMIT ?`).all(limit);
  return parseRows(RunSchema, "runs", rows);
}

/** Runs that have not reached a terminal status, newest first. */
export function listActiveRuns(db: Db, limit = 20): Run[] {
  const rows = db
    .query(
      `SELECT ${COLUMNS} FROM runs WHERE status IN ('pending', 'running')
       ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(limit);
  return parseRows(RunSchema, "runs", rows);
}

export interface UpdateRunInput {
  status?: RunStatus;
  verdict?: Verdict | null;
  endedAt?: string | null;
  exitCode?: number | null;
  opencodeSessionId?: string | null;
  cancelRequestedAt?: string | null;
}

export function updateRun(db: Db, id: string, patch: UpdateRunInput): Run {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.verdict !== undefined) set("verdict", patch.verdict);
  if (patch.endedAt !== undefined) set("ended_at", patch.endedAt);
  if (patch.exitCode !== undefined) set("exit_code", patch.exitCode);
  if (patch.opencodeSessionId !== undefined) set("opencode_session_id", patch.opencodeSessionId);
  if (patch.cancelRequestedAt !== undefined) set("cancel_requested_at", patch.cancelRequestedAt);
  if (sets.length === 0) return getRun(db, id);
  getRun(db, id); // 404s before a silent no-op UPDATE
  db.query(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  return getRun(db, id);
}

/**
 * Records that a stop was asked for. The process that owns the run polls this
 * and aborts the OpenCode session; a repeat request keeps the first stamp.
 */
export function requestCancel(db: Db, id: string): Run {
  const run = getRun(db, id);
  if (run.cancel_requested_at !== null) return run;
  return updateRun(db, id, { cancelRequestedAt: nowIso() });
}

/** Run counts by status, for the home view. Statuses with no runs are omitted. */
export function countByStatus(db: Db): Record<string, number> {
  const rows = db.query("SELECT status, COUNT(*) AS n FROM runs GROUP BY status").all() as {
    status: string;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function countRuns(db: Db): number {
  const row = db.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
  return row.n;
}

/** Duration in ms, or null while the run is still open. */
export function runDurationMs(run: Run): number | null {
  if (!run.ended_at) return null;
  return new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
}
