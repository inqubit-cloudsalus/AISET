import { describe, expect, test } from "bun:test";
import { seedDemoRun } from "../../src/cli/commands/seed.ts";
import { listArtifacts } from "../../src/db/repositories/artifacts.ts";
import { countEvents, listEvents } from "../../src/db/repositories/events.ts";
import { usageTotals } from "../../src/db/repositories/usage.ts";
import { toArtifactRow, toEventRow, toOwner, toRunRow } from "../../src/ui/mappers.ts";
import type { RunCancelModel, RunDetailModel, RunListModel } from "../../src/ui/models.ts";
import { plainRecover, plainRunCancel, plainRunDetail, plainRunList } from "../../src/ui/plain.ts";
import { makeTheme, toneForVerdict } from "../../src/ui/theme.ts";
import { freshDb } from "../db/helpers.ts";

const theme = makeTheme({ color: false, unicode: true });

function seeded() {
  const db = freshDb();
  const run = seedDemoRun(db, new Date("2026-09-01T06:00:00.000Z"));
  const detail: RunDetailModel = {
    run: toRunRow(run),
    engine: run.engine,
    model: run.model,
    verdict: run.verdict,
    verdictTone: toneForVerdict(run.verdict),
    endedAt: run.ended_at,
    exitCode: run.exit_code,
    workdir: run.workdir,
    parentRunId: run.parent_run_id,
    owner: toOwner(run),
    children: [],
    events: listEvents(db, run.id).map(toEventRow),
    eventCount: countEvents(db, run.id),
    artifacts: listArtifacts(db, run.id).map(toArtifactRow),
    usage: usageTotals(db, run.id),
    showEvents: true,
  };
  db.close();
  return { run, detail };
}

describe("seed --demo", () => {
  test("records a complete, succeeded run", () => {
    const { run } = seeded();
    expect(run.status).toBe("succeeded");
    expect(run.verdict).toBe("GREEN");
    expect(run.exit_code).toBe(0);
  });

  test("is marked as a mock engine so it cannot pass for real evidence", () => {
    const { run } = seeded();
    expect(run.engine).toBe("mock");
    expect(run.meta).toMatchObject({ demo: true });
  });
});

describe("plain renderers", () => {
  test("run detail is deterministic and free of ANSI escapes", () => {
    const { detail } = seeded();
    const a = plainRunDetail(detail, theme);
    const b = plainRunDetail(detail, theme);
    expect(a).toBe(b);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting ANSI is the point
    expect(/\[/.test(a)).toBe(false);
  });

  test("run detail shows only what the database holds", () => {
    const { detail } = seeded();
    const text = plainRunDetail(detail, theme);
    expect(text).toContain(detail.run.displayId);
    expect(text).toContain("T-001 sum of two numbers, with a test");
    expect(text).toContain("succeeded");
    expect(text).toContain("GREEN");
    expect(text).toContain("runs/demo/spec.json");
    expect(text).toContain("tokens in   1250");
    expect(text).toContain("2.1s");
  });

  test("cancel says what happened to the engine, not just to the row", () => {
    const { run } = seeded();
    const base: RunCancelModel = {
      run: toRunRow(run),
      endedAt: run.ended_at,
      exitCode: 130,
      cancelRequestedAt: run.started_at,
      alreadyFinished: false,
      owner: "local",
      confirmed: true,
    };

    const local = plainRunCancel(base, theme);
    expect(local).toBe(plainRunCancel(base, theme));
    expect(local).toContain(base.run.displayId);
    expect(local).toContain("OpenCode session aborted");

    expect(plainRunCancel({ ...base, alreadyFinished: true, owner: "none" }, theme)).toContain(
      "already finished",
    );
    expect(plainRunCancel({ ...base, owner: "remote" }, theme)).toContain(
      "the process running it stopped",
    );
    expect(plainRunCancel({ ...base, owner: "remote", confirmed: false }, theme)).toContain(
      "no process confirmed the stop",
    );
    expect(plainRunCancel({ ...base, owner: "none" }, theme)).toContain("never reached the engine");
  });

  test("run detail hides the timeline unless --events was passed", () => {
    const { detail } = seeded();
    const text = plainRunDetail({ ...detail, showEvents: false }, theme);
    expect(text).toContain("(use --events to list them)");
    expect(text).not.toContain("reading task specification");
  });

  test("an empty run list says so instead of printing an empty table", () => {
    const model: RunListModel = { runs: [], filterStatus: null, limit: 20 };
    expect(plainRunList(model, theme)).toContain("(no runs)");
  });

  test("a filtered list names the filter", () => {
    const model: RunListModel = { runs: [], filterStatus: "failed", limit: 20 };
    expect(plainRunList(model, theme)).toContain("status=failed");
  });
});

describe("recover output", () => {
  test("an empty recovery says nothing was abandoned", () => {
    const text = plainRecover({ entries: [], dryRun: false }, theme);
    expect(text).toContain("no runs were left open");
    expect(text).not.toContain("dry run");
  });

  test("a dry run is labelled as one, and every action is accounted for", () => {
    const text = plainRecover(
      {
        dryRun: true,
        entries: [
          { displayId: "r_A", action: "reattached", tone: "ok", reason: "session still alive" },
          { displayId: "r_B", action: "closed", tone: "warn", reason: "its server is gone" },
          { displayId: "r_C", action: "skipped", tone: "pending", reason: "still owned" },
        ],
      },
      theme,
    );
    expect(text).toContain("dry run — nothing written");
    expect(text).toContain("r_A");
    expect(text).toContain("its server is gone");
    expect(text).toContain("1 re-attached");
    expect(text).toContain("1 closed");
    expect(text).toContain("1 left alone");
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });
});

describe("run detail owner line", () => {
  test("a run nothing ever claimed shows no owner", () => {
    const { detail } = seeded();
    expect(plainRunDetail(detail, theme)).toContain("owner       —");
  });

  test("an abandoned owner is called stale, not just old", () => {
    const { detail } = seeded();
    const text = plainRunDetail(
      {
        ...detail,
        owner: {
          pid: 4242,
          host: "box",
          heartbeatAt: "2026-09-01T06:00:00.000Z",
          stale: true,
          serverUrl: null,
        },
      },
      theme,
    );
    expect(text).toContain("owner       pid 4242 @box");
    expect(text).toContain("2026-09-01 06:00:00");
    expect(text).toContain("stale, recoverable");
  });
});
