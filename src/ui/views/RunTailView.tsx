import { Box, Text, useApp } from "ink";
import { useEffect, useState } from "react";
import { Panel, Spinner, StatusLine } from "../components/index.tsx";
import type { EventRow, TailModel } from "../models.ts";
import { formatTimestamp, type Theme } from "../theme.ts";

/**
 * Polls the database for events with seq greater than the watermark.
 * It renders only what `poll` returns — there is no synthetic progress here.
 */
export function RunTailView({
  initial,
  poll,
  intervalMs = 500,
  theme,
}: {
  initial: TailModel;
  poll: (afterSeq: number) => TailModel;
  intervalMs?: number;
  theme: Theme;
}) {
  const { exit } = useApp();
  const [events, setEvents] = useState<EventRow[]>(initial.events);
  const [status, setStatus] = useState(initial.run.status);
  const [finished, setFinished] = useState(initial.finished);

  useEffect(() => {
    if (finished) {
      exit();
      return;
    }
    const timer = setInterval(() => {
      setEvents((prev) => {
        const watermark = prev.at(-1)?.seq ?? 0;
        const next = poll(watermark);
        setStatus(next.run.status);
        if (next.finished) {
          setFinished(true);
          exit();
        }
        return next.events.length > 0 ? [...prev, ...next.events] : prev;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [poll, intervalMs, exit, finished]);

  return (
    <Box flexDirection="column">
      <Panel theme={theme} title={`tail ${initial.run.displayId}`}>
        {events.map((e) => (
          <StatusLine
            key={e.seq}
            theme={theme}
            tone={e.tone}
            label={`${String(e.seq).padStart(4)} ${e.type.padEnd(9)}`}
            detail={`${formatTimestamp(e.ts)}${e.message ? `  ${e.message}` : ""}`}
          />
        ))}
        {finished ? (
          <Text color={theme.useColor ? theme.colors.muted : undefined}>
            {theme.symbols.ok} run {status}
          </Text>
        ) : (
          <Spinner theme={theme} label={`${status} — following (ctrl-c to stop)`} />
        )}
      </Panel>
    </Box>
  );
}
