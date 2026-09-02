import { displayRunId } from "../core/ids.ts";
import type { Db } from "../db/client.ts";
import { listArtifacts } from "../db/repositories/artifacts.ts";
import { findRun, runDurationMs } from "../db/repositories/runs.ts";
import { usageTotals } from "../db/repositories/usage.ts";
import { observe } from "../opencode/adapter.ts";
import type { GroupChild } from "../opencode/group.ts";
import { toEventRow } from "../ui/mappers.ts";
import { plainEventLine } from "../ui/plain.ts";
import { formatDuration, type Theme } from "../ui/theme.ts";
import type { ShellEmit } from "./types.ts";

/** How a child's lines are marked so several agents can share one transcript. */
export function childLabel(child: GroupChild): string {
  return `[${child.agent ?? "agent"} ${displayRunId(child.runId).slice(0, 10)}]`;
}

/**
 * Follows every agent in a group at once.
 *
 * One `observe` loop per child, all running together: within an agent the order
 * is the order its events were committed, and across agents it is the order
 * they arrived. Every line is a row already in SQLite — the shell is following
 * the database, never narrating a guess.
 */
export async function streamGroup(db: Db, children: GroupChild[], emit: ShellEmit): Promise<void> {
  await Promise.all(
    children.map(async (child) => {
      const label = childLabel(child);
      try {
        for await (const event of observe(db, child.runId, { pollMs: 150 })) {
          emit({ kind: "output", text: `${label} ${plainEventLine(toEventRow(event))}` });
        }
      } catch (err) {
        // One agent's stream ending badly must not silence the rest.
        emit({
          kind: "error",
          text: `${label} stream ended: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
  );
}

/** The closing block for a group: how each agent landed, and what the team spent. */
export function groupSummary(
  db: Db,
  parentRunId: string,
  children: GroupChild[],
  theme: Theme,
): string {
  const { symbols } = theme;
  const parent = findRun(db, parentRunId);
  const lines: string[] = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let artifacts = 0;
  for (const child of children) {
    const run = findRun(db, child.runId);
    const totals = usageTotals(db, child.runId);
    inputTokens += totals.inputTokens;
    outputTokens += totals.outputTokens;
    costUsd += totals.costUsd;
    artifacts += listArtifacts(db, child.runId).length;
    const mark = run?.status === "succeeded" ? symbols.ok : symbols.fail;
    lines.push(
      `  ${mark} ${(child.agent ?? "agent").padEnd(12)} ${displayRunId(child.runId)} ${
        run?.status ?? "unknown"
      } in ${formatDuration(run ? runDurationMs(run) : null)}`,
    );
  }

  const mark = parent?.status === "succeeded" ? symbols.ok : symbols.fail;
  return [
    `${mark} ${displayRunId(parentRunId)} ${parent?.status ?? "unknown"} in ${formatDuration(
      parent ? runDurationMs(parent) : null,
    )}`,
    ...lines,
    `  ${artifacts} artifact(s) ${symbols.bullet} ${inputTokens} in / ${outputTokens} out tokens ${symbols.bullet} $${costUsd.toFixed(4)}`,
  ].join("\n");
}
