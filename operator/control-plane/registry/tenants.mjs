// Tenant + deploy registry rows.
import { query } from './db.mjs';

export async function listTenants() {
  const { rows } = await query(
    `select t.*,
            d.url        as last_url,
            d.status     as last_deploy_status,
            d.started_at as last_deploy_at
       from siteagent_control.tenants t
       left join lateral (
         select url, status, started_at
           from siteagent_control.deploys
          where tenant_id = t.id
          order by started_at desc
          limit 1
       ) d on true
      where t.status <> 'removed'
      order by t.created_at desc`,
  );
  return rows;
}

export async function getTenant(slug) {
  const { rows } = await query('select * from siteagent_control.tenants where slug = $1', [slug]);
  return rows[0] || null;
}

export async function createTenant({ slug, schemaName, dbRole, ownerEmail, ownerPasswordEnc, secretRef, port }) {
  // Re-creating a slug that was previously removed (a "tombstone" row) must
  // FULLY reset the row to the freshly-allocated values. The old clause only
  // bumped updated_at, so the stale `port` survived — the registry then pointed
  // at the wrong port while the instance booted on the newly-allocated one
  // (port drift). Reset every provisioning field from the incoming values.
  const { rows } = await query(
    `insert into siteagent_control.tenants
       (slug, schema_name, db_role, owner_email, owner_password_enc, secret_ref, port, status, provision_state)
     values ($1,$2,$3,$4,$5,$6,$7,'provisioning','new')
     on conflict (slug) do update set
       schema_name = excluded.schema_name,
       db_role = excluded.db_role,
       owner_email = excluded.owner_email,
       owner_password_enc = excluded.owner_password_enc,
       secret_ref = excluded.secret_ref,
       port = excluded.port,
       status = excluded.status,
       provision_state = excluded.provision_state,
       updated_at = now()
     returning *`,
    [slug, schemaName, dbRole, ownerEmail, ownerPasswordEnc || null, secretRef || null, port || null],
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
