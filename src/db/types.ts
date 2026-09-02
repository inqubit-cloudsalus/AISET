import { z } from "zod";
import { SchemaDriftError } from "../core/errors.ts";

export const RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "killed",
] as const;
export const VERDICTS = ["GREEN", "AMBER", "RED"] as const;
export const EVENT_TYPES = [
  "start",
  "stdout",
  "stderr",
  "tool",
  "artifact",
  "timeout",
  "recover",
  "end",
] as const;
export const ARTIFACT_KINDS = ["spec", "patch", "test-report", "review-package", "log"] as const;
export const ENGINES = ["opencode", "mock"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses a run can never leave. The single definition every caller shares. */
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "succeeded",
  "failed",
  "timeout",
  "killed",
]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as RunStatus);
}

export type Verdict = (typeof VERDICTS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** SQLite has no JSON type: these columns are TEXT and decoded at this boundary only. */
const jsonColumn = z
  .string()
  .nullable()
  .transform((v, ctx) => {
    if (v === null) return null;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "column is not valid JSON" });
      return z.NEVER;
    }
  });

export const RunSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().nullable(),
  task_title: z.string().min(1),
  engine: z.enum(ENGINES),
  model: z.string().nullable(),
  status: z.enum(RUN_STATUSES),
  verdict: z.enum(VERDICTS).nullable(),
  started_at: z.string().min(1),
  ended_at: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  workdir: z.string().nullable(),
  parent_run_id: z.string().nullable(),
  /** Root OpenCode session this run drives; null for mock and pre-adapter runs. */
  opencode_session_id: z.string().nullable(),
  /** When a stop was asked for; the owning pump polls this to abort the session. */
  cancel_requested_at: z.string().nullable(),
  /** The process driving this run. Null on rows written before recovery existed. */
  owner_pid: z.number().int().nullable(),
  owner_host: z.string().nullable(),
  /** One ULID per AISET process, so a reused pid cannot pass for the same owner. */
  owner_nonce: z.string().nullable(),
  /** Last sign of life from the owner; a stale one is what marks a run orphaned. */
  heartbeat_at: z.string().nullable(),
  /** The OpenCode server this run's session lives on, for re-attaching to it. */
  server_url: z.string().nullable(),
  schema_version: z.string(),
  meta: jsonColumn,
});
export type Run = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  id: z.number().int(),
  run_id: z.string().min(1),
  seq: z.number().int(),
  ts: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  level: z.string(),
  message: z.string().nullable(),
  data: jsonColumn,
  /** OpenCode agent that produced the event ("build", "explore", …); null if unattributed. */
  agent: z.string().nullable(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunArtifactSchema = z.object({
  id: z.number().int(),
  run_id: z.string().min(1),
  kind: z.enum(ARTIFACT_KINDS),
  path: z.string().min(1),
  sha256: z.string().nullable(),
  bytes: z.number().int().nullable(),
  schema_version: z.string().nullable(),
  created_at: z.string().min(1),
});
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

export const RunUsageSchema = z.object({
  id: z.number().int(),
  run_id: z.string().min(1),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  /** The assistant message this usage was reported on; null for older rows. */
  message_id: z.string().nullable(),
  recorded_at: z.string().min(1),
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

/** Parses a raw SQLite row, converting a mismatch into a loud, named failure. */
export function parseRow<T>(schema: z.ZodType<T>, table: string, row: unknown): T {
  const result = schema.safeParse(row);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new SchemaDriftError(table, detail);
}

export function parseRows<T>(schema: z.ZodType<T>, table: string, rows: unknown[]): T[] {
  return rows.map((r) => parseRow(schema, table, r));
}
