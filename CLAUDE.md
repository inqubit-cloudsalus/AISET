# CLAUDE.md — AISET

AISET builds a measured team of specialized AI agents for the SDLC on OpenCode.
Charter and plan: `PROJECT_CHARTER.md`, `PROJECT_MANAGEMENT_PLAN.md` (charter wins).

## Stack

Bun + TypeScript (strict, ESM). `bun:sqlite` for storage, Ink for the TUI,
commander for routing, Zod for validation, Biome for lint/format.
Vercel AI SDK is for AISET's own small model calls only — OpenCode is the
execution engine for agent runs, never a second agent runtime.

## Architecture

    src/cli/       commander wiring + one file per command
    src/ui/        theme, Ink views, plain-text renderers, view models
    src/db/        client, migrations, repositories, Zod row schemas
    src/core/      config, ULID ids, JSONL logger, errors, paths
    src/ai/        model registry (wired, no consumer yet)

Commands call repositories; repositories own all SQL. Runtime state lives in
`.aiset/` (gitignored): `aiset.db`, `config.json`, `logs/*.jsonl`.

## Data model

One `runs` row per agent run, with `run_events` (ordered `seq` stream),
`run_artifacts` and `run_usage` hanging off it by cascade. `parent_run_id`
links a recovery re-run to its original. Schema: `src/db/migrations/`.

## Invariants

- No SQL outside `src/db/repositories/`. Every row is parsed back through Zod,
  so schema drift fails loudly instead of silently.
- Every view has a plain-text path. `--json`, a pipe, or `NO_COLOR` render
  deterministic output and never mount Ink. This is what makes commands testable.
- Nothing is displayed that the database does not contain. No synthetic progress.
- Migrations are append-only and idempotent.

## Checks

`bun run check` (typecheck + Biome + tests), `bun run smoke` (end-to-end CLI).
Run both before claiming work is done.

## Guardrails

No `db reset`. Never delete anything under `runs/` or `evals/baselines/`.
API keys are read from the environment only and never printed.
Never edit `PROJECT_CHARTER.md` — changes go through its §11, by the human.
