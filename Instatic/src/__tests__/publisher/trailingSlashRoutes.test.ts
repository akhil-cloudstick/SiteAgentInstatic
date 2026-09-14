/**
 * Trailing-slash route policy.
 *
 * A site migrated from a generator that used directory URLs (`/about-us/`)
 * published here as flat documents (`/about-us`). Nothing broke — static hosts
 * redirect between the two — but every canonical, every redirect target and
 * every inbound link on that site gained a redirect hop, and a canonical
 * pointing at a redirect is a weakened signal that no status check reports.
 *
 * The disk mapping always understood both shapes. Nothing ever asked for the
 * directory one, which is why this is a route-policy test and not a mapping
 * test: the bug was in what the bake requested, not in what the writer could do.
 */
import { describe, expect, it } from 'bun:test'
import { applyRoutePolicy } from '../../../server/publish/staticArtefact'

describe('applyRoutePolicy', () => {
  it('leaves routes flat by default, so existing sites keep their URLs', () => {
    expect(applyRoutePolicy('/about-us')).toBe('/about-us')
    expect(applyRoutePolicy('/about-us', false)).toBe('/about-us')
    expect(applyRoutePolicy('/blog/two-days', false)).toBe('/blog/two-days')
  })

  it('adds the trailing slash when the site asks for directory URLs', () => {
    expect(applyRoutePolicy('/about-us', true)).toBe('/about-us/')
    expect(applyRoutePolicy('/blog/two-days', true)).toBe('/blog/two-days/')
  })

  it('never doubles a slash that is already there', () => {
    expect(applyRoutePolicy('/about-us/', true)).toBe('/about-us/')
    expect(applyRoutePolicy('/about-us//', true)).toBe('/about-us/')
  })

  it('strips the slash when the site is flat, whichever form it was given', () => {
    expect(applyRoutePolicy('/about-us/', false)).toBe('/about-us')
    expect(applyRoutePolicy('/blog/two-days/', false)).toBe('/blog/two-days')
  })

  it('leaves the site root alone in both modes', () => {
    // `/` is already the root. Producing `//` or `''` here would bake the home
    // page to the wrong file in one mode and escape the slot in the other.
    expect(applyRoutePolicy('/', true)).toBe('/')
    expect(applyRoutePolicy('/', false)).toBe('/')
    expect(applyRoutePolicy('', true)).toBe('/')
  })

  it('is idempotent — re-applying the same policy changes nothing', () => {
    const once = applyRoutePolicy('/about-us', true)
    expect(applyRoutePolicy(once, true)).toBe(once)
    const flat = applyRoutePolicy('/about-us', false)
    expect(applyRoutePolicy(flat, false)).toBe(flat)
  })
})
