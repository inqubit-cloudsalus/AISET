import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { AisetError } from "./errors.ts";
import { resolvePaths } from "./paths.ts";

export const ConfigSchema = z.object({
  schemaVersion: z.literal("1"),
  project: z.string().min(1),
  engine: z.enum(["opencode", "mock"]),
  /** Provider for AISET's own small model calls — never a second agent runtime. */
  provider: z.enum(["anthropic", "openai", "openrouter"]),
  model: z.string().min(1),
  createdAt: z.string(),
  /** How the adapter reaches OpenCode. Optional so older config.json files still parse. */
  opencode: z
    .object({
      bin: z.string().min(1).default("opencode"),
      hostname: z.string().min(1).default("127.0.0.1"),
      /** 0 = let OpenCode pick a free port. */
      port: z.number().int().min(0).max(65535).default(0),
      /** Primary agent for a run; OpenCode's own default when unset. */
      agent: z.string().min(1).optional(),
      /** "provider/model"; OpenCode's configured default when unset. */
      model: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive().default(600_000),
    })
    .default(() => ({ bin: "opencode", hostname: "127.0.0.1", port: 0, timeoutMs: 600_000 })),
});
export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(project: string): Config {
  return {
    schemaVersion: "1",
    project,
    engine: "opencode",
    provider: "anthropic",
    model: "claude-sonnet-5",
    createdAt: new Date().toISOString(),
    opencode: { bin: "opencode", hostname: "127.0.0.1", port: 0, timeoutMs: 600_000 },
  };
}

export async function readConfig(root = process.cwd()): Promise<Config | null> {
  const { configPath } = resolvePaths(root);
  if (!existsSync(configPath)) return null;
  return ConfigSchema.parse(JSON.parse(await Bun.file(configPath).text()));
}

/** Writes config.json, creating `.aiset/` when needed. Overwrites an existing file. */
export async function writeConfig(config: Config, root = process.cwd()): Promise<void> {
  const { stateDir, configPath } = resolvePaths(root);
  await mkdir(stateDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Writes config.json only when absent. Returns false if one already existed. */
export async function writeConfigIfAbsent(config: Config, root = process.cwd()): Promise<boolean> {
  const { configPath } = resolvePaths(root);
  if (existsSync(configPath)) return false;
  await writeConfig(config, root);
  return true;
}

/**
 * Reads, mutates and re-validates config.json in place. The mutated value goes
 * back through `ConfigSchema`, so a bad edit fails here rather than at the next
 * read. Returns the config as written.
 */
export async function updateConfig(
  mutate: (config: Config) => Config,
  root = process.cwd(),
): Promise<Config> {
  const current = await readConfig(root);
  if (!current) {
    throw new AisetError(
      "no .aiset/config.json in this directory",
      "run `aiset init` before changing configuration",
    );
  }
  const next = ConfigSchema.parse(mutate(current));
  await writeConfig(next, root);
  return next;
}
