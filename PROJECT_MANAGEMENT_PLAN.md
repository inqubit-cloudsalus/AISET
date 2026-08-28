# PROJECT MANAGEMENT PLAN

## AI Software Engineering Team (AISET)

| Field | Value |
| :---- | :---- |
| **Version** | 1.0 (draft — 4 TBD points in sec. 12) |
| **Date** | August 28, 2026 |
| **Reference** | PROJECT_CHARTER v1.0 (approved 2026-08-28) |
| **Project Manager** | Massimiliano Corvino |
| **Approval required** | Sponsor + Gaurav, Hemant |
| **Funding** | Massimiliano Corvino (Sponsor) + Gaurav / Inqubit Systems and Technologies (co-funder) |

---

## 1. Introduction

This plan defines how the AISET project will be executed, monitored, controlled, and closed, in implementation of Project Charter v1.0. In case of conflict between this plan and the charter, the charter prevails; charter changes follow its section 11.

**Charter status:** PROJECT_CHARTER v1.0 was approved on 2026-08-28 by the Sponsor and both approvers (Gaurav, Hemant).

**Founding decision of the plan (recorded):** the sponsor chose to keep the 6-month horizon with availability < 5 h/week (~104 total estimated hours), **formally accepting the schedule risk** against a full-plan effort estimate of 250-400 hours. The plan manages this choice with three instruments: rigid timeboxing, a pre-defined scope-shedding ladder (sec. 3.3), and the use of AI agents to build the system itself (sec. 7.2).

**Operating principle:** dates do not move; scope flexes. Every milestone is a timebox with exit criteria distinguished into **minimum** (mandatory) and **target** (desirable).

## 2. Project baseline

- **Scope baseline:** deliverables D1-D7 of the charter, with priority and reducibility defined in sec. 3.
- **Schedule baseline:** 26 weeks, milestones as per sec. 4.
- **Cost baseline:** effort budget 104 **human** hours (~4 h/wk × 26); AI budget: TBD (sec. 12, tied to the funding agreement). Agent hours and API cost are tracked separately as construction cost.
- The baselines are changeable only through change control (sec. 11).

## 3. Scope management

### 3.1 First-level WBS

| WP | Content | Deliverable | Estimated hours |
| :---- | :---- | :---- | :---- |
| WP1 — Documentation kernel | Metrics, Agent Contract, Artifacts, Workflow; stubs of the other documents | D1 (partial), D2 (partial) | 24 |
| WP2 — Schemas and templates | run.schema.json + specification.schema.json complete; others in minimum version; evidence-driven PR and failure-issue templates | D2 | 10 |
| WP3 — Human baseline | Sample task selection, measurement, report | D6 | 8 |
| WP4 — Agents V0.1 | Platform-agnostic specifications + OpenCode implementation | D3, D4 | 26 |
| WP5 — Measurement infrastructure | Run logging, replay corpus, minimal eval suite, eval baseline | D5 | 22 |
| WP6 — Exercise & milestones | Use on real tasks, M2 and M3 reports, organizational decisions | D7 | 14 |
| **Total** |  |  | **104** |

The charter constraint (30-40% on measurement) is respected: WP5 + the measurement share of WP3/WP6 ≈ 34 hours.

### 3.2 Definition of Done of the work packages

A WP is closed when its deliverables pass the criteria defined in DoR/DoD (kernel document) and are versioned in the repository. No WP closes "verbally".

### 3.3 Scope-shedding ladder

If at the end of a timebox the minimum exit criteria are not achievable, scope reduces in this pre-defined order — decided now, in cold blood, not during the crisis:

1. **Step 1:** eval suite reduced to 5 scenarios; non-kernel documents remain stubs (ARCHITECTURE, extended TEAM, extended SECURITY)
2. **Step 2:** V0.1 agents from 5 to 3 (Orchestrator+Spec merged, Developer, Reviewer+QA merged) — the merge is itself a recorded organizational experiment
3. **Step 3:** M3 reduced to a demonstration of 2 concurrent workflows on simple tasks, organizational decisions deferred
4. **Step 4 (last):** M3 exits the horizon; the project closes at M2 with a final report and an extension proposal

**Non-reducible in any case:** mandatory run logging (run.schema.json), replay corpus, operational guardrails, M1 baseline. They are the core that makes the project different from a collection of prompts.

