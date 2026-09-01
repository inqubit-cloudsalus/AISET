import type { Context } from "../cli/context.ts";
import type { Db } from "../db/client.ts";
import type { Theme } from "../ui/theme.ts";

/**
 * One shell session: a single long-lived database handle plus the resolved
 * theme. Unlike the one-shot commands, the handle is opened once on mount and
 * closed on exit — the shell is the only long-running process in AISET.
 */
export interface Session {
  ctx: Context;
  db: Db;
  theme: Theme;
  version: string;
}

/** A committed line-block in the transcript. `text` is already rendered plain text. */
export interface ShellBlock {
  kind: "input" | "output" | "error";
  text: string;
}

/** What dispatching a line asks the view to do beyond appending blocks. */
export type ShellEffect = "none" | "clear" | "exit";

export interface ShellResult {
  blocks: ShellBlock[];
  effect: ShellEffect;
}

export interface SlashCommand {
  name: string;
  summary: string;
  usage?: string;
  /**
   * Returns already-rendered plain text. Commands never touch React, which is
   * what makes every one of them unit-testable without mounting Ink.
   */
  run(session: Session, args: string[]): ShellResult | Promise<ShellResult>;
}
