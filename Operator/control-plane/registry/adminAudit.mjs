// Who did what, and on whose behalf (R5).
//
// Until now nothing recorded the administrator behind an action: the only
// audit table names an agent key, and every other table records what changed
// without recording who changed it. This is that record, and it is the half of
// "acting as" that makes the mode worth having — a grant nobody can see later
// is indistinguishable from unlogged access.
//
// Both identities are stored. `admin_*` is who really did it; `acting_*` is
// who they were acting as. The actor's email and level are copied in rather
// than joined out, because an administrator gets renamed, re-scoped and
// disabled, and an audit trail that resolves authority when it is READ records
// today's authority instead of the authority the action was taken with.

import { query } from './db.mjs';
import { scopeFilter } from '../lib/scope.mjs';

/** The actor fields for an administrator, or for a machine caller. */
function actorOf(admin) {
  if (!admin) return { id: null, email: 'connector', level: 'machine', operatorId: null, businessId: null };
  return {
    id: admin.id ?? null,
    email: admin.email || 'unknown',
    level: admin.scope?.level || admin.scope_level || 'unknown',
    operatorId: admin.operator_id ?? admin.scope?.operatorId ?? null,
    businessId: admin.business_id ?? admin.scope?.businessId ?? null,
  };
}

const values = ({ admin, actAs, action, tenantSlug, targetType, targetId, reason, detail, ok, error, ip }) => {
  const a = actorOf(admin);
  return [
    a.id, a.email, a.level, a.operatorId, a.businessId,
    actAs?.grantId ?? null, actAs?.businessId ?? null,
    action,
    tenantSlug || null,
    targetType || null,
    targetId === null || targetId === undefined ? null : String(targetId),
    reason ? String(reason).slice(0, 200) : null,
    JSON.stringify(detail || {}),
    ok === undefined ? true : !!ok,
    error ? String(error).slice(0, 500) : null,
    ip || null,
  ];
};

const INSERT = `insert into siteagent_control.admin_audit
    (admin_id, admin_email, admin_level, admin_operator_id, admin_business_id,
     acting_grant_id, acting_business_id,
     action, tenant_slug, target_type, target_id, reason, detail, ok, error, ip)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`;

/**
 * Record an action. Fire-and-forget: an audit write must never be the reason a
 * working request fails, and a failure is loud in the log.
 *
 * The one exception is the act-as grant itself, which uses recordAndWait — a
 * grant you failed to record is a grant nobody can see.
 */
export function recordAdminAction(entry) {
  query(INSERT, values(entry)).catch((e) => console.error('[audit] write failed:', e.message));
}

/** Record an action and return its id, failing the caller if it cannot be written. */
export async function recordAndWait(entry) {
  const { rows } = await query(`${INSERT} returning id`, values(entry));
  return rows[0]?.id ?? null;
}

/**
 * The trail, newest first, limited to what this administrator may see. The
 * rows are addressed by the same trigger every other project-keyed record
 * uses, so the scope filter is the ordinary one.
 *
 * Rows with no project (a branding change, an administrator invite) have no
 * address, so they are platform-only — which is right: they are not a
 * customer's business.
 */
export async function listAdminAudit(scope, { tenantSlug = null, limit = 100 } = {}) {
  const capped = Math.min(Number(limit) || 100, 500);
  const params = [];
  const where = [];
  if (tenantSlug) {
    params.push(tenantSlug);
    where.push(`e.tenant_slug = $${params.length}`);
  }
  const f = scopeFilter(scope, 'e', params);
  where.push(f.sql);
  f.params.push(capped);
  const { rows } = await query(
    `select e.* from siteagent_control.admin_audit e
      where ${where.join(' and ')}
      order by e.at desc limit $${f.params.length}`,
    f.params,
  );
  return rows;
}
