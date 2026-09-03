import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemoRun } from "../../src/cli/commands/seed.ts";
import type { Context } from "../../src/cli/context.ts";
import { defaultConfig, readConfig, writeConfigIfAbsent } from "../../src/core/config.ts";
import { displayRunId } from "../../src/core/ids.ts";
import { resolvePaths } from "../../src/core/paths.ts";
import { createRun, getRun } from "../../src/db/repositories/runs.ts";
import {
  COMMANDS,
  dispatch,
  findCommand,
  normalizeModelId,
  parseTasks,
} from "../../src/shell/commands.ts";
import type { Session, ShellBlock } from "../../src/shell/types.ts";
import { makeTheme } from "../../src/ui/theme.ts";
import { goOffline } from "../ai/offline.ts";
import { mockModel } from "../ai/planner.test.ts";
import { freshDb } from "../db/helpers.ts";

/** ANSI escapes must never reach a shell block: every command renders plain text. */
const hasAnsi = (text: string) => text.includes(String.fromCharCode(27));

function makeSession(): Session {
  const ctx: Context = {
    paths: resolvePaths(process.cwd()),
    json: false,
    color: false,
  };
  return {
    ctx,
    db: freshDb(),
    theme: makeTheme({ color: false, unicode: true }),
    version: "0.0.0-test",
  };
}

