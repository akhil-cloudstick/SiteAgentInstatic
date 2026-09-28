/**
 * Where the Connector thinks the relay is.
 *
 * This is here because getting it wrong took the whole gate down without
 * looking like a fault. Two defects met:
 *
 *   1. `src/http/relay.ts` documented a default — PUBLIC_URL from
 *      Relay/wrangler.toml — and implemented it with `require()` on the .toml.
 *      This package is `"type": "module"`, so bare `require` does not exist;
 *      every call threw a ReferenceError into a bare `catch` and returned null.
 *      The documented default had never once worked.
 *   2. `src/go/registry.ts` carried its OWN copy of `relayUrl` that read the
 *      environment variable and nothing else, so even a working default would
 *      not have applied on the path that actually matters.
 *
 * The result was that every gated import and publish refused, on every target,
 * for want of a setting nobody had been told to set. It failed closed, which is
 * the only reason this was an outage of capability rather than of safety — and
 * it was found by somebody else's acceptance run, not by us.
 *
 * So: one definition, and the parsing is tested rather than assumed.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { publicUrlFromWrangler, relayUrl } from '../src/http/relay'

const WRANGLER = resolve(import.meta.dir, '..', '..', 'Relay', 'wrangler.toml')

describe('reading the relay address from wrangler.toml', () => {
  test('takes PUBLIC_URL from the top-level [vars] table', () => {
    const toml = `
name = "deploy-relay"

[vars]
STALL_MINUTES = "30"
PUBLIC_URL = "https://relay.example.test"
`
    expect(publicUrlFromWrangler(toml)).toBe('https://relay.example.test')
  })

  test('and NOT from [env.test.vars], which is deliberately empty', () => {
    // The real file carries both. Reading the second would point the Connector
    // at nothing while reporting itself configured — worse than the bug this
    // replaced, because it would fail somewhere further away.
    const toml = `
[vars]
PUBLIC_URL = "https://relay.example.test"

[env.test.vars]
PUBLIC_URL = ""
`
    expect(publicUrlFromWrangler(toml)).toBe('https://relay.example.test')
  })

  test('an empty top-level value is no address, not an empty one', () => {
    expect(publicUrlFromWrangler('[vars]\nPUBLIC_URL = ""\n')).toBeNull()
  })

  test('a trailing slash is trimmed, so paths are joined once', () => {
    expect(publicUrlFromWrangler('[vars]\nPUBLIC_URL = "https://r.test/"\n')).toBe('https://r.test')
  })

  test('single quotes are read too', () => {
    expect(publicUrlFromWrangler("[vars]\nPUBLIC_URL = 'https://r.test'\n")).toBe('https://r.test')
  })

  test('no [vars] table at all is null rather than a throw', () => {
    expect(publicUrlFromWrangler('name = "x"\n')).toBeNull()
  })

  test('a [vars] table without PUBLIC_URL is null', () => {
    expect(publicUrlFromWrangler('[vars]\nSTALL_MINUTES = "30"\n\n[other]\nPUBLIC_URL = "https://wrong.test"\n')).toBeNull()
  })
})

describe('the checked-in wrangler.toml', () => {
  test('actually yields an address — the default is real, not decorative', () => {
    // The regression that started this: the default was documented, shipped,
    // and inert. If this file ever stops carrying a usable PUBLIC_URL, the
    // Connector falls back to nothing and every gated action refuses, so it is
    // worth failing here rather than there.
    const url = publicUrlFromWrangler(readFileSync(WRANGLER, 'utf8'))
    expect(url).toBeTruthy()
    expect(url!.startsWith('https://')).toBe(true)
  })
})

describe('relayUrl', () => {
  test('prefers the environment variable when it is set', () => {
    const before = process.env.MMS_CONNECTOR_RELAY_URL
    try {
      process.env.MMS_CONNECTOR_RELAY_URL = 'https://override.test/'
      expect(relayUrl()).toBe('https://override.test')
    } finally {
      if (before === undefined) delete process.env.MMS_CONNECTOR_RELAY_URL
      else process.env.MMS_CONNECTOR_RELAY_URL = before
    }
  })

  test('falls back to the config when it is not, rather than to null', () => {
    const before = process.env.MMS_CONNECTOR_RELAY_URL
    try {
      delete process.env.MMS_CONNECTOR_RELAY_URL
      // The assertion the outage would have failed.
      expect(relayUrl()).toBeTruthy()
    } finally {
      if (before !== undefined) process.env.MMS_CONNECTOR_RELAY_URL = before
    }
  })
})
