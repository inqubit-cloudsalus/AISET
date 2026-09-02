# Milestone 1 — test plan for issues #7 and #9

A runnable script for a fresh session. Issue **#7** is *Bun restart recovery*; issue **#9**
is the milestone's core experiment, *kill OpenCode and verify what survives*. Part 1 is the
setup both depend on.

## Context

Repo `O:\DevPerformant\AISET`, branch `milestone-1`. Everything is committed:

| Commit | What it added |
|---|---|
| `bf397c0` | Multi-agent runs (#5): one shared server, parent run + `parent_run_id`, `/multi-launch`, `/cancel` |
| `7b30477` | Group duration and spend roll-up |
| `1ed4a62` | Bun restart recovery (#7): ownership + heartbeat, `aiset recover`, `/recover` |
| `1fa1013` | TUI redesign on OpenTUI |

**Issue #9 needs no code.** It is an experiment, not a feature: launch a multi-agent run,
kill OpenCode, observe what survives, and record GREEN / AMBER / RED. Everything needed to
observe it already exists — `runs list`, `runs show --events`, `recover`, `doctor`.

How recovery decides: a run is **orphaned** when it is not terminal, no local process is
pumping it, and either its heartbeat is over 30s old or its owner's pid is dead. Orphans are
re-attached if the engine still has the session, otherwise closed `killed`/130.

### Blocker to clear first

**OpenCode provider credits.** They were exhausted on 2026-09-02; the last 4-agent launch
failed with *"This request would exceed your available credits"*. That is the account, not
AISET. Top up before starting or every live test below is void.

## 0. Baseline

```powershell
bun run typecheck                       # clean
bun test                                # 180 pass, 0 fail
bun run smoke                           # 44 checks
bun run src/cli/main.ts doctor          # all checks passed
bun run src/cli/main.ts db migrate      # 4/4 migrations
```

`bun run check` also runs lint, which **fails on pre-existing CRLF formatting** in files
unrelated to this work. It fails identically at HEAD — not a regression, and not something
to "fix" as part of testing.

---

# Part 1 — launch a multi-agent run

Start the shell with `bun run src/cli/main.ts`, then paste this as one line:

```
/multi-launch --agent build "In multi-agent-ts-tests/, create slugify.ts exporting function slugify(text: string): string that lowercases, trims, and collapses runs of non-alphanumeric characters into single hyphens. Then create multi-agent-ts-tests/slugify.check.ts asserting with node:assert on at least three inputs, and run: bun run multi-agent-ts-tests/slugify.check.ts. Touch no other file." --agent build "In multi-agent-ts-tests/, create chunk.ts exporting function chunk<T>(items: T[], size: number): T[][] splitting an array into groups of at most size. Then create multi-agent-ts-tests/chunk.check.ts asserting with node:assert on at least three inputs including an empty array, and run: bun run multi-agent-ts-tests/chunk.check.ts. Touch no other file." --agent general "In multi-agent-ts-tests/, create formatBytes.ts exporting function formatBytes(bytes: number): string rendering B, KB, MB and GB. Then create multi-agent-ts-tests/formatBytes.check.ts asserting with node:assert on at least three inputs including 0, and run: bun run multi-agent-ts-tests/formatBytes.check.ts. Touch no other file." --agent general "In multi-agent-ts-tests/, create parseDuration.ts exporting function parseDuration(text: string): number turning 90s, 5m and 1h30m into milliseconds and returning null on anything unparseable. Then create multi-agent-ts-tests/parseDuration.check.ts asserting with node:assert on at least three inputs including an invalid string, and run: bun run multi-agent-ts-tests/parseDuration.check.ts. Touch no other file."
```

Only `build` and `general` can write files (`explore` and `plan` are read-only). Repeating an
agent name is fine — each `--agent` opens its own session.

**Confirm multiple agents really are executing**, from a second terminal:

```powershell
bun run src/cli/main.ts runs list --status running
@(Get-Process opencode).Count
```

**Expect:** 1 group + 4 agents `running`, and **exactly 1** `opencode` process — four sessions
on one shared server. `/run r_<parent>` in the shell shows all four with live statuses.

Left alone, the group should reach `succeeded` with eight files in `multi-agent-ts-tests/`,
and duration and spend rolled up on the parent labelled "all agents".

---

# Part 2 — issue #7, Bun restart recovery

## 2A. Kill Bun, engine survives

Launch as in Part 1. After ~20s, from a second terminal:

```powershell
Get-Process bun | Select-Object Id,StartTime
Stop-Process -Id <newest bun Id> -Force
Get-Process opencode                                    # survives the kill
bun run src/cli/main.ts runs list --status running      # all 5 still open
bun run src/cli/main.ts recover --dry-run
bun run src/cli/main.ts recover
```

**Expect:**
- `runs list` still shows the group and its agents — SQLite kept everything.
- `--dry-run` names each orphan as `orphaned — pid <dead> @<host> (last beat Ns ago)` and
  writes nothing (statuses unchanged afterwards).
- `recover` re-attaches each agent — *"session still alive"* or *"it had already finished;
  its result was recovered"* — waits for them, then rolls the group up.
- Afterwards: `runs show r_<parent>` is terminal with all agents terminal, and
  `@(Get-Process opencode).Count` is **0** (the leaked server is reaped once unused).

## 2B. Engine gone too

Same as 2A, but also `Stop-Process -Name opencode -Force` before recovering.

**Expect:** each agent `closed — its OpenCode server is gone`, status `killed`, exit `130`,
with exactly one `recover` event and one `end` event; the group rolls up `killed`. Running
`recover` a second time is a clean no-op.

## 2C. A healthy run is never stolen

With a team genuinely running, from another terminal:

```powershell
bun run src/cli/main.ts recover
bun run src/cli/main.ts doctor
```

**Expect:** *"no runs were left open by a dead process"* and `✔ open runs  none abandoned`.
This is what stops two terminals fighting over each other's runs.

## 2D. The notice surfaces on its own

After a kill, before recovering:

```powershell
bun run src/cli/main.ts doctor      # ⚠ open runs  N runs were left open…
bun run src/cli/main.ts            # shell banner shows the same line + "— /recover"
```

Then in the shell: `/recover --dry-run`, then `/recover`.

---

# Part 3 — issue #9, the core experiment: kill OpenCode

**Bun stays alive throughout 3A–3D.** That is what separates this from Part 2.

## What the code says should happen

Confirm or refute these — do not assume them.

1. All four agents share one `opencode serve`, so killing it hits **all of them at once**.
2. Each agent's pump loses its event stream, so each run finalizes **`failed`/1**, with a
   `stderr` event if the connection errored rather than simply ended.
3. Bun is alive, so the group rolls up to `failed` **on its own, with no human action**.
4. Nothing is left spending — the engine is dead.
5. The server is started on port `0` (OS-assigned), so a restarted OpenCode gets a **new
   port** and the `server_url` stored on the run is stale. Recovery cannot re-attach to a
   restarted engine even though OpenCode keeps its sessions on disk.

## 3A. Launch and let real work accumulate

Launch as in Part 1. Confirm 4 agents running on 1 engine. Let them work **30–45s** so there
is genuine state to survive: tool calls, at least one written file, and usage rows. Watch
`/run r_<parent>` until events are accumulating.

## 3B. Kill OpenCode — not Bun

```powershell
Get-Process opencode | Select-Object Id,StartTime
Stop-Process -Name opencode -Force
```

**Note the wall-clock time of the kill.**

## 3C. Observe what the Bun side does, unaided

Within a few seconds, and without running `recover`:

```powershell
bun run src/cli/main.ts runs list --limit 6
```

Record **how long** until every run reached a terminal status, and **which** status. Then the
most important question in the milestone:

> Did any run need human intervention to close?

## 3D. Inspect what survived, per agent

```powershell
bun run src/cli/main.ts runs show r_<child> --events
bun run src/cli/main.ts runs show r_<parent>
ls multi-agent-ts-tests/
```

Fill this in for each of the four agents:

| Question | Where to look | Survived? |
|---|---|---|
| Which session did it own? | `runs show --json` → `opencode_session_id` | |
| Every tool call up to the kill? | `--events`, the `tool` lines | |
| Which agent did what? | the `@agent` attribution on each event | |
| Files it had already written? | `artifacts (n)`, and the files on disk | |
| Tokens and money spent? | the `usage` block, and rolled up on the parent | |
| How it ended, and why? | the `stderr` line and the `end` line | |

Then answer the deliverable's question directly:

> From SQLite alone, can you reconstruct what each of the four agents was doing and how far
> it got?

## 3E. Confirm the failure is clean, not merely recorded

```powershell
bun run src/cli/main.ts recover --dry-run     # expect: nothing to recover
bun run src/cli/main.ts doctor                # expect: open runs — none abandoned
@(Get-Process opencode).Count                 # expect 0
```

Then, **in the same shell that survived the kill**, launch the team again. It must spawn a
fresh engine and work normally. A stale pooled server entry would show up here as a hang or a
connection error, and would be a real bug. This path has not been tested before.

## 3F. Restart OpenCode and test re-attach — the AMBER hinge

After 3B, start a server by hand and see whether the old sessions are still there:

```powershell
opencode serve --hostname 127.0.0.1 --port 4141
curl "http://127.0.0.1:4141/session?directory=O%3A%5CDevPerformant%5CAISET"
```

Record whether the killed run's `opencode_session_id` still appears. Then ask: **could AISET
have re-attached?** Expect no, for two independent reasons — the run is already terminal, and
the recorded `server_url` points at a port nobody is listening on. Note separately whether
the *interrupted turn* could resume at all, or whether it would need a fresh prompt.

## 3G. Double failure — OpenCode and Bun together

Launch, then kill `opencode` and the shell's `bun` within a second of each other. Restart and
run `recover`.

**Expect:** the orphans closed `killed`/130 with a `recover` event saying the server is gone,
and the group rolled up.

---

# Recording the verdict

**GREEN** — every agent reached a terminal status within seconds with no human action; the
timeline, agent attribution, artifacts and spend up to the kill are intact in SQLite; files
written before the kill survive on disk; the group rolled up on its own; nothing was left
spending; and a fresh launch works in the same shell. In short: multi-agent execution is
controllable from Bun, its state is reliably reconstructable, and a dead engine is reliably
marked failed.

**AMBER** — the above holds only with extra help: a run left non-terminal until someone runs
`recover` or `cancel`, lost attribution of which agent did what, or resuming an interrupted
turn requiring an OpenCode plugin or additional persistence.

**RED** — runs hang with no way to close them, state is lost or self-contradictory, or
multi-agent execution cannot be controlled from Bun at all.

Write the verdict with the 3C timing, the 3D table, and the 3F finding as its evidence.

# Failure signals across all parts

- A run still `running` after `recover` finished, or a group left open while its agents are closed.
- `--dry-run` changing any status or adding any event.
- Duplicated tool or artifact lines, or usage totals that doubled after a re-attach.
- An `opencode` process still alive after every run is closed.
- Part 2C finding anything to do.

# Cleanup

```powershell
bun run src/cli/main.ts runs cancel r_<parent>     # closes a group cleanly
Remove-Item -Recurse -Force multi-agent-ts-tests
```

Never `db reset`. Never delete anything under `runs/` or `evals/baselines/`.

# Open points to carry into the report

1. **Provider credits** must be topped up or nothing live runs.
2. **"Minimal Bun server"** in the milestone's diagram: AISET is a CLI/TUI over a long-lived
   Bun process, not an HTTP server. Everything the milestone validates works without one, but
   if the reviewer expects an HTTP endpoint, that is a scope question to settle before the
   demo rather than a defect to discover during it.
3. **Resuming an interrupted turn is not supported.** Recovery reconstructs state and closes
   runs reliably; it cannot make a half-finished agent turn continue. Step 3F demonstrates
   why. Whether that costs GREEN is a human judgement — state it plainly either way.