## 4. Time management

### 4.1 Schedule (26 weeks)

| Weeks | Phase | Content | Minimum exit criteria |
| :---- | :---- | :---- | :---- |
| 1-6 | **M0 + M1** | WP1, WP2, WP3 in parallel | Minimum kernel approved (Metrics, Agent Contract, Artifacts, Workflow); run.schema.json active; baseline documented |
| 7-10 | **M2a — Construction** | WP4: agent specifications + implementation | 3-5 agents operational on trial tasks; logging active from the first run |
| 11-17 | **M2b — Exercise** | WP5 + WP6: real tasks, eval suite, replay corpus | ≥2× on at least one task category vs baseline; corpus ≥90% of tasks; transition to evidence mode |
| 18-24 | **M3 — Parallelism** | WP6: concurrent workflows | 2-3 parallel workflows within the attention budget on simple tasks |
| 25-26 | **Closure** | M3 report, lessons learned, M4 proposal | Final report with metric comparison and decision on charter revision for M4 |

### 4.2 Schedule control

- Weekly progress check (integrated into the report, sec. 8) on GitHub Projects: hours spent, WP in progress, variance.
- **De-scoping trigger:** if at mid-timebox the estimated completion of the critical WP is < 50%, the next step of the ladder 3.3 is applied. The trigger is automatic, not negotiable on the spot — it avoids the "I'll recover next week" optimism.
- Buffer: no explicit buffer (incompatible with 104 h); the shedding ladder IS the buffer.

## 5. Cost management

- **Effort budget:** 104 **human** hours, tracked per WP on GitHub Projects (custom field "hours"). Agent hours and API cost are construction cost, tracked separately and not counted against the 104 h.
- **AI budget:** monthly cap and per-task threshold **TBD** (sec. 12), tied to the funding agreement between the Sponsor and Gaurav. Until defined: tracking of all API costs per run in the replay corpus (field provided by run.schema.json), no threshold enforcement.
- **Control:** effort variance > 20% on a WP → reported in the weekly report with a de-scoping or reallocation proposal.
- The AI cost of building the system (dogfooding, sec. 7.2) is accounted separately from the AI cost of exercise, so as not to pollute the cost-per-task metric.

## 6. Quality management

The quality of the *produced software* is governed by the kernel documents (Metrics, DoR/DoD, Evaluation) — this plan does not duplicate it. The quality of the *project deliverables* follows these rules:

- Every kernel document has a reviewer: the AI agents perform structured review (internal coherence, cross-references, completeness against the template), the sponsor approves.
- JSON schemas are validated with positive and negative examples committed alongside the schema.
- PRs to the AISET repository follow the evidence-driven template from the transition to evidence mode; before that, they require only description and link to an Issue.

## 7. Resource management

### 7.1 Human resources

One person (sponsor/PM/engineer), < 5 h/week. Operational consequences: no activity requires synchronization with third parties on the critical path; work sessions are 1-2 h blocks with a single objective defined in advance on GitHub Projects.

### 7.2 Dogfooding as a multiplier

The coding agents (open-source engines, e.g. OpenCode) are the resource that makes the plan feasible: the writing of schemas, logging tooling, eval runner, and documentation is delegated to the agents with human supervision. **Every AISET construction session is itself logged according to run.schema.json from the moment it exists** — the project becomes its own first case study, and the 104 human hours buy many more agent-hours.

**Engine validation spike:** the earlier "AISET Thin POC" was reduced and approved as the **OpenCode Lifecycle Spike** (GitHub milestone "OpenCode Lifecycle POC"; plan in [SPIKE_OPENCODE_LIFECYCLE_PLAN.md](SPIKE_OPENCODE_LIFECYCLE_PLAN.md), awaiting its own OK). It validates the open-source engine choice before WP4: Bun server + SQLite + OpenCodeAdapter; launch multi-agent OpenCode → kill → verify what survives, incl. Bun restart; outcome recorded as an ADR.

### 7.3 Tools

GitHub (repo, Issues, Projects, PR), OpenCode (target engine), open-source SAST/static analysis tooling, replay corpus storage. **Engine scope (decided):** open-source engine only — Claude Code/Cursor portability is out of scope (charter §4.2).

## 8. Communication management

