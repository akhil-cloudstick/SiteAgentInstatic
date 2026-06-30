# SiteAgent Plan Review 2

This document contains the adversarial review of the `docs/PLAN.md` and `docs/PLAN_V1.md` plans, following the guidelines set in `docs/PLAN-REVIEW-INSTRUCTIONS.md`.

## Findings

1. **Schema Isolation: Extension and Migration Failures**
   - **Problem:** Database migrations that run `CREATE EXTENSION` or create database-wide objects will fail under a restricted tenant role or pollute the shared public schema.
   - **Fix:** Pre-install all required extensions in the database as a superuser during database initialization and revoke `CREATE` privilege on `public` schema from `PUBLIC`.

2. **Schema Isolation: Connection Pool search_path Pollution**
   - **Problem:** Shared connection pools can drop or reuse connection state, leading to cross-tenant query execution against the wrong schema if `search_path` is not reset on checkout.
   - **Fix:** Bind the default `search_path` directly to each tenant's PostgreSQL role via `ALTER ROLE tenant_role SET search_path = tenant_schema` instead of relying on client-side setup.

3. **Security: System Catalog Metadata Exposure**
   - **Problem:** PostgreSQL system catalogs (`pg_class`, `pg_namespace`, `pg_attribute`) are globally readable by default, allowing any tenant to view the table structures and schema names of all other tenants.
   - **Fix:** Lock down system catalog access using PostgreSQL configurations/extensions or adopt a database-per-tenant / SQLite-per-instance isolation model.

4. **AI Gateway: Token Extraction and Abuse**
   - **Problem:** A tenant admin can extract the static AI Gateway URL from their instance's settings and abuse it to make direct, unmetered requests to OpenRouter.
   - **Fix:** Embed a cryptographically signed tenant token in the gateway URL and validate the signature and tenant's active quota at the gateway proxy layer.

5. **AI Gateway: Direct Client-Side Key Leaks**
   - **Problem:** If Instatic's browser-bridged agent makes direct client-side requests to the OpenRouter/Gateway endpoint, proxy tokens and URLs will be exposed to the tenant in browser network logs.
   - **Fix:** Ensure all AI communication is routed and proxied through the tenant's container backend rather than initiated directly from the frontend browser.

6. **Headless First-Run: Fragility of Playwright and DB Seeding**
   - **Problem:** Seeding a pre-alpha database schema or using Playwright UI automation is highly fragile and will break when upstream Instatic updates modify selectors or authentication schemas.
   - **Fix:** Implement a semi-manual first-run wizard in the Operator Console for v1, or tightly couple the Playwright script to the pinned Instatic container version.

7. **Headless First-Run: Immediate 2FA Gating**
   - **Problem:** If Instatic's first-run flow forces immediate 2FA setup for the primary Owner account, the automated provisioning script will fail or expose the TOTP secret.
   - **Fix:** Configure the initial Owner account with 2FA disabled, and prompt the tenant to enable 2FA manually after their first login.

8. **Provisioning Saga: Resource Leaks on Partial Failures**
   - **Problem:** If the provisioning saga fails midway (e.g., Cloudflare API down), it can leak partially created databases, containers, or Cloudflare projects with no automatic cleanup.
   - **Fix:** Write the Provisioner as a step-by-step state machine in the registry (`db_ready`, `container_up`, `cf_ready`) and execute compensating rollback steps on failure.

9. **Publish: Race Condition in Watcher Deployments**
   - **Problem:** The file system watcher could trigger deployment before all static files are completely written to disk, resulting in incomplete site publishes on Cloudflare.
   - **Fix:** Require the build process to write an explicit `manifest.json` file after flushing all data, and verify the manifest before starting the Cloudflare upload.

10. **Publish: Cloudflare Free-Tier Project Limits**
    - **Problem:** Cloudflare's free tier limits accounts to 100 Pages projects, which will silently block new tenant provisioning once the fleet scales.
    - **Fix:** Document the 100-project limit as a hard scaling threshold and implement support for multi-account Cloudflare credential rotation in the Operator Console settings.

11. **Simpler Alternatives: SQLite-per-instance Overlooked**
    - **Problem:** The schema-per-tenant Postgres model introduces significant migration, catalog-leak, and lock-contention risks that could be entirely bypassed.
    - **Fix:** Adopt SQLite-per-instance as the default storage engine, mounting the database file directly inside the tenant's host directory.

## Verdict

**VERDICT: REVISE**
