import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { AisetError } from "../core/errors.ts";
import { nowIso } from "../core/ids.ts";
import { log } from "../core/logger.ts";
import type { Db } from "../db/client.ts";
import { addArtifact, listArtifacts } from "../db/repositories/artifacts.ts";
import { appendEvent, listEvents } from "../db/repositories/events.ts";
import { createRun, getRun, updateRun } from "../db/repositories/runs.ts";
import { listUsage, recordUsage, usageTotals } from "../db/repositories/usage.ts";
import type { Run, RunArtifact, RunEvent, RunStatus, RunUsage } from "../db/types.ts";
import { HttpOpenCodeApi, type OpenCodeApi } from "./client.ts";
import { EventMapper } from "./mapper.ts";
import { type OpenCodeServer, startServer } from "./server.ts";
import type { Mapped, StartTask } from "./types.ts";

export interface AdapterOptions {
  bin?: string;
  hostname?: string;
  port?: number;
  /** Watchdog: a run still open after this long is recorded as `timeout`. */
  timeoutMs?: number;
  /** Injected in tests so no OpenCode process is ever spawned. */
  transport?: { api: OpenCodeApi; sessionId: string; stop?: () => Promise<void> };
}

/** A live run. `finished` resolves with the terminal row once the stream closes. */
export interface RunHandle {
  runId: string;
  sessionId: string;
  finished: Promise<Run>;
}

export interface Capture {
  run: Run;
  artifacts: RunArtifact[];
  usage: RunUsage[];
  totals: ReturnType<typeof usageTotals>;
}

interface LiveRun {
  abort: AbortController;
  api: OpenCodeApi;
  sessionId: string;
  /** Set by `kill` before it aborts, so the pump knows the stream ended on purpose. */
  killed: boolean;
}

/** Live runs owned by this process, so `kill` can reach the OpenCode session. */
const live = new Map<string, LiveRun>();

const TERMINAL: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "timeout", "killed"]);

function title(task: StartTask): string {
  if (task.title) return task.title;
  const first = task.prompt.trim().split("\n")[0] ?? task.prompt;
  return first.length <= 80 ? first : `${first.slice(0, 79)}…`;
}

/**
 * Launches a multi-agent OpenCode run and streams it into SQLite.
 *
 * The `runs` row is created before anything is spawned, so a run exists to look
 * at even when OpenCode fails to start. Everything after that is written by the
 * pump from OpenCode's own event stream — nothing is stored that OpenCode did
 * not report.
 */
