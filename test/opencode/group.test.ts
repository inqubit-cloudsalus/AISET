import { describe, expect, test } from "bun:test";
import { getRun, listChildRuns, requestCancel } from "../../src/db/repositories/runs.ts";
import { cancel } from "../../src/opencode/adapter.ts";
import type { CreateSessionInput, OpenCodeApi, PromptInput } from "../../src/opencode/client.ts";
import {
  cancelGroup,
  type GroupTask,
  groupOf,
  rollup,
  startGroup,
} from "../../src/opencode/group.ts";
import type { OpenCodeEvent } from "../../src/opencode/types.ts";
import { freshDb } from "../db/helpers.ts";

/**
 * One agent's session on the shared server. Each child gets its own instance,
 * as each gets its own session; no test here spawns a process or opens a socket.
 */
class AgentApi implements OpenCodeApi {
  aborted: string[] = [];
  prompts: PromptInput[] = [];

  constructor(
    readonly sessionId: string,
    /** "idle" succeeds, "error" fails, "hang" waits to be cancelled. */
    private readonly ending: "idle" | "error" | "hang",
  ) {}

  createSession(_input: CreateSessionInput): Promise<string> {
    return Promise.resolve(this.sessionId);
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
    yield {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          sessionID: this.sessionId,
          callID: `${this.sessionId}-call`,
          tool: "bash",
          state: { status: "completed", title: "ls", input: {} },
        },
      },
    } as OpenCodeEvent;

    if (this.ending === "idle") {
      yield { type: "session.idle", properties: { sessionID: this.sessionId } } as OpenCodeEvent;
      return;
    }
    if (this.ending === "error") {
      yield {
        type: "session.error",
        properties: { sessionID: this.sessionId, error: { name: "ProviderError" } },
      } as OpenCodeEvent;
      return;
    }
    while (!signal.aborted) await Bun.sleep(5);
  }
}

function team(endings: ("idle" | "error" | "hang")[]) {
  const apis = endings.map((ending, i) => new AgentApi(`ses_${i}`, ending));
  const tasks: GroupTask[] = endings.map((_, i) => ({
    prompt: `task ${i}`,
    agent: `agent-${i}`,
  }));
  return {
    apis,
    tasks,
    transportFor: (_t: GroupTask, i: number) => ({ api: apis[i]!, sessionId: apis[i]!.sessionId }),
  };
}

describe("startGroup", () => {
  test("launches every agent under one parent run", async () => {
    const db = freshDb();
    const { tasks, transportFor, apis } = team(["idle", "idle", "idle"]);

    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
    const parent = await handle.finished;

    expect(parent.status).toBe("succeeded");
    expect(parent.exit_code).toBe(0);
    expect(parent.opencode_session_id).toBeNull();
    expect(handle.children).toHaveLength(3);

    const children = listChildRuns(db, handle.parentRunId);
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.parent_run_id).toBe(handle.parentRunId);
      expect(child.status).toBe("succeeded");
    }
    // Each agent got its own prompt, not the group's.
    expect(apis.map((a) => a.prompts[0]?.text)).toEqual(["task 0", "task 1", "task 2"]);
    // The agent name is on the row, so a group reads as a team.
    expect(children.map((c) => (c.meta as { agent?: string } | null)?.agent)).toEqual([
      "agent-0",
      "agent-1",
      "agent-2",
    ]);
  });

  test("one agent failing does not stop its siblings", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(["idle", "error", "idle"]);

    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
    const parent = await handle.finished;

    expect(parent.status).toBe("failed");
    expect(listChildRuns(db, handle.parentRunId).map((c) => c.status)).toEqual([
      "succeeded",
      "failed",
      "succeeded",
    ]);
  });

  test("groupOf reads the team back off the database", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(["idle", "idle"]);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
    await handle.finished;

    const group = groupOf(db, handle.parentRunId);
    expect(group.parent.id).toBe(handle.parentRunId);
    expect(group.children).toHaveLength(2);
  });
});

describe("cancelling a group", () => {
  test("cancelGroup stops every agent and closes the group", async () => {
    const db = freshDb();
    const { tasks, transportFor, apis } = team(["hang", "hang"]);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });

    const result = await cancelGroup(db, handle.parentRunId);
    const parent = await handle.finished;

    expect(result.owner).toBe("local");
    expect(result.confirmed).toBe(true);
    expect(parent.status).toBe("killed");
    expect(parent.exit_code).toBe(130);
    for (const child of listChildRuns(db, handle.parentRunId)) {
      expect(child.status).toBe("killed");
      expect(child.exit_code).toBe(130);
    }
    // Cancelled at the engine, not just in the database.
    expect(apis.map((a) => a.aborted)).toEqual([["ses_0"], ["ses_1"]]);
  });

  test("plain cancel on a group id routes to the children", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(["hang", "hang"]);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });

    await cancel(db, handle.parentRunId);
    await handle.finished;

    expect(getRun(db, handle.parentRunId).status).toBe("killed");
    expect(listChildRuns(db, handle.parentRunId).every((c) => c.status === "killed")).toBe(true);
  });

  test("a cancel stamped by another process reaches the agents", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(["hang", "hang"]);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });

    // What `aiset runs cancel r_<group>` does from a second terminal: it stamps
    // the row and leaves. Only this process holds the sessions.
    requestCancel(db, handle.parentRunId);
    const parent = await handle.finished;

    expect(parent.status).toBe("killed");
    expect(listChildRuns(db, handle.parentRunId).every((c) => c.status === "killed")).toBe(true);
  });

  test("cancelling a finished group changes nothing", async () => {
    const db = freshDb();
    const { tasks, transportFor } = team(["idle"]);
    const handle = await startGroup(db, tasks, { transportFor, cancelPollMs: 20 });
    const parent = await handle.finished;

    const result = await cancel(db, handle.parentRunId);
    expect(result.alreadyFinished).toBe(true);
    expect(result.run.ended_at).toBe(parent.ended_at);
  });
});

describe("rollup", () => {
  test("a group is green only when every agent is", () => {
    expect(rollup(["succeeded", "succeeded"])).toBe("succeeded");
    expect(rollup(["succeeded", "failed"])).toBe("failed");
    expect(rollup(["killed", "failed"])).toBe("failed");
    expect(rollup(["succeeded", "killed"])).toBe("killed");
    expect(rollup(["killed", "timeout"])).toBe("timeout");
    expect(rollup([])).toBe("failed");
  });
});

describe("startGroup guards", () => {
  test("a group needs at least one task", async () => {
    const db = freshDb();
    await expect(startGroup(db, [])).rejects.toThrow("at least one task");
  });
});
