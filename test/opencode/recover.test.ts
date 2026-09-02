import { describe, expect, test } from "bun:test";
import type { Db } from "../../src/db/client.ts";
import { listArtifacts } from "../../src/db/repositories/artifacts.ts";
import { listEvents } from "../../src/db/repositories/events.ts";
import { getRun, listChildRuns, requestCancel, updateRun } from "../../src/db/repositories/runs.ts";
import { usageTotals } from "../../src/db/repositories/usage.ts";
import type { Run } from "../../src/db/types.ts";
import type {
  CreateSessionInput,
  OpenCodeApi,
  PromptInput,
  SessionMessage,
} from "../../src/opencode/client.ts";
import { type GroupTask, startGroup } from "../../src/opencode/group.ts";
import { STALE_MS } from "../../src/opencode/ownership.ts";
import { findOrphans, orphanNotice, recoverAll, recoverRun } from "../../src/opencode/recover.ts";
import type { OpenCodeEvent } from "../../src/opencode/types.ts";
import { freshDb } from "../db/helpers.ts";

/**
 * One agent's session. `ending` is what the stream does after its first event —
 * the same shape `group.test.ts` uses, plus a queue the test can push to after
 * a recovery has re-attached.
 */
class AgentApi implements OpenCodeApi {
  aborted: string[] = [];
  /** Events yielded on the *next* stream, i.e. after a re-attach. */
  replay: OpenCodeEvent[] = [];
  /** What the session says when recovery asks what it did while we were away. */
  history: SessionMessage[] | null = null;
  streams = 0;

  constructor(
    readonly sessionId: string,
    private readonly ending: "idle" | "hang" = "hang",
  ) {}

  createSession(_input: CreateSessionInput): Promise<string> {
    return Promise.resolve(this.sessionId);
  }
  prompt(_input: PromptInput): Promise<void> {
    return Promise.resolve();
  }
  abort(sessionId: string): Promise<void> {
    this.aborted.push(sessionId);
    return Promise.resolve();
  }

  tool(callId: string, title: string): OpenCodeEvent {
    return {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          sessionID: this.sessionId,
          callID: callId,
          tool: "write",
          state: { status: "completed", title, input: { filePath: "notes.md" } },
        },
      },
    } as OpenCodeEvent;
  }

  message(id: string): OpenCodeEvent {
    return {
      type: "message.updated",
      properties: {
        info: {
          id,
          sessionID: this.sessionId,
          role: "assistant",
          agent: "build",
          providerID: "anthropic",
          modelID: "claude",
          cost: 0.25,
          tokens: { input: 100, output: 10 },
          time: { completed: 1 },
        },
      },
    } as OpenCodeEvent;
  }

  messages(_sessionId: string): Promise<SessionMessage[]> {
    return Promise.resolve(this.history ?? []);
  }

  idle(): OpenCodeEvent {
    return { type: "session.idle", properties: { sessionID: this.sessionId } } as OpenCodeEvent;
  }

  async *events(signal: AbortSignal): AsyncIterable<OpenCodeEvent> {
    this.streams += 1;
    if (this.streams === 1) {
      yield this.tool("call-1", "write notes.md");
      yield this.message("msg-1");
      if (this.ending === "idle") {
        yield this.idle();
        return;
      }
      while (!signal.aborted) await Bun.sleep(5);
      return;
    }
    // A reconnect. `replay` is drained as a queue rather than read once, so a
    // test can decide what the engine says next after the stream is already open.
    let next = 0;
    while (!signal.aborted) {
      if (next < this.replay.length) {
        yield this.replay[next++]!;
        continue;
      }
      await Bun.sleep(5);
    }
  }
}

/** An assistant message as OpenCode reports it in a session's history. */
function assistantInfo(id: string, completed: boolean): Record<string, unknown> {
  return {
    id,
    sessionID: "ses_0",
    role: "assistant",
    agent: "build",
    providerID: "anthropic",
    modelID: "claude",
    cost: 0.25,
    tokens: { input: 100, output: 10 },
    ...(completed ? { time: { completed: 1 } } : {}),
  };
}

