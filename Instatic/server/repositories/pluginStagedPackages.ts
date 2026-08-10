/**
 * Staged plugin packages repository — CRUD over `plugin_staged_packages`.
 *
 * A staged package is one that has been uploaded and successfully inspected —
 * unzipped, manifest parsed, sandbox-scanned — but NOT approved. Nothing about
 * it is active: no code runs, no permission is granted, no plugin row changes.
 * It is the "an update is waiting" state the recovery screen reports and the
 * review screen re-opens.
 *
 * Owns:
 *   - All SQL touching `plugin_staged_packages`.
 *   - The one-staged-package-per-plugin invariant (plugin_id is the PK, so a
 *     second upload for the same plugin replaces the first rather than
 *     accumulating).
 *
 * Does NOT own:
 *   - The package bytes on disk (`server/plugins/stagedStorage.ts`).
 *   - HTTP semantics or capability checks (the handler).
 *   - Anything about installed plugins (`plugins.ts`).
 *
 * There is deliberately NO foreign key to `installed_plugins`: a package staged
 * for a FRESH install has no plugin row to point at. Uninstall sweeps the row
 * explicitly instead of relying on a cascade.
 */

import type { DbClient } from '../db/client'
import { parsePluginManifest } from '@core/plugins/manifest'
import type { PluginManifest } from '@core/plugin-sdk'

export interface StagedPackage {
  pluginId: string
  fileName: string
  fileSize: number
  storagePath: string
  manifest: PluginManifest
  /** Version of the currently-installed plugin when this was staged, if any. */
  fromVersion: string | null
  uploadedBy: string | null
  uploadedAt: string
}

interface StagedPackageRow {
  plugin_id: string
  file_name: string
  file_size: number
  storage_path: string
  // The SQLite adapter auto-parses `*_json` columns on read; Postgres returns
  // jsonb already decoded. Either way this is an object, not a string.
  manifest_json: unknown
  from_version: string | null
  uploaded_by: string | null
  uploaded_at: string | Date
}

/**
 * Rows are validated on the way OUT, not trusted. A manifest that no longer
 * parses — because the schema tightened since it was staged — must not crash
 * the plugins list; the row is dropped and swept instead.
 */
function toStagedPackage(row: StagedPackageRow, context: string): StagedPackage | null {
  try {
    return {
      pluginId: row.plugin_id,
      fileName: row.file_name,
      fileSize: Number(row.file_size),
      storagePath: row.storage_path,
      manifest: parsePluginManifest(row.manifest_json),
      fromVersion: row.from_version,
      uploadedBy: row.uploaded_by,
      uploadedAt:
        row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at),
    }
  } catch (err) {
    console.error(`[plugin:${row.plugin_id}] staged package ${context} has an unreadable manifest:`, err)
    return null
  }
}

export async function listStagedPackages(db: DbClient): Promise<StagedPackage[]> {
  const { rows } = await db<StagedPackageRow>`
    select plugin_id, file_name, file_size, storage_path, manifest_json,
           from_version, uploaded_by, uploaded_at
    from plugin_staged_packages
    order by uploaded_at desc
  `
  return rows
    .map((row) => toStagedPackage(row, 'in list'))
    .filter((staged): staged is StagedPackage => staged !== null)
}

export async function getStagedPackage(
  db: DbClient,
  pluginId: string,
): Promise<StagedPackage | null> {
  const { rows } = await db<StagedPackageRow>`
    select plugin_id, file_name, file_size, storage_path, manifest_json,
           from_version, uploaded_by, uploaded_at
    from plugin_staged_packages
    where plugin_id = ${pluginId}
  `
  const row = rows[0]
  if (!row) return null
  return toStagedPackage(row, pluginId)
}

export interface StagedPackageInput {
  pluginId: string
  fileName: string
  fileSize: number
  storagePath: string
  manifest: PluginManifest
  fromVersion: string | null
  uploadedBy: string | null
}

/**
 * Insert or replace the staged package for a plugin. Re-uploading supersedes
 * whatever was waiting — the operator's most recent upload is the one they
 * mean, and keeping a queue of superseded packages would only invite approving
 * the wrong one.
 */
export async function upsertStagedPackage(
  db: DbClient,
  input: StagedPackageInput,
): Promise<void> {
  const manifestJson = JSON.stringify(input.manifest)
  await db`
    insert into plugin_staged_packages
      (plugin_id, file_name, file_size, storage_path, manifest_json, from_version, uploaded_by)
    values
      (${input.pluginId}, ${input.fileName}, ${input.fileSize}, ${input.storagePath},
       ${manifestJson}, ${input.fromVersion}, ${input.uploadedBy})
    on conflict (plugin_id) do update set
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      storage_path = excluded.storage_path,
      manifest_json = excluded.manifest_json,
      from_version = excluded.from_version,
      uploaded_by = excluded.uploaded_by
  `
}

export async function deleteStagedPackage(db: DbClient, pluginId: string): Promise<void> {
  await db`
    delete from plugin_staged_packages
    where plugin_id = ${pluginId}
  `
}
