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
  events: EventRow[];
  eventCount: number;
  artifacts: ArtifactRow[];
  usage: UsageTotalsModel;
  showEvents: boolean;
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
