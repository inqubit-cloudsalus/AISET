import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import type { Db } from "../../src/db/client.ts";
import {
  claimRun,
  createRun,
  getRun,
  heartbeat,
  updateRun,
} from "../../src/db/repositories/runs.ts";
import type { Run } from "../../src/db/types.ts";
import { describeOwner, isOrphaned, processNonce, STALE_MS } from "../../src/opencode/ownership.ts";
import { freshDb } from "../db/helpers.ts";

function openRun(db: Db): Run {
  return createRun(db, { taskTitle: "a run", engine: "opencode", status: "running" });
}

/** Back-dates the heartbeat, which is what a dead owner looks like from here. */
function beatAgo(db: Db, id: string, ms: number): Run {
  return updateRun(db, id, { heartbeatAt: new Date(Date.now() - ms).toISOString() });
}

describe("ownership", () => {
  test("a run beating right now is never an orphan", () => {
    const db = freshDb();
    const run = openRun(db);
    claimRun(db, run.id, {
      pid: process.pid,
      host: hostname(),
      nonce: processNonce(),
      serverUrl: null,
    });
    expect(isOrphaned(getRun(db, run.id))).toBe(false);
  });

  test("a heartbeat older than the stale window is an orphan", () => {
    const db = freshDb();
    const run = openRun(db);
    claimRun(db, run.id, { pid: 1, host: "elsewhere", nonce: "other", serverUrl: null });
    expect(isOrphaned(beatAgo(db, run.id, STALE_MS + 1_000))).toBe(true);
    expect(isOrphaned(beatAgo(db, run.id, STALE_MS - 1_000))).toBe(false);
  });

  test("a run this process is pumping is never an orphan, however stale", () => {
    const db = freshDb();
    const run = openRun(db);
    claimRun(db, run.id, { pid: 1, host: "elsewhere", nonce: "other", serverUrl: null });
    const stale = beatAgo(db, run.id, STALE_MS * 10);
    expect(isOrphaned(stale, { local: new Set([run.id]) })).toBe(false);
    expect(isOrphaned(stale)).toBe(true);
  });

  test("a run that never claimed an owner is recoverable", () => {
    const db = freshDb();
    const run = openRun(db);
    expect(run.heartbeat_at).toBeNull();
    expect(isOrphaned(run)).toBe(true);
  });

  test("a finished run is never an orphan", () => {
    const db = freshDb();
    const run = openRun(db);
    claimRun(db, run.id, { pid: 1, host: "elsewhere", nonce: "other", serverUrl: null });
    beatAgo(db, run.id, STALE_MS * 10);
    updateRun(db, run.id, { status: "succeeded", endedAt: new Date().toISOString() });
    expect(isOrphaned(getRun(db, run.id))).toBe(false);
  });

  test("a dead pid on this host is an orphan before the window expires", () => {
    const db = freshDb();
    const run = openRun(db);
    // 2^22 is above every Linux and Windows pid; nothing is running under it.
    claimRun(db, run.id, { pid: 4_194_305, host: hostname(), nonce: "other", serverUrl: null });
    expect(isOrphaned(beatAgo(db, run.id, 1_000))).toBe(true);
  });

  test("heartbeat only moves the beat, and describeOwner reads it back", () => {
    const db = freshDb();
    const run = openRun(db);
    claimRun(db, run.id, { pid: 4242, host: "box", nonce: "n", serverUrl: "http://127.0.0.1:9" });
    beatAgo(db, run.id, 8_000);
    expect(describeOwner(getRun(db, run.id))).toContain("pid 4242 @box");
    expect(describeOwner(getRun(db, run.id))).toContain("8s ago");

    heartbeat(db, run.id);
    const beaten = getRun(db, run.id);
    expect(isOrphaned(beaten)).toBe(false);
    expect(beaten.server_url).toBe("http://127.0.0.1:9");
    expect(beaten.status).toBe("running");
  });

  test("a run nothing ever touched has no owner to describe", () => {
    const db = freshDb();
    expect(describeOwner(openRun(db))).toBeNull();
  });
});
