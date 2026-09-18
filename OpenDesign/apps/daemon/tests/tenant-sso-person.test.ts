// MMS Phase 1: the Design daemon's hand-off names a person, and "Share to CMS"
// uses a machine token only for its own server-side staging call.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  signInstaticMachineToken,
  signSession,
  verifyCpSsoToken,
  verifySession,
} from '../src/tenant-sso.js';

const SECRET = 'project-key-for-tests';

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${b64}.${createHmac('sha256', secret).update(b64).digest('base64url')}`;
}

const exp = () => Date.now() + 60_000;
const person = { id: '22', email: 'publisher@acme.test', role: 'admin' };

describe('tenant SSO (person hand-off)', () => {
  const saved = { secret: process.env.OD_SSO_SECRET, slug: process.env.OD_TENANT_SLUG };

  beforeEach(() => {
    process.env.OD_SSO_SECRET = SECRET;
    process.env.OD_TENANT_SLUG = 'acme';
  });

  afterEach(() => {
    if (saved.secret === undefined) delete process.env.OD_SSO_SECRET;
    else process.env.OD_SSO_SECRET = saved.secret;
    if (saved.slug === undefined) delete process.env.OD_TENANT_SLUG;
    else process.env.OD_TENANT_SLUG = saved.slug;
  });

  it('accepts a hand-off that names a person', () => {
    const p = verifyCpSsoToken(sign({ sub: 'acme', kind: 'sso', target: 'od', exp: exp(), person }));
    expect(p?.person).toEqual(person);
  });

  it('refuses the pre-Phase-1 hand-off that names nobody', () => {
    expect(verifyCpSsoToken(sign({ sub: 'acme', kind: 'sso', target: 'od', exp: exp() }))).toBeNull();
  });

  it('refuses an unknown role, another project, and another key', () => {
    expect(verifyCpSsoToken(sign({ sub: 'acme', kind: 'sso', target: 'od', exp: exp(), person: { ...person, role: 'root' } }))).toBeNull();
    expect(verifyCpSsoToken(sign({ sub: 'globex', kind: 'sso', target: 'od', exp: exp(), person }))).toBeNull();
    expect(verifyCpSsoToken(sign({ sub: 'acme', kind: 'sso', target: 'od', exp: exp(), person }, 'master'))).toBeNull();
  });

  it('records the person on the session, and refuses a session without one', () => {
    const session = verifySession(signSession('acme', person as never));
    expect(session).toMatchObject({ sub: 'acme', pid: '22', role: 'admin' });
    expect(verifySession(sign({ sub: 'acme', kind: 'od', exp: exp() }))).toBeNull();
  });

  it('mints a machine token for the CMS, never a person-less owner token', () => {
    const token = signInstaticMachineToken('acme', 60);
    const payload = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ sub: 'acme', kind: 'sso', target: 'instatic', actor: 'machine' });
  });
});
