# Plan Review Log: SiteAgent (Instatic fleet → Cloudflare)

Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

## Act 1 — decisions locked (Claude ↔ Dineshraj)
1. **DB layout:** ONE shared Postgres database, **schema-per-tenant** (apartment-per-tenant). Not database-per-tenant, not shared-tables-with-tenant_id (that would require forking Instatic).
2. **Security:** each tenant container gets an **auto-minted least-privilege role** scoped to its own schema (DB-blocked from others); the **admin/owner credential** (set once in env) sees across all schemas. "Admin sees all" falls out of the privilege model.
3. **Gating:** the whole DB design depends on **spike #9** (Instatic honoring a non-`public` schema). Fallback if it fails = **DB-per-tenant on the same server**.
4. **v1 hosting:** runs entirely locally — local Docker + a **locally-installed Postgres** (containers reach it via `host.docker.internal`); publish to **Cloudflare Pages free account** via `wrangler` Direct Upload.
5. **Product goal (confirmed):** tenants **build new pages AND import/edit their own HTML**, each **two ways: manual canvas or AI prompting**, all in-browser. → **Instatic stays.**
6. **Client-demo findings folded in:** Instatic is **v0.0.6 pre-alpha**; admin API is cookie+CSRF + capability-gated + TOTP step-up; AI agent is **browser-bridged** (not headless-drivable); Super Import commit is browser-GUI and **flattens motion-heavy JS to an opaque blob**. → sharpened spike #2, added pre-alpha + import-fidelity risks.

## Act 2 — Codex review: BLOCKED (2026-06-29)
Codex CLI 0.140.0 present and authenticated (ChatGPT login), but the account **hit its Codex usage limit** — resets **Jul 18, 2026** (or requires Plus). Round 1 could not complete. Per skill rules, no verdict was fabricated. Environment fixes confirmed for when quota returns: pass `--skip-git-repo-check` (this dir is not a git repo) and redirect `< /dev/null` (codex exec otherwise blocks reading stdin).
**Status: Act 2 pending — re-run when Codex quota resets, or substitute an interim adversarial review.**

## Round 1 — Claude self-review (INTERIM, same-model — not the cross-model check)
_User opted for an interim adversarial pass while Codex is rate-limited. This loses the no-echo-chamber guarantee; re-run Codex on reset to validate._

**F1 — `search_path` is NOT a security boundary (critical).** The plan repeatedly says tenant roles are "DB-blocked from other schemas via `search_path`." False: `search_path` is only a name-resolution default; a role can still read `other_schema.table` if it holds privileges. Isolation comes ONLY from GRANT/REVOKE. Worse, pre-PG15 every role gets `USAGE`+`CREATE` on `public` and inherits `PUBLIC` grants by default. _Fix:_ enforce isolation with `REVOKE ALL ON SCHEMA public FROM PUBLIC`, grant each tenant role USAGE/CREATE on its own schema only, never cross-grant; treat `search_path` as convenience, not a boundary. Add this to spike #9. → **FOLD.**

**F2 — Shared-catalog / extension collisions across tenants in one DB.** Each tenant's Instatic runs migrations into the same database. If any migration does `CREATE EXTENSION` (installs into `public` / needs superuser) or creates types in `public`, tenants collide or fail. _Fix:_ pre-install required extensions once as admin; verify Instatic creates nothing in `public`. Part of spike #9. → **FOLD.**

**F3 — Will Instatic honor a non-`public` schema at all? (under-weighted).** v0.0.6 Bun/TS CMS very plausibly hardcodes `public` or creates objects that a pooled connection's `search_path` won't cover. The plan lists DB-per-tenant as a fallback but treats schema-per-tenant as the default — backwards given the risk. _Fix:_ make **DB-per-tenant the v1 default**, schema-per-tenant the optimization attempted only if spike #9 passes cleanly. **Requires user sign-off (reverses the "literally one database" preference).** → **RAISE TO USER.**

**F4 — Global OpenRouter key leaks to the tenant Owner (v1 security/cost hole).** v1 injects the ONE global key directly into each tenant's `ai_credentials`. The tenant IS the Owner of their instance; if Instatic shows/returns the key, they can exfiltrate and burn your global key. _Fix:_ confirm Instatic masks (not returns) the key; regardless set a hard OpenRouter spend cap for v1, or pull the AI Gateway / per-tenant keys forward. → **FOLD (as risk + scope note).**

**F5 — Headless first-run is fragile on BOTH paths, and pre-alpha makes it worse.** DB-seed must reproduce Instatic's exact auth schema + password hashing + `INSTATIC_SECRET_KEY` crypto — all of which churn across pre-alpha versions. Playwright depends on selectors that also churn. TOTP step-up can't be scripted without the shared secret. _Fix:_ first check whether Instatic supports an env/token admin bootstrap (e.g. `INSTATIC_ADMIN_*`); confirm the AI-key write isn't TOTP-gated (TOTP may apply only to import/replace); pin one version and treat the seeder/Playwright as version-coupled, re-validated per upgrade. For v1, consider **semi-manual first-run** (operator completes the wizard once in a browser) to de-risk the rest of the loop. → **FOLD into spike #2 + raise semi-manual option.**

