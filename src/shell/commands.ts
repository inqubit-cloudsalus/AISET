import { collectChecks } from "../cli/commands/doctor.ts";
import { seedDemoRun } from "../cli/commands/seed.ts";
import { displayRunId, normalizeRunId } from "../core/ids.ts";
import { isCurrent, migrationStatus } from "../db/migrate.ts";
import { listArtifacts } from "../db/repositories/artifacts.ts";
import { countEvents, listEvents } from "../db/repositories/events.ts";
import { countByStatus, countRuns, findRun, listRuns } from "../db/repositories/runs.ts";
import { tableCounts } from "../db/repositories/stats.ts";
import { usageTotals } from "../db/repositories/usage.ts";
import { RUN_STATUSES, type RunStatus } from "../db/types.ts";
import { toArtifactRow, toEventRow, toRunRow } from "../ui/mappers.ts";
import type { DbStatusModel, RunDetailModel, RunListModel } from "../ui/models.ts";
import { plainDbStatus, plainDoctor, plainRunDetail, plainRunList } from "../ui/plain.ts";
import { toneForVerdict } from "../ui/theme.ts";
import type { Session, ShellResult, SlashCommand } from "./types.ts";

function output(text: string): ShellResult {
  return { blocks: [{ kind: "output", text }], effect: "none" };
}

function failure(text: string): ShellResult {
  return { blocks: [{ kind: "error", text }], effect: "none" };
}

/** Pulls `--key value` and `--flag` out of an argument list, leaving positionals. */
function parseFlags(args: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags.set(name!, inline);
    } else if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) {
      flags.set(name!, args[++i]!);
    } else {
      flags.set(name!, "true");
    }
  }
  return { flags, positional };
}

const help: SlashCommand = {
  name: "help",
  summary: "list every command",
  run(session) {
    const width = Math.max(...COMMANDS.map((c) => (c.usage ?? `/${c.name}`).length));
    const lines = ["commands", ""];
    for (const cmd of COMMANDS) {
      lines.push(`  ${(cmd.usage ?? `/${cmd.name}`).padEnd(width)}  ${cmd.summary}`);
    }
    lines.push(
      "",
      `${session.theme.symbols.bullet} tab completes a command, ↑/↓ walks history, wheel or pgup/pgdn scrolls, ctrl+c clears the line`,
    );
    return output(lines.join("\n"));
  },
};

const dbStatus: SlashCommand = {
  name: "db-status",
  summary: "migrations, schema currency and row counts per table",
  run(session) {
    const model: DbStatusModel = {
      dbPath: session.ctx.paths.dbPath,
      dbExists: true,
      current: isCurrent(session.db),
      migrations: migrationStatus(session.db),
      tables: tableCounts(session.db),
    };
    const counts = countByStatus(session.db);
    const byStatus = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, n]) => `  ${status.padEnd(20)} ${String(n).padStart(6)}`);
    const extra = byStatus.length > 0 ? ["", "runs by status", ...byStatus] : [];
    return output([plainDbStatus(model, session.theme), ...extra].join("\n"));
  },
};

const runsList: SlashCommand = {
  name: "runs",
  summary: "list runs, most recent first",
  usage: "/runs [--status <s>] [--limit <n>]",
  run(session, args) {
    const { flags } = parseFlags(args);
    const status = flags.get("status");
    if (status && !(RUN_STATUSES as readonly string[]).includes(status)) {
      return failure(`unknown status: ${status}\nexpected one of: ${RUN_STATUSES.join(", ")}`);
    }
    const rawLimit = flags.get("limit");
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
    if (!Number.isFinite(limit) || limit <= 0) {
      return failure(`--limit must be a positive integer, got: ${rawLimit}`);
    }
    const model: RunListModel = {
      runs: listRuns(session.db, { status: status as RunStatus | undefined, limit }).map(toRunRow),
      filterStatus: status ?? null,
      limit,
    };
    return output(plainRunList(model, session.theme));
  },
};

