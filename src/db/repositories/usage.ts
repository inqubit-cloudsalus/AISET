import { nowIso } from "../../core/ids.ts";
import type { Db } from "../client.ts";
import { parseRows, type RunUsage, RunUsageSchema } from "../types.ts";

const COLUMNS = "id, run_id, provider, model, input_tokens, output_tokens, cost_usd, recorded_at";

export interface RecordUsageInput {
  runId: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  recordedAt?: string;
}

export function recordUsage(db: Db, input: RecordUsageInput): RunUsage {
  const res = db
    .query(
      `INSERT INTO run_usage (run_id, provider, model, input_tokens, output_tokens,
         cost_usd, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.provider ?? null,
      input.model ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.costUsd ?? null,
      input.recordedAt ?? nowIso(),
    );
  const rows = db
    .query(`SELECT ${COLUMNS} FROM run_usage WHERE id = ?`)
    .all(Number(res.lastInsertRowid));
  return parseRows(RunUsageSchema, "run_usage", rows)[0]!;
}

export function listUsage(db: Db, runId: string): RunUsage[] {
  const rows = db
    .query(`SELECT ${COLUMNS} FROM run_usage WHERE run_id = ? ORDER BY id ASC`)
    .all(runId);
  return parseRows(RunUsageSchema, "run_usage", rows);
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function usageTotals(db: Db, runId: string): UsageTotals {
  return listUsage(db, runId).reduce<UsageTotals>(
    (acc, u) => ({
      inputTokens: acc.inputTokens + (u.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (u.output_tokens ?? 0),
      costUsd: acc.costUsd + (u.cost_usd ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}
