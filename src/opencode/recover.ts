/**
 * Recovery after AISET itself dies.
 *
 * Everything a run produced is already in SQLite — that part survives a crash
 * on its own. What does not survive is the process holding the OpenCode
 * session: its run is left at `running` forever, and its agent may still be
 * working, and spending, with nobody reading the result.
 *
 * So recovery reads the persisted state back and does one of two honest things
 * with each abandoned run: re-attach to a session the engine still has, and let
 * the run finish for real; or close it as killed, having first stopped the
 * agent. It never invents an outcome, and it never touches a run whose owner is
 * still beating.
 */
import { log } from "../core/logger.ts";
import type { Db } from "../db/client.ts";
import { listArtifacts } from "../db/repositories/artifacts.ts";
import { appendEvent, listEvents } from "../db/repositories/events.ts";
import {
  findRun,
  getRun,
  listChildRuns,
  listRecoverableRuns,
  listRunsOnServer,
} from "../db/repositories/runs.ts";
import { listUsage } from "../db/repositories/usage.ts";
import { type Run, type RunStatus, TERMINAL_STATUSES } from "../db/types.ts";
import { attach, exitCodeFor, finalize, liveRunIds, writeMapped } from "./adapter.ts";
import { HttpOpenCodeApi, type OpenCodeApi } from "./client.ts";
import { rollup } from "./group.ts";
import { EventMapper, type PriorState } from "./mapper.ts";
import { describeOwner, isOrphaned, type OrphanOptions } from "./ownership.ts";
import { stopServerAt } from "./server.ts";
import type { OpenCodeEvent } from "./types.ts";

/** What recovery did with one run. */
export type RecoverAction = "reattached" | "closed" | "skipped";

export interface Recovered {
  runId: string;
  action: RecoverAction;
  /** Why this run was left where it was, in one line fit to print. */
  reason: string;
  /** Present only for a re-attached run: the pump that now owns it. */
  finished?: Promise<Run>;
}

/** A live session recovery managed to reach, or null when there is none. */
export interface RecoverTransport {
  api: OpenCodeApi;
  sessionId: string;
}

export interface RecoverOptions extends OrphanOptions {
  /** Report what would happen and write nothing. */
  dryRun?: boolean;
  /** Injected in tests; the default probes the server recorded on the run. */
  probe?: (run: Run) => Promise<RecoverTransport | null>;
  /** Injected in tests so no port is ever killed. */
  stopServer?: (url: string) => Promise<void>;
  /** Passed on to the pump a re-attached run is handed to. */
  cancelPollMs?: number;
  timeoutMs?: number;
}

/** Non-terminal runs nobody is driving any more. */
export function findOrphans(db: Db, opts: RecoverOptions = {}): Run[] {
  const local = opts.local ?? liveRunIds();
  return listRecoverableRuns(db).filter((run) => isOrphaned(run, { ...opts, local }));
}

/** One line for a banner or a doctor check, or null when nothing is orphaned. */
export function orphanNotice(db: Db, opts: RecoverOptions = {}): string | null {
  const n = findOrphans(db, opts).length;
  if (n === 0) return null;
  const subject = n === 1 ? "1 run was" : `${n} runs were`;
  return `${subject} left open by a process that is gone — 'aiset recover' closes or resumes them`;
}

/**
 * Rebuilds what the run's mapper had learned, from the rows it already wrote.
 *
 * This is the whole of "recover persisted state from SQLite": the subagent
 * sessions the run owns, and every tool call, message and artifact already
 * recorded. Without it a reconnect that replays history would double-count the
 * run's spend, and events from a subagent discovered before the crash would be
 * dropped as belonging to somebody else.
 */
export function rebuildMapper(db: Db, runId: string, rootSessionId: string): EventMapper {
  const childSessions: string[] = [];
  const toolStates: string[] = [];
  const agentBySession: [string, string][] = [];

  for (const event of listEvents(db, runId)) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
    if (event.type === "tool") {
      if (sessionId !== null && typeof data.parentSessionId === "string") {
        childSessions.push(sessionId);
      }
      if (typeof data.callId === "string" && typeof data.status === "string") {
        toolStates.push(`${data.callId}:${data.status}`);
      }
    }
    if (event.agent !== null && sessionId !== null) agentBySession.push([sessionId, event.agent]);
  }

  // Spend is deduped against the usage rows themselves rather than the event
  // log: a message whose text was empty produced a usage row and no event, and
  // counting it twice would overstate what the run actually cost.
  const messages = listUsage(db, runId)
    .map((u) => u.message_id)
    .filter((id): id is string => id !== null);

  const prior: PriorState = {
    childSessions,
    toolStates,
    messages,
    artifacts: listArtifacts(db, runId).map((a) => a.path),
    agentBySession,
  };
  return new EventMapper(rootSessionId, prior);
}

