import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolvePaths } from "./paths.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Append-only JSONL session log. One file per UTC day under `.aiset/logs/`. */
export async function log(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
  root = process.cwd(),
): Promise<void> {
  const { logsDir } = resolvePaths(root);
  await mkdir(logsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  await appendFile(join(logsDir, `${day}.jsonl`), `${line}\n`, "utf8");
}
