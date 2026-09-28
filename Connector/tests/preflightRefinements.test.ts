/**
 * Two pre-flight gaps the acceptance run found, and what now happens instead.
 *
 * Both were reported from someone else's first run against the gate, and both
 * are the same shape of problem: the check answered, the answer was safe, and
 * the answer was not readable as a judgement.
 */
import { describe, expect, test } from 'bun:test'
import { projectPublish } from '../src/mcp/publishProjection'

/**
 * The fixture shape a real bundle has: pages are ROWS whose `cells.body.nodes`
 * carry `classIds`, and style rules are keyed by an opaque id that is NOT the
 * class name. Copied from publishProjection.test.ts deliberately — the first
 * version of these tests invented a shape of its own, no page parsed, nothing
 * counted as used, and every case "blocked" for the wrong reason.
 */
const ruleId = (name: string) => `sr_${name.replace(/[^a-z0-9]/gi, '')}_7f3a`

const rule = (name: string, kind: 'class' | 'ambient', selector: string) => ({
  id: ruleId(name),
  name: kind === 'class' ? name : selector,
  kind,
  selector,
  order: 0,
  styles: { color: 'red' },
  contextStyles: {},
  createdAt: 0,
  updatedAt: 0,
})

const rulesById = (...rules: ReturnType<typeof rule>[]) => Object.fromEntries(rules.map((r) => [r.id, r]))

const page = (id: string, slug: string, classIds: string[] = []) => ({
  id,
  tableId: 'pages',
  slug,
  cells: {
    title: slug,
    body: {
      rootNodeId: `${id}-root`,
      nodes: { [`${id}-root`]: { id: `${id}-root`, moduleId: 'base.container', props: {}, children: [], classIds } },
    },
  },
})

const codes = (out: ReturnType<typeof projectPublish>) => out.findings.map((f) => f.code)

describe('a bundle that keeps not one of its class rules', () => {
  // The reported case, and the one the first attempt at this check missed.
  //
  // The defect is that class-rule IDS ARE MINTED: the rules are present, and no
  // node references them, because the ids nodes carry are not the ids the rules
  // have. One ambient rule survives, so the bundle-wide count is 1 of 3 —
  // comfortably over its quarter — and nothing was reported at all.
  //
  // The first version of this check asked which class rules the NODES USE, keyed
  // on `usedIds.has(rule.id)`. It could never fire here: when the ids do not line
  // up, the set of "used class rules" is empty and there is nothing to judge.
  // Anything keyed on ids is blind to a fault in the ids.
  test('is blocked, where the bundle-wide count alone passes it', () => {
    const out = projectPublish({
      site: {
        styleRules: rulesById(
          rule('brand-mark', 'class', '.brand-mark'),
          rule('hero-logo', 'class', '.hero-logo'),
          rule('headings', 'ambient', 'h1'),
        ),
      },
      tables: [{ id: 'pages', slug: 'pages' }],
      // The node names a class id that no rule has — this is the defect.
      rows: [page('p1', 'index', ['style:class:brand-mark'])],
    })

    expect(codes(out)).toContain('CLASS_RULES_DROPPED')
    expect(out.ok).toBe(false)
    // The bundle-wide rule stays quiet, which is exactly why this one is needed.
    expect(codes(out)).not.toContain('STYLE_RULES_MOSTLY_DROPPED')
    expect(out.droppedClasses).toEqual(['brand-mark', 'hero-logo'])
  })

  test('at any size — one class rule dropped out of one is still all of them', () => {
    const out = projectPublish({
      site: { styleRules: rulesById(rule('only', 'class', '.only'), rule('headings', 'ambient', 'h1')) },
      tables: [{ id: 'pages', slug: 'pages' }],
      rows: [page('p1', 'index', ['style:class:only'])],
    })
    expect(codes(out)).toContain('CLASS_RULES_DROPPED')
  })

  test('and says so in words that name the cause', () => {
    const out = projectPublish({
      site: { styleRules: rulesById(rule('a', 'class', '.a'), rule('h', 'ambient', 'h1')) },
      tables: [{ id: 'pages', slug: 'pages' }],
      rows: [page('p1', 'index', [])],
    })
    const f = out.findings.find((x) => x.code === 'CLASS_RULES_DROPPED')!
    expect(f.severity).toBe('block')
    expect(f.message).toContain('None of the 1 class rules')
    expect(f.message).toContain('minted')
  })
})

