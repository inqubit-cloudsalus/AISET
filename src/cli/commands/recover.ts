import { displayRunId, normalizeRunId } from "../../core/ids.ts";
import { type Recovered, recover } from "../../opencode/recover.ts";
import type { RecoverEntryModel, RecoverModel } from "../../ui/models.ts";
import { plainRecover } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import type { StatusTone } from "../../ui/theme.ts";
import { type Context, requireDb } from "../context.ts";

export interface RecoverCliOptions {
  id?: string;
  dryRun?: boolean;
}

function toneFor(action: Recovered["action"]): StatusTone {
  if (action === "reattached") return "ok";
  return action === "closed" ? "warn" : "pending";
}

export function toRecoverModel(results: Recovered[], dryRun: boolean): RecoverModel {
  const entries: RecoverEntryModel[] = results.map((r) => ({
    displayId: displayRunId(r.runId),
    action: r.action,
    tone: toneFor(r.action),
    reason: r.reason,
  }));
  return { entries, dryRun };
}

/**
 * Finds runs whose process died and either resumes or closes them.
 *
 * The database is the only source: a run is recoverable because its owner
 * stopped beating, not because anyone told us the process is gone.
 *
 * A re-attached run is awaited to its end. This command *is* the run's new
 * owner — returning early would kill the session it just adopted, which is the
 * very thing it was called to prevent. `--dry-run` is how to look without
 * committing to that.
 */
export async function runRecover(ctx: Context, opts: RecoverCliOptions): Promise<number> {
  const db = requireDb(ctx);
  let results: Recovered[];
  try {
    results = await recover(db, opts.id ? normalizeRunId(opts.id) : undefined, {
      dryRun: opts.dryRun ?? false,
    });
    await Promise.all(results.map((r) => r.finished?.catch(() => {})));
  } finally {
    db.close();
  }

  const model = toRecoverModel(results, opts.dryRun ?? false);
  await renderView(
    {
      json: () => model,
      plain: (theme) => plainRecover(model, theme),
    },
    ctx,
  );
  return 0;
}
