/**
 * The checking side's own pre-flight probes, all five, run against our gate.
 *
 * These are not our fixtures. They were built by the party running acceptance,
 * posted to the relay as artefacts, and are replayed here byte for byte. Each
 * one's sha256 is asserted before it is used, so a probe that drifts from the
 * one they hold fails loudly rather than passing quietly against something else.
 *
 * Two of them are here because our own tests were wrong, which is the argument
 * for holding someone else's:
 *
 *   - `defect-3rules` is the bundle our first class-rule check could not see.
 *     That check asked which class rules the NODES USE, keyed on the rule id
 *     appearing among the ids nodes reference — and this defect IS ids that do
 *     not line up, so the set came back empty and there was nothing to judge.
 *     The test we wrote for it asserted the gap rather than catching it: named
 *     for the behaviour, asserting the opposite. The suite agreed with itself
 *     while the check did nothing.
 *   - `control-unused-classes` is the bundle our SECOND attempt would have
 *     wrongly refused. That one blocked when most class rules were dropped,
 *     which sounds right and is wrong — dropping unused class rules is exactly
 *     what a tree-shake is for. Five class rules with two surviving is correct.
 *
 * Between them they pin both edges: the check must fire on the defect, and must
 * not fire on a bundle that is merely economical.
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
  control3: {
    file: 'preflight-probe-control-3rules.json',
    sha256: 'bd0c0e5dfc04d00e9820fa77be88988512494924885d53d3dea054f0d6e826b2',
    expectation: 'must pass',
  },
  defect3: {
    file: 'preflight-probe-defect-3rules.json',
    sha256: 'c9493a9d6c84b3e911b87072f5550e79885641f6fbbc33a03ca6675a508ec130',
    expectation: 'must block with CLASS_RULES_DROPPED naming brand-mark and hero-logo',
  },
  controlUnused: {
    file: 'preflight-probe-control-unused-classes.json',
    sha256: 'e72f54809a61b5c8a82f0ea5aba2dc9e529be0e85d0d6a3a01e1d4c5d10e6363',
    expectation: 'must pass',
  },
  defect41: {
    file: 'preflight-probe-defect-41rules.json',
    sha256: 'cdaffec14e658aa33ea6cd63fef69fcfa17f0c9e9480a4f63b05989696f781a1',
    expectation: 'must block (STYLE_RULES_MOSTLY_DROPPED)',
  },
  malformed: {
    file: 'preflight-probe-malformed-files.json',
    sha256: '77b4db695f7478ba74e99179b90f448c1917fd6df6db9484e5233bd24e793de4',
    expectation: 'must block (BUNDLE_SHAPE_INVALID)',
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

const run = (probe: Probe) => projectPublish(load(probe))

describe("the validator's pre-flight probes", () => {
  test('each matches the sha256 the relay serves it under', () => {
    for (const probe of Object.values(PROBES)) expect(() => load(probe)).not.toThrow()
  })

  // --- the two that must pass --------------------------------------------------

  test('the 3-rule control passes, with nothing dropped', () => {
    const out = run(PROBES.control3!)
    expect(out.ok).toBe(true)
    expect(out.findings).toEqual([])
    expect(out.styleRules).toEqual({ inBundle: 3, surviving: 3, dropped: 0 })
  })

  test('the unused-classes control passes — a tree-shake dropping what nothing uses is not a fault', () => {
    const out = run(PROBES.controlUnused!)
    expect(out.ok).toBe(true)
    expect(out.findings).toEqual([])
    expect(out.styleRules).toEqual({ inBundle: 6, surviving: 3, dropped: 3 })
    expect(out.droppedClasses).toEqual(['unused-badge', 'unused-card', 'unused-grid'])
  })

  // --- the three that must block -----------------------------------------------

  test('the 3-rule defect blocks, and ONLY the class check sees it', () => {
    const out = run(PROBES.defect3!)

    expect(out.ok).toBe(false)
    expect(out.findings.map((f) => f.code)).toEqual(['CLASS_RULES_DROPPED'])
    expect(out.droppedClasses).toEqual(['brand-mark', 'hero-logo'])

    // The assertion that justifies the check existing at all. One of three rules
    // survives, which is over the bundle-wide quarter, so that check stays
    // silent — and without the class check this bundle passes while every class
    // rule in it is orphaned.
    expect(out.styleRules).toEqual({ inBundle: 3, surviving: 1, dropped: 2 })
    expect(out.findings.map((f) => f.code)).not.toContain('STYLE_RULES_MOSTLY_DROPPED')
  })

  test('the 41-rule defect blocks on both counts', () => {
    const out = run(PROBES.defect41!)
    expect(out.ok).toBe(false)
    expect(out.findings.map((f) => f.code).sort()).toEqual(['CLASS_RULES_DROPPED', 'STYLE_RULES_MOSTLY_DROPPED'])
  })

  test('the malformed bundle blocks with a coded finding, not a runtime error', () => {
    const out = run(PROBES.malformed!)
    expect(out.ok).toBe(false)
    expect(out.findings.map((f) => f.code)).toEqual(['BUNDLE_SHAPE_INVALID'])

    const finding = out.findings[0]!
    expect(finding.severity).toBe('block')
    expect(finding.message).toContain('site.files')
    // Not "your site would not publish", but "this was not judged".
    expect(finding.message).toContain('Nothing was checked')
  })

  // --- the set as a set ----------------------------------------------------------

  test('the controls pass and the defects block, which is what makes the set evidence', () => {
    // Stated on its own because a suite where every fixture blocks proves only
    // that the gate is capable of refusing.
    expect(run(PROBES.control3!).ok).toBe(true)
    expect(run(PROBES.controlUnused!).ok).toBe(true)
    expect(run(PROBES.defect3!).ok).toBe(false)
    expect(run(PROBES.defect41!).ok).toBe(false)
    expect(run(PROBES.malformed!).ok).toBe(false)
  })
})
