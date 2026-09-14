/**
 * `unknownFields` — the preview warning for cells that will never be read back.
 *
 * The import writes `cells_json` verbatim, so a cell addressed to a field the
 * table does not define is accepted, stored, and then invisible to every
 * reader. Preview is the last cheap moment to catch it.
 *
 * The rule is subtle in one specific way, and getting it wrong is worse than
 * not having the check at all: a bundle that ships a table definition is
 * *adding* those fields, and `replace` / `merge-overwrite` apply them
 * (`updateDataTable(..., fields)`). Comparing cells against the local schema
 * alone flags every field a well-formed bundle is in the middle of introducing
 * — firing loudest on exactly the bundles it should wave through, and burying
 * the real fault in noise. Hence the union.
 */
import { describe, expect, it } from 'bun:test'
import { findUnknownFields } from '../../../server/handlers/cms/importPreview'
import type { DataRow, DataTable, DataField } from '@core/data/schemas'

const field = (id: string): DataField => ({ type: 'text', id, label: id })

function table(fieldIds: string[]): DataTable {
  return {
    id: 'pages',
    name: 'Pages',
    slug: 'pages',
    kind: 'pageType',
    fields: fieldIds.map(field),
    primaryFieldId: 'title',
  } as DataTable
}

function row(id: string, cells: Record<string, unknown>): DataRow {
  return { id, tableId: 'pages', slug: id, status: 'published', cells } as DataRow
}

const BUILT_IN = ['title', 'slug', 'seoTitle', 'seoDescription']
const WITH_SEO = [...BUILT_IN, 'canonicalUrl', 'ogTitle', 'ogDescription', 'ogImage', 'jsonLd']

describe('findUnknownFields', () => {
  it('stays silent when the bundle ships the fields its cells use', () => {
    // The real globalnettech shape: the bundle carries `pages` WITH the SEO
    // fields; the instance still has only the two built-ins. Reporting here
    // would fail a correct bundle.
    const found = findUnknownFields(table(WITH_SEO), table(BUILT_IN), [
      row('a', { title: 'A', canonicalUrl: 'https://x.test/a/', jsonLd: '[]' }),
    ])
    expect(found).toEqual([])
  })

  it('reports a cell no schema on either side defines', () => {
    const found = findUnknownFields(table(BUILT_IN), table(BUILT_IN), [
      row('a', { title: 'A', canonicalUrl: 'https://x.test/a/' }),
    ])
    expect(found).toEqual([
      { tableId: 'pages', tableName: 'Pages', fieldId: 'canonicalUrl', rowCount: 1 },
    ])
  })

  it('counts how many rows carry the unknown cell', () => {
    const found = findUnknownFields(table(BUILT_IN), table(BUILT_IN), [
      row('a', { jsonLd: '[]' }),
      row('b', { jsonLd: '[]' }),
      row('c', { title: 'C' }),
    ])
    expect(found).toEqual([
      { tableId: 'pages', tableName: 'Pages', fieldId: 'jsonLd', rowCount: 2 },
    ])
  })

  it('orders by row count so the widest problem reads first', () => {
    const found = findUnknownFields(table(BUILT_IN), table(BUILT_IN), [
      row('a', { rare: 1, common: 1 }),
      row('b', { common: 1 }),
      row('c', { common: 1 }),
    ])
    expect(found.map((f) => f.fieldId)).toEqual(['common', 'rare'])
  })

  it('accepts a field only the local table defines', () => {
    // A custom field added on the instance earlier; the bundle does not
    // redeclare it but the cell still lands somewhere real.
    const found = findUnknownFields(table(BUILT_IN), table([...BUILT_IN, 'legacyNote']), [
      row('a', { legacyNote: 'kept' }),
    ])
    expect(found).toEqual([])
  })

  it('falls back to the bundle schema for a table that does not exist locally', () => {
    const found = findUnknownFields(table(WITH_SEO), undefined, [
      row('a', { canonicalUrl: 'https://x.test/a/', nope: 1 }),
    ])
    expect(found.map((f) => f.fieldId)).toEqual(['nope'])
  })

  it('reports nothing for rows with no cells at all', () => {
    expect(findUnknownFields(table(BUILT_IN), table(BUILT_IN), [row('a', {})])).toEqual([])
  })
})