describe("shell command registry", () => {
  test("every command has a unique name and /help lists each exactly once", async () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);

    const session = makeSession();
    const { blocks } = await dispatch(session, "/help");
    const text = blocks[0]!.text;
    for (const name of names) {
      const occurrences = text.split(`/${name}`).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(1);
    }
    session.db.close();
  });

  test("findCommand resolves registered names and nothing else", () => {
    expect(findCommand("db-status")?.name).toBe("db-status");
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("dispatch", () => {
  test("blank input is a no-op", async () => {
    const session = makeSession();
    expect(await dispatch(session, "   ")).toEqual({ blocks: [], effect: "none" });
    session.db.close();
  });

  test("bare text is a request for work, not an unknown command", async () => {
    // A model that answers with prose keeps the test off the network *and*
    // stops before anything is launched, while still proving the routing.
    const session: Session = { ...makeSession(), plannerModel: mockModel("I can help with that") };
    const { blocks } = await dispatch(session, "write me a function");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("could not plan");
    expect(blocks[0]!.text).not.toContain("not a command");
    session.db.close();
  });

  test("an unknown command suggests near matches", async () => {
    const session = makeSession();
    const { blocks } = await dispatch(session, "/ru");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("/runs");
    expect(blocks[0]!.text).toContain("/run");
    session.db.close();
  });

  test("/clear and /exit ask the view for their effect and emit nothing", async () => {
    const session = makeSession();
    expect(await dispatch(session, "/clear")).toEqual({ blocks: [], effect: "clear" });
    expect(await dispatch(session, "/exit")).toEqual({ blocks: [], effect: "exit" });
    expect(await dispatch(session, "/quit")).toEqual({ blocks: [], effect: "exit" });
    session.db.close();
  });
});

describe("/db-status", () => {
  test("reports the applied migration and zero rows on a fresh database", async () => {
    const session = makeSession();
    const text = (await dispatch(session, "/db-status")).blocks[0]!.text;
    expect(text).toContain("0001_init");
    expect(text).toContain("schema is current");
    expect(text).toContain("tables");
    expect(text).toMatch(/runs\s+0 rows/);
    expect(hasAnsi(text)).toBe(false);
    session.db.close();
  });

  test("counts the rows the demo run actually wrote", async () => {
    const session = makeSession();
    seedDemoRun(session.db);
    const text = (await dispatch(session, "/db-status")).blocks[0]!.text;
    expect(text).toMatch(/runs\s+1 rows/);
    expect(text).toMatch(/run_events\s+7 rows/);
    expect(text).toMatch(/run_artifacts\s+2 rows/);
    expect(text).toMatch(/run_usage\s+1 rows/);
    expect(text).toContain("succeeded");
    session.db.close();
  });
});

describe("/runs and /run", () => {
  test("lists a seeded run and rejects a bad status or limit", async () => {
    const session = makeSession();
    const run = seedDemoRun(session.db);

    const listed = (await dispatch(session, "/runs")).blocks[0]!;
    expect(listed.kind).toBe("output");
    expect(listed.text).toContain(displayRunId(run.id));
    expect(hasAnsi(listed.text)).toBe(false);

    expect((await dispatch(session, "/runs --status nope")).blocks[0]!.kind).toBe("error");
    expect((await dispatch(session, "/runs --limit 0")).blocks[0]!.kind).toBe("error");

    const filtered = (await dispatch(session, "/runs --status succeeded")).blocks[0]!;
    expect(filtered.text).toContain(displayRunId(run.id));
    session.db.close();
  });

  test("shows a run with its events, artifacts and usage", async () => {
    const session = makeSession();
    const run = seedDemoRun(session.db);
    const text = (await dispatch(session, `/run ${displayRunId(run.id)}`)).blocks[0]!.text;
    expect(text).toContain("events (7)");
    expect(text).toContain("run completed");
    expect(text).toContain("artifacts (2)");
    expect(text).toContain("0.0042");
    expect(hasAnsi(text)).toBe(false);
    session.db.close();
  });

  test("a missing run and a missing argument are errors, not throws", async () => {
    const session = makeSession();
    expect((await dispatch(session, "/run")).blocks[0]!.kind).toBe("error");
    const missing = (await dispatch(session, "/run r_NOSUCHRUN")).blocks[0]!;
    expect(missing.kind).toBe("error");
    expect(missing.text).toContain("no run found");
    session.db.close();
  });
});

describe("/seed", () => {
  test("requires --demo and otherwise writes one run", async () => {
    const session = makeSession();
    expect((await dispatch(session, "/seed")).blocks[0]!.kind).toBe("error");

    const seeded = (await dispatch(session, "/seed --demo")).blocks[0]!;
    expect(seeded.kind).toBe("output");
    expect(seeded.text).toContain("engine=mock");
    expect((await dispatch(session, "/db-status")).blocks[0]!.text).toMatch(/runs\s+1 rows/);
    session.db.close();
  });
});

describe("/launch", () => {
  test("is registered and does not shadow the /run viewer", () => {
    expect(findCommand("launch")).toBeDefined();
    expect(findCommand("run")?.summary).toContain("show one run");
  });

  test("a missing prompt is an error, not a launched run", async () => {
    const session = makeSession();
    const result = (await dispatch(session, "/launch")).blocks[0]!;
    expect(result.kind).toBe("error");
    expect(result.text).toContain("usage: /launch");
    // Nothing reached the engine, so nothing was recorded.
    expect((await dispatch(session, "/runs")).blocks[0]!.text).toContain("(no runs)");
    session.db.close();
  });

  test("a bad --timeout is rejected before OpenCode is contacted", async () => {
    const session = makeSession();
    const result = (await dispatch(session, "/launch --timeout nope write a test")).blocks[0]!;
    expect(result.kind).toBe("error");
    expect(result.text).toContain("--timeout must be");
    expect((await dispatch(session, "/runs")).blocks[0]!.text).toContain("(no runs)");
    session.db.close();
  });
});

describe("progress channel", () => {
  test("dispatch works without an emit callback", async () => {
    const session = makeSession();
    const result = await dispatch(session, "/help");
    expect(result.blocks[0]!.kind).toBe("output");
    session.db.close();
  });

  test("a command that emits nothing leaves the channel unused", async () => {
    const session = makeSession();
    const emitted: ShellBlock[] = [];
    await dispatch(session, "/runs", (b) => emitted.push(b));
    expect(emitted).toEqual([]);
    session.db.close();
  });

  test("/launch reports it is starting before it reaches OpenCode", async () => {
    const session = makeSession();
    const emitted: ShellBlock[] = [];
    // A bogus binary fails at spawn, after the feedback line is already out.
    const result = await dispatch(session, "/launch --bin aiset-no-such-binary write a file", (b) =>
      emitted.push(b),
    );
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0]!.text).toContain("starting OpenCode");
    expect(result.blocks[0]!.kind).toBe("error");
    session.db.close();
  });
});

