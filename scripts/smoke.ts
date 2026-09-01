#!/usr/bin/env bun
/**
 * End-to-end CLI smoke test. Zero manual setup: runs the real binary against a
 * throwaway workspace and asserts the JSON contract of each command.
 *
 * `bun run smoke` (or `make cli-smoke`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "main.ts");

let step = 0;
const failures: string[] = [];

function ok(label: string) {
  step += 1;
  process.stdout.write(`  ok ${step} — ${label}\n`);
}

function assert(condition: unknown, label: string): asserts condition {
  if (condition) {
    ok(label);
    return;
  }
  step += 1;
  failures.push(label);
  process.stdout.write(`  NOT OK ${step} — ${label}\n`);
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function aiset(workdir: string, ...args: string[]): Promise<Result> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: workdir,
    stdout: "pipe",
    stderr: "pipe",
    // NO_COLOR guarantees the deterministic path even if the runner has a TTY.
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function json<T>(result: Result, label: string): T {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`${label}: stdout was not JSON:\n${result.stdout}\n${result.stderr}`);
  }
}

const workdir = mkdtempSync(join(tmpdir(), "aiset-smoke-"));
process.stdout.write(`aiset cli smoke — ${workdir}\n`);

try {
  // 1. init, and a second init to prove idempotence
  const init = await aiset(workdir, "init", "--json");
  assert(init.code === 0, "init exits 0");
  const initModel = json<{ createdDb: boolean; migrationsApplied: string[] }>(init, "init");
  assert(initModel.createdDb, "init creates the database");
  assert(initModel.migrationsApplied.includes("0001_init"), "init applies 0001_init");

  const reinit = json<{ createdDb: boolean; migrationsApplied: string[] }>(
    await aiset(workdir, "init", "--json"),
    "re-init",
  );
  assert(!reinit.createdDb && reinit.migrationsApplied.length === 0, "init is idempotent");

  // 2. db status
  const status = await aiset(workdir, "db", "status", "--json");
  assert(status.code === 0, "db status exits 0");
  assert(json<{ current: boolean }>(status, "db status").current, "schema reports current");

  // 3. seed
  const seed = await aiset(workdir, "seed", "--demo", "--json");
  assert(seed.code === 0, "seed --demo exits 0");
  const seeded = json<{ seeded: number; displayId: string }>(seed, "seed");
  assert(seeded.seeded === 1, "seed inserts exactly one run");

  // 4. runs list
  const list = await aiset(workdir, "runs", "list", "--json");
  assert(list.code === 0, "runs list exits 0");
  const runs = json<{ id: string; displayId: string; status: string }[]>(list, "runs list");
  assert(runs.length === 1, "runs list returns one run");
  assert(runs[0]!.status === "succeeded", "the seeded run is succeeded");

  const filtered = json<unknown[]>(
    await aiset(workdir, "runs", "list", "--status", "failed", "--json"),
    "runs list --status",
  );
  assert(filtered.length === 0, "--status filters the list");

  const badStatus = await aiset(workdir, "runs", "list", "--status", "bogus");
  assert(badStatus.code === 1, "an unknown --status exits 1");
  assert(badStatus.stderr.includes("unknown status"), "an unknown --status explains itself");

  // 5. runs show
  const show = await aiset(workdir, "runs", "show", seeded.displayId, "--json");
  assert(show.code === 0, "runs show exits 0");
  const detail = json<{
    events: unknown[];
    artifacts: unknown[];
    usage: { inputTokens: number };
    verdict: string;
  }>(show, "runs show");
  assert(detail.events.length >= 5, "runs show returns the event timeline");
  assert(detail.artifacts.length === 2, "runs show returns the artifacts");
  assert(detail.usage.inputTokens > 0, "runs show returns usage");
  assert(detail.verdict === "GREEN", "runs show returns the verdict");

  const missing = await aiset(workdir, "runs", "show", "r_DOESNOTEXIST");
  assert(missing.code === 1, "runs show on an unknown id exits 1");

  // 5b. runs cancel. The seeded run is already closed, so this exercises the
  // command end to end without an engine: cancel must be a no-op, not a reopen.
  const cancelDone = await aiset(workdir, "runs", "cancel", seeded.displayId, "--json");
  assert(cancelDone.code === 0, "runs cancel on a finished run exits 0");
  const cancelled = json<{
    run: { status: string };
    alreadyFinished: boolean;
    owner: string;
  }>(cancelDone, "runs cancel");
  assert(cancelled.alreadyFinished, "runs cancel reports the run had already finished");
  assert(cancelled.run.status === "succeeded", "runs cancel does not rewrite a closed run");

  const cancelMissing = await aiset(workdir, "runs", "cancel", "r_DOESNOTEXIST");
  assert(cancelMissing.code === 1, "runs cancel on an unknown id exits 1");

  // 6. plain-text fallback never emits ANSI
  const plain = await aiset(workdir, "runs", "list");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting ANSI escapes is the point
  assert(!/\[/.test(plain.stdout), "plain output contains no ANSI escapes");
  assert(plain.stdout.includes(seeded.displayId), "plain output lists the run");

  // 7. `run` guardrails. The engine itself is never launched here — a smoke run
  // must stay offline and free — so only the paths that fail before OpenCode is
  // reached are exercised.
  const runHelp = await aiset(workdir, "run", "--help");
  assert(runHelp.code === 0, "run --help exits 0");
  assert(runHelp.stdout.includes("--agent"), "run --help documents --agent");
  assert(runHelp.stdout.includes("--detach"), "run --help documents --detach");

  const badTimeout = await aiset(workdir, "run", "hello", "--timeout", "nope");
  assert(badTimeout.code === 1, "run with a bad --timeout exits 1");
  assert(badTimeout.stderr.includes("--timeout must be"), "run explains a bad --timeout");

  const missingPrompt = await aiset(workdir, "run");
  assert(missingPrompt.code !== 0, "run without a prompt exits non-zero");

  // 8. doctor last, so a broken DB would already have surfaced
  const doctor = await aiset(workdir, "doctor");
  assert(doctor.code === 0, "doctor exits 0");
  assert(!/sk-|api[_-]?key=\S/i.test(doctor.stdout), "doctor never prints a key value");
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\nsmoke FAILED — ${failures.length} of ${step} checks\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`\nsmoke passed — ${step} checks\n`);
