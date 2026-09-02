import { Box, Text, useApp, useInput, useStdout, useWindowSize } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orphanNotice } from "../../opencode/recover.ts";
import { dispatch } from "../../shell/commands.ts";
import { shellHeader } from "../../shell/session.ts";
import type { Session, ShellBlock } from "../../shell/types.ts";
import { headerRows, rowText, type Shade } from "../banner.ts";
import { useSpinnerFrame } from "../components/index.tsx";
import { Prompt } from "../components/Prompt.tsx";
import { MOUSE_DISABLE, MOUSE_ENABLE, WHEEL_LINES, type WheelDirection } from "../mouse.ts";
import { colorForTone, type Theme } from "../theme.ts";
import {
  clampOffset,
  maxOffset,
  scrollStatus,
  toViewportLines,
  type ViewportLine,
  viewportHeight,
  visibleLines,
} from "../viewport.ts";

function tint(theme: Theme, color: string): string | undefined {
  return theme.useColor ? color : undefined;
}

/**
 * Depth in the logo: lit faces take the accent, the drop shadow and the back
 * rank of the team take chrome grey and are dimmed on top of that.
 */
function shadeColor(theme: Theme, shade: Shade): string {
  return shade === "lit" ? theme.colors.accent : theme.colors.chrome;
}

function colorFor(theme: Theme, kind: ViewportLine["kind"]): string | undefined {
  if (kind === "error") return tint(theme, colorForTone("fail"));
  if (kind === "input") return tint(theme, theme.colors.accent);
  return undefined;
}

/**
 * The AISET shell. The header is fixed above a bordered viewport sized to the
 * terminal: output scrolls inside the box, and `/clear` empties the box without
 * touching the wordmark or the connection line.
 */
interface ShellViewProps {
  session: Session;
  /** Subscribes to wheel notches; returns an unsubscribe. Supplied by runShell. */
  onWheel: (listener: (direction: WheelDirection) => void) => () => void;
}

