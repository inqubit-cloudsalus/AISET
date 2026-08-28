# CLAUDE.md — AISET Project Instructions

Instructions for Claude Code working on the **AI Software Engineering Team (AISET)** project.
Reference documents: `PROJECT_CHARTER.md`, `PROJECT_MANAGEMENT_PLAN.md`. If anything in this file conflicts with them, the charter wins, then the plan, then this file.

## 1. Project context

AISET builds a measured, evidence-driven team of specialized AI agents for the SDLC on OpenCode. The human engineer (Massimiliano) supervises; you build. Total human budget is ~104 hours over 26 weeks, so every interaction with the human must be short, prepared, and worth his time.

Core principles you must never violate:
- **Deterministic verification before probabilistic verification.**
- **Artifacts over conversations** — structured, schema-validated outputs.
- **Everything logged** — every working session on this project is itself recorded per `schemas/run.schema.json` as soon as that schema exists (the project is its own first case study).
- **Quality is a constraint, not a trade-off.**

## 2. Initial setup

On first run, scaffold this structure (do not overwrite existing files; report diffs instead):

```
ai-software-engineering-team/
├── README.md
├── PROJECT_CHARTER.md          # provided
├── PROJECT_MANAGEMENT_PLAN.md  # provided
├── CLAUDE.md                   # this file
├── ROADMAP.md
├── architecture/
│   ├── ARCHITECTURE.md         # stub until WP1 decides otherwise
│   └── decisions/              # ADRs, incl. validation records
├── contracts/
│   ├── AGENT_CONTRACT.md
│   ├── ARTIFACTS.md
│   └── agents/                 # platform-agnostic agent specs (one file per agent)
├── methodology/
│   ├── WORKFLOW.md
│   ├── TEAM.md
│   ├── DEFINITION_OF_READY.md
│   ├── DEFINITION_OF_DONE.md
│   └── FAILURE_TAXONOMY.md
├── measurement/
│   ├── METRICS.md
│   └── EVALUATION.md
├── schemas/                    # JSON schemas, each with examples/valid/ and examples/invalid/
├── templates/                  # spec, adr, review-package, agent-failure-issue, evidence-driven PR
├── evals/
│   ├── scenarios/
│   ├── baselines/
│   └── results/
├── runs/                       # replay corpus (gitignored payloads, indexed metadata)
├── tools/                      # logging pipeline, validation scripts, report generator
└── .opencode/                  # ONLY place with OpenCode-specific content
    ├── agents/                 # derived from contracts/agents/ — never authored here
    ├── commands/
    └── skills/
```

Set up: GitHub Projects board with the 6 work packages (WP1-WP6 from the plan, custom field `hours`), Issue labels (`change-request`, `risk-materialized`, `agent-failure`, `validation`), PR template (evidence-driven format from the plan).

Formalization order (from charter M0): Metrics → Agent Contract → Artifacts → Workflow → Failure Taxonomy → Evaluation → Team → OpenCode implementation. Do not write later documents before earlier ones exist at least as approved minimums.

## 3. Work package lifecycle — MANDATORY

Every WP follows this state machine. **You may never skip or merge states, and you may never declare a WP done.** Only the human closes a WP.

```
PLAN → BUILD → SELF-CHECK → VALIDATION PACKAGE → AWAIT HUMAN VALIDATION → (APPROVED | REJECTED)
```

### PLAN (before any building)
Produce a short WP plan (≤1 page) containing:
- Scope of the WP and its Definition of Done
- **The validation demo, defined NOW**: exactly what the human will observe at the end, the command that launches it, and the pass criteria. The demo is designed before the work so it cannot be tailored to whatever happens to function.
- Hour estimate vs the plan's budget for that WP.

The human approves the plan (a one-line OK is enough). No approval, no build.

### BUILD
Do the work. Log the session. Commit in small, reviewable increments on a WP branch. Respect the guardrails in §5.

### SELF-CHECK
Run every deterministic check available (schema validation, linters, tests, the demo itself end-to-end). Fix what fails. The human must never be the first one to run the demo.

### VALIDATION PACKAGE
Prepare and present:
1. **One command** that launches the demo (`make validate-wpN` or equivalent). Zero manual setup. If setup is unavoidable, you script it.
2. A validation brief (≤1 page): what will be observed, expected behavior, what was NOT covered, known limitations, hours spent vs estimate.
3. The demo must be completable by the human in **≤30 minutes**, including reading the brief.

