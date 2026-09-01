import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrame } from "../../src/opencode/client.ts";
import type { OpenCodeEvent } from "../../src/opencode/types.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/opencode-events.ndjson");

/**
 * A real `opencode serve` transcript, recorded from a run where the `build`
 * agent delegated to the `explore` subagent and then wrote two files. Nothing
 * in the test suite ever starts OpenCode; this transcript is the contract.
 */
export const ROOT_SESSION = "ses_fa3a64427ffe7RjIotVYsrQ1yy";
export const CHILD_SESSION = "ses_fa3a636a4ffetjAzgw23fmTqoA";

export function fixtureEvents(): OpenCodeEvent[] {
  return readFileSync(FIXTURE, "utf8")
    .trim()
    .split("\n")
    .map((line) => parseFrame(line))
    .filter((e): e is OpenCodeEvent => e !== null);
}
