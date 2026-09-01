import { createElement } from "react";
import { AisetError, NotFoundError } from "../../core/errors.ts";
import { normalizeRunId } from "../../core/ids.ts";
import { listArtifacts } from "../../db/repositories/artifacts.ts";
import { countEvents, listEvents } from "../../db/repositories/events.ts";
import { findRun, listRuns, runDurationMs } from "../../db/repositories/runs.ts";
import { usageTotals } from "../../db/repositories/usage.ts";
import { isTerminal, RUN_STATUSES, type RunStatus } from "../../db/types.ts";
import { type CancelResult, cancel } from "../../opencode/adapter.ts";
import { toArtifactRow, toEventRow, toRunRow } from "../../ui/mappers.ts";
import type { RunCancelModel, RunDetailModel, RunListModel, TailModel } from "../../ui/models.ts";
import { plainRunCancel, plainRunDetail, plainRunList, plainTail } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import { toneForVerdict } from "../../ui/theme.ts";
import { type Context, requireDb } from "../context.ts";

export interface ListOptions {
  status?: string;
  limit?: string;
}

function parseStatus(value: string | undefined): RunStatus | undefined {
  if (!value) return undefined;
  if (!(RUN_STATUSES as readonly string[]).includes(value)) {
    throw new AisetError(`unknown status: ${value}`, `expected one of: ${RUN_STATUSES.join(", ")}`);
  }
  return value as RunStatus;
}

export async function runRunsList(ctx: Context, opts: ListOptions): Promise<number> {
  const status = parseStatus(opts.status);
  const limit = opts.limit ? Number.parseInt(opts.limit, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new AisetError(`--limit must be a positive integer, got: ${opts.limit}`);
  }

  const db = requireDb(ctx);
  const model: RunListModel = {
    runs: listRuns(db, { status, limit }).map(toRunRow),
    filterStatus: status ?? null,
    limit,
  };
  db.close();

  await renderView(
    {
      json: () => model.runs,
      plain: (theme) => plainRunList(model, theme),
      ink: async (theme) => {
        const { RunListView } = await import("../../ui/views/RunListView.tsx");
        return createElement(RunListView, { model, theme });
      },
    },
    ctx,
  );
  return 0;
}

export interface ShowOptions {
  events?: boolean;
}

export async function runRunsShow(ctx: Context, id: string, opts: ShowOptions): Promise<number> {
  const runId = normalizeRunId(id);
  const db = requireDb(ctx);
  const run = findRun(db, runId);
  if (!run) {
    db.close();
    throw new NotFoundError("run", id);
  }

  const model: RunDetailModel = {
    run: toRunRow(run),
    engine: run.engine,
    model: run.model,
    verdict: run.verdict,
    verdictTone: toneForVerdict(run.verdict),
    endedAt: run.ended_at,
    exitCode: run.exit_code,
    workdir: run.workdir,
    parentRunId: run.parent_run_id,
    events: listEvents(db, runId).map(toEventRow),
    eventCount: countEvents(db, runId),
    artifacts: listArtifacts(db, runId).map(toArtifactRow),
    usage: usageTotals(db, runId),
    // JSON always carries the full timeline; the human views honour --events.
    showEvents: opts.events ?? false,
  };
  db.close();

  await renderView(
    {
      json: () => ({
        ...model,
        durationMs: runDurationMs(run),
      }),
      plain: (theme) => plainRunDetail(model, theme),
      ink: async (theme) => {
        const { RunDetailView } = await import("../../ui/views/RunDetailView.tsx");
        return createElement(RunDetailView, { model, theme });
      },
    },
    ctx,
  );
  return 0;
}

export interface CancelOptions {
  wait?: string;
}

/**
 * Stops an active run. The request is recorded in the database, so it reaches
 * the OpenCode session even when another process is the one driving it.
 */
export async function runRunsCancel(
  ctx: Context,
  id: string,
  opts: CancelOptions,
): Promise<number> {
  const runId = normalizeRunId(id);
  const graceMs = opts.wait === undefined ? undefined : Number.parseInt(opts.wait, 10);
  if (graceMs !== undefined && (!Number.isFinite(graceMs) || graceMs < 0)) {
    throw new AisetError(`--wait must be a non-negative number of milliseconds, got: ${opts.wait}`);
  }

  const db = requireDb(ctx);
  let result: CancelResult;
  try {
    if (!findRun(db, runId)) throw new NotFoundError("run", id);
    result = await cancel(db, runId, { graceMs });
  } finally {
    db.close();
  }

  const model: RunCancelModel = {
    run: toRunRow(result.run),
    endedAt: result.run.ended_at,
    exitCode: result.run.exit_code,
    cancelRequestedAt: result.run.cancel_requested_at,
    alreadyFinished: result.alreadyFinished,
    owner: result.owner,
    confirmed: result.confirmed,
  };

  await renderView(
    {
      json: () => model,
      plain: (theme) => plainRunCancel(model, theme),
    },
    ctx,
  );
  // An unconfirmed stop closed the row on a guess, which is not a clean cancel.
  return result.confirmed ? 0 : 1;
}

/**
 * Follows a run's events by polling the database on the `seq` watermark.
 * Nothing is displayed that the database does not already contain — when the
 * adapter lands, it writes events and this view shows them, unchanged.
 */
export async function runRunsTail(ctx: Context, id: string): Promise<number> {
  const runId = normalizeRunId(id);

  const read = (afterSeq: number): TailModel => {
    const db = requireDb(ctx);
    try {
      const run = findRun(db, runId);
      if (!run) throw new NotFoundError("run", id);
      return {
        run: toRunRow(run),
        events: listEvents(db, runId, { afterSeq }).map(toEventRow),
        finished: isTerminal(run.status),
      };
    } finally {
      db.close();
    }
  };

  const initial = read(0);

  await renderView(
    {
      json: () => initial,
      // Non-interactive: print the events recorded so far and exit, rather than
      // block forever on a pipe.
      plain: (theme) => plainTail(initial, theme),
      live: true,
      ink: async (theme) => {
        const { RunTailView } = await import("../../ui/views/RunTailView.tsx");
        return createElement(RunTailView, { initial, poll: read, theme });
      },
    },
    ctx,
  );
  return 0;
}