### AWAIT HUMAN VALIDATION
Stop. Do not start the next WP. Do not "prepare ahead" on the next WP's deliverables. You may fix bugs, improve docs of the current WP, or work on explicitly pre-approved parallel items.

### APPROVED / REJECTED
Record the outcome as an ADR in `architecture/decisions/` (template: `VAL-WPn`): date, what was observed, result, human's observations verbatim, follow-up issues opened. A REJECTED outcome is evidence, not failure: open issues for each gap, revise, return to BUILD. Rejections feed `FAILURE_TAXONOMY.md` once it exists.

## 4. Validation demos per work package

These are the practical observations the human performs. Each must be launchable with one command.

| WP | What the human observes (hands-on, not document reading) |
|---|---|
| **WP1 — Kernel docs** | A **walkthrough simulation**: you take a realistic sample task and trace it live through WORKFLOW.md step by step, producing each artifact the workflow names, citing the contract clause that governs each step. Validation fails if any step references an artifact, role, or rule that doesn't exist or contradicts another document. The human follows along and interrupts at will. |
| **WP2 — Schemas** | `make validate-schemas` runs validation over `examples/valid/` (all must pass) and `examples/invalid/` (all must be rejected **with a readable error naming the missing/wrong field**). The human then edits one valid example to break it and watches it get caught. |
| **WP3 — Baseline** | The human picks one task from the baseline set that *he* performed; you show the recorded measurements next to his own recollection/records. Numbers that don't match reality fail the validation. Then the full baseline report in one page. |
| **WP4 — Agents V0.1** | A **live run**: one small real task goes through the pipeline end-to-end while the human watches — spec produced, schema-validated, code written, tests run, review package generated. Then the **guardrail test**: you attempt a forbidden action (e.g., a mock secrets access or protected-branch merge) and the human watches it get blocked and escalated. A pipeline that only shows the happy path does not pass. |
| **WP5 — Measurement infra** | Three observations: (1) `make replay RUN=<id>` re-executes a logged historical run and the human compares outputs; (2) the weekly report generates itself from the Projects board in front of him; (3) a **sentinel test**: you inject one known defect into a review flow and the human observes whether the verification layer catches it — and at which layer. |
| **WP6 — Exercise & milestones** | The milestone report is walked through against raw data: for two claims in the report, the human picks them and you drill down live to the underlying runs in the corpus that support them. Claims that can't be traced to runs fail. |

If a WP's scope changes via the scope-shedding ladder (plan §3.3), the demo is re-scoped in the same PLAN-approval step — never silently.

## 5. Guardrails (from charter, active from day one)

Never, without explicit human approval in the current session: DB migrations or destructive data operations; reading/writing secrets or credentials; production deployments; CI/CD pipeline changes; merges to protected branches; external paid calls beyond thresholds; `git push --force`; deleting anything under `runs/` or `evals/baselines/`.

Additionally, for this meta-project: never edit `PROJECT_CHARTER.md` (any version) — charter changes go through its §11 and are made by the human; never mark GitHub issues/cards as Done for a WP awaiting validation; never rewrite a validation ADR after the fact.

## 6. Working style

- Sessions are 1-2h blocks with a single pre-defined objective from the Projects board. Start each session by stating the objective and the WP state; end it by updating hours and state.
- Ask questions in batch, at the start, only when genuinely blocked. Prefer documented assumptions (stated in the PR) over interruptions — the human's hours are the scarcest resource in this project.
- Write repository artifacts in English. Interact with the human in Italian.
- When the human's decision is needed, present options with a recommendation, never an open-ended question.
- Track your own token/API cost per session in the run log (construction costs are accounted separately from exercise costs — plan §5).

## 7. Current state

> Update this section at the end of every session.

**Last updated:** 2026-08-28

