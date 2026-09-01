/** Database rows → view models. The only place row shapes become display shapes. */
import { displayRunId } from "../core/ids.ts";
import { runDurationMs } from "../db/repositories/runs.ts";
import type { Run, RunArtifact, RunEvent } from "../db/types.ts";
import type { ArtifactRow, EventRow, RunRow } from "./models.ts";
import { type StatusTone, toneForStatus } from "./theme.ts";

export function toRunRow(run: Run): RunRow {
  return {
    id: run.id,
    displayId: displayRunId(run.id),
    status: run.status,
    tone: toneForStatus(run.status),
    taskTitle: run.task_title,
    taskId: run.task_id,
    startedAt: run.started_at,
    durationMs: runDurationMs(run),
  };
}

function toneForEvent(event: RunEvent): StatusTone {
  if (event.type === "end") return "ok";
  if (event.type === "timeout" || event.type === "stderr") return "fail";
  if (event.type === "recover") return "warn";
  if (event.level === "error") return "fail";
  if (event.level === "warn") return "warn";
  return "pending";
}

export function toEventRow(event: RunEvent): EventRow {
  return {
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    level: event.level,
    message: event.message,
    tone: toneForEvent(event),
  };
}

export function toArtifactRow(artifact: RunArtifact): ArtifactRow {
  return {
    kind: artifact.kind,
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    createdAt: artifact.created_at,
  };
}
