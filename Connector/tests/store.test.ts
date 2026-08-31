import { afterEach, expect, test } from 'bun:test'
import { connect, connectedTargets, disconnect, requireSession } from '../src/http/store'
import { TARGETS_ENV } from '../src/http/config'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  disconnect()
  delete process.env[TARGETS_ENV]
})

function configureTarget(): void {
  process.env[TARGETS_ENV] = JSON.stringify({
    acme: { url: 'http://127.0.0.1:7301', email: 'owner@acme.test', secret: 'pw' },
  })
}

function respondWith(status: number, cookie?: string): void {
  globalThis.fetch = (async () =>
    new Response(status === 200 ? '{}' : '{"error":"Invalid email or password"}', {
      status,
      headers: cookie ? { 'set-cookie': cookie } : undefined,
    })) as typeof fetch
}

test('a failed re-connect does not leave the previous session live', async () => {
  configureTarget()

  respondWith(200, 'instatic_admin_session=first; Path=/; HttpOnly')
  await connect('acme')
  expect(connectedTargets()).toEqual(['acme'])

  // Re-auth fails the way a rotated/incorrect credential does.
  respondWith(401)
  await expect(connect('acme')).rejects.toThrow(/401/)

  // The old cookie must be gone, not still answering for the identity that failed.
  expect(connectedTargets()).toEqual([])
  expect(() => requireSession('acme')).toThrow(/Not connected/)
})
