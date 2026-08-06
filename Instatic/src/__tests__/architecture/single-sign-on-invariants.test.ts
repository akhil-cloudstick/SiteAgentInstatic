import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SINGLE-SIGN-ON INVARIANTS
 *
 * The product promise is ONE login for the design studio and the CMS. Two
 * separate bugs have already broken it, both silently — the app still worked,
 * it just asked for a second password:
 *
 *   1. The session cookie's `Path` drifted from the admin mount point, so the
 *      browser withheld it on every admin request and the SPA fell back to its
 *      own login even though SSO had succeeded.
 *   2. An unauthenticated page load rendered the built-in login form instead of
 *      bouncing to the hub, which would have silently re-minted an SSO token.
 *
 * Neither is visible in a type check or a normal feature test, so they are
 * pinned here. If you move the admin mount point, these fail and tell you
 * exactly which other places must move with it.
 */

const ROOT = join(import.meta.dir, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** The single source of truth for where the admin app is mounted. */
const ADMIN_MOUNT = '/cms'

describe('single sign-on invariants', () => {
  it('session cookie Path matches the admin mount point', () => {
    const session = read('server/handlers/cms/session.ts')
    const match = session.match(/Path=(\/[a-z0-9-]*)/i)
    expect(match).not.toBeNull()
    // A mismatch here means: SSO succeeds, cookie is set, browser never sends
    // it back, user sees a SECOND login. Exactly the production bug.
    expect(match?.[1]).toBe(ADMIN_MOUNT)
  })

  it('the API prefix lives under the admin mount, so the cookie is carried', () => {
    const shared = read('server/handlers/cms/shared.ts')
    const match = shared.match(/CMS_API_PREFIX\s*=\s*['"]([^'"]+)['"]/)
    expect(match).not.toBeNull()
    expect(match?.[1].startsWith(`${ADMIN_MOUNT}/`)).toBe(true)
  })

  it('the router serves the admin app at the admin mount point', () => {
    const router = read('server/router.ts')
    expect(router).toContain(`pathname === '${ADMIN_MOUNT}'`)
    expect(router).toContain(`pathname.startsWith('${ADMIN_MOUNT}/')`)
  })

  it('an unauthenticated page load defers to the hub instead of our own login', () => {
    const router = read('server/router.ts')
    // Hub-managed instances must redirect; standalone ones (env unset) keep the
    // built-in form. Losing this branch reintroduces the second login.
    expect(router).toContain('INSTATIC_HUB_SSO_URL')
    expect(router).toContain('requestIsDocument')
  })

  it('an EXPIRED session redirects to the hub, not to our login form', () => {
    const router = read('server/router.ts')
    // The subtle case, and the common one in production: an expired session
    // still SENDS its cookie. A presence-only check would serve the SPA, `/me`
    // would 401, and the user would get our login form. The gate must actually
    // resolve the session against the database.
    expect(router).toContain('requestHasValidAdminSession')
    expect(router).toContain('findUserBySessionHash')
    // Guard the exact regression: no presence-only helper may gate this path.
    expect(router).not.toContain('requestHasAdminSessionCookie')
  })

  it('the dev proxy forwards the same API prefix the app calls', () => {
    const vite = read('vite.config.ts')
    // A drift here breaks `bun run dev` only — no production symptom, which is
    // precisely why it is easy to miss.
    expect(vite).toContain(`'${ADMIN_MOUNT}/api'`)
  })

  it('no stale /admin URL literals remain anywhere in server code', () => {
    for (const file of ['server/router.ts', 'server/handlers/cms/session.ts', 'server/handlers/cms/shared.ts']) {
      const src = read(file)
      // Quote/interpolation-anchored, so module import paths are not matched.
      expect(src).not.toMatch(/(['"`}])\/admin(?=[/?'"`\s)])/)
    }
  })
})
