import { describe, expect, test } from "bun:test";
import { seedDemoRun } from "../../src/cli/commands/seed.ts";
import { listArtifacts } from "../../src/db/repositories/artifacts.ts";
import { countEvents, listEvents } from "../../src/db/repositories/events.ts";
import { usageTotals } from "../../src/db/repositories/usage.ts";
import { toArtifactRow, toEventRow, toRunRow } from "../../src/ui/mappers.ts";
import type { RunDetailModel, RunListModel } from "../../src/ui/models.ts";
import { plainRunDetail, plainRunList } from "../../src/ui/plain.ts";
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
