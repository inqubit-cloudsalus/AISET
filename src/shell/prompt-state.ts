import { completions } from "./commands.ts";

/**
 * The prompt's editing model, kept pure and separate from Ink so it can be
 * tested without mounting a terminal. `Prompt.tsx` is a thin `useInput` wrapper
 * that maps key events onto these actions.
 */
export interface PromptState {
  buffer: string;
  cursor: number;
  history: string[];
  /** Index into `history` while browsing; null when editing a fresh line. */
  historyIndex: number | null;
  /** The line being edited when history browsing started, restored on the way down. */
  draft: string;
}

export type PromptAction =
  | { type: "insert"; text: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "historyUp" }
  | { type: "historyDown" }
  | { type: "complete" }
  | { type: "clearLine" }
  | { type: "submit" };

export function initialPromptState(): PromptState {
  return { buffer: "", cursor: 0, history: [], historyIndex: null, draft: "" };
}

function edited(state: PromptState, buffer: string, cursor: number): PromptState {
  return { ...state, buffer, cursor: Math.max(0, Math.min(cursor, buffer.length)) };
}

/** The longest prefix shared by every candidate — what `Tab` extends to. */
function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0]!;
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

/** Candidate completions for the current buffer; empty unless it is a lone `/word`. */
export function promptCompletions(state: PromptState): string[] {
  if (!state.buffer.startsWith("/") || /\s/.test(state.buffer)) return [];
  return completions(state.buffer);
}

export function reducePrompt(state: PromptState, action: PromptAction): PromptState {
  switch (action.type) {
    case "insert": {
      const next =
        state.buffer.slice(0, state.cursor) + action.text + state.buffer.slice(state.cursor);
      return edited(state, next, state.cursor + action.text.length);
    }
    case "backspace": {
      if (state.cursor === 0) return state;
      const next = state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor);
      return edited(state, next, state.cursor - 1);
    }
    case "delete": {
      if (state.cursor >= state.buffer.length) return state;
      const next = state.buffer.slice(0, state.cursor) + state.buffer.slice(state.cursor + 1);
      return edited(state, next, state.cursor);
    }
    case "left":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "right":
      return { ...state, cursor: Math.min(state.buffer.length, state.cursor + 1) };
    case "home":
      return { ...state, cursor: 0 };
    case "end":
      return { ...state, cursor: state.buffer.length };

    case "historyUp": {
      if (state.history.length === 0) return state;
      const index = state.historyIndex === null ? state.history.length - 1 : state.historyIndex - 1;
      if (index < 0) return state;
      const buffer = state.history[index]!;
      const draft = state.historyIndex === null ? state.buffer : state.draft;
      return { ...state, buffer, cursor: buffer.length, historyIndex: index, draft };
    }
    case "historyDown": {
      if (state.historyIndex === null) return state;
      const index = state.historyIndex + 1;
      if (index >= state.history.length) {
        return { ...state, buffer: state.draft, cursor: state.draft.length, historyIndex: null };
      }
      const buffer = state.history[index]!;
      return { ...state, buffer, cursor: buffer.length, historyIndex: index };
    }

    case "complete": {
      const candidates = promptCompletions(state);
      if (candidates.length === 0) return state;
      // A single match is completed and spaced ready for arguments; several
      // extend only as far as they agree, leaving the menu on screen.
      const next = candidates.length === 1 ? `${candidates[0]!} ` : commonPrefix(candidates);
      return edited(state, next, next.length);
    }

    case "clearLine":
      return { ...state, buffer: "", cursor: 0, historyIndex: null, draft: "" };

    case "submit": {
      const line = state.buffer.trim();
      // Consecutive duplicates are not worth a second history slot.
      const history =
        line === "" || state.history.at(-1) === line ? state.history : [...state.history, line];
      return { buffer: "", cursor: 0, history, historyIndex: null, draft: "" };
    }
  }
}
