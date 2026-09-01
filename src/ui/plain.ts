/**
 * Deterministic plain-text renderers — no colour, no React, no ANSI.
 * This is the output for pipes, CI, NO_COLOR and every test.
 */
import type {
  DbStatusModel,
  DoctorModel,
  EventRow,
  HomeModel,
  InitModel,
  RunDetailModel,
  RunListModel,
  RunRow,
  TailModel,
} from "./models.ts";
import { formatDuration, formatTimestamp, type StatusTone, type Theme, truncate } from "./theme.ts";

/**
 * The trailing half of an event line: the agent that produced it, then its
 * message. A run driven by OpenCode is multi-agent, so which agent spoke is
 * part of the record, not decoration.
 */
export function eventDetail(event: EventRow): string {
  const agent = event.agent ? ` @${event.agent}` : "";
  const message = event.message ? ` ${event.message}` : "";
  return `${agent}${message}`;
}

function mark(theme: Theme, tone: StatusTone): string {
  return tone === "ok"
    ? theme.symbols.ok
    : tone === "warn"
      ? theme.symbols.warn
      : tone === "fail"
        ? theme.symbols.fail
        : theme.symbols.pending;
}

function runTableLines(runs: RunRow[]): string[] {
  const header = ["ID", "STATUS", "TASK", "STARTED", "DURATION"];
  const widths = [30, 10, 36, 19, 10];
  const row = (cells: string[]) =>
    cells
      .map((c, i) => truncate(c, widths[i]!).padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  const lines = [row(header)];
  for (const r of runs) {
    lines.push(
      row([
        r.displayId,
        r.status,
        r.taskId ? `${r.taskId} ${r.taskTitle}` : r.taskTitle,
        formatTimestamp(r.startedAt),
        formatDuration(r.durationMs),
      ]),
    );
  }
  if (runs.length === 0) lines.push("(no runs)");
  return lines;
}

export function plainHome(model: HomeModel, theme: Theme): string {
  const lines: string[] = [
    `${theme.symbols.accent} AISET v${model.version} — AI Software Engineering Team`,
    "",
    `database   ${model.dbPath}${model.dbExists ? "" : "  (not created)"}`,
    `runs       ${model.totalRuns}`,
  ];
  const counts = Object.entries(model.countsByStatus).sort(([a], [b]) => a.localeCompare(b));
  for (const [status, n] of counts) lines.push(`  ${status.padEnd(10)} ${n}`);
  lines.push("", "recent runs", ...runTableLines(model.recentRuns).map((l) => `  ${l}`));
  lines.push(
    "",
    model.initialized
      ? `${theme.symbols.cursor} aiset runs list  ·  aiset doctor  ·  aiset seed --demo`
      : `${theme.symbols.cursor} run 'aiset init' to create ${model.dbPath}`,
  );
  return lines.join("\n");
}

export function plainDoctor(model: DoctorModel, theme: Theme): string {
  const lines = model.checks.map((c) => `${mark(theme, c.tone)} ${c.name.padEnd(22)} ${c.detail}`);
  lines.push("", model.ok ? "all checks passed" : "one or more checks failed");
  return lines.join("\n");
}

export function plainRunList(model: RunListModel, _theme: Theme): string {
  const head = model.filterStatus ? `runs (status=${model.filterStatus})` : "runs";
  return [head, "", ...runTableLines(model.runs)].join("\n");
}

export function plainRunDetail(model: RunDetailModel, theme: Theme): string {
  const r = model.run;
  const lines: string[] = [
    `${theme.symbols.accent} ${r.displayId}`,
    "",
    `task        ${r.taskId ? `${r.taskId} ` : ""}${r.taskTitle}`,
    `status      ${r.status}`,
    `verdict     ${model.verdict ?? "—"}`,
    `engine      ${model.engine}`,
    `model       ${model.model ?? "—"}`,
    `started     ${formatTimestamp(r.startedAt)}`,
    `ended       ${model.endedAt ? formatTimestamp(model.endedAt) : "—"}`,
    `duration    ${formatDuration(r.durationMs)}`,
    `exit code   ${model.exitCode ?? "—"}`,
    `workdir     ${model.workdir ?? "—"}`,
  ];
  if (model.parentRunId) lines.push(`parent run  r_${model.parentRunId}`);

  lines.push("", `events (${model.eventCount})`);
  if (model.showEvents && model.events.length > 0) {
    for (const e of model.events) {
      const msg = eventDetail(e);
      lines.push(
        `  ${String(e.seq).padStart(4)} ${formatTimestamp(e.ts)} ${e.type.padEnd(9)}${msg}`,
      );
    }
  } else if (model.eventCount > 0) {
    lines.push("  (use --events to list them)");
  } else {
    lines.push("  (none)");
  }

  lines.push("", `artifacts (${model.artifacts.length})`);
  if (model.artifacts.length === 0) lines.push("  (none)");
  for (const a of model.artifacts) {
    const size = a.bytes === null ? "" : ` ${a.bytes}b`;
    lines.push(`  ${a.kind.padEnd(15)} ${a.path}${size}`);
  }

  lines.push(
    "",
    "usage",
    `  tokens in   ${model.usage.inputTokens}`,
    `  tokens out  ${model.usage.outputTokens}`,
    `  cost usd    ${model.usage.costUsd.toFixed(4)}`,
  );
  return lines.join("\n");
}

export function plainDbStatus(model: DbStatusModel, theme: Theme): string {
  const lines = [
    `database   ${model.dbPath}${model.dbExists ? "" : "  (not created)"}`,
    "",
    "migrations",
  ];
  for (const m of model.migrations) {
    const symbol = m.applied ? theme.symbols.ok : theme.symbols.pending;
    lines.push(
      `  ${symbol} ${m.version.padEnd(20)} ${m.appliedAt ? formatTimestamp(m.appliedAt) : "pending"}`,
    );
  }
  if (model.tables) {
    lines.push("", "tables");
    for (const t of model.tables) {
      lines.push(`  ${t.name.padEnd(20)} ${String(t.rows).padStart(6)} rows`);
    }
  }
  lines.push("", model.current ? "schema is current" : "schema is behind — run 'aiset db migrate'");
  return lines.join("\n");
}

// The shell's header lives in `banner.ts`: it is a fixed region above the
// viewport rather than a rendered block, so `/clear` cannot take it away.

export function plainInit(model: InitModel, theme: Theme): string {
  const line = (created: boolean, what: string) =>
    `${created ? theme.symbols.ok : theme.symbols.bullet} ${created ? "created" : "already existed"}  ${what}`;
  const lines = [
    line(model.createdStateDir, model.stateDir),
    line(model.createdConfig, model.configPath),
    line(model.createdDb, model.dbPath),
  ];
  lines.push(
    model.migrationsApplied.length > 0
      ? `${theme.symbols.ok} applied migrations: ${model.migrationsApplied.join(", ")}`
      : `${theme.symbols.bullet} migrations already current`,
  );
  lines.push("", `${theme.symbols.cursor} next: aiset doctor`);
  return lines.join("\n");
}

export function plainTail(model: TailModel, theme: Theme): string {
  const lines = [`${theme.symbols.accent} tail ${model.run.displayId} (${model.run.status})`];
  for (const e of model.events) {
    const msg = eventDetail(e);
    lines.push(`  ${String(e.seq).padStart(4)} ${formatTimestamp(e.ts)} ${e.type.padEnd(9)}${msg}`);
  }
  if (model.finished) lines.push(`  ${theme.symbols.ok} run ${model.run.status}`);
  return lines.join("\n");
}