describe("parseTasks", () => {
  test("each --agent opens a task and the words after it are its prompt", () => {
    const parsed = parseTasks(["--agent", "build", "add the parser", "--agent", "review", "audit"]);
    expect(parsed).toEqual({
      shared: new Map(),
      tasks: [
        { agent: "build", prompt: "add the parser" },
        { agent: "review", prompt: "audit" },
      ],
    });
  });

  test("flags before the first agent belong to the whole team", () => {
    const parsed = parseTasks(["--model", "opencode/big-pickle", "--agent", "build", "go"]);
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.shared.get("model")).toBe("opencode/big-pickle");
    expect(parsed.tasks).toHaveLength(1);
  });

  test("--wait is a bare flag, not a prompt eater", () => {
    const parsed = parseTasks(["--wait", "--agent", "build", "go"]);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.shared.get("wait")).toBe("true");
    expect(parsed.tasks[0]!.prompt).toBe("go");
  });

  test("says what is missing rather than launching something empty", () => {
    expect(parseTasks([])).toContain("usage:");
    expect(parseTasks(["--agent", "build"])).toContain("no prompt");
    expect(parseTasks(["a prompt", "--agent", "build", "go"])).toContain("has no agent");
    expect(parseTasks(["--nonsense", "x", "--agent", "b", "go"])).toContain("unknown flag");
  });
});

describe("/multi-launch", () => {
  test("refuses a launch with no agents before touching the engine", async () => {
    const session = makeSession();
    const { blocks } = await dispatch(session, "/multi-launch");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("--agent");
    session.db.close();
  });

  test("an agent with no prompt is named in the error", async () => {
    const session = makeSession();
    const { blocks } = await dispatch(session, "/multi-launch --agent build");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("build");
    session.db.close();
  });

  test("a quoted prompt survives dispatch as one argument", async () => {
    const session = makeSession();
    // --timeout is validated before anything is started, so this exercises the
    // whole parse path without reaching OpenCode.
    const { blocks } = await dispatch(
      session,
      '/multi-launch --timeout nope --agent build "add the parser" --agent review "audit src/db"',
    );
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("--timeout must be a positive number");
    session.db.close();
  });
});

describe("/cancel", () => {
  test("needs an id", async () => {
    const session = makeSession();
    const { blocks } = await dispatch(session, "/cancel");
    expect(blocks[0]!.text).toContain("usage: /cancel");
    session.db.close();
  });

  test("an unknown id is an error, not a silent no-op", async () => {
    const session = makeSession();
    const { blocks } = await dispatch(session, "/cancel r_nope");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("no run found");
    session.db.close();
  });

  test("a run that already finished reports that nothing changed", async () => {
    const session = makeSession();
    const run = seedDemoRun(session.db);
    const { blocks } = await dispatch(session, `/cancel ${displayRunId(run.id)}`);
    expect(blocks[0]!.text).toContain("already finished");
    expect(hasAnsi(blocks[0]!.text)).toBe(false);
    session.db.close();
  });
});

describe("/runs --active", () => {
  test("lists only what is still working", async () => {
    const session = makeSession();
    seedDemoRun(session.db);
    const { blocks } = await dispatch(session, "/runs --active");
    expect(blocks[0]!.kind).toBe("output");
    expect(hasAnsi(blocks[0]!.text)).toBe(false);
    session.db.close();
  });
});

