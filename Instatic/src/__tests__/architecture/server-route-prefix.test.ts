/**
 * Architecture Gate — server route matchers use the current API prefix.
 *
 * The admin API was renamed from `/cms/api/...` to `/cms/api/...`. Most
 * routes were updated, but several matchers were left spelled out at the old
 * prefix and silently stopped matching — they are regex literals with escaped
 * slashes (`/^\/admin\/api\/cms\/...`), so a plain search for "admin/api/cms"
 * walks straight past them and only finds the doc comments.
 *
 * The damage was invisible from the outside: in `data/tables.ts` the bare
 * `/data/tables` route used `CMS_API_PREFIX` (so listing collections worked)
 * while `/tables/:id/rows` was hardcoded (so listing and CREATING entries
 * 404'd). Plugin management, the plugin runtime and the per-user admin route
 * were dead the same way.
 *
 * This gate fails on any live route matcher still carrying an old prefix.
 * Documentation comments are exempt — they are prose, not routing.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { extname, join, relative } from 'path'

const SERVER_ROOT = join(import.meta.dir, '../../../server')

/**
 * Old prefixes, in both the spellings a matcher can carry: a regex literal
 * with escaped slashes, and a plain string used in `===` / `startsWith`.
 */
const STALE_PREFIX_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: String.raw`\/admin\/api (escaped regex literal)`, re: /\\\/admin\\\/api/g },
  { label: '/admin/api (plain string)', re: /['"`]\/admin\/api/g },
]

function collectServerSources(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectServerSources(full))
      continue
    }
    if (extname(entry) === '.ts') results.push(full)
  }
  return results
}

/** Strip block and line comments so prose about old URLs doesn't trip the gate. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

describe('server route prefix', () => {
  it('has no route matcher left on a pre-rename API prefix', () => {
    const offenders: string[] = []

    for (const filePath of collectServerSources(SERVER_ROOT)) {
      // The gate's own fixtures would match themselves.
      if (filePath.includes('__tests__') || filePath.endsWith('.test.ts')) continue
      const source = stripComments(readFileSync(filePath, 'utf8'))
      for (const { label, re } of STALE_PREFIX_PATTERNS) {
        for (const match of source.matchAll(re)) {
          offenders.push(
            `  ${relative(SERVER_ROOT, filePath)}:${lineNumber(source, match.index ?? 0)} -> ${label}`,
          )
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        'Route matchers found on a pre-rename API prefix.\n' +
          'The admin calls `/cms/api/...` (see CMS_API_PREFIX in server/handlers/cms/shared.ts).\n' +
          'Build the pattern from that constant instead of spelling the prefix out.\n\n' +
          'Violations:\n' +
          offenders.join('\n'),
      )
    }

    expect(offenders).toEqual([])
    // Walking the whole server tree exceeds bun's 5s default on a network-share
    // checkout, the same way the CSS-policy gates do.
  }, 60_000)

  it('routes the Content workspace entry-list and entry-create URLs', async () => {
    // Regression lock for the exact request that 404'd: creating a post.
    const { CMS_API_PREFIX } = await import('../../../server/handlers/cms/shared')
    const tablesSource = readFileSync(
      join(SERVER_ROOT, 'handlers/cms/data/tables.ts'),
      'utf8',
    )

    // Rebuild the matchers the handler uses, from the same constant.
    const base = `${CMS_API_PREFIX}/data/tables`.replace(/\//g, '\\/')
    const rowsPattern = new RegExp(`^${base}\\/([^/]+)\\/rows$`)
    const itemPattern = new RegExp(`^${base}\\/([^/]+)$`)

    expect(rowsPattern.test(`${CMS_API_PREFIX}/data/tables/posts/rows`)).toBe(true)
    expect(itemPattern.test(`${CMS_API_PREFIX}/data/tables/posts`)).toBe(true)
    // Ordering safety: the bare item pattern must not swallow the sub-route.
    expect(itemPattern.test(`${CMS_API_PREFIX}/data/tables/posts/rows`)).toBe(false)

    // And the handler must derive them rather than hardcode a prefix.
    expect(tablesSource).toContain('CMS_API_PREFIX}/data/tables')
  })
})
