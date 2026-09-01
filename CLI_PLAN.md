# AISET CLI — project initialization, TUI, and SQLite runs storage

| Field | Value |
|---|---|
| **Status** | **APPROVED 2026-09-01 — BUILD complete.** Verification below passes (33 unit tests, 24 smoke checks). |
| **Version** | v1 |
| **Date** | 2026-08-31 (approved and built 2026-09-01) |
| **Type** | Spike track — issue #1 of the "OpenCode Lifecycle POC" milestone |
| **Estimate** | ~7.75 h agent-side (construction cost, tracked separately from WP hours) |

## Context

The repo is documentation-only today (charter, management plan, WP1 plan, spike plan).
Nothing executable exists. The **OpenCode Lifecycle POC** milestone asks whether AISET can
control and recover an OpenCode run headlessly — start, observe, capture, kill — and record
the whole lifecycle as evidence. Issue **#1 "Bun server + SQLite runs storage"** is the
foundation: something has to hold runs, events, artifacts and cost before an adapter can
write to it.

This plan covers the executable foundation: a real Bun/TypeScript project named **AISET**,
a Claude-Code-style Ink TUI, and the SQLite runs store. It deliberately stops **before** the
OpenCode adapter (next issue) so the storage contract and the CLI surface are settled first.

Two things are recorded as assumptions rather than guesses:

- The milestone and issue text pasted into the session arrived elided on the agent side.
  This plan is written against `SPIKE_OPENCODE_LIFECYCLE_PLAN.md`, which describes the same
  milestone. If the issue text says anything different, it must be folded in before BUILD.
- `CLAUDE.md` records the spike as "awaiting approval, no build before a one-line OK".
  The WP1 ↔ spike ordering is unchanged: this is the spike track, not WP1 BUILD.

**Prerequisite (human): resolved.** Bun was already installed (1.4.0), so the install step
was not needed. `opencode` 1.14.38 is on PATH; Node 20 is present but unused by this project.

## Decisions taken

| Choice | Decision | Why |
|---|---|---|
| Runtime | **Bun** | Milestone wording; `bun:sqlite` is built in, so zero native modules on Windows |
| Database | **`bun:sqlite`** + hand-written SQL migrations | The schema *is* evidence; an ORM would hide it. No native build step |
| TUI | **Ink + React** (installed: Ink 7 / React 19) | "Like Claude Code" literally means Ink — live spinners, panels, streaming event views |
| Arg parsing | **commander** | Mature `--help` / subcommand handling; Ink renders, commander routes |
| Model access | **Vercel AI SDK** (installed: `ai` 7, `@ai-sdk/anthropic` 4, `@ai-sdk/openai` 4) | Provider-agnostic (keeps measurement honest), streaming, and `generateObject` + Zod gives schema-validated artifacts, matching the charter's "artifacts over conversations" |
| Validation | **Zod** | One schema language for config, DB rows, and future artifact schemas |
| Tests / lint | **`bun test`** + **Biome** | Both built for speed; Biome replaces eslint + prettier with one config |

Note on the AI layer: OpenCode remains **the execution engine** for agent runs (charter §4.2,
open-source-engine-only). The AI SDK is for AISET's *own* small model calls — classifying a
run failure, summarising an event stream — never a second agent runtime.

## Repository layout added

Source lives at the repo root as a single package so `bun run` is trivial; the docs scaffold
from `CLAUDE.md` §2 is created later during WP1 BUILD and does not conflict.

```
package.json              # name: "aiset", bin: { aiset: "./src/cli/main.ts" }
tsconfig.json             # strict, ESM, bundler resolution, react-jsx
biome.json
Makefile                  # thin delegation to the bun scripts (make is optional; not installed here)
.env.example              # ANTHROPIC_API_KEY / OPENAI_API_KEY placeholders
src/
  cli/
    main.ts               # shebang, commander wiring, global flags
    commands/
      init.ts  doctor.ts  runs.ts  db.ts  seed.ts
  ui/
    theme.ts              # colors, symbols, NO_COLOR / non-TTY fallback
    components/           # Banner, Panel, StatusLine, KeyValue, Table, Spinner
    views/                # HomeView, DoctorView, RunListView, RunDetailView
    render.tsx            # renderApp(): mounts Ink only when TTY, else plain text
  db/
    client.ts             # openDb(): WAL, foreign_keys=ON, busy_timeout
    migrate.ts            # runs migrations/*.sql in order, records schema_migrations
    migrations/0001_init.sql
    repositories/         # runs.ts, events.ts, artifacts.ts, usage.ts
    types.ts              # Zod schemas + inferred row types
  ai/
    provider.ts           # AI SDK model registry, provider chosen by config/env
  core/
    config.ts  ids.ts (ULID)  logger.ts (JSONL)  errors.ts  paths.ts
test/
  db/*.test.ts  cli/*.test.ts
```

