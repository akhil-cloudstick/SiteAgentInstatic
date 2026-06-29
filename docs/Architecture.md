# Architecture: SiteAgent — Runtime Topology
_The whole-project runtime picture. Terms per [`CONTEXT.md`](CONTEXT.md); scope &amp; rationale per [`PLAN.md`](PLAN.md); database detail in [`DB-Architecture.md`](DB-Architecture.md); review/spike history in [`PLAN-REVIEW-LOG.md`](PLAN-REVIEW-LOG.md)._

## Goal
Run a **fleet of isolated CMS instances** behind one admin console. Each Tenant gets a full **Instatic** instance to build/edit a site — by hand or by prompting the AI agent — and one-click **Publish** ships the baked static site to the Tenant's **Cloudflare Pages** project. The Operator manages the fleet (provision, monitor, publish, upgrade) without ever touching tenant content.

## Decisions locked (the foundation)
- **Isolation = separate containers + schema-per-tenant.** One Instatic container per Tenant; one **shared Postgres database** with one **schema + least-privilege role** per Tenant. Cross-tenant data access is blocked by `GRANT`/`REVOKE`, **not** `search_path` (proven on real Postgres — see [`PLAN-REVIEW-LOG.md`](PLAN-REVIEW-LOG.md) spike #9).
- **Off-the-shelf Instatic, pinned.** Instatic (MIT, pre-alpha v0.0.6) is run from a **pinned image**; we never fork it. The agent, visual editor, drafts, RBAC, audit, and static publishing are all native to Instatic.
- **The AI key is never in a tenant instance.** All AI traffic routes through the **AI Gateway**, which holds the single OpenRouter key. Tenants and their AI can read the gateway address but never the key.
- **Publish target is Cloudflare.** Baked output is direct-uploaded with `wrangler`; SiteAgent owns the deploys.
- **Admin sees all; tenants see only themselves.** The admin/owner Postgres role spans every schema; each tenant role is fenced to its own.

> **Accepted limitation** — schema-per-tenant in one DB leaks *metadata* (a Tenant can read other schemas' table **names** via Postgres system catalogs, never their **data**). Documented; revisit DB-per-tenant / SQLite-per-instance before onboarding competing tenants.

## The picture
```
                         ┌───────────────────────────────────────────────┐
                         │  Operator (admin)                             │
                         └───────────────┬───────────────────────────────┘
                                         ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │  SiteAgent Operator Console   (Astro SSR, admin-only)                  │
   │   settings · tenants + share links · usage/health dashboards · alerts  │
   └──────┬─────────────┬───────────────┬───────────────┬──────────────────┘
          │ Provisioner   │ Publish Deployer │ AI Gateway   │ Metrics + Registry
          ▼              ▼               ▼               ▼  (Postgres siteagent_control)
   ┌───────────────────────────────────────────────────────────────────────┐
   │  Tenant Instatic instances  (Docker, one per tenant, pinned image)     │
   │   instance:3001  ── DATABASE_URL ─►  shared Postgres: schema <slug>     │
   │   uploads/ (media + published/) bind-mounted on host                   │
   │   agent ── base URL ─►  AI Gateway ── injects key ─►  OpenRouter        │
   └──────┬────────────────────────────────────────────────────────────────┘
          │ tenant clicks Publish → Instatic bakes uploads/published/<ts>/
          ▼
   ┌──────────────────────────┐        ┌──────────────────────────────────┐
   │ Publish Deployer (watch) │ ─────► │  Cloudflare Pages (per tenant)    │
   │ wrangler Direct Upload   │        │  live URL: *.pages.dev / custom   │
   └──────────────────────────┘        └──────────────────────────────────┘
   Caddy/Traefik → <slug>.<editing-domain> → instance:3001  (editing access, auto-TLS)
```

## Components &amp; where they run
### 1. Operator Console — `operator/ui` + `operator/api` (Astro SSR, Node adapter)
The single admin-only web app. Screens: **Settings** (OpenRouter key+model, Cloudflare creds), **Tenants** (add → share link/creds + live URL/deploy status, suspend/remove), **Usage/Health** dashboards (live islands), **fleet overview**, **alerts**. Holds no tenant content — it drives the control-plane and reads the Registry.

### 2. Control-plane services — `operator/control-plane` (Node/Bun)
- **Provisioner** — `provisionTenant()`, the idempotent saga (see contract A).
- **Publish Deployer** — watches each instance's baked output and ships it (contract D).
- **AI Gateway** — OpenRouter reverse proxy that hides the key + meters per Tenant (contract C).
- **Metrics Collector** — periodic per-Tenant storage / health / AI usage → Registry → dashboards + alerts.
- **Registry** — the control-plane Postgres schema (`siteagent_control`): tenants, deploys, settings, usage, metrics, alerts.

### 3. Shared Postgres — one database, schema-per-tenant
One Postgres server, one `siteagent` database. Each Tenant = one schema + one least-privilege role (`search_path` pinned at the role level via `ALTER ROLE`). The control plane lives in the `siteagent_control` schema. Full detail in [`DB-Architecture.md`](DB-Architecture.md).

### 4. Tenant Instatic instances — `tenants/<slug>/` (Docker, pinned image)
One container per Tenant on `:3001` (internally), `DATABASE_URL` scoped to its schema, `uploads/` (media + `published/`) bind-mounted on the host. Each runs the full Instatic feature set; the agent's OpenRouter base URL points at the AI Gateway. Editing access is routed by Caddy/Traefik at `<slug>.<editing-domain>` with auto-TLS.

### 5. Publish target — Cloudflare Pages
One Pages project per Tenant, named `siteagent-<slug>-<rand>` (the `*.pages.dev` subdomain is globally unique). Served free on Cloudflare's CDN; custom domains attach via the CF custom-domain API.

## Key contracts (how the parts talk)
### A. Provisioning — an ordered, idempotent saga
Using the single admin credential, `provisionTenant()` runs per `slug`: **(1)** create schema + least-privilege role (`REVOKE ALL ON SCHEMA public FROM PUBLIC`; grant the role its own schema only; `ALTER ROLE … SET search_path`); **(2)** create `uploads/` + generate `INSTATIC_SECRET_KEY` + role password; **(3)** render per-tenant compose (`DATABASE_URL` → shared DB, tenant role, own schema); **(4)** `docker compose up -d`; **(5)** headless first-run (create Owner with **email + password**; point AI at the Gateway; the Tenant sets their **own 2FA** after first login); **(6)** create the Cloudflare Pages project; **(7)** record in the Registry. Each step is **check-then-act keyed by slug**, with a Registry **state machine** (`db_ready → up → seeded → cf_ready → done`) and **walk-back cleanup** on failure (so a partial failure never leaks a scarce free-tier CF project).

### B. Tenant isolation — schema + role, GRANT/REVOKE-enforced
A tenant container connects only as its own role. That role has `USAGE`/`CREATE` on its own schema and **no grant** on any other schema, so a tenant — and the AI running inside it — physically cannot read another tenant's data. The admin/owner role retains cross-schema visibility (that's how the Operator sees across tenants). Proven empirically: `permission denied for schema <other>`.

### C. AI Gateway — one key, never exposed, metered per Tenant
Each instance's OpenRouter base URL → `…/ai/<slug>`. The gateway validates a **signed per-tenant token**, injects the **global key (held only by the Operator)**, forwards to OpenRouter, and meters tokens/cost per Tenant. The real key is **never stored in any tenant instance**. A per-tenant **rate guard** bounds runaway cost. Fallback if Instatic rejects a custom base URL: force the instance's outbound AI traffic through the gateway at the **network level**. AI calls must originate server-side (container backend), not the browser.

### D. Publish saga — complete-bake detection + Direct Upload
Tenant clicks Publish in Instatic → Instatic bakes static HTML/CSS/media to `uploads/published/`. The Deployer publishes an **immutable `published/<timestamp>/`** and gates on an explicit **completion marker/manifest** (not just `fs.watch` quiescence, which can fire mid-write) → `wrangler pages deploy <ts-dir> --project-name=siteagent-<slug>-<rand>` → record deploy + live URL. Custom-domain wiring layers on via the CF API + DNS verification.

### E. Identity &amp; auth
- **Operator** logs into the Console (admin-only).
- **Tenant Admin** = the Instatic Owner, created with email + password and handed via the share link; the Tenant enables their **own 2FA** after first login (the Operator never holds tenant 2FA).
- **Sub-users** are Instatic users the Tenant Admin creates, governed by Instatic's RBAC (36 capabilities) + per-user audit log.

### F. Editing-domain routing
Caddy/Traefik terminates TLS and routes `<slug>.<editing-domain>` → the Tenant's `instance:3001`. Public viewer sites are served entirely by Cloudflare, offloading the host.

## Observability
Per Tenant: Postgres **schema size** + `uploads/` media size, # pages/sites/users, **AI usage (tokens/cost)** via the Gateway, deploy count + last publish + live URL, container health (up/down, CPU/mem), recent failures. Plus a fleet overview and **alerts** on provision/deploy/health failures. (Plan limits, enforcement, billing are out of scope.)

## Hosting tiers
- **Dev/test:** entirely local — Docker for the Console + instances, a **locally-installed Postgres** as the shared DB (containers reach it via `host.docker.internal`), Cloudflare free account for real publishes.
- **Production:** a **VPS (Linode)** running Docker: Console + control-plane + shared Postgres + N Instatic containers; Caddy/Traefik for editing-domain TLS; Cloudflare serves the public sites. Scale path: vertical first; then Postgres to a managed host + a connection pooler (one shared Postgres tops out around **~5–8 tenants** at default `max_connections=100`), more nodes for containers.

## Risks / open questions
- **Pre-alpha foundation** — Instatic v0.0.6 APIs churn; pinned image + budgeted breakage on upgrade.
- **Instatic schema-honoring** — does its migration tool respect a non-`public` schema? Gated by spike #9's Instatic half (needs Docker).
- **Headless first-run** — admin API is cookie+CSRF + capability-gated + possible TOTP; provisioning may need a DB seed or a Playwright pass, else semi-manual (spike #2).
- **AI Gateway base URL** — does Instatic accept a custom OpenRouter base URL, else the network-proxy fallback (spike #4).
- **Single shared DB / single VPS** = one blast radius; mitigate with backups, document HA/scale-out.
- **Connection ceiling** — one Postgres ≈ a handful of tenants before pooling (PgBouncer) is needed.

## Out of scope
Billing/payments/subscriptions; plan limits + enforcement; making Instatic itself multi-tenant; self-serve signup; control-plane HA beyond one VPS.

## Review status
DB-isolation design **proven on real Postgres** (spike #9 DB side + provisioner ops + security). Instatic-dependent contracts (A first-run, C gateway, D publish) **pending Docker**. Two independent plan reviews complete (interim same-model + external model `plan_review_2.md`); all findings folded or consciously accepted.
