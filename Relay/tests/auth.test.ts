import { beforeAll, beforeEach, expect, test } from 'bun:test'
import { authenticate, resetAccessKeyCache, type AccessConfig } from '../src/auth'
import { readConfig, type Env } from '../src/config'

const CFG: AccessConfig = {
  teamDomain: 'team.cloudflareaccess.com',
  aud: 'relay-aud-tag',
  ownerEmail: 'owner@example.test',
  builderEmails: ['builder@example.test'],
  builderTokenIds: ['builder-tooling-token.access'],
  validatorTokenId: 'validator-token-id.access',
}
const NOW = Date.parse('2026-09-14T08:00:00Z')

const b64url = (data: Uint8Array | string): string => Buffer.from(data).toString('base64url')

async function makeSigner(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  return { kid, privateKey: pair.privateKey, jwk: { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid } }
}

let signer: Awaited<ReturnType<typeof makeSigner>>
let impostor: Awaited<ReturnType<typeof makeSigner>>

beforeAll(async () => {
  signer = await makeSigner('access-key-1')
  impostor = await makeSigner('access-key-1')
})

beforeEach(() => resetAccessKeyCache())

const certs = (() => Promise.resolve(new Response(JSON.stringify({ keys: [signer.jwk] })))) as unknown as typeof fetch

async function token(claims: Record<string, unknown>, by = signer): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: by.kid, typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ aud: [CFG.aud], iss: `https://${CFG.teamDomain}`, iat: NOW / 1000, exp: NOW / 1000 + 600, ...claims }),
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', by.privateKey, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

const withToken = (jwt?: string) =>
  new Request('https://relay.test/api/whoami', jwt ? { headers: { 'cf-access-jwt-assertion': jwt } } : {})

const CONFIGURED_ENV = {
  ACCESS_TEAM_DOMAIN: CFG.teamDomain,
  ACCESS_AUD: CFG.aud,
  ROLE_OWNER_EMAIL: 'owner@example.test',
  ROLE_BUILDER_EMAILS: 'builder@example.test',
  ROLE_VALIDATOR_TOKEN_ID: CFG.validatorTokenId,
}

test('the identities map to their roles', async () => {
  const owner = await authenticate(withToken(await token({ email: 'Owner@Example.test' })), CFG, certs, NOW)
  expect(owner).toEqual({ ok: true, actor: { role: 'owner', subject: 'owner@example.test' } })

  const builder = await authenticate(withToken(await token({ email: 'builder@example.test' })), CFG, certs, NOW)
  expect(builder.ok && builder.actor.role).toBe('builder')

  const validator = await authenticate(withToken(await token({ common_name: CFG.validatorTokenId })), CFG, certs, NOW)
  expect(validator).toEqual({ ok: true, actor: { role: 'validator', subject: `service:${CFG.validatorTokenId}` } })

  const tooling = await authenticate(withToken(await token({ common_name: 'builder-tooling-token.access' })), CFG, certs, NOW)
  expect(tooling).toEqual({ ok: true, actor: { role: 'builder', subject: 'service:builder-tooling-token.access' } })
})

test('anything else is refused', async () => {
  const cases: [string, Request][] = [
    ['no assertion', withToken()],
    ['unknown identity', withToken(await token({ email: 'someone@example.test' }))],
    ['unknown service token', withToken(await token({ common_name: 'some-other-token.access' }))],
    ['wrong audience', withToken(await token({ email: CFG.ownerEmail, aud: ['other-app'] }))],
    ['expired', withToken(await token({ email: CFG.ownerEmail, exp: NOW / 1000 - 1 }))],
    ['wrong issuer', withToken(await token({ email: CFG.ownerEmail, iss: 'https://evil.cloudflareaccess.com' }))],
    ['forged signature', withToken(await token({ email: CFG.ownerEmail }, impostor))],
    ['service token claiming an email', withToken(await token({ email: 'x@example.test', common_name: CFG.validatorTokenId }))],
    ['not a JWT', withToken('abc.def')],
  ]
  for (const [name, req] of cases) {
    const result = await authenticate(req, CFG, certs, NOW)
    expect({ name, ok: result.ok }).toEqual({ name, ok: false })
  }
})

test('the relay stays closed when Access or roles are not configured, or roles overlap', () => {
  const missing = readConfig({} as Env)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.problems).toContain('ACCESS_AUD is not set')

  expect(readConfig({ ...CONFIGURED_ENV } as Env).ok).toBe(true)

  const emailOverlap = readConfig({ ...CONFIGURED_ENV, ROLE_BUILDER_EMAILS: 'builder@example.test, OWNER@example.test' } as Env)
  expect(emailOverlap.ok).toBe(false)

  const tokenOverlap = readConfig({ ...CONFIGURED_ENV, ROLE_BUILDER_TOKEN_IDS: CFG.validatorTokenId } as Env)
  expect(tokenOverlap.ok).toBe(false)

  const longTtl = readConfig({ ...CONFIGURED_ENV, GO_MAX_TTL_HOURS: '8' } as Env)
  expect(longTtl.ok).toBe(false)
})
