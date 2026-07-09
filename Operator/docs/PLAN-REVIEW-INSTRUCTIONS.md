# Reviewer Instructions — SiteAgent Plan (for a second AI)
_Hand this file to another AI to get an independent adversarial review of the SiteAgent plan. It is read-only work — the reviewer must not change any files._

## Your role
You are an **adversarial, read-only reviewer** of an implementation plan. Do **not** edit any files. Be skeptical and specific — your job is to find what breaks, not to be agreeable. Prefer concrete failure scenarios over vague concerns.

## Read these files first
- `docs/PLAN.md` — the full project plan.
- `docs/PLAN_V1.md` — the first version to build (the slice that ships first).
- `docs/PLAN-REVIEW-LOG.md` — history of locked decisions + a prior interim (same-model) self-review with findings F1–F11.

## The product in one line
A fleet of per-tenant **Instatic (v0.0.6 pre-alpha)** CMS Docker containers. Tenants are isolated by a Postgres **schema inside ONE shared database**, each container connecting with a private **least-privilege role** (admin/owner role sees all schemas). v1 runs **locally** (a locally-installed Postgres reached from containers via `host.docker.internal`); published static sites go to **Cloudflare Pages (free account)** via `wrangler` Direct Upload. An **AI Gateway** holds the single OpenRouter key so it is **never stored in any tenant instance** (tenant + AI can't read it). Tenants build new pages AND import/edit their own HTML, each via the manual canvas OR an in-browser AI agent. New tenants are created with email+password; the tenant sets up their own 2FA after first login.

## Locked decisions (challenge them, don't just accept)
1. One DB, **schema-per-tenant**, private role per tenant; isolation by `GRANT`/`REVOKE` (not `search_path`); admin sees all.
2. **AI Gateway hides the key** (whole project) — gated by spike #4; network-level proxy as fallback.
3. Add-tenant = button + form; **tenant sets own 2FA** (admin creates email+password only).
4. Publish only an **immutable finished folder** (no half-written bakes).
5. **Pinned** Instatic image; building on pre-alpha is a known, accepted risk.
6. Animated-import handling = **decide after a spike** (import → edit → deploy → observe).

## Attack these points especially (give a one-line fix for each finding)
1. **Schema isolation:** will Instatic + its migration tool actually create tables in a non-`public` schema, or silently use `public` and collide across tenants? (spike #9) What about a pooled connection dropping `search_path`, or `CREATE EXTENSION` landing in `public`?
2. **Security:** is per-tenant isolation truly enforced by `GRANT`/`REVOKE`? After `REVOKE ALL ON SCHEMA public FROM PUBLIC`, can a tenant — or its AI — still read another tenant's schema (e.g. fully-qualified)?
3. **Headless first-run:** given a cookie+CSRF + capability-gated + **TOTP** admin API and a **browser-bridged** agent, is a DB-seed (`INSTATIC_SECRET_KEY`) or Playwright pass actually viable, or is semi-manual the only honest path? (spike #2) Does creating the Owner force 2FA before the tenant can set their own?
4. **AI Gateway:** does Instatic accept a custom OpenRouter base URL? If not, is the network-level proxy fallback sound and truly key-hiding? Can the gateway address-token be abused? (spike #4)
5. **Provisioning saga:** ordering, idempotency, cleanup on partial failure (don't leak a scarce free-tier Cloudflare project); guard against duplicate Owner on re-run.
6. **Publish:** half-written-bake protection; Cloudflare free-tier limits at fleet scale; `*.pages.dev` global name collisions.
7. **Foundation:** is building on v0.0.6 pre-alpha wise now, or should we wait / hedge? What breaks on the first upstream version bump?
8. **Simpler alternatives** the plan may have missed.

## Output format
For every finding, write: `problem (one line) → fix (one line)`.
End your reply with EXACTLY one line: `VERDICT: APPROVED` or `VERDICT: REVISE`.
