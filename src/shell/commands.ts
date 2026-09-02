import { collectChecks } from "../cli/commands/doctor.ts";
import { seedDemoRun } from "../cli/commands/seed.ts";
import { readConfig } from "../core/config.ts";
import { displayRunId, normalizeRunId } from "../core/ids.ts";
import { isCurrent, migrationStatus } from "../db/migrate.ts";
import { listArtifacts } from "../db/repositories/artifacts.ts";
import { countEvents, listEvents } from "../db/repositories/events.ts";
import {
  countByStatus,
  countRuns,
  findRun,
  listActiveRuns,
  listChildRuns,
  listRuns,
  runDurationMs,
} from "../db/repositories/runs.ts";
import { tableCounts } from "../db/repositories/stats.ts";
import { usageTotals } from "../db/repositories/usage.ts";
import { RUN_STATUSES, type RunStatus } from "../db/types.ts";
import { cancel, observe, start } from "../opencode/adapter.ts";
import { type GroupTask, startGroup } from "../opencode/group.ts";
import { toArtifactRow, toEventRow, toRunRow } from "../ui/mappers.ts";
import type { DbStatusModel, RunCancelModel, RunDetailModel, RunListModel } from "../ui/models.ts";
import {
  plainDbStatus,
  plainDoctor,
  plainEventLine,
  plainRunCancel,
  plainRunDetail,
  plainRunList,
} from "../ui/plain.ts";
import { formatDuration, toneForVerdict } from "../ui/theme.ts";
import { groupSummary, streamGroup } from "./multi-stream.ts";
import { tokenize } from "./tokenize.ts";
import type { Session, ShellEmit, ShellResult, SlashCommand } from "./types.ts";

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

/** Flags that describe the whole team rather than one agent. */
const GROUP_FLAGS = new Set(["model", "timeout", "workdir", "bin", "task", "wait", "detach"]);

export interface ParsedTasks {
  shared: Map<string, string>;
  tasks: { agent: string; prompt: string }[];
}

/**
 * Reads `--agent <name> <prompt…>` pairs.
 *
 * Each `--agent` opens a task and the words after it are that agent's prompt,
 * until the next `--agent`. Flags before the first one belong to the group, so
 * `--model` and `--timeout` are said once rather than per agent.
 */