describe('a bundle whose tree-shake is working normally', () => {
  // The false positive this check must not have. Dropping unused class rules is
  // what a tree-shake is FOR: a bundle carrying a design system of many classes
  // and using a few is correct, and a proportional threshold would refuse it.
  // That is why the rule is "none survive" rather than "most are dropped".
  test('is not blocked for dropping the classes nothing uses', () => {
    const out = projectPublish({
      site: {
        styleRules: rulesById(
          rule('hero', 'class', '.hero'),
          rule('unused-a', 'class', '.unused-a'),
          rule('unused-b', 'class', '.unused-b'),
          rule('unused-c', 'class', '.unused-c'),
          rule('headings', 'ambient', 'h1'),
        ),
      },
      tables: [{ id: 'pages', slug: 'pages' }],
      rows: [page('p1', 'index', [ruleId('hero')])],
    })

    // One of four class rules survives — a proportional rule would have blocked
    // this, and it is a perfectly good bundle.
    expect(codes(out)).not.toContain('CLASS_RULES_DROPPED')
  })

  test('nor when the bundle has no class rules at all', () => {
    const out = projectPublish({
      site: { styleRules: rulesById(rule('headings', 'ambient', 'h1')) },
      tables: [{ id: 'pages', slug: 'pages' }],
      rows: [page('p1', 'index', [])],
    })
    expect(codes(out)).not.toContain('CLASS_RULES_DROPPED')
  })
})

describe('a malformed bundle', () => {
  // The reported case: `site.files` as {} instead of []. It used to reach the
  // walk and die with "{} is not iterable" — safe, but unreadable: a gate
  // cannot act on a raw runtime message, and the caller cannot tell a bad
  // bundle from a broken tool.
  test('gives a coded finding rather than a raw runtime error', () => {
    const out = projectPublish({ site: { files: {} }, rows: [], tables: [] })
    expect(out.ok).toBe(false)
    expect(out.findings[0]!.code).toBe('BUNDLE_SHAPE_INVALID')
    expect(out.findings[0]!.severity).toBe('block')
    expect(out.findings[0]!.message).toContain('site.files')
    expect((out.findings[0]!.detail as { fields: string[] }).fields).toEqual(['site.files'])
  })

  test('names every field that is wrong, not just the first', () => {
    const out = projectPublish({ site: { files: {}, visualComponents: {} }, rows: {}, tables: {} })
    const fields = (out.findings[0]!.detail as { fields: string[] }).fields
    expect(fields).toContain('rows')
    expect(fields).toContain('tables')
    expect(fields).toContain('site.files')
    expect(fields).toContain('site.visualComponents')
  })

  test('says plainly that nothing else was judged', () => {
    // The distinction that matters to whoever reads it: this is not "your site
    // would not publish", it is "this was not checked".
    const out = projectPublish({ site: { files: {} }, rows: [], tables: [] })
    expect(out.findings[0]!.message).toContain('Nothing was checked')
    expect(out.routes).toEqual([])
    expect(out.styleRules).toEqual({ inBundle: 0, surviving: 0, dropped: 0 })
  })

  test('an absent field is still not malformed', () => {
    // `?? []` behaviour has to survive: omitting a list is ordinary.
    const out = projectPublish({ site: {}, rows: [], tables: [] })
    expect(out.findings.some((f) => f.code === 'BUNDLE_SHAPE_INVALID')).toBe(false)
  })
})
