import { ulid } from "ulid";

/** Runs are stored by bare ULID and displayed with an `r_` prefix. */
export function newRunId(): string {
  return ulid();
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
