import { Box, Text } from "ink";
import { Panel, Table } from "../components/index.tsx";
import type { RunListModel } from "../models.ts";
import { formatDuration, formatTimestamp, type Theme } from "../theme.ts";

export function RunListView({ model, theme }: { model: RunListModel; theme: Theme }) {
  const title = model.filterStatus ? `runs · status=${model.filterStatus}` : "runs";
  return (
    <Box flexDirection="column">
      <Panel theme={theme} title={title}>
        {model.runs.length === 0 ? (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>(no runs)</Text>
        ) : (
          <Table
            theme={theme}
            columns={[
              { header: "ID", width: 30 },
              { header: "STATUS", width: 10, tone: (i) => model.runs[i]?.tone },
              { header: "TASK", width: 34 },
              { header: "STARTED", width: 19 },
              { header: "DURATION", width: 9 },
            ]}
            rows={model.runs.map((r) => [
              r.displayId,
              r.status,
              r.taskId ? `${r.taskId} ${r.taskTitle}` : r.taskTitle,
              formatTimestamp(r.startedAt),
              formatDuration(r.durationMs),
            ])}
          />
        )}
      </Panel>
    </Box>
  );
}
