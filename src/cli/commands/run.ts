import { createElement } from "react";
import { readConfig } from "../../core/config.ts";
import { AisetError } from "../../core/errors.ts";
import { displayRunId } from "../../core/ids.ts";
import { listEvents } from "../../db/repositories/events.ts";
import { findRun } from "../../db/repositories/runs.ts";
import { isTerminal } from "../../db/types.ts";
import { start } from "../../opencode/adapter.ts";
import { toEventRow, toRunRow } from "../../ui/mappers.ts";
import type { TailModel } from "../../ui/models.ts";
import { plainTail } from "../../ui/plain.ts";
import { renderView, resolveOutputMode } from "../../ui/render.tsx";
import { type Context, requireDb } from "../context.ts";

export interface RunOptions {
  agent?: string;
  model?: string;
  workdir?: string;
  timeout?: string;
  task?: string;
  detach?: boolean;
  bin?: string;
}

function parseTimeout(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const ms = Number.parseInt(value, 10);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new AisetError(`--timeout must be a positive number of milliseconds, got: ${value}`);
  }
  return ms;
}

/**
 * Launches a multi-agent OpenCode run and follows it.
 *
 * The adapter writes every event, artifact and token count to SQLite as OpenCode
 * reports it; this command only displays what has landed there, which is why
 * `--detach` and a later `aiset runs tail` show exactly the same thing.
 */
export async function runRun(ctx: Context, prompt: string, opts: RunOptions): Promise<number> {
  if (prompt.trim().length === 0) {
    throw new AisetError("a run needs a prompt", 'e.g. aiset run "add a health endpoint"');
  }

  const config = await readConfig();
  const oc = config?.opencode;
  const db = requireDb(ctx);

  let handle: Awaited<ReturnType<typeof start>>;
  try {
    handle = await start(
      db,
      {
        prompt,
        taskId: opts.task ?? null,
        agent: opts.agent ?? oc?.agent,
        model: opts.model ?? oc?.model ?? null,
        workdir: opts.workdir,
      },
      {
        bin: opts.bin ?? oc?.bin,
        hostname: oc?.hostname,
        port: oc?.port,
        timeoutMs: parseTimeout(opts.timeout, oc?.timeoutMs ?? 600_000),
      },
    );
  } catch (err) {
    db.close();
    throw err;
  }

  // Detached: the run keeps going in this process only until it ends, so we
  // still await it, but print the id up front and nothing else.
  if (opts.detach) {
    process.stdout.write(`${displayRunId(handle.runId)}\n`);
    await handle.finished.catch(() => {});
    db.close();
    return 0;
  }

  const read = (afterSeq: number): TailModel => {
    const run = findRun(db, handle.runId);
    if (!run) throw new AisetError(`run ${handle.runId} vanished mid-flight`);
    return {
      run: toRunRow(run),
      events: listEvents(db, handle.runId, { afterSeq }).map(toEventRow),
      finished: isTerminal(run.status),
    };
  };

  // The plain and JSON paths cannot poll a live view, so they wait for the run
  // to close and then render the whole timeline in one deterministic block.
  const finish = async (): Promise<TailModel> => {
    await handle.finished.catch(() => {});
    return read(0);
  };

  const final = resolveOutputMode(ctx) === "tty" ? read(0) : await finish();

  await renderView(
    {
      json: () => final,
      plain: (theme) => plainTail(final, theme),
      live: true,
      ink: async (theme) => {
        const { RunTailView } = await import("../../ui/views/RunTailView.tsx");
        return createElement(RunTailView, { initial: final, poll: read, theme });
      },
    },
    ctx,
  );

  await handle.finished.catch(() => {});
  const run = findRun(db, handle.runId);
  db.close();
  return run?.status === "succeeded" ? 0 : 1;
}
