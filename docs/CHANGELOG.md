# SiteAgent — Changelog
_Plain-language log of what changed, newest first._

## 2026-07-01

**Import Fidelity — Site Replica (Path B) now imports pixel-exact**
Validated by importing a real Astro replica (**AtlasInfra**, built per `templateRule.md`) into a live tenant and comparing the published site to the original at `localhost:4321`. Every difference traced to a **platform** bug (the replica followed the rule correctly). Fixed 6 import/publish bugs + 2 operator bugs — all in `instatic/vendor` and `operator/control-plane`, so they apply to **every** tenant. First application-code change (earlier phases were planning + spikes). Regression tests added; full publisher/import suite green.

- **Responsive CSS was silently dropped.** Vite/Astro minify `@media (min-width:…)` to `@media(min-width:…)` (no space); the CSS engine ignored those rules, so every breakpoint override was lost. Now normalised before parsing (`@media`/`@supports`/`@container`/`@layer`).
- **Responsive overrides won in the wrong order.** Imported media queries emitted in discovery order, not cascade order — a 640px rule could beat a 1024px rule on a wide screen. Now mobile-first (min-width ascending / max-width descending).
- **Buttons & cards were ~3px too tall.** The publisher reset forced `body { line-height: 1.5 }`, which every element without its own line-height inherited. Now `normal` — neutral, so imported geometry matches.
- **Sticky navbars broke after one screen.** The reset pinned `body { height: 100% }`, confining `position: sticky` to one viewport. Now `min-height` — the body grows and sticky spans the page.
- **Icon buttons lost their icon.** `<button><svg>…</svg></button>` imported as an empty button (only text was kept). Buttons now preserve `<svg>`/element children, like links already did.
- **Active nav link lost its colour (and CSS was 2× too big).** An imported class could be stored twice — as a class rule AND a byte-identical ambient rule; the later copy overrode `.nav-link-active`. The publisher now never emits two identical rules.
- **Operator — port drift on tenant re-create.** Re-creating a tenant kept the old port in the registry while the instance booted on a newly-allocated one; console links pointed at a dead port. `createTenant` now resets every field (incl. port) on re-create.
- **Operator — a tenant boot failure crashed the whole control-plane.** The spawned instance had no `error` handler, so one hiccup took the supervisor down mid-request. Added a child `error` handler + global uncaught/unhandled guards; a failed provision now returns a clean 400 and the server stays up.

## 2026-06-30 (continued)

**`Afternoon`** — Tenant workflow clarified + `templateRule.md` created
- Locked the two Tenant site-building paths: **(A)** build from scratch in Instatic; **(B)** import a Site Replica.
- Path B use case: a client has an old website with no developer — someone (Operator, developer, AI agent — not SiteAgent's concern) rebuilds it following `docs/templateRule.md`, hands the `dist/` folder to the Tenant, and the Tenant imports it into Instatic for full editing.
- Created **`docs/templateRule.md`**: the build standard for Site Replicas — Astro static output, CSS inlined in HTML (`assetsInlineLimit: 1048576`, `cssCodeSplit: false`), JS libraries from CDN, all images in `public/` as plain `<img>` tags, `data-sa` markers on editable content.
- Updated `UserFlow.md` (Flow 4 rewritten), `CONTEXT.md` (new terms: templateRule.md, Site Replica, Tenant site paths).

## 2026-06-30

**`11:30 AM`** — Documentation suite generated
- Added **`Architecture.md`**, **`DB-Architecture.md`**, **`Diagrams.md`**, **`UserFlow.md`**, **`CONTEXT.md`**, **`CHANGELOG.md`**, **`PENDING.md`** — the whole-project doc set, styled after the prior project's reference docs.
- Stood up **`.serve/`** (`server.js` + `ProjectPlan.html`) to serve the live, interactive project plan with shared task state.

**`10:15 AM`** — Spike #9 (database isolation) **RUN &amp; PASSED** on real PostgreSQL 18
- Created the real project DB + admin role: **`siteagent_platform`** + **`siteagent_admin`**.
- Proved **two tenants in one DB don't collide** (same `pages` table name, separate schemas), a tenant **reads its own data**, and a tenant is **denied** another's (`permission denied for schema …`).
- Confirmed the external review's **name-leak** (finding #3): metadata names visible via `pg_catalog`, data never.
- Proved **idempotent provisioning** (re-run = no-op) + **clean deprovision** (0 residue); tenant **can't read `pg_authid`** or write `public`; PG18 blocks `public` CREATE by default.
- Learned a real number: one Postgres ≈ **~5–8 tenants** at `max_connections=100` before pooling.

**`09:00 AM`** — External AI plan review (`plan_review_2.md`) triaged
- Independently **confirmed 5 of our findings** (extensions, Playwright fragility, forced-2FA, saga leaks, publish race).
- **Folded 4 improvements:** role-level `search_path` (`ALTER ROLE`), signed gateway token + rate guard, server-side AI calls, Cloudflare ~100-project cap.
- **Accepted** the new **metadata name-leak** finding (#3) for schema-per-tenant; documented SQLite/DB-per-tenant as upgrade paths.

## 2026-06-29

**`Evening`** — Locked the simplified risk decisions
- **DB:** one shared Postgres, **schema-per-tenant**, private least-privilege role per tenant; isolation by GRANT/REVOKE.
- **AI key:** hide via the **AI Gateway** for the whole project — the key never lives in a tenant instance; pulled the Gateway forward.
- **Onboarding:** Add-Tenant = button + form; admin creates **email+password**, the **tenant sets their own 2FA**.
- **Publish:** ship only the **finished** baked folder. **Animations:** decide via a spike.

**`Afternoon`** — Plan hardening (grill + reviews)
- Ran an Act-1 grill; Codex (cross-model review) was rate-limited → ran an **interim same-model adversarial review** (REVISE → 10 findings folded, 1 escalated &amp; resolved).
- Rewrote provisioning as an **ordered, idempotent saga** with state machine + walk-back cleanup; fixed publish/CF/local-Postgres footguns.

**`Morning`** — Plan rebuilt on Instatic
- Replaced the Payload-based plan with a **fleet of per-tenant Instatic instances → Cloudflare** design.
- Switched the data model to **single shared database, schema-per-tenant** (was database-per-tenant); v1 runs locally with a locally-installed Postgres + a free Cloudflare account.
