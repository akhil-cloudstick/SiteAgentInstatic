/**
 * Where exported bundles live, and the one safe way to address one.
 *
 * Shared because two surfaces now resolve an `exportId`: the tool that returns
 * parts inline, and the HTTP route that serves the whole archive. Two copies of
 * a path-safety check is one copy that eventually drifts, and the thing being
 * guarded is "read an arbitrary file off this host".
 */

import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where exported bundles land. Configurable so it can point at shared storage. */
export const EXPORT_DIR_ENV = 'MMS_CONNECTOR_EXPORT_DIR'

/**
 * URL prefix an archive is fetchable under.
 *
 * Lives here rather than beside the route it serves because the tool that
 * hands out the URL and the server that answers it would otherwise import each
 * other. One constant, no cycle.
 */
export const EXPORT_DOWNLOAD_PREFIX = '/exports/'

export function exportDir(): string {
  const configured = process.env[EXPORT_DIR_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../exports')
}

export function ensureExportDir(): string {
  const dir = exportDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export type ExportLookup =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/**
 * Resolve an `exportId` to a file, refusing anything that escapes the directory.
 *
 * Two checks, not one. The character class alone would be enough today, but it
 * is a rule about names and the risk is about paths — so the resolved path is
 * also required to sit under the export directory. The cheap check catches the
 * obvious attempt with a clear message; the second one is what actually holds
 * if the first is ever loosened.
 */
export function resolveExport(id: string): ExportLookup {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return { ok: false, reason: 'exportId contains characters that are not allowed in a file name.' }
  }
  const dir = exportDir()
  const path = resolve(dir, id)
  if (!path.startsWith(resolve(dir))) {
    return { ok: false, reason: 'exportId resolves outside the export directory.' }
  }
  if (!existsSync(path)) {
    return { ok: false, reason: `No export named "${id}" is on disk. Start again without exportId.` }
  }
  return { ok: true, path }
}
