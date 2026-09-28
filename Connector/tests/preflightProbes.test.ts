/**
 * The checking side's own pre-flight probes, run against our gate.
 *
 * These are not our fixtures. They were built by the party running acceptance,
 * posted to the relay as artefacts, and are replayed here byte for byte. Each
 * one's sha256 is asserted before it is used, so a probe that drifts from the
 * one they hold fails loudly rather than passing quietly against something else.
 *
 * Why it is worth having someone else's fixtures in our suite: this control
 * probe is the case our own first attempt at the class-rule threshold would have
 * REFUSED. That attempt blocked when most class rules were dropped, which sounds
 * right and is wrong — dropping unused class rules is exactly what a tree-shake
 * is for. Five class rules with two surviving is a correct bundle, and a
 * proportional rule calls it broken. We did not have a fixture that said so.
 * They did.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectPublish } from '../src/mcp/publishProjection'

/** Probe file, with the sha256 the relay serves it under. */
interface Probe {
  file: string
  sha256: string
  /** What the other side asserts about it, in their words. */
  expectation: string
}

const PROBES: Probe[] = [
  {
    file: 'preflight-probe-control-unused-classes.json',
    sha256: 'e72f54809a61b5c8a82f0ea5aba2dc9e529be0e85d0d6a3a01e1d4c5d10e6363',
    expectation: 'must pass',
  },
]

const load = (probe: Probe): unknown => {
  const path = resolve(import.meta.dir, 'fixtures', probe.file)
  const bytes = readFileSync(path)
  const actual = createHash('sha256').update(bytes).digest('hex')
  // Asserted before the bundle is used, not after. A fixture that has drifted
  // is not a weaker test, it is a different one, and it would pass while
  // proving nothing about what the other side actually runs.
  expect({ file: probe.file, sha256: actual }).toEqual({ file: probe.file, sha256: probe.sha256 })
  return JSON.parse(bytes.toString('utf8'))
}

describe("the validator's pre-flight probes", () => {
  test('every probe matches the sha256 the relay serves it under', () => {
    for (const probe of PROBES) expect(() => load(probe)).not.toThrow()
  })

  test('the tree-shake control passes — dropping unused class rules is not a fault', () => {
    const probe = PROBES[0]!
    const out = projectPublish(load(probe))

    expect({ file: probe.file, ok: out.ok }).toEqual({ file: probe.file, ok: true })
    expect(out.findings).toEqual([])

    // The shape that makes this the useful control: a bundle where half the
    // class rules are legitimately unused. Our first threshold — block when
    // most class rules are dropped — would have refused exactly this.
    expect(out.styleRules).toEqual({ inBundle: 6, surviving: 3, dropped: 3 })
    expect(out.droppedClasses).toEqual(['unused-badge', 'unused-card', 'unused-grid'])
  })

  test('and the rule that judges it is "none survive", not "most dropped"', () => {
    // Stated as a test rather than a comment because it is the distinction the
    // control exists to protect. Two of this bundle's five class rules survive:
    // a proportional rule at any sensible fraction blocks it, and it is fine.
    const out = projectPublish(load(PROBES[0]!))
    const survivingClasses = out.styleRules.surviving - 1 // less the one ambient rule
    expect(survivingClasses).toBeGreaterThan(0)
    expect(survivingClasses * 2).toBeLessThan(5)
    expect(out.findings.map((f) => f.code)).not.toContain('CLASS_RULES_DROPPED')
  })
})
