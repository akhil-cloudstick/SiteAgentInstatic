# Open Design + Instatic Integration Summary

> Written 2026-07-20 from the repo at `S:\SiteAgentHub` (branch `Instatic_opendesign`).
> Authoritative source docs in-repo: `docs/integration/od-cms-vision.md`, `docs/integration/od-cms-compliance.md`,
> `docs/CHANGELOG.md`.
>
> ⚠️ **Two in-repo docs are stale — do not plan from them.**
> `docs/integration/phase5-share-to-cms-design.md` and the **2026-07-10** CHANGELOG entry both describe a
> **server-side** importer (a `SiteImportAdapter` at
> `server/handlers/cms/siteImport/applyPlan.ts` that committed the import on the server). That
> approach was **built, then deleted** in commit `9e13bf1` (2026-07-16): `applyPlan.ts` (-382),
> `classLinking.ts` (-97), `domPolyfill.ts` (-47) removed; `stagedImports.ts` (+59) and
> `useStagedSiteImportHandoff.ts` (+67) added. The shipped design is a **stage-then-browser-handoff**
> (described correctly in `od-cms-vision.md`). This file reflects the shipped code.

## What is connected now?

The repo is **three top-level modules**: `Operator/` (control-plane + operator console),
`Instatic/` (the CMS), `OpenDesign/` (the design studio). They are **separate products with
separate runtimes** — deliberately not merged.

The **Operator control-plane is the hub**. It is the tenant identity provider and the process
supervisor: it holds the tenant registry, issues one-time invite links, owns the hub session, and
spawns **per-tenant isolated instances** of both OpenDesign (its own daemon + its own Next.js web
server, own port, own data dir) and Instatic (own Postgres schema). A tenant logs in **once** and
sees a two-card home: "MMS Design" (OpenDesign) and "MMS CMS" (Instatic), each entered by SSO with
one click.

The two spokes are joined by **"Share to CMS"**: a tenant designs a site in OpenDesign, clicks one
button, and the design lands in their Instatic CMS as fully-editable pages — with **no duplicate
pages on re-share**. This is live and verified end-to-end on a real tenant project.

There is a **tier split**: `lite` = OpenDesign only; `advanced` = OpenDesign + Instatic.

## What does Open Design control?

- **design tokens:** yes — OD authors `:root { --x }` color tokens and `--font-*` tokens; these
  cross into Instatic as *editable* CMS color/font tokens on import.
- **layouts:** yes — OD is where the page is designed and laid out. OD is the **source of truth**;
  a re-share overwrites the CMS to match OD.
- **components:** partially — OD emits semantic HTML sections. Identical top-level
  `<nav>/<header>/<footer>` across pages are converted **by the importer** into shared Instatic
  Visual Components. OD does not author CMS Visual Components directly.
- **page sections:** yes — authored in OD as static HTML/CSS.
- **brand/style rules:** yes, but **constrained** by `Operator/rules/templateRule.md` — the build
  contract OD must obey 100%.
- **generation/editing flow:** yes — a tenant prompts OD's AI agent in natural language; OD builds
  the page. AI runs in **managed mode** through the operator's key-hiding gateway, so the real
  provider key never enters the tenant's OD process.

**Critical constraint — the "veg-kitchen" rule.** OD may only ever build what the Instatic importer
can consume. `templateRule.md` is read **live** by OD (`OD_CMS_RULE_FILE`, mtime-cached) and injected
into OD's system prompt — edit that one file and every tenant's OD picks it up with **no redeploy**.

## What does Instatic CMS control?

- **pages:** yes — canonical page storage (`pages` data rows), editable in the visual canvas.
- **posts/content:** yes — data tables, custom post types, forms.
- **Visual Components:** yes — canonical store (`components` rows). Created on import from repeated
  nav/header/footer.
- **templates:** yes — templates, post-type wrappers, saved layouts.
- **media/assets:** yes — imported images become content-hash-**deduplicated** `/uploads/` media
  assets.
- **preview:** yes — the CMS editing canvas and Preview.
- **publish:** yes — Instatic is the **sole publisher**. Publish bakes the site locally *and* ships
  to Cloudflare Pages.

## How does data move?

```
tenant prompt
  → OpenDesign AI builds a page (compliant-by-construction via templateRule.md)
  → "Share to CMS"  (OD daemon: POST /api/projects/:id/push/instatic)
      1. materialize images   — every referenced image becomes a real file under public/images/
                                (capture external URL / fetch royalty-free photo / SVG placeholder)
      2. normalize            — lossless mechanical fixes + makeVisibleWithoutJs on the CMS-bound copy
      3. compliance gate      — pass → continue;  fail → HTTP 422 → reassure-first dialog (Cancel | Fix it)
                                "Fix it" sends the jargon privately to the AI via context.agentInstruction
      4. SSO into the tenant's Instatic as Owner (control-plane-signed token) → capture session cookie
      5. POST the FileMap → Instatic  POST /admin/api/cms/import/site-html
         → Instatic STAGES the FileMap in memory and returns an opaque { token } (nanoid, 5-min TTL)
      6. OD returns { ok, redirectUrl } and redirects the TENANT'S BROWSER to
         {gateway}/admin/site?importToken=<token>
  → the tenant's BROWSER picks up the staged bundle (GET /admin/api/cms/import/staged/:token —
    single-use, burned on read, same-user enforced) and runs Instatic's OWN real import wizard
    client-side: buildImportPlan + commitImportPlan — the exact code path the manual
    Ctrl+K → Import Site wizard uses. There is exactly ONE importer.
      → pages matched to existing pages BY SLUG → overwritePage (same id) → upsert  ⇒ NO DUPLICATES
      → repeated <nav>/<header>/<footer> across ≥2 pages → promoted to shared Visual Components
  → tenant lands in Instatic /admin — pages fully editable in the canvas
  → Preview
  → tenant clicks Publish
  → Instatic bakes + POSTs a token-authenticated webhook to the control-plane (POST /deploy/<token>)
  → control-plane deploys to Cloudflare Pages with the OPERATOR's token (token never enters the tenant)
  → live .pages.dev URL lands in the deploys registry, visible in the operator console
```