**F6 — Provisioning is a cross-system saga with no defined order or rollback.** Touches Postgres + filesystem + Docker + Instatic seed + Cloudflare + Registry. "Idempotent; cleanup on failure" is asserted, not designed. Creating the CF project before the container is healthy wastes a scarce free-tier project; re-runs could duplicate the Owner. _Fix:_ ordered check-then-act keyed by slug, a state machine in the Registry (`db_ready→container_up→seeded→cf_ready→done`), guarded first-run (skip if Owner exists), compensating cleanup that walks back completed steps. → **FOLD.**

**F7 — `fs.watch` can deploy a half-written bake.** `fs.watch` is unreliable cross-platform (esp. Windows v1 dev vs Linux prod) and "debounce + confirm complete" is racy — no atomic publish-done signal. _Fix:_ publish to an immutable `uploads/published/<timestamp>/` and deploy THAT; gate on an explicit completion marker/manifest (or an Instatic publish hook), not just quiescence. → **FOLD.**

**F8 — Cloudflare project naming collides globally; `*.pages.dev` is account-global.** `<project>.pages.dev` must be globally unique across all Cloudflare; a raw `<slug>` will collide and fail creation. _Fix:_ namespace project names (`siteagent-<slug>-<rand>`) and store the returned URL in the Registry instead of assuming `<slug>.pages.dev`. → **FOLD.**

**F9 — Local Postgres + `host.docker.internal` will reject container connections by default.** Local installs listen on `localhost` and `pg_hba.conf` rejects the Docker bridge subnet → containers can't connect. _Fix:_ document `listen_addresses='*'` (or the docker gateway) + a `pg_hba.conf` rule for the Docker subnet with scram auth; or run dev Postgres in-compose. → **FOLD.**

**F10 — Per-tenant secrets land in plaintext on the host.** Auto-minted per-tenant DB passwords + `INSTATIC_SECRET_KEY` get written into `tenants/<slug>/compose.yaml`. _Fix:_ restrict perms, gitignore `tenants/`, call out plaintext-on-host as acceptable only for local v1; plan a secrets manager for prod. → **FOLD.**

**F11 — Fleet upgrade runs N concurrent migration sets against ONE database.** Upgrading the pinned image restarts every container; under schema-per-tenant they all migrate the same DB at once → catalog lock contention / shared-object conflicts. _Fix:_ sequential rolling upgrades under schema-per-tenant (another point for DB-per-tenant). → **FOLD into PLAN.md fleet-upgrade.**

VERDICT (interim, self-assessed): **REVISE** — F1/F3/F4/F6 are material. Fold F1,F2,F4–F11; escalate F3 (DB-per-tenant default) to the user.

### Claude's response (revisions applied)
Applied F1,F2,F4,F5,F6,F7,F8,F9,F10,F11 to both plans. Escalated F3 to the user.

**F3 RESOLVED (user, 2026-06-29):** keep **schema-per-tenant** (one database) as the intent, with **spike #9 as a hard go/no-go gate before any provisioner code**; DB-per-tenant remains the documented fallback if #9 fails. Plan already encodes this — no further change.

**Act 2 status:** interim same-model review complete (1 round → REVISE → revised → open item resolved). **Real cross-model Codex pass still PENDING — re-run on Jul 18, 2026** when quota resets (use `--skip-git-repo-check` + `< /dev/null`). Plan is signed-off-pending by the user for build, starting at spike #9.

