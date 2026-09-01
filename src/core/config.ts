import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolvePaths } from "./paths.ts";

export const ConfigSchema = z.object({
  schemaVersion: z.literal("1"),
  project: z.string().min(1),
  engine: z.enum(["opencode", "mock"]),
  /** Provider for AISET's own small model calls — never a second agent runtime. */
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1),
  createdAt: z.string(),
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
  };
}

export async function readConfig(root = process.cwd()): Promise<Config | null> {
  const { configPath } = resolvePaths(root);
  if (!existsSync(configPath)) return null;
  return ConfigSchema.parse(JSON.parse(await Bun.file(configPath).text()));
}

/** Writes config.json only when absent. Returns false if one already existed. */
export async function writeConfigIfAbsent(config: Config, root = process.cwd()): Promise<boolean> {
  const { stateDir, configPath } = resolvePaths(root);
  await mkdir(stateDir, { recursive: true });
  if (existsSync(configPath)) return false;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}
