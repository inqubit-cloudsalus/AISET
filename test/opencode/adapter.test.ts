import { describe, expect, test } from "bun:test";
import { createRun, listRuns, requestCancel } from "../../src/db/repositories/runs.ts";
import { cancel, capture, kill, observe, start } from "../../src/opencode/adapter.ts";
import type { CreateSessionInput, OpenCodeApi, PromptInput } from "../../src/opencode/client.ts";
import { splitModel } from "../../src/opencode/client.ts";
import type { OpenCodeEvent } from "../../src/opencode/types.ts";
import { freshDb } from "../db/helpers.ts";
import { fixtureEvents, ROOT_SESSION } from "./fixture.ts";

/**
 * Replays a recorded transcript in place of a live `opencode serve`. No test in
 * this suite spawns a process or opens a socket.
 */
class FakeApi implements OpenCodeApi {
  prompts: PromptInput[] = [];
  aborted: string[] = [];
  stopped = 0;

  constructor(
    private readonly script: OpenCodeEvent[],
    /** Held open after the script runs out, so kill and timeout have something to interrupt. */
    private readonly hang = false,
  ) {}

  createSession(_input: CreateSessionInput): Promise<string> {
    return Promise.resolve(ROOT_SESSION);
  }

  prompt(input: PromptInput): Promise<void> {
    this.prompts.push(input);
    return Promise.resolve();
  }

  abort(sessionId: string): Promise<void> {
    this.aborted.push(sessionId);
    return Promise.resolve();
  }

  async *events(signal: AbortSignal): AsyncIterable<OpenCodeEvent> {
    for (const ev of this.script) {
      if (signal.aborted) return;
      yield ev;
    }
    while (this.hang && !signal.aborted) await Bun.sleep(5);
  }
}

function transportFor(api: FakeApi) {
  return {
    api,
    sessionId: ROOT_SESSION,
    stop: () => {
      api.stopped += 1;
      return Promise.resolve();
    },
  };
}

async function runFixture(
  opts: { hang?: boolean; timeoutMs?: number; cancelPollMs?: number } = {},
) {
  const db = freshDb();
  const api = new FakeApi(fixtureEvents(), opts.hang ?? false);
  const handle = await start(
    db,
    { prompt: "write sum.ts and a test for it", agent: "build", model: "openrouter/haiku" },
    { transport: transportFor(api), timeoutMs: opts.timeoutMs, cancelPollMs: opts.cancelPollMs },
  );
  return { db, api, handle };
}

describe("adapter.start over a recorded transcript", () => {
  test("records a complete, closed run", async () => {
    const { db, handle } = await runFixture();
    const run = await handle.finished;

    expect(run.status).toBe("succeeded");
    expect(run.engine).toBe("opencode");
    expect(run.exit_code).toBe(0);
    expect(run.ended_at).not.toBeNull();
    expect(run.opencode_session_id).toBe(ROOT_SESSION);
    db.close();
  });

  test("the prompt reaches OpenCode with the requested agent and model", async () => {
    const { db, api, handle } = await runFixture();
    await handle.finished;

    expect(api.prompts.length).toBe(1);
    expect(api.prompts[0]?.agent).toBe("build");
    expect(api.prompts[0]?.text).toBe("write sum.ts and a test for it");
    db.close();
  });

  test("the event stream opens with one start and closes with one end", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;

    const all = await collect(db, handle.runId);
    expect(all.filter((e) => e.type === "start").length).toBe(1);
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    expect(all[0]?.type).toBe("start");
    expect(all.at(-1)?.type).toBe("end");
    db.close();
  });

  test("seq is contiguous from 1", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;
    const all = await collect(db, handle.runId);
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    db.close();
  });

  test("both agents are attributed in the stored rows", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;
    const agents = new Set((await collect(db, handle.runId)).map((e) => e.agent));
    expect(agents.has("build")).toBe(true);
    expect(agents.has("explore")).toBe(true);
    // AISET's own start/end events are not attributed to any agent.
    expect(agents.has(null)).toBe(true);
    db.close();
  });

  test("capture returns the artifacts and token totals the run produced", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;

    const result = capture(db, handle.runId);
    expect(result.artifacts.length).toBe(2);
    expect(result.artifacts.map((a) => a.kind)).toEqual(["patch", "patch"]);
    expect(result.usage.length).toBeGreaterThan(0);
    expect(result.totals.outputTokens).toBeGreaterThan(0);
    expect(result.totals.costUsd).toBeGreaterThan(0);
    db.close();
  });

  test("each artifact also appears in the event timeline", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;
    const all = await collect(db, handle.runId);
    expect(all.filter((e) => e.type === "artifact").length).toBe(
      capture(db, handle.runId).artifacts.length,
    );
    db.close();
  });

  test("the OpenCode server is stopped when the run closes", async () => {
    const { db, api, handle } = await runFixture();
    await handle.finished;
    expect(api.stopped).toBe(1);
    db.close();
  });
});

