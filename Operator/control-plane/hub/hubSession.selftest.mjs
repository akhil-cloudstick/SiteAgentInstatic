/**
 * Self-test for the person-bound hub session and the project keys (Phase 1).
 * Run: `npm run test:hub-session` (from Operator/). No database needed.
 */
import { signValue } from '../lib/crypto.mjs';
import { signForTenant, verifyForTenant, tenantKey } from '../lib/crypto.mjs';
import { childEnv, isInheritable } from '../lib/childEnv.mjs';
import {
  SESSION_COOKIE, signHubSession, readHubSession, currentPerson, currentPersonCached,
  signChooser, readChooser,
} from './hubSession.mjs';

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

const updated = new Date('2026-09-17T12:00:00Z');
const alice = { id: '11', tenant_slug: 'acme', role: 'client', updated_at: updated, status: 'active' };
const req = (value) => ({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}` } });
const finder = (row) => async (id) => (row && String(row.id) === String(id) ? row : null);

// --- the cookie names a person ------------------------------------------------------
const cookie = signHubSession(alice);
check('a person session reads back', readHubSession(cookie), { slug: 'acme', uid: '11', v: updated.getTime() });
check('a pre-Phase-1 cookie (project only) is signed out',
  readHubSession(signValue({ sub: 'acme', kind: 'hub' }, 3600)), null);
check('an admin session is not a hub session',
  readHubSession(signValue({ sub: '11', kind: 'admin', v: 1 }, 3600)), null);
check('the signed-in person resolves', (await currentPerson(req(cookie), finder(alice)))?.id, '11');
check('a removed person is signed out', await currentPerson(req(cookie), finder(null)), null);
check('a role change ends the session',
  await currentPerson(req(cookie), finder({ ...alice, updated_at: new Date(updated.getTime() + 5) })), null);
check('a person moved to another project is signed out',
  await currentPerson(req(cookie), finder({ ...alice, tenant_slug: 'other' })), null);
check('the gateway cache answers the same',
  (await currentPersonCached(req(cookie), finder(alice), 1_000))?.id, '11');

// --- the project chooser -----------------------------------------------------------------
const chooser = signChooser([{ id: 3 }, { id: '7' }]);
check('the chooser carries the matching people', readChooser(chooser), ['3', '7']);
check('an expired chooser is refused',
  readChooser(signValue({ kind: 'hub-choose', uids: ['3'] }, -1)), null);
check('a hub session is not a chooser', readChooser(cookie), null);

// --- per-project keys: a token for A fails on B ---------------------------------------------
const forA = signForTenant('acme', { kind: 'sso', target: 'instatic', person: { id: '11', role: 'client' } }, 60);
check('a token verifies for its own project', verifyForTenant('acme', forA)?.person?.role, 'client');
check('the same token fails for another project', verifyForTenant('globex', forA), null);
check('a master-key token fails as a project token',
  verifyForTenant('acme', signValue({ sub: 'acme', kind: 'sso', target: 'instatic' }, 60)), null);
check('an expired project token fails', verifyForTenant('acme', signForTenant('acme', { kind: 'sso' }, -1)), null);
check('project keys differ per project and are not the master',
  new Set([tenantKey('acme'), tenantKey('globex')]).size, 2);

// --- project processes inherit no control-plane secret ------------------------------------
const base = {
  PATH: '/bin', SystemRoot: 'C:\\Windows', TEMP: '/tmp', NODE_OPTIONS: '--max-old-space-size=4096',
  ADMIN_DATABASE_URL: 'postgres://admin', SETTINGS_ENC_KEY: 'k', TOKEN_SECRET: 's',
  MMS_CONNECTOR_MCP_TOKEN: 't', OPENROUTER_API_KEY: 'o', CLOUDFLARE_API_TOKEN: 'c', PGPASSWORD: 'p',
};
const env = childEnv({ DATABASE_URL: 'postgres://tenant', INSTATIC_SSO_SECRET: 'project-key' }, base);
check('ordinary variables are inherited', [env.PATH, env.SystemRoot, env.TEMP, env.NODE_OPTIONS],
  ['/bin', 'C:\\Windows', '/tmp', '--max-old-space-size=4096']);
check('no control-plane secret is inherited',
  ['ADMIN_DATABASE_URL', 'SETTINGS_ENC_KEY', 'TOKEN_SECRET', 'MMS_CONNECTOR_MCP_TOKEN',
    'OPENROUTER_API_KEY', 'CLOUDFLARE_API_TOKEN', 'PGPASSWORD'].filter((k) => k in env), []);
check("the project's own values are set", [env.DATABASE_URL, env.INSTATIC_SSO_SECRET], ['postgres://tenant', 'project-key']);
check('a plain name is inheritable, a credential name is not', [isInheritable('PORT'), isInheritable('GITHUB_TOKEN')], [true, false]);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall hub-session checks passed');
process.exit(0);
