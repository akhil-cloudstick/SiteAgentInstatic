# Questions Answered

Answers verified against the code on branch `Instatic_opendesign` @ `a6db789` (2026-07-20).

## 1. Is Open Design called directly from the app, or through a backend adapter?

**Through a backend adapter — the OD daemon.** The browser never talks to Instatic directly during a
share. The OD web UI POSTs same-origin to its own daemon (`POST /api/projects/:id/push/instatic`,
`server.ts:2809`); the daemon does the server-to-server work (SSO + push).

**But there is a deliberate third step: a browser handoff.** The daemon does *not* perform the import.
It stages the bundle and hands an opaque token back, and the **tenant's browser** runs the actual
import. So the shape is: browser → OD daemon → (server-to-server) Instatic stage → browser → Instatic
import wizard.

**Transport is plain HTTP.** No MCP, no shared filesystem, no message queue.

## 2. Is Instatic embedded, linked, or controlled through an API/MCP/tool layer?

**Linked, plus a thin API.** Instatic is a **separate product with its own runtime** — an explicit
invariant (`od-cms-vision.md`: "Do not merge them"). It is not embedded in OD.

Three linkage mechanisms:
- **SSO link** — the hub's "MMS CMS" card and OD's share both mint an Owner session via
  `GET /admin/api/cms/sso`.
- **A 2-endpoint ingest API** — `POST /admin/api/cms/import/site-html` (stage) and
  `GET /admin/api/cms/import/staged/:token` (burn-on-read pickup).
- **An outbound webhook** — `INSTATIC_DEPLOY_WEBHOOK` on publish.

**Not MCP.** No MCP layer exists between OD and Instatic.

## 3. Where is the canonical project state stored?

**Split, by lifecycle stage — and this is the single most important architectural fact.**

| State | Home |
|---|---|
| Tenant registry, users, ports, tiers, deploys | Operator control-plane (Postgres, `ADMIN_DATABASE_URL`) |
| The **design** (project files on disk) | That tenant's **OpenDesign** data dir (`OD_DATA_DIR`, forced to local disk — SQLite can't run on the SMB share) |
| The **site** (pages, components, media, tokens) | That tenant's **Instatic** Postgres schema |
| The **published** site | Cloudflare Pages |

**OD is the declared source of truth for design** — a re-share overwrites the CMS to match OD. But
once imported, the tenant can also edit in the CMS canvas, and **those CMS-side edits are destroyed by
the next re-share.** There is no merge-back and no conflict detection. This is a real, unresolved
product question, not a bug.

## 4. Where are templates stored?

Two different things share the word:
- **The build contract** — `Operator/rules/templateRule.md`, a single file on the operator's disk,
  read live by every tenant's OD (`OD_CMS_RULE_FILE`, mtime-cached).
- **CMS templates / wrappers / saved layouts** — inside each tenant's Instatic database.

There is **no shared template catalog** and **no cross-tenant library**. The MMSBUILD plan's
"Template Catalog" does not exist.

## 5. Where are Visual Components stored?

In each tenant's **Instatic** database (`components` data rows). They are **not** authored in OD.

They are **created by the importer**: `commitPlan.ts:125`/`:477` detect `<nav>/<header>/<footer>` that
are structurally identical across ≥2 pages and promote them to a `VisualComponent`, replacing each
page's section node with a `base.visual-component-ref` module (`:518`).

Consequence worth flagging: **Visual Components emerge as a side-effect of repetition**, not from
authored intent. A design with only one page produces none.

## 6. Can Open Design output be saved into Instatic automatically?

**Yes — this is the shipped, verified core feature.** One click, no manual steps, and critically
**no duplicates on re-share**: `buildImportPlan` matches an imported page to an existing page **by
slug**, and `commitImportPlan` then calls `overwritePage` (reusing the id) instead of `addPage`, so the
rows upsert. Verified: first push imports; re-push → `replaced`, `inserted=0`.

