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
