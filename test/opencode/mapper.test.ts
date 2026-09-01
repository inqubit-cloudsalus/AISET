import { describe, expect, test } from "bun:test";
import { parseFrame } from "../../src/opencode/client.ts";
import { EventMapper } from "../../src/opencode/mapper.ts";
import type { Mapped, MappedEvent } from "../../src/opencode/types.ts";
import { CHILD_SESSION, fixtureEvents, ROOT_SESSION } from "./fixture.ts";

function replay(mapper = new EventMapper(ROOT_SESSION)) {
  const events: MappedEvent[] = [];
  const artifacts: Mapped["artifacts"] = [];
  const usage: Mapped["usage"] = [];
  let terminal: Mapped["terminal"] = null;
  for (const ev of fixtureEvents()) {
    const m = mapper.map(ev);
    events.push(...m.events);
    artifacts.push(...m.artifacts);
    usage.push(...m.usage);
    if (m.terminal) {
      terminal = m.terminal;
      break;
    }
  }
  return { events, artifacts, usage, terminal };
}

describe("EventMapper over a recorded OpenCode transcript", () => {
  test("the run reaches a terminal verdict", () => {
    expect(replay().terminal).toBe("succeeded");
  });

  test("every mapped event uses an existing run_events type", () => {
    const allowed = new Set(["start", "stdout", "stderr", "tool", "artifact", "timeout", "end"]);
    for (const e of replay().events) expect(allowed.has(e.type)).toBe(true);
  });

  test("the delegating agent and the subagent are both attributed", () => {
    const agents = new Set(replay().events.map((e) => e.agent));
    expect(agents.has("build")).toBe(true);
    expect(agents.has("explore")).toBe(true);
  });

  test("the subagent session is recorded as a tool event under its parent agent", () => {
    const spawn = replay().events.find((e) => e.message.startsWith("subagent session started"));
    expect(spawn).toBeDefined();
    expect(spawn?.type).toBe("tool");
    expect(spawn?.data.sessionId).toBe(CHILD_SESSION);
  });

  test("the subagent's own tool calls are attributed to the subagent, not the parent", () => {
    const explore = replay().events.filter((e) => e.agent === "explore" && e.type === "tool");
    expect(explore.length).toBeGreaterThan(0);
  });

  test("written files become artifacts, once each", () => {
    const { artifacts } = replay();
    const paths = artifacts.map((a) => a.path);
    expect(paths.length).toBe(new Set(paths).size);
    expect(paths.some((p) => p.endsWith("sum.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("sum.test.ts"))).toBe(true);
    for (const a of artifacts) expect(a.kind).toBe("patch");
  });

  test("token usage is recorded per completed assistant message", () => {
    const { usage } = replay();
    expect(usage.length).toBeGreaterThan(0);
    for (const u of usage) {
      expect(u.provider).toBe("openrouter");
      expect(u.inputTokens).toBeGreaterThanOrEqual(0);
      expect(u.outputTokens).toBeGreaterThanOrEqual(0);
    }
    expect(usage.reduce((n, u) => n + u.outputTokens, 0)).toBeGreaterThan(0);
    expect(usage.reduce((n, u) => n + u.costUsd, 0)).toBeGreaterThan(0);
  });

  test("assistant prose is emitted once per part, not once per delta", () => {
    const { events } = replay();
    const stdout = events.filter((e) => e.type === "stdout");
    expect(stdout.length).toBeGreaterThan(0);
    // The transcript holds ~1300 deltas for a handful of messages; anything in
    // that order would mean deltas were being stored.
    expect(stdout.length).toBeLessThan(20);
    for (const e of stdout) expect(e.message.length).toBeGreaterThan(0);
  });

  test("replaying the same transcript through the same mapper adds nothing", () => {
    const mapper = new EventMapper(ROOT_SESSION);
    const first = replay(mapper);
    const second = replay(mapper);
    expect(second.events).toEqual([]);
    expect(second.artifacts).toEqual([]);
    expect(second.usage).toEqual([]);
    expect(first.events.length).toBeGreaterThan(0);
  });

  test("two mappers over the same transcript produce identical rows", () => {
    expect(replay()).toEqual(replay());
  });
});

describe("EventMapper isolation and failure handling", () => {
  const ev = (type: string, properties: Record<string, unknown>) => ({ type, properties });

  test("events from a session this run does not own are ignored", () => {
    const m = new EventMapper(ROOT_SESSION);
    const out = m.map(
      ev("message.updated", {
        info: {
          id: "msg_x",
          role: "assistant",
          sessionID: "ses_stranger",
          agent: "build",
          time: { completed: 1 },
        },
      }),
    );
    expect(out.usage).toEqual([]);
  });

  test("an unknown event type is dropped rather than stored", () => {
    const m = new EventMapper(ROOT_SESSION);
    expect(m.map(ev("something.new", { sessionID: ROOT_SESSION }))).toEqual({
      events: [],
      artifacts: [],
      usage: [],
      terminal: null,
    });
  });

  test("a root session error ends the run; a subagent error does not", () => {
    const m = new EventMapper(ROOT_SESSION);
    m.map(ev("session.created", { info: { id: CHILD_SESSION, parentID: ROOT_SESSION } }));
    const child = m.map(
      ev("session.error", { sessionID: CHILD_SESSION, error: { name: "UnknownError" } }),
    );
    expect(child.terminal).toBeNull();
    expect(child.events[0]?.type).toBe("stderr");
    expect(child.events[0]?.level).toBe("error");

    const root = m.map(
      ev("session.error", { sessionID: ROOT_SESSION, error: { name: "APIError" } }),
    );
    expect(root.terminal).toBe("failed");
  });

  test("a subagent going idle does not end the run", () => {
    const m = new EventMapper(ROOT_SESSION);
    m.map(ev("session.created", { info: { id: CHILD_SESSION, parentID: ROOT_SESSION } }));
    expect(m.map(ev("session.idle", { sessionID: CHILD_SESSION })).terminal).toBeNull();
    expect(m.map(ev("session.idle", { sessionID: ROOT_SESSION })).terminal).toBe("succeeded");
  });

  test("a failed tool is recorded at error level and yields no artifact", () => {
    const m = new EventMapper(ROOT_SESSION);
    const out = m.map(
      ev("message.part.updated", {
        part: {
          type: "tool",
          tool: "write",
          callID: "call-1",
          sessionID: ROOT_SESSION,
          state: { status: "error", input: { filePath: "a.ts" }, error: "disk full" },
        },
      }),
    );
    expect(out.events[0]?.level).toBe("error");
    expect(out.artifacts).toEqual([]);
  });

  test("a pending tool is not stored until it settles", () => {
    const m = new EventMapper(ROOT_SESSION);
    const pending = {
      type: "tool",
      tool: "bash",
      callID: "call-2",
      sessionID: ROOT_SESSION,
      state: { status: "pending", input: {} },
    };
    expect(m.map(ev("message.part.updated", { part: pending })).events).toEqual([]);
    const done = { ...pending, state: { status: "completed", input: {}, title: "ls" } };
    expect(m.map(ev("message.part.updated", { part: done })).events.length).toBe(1);
    // Re-delivery of the settled state is not a second event.
    expect(m.map(ev("message.part.updated", { part: done })).events).toEqual([]);
  });
});

describe("parseFrame", () => {
  test("drops a malformed frame instead of throwing", () => {
    expect(parseFrame("{not json")).toBeNull();
    expect(parseFrame("")).toBeNull();
    expect(parseFrame('{"noType":1}')).toBeNull();
  });

  test("defaults missing properties to an empty object", () => {
    expect(parseFrame('{"type":"session.idle"}')).toEqual({
      type: "session.idle",
      properties: {},
    });
  });
});
