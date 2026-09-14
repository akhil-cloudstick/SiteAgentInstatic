/**
 * Auto-enrolment of sites the connector created.
 *
 * `create_site` and the target allowlist were each correct and together left
 * the caller able to provision a site and then unable to address it. These
 * cover the rule that resolves it — a tenant created THROUGH the connector is
 * theirs and enrols itself; nothing else does — and the two ways the merge
 * could go wrong: overwriting an operator's deliberate entry, or emitting a
 * half-built target that fails later at connect time.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { refreshManagedTargets, managedTargetsError } from '../src/http/managedTargets'
import { TARGETS_ENV, targetNames } from '../src/http/config'

const TOKEN = 'c'.repeat(48)
const realFetch = globalThis.fetch

beforeEach(() => {
  process.env.MMS_CONNECTOR_MCP_TOKEN = TOKEN
  delete process.env[TARGETS_ENV]
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env[TARGETS_ENV]
  delete process.env.MMS_CONNECTOR_MCP_TOKEN
  delete process.env.MMS_CONTROL_PLANE_URL
})

/** Control plane returning a managed target set, recording what it was sent. */
function stubControlPlane(targets: Record<string, unknown>): { authSeen: () => string | null } {
  let auth: string | null = null
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    auth =
      (init?.headers as Record<string, string> | undefined)?.authorization ??
      (input instanceof Request ? input.headers.get('authorization') : null)
    return new Response(JSON.stringify({ targets }), { status: 200 })
  }) as typeof fetch
  return { authSeen: () => auth }
}

const acme = { url: 'http://127.0.0.1:7401', email: 'connector@acme.test', secret: 'pw' }

test('a connector-created site becomes addressable without a restart', async () => {
  stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  expect(targetNames()).toContain('sheeltron')
})

test('the refresh authenticates with the connector token', async () => {
  const cp = stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  // The endpoint returns live credentials, so it must not be reachable by
  // anything that merely reaches the control plane's port.
  expect(cp.authSeen()).toBe(`Bearer ${TOKEN}`)
})

test('an existing configured target is never overwritten by a refresh', async () => {
  const operatorSet = { url: 'http://127.0.0.1:9999', email: 'operator@acme.test', secret: 'chosen' }
  process.env[TARGETS_ENV] = JSON.stringify({ sheeltron: operatorSet })
  stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  // An operator entry is a deliberate decision — a corrected port, a different
  // account. A background refresh replacing it would be a configuration change
  // nobody made.
  const live = JSON.parse(process.env[TARGETS_ENV]!) as Record<string, typeof operatorSet>
  expect(live.sheeltron.url).toBe('http://127.0.0.1:9999')
  expect(live.sheeltron.secret).toBe('chosen')
})

test('existing targets survive alongside a newly enrolled one', async () => {
  process.env[TARGETS_ENV] = JSON.stringify({ akhil: acme })
  stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  expect(targetNames().sort()).toEqual(['akhil', 'sheeltron'])
})

test('an incomplete target is skipped rather than emitted broken', async () => {
  // A tenant mid-provision has no credential yet. Emitting it would produce a
  // target that fails at connect time, looking like a wrong password.
  stubControlPlane({ halfway: { url: 'http://127.0.0.1:7402' } })

  await refreshManagedTargets(true)

  expect(targetNames()).not.toContain('halfway')
})

test('a control-plane failure is quiet, recorded, and leaves targets intact', async () => {
  process.env[TARGETS_ENV] = JSON.stringify({ akhil: acme })
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch

  await refreshManagedTargets(true)

  // This runs opportunistically inside unrelated tool calls: a brief outage
  // should mean "the new site is not listed yet", not an error from every tool.
  expect(targetNames()).toEqual(['akhil'])
  expect(managedTargetsError()).toContain('503')
})

test('a missing token is reported rather than sent as an empty bearer', async () => {
  delete process.env.MMS_CONNECTOR_MCP_TOKEN
  stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  expect(managedTargetsError()).toContain('MMS_CONNECTOR_MCP_TOKEN')
  expect(targetNames()).toEqual([])
})

test('unparseable existing configuration is left for its author to fix', async () => {
  process.env[TARGETS_ENV] = '{not json'
  stubControlPlane({ sheeltron: acme })

  await refreshManagedTargets(true)

  expect(process.env[TARGETS_ENV]).toBe('{not json')
  expect(managedTargetsError()).toContain('not valid JSON')
})

test('repeat refreshes inside the TTL do not re-hit the control plane', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return new Response(JSON.stringify({ targets: {} }), { status: 200 })
  }) as typeof fetch

  await refreshManagedTargets(true)
  await refreshManagedTargets()
  await refreshManagedTargets()

  // A tool chain can call this several times in one turn.
  expect(calls).toBe(1)
})
