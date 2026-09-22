/**
 * A replace no longer destroys published history (R15, AC-D15.1).
 *
 * The requirement is one sentence — "after a replace, the prior published state
 * is recoverable" — and two things stood in its way. The replace path took no
 * backup at all, and the only backup anywhere in the repository (written by the
 * clear-all script) had no reader AND omitted `data_row_versions` and
 * `site_snapshots`: exactly the published half.
 *
 * So the test that matters is not "a backup file appears". It is: publish
 * something, destroy it, put it back, and find the PUBLISHED versions there —
 * not merely the draft rows, which is all the old backup ever held.
 */

import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteClient } from '../../../server/db/sqlite'
import { runMigrations } from '../../../server/db/runMigrations'
import { sqliteMigrations } from '../../../server/db/migrations-sqlite'
import {
  BACKUP_FORMAT,
  captureSiteBackup,
  checkBackup,
  listBackups,
  readBackup,
  restoreSiteBackup,
  writeBackup,
} from '../../../server/publish/siteBackup'
import type { DbClient } from '../../../server/db/client'

/** A site with one page that has been PUBLISHED — a row, a version, a snapshot. */
async function seedPublishedSite(db: DbClient): Promise<void> {
  await db`insert into data_rows (id, table_id, cells_json, slug, status)
           values ('p1', 'pages', ${JSON.stringify({ title: 'Home' })}, 'index', 'published')`
  await db`insert into site_snapshots (id, site_json, content_hash)
           values ('snap1', ${JSON.stringify({ name: 'live' })}, 'hash-1')`
  await db`insert into data_row_versions (id, row_id, version_number, cells_json, slug, site_snapshot_id)
           values ('v1', 'p1', 1, ${JSON.stringify({ title: 'Home' })}, 'index', 'snap1')`
  await db`update data_rows set active_version_id = 'v1' where id = 'p1'`
}

async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  return db
}

describe('capturing a site', () => {
  test('holds the published half, which the old backup did not', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)

    const backup = await captureSiteBackup(db, 'replace-import')

    // The two the clear-all's backup omitted, and the reason this exists.
    expect(backup.counts.data_row_versions).toBe(1)
    expect(backup.counts.site_snapshots).toBe(1)
    expect(backup.counts.data_rows).toBe(1)
    // Custom table definitions go too: a replace deletes every non-system table.
    expect(backup.counts.data_tables).toBeGreaterThan(0)
    expect(backup.format).toBe(BACKUP_FORMAT)
    db.close?.()
  })

  test('a captured row keeps the pointer that makes it published', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const backup = await captureSiteBackup(db, 'manual')
    const row = (backup.payload.data_rows as Record<string, unknown>[])[0]!
    // Without this a restored page is present but not published — the exact
    // difference between the site being back and merely looking back.
    expect(row.active_version_id).toBe('v1')
    db.close?.()
  })
})

describe('restoring', () => {
  test('puts the published state back after everything is destroyed (AC-D15.1)', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const backup = await captureSiteBackup(db, 'replace-import')

    // Exactly what the replace path does.
    await db`delete from data_rows`
    await db`delete from site_snapshots`
    expect((await db`select * from data_row_versions`).rows.length).toBe(0)

    await restoreSiteBackup(db, backup)

    const rows = (await db`select * from data_rows`).rows
    const versions = (await db`select * from data_row_versions`).rows
    const snaps = (await db`select * from site_snapshots`).rows
    expect(rows.length).toBe(1)
    expect(versions.length).toBe(1)
    expect(snaps.length).toBe(1)
    // The page is PUBLISHED again, not just present.
    expect((rows[0] as Record<string, unknown>).active_version_id).toBe('v1')
    expect((versions[0] as Record<string, unknown>).site_snapshot_id).toBe('snap1')
    db.close?.()
  })

  test('is one transaction — a failure leaves the site as it was, not half-restored', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const good = await captureSiteBackup(db, 'manual')

    // A version naming a row that is not in the backup cannot satisfy its
    // foreign key. The restore must fail whole rather than landing the rows it
    // managed before the bad one.
    const broken = structuredClone(good)
    ;(broken.payload.data_row_versions as Record<string, unknown>[]).push({
      id: 'v-orphan', row_id: 'nobody', version_number: 9, cells_json: '{}', slug: 'x',
    })

    await expect(restoreSiteBackup(db, broken)).rejects.toThrow()
    // The site still has its original published page — nothing was left behind.
    const rows = (await db`select * from data_rows`).rows
    expect(rows.length).toBe(1)
    expect((rows[0] as Record<string, unknown>).active_version_id).toBe('v1')
    db.close?.()
  })
})

describe('what a restore refuses', () => {
  test('a backup from before the published half was captured', async () => {
    // Every backup the clear-all script ever wrote looks like this: real data,
    // no format marker, and no published state. Restoring one would silently
    // produce a site with its history missing, which is worse than refusing.
    const old = { slug: 'acme', site: null, data_rows: [], media_assets: [], media_folders: [] }
    const checked = checkBackup(old)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.reason).toContain('cannot restore published state')
  })

  test('a backup that has been altered since it was written', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const backup = await captureSiteBackup(db, 'manual')
    ;(backup.payload.data_rows as Record<string, unknown>[])[0]!.slug = 'tampered'

    const checked = checkBackup(backup)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.reason).toContain('checksum')
    db.close?.()
  })

  test('anything that is not a backup at all', () => {
    for (const junk of [null, 42, 'a string', {}, { format: BACKUP_FORMAT }]) {
      expect(checkBackup(junk).ok).toBe(false)
    }
  })
})

describe('on disk', () => {
  test('a written backup reads back, and a path cannot escape the directory', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const dir = await mkdtemp(join(tmpdir(), 'backup-'))
    try {
      await writeBackup(dir, await captureSiteBackup(db, 'replace-import'))
      const names = await listBackups(dir)
      expect(names.length).toBe(1)

      const read = await readBackup(dir, names[0]!)
      expect(read.ok).toBe(true)
      if (read.ok) expect(read.backup.counts.data_row_versions).toBe(1)

      // A restore target is a NAME from a listing, never a path: `..` here would
      // read an arbitrary file and write it into the database.
      for (const escape of ['../../etc/passwd', '..\\secrets.json', '/abs/path.json']) {
        expect((await readBackup(dir, escape)).ok).toBe(false)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
      db.close?.()
    }
  })

  test('only the last few are kept, so backups cannot fill a disk', async () => {
    const db = await freshDb()
    await seedPublishedSite(db)
    const dir = await mkdtemp(join(tmpdir(), 'backup-'))
    try {
      for (let i = 0; i < 6; i++) {
        const backup = await captureSiteBackup(db, 'manual')
        // Distinct timestamps; the filename is what orders them.
        backup.takenAt = new Date(Date.UTC(2026, 0, i + 1)).toISOString()
        await writeBackup(dir, backup)
      }
      const names = await listBackups(dir)
      expect(names.length).toBe(3)
      // Newest kept, oldest pruned.
      expect(names[0]).toContain('2026-01-06')
      expect(names.join()).not.toContain('2026-01-01')
    } finally {
      await rm(dir, { recursive: true, force: true })
      db.close?.()
    }
  })
})
