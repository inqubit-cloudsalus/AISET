# Milestone 1 — findings

**Date:** 2026-09-02 · **Commit under test:** `cbf3025` (branch `milestone-1`) ·
**Engine:** OpenCode 1.18.25 · **Runtime:** Bun 1.4.0 on Windows 11

Every run below used real, paid OpenCode agents against the real engine. Nothing here is
simulated: each kill was a `Stop-Process -Force` against a live process mid-flight.

Procedure: [`MILESTONE-1-TEST-PLAN.md`](./MILESTONE-1-TEST-PLAN.md).

## Summary

| # | Test | Result |
|---|---|---|
| 1 | 4 agents execute concurrently | **PASS** — 4 sessions on exactly 1 `opencode serve` |
| 2A | Kill Bun, engine survives → recover | **PASS** — 4/4 re-attached, group rolled up |
| 2B/3G | Kill Bun *and* OpenCode → recover | **PASS** — all closed `killed`/130 |
| 2C | Healthy run is not stolen | **PASS** — recovery found nothing to do |
| 2D | Abandonment is reported unprompted | **PASS** — doctor and shell banner |
| 3C | **Kill OpenCode, Bun alive** | **PASS** — all 5 runs self-closed in ≤1s |
| 3E | Relaunch after the engine died | **PASS** — fresh engine in 1.7s, group succeeded |
| 3F | Do sessions survive the engine? | **PASS** (sessions) / **NO** (the in-flight turn) |

Baseline at the same commit: `typecheck` clean, `bun test` 180 pass, `bun run smoke` 44 checks.

---

## 1. The core experiment (#9): kill OpenCode, Bun alive

The milestone turns on one number: **how long until every run reaches a terminal status, and
does anyone have to intervene?**

```
14:53:37.000   Stop-Process -Name opencode -Force
14:53:37.725   agent 1 → failed      (+0.7s)
14:53:37.731   agent 2 → failed      (+0.7s)
14:53:37.735   agent 3 → failed      (+0.7s)
14:53:38.575   group   → failed      (+1.0s, exit 1)
```

**No human action was taken.** The Bun process detected the loss of each agent's event stream
and finalized each run on its own; the group rolled up from its agents without being asked.
A fourth agent had already failed at 14:53:33 for an unrelated provider reason (below).

### Per-agent survival

| Agent | Status | Events | Artifacts | Spend | Explanation recorded |
|---|---|---|---|---|---|
| `…M5PECX` | failed | 11 | 2 | $0.0336 | `The socket connection was closed unexpectedly` |
| `…M5PECY` | failed | 9 | 2 | $0.0256 | `The socket connection was closed unexpectedly` |
| `…M5PECZ` | failed | 11 | 0 | $0.0381 | `The socket connection was closed unexpectedly` |
| `…M5PED0` | failed | 5 | 0 | $0.0125 | `400 Corrupted thought signature` (pre-kill, provider) |

Group total: `failed`, exit 1, $0.1098, 4 artifacts.

**From SQLite alone you can reconstruct what each agent was doing and how far it got**: the
ordered event stream per agent, which agent produced each event (`@build` / `@general`), the
files each had written, tokens and cost per agent and rolled up to the group, and a truthful
reason for the ending. Files written before the kill survive on disk.

## 2. Recovery after a Bun crash (#7)

**2A — Bun killed, engine survives.** All 5 runs stayed `running` in SQLite. Orphans were
identified **10s** after the kill by dead-pid detection; `--dry-run` changed nothing. Then:

```
✔ …4G9P99 reattached  session still alive
✔ …4G9P9A reattached  it had already finished; its result was recovered
✔ …4G9P9B reattached  it had already finished; its result was recovered
✔ …4G9P9C reattached  session still alive
○ …239ED3 skipped     waiting for the 2 agents it just resumed
```

Two agents were resumed on a live stream and two were settled from session history — the
distinction matters, because an agent that finished *during* the outage would otherwise wait
forever for an idle event that had already passed. The group waited for the agents it
resumed, then rolled up. The orphaned server was reaped once unused (0 processes), and a
second `recover` was a clean no-op.

**Work survived the crash intact.** All four agents completed their tasks after recovery and
wrote working TypeScript — every check script they produced passes:

