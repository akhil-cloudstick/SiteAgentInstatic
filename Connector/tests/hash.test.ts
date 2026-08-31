import { describe, expect, test } from 'bun:test'
import { canonicalJson } from '../src/hash/canonical'
import { rowHash, rowsDigest, type HashableRow } from '../src/hash/row'
import { mediaDigest } from '../src/hash/media'
import { recipeHash, type ReleaseRecipe } from '../src/hash/recipe'
import { documentHash } from '../src/hash/document'

const row = (over: Partial<HashableRow> = {}): HashableRow => ({
  id: 'r1',
  tableId: 'posts',
  slug: 'hello-world',
  cells: { title: 'Hello', body: '# Hi' },
  authorUserId: null,
  ...over,
})

describe('canonicalJson', () => {
  test('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  test('preserves array order — order carries content meaning', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })
})

describe('rowHash', () => {
  test('is stable across key ordering in cells', () => {
    const a = rowHash(row({ cells: { title: 'Hello', body: 'x' } }))
    const b = rowHash(row({ cells: { body: 'x', title: 'Hello' } }))
    expect(a).toBe(b)
  })

  test.each([
    ['slug', { slug: 'changed' }],
    ['cells', { cells: { title: 'Different' } }],
    ['tableId', { tableId: 'pages' }],
    ['authorUserId', { authorUserId: 'user-9' }],
  ])('changes when %s changes', (_label, over) => {
    expect(rowHash(row(over as Partial<HashableRow>))).not.toBe(rowHash(row()))
  })

  test('ignores fields the publish itself creates', () => {
    // status / seq / publishedAt / activeVersionId are not part of the input at
    // all — including them would make the hash change as a RESULT of publishing.
    const withNoise = { ...row(), status: 'published', seq: 7, activeVersionId: 'v9' }
    expect(rowHash(withNoise as HashableRow)).toBe(rowHash(row()))
  })
})

describe('rowsDigest', () => {
  test('is independent of input order', () => {
    const rows = [row({ id: 'b' }), row({ id: 'a' }), row({ id: 'c' })]
    const reversed = [...rows].reverse()
    expect(rowsDigest(rows).digest).toBe(rowsDigest(reversed).digest)
  })

  test('changes when a row is added or removed', () => {
    const base = [row({ id: 'a' }), row({ id: 'b' })]
    expect(rowsDigest([...base, row({ id: 'c' })]).digest).not.toBe(rowsDigest(base).digest)
    expect(rowsDigest(base.slice(0, 1)).digest).not.toBe(rowsDigest(base).digest)
  })

  test('emits one entry per row, sorted by rowId', () => {
    const { entries } = rowsDigest([row({ id: 'c' }), row({ id: 'a' }), row({ id: 'b' })])
    expect(entries.map((e) => e.rowId)).toEqual(['a', 'b', 'c'])
  })
})

describe('mediaDigest', () => {
  test('changes when bytes change but the id does not', () => {
    const id = 'm1'
    const a = mediaDigest([{ mediaId: id, bytes: new Uint8Array([1, 2, 3]) }])
    const b = mediaDigest([{ mediaId: id, bytes: new Uint8Array([1, 2, 4]) }])
    expect(a.digest).not.toBe(b.digest)
  })

  test('is independent of input order', () => {
    const one = { mediaId: 'a', bytes: new Uint8Array([1]) }
    const two = { mediaId: 'b', bytes: new Uint8Array([2]) }
    expect(mediaDigest([one, two]).digest).toBe(mediaDigest([two, one]).digest)
  })
})

describe('documentHash', () => {
  const site = { id: 's', name: 'S', pages: [], visualComponents: [] } as never

  test('a layouts-only change does NOT alter the hash', () => {
    // The publisher sets layouts: [] — saved layouts are editor-only. If this
    // ever fails, the conditional full-site publish will fire on layout edits
    // that change nothing published.
    const withLayouts = { ...(site as object), layouts: [{ id: 'l1', name: 'Hero' }] } as never
    expect(documentHash(withLayouts)).toBe(documentHash(site))
  })

  test('a page change DOES alter the hash', () => {
    const withPage = { ...(site as object), pages: [{ id: 'p1' }] } as never
    expect(documentHash(withPage)).not.toBe(documentHash(site))
  })
})

describe('recipeHash', () => {
  const recipe: ReleaseRecipe = {
    instaticCommit: 'abc',
    instaticTree: 'def',
    instaticPackageVersion: '0.0.16',
    bunVersion: '1.3.14',
    instaticDependencyLockSha256: 'l1',
    connectorDependencyLockSha256: 'l2',
    connectorVersion: '0.1.0',
    connectorCommit: 'c1',
    connectorConfigSha256: 'cfg',
    pluginPacks: [],
    publishFilterConfigSha256: 'f',
    importStrategy: 'merge-overwrite',
    featureFlags: {},
    deployWebhookMode: 'suppressed-during-connector-release',
  }

  test('changes when the runtime changes even though content did not', () => {
    expect(recipeHash({ ...recipe, bunVersion: '1.3.15' })).not.toBe(recipeHash(recipe))
  })

  test('changes when a plugin pack version changes', () => {
    expect(
      recipeHash({ ...recipe, pluginPacks: [{ id: 'mms.connector', version: '2' }] }),
    ).not.toBe(recipeHash(recipe))
  })
})
