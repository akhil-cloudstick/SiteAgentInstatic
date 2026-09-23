/**
 * The collab roster sweep must remove a deleted page's BAKED FILE, not just its
 * row and the render cache.
 *
 * This is the path an ordinary editor delete takes: removing a page from the
 * site document drops it from the roster, and this sweep is what soft-deletes
 * the row. Bumping the publish version only clears the in-memory cache (Layer
 * B); Layer A reads the file from disk BEFORE any database query, so without the
 * prune the deleted page carries on being served at its own URL until the next
 * full publish (ISS-039).
 *
 * The bug this pins was invisible to a test that only checked the database: the
 * row really was soft-deleted and the version really was bumped. Only the file
 * on disk tells the truth, so that is what is asserted.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createSqliteClient } from '../../db/sqlite'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import type { DbClient } from '../../db/client'
import { createRelayPersistence } from '../relayPersistence'
import { updateArtefactInPlace } from '../../publish/staticArtefact'

/**
 * The migrations already create the `pages` system table (route_base ''), and
 * the sweep scans exactly `pages` / `components` / `layouts` by id — so this
 * uses the real one rather than inserting a fixture that would collide with it.
 */
const TABLE_ID = 'pages'

/** Hooks the sweep needs; none of them matter for what is asserted here. */
const inertHooks = {
  isResident: () => false,
  schedulePersist: () => {},
  openDoc: async () => {},
  invalidationVersion: () => 0,
}

async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  return db
}

async function seedPublishedPage(db: DbClient, id: string, slug: string): Promise<void> {
  await db`
    insert into data_rows (id, table_id, cells_json, slug, status)
    values (${id}, ${TABLE_ID}, ${{ title: slug }}, ${slug}, ${'published'})
  `
}

/**
 * Is the page baked anywhere under the uploads root?
 *
 * Scanned rather than computed from the slot layout, so the test does not
 * depend on internals of the artefact writer — and so it catches the file under
 * EITHER url shape (`about.html` or `about/index.html`), which is what the
 * retraction is required to clear.
 */
async function isBaked(uploadsDir: string, slug: string): Promise<boolean> {
  const wanted = new Set([`${slug}.html`, path.join(slug, 'index.html')])
  const walk = async (dir: string): Promise<boolean> => {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (await walk(full)) return true
        continue
      }
      for (const name of wanted) if (full.endsWith(path.sep + name) || full.endsWith(name)) return true
    }
    return false
  }
  return walk(uploadsDir)
}

describe('collab roster sweep — baked-file retraction', () => {
  let db: DbClient
  let uploadsDir: string

  beforeEach(async () => {
    db = await freshDb()
    uploadsDir = await mkdtemp(path.join(tmpdir(), 'roster-sweep-'))
    await mkdir(uploadsDir, { recursive: true })
  })

  afterEach(async () => {
    if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true })
  })

  it('removes the baked file of a published page dropped from the roster', async () => {
    await seedPublishedPage(db, 'page-about', 'about')
    await updateArtefactInPlace(uploadsDir, '/about', '<html>about</html>')

    expect(await isBaked(uploadsDir, 'about')).toBe(true)

    const persistence = createRelayPersistence(db, inertHooks, { uploadsDir })
    // An empty roster: the page is gone from the site document.
    await persistence.sweepRosterDeletions({ pages: [], components: [], layouts: [] }, 0)

    expect(await isBaked(uploadsDir, 'about')).toBe(false)

    const { rows } = await db<{ deleted_at: string | null }>`
      select deleted_at from data_rows where id = ${'page-about'}
    `
    expect(rows[0]?.deleted_at).not.toBeNull()
  })

  it('leaves the baked file of a page still in the roster alone', async () => {
    await seedPublishedPage(db, 'page-home', 'home')
    await updateArtefactInPlace(uploadsDir, '/home', '<html>home</html>')

    const persistence = createRelayPersistence(db, inertHooks, { uploadsDir })
    await persistence.sweepRosterDeletions({ pages: ['page-home'], components: [], layouts: [] }, 0)

    expect(await isBaked(uploadsDir, 'home')).toBe(true)
  })

  it('still sweeps when no uploads dir is configured, it just cannot prune', async () => {
    await seedPublishedPage(db, 'page-orphan', 'orphan')
    await updateArtefactInPlace(uploadsDir, '/orphan', '<html>orphan</html>')

    // No uploadsDir — the row must still be soft-deleted rather than throwing.
    const persistence = createRelayPersistence(db, inertHooks)
    await persistence.sweepRosterDeletions({ pages: [], components: [], layouts: [] }, 0)

    const { rows } = await db<{ deleted_at: string | null }>`
      select deleted_at from data_rows where id = ${'page-orphan'}
    `
    expect(rows[0]?.deleted_at).not.toBeNull()
  })
})
