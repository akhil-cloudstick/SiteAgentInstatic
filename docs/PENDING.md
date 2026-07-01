# PENDING — phased build work
_All remaining work, phased. **Prove-first** spikes gate the build; tick a box as each lands. Task IDs in `()` map to [`../.serve/ProjectPlan.html`](../.serve/ProjectPlan.html). Whole-project scope._

> Rule of thumb: nothing in the **build** phases starts until the **spikes** that gate it are green. The DB design is already proven; the Instatic-dependent spikes need Docker.

---

## Phase 0 — Spikes (prove before building)
> ⛔ **Docker is currently un-installable on the dev machine** (no admin / WSL2). Every spike marked *needs Docker* is **BLOCKED &amp; deferred** until a Docker-capable machine is available. The DB spike needed no Docker and is **done**.

- [x] **DB isolation** (`s9-db`) — two tenants, one DB, schema-per-tenant; doors locked by GRANT/REVOKE; idempotent provision + clean teardown _(passed 2026-06-30, real PG18)_
- [ ] **Instatic honors a non-`public` schema** (`s9-instatic`) — two containers, same DB, separate schemas; migrate into own schema, no collision. _Fallback: DB-per-tenant._ **Needs Docker.**
- [ ] **Headless first-run** (`s2-firstrun`) — create Owner (email+password) without a forced 2FA wall; DB-seed vs Playwright vs semi-manual. **Needs Docker.**
- [ ] **AI Gateway base URL** (`s4-gateway`) — does Instatic accept a custom OpenRouter base URL? Else the network-proxy fallback. **Needs Docker.**
- [ ] **Asset-URL portability** (`s1-assets`) — baked HTML relative vs absolute (maybe a `publish.html` rewrite).
- [ ] **Direct Upload renders** (`s3-upload`) — `wrangler pages deploy` of the baked folder serves correctly.
- [ ] **Animation import fidelity** (`sA-anim`) — import 1 animated page, edit, deploy; observe what survives.

---

## Phase 1 — Foundation &amp; infra
- [ ] **Docker Desktop + pinned Instatic image** (`m1-docker`)
- [x] **Shared Postgres + admin role** (`m1-postgres`) — `siteagent_platform` + `siteagent_admin` created locally _(2026-06-30)_
- [ ] **Registry schema + migrations** (`m1-registry`) — `siteagent_control`: tenants/deploys/settings/usage/metrics/alerts
- [ ] **Per-tenant compose template** (`m1-compose`) — `DATABASE_URL` → shared DB scoped to schema + tenant role

## Phase 2 — Provisioner _(gated by s9-instatic, s2-firstrun)_
- [x] **Mint schema + least-privilege role (idempotent)** (`m2-schema-role`) — SQL proven (guarded `CREATE ROLE` + `CREATE SCHEMA IF NOT EXISTS` + `ALTER ROLE search_path`)
- [ ] **Headless first-run** (`m2-firstrun`) — create Owner (email+password); point AI at the Gateway
- [ ] **Create Cloudflare Pages project** (`m2-cf`) — namespaced `siteagent-<slug>-<rand>`; store URL
- [ ] **Saga + cleanup** (`m2-saga`) — Registry state machine (`db_ready→up→seeded→cf_ready→done`) + walk-back on failure
- [x] **Deprovision** (`m2-deprovision`) — drop schema+role cleanly (SQL proven); container + `tenants/<slug>/` teardown pending

## Phase 3 — AI Gateway _(gated by s4-gateway)_
- [ ] **OpenRouter reverse proxy** (`m3-proxy`) — base URL `…/ai/<slug>`, injects the global key
- [ ] **Signed per-tenant token** (`m3-token`) — validate signature + active status every call
- [ ] **Per-tenant rate guard** (`m3-rate`) — bound runaway cost (no spend cap by choice)
- [ ] **Usage metering** (`m3-meter`) — tokens/cost per tenant → Registry

