import { type OpenCodeServer, type StartServerOptions, startServer } from "./server.ts";

/**
 * A borrowed OpenCode server. `release` is the caller's half of the refcount:
 * the process stops once every lease on it has been released.
 */
export interface ServerLease {
  url: string;
  stderr(): string;
  release(): Promise<void>;
}

export interface PoolOptions {
  /** Injected in tests so no OpenCode process is ever spawned. */
  startFn?: (opts: StartServerOptions) => Promise<OpenCodeServer>;
}

interface Entry {
  server: Promise<OpenCodeServer>;
  refs: number;
}

/**
 * Servers borrowed by this process, keyed by what makes two of them the same
 * server. Two runs in the same directory with the same binary share one
 * `opencode serve`; OpenCode already keeps sessions apart, and the mapper only
 * records events for the sessions its run owns.
 */
const entries = new Map<string, Entry>();

function keyOf(opts: StartServerOptions): string {
  return `${opts.bin}|${opts.hostname}|${opts.port}|${opts.cwd}`;
}

/**
 * Borrows an OpenCode server, starting one only if this key has none.
 *
 * The in-flight promise is what is stored, not the resolved server, so N runs
 * launched at once await a single spawn rather than racing to start N servers.
 * A single sequential run behaves exactly as before: refcount 1, then 0, then
 * the same `stop()` — including the Windows listener kill.
 */
export async function lease(
  opts: StartServerOptions,
  pool: PoolOptions = {},
): Promise<ServerLease> {
  const key = keyOf(opts);
  let entry = entries.get(key);
  if (!entry) {
    entry = { server: (pool.startFn ?? startServer)(opts), refs: 0 };
    entries.set(key, entry);
  }
  entry.refs += 1;

  let server: OpenCodeServer;
  try {
    server = await entry.server;
  } catch (err) {
    // A failed start is not cached: drop it so the next caller may try again.
    release(key, entry);
    throw err;
  }

  let released = false;
  return {
    url: server.url,
    stderr: () => server.stderr(),
    async release() {
      if (released) return;
      released = true;
      await release(key, entry);
    },
  };
}

/** Drops one reference, stopping and forgetting the server at zero. */
async function release(key: string, entry: Entry): Promise<void> {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (entries.get(key) === entry) entries.delete(key);
  const server = await entry.server.catch(() => null);
  await server?.stop();
}

/** Stops every borrowed server, whatever the refcounts say. For shutdown only. */
export async function stopAll(): Promise<void> {
  const open = [...entries.values()];
  entries.clear();
  await Promise.all(
    open.map(async (entry) => {
      const server = await entry.server.catch(() => null);
      await server?.stop();
    }),
  );
}

/** How many servers this process is currently holding open. For tests. */
export function leasedServers(): number {
  return entries.size;
}
