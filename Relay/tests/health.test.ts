import { expect, test } from 'bun:test'
import worker from '../src/index'
import type { Env } from '../src/config'
import { RELAY_VERSION } from '../src/version'
import { VECTORS } from './helpers'

const ctx = { waitUntil: () => {} }

const CONFIGURED = {
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'relay-aud-tag',
  ROLE_OWNER_EMAIL: 'owner@example.test',
  ROLE_BUILDER_EMAILS: 'builder@example.test',
  ROLE_VALIDATOR_TOKEN_ID: 'validator-token-id.access',
}

/** Health must never touch storage, so the bindings are deliberately empty. */
const envWith = (vars: Partial<Env>): Env => ({ RELAY_DB: {} as never, RELAY_ARTEFACTS: {} as never, ...vars }) as Env

const get = (path: string, env: Env, method = 'GET') =>
  worker.fetch(new Request(`https://relay.test${path}`, { method }), env, ctx)

test('health needs no login and returns only live, version, the owner key fingerprint and where approvers live', async () => {
  const res = await get('/api/health', envWith({ ...CONFIGURED, OWNER_PUBLIC_KEY: VECTORS.owner.publicKey }))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect(await res.json()).toEqual({
    live: true,
    version: RELAY_VERSION,
    ownerKeyFingerprint: VECTORS.owner.fingerprint,
    approverRegistry: '/api/health/approvers',
  })
})

test('health reports not live when the relay is unconfigured or has no usable owner key', async () => {
  expect(await (await get('/api/health', envWith({}))).json()).toEqual({
    live: false,
    version: RELAY_VERSION,
    ownerKeyFingerprint: null,
    approverRegistry: '/api/health/approvers',
  })
  expect(await (await get('/api/health', envWith(CONFIGURED))).json()).toMatchObject({ live: false, ownerKeyFingerprint: null })

  const notAKey = await get('/api/health', envWith({ ...CONFIGURED, OWNER_PUBLIC_KEY: 'bm90IGEga2V5' }))
  expect(await notAKey.json()).toMatchObject({ live: false, ownerKeyFingerprint: null })

  const keyButNoAccess = await get('/api/health', envWith({ OWNER_PUBLIC_KEY: VECTORS.owner.publicKey }))
  expect(await keyButNoAccess.json()).toMatchObject({ live: false, ownerKeyFingerprint: VECTORS.owner.fingerprint })
})

test('health answers only GET and HEAD, and every other route still requires a login', async () => {
  const env = envWith({ ...CONFIGURED, OWNER_PUBLIC_KEY: VECTORS.owner.publicKey })
  expect((await get('/api/health', env, 'POST')).status).toBe(405)
  const head = await get('/api/health', env, 'HEAD')
  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')

  for (const path of ['/api/whoami', '/api/tickets', '/api/export.jsonl', '/api/health/extra', '/']) {
    expect({ path, status: (await get(path, env)).status }).toEqual({ path, status: 403 })
  }
})

test('the registry reads without a login, under the prefix that is already bypassed', async () => {
  // `/api/health/approvers` is the PUBLISHED read. It lives here rather than at
  // `/api/approvers` because a Cloudflare Access application covers its path and
  // everything beneath it: a Bypass on `api/approvers` would also cover the POST
  // register/rotate/retire routes and strip the assertion header the owner is
  // identified by, locking the only permitted registrar out. Nothing is written
  // beneath `/api/health`, so opening that subtree opens only reads.
  // The registry read is the one pre-auth route that DOES touch storage, so it
  // needs a D1 binding where the others take `{}`. Empty results are enough:
  // what is under test is the routing and the absence of a login, not the rows.
  const db = {
    prepare: () => ({ all: async () => ({ results: [] }), bind: () => ({ all: async () => ({ results: [] }) }) }),
  } as never
  const env = envWith({ ...CONFIGURED, OWNER_PUBLIC_KEY: VECTORS.owner.publicKey, RELAY_DB: db })

  for (const path of ['/api/health/approvers', '/api/approvers']) {
    const res = await get(path, env)
    expect({ path, status: res.status }).toEqual({ path, status: 200 })
    // `toMatchObject`, not `toEqual`: the body also carries `at`, and pinning a
    // timestamp here would test the clock.
    expect(await res.json()).toMatchObject({ approvers: [] })
  }

  // The old path still answers, so a Connector that has not been updated keeps
  // working the moment this deploys.
  expect((await get('/api/health/approvers', env, 'HEAD')).status).toBe(200)

  // Still EXACT matches. A `startsWith('/api/health')` would open every future
  // sub-path before identity, which is what the 403 above guards.
  expect((await get('/api/health/approvers/extra', env)).status).toBe(403)

  // A POST here is refused at IDENTITY (403), not answered and rejected (405) —
  // the pre-auth branch matches GET and HEAD only, so anything else falls
  // through to `authenticate`. That is the property that makes this path safe to
  // bypass: the bypassed subtree cannot be used to write, whoever asks.
  expect((await get('/api/health/approvers', env, 'POST')).status).toBe(403)
})
