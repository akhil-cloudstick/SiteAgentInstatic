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
import {
  BUILDER,
  OTHER_KEY,
  OWNER,
  OWNER_KEY,
  VALIDATOR,
  goFor,
  openDeployRequest,
  relay,
  signGo,
  type Relay,
} from './helpers'
import { approvers } from '../src/approvers'
import { readConfig, type Env } from '../src/config'
import { health } from '../src/health'
import type { Actor, Ticket } from '../src/types'

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

// This test used to assert the opposite: that a WELL-FORMED approver map was
// accepted and parsed. It was, and by then it decided nothing — the registry
// had taken over. An operator setting it would have seen the relay start and
// concluded they had designated an approver.
test('the old approver-map setting is refused outright, in every shape', () => {
  for (const raw of [
    '{not json',
    '["sheeltron"]',
    '{"sheeltron":42}',
    `{"sheeltron":"${VECTORS.other.publicKey}"}`,
  ]) {
    const read = readConfig({ ...ENV, PROPERTY_APPROVERS: raw })
    expect({ raw, ok: read.ok }).toEqual({ raw, ok: false })
    if (!read.ok) expect(read.problems.join(' ')).toContain('POST /api/approvers')
  }
  expect(readConfig(ENV).ok).toBe(true)
})

test('health points at the registry rather than publishing a second copy of it', async () => {
  const res = await health(new Request('https://relay.test/api/health'), {
    ...ENV,
    OWNER_PUBLIC_KEY: VECTORS.owner.publicKey,
  })
  const body = (await res.json()) as Record<string, unknown>
  expect(body.live).toBe(true)
  expect(body.ownerKeyFingerprint).toBe(VECTORS.owner.fingerprint)
  expect(body.approverRegistry).toBe('/api/approvers')
  // The field that could disagree with the registry is gone, not merely empty.
  expect('approvers' in body).toBe(false)
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

// --- The registry's write door (R6: first-class registration) -----------------
//
// These exercise the ROUTE, not the store. The distinction matters: the store
// methods and their tests existed before the route did, which is exactly why
// the requirement looked finished while registering an approver still meant a
// developer running `wrangler d1 execute` against the production database.

const register = (r: Relay, actor: Actor, body: unknown) => r.call(actor, 'POST', '/api/approvers', body)

test('a project born with no approver can be given one through the route, and then approves (R6)', async () => {
  // Nothing seeded: this is a new project exactly as provisioning leaves it.
  const r = relay({ approvers: {} })
  const ticket = await openDeployRequest(r, { target: 'greenkitchen' })

  const beforeAnyoneIsRegistered = await grantWith(r, ticket, OWNER_KEY)
  expect(beforeAnyoneIsRegistered.status).toBe(503)
  expect(beforeAnyoneIsRegistered.json.error).toContain('No approver is registered')

  const registered = await register(r, OWNER, {
    property: 'greenkitchen',
    level: 'project',
    publicKey: VECTORS.owner.publicKey,
    reason: 'provisioned',
  })
  expect(registered.status).toBe(201)
  expect(registered.json.approver.fingerprint).toBe(VECTORS.owner.fingerprint)
  // A first registration retires nothing, and says so rather than leaving the
  // caller to guess whether it replaced something.
  expect(registered.json.retired).toBeNull()

  const now = await grantWith(r, ticket, OWNER_KEY)
  expect(now.status).toBe(200)
  expect(now.json.ownerKeyFingerprint).toBe(VECTORS.owner.fingerprint)
})

test('only the owner may write the registry', async () => {
  const r = relay({ approvers: {} })
  for (const actor of [BUILDER, VALIDATOR]) {
    const res = await register(r, actor, {
      property: 'greenkitchen',
      level: 'project',
      publicKey: VECTORS.other.publicKey,
    })
    expect({ role: actor.role, status: res.status }).toEqual({ role: actor.role, status: 403 })
  }
  // And nothing was written on the way to being refused.
  expect(await r.store.listApprovers()).toEqual([])
})

test('rotation through the route: the old identity stops being accepted immediately (AC-B6.2)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })

  const rotated = await register(r, OWNER, {
    property: 'sheeltron',
    level: 'project',
    publicKey: VECTORS.other.publicKey,
    reason: 'quarterly rotation',
  })
  expect(rotated.status).toBe(201)
  expect(rotated.json.retired.fingerprint).toBe(VECTORS.owner.fingerprint)

  const ticket = await openDeployRequest(r, { target: 'sheeltron' })
  const byTheRetiredKey = await grantWith(r, ticket, OWNER_KEY)
  expect(byTheRetiredKey.status).toBe(422)
  expect(await r.store.getGo(ticket.id)).toBeFalsy()

  const byTheNewKey = await grantWith(r, ticket, OTHER_KEY)
  expect(byTheNewKey.status).toBe(200)
  expect(byTheNewKey.json.ownerKeyFingerprint).toBe(VECTORS.other.fingerprint)

  // History is retained so an old receipt can still be explained (PRD 5.3).
  const history = await r.store.listApproverHistory('sheeltron')
  expect(history.length).toBe(2)
  expect(history.filter((a) => a.retiredAt === null).length).toBe(1)
})

test('one key may not be registered for two properties (AC-B6.3)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })
  const res = await register(r, OWNER, {
    property: 'greenkitchen',
    level: 'project',
    publicKey: VECTORS.owner.publicKey,
  })
  expect(res.status).toBe(409)
  expect(res.json.error).toContain('sheeltron')
  expect((await r.store.listApprovers()).some((a) => a.property === 'greenkitchen')).toBe(false)
})

