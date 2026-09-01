import { Box, Text } from "ink";
import { KeyValue, Panel, StatusLine } from "../components/index.tsx";
import type { RunDetailModel } from "../models.ts";
import { formatDuration, formatTimestamp, type Theme } from "../theme.ts";

export function RunDetailView({ model, theme }: { model: RunDetailModel; theme: Theme }) {
  const r = model.run;
  const entries: [string, string][] = [
    ["task", r.taskId ? `${r.taskId} ${r.taskTitle}` : r.taskTitle],
    ["status", r.status],
    ["verdict", model.verdict ?? "—"],
    ["engine", model.engine],
    ["model", model.model ?? "—"],
    ["started", formatTimestamp(r.startedAt)],
    ["ended", model.endedAt ? formatTimestamp(model.endedAt) : "—"],
    ["duration", formatDuration(r.durationMs)],
    ["exit code", model.exitCode === null ? "—" : String(model.exitCode)],
    ["workdir", model.workdir ?? "—"],
  ];
  if (model.parentRunId) entries.push(["parent run", `r_${model.parentRunId}`]);

  return (
    <Box flexDirection="column">
      <Panel theme={theme} title={r.displayId}>
        <KeyValue theme={theme} entries={entries} />
      </Panel>

      <Panel theme={theme} title={`events (${model.eventCount})`}>
        {model.eventCount === 0 ? (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>(none)</Text>
        ) : model.showEvents ? (
          model.events.map((e) => (
            <StatusLine
              key={e.seq}
              theme={theme}
              tone={e.tone}
              label={`${String(e.seq).padStart(4)} ${e.type.padEnd(9)}`}
              detail={`${formatTimestamp(e.ts)}${e.message ? `  ${e.message}` : ""}`}
            />
          ))
        ) : (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>
            (use --events to list them)
          </Text>
        )}
      </Panel>

      <Panel theme={theme} title={`artifacts (${model.artifacts.length})`}>
        {model.artifacts.length === 0 ? (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>(none)</Text>
        ) : (
          <KeyValue
            theme={theme}
            width={16}
            entries={model.artifacts.map((a) => [
              a.kind,
              `${a.path}${a.bytes === null ? "" : ` (${a.bytes}b)`}`,
            ])}
          />
        )}
      </Panel>

      <Panel theme={theme} title="usage">
        <KeyValue
          theme={theme}
          entries={[
            ["tokens in", String(model.usage.inputTokens)],
            ["tokens out", String(model.usage.outputTokens)],
            ["cost usd", model.usage.costUsd.toFixed(4)],
          ]}
        />
      </Panel>
    </Box>
  );
}
