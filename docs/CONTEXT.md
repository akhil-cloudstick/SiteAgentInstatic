# CONTEXT — SiteAgent (Instatic fleet) ubiquitous language
_Glossary only. No implementation details. Terms here are the canonical vocabulary used across [`PLAN.md`](PLAN.md), [`Architecture.md`](Architecture.md), [`DB-Architecture.md`](DB-Architecture.md), and any ADRs._

- **Product / SiteAgent** — the platform being built: an Operator runs a fleet of isolated CMS instances; each customer gets a full website-building CMS they edit by hand or by prompting an AI agent, and one-click **Publish** ships the site to Cloudflare.
- **Operator** — the party who owns and sells the Product. Holds the global OpenRouter API key + model and the Cloudflare credentials; provisions Tenants; runs the Operator Console and control-plane.
- **SiteAgent Operator Console** — the ONE global, admin-only application (Astro SSR). Holds no tenant content; manages settings, tenants, share links, usage/health.
- **Tenant** — an Operator's customer. Owns exactly one isolated Instatic instance.
- **Tenant Instatic Instance** — ONE per Tenant; fully isolated (own Docker container, own Postgres **schema** + role in the shared DB, own `uploads/` disk). All editing/agent/publishing happens here.
- **Instatic** — the MIT-licensed standalone CMS each Tenant runs (visual editor, BYO-key AI agent, drafts/versions, RBAC, audit log, static publishing). One install = one website; not multi-tenant by itself.
- **Tenant Admin** — the single predefined full-access role per Tenant = the Instatic **Owner**. Creates custom roles via per-permission toggles.
- **Sub-user** — an additional user inside a Tenant (an Instatic user with a custom role + per-user audit trail).
- **Schema-per-tenant** — the isolation model: ONE shared Postgres database, with one **schema** + one least-privilege **role** per Tenant. Data isolation is enforced by `GRANT`/`REVOKE`; the Operator/admin role sees all.
- **Control plane** — the Operator-side services: Provisioner, Publish Deployer, AI Gateway, Metrics Collector, Registry.
- **Provisioner** — `provisionTenant()`: the idempotent saga that creates a Tenant (schema + role → uploads + secret → render compose → start container → headless first-run → Cloudflare project → registry record), with cleanup on failure.
- **Publish Deployer** — watches a Tenant's baked output (`uploads/published/`), confirms it is complete, and direct-uploads it to the Tenant's Cloudflare Pages project (`wrangler`).
- **AI Gateway** — the control-plane proxy that holds the single OpenRouter key. Every Tenant's AI calls route through it; it injects the key (so the key is **never stored in a Tenant instance**) and meters usage per Tenant.
- **Metrics Collector** — periodically gathers per-Tenant storage / health / AI usage / deploys into the Registry for dashboards and alerts.
- **Registry** — the control-plane database/schema (`siteagent_control`): tenants, cloudflare projects, deploys, settings, usage, metrics, alerts.
- **Publish** — a Tenant clicks Publish in Instatic → Instatic bakes static HTML/CSS/media to disk → the Publish Deployer ships it live.
- **Cloudflare Pages** — the publish target. One Pages project per Tenant; served on `*.pages.dev` until a custom domain is attached.
- **Share link** — the login link + credentials the Operator hands a Tenant after provisioning, so they can log into their instance.
- **Spike** — a small, throwaway experiment that proves (or disproves) one risky assumption before any real building.
- **Name-leak** — the accepted limitation of schema-per-tenant: a Tenant can see other Tenants' schema/table *names* via Postgres system catalogs, but never their *data*.
