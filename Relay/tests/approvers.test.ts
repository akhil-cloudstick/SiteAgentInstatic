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

test('a property is approved by its own registered key, and never by another (AC-B6.1)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.other.publicKey } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  const byAnotherKey = await grantWith(r, ticket, OWNER_KEY)
  expect(byAnotherKey.status).toBe(422)
  expect(byAnotherKey.json.error).toContain('sheeltron')
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
  expect((await r.store.getTicket(ticket.id))!.state).toBe('awaiting_go')

  const byItsOwnKey = await grantWith(r, ticket, OTHER_KEY)
  expect(byItsOwnKey.status).toBe(200)
  expect(byItsOwnKey.json.ownerKeyFingerprint).toBe(VECTORS.other.fingerprint)
  expect((await r.store.getTicket(ticket.id))!.state).toBe('go_granted')
})

// The requirement this replaces read "a property with no approver of its own
// uses the default one". That default WAS the platform key approving every
// customer's site, which is what P1 forbids and what AC-B6.3 fails on.
test('a property with no registered approver is refused, never handed to another key (AC-B6.3)', async () => {
  const r = relay({ approvers: { globalnettech: VECTORS.other.publicKey } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  for (const key of [OWNER_KEY, OTHER_KEY]) {
    const res = await grantWith(r, ticket, key)
    expect(res.status).toBe(503)
    expect(res.json.error).toContain('No approver is registered')
  }
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
})

test('no single identity satisfies two properties (AC-B6.3)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey, globalnettech: VECTORS.other.publicKey } })
  const mine = await openDeployRequest(r, { target: 'sheeltron' })
  const theirs = await openDeployRequest(r, { target: 'globalnettech' })

  expect((await grantWith(r, mine, OWNER_KEY)).status).toBe(200)
  // The very key that just approved sheeltron is refused on the other property.
  expect((await grantWith(r, theirs, OWNER_KEY)).status).toBe(422)
  expect((await grantWith(r, theirs, OTHER_KEY)).status).toBe(200)
})

test('after rotation the retired identity is refused and the new one accepted (AC-B6.2)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })

  const before = await openDeployRequest(r, { target: 'sheeltron' })
  expect((await grantWith(r, before, OWNER_KEY)).status).toBe(200)

  await r.store.registerApprover({
    id: 'apr_rotated',
    seq: 99,
    property: 'sheeltron',
    level: 'project',
    covers: null,
    publicKey: VECTORS.other.publicKey,
    fingerprint: VECTORS.other.fingerprint,
    effectiveFrom: '2026-09-15T00:00:00.000Z',
    retiredAt: null,
    registeredBy: 'owner@example.test',
    reason: 'rotation',
    createdAt: '2026-09-15T00:00:00.000Z',
  })

  const after = await openDeployRequest(r, { target: 'sheeltron' })
  // Immediately, not at the next restart and not when the old GO expires.
  expect((await grantWith(r, after, OWNER_KEY)).status).toBe(422)
  expect((await grantWith(r, after, OTHER_KEY)).status).toBe(200)

  // History is kept, so an old receipt can still be explained.
  const history = await r.store.listApproverHistory('sheeltron')
  expect(history.length).toBe(2)
  expect(history.filter((a) => a.retiredAt === null).length).toBe(1)
})

test('revoking without a replacement leaves the property refusing everything', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })
  expect(await r.store.retireApprover('sheeltron', '2026-09-15T00:00:00.000Z')).toBe(true)

  const ticket = await openDeployRequest(r, { target: 'sheeltron' })
  const res = await grantWith(r, ticket, OWNER_KEY)
  expect(res.status).toBe(503)
  expect(res.json.error).toContain('No approver is registered')
})

test('a business approver covers the properties it names, and no others (AC-B6.4)', async () => {
  const r = relay({
    approvers: {},
    delegated: { 'acme-group': { publicKey: VECTORS.other.publicKey, covers: ['sheeltron'] } },
  })

  const covered = await openDeployRequest(r, { target: 'sheeltron' })
  const granted = await grantWith(r, covered, OTHER_KEY)
  expect(granted.status).toBe(200)
  expect(granted.json.ownerKeyFingerprint).toBe(VECTORS.other.fingerprint)

  // Another business's property is not reachable, even by the same key —
  // delegation is what the registration named, never what a tree implies.
  const notCovered = await openDeployRequest(r, { target: 'globalnettech' })
  const refused = await grantWith(r, notCovered, OTHER_KEY)
  expect(refused.status).toBe(503)
  expect(refused.json.error).toContain('No approver is registered')
})

test('a registered approver whose key is unusable refuses every key, and records nothing', async () => {
  const r = relay({ approvers: { sheeltron: 'not-a-key' } })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })

  for (const key of [OTHER_KEY, OWNER_KEY]) {
    const res = await grantWith(r, ticket, key)
    expect(res.status).toBe(503)
    expect(res.json.error).toContain('not a usable Ed25519 public key')
  }
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
  expect((await r.store.getTicket(ticket.id))!.state).toBe('awaiting_go')
})

test('a relay with an empty registry grants nothing', async () => {
  const r = relay({ approvers: {} })
  const ticket = await openDeployRequest(r, { target: 'sheeltron' })
  const res = await grantWith(r, ticket, OWNER_KEY)
  expect(res.status).toBe(503)
  expect(res.json.error).toContain('No approver is registered')
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

/**
 * The shared vectors, applied to THIS side's resolver (R10).
 *
 * The two ends share no code, which is the point — and it is also how they
 * drift. The signature vectors have always pinned what a valid signature is;
 * these pin who should have signed. The Connector runs the identical block
 * against its own resolver, so a change to either rule that is not made to both
 * fails here or there.
 */
test('the relay resolves approvers exactly as the shared vectors say (R10)', async () => {
  for (const c of VECTORS.resolution ?? []) {
    const r = relay({ approvers: {} })
    let seq = 0
    for (const a of c.registry) {
      await r.store.registerApprover({
        id: `apr_${++seq}`,
        seq,
        property: a.property,
        level: a.level,
        covers: a.covers ?? null,
        publicKey: a.publicKey,
        fingerprint: a.fingerprint,
        effectiveFrom: a.effectiveFrom,
        retiredAt: null,
        registeredBy: 'vectors',
        reason: null,
        createdAt: a.effectiveFrom,
      })
    }

    const ticket = await openDeployRequest(r, { target: c.target })
    const granted = await grantWith(r, ticket, c.expect.ok && c.expect.fingerprint === VECTORS.other.fingerprint ? OTHER_KEY : OWNER_KEY)

    if (c.expect.ok) {
      expect({ case: c.name, status: granted.status }).toEqual({ case: c.name, status: 200 })
      expect({ case: c.name, fp: granted.json.ownerKeyFingerprint }).toEqual({
        case: c.name,
        fp: c.expect.fingerprint,
      })
    } else {
      // Refused, and by the resolver rather than by the signature: a 503 says
      // "nobody may approve this", a 422 would say "wrong key for the one who
      // may". The distinction is the requirement.
      expect({ case: c.name, status: granted.status }).toEqual({ case: c.name, status: 503 })
    }
  }
})
