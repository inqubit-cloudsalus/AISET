import { Box, Text } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { colorForTone, type StatusTone, type Theme, truncate } from "../theme.ts";

interface ThemeProp {
  theme: Theme;
}

function tint(theme: Theme, color: string): string | undefined {
  return theme.useColor ? color : undefined;
}

export function Banner({ theme, version }: ThemeProp & { version: string }) {
  return (
    <Box
      borderStyle="round"
      borderColor={tint(theme, theme.colors.chrome)}
      flexDirection="column"
      paddingX={2}
      marginBottom={1}
    >
      <Text>
        <Text color={tint(theme, theme.colors.accent)}>{theme.symbols.accent} AISET </Text>
        <Text color={tint(theme, theme.colors.muted)}>v{version}</Text>
      </Text>
      <Text color={tint(theme, theme.colors.muted)}>AI Software Engineering Team</Text>
    </Box>
  );
}

export function Panel({
  theme,
  title,
  children,
}: ThemeProp & { title?: string; children: ReactNode }) {
  return (
    <Box
      borderStyle="round"
      borderColor={tint(theme, theme.colors.chrome)}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      {title ? (
        <Text color={tint(theme, theme.colors.accent)}>
          {theme.symbols.accent} {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function StatusLine({
  theme,
  tone,
  label,
  detail,
}: ThemeProp & { tone: StatusTone; label: string; detail?: string }) {
  const symbol =
    tone === "ok"
      ? theme.symbols.ok
      : tone === "warn"
        ? theme.symbols.warn
        : tone === "fail"
          ? theme.symbols.fail
          : theme.symbols.pending;
  return (
    <Text>
      <Text color={tint(theme, colorForTone(tone))}>{symbol} </Text>
      <Text>{label}</Text>
      {detail ? <Text color={tint(theme, theme.colors.muted)}> {detail}</Text> : null}
    </Text>
  );
}

export function KeyValue({
  theme,
  entries,
  width = 14,
}: ThemeProp & { entries: [string, string][]; width?: number }) {
  return (
    <Box flexDirection="column">
      {entries.map(([key, value]) => (
        <Text key={key}>
          <Text color={tint(theme, theme.colors.muted)}>{key.padEnd(width)}</Text>
          <Text>{value}</Text>
        </Text>
      ))}
    </Box>
  );
}

export interface Column {
  header: string;
  width: number;
  /** Tone applied to this cell, if any — used to colour the status column only. */
  tone?: (rowIndex: number) => StatusTone | undefined;
}

export function Table({
  theme,
  columns,
  rows,
}: ThemeProp & { columns: Column[]; rows: string[][] }) {
  return (
    <Box flexDirection="column">
      <Text color={tint(theme, theme.colors.muted)}>
        {columns.map((c) => c.header.padEnd(c.width)).join(" ")}
      </Text>
      {rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, ids live in cells
        <Text key={`${row[0]}-${rowIndex}`}>
          {columns.map((col, colIndex) => {
            const tone = col.tone?.(rowIndex);
            const cell = truncate(row[colIndex] ?? "", col.width).padEnd(col.width);
            return (
              <Text key={col.header} color={tone ? tint(theme, colorForTone(tone)) : undefined}>
                {cell}{" "}
              </Text>
            );
          })}
        </Text>
      ))}
    </Box>
  );
}

/**
 * The current spinner glyph on its own, for callers that compose their own
 * line — the shell's status row is a single truncated `Text` and cannot afford
 * the nested elements `Spinner` renders.
 */
export function useSpinnerFrame(theme: Theme): string {
  const [frame, setFrame] = useState(0);
  const frames = theme.symbols.spinner;
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % frames.length), 90);
    return () => clearInterval(timer);
  }, [frames.length]);
  return frames[frame] ?? "";
}

export function Spinner({ theme, label }: ThemeProp & { label: string }) {
  const frame = useSpinnerFrame(theme);
  return (
    <Text>
      <Text color={tint(theme, theme.colors.accent)}>{frame} </Text>
      <Text color={tint(theme, theme.colors.muted)}>{label}</Text>
    </Text>
  );
}

export function Hint({ theme, children }: ThemeProp & { children: ReactNode }) {
  return (
    <Text color={tint(theme, theme.colors.muted)}>
      {theme.symbols.cursor} {children}
    </Text>
  );
}
