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
| 6 | Can a killed turn be *continued* with a new prompt? | **PASS** — 2/2 sessions, work finished, checks pass |

Baseline at the same commit: `typecheck` clean, `bun test` 180 pass, `bun run smoke` 44 checks.

**Since written up**, the #9 path is covered by tests rather than by this one observation:
a stream that breaks mid-flight closing the run `failed`/1 unaided with its state intact
(`test/opencode/adapter.test.ts`), a whole team's shared engine dying and the group rolling
up on its own (`test/opencode/group.test.ts`), and no stale pooled server left for the next
launch (`test/opencode/pool.test.ts`). `bun test` is now **189 pass**. #7 was already covered
by the 20 tests in `recover.test.ts` and `ownership.test.ts`.

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

*(See §6 — the turn does not resume, but the work behind it can be continued.)*

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

**The interrupted turn itself does not resume** — OpenCode will not pick it up, and nothing in
AISET can make it. But §6 shows the work behind it is not lost: prompting the killed session
with *"continue where you stopped"* had both agents correctly recall what they had written and
which step they were on, then finish the job with their checks passing. That needed no OpenCode
plugin and no additional persistence — only AISET code that has not been written yet.

So the milestone's AMBER wording, *"requires a small OpenCode plugin or additional persistence
mechanism"*, does not describe the remaining gap. **GREEN** on the question as written, and on
the stricter reading too: the state recovers, and so does the work.

## 6. Follow-up (2026-09-03): a killed turn *can* be continued

Section 3 says the interrupted turn does not survive. That is still true — OpenCode does not
resume it, and the dangling assistant message stays dangling. But "the turn cannot resume
itself" turned out not to mean "the work is lost", and the difference decides the colour, so
it was worth testing.

**Method.** No new crash was staged. The four sessions from the 2026-09-02 kill are still in
`~/.local/share/opencode/opencode.db`, so a server was started by hand on port 4141 and the
killed sessions were prompted directly with `curl`. No AISET code ran; the `failed` rows in
`.aiset/aiset.db` were left untouched. A cleanly-finished session from the same day was
prompted first as a control, to prove the setup and the credits before drawing conclusions.

**What the killed session looked like going in** (`ses_f9d6422d8ffeYdysrtsEWSfqXm`, the
`…M5PECX` slugify agent): 8 messages, the last one `completed:(none) finish:(none)` with
**zero parts** — created at the instant of the kill, cost 0, tokens 0. Its six working
messages carried `reasoning` parts, which is what made the `400 Corrupted thought signature`
fault a real risk here. The transcript shows it had already written both `slugify.ts` and
`slugify.check.ts` and was about to run the check when the engine died. Both files had since
been deleted by the 2026-09-02 cleanup, so the agent's belief about the workspace was stale.

**The prompt.** One message: *"You were interrupted partway through the task above. Review
what you had already done and finish it. Do not start over — continue from where you stopped.
Begin your reply by stating which files you had already written and which step you were on."*

**What happened.** Accepted with `204`. No thought-signature error. Its first words:

```
I had already written multi-agent-ts-tests/slugify.ts and
multi-agent-ts-tests/slugify.check.ts, and was on the final step to run
bun run multi-agent-ts-tests/slugify.check.ts. Running the check now.
```

Exactly right, including the step it never got to. It then ran the check, found the files gone,
re-created them, re-ran the check, and finished `finish: stop` with the assertions passing.

**Repeated on a second session** (`ses_f9d6422cdffe3QxUN9f4AX38j4`, the `…M5PECY` chunk agent,
6 messages) with the same prompt: same accurate recall of both files and the pending step,
same completion, `bun run multi-agent-ts-tests/chunk.check.ts` → *All assertions passed*.

| | Original turn | Continuation |
|---|---|---|
| `…M5PECX` slugify | $0.0336 | $0.0517 · 10 messages · 54,929 input tokens |
| `…M5PECY` chunk | $0.0256 | $0.0515 · 10 messages · 56,179 input tokens |

**What this changes.** Continuing costs roughly double the original turn, because the whole
session replays as context. But nothing OpenCode-side was needed: no plugin, no extra
persistence, no repair of the dangling message. OpenCode already keeps everything required.
What is missing is AISET code that does not exist yet — find a live server for the workdir,
confirm the session, create a follow-up run, send a continuation prompt. The schema already
anticipates the shape: `parent_run_id` is commented *"recovery re-runs link to the original"*.

So AMBER's wording — *"requires a small OpenCode plugin or additional persistence mechanism"* —
does not describe this gap. Recovery of the **work**, not just the state, is reachable with
ordinary work in our own codebase.

**Caveats, stated plainly.** Two sessions is two data points, both `build` agents on
`google/gemini-3.7-flash` via OpenRouter, both interrupted between tool calls rather than
mid-write. An agent killed with a half-written file, or one whose last step had side effects,
may not recover as cleanly — re-running is not always safe. And this was still a *new turn*:
the model re-derived its position from the transcript rather than picking up a suspended one.
That distinction matters for cost, not for outcome.