/**
 * Replays the session's history into the run, and says whether it is over.
 *
 * The event stream carries only what happens after you connect, so a run whose
 * process died has a hole in it: everything the agent did while nobody was
 * listening — up to and including finishing. Reading the history back closes
 * that hole. It is safe to replay because the mapper was rebuilt from the rows
 * the run already has, so anything recorded once is not recorded again.
 *
 * The messages are fed in the order the live stream would have produced them:
 * the message registered first, then its parts, then the message again once
 * complete — which is when its usage and prose are recorded.
 */
async function catchUp(
  db: Db,
  run: Run,
  transport: RecoverTransport,
  mapper: EventMapper,
): Promise<{ settled: boolean }> {
  if (!transport.api.messages) return { settled: false };
  const history = await transport.api.messages(transport.sessionId);
  const workdir = run.workdir ?? process.cwd();
  const write = (ev: OpenCodeEvent) => writeMapped(db, run.id, workdir, mapper.map(ev));

  for (const message of history) {
    // Without `time.completed` this reads as a message still being written, so
    // it registers the message without yet claiming its usage.
    const opening = { ...message.info };
    delete opening.time;
    write({ type: "message.updated", properties: { info: opening } } as OpenCodeEvent);
    for (const part of message.parts) {
      write({ type: "message.part.updated", properties: { part } } as OpenCodeEvent);
    }
    write({ type: "message.updated", properties: { info: message.info } } as OpenCodeEvent);
  }

  // The turn is over when the last thing in the session is an assistant message
  // that completed. Anything else means the agent still has work in flight.
  const last = history.at(-1)?.info;
  const completed =
    last !== undefined &&
    last.role === "assistant" &&
    typeof last.time === "object" &&
    last.time !== null &&
    (last.time as Record<string, unknown>).completed !== undefined;
  return { settled: completed };
}

/** The default probe: ask the recorded server whether it still has the session. */
async function probeRecordedServer(run: Run): Promise<RecoverTransport | null> {
  if (run.server_url === null || run.opencode_session_id === null) return null;
  const api = new HttpOpenCodeApi(run.server_url, run.workdir ?? process.cwd());
  return (await api.sessionExists(run.opencode_session_id))
    ? { api, sessionId: run.opencode_session_id }
    : null;
}

function note(db: Db, runId: string, message: string, data: Record<string, unknown>): void {
  appendEvent(db, { runId, type: "recover", level: "warn", message, data });
}

/**
 * Closes an abandoned run, stopping its agent first if it can still be reached.
 *
 * `killed`, not `failed`: the run did not break, it was interrupted. Exit 130
 * is the same code a cancel leaves, because that is what this is — a stop the
 * run never got to hear about.
 */
async function closeOrphan(
  db: Db,
  run: Run,
  reason: string,
  transport: RecoverTransport | null,
  opts: RecoverOptions,
): Promise<Recovered> {
  if (transport) {
    // Reachable, and being closed rather than resumed: stop it spending.
    await transport.api.abort(transport.sessionId).catch(() => {});
  }
  note(db, run.id, `run recovered and closed: ${reason}`, {
    owner: describeOwner(run),
    serverUrl: run.server_url,
    sessionId: run.opencode_session_id,
  });
  finalize(db, run.id, "killed", exitCodeFor("killed"));
  await reapServer(db, run, opts);
  log("info", "run.recovered", { runId: run.id, action: "closed", reason });
  return { runId: run.id, action: "closed", reason };
}

/**
 * Stops a leaked OpenCode server, but only once nothing is using it.
 *
 * Runs launched together share one server through the pool, so killing it on
 * the first recovered run would take its siblings down with it.
 */
async function reapServer(db: Db, run: Run, opts: RecoverOptions): Promise<void> {
  if (run.server_url === null) return;
  if (listRunsOnServer(db, run.server_url).length > 0) return;
  await (opts.stopServer ?? stopServerAt)(run.server_url).catch(() => {});
}

/**
 * Recovers one run: re-attach if the engine still has it, close it otherwise.
 *
 * A run that is not an orphan is left exactly as it is — this is what keeps two
 * AISET processes from stealing each other's work.
 */
