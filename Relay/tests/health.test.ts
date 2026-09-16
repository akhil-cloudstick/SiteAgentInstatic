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

test('health needs no login and returns only live, version, the owner key fingerprint and the property approvers', async () => {
  const res = await get('/api/health', envWith({ ...CONFIGURED, OWNER_PUBLIC_KEY: VECTORS.owner.publicKey }))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect(await res.json()).toEqual({
    live: true,
    version: RELAY_VERSION,
    ownerKeyFingerprint: VECTORS.owner.fingerprint,
    approvers: {},
  })
})

test('health reports not live when the relay is unconfigured or has no usable owner key', async () => {
  expect(await (await get('/api/health', envWith({}))).json()).toEqual({
    live: false,
    version: RELAY_VERSION,
    ownerKeyFingerprint: null,
    approvers: {},
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
