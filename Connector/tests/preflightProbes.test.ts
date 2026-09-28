/**
 * The checking side's own pre-flight probes, run against our gate.
 *
 * These are not our fixtures. They were built by the party running acceptance,
 * posted to the relay as artefacts, and are replayed here byte for byte. Each
 * one's sha256 is asserted before it is used, so a probe that drifts from the
 * one they hold fails loudly rather than passing quietly against something else.
 *
 * Why it is worth having someone else's fixtures in our suite: the control probe
 * below is the case our own first attempt at the class-rule threshold would have
 * REFUSED. That attempt blocked when most class rules were dropped, which sounds
 * right and is wrong — dropping unused class rules is exactly what a tree-shake
 * is for. Five class rules with two surviving is a correct bundle, and a
 * proportional rule calls it broken. We had no fixture that said so. They did.
 *
 * Two of their five are not here yet: the 3-rule control and the 3-rule defect,
 * whose full hashes we do not hold. They are asked for; when they arrive they
 * belong in the table below and nowhere else.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectPublish } from '../src/mcp/publishProjection'

interface Probe {
  file: string
  sha256: string
  /** What the other side asserts about it, in their words. */
  expectation: string
}

const PROBES: Record<string, Probe> = {
  control: {
    file: 'preflight-probe-control-unused-classes.json',
    sha256: 'e72f54809a61b5c8a82f0ea5aba2dc9e529be0e85d0d6a3a01e1d4c5d10e6363',
    expectation: 'must pass',
  },
  malformed: {
    file: 'preflight-probe-malformed-files.json',
    sha256: '77b4db695f7478ba74e99179b90f448c1917fd6df6db9484e5233bd24e793de4',
    expectation: 'must block (BUNDLE_SHAPE_INVALID)',
  },
  defect41: {
    file: 'preflight-probe-defect-41rules.json',
    sha256: 'cdaffec14e658aa33ea6cd63fef69fcfa17f0c9e9480a4f63b05989696f781a1',
    expectation: 'must block (STYLE_RULES_MOSTLY_DROPPED)',
  },
}

function load(probe: Probe): unknown {
  const bytes = readFileSync(resolve(import.meta.dir, 'fixtures', probe.file))
  const actual = createHash('sha256').update(bytes).digest('hex')
  // Asserted before the bundle is used, not after. A fixture that has drifted is
  // not a weaker test, it is a different one — it would pass while proving
  // nothing about what the other side actually runs.
  expect({ file: probe.file, sha256: actual }).toEqual({ file: probe.file, sha256: probe.sha256 })
  return JSON.parse(bytes.toString('utf8'))
}

const codes = (bundle: unknown) => projectPublish(bundle).findings.map((f) => f.code)

describe("the validator's pre-flight probes", () => {
  test('each matches the sha256 the relay serves it under', () => {
    for (const probe of Object.values(PROBES)) expect(() => load(probe)).not.toThrow()
  })

  test('the tree-shake control passes — dropping unused class rules is not a fault', () => {
    const out = projectPublish(load(PROBES.control!))

    expect(out.ok).toBe(true)
    expect(out.findings).toEqual([])

    // The shape that makes this the useful control: half the class rules are
    // legitimately unused. Our first threshold — block when most class rules are
    // dropped — would have refused exactly this.
    expect(out.styleRules).toEqual({ inBundle: 6, surviving: 3, dropped: 3 })
    expect(out.droppedClasses).toEqual(['unused-badge', 'unused-card', 'unused-grid'])
  })

  test('the 41-rule defect blocks, and on both counts', () => {
    const out = projectPublish(load(PROBES.defect41!))

    expect(out.ok).toBe(false)
    // Both, because in this bundle every class rule is orphaned AND the
    // bundle-wide survival is under a quarter. The checking side reports the
    // same pair, which is the point of replaying their bundle rather than ours.
    expect(out.findings.map((f) => f.code).sort()).toEqual(['CLASS_RULES_DROPPED', 'STYLE_RULES_MOSTLY_DROPPED'])
  })

  test('the malformed bundle blocks with a coded finding, not a runtime error', () => {
    const out = projectPublish(load(PROBES.malformed!))

    expect(out.ok).toBe(false)
    expect(codes(load(PROBES.malformed!))).toEqual(['BUNDLE_SHAPE_INVALID'])

    const finding = out.findings[0]!
    expect(finding.severity).toBe('block')
    expect(finding.message).toContain('site.files')
    // The distinction that matters to whoever reads it: not "your site would not
    // publish", but "this was not judged".
    expect(finding.message).toContain('Nothing was checked')
  })

  test('the control and the defects disagree, which is what makes the pair evidence', () => {
    // Stated as its own case because a suite where every fixture blocks proves
    // only that the gate is capable of refusing.
    expect(projectPublish(load(PROBES.control!)).ok).toBe(true)
    expect(projectPublish(load(PROBES.defect41!)).ok).toBe(false)
    expect(projectPublish(load(PROBES.malformed!)).ok).toBe(false)
  })
})