**The acceptance bar** (non-negotiable, from `od-cms-vision.md`): a Share-to-CMS result must be
**identical to a manual Import-Site of the same project** — pixel-perfect in the CMS *editable*
canvas *and* on the published page, fully editable on both sides, responsive, all images loading,
and no duplicates on re-share.

## What is manual today?

- **Tenant creation** — the operator adds a tenant in the console and shares an invite link.
- **The whole MMSBUILD client journey** — onboarding wizard, diagnosis, revival plan, approvals,
  reports. **None of it exists.** Today the tenant logs directly into OD/Instatic; there is no
  Client Lite Hub.
- **Reading an old website** — done by hand. A person (or an AI agent) rebuilds the old site
  following `templateRule.md`. There is **no crawler**.
- **Approval** — there is no approval step. Publish goes straight live.
- **Design-level compliance repair** — auto-repair covers mechanical issues; a genuine design-level
  violation still needs the tenant to click **Fix it** and re-share.

## What is automated today?

- Per-tenant provisioning of OD (daemon + web) and Instatic, incl. Owner account creation.
- One-login SSO from the hub into either tool.
- **Share to CMS end-to-end**, including no-duplicate re-push (verified: re-push → `replaced`,
  `inserted=0`).
- **Image materialization** — no image API key needed; zero broken links, provider-free.
- **Visible-without-JS repair** — no more blank pages in the CMS editor.
- **Compliance gate + one-click AI self-heal** with the jargon hidden from the tenant.
- **Publish → Cloudflare Pages deploy**, operator token never exposed.
- **Managed AI** — operator's single key/model powers every tenant; model changes apply live with
  no tenant restart.
- Live `templateRule.md` propagation to every tenant with no redeploy.

## What is not working yet?

- **OD web runs via `next dev`, not a production build** — deliberate workaround for an upstream
  **Next.js 16.2.6** bug ("Expected workStore to be initialized" while prerendering the root route).
  Not a blocker; the flow is fully working this way.
- **OD's "bring your own key" box is still visible** — cosmetic, not a security hole (the secure
  half is done). Hiding it must land *together with* routing OD's in-browser chat through the
  gateway, else in-editor chat would have no key.
- **Scale ceiling** — one Postgres comfortably holds only ~5–8 tenants at `max_connections=100`.
- **No image/video generation at all** — fal.ai is not connected, so the Resource Control Plane
  governs AI chat only, not media.
- **No Firecrawl / no crawler**, **no WhatsApp**, **no Asset Vault**, **no Approval Engine**,
  **no Report Engine**, **no Client Lite Hub**.
- **Site Agent Library** — the *mechanism* (Instatic plugin system + Visual Components) exists and
  works; the actual salon-ready library of sections does not exist.

## What changed compared to the old plan?

The MMSBUILD plan (`docs/platform/mmsbuild-project-plan.md`, dated 2026-07-06) **does not model OpenDesign at
all**. It mentions "Hermes/Open Design/Codex-style specialist agents" once, in passing, in §9 as one
of several possible agent surfaces. Everything below is new since that plan was written:

1. **OpenDesign is now a real, connected, first-class spoke** — not an optional agent surface. It is
   per-tenant, isolated, SSO'd, operator-AI-governed, and wired into the CMS by a verified pipeline.
2. **A design→CMS contract exists and is enforced in three layers** (`templateRule.md` prevention →
   deterministic share-time repair → compliance gate with AI self-heal). The plan's Phase 5
   "Template Library Engine" assumed agents building from blueprints; the real system instead
   constrains a *generative* design tool to an importer-safe output contract.
3. **The plan's "Instatic Adapter" is largely built** — provisioning, draft creation, preview,
   publish, and Cloudflare deploy all work. Phase 2 is mostly done.
4. **A tier model exists** (`lite`/`advanced`) — the plan's §4.3 "advanced editor for power users"
   split is implemented at the control-plane, not inside Instatic.
5. **The hub is real but is an *infrastructure* control-plane, not the *product* hub the plan
   describes.** It orchestrates processes, identity, AI keys, and deploys. It has no client/project
   records, no workflow state machine, no approvals, no reports.
6. **"Site Agent Library" needs re-scoping.** The plan positioned it as the answer to "stop agents
   building from blank." OD's generative flow + `templateRule.md` now covers a large part of that
   need. What remains valuable is the *curated section library*, not the whole engine.
7. **Media generation moved further away, not closer.** The plan assumed fal.ai. In practice the
   image problem was solved deterministically and provider-free (capture / royalty-free fetch /
   placeholder) because no image provider was configured.
