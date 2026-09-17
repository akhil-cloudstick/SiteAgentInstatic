/**
 * Self-test for NEW-1: the admin surface reveals no secret it does not have to.
 * Run: `npm run test:new1` (from Operator/). No database needed.
 *
 *   NEW-1a — a minted machine key cannot be read back in plaintext.
 *   NEW-1b — a project listing carries no usable invite link or capacity token.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signTenantToken } from './crypto.mjs';
import { decorate } from './tenantView.mjs';
import * as mcpAgents from '../registry/mcpAgents.mjs';

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

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(resolve(here, rel), 'utf8');
const live = { running: true, odRunning: false, published: true };

// --- NEW-1b: the listing ------------------------------------------------------
const row = {
  slug: 'acme',
  status: 'active',
  port: 4501,
  od_port: 4601,
  hub_status: 'invited',
  has_invite: true,
  invite_expires_at: null,
  // Everything below is secret material a `select t.*` could carry.
  invite_token_enc: 'ENC-INVITE',
  invite_token_hash: 'HASH-INVITE',
  owner_password_enc: 'ENC-OWNER',
  db_password_enc: 'ENC-DB',
  secret_key_enc: 'ENC-SECRET',
  connector_password_enc: 'ENC-CONNECTOR',
  secret_ref: 'REF-SECRET',
};
const view = decorate(row, live);
const wire = JSON.stringify(view);

check('no invite link in the listing', 'invite_url' in view, false);
check('no AI capacity token in the listing', 'ai_base_url' in view, false);
check('no invite path anywhere in the row', wire.includes('/invite/'), false);
check('no AI gateway path anywhere in the row', wire.includes('/ai/'), false);
check("the tenant's signed token is not in the row", wire.includes(signTenantToken('acme')), false);
check('no secret-shaped column survives',
  Object.keys(view).filter((k) => /(_enc$|password|secret|token)/.test(k)), []);
check('no secret value survives',
  ['ENC-INVITE', 'HASH-INVITE', 'ENC-OWNER', 'ENC-DB', 'ENC-SECRET', 'ENC-CONNECTOR', 'REF-SECRET']
    .filter((v) => wire.includes(v)), []);
check('a pending invite is still visible as a flag', view.invite_pending, true);
check('live status is carried', [view.running, view.od_running, view.published], [true, false, true]);
check('an activated tenant has no pending invite',
  decorate({ ...row, hub_status: 'active' }, live).invite_pending, false);
check('an expired invite is not pending',
  decorate({ ...row, invite_expires_at: '2020-01-01T00:00:00Z' }, live).invite_pending, false);
check('no invite at all is not pending',
  decorate({ ...row, has_invite: false }, live).invite_pending, false);
check('the listing query selects no invite ciphertext',
  /invite_token_enc/.test(src('../registry/tenants.mjs')), false);
check('a new invite stores no reversible copy',
  /encrypt\(/.test(src('../registry/tenantUsers.mjs')), false);

// --- NEW-1a: machine keys -------------------------------------------------------
check('there is no key read-back function', 'revealAgentKey' in mcpAgents, false);
check('a minted key is stored only as a hash',
  /\b(en|de)crypt\(/.test(src('../registry/mcpAgents.mjs')), false);
check('there is no key read-back route', /reveal/.test(src('../server.mjs')), false);
check('the console never asks for a key back',
  /reveal/.test(src('../../ui/src/pages/mcp.astro')), false);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall NEW-1 checks passed');
process.exit(0);