export function parseTasks(args: string[]): ParsedTasks | string {
  const shared = new Map<string, string>();
  const tasks: { agent: string; prompt: string[] }[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      const current = tasks.at(-1);
      if (!current) return `multi-launch: '${arg}' has no agent — put it after --agent <name>`;
      current.prompt.push(arg);
      continue;
    }

    const [rawName, inline] = arg.slice(2).split("=", 2);
    const name = rawName ?? "";
    const takesValue = name !== "wait" && name !== "detach";
    let value = inline;
    if (value === undefined && takesValue) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        return `multi-launch: --${name} needs a value`;
      }
      value = args[++i]!;
    }

    if (name === "agent") {
      tasks.push({ agent: value!, prompt: [] });
      continue;
    }
    if (!GROUP_FLAGS.has(name)) return `multi-launch: unknown flag --${name}`;
    shared.set(name, value ?? "true");
  }

  if (tasks.length === 0) {
    return "usage: /multi-launch --agent <a> <prompt> [--agent <b> <prompt> …]";
  }
  const empty = tasks.find((t) => t.prompt.join(" ").trim() === "");
  if (empty) return `multi-launch: agent ${empty.agent} was given no prompt`;

  return { shared, tasks: tasks.map((t) => ({ agent: t.agent, prompt: t.prompt.join(" ") })) };
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
  usage: "/runs [--status <s>] [--active] [--limit <n>]",
  run(session, args) {
    const { flags } = parseFlags(args);
    const status = flags.get("status");
    const active = flags.has("active");
    if (status && !(RUN_STATUSES as readonly string[]).includes(status)) {
      return failure(`unknown status: ${status}\nexpected one of: ${RUN_STATUSES.join(", ")}`);
    }
    const rawLimit = flags.get("limit");
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
    if (!Number.isFinite(limit) || limit <= 0) {
      return failure(`--limit must be a positive integer, got: ${rawLimit}`);
    }
    // --active is the multi-agent view: everything still working, whoever
    // started it, so a team launched here and a run started elsewhere both show.
    const runs = active
      ? listActiveRuns(session.db, limit)
      : listRuns(session.db, { status: status as RunStatus | undefined, limit });
    const model: RunListModel = {
      runs: runs.map(toRunRow),
      filterStatus: active ? "active" : (status ?? null),
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
      children: listChildRuns(session.db, runId).map(toRunRow),
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

const launch: SlashCommand = {
  name: "launch",
  summary: "launch a multi-agent OpenCode run in this directory",
  usage: "/launch [--agent <a>] [--model <m>] <prompt>",
  async run(session, args, emit) {
    const { flags, positional } = parseFlags(args);
    const prompt = positional.join(" ").trim();
    if (!prompt) return failure("usage: /launch <prompt>");

    const timeoutRaw = flags.get("timeout");
    const timeoutMs = timeoutRaw === undefined ? undefined : Number.parseInt(timeoutRaw, 10);
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      return failure(`launch: --timeout must be a positive number of ms, got: ${timeoutRaw}`);
    }

    const config = await readConfig();
    const oc = config?.opencode;
    const { symbols } = session.theme;

    // Starting the engine takes a few seconds before the first event exists,
    // so say so rather than leaving the shell silent.
    emit({
      kind: "output",
      text: `${symbols.accent} starting OpenCode in ${session.ctx.paths.root}…`,
    });

    let handle: Awaited<ReturnType<typeof start>>;
    try {
      handle = await start(
        session.db,
        {
          prompt,
          taskId: flags.get("task") ?? null,
          agent: flags.get("agent") ?? oc?.agent,
          model: flags.get("model") ?? oc?.model ?? null,
          workdir: flags.get("workdir"),
        },
        {
          bin: flags.get("bin") ?? oc?.bin,
          hostname: oc?.hostname,
          port: oc?.port,
          timeoutMs: timeoutMs ?? oc?.timeoutMs ?? 600_000,
        },
      );
    } catch (err) {
      return failure(`launch: ${err instanceof Error ? err.message : String(err)}`);
    }

    emit({
      kind: "output",
      text: `${symbols.ok} ${displayRunId(handle.runId)} running${
        (flags.get("agent") ?? oc?.agent) ? ` · agent ${flags.get("agent") ?? oc?.agent}` : ""
      } · use /cancel ${displayRunId(handle.runId)} to stop it`,
    });

    // Every line below is a row already committed to SQLite by the adapter's
    // pump — the shell is following the database, not narrating a guess.
    for await (const event of observe(session.db, handle.runId, { pollMs: 150 })) {
      emit({ kind: "output", text: plainEventLine(toEventRow(event)) });
    }

    await handle.finished.catch(() => {});
    const run = findRun(session.db, handle.runId);
    if (!run) return failure(`launch: run ${handle.runId} vanished mid-flight`);

    const totals = usageTotals(session.db, handle.runId);
    const artifacts = listArtifacts(session.db, handle.runId);
    const mark = run.status === "succeeded" ? symbols.ok : symbols.fail;
    const summary = [
      `${mark} ${displayRunId(run.id)} ${run.status} in ${formatDuration(runDurationMs(run))}`,
      `  ${artifacts.length} artifact(s) ${symbols.bullet} ${totals.inputTokens} in / ${totals.outputTokens} out tokens ${symbols.bullet} $${totals.costUsd.toFixed(4)}`,
    ].join("\n");
    return run.status === "succeeded" ? output(summary) : failure(summary);
  },
};

const multiLaunch: SlashCommand = {
  name: "multi-launch",
  summary: "launch several OpenCode agents at once, tracked as one run",
  usage: "/multi-launch [--model <m>] [--wait] --agent <a> <prompt> [--agent <b> <prompt> …]",
  async run(session, args, emit) {
    const parsed = parseTasks(args);
    if (typeof parsed === "string") return failure(parsed);
    const { shared, tasks } = parsed;

    const timeoutRaw = shared.get("timeout");
    const timeoutMs = timeoutRaw === undefined ? undefined : Number.parseInt(timeoutRaw, 10);
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      return failure(`multi-launch: --timeout must be a positive number of ms, got: ${timeoutRaw}`);
    }

    const config = await readConfig();
    const oc = config?.opencode;
    const { symbols } = session.theme;
    const wait = shared.has("wait");

    emit({
      kind: "output",
      text: `${symbols.accent} starting ${tasks.length} agents on one OpenCode server in ${session.ctx.paths.root}…`,
    });

    const groupTasks: GroupTask[] = tasks.map((t) => ({
      prompt: t.prompt,
      agent: t.agent,
      taskId: shared.get("task") ?? null,
      model: shared.get("model") ?? oc?.model ?? null,
      workdir: shared.get("workdir"),
    }));

    let handle: Awaited<ReturnType<typeof startGroup>>;
    try {
      handle = await startGroup(session.db, groupTasks, {
        bin: shared.get("bin") ?? oc?.bin,
        hostname: oc?.hostname,
        port: oc?.port,
        timeoutMs: timeoutMs ?? oc?.timeoutMs ?? 600_000,
      });
    } catch (err) {
      return failure(`multi-launch: ${err instanceof Error ? err.message : String(err)}`);
    }

    const group = displayRunId(handle.parentRunId);
    const header = [
      `${symbols.ok} ${group} running ${handle.children.length} agents`,
      ...handle.children.map(
        (c) =>
          `  ${c.error ? symbols.fail : symbols.bullet} ${(c.agent ?? "agent").padEnd(12)} ${displayRunId(c.runId)}${c.error ? ` — ${c.error}` : ""}`,
      ),
      `${symbols.cursor} /cancel ${group} stops the whole team ${symbols.bullet} /run ${group} inspects it`,
    ].join("\n");

    const summary = async (): Promise<ShellResult> => {
      await streamGroup(session.db, handle.children, emit);
      await handle.finished.catch(() => {});
      const text = groupSummary(session.db, handle.parentRunId, handle.children, session.theme);
      const run = findRun(session.db, handle.parentRunId);
      return run?.status === "succeeded" ? output(text) : failure(text);
    };

    if (wait) {
      emit({ kind: "output", text: header });
      return summary();
    }

    // Detached by default: the prompt comes back while the team works, so the
    // shell can still inspect and cancel them. The blocks keep arriving through
    // `emit`, which the view appends wherever the transcript has got to.
    void summary().then((result) => {
      for (const block of result.blocks) emit(block);
    });
    return output(header);
  },
};