Two caveats:
- **Lite tenants can't.** `odRuntime.mjs:81` only sets `OD_INSTATIC_URL` when `tenant.instaticUrl`
  exists, so a lite tenant's Share button is inert.
- **The browser must complete the handoff.** The staged bundle has a **5-minute TTL** and is
  **single-use**. If the tenant closes the tab, the share is lost and must be redone.

## 7. Can Instatic preview/publish be triggered from the app?

**Preview:** yes, it's just the CMS canvas.

**Publish: not by an exposed API today, but yes in effect through the SSO side door.**
`POST /admin/api/cms/publish` requires capability `pages.publish` **and** `requireStepUp`. However
`sso.ts` mints an Owner session with **step-up already satisfied** (`stepUpExpiresAt: expiresAt`) —
because the hub is the identity provider, so local re-authentication is impossible. So **any holder of
the SSO secret can mint a session that passes the publish gate.** Nothing calls this today, but the
capability is effectively already there — and it is a security property worth an explicit decision
rather than an accident.

Publish → Cloudflare **is** fully automated: Instatic bakes, POSTs a token-authenticated webhook to
the control-plane, which deploys with the **operator's** Cloudflare token (never exposed to the tenant).

## 8. What approval steps exist today?

**None.** There is no approval engine, no draft-review gate, no client sign-off. A tenant with publish
capability publishes straight to the live web.

The only thing resembling a gate is the **compliance gate** — and it gates *importability*, not
*content quality*: pass → continue; fail → 422 + a reassure-first dialog (Cancel | Fix it) where "Fix
it" sends the technical detail privately to the AI via `context.agentInstruction` while the tenant sees
a short friendly message.

## 9. What roles exist today?

Three, and they are **not** the plan's client/operator/admin triad:

1. **Operator** — uses the Astro console; adds tenants, sets the AI key/model, holds the Cloudflare
   token. ⚠️ `/operator/*` is served **unauthenticated** on the public funnel.
2. **Tenant** — one login to a hub with two cards. Tiered: `lite` (OD only) / `advanced` (OD + CMS).
   Inside Instatic they are the **Owner**.
3. **Instatic sub-users** — the tenant can create custom roles from ~36 capability toggles for their
   own staff.

**There is no "client" role** distinct from "tenant", and **no operator-review step** anywhere. Note
Instatic's real **Owner role can never be restricted** — it resets to full permissions on every server
restart — so a genuinely restricted Lite login needs a *custom role*, not Owner. Provisioning creates
Owner today.

## 10. What still requires manual operator work?

- Adding each tenant and sending the invite link.
- **Reading an old website** — entirely by hand. A person or agent rebuilds it against
  `templateRule.md`. No crawler exists.
- Everything in the MMSBUILD client journey: onboarding, diagnosis, revival plan, QA, approval,
  reporting.
- Starting the stack (three terminals, three package managers).
- Design-level compliance repair (the tenant clicks Fix it and re-shares).

## 11. What breaks if Open Design is unavailable?

**Design authoring stops; the CMS keeps working.** Instatic keeps serving, editing, and publishing —
Instatic was built first and stands alone. A lite tenant loses their entire product (OD is all they
have). Already-published sites are on Cloudflare and are unaffected.

## 12. What breaks if Instatic is unavailable?

**Everything downstream of design.** Share-to-CMS fails at the SSO step; there is no publishing path at
all (Instatic is the sole publisher); an in-flight staged bundle expires in 5 minutes and is lost.
Design work in OD continues but has nowhere to go. Already-published sites stay up.

**Asymmetry worth stating plainly:** OD depends on Instatic; Instatic does not depend on OD.

## 13. What should the updated MMSBUILD plan REMOVE because this integration solved it?

1. **Phase 2 "Instatic Integration" — mostly done.** Provisioning, tenant mapping, draft creation,
   preview, publish trigger, and Cloudflare deploy all work. Reduce to "wire into Hub client/project
   records".
