## GREEN

Tested on `cf32b91` against the real engine with paid agents, and now covered by tests.

Details: `docs/MILESTONE-1-FINDINGS.md`. Procedure: `docs/MILESTONE-1-TEST-PLAN.md`.

## What I did

Launched 4 agents (2 `build`, 2 `general`) writing and self-testing TypeScript functions. Confirmed all four running at once as one group on a single shared `opencode serve`, let them work long enough to produce real state, then killed OpenCode and left Bun alive.

```
14:53:37.000   kill OpenCode
14:53:37.725   agent 1 → failed   (+0.7s)
14:53:37.731   agent 2 → failed   (+0.7s)
14:53:37.735   agent 3 → failed   (+0.7s)
14:53:38.575   group   → failed   (+1.0s, exit 1)
```

Everything reached a terminal status in under a second. Nobody ran `recover`, nobody ran `cancel`. Each run carries the reason it got from the engine: `socket connection was closed unexpectedly`.

## What survived

- **SQLite.** Per-agent event timeline, which agent produced each event, artifacts, and tokens/cost per agent plus rolled up to the group. Enough to reconstruct what each of the four was doing and how far it got without asking OpenCode anything.
- **Disk.** Files the agents had already written.
- **OpenCode's own storage.** All four sessions still show up in a server restarted afterwards.
- **Not the in-flight turn.** The last assistant message reads `completed: false`, no finish reason, no parts. Nothing picks it back up on its own — but see *Continuing a killed turn* below.

## Recover / reattach / resume / mark failed

| | |
|---|---|
| Recover state | Yes, fully, from SQLite |
| Reattach | Yes if Bun died and the engine lived — 4/4 re-attached, ran to completion, and the code they wrote passes its own checks. No once the engine itself is gone: the session record is there but the turn is dead, and the `server_url` on the run points at a port a restarted engine won't bind (it starts on port 0) |
| Resume the turn | Not the turn itself. But a fresh prompt into the same session continues the work — 2/2 tested |
| Mark failed | Yes, automatically, within a second, with the cause on the record |

Also checked: killing both processes leaves every run closed as `killed` / 130 rather than stuck, nothing is left spending, and a Bun process that lost its engine launched again 1.7s later on a fresh `opencode serve` whose group succeeded. No stale pooled server.

## Continuing a killed turn

Tested 2026-09-03. The four sessions from the kill are still in OpenCode's own SQLite, so I started a server by hand and prompted two of them directly with `curl` — no AISET code, no new crash staged, the `failed` rows left alone. A cleanly-finished session went first as a control.

One message: *"You were interrupted partway through the task above. Review what you had already done and finish it. Do not start over."* The `…M5PECX` agent replied:

```
I had already written multi-agent-ts-tests/slugify.ts and
multi-agent-ts-tests/slugify.check.ts, and was on the final step to run
bun run multi-agent-ts-tests/slugify.check.ts. Running the check now.
```

Correct, including the step it never reached. It then finished the task and its check passed. Same result on a second session. No `400 Corrupted thought signature`, despite both sessions carrying reasoning parts and a dangling zero-part assistant message at the tail.

Continuing costs about double the original turn (~$0.05 against ~$0.03) because the session replays as context. What it did **not** need was anything on the OpenCode side — no plugin, no extra persistence, no repair of the dangling message. What's missing is AISET code that doesn't exist yet: find a live server, confirm the session, open a follow-up run, send the prompt. The schema already expects it — `parent_run_id` is commented *"recovery re-runs link to the original"*.

Caveat: two sessions, both `build` agents, both interrupted between tool calls rather than mid-write. An agent killed halfway through writing a file may not come back this cleanly.

## Tests

The live run is one observation, so I backed the same path with tests:

- `test/opencode/adapter.test.ts` — *the engine dies mid-run*. A stream that breaks mid-flight closes the run `failed` / 1 on its own, records the engine's reason as the last thing written before `end`, keeps every pre-kill event with `seq` still contiguous along with its artifacts, usage and agent attribution, and releases the dead server exactly once. Plus the case where the engine dies before emitting anything.
- `test/opencode/group.test.ts` — *the shared engine dies under a whole team*. All streams break at once, every agent closes `failed`, the group rolls up `failed` / 1 with no `recover` call anywhere in the test, each agent keeps its own timeline and reason, and an agent that had already finished keeps its success.
- `test/opencode/pool.test.ts` — a team whose engine died leaves no stale pooled server; the next launch starts a fresh one even when stopping the dead process throws.

Nothing spawns OpenCode or opens a socket. Baseline: `typecheck` clean, `bun test` 189 pass (was 180), `bun run smoke` 44 checks.

## Verdict

GREEN on the question the deliverable asks, which is control and reconstruction.

The one limitation, in the same paragraph rather than a footnote: **the interrupted turn itself never resumes.** But the work behind it isn't lost — a new prompt into the same session picks it up accurately, and that needs no OpenCode plugin and no extra persistence, only AISET code we haven't written. So AMBER's wording, *"requires a small OpenCode plugin or additional persistence mechanism"*, doesn't fit the gap that's left.
