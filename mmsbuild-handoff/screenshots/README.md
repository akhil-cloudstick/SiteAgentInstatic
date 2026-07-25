# Screenshots — what was captured, and what wasn't

Captured 2026-07-20 against the **live running stack** via Playwright driving installed Edge
(Playwright's own browser cache was empty; no ~150MB download was performed).

Live at capture time: Operator control-plane `:4400`, operator console `:3000`, plan board `:8091`,
one provisioned tenant — Instatic `:3117`, OD daemon `:7500`, OD web `:8100`. The public gateway
(`:443`) was **not** running.

## Captured

| File | What it shows | Why it matters |
|---|---|---|
| `01-operator-console-dashboard.png` | Operator console — Tenants list + Add-tenant form | Shows the **Plan tier** dropdown ("Advanced — OpenDesign + Instatic (two cards)"), and a live tenant `Akhil / akhil` — Advanced, active, with "hub login" and live URL `atlasinfra.pages.dev`. This is the real operator surface. |
| `02-tenant-hub-one-login.png` | Tenant hub sign-in: *"One login for your design studio and CMS."* | The one-login hub that fronts both tools. |
| `04-open-design-home.png` | OpenDesign home, branded **"MMS Design — What will you design today?"** | The tenant's design entry point: prompt box, design-system selector, template cards (Slide deck / Prototype / Wireframe / Mobile app), community plugins. |
| `04b-open-design-projects.png` | OD Projects list — *"No projects yet."* | Confirms per-tenant isolation (this tenant's OD has its own empty project space). |
| `04c-open-design-onboarding.png` | OD onboarding route | |
| `05-instatic-admin-login.png` | Instatic admin login wall (tenant `atlasinfra`) | Instatic is reachable and provisioned; everything past this needs credentials. |
| `10-instatic-root-404.png` | Instatic root 404 | Instatic serves only `/admin` until a site is published. |
| `11-project-plan-board.png` | The `.serve` project-plan board | |
| `12-od-daemon-health.png` | OD daemon `/api/health` | Proves the daemon is up and separately addressable from OD web. |

`_capture-log.json` / `_capture-log-2.json` record each URL, HTTP status, final URL, and any error.

## NOT captured — and why

These were requested but could not be captured honestly. **None of them were faked or substituted.**

| Requested | Status | Reason |
|---|---|---|
| Client onboarding / project creation | **Does not exist** | There is no Client Lite Hub and no client onboarding wizard in the product. The closest real thing is the operator's Add-tenant form, visible in `01`. |
| Open Design connection/settings screen | **Blocked** | No such tenant-facing screen: the OD↔CMS connection is configured by the control-plane as env (`OD_INSTATIC_URL`, `OD_CMS_RULE_FILE`) at daemon spawn, not through a UI. |
| Open Design design/editing screen | **Blocked** | This OD instance has **zero projects**, so there is no design to open. Would require creating a project (an AI build run — a real side effect and cost). |
| Instatic CMS dashboard | **Blocked — auth** | Login wall (`05`). Requires tenant Owner credentials. |
| Instatic page editor / Visual Components | **Blocked — auth** | Same. |
| Template/layout library screen | **Does not exist** | There is no cross-tenant template catalog. `templateRule.md` is a file, not a UI; CMS templates live per-tenant behind the login. |
| Preview URL screen | **Blocked — auth** | Inside Instatic. |
| Publish/deploy screen | **Blocked — auth** | Inside Instatic; publish additionally requires a step-up gate. |
| Error / unfinished screen | **Partial** | `10-instatic-root-404.png` is a real 404. The more interesting one — the **CMS compliance block dialog** ("Your design looks great — one quick fix", Cancel / Fix it) — requires running a real Share-to-CMS on a non-compliant project. Not reproducible without building a project first. |

### To capture the rest

Two things are needed, both requiring a human decision:

1. **Tenant Owner credentials** for the `akhil` tenant, to get past the Instatic login. The password is
   stored **encrypted** by the control-plane; it was deliberately not extracted or used for this handoff.
2. **A real OD project** in the tenant's OpenDesign, to screenshot the editor, the Share-to-CMS action,
   and the resulting imported pages in the CMS canvas. Creating one runs the AI build agent (a real
   side effect, and it consumes the operator's AI budget).

Given credentials plus one built project, the full Share-to-CMS sequence (OD editor → Share → import
wizard → CMS canvas → Preview → Publish) is capturable in one pass.
