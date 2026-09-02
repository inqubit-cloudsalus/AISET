import { describe, expect, test } from "bun:test";
import { SchemaDriftError } from "../../src/core/errors.ts";
import {
  addArtifact,
  listArtifacts,
  listArtifactsWithChildren,
} from "../../src/db/repositories/artifacts.ts";
import { appendEvent, countEvents, listEvents } from "../../src/db/repositories/events.ts";
import {
  countByStatus,
  createRun,
  findRun,
  getRun,
  listActiveRuns,
  listRuns,
  requestCancel,
  runDurationMs,
  updateRun,
} from "../../src/db/repositories/runs.ts";
import {
  listUsage,
  recordUsage,
  usageTotals,
  usageTotalsWithChildren,
} from "../../src/db/repositories/usage.ts";
import { freshDb } from "./helpers.ts";

describe("runs repository", () => {
  test("creates, reads and updates a run", () => {
    const db = freshDb();
    const run = createRun(db, {
      taskId: "T-001",
      taskTitle: "sum of two numbers",
      engine: "mock",
      meta: { source: "test" },
    });
    expect(run.status).toBe("pending");
    expect(run.meta).toEqual({ source: "test" });
    expect(getRun(db, run.id).id).toBe(run.id);

    const done = updateRun(db, run.id, {
      status: "succeeded",
      verdict: "GREEN",
      endedAt: new Date(Date.parse(run.started_at) + 1500).toISOString(),
      exitCode: 0,
    });
    expect(done.status).toBe("succeeded");
    expect(done.verdict).toBe("GREEN");
    expect(runDurationMs(done)).toBe(1500);
    db.close();
  });

  test("duration is null while the run is open", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "open", engine: "mock" });
    expect(runDurationMs(run)).toBeNull();
    db.close();
  });

  test("findRun returns null and getRun throws for a missing id", () => {
    const db = freshDb();
    expect(findRun(db, "nope")).toBeNull();
    expect(() => getRun(db, "nope")).toThrow(/not found/);
    db.close();
  });

  test("lists by status and honours limit", () => {
    const db = freshDb();
    for (let i = 0; i < 3; i++) {
      const r = createRun(db, { taskTitle: `t${i}`, engine: "mock" });
      if (i < 2) updateRun(db, r.id, { status: "failed" });
    }
    expect(listRuns(db).length).toBe(3);
    expect(listRuns(db, { limit: 1 }).length).toBe(1);
    expect(listRuns(db, { status: "failed" }).length).toBe(2);
    expect(countByStatus(db)).toEqual({ failed: 2, pending: 1 });
    db.close();
  });

  test("listActiveRuns returns only runs that have not closed", () => {
    const db = freshDb();
    const pending = createRun(db, { taskTitle: "waiting", engine: "mock" });
    const running = createRun(db, { taskTitle: "in flight", engine: "mock" });
    updateRun(db, running.id, { status: "running" });
    const done = createRun(db, { taskTitle: "finished", engine: "mock" });
    updateRun(db, done.id, { status: "succeeded" });

    const active = listActiveRuns(db)
      .map((r) => r.id)
      .sort();
    expect(active).toEqual([pending.id, running.id].sort());
    db.close();
  });

  test("requestCancel stamps the request once and 404s on a missing run", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "to be stopped", engine: "mock" });
    expect(run.cancel_requested_at).toBeNull();

    const asked = requestCancel(db, run.id);
    expect(asked.cancel_requested_at).not.toBeNull();
    // A second request keeps the first stamp: when the stop was asked for is a
    // fact about the run, not about how many times someone typed the command.
    expect(requestCancel(db, run.id).cancel_requested_at).toBe(asked.cancel_requested_at);

    expect(() => requestCancel(db, "nope")).toThrow(/not found/);
    db.close();
  });
});

