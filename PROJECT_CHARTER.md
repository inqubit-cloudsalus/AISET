# PROJECT CHARTER

## AI Software Engineering Team (AISET)

| Field | Value |
| :---- | :---- |
| **Project name** | AI Software Engineering Team (AISET) |
| **Charter version** | 1.0 |
| **Date** | August 25, 2026 |
| **Sponsor** | Massimiliano Corvino |
| **Project Manager** | Massimiliano Corvino |
| **Approvers** | Gaurav, Hemant |
| **Status** | Pending approval |

---

## 1\. Purpose / Business Case

Organizations and professionals developing software currently use AI agents as individual assistants, obtaining real but limited and unmeasured productivity gains. Existing multi-agent frameworks (MetaGPT, ChatDev, Devin, OpenHands) promised full autonomy and largely failed to deliver, for three recurring reasons: architectures justified by analogy with human teams rather than by evidence, unmanaged human supervision costs, and the absence of rigorous measurement.

AISET addresses this gap: building a coordinated team of specialized AI agents for the SDLC whose **organizational structure, effectiveness, and cost are subject to continuous experimental measurement**, with the human engineer remaining responsible for objectives, critical decisions, and final approval.

**Expected value:**

- **Direct:** measured amplification of a single engineer's development capacity (progressive target 2-3× → 10× north star), at equal or better quality and economically sustainable cost.  
- **Strategic:** a reproducible replay corpus and an experimental platform for agentic software engineering — a differentiating asset relative to the state of the art, reusable for consulting, applied research, and potential derived products.

## 2\. Measurable Objectives and Success Criteria

| \# | Objective | Metric | Target | Verification |
| :---- | :---- | :---- | :---- | :---- |
| O1 | Establish the human capacity baseline without the system | Lead time, defect rate, hours/feature on a sample task set | Documented baseline | End of M1 |
| O2 | Amplification on well-scoped tasks | Lead time vs baseline, at equal defect rate and rework | ≥ 2× | End of M2 |
| O3 | Sustainable parallel supervision | Concurrent workflows per engineer; human time per task | 2-3 workflows; ≤ defined attention budget | End of M3 |
| O4 | Economic sustainability | AI cost per completed task | ≤ threshold per task category (defined in METRICS.md) | Ongoing from M2 |
| O5 | No quality degradation | Defect rate, regressions, security findings vs baseline | ≤ baseline | Ongoing |
| O6 | Operational replay corpus | % of production tasks archived in replayable form | ≥ 90% | Ongoing from M2 |
| O7 | Evidence-driven improvement | % of significant changes (prompts, routing, schemas, models) with a complete evidence chain | 100% in evidence mode | From end of M2 |

**Overall success criterion:** the project is successful if O1-O5 are achieved relative to the baseline on the same task types. The 10× is explicitly declared a **non-binding north star**: no project milestone depends on reaching it.

## 3\. High-Level Requirements

1. A team of specialized agents coordinated by an Orchestrator that activates the minimum effective combination of specialists per task (complexity, risk, domain, dependencies) and selects the cheapest sufficient model.  
2. Agent collaboration through structured, machine-verifiable artifacts (versioned JSON schemas), not through free-form conversations.  
3. Deterministic verification (schema validation, static analysis, SAST, tests) always prioritized over probabilistic verification (LLM review); model diversity between generation and review where possible.  
4. Human supervision designed as a first-class component: standard review packages, selective escalation, measured attention budget, workflow dashboard.  
5. Every production run archived in complete, reproducible form (**counterfactual replay corpus**): repo snapshot, spec, configuration, outcomes.  
6. Operational guardrails: no agent executes without human approval DB migrations, secrets handling, production deployments, CI/CD changes, merges to protected branches, or spending beyond thresholds.  
7. Platform-agnostic agent specifications with an adapter layer toward OpenCode; an agent's spec contains no platform references.  
8. Two-level measurement system: end-to-end workflow metrics from day one, per-agent scorecards only once the data supports reliable attribution.  
9. A sentinel-defects mechanism to continuously measure the detection power of the verification system.  
10. Two declared operating regimes: **exploration mode** (pre-M2: free changes, mandatory logging per run.schema.json) and **evidence mode** (once the eval suite is active: the Observation→Evidence→Issue→Hypothesis→Change→Evaluation→Result→Decision chain is mandatory for every significant change).

