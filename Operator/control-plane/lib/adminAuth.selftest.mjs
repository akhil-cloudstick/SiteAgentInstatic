/**
 * Self-test for operator console authentication (R14, AC-D14.1).
 * Run: `npm run test:admin-auth` (from Operator/). No database needed.
 *
 * The acceptance is "an unauthenticated request to any admin/operator action is
 * refused". The last group reads server.mjs itself, so a route added later
 * without being covered by the gate fails here rather than shipping open.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signValue } from './crypto.mjs';
import {
  ADMIN_COOKIE, OPEN_API_PATHS, readAdminSession, signAdminSession, currentAdmin,
  isAdminApiPath, connectorMayCall, loginLockedFor, recordLoginFailure, clearLoginFailures,
} from './adminAuth.mjs';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const updatedAt = new Date('2026-09-17T10:00:00Z');
const row = { id: '7', email: 'ops@example.test', updated_at: updatedAt, scope_level: 'platform', operator_id: null, business_id: null };
const finder = (r) => async (id) => (r && String(r.id) === String(id) ? r : null);
const reqWith = (cookie, extra = {}) => ({ headers: { cookie, ...extra } });

// --- the session token ------------------------------------------------------
const good = signAdminSession(row);
check('a signed admin session reads back', readAdminSession(good), { id: '7', v: updatedAt.getTime() });
check('a tenant hub cookie is not an admin session',
  readAdminSession(signValue({ sub: 'acme', kind: 'hub' }, 3600)), null);
check('an SSO-shaped token is not an admin session',
  readAdminSession(signValue({ sub: '7', kind: 'sso', v: updatedAt.getTime() }, 3600)), null);
check('a tampered session is refused', readAdminSession(good.slice(0, -2) + 'xx'), null);
check('an expired session is refused',
  readAdminSession(signValue({ sub: '7', kind: 'admin', v: updatedAt.getTime() }, -1)), null);
check('garbage is refused', readAdminSession('not-a-token'), null);
check('no cookie is refused', readAdminSession(undefined), null);

// --- the request ------------------------------------------------------------
check('a request with the admin cookie is signed in',
  await currentAdmin(reqWith(`${ADMIN_COOKIE}=${encodeURIComponent(good)}`), finder(row)),
  { id: '7', email: 'ops@example.test', scope: { level: 'platform', operatorId: null, businessId: null } });
check('a business administrator carries its business scope',
  (await currentAdmin(reqWith(`${ADMIN_COOKIE}=${good}`),
    finder({ ...row, scope_level: 'business', business_id: '42' }))).scope,
  { level: 'business', operatorId: null, businessId: '42' });
check('a request with no cookie is not signed in',
  await currentAdmin(reqWith(undefined), finder(row)), null);
check('a hub cookie under the admin name is not signed in',
  await currentAdmin(reqWith(`${ADMIN_COOKIE}=${signValue({ sub: '7', kind: 'hub' }, 3600)}`), finder(row)), null);
check('the hub cookie itself signs nobody in as admin',
  await currentAdmin(reqWith(`sa_hub=${good}`), finder(row)), null);
check('a disabled or deleted admin is signed out',
  await currentAdmin(reqWith(`${ADMIN_COOKIE}=${good}`), finder(null)), null);
check('a password reset ends a session signed before it',
  await currentAdmin(reqWith(`${ADMIN_COOKIE}=${good}`),
    finder({ ...row, updated_at: new Date(updatedAt.getTime() + 1000) })), null);

// --- which routes are admin routes -------------------------------------------
for (const p of ['/api/settings', '/api/ai-guidance-default', '/api/models', '/api/tenants',
  '/api/tenants/acme', '/api/tenants/acme/deploy', '/api/mcp/agents', '/api/mcp/agents/mk_1/revoke',
  '/api/admin/session', '/api/org', '/api/operators', '/api/operators/3', '/api/businesses',
  '/api/businesses/4/update', '/api/admins', '/api/admins/5/disable',
  '/api/tenants/acme/people', '/api/tenants/acme/people/9/role', '/api/tenants/acme/move']) {
  check(`admin route: ${p}`, isAdminApiPath(p), true);
}
for (const p of OPEN_API_PATHS) check(`open route: ${p}`, isAdminApiPath(p), false);
check('a tenant daemon path is left to the proxy', isAdminApiPath('/api/projects'), false);
check('a look-alike prefix is not matched', isAdminApiPath('/api/tenantsx'), false);

// --- the Connector's bearer --------------------------------------------------
const bearer = (t) => ({ headers: { authorization: `Bearer ${t}` } });
check('connector token may create a site', connectorMayCall('POST', '/api/tenants', bearer('tok-123'), 'tok-123'), true);
check('connector token may not list sites', connectorMayCall('GET', '/api/tenants', bearer('tok-123'), 'tok-123'), false);
check('connector token may not delete a site', connectorMayCall('DELETE', '/api/tenants/acme', bearer('tok-123'), 'tok-123'), false);
check('connector token may not mint a key', connectorMayCall('POST', '/api/mcp/agents', bearer('tok-123'), 'tok-123'), false);
check('a wrong token may not create a site', connectorMayCall('POST', '/api/tenants', bearer('tok-124'), 'tok-123'), false);
check('an unset token lets nobody in', connectorMayCall('POST', '/api/tenants', bearer(''), ''), false);

// --- login throttle ------------------------------------------------------------
const t0 = 1_000_000;
for (let i = 0; i < 4; i++) recordLoginFailure('Ops@Example.test', t0 + i);
check('four failures do not lock', loginLockedFor('ops@example.test', t0 + 10), 0);
recordLoginFailure('ops@example.test', t0 + 5);
check('the fifth failure locks the email', loginLockedFor('OPS@example.test', t0 + 10) > 0, true);
check('the lock lifts after 15 minutes', loginLockedFor('ops@example.test', t0 + 15 * 60_000 + 10), 0);
check('another email is unaffected', loginLockedFor('other@example.test', t0 + 10), 0);
clearLoginFailures('ops@example.test');
check('a successful sign-in clears the record', loginLockedFor('ops@example.test', t0 + 10), 0);
for (let i = 0; i < 4; i++) recordLoginFailure('slow@example.test', t0 + i * 20 * 60_000);
recordLoginFailure('slow@example.test', t0 + 5 * 20 * 60_000);
check('failures spread beyond the window do not lock', loginLockedFor('slow@example.test', t0 + 5 * 20 * 60_000 + 1), 0);

// --- every /api/ route is gated or deliberately open ----------------------------
// server.mjs and the module it dispatches the levels/people routes to.
const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(resolve(here, '../server.mjs'), 'utf8');
const orgSrc = readFileSync(resolve(here, '../api/orgApi.mjs'), 'utf8');
const routeSrc = serverSrc + orgSrc;
const literals = new Set([...routeSrc.matchAll(/'(\/api\/[^'\s]*)'/g)].map((m) => m[1]));
// Regex routes: the static prefix before the first capture, e.g. /api/tenants/.
const patterns = [...routeSrc.matchAll(/\/\^((?:\\\/|[a-z-])+)/g)]
  .map((m) => m[1].replace(/\\\//g, '/'))
  .filter((p) => p.startsWith('/api/'));
check('routes were found', literals.size > 8 && patterns.length >= 6, true);
for (const p of literals) {
  const covered = isAdminApiPath(p) || OPEN_API_PATHS.includes(p);
  check(`server route ${p} is gated or deliberately open`, covered, true);
}
for (const p of patterns) {
  check(`server route ${p}… is gated`, isAdminApiPath(`${p}x`), true);
}
const gateAt = serverSrc.indexOf('if (isAdminApiPath(path))');
const firstRoute = serverSrc.indexOf("path === '/api/");
check('the gate runs before the first /api/ route', gateAt > 0 && gateAt < firstRoute, true);
check('the gate runs before the tenant proxy',
  gateAt > 0 && gateAt < serverSrc.indexOf('await handleGatewayProxy('), true);
check('the main server no longer serves the board',
  /path === '\/board'/.test(serverSrc), false);
check('the levels/people routes are dispatched after the gate',
  gateAt > 0 && gateAt < serverSrc.indexOf('await handleOrgApi('), true);
check('an unclaimed admin route never reaches the tenant proxy',
  serverSrc.indexOf("if (isAdminApiPath(path)) return send(res, 404") > 0
    && serverSrc.indexOf("if (isAdminApiPath(path)) return send(res, 404") < serverSrc.indexOf('await handleGatewayProxy('), true);

// --- AC-A1.2: project routes resolve the project through the caller's scope -------
check('server.mjs never looks a project up without a scope',
  /tenantsRepo\.getTenant\(/.test(serverSrc), false);
check('the scope-less project listing is used once (the Connector machine view)',
  (serverSrc.match(/listAllTenants\(/g) || []).length, 1);
check('orgApi.mjs never looks a project up without a scope',
  /[^A-Za-z]getTenant\(/.test(orgSrc), false);
check('every project listing in server.mjs names the scope',
  (serverSrc.match(/listTenants\(([^)]*)\)/g) || []).every((c) => c === 'listTenants(scope)'), true);

// --- AC-A5.1: the platform owner sees counts, and opens nothing -------------------
//
// Three ways into a customer's work, all of which have to pass canOpenWork, and
// a fourth that was deleted outright. These are source checks because the
// alternative is a live project, an owner session and a real agent key — and
// the thing most likely to break here is somebody adding a fifth way, which a
// source check catches and a behaviour test does not.
const actAsSrc = readFileSync(resolve(here, '../api/actAsApi.mjs'), 'utf8');

const gatedBlock = (name, from, to) => {
  const start = serverSrc.indexOf(from);
  const end = start >= 0 ? serverSrc.indexOf(to, start) : -1;
  const block = start >= 0 && end > start ? serverSrc.slice(start, end) : '';
  check(name, /requireOpenWork\(/.test(block), true);
};
gatedBlock('minting an agent key passes the open-work gate', "if (path === '/api/mcp/agents')", "if (path === '/api/mcp/presets'");
gatedBlock('installing the bridge passes the open-work gate', 'install-bridge$/', 'return send(res, 200, out);');
gatedBlock('exposing a project passes the open-work gate', "if (action === 'expose'", 'return send(res, 200, out);');

check('the console no longer carries the ungated expose link',
  existsSync(resolve(here, '../../ui/src/pages/open.ts')), false);

check('listing the MCP directory no longer opens a session in every project',
  /bridgeInstalled: reachable \? await pluginInstalled/.test(serverSrc), false);

// The grant is recorded before it is handed out. A grant that was given after a
// failed write is access nobody can see afterwards, which is the one failure
// this whole mode exists to prevent.
check('the act-as grant is recorded before the session is minted',
  actAsSrc.indexOf('recordAndWait(') > 0
    && actAsSrc.indexOf('recordAndWait(') < actAsSrc.indexOf('sessionCookie(person)'), true);
check('the act-as grant waits for its audit row rather than firing and forgetting',
  /await recordAndWait\(/.test(actAsSrc), true);
check('ending a grant removes the person, which is what revokes it everywhere',
  /closeGrants\(/.test(actAsSrc), true);
check('ending a grant tells the project, so the CMS drops the account too',
  /syncPeopleSoon\(/.test(actAsSrc), true);
check('only a platform administrator can act as a business',
  /scope\?\.level !== 'platform'/.test(actAsSrc), true);
check('a reason is required before the work is opened',
  /Say why you are opening this project/.test(actAsSrc), true);

// The audit must be readable, or it is a table nobody looks at.
check('the record can be read back', /path === '\/api\/audit'/.test(serverSrc), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall admin-auth checks passed');
process.exit(0);
