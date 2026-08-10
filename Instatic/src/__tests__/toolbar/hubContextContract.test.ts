/**
 * Hub context contract — the role→navigation table and the SSO scope parser.
 *
 * The navigation table is transcribed from the client's shared-header spec, so
 * it is asserted literally: a silent edit to a label or an added destination is
 * a contract change, not a refactor.
 *
 * The parser half is security-relevant. `returnUrl` arrives on a route whose
 * only authenticator is a signed SSO token, and it ends up in a
 * `window.location.assign`. If it could point off the Hub origin, the hand-off
 * would be an open redirect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { hubNavigationLinks, hubLinkHref } from '@admin/shared/ProductHubHeader/hubNavigation'
import { parseHubContextFromSso, readStoredHubContext } from '../../../server/auth/hubContext'

const HUB = 'https://hub.example.com'

function ssoUrl(params: Record<string, string>): URL {
  const url = new URL('https://tenant.example.com/cms/api/cms/sso')
  url.searchParams.set('token', 'signed')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

const originalHubBase = process.env.INSTATIC_HUB_BASE_URL
const originalHubSso = process.env.INSTATIC_HUB_SSO_URL

beforeEach(() => {
  process.env.INSTATIC_HUB_BASE_URL = HUB
  delete process.env.INSTATIC_HUB_SSO_URL
})

afterEach(() => {
  if (originalHubBase === undefined) delete process.env.INSTATIC_HUB_BASE_URL
  else process.env.INSTATIC_HUB_BASE_URL = originalHubBase
  if (originalHubSso === undefined) delete process.env.INSTATIC_HUB_SSO_URL
  else process.env.INSTATIC_HUB_SSO_URL = originalHubSso
})

describe('role-scoped Hub navigation', () => {
  it('gives Operator and Agency the same set, verbatim', () => {
    const expected = ['Home', 'Portfolio', 'Actions', 'Approvals', 'Reports']
    expect(hubNavigationLinks('operator').map((l) => l.label)).toEqual(expected)
    expect(hubNavigationLinks('agency').map((l) => l.label)).toEqual(expected)
  })

  it('gives Client the my-scoped set', () => {
    expect(hubNavigationLinks('client').map((l) => l.label)).toEqual([
      'Home', 'My Projects', 'My Actions', 'Approvals', 'Reports',
    ])
  })

  it('gives Super Admin the platform set', () => {
    expect(hubNavigationLinks('super-admin').map((l) => l.label)).toEqual([
      'Home', 'Governance', 'Global Library', 'Intelligence',
      'Knowledge', 'Integrations', 'Health & Audit',
    ])
  })

  it('resolves links against the Hub origin', () => {
    expect(hubLinkHref(HUB, '/hub/portfolio')).toBe(`${HUB}/hub/portfolio`)
  })
})

describe('parseHubContextFromSso', () => {
  it('reads the authorized scope off the hand-off', () => {
    const context = parseHubContextFromSso(ssoUrl({
      hubRole: 'operator',
      hubClient: 'Harbour Suites',
      hubProject: 'Website',
      hubSite: 'harbour',
      hubOrigin: 'portfolio',
      hubReturnUrl: '/hub?tab=portfolio',
    }))

    expect(context).toEqual({
      hubBaseUrl: HUB,
      role: 'operator',
      client: 'Harbour Suites',
      project: 'Website',
      site: 'harbour',
      origin: 'portfolio',
      returnUrl: `${HUB}/hub?tab=portfolio`,
    })
  })

  it('treats absent scope fields as absent rather than substituting defaults', () => {
    const context = parseHubContextFromSso(ssoUrl({ hubRole: 'client' }))

    expect(context?.client).toBeNull()
    expect(context?.project).toBeNull()
    // With no return target the Hub root is the only honest fallback.
    expect(context?.returnUrl).toBe(HUB)
  })

  it('refuses a returnUrl pointing off the Hub origin', () => {
    const context = parseHubContextFromSso(ssoUrl({
      hubRole: 'operator',
      hubReturnUrl: 'https://attacker.example.com/phish',
    }))

    expect(context?.returnUrl).toBe(HUB)
  })

  it('drops the whole context when the role is unrecognised', () => {
    // A partial context would render a header claiming an authority the Hub
    // never granted, so nothing is kept.
    expect(parseHubContextFromSso(ssoUrl({ hubRole: 'root' }))).toBeNull()
  })

  it('is inert with no role, and inert with no Hub configured', () => {
    expect(parseHubContextFromSso(ssoUrl({ hubSite: 'harbour' }))).toBeNull()

    delete process.env.INSTATIC_HUB_BASE_URL
    expect(parseHubContextFromSso(ssoUrl({ hubRole: 'operator' }))).toBeNull()
  })

  it('falls back to the origin of the control-plane SSO URL', () => {
    delete process.env.INSTATIC_HUB_BASE_URL
    process.env.INSTATIC_HUB_SSO_URL = `${HUB}/sso/cms`

    expect(parseHubContextFromSso(ssoUrl({ hubRole: 'operator' }))?.hubBaseUrl).toBe(HUB)
  })
})

describe('readStoredHubContext', () => {
  const stored = {
    hubBaseUrl: 'https://old-hub.example.com',
    role: 'operator',
    client: null,
    project: null,
    site: 'harbour',
    origin: 'hub',
    returnUrl: 'https://old-hub.example.com/hub?tab=portfolio',
  }

  it('re-pins a session opened before the Hub moved', () => {
    const context = readStoredHubContext(stored)

    // Otherwise "Back to Product Hub" would send the user to a host we no
    // longer trust.
    expect(context?.hubBaseUrl).toBe(HUB)
    expect(context?.returnUrl).toBe(`${HUB}/hub?tab=portfolio`)
  })

  it('returns null for a missing, malformed, or hub-less value', () => {
    expect(readStoredHubContext(null)).toBeNull()
    expect(readStoredHubContext({ role: 'operator' })).toBeNull()

    delete process.env.INSTATIC_HUB_BASE_URL
    expect(readStoredHubContext(stored)).toBeNull()
  })
})