```
chunk.check.ts         exit 0
formatBytes.check.ts   formatBytes checks passed!
parseDuration.check.ts All parseDuration checks passed.
slugify.check.ts       All slugify checks passed.
```

**2B/3G — both processes killed.** Bun first, then the engine, with two agents mid-flight.
Both were closed `killed`/130 with the reason `its OpenCode server is gone`; the group rolled
up `killed`/130. Each agent kept **exactly one** `recover` event and **one** `end` event
alongside its 33 and 27 pre-kill tool events — nothing duplicated, nothing lost. `killed`
rather than `failed` is deliberate: the run was interrupted, it did not break.

**2C — no theft.** With a team genuinely running, `recover` from a second process reported
*"no runs were left open by a dead process"*. A beating owner is untouchable, so two AISET
processes cannot fight over each other's runs.

**3E — the engine's death does not poison the process.** A Bun process that lost its engine
launched again **1.7s** later on a fresh `opencode serve`, and that second group **succeeded**.
No stale pooled server.

## 3. What survives on each side

| | Survives | Evidence |
|---|---|---|
| AISET / SQLite | Full ordered timeline, per-agent attribution, artifacts, usage, ownership | `runs show --events` after every kill |
| OpenCode storage | The sessions themselves | All 4 killed sessions listed by a restarted server |
| Filesystem | Files agents had already written | `multi-agent-ts-tests/` intact |
| **The in-flight turn** | **No** | See below |

### What does not survive: the interrupted turn

A server restarted after the kill still knows every session. But the last assistant message
of a killed session reads:

```
messages: 8
last role: assistant | completed: false | finish: (none) | parts: (empty)
```

The turn was cut off and OpenCode did not resume it. Making progress would require sending a
**new prompt** — a new turn, not a continuation. Two further reasons AISET could not
re-attach here even if it wanted to: the run is already terminal, and the recorded
`server_url` points at a port a restarted engine no longer uses (it binds port 0).

## 4. Caveats

**A provider fault, not AISET's.** `400 Corrupted thought signature` failed three separate
agents across the session, independent of any kill. It is the model's reasoning chain
breaking between OpenCode and the provider. Worth noting that AISET's re-attach is strictly
**read-only** — `attach()` opens the event stream and never calls `prompt()`, so it cannot
corrupt a reasoning chain. Fix the model choice before any customer-facing demo; it depressed
agent success rates by roughly a quarter for reasons unrelated to this milestone.

**A recovered run's duration counts the time it was abandoned.** The 2B/3G group reads
`88m 55s` because its rows sat orphaned for 88 minutes before recovery ran; the agents worked
for about a minute. `duration = started_at → ended_at` is the honest definition, but the
number should not be read as work done.

**Not built: an HTTP "Bun server".** The milestone diagram names one. AISET is a CLI/TUI over
a long-lived Bun process, and everything this milestone validates works without an HTTP
endpoint. Flagged as a scope question, not a defect.

## 5. Verdict

### GREEN — with one limitation stated in the same breath

The deliverable asks: *can AISET reliably control and recover a multi-agent OpenCode
execution after the OpenCode process crashes?*

**On control and reconstruction, yes.** Killing the engine closed every agent and the group in
**under one second**, with no human action, no hung runs, and a truthful reason on each
record. Everything the agents did up to that instant — timeline, attribution, artifacts,
spend — is reconstructable from SQLite alone. Killing Bun instead is fully recoverable: 4/4
agents re-attached and ran to completion. Killing both leaves every run closed as `killed`,
never stuck. The surviving process relaunches cleanly, and nothing is left spending. This
meets the milestone's GREEN wording — *"recover/control the run"* — and the deliverable's
*"or reliably marked failed"*.

**Resuming an interrupted turn is not possible**, and would need an OpenCode-side mechanism —
which is precisely the milestone's AMBER wording, *"requires a small OpenCode plugin or
additional persistence mechanism"*. A reviewer who reads GREEN as requiring **resume** should
record this as **AMBER**.

The recommendation is GREEN on the question as written, with the resume limitation stated
plainly rather than averaged away. **The colour is the human's to set.**
