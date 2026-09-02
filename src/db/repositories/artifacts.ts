import { nowIso } from "../../core/ids.ts";
import type { Db } from "../client.ts";
import { type ArtifactKind, parseRows, type RunArtifact, RunArtifactSchema } from "../types.ts";

const COLUMNS = "id, run_id, kind, path, sha256, bytes, schema_version, created_at";

export interface AddArtifactInput {
  runId: string;
  kind: ArtifactKind;
  path: string;
  sha256?: string | null;
  bytes?: number | null;
  schemaVersion?: string | null;
  createdAt?: string;
}

export function addArtifact(db: Db, input: AddArtifactInput): RunArtifact {
  const res = db
    .query(
      `INSERT INTO run_artifacts (run_id, kind, path, sha256, bytes, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.kind,
      input.path,
      input.sha256 ?? null,
      input.bytes ?? null,
      input.schemaVersion ?? null,
      input.createdAt ?? nowIso(),
    );
  const rows = db
    .query(`SELECT ${COLUMNS} FROM run_artifacts WHERE id = ?`)
    .all(Number(res.lastInsertRowid));
  return parseRows(RunArtifactSchema, "run_artifacts", rows)[0]!;
}

export function listArtifacts(db: Db, runId: string): RunArtifact[] {
  const rows = db
    .query(`SELECT ${COLUMNS} FROM run_artifacts WHERE run_id = ? ORDER BY id ASC`)
    .all(runId);
  return parseRows(RunArtifactSchema, "run_artifacts", rows);
}

/** Artifacts produced by a run and by every run launched under it. */
export function listArtifactsWithChildren(db: Db, runId: string): RunArtifact[] {
  const rows = db
    .query(
      `SELECT ${COLUMNS} FROM run_artifacts
       WHERE run_id = ? OR run_id IN (SELECT id FROM runs WHERE parent_run_id = ?)
       ORDER BY id ASC`,
    )
    .all(runId, runId);
  return parseRows(RunArtifactSchema, "run_artifacts", rows);
}
