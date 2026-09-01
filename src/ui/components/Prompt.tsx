import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  initialPromptState,
  type PromptState,
  promptCompletions,
  reducePrompt,
} from "../../shell/prompt-state.ts";
import type { Theme } from "../theme.ts";

interface PromptProps {
  theme: Theme;
  /** A command is in flight — dims the prompt; editing stays available. */
  busy: boolean;
  onSubmit: (line: string) => void;
  onExit: () => void;
}

function tint(theme: Theme, color: string): string | undefined {
  return theme.useColor ? color : undefined;
}

/**
 * The input line, built on Ink's `useInput` — no third-party input widget, so
 * the completion menu and history behave exactly as the registry describes.
 */
export function Prompt({ theme, busy, onSubmit, onExit }: PromptProps) {
  const [state, setState] = useState<PromptState>(initialPromptState);
  // Two consecutive ctrl+c exit; a single one clears the line, as in a real shell.
  const [armedToExit, setArmedToExit] = useState(false);

  // Input stays live while a command runs: keystrokes are never dropped, and the
  // view serialises the submitted lines behind whatever is in flight.
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (state.buffer === "" && armedToExit) return onExit();
      setArmedToExit(state.buffer === "");
      return setState(reducePrompt(state, { type: "clearLine" }));
    }
    setArmedToExit(false);

    if (key.ctrl && input === "d") {
      if (state.buffer === "") return onExit();
      return setState(reducePrompt(state, { type: "delete" }));
    }

    // A chunk can carry newlines of its own — a paste, or a terminal that batches
    // the text and the carriage return together — so submission is driven by the
    // newlines in the input, not by `key.return` alone.
    const newline = /\r\n|\r|\n/;
    if (key.return || newline.test(input)) {
      const parts = newline.test(input) ? input.split(newline) : ["", ""];
      const lines: string[] = [];
      let next = state;
      for (const [index, part] of parts.entries()) {
        if (part) next = reducePrompt(next, { type: "insert", text: part });
        // Everything before the final part completed a line; the tail stays typed.
        if (index < parts.length - 1) {
          lines.push(next.buffer);
          next = reducePrompt(next, { type: "submit" });
        }
      }
      setState(next);
      for (const line of lines) onSubmit(line);
      return;
    }
    // Some terminals deliver a bare tab character without setting `key.tab`.
    if (key.tab || input === "\t") return setState(reducePrompt(state, { type: "complete" }));
    if (key.backspace) return setState(reducePrompt(state, { type: "backspace" }));
    if (key.delete) return setState(reducePrompt(state, { type: "delete" }));
    if (key.leftArrow) return setState(reducePrompt(state, { type: "left" }));
    if (key.rightArrow) return setState(reducePrompt(state, { type: "right" }));
    // pageUp/pageDown scroll the viewport, which ShellView owns — ignored here.
    if (key.pageUp || key.pageDown) return;
    if (key.home) return setState(reducePrompt(state, { type: "home" }));
    if (key.end) return setState(reducePrompt(state, { type: "end" }));
    if (key.upArrow) return setState(reducePrompt(state, { type: "historyUp" }));
    if (key.downArrow) return setState(reducePrompt(state, { type: "historyDown" }));
    if (key.ctrl && input === "a") return setState(reducePrompt(state, { type: "home" }));
    if (key.ctrl && input === "e") return setState(reducePrompt(state, { type: "end" }));
    if (key.ctrl && input === "u") return setState(reducePrompt(state, { type: "clearLine" }));

    // Everything else is literal text; escape sequences arrive with `key` flags set.
    // Control characters are dropped rather than typed: a stray one in
    // the buffer would corrupt the line and the command parsed from it. Mouse
    // reports never reach here — runShell strips them from stdin upstream.
    const text = input.replace(/\p{Cc}/gu, "");
    if (text && !key.ctrl && !key.meta && !key.escape) {
      setState(reducePrompt(state, { type: "insert", text }));
    }
  });

  const before = state.buffer.slice(0, state.cursor);
  const at = state.buffer.slice(state.cursor, state.cursor + 1) || " ";
  const after = state.buffer.slice(state.cursor + 1);
  const menu = promptCompletions(state);

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="round"
        borderColor={tint(theme, busy ? theme.colors.muted : theme.colors.accent)}
        paddingX={1}
      >
        <Text color={tint(theme, theme.colors.accent)}>{theme.symbols.cursor} </Text>
        <Text>
          {before}
          <Text inverse={!busy}>{at}</Text>
          {after}
        </Text>
      </Box>
      {menu.length > 1 ? (
        <Text color={tint(theme, theme.colors.muted)}>
          {"  "}
          {menu.join("  ")}
        </Text>
      ) : null}
      {armedToExit ? (
        <Text color={tint(theme, theme.colors.muted)}>{"  "}press ctrl+c again to exit</Text>
      ) : null}
    </Box>
  );
}
