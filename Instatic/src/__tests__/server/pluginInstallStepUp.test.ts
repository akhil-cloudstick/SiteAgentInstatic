/**
 * Installing a plugin requires step-up even for a user who turned step-up off.
 *
 * `requireStepUp` defaults to `policy: 'user'`, which honours the caller's own
 * `stepUpAuthMode` — and that mode is self-service (`PATCH
 * /me/security/step-up`, `mode: 'disabled'`). The plugin dispatcher called it
 * with no options, so every `plugins.install` route — install, zip upgrade,
 * pack install, uninstall — fell back to the capability alone for anyone who
 * had turned the preference off.
 *
 * The docs described that gate without the qualifier, and an integration
 * partner read the docs, checked the implementation, and found they disagreed.
 * They were careful to note the default is `'required'` and that turning it off
 * costs a step-up itself. The point stands anyway: these four routes RUN CODE
 * INSIDE THE CMS, so the step-up there is not protecting a user from their own
 * convenience trade-off, it is the boundary protecting every site on the
 * instance from a stolen session.
 *
 * The same rule already applies to the route that changes the setting
 * (`me.ts`, `policy: 'always'`). This pins the identical treatment for install.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DISPATCHER = resolve(import.meta.dir, '../../../server/handlers/cms/plugins/index.ts')

function source(): string {
  return readFileSync(DISPATCHER, 'utf8')
}

/** The `resolvePluginRoutePolicy` body — the matrix, without the surrounding file. */
function policyMatrix(): string {
  const src = source()
  const start = src.indexOf('function resolvePluginRoutePolicy')
  const end = src.indexOf('\n}', start)
  expect(start).toBeGreaterThan(-1)
  return src.slice(start, end)
}

describe('plugin install step-up cannot be opted out of', () => {
  test('the gate passes the route policy through, not the default', () => {
    // The whole defect was one call with no options. If this reverts to a bare
    // `requireStepUp(req, db, user)`, every RCE route silently reopens.
    expect(source()).toContain('requireStepUp(req, db, user, { policy: policy.stepUpPolicy ?? \'user\' })')
  })

  test('every plugins.install route that requires step-up requires it ALWAYS', () => {
    const matrix = policyMatrix()
    const installRoutes = matrix
      .split('\n')
      .filter((line) => line.includes("capability: 'plugins.install'") && line.includes('stepUp: true'))

    // install (JSON), install (zip), pack install, uninstall.
    expect(installRoutes).toHaveLength(4)
    for (const line of installRoutes) {
      expect(line).toContain("stepUpPolicy: 'always'")
    }
  })

  test('the read-only install-capability routes still do not demand step-up', () => {
    // `inspect-package` and `staged` hold the install capability because only
    // someone who could install should reach them, but neither runs code. They
    // must not become step-up routes by accident.
    const matrix = policyMatrix()
    const noStepUp = matrix
      .split('\n')
      .filter((line) => line.includes("capability: 'plugins.install'") && line.includes('stepUp: false'))

    expect(noStepUp.length).toBeGreaterThanOrEqual(2)
    for (const line of noStepUp) {
      expect(line).not.toContain('stepUpPolicy')
    }
  })

  test('lifecycle routes keep the user policy — they are not the code-entry boundary', () => {
    // Enable/disable/restart run hooks of code that was ALREADY approved at
    // install. Tightening those is a separate decision, and quietly folding
    // them in here would be a scope change nobody reviewed.
    const matrix = policyMatrix()
    const lifecycle = matrix
      .split('\n')
      .filter((line) => line.includes("capability: 'plugins.lifecycle'"))

    expect(lifecycle.length).toBeGreaterThan(0)
    for (const line of lifecycle) {
      expect(line).not.toContain("stepUpPolicy: 'always'")
    }
  })
})
