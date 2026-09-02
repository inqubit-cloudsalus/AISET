/**
 * Who is driving a run, and whether they are still alive.
 *
 * A run's status alone cannot answer that: a run whose process was killed and
 * one that is working hard both read `running`. So the owner stamps itself on
 * the row and beats a heartbeat while it pumps, and a run with a stale beat and
 * no live owner is one nobody is coming back for.
 *
 * Pure except for the clock and `process.kill(pid, 0)`; it never talks to
 * OpenCode and never decides what to do about an orphan — that is `recover.ts`.
 */
import { hostname } from "node:os";
import { ulid } from "ulid";
import type { Db } from "../db/client.ts";
import { claimRun, heartbeat } from "../db/repositories/runs.ts";
import { type Run, TERMINAL_STATUSES } from "../db/types.ts";

/** How often an owner refreshes its heartbeat. */
export const HEARTBEAT_MS = 5_000;

/**
 * How old a heartbeat may be before its run is considered abandoned. Six beats:
 * long enough that a busy or briefly blocked owner is never mistaken for a dead
 * one, short enough that a crash is noticed within one restart.
 */
export const STALE_MS = 30_000;

let nonce: string | null = null;

/**
 * This process's identity, minted once.
 *
 * A pid is not enough on its own — the operating system reuses them, and a new
 * AISET could be handed the pid of the one that just died.
 */
export function processNonce(): string {
  nonce ??= ulid();
  return nonce;
}

/** Claims a run for this process, recording the engine it is talking to. */
export function claim(db: Db, runId: string, serverUrl: string | null): void {
  claimRun(db, runId, {
    pid: process.pid,
    host: hostname(),
    nonce: processNonce(),
    serverUrl,
  });
}

export function beat(db: Db, runId: string): void {
  heartbeat(db, runId);
}

export interface OrphanOptions {
  now?: number;
  /** Runs this process is pumping right now; never orphans, whatever the clock says. */
  local?: ReadonlySet<string>;
}

/** True when a pid is gone. An EPERM means it exists but is not ours to signal. */
function pidIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "EPERM";
  }
}

export function heartbeatAgeMs(run: Run, now = Date.now()): number | null {
  if (run.heartbeat_at === null) return null;
  return now - new Date(run.heartbeat_at).getTime();
}

/**
 * Whether a run has been left behind.
 *
 * The bar is deliberately high: a run we are pumping, or one whose owner beat
 * recently, is never an orphan. Two AISET processes can therefore work side by
 * side without either stealing the other's runs. A dead pid on this host is the
 * one shortcut — there is nothing left to wait for.
 */
export function isOrphaned(run: Run, opts: OrphanOptions = {}): boolean {
  if (TERMINAL_STATUSES.has(run.status)) return false;
  if (opts.local?.has(run.id)) return false;

  const age = heartbeatAgeMs(run, opts.now ?? Date.now());
  // No heartbeat at all: either the owner died before its first beat, or the row
  // predates recovery. Both are ours to close.
  if (age === null) return true;
  if (age > STALE_MS) return true;

  const sameHost = run.owner_host !== null && run.owner_host === hostname();
  const ourNonce = run.owner_nonce === processNonce();
  return sameHost && !ourNonce && run.owner_pid !== null && pidIsDead(run.owner_pid);
}

/** One line for the owner, or null when nothing ever claimed the run. */
export function describeOwner(run: Run, now = Date.now()): string | null {
  if (run.owner_pid === null && run.heartbeat_at === null) return null;
  const age = heartbeatAgeMs(run, now);
  const beatText = age === null ? "never beat" : `last beat ${Math.round(age / 1000)}s ago`;
  const who = run.owner_pid === null ? "unknown owner" : `pid ${run.owner_pid}`;
  return `${who}${run.owner_host ? ` @${run.owner_host}` : ""} (${beatText})`;
}