## Phase 4 — Publish Deployer _(gated by s1-assets, s3-upload)_
- [ ] **Complete-bake detection** (`m4-watch`) — immutable `published/<ts>/` + completion marker (not bare `fs.watch`)
- [ ] **Direct Upload** (`m4-deploy`) — `wrangler pages deploy <ts-dir> --project-name=…`
- [ ] **Record deploy + live URL** (`m4-record`)
- [ ] **Custom domains** (`m4-domains`) — CF custom-domain API + DNS verify

## Phase 5 — Operator Console (Astro SSR)
- [ ] **Settings** (`m5-settings`) — OpenRouter key/model + Cloudflare creds (encrypted at rest)
- [ ] **Tenants** (`m5-tenants`) — Add Tenant (form) → share link/creds; suspend/resume/remove
- [ ] **Usage/Health dashboards** (`m5-dash`) — live islands over Metrics
- [ ] **Alerts** (`m5-alerts`) — provision/deploy/health failures

## Phase 6 — Roles, audit, metrics, fleet ops
- [ ] **Tenant roles** (`m6-roles`) — Tenant Admin + custom toggle roles; suppress extra system roles
- [ ] **Per-user audit log** (`m6-audit`)
- [ ] **Metrics Collector** (`m7-metrics`) — periodic storage/health/usage → time series
- [ ] **Fleet upgrade** (`m8-upgrade`) — re-pull pinned image, **sequential** rolling restart
- [ ] **Backup/restore** (`m8-backup`) — per-tenant `pg_dump -n <schema>` + `uploads/`

## Phase 7 — Deploy / go-live
- [ ] **VPS (Linode) + Docker** (`m9-vps`)
- [ ] **Caddy/Traefik editing-domain TLS** (`m9-proxy`)
- [ ] **Secrets manager** (`m9-secrets`) — replace plaintext-on-host (acceptable only for local dev)
- [ ] **Connection pooler (PgBouncer)** (`m9-pool`) — before the fleet passes ~5–8 tenants

## Import Fidelity — Site Replica (Path B) _(done 2026-07-01)_
> Validated by importing a real Astro replica (**AtlasInfra**, built per [`templateRule.md`](templateRule.md)) into a live tenant and diffing the published site against the original. Every gap was a **platform** bug — the replica was correct. All fixed in `instatic/vendor` (every tenant) + `operator/control-plane`.

- [x] **Preserve minified `@media(…)`** (`if-media`) — Vite/Astro's no-space form was silently dropped; all responsive CSS lost
- [x] **Mobile-first cascade order** (`if-cascade`) — responsive overrides emit min-width ascending / max-width descending so the right breakpoint wins
- [x] **Neutral reset line-height** (`if-lineheight`) — `normal` not `1.5`; buttons/cards no longer +3px taller
- [x] **Sticky-safe reset height** (`if-sticky`) — `body{min-height}` not `height:100%`; `position:sticky` spans the page
- [x] **Icon buttons keep children** (`if-iconbtn`) — `<button><svg></button>` preserves its glyph (renders children like links)
- [x] **No duplicate identical rules** (`if-dedup`) — publisher never emits two byte-identical rules; fixes active-nav colour + halves CSS
- [x] **Operator: no port drift on re-create** (`if-portdrift`) — `createTenant` resets all fields incl. port
- [x] **Operator: crash-proof control-plane** (`if-crashguard`) — child `error` handler + global guards; a tenant boot failure returns a clean error instead of killing the supervisor

---

## Notes on deliberate deferrals
- **Metering &amp; dashboards before billing** — the AI Gateway hides the key from day one; per-tenant *attribution* dashboards come in Phase 3/6. **Billing/enforcement stays out of scope** entirely.
- **Secrets plaintext on host** — accepted for **local dev only**; `tenants/` is gitignored; a secrets manager is required before production (`m9-secrets`).
- **Single shared DB** — accepted; the metadata name-leak is documented. DB-per-tenant / SQLite-per-instance remain the stronger-isolation upgrade paths to revisit before competing tenants.