## Round 2 — simplified risk sheet + additional user decisions (2026-06-29)
Walked the 8 big risks with the user in plain language (saved as the doubts sheet `~/.claude/plans/merry-sauteeing-gem.md`). Locked:
1. **DB:** one shared DB, schema-per-tenant, private least-privilege role per tenant (AI inside an instance can't cross schemas; admin sees all) — Risk 2/3 = GRANT/REVOKE, proven by spike #9.
2. **AI key:** hide via **AI Gateway** for the **entire project** — real key only with admin, **never stored in a tenant instance**. Pulled the Gateway **into v1**. Gated by spike #4; network-level proxy fallback. No per-tenant keys, no spend cap.
3. **2FA / onboarding:** admin creates tenant with **email + password only** (button + form); the **tenant sets up their own 2FA** after first login — admin never holds tenant 2FA. Spike #2 must confirm Instatic doesn't force 2FA at creation.
4. **Publish:** wait for a "done" marker, deploy an immutable finished folder (extra wait ≈ a few seconds — accepted).
5. **Animation imports:** decide after a **spike** (#A: import → edit → deploy → observe).
6. **Pre-alpha:** pin one image (our control), accept the foundation risk knowingly.

**Doc-fold applied (2026-06-29):** folded the above into `docs/PLAN.md` + `docs/PLAN_V1.md` (AI Gateway into v1 + key-never-exposed wording; 2FA flow; spike #4 + animation spike #A added; build-order gating updated). Created `docs/PLAN-REVIEW-INSTRUCTIONS.md` for the user's external AI review. **No code built.** Next: user runs external AI review → then spikes (#9 first) on explicit go.

## Round 3 — external AI review (`docs/plan_review_2.md`, VERDICT: REVISE, 2026-06-29)
A different model reviewed both plans. Triage (Claude = arbiter):
- **Already covered (confirms our plan, no echo chamber):** #1 extensions/`public`, #6 Playwright/seed fragility, #7 forced-2FA, #8 saga leaks, #9 publish race.
- **Folded as improvements:** **#2** pin `search_path` at the **role** (`ALTER ROLE`); **#4** signed gateway token + per-tenant rate guard (= the AI-cost risk); **#5** route AI calls server-side (not browser); **#10** Cloudflare ~100-Pages-project hard cap + multi-account rotation.
- **NEW + material → escalated to user (DB model):** **#3** Postgres **system catalogs are globally readable** → schema-per-tenant leaks other tenants' *schema/table names + structure* (not row data); cannot be cleanly locked down. **#11** **SQLite-per-instance** would bypass #1/#2/#3 + lock contention + single-DB blast radius entirely (each tenant = own file) — *if Instatic supports SQLite*. Both point away from schema-per-tenant for true isolation. **Pending user decision on DB model.**
- **Reject/none.** Verdict REVISE is fair; the catalog-leak (#3) is a genuine miss in our prior reviews.

## Spike #9 — DATABASE SIDE: RUN & PASSED (2026-06-30, real PostgreSQL 18 / db `siteagent_platform`)
Ran a live, throwaway isolation test (two roles + two schemas in one DB; `spike_*` objects, all dropped after). Results:
- **TEST 1 ✅** two tenants, same table name `pages`, coexist in one DB — separate tables, no collision.
- **TEST 2 ✅** tenant reads its own data; role-level `ALTER ROLE … SET search_path` (review #2) applied at login.
- **TEST 3 ✅ (critical)** tenant `spike_acme_role` reading `spike_globex.pages` → **`ERROR: permission denied for schema spike_globex`**. GRANT/REVOKE isolation holds (Risk 2/3 proven at DB level; AI agent inside a tenant role is equally blocked).
- **TEST 4 ✅ (confirms review #3)** via `information_schema` acme saw only its own table; via raw `pg_catalog` (`pg_tables`/`pg_namespace`) acme **also saw `spike_globex`** → the metadata name-leak is real (data stays hidden; names/structure visible). Accepted-limitation decision validated.
**Scope caveat:** this proves the **Postgres design** (isolation mechanics). It does **NOT** yet prove **Instatic** writes its tables into the assigned schema (not `public`) or honors a non-`public` `search_path` — that half needs the actual Instatic container (Docker not installed on this machine). Spike #9 is therefore **half-proven: DB design solid; Instatic-cooperation still open.**

### Spike #9b — provisioner DB ops + security + capacity (2026-06-30, also PASSED)
- **Idempotent provision ✅** re-running the mint-tenant SQL (DO-guard for role + `CREATE SCHEMA IF NOT EXISTS`) → no error on 2nd run. **Clean deprovision ✅** drop schema+role → 0 leftovers (finding #6 DB ops validated).
- **Security ✅** tenant role: `pg_authid` (password hashes) → `permission denied`; `CREATE TABLE public.x` → `permission denied for schema public`; can still write its OWN schema. **PG18 default**: tenant has **no** CREATE on `public` out of the box.
- **Capacity ⚠️ (new finding):** `max_connections = 100` (11 baseline in use). One shared Postgres ≈ **~5–8 Instatic tenants** before raising `max_connections` or adding **PgBouncer**. Fleet-scaling limit; document it (not a v1 blocker). 
**Everything testable WITHOUT Docker/Instatic is now done.** Remaining spikes (#9 Instatic-cooperation half, #2 headless first-run, #4 AI-gateway, publish #1/#3, animation) all require Docker + the Instatic image.

**Findings #3 + #11 RESOLVED (Operator, 2026-06-29):** **keep schema-per-tenant**; the system-catalog **metadata leak is ACCEPTED** (harmless for v1 / non-competing tenants). **SQLite-per-instance** and **DB-per-tenant** stay documented as the stronger-isolation upgrade paths to revisit before onboarding competing tenants. All other plan_review_2 findings folded (#2/#4/#5/#10) or already covered (#1/#6/#7/#8/#9). External review cycle closed.

