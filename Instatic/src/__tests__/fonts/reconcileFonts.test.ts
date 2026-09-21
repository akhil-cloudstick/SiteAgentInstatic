/**
 * Fonts surviving a design replace (R12, AC-C12.2).
 *
 * The pull in two directions is the whole test. AC-C12.2 wants a family the new
 * design uses to still work after a replace. The "Share to CMS" invariant wants
 * a re-share to be an exact match for the design it came from, with no stale
 * fonts from a previous share. Restoring everything satisfies the first and
 * breaks the second, which is why the code reconciles rather than preserves —
 * and why both directions are asserted here.
 */

import { describe, expect, it } from 'bun:test'
import { familiesReferencedBy, normalizeFamily, reconcileFonts } from '@core/fonts/reconcile'
import type { FontEntry, FontToken, SiteFontsSettings } from '@core/fonts/schemas'

const entry = (id: string, family: string): FontEntry => ({
  id,
  source: 'google',
  family,
  variants: ['400'],
  subsets: ['latin'],
  files: [{ url: `/media/fonts/${id}.woff2`, weight: 400, style: 'normal', format: 'woff2' }],
  category: 'sans-serif',
  createdAt: 1,
  updatedAt: 1,
})

const token = (id: string, variable: string, familyId: string): FontToken => ({
  id,
  name: variable,
  variable,
  familyId,
  fallback: 'sans-serif',
  order: 0,
})

const rule = (fontFamily: string) => ({ id: 'r1', kind: 'class', styles: { fontFamily }, contextStyles: {} })

describe('familiesReferencedBy', () => {
  it('finds a family used by a style rule', () => {
    const found = familiesReferencedBy({ styleRules: { r1: rule('"Inter", sans-serif') } })
    expect(found.has('inter')).toBe(true)
  })

  it('finds a family used only at one breakpoint', () => {
    // A family used only inside contextStyles is still used. Reading only the
    // base `styles` bag would drop it and leave that breakpoint unstyled.
    const found = familiesReferencedBy({
      styleRules: {
        r1: { id: 'r1', kind: 'class', styles: {}, contextStyles: { 'md': { fontFamily: 'Playfair Display' } } },
      },
    })
    expect(found.has('playfair display')).toBe(true)
  })

  it('finds a family named only in a raw stylesheet, including in @font-face', () => {
    const found = familiesReferencedBy({
      files: [
        { type: 'style', content: 'body { font-family: "Source Serif 4", Georgia, serif; }' },
        { type: 'style', content: '@font-face { font-family: Cardo; src: url(/f.woff2); }' },
      ],
    })
    expect([...found].sort()).toEqual(['cardo', 'georgia', 'serif', 'source serif 4'])
  })

  it('compares families the way CSS does', () => {
    expect(normalizeFamily('  "Inter"  ')).toBe('inter')
    expect(normalizeFamily("'Inter'")).toBe(normalizeFamily('INTER'))
  })
})

describe('reconcileFonts', () => {
  const before: SiteFontsSettings = {
    items: [entry('f_inter', 'Inter'), entry('f_lobster', 'Lobster')],
    tokens: [token('t_body', '--font-body', 'f_inter'), token('t_old', '--font-old', 'f_lobster')],
  }

  it('brings back a family the new design uses but did not install (AC-C12.2)', () => {
    // The case the blank used to break: the design binds its body text to Inter
    // through a token and never ships an @font-face for it, so the import has
    // nothing to reinstall from.
    const imported = { styleRules: { r1: rule('"Inter", sans-serif') }, settings: { fonts: { items: [] } } }
    const result = reconcileFonts(before, imported)

    expect(result.restored).toEqual(['Inter'])
    expect(result.fonts.items.map((i) => i.family)).toEqual(['Inter'])
    // And its files are still pointed at — a blank never deleted the bytes.
    expect(result.fonts.items[0]!.files[0]!.url).toBe('/media/fonts/f_inter.woff2')
  })

  it('does NOT bring back a family the new design stopped using', () => {
    // The invariant the blank exists to protect: a re-share must not accumulate
    // stale fonts from a previous share.
    const imported = { styleRules: { r1: rule('"Inter", sans-serif') }, settings: { fonts: { items: [] } } }
    const result = reconcileFonts(before, imported)

    expect(result.dropped).toEqual(['Lobster'])
    expect(result.fonts.items.some((i) => i.family === 'Lobster')).toBe(false)
    expect(result.fonts.tokens?.some((t) => t.familyId === 'f_lobster')).toBeFalsy()
  })

  it('lets what the import installed win over the old copy of the same family', () => {
    // The imported entry carries the current design's variants and subsets. The
    // old one is the previous design's idea of that family.
    const fresh = { ...entry('f_inter_new', 'Inter'), variants: ['400', '700'] }
    const imported = {
      styleRules: { r1: rule('Inter') },
      settings: { fonts: { items: [fresh] } },
    }
    const result = reconcileFonts(before, imported)

    expect(result.fonts.items.map((i) => i.id)).toEqual(['f_inter_new'])
    expect(result.restored).toEqual([])
  })

  it('restores a token only when its family survives', () => {
    const imported = { styleRules: { r1: rule('Inter') }, settings: { fonts: { items: [] } } }
    const result = reconcileFonts(before, imported)

    // A token whose familyId no longer resolves falls back to its bare stack,
    // which is the unstyled outcome this is all here to prevent.
    expect(result.fonts.tokens?.map((t) => t.variable)).toEqual(['--font-body'])
  })

  it('never lets a restored token shadow one the import defined', () => {
    const importedToken = token('t_new', '--font-body', 'f_new')
    const imported = {
      styleRules: { r1: rule('Inter') },
      settings: { fonts: { items: [entry('f_new', 'Space Grotesk')], tokens: [importedToken] } },
    }
    const result = reconcileFonts(before, imported)

    const bodyTokens = (result.fonts.tokens ?? []).filter((t) => t.variable === '--font-body')
    expect(bodyTokens).toEqual([importedToken])
  })

  it('is a no-op when there was nothing installed before', () => {
    const imported = { settings: { fonts: { items: [entry('f_a', 'A')] } } }
    expect(reconcileFonts({ items: [] }, imported).fonts.items.map((i) => i.family)).toEqual(['A'])
    expect(reconcileFonts(null, imported).fonts.items.map((i) => i.family)).toEqual(['A'])
  })
})
