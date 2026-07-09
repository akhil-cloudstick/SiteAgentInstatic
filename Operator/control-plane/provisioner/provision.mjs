// Provisioner — provisionTenant() saga + deprovision + (re)start supervision.
// No Docker: each tenant is a native Bun Instatic process (see runtime/).
import { mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { query } from '../registry/db.mjs';
import * as tenants from '../registry/tenants.mjs';
import { createInvite } from '../registry/tenantUsers.mjs';
import * as rt from '../runtime/tenantRuntime.mjs';
import * as odrt from '../runtime/odRuntime.mjs';
import { initTenantSite, attachTenantDomain, deleteTenantSite } from '../deployer/deploy.mjs';
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
// Cloudflare Pages project names: lowercase, alphanumeric + hyphens, no leading/
// trailing hyphen, <=58 chars. Sanitize operator input; null if it empties out.
function sanitizeCfProject(s) {
  const v = String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 58);
  return v || null;
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

// OpenDesign daemon port — a range distinct from Instatic's (tenantBasePort).
async function allocateOdPort() {
  const { rows } = await query(
    'select coalesce(max(od_port), $1 - 1) as m from siteagent_control.tenants', [config.odBasePort]);
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

export async function provisionTenant({ name, ownerEmail, cfProject, customDomain, tier }) {
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
  const odPort = await allocateOdPort();
  const cf_project = sanitizeCfProject(cfProject) || `siteagent-${slug}`;
  const custom_domain = String(customDomain || '').trim().toLowerCase() || null;

  // 0) registry row (synchronous, so the console shows the tenant immediately as
  //    'provisioning'). The heavy work then runs in the BACKGROUND — the POST
  //    returns right away and the console polls provision_state for progress.
  await tenants.createTenant({
    slug, schemaName: schema, dbRole: role, ownerEmail,
    ownerPasswordEnc: null, secretRef: null, port,
    tier: tier === 'lite' ? 'lite' : 'advanced',
  });
  await tenants.updateTenant(slug, {
    db_password_enc: encrypt(dbPassword),
    secret_key_enc: encrypt(secretKey),
    cf_project, custom_domain, last_error: null,
    display_name: String(name || '').trim() || slug,
    od_port: odPort, od_status: 'stopped',
  });

  // Mint the tenant's one-time invite link (the URL the operator shares). Only the
  // token's hash is stored; this raw URL is shown once in the console.
  const inviteToken = await createInvite(slug, ownerEmail || null);
  const inviteUrl = `${config.publicBaseUrl}/invite/${inviteToken}`;

  // Fire-and-forget: never await the saga here (that is what blocked the page).
  runProvisionSaga({ slug, schema, role, dbPassword, secretKey, port, odPort })
    .catch((e) => console.error(`[provisioner] saga ${slug} crashed:`, e?.message ?? e));

  return {
    slug, cfProject: cf_project, customDomain: custom_domain, status: 'provisioning',
    inviteUrl,
    message: 'Provisioning started (~30–60s). Share the invite link with the tenant.',
  };
}

// (Re)generate a one-time invite link for an existing tenant (new or pre-existing).
export async function createTenantInvite(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);
  const token = await createInvite(slug, row.owner_email || null);
  return { ok: true, slug, url: `${config.publicBaseUrl}/invite/${token}` };
}

// The heavy provisioning steps, run in the background. Advances provision_state so
// the console can show progress; on failure it cleans up and marks the row 'failed'
// (visible, with last_error) instead of throwing to an HTTP caller that already left.
async function runProvisionSaga({ slug, schema, role, dbPassword, secretKey, port, odPort }) {
  try {
    // 1) DB
    await mintDb(schema, role, dbPassword);
    await tenants.updateTenant(slug, { provision_state: 'db_ready' });

    // 2) start native instance (Instatic auto-migrates into its schema on boot)
    rt.start({ slug, port, dbRole: role, dbPassword, secretKey, aiModel: await operatorAiModel() });
    const healthy = await rt.waitHealthy(port, 60000);
    if (!healthy) throw new Error('Instance did not become healthy in time.');
    await tenants.updateTenant(slug, { provision_state: 'up' });

    // 2b) OpenDesign daemon for this tenant (ALL tiers get OpenDesign). Isolated by
    //     its own OD_DATA_DIR on local disk + port. Non-fatal: an OD hiccup records
    //     od_status='failed' but doesn't fail the whole provision.
    try {
      odrt.start({ slug, odPort });
      const odHealthy = await odrt.waitHealthy(odPort, 90000);
      await tenants.updateTenant(slug, { od_status: odHealthy ? 'running' : 'failed' });
    } catch (e) {
      console.error(`[provisioner] OpenDesign start for ${slug} failed (non-fatal):`, e.message);
      await tenants.updateTenant(slug, { od_status: 'failed' });
    }

    // 3) self-onboard: the tenant creates their site + owner via the share link.
    await tenants.updateTenant(slug, { provision_state: 'seeded' });

    // 4) Create the Cloudflare Pages project + "Coming soon" placeholder (and attach
    //    the custom domain if one was given) so the public URL is live immediately.
    //    Best-effort: a CF hiccup records last_error but does not fail provisioning.
    try {
      const site = await initTenantSite(slug);
      if (!site.ok && !site.skipped) {
        await tenants.updateTenant(slug, { last_error: `CF: ${site.error || 'init failed'}` });
      }
    } catch (e) {
      console.error(`[provisioner] CF site init for ${slug} failed (non-fatal):`, e.message);
      await tenants.updateTenant(slug, { last_error: `CF: ${e.message}` });
    }

    await tenants.updateTenant(slug, { provision_state: 'done', status: 'active' });
  } catch (err) {
    console.error(`[provisioner] provision ${slug} failed:`, err.message);
    // walk-back cleanup so a partial failure leaves nothing behind, then keep a
    // visible 'failed' row (deprovision sets 'removed', so re-mark it afterwards).
    try { await deprovisionTenant(slug, { force: true }); } catch { /* best effort */ }
    try {
      await tenants.updateTenant(slug, {
        status: 'failed', provision_state: 'failed', last_error: err.message,
      });
    } catch { /* row may be gone; ignore */ }
  }
}

// Edit an existing tenant's editable details (owner email, CF project name, custom
// domain). Changing the domain re-attaches it on Cloudflare (safe — never touches
// published content). CF project name only affects FUTURE deploys.
export async function editTenant(slug, { displayName, ownerEmail, cfProject, customDomain, tier } = {}) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);

  const fields = {};
  if (displayName !== undefined) fields.display_name = String(displayName || '').trim() || slug;
  // Plan tier (lite|advanced). Persisting the change is enough here; provisioning
  // Instatic on a lite->advanced upgrade is wired in Phase 4 (upgradeTenantTier).
  let tierChanged = false;
  if (tier !== undefined) {
    const t = tier === 'lite' ? 'lite' : 'advanced';
    tierChanged = t !== (row.tier || 'advanced');
    fields.tier = t;
  }
  if (ownerEmail !== undefined) fields.owner_email = String(ownerEmail || '').trim() || null;
  if (cfProject !== undefined) {
    const cp = sanitizeCfProject(cfProject);
    if (cp) fields.cf_project = cp;
  }
  let domainChanged = false;
  if (customDomain !== undefined) {
    const cd = String(customDomain || '').trim().toLowerCase() || null;
    domainChanged = cd !== (row.custom_domain || null);
    fields.custom_domain = cd;
  }
  await tenants.updateTenant(slug, fields);

  let domain = null;
  if (domainChanged && fields.custom_domain) {
    const r = await attachTenantDomain(slug);
    domain = r.ok ? fields.custom_domain : null;
    if (!r.ok) await tenants.updateTenant(slug, { last_error: `CF domain: ${r.error || 'attach failed'}` });
  }
  return { ok: true, slug, domain };
}

