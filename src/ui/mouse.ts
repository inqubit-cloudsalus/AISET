/**
 * Mouse-wheel scrolling for the shell viewport.
 *
 * Terminals do not report the wheel unless asked. Enabling tracking takes the
 * mouse away from the terminal for as long as AISET runs — drag-to-select needs
 * Shift while it is on — so the escape sequences are written on mount and
 * unconditionally undone on the way out, including when the shell crashes.
 *
 * Everything here is a pure string function plus two constants, so the parsing
 * is testable without a terminal.
 */

import { PassThrough } from "node:stream";

const ESC = String.fromCharCode(27);

/** `?1000` reports button presses (the wheel included), `?1006` the SGR encoding. */
export const MOUSE_ENABLE = `${ESC}[?1000h${ESC}[?1006h`;
export const MOUSE_DISABLE = `${ESC}[?1006l${ESC}[?1000l`;

/** SGR: `ESC [ < button ; column ; row (M|m)`. The modern, unambiguous encoding. */
const SGR = new RegExp(`${ESC}\\[<(\\d+);\\d+;\\d+([Mm])`, "g");
/** X10: `ESC [ M` then three raw bytes. Only matched so it can be discarded. */
const X10 = new RegExp(`${ESC}\\[M[\\s\\S]{3}`, "g");

export type WheelDirection = "up" | "down";

/**
 * The wheel notches in a chunk of stdin, in order.
 *
 * Bit 6 of the button marks a wheel event; bit 0 then gives the direction, so
 * 64 is up and 65 is down. Modifier bits (shift/meta/ctrl) ride in the same
 * number and are ignored — a wheel turn scrolls whatever else is held down.
 */
export function parseWheel(data: string): WheelDirection[] {
  const out: WheelDirection[] = [];
  for (const match of data.matchAll(SGR)) {
    // Only presses carry wheel notches; the release report is a duplicate.
    if (match[2] !== "M") continue;
    const button = Number.parseInt(match[1]!, 10);
    if ((button & 0x40) === 0) continue;
    out.push((button & 0x01) === 0 ? "up" : "down");
  }
  return out;
}

/**
 * Removes mouse reports from a complete chunk.
 *
 * Ink's key parser has no idea what these are and would hand the payload to the
 * prompt as literal text, so `/db-status` would come out as `/db-st<64;20;5Matus`.
 */
export function stripMouseSequences(input: string): string {
  return input.replace(SGR, "").replace(X10, "");
}

/** Lines moved per wheel notch — the common terminal convention. */
export const WHEEL_LINES = 3;

/**
 * A tail that might still grow into a mouse report once more bytes arrive.
 *
 * Terminals do not promise to deliver an escape sequence in one read, so
 * `ESC [ <64;37;2` can be all that has landed so far. Holding it back is what
 * stops half a report reaching the prompt as text.
 */
const PARTIAL = new RegExp(`${ESC}(\\[(<[\\d;]*|M[\\s\\S]{0,2})?)?$`);

export interface SplitInput {
  /** Keystrokes to pass on. */
  text: string;
  /** Wheel notches found, in order. */
  wheel: WheelDirection[];
  /** An incomplete tail to prepend to the next chunk. */
  rest: string;
}

/**
 * Separates mouse reports from keystrokes, keeping any incomplete trailing
 * sequence for the next chunk. Pure, so the fragmentation cases are testable
 * without a terminal.
 */
export function splitMouseInput(input: string): SplitInput {
  const partial = input.match(PARTIAL);
  const rest = partial ? partial[0] : "";
  const complete = rest ? input.slice(0, -rest.length) : input;
  return { text: stripMouseSequences(complete), wheel: parseWheel(complete), rest };
}

/**
 * Bytes held back waiting for the rest of a sequence are released after this,
 * so a lone Escape keypress is not swallowed until the next keystroke.
 */
const FLUSH_MS = 20;

export interface MouseInput {
  /** Hand this to Ink in place of the real stdin. */
  stdin: NodeJS.ReadStream;
  onWheel(listener: (direction: WheelDirection) => void): () => void;
  dispose(): void;
}

/**
 * Wraps stdin so mouse reports never reach Ink.
 *
 * Ink's parser splits an escape sequence into several input events, so a report
 * cannot be recognised once it is inside the key handler — the fragments arrive
 * one at a time. Filtering has to happen upstream, on the raw stream, which is
 * what this does: wheel notches are pulled out here and only real keystrokes are
 * forwarded to the terminal Ink reads from.
 */
export function createMouseInput(source: NodeJS.ReadStream): MouseInput {
  const proxy = new PassThrough();
  const listeners = new Set<(direction: WheelDirection) => void>();
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (pending === "") return;
    proxy.write(pending);
    pending = "";
  };

  const onData = (chunk: Buffer | string) => {
    if (timer) clearTimeout(timer);
    const { text, wheel, rest } = splitMouseInput(pending + String(chunk));
    pending = rest;
    if (text !== "") proxy.write(text);
    for (const direction of wheel) {
      for (const listener of listeners) listener(direction);
    }
    if (pending !== "") timer = setTimeout(flush, FLUSH_MS);
  };

  source.on("data", onData);

  // Ink drives raw mode and the event loop through the stream it is given, so
  // those calls are forwarded to the real terminal.
  Object.assign(proxy, {
    isTTY: source.isTTY,
    setRawMode: (mode: boolean) => source.setRawMode?.(mode),
    ref: () => source.ref(),
    unref: () => source.unref(),
  });

  return {
    stdin: proxy as unknown as NodeJS.ReadStream,
    onWheel(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      source.off("data", onData);
      listeners.clear();
    },
  };
}
