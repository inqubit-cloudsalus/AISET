# WP1 PLAN — Documentation kernel

| Field | Value |
|---|---|
| **Status** | **PROPOSED — awaiting human approval. BUILD must not start before a one-line OK.** |
| **Version** | v1 |
| **Date** | 2026-08-26 |
| **Budget (plan §3.1)** | 12 h |
| **Estimate** | 11 h agent-side, ~1.5 h human |
| **Note** | Temporary location. Moves to its final home when the CLAUDE.md §2 scaffold is created during BUILD. |

## Scope

**IN** — four normative documents: `measurement/METRICS.md` (4 v1 metrics + appendix of deferred ones), `contracts/AGENT_CONTRACT.md`, `contracts/ARTIFACTS.md` (semantics of 5 artifacts + `schema_version` policy), `methodology/WORKFLOW.md` (9 steps, gates, rejection flow). Seven stubs of ≤15 lines: ARCHITECTURE, TEAM, FAILURE_TAXONOMY, EVALUATION, DEFINITION_OF_READY, DEFINITION_OF_DONE, ROADMAP. Plus `tools/check_coherence.py` and a `make validate-wp1` target.

**OUT** — real JSON Schemas (WP2; here only semantics, citing the `schemas/` filenames WP2 will implement), agent specifications and any `.opencode/` content (WP4), cost-per-task threshold values (plan §12, TBD #2).

## Definition of Done

1. The four normative documents cover every required field, nothing deferred to "later".
2. `make validate-wp1` exits green on the five coherence constraints.
3. The T-001 walkthrough is complete and committed under `methodology/examples/`.
4. Every cross-reference is a resolvable relative link; no duplicated content.
5. Validation brief of ≤1 page ready.
6. **The human closes the WP, not the agent.**

## Sample task for the demo — T-001 "coherence checker"

The walkthrough traces the construction of `tools/check_coherence.py` itself through WORKFLOW.md. Rationale: the artifacts are real (real spec, tests actually executed, real pytest output), the code already belongs to WP1 scope so it introduces no Scope Violations, and the task carries two genuine stress points that exercise the unhappy path:

- **Real ambiguity** — does "a cited rule" mean a textual match or an anchor link? Triggers the escalation clause of AGENT_CONTRACT.
- **A deterministic gate that fails** — the first version of the checker does not pass its own check. Exercises return-to-producer and the retry counter.

*Alternative if a more neutral task is preferred:* a fictitious task with illustrative artifacts — but the real test output is lost.

## Validation demo (defined now, before building)

One command, zero manual setup: `make validate-wp1`.

- **Part A — deterministic (~2 min).** The checker verifies five constraints: every artifact named in WORKFLOW exists in ARTIFACTS; every rule cited in WORKFLOW exists in AGENT_CONTRACT; every metric cited anywhere is defined in METRICS; no OpenCode reference inside kernel documents; every relative link resolves. Prints PASS/FAIL per constraint with file and line.
- **Part B — live walkthrough (~20 min).** T-001 is traced step by step along WORKFLOW.md, showing the artifact produced at each step and citing the contract clause governing it. The human interrupts at will.
- **Pass criteria.** Part A green; in Part B no step refers to a non-existent or contradictory artifact, role or rule; the rejection flow and the escalation are observable, not merely described. A single citation that does not resolve fails the demo.
- **Human time: ≤30 min**, brief included.

## Estimate

| Item | h |
|---|---|
| METRICS 1.75 · AGENT_CONTRACT 1.5 · ARTIFACTS 1.5 · WORKFLOW 2 | 6.75 |
| 7 stubs | 0.75 |
| `check_coherence.py` + make target | 1.25 |
| T-001 walkthrough | 1 |
| Self-check + coherence fixes | 1 |
| Validation brief | 0.25 |
| **Total agent-side** | **11 / 12** |
| **Human hours** (plan OK 0.25 · 2 checkpoints 0.5 · demo 0.25 · one revision round 0.5) | **~1.5** |

## Documented assumptions

- The constraint "no OpenCode reference outside `.opencode/`" is applied **to the kernel documents produced here**. The charter, the plan and the README cite OpenCode legitimately; including them would make the checker fail by construction on its first run.
- `tools/check_coherence.py` is not in the WP1 line of plan §3.1. It is added because CLAUDE.md §3 requires a single command with no manual setup. Declared cost: 1.25 h. Without it, Part A becomes manual and the demo exceeds 30 minutes.
- **Cost per Task** is defined formally (formula, unit, source) with the threshold left as an explicit TBD, due by week 2 per plan §12.
- Hour convention: the 12 h are the **human** currency of the WP; agent hours and API cost are tracked separately as construction cost (plan §5). Confirmed 2026-08-28.
- The FAILURE_TAXONOMY stub will designate Kepner-Tregoe (from the `agentic-skills-playbook` repo) as the failure-analysis method, by link. One line, inside the 15; no change to the estimate.
