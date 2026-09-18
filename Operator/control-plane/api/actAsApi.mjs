// Opening a business's work, on the record (R5).
//
// A platform administrator reaches every project — counts and status across
// the estate are its job — but opens none of them. Opening is this: a named
// reason, an audit row written before anything is handed out, and a session
// that belongs to a visible person on the project rather than to a hidden
// privilege.
//
// The three routes are deliberately split by who is asking:
//   POST /api/act-as        · the console, holding an administrator session
//   POST /api/act-as/exit   · the console, ending it from outside
//   POST /act-as/exit       · the banner INSIDE MMS-CMS or MMS-Design, which
//                             cannot see the administrator cookie at all
//                             (sa_admin is Path=/operator) and is authorised
//                             by the staff hub session it is ending.

import * as tenantsRepo from '../registry/tenants.mjs';
import { getBusiness } from '../registry/org.mjs';
import { openGrant, closeGrants, activeGrants, GRANT_TTL_SEC } from '../registry/actAs.mjs';
import { recordAdminAction, recordAndWait } from '../registry/adminAudit.mjs';
import { canOpenWork } from '../lib/scope.mjs';
import { sessionCookie, clearCookie } from '../hub/hub.mjs';
import { syncPeopleSoon } from '../provisioner/peopleSync.mjs';

const status = (message, code) => Object.assign(new Error(message), { status: code });

/** The grant this administrator holds on this project, or null. */
export async function grantFor(admin, slug) {
  if (!admin?.id || !slug) return null;
  const grants = await activeGrants(admin.id);
  const g = grants.find((x) => x.tenant_slug === slug);
  return g ? { grantId: g.staff_grant_id, slug: g.tenant_slug, businessId: g.business_id } : null;
}

/**
 * The gate every content-plane action passes (AC-A5.1). A platform
 * administrator is refused unless it is currently acting as this project, and
 * the refusal names the way in — a dead end teaches nobody anything.
 *
 * Returns the grant (or null for administrators who need none), so the caller
 * can put both identities on the audit row.
 */
export async function requireOpenWork(admin, tenant) {
  if (!admin) return null; // the Connector's own token: not an administrator at all
  const actAs = await grantFor(admin, tenant.slug);
  if (canOpenWork(admin.scope, tenant, actAs)) return actAs;
  throw Object.assign(
    new Error("Platform administrators cannot open a business's work. Use “Act as this business” first."),
    { status: 403, actAs: { url: '/api/act-as', slug: tenant.slug } },
  );
}

/** Both identities, in the shape the audit writer wants. */
export const actorPair = (grant, businessId = null) =>
  grant ? { grantId: grant.grantId, businessId: grant.businessId ?? businessId } : null;

export async function handleActAsApi({ req, res, method, path, admin, send, readJson }) {
  if (path === '/api/act-as' && method === 'GET') {
    send(res, 200, { grants: await activeGrants(admin?.id) });
    return true;
  }

  if (path === '/api/act-as' && method === 'POST') {
    const body = await readJson(req);
    const slug = String(body.slug || '');
    const reason = String(body.reason || '').trim();
    if (admin?.scope?.level !== 'platform') {
      throw status('Only platform administrators act as a business; you already reach your own projects', 403);
    }
    if (!reason) throw status('Say why you are opening this project — it goes on the record', 400);
    if (reason.length > 200) throw status('That reason is too long', 400);

    const tenant = await tenantsRepo.getTenantInScope(admin.scope, slug);
    if (!tenant) throw status('not found', 404);
    const business = tenant.business_id ? await getBusiness(tenant.business_id).catch(() => null) : null;

    // Recorded FIRST, and awaited. A grant handed out after a failed write is
    // access nobody can see afterwards, which is the one thing this mode exists
    // to prevent.
    const grantId = await recordAndWait({
      admin,
      actAs: { grantId: null, businessId: tenant.business_id ?? null },
      action: 'act_as.enter',
      tenantSlug: tenant.slug,
      targetType: 'tenant',
      targetId: tenant.slug,
      reason,
      detail: { business: business?.name ?? null, ttlSeconds: GRANT_TTL_SEC },
      ip: req.socket?.remoteAddress ?? null,
    });

    const person = await openGrant({ slug: tenant.slug, admin, grantId });
    // The project's CMS learns about the new person at once, so the work is
    // attributed to them from the first edit rather than from the next sweep.
    syncPeopleSoon(tenant.slug, 0);

    res.setHeader('Set-Cookie', sessionCookie(person));
    send(res, 200, {
      ok: true,
      grantId: String(grantId),
      slug: tenant.slug,
      project: tenant.display_name || tenant.slug,
      business: business?.name ?? null,
      expiresInSeconds: GRANT_TTL_SEC,
      redirect: '/hub',
    });
    return true;
  }

  if (path === '/api/act-as/exit' && method === 'POST') {
    const body = await readJson(req).catch(() => ({}));
    await endGrants(admin, body.slug ? String(body.slug) : null, req);
    res.setHeader('Set-Cookie', clearCookie());
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * End a grant and revoke it everywhere. Removing the person row is what does
 * the revoking: the people sync tells the project's CMS the account is gone,
 * and Phase 1 already ends a hub session the moment its person is removed.
 * Clearing the browser's cookies alone would leave the tool sessions alive —
 * they are the real credential.
 */
export async function endGrants(admin, slug = null, req = null) {
  if (!admin?.id) return [];
  const closed = await closeGrants(admin.id, slug);
  for (const person of closed) {
    syncPeopleSoon(person.tenant_slug, 0);
    recordAdminAction({
      admin,
      actAs: { grantId: person.staff_grant_id ?? null, businessId: person.business_id ?? null },
      action: 'act_as.exit',
      tenantSlug: person.tenant_slug,
      targetType: 'tenant',
      targetId: person.tenant_slug,
      ip: req?.socket?.remoteAddress ?? null,
    });
  }
  return closed;
}
