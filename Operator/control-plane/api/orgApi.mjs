// Admin API for the levels (R1) and a project's people (R3, NEW-2).
//
// Every route here is behind the admin gate in server.mjs (lib/adminAuth.mjs
// isAdminApiPath) except /api/admin/accept, which an invited administrator
// uses before they have a session. Every read and change is limited to the
// caller's scope; a project, Business or Operator outside it answers
// "not found", so another Business's data never appears (AC-A1.2).
import config from '../lib/env.mjs';
import { isPlatform } from '../lib/scope.mjs';
import { getTenantInScope, moveTenant } from '../registry/tenants.mjs';
import {
  orgTree, listOperators, getOperatorInScope, createOperator, updateOperator,
  listBusinesses, getBusinessInScope, createBusiness, updateBusiness,
} from '../registry/org.mjs';
import {
  listPeople, invitePerson, setRole, removePerson, reissueInvite, INVITABLE_ROLES,
} from '../registry/tenantUsers.mjs';
import { listAdmins, inviteAdmin, acceptAdminInvite, disableAdmin } from '../registry/adminUsers.mjs';
import { syncPeopleSoon } from '../provisioner/peopleSync.mjs';

const notFound = () => Object.assign(new Error('not found'), { status: 404 });
const forbidden = (msg) => Object.assign(new Error(msg), { status: 403 });
const inviteUrl = (token) => `${config.gatewayOrigin}/invite/${token}`;
const adminInviteUrl = (token) => `${config.gatewayOrigin}/operator/accept?token=${encodeURIComponent(token)}`;

const idParam = (v) => (/^\d+$/.test(String(v ?? '')) ? String(v) : null);

function adminView(a) {
  return {
    id: String(a.id),
    email: a.email,
    status: a.status,
    level: a.scope_level,
    operatorId: a.operator_id === null ? null : String(a.operator_id),
    businessId: a.business_id === null ? null : String(a.business_id),
    operatorName: a.operator_name ?? null,
    businessName: a.business_name ?? null,
    invitePending: !!a.invite_pending,
    lastLoginAt: a.last_login_at ?? null,
  };
}

function personView(p) {
  return {
    id: String(p.id),
    email: p.email,
    displayName: p.display_name,
    role: p.role,
    status: p.status,
    invitePending: !!p.invite_pending,
    createdAt: p.created_at,
  };
}

/**
 * Returns true when it answered. `admin` is null only for the open accept
 * route; every other route here is reached only with a signed-in admin.
 */