test('retiring with no replacement leaves the property refusing everything (PRD 5.3)', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })

  const retired = await r.call(OWNER, 'POST', '/api/approvers/sheeltron/retire')
  expect(retired.status).toBe(200)
  expect(retired.json.retired.fingerprint).toBe(VECTORS.owner.fingerprint)
  // The response states the consequence rather than reading like a clean 200.
  expect(retired.json.effect).toContain('no approver')

  const ticket = await openDeployRequest(r, { target: 'sheeltron' })
  const refused = await grantWith(r, ticket, OWNER_KEY)
  expect(refused.status).toBe(503)
  expect(await r.store.getGo(ticket.id)).toBeFalsy()
})

test('an unusable key is refused at registration, not discovered at GO time', async () => {
  const r = relay({ approvers: {} })
  // The realistic mistakes: a truncated paste, a hex string where base64 was
  // meant, a whole PEM file. Not included — and this is deliberate — is "32
  // bytes that are not a valid curve point": WebCrypto's raw Ed25519 import
  // accepts any 32 bytes, so the registration door cannot detect that one and
  // does not pretend to.
  const cases = [
    ['too short', Buffer.from('nowhere near thirty-two bytes').toString('base64')],
    ['not base64 at all', 'this is not a key'],
    ['hex where base64 was meant', Buffer.alloc(32, 7).toString('hex')],
    ['a whole PEM file', '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----'],
  ] as const
  for (const [name, publicKey] of cases) {
    const res = await register(r, OWNER, { property: 'greenkitchen', level: 'project', publicKey })
    expect({ name, status: res.status }).toEqual({ name, status: 422 })
  }
  expect(await r.store.listApprovers()).toEqual([])
})

test('two business approvers may not both claim one property', async () => {
  const r = relay({
    approvers: {},
    delegated: { mmsgroup: { publicKey: VECTORS.owner.publicKey, covers: ['greenkitchen', 'sheeltron'] } },
  })
  const res = await register(r, OWNER, {
    property: 'othergroup',
    level: 'business',
    covers: ['greenkitchen'],
    publicKey: VECTORS.other.publicKey,
  })
  expect(res.status).toBe(409)
  expect(res.json.conflicts).toEqual([{ property: 'greenkitchen', coveredBy: 'mmsgroup' }])
})

test('a business registration must name what it covers; a project one must not', async () => {
  const r = relay({ approvers: {} })
  const businessWithNoCovers = await register(r, OWNER, {
    property: 'mmsgroup',
    level: 'business',
    publicKey: VECTORS.owner.publicKey,
  })
  expect(businessWithNoCovers.status).toBe(422)
  expect(businessWithNoCovers.json.error).toContain('explicit, never implied')

  const projectWithCovers = await register(r, OWNER, {
    property: 'greenkitchen',
    level: 'project',
    covers: ['sheeltron'],
    publicKey: VECTORS.owner.publicKey,
  })
  expect(projectWithCovers.status).toBe(422)
})

