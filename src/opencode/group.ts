import { newRunIds } from "../core/ids.ts";
import { log } from "../core/logger.ts";
import type { Db } from "../db/client.ts";
import { appendEvent } from "../db/repositories/events.ts";
import { createRun, getRun, listChildRuns, requestCancel } from "../db/repositories/runs.ts";
import { type Run, type RunStatus, TERMINAL_STATUSES } from "../db/types.ts";
import {
  type AdapterOptions,
  type CancelOptions,
  type CancelResult,
  cancel,
  exitCodeFor,
  finalize,
  start,
} from "./adapter.ts";
import type { StartTask } from "./types.ts";

/** One agent's share of a group: its own prompt, its own OpenCode session. */
export type GroupTask = StartTask;

export interface GroupOptions extends AdapterOptions {
  /** Title for the parent row; defaults to a summary of the agents. */
  title?: string;
  /** How often the group looks for a cancel asked for by another process. */
  cancelPollMs?: number;
  /** Injected in tests so no OpenCode process is ever spawned. */
  transportFor?: (task: GroupTask, index: number) => AdapterOptions["transport"];
}

export interface GroupChild {
  runId: string;
  agent: string | null;
  sessionId: string | null;
  /** Set when this agent never reached the engine; its run is already `failed`. */
  error: string | null;
}

export interface GroupHandle {
  parentRunId: string;
  children: GroupChild[];
  /** Resolves with the closed parent row once every child has finished. */
  finished: Promise<Run>;
}

const CANCEL_POLL_MS = 500;

function groupTitle(tasks: GroupTask[]): string {
  const agents = tasks.map((t) => t.agent ?? "default").join(", ");
  return `${tasks.length} agents: ${agents}`;
}

/**
 * Rolls a team's outcomes into one.
 *
 * A group is only green when every agent is. A failure outranks a cancellation
 * because it is the more informative fact: work that was stopped on purpose is
 * not the same as work that broke.
 */
export function rollup(statuses: RunStatus[]): RunStatus {
  if (statuses.length === 0) return "failed";
  if (statuses.every((s) => s === "succeeded")) return "succeeded";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "timeout")) return "timeout";
  return "killed";
}

/**
 * Launches several OpenCode agents at once, tracked as one run.
 *
 * The parent is a bookkeeping row, not a session: it has no
 * `opencode_session_id` and never talks to the engine. What makes it a group is
 * that every agent's run points at it through `parent_run_id`, so the team can
 * be listed, watched and cancelled by one id.
 *
 * The agents are started concurrently and all land on one `opencode serve` via
 * the server pool. A task the engine refuses is already recorded `failed` by
 * `start`, so it is reported here rather than taking its siblings down.
 */
export async function startGroup(
  db: Db,
  tasks: GroupTask[],
  opts: GroupOptions = {},
): Promise<GroupHandle> {
  if (tasks.length === 0) throw new Error("a group needs at least one task");

  const parent = createRun(db, {
    taskTitle: opts.title ?? groupTitle(tasks),
    engine: "opencode",
    status: "running",
    workdir: tasks[0]?.workdir ?? process.cwd(),
    meta: {
      kind: "group",
      agents: tasks.map((t) => t.agent ?? null),
      prompts: tasks.map((t) => t.prompt),
    },
  });
  appendEvent(db, {
    runId: parent.id,
    type: "start",
    message: `launching ${tasks.length} agents`,
    data: { agents: tasks.map((t) => ({ agent: t.agent ?? null, prompt: t.prompt })) },
  });

  // Ids are minted up front and ascend, so a child is known before it starts —
  // an agent the engine refuses is still identifiable — and the team always
  // comes back from the database in the order it was launched.
  const runIds = newRunIds(tasks.length);
  const started = await Promise.allSettled(
    tasks.map((task, index) =>
      start(
        db,
        { ...task, runId: runIds[index]!, parentRunId: parent.id },
        { ...opts, transport: opts.transportFor?.(task, index) ?? opts.transport },
      ),
    ),
  );

  const children: GroupChild[] = [];
  const finishing: Promise<RunStatus>[] = [];
  started.forEach((result, index) => {
    const agent = tasks[index]?.agent ?? null;
    const runId = runIds[index]!;
    if (result.status === "fulfilled") {
      const handle = result.value;
      children.push({ runId, agent, sessionId: handle.sessionId, error: null });
      finishing.push(handle.finished.then((run) => run.status).catch(() => "failed" as RunStatus));
      return;
    }
    // `start` records and closes the row before it throws, so the agent that
    // never ran is still part of the group's account of itself.
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    appendEvent(db, {
      runId: parent.id,
      type: "stderr",
      level: "error",
      message: `agent ${agent ?? "default"} did not start: ${message}`,
      agent,
    });
    children.push({ runId, agent, sessionId: null, error: message });
    finishing.push(Promise.resolve("failed" as RunStatus));
  });

  const poller = watchForCancel(db, parent.id, opts);
  const finished = Promise.all(finishing)
    .then((statuses) => {
      const status = rollup(statuses);
      log("info", "group.finalized", { runId: parent.id, status, children: statuses.length });
      return finalize(db, parent.id, status, exitCodeFor(status));
    })
    .finally(() => clearInterval(poller));

  return { parentRunId: parent.id, children, finished };
}

/**
 * Watches the parent row for a cancel asked for elsewhere.
 *
 * Only a process holding the sessions can stop them, and the group is what a
 * user cancels, so the request has to travel from the parent row down to the
 * children. Mirrors the pump's own canceller.
 */
function watchForCancel(
  db: Db,
  parentRunId: string,
  opts: GroupOptions,
): ReturnType<typeof setInterval> {
  const poller = setInterval(() => {
    const parent = getRun(db, parentRunId);
    if (parent.cancel_requested_at === null) return;
    clearInterval(poller);
    for (const child of listChildRuns(db, parentRunId)) {
      if (TERMINAL_STATUSES.has(child.status)) continue;
      requestCancel(db, child.id);
    }
  }, opts.cancelPollMs ?? CANCEL_POLL_MS);
  return poller;
}

/** A group and the runs underneath it. */
export function groupOf(db: Db, parentRunId: string): { parent: Run; children: Run[] } {
  return { parent: getRun(db, parentRunId), children: listChildRuns(db, parentRunId) };
}

/**
 * Cancels every agent in a group and closes the group.
 *
 * `cancel` already routes a parent id here, so this is the same call by another
 * name; it exists so callers that know they hold a group can say so.
 */
export async function cancelGroup(
  db: Db,
  parentRunId: string,
  opts: CancelOptions = {},
): Promise<CancelResult> {
  return cancel(db, parentRunId, opts);
}
