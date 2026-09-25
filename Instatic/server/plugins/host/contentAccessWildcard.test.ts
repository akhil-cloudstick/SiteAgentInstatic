/**
 * `contentAccess: "*"` — a plugin that may reach every content table.
 *
 * Why this exists. `contentAccess` is a fixed list of table names in a plugin's
 * manifest, which is right for a plugin that knows the tables it needs. It is
 * wrong for one whose job is to expose the tables the OPERATOR created: a custom
 * post type called "recipes" cannot appear in a manifest written before it
 * existed. The effect was not a refusal, which would at least have been visible
 * — `cms_list_tables` simply did not return it, so an agent asking "what content
 * is here" was told a subset and had no way to know it was a subset.
 *
 * This is a widening of a security boundary, so what is pinned below is as much
 * about what the wildcard does NOT do:
 *
 *   - it is declared, never implied — no manifest gets it by accident
 *   - the row's `modes` still bound it, so "*" with ["read"] grants reading
 *     every table and writing none
 *   - a plugin without it is unchanged in every respect
 */
import { describe, expect, it } from 'bun:test'
import { CONTENT_ACCESS_ALL, assertContentTableAccess } from './registry'

/** The shape the assertion actually reads — nothing else is touched. */
const pluginWith = (contentAccess: { table: string; modes: string[] }[]) =>
  ({ manifest: { id: 'test.plugin', contentAccess } }) as never

describe('contentAccess wildcard', () => {
  it('is the literal asterisk', () => {
    expect(CONTENT_ACCESS_ALL).toBe('*')
  })

  it('grants a table the manifest could not have named', () => {
    const plugin = pluginWith([{ table: '*', modes: ['read', 'write'] }])
    // A custom post type created long after this manifest was written.
    expect(() => assertContentTableAccess(plugin, 'recipes', 'read')).not.toThrow()
    expect(() => assertContentTableAccess(plugin, 'anything-at-all', 'write')).not.toThrow()
  })

  it('is still bounded by the modes on its own row', () => {
    const readOnly = pluginWith([{ table: '*', modes: ['read'] }])
    expect(() => assertContentTableAccess(readOnly, 'recipes', 'read')).not.toThrow()
    // The wildcard is about WHICH tables, never about what may be done to them.
    expect(() => assertContentTableAccess(readOnly, 'recipes', 'write')).toThrow(/not for mode "write"/)
    expect(() => assertContentTableAccess(readOnly, 'recipes', 'delete')).toThrow(/not for mode "delete"/)
  })

  it('an exact row still wins over the wildcard, so a narrower rule can be written', () => {
    const plugin = pluginWith([
      { table: '*', modes: ['read'] },
      { table: 'pages', modes: ['read', 'write', 'publish', 'delete'] },
    ])
    // The specific row is found first, so `pages` keeps its broader modes.
    expect(() => assertContentTableAccess(plugin, 'pages', 'delete')).not.toThrow()
    // And everything else still has only what the wildcard row grants.
    expect(() => assertContentTableAccess(plugin, 'recipes', 'delete')).toThrow()
  })

  it('a plugin without the wildcard is completely unchanged', () => {
    const plugin = pluginWith([{ table: 'pages', modes: ['read'] }])
    expect(() => assertContentTableAccess(plugin, 'pages', 'read')).not.toThrow()
    expect(() => assertContentTableAccess(plugin, 'recipes', 'read')).toThrow(
      /does not have contentAccess declared for table "recipes"/,
    )
  })

  it('a plugin declaring nothing reaches nothing', () => {
    const plugin = pluginWith([])
    expect(() => assertContentTableAccess(plugin, 'pages', 'read')).toThrow()
  })
})
