import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveOutputMode } from "../../src/ui/render.tsx";
import { formatDuration, formatTimestamp, makeTheme, toneForStatus } from "../../src/ui/theme.ts";

const originalNoColor = process.env.NO_COLOR;
const originalIsTty = process.stdout.isTTY;

function setTty(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

beforeEach(() => {
  process.env.NO_COLOR = undefined as unknown as string;
  delete process.env.NO_COLOR;
});

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
  setTty(originalIsTty as boolean);
});

describe("output mode", () => {
  test("--json wins over everything, including a TTY", () => {
    setTty(true);
    expect(resolveOutputMode({ json: true })).toBe("json");
  });

  test("a non-TTY never mounts Ink", () => {
    setTty(false);
    expect(resolveOutputMode({})).toBe("plain");
  });

  test("NO_COLOR forces plain text even on a TTY", () => {
    setTty(true);
    process.env.NO_COLOR = "1";
    expect(resolveOutputMode({})).toBe("plain");
  });

  test("--no-color forces plain text even on a TTY", () => {
    setTty(true);
    expect(resolveOutputMode({ color: false })).toBe("plain");
  });

  test("an interactive terminal gets the TUI", () => {
    setTty(true);
    expect(resolveOutputMode({})).toBe("tty");
  });
});

describe("theme", () => {
  test("NO_COLOR disables colour", () => {
    process.env.NO_COLOR = "1";
    expect(makeTheme().useColor).toBe(false);
  });

  test("an empty NO_COLOR is not set, per the convention", () => {
    process.env.NO_COLOR = "";
    expect(makeTheme().useColor).toBe(true);
  });

  test("maps statuses to tones", () => {
    expect(toneForStatus("succeeded")).toBe("ok");
    expect(toneForStatus("running")).toBe("warn");
    expect(toneForStatus("timeout")).toBe("fail");
    expect(toneForStatus("killed")).toBe("fail");
    expect(toneForStatus("pending")).toBe("pending");
  });

  test("formats durations and timestamps deterministically", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(2100)).toBe("2.1s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatTimestamp("2026-09-01T06:22:17.123Z")).toBe("2026-09-01 06:22:17");
  });
});