describe("/recover", () => {
  test("says so plainly when nothing was abandoned", async () => {
    const session = makeSession();
    seedDemoRun(session.db);
    const { blocks } = await dispatch(session, "/recover");
    expect(blocks[0]!.kind).toBe("output");
    expect(blocks[0]!.text).toContain("nothing to recover");
    expect(hasAnsi(blocks[0]!.text)).toBe(false);
    session.db.close();
  });

  test("reports an abandoned run without closing it under --dry-run", async () => {
    const session = makeSession();
    const run = createRun(session.db, {
      taskTitle: "left behind",
      engine: "opencode",
      status: "running",
    });
    const { blocks } = await dispatch(session, "/recover --dry-run");

    expect(blocks[0]!.text).toContain("dry run");
    expect(blocks[0]!.text).toContain(displayRunId(run.id));
    expect(hasAnsi(blocks[0]!.text)).toBe(false);
    expect(getRun(session.db, run.id).status).toBe("running");
    session.db.close();
  });

  test("closes an abandoned run that never reached the engine", async () => {
    const session = makeSession();
    const run = createRun(session.db, {
      taskTitle: "left behind",
      engine: "opencode",
      status: "running",
    });
    const { blocks } = await dispatch(session, `/recover --id ${displayRunId(run.id)}`);

    expect(blocks[0]!.text).toContain("closed");
    expect(getRun(session.db, run.id).status).toBe("killed");
    expect(getRun(session.db, run.id).exit_code).toBe(130);
    session.db.close();
  });
});

describe("/model", () => {
  // The catalogue is only ever the offline fallback here: no test hits the network.
  let restoreEnv: () => void = () => {};
  beforeEach(() => {
    restoreEnv = goOffline();
  });
  afterEach(() => restoreEnv());

  /** A session rooted in a throwaway directory so config.json can be written. */
  async function makeConfiguredSession(): Promise<{ session: Session; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "aiset-model-"));
    await writeConfigIfAbsent(defaultConfig("model-test"), root);
    const session = makeSession();
    return { session: { ...session, ctx: { ...session.ctx, paths: resolvePaths(root) } }, root };
  }

  test("normalizeModelId prefixes a bare id and rejects a non-id", () => {
    expect(normalizeModelId("anthropic/claude-sonnet-4.5")).toBe(
      "openrouter/anthropic/claude-sonnet-4.5",
    );
    expect(normalizeModelId("openrouter/anthropic/claude-sonnet-4.5")).toBe(
      "openrouter/anthropic/claude-sonnet-4.5",
    );
    expect(normalizeModelId("gpt-5")).toBeNull();
    expect(normalizeModelId("")).toBeNull();
    expect(normalizeModelId("vendor/")).toBeNull();
  });

  test("reports the current model and then sets one, persisting it to config.json", async () => {
    const { session, root } = await makeConfiguredSession();

    const before = (await dispatch(session, "/model")).blocks[0]!;
    expect(before.kind).toBe("output");
    expect(before.text).toContain("unset");
    expect(hasAnsi(before.text)).toBe(false);

    const set = (await dispatch(session, "/model anthropic/claude-sonnet-4.5")).blocks[0]!;
    expect(set.kind).toBe("output");
    expect(set.text).toContain("openrouter/anthropic/claude-sonnet-4.5");
    expect(hasAnsi(set.text)).toBe(false);

    expect((await readConfig(root))?.opencode.model).toBe("openrouter/anthropic/claude-sonnet-4.5");

    const after = (await dispatch(session, "/model")).blocks[0]!;
    expect(after.text).toContain("openrouter/anthropic/claude-sonnet-4.5");

    await rm(root, { recursive: true, force: true });
    session.db.close();
  });

  test("--reset clears the model and --list prints the catalogue", async () => {
    const { session, root } = await makeConfiguredSession();
    await dispatch(session, "/model anthropic/claude-sonnet-4.5");

    const reset = (await dispatch(session, "/model --reset")).blocks[0]!;
    expect(reset.kind).toBe("output");
    expect((await readConfig(root))?.opencode.model).toBeUndefined();

    const listed = (await dispatch(session, "/model --list")).blocks[0]!;
    expect(listed.kind).toBe("output");
    expect(listed.text).toContain("anthropic/claude-sonnet-4.5");
    expect(listed.text).toContain("source=");
    expect(hasAnsi(listed.text)).toBe(false);

    await rm(root, { recursive: true, force: true });
    session.db.close();
  });

  test("rejects an id that is not vendor/model and leaves config untouched", async () => {
    const { session, root } = await makeConfiguredSession();
    const { blocks } = await dispatch(session, "/model gpt-5");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("vendor/model");
    expect((await readConfig(root))?.opencode.model).toBeUndefined();

    await rm(root, { recursive: true, force: true });
    session.db.close();
  });

  test("fails with a hint when the directory has no config.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "aiset-noconfig-"));
    const base = makeSession();
    const session: Session = { ...base, ctx: { ...base.ctx, paths: resolvePaths(root) } };
    const { blocks } = await dispatch(session, "/model anthropic/claude-sonnet-4.5");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("config.json");

    await rm(root, { recursive: true, force: true });
    session.db.close();
  });
});

