import { z } from "zod";
import type { ArtifactKind, EventType } from "../db/types.ts";

/**
 * OpenCode's `GET /event` stream, parsed permissively.
 *
 * The contract this is written against is `docs/opencode-api-1.18.25.json` (the
 * server's own `/doc`). Only the fields the mapper reads are typed; everything
 * else rides along in `properties` untouched, so a newer OpenCode adding fields
 * or event types degrades to "unmapped" instead of throwing.
 */
export const OpenCodeEventSchema = z.object({
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type OpenCodeEvent = z.infer<typeof OpenCodeEventSchema>;

/** An event row the adapter is ready to hand to `appendEvent`. */
export interface MappedEvent {
  type: EventType;
  level: "info" | "warn" | "error";
  message: string;
  agent: string | null;
  data: Record<string, unknown>;
}

export interface MappedArtifact {
  kind: ArtifactKind;
  path: string;
}

export interface MappedUsage {
  /** The assistant message it was reported on, so it is counted exactly once. */
  messageId: string;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Everything one OpenCode event contributes. Usually empty or a single event. */
export interface Mapped {
  events: MappedEvent[];
  artifacts: MappedArtifact[];
  usage: MappedUsage[];
  /** Set when this event ends the run: the root session went idle or errored. */
  terminal: "succeeded" | "failed" | null;
}

export const EMPTY: Mapped = { events: [], artifacts: [], usage: [], terminal: null };

export interface StartTask {
  /** The prompt handed to OpenCode. */
  prompt: string;
  /** Human title for the run; defaults to a truncation of the prompt. */
  title?: string;
  /** External task reference, e.g. "T-001". */
  taskId?: string | null;
  /** Primary OpenCode agent, e.g. "build". */
  agent?: string;
  /** "provider/model", e.g. "opencode/big-pickle". */
  model?: string | null;
  /** Directory OpenCode runs in. Defaults to the process cwd. */
  workdir?: string;
  /** Chosen by the caller when the run's id must be known before it starts. */
  runId?: string;
  /** Links a recovery re-run back to the run it replaces. */
  parentRunId?: string | null;
}
