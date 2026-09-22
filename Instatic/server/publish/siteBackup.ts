/**
 * A site's published state, captured before something destroys it (MMSBUILD R15).
 *
 * AC-D15.1 asks that "after a replace, the prior published state is
 * recoverable". Two things stood between that and reality:
 *
 *   1. The replace path took no backup at all. It deletes every row and every
 *      custom table inside one transaction and then imports over the top.
 *   2. The one backup that did exist — written by the clear-all script — held
 *      draft rows, media and the site shell, and omitted `data_row_versions`
 *      and `site_snapshots`: precisely the PUBLISHED state this requirement is
 *      about. It also had no reader, anywhere in the repository.
 *
 * So this captures what a restore actually needs, and can read it back.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   `collab_documents` — the CRDT blobs. The clear-all deletes them precisely
 *   because they re-seed deleted pages on the next editor open; writing them
 *   back would resurrect exactly what a restore is trying to place
 *   deliberately. The relay re-derives them from the restored rows instead.
 *
 *   Media bytes. They live on disk and neither a replace nor a clear removes
 *   the files a restored row points at, so copying megabytes to guard against
 *   a deletion that does not happen would be cost without cover.
 *
 * The format carries a version and a checksum because a restore that cannot
 * tell what it is holding is more dangerous than no restore: a half-understood
 * backend written back over a live site is worse than an empty one.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { placeholder, type DbClient } from '../db/client'

/** Bump this when the payload's shape changes. A reader refuses what it does not know. */
export const BACKUP_FORMAT = 'mms-site-backup-v1'

/** Why the backup was taken. Recorded so a restore can be explained later. */
export type BackupReason = 'replace-import' | 'clear-all' | 'manual'

export interface SiteBackupPayload {
  /** `site.settings_json` — the draft shell: styles, fonts, tokens, files. */
  site: unknown
  /** Custom table definitions. A replace deletes every non-system table. */
  data_tables: unknown[]
  data_rows: unknown[]
  /** The published versions. The whole reason this module exists. */
  data_row_versions: unknown[]
  /** The published SiteDocument each version renders against. */
  site_snapshots: unknown[]
  data_row_redirects: unknown[]
}

export interface SiteBackup {
  format: string
  takenAt: string
  reason: BackupReason
  /** sha256 over the canonical JSON of `payload`. */
  checksum: string
  counts: Record<string, number>
  payload: SiteBackupPayload
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Read every table a restore needs, in one pass.
 *
 * Takes a `db` rather than opening its own, so a caller inside a transaction
 * captures a state consistent with what it is about to destroy — reading
 * outside the transaction that deletes would race the deletion it exists to
 * protect against.
 */
export async function captureSiteBackup(db: DbClient, reason: BackupReason): Promise<SiteBackup> {
  // `.rows` — the client returns { rows, rowCount }, not an array. Casting the
  // result itself to an array type compiles and is simply false, and the damage
  // shows up later as a backup that restores nothing.
  const site = (await db`select settings_json from site where id = 'default'`).rows[0]
  const data_tables = (await db`select * from data_tables`).rows
  const data_rows = (await db`select * from data_rows`).rows
  const data_row_versions = (await db`select * from data_row_versions`).rows
  const site_snapshots = (await db`select * from site_snapshots`).rows
  const data_row_redirects = (await db`select * from data_row_redirects`).rows

  const payload: SiteBackupPayload = {
    site: (site as { settings_json?: unknown } | undefined)?.settings_json ?? null,
    data_tables,
    data_rows,
    data_row_versions,
    site_snapshots,
    data_row_redirects,
  }

  return {
    format: BACKUP_FORMAT,
    takenAt: new Date().toISOString(),
    reason,
    checksum: sha256(JSON.stringify(payload)),
    counts: {
      data_tables: payload.data_tables.length,
      data_rows: payload.data_rows.length,
      data_row_versions: payload.data_row_versions.length,
      site_snapshots: payload.site_snapshots.length,
      data_row_redirects: payload.data_row_redirects.length,
    },
    payload,
  }
}

export type BackupCheck = { ok: true; backup: SiteBackup } | { ok: false; reason: string }

/**
 * Is this a backup we are willing to write back over a live site?
 *
 * Deliberately strict. Every refusal here is a site that stays as it is, which
 * is recoverable; a wrong acceptance is a site overwritten with something we
 * did not understand, which is not.
 */
export function checkBackup(value: unknown): BackupCheck {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'not a backup file' }
  const b = value as Partial<SiteBackup>
  if (b.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      reason:
        `this backup is "${String(b.format ?? 'unmarked')}", and this build restores ` +
        `"${BACKUP_FORMAT}". Backups written before the published half was captured cannot ` +
        'restore published state and are refused rather than half-applied.',
    }
  }
  if (!b.payload || typeof b.payload !== 'object') return { ok: false, reason: 'the backup carries no payload' }
  for (const key of ['data_tables', 'data_rows', 'data_row_versions', 'site_snapshots', 'data_row_redirects']) {
    if (!Array.isArray((b.payload as Record<string, unknown>)[key])) {
      return { ok: false, reason: `the backup is missing "${key}"` }
    }
  }
  const actual = sha256(JSON.stringify(b.payload))
  if (actual !== b.checksum) {
    return { ok: false, reason: 'the backup does not match its own checksum — it has been altered or truncated' }
  }
  return { ok: true, backup: b as SiteBackup }
}

/**
 * Insert one captured row back, using its OWN columns.
 *
 * Built from the row's keys rather than a hand-written column list on purpose.
 * A fixed list is a second place to remember every future migration, and the
 * failure when somebody forgets is silent — the column simply stops being
 * restored, and nobody finds out until they need the thing it held.
 */