## 4\. Project Description and Boundaries

### 4.1 In Scope

- Design and implementation of the documentation and contract kernel: Charter, Metrics, Agent Contract, Artifact Contract, Workflow, Failure Taxonomy, Evaluation, Team.  
- V0.1 implementation on OpenCode with **5 agents**: Orchestrator, Requirements/Spec, Developer, QA/Test, Reviewer.  
- Additional roles (Security, Architect, Frontend, Backend/Data, DevOps) defined as specifications but activated **only** when evals demonstrate their value (quality, cost, human attention). The organizational structure is itself an object of experimentation: role mergers and splits are data-driven decisions.  
- Measurement infrastructure: versioned schemas, eval suite, baselines, replay corpus, evidence-driven PR templates, Agent Failure Issues with a mandatory failure\_category field.  
- Use on the sponsor's real development projects as the primary source of evidence.

### 4.2 Out of Scope (V1)

- Implemented multi-platform support (Claude Code, Cursor): portability is guaranteed at the contract level, not delivered.  
- Autonomy without human approval on the defined gates.  
- Multi-tenancy / use by external teams.  
- Publication of the contract format as an open standard (strategic option post-V1).  
- Graphical interfaces beyond the minimal supervision dashboard.

## 5\. Key Deliverables

| Deliverable | Description |
| :---- | :---- |
| D1 — Documentation kernel | PROJECT\_CHARTER, ROADMAP, ARCHITECTURE \+ ADRs, AGENT\_CONTRACT, ARTIFACTS, WORKFLOW, TEAM, DoR/DoD, FAILURE\_TAXONOMY, METRICS, EVALUATION |
| D2 — Schemas and templates | schemas/ (specification, task, review, test-report, run) with schema\_version and compatibility policy; templates/ (spec, ADR, review-package, agent-failure-issue, evidence-driven PR) |
| D3 — Agent specifications | Platform-agnostic specifications for the 5 V0.1 agents \+ reserve roles |
| D4 — OpenCode implementation | .opencode/ (agents, commands, skills) generated/derived from D3 through the adapter |
| D5 — Measurement infrastructure | Eval suite (scenarios, baselines, results), run logging pipeline, replay corpus |
| D6 — M1 baseline | Baseline report on human capacity pre-system |
| D7 — Milestone reports | M2 and M3 reports with metrics vs baseline and organizational decisions taken |

## 6\. Summary Milestone Schedule

| Milestone | Horizon | Exit criteria |
| :---- | :---- | :---- |
| **M0 — Kernel** | Month 0-1 | D1+D2 approved; formalization order: Charter → Metrics → Agent Contract → Artifact Contract → Workflow → Failure Taxonomy → Evaluation → Team → Implementation |
| **M1 — Baseline** | Month 0-1 (parallel) | Documented baseline on the sample task set (D6) |
| **M2 — Vertical amplification** | Month 2-4 | ≥2× on well-scoped tasks at equal quality; replay corpus active; transition to evidence mode |
| **M3 — Parallelism** | Month 5-6 | 2-3 concurrent workflows within the attention budget; first data-driven organizational decisions (role activation/merger) |
| **M4 — Scale** | Month 6+ (beyond charter horizon) | Extension to complex tasks; organizational configuration experiments via replay. Activated only through charter revision after M3 |

The transition from exploration mode to evidence mode is a declared milestone (within M2), not a drift.

## 7\. Pre-Approved Budget and Resources

| Item | Allocation |
| :---- | :---- |
| Human effort | Sponsor/PM part-time; overall project horizon **6 months**, with M2 at month 4\. **Declared constraint: 30-40% of total effort allocated to measurement infrastructure** (D5), on pain of failure of the evidence-driven model |
| AI costs | Monthly token/API budget with per-task threshold (values in METRICS.md); cost is a design constraint of the Orchestrator |
| Infrastructure | OpenCode, GitHub repository, open-source SAST/static analysis tooling, replay corpus storage |
| Spending authority | The PM is authorized to spend within the defined monthly budget; overruns require sponsor review |

