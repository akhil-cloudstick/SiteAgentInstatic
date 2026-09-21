/**
 * A second website cannot silently destroy the first (MMSBUILD R2, AC-A2.1).
 *
 * The failure this guards against was not a bug in any one function. A share
 * carried files and nothing else, so "this design again" and "a different
 * design" arrived down one path looking identical — and that path blanks the
 * site before it plans the import, which is why no conflict was ever detected
 * and why the result read as a successful update.
 *
 * So the thing worth testing is the judgement: which of the two this is, and
 * what happens as a result. Two cases matter most and pull in opposite
 * directions —
 *
 *   · a DIFFERENT design over a published website must be refused, and
 *   · the SAME design again must still overwrite in place, because "no
 *     duplicates on re-share" depends on exactly that.
 *
 * Breaking the second while fixing the first would be the easy mistake.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DbClient } from '../../../server/db'
import { createTestDb } from '../helpers/createTestDb'
import { getDesignOrigin, recordDesignOrigin } from '../../../server/repositories/designOrigin'
import { judgeShare } from '../../../server/handlers/cms/importSiteHtml'

let db: DbClient
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ db, cleanup } = await createTestDb())
})
afterEach(async () => {
  await cleanup()
})

describe('which design built this website', () => {
  it('remembers nothing until a design has landed', async () => {
    expect(await getDesignOrigin(db)).toBeNull()
  })

  it('records the design that landed, with the name a person reads', async () => {
    await recordDesignOrigin(db, 'design-a', 'Menu Site')
    const origin = await getDesignOrigin(db)
    expect(origin?.designId).toBe('design-a')
    expect(origin?.designName).toBe('Menu Site')
  })

  it('keeps the first-shared date when the same design is shared again', async () => {
    await recordDesignOrigin(db, 'design-a', 'Menu Site')
    const first = await getDesignOrigin(db)
    await new Promise((r) => setTimeout(r, 1100))
    await recordDesignOrigin(db, 'design-a', 'Menu Site renamed')
    const again = await getDesignOrigin(db)
    // Same website, brought up to date: it did not start over.
    expect(again?.firstSharedAt).toBe(first!.firstSharedAt)
    expect(again?.designName).toBe('Menu Site renamed')
  })

  it('starts over when a different design takes the website', async () => {
    await recordDesignOrigin(db, 'design-a', 'Menu Site')
    const first = await getDesignOrigin(db)
    await new Promise((r) => setTimeout(r, 1100))
    await recordDesignOrigin(db, 'design-b', 'Christmas Site')
    const now = await getDesignOrigin(db)
    expect(now?.designId).toBe('design-b')
    // A different design is a different website's history.
    expect(now?.firstSharedAt).not.toBe(first!.firstSharedAt)
  })

  it('only ever describes one website — the project holds exactly one', async () => {
    await recordDesignOrigin(db, 'design-a', 'A')
    await recordDesignOrigin(db, 'design-b', 'B')
    const { rows } = await db<{ n: number }>`select count(*) as n from site_design_origin`
    expect(Number(rows[0]!.n)).toBe(1)
  })
})

describe('a second design cannot silently destroy the first (AC-A2.1)', () => {
  const origin = (designId: string, designName: string | null = null) => ({
    designId,
    designName,
    firstSharedAt: '2026-01-01T00:00:00.000Z',
    lastSharedAt: '2026-01-01T00:00:00.000Z',
  })
  const live = { hasPublishedVersion: true, publishedPages: 12, draftPages: 12 }
  const draftOnly = { hasPublishedVersion: false, publishedPages: 0, draftPages: 4 }
  const empty = { hasPublishedVersion: false, publishedPages: 0, draftPages: 0 }

  it('refuses a different design over a published website', () => {
    const v = judgeShare(origin('design-a', 'Menu Site'), live, { id: 'design-b', name: 'Christmas Site' })
    expect(v.verdict).toBe('refuse')
  })

  it('says what is already there, so the refusal can be acted on', () => {
    const v = judgeShare(origin('design-a', 'Menu Site'), live, { id: 'design-b' })
    if (v.verdict !== 'refuse') throw new Error('expected a refusal')
    expect(v.message).toContain('12 page')
    expect(v.message).toContain('Menu Site')
    expect(v.existing).toEqual({ design: 'Menu Site', pages: 12 })
  })

  // The one most likely to be broken by fixing the rest: re-sharing the SAME
  // design must still overwrite in place, or "no duplicates on re-share" — the
  // behaviour the whole share feature rests on — is gone.
  it('still lets the same design overwrite its own website', () => {
    expect(judgeShare(origin('design-a'), live, { id: 'design-a' }).verdict).toBe('allow')
  })

  it('allows the same design even when it has been renamed', () => {
    expect(judgeShare(origin('design-a', 'Old name'), live, { id: 'design-a', name: 'New name' }).verdict).toBe('allow')
  })

  it('lets a first design land in an empty project', () => {
    expect(judgeShare(null, empty, { id: 'design-a' }).verdict).toBe('allow')
  })

  it('lets any design land where there is nothing to lose', () => {
    expect(judgeShare(origin('design-a'), empty, { id: 'design-b' }).verdict).toBe('allow')
  })

  // Unpublished work is not refused — iterating with more than one design
  // before launch is normal — but it is not thrown away in silence either.
  it('asks before replacing unpublished work, naming what goes', () => {
    const v = judgeShare(origin('design-a', 'Menu Site'), draftOnly, { id: 'design-b' })
    expect(v.verdict).toBe('allow')
    if (v.verdict !== 'allow') throw new Error('expected an allow')
    expect(v.confirm).toEqual({ replacing: 'Menu Site', pages: 4 })
  })

  it('does not ask when the same design updates its own unpublished work', () => {
    const v = judgeShare(origin('design-a'), draftOnly, { id: 'design-a' })
    expect(v.verdict).toBe('allow')
    if (v.verdict !== 'allow') throw new Error('expected an allow')
    expect(v.confirm).toBeUndefined()
  })

  // A share that cannot say which design it is cannot be shown to be the same
  // one, and a published website is not the place to assume the best.
  it('refuses a share that names no design at all, over a published website', () => {
    expect(judgeShare(origin('design-a'), live, undefined).verdict).toBe('refuse')
  })

  // A website built before the platform recorded any of this has no origin.
  // Reading that absence as evidence of a second design would lock every
  // existing project out of its own studio, so the first identified share is
  // adopted — and the project is protected from then on.
  it('adopts the first identified design for a website that predates the check', () => {
    expect(judgeShare(null, live, { id: 'design-b' }).verdict).toBe('allow')
  })

  it('protects that website from the NEXT different design, once adopted', () => {
    expect(judgeShare(origin('design-b'), live, { id: 'design-c' }).verdict).toBe('refuse')
  })

  it('says plainly when a share simply did not identify itself', () => {
    const v = judgeShare(null, live, undefined)
    if (v.verdict !== 'refuse') throw new Error('expected a refusal')
    expect(v.message).toContain('did not say which design')
  })
})

// Source checks, in the spirit of the control plane's route-coverage test: the
// things most likely to be undone later by someone who does not know why they
// are there, and which no behavioural test would notice.
describe('the guard stays where it has to be', () => {
  const read = (rel: string) => readFileSync(resolve(import.meta.dir, '../../../', rel), 'utf8')

  it('judges the share BEFORE anything is staged', () => {
    const src = read('server/handlers/cms/importSiteHtml.ts')
    expect(src.indexOf('judgeShare(')).toBeGreaterThan(-1)
    // Staging is harmless on its own, but it is what hands the browser the
    // token that runs the wizard — and the wizard is what destroys the site.
    expect(src.indexOf('const judged = judgeShare(')).toBeLessThan(src.indexOf('stageFileMap('))
  })

  it('records the design only once the share is allowed through', () => {
    const src = read('server/handlers/cms/importSiteHtml.ts')
    expect(src.indexOf("verdict === 'refuse'")).toBeLessThan(src.indexOf('recordDesignOrigin('))
  })

  // A CMS that does not know which project it is cannot decide that a token is
  // addressed to it. The old `!slug ||` made an unconfigured install accept a
  // hand-off meant for anybody (R4, AC-A2.2).
  it('never skips the project check when no project is configured', () => {
    const src = read('server/auth/tenantSso.ts')
    expect(src).not.toContain('return !slug || payload.sub === slug')
    expect(src).toContain('if (!slug) return false')
  })
})