function team(count: number) {
  const apis = Array.from({ length: count }, (_, i) => new AgentApi(`ses_${i}`));
  const tasks: GroupTask[] = apis.map((_, i) => ({ prompt: `task ${i}`, agent: `agent-${i}` }));
  return {
    apis,
    tasks,
    transportFor: (_t: GroupTask, i: number) => ({ api: apis[i]!, sessionId: apis[i]!.sessionId }),
  };
}

/**
 * What killing Bun mid-run leaves behind, without killing this test process:
 * a claimed run whose owner stopped beating. `local` is passed empty everywhere
 * below because in a real restart the pumps are simply gone.
 */
function abandon(db: Db, runId: string): Run {
  return updateRun(db, runId, {
    heartbeatAt: new Date(Date.now() - STALE_MS - 1_000).toISOString(),
    ownerPid: 4_194_305,
    ownerHost: "a-host-that-died",
    ownerNonce: "not-this-process",
  });
}

/** Marks a run as having reached the engine, which is what makes it re-attachable. */
function onServer(db: Db, runId: string, sessionId: string): Run {
  return updateRun(db, runId, {
    opencodeSessionId: sessionId,
    serverUrl: "http://127.0.0.1:65000",
  });
}

const NO_LOCAL = { local: new Set<string>() };

async function abandonedGroup(count = 2) {
  const db = freshDb();
  const { apis, tasks, transportFor } = team(count);
  const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
  // Let the first stream write its rows before the owner "dies".
  await Bun.sleep(60);

  abandon(db, handle.parentRunId);
  for (const child of handle.children) {
    abandon(db, child.runId);
    onServer(db, child.runId, `ses_${handle.children.indexOf(child)}`);
  }
  return { db, handle, apis };
}

describe("finding what a crash left behind", () => {
  test("every run of an abandoned group is an orphan", async () => {
    const { db, handle } = await abandonedGroup();
    const orphans = findOrphans(db, NO_LOCAL).map((r) => r.id);
    expect(orphans).toContain(handle.parentRunId);
    for (const child of handle.children) expect(orphans).toContain(child.runId);
    expect(orphanNotice(db, NO_LOCAL)).toContain("3 runs were left open");
  });

  test("a run whose owner is still beating is left alone", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(1);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
    // The real thing: this process is pumping, so nothing here is recoverable.
    expect(findOrphans(db)).toHaveLength(0);

    const result = await recoverRun(db, handle.children[0]!.runId);
    expect(result.action).toBe("skipped");
    expect(result.reason).toContain("live process");
  });

  test("a dry run reports without writing anything", async () => {
    const { db, handle } = await abandonedGroup();
    const before = listEvents(db, handle.children[0]!.runId).length;

    const results = await recoverAll(db, { ...NO_LOCAL, dryRun: true });
    expect(results.every((r) => r.action === "skipped")).toBe(true);
    expect(results.some((r) => r.reason.includes("orphaned"))).toBe(true);
    expect(listEvents(db, handle.children[0]!.runId)).toHaveLength(before);
    expect(getRun(db, handle.children[0]!.runId).status).toBe("running");
  });
});

describe("recovering a run whose engine is gone", () => {
  test("it is closed as killed, with a recover event saying why", async () => {
    const { db, handle } = await abandonedGroup(1);
    const child = handle.children[0]!;

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => null,
      stopServer: async () => {},
    });

    expect(result.action).toBe("closed");
    const run = getRun(db, child.runId);
    expect(run.status).toBe("killed");
    expect(run.exit_code).toBe(130);

    const events = listEvents(db, child.runId);
    expect(events.filter((e) => e.type === "recover")).toHaveLength(1);
    expect(events.filter((e) => e.type === "end")).toHaveLength(1);
    expect(events.find((e) => e.type === "recover")?.message).toContain("server is gone");
  });

  test("the leaked server is only stopped once nothing else needs it", async () => {
    const { db, handle } = await abandonedGroup(2);
    const stopped: string[] = [];
    const opts = {
      ...NO_LOCAL,
      probe: async () => null,
      stopServer: async (url: string) => {
        stopped.push(url);
      },
    };

    await recoverRun(db, handle.children[0]!.runId, opts);
    // Its sibling is still open on the same server, so the server stays up.
    expect(stopped).toEqual([]);

    await recoverRun(db, handle.children[1]!.runId, opts);
    expect(stopped).toEqual(["http://127.0.0.1:65000"]);
  });

  test("recovering the same run twice changes nothing the second time", async () => {
    const { db, handle } = await abandonedGroup(1);
    const opts = { ...NO_LOCAL, probe: async () => null, stopServer: async () => {} };
    const child = handle.children[0]!;

    await recoverRun(db, child.runId, opts);
    const ended = getRun(db, child.runId).ended_at;
    const again = await recoverRun(db, child.runId, opts);

    expect(again.action).toBe("skipped");
    expect(again.reason).toContain("already killed");
    expect(getRun(db, child.runId).ended_at).toBe(ended);
    expect(listEvents(db, child.runId).filter((e) => e.type === "end")).toHaveLength(1);
  });
});

