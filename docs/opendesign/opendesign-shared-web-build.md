# OpenDesign: one shared web build, session-routed tenants

_**IMPLEMENTED 2026-08-04.** Decided and built the same day. This doc is now the record of the change
plus the reasoning behind it._

> **The change in one line:** the shared build carries `"basePath": "/design"` where the old per-tenant
> build carried `"basePath": "/od/akhil"`. Nothing tenant-specific is baked in any more, so one build
> and one `next start` serve every tenant.
>
> **What you must do after pulling this:** restart the control plane. The first boot will use the
> shared build (`.next-prod-shared-<ms>`); old `.next-prod-<slug>-*` and `.next-<slug>` directories
> are no longer read and can be deleted once nothing is serving them.

## The problem

OpenDesign builds and runs **one Next.js web per tenant**. `Operator/control-plane/runtime/odRuntime.mjs`
→ `buildWeb()` bakes two tenant-specific values into the bundle:

```js
OD_WEB_BASE_PATH: `/od/${slug}`,   // Next.js basePath — a BUILD-TIME constant
OD_PORT: String(odPort),           // tenant's daemon port, baked into the /api rewrite
```

Because `basePath` is compiled into every asset URL and router link, each tenant needs its own build
**and** its own `next start` process on its own `od_web_port`.

**At 50 tenants that is 50 builds (~1–2 min each on the share) and 50 Node processes.** Every OD
source upgrade would require rebuilding all of them. Not viable.

## Instatic already does this correctly

`Operator/control-plane/gateway/proxy.mjs` resolves the Instatic tenant from the **session**, not the URL:

```js
const slug = sessionSlug(req);
if (slug) { const t = await getTenant(slug); if (t?.port) return { port: t.port, kind: 'instatic' }; }
```

One shared `Instatic/dist`, no slug in the URL, tenant determined by who authenticated. OD is the
outlier and should converge on this.

## Target architecture

| Layer | Today | Target |
|---|---|---|
| OD web **bundle** | one build per tenant (`basePath=/od/<slug>`) | **one shared build**, fixed `basePath=/design` |
| OD web **process** | one `next start` per tenant (`od_web_port`) | **one shared process** |
| OD **daemon** | one per tenant (own `OD_DATA_DIR` + SQLite) | **unchanged — stays per tenant** |
| Tenant resolution | slug in the URL path | **session cookie**, like Instatic |

The daemon stays per-tenant: that is the real isolation boundary (projects, SQLite, artifacts). Only
the UI shell becomes shared — exactly the Instatic split.

## What was implemented

The key realisation: the problem was never `basePath` itself — it was that the basePath contained the
**slug**. A *fixed* `/design` keeps routing unambiguous (no reliance on `Referer` to identify the app)
while making one build serve everyone.

1. **`odRuntime.buildWeb()`** — takes no arguments now. Builds once with `OD_WEB_BASE_PATH=/design` into
   `.next-prod-shared-<ms>`, keeping the versioned-dir pattern so a rebuild never fights the dir being
   served. No `OD_PORT` is baked into the `/api` rewrite: the gateway intercepts every daemon path
   before it reaches Next, so a build-time port would be both wrong and unused behind the funnel.
2. **`odRuntime.start()`** — spawns ONLY the tenant's daemon. New `startSharedWeb()` / `stopSharedWeb()`
   run the single shared Next process on `config.odWebBasePort`; `isWebBuilt()` and `newestBuildDir()`
   lost their `slug` parameter. `sharedWebPort()` is the one port every tenant's browser talks to.
3. **`gateway/proxy.mjs`** — `/design/*` now splits: daemon-owned paths (`/design/api`,
   `/design/sso`, `/design/artifacts`, `/design/frames`) resolve the tenant via `sessionSlug(req)` and go to **that** tenant's
   `od_port` with the `/design` prefix stripped; everything else goes to the shared web with the path
   preserved. `odSlugFromReferer` became `isFromOdPage` — the Referer is now only used to *recognise*
   a base-less sub-resource request, **never** to pick a tenant, so a forged Referer cannot reach
   another tenant's daemon.
4. **OD web** — the three base-path regexes (`app/gateway-basepath-shim.ts`, `src/router.ts`,
   `src/providers/registry.ts`) changed from `/^\/od\/[a-z0-9-]+/` to `/^\/design(?=\/|$)/`. They still
   no-op when served at the root in local dev.
5. **`hub.mjs`** — the SSO hand-off link is now `<gateway>/design/sso?token=…` (no slug), matching how the
   Instatic hand-off already worked.
6. **`provision.mjs`** — builds the shared web only if none exists, starts the shared web once, and
   no longer passes `webPort` per tenant. **`server.mjs`** reports `od_url` as the gateway `/design` mount.
7. **`scripts/build-od-web.mjs`** — takes `--force` instead of a slug.

The `od_web_port` registry column is now **legacy/unused**. It was left in place deliberately: dropping
a column is a migration, and nothing reads it any more.

## How isolation works now

**The routing decision is the isolation boundary.** A request can only ever reach the daemon of the
tenant named in its own signed `sa_hub` cookie — the same mechanism Instatic has always used. The URL
no longer carries a tenant, so there is nothing to tamper with: changing the path cannot reach another
tenant, and neither can forging a `Referer`.

Per-tenant daemons are unchanged, each with its own `OD_DATA_DIR` and SQLite. Only the UI shell is
shared, and it holds no tenant data.

**`OD_ALLOWED_ORIGINS`** now lists the shared web's origin plus the gateway origin instead of a
per-tenant web port. **`od_session`** is a daemon-local "is authenticated" cookie; it does not select a
tenant, because the gateway has already chosen the daemon before the request arrives.

## Still to verify (needs two tenants)

The single most important test cannot be run right now — there is only one tenant (`adithyan` was
deleted). Before this goes near real multi-tenant use:

> Sign in as tenant A in one browser and tenant B in another. Confirm every `/design/api/*` call lands on
> its own daemon, and that A's browser can never see B's projects — including after switching accounts
> in the same browser (stale `od_session`).

## Deep links

Old `/od/<slug>/…` URLs no longer resolve. Nothing generates them any more (the hub link was the only
producer), so no redirect was added; add one if any are bookmarked.

## Payoff

One `node Operator/scripts/build-od-web.mjs --force` per OD upgrade instead of one per tenant, one web
process instead of N, and OD upgrades stop scaling with tenant count — matching how Instatic already
works.