export async function handleOrgApi({ req, res, method, path, admin, send, readJson }) {
  const reply = (code, body) => { send(res, code, body); return true; };
  // ---- Invited administrators (open) ------------------------------------------
  if (path === '/api/admin/accept' && method === 'POST') {
    const b = await readJson(req);
    const password = String(b.password || '');
    if (password.length < 12) return reply(400, { error: 'Use at least 12 characters.' });
    const row = await acceptAdminInvite(String(b.token || ''), password);
    if (!row) return reply(410, { error: 'This invite is no longer valid.' });
    return reply(200, { email: row.email });
  }
  if (!admin) return false;
  const scope = admin.scope;

  // ---- The chain (AC-A1.1) ------------------------------------------------------
  if (path === '/api/org' && method === 'GET') {
    return reply(200, await orgTree(scope));
  }

  // ---- Operators ------------------------------------------------------------------
  if (path === '/api/operators') {
    if (method === 'GET') return reply(200, { operators: await listOperators(scope) });
    if (method === 'POST') {
      const b = await readJson(req);
      return reply(200, { operator: await createOperator(scope, { name: b.name, slug: b.slug }) });
    }
  }
  const op = path.match(/^\/api\/operators\/(\d+)(?:\/(update))?$/);
  if (op && op[2] === 'update' && method === 'POST') {
    const b = await readJson(req);
    return reply(200, { operator: await updateOperator(scope, op[1], { name: b.name }) });
  }
  if (op && !op[2] && method === 'GET') {
    const operator = await getOperatorInScope(scope, op[1]);
    if (!operator) throw notFound();
    const businesses = (await listBusinesses(scope)).filter((x) => String(x.operator_id) === op[1]);
    return reply(200, { operator, businesses });
  }

  // ---- Businesses -------------------------------------------------------------------
  if (path === '/api/businesses') {
    if (method === 'GET') return reply(200, { businesses: await listBusinesses(scope) });
    if (method === 'POST') {
      const b = await readJson(req);
      const business = await createBusiness(scope, { name: b.name, slug: b.slug, operatorId: b.operatorId });
      return reply(200, { business });
    }
  }
  const biz = path.match(/^\/api\/businesses\/(\d+)(?:\/(update))?$/);
  if (biz) {
    if (!biz[2] && method === 'GET') {
      const business = await getBusinessInScope(scope, biz[1]);
      if (!business) throw notFound();
      const tree = await orgTree(scope);
      const all = [...tree.direct, ...tree.other, ...tree.operators.flatMap((o) => o.businesses)];
      const projects = all.find((x) => x.id === String(business.id))?.projects ?? [];
      return reply(200, { business, projects });
    }
    if (biz[2] === 'update' && method === 'POST') {
      const b = await readJson(req);
      const patch = {};
      if (b.name !== undefined) patch.name = b.name;
      if (Object.hasOwn(b, 'operatorId')) patch.operatorId = b.operatorId;
      return reply(200, { business: await updateBusiness(scope, biz[1], patch) });
    }
  }

  // ---- Console administrators ("own people" per level) -------------------------------
  if (path === '/api/admins') {
    if (method === 'GET') return reply(200, { admins: (await listAdmins(scope)).map(adminView) });
    if (method === 'POST') {
      const b = await readJson(req);
      const level = String(b.level || '');
      const target = {
        level,
        operatorId: level === 'operator' ? idParam(b.operatorId) : null,
        businessId: level === 'business' ? idParam(b.businessId) : null,
      };
      const { admin: created, token } = await inviteAdmin(scope, b.email, target);
      // The link is in this response only; only its hash is stored.
      return reply(200, { admin: adminView(created), inviteUrl: adminInviteUrl(token) });
    }
  }
  const adm = path.match(/^\/api\/admins\/(\d+)\/disable$/);
  if (adm && method === 'POST') {
    return reply(200, { admin: adminView(await disableAdmin(scope, admin.id, adm[1])) });
  }

  // ---- A project's Business, and its people -------------------------------------------
  const tp = path.match(/^\/api\/tenants\/([a-z0-9-]+)\/(move|people)(?:\/(\d+)\/(role|remove|invite))?$/);
  if (tp) {
    const tenant = await getTenantInScope(scope, tp[1]);
    if (!tenant) throw notFound();
    const slug = tenant.slug;

    if (tp[2] === 'move' && !tp[3] && method === 'POST') {
      if (scope.level === 'business') throw forbidden('Business administrators cannot move projects');
      const b = await readJson(req);
      const target = await getBusinessInScope(scope, b.businessId);
      if (!target) throw notFound();
      const moved = await moveTenant(slug, target.id);
      return reply(200, { slug, businessId: String(moved.business_id) });
    }

    if (tp[2] === 'people' && !tp[3]) {
      if (method === 'GET') {
        return reply(200, { people: (await listPeople(slug)).map(personView), roles: INVITABLE_ROLES });
      }
      if (method === 'POST') {
        const b = await readJson(req);
        if (!INVITABLE_ROLES.includes(b.role)) {
          throw Object.assign(new Error(`Choose one of: ${INVITABLE_ROLES.join(', ')}`), { status: 400 });
        }
        const { person, token } = await invitePerson(slug, {
          email: b.email, role: b.role, displayName: b.displayName,
        });
        // A second person is ADDED (NEW-2). The link is in this response only.
        return reply(200, { person: personView(person), inviteUrl: inviteUrl(token) });
      }
    }

    if (tp[2] === 'people' && tp[3] && method === 'POST') {
      const personId = tp[3];
      if (tp[4] === 'role') {
        const b = await readJson(req);
        const person = await setRole(slug, personId, b.role);
        syncPeopleSoon(slug, 0);
        return reply(200, { person: personView(person) });
      }
      if (tp[4] === 'remove') {
        const person = await removePerson(slug, personId);
        syncPeopleSoon(slug, 0);
        return reply(200, { person: personView(person) });
      }
      if (tp[4] === 'invite') {
        const { person, token } = await reissueInvite(slug, personId);
        return reply(200, { person: personView(person), inviteUrl: inviteUrl(token) });
      }
    }
  }

  return false;
}

/** Platform-only routes answer 403 for narrower administrators. */
export function requirePlatform(admin) {
  if (!admin || !isPlatform(admin.scope)) throw forbidden('Platform administrators only');
}
