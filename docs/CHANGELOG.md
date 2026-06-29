# SiteAgent — Changelog
_Plain-language log of what changed, newest first. Planning + spike phase (no application code yet)._

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