describe("recovering a run whose session is still alive", () => {
  test("it re-attaches and the run finishes for real", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const child = handle.children[0]!;
    const api = apis[0]!;
    // The session survived the crash and is about to go idle.
    api.replay = [api.tool("call-2", "write more.md"), api.idle()];

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      cancelPollMs: 20,
    });

    expect(result.action).toBe("reattached");
    const run = await result.finished!;
    expect(run.status).toBe("succeeded");
    expect(run.exit_code).toBe(0);

    const events = listEvents(db, child.runId);
    expect(events.filter((e) => e.type === "recover")).toHaveLength(1);
    // The work done after the crash is recorded too.
    expect(events.some((e) => e.message?.includes("write more.md"))).toBe(true);
    // A recovered run has a new owner, and it beat.
    expect(getRun(db, child.runId).owner_nonce).not.toBe("not-this-process");
  });

  test("the orphaned server is reaped once the resumed run ends", async () => {
    const { db, handle, apis } = await abandonedGroup(2);
    const stopped: string[] = [];
    const opts = {
      ...NO_LOCAL,
      stopServer: async (url: string) => {
        stopped.push(url);
      },
      cancelPollMs: 20,
    };

    // Both agents resume; the first to finish must leave the server alone,
    // because its sibling is still using it.
    const first = await recoverRun(db, handle.children[0]!.runId, {
      ...opts,
      probe: async () => ({ api: apis[0]!, sessionId: apis[0]!.sessionId }),
    });
    const second = await recoverRun(db, handle.children[1]!.runId, {
      ...opts,
      probe: async () => ({ api: apis[1]!, sessionId: apis[1]!.sessionId }),
    });

    apis[0]!.replay.push(apis[0]!.idle());
    await first.finished!;
    expect(stopped).toEqual([]);

    apis[1]!.replay.push(apis[1]!.idle());
    await second.finished!;
    expect(stopped).toEqual(["http://127.0.0.1:65000"]);
  });

  test("a replayed stream is not counted twice", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const child = handle.children[0]!;
    const api = apis[0]!;
    const before = usageTotals(db, child.runId);
    const artifactsBefore = listArtifacts(db, child.runId);
    expect(before.costUsd).toBeGreaterThan(0);
    expect(artifactsBefore).toHaveLength(1);

    // OpenCode replays the history this run already recorded, then goes idle.
    api.replay = [api.tool("call-1", "write notes.md"), api.message("msg-1"), api.idle()];

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      cancelPollMs: 20,
    });
    await result.finished!;

    expect(usageTotals(db, child.runId)).toEqual(before);
    expect(listArtifacts(db, child.runId)).toHaveLength(artifactsBefore.length);
    expect(
      listEvents(db, child.runId).filter((e) => e.message?.includes("write notes.md")),
    ).toHaveLength(1);
  });

  test("a cancel asked for before the crash is honoured, not resumed", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const child = handle.children[0]!;
    const api = apis[0]!;
    requestCancel(db, child.runId);

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      stopServer: async () => {},
    });

    expect(result.action).toBe("closed");
    expect(getRun(db, child.runId).status).toBe("killed");
    // Reachable and unwanted: the agent was stopped rather than left spending.
    expect(api.aborted).toContain(api.sessionId);
  });
});

