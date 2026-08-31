-- SiteAgent control-plane (Registry). Idempotent. Lives in its own schema in the
-- single shared database, alongside the per-tenant schemas.
create schema if not exists siteagent_control;

create table if not exists siteagent_control.settings (
  id                    int primary key default 1,
  openrouter_key_enc    text,
  openrouter_model      text,
  cloudflare_token_enc  text,
  cloudflare_account_id text,
  updated_at            timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

create table if not exists siteagent_control.tenants (
  id                 bigserial primary key,
  slug               text not null unique,
  schema_name        text not null,
  db_role            text not null,
  owner_email        text,
  owner_password_enc text,
  db_password_enc    text,
  secret_key_enc     text,
  port               int,
  cf_project         text,
  pages_url          text,
  status             text not null default 'provisioning',  -- provisioning|active|suspended|removed|failed
  provision_state    text not null default 'new',           -- new|db_ready|up|seeded|cf_ready|done
  secret_ref         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists siteagent_control.deploys (
  id          bigserial primary key,
  tenant_id   bigint not null references siteagent_control.tenants(id) on delete cascade,
  status      text not null default 'pending',  -- pending|uploading|live|failed
  url         text,
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists deploys_tenant_started
  on siteagent_control.deploys (tenant_id, started_at desc);

-- Idempotent column adds (for already-created tables).
alter table siteagent_control.tenants add column if not exists db_password_enc text;
alter table siteagent_control.tenants add column if not exists secret_key_enc text;
alter table siteagent_control.tenants add column if not exists custom_domain text;
alter table siteagent_control.tenants add column if not exists last_error text;
alter table siteagent_control.tenants add column if not exists display_name text;
-- Plan tier: lite = OpenDesign only (no Instatic provisioned); advanced = OpenDesign + Instatic (two-card hub).
-- NOT NULL default 'advanced' backfills every existing tenant (incl. akhil) to advanced with no migration.
alter table siteagent_control.tenants add column if not exists tier text not null default 'advanced';
-- Per-tenant OpenDesign daemon (its own OD_DATA_DIR + port, spawned by the control-plane).
alter table siteagent_control.tenants add column if not exists od_port   int;
alter table siteagent_control.tenants add column if not exists od_status text not null default 'stopped';  -- stopped|running|failed
-- Per-tenant OpenDesign web (Next.js dev) port — the tenant browses here.
alter table siteagent_control.tenants add column if not exists od_web_port int;

-- Whether search engines may index this tenant's published site.
--
-- Defaults to FALSE, and that default is the point. Instatic bakes only page
-- HTML — no robots.txt, no _headers, no meta robots — so before this column
-- every tenant we deployed was fully crawlable the moment it went live,
-- including staging copies of clients' real production sites. The deployer now
-- writes robots.txt + _headers on every deploy and reads this flag to decide
-- which pair to write, so exposure becomes a deliberate act instead of the
-- default. Existing tenants backfill to false: a live site that should be
-- indexed gets the flag set once, on purpose.
alter table siteagent_control.tenants add column if not exists search_indexing boolean not null default false;

-- Per-task-type AI model routing + global guidance (managed multi-tenant).
--   ai_categories: [{ slug, name, description, modelId, isDefault, builtin }]
--     slug is the stable, header-safe id used for routing (never the display name).
--     Exactly one row is isDefault. Builtins: design + content.
--   classifier_model: cheap model used only for the per-message classify call.
--   ai_guidance: global plain-English guidance injected into every tenant's system prompt.
-- Live tenants with only openrouter_model keep working: the gateway derives the
-- default model from openrouter_model when ai_categories is empty.
alter table siteagent_control.settings add column if not exists ai_categories   jsonb;
alter table siteagent_control.settings add column if not exists classifier_model text;
alter table siteagent_control.settings add column if not exists ai_guidance      text;

-- Tenant hub identity: the ONE login a tenant uses for BOTH tools (via SSO). One
-- row per tenant (the owner's hub account). `password_hash` is null until the
-- one-time invite is accepted; only the invite token's keyed hash is stored, so a
-- registry leak can't be replayed as a working invite.
create table if not exists siteagent_control.tenant_users (
  id                bigserial primary key,
  tenant_slug       text not null unique references siteagent_control.tenants(slug) on delete cascade,
  email             text,
  password_hash     text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  status            text not null default 'invited',  -- invited|active|disabled
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Invite token, encrypted at rest (AES-256-GCM). The *hash* is what we match on;
-- this reversible copy only exists so the operator console can show the pending
-- invite link inline (stable, until accepted) without re-minting on every view.
-- A raw DB leak still can't replay it — decrypting needs the enc key (.state/enc.key).
alter table siteagent_control.tenant_users add column if not exists invite_token_enc text;

-- ---------------------------------------------------------------------------
-- MCP agent keys — external AI agents that drive a tenant's CMS over MCP.
--
-- One row per issued key. `token_enc` is a reversible copy (same rationale as
-- the invite token above: the console can re-show a key the operator already
-- minted) while `token_hash` is what an inbound bearer is matched against, so
-- verification never needs the enc key. Revoking is a timestamp, never a
-- delete, so the audit trail keeps pointing at a real row.
--
-- `permissions` and `tables` are the per-key profile the MCP gateway enforces:
-- permissions is the granted verb set (read/create/edit/publish/...), tables
-- narrows which content tables the key may touch ('*' = every table the
-- plugin manifest already allows).
create table if not exists siteagent_control.mcp_agents (
  id           bigserial primary key,
  tenant_slug  text not null references siteagent_control.tenants(slug) on delete cascade,
  key_id       text not null unique,
  label        text not null,
  token_hash   text not null,
  token_enc    text,
  permissions  text[] not null default '{}',
  tables       text[] not null default '{*}',
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists mcp_agents_tenant on siteagent_control.mcp_agents (tenant_slug);
create index if not exists mcp_agents_token  on siteagent_control.mcp_agents (token_hash);

-- Per-call audit. The tenant CMS logs agent work as the owner (the gateway
-- signs in over hub SSO), so this table is what keeps agent activity separable
-- from human activity — and is the only place the originating key is recorded.
create table if not exists siteagent_control.mcp_agent_audit (
  id          bigserial primary key,
  tenant_slug text not null,
  key_id      text,
  tool        text not null,
  target      text,
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists mcp_agent_audit_tenant_time
  on siteagent_control.mcp_agent_audit (tenant_slug, created_at desc);

-- ---------------------------------------------------------------------------
-- Operator-managed AI for MMS Design (OpenDesign).
--
-- design_model: the ONE model every tenant's MMS Design session runs on. It is
--   deliberately NOT a third ai_categories row: ai_categories is the CMS's
--   per-task routing map (served to tenants by the gateway's /config probe and
--   validated as "exactly one isDefault, builtins design+content"), whereas OD
--   has no classifier and needs a single tool-calling + vision capable model.
--   NULL falls back to the default category's model, so an operator who never
--   picks one still gets a working /design.
-- media_keys_enc: operator-owned media provider keys (image/video/speech), one
--   encrypted JSON blob {providerId: apiKey} rather than a column per provider
--   because the provider list is long and grows upstream. Injected into each
--   tenant's OD daemon as OD_*_API_KEY env vars at spawn.
alter table siteagent_control.settings add column if not exists design_model    text;
alter table siteagent_control.settings add column if not exists media_keys_enc  text;

-- Product availability, platform-wide. Deliberately SEPARATE from tenants.tier:
-- `tier` decides what gets PROVISIONED for one tenant (lite = no Instatic), these
-- decide what is AVAILABLE on this deployment at all, for every tenant at once.
-- Both default true, so an existing deployment behaves exactly as before until an
-- operator turns something off. When only one is active the hub chooser is skipped
-- and login lands straight in that product.
alter table siteagent_control.settings add column if not exists design_active boolean not null default true;
alter table siteagent_control.settings add column if not exists cms_active    boolean not null default true;
