/**
 * Test properties — who may SUBMIT a GO (the owner's decision, note 0035 §1).
 *
 * The rule being pinned here is narrow on purpose, and each half matters:
 *
 *   - a GO for a designated test property may be submitted by the validator
 *   - everywhere else, only the owner submits
 *   - the builder submits nowhere, designated or not
 *   - and the SIGNATURE is unchanged throughout — a designation widens who may
 *     submit and nothing else, so a validator still has to present a GO signed
 *     by the key registered for that property
 *
 * The last one is the one worth being careful about. A change that let the
 * validator submit would be worth very little if it also let them submit
 * something they had signed themselves, so there is a test for exactly that
 * below, and it is the reason `designateTestProperty` touches no key material.
 */
import { expect, test } from 'bun:test'
import { approvers as publishedRegistry } from '../src/approvers'
import {
  BUILDER,
  OTHER_KEY,
  OWNER,
  VALIDATOR,
  VECTORS,
  goFor,
  grant,
  grantAs,
  openDeployRequest,
  relay,
  signGo,
} from './helpers'

const designate = (r: ReturnType<typeof relay>, actor: typeof OWNER, property: string) =>
  r.call(actor, 'POST', '/api/test-properties', { property })

const undesignate = (r: ReturnType<typeof relay>, actor: typeof OWNER, property: string) =>
  r.call(actor, 'POST', `/api/test-properties/${property}/remove`, {})

/**
 * The published registry, read the way the outside world reads it.
 *
 * Called directly rather than through `r.call`, because this route is served
 * BEFORE authentication in index.ts — it is the one read that needs no login —
 * and the test harness enters at `handle`, which is past that point.
 */
async function published(r: ReturnType<typeof relay>): Promise<{ testProperties: string[] }> {
  const res = await publishedRegistry(new Request('https://relay.test/api/health/approvers'), r.store)
  return (await res.json()) as { testProperties: string[] }
}

// --- who may designate ---------------------------------------------------------

test('only the owner designates a test property, and a refusal writes nothing', async () => {
  const r = relay()
  for (const actor of [BUILDER, VALIDATOR]) {
    const res = await designate(r, actor, 'sheeltron-staging')
    expect({ role: actor.role, status: res.status }).toEqual({ role: actor.role, status: 403 })
  }
  // The refusal left no trace — the point of the door is that it is not a
  // formality, so "refused" has to mean nothing happened.
  expect(await r.store.listTestProperties()).toEqual([])

  expect((await designate(r, OWNER, 'sheeltron-staging')).status).toBe(200)
  expect(await r.store.listTestProperties()).toEqual(['sheeltron-staging'])
})

test('only the owner removes a designation', async () => {
  const r = relay({ testProperties: ['acceptance-scratch'] })
  for (const actor of [BUILDER, VALIDATOR]) {
    expect((await undesignate(r, actor, 'acceptance-scratch')).status).toBe(403)
  }
  expect(await r.store.listTestProperties()).toEqual(['acceptance-scratch'])

  expect((await undesignate(r, OWNER, 'acceptance-scratch')).status).toBe(200)
  expect(await r.store.listTestProperties()).toEqual([])
})

test('designating is append-only: the history keeps both the designation and its removal', async () => {
  const r = relay()
  await designate(r, OWNER, 'acceptance-scratch')
  await undesignate(r, OWNER, 'acceptance-scratch')
  await designate(r, OWNER, 'acceptance-scratch')

  expect(await r.store.listTestProperties()).toEqual(['acceptance-scratch'])
  const history = await r.store.listTestPropertyHistory()
  expect(history.map((h) => h.designated)).toEqual([true, false, true])
  // Newest first, and nothing was edited on the way.
  expect(history[0]!.seq).toBeGreaterThan(history[1]!.seq)
})

