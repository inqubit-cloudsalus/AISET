import { displayRunId } from "../../core/ids.ts";
import { log } from "../../core/logger.ts";
import type { Db } from "../../db/client.ts";
import { addArtifact } from "../../db/repositories/artifacts.ts";
import { appendEvent } from "../../db/repositories/events.ts";
import { createRun, updateRun } from "../../db/repositories/runs.ts";
import { recordUsage } from "../../db/repositories/usage.ts";
import type { Run } from "../../db/types.ts";
import { renderView } from "../../ui/render.tsx";
import { type Context, requireDb } from "../context.ts";

/**
 * Inserts one synthetic run so the UI is demonstrable before the OpenCode adapter
 * exists. The engine is recorded as `mock`, never `opencode`: nothing here should
 * ever be mistaken for evidence of a real run.
 */
export function seedDemoRun(db: Db, at = new Date()): Run {
  const t = (offsetMs: number) => new Date(at.getTime() + offsetMs).toISOString();

  const run = createRun(db, {
    taskId: "T-001",
    taskTitle: "sum of two numbers, with a test",
    engine: "mock",
    model: "demo",
    status: "running",
    startedAt: t(0),
    workdir: ".",
    meta: { demo: true, note: "synthetic seed data — not a real run" },
  });

  const events: [number, Parameters<typeof appendEvent>[1]["type"], string][] = [
    [0, "start", "run started"],
    [120, "stdout", "reading task specification"],
    [400, "tool", "write src/sum.ts"],
    [900, "artifact", "spec.json written"],
    [1400, "tool", "bun test"],
    [1900, "stdout", "3 tests passed"],
    [2100, "end", "run completed"],
  ];
  for (const [offset, type, message] of events) {
    appendEvent(db, { runId: run.id, type, message, ts: t(offset) });
  }

  addArtifact(db, {
    runId: run.id,
    kind: "spec",
    path: "runs/demo/spec.json",
    bytes: 412,
    schemaVersion: "1",
    createdAt: t(900),
  });
  addArtifact(db, {
    runId: run.id,
    kind: "test-report",
    path: "runs/demo/test-report.json",
    bytes: 1180,
    schemaVersion: "1",
    createdAt: t(1900),
  });

  recordUsage(db, {
    runId: run.id,
    provider: "mock",
    model: "demo",
    inputTokens: 1250,
    outputTokens: 340,
    costUsd: 0.0042,
    recordedAt: t(2100),
  });

  return updateRun(db, run.id, {
    status: "succeeded",
    verdict: "GREEN",
    endedAt: t(2100),
    exitCode: 0,
  });
}

export async function runSeed(ctx: Context, opts: { demo?: boolean }): Promise<number> {
  if (!opts.demo) {
    process.stderr.write("seed: nothing to do — pass --demo to insert the demo run\n");
    return 1;
  }

  const db = requireDb(ctx);
  const run = seedDemoRun(db);
  db.close();

  await log("info", "seed.demo", { runId: run.id }, ctx.paths.root);
  const summary = {
    seeded: 1,
    runId: run.id,
    displayId: displayRunId(run.id),
    engine: run.engine,
  };
  await renderView(
    {
      json: () => summary,
      plain: (theme) =>
        `${theme.symbols.ok} seeded demo run ${summary.displayId} (engine=mock)\n` +
        `${theme.symbols.cursor} aiset runs show ${summary.displayId} --events`,
    },
    ctx,
  );
  return 0;
}