const runShow: SlashCommand = {
  name: "run",
  summary: "show one run with its events, artifacts and usage",
  usage: "/run <id>",
  run(session, args) {
    const { positional } = parseFlags(args);
    const id = positional[0];
    if (!id) return failure("usage: /run <id>");

    const runId = normalizeRunId(id);
    const run = findRun(session.db, runId);
    if (!run) return failure(`no run found: ${id}`);

    const model: RunDetailModel = {
      run: toRunRow(run),
      engine: run.engine,
      model: run.model,
      verdict: run.verdict,
      verdictTone: toneForVerdict(run.verdict),
      endedAt: run.ended_at,
      exitCode: run.exit_code,
      workdir: run.workdir,
      parentRunId: run.parent_run_id,
      events: listEvents(session.db, runId).map(toEventRow),
      eventCount: countEvents(session.db, runId),
      artifacts: listArtifacts(session.db, runId).map(toArtifactRow),
      usage: usageTotals(session.db, runId),
      // The shell has the room the one-shot command does not, so events are always shown.
      showEvents: true,
    };
    return output(plainRunDetail(model, session.theme));
  },
};

const doctor: SlashCommand = {
  name: "doctor",
  summary: "check bun, the database, opencode and provider key presence",
  async run(session) {
    const model = await collectChecks(session.ctx);
    return output(plainDoctor(model, session.theme));
  },
};

const seed: SlashCommand = {
  name: "seed",
  summary: "insert one synthetic demo run (engine=mock)",
  usage: "/seed --demo",
  run(session, args) {
    const { flags } = parseFlags(args);
    if (!flags.has("demo")) {
      return failure("seed: nothing to do — pass --demo to insert the demo run");
    }
    const run = seedDemoRun(session.db);
    return output(
      [
        `${session.theme.symbols.ok} seeded demo run ${displayRunId(run.id)} (engine=mock)`,
        `${session.theme.symbols.cursor} /run ${displayRunId(run.id)}  ${session.theme.symbols.bullet}  ${countRuns(session.db)} runs total`,
      ].join("\n"),
    );
  },
};

const clear: SlashCommand = {
  name: "clear",
  summary: "clear the transcript",
  run() {
    return { blocks: [], effect: "clear" };
  },
};

const exit: SlashCommand = {
  name: "exit",
  summary: "leave the shell (also /quit, or ctrl+d on an empty line)",
  run() {
    return { blocks: [], effect: "exit" };
  },
};

const quit: SlashCommand = { ...exit, name: "quit", summary: "alias for /exit" };

/** Registry order is display order in `/help`. */
export const COMMANDS: SlashCommand[] = [
  help,
  dbStatus,
  runsList,
  runShow,
  doctor,
  seed,
  clear,
  exit,
  quit,
];

export function findCommand(name: string): SlashCommand | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** Command names that `Tab` can complete, in registry order. */
export function completions(prefix: string): string[] {
  const bare = prefix.startsWith("/") ? prefix.slice(1) : prefix;
  return COMMANDS.filter((c) => c.name.startsWith(bare)).map((c) => `/${c.name}`);
}

/**
 * Dispatches one submitted line. Bare text is an error, not a prompt: the shell
 * does not yet run agents, and it will not pretend to.
 */
export async function dispatch(session: Session, line: string): Promise<ShellResult> {
  const trimmed = line.trim();
  if (trimmed === "") return { blocks: [], effect: "none" };

  if (!trimmed.startsWith("/")) {
    return failure(
      `not a command: ${trimmed}\nthe shell does not run agents yet — type /help to see what it does do`,
    );
  }

  const [head, ...args] = trimmed.slice(1).split(/\s+/);
  const command = findCommand(head ?? "");
  if (!command) {
    const near = completions(head ?? "");
    const hint = near.length > 0 ? `\ndid you mean: ${near.join(", ")}` : "";
    return failure(`unknown command: /${head}${hint}\ntype /help for the full list`);
  }

  try {
    return await command.run(session, args);
  } catch (err) {
    return failure(`/${command.name} failed: ${(err as Error).message}`);
  }
}
