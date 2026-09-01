#!/usr/bin/env bun
import { Command } from "commander";
import { AisetError } from "../core/errors.ts";
import { runDbMigrate, runDbStatus } from "./commands/db.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runHome } from "./commands/home.ts";
import { runInit } from "./commands/init.ts";
import { runRunsList, runRunsShow, runRunsTail } from "./commands/runs.ts";
import { runSeed } from "./commands/seed.ts";
import { type CommandLike, globalsFrom, makeContext } from "./context.ts";
import { VERSION } from "./version.ts";

/**
 * The global flags are declared on every command that can be invoked directly,
 * so `aiset --json runs list` and `aiset runs list --json` behave identically.
 * `globalsFrom` resolves which one the user actually typed.
 */
function withGlobals(cmd: Command): Command {
  return cmd
    .option("--json", "machine-readable output; never mounts the TUI")
    .option("--no-color", "disable colour and the TUI (also honours NO_COLOR)")
    .option("--db <path>", "path to the runs database (default .aiset/aiset.db)");
}

function ctx(cmd: Command) {
  return makeContext(globalsFrom(cmd as unknown as CommandLike));
}

/** Commander actions cannot set an exit code directly; every action funnels here. */
async function run(action: () => Promise<number>): Promise<void> {
  process.exitCode = await action();
}

const program = withGlobals(
  new Command()
    .name("aiset")
    .description("AISET — AI Software Engineering Team")
    .version(VERSION, "-v, --version"),
);

program.action((_opts, cmd: Command) => run(() => runHome(ctx(cmd))));

withGlobals(
  program
    .command("init")
    .description("create .aiset/, its config and the runs database (idempotent)"),
).action((_opts, cmd: Command) => run(() => runInit(ctx(cmd))));

withGlobals(
  program
    .command("doctor")
    .description("check bun, the database, opencode and provider key presence"),
).action((_opts, cmd: Command) => run(() => runDoctor(ctx(cmd))));

const runs = program.command("runs").description("inspect recorded runs");

withGlobals(
  runs
    .command("list")
    .description("list runs, most recent first")
    .option("--status <status>", "filter by status")
    .option("--limit <n>", "maximum rows (default 20)"),
).action((opts, cmd: Command) => run(() => runRunsList(ctx(cmd), opts)));

withGlobals(
  runs
    .command("show <id>")
    .description("show one run with its artifacts and usage")
    .option("--events", "include the full event timeline"),
).action((id, opts, cmd: Command) => run(() => runRunsShow(ctx(cmd), id, opts)));

withGlobals(runs.command("tail <id>").description("follow a running run's events live")).action(
  (id, _opts, cmd: Command) => run(() => runRunsTail(ctx(cmd), id)),
);

const db = program.command("db").description("database maintenance (no destructive commands)");

withGlobals(db.command("migrate").description("apply pending migrations")).action(
  (_opts, cmd: Command) => run(() => runDbMigrate(ctx(cmd))),
);

withGlobals(db.command("status").description("report applied and pending migrations")).action(
  (_opts, cmd: Command) => run(() => runDbStatus(ctx(cmd))),
);

withGlobals(
  program
    .command("seed")
    .description("insert synthetic data for demonstration")
    .option("--demo", "insert one demo run with events, artifacts and usage"),
).action((opts, cmd: Command) => run(() => runSeed(ctx(cmd), opts)));

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof AisetError) {
    process.stderr.write(`error: ${err.message}\n`);
    if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
