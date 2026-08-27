# SPIKE — OpenCode Lifecycle Control

| Field | Value |
|---|---|
| **Status** | **PROPOSED — awaiting human approval. BUILD must not start before a one-line OK.** |
| **Version** | v1 |
| **Date** | 2026-08-27 |
| **Type** | De-risking spike (not a WP; outside the WP1-WP6 sequence) |
| **Timebox** | 8-10 h agent-side (construction cost, tracked separately from WP hours) |
| **Human effort** | ~0.5 h (one demo run + read brief) |
| **Note** | Temporary location. Moves to its final home when the CLAUDE.md §2 scaffold is created during WP1 BUILD. |

## The de-risking question

Can AISET **control and recover** OpenCode execution lifecycles — start an agent/subagent run, observe it, capture its structured output, detect failure/timeout, and recover — all headlessly from a script? This is a hard dependency for WP4 (Agents V0.1) and WP5 (Measurement infra): if it is not possible, both must be re-planned.

The prior "AISET Thin POC" asked the right question but proposed a non-thin scope (full Next.js UI). This spike strips it to the question only.

## Scope

**IN**

1. One script (`tools/` when the scaffold exists, otherwise repo root): Bun + SQLite.
2. A minimal **OpenCode adapter** exposing four primitives: `start(task)`, `observe(runId)`, `capture(runId)` (structured outputs/artifacts), `kill(runId)`.
3. One trivial sample task (e.g., "write a function returning the sum of two numbers, with a test").
4. A lifecycle record written to SQLite: run id, start/end timestamps, events, exit status, captured artifact path, token cost if available.
5. One **injected-failure** demonstration: a second run is forced to time out; the script detects it and recovers (re-run) with the failure logged.
6. An **ADR** with verdict GREEN / AMBER / RED, with the evidence that supports it.

**OUT**

Full UI, agent specifications, WP4/WP5 deliverables, any production use, anything under `.opencode/`.

## Validation demo (defined now, before building)

One command, zero manual setup: `make spike-lifecycle`.

- **What the human observes (~10 min):** the script (a) starts a trivial OpenCode run headlessly, (b) streams lifecycle events to the console and writes them to SQLite, (c) then forces a timeout on a second run and shows detection + automatic recovery, (d) prints the GREEN/AMBER/RED verdict with its evidence.
- **Pass criteria:** start → output → complete **and** start → timeout → recover are both observable and recorded with no manual intervention; the verdict is produced and backed by the recorded evidence. A **RED** verdict is a valid, passing outcome — it answers the question and triggers WP4 re-planning.
- **Human time: ≤ 15 min**, brief included.

## Estimate

| Item | h |
|---|---|
| Probe OpenCode control surface (CLI/SDK/subagent invocation, headless) | 2 |
| Adapter primitives + SQLite lifecycle record | 3 |
| Injected-failure recovery demo | 1.5 |
| `make spike-lifecycle` target | 0.5 |
| ADR + brief | 1 |
| Buffer / unknowns | 2 |
| **Total agent-side** | **~10** |

## Documented assumptions

- The unknown is the deliverable: I do not assume OpenCode has a headless control surface. If only the CLI exists, the adapter shells out to it; if a programmatic SDK/HTTP surface exists, use it. RED is acceptable.
- Cost: the sample task consumes ordinary model tokens (trivial task, minimal). Tracked as construction cost (plan §5), separate from exercise cost.
- No guardrail is touched: the task is self-contained, uses no secrets, no external paid calls beyond normal token use, no DB migrations, no CI changes.
- A GREEN/AMBER/RED ADR is recorded in `architecture/decisions/` (directory created by this spike if the WP1 scaffold is not yet in place).
