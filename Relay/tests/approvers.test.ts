/**
 * Who approves a property — resolved the same way on the side that ISSUES a GO
 * as on the side that CHECKS it.
 *
 * The Connector resolves an approver per property; until the relay did the
 * same, a per-property approval was not functional end to end: the relay would
 * still accept the platform key for a property whose owner designated another.
 * A property listed with its own approver is approved by that key alone, and a
 * property whose key is unusable is refused rather than handed back to the
 * platform key.
 */

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OTHER_KEY, OWNER, OWNER_KEY, goFor, openDeployRequest, relay, signGo, type Relay } from './helpers'
import { readConfig, type Env } from '../src/config'
import { health } from '../src/health'
import type { Ticket } from '../src/types'

const VECTORS = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../docs/relay/go-test-vectors.json'), 'utf8'),
) as { owner: { publicKey: string; fingerprint: string }; other: { publicKey: string; fingerprint: string } }

const ENV = {
  RELAY_DB: {} as never,
  RELAY_ARTEFACTS: {} as never,
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud-value',
  ROLE_OWNER_EMAIL: 'owner@example.test',
  ROLE_BUILDER_EMAILS: 'builder@example.test',
  ROLE_VALIDATOR_TOKEN_ID: 'validator-token.access',
} satisfies Env

const grantWith = (r: Relay, ticket: Ticket, key: Parameters<typeof signGo>[1]) =>
  r.call(OWNER, 'POST', `/api/tickets/${ticket.id}/go`, { go: signGo(goFor(ticket, r.now()), key) })

test('a property with its own approver is approved by that key, and never by the platform key', async () => {
  const r = relay({ propertyApprovers: { sheeltron: VECTORS.other.publicKey } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  const byPlatformKey = await grantWith(r, ticket, OWNER_KEY)
  expect(byPlatformKey.status).toBe(422)
  expect(byPlatformKey.json.error).toContain('sheeltron')
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
  expect((await r.store.getTicket(ticket.id))!.state).toBe('awaiting_go')

  const byItsOwnKey = await grantWith(r, ticket, OTHER_KEY)
  expect(byItsOwnKey.status).toBe(200)
  expect(byItsOwnKey.json.ownerKeyFingerprint).toBe(VECTORS.other.fingerprint)
  expect((await r.store.getTicket(ticket.id))!.state).toBe('go_granted')
})

test('a property with no approver of its own uses the default one', async () => {
  const r = relay({ propertyApprovers: { globalnettech: VECTORS.other.publicKey } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  const granted = await grantWith(r, ticket, OWNER_KEY)
  expect(granted.status).toBe(200)
  expect(granted.json.ownerKeyFingerprint).toBe(VECTORS.owner.fingerprint)
})

test('a property whose configured approver is unusable refuses every key, and records nothing', async () => {
  const r = relay({ propertyApprovers: { sheeltron: 'not-a-key' } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  for (const key of [OTHER_KEY, OWNER_KEY]) {
    const res = await grantWith(r, ticket, key)
    expect(res.status).toBe(503)
    expect(res.json.error).toContain('not a usable Ed25519 public key')
  }
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
  expect((await r.store.getTicket(ticket.id))!.state).toBe('awaiting_go')
})

test('a relay with no approver at all grants nothing', async () => {
  const r = relay({ ownerPublicKey: '' })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })
  const res = await grantWith(r, ticket, OWNER_KEY)
  expect(res.status).toBe(503)
  expect(res.json.error).toContain('No approver is configured')
})

test('a malformed approver map keeps the relay shut rather than falling back to the platform key', () => {
  expect(readConfig({ ...ENV, PROPERTY_APPROVERS: '{not json' }).ok).toBe(false)
  expect(readConfig({ ...ENV, PROPERTY_APPROVERS: '["sheeltron"]' }).ok).toBe(false)
  expect(readConfig({ ...ENV, PROPERTY_APPROVERS: '{"sheeltron":42}' }).ok).toBe(false)

  const good = readConfig({ ...ENV, PROPERTY_APPROVERS: `{"sheeltron":"${VECTORS.other.publicKey}"}` })
  expect(good.ok).toBe(true)
  if (good.ok) expect(good.relay.propertyApprovers).toEqual({ sheeltron: VECTORS.other.publicKey })
})

test('health publishes each property approver fingerprint, so both sides can be compared without logging in', async () => {
  const res = await health(new Request('https://relay.test/api/health'), {
    ...ENV,
    OWNER_PUBLIC_KEY: VECTORS.owner.publicKey,
    PROPERTY_APPROVERS: `{"sheeltron":"${VECTORS.other.publicKey}"}`,
  })
  const body = (await res.json()) as { live: boolean; ownerKeyFingerprint: string; approvers: Record<string, string> }
  expect(body.live).toBe(true)
  expect(body.ownerKeyFingerprint).toBe(VECTORS.owner.fingerprint)
  expect(body.approvers).toEqual({ sheeltron: VECTORS.other.fingerprint })
})
