import { join, resolve } from "node:path";

/** Everything AISET writes at runtime lives under `.aiset/` (gitignored). */
export interface Paths {
  root: string;
  stateDir: string;
  dbPath: string;
  configPath: string;
  logsDir: string;
}

export function resolvePaths(root = process.cwd(), dbOverride?: string): Paths {
  const stateDir = join(resolve(root), ".aiset");
  return {
    root: resolve(root),
    stateDir,
    dbPath: dbOverride ? resolve(dbOverride) : join(stateDir, "aiset.db"),
    configPath: join(stateDir, "config.json"),
    logsDir: join(stateDir, "logs"),
  };
}
