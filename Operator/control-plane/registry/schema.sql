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
-- stopped|starting|running|failed. Written ONCE at provisioning and never
-- updated after, so it records how that one attempt went and nothing since. It
-- is not the live state and must not be read as one: ask `studioStatus()` in
-- runtime/odRuntime.mjs, which knows whether the daemon is actually answering.
-- It said 'failed' for four live projects for months, because provisioning gave
-- the daemon 90 seconds to boot when it needs minutes.
alter table siteagent_control.tenants add column if not exists od_status text not null default 'stopped';
-- Per-tenant OpenDesign web (Next.js dev) port — the tenant browses here.
alter table siteagent_control.tenants add column if not exists od_web_port int;

-- The CMS account the connector signs in as, when it is not the tenant owner.
--
-- Two separate reasons this is not `owner_email`:
--
--   1. The hub login and the CMS login are different credential stores. The hub
--      mints an SSO token into the CMS, so an operator can use a tenant for
--      months without ever knowing its CMS password — and `owner_password_enc`
--      is empty for every tenant whose owner set their own password by invite.
--   2. A shared machine identity should not be a person's account. The connector
--      can create sites, replace a site's whole contents and publish; binding
--      that to an individual's login means their lockouts become outages and
--      their password changes become silent breakages.
--
-- Falls back to the owner credential when unset, so existing tenants are
-- unaffected.
alter table siteagent_control.tenants add column if not exists connector_email        text;
alter table siteagent_control.tenants add column if not exists connector_password_enc text;

-- Whether this tenant was provisioned THROUGH the connector, by the partner who
-- holds its token.
--
-- Exists to settle a conflict between two changes that were each correct.
-- `connector_create_site` was added so the partner stops waiting on us to
-- provision every client; connector target derivation became an explicit
-- allowlist after one of our own scratch tenants surfaced on their target list.
-- Together they let a caller create a site and then be unable to address it —
-- the dependency moved from "ask the dev to create it" to "ask the dev to
-- allowlist it", which is the same wait wearing a different hat.
--
-- Ownership resolves it where a list could not. A tenant created through the
-- connector is theirs and enrols itself; a tenant we create stays invisible to
-- them however many we add. That keeps the exposure closed while making
-- onboarding a single call, so the safe default and the convenient one stop
-- pulling against each other.
--
-- Defaults FALSE, so every existing tenant — including any created before this
-- column — is reachable only by being named deliberately.
alter table siteagent_control.tenants add column if not exists connector_managed boolean not null default false;

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

