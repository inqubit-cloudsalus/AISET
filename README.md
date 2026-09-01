# AISET

**AI Software Engineering Team** — a coordinated team of specialized AI agents for the
software development lifecycle, whose organizational structure, effectiveness, and cost
are subject to continuous experimental measurement.

## Problem

Organizations and professionals developing software currently use AI agents as individual
assistants, obtaining real but limited and unmeasured productivity gains.

Existing multi-agent frameworks (MetaGPT, ChatDev, Devin, OpenHands) promised full autonomy
and largely failed to deliver, for three recurring reasons:

1. **Architectures justified by analogy** with human teams rather than by evidence.
2. **Unmanaged human supervision costs.**
3. **The absence of rigorous measurement.**

## Approach

AISET addresses this gap: building a coordinated team of specialized AI agents for the SDLC
whose organizational structure, effectiveness, and cost are subject to continuous
experimental measurement, with the human engineer remaining responsible for objectives,
critical decisions, and final approval.

## Status

Early stage. The **AISET CLI** — the runs store and the terminal surface that the OpenCode
lifecycle spike is built on — is implemented ([CLI_PLAN.md](CLI_PLAN.md)). The OpenCode
adapter itself is the next issue in the "OpenCode Lifecycle POC" milestone.

## The CLI

Requires [Bun](https://bun.sh) ≥ 1.1. No native modules, no build step.

```sh
bun install
bun run aiset init      # create .aiset/, its config and the runs database
bun run aiset doctor    # check bun, the database, opencode and provider keys
bun run aiset seed --demo
bun run aiset           # the home view
```

| Command | What it does |
|---|---|
| `aiset` | Home: database path, run counts by status, the last 5 runs |
| `aiset init` | Creates `.aiset/`, `config.json` and the database, applies migrations. Idempotent |
| `aiset doctor` | Bun, database + migrations, `opencode` on PATH, provider key presence, write access. Exit 1 on failure |
| `aiset runs list` | Runs, most recent first. `--status`, `--limit` |
| `aiset runs show <id>` | One run with its event timeline, artifacts and usage. `--events` |
| `aiset runs tail <id>` | Follows a running run's events live |
| `aiset db migrate` / `db status` | Apply / report migrations |
| `aiset seed --demo` | Inserts one synthetic run (`engine=mock`) so the UI is demonstrable |

Global flags: `--json`, `--no-color`, `--db <path>`, `--version`, `--help`.

**Every command has a plain-text path.** With `--json`, a non-TTY (a pipe), or `NO_COLOR`
set, output is deterministic text or JSON and the Ink TUI is never mounted — which is what
makes the CLI both pipeable and testable. Nothing is rendered that the database does not
contain: there are no synthetic progress bars.

There is deliberately **no `db reset`** and no command that deletes anything under `runs/`
or `evals/baselines/` (charter §5). Provider API keys are read from the environment only and
are never printed, including by `doctor`.

### Runtime state

`.aiset/` (gitignored) holds `aiset.db`, `config.json` and `logs/*.jsonl`. Nothing else is
written outside the repository.

### Checks

```sh
bun run check    # typecheck + biome + unit tests
bun run smoke    # end-to-end CLI smoke test against a throwaway workspace
```

`make check` / `make cli-smoke` delegate to the same scripts where GNU make is available.

## License

MIT — see [LICENSE](LICENSE).
