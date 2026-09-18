// Tenant + deploy registry rows.
import { query } from './db.mjs';
import { scopeFilter, canReachRecord } from '../lib/scope.mjs';

// Registry rows for administrators: the scope is required and named in the
// query (R1's addressing rule), so a call that forgets it throws instead of
// listing every business's projects.
const LIST_SQL = (where) => `
    select t.*,
           b.name  as business_name,
           b.slug  as business_slug,
           o.name  as operator_name,
           d.url        as last_url,
           d.status     as last_deploy_status,
           d.started_at as last_deploy_at,
           ow.status    as hub_status,
           ow.invite_token_hash is not null as has_invite,
           ow.invite_expires_at,
           coalesce(pc.people, 0)  as people_count,
           coalesce(pc.pending, 0) as people_pending
      from siteagent_control.tenants t
      left join siteagent_control.businesses b on b.id = t.business_id
      left join siteagent_control.operators  o on o.id = t.operator_id
      left join siteagent_control.tenant_users ow
             on ow.tenant_slug = t.slug and ow.role = 'owner' and ow.status <> 'removed'
      left join lateral (
        select count(*) filter (where status <> 'removed') as people,
               count(*) filter (where status = 'invited')  as pending
          from siteagent_control.tenant_users where tenant_slug = t.slug
      ) pc on true
      left join lateral (
        select url, status, started_at
          from siteagent_control.deploys
         where tenant_id = t.id
         order by started_at desc
         limit 1
      ) d on true
     where t.status <> 'removed' and ${where}
     order by t.created_at desc`;

export async function listTenants(scope) {
  const f = scopeFilter(scope, 't');
  const { rows } = await query(LIST_SQL(f.sql), f.params);
  return rows;
}

/**
 * Every live project, for the system itself (runtime resume, connector target
 * derivation) — never for an administrator's listing.
 */
export async function listAllTenants() {
  const { rows } = await query(LIST_SQL('true'));
  return rows;
}

/**
 * The project, only if the scope reaches it. Callers answer "not found" for
 * null, so a project in another Business is indistinguishable from none.
 */
export async function getTenantInScope(scope, slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return null;
  const row = await getTenant(slug);
  return row && row.status !== 'removed' && canReachRecord(scope, row) ? row : null;
}

export async function getTenant(slug) {
  const { rows } = await query('select * from siteagent_control.tenants where slug = $1', [slug]);
  return rows[0] || null;
}

export async function createTenant({ slug, schemaName, dbRole, ownerEmail, ownerPasswordEnc, secretRef, port, tier, businessId }) {
  if (!businessId) throw new Error('A project must belong to a business');
  // Re-creating a slug that was previously removed (a "tombstone" row) must
  // FULLY reset the row to the freshly-allocated values. The old clause only
  // bumped updated_at, so the stale `port` survived — the registry then pointed
  // at the wrong port while the instance booted on the newly-allocated one
  // (port drift). Reset every provisioning field from the incoming values.
  const { rows } = await query(
    `insert into siteagent_control.tenants
       (slug, schema_name, db_role, owner_email, owner_password_enc, secret_ref, port, tier, status, provision_state, business_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'provisioning','new',$9)
     on conflict (slug) do update set
       schema_name = excluded.schema_name,
       db_role = excluded.db_role,
       owner_email = excluded.owner_email,
       owner_password_enc = excluded.owner_password_enc,
       secret_ref = excluded.secret_ref,
       port = excluded.port,
       tier = excluded.tier,
       status = excluded.status,
       provision_state = excluded.provision_state,
       business_id = excluded.business_id,
       updated_at = now()
     returning *`,
    [slug, schemaName, dbRole, ownerEmail, ownerPasswordEnc || null, secretRef || null, port || null, tier === 'lite' ? 'lite' : 'advanced', businessId],
  );
  return rows[0];
}

// `fields` keys are internal column names (never user input).
export async function updateTenant(slug, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return getTenant(slug);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `update siteagent_control.tenants set ${sets}, updated_at = now() where slug = $1 returning *`,
    [slug, ...cols.map((c) => fields[c])],
  );
  return rows[0] || null;
}

/** Move a project to another Business. Its records re-address by trigger. */
export async function moveTenant(slug, businessId) {
  const { rows } = await query(
    'update siteagent_control.tenants set business_id = $2, updated_at = now() where slug = $1 returning *',
    [slug, businessId],
  );
  return rows[0] || null;
}

// True once a real (successful) publish exists — used to avoid a placeholder
// re-deploy overwriting a tenant's live site during a CF repair.
export async function hasLiveDeploy(tenantId) {
  const { rows } = await query(
    `select 1 from siteagent_control.deploys where tenant_id = $1 and status = 'live' limit 1`,
    [tenantId],
  );
  return rows.length > 0;
}

export async function recordDeploy(tenantId, status, url, error) {
  const { rows } = await query(
    `insert into siteagent_control.deploys (tenant_id, status, url, error) values ($1,$2,$3,$4) returning *`,
    [tenantId, status, url || null, error || null],
  );
  return rows[0];
}

export async function finishDeploy(deployId, status, url, error) {
  await query(
    `update siteagent_control.deploys
        set status = $2, url = coalesce($3, url), error = $4, finished_at = now()
      where id = $1`,
    [deployId, status, url || null, error || null],
  );
}
