import { describe, expect, it, beforeEach } from 'bun:test'
import { createSqliteClient } from '../../db/sqlite'
import { sqliteMigrations } from '../../db/migrations-sqlite'
import { runMigrations } from '../../db/runMigrations'
import type { DbClient } from '../../db/client'
import {
  createMediaAsset,
  findLiveMediaAssetByContentHash,
  softDeleteMediaAsset,
} from '../media'

// In-memory SQLite (not a temp file) — avoids the Windows open-handle rm race.
async function freshDb(): Promise<DbClient> {
  const db = createSqliteClient(':memory:')
  await runMigrations(db, sqliteMigrations)
  return db
}

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

async function seed(db: DbClient, id: string, contentHash: string | null): Promise<void> {
  await createMediaAsset(db, {
    id,
    filename: `${id}.svg`,
    mimeType: 'image/svg+xml',
    sizeBytes: 100,
    storagePath: `${id}.svg`,
    publicPath: `/uploads/${id}.svg`,
    uploadedByUserId: null,
    storageAdapterId: '',
    externallyHosted: false,
    contentHash,
  })
}

/**
 * Locks the content-addressed dedup used by Share-to-CMS: a re-push must reuse a
 * live byte-identical asset instead of cloning it (the "111 duplicate media"
 * bug). content_hash is a write-only internal column (never hydrated); dedup is
 * a WHERE-clause match, live-only, oldest-first.
 */
describe('findLiveMediaAssetByContentHash', () => {
  let db: DbClient
  beforeEach(async () => {
    db = await freshDb()
  })

  it('migration 020 adds the content_hash column', async () => {
    const { rows } = await db.unsafe<{ name: string }>(`select name from pragma_table_info('media_assets')`)
    expect(rows.some((r) => r.name === 'content_hash')).toBe(true)
  })

  it('returns the asset whose stored bytes hash to the given value', async () => {
    await seed(db, 'a1', HASH_A)
    const found = await findLiveMediaAssetByContentHash(db, HASH_A)
    expect(found?.id).toBe('a1')
  })

  it('returns null for an unknown hash and for an empty hash', async () => {
    await seed(db, 'a1', HASH_A)
    expect(await findLiveMediaAssetByContentHash(db, HASH_B)).toBeNull()
    expect(await findLiveMediaAssetByContentHash(db, '')).toBeNull()
  })

  it('never matches a NULL-hash row (older / bundle-imported / avatar assets)', async () => {
    await seed(db, 'legacy', null)
    expect(await findLiveMediaAssetByContentHash(db, HASH_A)).toBeNull()
  })

  it('returns the OLDEST live row when several share a hash (canonical original)', async () => {
    await seed(db, 'first', HASH_A)
    await new Promise((r) => setTimeout(r, 5)) // distinct created_at
    await seed(db, 'second', HASH_A)
    const found = await findLiveMediaAssetByContentHash(db, HASH_A)
    expect(found?.id).toBe('first')
  })

  it('excludes soft-deleted rows — a re-push resurrects into a fresh upload, not the trash', async () => {
    await seed(db, 'first', HASH_A)
    await new Promise((r) => setTimeout(r, 5))
    await seed(db, 'second', HASH_A)

    await softDeleteMediaAsset(db, 'first')
    expect((await findLiveMediaAssetByContentHash(db, HASH_A))?.id).toBe('second')

    await softDeleteMediaAsset(db, 'second')
    expect(await findLiveMediaAssetByContentHash(db, HASH_A)).toBeNull()
  })
})