describe("recovering a group", () => {
  test("agents are closed first, then the group rolls up from them", async () => {
    const { db, handle } = await abandonedGroup(2);
    const results = await recoverAll(db, {
      ...NO_LOCAL,
      probe: async () => null,
      stopServer: async () => {},
    });

    expect(results.filter((r) => r.action === "closed")).toHaveLength(3);
    for (const child of listChildRuns(db, handle.parentRunId)) {
      expect(child.status).toBe("killed");
    }
    const parent = getRun(db, handle.parentRunId);
    expect(parent.status).toBe("killed");
    expect(parent.exit_code).toBe(130);
    expect(listEvents(db, parent.id).some((e) => e.type === "recover")).toBe(true);
  });

  test("a group waits for the agents it resumed, then rolls up on its own", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const api = apis[0]!;
    api.replay = [api.idle()];

    const results = await recoverAll(db, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      cancelPollMs: 20,
    });

    const group = results.find((r) => r.runId === handle.parentRunId)!;
    expect(group.reason).toContain("waiting for the 1 agents it just resumed");
    // The agent had not finished when the group was considered, so the group is
    // still open — but its close is now owned by this recovery, not abandoned.
    expect(getRun(db, handle.parentRunId).status).toBe("running");

    const closed = await group.finished!;
    expect(closed.status).toBe("succeeded");
    expect(closed.exit_code).toBe(0);
    expect(listEvents(db, handle.parentRunId).some((e) => e.type === "recover")).toBe(true);
  });

  test("a group whose agents are owned elsewhere is left alone", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const api = apis[0]!;
    api.replay = [];

    // Only the group is orphaned; its agent is being pumped by somebody else.
    const results = await recoverAll(db, {
      local: new Set([handle.children[0]!.runId]),
      probe: async () => ({ api, sessionId: api.sessionId }),
      cancelPollMs: 20,
    });

    const group = results.find((r) => r.runId === handle.parentRunId)!;
    expect(group.action).toBe("skipped");
    expect(group.reason).toContain("running again");
    expect(group.finished).toBeUndefined();
    expect(getRun(db, handle.parentRunId).status).toBe("running");
  });
});

describe("a session that finished while nobody was listening", () => {
  test("its result is recovered from the history, not waited for", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const child = handle.children[0]!;
    const api = apis[0]!;
    // The agent worked on after the crash and completed. No idle event will
    // ever arrive on a new stream: it happened while the run had no owner.
    api.history = [
      { info: assistantInfo("msg-1", true), parts: [] },
      {
        info: assistantInfo("msg-2", true),
        parts: [
          {
            type: "tool",
            sessionID: api.sessionId,
            callID: "call-2",
            tool: "write",
            state: {
              status: "completed",
              title: "write later.md",
              input: { filePath: "later.md" },
            },
          },
        ],
      },
    ];

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      stopServer: async () => {},
    });

    expect(result.action).toBe("reattached");
    expect(result.reason).toContain("already finished");
    const run = await result.finished!;
    expect(run.status).toBe("succeeded");
    expect(run.exit_code).toBe(0);

    // The work done during the outage is now on the record...
    const events = listEvents(db, child.runId);
    expect(events.some((e) => e.message?.includes("write later.md"))).toBe(true);
    expect(listArtifacts(db, child.runId).some((a) => a.path === "later.md")).toBe(true);
    // ...and the message the run had already counted was not counted twice.
    expect(usageTotals(db, child.runId).costUsd).toBeCloseTo(0.5, 5);
    // No stream was ever opened: the history answered the question.
    expect(api.streams).toBe(1);
  });

  test("a turn still in flight is followed live instead", async () => {
    const { db, handle, apis } = await abandonedGroup(1);
    const child = handle.children[0]!;
    const api = apis[0]!;
    // The last word is the user's: the agent is still thinking.
    api.history = [{ info: { id: "msg-9", sessionID: api.sessionId, role: "user" }, parts: [] }];
    api.replay = [api.idle()];

    const result = await recoverRun(db, child.runId, {
      ...NO_LOCAL,
      probe: async () => ({ api, sessionId: api.sessionId }),
      cancelPollMs: 20,
    });

    expect(result.reason).toContain("still alive");
    expect((await result.finished!).status).toBe("succeeded");
    expect(api.streams).toBe(2);
  });
});