export async function recoverRun(
  db: Db,
  runId: string,
  opts: RecoverOptions = {},
): Promise<Recovered> {
  const run = getRun(db, runId);
  const local = opts.local ?? liveRunIds();
  if (!isOrphaned(run, { ...opts, local })) {
    const why = TERMINAL_STATUSES.has(run.status)
      ? `already ${run.status}`
      : "still owned by a live process";
    return { runId, action: "skipped", reason: why };
  }

  const owner = describeOwner(run) ?? "never claimed";

  // A group has no session; it is closed by its agents' roll-up, not here.
  if (listChildRuns(db, runId).length > 0) {
    return { runId, action: "skipped", reason: "group — recovered with its agents" };
  }

  if (opts.dryRun) {
    return { runId, action: "skipped", reason: `orphaned — ${owner}` };
  }

  if (run.server_url === null || run.opencode_session_id === null) {
    return closeOrphan(db, run, "it never reached the engine", null, opts);
  }

  const transport = await (opts.probe ?? probeRecordedServer)(run);
  if (!transport) {
    return closeOrphan(db, run, "its OpenCode server is gone", null, opts);
  }

  // Somebody asked for this run to stop before its owner died. Honour that
  // rather than resuming work the user has already said they do not want.
  if (run.cancel_requested_at !== null) {
    return closeOrphan(db, run, "a cancel was requested before the owner died", transport, opts);
  }

  note(db, runId, `run recovered and re-attached: ${owner}`, {
    owner,
    serverUrl: run.server_url,
    sessionId: transport.sessionId,
  });
  const mapper = rebuildMapper(db, runId, transport.sessionId);
  const caught = await catchUp(db, run, transport, mapper).catch(() => ({ settled: false }));

  if (caught.settled) {
    // The agent finished while nobody was listening. Its work is now recorded,
    // so the run is closed on what it actually did — not on the fact that we
    // were not there to see it.
    finalize(db, runId, "succeeded", exitCodeFor("succeeded"));
    await reapServer(db, getRun(db, runId), opts);
    log("info", "run.recovered", { runId, action: "reattached", settled: true });
    return {
      runId,
      action: "reattached",
      reason: "it had already finished; its result was recovered",
      finished: Promise.resolve(getRun(db, runId)),
    };
  }

  // The server was leased by a process that is gone, so nothing will release it
  // when this run ends. Reaping it here is the only thing left that can — and
  // `reapServer` still leaves it alone while any other run needs it.
  const finished = attach(db, runId, transport.api, transport.sessionId, {
    mapper,
    cancelPollMs: opts.cancelPollMs,
    timeoutMs: opts.timeoutMs,
  }).finally(() => reapServer(db, getRun(db, runId), opts));
  log("info", "run.recovered", { runId, action: "reattached" });
  return { runId, action: "reattached", reason: `session still alive — ${owner}`, finished };
}

/**
 * Recovers everything abandoned, agents before their groups.
 *
 * A group is closed only once its own agents are: it is a roll-up of them, so
 * `rollup` gives it the same verdict it would have reached had nothing crashed.
 * A group whose agents were re-attached is left running — its close is coming.
 */
export async function recoverAll(db: Db, opts: RecoverOptions = {}): Promise<Recovered[]> {
  const local = opts.local ?? liveRunIds();
  const orphans = findOrphans(db, { ...opts, local });
  const groups = orphans.filter((r) => listChildRuns(db, r.id).length > 0);
  const groupIds = new Set(groups.map((r) => r.id));

  const results: Recovered[] = [];
  for (const run of orphans) {
    if (groupIds.has(run.id)) continue;
    results.push(await recoverRun(db, run.id, { ...opts, local }));
  }
  // Agents this pass resumed, so a group can wait for the ones it owns rather
  // than judging them the instant they were handed back.
  const resumed = new Map<string, Promise<Run>>();
  for (const r of results) {
    if (r.finished) resumed.set(r.runId, r.finished);
  }
  for (const group of groups) {
    results.push(await recoverGroup(db, group, opts, resumed));
  }
  return results;
}

/** Closes a group on what its agents actually did. */
function rollUp(db: Db, group: Run): Recovered {
  const children = listChildRuns(db, group.id);
  const status: RunStatus = rollup(children.map((c) => c.status));
  note(db, group.id, `group recovered and rolled up: ${status}`, {
    owner: describeOwner(group),
    children: children.map((c) => ({ runId: c.id, status: c.status })),
  });
  finalize(db, group.id, status, exitCodeFor(status));
  log("info", "group.recovered", { runId: group.id, status });
  return { runId: group.id, action: "closed", reason: `rolled up from its agents: ${status}` };
}

async function recoverGroup(
  db: Db,
  group: Run,
  opts: RecoverOptions,
  resumed: Map<string, Promise<Run>>,
): Promise<Recovered> {
  if (opts.dryRun) {
    return { runId: group.id, action: "skipped", reason: "orphaned group — would roll up" };
  }
  const open = listChildRuns(db, group.id).filter((c) => !TERMINAL_STATUSES.has(c.status));
  const waiting = open.map((c) => resumed.get(c.id)).filter((p) => p !== undefined);

  if (open.length > 0) {
    // Every open agent is one we just resumed, so the group's close is ours to
    // finish: roll it up when they end. Without this a recovered group would be
    // left `running` for ever, with every one of its agents already closed.
    if (waiting.length === open.length) {
      const finished = Promise.all(waiting.map((p) => p.catch(() => {}))).then(() => {
        rollUp(db, group);
        return getRun(db, group.id);
      });
      return {
        runId: group.id,
        action: "skipped",
        reason: `waiting for the ${open.length} agents it just resumed`,
        finished,
      };
    }
    return {
      runId: group.id,
      action: "skipped",
      reason: `${open.length} of its agents are running again`,
    };
  }

  return rollUp(db, group);
}

/** Recovers one run by id, or everything. Used by the CLI and the shell alike. */
export async function recover(
  db: Db,
  id: string | undefined,
  opts: RecoverOptions = {},
): Promise<Recovered[]> {
  if (id === undefined) return recoverAll(db, opts);
  if (!findRun(db, id)) return [];
  return [await recoverRun(db, id, opts)];
}
