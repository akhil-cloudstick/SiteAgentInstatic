/**
 * `merge-add` never overwrites, so an existing table keeps its field list —
 * and a bundle that adds a field to that table imports cells addressed to a
 * field that will never exist. The values land and stay invisible, and no
 * result counter mentions it. The preview names them instead.
 */

import { describe, it, expect } from 'bun:test'
import { findFieldsNotCreated } from '../../../server/handlers/cms/importPreview'
import type { DataTable } from '@core/data/schemas'

const table = (id: string, fieldIds: string[]): DataTable =>
  ({
    id,
    name: `${id} table`,
    slug: id,
    kind: 'data',
    fields: fieldIds.map((fieldId) => ({ id: fieldId, type: 'text', label: fieldId })),
  }) as unknown as DataTable

describe('findFieldsNotCreated', () => {
  it('names the fields a bundle adds to a table that already exists', () => {
    expect(findFieldsNotCreated(table('news', ['title', 'body', 'seoTitle']), table('news', ['title', 'body']))).toEqual({
      tableId: 'news',
      tableName: 'news table',
      fieldIds: ['seoTitle'],
    })
  })

  it('reports nothing for a table the destination does not have — it arrives with its fields', () => {
    expect(findFieldsNotCreated(table('news', ['title']), undefined)).toBeNull()
  })

  it('reports nothing when the destination already defines every field', () => {
    expect(findFieldsNotCreated(table('news', ['title']), table('news', ['title', 'extra']))).toBeNull()
  })
})