async function insertRow(
  tx: DbClient,
  table: string,
  row: Record<string, unknown>,
  options: { upsertOn?: string } = {},
): Promise<void> {
  const columns = Object.keys(row)
  if (columns.length === 0) return
  const values = columns.map((c) => row[c])
  const placeholders = columns.map((_, i) => placeholder(tx.dialect, i + 1)).join(', ')
  const quoted = columns.map((c) => `"${c}"`).join(', ')
  const conflict = options.upsertOn
    ? ` on conflict ("${options.upsertOn}") do update set ${columns
        .filter((c) => c !== options.upsertOn)
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(', ')}`
    : ''
  await tx.unsafe(`insert into ${table} (${quoted}) values (${placeholders})${conflict}`, values)
}

export interface RestoreResult {
  restored: Record<string, number>
  takenAt: string
  reason: BackupReason
}

/**
 * Write a captured state back.
 *
 * ORDER IS NOT COSMETIC. `data_row_versions.row_id` references `data_rows` and
 * `data_row_versions.site_snapshot_id` references `site_snapshots`, so rows and
 * snapshots go back before versions do. `data_rows.active_version_id` points the
 * other way, which is why rows are inserted with it NULL and updated once the
 * versions they point at exist — a single-pass insert cannot satisfy a cycle.
 *
 * One transaction. A half-restored site is the worst of the three possible
 * outcomes, and the only one that is not recoverable by trying again.
 */
export async function restoreSiteBackup(db: DbClient, backup: SiteBackup): Promise<RestoreResult> {
  const p = backup.payload
  const restored: Record<string, number> = {}

  await db.transaction(async (tx) => {
    // Clear in dependency order. `data_rows` cascades its versions; snapshots
    // do not cascade (their FK is `on delete set null`), so they go explicitly.
    await tx`delete from data_rows`
    await tx`delete from site_snapshots`
    await tx`delete from data_tables where system = ${false}`

    // System tables survived the delete above, so a table that is still there
    // is updated rather than inserted over its own primary key.
    for (const table of p.data_tables as Record<string, unknown>[]) {
      await insertRow(tx, 'data_tables', table, { upsertOn: 'id' })
    }
    restored.data_tables = p.data_tables.length

    for (const snap of p.site_snapshots as Record<string, unknown>[]) {
      await insertRow(tx, 'site_snapshots', snap)
    }
    restored.site_snapshots = p.site_snapshots.length

    // Rows first WITHOUT their active-version pointer: the version it names
    // does not exist yet.
    for (const row of p.data_rows as Record<string, unknown>[]) {
      await insertRow(tx, 'data_rows', { ...row, active_version_id: null })
    }
    restored.data_rows = p.data_rows.length

    for (const version of p.data_row_versions as Record<string, unknown>[]) {
      await insertRow(tx, 'data_row_versions', version)
    }
    restored.data_row_versions = p.data_row_versions.length

    // Now the pointer can be satisfied. This is what makes a page PUBLISHED
    // again rather than merely present.
    for (const row of p.data_rows as Record<string, unknown>[]) {
      const activeVersionId = (row as { active_version_id?: unknown }).active_version_id ?? null
      if (!activeVersionId) continue
      await tx`update data_rows set active_version_id = ${activeVersionId as string} where id = ${row.id as string}`
    }

    for (const redirect of p.data_row_redirects as Record<string, unknown>[]) {
      await insertRow(tx, 'data_row_redirects', redirect)
    }
    restored.data_row_redirects = p.data_row_redirects.length

    if (p.site !== null && p.site !== undefined) {
      await tx`update site set settings_json = ${p.site as never} where id = 'default'`
    }
  })

  return { restored, takenAt: backup.takenAt, reason: backup.reason }
}

// --- on disk -----------------------------------------------------------------

/** Where a site's backups live, beside its uploads rather than in another package's tree. */
export const backupDir = (uploadsDir: string): string => join(uploadsDir, 'backups')

/**
 * How many to keep.
 *
 * Three, matching what R9 already chose for known-good deploy bundles. A second
 * retention number would be a second policy to reason about, and these guard
 * the same class of accident.
 */
export const KEEP_BACKUPS = 3

export async function writeBackup(uploadsDir: string, backup: SiteBackup): Promise<string> {
  const dir = backupDir(uploadsDir)
  await mkdir(dir, { recursive: true })
  const stamp = backup.takenAt.replace(/[:.]/g, '-')
  const path = join(dir, `${stamp}-${backup.reason}.json`)
  await writeFile(path, JSON.stringify(backup), 'utf8')
  await pruneBackups(dir)
  return path
}

/** Newest first. Named by timestamp, so lexical order is chronological order. */
export async function listBackups(uploadsDir: string): Promise<string[]> {
  try {
    const names = await readdir(backupDir(uploadsDir))
    return names.filter((n) => n.endsWith('.json')).sort().reverse()
  } catch {
    return []
  }
}

async function pruneBackups(dir: string): Promise<void> {
  try {
    const { rm } = await import('node:fs/promises')
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
    for (const old of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) {
      await rm(join(dir, old), { force: true })
    }
  } catch {
    // Pruning is housekeeping. Failing it must never fail the backup that just
    // succeeded, nor the import that is waiting on it.
  }
}

export async function readBackup(uploadsDir: string, name: string): Promise<BackupCheck> {
  // A name from a listing, never a path from a caller: `..` in a restore target
  // would read an arbitrary file and write it into the database.
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) return { ok: false, reason: 'not a backup name' }
  try {
    return checkBackup(JSON.parse(await readFile(join(backupDir(uploadsDir), name), 'utf8')))
  } catch (err) {
    return { ok: false, reason: `could not read ${name}: ${err instanceof Error ? err.message : String(err)}` }
  }
}