Runtime state goes in `.aiset/` (gitignored): `.aiset/aiset.db`, `.aiset/config.json`,
`.aiset/logs/*.jsonl`. The `runs/` corpus directory stays as `CLAUDE.md` §2 defines it.

## SQLite schema (`0001_init.sql`)

```sql
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,          -- ULID, displayed as r_<ulid>
  task_id       TEXT,                      -- e.g. T-001
  task_title    TEXT NOT NULL,
  engine        TEXT NOT NULL,             -- 'opencode' | 'mock'
  model         TEXT,
  status        TEXT NOT NULL,             -- pending|running|succeeded|failed|timeout|killed
  verdict       TEXT,                      -- GREEN|AMBER|RED
  started_at    TEXT NOT NULL,             -- ISO-8601 UTC
  ended_at      TEXT,
  exit_code     INTEGER,
  workdir       TEXT,
  parent_run_id TEXT REFERENCES runs(id),  -- recovery re-runs link to the original
  schema_version TEXT NOT NULL DEFAULT '1',
  meta          TEXT                       -- JSON
);

CREATE TABLE run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  ts      TEXT NOT NULL,
  type    TEXT NOT NULL,   -- start|stdout|stderr|tool|artifact|timeout|recover|end
  level   TEXT NOT NULL DEFAULT 'info',
  message TEXT,
  data    TEXT,            -- JSON
  UNIQUE (run_id, seq)
);

CREATE TABLE run_artifacts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,  -- spec|patch|test-report|review-package|log
  path     TEXT NOT NULL,
  sha256   TEXT,
  bytes    INTEGER,
  schema_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE run_usage (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider TEXT, model TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cost_usd REAL, recorded_at TEXT NOT NULL
);

CREATE INDEX idx_runs_started    ON runs(started_at DESC);
CREATE INDEX idx_runs_status     ON runs(status);
CREATE INDEX idx_events_run_seq  ON run_events(run_id, seq);
```

Every write goes through `src/db/repositories/*`; no ad-hoc SQL in commands. Rows are parsed
back through Zod so a schema drift fails loudly instead of silently.

## CLI surface

| Command | Behaviour |
|---|---|
| `aiset` | Ink home: banner, DB path, run counts by status, last 5 runs, hint line |
| `aiset init` | Creates `.aiset/`, writes `config.json`, creates the DB, applies migrations. Idempotent — reports what already existed instead of overwriting |
| `aiset doctor` | Live checklist: Bun version, DB reachable + migrations current, `opencode` on PATH + version, provider API key present (presence only — never printed), write access to `.aiset/`. Exit 1 if any check fails |
| `aiset runs list` | Table: id, status, task, started, duration. `--status`, `--limit`, `--json` |
| `aiset runs show <id>` | Detail panel + event timeline + artifacts + usage. `--events`, `--json` |
| `aiset runs tail <id>` | Live-follow view of a running run's events (polls the DB; ready for the adapter) |
| `aiset db migrate` / `db status` | Apply / report migrations |
| `aiset seed --demo` | Inserts one synthetic run with events and artifacts so the UI is demonstrable before the adapter exists |

Global flags: `--json`, `--no-color`, `--db <path>`, `--version`, `--help`.

Guardrails honoured (charter §5 / `CLAUDE.md` §5): there is no `db reset` and no command that
deletes anything under `runs/` or `evals/baselines/`. API keys are read from the environment
only and never echoed, including by `doctor`.

## Visual design

`src/ui/theme.ts` is the single source of colour and symbol truth:

