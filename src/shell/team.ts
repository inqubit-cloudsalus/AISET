/**
 * Launching a team, shared by the two ways to ask for one: `/multi-launch`,
 * where the human writes each agent's prompt, and a planned team, where the
 * model does. Both end in the same `startGroup` call, so both stream and
 * summarise identically.
 */
import type { TeamPlan } from "../ai/planner.ts";
import type { Config } from "../core/config.ts";
import { displayRunId } from "../core/ids.ts";
import { findRun } from "../db/repositories/runs.ts";
import { type GroupTask, startGroup } from "../opencode/group.ts";
import type { Theme } from "../ui/theme.ts";
import { groupSummary, streamGroup } from "./multi-stream.ts";
import type { Session, ShellEmit, ShellResult } from "./types.ts";

type OpenCodeConfig = Config["opencode"] | undefined;

export interface RunGroupOptions {
  /** Blocks until every agent is done instead of returning the prompt at once. */
  wait: boolean;
  /** Names the group run; `startGroup` falls back to "N agents: …" without it. */
  title?: string;
  bin?: string;
  timeoutMs?: number;
  oc?: OpenCodeConfig;
  /** Prefixes the failure lines so the user knows which command spoke. */
  label?: string;
}

/** The plan's tasks as engine tasks, with the configured model applied to each. */
export function planToTasks(plan: TeamPlan, oc: OpenCodeConfig, workdir?: string): GroupTask[] {
  return plan.tasks.map((task) => ({
    prompt: task.prompt,
    title: task.title,
    agent: task.agent,
    taskId: null,
    model: oc?.model ?? null,
    workdir,
  }));
}

/** The plan as plain text — the same body the overlay and the transcript show. */
export function planSummary(plan: TeamPlan, theme: Theme): string {
  const { symbols } = theme;
  const lines = [
    `${symbols.accent} ${plan.title}`,
    `  ${plan.rationale}`,
    "",
    `${plan.tasks.length} agent(s):`,
  ];
  plan.tasks.forEach((task, index) => {
    lines.push(
      "",
      `  ${index + 1}. ${task.agent.padEnd(8)} ${task.title}`,
      ...task.prompt.split("\n").map((line) => `     ${line}`),
    );
  });
  return lines.join("\n");
}

/**
 * Starts the team and reports it. Detached by default: the prompt comes back
 * while the agents work, and their events keep arriving through `emit`.
 */
export async function runGroup(
  session: Session,
  tasks: GroupTask[],
  emit: ShellEmit,
  opts: RunGroupOptions,
): Promise<ShellResult> {
  const { symbols } = session.theme;
  const oc = opts.oc;
  const label = opts.label ?? "launch";

  emit({
    kind: "output",
    text: `${symbols.accent} starting ${tasks.length} agents on one OpenCode server in ${session.ctx.paths.root}…`,
  });

  let handle: Awaited<ReturnType<typeof startGroup>>;
  try {
    handle = await startGroup(session.db, tasks, {
      title: opts.title,
      bin: opts.bin ?? oc?.bin,
      hostname: oc?.hostname,
      port: oc?.port,
      timeoutMs: opts.timeoutMs ?? oc?.timeoutMs ?? 600_000,
    });
  } catch (err) {
    return {
      blocks: [
        {
          kind: "error",
          text: `${label}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      effect: "none",
    };
  }

  const group = displayRunId(handle.parentRunId);
  const header = [
    `${symbols.ok} ${group} running ${handle.children.length} agents`,
    ...handle.children.map(
      (child) =>
        `  ${child.error ? symbols.fail : symbols.bullet} ${(child.agent ?? "agent").padEnd(12)} ${displayRunId(child.runId)}${child.error ? ` — ${child.error}` : ""}`,
    ),
    `${symbols.cursor} /cancel ${group} stops the whole team ${symbols.bullet} /run ${group} inspects it`,
  ].join("\n");

  const summary = async (): Promise<ShellResult> => {
    await streamGroup(session.db, handle.children, emit);
    await handle.finished.catch(() => {});
    const text = groupSummary(session.db, handle.parentRunId, handle.children, session.theme);
    const run = findRun(session.db, handle.parentRunId);
    return {
      blocks: [{ kind: run?.status === "succeeded" ? "output" : "error", text }],
      effect: "none",
    };
  };

  if (opts.wait) {
    emit({ kind: "output", text: header });
    return summary();
  }

  void summary().then((result) => {
    for (const block of result.blocks) emit(block);
  });
  return { blocks: [{ kind: "output", text: header }], effect: "none" };
}
