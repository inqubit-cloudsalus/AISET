import { Box, Text } from "ink";
import { Banner, Hint, Panel, Table } from "../components/index.tsx";
import type { HomeModel } from "../models.ts";
import { formatDuration, formatTimestamp, type Theme } from "../theme.ts";

export function HomeView({ model, theme }: { model: HomeModel; theme: Theme }) {
  const counts = Object.entries(model.countsByStatus).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Box flexDirection="column">
      <Banner theme={theme} version={model.version} />

      <Panel theme={theme} title="workspace">
        <Text>
          <Text color={theme.useColor ? theme.colors.muted : undefined}>{"database  "}</Text>
          <Text>{model.dbPath}</Text>
          {model.dbExists ? null : (
            <Text color={theme.useColor ? theme.colors.warn : undefined}> (not created)</Text>
          )}
        </Text>
        <Text>
          <Text color={theme.useColor ? theme.colors.muted : undefined}>{"runs      "}</Text>
          <Text>{model.totalRuns}</Text>
          {counts.length > 0 ? (
            <Text color={theme.useColor ? theme.colors.muted : undefined}>
              {"  "}
              {counts.map(([s, n]) => `${s} ${n}`).join(`  ${theme.symbols.bullet}  `)}
            </Text>
          ) : null}
        </Text>
      </Panel>

      <Panel theme={theme} title="recent runs">
        {model.recentRuns.length === 0 ? (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>(no runs yet)</Text>
        ) : (
          <Table
            theme={theme}
            columns={[
              { header: "ID", width: 30 },
              { header: "STATUS", width: 10, tone: (i) => model.recentRuns[i]?.tone },
              { header: "TASK", width: 30 },
              { header: "STARTED", width: 19 },
              { header: "DURATION", width: 9 },
            ]}
            rows={model.recentRuns.map((r) => [
              r.displayId,
              r.status,
              r.taskId ? `${r.taskId} ${r.taskTitle}` : r.taskTitle,
              formatTimestamp(r.startedAt),
              formatDuration(r.durationMs),
            ])}
          />
        )}
      </Panel>

      <Hint theme={theme}>
        {model.initialized
          ? "aiset runs list  ·  aiset doctor  ·  aiset seed --demo"
          : `run 'aiset init' to create ${model.dbPath}`}
      </Hint>
    </Box>
  );
}
