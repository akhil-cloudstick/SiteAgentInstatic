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