describe("/team and bare text", () => {
  /** The same canned plan for every case; the model is never really called. */
  const PLAN = {
    title: "Next.js demos: dashboard and settings",
    rationale: "Two routes, no shared files, so they run in parallel.",
    tasks: [
      {
        agent: "build",
        title: "Dashboard route",
        prompt:
          "Scaffold ./web with Next.js App Router and Tailwind, then create app/dashboard/page.tsx and run `bun run build`.",
      },
      {
        agent: "build",
        title: "Settings route",
        prompt:
          "Assume ./web exists with Next.js and Tailwind. Create only app/settings/page.tsx and run `bun run build`.",
      },
    ],
  };

  function plannedSession(body: unknown = PLAN): Session {
    return { ...makeSession(), plannerModel: mockModel(body) };
  }

  test("--dry-run shows every prompt and launches nothing", async () => {
    const session = plannedSession();
    const emitted: ShellBlock[] = [];
    const { blocks } = await dispatch(session, "/team --dry-run build me two pages", (block) =>
      emitted.push(block),
    );

    const text = blocks[0]!.text;
    expect(blocks[0]!.kind).toBe("output");
    expect(text).toContain("Next.js demos");
    expect(text).toContain("app/dashboard/page.tsx");
    expect(text).toContain("app/settings/page.tsx");
    expect(text).toContain("nothing launched");
    expect(hasAnsi(text)).toBe(false);
    expect(emitted[0]!.text).toContain("planning a team");
    // Nothing reached the engine, so no run was recorded.
    expect((await dispatch(session, "/runs")).blocks[0]!.text).toContain("(no runs)");
    session.db.close();
  });

  test("bare text reaches the planner with the whole line intact", async () => {
    const session = plannedSession("not a plan");
    const emitted: ShellBlock[] = [];
    const request = "Create a team of 2 agents for a dashboard and a --settings page";
    const { blocks } = await dispatch(session, request, (block) => emitted.push(block));

    // The whole line is the request: a stray `--flag` inside it is not parsed.
    expect(emitted[0]!.text).toContain(request);
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("could not plan");
    expect((await dispatch(session, "/runs")).blocks[0]!.text).toContain("(no runs)");
    session.db.close();
  });

  test("a request the model cannot shape into a plan is an error with a hint", async () => {
    const session = plannedSession("sure, I can help with that!");
    const { blocks } = await dispatch(session, "/team do something");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("could not plan");
    expect(blocks[0]!.text).toContain("/model");
    expect((await dispatch(session, "/runs")).blocks[0]!.text).toContain("(no runs)");
    session.db.close();
  });

  test("an empty /team is a usage error before any model call", async () => {
    const session = plannedSession();
    const { blocks } = await dispatch(session, "/team");
    expect(blocks[0]!.kind).toBe("error");
    expect(blocks[0]!.text).toContain("usage: /team");
    session.db.close();
  });
});