describe("adapter lifecycle: kill and timeout", () => {
  test("kill closes the run and aborts the OpenCode session", async () => {
    const { db, api, handle } = await runFixture({ hang: true });
    const run = await kill(db, handle.runId);
    await handle.finished;

    expect(run.status).toBe("killed");
    expect(run.ended_at).not.toBeNull();
    expect(api.aborted).toEqual([ROOT_SESSION]);

    const all = await collect(db, handle.runId);
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    expect(all.at(-1)?.message).toBe("killed");
    db.close();
  });

  test("killing an already-closed run is a no-op, not a second end", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;
    const again = await kill(db, handle.runId);

    expect(again.status).toBe("succeeded");
    expect((await collect(db, handle.runId)).filter((e) => e.type === "end").length).toBe(1);
    db.close();
  });

  test("cancel reports it owned the session and closes with exit code 130", async () => {
    const { db, api, handle } = await runFixture({ hang: true });
    const result = await cancel(db, handle.runId);
    await handle.finished;

    expect(result.owner).toBe("local");
    expect(result.confirmed).toBe(true);
    expect(result.alreadyFinished).toBe(false);
    expect(result.run.status).toBe("killed");
    expect(result.run.exit_code).toBe(130);
    expect(result.run.cancel_requested_at).not.toBeNull();
    expect(api.aborted).toEqual([ROOT_SESSION]);
    db.close();
  });

  test("cancel on a closed run reports it had already finished", async () => {
    const { db, api, handle } = await runFixture();
    await handle.finished;
    const result = await cancel(db, handle.runId);

    expect(result.alreadyFinished).toBe(true);
    expect(result.owner).toBe("none");
    expect(result.run.status).toBe("succeeded");
    // Nothing was asked of the engine, and no stop was stamped after the fact.
    expect(api.aborted).toEqual([]);
    expect(result.run.cancel_requested_at).toBeNull();
    db.close();
  });

  /**
   * The cross-process path: another process only stamps the request, and the
   * pump that owns the session is the one that reaches OpenCode.
   */
  test("a cancel requested elsewhere is picked up by the owning pump", async () => {
    const db = freshDb();
    // An empty script that hangs: the run stays open until something stops it.
    const api = new FakeApi([], true);
    const handle = await start(
      db,
      { prompt: "hang until cancelled" },
      { transport: transportFor(api), cancelPollMs: 10 },
    );
    requestCancel(db, handle.runId);
    const run = await handle.finished;

    expect(run.status).toBe("killed");
    expect(api.aborted).toEqual([ROOT_SESSION]);
    const all = await collect(db, handle.runId);
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    db.close();
  });

  test("cancelling a run whose owner is gone closes it once the grace expires", async () => {
    const db = freshDb();
    // A row left behind by a process that died mid-run: running, with a session
    // this process has no handle for.
    const orphan = createRun(db, {
      taskTitle: "orphaned run",
      engine: "opencode",
      status: "running",
      opencodeSessionId: ROOT_SESSION,
    });
    const result = await cancel(db, orphan.id, { graceMs: 30, pollMs: 10 });

    expect(result.owner).toBe("remote");
    expect(result.confirmed).toBe(false);
    expect(result.run.status).toBe("killed");
    expect(result.run.exit_code).toBe(130);
    db.close();
  });

  test("cancelling a run that never reached the engine closes it immediately", async () => {
    const db = freshDb();
    const pending = createRun(db, { taskTitle: "never started", engine: "opencode" });
    const result = await cancel(db, pending.id);

    expect(result.owner).toBe("none");
    expect(result.confirmed).toBe(true);
    expect(result.run.status).toBe("killed");
    db.close();
  });

  test("a run that produces nothing in time is recorded as a timeout", async () => {
    const db = freshDb();
    const api = new FakeApi([], true);
    const handle = await start(
      db,
      { prompt: "hang forever" },
      { transport: transportFor(api), timeoutMs: 50 },
    );
    const run = await handle.finished;

    expect(run.status).toBe("timeout");
    expect(run.ended_at).not.toBeNull();
    const all = await collect(db, handle.runId);
    expect(all.filter((e) => e.type === "timeout").length).toBe(1);
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    db.close();
  });

  test("a run whose engine never starts is closed as failed, not left pending", async () => {
    const db = freshDb();
    // No transport, so the real spawn path runs — against a binary that is not
    // there. This is the one test that touches `startServer`.
    await expect(
      start(db, { prompt: "x" }, { bin: "aiset-no-such-opencode-binary" }),
    ).rejects.toThrow(/could not start/);

    // `start` rejects, but the run row it created must still be closed.
    const run = listRuns(db, { limit: 1 })[0];
    expect(run?.status).toBe("failed");
    expect(run?.ended_at).not.toBeNull();
    expect(run?.opencode_session_id).toBeNull();

    const all = await collect(db, run!.id);
    expect(all.filter((e) => e.type === "end").length).toBe(1);
    expect(all.some((e) => e.type === "stderr")).toBe(true);
    db.close();
  });
});

describe("adapter.observe", () => {
  test("replays a finished run from the database and then stops", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;

    const seen = await collect(db, handle.runId);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.type).toBe("end");
  });

  test("honours the seq watermark", async () => {
    const { db, handle } = await runFixture();
    await handle.finished;

    const all = await collect(db, handle.runId);
    const rest = await collect(db, handle.runId, 3);
    expect(rest.length).toBe(all.length - 3);
    expect(rest[0]?.seq).toBe(4);
    db.close();
  });
});

describe("splitModel", () => {
  test("splits on the first slash so model ids may contain slashes", () => {
    expect(splitModel("openrouter/~anthropic/claude-haiku-latest")).toEqual({
      providerID: "openrouter",
      modelID: "~anthropic/claude-haiku-latest",
    });
  });

  test("is absent for an unset model", () => {
    expect(splitModel(null)).toBeNull();
    expect(splitModel(undefined)).toBeNull();
  });

  test("rejects a bare model name with an actionable error", () => {
    expect(() => splitModel("big-pickle")).toThrow(/provider\/model/);
  });
});

async function collect(db: ReturnType<typeof freshDb>, runId: string, afterSeq = 0) {
  const out = [];
  for await (const e of observe(db, runId, { afterSeq, pollMs: 1 })) out.push(e);
  return out;
}