export async function start(
  db: Db,
  task: StartTask,
  opts: AdapterOptions = {},
): Promise<RunHandle> {
  const workdir = resolve(task.workdir ?? process.cwd());
  const run = createRun(db, {
    taskId: task.taskId ?? null,
    taskTitle: title(task),
    engine: "opencode",
    model: task.model ?? null,
    status: "pending",
    workdir,
    parentRunId: task.parentRunId ?? null,
    meta: { prompt: task.prompt, agent: task.agent ?? null },
  });

  let server: OpenCodeServer | null = null;
  let api: OpenCodeApi;
  let sessionId: string;
  try {
    if (opts.transport) {
      api = opts.transport.api;
      sessionId = opts.transport.sessionId;
    } else {
      server = await startServer({
        bin: opts.bin ?? "opencode",
        hostname: opts.hostname ?? "127.0.0.1",
        port: opts.port ?? 0,
        cwd: workdir,
      });
      api = new HttpOpenCodeApi(server.url, workdir);
      sessionId = await api.createSession({ title: run.task_title, agent: task.agent });
    }
  } catch (err) {
    // The run must never be left `pending` because the engine would not start.
    appendEvent(db, {
      runId: run.id,
      type: "stderr",
      level: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    finalize(db, run.id, "failed", 1);
    await server?.stop();
    throw err;
  }

  updateRun(db, run.id, { status: "running", opencodeSessionId: sessionId });
  appendEvent(db, {
    runId: run.id,
    type: "start",
    message: task.prompt.trim(),
    data: { sessionId, agent: task.agent ?? null, model: task.model ?? null, workdir },
  });

  const abort = new AbortController();
  const handle: LiveRun = { abort, api, sessionId, killed: false };
  live.set(run.id, handle);

  const stop = opts.transport?.stop ?? (() => server?.stop() ?? Promise.resolve());
  const finished = pump(db, run.id, workdir, handle, opts.timeoutMs).finally(async () => {
    live.delete(run.id);
    abort.abort();
    await stop();
  });

  try {
    await api.prompt({ sessionId, text: task.prompt, agent: task.agent, model: task.model });
  } catch (err) {
    abort.abort();
    await finished.catch(() => {});
    throw err;
  }

  return { runId: run.id, sessionId, finished };
}

/** Consumes the event stream to its end, writing every mapped row as it arrives. */
async function pump(
  db: Db,
  runId: string,
  workdir: string,
  handle: LiveRun,
  timeoutMs?: number,
): Promise<Run> {
  const { abort, api } = handle;
  const mapper = new EventMapper(handle.sessionId);
  let terminal: RunStatus | null = null;

  const watchdog =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          terminal = "timeout";
          appendEvent(db, {
            runId,
            type: "timeout",
            level: "error",
            message: `no result after ${timeoutMs} ms`,
            data: { timeoutMs },
          });
          abort.abort();
        }, timeoutMs);

  try {
    for await (const ev of api.events(abort.signal)) {
      const mapped = mapper.map(ev);
      writeMapped(db, runId, workdir, mapped);
      if (mapped.terminal) {
        terminal = mapped.terminal;
        break;
      }
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      appendEvent(db, {
        runId,
        type: "stderr",
        level: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      terminal ??= "failed";
    }
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }

  // An aborted stream with no verdict of its own is a kill, not a success.
  const status: RunStatus = terminal ?? (handle.killed ? "killed" : "failed");
  return finalize(db, runId, status, status === "succeeded" ? 0 : 1);
}

function writeMapped(db: Db, runId: string, workdir: string, mapped: Mapped): void {
  for (const e of mapped.events) {
    appendEvent(db, {
      runId,
      type: e.type,
      level: e.level,
      message: e.message,
      agent: e.agent,
      data: e.data,
    });
  }
  for (const a of mapped.artifacts) {
    const full = isAbsolute(a.path) ? a.path : resolve(workdir, a.path);
    const digest = digestOf(full);
    addArtifact(db, {
      runId,
      kind: a.kind,
      path: a.path,
      sha256: digest.sha256,
      bytes: digest.bytes,
    });
    appendEvent(db, {
      runId,
      type: "artifact",
      message: a.path,
      data: { kind: a.kind, path: a.path, bytes: digest.bytes },
    });
  }
  for (const u of mapped.usage) {
    recordUsage(db, {
      runId,
      provider: u.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      costUsd: u.costUsd,
    });
  }
}

/** A file OpenCode reported but that is gone or unreadable is recorded without a digest. */
function digestOf(path: string): { sha256: string | null; bytes: number | null } {
  try {
    const bytes = readFileSync(path);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    return { sha256: hasher.digest("hex"), bytes: bytes.byteLength };
  } catch {
    return { sha256: null, bytes: null };
  }
}

/**
 * The single exit for every terminal path — success, failure, kill, timeout.
 * Idempotent, so a race between the watchdog and the stream still leaves exactly
 * one `end` event and one closed run.
 */
export function finalize(db: Db, runId: string, status: RunStatus, exitCode: number): Run {
  const current = getRun(db, runId);
  if (TERMINAL.has(current.status) && current.ended_at !== null) return current;
  const endedAt = nowIso();
  appendEvent(db, {
    runId,
    type: "end",
    level: status === "succeeded" ? "info" : "error",
    message: status,
    ts: endedAt,
    data: { status, exitCode },
  });
  const run = updateRun(db, runId, { status, endedAt, exitCode });
  log("info", "run.finalized", { runId, status, exitCode });
  return run;
}

export interface ObserveOptions {
  afterSeq?: number;
  signal?: AbortSignal;
  pollMs?: number;
}

/**
 * Streams a run's events in `seq` order, live or after the fact.
 *
 * The source is always SQLite, never the in-memory pump, so observing works
 * from another process and survives a restart of whatever started the run.
 */
export async function* observe(
  db: Db,
  runId: string,
  opts: ObserveOptions = {},
): AsyncIterable<RunEvent> {
  const pollMs = opts.pollMs ?? 200;
  let after = opts.afterSeq ?? 0;
  for (;;) {
    const batch = listEvents(db, runId, { afterSeq: after, limit: 500 });
    for (const e of batch) {
      yield e;
      after = e.seq;
    }
    if (opts.signal?.aborted) return;
    // Re-read the run only once the batch is drained, so the final events are
    // always yielded before the loop notices the run has closed.
    if (batch.length === 0) {
      if (TERMINAL.has(getRun(db, runId).status)) return;
      await Bun.sleep(pollMs);
    }
  }
}

/** Everything a finished run produced. */
export function capture(db: Db, runId: string): Capture {
  return {
    run: getRun(db, runId),
    artifacts: listArtifacts(db, runId),
    usage: listUsage(db, runId),
    totals: usageTotals(db, runId),
  };
}

/**
 * Stops a run. Aborts the OpenCode session when this process owns it; either
 * way the run is closed in SQLite rather than left stuck in `running`.
 */
export async function kill(db: Db, runId: string): Promise<Run> {
  const run = getRun(db, runId);
  if (TERMINAL.has(run.status)) return run;
  const handle = live.get(runId);
  if (handle) {
    handle.killed = true;
    await handle.api.abort(handle.sessionId).catch(() => {});
    handle.abort.abort();
  } else if (run.opencode_session_id === null) {
    throw new AisetError(
      `run ${runId} has no OpenCode session to stop`,
      "it never reached the engine; it will be closed as killed",
    );
  }
  return finalize(db, runId, "killed", 130);
}