## 8\. High-Level Risks

| Risk | P | I | Response |
| :---- | :---- | :---- | :---- |
| Human review load cancels out the gains | High | High | Supervision as a designed component: review packages, selective escalation, measured attention budget |
| Evidence-driven discipline unsustainable for a single person | High | High | Dual exploration/evidence regime; mandatory logging as the only initial constraint; tooling (PR templates) instead of goodwill |
| 6-month horizon insufficient to accumulate statistical evidence by M3 | High | Medium | Replay corpus from day one; M3 organizational decisions declared provisional if data volume is below threshold (thresholds in EVALUATION.md); M4 subject to charter revision |
| Insufficient data volume for statistically honest decisions | High | Medium | Replay corpus (every task replayable N times); EVALUATION declares which decisions can be made at which data volumes; high-frequency proxies for rare events |
| AI review correlated with AI generation errors | High | High | Deterministic layer first, model diversity, sentinel defects |
| Measurement infrastructure abandoned under delivery pressure | Medium | High | 30-40% budget declared in the charter; initial metrics limited to 3-4 actually collectable |
| Model evolution makes role separations obsolete | Medium | Medium | Organizational structure subject to evals: the system measures its own obsolescence and simplifies itself |
| Provider model drift breaks comparability | Medium | Medium | Pinning where possible, flakiness budget, suite re-execution on version changes |
| OpenCode lock-in | Medium | Medium | Platform-agnostic specifications \+ adapter; any waiver only via an explicit ADR |

## 9\. Stakeholders

| Stakeholder | Role | Interest/Influence |
| :---- | :---- | :---- |
| Massimiliano Corvino | Sponsor, PM, supervising engineer | Decisions, approvals, execution |
| Gaurav | Charter approver | Formal approval; review of charter changes |
| Hemant | Charter approver | Formal approval; review of charter changes |
| Host projects | Source of real tasks | Direct beneficiaries; impose quality and confidentiality constraints |
| Technical/research community | Potential recipient of results and corpus | Reputational influence; future adoption of the contract format |
| AI providers (Anthropic, others) | Model suppliers | Technological dependency; drift risk |

## 10\. Assumptions and Constraints

**Assumptions:**

- The sponsor's real projects provide a sufficient task flow (estimated 10-30/month).  
- OpenCode maintains the required native capabilities (agents, subagents, permissions, project instructions).  
- Providers allow a degree of model pinning sufficient for eval comparability.

**Constraints:**

- Quality is a constraint, not a trade-off: no speed gain is accepted at quality below the baseline.  
- Operational guardrails (req. 6\) active from day one; the list may only be tightened automatically — any relaxation requires a recorded human decision.  
- Every significant change in evidence mode requires the complete evidence chain.  
- Host projects' data and code handled according to their confidentiality constraints; no client data in any public corpus.

## 11\. Project Manager Authority

The PM is authorized to: define and modify kernel documents within the boundaries of this charter; activate/merge/split agents based on evals; approve spending within budget; declare the exploration→evidence mode transition once the criteria are met.

The following require charter revision (sponsor and approvers): changes to objectives O1-O7, scope boundaries, overall budget, or waiver of portability.

## 12\. Approval

This charter formally authorizes the AISET project, the use of the resources indicated, and the start of phase M0 according to the defined formalization order. First technical document: **METRICS.md**, followed by **AGENT\_CONTRACT.md**.

The charter takes effect upon approval by all signatories. Changes requiring charter revision under section 11 require re-approval by Gaurav and Hemant.

| Role | Name | Signature | Date |
| :---- | :---- | :---- | :---- |
| Sponsor | Massimiliano Corvino | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_ /\_\_\_\_ /\_\_\_\_\_\_ |
| Project Manager | Massimiliano Corvino | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_ /\_\_\_\_ /\_\_\_\_\_\_ |
| Approver | Gaurav | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_ /\_\_\_\_ /\_\_\_\_\_\_ |
| Approver | Hemant | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_ /\_\_\_\_ /\_\_\_\_\_\_ |