const cancelRun: SlashCommand = {
  name: "cancel",
  summary: "stop a run, or a whole team launched with /multi-launch",
  usage: "/cancel <id>",
  async run(session, args) {
    const { positional } = parseFlags(args);
    const id = positional[0];
    if (!id) return failure("usage: /cancel <id>");

    const runId = normalizeRunId(id);
    const run = findRun(session.db, runId);
    if (!run) return failure(`no run found: ${id}`);

    // A group id cancels the whole group: `cancel` routes it to the children.
    const children = listChildRuns(session.db, runId);
    const result = await cancel(session.db, runId);
    const model: RunCancelModel = {
      run: toRunRow(result.run),
      endedAt: result.run.ended_at,
      exitCode: result.run.exit_code,
      cancelRequestedAt: result.run.cancel_requested_at,
      alreadyFinished: result.alreadyFinished,
      owner: result.owner,
      confirmed: result.confirmed,
    };
    const note = children.length > 0 ? `\n\ncancelled ${children.length} agents in this group` : "";
    const text = `${plainRunCancel(model, session.theme)}${note}`;
    return result.confirmed ? output(text) : failure(text);
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
  launch,
  multiLaunch,
  cancelRun,
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
export async function dispatch(
  session: Session,
  line: string,
  emit: ShellEmit = () => {},
): Promise<ShellResult> {
  const trimmed = line.trim();
  if (trimmed === "") return { blocks: [], effect: "none" };

  if (!trimmed.startsWith("/")) {
    return failure(
      `not a command: ${trimmed}\nto run an agent use /launch <prompt> — type /help for the full list`,
    );
  }

  // Quote-aware: a command may take several prompts, and quoting is how a
  // terminal user says where one of them ends.
  const [head, ...args] = tokenize(trimmed.slice(1));
  const command = findCommand(head ?? "");
  if (!command) {
    const near = completions(head ?? "");
    const hint = near.length > 0 ? `\ndid you mean: ${near.join(", ")}` : "";
    return failure(`unknown command: /${head}${hint}\ntype /help for the full list`);
  }

  try {
    return await command.run(session, args, emit);
  } catch (err) {
    return failure(`/${command.name} failed: ${(err as Error).message}`);
  }
}
