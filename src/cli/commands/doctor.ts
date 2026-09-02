import { accessSync, constants, existsSync } from "node:fs";
import { createElement } from "react";
import { hasCredentials, PROVIDER_ENV } from "../../ai/provider.ts";
import { readConfig } from "../../core/config.ts";
import { openDb } from "../../db/client.ts";
import { isCurrent, migrationStatus } from "../../db/migrate.ts";
import { orphanNotice } from "../../opencode/recover.ts";
import type { CheckResult, DoctorModel } from "../../ui/models.ts";
import { plainDoctor } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import type { Context } from "../context.ts";

function pass(name: string, detail: string): CheckResult {
  return { name, tone: "ok", detail, ok: true };
}
function warn(name: string, detail: string): CheckResult {
  return { name, tone: "warn", detail, ok: true };
}
function fail(name: string, detail: string): CheckResult {
  return { name, tone: "fail", detail, ok: false };
}

async function commandVersion(command: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "ignore" });
    const out = (await new Response(proc.stdout).text()).trim();
    const code = await proc.exited;
    return code === 0 ? out.split("\n")[0]!.trim() : null;
  } catch {
    return null;
  }
}

export async function collectChecks(ctx: Context): Promise<DoctorModel> {
  const checks: CheckResult[] = [];

  checks.push(pass("bun", `v${Bun.version}`));

  // Database + migrations
  if (!existsSync(ctx.paths.dbPath)) {
    checks.push(fail("database", `missing: ${ctx.paths.dbPath} — run 'aiset init'`));
  } else {
    try {
      const db = openDb(ctx.paths.dbPath, { create: false });
      const status = migrationStatus(db);
      const applied = status.filter((s) => s.applied).length;
      checks.push(
        isCurrent(db)
          ? pass("database", `${ctx.paths.dbPath} (${applied}/${status.length} migrations)`)
          : fail(
              "database",
              `schema behind (${applied}/${status.length}) — run 'aiset db migrate'`,
            ),
      );
      // Runs left behind by a process that died. Reported, never acted on: a
      // check may not change the thing it is checking.
      const orphans = orphanNotice(db);
      checks.push(orphans ? warn("open runs", orphans) : pass("open runs", "none abandoned"));
      db.close();
    } catch (err) {
      checks.push(fail("database", `unreadable: ${(err as Error).message}`));
    }
  }

  // Write access to .aiset/
  try {
    accessSync(ctx.paths.stateDir, constants.W_OK);
    checks.push(pass("state dir writable", ctx.paths.stateDir));
  } catch {
    checks.push(fail("state dir writable", `cannot write to ${ctx.paths.stateDir}`));
  }

  // OpenCode — the execution engine for agent runs
  const opencode = await commandVersion("opencode");
  checks.push(
    opencode
      ? pass("opencode", opencode)
      : fail("opencode", "not found on PATH — the run engine is unavailable"),
  );

  // Provider key: presence only. The value is never read into the output.
  const config = await readConfig(ctx.paths.root).catch(() => null);
  const provider = config?.provider ?? "anthropic";
  const envVar = PROVIDER_ENV[provider];
  const present = hasCredentials(provider);
  checks.push(
    present
      ? pass("provider key", `${envVar} present`)
      : warn("provider key", `${envVar} not set — AISET's own model calls are disabled`),
  );

  return { checks, ok: checks.every((c) => c.ok) };
}

export async function runDoctor(ctx: Context): Promise<number> {
  const model = await collectChecks(ctx);
  await renderView(
    {
      json: () => model,
      plain: (theme) => plainDoctor(model, theme),
      ink: async (theme) => {
        const { DoctorView } = await import("../../ui/views/DoctorView.tsx");
        return createElement(DoctorView, { model, theme });
      },
    },
    ctx,
  );
  return model.ok ? 0 : 1;
}
