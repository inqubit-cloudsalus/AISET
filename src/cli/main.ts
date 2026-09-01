#!/usr/bin/env bun
import { Command } from "commander";
import { AisetError } from "../core/errors.ts";
import { runDbMigrate, runDbStatus } from "./commands/db.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runHome } from "./commands/home.ts";
import { runInit } from "./commands/init.ts";
import { runRun } from "./commands/run.ts";
import { runRunsCancel, runRunsList, runRunsShow, runRunsTail } from "./commands/runs.ts";
import { runSeed } from "./commands/seed.ts";
import { runShell, shellIsAvailable } from "./commands/shell.ts";
import { type CommandLike, dbExists, globalsFrom, makeContext } from "./context.ts";
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

/**
 * Bare `aiset` opens the interactive shell in a terminal and prints the one-shot
 * dashboard everywhere else, so pipes, CI and `--json` keep today's behaviour.
 * Before `init` there is no database to hold open, so home explains that instead.
 */
program.action((_opts, cmd: Command) =>
  run(() => {
    const context = ctx(cmd);
    return shellIsAvailable(context) && dbExists(context) ? runShell(context) : runHome(context);
  }),
);

withGlobals(program.command("shell").description("open the interactive AISET shell")).action(
  (_opts, cmd: Command) => run(() => runShell(ctx(cmd))),
);

withGlobals(program.command("home").description("print the dashboard once and exit")).action(
  (_opts, cmd: Command) => run(() => runHome(ctx(cmd))),
);

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

withGlobals(
  program
    .command("run <prompt...>")
    .description("launch a multi-agent OpenCode run and record it")
    .option("--agent <name>", "primary OpenCode agent (default: OpenCode's own)")
    .option("--model <provider/model>", "model for the run, e.g. opencode/big-pickle")
    .option("--workdir <path>", "directory OpenCode runs in (default: cwd)")
    .option("--timeout <ms>", "give up and record a timeout after this long")
    .option("--task <id>", "external task reference, e.g. T-001")
    .option("--detach", "print the run id and do not follow the events")
    .option("--bin <path>", "OpenCode executable to use (default: opencode on PATH)"),
).action((prompt: string[], opts, cmd: Command) =>
  run(() => runRun(ctx(cmd), prompt.join(" "), opts)),
);

const runs = program.command("runs").description("inspect and control recorded runs");

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

withGlobals(
  runs
    .command("cancel <id>")
    .description("stop an active run, wherever it is running")
    .option("--wait <ms>", "how long to wait for the owning process to confirm (default 5000)"),
).action((id, opts, cmd: Command) => run(() => runRunsCancel(ctx(cmd), id, opts)));

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