export function ShellView({ session, onWheel }: ShellViewProps) {
  const { theme } = session;
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const { stdout } = useStdout();

  const [blocks, setBlocks] = useState<ShellBlock[]>(() => {
    const opening: ShellBlock[] = [
      {
        kind: "output",
        text: `${theme.symbols.cursor} /help for commands ${theme.symbols.bullet} /db-status for the database ${theme.symbols.bullet} /exit to quit`,
      },
    ];
    // Runs a dead process left behind are said once, on the way in. Reported,
    // not acted on: recovery adopts sessions and closes runs, which is not
    // something to do to a user who only opened a terminal.
    const orphans = orphanNotice(session.db);
    if (orphans) {
      opening.push({ kind: "output", text: `${theme.symbols.warn} ${orphans} — /recover` });
    }
    return opening;
  });
  const [busy, setBusy] = useState(false);
  /** null follows the tail; a number pins the first visible line. */
  const [offset, setOffset] = useState<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);

  const spinner = useSpinnerFrame(theme);

  // Read once: the header describes the handle this session opened, and the
  // counts on it are a connection fact, not a live view of the data.
  const header = useMemo(() => shellHeader(session), [session]);
  const banner = headerRows(header, theme, { columns, rows });

  const height = viewportHeight(rows, banner.length);
  // Two border columns and one column of padding on each side.
  const width = Math.max(20, columns - 4);
  const lines = useMemo(() => toViewportLines(blocks, width), [blocks, width]);
  const shown = visibleLines(lines, offset, height);
  const status = scrollStatus(lines.length, offset, height);

  const parts = [
    busy ? `${spinner} working` : null,
    status.total === 0 ? "empty" : `lines ${status.first}–${status.last} of ${status.total}`,
    status.following ? null : `${theme.symbols.warn} scrolled back`,
    // The key hints are the first thing to go when the terminal is narrow.
    columns >= 72 ? "wheel or pgup/pgdn scrolls" : null,
    columns >= 72 ? "/clear empties" : null,
  ].filter((part): part is string => part !== null);
  const statusLine = parts.join(`  ${theme.symbols.bullet}  `);

  const append = useCallback((next: ShellBlock[]) => {
    if (next.length === 0) return;
    setBlocks((prev) => [...prev, ...next]);
    // New output pulls the viewport back to the tail, so nothing is missed.
    setOffset(null);
  }, []);

  const onSubmit = useCallback(
    (line: string) => {
      if (line.trim() === "") return;
      append([{ kind: "input", text: `${theme.symbols.cursor} ${line.trim()}` }]);
      setBusy(true);
      pending.current += 1;
      // Chained rather than fired in parallel, so a line submitted while another
      // command is still running cannot interleave its output.
      queue.current = queue.current
        // A long command publishes blocks as it goes, so the transcript grows
        // while it runs instead of staying empty until it returns.
        .then(() => dispatch(session, line, (block) => append([block])))
        .then((result) => {
          // Clears the transcript only; the header above the viewport stays.
          if (result.effect === "clear") {
            setBlocks([]);
            setOffset(null);
          }
          append(result.blocks);
          if (result.effect === "exit") exit();
        })
        .finally(() => {
          pending.current -= 1;
          if (pending.current === 0) setBusy(false);
        });
    },
    [append, exit, session, theme],
  );

  const scrollBy = useCallback(
    (delta: number) => {
      setOffset((current) => {
        const bottom = maxOffset(lines.length, height);
        const clamped = clampOffset((current ?? bottom) + delta, lines.length, height);
        // Landing back at the bottom resumes following, so later output appears.
        return clamped >= bottom ? null : clamped;
      });
    },
    [height, lines.length],
  );

  // Scrolling is handled here rather than in the prompt: these keys move the
  // viewport, never the input line.
  useInput((_input, key) => {
    if (!key.pageUp && !key.pageDown) return;
    const page = Math.max(1, height - 1);
    scrollBy(key.pageUp ? -page : page);
  });

  // Terminals report the wheel only when asked to. Tracking is turned off again
  // on unmount so the terminal gets its mouse back — see also runShell, which
  // repeats the reset in case the shell exits without unmounting cleanly.
  useEffect(() => {
    stdout.write(MOUSE_ENABLE);
    return () => {
      stdout.write(MOUSE_DISABLE);
    };
  }, [stdout]);

  // Notches arrive from the stdin filter in runShell, which removes them before
  // Ink's key parser can shred them into fragments.
  useEffect(
    () => onWheel((direction) => scrollBy(direction === "up" ? -WHEEL_LINES : WHEEL_LINES)),
    [onWheel, scrollBy],
  );

  return (
    <Box flexDirection="column">
      {banner.map((row) => (
        // Keyed by content: every header row is distinct, and the header is
        // rebuilt wholesale on resize rather than reordered.
        <Text key={rowText(row)} wrap="truncate">
          {row.map((segment, index) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional runs
              key={`${index}-${segment.shade}`}
              color={tint(theme, shadeColor(theme, segment.shade))}
              dimColor={segment.shade !== "lit"}
            >
              {segment.text}
            </Text>
          ))}
        </Text>
      ))}

      <Box
        borderStyle="round"
        borderColor={tint(theme, theme.colors.chrome)}
        flexDirection="column"
        paddingX={1}
        height={height + 2}
      >
        {shown.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional by nature
          <Text key={`${index}-${line.text}`} color={colorFor(theme, line.kind)} wrap="truncate">
            {line.text === "" ? " " : line.text}
          </Text>
        ))}
      </Box>

      {/* Truncated, never wrapped: a second row here would push the prompt off
          the bottom of the terminal and break the CHROME_ROWS budget. */}
      <Text color={tint(theme, theme.colors.muted)} wrap="truncate">
        {statusLine}
      </Text>

      <Prompt theme={theme} busy={busy} onSubmit={onSubmit} onExit={exit} />
    </Box>
  );
}
