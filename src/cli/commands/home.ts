import { createElement } from "react";
import { openDb } from "../../db/client.ts";
import { isCurrent } from "../../db/migrate.ts";
import { countByStatus, countRuns, listRuns } from "../../db/repositories/runs.ts";
import { toRunRow } from "../../ui/mappers.ts";
import type { HomeModel } from "../../ui/models.ts";
import { plainHome } from "../../ui/plain.ts";
import { renderView } from "../../ui/render.tsx";
import { type Context, dbExists } from "../context.ts";
import { VERSION } from "../version.ts";

/** The bare `aiset` view. Works before `init`, reporting that the DB is missing. */
export async function runHome(ctx: Context): Promise<number> {
  const exists = dbExists(ctx);
  let model: HomeModel = {
    version: VERSION,
    dbPath: ctx.paths.dbPath,
    dbExists: exists,
    initialized: false,
    totalRuns: 0,
    countsByStatus: {},
    recentRuns: [],
  };

  if (exists) {
    const db = openDb(ctx.paths.dbPath, { create: false });
    if (isCurrent(db)) {
      model = {
        ...model,
        initialized: true,
        totalRuns: countRuns(db),
        countsByStatus: countByStatus(db),
        recentRuns: listRuns(db, { limit: 5 }).map(toRunRow),
      };
    }
    db.close();
  }

  await renderView(
    {
      json: () => model,
      plain: (theme) => plainHome(model, theme),
      ink: async (theme) => {
        const { HomeView } = await import("../../ui/views/HomeView.tsx");
        return createElement(HomeView, { model, theme });
      },
    },
    ctx,
  );
  return 0;
}
