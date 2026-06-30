# Plan: SiteAgent — Full Project (Instatic fleet platform)
_Locked via /grill-me-codex Act 1 — by Claude + Dineshraj. Replaces the Payload-based plan. This is the **entire-project** plan; the v1 slice that gets built first lives in [`PLAN_V1.md`](PLAN_V1.md)._

## Context
SiteAgent is being rebuilt on **Instatic CMS** (https://github.com/corebunch/instatic) instead of Payload. Research of Instatic's docs/README established:
- **MIT-licensed, standalone, single-site** visual CMS (TypeScript/Bun). MIT ⇒ resell/white-label/host-as-a-service is legally clean.
- **Already includes** the AI agent (BYO key incl. **OpenRouter**), visual editor, drafts/versions, **RBAC (36 capabilities)**, an **audit log**, and **static publishing** (renders its own HTML/CSS to disk).
- **NOT multi-tenant** (one install = one website) and **NOT embeddable** (standalone `Bun.serve`; admin-only HTTP API; built-in agent not externally drivable).
- **Maturity & automation surface (confirmed by client demo):** Instatic is **v0.0.6 pre-alpha** — expect API churn. Automation = the **HTTP admin API only** (cookie+CSRF, capability-gated, **TOTP step-up** on some ops like import/replace); **no MCP, no content/import CLI** (only a plugin-dev CLI). The **AI agent is browser-bridged** (29/35 of its 35 tools require a live editor session) — usable by tenants in-browser, **not headless-drivable** by us. **Super Import**: analysis is headless but **commit routes through the browser GUI**; **motion-heavy HTML/JS is kept as an opaque page-scoped script blob, not editable canvas nodes** (canvas edits can desync).
- **No Astro:** Instatic builds *and* renders tenant sites itself — there is no separate site framework and **no headless content API**. Astro from the old plan is dropped entirely. (Astro is used **only** for our own Operator Console.)

**Therefore** the product is a **fleet of per-tenant Instatic instances** managed by a **SiteAgent Operator Console**, with each tenant's published static site deployed to **Cloudflare Pages**.

## Hierarchy
**1 Admin (Operator)** → **N Tenants** (each = one isolated Instatic instance; the **Tenant Admin** is its Owner) → **M sub-users** per tenant (Instatic users + per-user audit log).

## Tech stack (locked)
- **Operator Console:** **Astro (SSR + islands)**, Node adapter (self-hosted on the VPS). React/Svelte islands for live dashboard widgets.
- **Control-plane services:** Node/Bun (Provisioner, Publish Deployer, AI Gateway, Metrics Collector).
- **Databases:** **PostgreSQL** — a **single shared database**, **one schema per tenant** (+ scoped role pinned via `search_path`), plus a `siteagent_control` schema for the Registry.
- **Tenant CMS:** Instatic (Docker, **pinned image**), Postgres backend (its own **schema** in the shared DB) per tenant.
- **Publish target:** **Cloudflare Pages** via `wrangler` Direct Upload.
- **Reverse proxy:** Caddy/Traefik (auto-TLS) for editing-domain routing.

## Terminology (replaces the ambiguous "brain")
- **SiteAgent Operator Console** — ONE, global, admin-only (the `operator/` side). Holds no tenant content.
- **Tenant Instatic Instance** — ONE per tenant; isolated (own container, own Postgres **schema** in the single shared DB, own uploads disk). All editing/agent/publishing happens here.
- **Control-plane services** — Provisioner, Publish Deployer, Metrics Collector, AI Gateway, Registry (all under `operator/`).

## Folder / naming convention (two main folders; slug is the single key)
The tenant **slug** is reused everywhere: container/compose project, schema name (in the single shared DB), uploads folder, Cloudflare project, editing subdomain, metrics, AI tag.
```
siteagent/
  operator/                 # ADMIN side — everything the Operator runs
    ui/                     #   Astro SSR console + islands (tenants · settings · usage · health)
    api/                    #   console backend (Astro server endpoints / small API)
    control-plane/
      provisioner/          #   provisionTenant(), lifecycle (idempotent)
      deployer/             #   publish-volume watcher → Cloudflare Direct Upload
      metrics/              #   collector: storage, health, deploys, AI usage
      ai-gateway/           #   OpenRouter proxy + per-tenant metering
      registry/             #   control-plane DB (Postgres) + migrations
    instatic/
      image/                #   pinned Instatic image ref + compose templates
      plugins/              #   optional publish.html asset-URL rewrite plugin
  tenants/                  # per-tenant runtime — ONE section per tenant
    <slug>/
      compose.yaml          #   rendered per tenant (DATABASE_URL → the shared DB, scoped to its schema)
      uploads/              #   media + published/ (baked site) — bind-mounted
      tenant.json           #   slug, owner, cf project, ports, schema name, secret refs
```

## Roles model (per the Operator's spec)
- Exactly **one predefined role per tenant: "Tenant Admin" (full access)** = Instatic **Owner**.
- Tenant Admin creates **custom roles via per-permission toggles** (each toggle = one of Instatic's 36 capabilities; native Admin→Roles editor, `roles.manage`, `capabilities_json`).
- Instatic's other system roles (Admin/Client/Member) **re-sync on boot** → we **suppress/relabel** them so only "Tenant Admin" + custom roles show. _← spike gate 5._
- Example custom roles: Editor (`content.edit.any`+`content.create`+`site.content.edit`, no publish); Publisher (`content.publish.any`).
- **Per-user audit log** (`audit.read`), isolated to the instance → Tenant Admin sees their team's activity.

## Admin depth: usage dashboards + monitoring (no billing, no enforcement)
Per tenant: storage (Postgres **schema** size + `uploads/` media size), # pages, # sites, # users, **AI usage (tokens/cost)** via the AI Gateway, deploy count + last publish + live URL, instance health (container up/down, CPU/mem), recent failures. Plus a fleet overview and **alerts** on provision/deploy/health failures. *(Plan limits, enforcement, billing = explicitly out of scope.)*

## AI usage attribution: one global key, per-tenant tagging
- One global **OpenRouter key + model** (Operator-set in the console).
- **AI Gateway** (control-plane proxy): each instance's OpenRouter base URL → `…/ai/<slug>`; the gateway injects the global key, **tags + meters tokens/cost per tenant**, forwards to OpenRouter, feeds the dashboard. **Security property (required, whole project): the real key lives ONLY with admin in the gateway — it is never stored in any tenant instance, so neither a tenant nor their AI can read it.**
- Fallback if Instatic rejects a custom base URL: force the instance's outbound AI traffic through the gateway at the **network level** (still hides the key); per-instance **`X-Title`** only adds coarser attribution. _← spike gate 4._
- **Gateway hardening:** the per-tenant gateway URL carries a **cryptographically signed token** (not a guessable slug); the gateway validates the signature + the tenant's active status on every call, so a leaked URL can't be replayed/abused. Add a **per-tenant rate/usage guard** to bound runaway cost (the global key has no spend cap — this guard is the only thing stopping a tenant from running up the bill through normal use). Ensure AI calls originate **server-side (the tenant container backend), not the browser**, so the token/URL never appears in browser network logs. _← verify in spike 4. (plan_review_2 #4/#5.)_

## Architecture
```
   operator/  —  Astro SSR console + control-plane services (on the VPS)
     settings(key+model) · tenants+links · usage/health dashboards · alerts
        │ Provisioner   Publish Deployer   Metrics   AI Gateway   Registry(Postgres)
        ▼
  Tenant Instatic instance (Docker, :3001)  ── DATABASE_URL ─►  single shared Postgres DB: schema <slug>
     uploads/ (media + published/) bind-mounted on host
     agent → AI Gateway → OpenRouter
        │ tenant clicks Publish → bakes uploads/published/current
        ▼
  Publish Deployer (fs.watch) → wrangler pages deploy → Cloudflare Pages project per tenant
        ▼
  live URL (*.pages.dev or custom domain)
  Caddy/Traefik → <slug>.<editing-domain> → instance:3001 (editing access, auto-TLS)
```

## Modules / build breakdown
1. **Operator Console (`operator/ui` + `operator/api`)** — Astro SSR: global settings (OpenRouter key+model), tenant CRUD + share links, usage/health dashboards (live islands), fleet overview, alerts.
2. **Provisioner** — `provisionTenant()` (ordered, idempotent saga): using the **single admin Postgres credential**, create the tenant's **schema + least-privilege role** in the single shared DB — isolation **enforced by GRANT/REVOKE** (`REVOKE ALL ON SCHEMA public FROM PUBLIC`; grant `USAGE`/`CREATE` on **its own schema only**, never cross-grant; `search_path` is convenience, **not** the boundary), so the tenant container reads/writes **only its own schema** while the **admin/owner role** retains cross-schema visibility (Operator sees all). → create `uploads/` dir + `INSTATIC_SECRET_KEY` + role password → render per-tenant compose (DATABASE_URL → shared DB, tenant role, own schema) → `docker compose up -d` (Instatic migrates into its schema) → **headless first-run** (create Tenant Admin/Owner with **email + password**; the tenant sets their **own 2FA** after first login; point OpenRouter provider at the AI Gateway + set model) → create the Cloudflare Pages project (namespaced **`siteagent-<slug>-<rand>`**; store the returned URL) → record in Registry. Each step **check-then-act keyed by slug** with a Registry **state machine** (`db_ready→up→seeded→cf_ready→done`); first-run **guarded** (skip if Owner exists); **cleanup-on-failure walks back completed steps**. Plus deprovision/suspend (drop role + schema cleanly), **fleet upgrade** (re-pull pinned image, **sequential** rolling restart — concurrent migrations against one shared DB contend on catalogs), **backup/restore** (per-tenant `pg_dump -n <schema>` + `uploads/`).
3. **Publish Deployer** — detect a *completed* bake via an **immutable `uploads/published/<timestamp>/` + completion marker** (or an Instatic publish hook), not just `fs.watch` quiescence (unreliable cross-platform, can fire mid-write), then `wrangler pages deploy <timestamp-dir> --project-name=siteagent-<slug>-<rand>` (Direct Upload), record deploy + URL. Plus **custom-domain** wiring (CF custom-domain API + DNS verification).
4. **AI Gateway** — OpenRouter reverse proxy; injects global key, tags+meters per tenant, exposes usage to Metrics.
5. **Metrics Collector** — periodic per-tenant storage/health/usage → time series in Registry → dashboards + alerts.
6. **Registry (Postgres `siteagent_control`)** — `tenants`, `cloudflare_projects`, `deploys`, `ai_usage`, `metrics`, `settings`, `alerts`.
7. **Per-tenant Instatic config** — roles model (Tenant Admin + custom-toggle roles; suppress extra system roles), audit on, OpenRouter base URL → AI Gateway; optional `publish.html` plugin for asset-URL rewrite.

## Publishing & domains
- Publish in Instatic → bake → Deployer → Cloudflare Pages.
- **Custom domains** per tenant via CF Pages custom-domain API + DNS verification in the console (`*.pages.dev` until attached).
- **Forms/dynamic:** form `action` posts back to the tenant's reachable instance (CORS + absolute action URLs, `publish.html` rewrite if needed); fallback = Cloudflare Pages Function. _← spike gate 7._

## Hosting
- **VPS (Linode)** running Docker: Operator Console + control-plane services + the **single shared Postgres database** (schema-per-tenant) + N Instatic containers. (Local Docker for dev.)
- **Caddy/Traefik** routes editing subdomains → `instance:3001`, auto-TLS.
- Public **viewer** sites served by **Cloudflare** (free CDN), offloading the VPS.
- Scale path: vertical first; document horizontal (Postgres to a managed/separate host; more VPS nodes for containers).

## Spike gates — prove before building the rest
1. **Asset-URL portability (#1):** baked HTML relative (portable) vs absolute origin (need `publish.html` rewrite).
2. **Headless provisioning:** script first-run Owner + AI provider/base-URL/model config. _Client demo shows the admin API is cookie+CSRF, capability-gated, TOTP-stepped — a clean REST provision is unlikely._ Prove **(a) encrypted DB seed** in the tenant's Postgres **schema** using `INSTATIC_SECRET_KEY`, or **(b) a one-shot Playwright headless-browser setup pass**.
3. **Direct Upload renders:** `wrangler pages deploy` of the baked folder serves correctly (paths/media/JS).
4. **AI Gateway:** Instatic accepts a custom OpenRouter base URL (else `X-Title` fallback).
5. **Roles:** suppress/relabel system roles so only "Tenant Admin" + custom remain; capability-toggle editor usable.
6. **Audit log:** per-user and viewable by the Tenant Admin.
7. **Forms:** cross-origin post-back + CORS (if used).
8. **Custom domains:** CF API + DNS verification flow.
9. **Schema-per-tenant works (gates the DB design):** two Instatic containers against the **same database**, each on its own schema; confirm each migrates **into its own schema, not `public`** (watch hardcoded `public` / a pooled connection dropping `search_path`), creates nothing in `public`, and they don't collide. Pin `search_path` at the **role level** (`ALTER ROLE <role> SET search_path = <schema>`), not via the client connection (pooled connections lose client-set state — plan_review_2 #2). Isolation must be **GRANT/REVOKE-enforced, not `search_path`** — tenant A can't read schema B even fully-qualified after `REVOKE … FROM PUBLIC`; admin reads all. **Known limit (plan_review_2 #3):** Postgres **system catalogs are globally readable**, so tenants can still see each other's *schema/table names + structure* (not row data) — true metadata isolation needs **DB-per-tenant or SQLite-per-instance**. If Instatic hardcodes `public` or won't honor a per-connection schema, **fall back to DB-per-tenant on the same server**.
10. **License:** confirm `LICENSE` = MIT. **Metrics:** per-tenant schema size + uploads size + container stats readable.

## Dropped from the old plan (Payload/Astro-specific → moot)
In-process Local-API isolation adapter; shared multi-tenant instance + plugin; Tool broker + dual-model agent + primitive registry; ChangeSet state machine; per-tenant GitHub repos + protected merge + CODEOWNERS; durable publish saga over deploy webhooks; reference-safe R2 media GC; SSR-preview-on-Workers + draft-media proxy; **Astro tenant-site framework**. **Why:** isolation = separate containers + per-tenant schema (least-privilege role) in the single shared DB; agent/editor/drafts/RBAC/audit/publish/render are native to Instatic; preview = Instatic's canvas; media ships with the static bundle.

## Survives from the old work
Product intent; the simple edit → preview → Publish loop (native to Instatic); the Operator/Tenant model (now a fleet); BYO model key (OpenRouter); deploy-to-Cloudflare ownership (matches `templateRule.md`).

## Risks / open questions
- **Instatic is v0.0.6 pre-alpha (headline strategic risk)** — building a commercial fleet on a churning, buggy base. Mitigate: pin the image, gate upgrades behind the fleet-upgrade spike, budget for breakage; reconsider timing if a stabler tag is near.
- Instatic's **admin-only API** (cookie+CSRF, capability-gated, TOTP step-up) makes headless provisioning + role config fiddly — needs DB seeding or a Playwright headless-browser pass (see spike #2); the AI agent is **browser-bridged** (in-browser only, not headless-drivable).
- **Tenant HTML import (Super Import)** commits via the browser GUI (fine) but **flattens motion-heavy JS into an opaque script blob** that canvas edits desync from — document the limitation; plain HTML imports cleanly.
- **AI Gateway** depends on Instatic accepting a custom OpenRouter base URL; else coarser `X-Title` attribution.
- **Single shared Postgres DB** = logical (not physical) isolation. *Between tenants* it's DB-enforced (per-tenant least-privilege role can't read another schema's **data**; admin/owner role can read all — which is how the Operator sees across tenants). *Against an admin/DB compromise* it is not isolated — one breach or a leaked admin credential touches all tenants. Mitigate: network isolation, guard the admin credential, central encrypted backups. The whole design **depends on spike #9** (Instatic honoring a non-`public` schema); fallback = DB-per-tenant on the same server.
- **Metadata leak — ACCEPTED for now (Operator decision, plan_review_2 #3):** Postgres **system catalogs are globally readable**, so tenants can see each other's *schema/table names + structure* (not row data); this can't be cleanly locked down with schemas. Harmless while tenants don't compete / in v1. **Stronger-isolation upgrade paths (documented, revisit before competing tenants):** **SQLite-per-instance** (separate file per tenant — also removes shared-catalog, lock-contention, and single-DB blast-radius risks, *if Instatic supports SQLite*) or **DB-per-tenant** (separate catalogs).
- **Astro SSR** for the console needs the Node adapter + a long-running server (not static) — fine on the VPS.
- **Fleet ops:** pin image tag; build rolling upgrades + per-tenant backup/restore.
- **Cloudflare free-tier limits** — notably ~**100 Pages projects per account** (plus deploys/month, custom domains): a **hard scaling ceiling** that silently blocks new-tenant provisioning. Document it; plan **multi-account credential rotation** in the console as the scale path. Confirm exact current limits as tenants grow. _(plan_review_2 #10.)_
- **Single VPS = SPOF** — document HA/scale-out.
- Suppressing Instatic system roles **fights "force-resync on boot"** — verify a durable approach.

## Out of scope (this platform; deferred regardless of v1/v2)
Billing/payments/subscriptions; plan limits + enforcement; making Instatic itself multi-tenant; self-serve signup; control-plane HA beyond one VPS.

## Verification (end-to-end, when built)
- **Provision:** add a tenant → Postgres schema+role created (in the single shared DB), instance boots+migrates, OpenRouter via AI Gateway + model set, share link works, Tenant Admin logs in; re-run → idempotent.
- **Roles:** only "Tenant Admin" predefined; Tenant Admin builds a custom role via permission toggles; enforcement holds; audit log shows per-user activity.
- **Edit:** edit via UI and via agent → Instatic canvas updates; AI usage appears per tenant in the dashboard.
- **Publish→live:** Publish → Deployer → `wrangler` deploys → live URL renders (HTML/CSS/media); attach a custom domain → resolves.
- **Usage/health:** dashboard shows per-tenant storage/users/pages/deploys/health; failure raises an alert; editing unaffected.
- **Forms (if used):** submit on the live site → lands in the tenant's Instatic data tables (or handler).

## Build order
The first shippable slice is **[`PLAN_V1.md`](PLAN_V1.md)** (minimal admin + full-Instatic tenants → Cloudflare). The remaining capabilities (roles UI, usage dashboards/metrics, AI Gateway attribution, custom domains, fleet ops) layer on top in later versions.
