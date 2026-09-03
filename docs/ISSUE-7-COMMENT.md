Recovery works. Tested live against the real engine with paid agents, and now covered by tests.

Details: `docs/MILESTONE-1-FINDINGS.md`. Procedure: `docs/MILESTONE-1-TEST-PLAN.md`.

## What I did

Launched a 4-agent group on one shared `opencode serve`, then killed the Bun process mid-run and left the engine running.

SQLite still had all five runs (group + 4 agents) exactly as they were. `aiset recover` from a fresh process picked them up:

```
✔ …4G9P99 reattached  session still alive
✔ …4G9P9A reattached  it had already finished; its result was recovered
✔ …4G9P9B reattached  it had already finished; its result was recovered
✔ …4G9P9C reattached  session still alive
○ …239ED3 skipped     waiting for the 2 agents it just resumed
```

Two agents got resumed on a live stream, two got settled from session history. That split is worth calling out: an agent that finishes *during* the outage has already emitted its idle event, so re-attaching and waiting for one would hang forever. Recovery checks the history instead.

After that the group rolled up by itself, the orphaned server was reaped once nothing was using it, and running `recover` again did nothing.

The agents' actual work survived too. All four finished their tasks after recovery and the code they wrote runs:

```
chunk.check.ts         exit 0
formatBytes.check.ts   formatBytes checks passed!
parseDuration.check.ts All parseDuration checks passed.
slugify.check.ts       All slugify checks passed.
```

## The other cases

**Bun and OpenCode both killed.** Every run closed as `killed` / exit 130, reason recorded as *its OpenCode server is gone*. Each agent ended up with exactly one `recover` event and one `end` event on top of its 33 and 27 pre-kill tool events, so nothing was lost or written twice. `killed` and not `failed` is on purpose: the run was interrupted, it didn't break.

**A healthy run doesn't get stolen.** With a team genuinely running, `recover` from a second terminal said *"no runs were left open by a dead process"* and touched nothing. An owner that's still beating is off limits, so two AISET processes can't fight over each other's runs.

**You don't have to go looking for it.** `doctor` reports `N runs were left open…`, and the shell banner shows the same line with `— /recover`.

`--dry-run` prints each orphan as `orphaned — pid <dead> @<host> (last beat Ns ago)` and writes nothing: no status changed, no event appended.

## How it decides

A run counts as orphaned when it's not terminal, no local process is pumping it, and either its heartbeat is older than 30s or its owner's pid is dead. Orphans get re-attached if the engine still has the session, otherwise closed as `killed` / 130.

## Tests

20 tests in `test/opencode/recover.test.ts` and `test/opencode/ownership.test.ts` cover orphan detection, `--dry-run` writing nothing, re-attaching to a live session, settling from history, not double-counting a replayed stream, honouring a cancel that was requested before the crash, group rollup, and `recover` twice being a no-op. None of them spawns a process or opens a socket.

Baseline: `typecheck` clean, `bun test` 189 pass, `bun run smoke` 44 checks, `doctor` green.

## Verdict

State is never lost, live sessions get re-attached and run to completion, dead ones get closed instead of hanging, healthy runs owned by someone else are left alone, and the condition surfaces on its own. Closing.