test('a property that is not one is refused, and a malformed name never reaches the store', async () => {
  const r = relay()
  expect((await undesignate(r, OWNER, 'sheeltron')).status).toBe(404)
  expect((await designate(r, OWNER, 'Not A Property')).status).toBe(422)
  expect(await r.store.listTestPropertyHistory()).toEqual([])
})

// --- who may submit ------------------------------------------------------------

test('the validator may submit a GO on a designated test property', async () => {
  const r = relay({
    approvers: { 'acceptance-scratch': VECTORS.owner.publicKey },
    testProperties: ['acceptance-scratch'],
  })
  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })

  const res = await grantAs(r, VALIDATOR, dr)
  expect(res.status).toBe(200)
  expect(await r.store.getGo(dr.id)).toBeTruthy()
})

test('the validator is refused on a property that is not designated, and the ticket does not move', async () => {
  const r = relay()
  const dr = await openDeployRequest(r)

  const res = await grantAs(r, VALIDATOR, dr)
  expect(res.status).toBe(403)
  // The message names the property, because "403" alone does not tell the
  // validator whether they asked for the wrong thing or the designation is
  // missing.
  expect(res.json.error).toContain('sheeltron')
  expect(await r.store.getGo(dr.id)).toBeFalsy()
  expect((await r.store.getTicket(dr.id))!.state).toBe('awaiting_go')
})

test('removing the designation closes submission again', async () => {
  const r = relay({
    approvers: { 'acceptance-scratch': VECTORS.owner.publicKey },
    testProperties: ['acceptance-scratch'],
  })
  await undesignate(r, OWNER, 'acceptance-scratch')

  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })
  expect((await grantAs(r, VALIDATOR, dr)).status).toBe(403)
  expect(await r.store.getGo(dr.id)).toBeFalsy()
})

test('the builder submits nowhere — a designation gives it nothing', async () => {
  const r = relay({
    approvers: { 'acceptance-scratch': VECTORS.owner.publicKey },
    testProperties: ['acceptance-scratch'],
  })
  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })

  const res = await grantAs(r, BUILDER, dr)
  expect(res.status).toBe(403)
  expect(res.json.error).toBe('Only the owner grants a GO.')
  expect(await r.store.getGo(dr.id)).toBeFalsy()
})

test('the owner still submits on a designated property', async () => {
  const r = relay({
    approvers: { 'acceptance-scratch': VECTORS.owner.publicKey },
    testProperties: ['acceptance-scratch'],
  })
  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })
  expect((await grant(r, dr)).status).toBe(200)
})

// --- the signature is untouched -------------------------------------------------

test('a designation does NOT let the validator sign for itself', async () => {
  // The registered approver is the owner key. The validator submits a GO it
  // signed with a different key — which is the whole risk of widening who may
  // submit, and it must still be refused at the signature check.
  const r = relay({
    approvers: { 'acceptance-scratch': VECTORS.owner.publicKey },
    testProperties: ['acceptance-scratch'],
  })
  const dr = await openDeployRequest(r, { target: 'acceptance-scratch' })

  const forged = signGo(goFor(dr, r.now()), OTHER_KEY)
  const res = await r.call(VALIDATOR, 'POST', `/api/tickets/${dr.id}/go`, { go: forged })

  expect(res.status).toBe(422)
  expect(res.json.error).toContain('signature')
  expect(await r.store.getGo(dr.id)).toBeFalsy()
})

// --- it is published -------------------------------------------------------------

test('the designation is published in the registry read, so it can be audited from outside', async () => {
  const r = relay({ testProperties: ['acceptance-scratch'] })
  expect((await published(r)).testProperties).toEqual(['acceptance-scratch'])

  // And it follows the store rather than being a separate thing to keep in
  // step: removing the designation removes it from the published read.
  await undesignate(r, OWNER, 'acceptance-scratch')
  expect((await published(r)).testProperties).toEqual([])
})

test('an ordinary relay designates nothing, so the published list is empty', async () => {
  const r = relay()
  expect((await published(r)).testProperties).toEqual([])
})
