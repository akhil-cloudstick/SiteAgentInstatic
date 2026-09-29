/**
 * CSRF, re-tested with valid credentials (security class E7).
 *
 * WHY WITH CREDENTIALS. The PRD is specific about this: "'Refused' always means
 * the *server* refuses, re-tested with valid credentials" (line 583). The reason
 * is that CSRF is an attack BY a credential holder's browser — the victim is
 * logged in, and their cookie rides along. An unauthenticated probe against a
 * mutating route gets a 401 from the session check and never reaches the origin
 * gate at all, so it proves nothing about CSRF. Every CMS security test in this
 * repo before this file was unauthenticated.
 *
 * WHAT THIS FOUND. `originAllowed` returned `true` for any request with no
 * `Origin` header, across every one of its callers — the mutating CMS routes, the
 * AI routes, the MCP HTTP transport and the collab WebSocket upgrade. The
 * justifying comment argued that a cross-origin browser fetch always sends
 * `Origin`, which holds for `fetch`/XHR and not for every navigation-shaped
 * request a hostile page can cause. See `noOriginAllowed` in
 * `server/auth/security.ts` for the fix and why it could not simply return false.
 *
 * THE REGRESSION GUARD IS THE POINT OF HALF THIS FILE. The fix is one line from
 * breaking the Connector and the control plane, which call in with no Origin and
 * no `Sec-Fetch-Site` and must keep working. That case is asserted as loudly as
 * the refusals.
 */
import { describe, expect, it } from 'bun:test'
import { createCapabilityTestHarness } from '../helpers/capabilityHarness'
import { originAllowed, configurePublicOrigins, resetPublicOrigins } from '../../../server/auth/security'

const EVIL = 'https://evil.example'

function request(headers: Record<string, string>): Request {
  const req = new Request('http://localhost/cms/api/cms/site', { method: 'POST' })
  for (const [name, value] of Object.entries(headers)) req.headers.set(name, value)
  return req
}

// ---------------------------------------------------------------------------
// The decision itself, stated as a table. `originAllowed` is one function behind
// five call sites, so getting the matrix right here is worth more than any single
// route test — and a route test cannot express "absent" versus "present but
// cross-site" as compactly.
// ---------------------------------------------------------------------------

describe('originAllowed — the no-Origin case', () => {
  it('allows a caller that sends neither header: the Connector and the control plane', () => {
    // The regression guard. If this ever fails, every gated action on the
    // platform is broken for machine callers, which is a worse outcome than the
    // hole this class closes.
    expect(originAllowed(request({}))).toBe(true)
  })

  it('allows a browser whose Sec-Fetch-Site says the request is our own', () => {
    expect(originAllowed(request({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })

  it("allows a browser's user-initiated request (address bar, bookmark)", () => {
    expect(originAllowed(request({ 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('allows a sibling subdomain, because SameSite cookies reach it regardless', () => {
    // Refusing `same-site` would break real subdomain setups while changing
    // nothing an attacker can exploit — the cookie is already sent there.
    expect(originAllowed(request({ 'sec-fetch-site': 'same-site' }))).toBe(true)
  })

  it('REFUSES a browser request that came from someone else s page', () => {
    // The hole. Before the fix this returned true, and with a valid session
    // cookie attached it was a completed forged action.
    expect(originAllowed(request({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('is not fooled by header casing or whitespace', () => {
    expect(originAllowed(request({ 'sec-fetch-site': 'Cross-Site' }))).toBe(false)
    expect(originAllowed(request({ 'sec-fetch-site': '  cross-site  ' }))).toBe(false)
  })

  it('still refuses an explicit foreign Origin, which was never the gap', () => {
    expect(originAllowed(request({ origin: EVIL }))).toBe(false)
    // And a foreign Origin is refused even when Sec-Fetch-Site lies about it —
    // the Origin branch is reached first and decides.
    expect(originAllowed(request({ origin: EVIL, 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The same decisions through a real mutating route, with a real session.
// ---------------------------------------------------------------------------

describe('a mutating CMS route, with a valid session cookie', () => {
  it('refuses a cross-origin request and does not execute it', async () => {
    const harness = await createCapabilityTestHarness()
    const cookie = await harness.setupOwner()

    const response = await harness.cms('/cms/api/cms/site', {
      method: 'POST',
      cookie,
      headers: { origin: EVIL },
      json: { name: 'Renamed by an attacker' },
    })

    // 403 from the origin gate, NOT 401 from the session check — the credential
    // was good. That distinction is the whole reason this test carries a cookie.
    expect(response.status).toBe(403)
    const body = await response.json() as { error?: string }
    expect(body.error).toContain('invalid origin')
  })

  it('refuses a credentialed cross-SITE request that omits Origin', async () => {
    const harness = await createCapabilityTestHarness()
    const cookie = await harness.setupOwner()

    const response = await harness.cms('/cms/api/cms/site', {
      method: 'POST',
      cookie,
      headers: { 'sec-fetch-site': 'cross-site' },
      json: { name: 'Renamed by an attacker' },
    })

    // This is the case that used to succeed.
    expect(response.status).toBe(403)
  })

  it('still serves a machine caller that sends neither header', async () => {
    const harness = await createCapabilityTestHarness()
    const cookie = await harness.setupOwner()

    const response = await harness.cms('/cms/api/cms/site', {
      method: 'POST',
      cookie,
      json: { name: 'Renamed by the control plane' },
    })

    // Whatever this route answers, it must not be the origin gate's 403.
    expect(response.status).not.toBe(403)
  })

  it('does not gate safe methods, which cannot mutate by definition', async () => {
    const harness = await createCapabilityTestHarness()
    const cookie = await harness.setupOwner()

    const response = await harness.cms('/cms/api/cms/site', {
      method: 'GET',
      cookie,
      headers: { origin: EVIL },
    })

    // A GET from a foreign origin is not a CSRF concern — the browser will not
    // let the page read the response, and nothing changed. Pinned so a later
    // tightening does not break every embedded read.
    expect(response.status).not.toBe(403)
  })
})

// ---------------------------------------------------------------------------
// The configured public origins still work, since the fix touches the no-Origin
// branch and must not disturb the allowlist above it.
// ---------------------------------------------------------------------------

describe('the configured public origin allowlist', () => {
  it('accepts a configured custom domain and still refuses everything else', () => {
    try {
      configurePublicOrigins(['https://client.example'])
      expect(originAllowed(request({ origin: 'https://client.example' }))).toBe(true)
      expect(originAllowed(request({ origin: EVIL }))).toBe(false)
    } finally {
      resetPublicOrigins()
    }
  })
})
