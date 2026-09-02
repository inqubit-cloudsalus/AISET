/**
 * View models — the exact data each view renders.
 *
 * The Ink views and the plain-text renderers both consume these and nothing else,
 * so the two paths cannot drift. Every field here is derived from the database:
 * a view may not display anything that is not in one of these models.
 */
import type { StatusTone } from "./theme.ts";

export interface RunRow {
  id: string;
  displayId: string;
  status: string;
  tone: StatusTone;
  taskTitle: string;
  taskId: string | null;
  startedAt: string;
  durationMs: number | null;
}

export interface HomeModel {
  version: string;
  dbPath: string;
  dbExists: boolean;
  initialized: boolean;
  totalRuns: number;
  countsByStatus: Record<string, number>;
  recentRuns: RunRow[];
}

export interface CheckResult {
  name: string;
  tone: StatusTone;
  detail: string;
  /** Only a `fail` tone sets the exit code; warnings do not. */
  ok: boolean;
}

export interface DoctorModel {
  checks: CheckResult[];
  ok: boolean;
}

export interface RunListModel {
  runs: RunRow[];
  filterStatus: string | null;
  limit: number;
}

export interface EventRow {
  seq: number;
  ts: string;
  type: string;
  level: string;
  message: string | null;
  /** OpenCode agent that produced the event; null for events AISET itself wrote. */
  agent: string | null;
  tone: StatusTone;
}

export interface ArtifactRow {
  kind: string;
  path: string;
  bytes: number | null;
  sha256: string | null;
  createdAt: string;
}

export interface UsageTotalsModel {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** The process driving a run, as far as the database knows. */
export interface OwnerModel {
  pid: number | null;
  host: string | null;
  heartbeatAt: string | null;
  /** No sign of life for long enough that the run counts as abandoned. */
  stale: boolean;
  serverUrl: string | null;
}

export interface RunDetailModel {
  run: RunRow;
  engine: string;
  model: string | null;
  verdict: string | null;
  verdictTone: StatusTone;
  endedAt: string | null;
  exitCode: number | null;
  workdir: string | null;
  parentRunId: string | null;
  /** Null when nothing ever claimed the run — every row written before recovery. */
  owner: OwnerModel | null;
  /** Runs launched under this one — the agents of a multi-agent group. */
  children: RunRow[];
  events: EventRow[];
  eventCount: number;
  artifacts: ArtifactRow[];
  usage: UsageTotalsModel;
  showEvents: boolean;
}

/** The outcome of `runs cancel`: what was asked, who could act, where it landed. */
export interface RunCancelModel {
  run: RunRow;
  endedAt: string | null;
  exitCode: number | null;
  cancelRequestedAt: string | null;
  /** The run had already closed; this call changed nothing. */
  alreadyFinished: boolean;
  /** "local" — we owned the session; "remote" — another process did; "none" — it never reached the engine. */
  owner: "local" | "remote" | "none";
  /** False when the owning process never confirmed the stop within the grace. */
  confirmed: boolean;
}

export interface RecoverEntryModel {
  displayId: string;
  action: "reattached" | "closed" | "skipped";
  tone: StatusTone;
  reason: string;
}

/** The outcome of `aiset recover`: what was found, and what was done about it. */
export interface RecoverModel {
  entries: RecoverEntryModel[];
  /** Nothing was written; the entries are what would have happened. */
  dryRun: boolean;
}

export interface MigrationRow {
  version: string;
  applied: boolean;
  appliedAt: string | null;
}

export interface TableCountRow {
  name: string;
  rows: number;
}

export interface DbStatusModel {
  dbPath: string;
  dbExists: boolean;
  current: boolean;
  migrations: MigrationRow[];
  /** Row counts per data table. Absent when the database could not be opened. */
  tables?: TableCountRow[];
}

export interface InitModel {
  stateDir: string;
  dbPath: string;
  configPath: string;
  createdStateDir: boolean;
  createdConfig: boolean;
  createdDb: boolean;
  migrationsApplied: string[];
}

export interface TailModel {
  run: RunRow;
  events: EventRow[];
  finished: boolean;
}

/** The shell's connection banner — every field read from the live database. */
export interface ShellHeaderModel {
  version: string;
  dbPath: string;
  schemaVersion: string | null;
  current: boolean;
  totalRuns: number;
  totalEvents: number;
}