- **Active WP:** WP1 — Documentation kernel. State: **AWAITING PLAN APPROVAL**. The plan is in [WP1_PLAN.md](WP1_PLAN.md). BUILD has not started and must not start before a one-line human OK.
- **Hours:** convention confirmed — the 24 h of WP1 (and the 104 h total) are **human** hours; agent hours and API cost are tracked separately as construction cost (plan §5). WP1 estimated at 22 h agent-side + ~3 h human against the 24 h budget. Spent so far: 0 h of build, ~1.5 h human (estimate) across the sessions of 2026-08-25 and 2026-08-26.
- **Repository:** published at `inqubit-cloudsalus/AISET` (public) with the initial commit of 2026-08-27: `CLAUDE.md`, `PROJECT_CHARTER.md`, `PROJECT_MANAGEMENT_PLAN.md`, `README.md`, `.gitignore`, `WP1_PLAN.md`. License: **MIT** (`LICENSE`). `PROJECT_MANAGEMENT_PLAN.md` is now in English. The §2 scaffold does not exist yet — it is created during WP1 BUILD.

**Decided this session (2026-08-27):**

- Hour convention → **human hours** (confirmed; reporting convention, no ADR required).
- License → **MIT** (`LICENSE` added, README updated).
- `PROJECT_MANAGEMENT_PLAN.md` → **English** (translated, content unchanged).
- "AISET Thin POC" → reduced and approved as the **OpenCode Lifecycle Spike**. The spike is now tracked as the GitHub milestone "OpenCode Lifecycle POC" (Bun server + SQLite + OpenCodeAdapter; core experiment: launch multi-agent OpenCode → kill → verify what survives, incl. Bun restart). Outcome GREEN/AMBER/RED recorded as an ADR. Plan in [SPIKE_OPENCODE_LIFECYCLE_PLAN.md](SPIKE_OPENCODE_LIFECYCLE_PLAN.md), **awaiting approval** — no build before a one-line OK. Estimate: Hemant 3-4 h (my note: 4-6 h realistic).
- **Engine scope (decided via Hemant):** open-source engine **only** — Claude Code excluded. Already consistent with charter §4.2 (Claude Code/Cursor portability is out of scope). No ADR required, just a recorded principle.
- **Charter v1.0 confirmed by Hemant** (point 1 of the group message). His role/cadence is still vague ("seems good" — needs a concrete answer for the plan).
- **Funding:** the project is paid by Massimiliano **and Gaurav** (Gaurav = Inqubit Systems and Technologies, co-funder). His charter confirmation is therefore a funding gate, not a formality — POC start is blocked until his OK.
- **Standby (human decision, 2026-08-27):** wait for Gaurav's Project Charter confirmation before any further action — no BUILD, no POC start. State otherwise unchanged.

**Decided this session (2026-08-28):**

- **Charter v1.0 approved by Gaurav and Hemant** (both colleagues confirmed). The funding gate is open and POC start is unblocked. Recorded in [PROJECT_MANAGEMENT_PLAN.md](PROJECT_MANAGEMENT_PLAN.md) header + sec. 1; the plan itself remains draft (4 TBDs still open).
- `PROJECT_MANAGEMENT_PLAN.md` updated with the decisions taken since its creation: human-hours cost convention, engine scope (open-source only), funding (Massimiliano + Gaurav), OpenCode Lifecycle Spike, and the charter-approval status.

**Open — waiting on the human, raise these at the next session start:**

1. **OK on the WP1 plan.** Blocks all BUILD.
2. **OK on the Spike plan / milestone** (see above). Not blocking WP1.
3. **TBD #1** (plan §12) — concrete role and cadence of Gaurav/Hemant. Partially resolved: Gaurav = co-funder; still need reporting cadence and decision authority for both.
4. **TBD #2** (plan §12) — monthly AI cap and cost-per-task threshold. Now tied to the funding agreement between Massimiliano and Gaurav. Not blocking: METRICS.md defines Cost per Task formally with the threshold marked TBD.
5. **TBD #4** (plan §12) — baseline sample task set: does it already exist or must it be built? Blocks WP3, which is on the critical path; due by week 2.

**Proposed this session, not yet approved and not yet ADRs:**

- The `agentic-skills-playbook` repo (private, `inqubit-cloudsalus`) stays separate from AISET: it is a skills library, with no metrics, schemas, run logging or eval suite, so it does not shorten the kernel work. Its Kepner-Tregoe RCA prompt is proposed as the designated failure-analysis method, referenced by link from the FAILURE_TAXONOMY stub. Whether AISET agent specifications are published there is a WP4 decision requiring an ADR.
- Sample task for the WP1 demo: T-001, the coherence checker itself (see WP1_PLAN.md).