-- Tenant hub identity: the people of a project, each with ONE login for both
-- tools (via SSO). Several rows per project since Phase 1 (R3/NEW-2) — see the
-- role/index changes at the end of this file. `password_hash` is null until the
-- one-time invite is accepted; only the invite token's keyed hash is stored, so a
-- registry leak can't be replayed as a working invite.
create table if not exists siteagent_control.tenant_users (
  id                bigserial primary key,
  tenant_slug       text not null references siteagent_control.tenants(slug) on delete cascade,
  email             text,
  password_hash     text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  status            text not null default 'invited',  -- invited|active|disabled|removed
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Legacy: a reversible copy of the invite token, once kept so the console could
-- re-show a pending link. No longer written (NEW-1): an admin listing must not
-- hand out a usable invite. The link is shown once, when minted; the *hash* is
-- what we match on, so a link already shared keeps working until accepted or
-- replaced. The column stays only so older rows migrate; the update wipes them.
alter table siteagent_control.tenant_users add column if not exists invite_token_enc text;
update siteagent_control.tenant_users set invite_token_enc = null where invite_token_enc is not null;

-- ---------------------------------------------------------------------------
-- MCP agent keys — external AI agents that drive a tenant's CMS over MCP.
--
-- One row per issued key. `token_hash` is what an inbound bearer is matched
-- against, so verification never needs the plaintext. `token_enc` is legacy: a
-- reversible copy the console once used to re-show a key. It is no longer
-- written and is wiped below (NEW-1) — a minted key is shown exactly once.
-- Revoking is a timestamp, never a delete, so the audit trail keeps pointing at
-- a real row.
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

update siteagent_control.mcp_agents set token_enc = null where token_enc is not null;

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

-- ---------------------------------------------------------------------------
-- Operator console administrators (R14). Every admin/operator action requires
-- one signed in. Only the scrypt hash is stored. `updated_at` doubles as the
-- session version: resetting a password bumps it, which ends every session
-- signed before the reset. Created from the CLI or invited from the console:
--   npm run admin:create -- --email <email>      (from Operator/)
create table if not exists siteagent_control.admin_users (
  id            bigserial primary key,
  email         text not null unique,
  password_hash text not null,
  status        text not null default 'active',  -- invited|active|disabled
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- ===========================================================================
-- Phase 1 (R1) — Operator → Business → Project.
--
-- Today's tenant IS the project. An Operator (an agency) owns Businesses; a
-- Business owns projects; a Business with no Operator sits directly under the
-- platform.
--
-- The addressing rule: every stored record carries its full address (which
-- Operator, which Business). The columns are stamped by triggers from the
-- project's Business, so the address is a property of the data rather than of
-- code remembering to write it, and a query scoped to a Business can filter on
-- the record itself.
-- ===========================================================================
create table if not exists siteagent_control.operators (
  id         bigserial primary key,
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists siteagent_control.businesses (
  id          bigserial primary key,
  slug        text not null unique,
  name        text not null,
  operator_id bigint references siteagent_control.operators(id) on delete restrict,  -- null = direct
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists businesses_operator on siteagent_control.businesses (operator_id);

alter table siteagent_control.tenants add column if not exists business_id bigint references siteagent_control.businesses(id) on delete restrict;
alter table siteagent_control.tenants add column if not exists operator_id bigint references siteagent_control.operators(id) on delete restrict;
alter table siteagent_control.tenant_users    add column if not exists business_id bigint;
alter table siteagent_control.tenant_users    add column if not exists operator_id bigint;
alter table siteagent_control.mcp_agents      add column if not exists business_id bigint;
alter table siteagent_control.mcp_agents      add column if not exists operator_id bigint;
alter table siteagent_control.mcp_agent_audit add column if not exists business_id bigint;
alter table siteagent_control.mcp_agent_audit add column if not exists operator_id bigint;
alter table siteagent_control.deploys         add column if not exists business_id bigint;
alter table siteagent_control.deploys         add column if not exists operator_id bigint;
create index if not exists tenants_business on siteagent_control.tenants (business_id);
create index if not exists tenants_operator on siteagent_control.tenants (operator_id);

-- A project's Operator is always its Business's Operator.
create or replace function siteagent_control.stamp_tenant_address() returns trigger
language plpgsql as $$
begin
  if new.business_id is null then
    new.operator_id := null;
  else
    select b.operator_id into new.operator_id
      from siteagent_control.businesses b where b.id = new.business_id;
  end if;
  return new;
end $$;
drop trigger if exists tenants_stamp_address on siteagent_control.tenants;
create trigger tenants_stamp_address
  before insert or update of business_id, operator_id on siteagent_control.tenants
  for each row execute function siteagent_control.stamp_tenant_address();

-- Records addressed by project slug take the project's address.
create or replace function siteagent_control.stamp_slug_address() returns trigger
language plpgsql as $$
begin
  select t.business_id, t.operator_id into new.business_id, new.operator_id
    from siteagent_control.tenants t where t.slug = new.tenant_slug;
  return new;
end $$;
-- Records addressed by project id (deploys) likewise.
create or replace function siteagent_control.stamp_id_address() returns trigger
language plpgsql as $$
begin
  select t.business_id, t.operator_id into new.business_id, new.operator_id
    from siteagent_control.tenants t where t.id = new.tenant_id;
  return new;
end $$;
drop trigger if exists tenant_users_stamp_address on siteagent_control.tenant_users;
create trigger tenant_users_stamp_address
  before insert or update of tenant_slug, business_id, operator_id on siteagent_control.tenant_users
  for each row execute function siteagent_control.stamp_slug_address();
drop trigger if exists mcp_agents_stamp_address on siteagent_control.mcp_agents;
create trigger mcp_agents_stamp_address
  before insert or update of tenant_slug, business_id, operator_id on siteagent_control.mcp_agents
  for each row execute function siteagent_control.stamp_slug_address();
drop trigger if exists mcp_agent_audit_stamp_address on siteagent_control.mcp_agent_audit;
create trigger mcp_agent_audit_stamp_address
  before insert or update of tenant_slug, business_id, operator_id on siteagent_control.mcp_agent_audit
  for each row execute function siteagent_control.stamp_slug_address();
drop trigger if exists deploys_stamp_address on siteagent_control.deploys;
create trigger deploys_stamp_address
  before insert or update of tenant_id, business_id, operator_id on siteagent_control.deploys
  for each row execute function siteagent_control.stamp_id_address();

-- Moving a project re-addresses everything that belongs to it.
create or replace function siteagent_control.propagate_tenant_address() returns trigger
language plpgsql as $$
begin
  if new.business_id is distinct from old.business_id
     or new.operator_id is distinct from old.operator_id then
    update siteagent_control.tenant_users    set business_id = new.business_id where tenant_slug = new.slug;
    update siteagent_control.mcp_agents      set business_id = new.business_id where tenant_slug = new.slug;
    update siteagent_control.mcp_agent_audit set business_id = new.business_id where tenant_slug = new.slug;
    update siteagent_control.deploys         set business_id = new.business_id where tenant_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists tenants_propagate_address on siteagent_control.tenants;
create trigger tenants_propagate_address
  after update of business_id, operator_id on siteagent_control.tenants
  for each row execute function siteagent_control.propagate_tenant_address();

-- Moving a Business under another Operator re-addresses its projects.
create or replace function siteagent_control.propagate_business_address() returns trigger
language plpgsql as $$
begin
  if new.operator_id is distinct from old.operator_id then
    update siteagent_control.tenants set operator_id = new.operator_id where business_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists businesses_propagate_address on siteagent_control.businesses;
create trigger businesses_propagate_address
  after update of operator_id on siteagent_control.businesses
  for each row execute function siteagent_control.propagate_business_address();

-- Backfill: every project that predates the levels gets its own Business,
-- directly under the platform. A `-staging` copy shares its site's Business.
-- Projects already removed share one "Removed projects" Business, so they do
-- not each leave an empty Business behind.
do $$
declare
  t    record;
  base text;
  bid  bigint;
begin
  for t in select id, slug, status from siteagent_control.tenants where business_id is null order by id loop
    base := case when t.status = 'removed' then 'removed-projects'
                 else regexp_replace(t.slug, '-staging$', '') end;
    insert into siteagent_control.businesses (slug, name)
    values (
      base,
      case when base = 'removed-projects' then 'Removed projects'
           else coalesce(
             (select nullif(trim(x.display_name), '') from siteagent_control.tenants x where x.slug = base),
             initcap(replace(base, '-', ' '))
           ) end
    )
    on conflict (slug) do nothing;
    select b.id into bid from siteagent_control.businesses b where b.slug = base;
    update siteagent_control.tenants set business_id = bid where id = t.id;
  end loop;
end $$;
alter table siteagent_control.tenants alter column business_id set not null;

update siteagent_control.tenant_users u set business_id = t.business_id
  from siteagent_control.tenants t
 where t.slug = u.tenant_slug and u.business_id is distinct from t.business_id;
update siteagent_control.mcp_agents a set business_id = t.business_id
  from siteagent_control.tenants t
 where t.slug = a.tenant_slug and a.business_id is distinct from t.business_id;
update siteagent_control.mcp_agent_audit a set business_id = t.business_id
  from siteagent_control.tenants t
 where t.slug = a.tenant_slug and a.business_id is distinct from t.business_id;
update siteagent_control.deploys d set business_id = t.business_id
  from siteagent_control.tenants t
 where t.id = d.tenant_id and d.business_id is distinct from t.business_id;

-- ---------------------------------------------------------------------------
-- Phase 1 (R3 / NEW-2) — several people per project, each with a role.
--
-- The roles are the CMS's own four (owner, admin, client, member); the CMS
-- enforces them on every request once the person arrives through SSO. In the
-- console they read Owner / Publisher / Author / Viewer. One owner per project:
-- the account holder, who maps to the CMS owner account.
--
-- The old UNIQUE(tenant_slug) is what made a second invite overwrite the first
-- person (NEW-2). A person is now unique per (project, email) among rows that
-- are not removed, so a removed person stays as history.
alter table siteagent_control.tenant_users add column if not exists role text not null default 'owner';
alter table siteagent_control.tenant_users add column if not exists display_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_users_role_check') then
    alter table siteagent_control.tenant_users
      add constraint tenant_users_role_check check (role in ('owner', 'admin', 'client', 'member'));
  end if;
end $$;
alter table siteagent_control.tenant_users drop constraint if exists tenant_users_tenant_slug_key;
create index if not exists tenant_users_slug on siteagent_control.tenant_users (tenant_slug);
create unique index if not exists tenant_users_slug_email
  on siteagent_control.tenant_users (tenant_slug, lower(email))
  where status <> 'removed';
create unique index if not exists tenant_users_one_owner
  on siteagent_control.tenant_users (tenant_slug)
  where role = 'owner' and status <> 'removed';

-- ---------------------------------------------------------------------------
-- Phase 1 (R1) — console administrators are scoped: the platform, one Operator
-- ("own people", its Businesses only) or one Business (its projects only). An
-- invited administrator has no password until they accept.
alter table siteagent_control.admin_users add column if not exists scope_level text not null default 'platform';
alter table siteagent_control.admin_users add column if not exists operator_id bigint references siteagent_control.operators(id) on delete cascade;
alter table siteagent_control.admin_users add column if not exists business_id bigint references siteagent_control.businesses(id) on delete cascade;
alter table siteagent_control.admin_users add column if not exists invite_token_hash text;
alter table siteagent_control.admin_users add column if not exists invite_expires_at timestamptz;
alter table siteagent_control.admin_users alter column password_hash drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admin_users_scope_check') then
    alter table siteagent_control.admin_users add constraint admin_users_scope_check check (
      (scope_level = 'platform' and operator_id is null and business_id is null)
      or (scope_level = 'operator' and operator_id is not null and business_id is null)
      or (scope_level = 'business' and business_id is not null and operator_id is null)
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Phase 2 (R5) — an Operator's own branding.
--
-- Branding flows down exactly one level: an Operator's logo, name and accent
-- replace the platform's across every project it owns, while a Business that
-- sits directly under the platform keeps MMSBUILD's. That rule needs no code —
-- a project's operator_id is stamped by trigger, and "no Operator" resolves to
-- the platform brand by construction.
--
-- The artwork is stored here rather than on disk: the control plane has no
-- asset store, and a row survives a redeploy. brand_version is the ETag every
-- branded icon is served with. Without it a browser that cached one Operator's
-- favicon at a shared URL would keep showing it for the next one, for good.
alter table siteagent_control.operators add column if not exists brand_name     text;
alter table siteagent_control.operators add column if not exists brand_accent   text;
alter table siteagent_control.operators add column if not exists logo_blob      bytea;
alter table siteagent_control.operators add column if not exists logo_mime      text;
alter table siteagent_control.operators add column if not exists logo_dark_blob bytea;
alter table siteagent_control.operators add column if not exists logo_dark_mime text;
alter table siteagent_control.operators add column if not exists icon_blob      bytea;
alter table siteagent_control.operators add column if not exists icon_mime      text;
alter table siteagent_control.operators add column if not exists brand_version  int not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operators_brand_accent_check') then
    alter table siteagent_control.operators add constraint operators_brand_accent_check
      check (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Phase 2 (R5) — the Platform Owner sees counts, not work.
--
-- Opening a business's work is a distinct, logged "acting as" mode, recorded as
-- platform staff acting as that business — never as the business itself. Both
-- identities are stored: admin_* is who really did it, acting_* is who they
-- were acting as. admin_email and admin_level are denormalised on purpose — an
-- audit trail that resolves the actor's authority at read time records today's
-- authority, not the authority the action was taken with.
create table if not exists siteagent_control.admin_audit (
  id                 bigserial primary key,
  at                 timestamptz not null default now(),
  admin_id           bigint,          -- null for the connector and other machine actors
  admin_email        text not null,
  admin_level        text not null,   -- platform | operator | business | machine
  admin_operator_id  bigint,
  admin_business_id  bigint,
  acting_grant_id    bigint,          -- the act_as.enter row this action belongs to
  acting_business_id bigint,
  action             text not null,
  tenant_slug        text,
  target_type        text,
  target_id          text,
  reason             text,
  detail             jsonb not null default '{}'::jsonb,
  ok                 boolean not null default true,
  error              text,
  ip                 text,
  business_id        bigint,
  operator_id        bigint
);
create index if not exists admin_audit_at        on siteagent_control.admin_audit (at desc);
create index if not exists admin_audit_tenant_at on siteagent_control.admin_audit (tenant_slug, at desc);
create index if not exists admin_audit_admin_at  on siteagent_control.admin_audit (admin_id, at desc);
create index if not exists admin_audit_grant     on siteagent_control.admin_audit (acting_grant_id);
-- Addressed like every other project-keyed record, so a scoped read filters the
-- audit with no new logic. A row with no project (a branding change, say) keeps
-- a null address and is therefore platform-only, which is correct.
drop trigger if exists admin_audit_stamp_address on siteagent_control.admin_audit;
create trigger admin_audit_stamp_address
  before insert on siteagent_control.admin_audit
  for each row execute function siteagent_control.stamp_slug_address();

-- The act-as grant lives on the person row it creates, so ending it — by exit,
-- by expiry, or by the customer removing that person — always travels the one
-- path Phase 1 already proved: remove the person, and the session dies
-- everywhere, in the products as well as the hub.
alter table siteagent_control.tenant_users add column if not exists staff_admin_id bigint references siteagent_control.admin_users(id) on delete cascade;
alter table siteagent_control.tenant_users add column if not exists staff_grant_id bigint;
alter table siteagent_control.tenant_users add column if not exists staff_expires_at timestamptz;
create index if not exists tenant_users_staff on siteagent_control.tenant_users (staff_admin_id) where staff_admin_id is not null;

-- The bridge state the console shows, recorded when an install runs rather
-- than probed per project on every page load: probing opened an owner session
-- inside every tenant, which is exactly what R5 forbids.
alter table siteagent_control.tenants add column if not exists bridge_installed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Phase 3 (R4, AC-A2.3) — one project, one domain.
--
-- `cf_project` and `custom_domain` were free text with nothing stopping two
-- projects from naming the same one. A typo, or a `-staging` clone that kept
-- its source's Cloudflare project, was enough: publishing project A then
-- uploaded A's site onto B's live domain, because the deploy path never
-- re-checks that the Cloudflare project belongs to the project being deployed.
--
-- Partial, because a removed project must not keep a domain hostage — its name
-- is free again the moment it is gone.
create unique index if not exists tenants_cf_project_unique
  on siteagent_control.tenants (cf_project)
  where cf_project is not null and status <> 'removed';
create unique index if not exists tenants_custom_domain_unique
  on siteagent_control.tenants (lower(custom_domain))
  where custom_domain is not null and custom_domain <> '' and status <> 'removed';

-- ---------------------------------------------------------------------------
-- Phase 4 (R9) — the proof chain: a receipt per publish.
--
-- "Without this, 'it went live' is an assertion." A deploy was marked live
-- because the deploy tool exited cleanly, and nothing had ever fetched the
-- result. The `deploys` table beside this one records a time and a URL; it is
-- also mutable by design (finishDeploy updates it, the address triggers rewrite
-- it, and it is cascade-deleted with its project), so it cannot be a receipt.
--
-- This table is the receipt, and it is append-only: the row is written ONCE,
-- after the deploy and its verification have both finished, and then never
-- edited or deleted. A record that can be revised after the fact cannot settle
-- an argument about what went live, which is the only reason to keep one.
create table if not exists siteagent_control.deploy_receipts (
  id                  bigserial primary key,
  at                  timestamptz not null default now(),
  tenant_slug         text not null,
  -- WHAT went live: the hash of the exact site document that was baked, as the
  -- CMS computed it at publish time.
  content_hash        text,
  published_pages     int,
  -- WHO put it there: the Cloudflare project and the deployment the tool
  -- reported, so the platform's record and the provider's can be reconciled.
  cf_project          text,
  deploy_url          text,
  deploy_id           text,
  -- WHETHER IT IS REALLY THERE: not the deploy tool's exit code, but the answer
  -- from fetching the site afterwards. `verified` means routes were fetched and
  -- their content matched; `unverified` means the check could not run — which is
  -- deliberately NOT the same as `failed`.
  verification        text not null default 'unverified'
                      check (verification in ('verified', 'failed', 'unverified')),
  verification_detail text,
  routes_checked      int,
  routes_failed       int,
  -- WHAT IT REPLACED: the receipt of the generation before this one, so the
  -- chain can be walked backwards, and where that generation's bundle is kept.
  previous_receipt_id bigint,
  known_good_path     text,
  -- WHICH BUILD did it, so a bad release can be identified rather than guessed.
  build               text,
  business_id         bigint,
  operator_id         bigint
);
create index if not exists deploy_receipts_tenant_at on siteagent_control.deploy_receipts (tenant_slug, at desc);
create index if not exists deploy_receipts_at on siteagent_control.deploy_receipts (at desc);

-- WAS THIS A ROLLBACK? (security class E10)
--
-- The PRD names "a rollback receipt" (E-table, mmsbuild-prd.md:466) and defines
-- no fields for one; AC-B9.1 enumerates a PUBLISH receipt's fields only. These
-- two columns are the minimum the existing shape cannot already express, and
-- nothing else is added: a rollback reuses `known_good_path` (the bundle that
-- went live), `previous_receipt_id` (the chain, unchanged) and a FRESHLY
-- measured `verification` — never one copied from the receipt being restored,
-- because a rollback that did not actually restore the site must read `failed`.
--
-- `restored_from_receipt_id` is deliberately separate from `previous_receipt_id`:
-- one says which generation was put back, the other says what came immediately
-- before in time. Merging them would lose the provenance.
--
-- Defaulted so every receipt written before this is honestly labelled: they were
-- all publishes.
alter table siteagent_control.deploy_receipts
  add column if not exists kind text not null default 'publish';
alter table siteagent_control.deploy_receipts
  add column if not exists restored_from_receipt_id bigint;

do $$ begin
  alter table siteagent_control.deploy_receipts
    add constraint deploy_receipts_kind_check check (kind in ('publish', 'rollback'));
exception when duplicate_object then null; end $$;

-- Addressed like every other project-keyed record, so a scoped read filters it
-- with no new logic (R5).
drop trigger if exists deploy_receipts_stamp_address on siteagent_control.deploy_receipts;
create trigger deploy_receipts_stamp_address
  before insert on siteagent_control.deploy_receipts
  for each row execute function siteagent_control.stamp_slug_address();

-- Append-only, enforced here rather than only by the code that writes it — the
-- second layer is for whoever holds the database console. Mirrors the relay's
-- own approach, which is the one store in this system that already had it.
create or replace function siteagent_control.deploy_receipts_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'a deploy receipt is immutable: it records what went live, and may not be % after the fact',
    case tg_op when 'DELETE' then 'deleted' else 'edited' end;
end $$;
drop trigger if exists deploy_receipts_no_update on siteagent_control.deploy_receipts;
create trigger deploy_receipts_no_update before update on siteagent_control.deploy_receipts
  for each row execute function siteagent_control.deploy_receipts_immutable();
drop trigger if exists deploy_receipts_no_delete on siteagent_control.deploy_receipts;
create trigger deploy_receipts_no_delete before delete on siteagent_control.deploy_receipts
  for each row execute function siteagent_control.deploy_receipts_immutable();