test('the registry is readable without a credential, and writable only with one', async () => {
  // GET is answered before identity (every field is a public key); the write
  // door is not, and the two are the same path.
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })
  const res = await approvers(new Request('https://relay.test/api/approvers'), r.store)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { approvers: { property: string; publicKey: string }[] }
  expect(body.approvers.map((a) => a.property)).toEqual(['sheeltron'])

  const writeAttempt = await approvers(
    new Request('https://relay.test/api/approvers', { method: 'POST' }),
    r.store,
  )
  expect(writeAttempt.status).toBe(405)
})

// --- The registry as a page the owner can use ---------------------------------
//
// The route was owner-only from the start, and the owner on this relay is a
// browser identity — the role is matched on an email in an Access assertion, and
// a service token can never hold it. So until this page existed the one party
// permitted to register an approver had no way to do it that did not involve
// lifting a token out of a browser session.

const page = (r: Relay, actor: Actor) => r.call(actor, 'GET', '/approvers')

test('the owner gets a form to register an approver; nobody else does', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })

  const owner = await page(r, OWNER)
  expect(owner.status).toBe(200)
  expect(owner.text).toContain('Register an approver')
  expect(owner.text).toContain('ap-submit')

  for (const actor of [BUILDER, VALIDATOR]) {
    const other = await page(r, actor)
    expect(other.status).toBe(200)
    expect(other.text).not.toContain('Register an approver')
    expect(other.text).toContain('Only the owner can change this registry')
  }
})

test('hiding the form is not the control — the write still refuses', async () => {
  // The page decides what to draw and nothing else. A builder who skips the UI
  // and posts directly meets exactly the same refusal.
  const r = relay({ approvers: {} })
  const res = await r.call(BUILDER, 'POST', '/api/approvers', {
    property: 'greenkitchen',
    level: 'project',
    publicKey: VECTORS.owner.publicKey,
  })
  expect(res.status).toBe(403)
  expect(await r.store.listApprovers()).toEqual([])
})

test('the page shows who approves what, and says plainly when nobody does', async () => {
  const withOne = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })
  const listed = await page(withOne, OWNER)
  expect(listed.text).toContain('sheeltron')
  expect(listed.text).toContain(VECTORS.owner.fingerprint)

  const empty = await page(relay({ approvers: {} }), OWNER)
  expect(empty.text).toContain('No approver is registered for anything')
  // The consequence, not just the absence.
  expect(empty.text).toContain('will refuse until one is')
})

test('a retired registration is shown as history, and labelled as authorising nothing', async () => {
  const r = relay({ approvers: { sheeltron: VECTORS.owner.publicKey } })
  await r.call(OWNER, 'POST', '/api/approvers', {
    property: 'sheeltron',
    level: 'business',
    covers: ['greenkitchen'],
    publicKey: VECTORS.other.publicKey,
  })

  const after = await page(r, OWNER)
  expect(after.text).toContain('Retired registrations')
  expect(after.text).toContain('None of these authorises anything now')
  // The live row is the new one; the old key appears only under history.
  expect(after.text).toContain('greenkitchen')
})

test('every value the page prints is escaped', async () => {
  // Property names are validated on the way in, but the page must not depend on
  // that: it renders whatever the store holds, and the store outlives today's
  // validation rules.
  const r = relay({ approvers: {} })
  await r.store.registerApprover({
    id: 'apr_x',
    seq: 500,
    property: '<script>alert(1)</script>',
    level: 'project',
    covers: null,
    publicKey: VECTORS.owner.publicKey,
    fingerprint: VECTORS.owner.fingerprint,
    effectiveFrom: '2026-09-14T00:00:00.000Z',
    retiredAt: null,
    registeredBy: 'owner@example.test',
    reason: null,
    createdAt: '2026-09-14T00:00:00.000Z',
  })
  const res = await page(r, OWNER)
  expect(res.text).not.toContain('<script>alert(1)</script>')
  expect(res.text).toContain('&lt;script&gt;')
})