describe("events repository", () => {
  test("allocates seq per run starting at 1", () => {
    const db = freshDb();
    const a = createRun(db, { taskTitle: "a", engine: "mock" });
    const b = createRun(db, { taskTitle: "b", engine: "mock" });
    expect(appendEvent(db, { runId: a.id, type: "start" }).seq).toBe(1);
    expect(appendEvent(db, { runId: a.id, type: "stdout", message: "hi" }).seq).toBe(2);
    expect(appendEvent(db, { runId: b.id, type: "start" }).seq).toBe(1);
    expect(countEvents(db, a.id)).toBe(2);
    db.close();
  });

  test("afterSeq acts as a tail watermark", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    for (let i = 0; i < 5; i++) appendEvent(db, { runId: run.id, type: "stdout" });
    const rest = listEvents(db, run.id, { afterSeq: 3 });
    expect(rest.map((e) => e.seq)).toEqual([4, 5]);
    db.close();
  });

  test("round-trips the JSON data column", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    appendEvent(db, { runId: run.id, type: "tool", data: { tool: "bash", exit: 0 } });
    expect(listEvents(db, run.id)[0]!.data).toEqual({ tool: "bash", exit: 0 });
    db.close();
  });

  test("rejects an event for a nonexistent run (foreign key enforced)", () => {
    const db = freshDb();
    expect(() => appendEvent(db, { runId: "ghost", type: "start" })).toThrow();
    db.close();
  });
});

describe("cascade delete", () => {
  test("deleting a run removes its events, artifacts and usage", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    appendEvent(db, { runId: run.id, type: "start" });
    addArtifact(db, { runId: run.id, kind: "spec", path: "runs/spec.json" });
    recordUsage(db, { runId: run.id, inputTokens: 10, outputTokens: 5 });

    db.query("DELETE FROM runs WHERE id = ?").run(run.id);

    expect(countEvents(db, run.id)).toBe(0);
    expect(listArtifacts(db, run.id)).toEqual([]);
    expect(listUsage(db, run.id)).toEqual([]);
    db.close();
  });
});

describe("artifacts and usage", () => {
  test("stores artifacts in insertion order", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    addArtifact(db, { runId: run.id, kind: "spec", path: "a.json", bytes: 12 });
    addArtifact(db, { runId: run.id, kind: "patch", path: "b.diff" });
    expect(listArtifacts(db, run.id).map((a) => a.kind)).toEqual(["spec", "patch"]);
    db.close();
  });

  test("totals usage across rows, treating nulls as zero", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    recordUsage(db, { runId: run.id, inputTokens: 100, outputTokens: 20, costUsd: 0.01 });
    recordUsage(db, { runId: run.id, inputTokens: 50, outputTokens: null });
    expect(usageTotals(db, run.id)).toEqual({ inputTokens: 150, outputTokens: 20, costUsd: 0.01 });
    db.close();
  });
});

describe("schema drift", () => {
  test("a row with an unknown status fails loudly instead of silently", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    db.query("UPDATE runs SET status = 'bogus' WHERE id = ?").run(run.id);
    expect(() => getRun(db, run.id)).toThrow(SchemaDriftError);
    db.close();
  });

  test("a malformed JSON meta column fails loudly", () => {
    const db = freshDb();
    const run = createRun(db, { taskTitle: "a", engine: "mock" });
    db.query("UPDATE runs SET meta = '{not json' WHERE id = ?").run(run.id);
    expect(() => getRun(db, run.id)).toThrow(SchemaDriftError);
    db.close();
  });
});

describe("group totals", () => {
  test("a group reports what its agents spent and produced", () => {
    const db = freshDb();
    const parent = createRun(db, { taskTitle: "2 agents", engine: "opencode" });
    const a = createRun(db, { taskTitle: "build", engine: "opencode", parentRunId: parent.id });
    const b = createRun(db, { taskTitle: "explore", engine: "opencode", parentRunId: parent.id });

    recordUsage(db, { runId: a.id, inputTokens: 100, outputTokens: 10, costUsd: 0.07 });
    recordUsage(db, { runId: b.id, inputTokens: 200, outputTokens: 20, costUsd: 0.08 });
    addArtifact(db, { runId: a.id, kind: "patch", path: "src/notes-a.md" });

    // The parent row itself spends nothing, which is why totalling it alone
    // reported $0 for a team that cost real money.
    expect(usageTotals(db, parent.id).costUsd).toBe(0);
    expect(listArtifacts(db, parent.id)).toHaveLength(0);

    const totals = usageTotalsWithChildren(db, parent.id);
    expect(totals.inputTokens).toBe(300);
    expect(totals.outputTokens).toBe(30);
    expect(totals.costUsd).toBeCloseTo(0.15, 10);
    expect(listArtifactsWithChildren(db, parent.id).map((x) => x.path)).toEqual(["src/notes-a.md"]);

    // A run with no agents under it is unchanged by the roll-up.
    expect(usageTotalsWithChildren(db, a.id).costUsd).toBeCloseTo(0.07, 10);
    db.close();
  });
});