| Communication | Frequency | Format | Effort |
| :---- | :---- | :---- | :---- |
| Report to approvers (Gaurav, Hemant) | Weekly | **Auto-generated** from GitHub Projects (WP progress, hours, available metrics, active risks) + 3-5 lines of PM commentary | ≤ 15 min/wk |
| Milestone report | At M0/M1, M2, M3 | Structured document with comparison vs baseline and decisions requested | Included in WP6 |
| Decision log | Continuous | ADR in the repository | — |

The automated weekly report is a WP5 deliverable (first 3 weeks in reduced manual form). Constraint: communication must not exceed 10% of the effort budget.

**TBD:** expected content for the recipients — depends on the real role of Gaurav and Hemant (sec. 12).

## 9. Risk management

### 9.1 Register (inherits from the charter, updated with planning decisions)

| ID | Risk | P | I | Response | Owner |
| :---- | :---- | :---- | :---- | :---- | :---- |
| R1 | **Available effort (104 h) insufficient for the chartered scope (250-400 h estimate)** | **Certain** | High | **ACCEPTED by the sponsor** (recorded decision, sec. 1). Management: timeboxing, ladder 3.3, dogfooding 7.2 | Sponsor |
| R2 | Human review load cancels out the gains | High | High | Review packages, selective escalation, attention budget | PM |
| R3 | Measurement infrastructure sacrificed under pressure | Medium | High | Non-reducible elements in 3.3; 30-40% protected hours | PM |
| R4 | AI review correlated with AI generation | High | High | Deterministic layer, model diversity, sentinel defects (post-M2) | PM |
| R5 | Insufficient data volume at M3 for organizational decisions | High | Medium | Decisions declared provisional below threshold; replay corpus | PM |
| R6 | Prolonged availability interruptions (CloudSalus/other project commitments) | Medium | High | Flexible timeboxes at start ±1 wk; beyond 2 weeks of stoppage → change request on schedule baseline | Sponsor |
| R7 | Provider model drift | Medium | Medium | Pinning, flakiness budget | PM |

### 9.2 Process

Register review at each weekly report ("active risks" field generated from GitHub labels); full re-evaluation at each milestone. A materialized risk generates an Issue with the `risk-materialized` label and, if it touches the baselines, a change request.

## 10. Stakeholder management

| Stakeholder | Strategy |
| :---- | :---- |
| Gaurav, Hemant | Gaurav = co-funder (Inqubit Systems and Technologies); Hemant = approver. Automated weekly report; decision involvement on baseline changes and charter revisions. **Reporting cadence and decision authority still TBD (sec. 12)** |
| Host projects | Selection of tasks compatible with confidentiality constraints; no client data in the shareable corpus |
| Community | No public communication before the M2 report (avoids premature promises) |

## 11. Change control and configuration management

- **Change request:** modification to scope/schedule/cost baseline → Issue with the `change-request` label, impact analysis (minimum 3 lines: effect on hours, milestone, risks), recorded sponsor decision. Changes touching the charter → charter sec. 11 (re-approval by Gaurav/Hemant).
- **Configuration management:** everything is in the Git repository; documents versioned via PR; schemas with `schema_version`; "AI team" releases tagged with changelog and metric comparison. No document lives outside the repo.
- The steps of ladder 3.3 **do not require a change request** (they are pre-approved with this plan); their application is only recorded in the weekly report.

## 12. Open points (blocking for final v1.0)

| # | Point | Impacts |
| :---- | :---- | :---- |
| 1 | Real role of Gaurav and Hemant and their expectations | Sec. 8, 10; possible revision of authority in charter. Partially resolved: Gaurav = co-funder (Inqubit); reporting cadence and decision authority still open |
| 2 | Monthly AI budget cap (€) and cost/task threshold | Sec. 5; METRICS.md. Tied to the funding agreement between the Sponsor and Gaurav |
| 3 | Host projects for the real tasks | Sec. 7, 10; confidentiality constraints; M1 task selection |
| 4 | Sample task set for the M1 baseline (exists or must be built) | WP3; reliability of all subsequent comparisons |

The plan is approvable in draft with these TBDs; the final v1.0 requires them resolved **within week 2** (point 4 blocks WP3, which is on the critical path).

---

*Approval: Sponsor \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Gaurav \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Hemant \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ · Date \_\_/\_\_/\_\_\_\_\_\_*
