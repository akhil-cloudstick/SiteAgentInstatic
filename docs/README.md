# SiteAgentHub — documentation index

Every **cross-product / monorepo-level** document lives here, grouped by subject.
Product-internal docs stay inside their product (see [Where else docs live](#where-else-docs-live)).

| Folder | What's in it |
|---|---|
| [`platform/`](#platform) | MMSBUILD product vision, the client's plan, scale & tenancy |
| [`architecture/`](#architecture) | SiteAgent build plan, runtime topology, DB design, glossary, pending work |
| [`integration/`](#integration) | OpenDesign ↔ CMS — "Share to CMS", the build rule, compliance |
| [`instatic/`](#instatic) | MMS-CMS (Instatic) — admin re-skin design masters |
| [`opendesign/`](#opendesign) | MMS-Design (OpenDesign) — shared web build |
| [`upgrades/`](#upgrades) | Vendored-fork upgrade runbooks, reports and version comparisons (both products) |
| [`connector/`](#connector) | MMS Connector + per-site MCP endpoint |
| [`operator/`](#operator) | Operator-facing setup runbooks |
| [`client/`](#client) | Client-facing handover notes |
| [`CHANGELOG.md`](./CHANGELOG.md) | Plain-language log of what changed, newest first |

---

## platform

The product itself — what MMSBUILD is meant to be, and how far today's code is from it.

| File | Read it for |
|---|---|
| [`mmsbuild-platform-vision.md`](./platform/mmsbuild-platform-vision.md) | The full target: Super Admin → Operator → Client → Project hierarchy, containers, role workflows |
| [`mmsbuild-vision-vs-today.md`](./platform/mmsbuild-vision-vs-today.md) | The same target put next to the current code, section by section |
| [`mmsbuild-product-hub-os.md`](./platform/mmsbuild-product-hub-os.md) | The client's architecture poster, transcribed and redrawn |
| [`mmsbuild-project-plan.md`](./platform/mmsbuild-project-plan.md) | The client's original plan (2026-07-06) |
| [`mmsbuild-user-cycle-flowchart.md`](./platform/mmsbuild-user-cycle-flowchart.md) | The client journey, as a flow chart |
| [`mmsbuild-final-plan-review.md`](./platform/mmsbuild-final-plan-review.md) | The client's plan explained back in plain words, with what exists vs doesn't |
| [`mmsbuild-scale-architecture.md`](./platform/mmsbuild-scale-architecture.md) | Storage & tenancy as it grows: one DB or many, cells, noisy-neighbour limits |

## architecture

How SiteAgent is actually built and what is still outstanding. *(Promoted from `Operator/docs/` — these were never Operator-only.)*

| File | Read it for |
|---|---|
| [`PLAN.md`](./architecture/PLAN.md) | The whole-project plan |
| [`PLAN_V1.md`](./architecture/PLAN_V1.md) | The v1 slice that ships first |
| [`Architecture.md`](./architecture/Architecture.md) | Runtime topology — what runs where |
| [`DB-Architecture.md`](./architecture/DB-Architecture.md) | Control-plane schema, schema-per-tenant decision |
| [`CONTEXT.md`](./architecture/CONTEXT.md) | Glossary — the canonical vocabulary used by every other doc |
| [`Diagrams.md`](./architecture/Diagrams.md) | Two simple pictures: what runs where, and the human journey |
| [`UserFlow.md`](./architecture/UserFlow.md) | The end-to-end experience for each actor |
| [`PENDING.md`](./architecture/PENDING.md) | Remaining work, phased |
| [`reviews/`](./architecture/reviews/) | Adversarial plan reviews: [instructions](./architecture/reviews/PLAN-REVIEW-INSTRUCTIONS.md), [log](./architecture/reviews/PLAN-REVIEW-LOG.md), [round 2](./architecture/reviews/plan_review_2.md) |

## integration

The seam between the two products — the part that breaks first.

| File | Read it for |
|---|---|
| [`od-cms-vision.md`](./integration/od-cms-vision.md) | How OD and the CMS relate, and the "Share to CMS" acceptance bar |
| [`od-cms-compliance.md`](./integration/od-cms-compliance.md) | Why OD only builds what the CMS imports; the accept/block matrix and failure playbook |
| [`phase5-share-to-cms-design.md`](./integration/phase5-share-to-cms-design.md) | Build spec for the no-duplicate Share-to-CMS push |
| [`import-compliance-fixes.md`](./integration/import-compliance-fixes.md) | Field report: what went wrong on a real import batch |
| [`templateRule-STALE-SNAPSHOT.md`](./integration/templateRule-STALE-SNAPSHOT.md) | ⚠️ History only. The **live** rule is [`Operator/rules/templateRule.md`](../Operator/rules/templateRule.md) |

## instatic

MMS-CMS specifics. Product-internal docs stay in [`../Instatic/docs/`](../Instatic/docs/).

| File | Read it for |
|---|---|
| [`CMS-New-ui.md`](./instatic/CMS-New-ui.md) | The admin-wide re-skin plan, all 7 screens, light + dark |
| [`cms-new-ui-review/`](./instatic/cms-new-ui-review/) | The approved design masters (PNG) those screens are built against |

## opendesign

MMS-Design specifics. Product-internal docs stay in [`../OpenDesign/docs/`](../OpenDesign/docs/).

| File | Read it for |
|---|---|
| [`opendesign-shared-web-build.md`](./opendesign/opendesign-shared-web-build.md) | One shared `/design` build, session-routed per tenant (shipped 2026-08-04) |

## upgrades

Both vendored forks, together — the runbooks reference each other.

| File | Read it for |
|---|---|
| [`instatic-upgrade-runbook.md`](./upgrades/instatic-upgrade-runbook.md) | Version-agnostic procedure for any future Instatic release |
| [`instatic-0.0.16-upgrade-report.md`](./upgrades/instatic-0.0.16-upgrade-report.md) | Latest Instatic upgrade + customization ledger |
| [`instatic-0.0.14-upgrade-report.md`](./upgrades/instatic-0.0.14-upgrade-report.md) | Prior Instatic upgrade |
| [`instatic-version-comparison.md`](./upgrades/instatic-version-comparison.md) | Instatic 0.0.7 → 0.0.14 preflight comparison |
| [`opendesign-upgrade-runbook.md`](./upgrades/opendesign-upgrade-runbook.md) | Version-agnostic procedure for any future OpenDesign release |
| [`opendesign-0.20.0-upgrade-report.md`](./upgrades/opendesign-0.20.0-upgrade-report.md) | Latest OpenDesign upgrade |
| [`opendesign-0.16.1-upgrade-report.md`](./upgrades/opendesign-0.16.1-upgrade-report.md) | Prior OpenDesign upgrade + customization ledger |
| [`opendesign-0.16.1-test-plan.md`](./upgrades/opendesign-0.16.1-test-plan.md) | Post-upgrade test pass |
| [`opendesign-version-comparison.md`](./upgrades/opendesign-version-comparison.md) | OpenDesign 0.14.x → 0.16.1 comparison (superseded) |
| [`upgrade-2026-08-20-pre-existing-failures.md`](./upgrades/upgrade-2026-08-20-pre-existing-failures.md) | Baseline failures on both products, captured before the 2026-08-20 merges |

## connector

| File | Read it for |
|---|---|
| [`mms-mcp.md`](./connector/mms-mcp.md) | One MCP endpoint per site — scoped agent access to a tenant |
| [`connect-an-ai-agent.md`](./connector/connect-an-ai-agent.md) | How to give an AI assistant access to a client site |
| [`connector-guide.html`](./connector/connector-guide.html) · [`connector-plan.html`](./connector/connector-plan.html) · [`connector-mcp.html`](./connector/connector-mcp.html) · [`connector-handover.html`](./connector/connector-handover.html) | Rendered connector guides |

## operator

| File | Read it for |
|---|---|
| [`operator-import-setup.md`](./operator/operator-import-setup.md) | Path B — the one-time setup after a site replica is imported into a tenant |

## client

Client-facing handover material.

| File | Read it for |
|---|---|
| [`01-import-path.md`](./client/01-import-path.md) → [`06-capability-matrix.md`](./client/06-capability-matrix.md) | The numbered handover set: import path, entry templates, SEO & taxonomy, publishing, what changed, capability matrix |
| [`note-to-client-gnt-structure.md`](./client/note-to-client-gnt-structure.md) | Reply on the GNT build revisions |

---

## Where else docs live

Not everything belongs here. These stay put on purpose:

| Location | Why it is not in `docs/` |
|---|---|
| [`../Instatic/docs/`](../Instatic/docs/) | Vendored upstream doc tree (already organised into `features/`, `reference/`, `deployment/`, `e2e/`). Moving it would break the upgrade diff against upstream. |
| [`../OpenDesign/docs/`](../OpenDesign/docs/) | Same — pure upstream, no MMS-specific docs in it. |
| [`../Operator/rules/templateRule.md`](../Operator/rules/templateRule.md) | **Live config, not documentation.** OpenDesign reads it at run time via `OD_CMS_RULE_FILE`. |
| [`../mmsbuild-handoff/`](../mmsbuild-handoff/) | A frozen hand-off bundle — kept as delivered. |
