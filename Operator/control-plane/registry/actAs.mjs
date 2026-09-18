// "Acting as" — the one way a platform administrator opens a business's work (R5).
//
// The PRD is explicit that this is not a read-only preview and not a back
// door: opening the work is a distinct, logged mode, recorded as *platform
// staff, acting as that business* — never as the business itself.
//
// So the grant is a real person on the project, flagged as staff and given the
// administrator's own address and a name that says what it is. Three things
// fall out of that, none of which needed inventing:
//
//   · MMS-CMS and MMS-Design attribute every edit to that name in their own
//     logs, with no change to either product's sign-in;
//   · the project's own People page shows that platform staff are inside, so
//     the customer can see it and can throw them out;
//   · ending it is the path Phase 1 already proved — remove the person and the
//     session dies everywhere, including the tools, because the people sync
//     suspends the account and revokes its sessions in the CMS.
//
// Which is why exit, expiry and "the customer removed them" are all one code
// path here rather than three.

import { query } from './db.mjs';

/** How long a grant lasts. Long enough to do the work; short enough that a forgotten tab is not standing access. */
export const GRANT_TTL_SEC = 60 * 60;

const STAFF_ROLE = 'admin'; // Publisher: edits and publishes, never owns.
const status = (message, code) => Object.assign(new Error(message), { status: code });

export const staffDisplayName = (email) => `Platform staff · ${email}`;

/**
 * Open a grant. The audit row is written first, by the caller, and its id
 * comes in here — a grant that was handed out but never recorded is exactly
 * the thing this mode exists to prevent.
 */
export async function openGrant({ slug, admin, grantId, ttlSec = GRANT_TTL_SEC }) {
  const email = String(admin?.email || '').trim().toLowerCase();
  if (!email) throw status('That administrator has no address to act with', 400);

  // Somebody who is already a person here does not need to act as anybody:
  // they would be upgrading their own standing access under a different name,
  // which is the opposite of a record.
  const { rows: existing } = await query(
    `select id, staff_admin_id from siteagent_control.tenant_users
      where tenant_slug = $1 and lower(email) = $2 and status <> 'removed'`,
    [slug, email],
  );
  const mine = existing.find((r) => String(r.staff_admin_id ?? '') === String(admin.id));
  if (existing.length && !mine) {
    throw status('You already have an account on this project — sign in as yourself instead', 409);
  }

  const expires = new Date(Date.now() + ttlSec * 1000);
  if (mine) {
    // Re-entering extends the same grant rather than stacking rows. Touching
    // updated_at ends the previous session, so the new expiry is the only one.
    const { rows } = await query(
      `update siteagent_control.tenant_users
          set staff_grant_id = $3, staff_expires_at = $4, role = $5, status = 'active',
              display_name = $6, updated_at = now()
        where id = $1 and tenant_slug = $2
        returning *`,
      [mine.id, slug, grantId, expires, STAFF_ROLE, staffDisplayName(email)],
    );
    return rows[0];
  }
  const { rows } = await query(
    `insert into siteagent_control.tenant_users
       (tenant_slug, email, role, display_name, status, staff_admin_id, staff_grant_id, staff_expires_at)
     values ($1, $2, $3, $4, 'active', $5, $6, $7)
     returning *`,
    [slug, email, STAFF_ROLE, staffDisplayName(email), admin.id, grantId, expires],
  );
  return rows[0];
}

/**
 * Close every grant this administrator holds (or just the one on `slug`).
 * Removing the person is what revokes the access, here and in the products.
 */
export async function closeGrants(adminId, slug = null) {
  const params = [String(adminId)];
  let where = 'staff_admin_id = $1';
  if (slug) {
    params.push(slug);
    where += ` and tenant_slug = $${params.length}`;
  }
  const { rows } = await query(
    `update siteagent_control.tenant_users
        set status = 'removed', password_hash = null, invite_token_hash = null,
            staff_expires_at = null, updated_at = now()
      where ${where} and status <> 'removed'
      returning *`,
    params,
  );
  return rows;
}

/** The grants this administrator is inside right now. */
export async function activeGrants(adminId) {
  if (adminId === null || adminId === undefined) return [];
  const { rows } = await query(
    `select u.id, u.tenant_slug, u.staff_grant_id, u.staff_expires_at,
            t.display_name as project_name, t.business_id,
            b.name as business_name
       from siteagent_control.tenant_users u
       join siteagent_control.tenants t on t.slug = u.tenant_slug
  left join siteagent_control.businesses b on b.id = t.business_id
      where u.staff_admin_id = $1 and u.status = 'active'
        and (u.staff_expires_at is null or u.staff_expires_at > now())
      order by u.staff_expires_at`,
    [String(adminId)],
  );
  return rows;
}

/** The grant a person row belongs to, or null when the person is not staff. */
export function grantOfPerson(person) {
  if (!person || !person.staff_admin_id) return null;
  return {
    grantId: person.staff_grant_id ?? null,
    adminId: String(person.staff_admin_id),
    slug: person.tenant_slug,
    expiresAt: person.staff_expires_at ?? null,
  };
}

/**
 * Remove grants whose hour is up. Expiry has to be swept rather than merely
 * checked at sign-in, because the products hold their own sessions: an
 * expired row that still exists is still an account they will honour.
 */
export async function sweepExpiredGrants() {
  const { rows } = await query(
    `update siteagent_control.tenant_users
        set status = 'removed', password_hash = null, staff_expires_at = null, updated_at = now()
      where staff_admin_id is not null and status <> 'removed'
        and staff_expires_at is not null and staff_expires_at <= now()
      returning id, tenant_slug, staff_admin_id, staff_grant_id`,
    [],
  );
  return rows;
}