// Retry the Cloudflare setup for a tenant (e.g. after fixing the API token). If the
// tenant has already published a real site, we only (re)attach the domain so we
// never overwrite live content; otherwise we run the full project + placeholder init.
export async function repairTenantCf(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);
  await tenants.updateTenant(slug, { last_error: null });

  if (await tenants.hasLiveDeploy(row.id)) {
    const r = await attachTenantDomain(slug);
    if (!r.ok && row.custom_domain) await tenants.updateTenant(slug, { last_error: `CF domain: ${r.error}` });
    return { ok: true, slug, mode: 'domain-only' };
  }

  const site = await initTenantSite(slug);
  if (!site.ok && !site.skipped) {
    await tenants.updateTenant(slug, { last_error: `CF: ${site.error || 'init failed'}` });
    return { ok: false, error: site.error || 'init failed' };
  }
  return { ok: true, slug, url: site.url || null, mode: 'full' };
}

// Stop the instance, drop schema + role, remove files. Keeps a 'removed' tombstone.
export async function deprovisionTenant(slug, { force = false, deleteCf = false } = {}) {
  const row = await tenants.getTenant(slug);
  if (!row && !force) throw new Error(`Unknown tenant: ${slug}`);
  const { schema, role } = names(slug);

  // Optionally tear down the Cloudflare Pages project (the live site) first, while
  // the row still exists so we can read its cf_project. Best-effort — never blocks.
  if (deleteCf && row) {
    try { await deleteTenantSite(slug); } catch (e) { console.error(`[provisioner] CF delete ${slug}:`, e.message); }
  }

  rt.stop(slug);
  odrt.stop(slug); // stop this tenant's OpenDesign daemon too
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
  try { rmSync(odrt.odPaths(slug).dataDir, { recursive: true, force: true }); } catch { /* ignore */ }

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

// --- CLIENT-TEST ONLY (see pending.md): publish ONE tenant editor on the shared
// Tailscale test funnel port so a remote client (no install, no tailnet) can open
// the tenant's Instatic admin in a browser, log in, and edit with AI. Only one
// tenant at a time (a single spare funnel port). No restart needed: every tenant
// already trusts the funnel origin (see tenantRuntime PUBLIC_ORIGIN), so this just
// repoints the funnel at the requested tenant's port. ---

function runTailscale(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('tailscale', args, { shell: process.platform === 'win32', windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `tailscale exited ${code}`))));
  });
}

export async function pointTestFunnel(slug) {
  const row = await tenants.getTenant(slug);
  if (!row) throw new Error(`Unknown tenant: ${slug}`);
  if (!rt.isRunning(slug)) await startTenant(slug); // must be up to receive traffic
  await runTailscale(['funnel', '--bg', `--https=${config.testFunnelPort}`, `http://127.0.0.1:${row.port}`]);
  return { ok: true, slug, url: `${config.testFunnelOrigin}/admin` };
}

// On control-plane boot, bring active tenants back up.
export async function resumeAll() {
  const rows = await tenants.listTenants();
  const active = rows.filter((r) => r.status === 'active');
  const aiModel = await operatorAiModel();
  for (const r of active) {
    try { rt.start({ ...runtimeParams(r), aiModel }); } catch (e) { console.error(`[provisioner] resume ${r.slug} failed:`, e.message); }
    if (r.od_port) {
      try { odrt.start({ slug: r.slug, odPort: r.od_port }); } catch (e) { console.error(`[provisioner] OD resume ${r.slug} failed:`, e.message); }
    }
  }
  return active.map((r) => r.slug);
}
