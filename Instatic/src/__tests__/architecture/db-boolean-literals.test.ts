/**
 * Architecture Source-Scan — Boolean Columns Are Never Compared To 0 / 1
 *
 * A column declared `boolean` in `migrations-pg.ts` is declared `integer` in
 * `migrations-sqlite.ts`, because SQLite has no boolean type. A SQL literal
 * therefore cannot be correct for both dialects: `system = 0` is valid SQLite
 * and a hard error on Postgres — `operator does not exist: boolean = integer`
 * (SQLSTATE 42883).
 *
 * This is not hypothetical. The replace-import path shipped:
 *
 *     delete from data_tables where system = 0 or system = false
 *
 * which reads as though it covers both dialects and does the opposite: Postgres
 * rejects the whole statement on the FIRST comparison, so the `or system =
 * false` never runs. Clean-site import was broken on Postgres from the day it
 * was written, and no test could catch it — every test in this repo runs
 * SQLite, while every real installation runs Postgres.
 *
 * That asymmetry is why this gate scans source instead of exercising behaviour.
 * A behavioural test would need a live Postgres and would still only cover the
 * queries it happened to run.
 *
 * The fix in every case is to BIND the value and let each driver render its own
 * truth — SQLite binds 0, Postgres binds false:
 *
 *     delete from data_tables where system = ${false}
 *
 * @see server/db/migrations-pg.ts     — where boolean columns are declared
 * @see server/db/migrations-sqlite.ts — the same columns as integer
 * @see server/db/sqlite.ts            — toBindable(): boolean → 1 / 0
 */

import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { extname, join, relative } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '../../../')
const SERVER_DIR = join(PROJECT_ROOT, 'server')
const PG_MIGRATIONS = join(SERVER_DIR, 'db/migrations-pg.ts')

/**
 * Migrations are exempt: they are the DDL that CREATES each dialect's own
 * column type, so dialect-specific literals are their entire purpose.
 */
const ALLOWLISTED = new Set([
  PG_MIGRATIONS,
  join(SERVER_DIR, 'db/migrations-sqlite.ts'),
])

const COMMENT_RE = /\/\/.*$|\/\*[\s\S]*?\*\//gm

/** Strip comments, preserving line numbers so violations still point at the right line. */
function stripComments(src: string): string {
  return src.replace(COMMENT_RE, (m) => m.replace(/[^\n]/g, ' '))
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (extname(entry) === '.ts') out.push(full)
  }
  return out
}

/** Every column declared `boolean` by the Postgres migrations. */
function postgresBooleanColumns(): string[] {
  const src = readFileSync(PG_MIGRATIONS, 'utf8')
  const found = new Set<string>()
  for (const match of src.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+boolean\b/gim)) {
    found.add(match[1]!)
  }
  return [...found].sort()
}

describe('Architecture: boolean columns are never compared to numeric literals', () => {
  test('the Postgres migrations yield a non-trivial set of boolean columns', () => {
    const columns = postgresBooleanColumns()

    // Guards the guard. If the migration format changes and this parses
    // nothing, the scan below would pass vacuously and protect nothing —
    // exactly the failure mode that let the Postgres-ism gate silently
    // inspect zero files (F-0007).
    expect(columns.length).toBeGreaterThan(3)
    expect(columns).toContain('system')
  })

  test('no server file compares a boolean column to 0 or 1', () => {
    const columns = postgresBooleanColumns()
    // `col = 0`, `col <> 1`, `col != 0`. Bound parameters (`= ${false}`) and
    // column-to-column comparisons (`is_system = excluded.is_system`) do not
    // match, and are the correct forms.
    const forbidden = new RegExp(
      String.raw`\b(${columns.join('|')})\s*(?:=|<>|!=)\s*[01]\b`,
      'i',
    )

    const violations: string[] = []
    for (const file of walk(SERVER_DIR)) {
      if (ALLOWLISTED.has(file)) continue
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        if (!forbidden.test(line)) return
        violations.push(`${relative(PROJECT_ROOT, file)}:${i + 1}  ${line.trim()}`)
      })
    }

    expect(violations).toEqual([])
  }, 60_000) // walks the whole server tree; the repo lives on a network share
})
