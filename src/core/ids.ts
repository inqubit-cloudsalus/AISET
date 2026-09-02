import { monotonicFactory, ulid } from "ulid";

/** Runs are stored by bare ULID and displayed with an `r_` prefix. */
export function newRunId(): string {
  return ulid();
}

/**
 * Ids for runs launched together, in launch order.
 *
 * Plain ULIDs minted in the same millisecond sort arbitrarily, which would make
 * a team of agents come back from the database in a different order every time.
 * The monotonic factory guarantees the ids ascend, so id order is launch order.
 */
export function newRunIds(count: number): string[] {
  const next = monotonicFactory();
  const now = Date.now();
  return Array.from({ length: count }, () => next(now));
}

export function displayRunId(id: string): string {
  return id.startsWith("r_") ? id : `r_${id}`;
}

/** Accepts `r_<ulid>` or a bare ULID, returning the stored form. */
export function normalizeRunId(id: string): string {
  return id.startsWith("r_") ? id.slice(2) : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}