```
accent ◆   ok ✔   warn ⚠   fail ✖   pending ○   cursor ›   spinner ⠋⠙⠹…
```

Palette: dim grey chrome, cyan accent, green/yellow/red for status only. Rounded `Box`
borders for panels. Target look:

```
╭────────────────────────────────────────╮
│  ◆ AISET  v0.1.0                       │
│  AI Software Engineering Team          │
╰────────────────────────────────────────╯

  ⠋ run r_01J8…  start → observing
  ✔ spec.json    schema-valid
  ✔ tests        3 passed
  ⚠ timeout      recovering (1/3)

  › _
```

Two hard rules:

1. **Every view has a plain-text path.** If `!process.stdout.isTTY`, or `--json`, or `NO_COLOR`
   is set, the command prints deterministic text/JSON and never mounts Ink — this keeps output
   pipeable and, more importantly, testable.
2. **Nothing is rendered that the DB does not contain.** No fake progress bars.

## Verification

1. `bun install && bun run check` (typecheck + Biome + `bun test`)
2. `bun test` — repository CRUD, migration idempotence (run twice, one row in
   `schema_migrations`), Zod rejection of a malformed row, cascade delete of events.
3. `bun run smoke` (or `make cli-smoke`) — the end-to-end path, zero manual setup:
   `aiset init` → `aiset db status` → `aiset seed --demo` → `aiset runs list --json`
   (asserts one run) → `aiset runs show <id> --json` (asserts events + artifacts) →
   `aiset doctor` (asserts exit 0).
4. Manual, ~3 min: run `aiset`, `aiset doctor`, `aiset runs show <id>` in a real terminal to
   confirm the TUI; then `aiset runs list | cat` to confirm the plain-text fallback.

## Phases

| # | Work | Est. |
|---|---|---|
| 1 | Project init: package.json, tsconfig, biome, Makefile, `.gitignore` additions, `.env.example` | 0.75 h |
| 2 | `src/db`: client, migrations, migrate runner, repositories, Zod types + tests | 2 h |
| 3 | `src/ui`: theme, components, TTY/plain dual rendering | 1.5 h |
| 4 | Commands: init, doctor, runs list/show/tail, db, seed | 2 h |
| 5 | `src/ai/provider.ts`: AI SDK registry + config (wired, not yet used by a feature) | 0.5 h |
| 6 | Smoke target, README section, self-check, run log entry | 1 h |
| | **Total agent-side** | **~7.75 h** |

Tracked as spike construction cost, separate from the 12 h WP1 human budget.

## Out of scope (next issues)

The Bun HTTP server exposing `/runs`, the OpenCode adapter (`start` / `observe` / `capture` /
`kill`), the injected-timeout recovery demo, `make spike-lifecycle`, and the GREEN/AMBER/RED
ADR. This plan builds exactly the storage and surface those need.

## Build record (2026-09-01)

Built as planned, all six phases. Deviations, all recorded rather than silent:

- **Task runner.** GNU `make` is not installed on the build machine, so the canonical targets
  are `package.json` scripts (`bun run check`, `bun run smoke`); the `Makefile` is a thin
  delegation kept for the charter's `make …` convention where make exists.
- **Prerequisite already met.** Bun 1.4.0 and `opencode` 1.14.38 were already on PATH.
- **Dependency versions** resolved above the floors this plan named (Ink 7, React 19, Zod 4,
  AI SDK 7). No API surface used here changed.
- **`--json` after a subcommand.** Commander scopes options to the command they are declared
  on, so the global flags are registered on every leaf and resolved by walking the command
  chain (`globalsFrom` in `src/cli/context.ts`). `aiset --json runs list` and
  `aiset runs list --json` are equivalent.
- **`db status` on a stale schema.** It opens the database directly instead of through
  `requireDb`, because reporting a behind schema is precisely that command's job.

Verification at completion: `bun run check` clean (typecheck, Biome, **33 unit tests**);
`bun run smoke` passes **24 end-to-end checks**.

Not built, as scoped out: the Bun HTTP server, the OpenCode adapter, the injected-timeout
recovery demo, `make spike-lifecycle`, the GREEN/AMBER/RED ADR.