2. **"Design output → CMS" as unsolved work.** It is built, verified, and idempotent (no-duplicate
   re-share). Remove any plan item proposing a *second* importer or a server-side conversion — an
   explicit invariant is that exactly **one** importer exists, and a server-side variant was already
   built and **deliberately deleted** (`9e13bf1`).
3. **Most of the "Template Library Engine" (Phase 5) premise.** The plan assumed agents assembling from
   blueprints to avoid blank-page output. OD's generative flow + `templateRule.md` already covers that.
   Keep the *curated section library*; drop the *engine*.
4. **Site Agent Library as a large phase.** Re-scope to a content deliverable (a salon section pack),
   not infrastructure — Instatic's plugin/Visual Component mechanism already exists and works.
5. **fal.ai as the answer to "we need images".** The image problem was solved **deterministically and
   provider-free** (capture external / fetch royalty-free / SVG placeholder). fal.ai becomes an
   enhancement, not a dependency.
6. **AI key governance / managed AI** — built. Key-hiding gateway, per-tenant signed tokens, live model
   changes with no restart.
7. **The plan's assumption that tenants log into Instatic directly as the only door.** The tier split
   and one-login hub already exist.

## 14. What should the updated MMSBUILD plan ADD because this integration creates new capability?

1. **Promote OpenDesign to a first-class spoke in the Hub & Spokes diagram.** It is currently absent
   from the visual architecture (mentioned once, in passing, in §9). It is per-tenant, isolated, SSO'd,
   AI-governed, and wired to the CMS. The diagram is materially wrong without it.
2. **Model the OD→CMS contract as a first-class subsystem** — `templateRule.md` + three enforcement
   layers (prevention in the prompt → deterministic share-time repair → gate with one-click AI
   self-heal). This is the load-bearing mechanism for design quality and has no counterpart in the plan.
3. **Resolve the source-of-truth conflict.** OD is declared authoritative and a re-share **overwrites**
   the CMS — but the tenant can also edit in the CMS canvas, and those edits are silently destroyed on
   the next share. No merge-back, no conflict detection, no warning. **This is the biggest unresolved
   product question and it needs a decided policy**, not a technical fix.
4. **Add "generative design" as a client journey step.** The plan's journey goes crawl → blueprint →
   assemble. Reality adds: tenant prompts OD in natural language → OD builds → share. The revival
   workflow diagram needs this branch.
5. **Add the compliance-failure UX to the journey.** The 422 → reassure-first dialog → "Fix it" → AI
   edits source → re-share loop is a real user-facing state the plan doesn't model.
6. **Re-scope the "Hub".** The control-plane is an *infrastructure* hub (processes, identity, keys,
   ports, deploys). The plan's Hub is a *product* hub (clients, projects, workflow state, approvals,
   reports). Decide whether these are one system or two — currently the plan implies one and reality
   has only the first.
7. **Add the tier model (`lite`/`advanced`) to the plan** — it exists in code and drives real behavior
   (a lite tenant's Share button is inert).
8. **Add publish-trigger as an available capability** (via the SSO session), and make the step-up
   bypass an explicit, reviewed decision.
9. **Add these to the risk register:**
   - CMS-side edits lost on re-share (no merge-back)
   - `/operator/*` unauthenticated on a public funnel
   - SSO session bypasses publish step-up
   - Staged imports in-memory/per-process (5-min TTL, single-use, blocks horizontal scaling; a closed
     tab loses the share)
   - OD web on `next dev` not a production build (upstream Next 16.2.6 bug)
   - ~5–8 tenant ceiling on one Postgres
   - Secrets on disk (`Operator/.env`, `Instatic/_creds.ts`)
   - Visual Components emerge from repetition, not intent — single-page designs produce none
10. **Revise the MVP build order** to start from what exists: OD design → share → CMS → publish is a
    working spine **today**. The fastest path to the MMSBUILD promise is to add the Client Lite Hub,
    an approval step, and a report on top of that spine — *not* to start with Firecrawl/fal.ai, which
    remain blocked on accounts that still don't exist.
