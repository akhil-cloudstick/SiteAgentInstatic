// Provisioner — provisionTenant() saga + deprovision + (re)start supervision.
// No Docker: each tenant is a native Bun Instatic process (see runtime/).
import { mkdirSync, rmSync } from 'node:fs';
import { query } from '../registry/db.mjs';
import * as tenants from '../registry/tenants.mjs';
import * as rt from '../runtime/tenantRuntime.mjs';
import { encrypt, decrypt, genPassword, genSecretKeyHex } from '../lib/crypto.mjs';
import { getSettings } from '../registry/settings.mjs';
import config from '../lib/env.mjs';

// The operator's chosen model (from Settings) enables managed AI on each tenant:
// when set, TenantRuntime wires the instance to this tenant's AI-Gateway URL and
// pins the model. Empty string → managed AI stays off (standalone BYO-key AI).
async function operatorAiModel() {
  try {
    return (await getSettings()).openrouterModel || '';
  } catch {
    return '';
  }
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
// schema/role identifiers derived from slug (hyphens -> underscores), validated.
function names(slug) {
  const base = slug.replace(/-/g, '_');
  const schema = `t_${base}`;
  const role = `r_${base}`;
  if (!/^[a-z][a-z0-9_]{0,48}$/.test(schema) || !/^[a-z][a-z0-9_]{0,48}$/.test(role)) {
    throw new Error(`invalid tenant slug for identifiers: ${slug}`);
  }
  return { schema, role };
}

async function allocatePort() {
  const { rows } = await query(
    'select coalesce(max(port), $1 - 1) as m from siteagent_control.tenants', [config.tenantBasePort]);
  return Number(rows[0].m) + 1;
}

// Mint the tenant's Postgres schema + least-privilege role (idempotent).
async function mintDb(schema, role, dbPassword) {
  // role: create or rotate password
  await query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = '${role}') then
      execute format('create role %I login password %L', '${role}', '${dbPassword}');
    else
      execute format('alter role %I login password %L', '${role}', '${dbPassword}');
    end if;
  end $$;`);
  await query(`create schema if not exists ${schema} authorization ${role}`);
  await query(`alter role ${role} set search_path = ${schema}`);
  await query(`grant connect on database ${config.pgDb} to ${role}`);
  await query(`revoke all on schema public from ${role}`);
}

// Build the in-memory runtime params for an instance (decrypts secrets).
function runtimeParams(row) {
  return {
    slug: row.slug,
    port: row.port,
    dbRole: row.db_role,
    dbPassword: decrypt(row.db_password_enc),
    secretKey: decrypt(row.secret_key_enc),
  };
}

export async function provisionTenant({ name, ownerEmail }) {
  const slug = slugify(name);
  if (!slug) throw new Error('A valid tenant name is required.');
  const existing = await tenants.getTenant(slug);
  if (existing && existing.status !== 'removed' && existing.status !== 'failed') {
    throw new Error(`Tenant "${slug}" already exists.`);
  }
  const { schema, role } = names(slug);
  const dbPassword = genPassword();
  const secretKey = genSecretKeyHex();
  const port = await allocatePort();

  // 0) registry row
  await tenants.createTenant({
    slug, schemaName: schema, dbRole: role, ownerEmail,
    ownerPasswordEnc: null, secretRef: null, port,
  });
  await tenants.updateTenant(slug, {
    db_password_enc: encrypt(dbPassword),
    secret_key_enc: encrypt(secretKey),
  });

  try {
    // 1) DB
    await mintDb(schema, role, dbPassword);
    await tenants.updateTenant(slug, { provision_state: 'db_ready' });

    // 2) start native instance (Instatic auto-migrates into its schema on boot)
    rt.start({ slug, port, dbRole: role, dbPassword, secretKey, aiModel: await operatorAiModel() });
    const healthy = await rt.waitHealthy(port, 60000);
    if (!healthy) throw new Error('Instance did not become healthy in time.');
    await tenants.updateTenant(slug, { provision_state: 'up' });

    // 3) self-onboard: the tenant creates their site + owner via the share link.
    //    (No headless owner creation — Instatic's native setup wizard handles it.)
    await tenants.updateTenant(slug, { provision_state: 'seeded' });

    // 4) Cloudflare project is created lazily on first publish (wrangler --create).
    await tenants.updateTenant(slug, {
      provision_state: 'done', status: 'active',
      cf_project: `siteagent-${slug}`,
    });

    return {
      slug, schema, role, port,
      shareUrl: `http://127.0.0.1:${port}/admin`,
      message: 'Open the share link to create your owner account and start building.',
    };
  } catch (err) {
    await tenants.updateTenant(slug, { status: 'failed', provision_state: 'failed' });
    // walk-back cleanup so a partial failure leaves nothing behind
    try { await deprovisionTenant(slug, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

// Stop the instance, drop schema + role, remove files. Keeps a 'removed' tombstone.
export async function deprovisionTenant(slug, { force = false } = {}) {
  const row = await tenants.getTenant(slug);
  if (!row && !force) throw new Error(`Unknown tenant: ${slug}`);
  const { schema, role } = names(slug);

  rt.stop(slug);
  await new Promise((r) => setTimeout(r, 1500)); // let connections close

  await query(`drop schema if exists ${schema} cascade`);
  // DROP OWNED clears privileges/default-acls so the role drops cleanly.
  await query(`do $$ begin
    if exists (select 1 from pg_roles where rolname = '${role}') then
      execute format('drop owned by %I cascade', '${role}');
      execute format('drop role %I', '${role}');
    end if;
  end $$;`);

  try { rmSync(rt.tenantPaths(slug).dir, { recursive: true, force: true }); } catch { /* ignore */ }

  if (row) await tenants.updateTenant(slug, { status: 'removed', provision_state: 'removed' });
  return { slug, removed: true };
}

// Start (or restart) an already-provisioned tenant's instance.
export async function startTenant(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);
  if (rt.isRunning(slug)) return { slug, alreadyRunning: true, port: row.port };
  rt.start({ ...runtimeParams(row), aiModel: await operatorAiModel() });
  const healthy = await rt.waitHealthy(row.port, 45000);
  return { slug, port: row.port, healthy };
}

// On control-plane boot, bring active tenants back up.
export async function resumeAll() {
  const rows = await tenants.listTenants();
  const active = rows.filter((r) => r.status === 'active');
  const aiModel = await operatorAiModel();
  for (const r of active) {
    try { rt.start({ ...runtimeParams(r), aiModel }); } catch (e) { console.error(`[provisioner] resume ${r.slug} failed:`, e.message); }
  }
  return active.map((r) => r.slug);
}
