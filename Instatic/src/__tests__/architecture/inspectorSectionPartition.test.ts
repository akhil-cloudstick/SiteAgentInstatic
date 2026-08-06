/**
 * Inspector section partition — the "one home" gate.
 *
 * The Site inspector shows the CSS workbench in slices: a Layout slice, a
 * Style slice and a Visibility slice, spread across the mode bodies' tabs and
 * disclosures. The failure this guards against is a setting appearing in two
 * places at once — Typography under both Layout and Style, Spacing under both
 * the Layout tab and a "Spacing & alignment" disclosure — which is confusing
 * and, when the two copies disagree about the editing context, actively
 * misleading.
 *
 * So the slices must be DISJOINT (no section in two slices) and COMPLETE
 * (no section stranded with no home), and every mode body must render each
 * slice at most once.
 */

import { describe, expect, it } from 'bun:test'
import { CLASS_STYLE_SECTIONS } from '@site/panels/PropertiesPanel/cssControlTypes'
import {
  LAYOUT_SECTION_IDS,
  STYLE_SECTION_IDS,
  VISIBILITY_SECTION_IDS,
} from '@site/panels/PropertiesPanel/inspectorSections'
import { GUIDED_LAYOUT_CONTROLS } from '@site/panels/PropertiesPanel/guidedCssControls'

const SLICES = {
  layout: LAYOUT_SECTION_IDS,
  style: STYLE_SECTION_IDS,
  visibility: VISIBILITY_SECTION_IDS,
} as const

describe('inspector section partition', () => {
  it('assigns every style section to exactly one slice', () => {
    const homes = new Map<string, string[]>()
    for (const [slice, ids] of Object.entries(SLICES)) {
      for (const id of ids) {
        homes.set(id, [...(homes.get(id) ?? []), slice])
      }
    }

    const duplicated = [...homes].filter(([, slices]) => slices.length > 1)
    expect(duplicated).toEqual([])

    const stranded = CLASS_STYLE_SECTIONS.map((section) => section.id).filter(
      (id) => !homes.has(id),
    )
    expect(stranded).toEqual([])
  })

  it('does not invent slice ids that no section defines', () => {
    const known = new Set(CLASS_STYLE_SECTIONS.map((section) => section.id))
    const unknown = Object.values(SLICES)
      .flatMap((ids) => [...ids])
      .filter((id) => !known.has(id))
    expect(unknown).toEqual([])
  })

  it('gives each guided control a property that a real section owns', () => {
    // A guided control shadows one raw row. If its property belonged to no
    // section, `excludeProperties` would silently exclude nothing and the
    // control would be editing a property the workbench never shows.
    const owned = new Set(
      CLASS_STYLE_SECTIONS.flatMap((section) => section.properties.map(String)),
    )
    const orphans = GUIDED_LAYOUT_CONTROLS.map((control) => String(control.property)).filter(
      (property) => !owned.has(property),
    )
    expect(orphans).toEqual([])
  })

  it('never points two guided controls at the same property', () => {
    const properties = GUIDED_LAYOUT_CONTROLS.map((control) => String(control.property))
    expect(properties.length).toBe(new Set(properties).size)
  })
})
