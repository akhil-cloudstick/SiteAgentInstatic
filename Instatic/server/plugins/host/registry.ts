/**
 * Plugin host registry — the shared mutable state for loaded plugins.
 *
 * `hostPlugins` is the source of truth for what the main process knows about
 * each active plugin: routes, hook registrations, loop sources, media
 * adapters, and in-flight fetches. All dispatch paths read from here.
 *
 * `dbForApi` is injected by the server startup sequence once the database
 * client is ready, so api-call dispatch can reach repositories without
 * importing the db client at module load time.
 */

import type { DbClient } from '../../db/client'
import type { PluginManifest, PluginPermission } from '@core/plugin-sdk'
import type { ContentAccessMode } from '@core/plugin-sdk/contentSchemas'
import type { HostPluginRecord } from './types'

export const hostPlugins = new Map<string, HostPluginRecord>()

function hasGrantedPermission(
  manifest: PluginManifest,
  permission: PluginPermission,
): boolean {
  return new Set(manifest.grantedPermissions ?? []).has(permission)
}

export function assertHostPluginPermission(
  entry: HostPluginRecord,
  permission: PluginPermission,
): void {
  if (!hasGrantedPermission(entry.manifest, permission)) {
    throw new Error(`Plugin "${entry.manifest.id}" requires permission "${permission}"`)
  }
}

/**
 * Authoritative check for `api.cms.content.*` table access. Each handler
 * runs this BEFORE any repository call so a plugin that holds the
 * permission but didn't list the table (or list the right mode) in its
 * manifest's `contentAccess[]` fails closed.
 */
/**
 * The table slug that means "every content table".
 *
 * `contentAccess` is a fixed list of table names, which works for a plugin that
 * knows the tables it needs — and does not work at all for one whose job is to
 * expose whatever tables the operator has created. A custom post type called
 * "recipes" cannot be in a manifest written before it existed, so it was
 * invisible: `cms_list_tables` simply did not return it, and an agent asking
 * "what content is here" was told a subset and had no way to know.
 *
 * A wildcard is declared, never implied. A plugin gets this only by writing
 * `{ "table": "*" }` in its own manifest, and the modes on that row still apply
 * — so "*" with `["read"]` grants reading every table and writing none.
 *
 * It is also not the last word on what an agent can reach. The MCP gateway
 * narrows per key on top of this (see mcp/permissions.mjs `tableAllowed`), so a
 * key scoped to two tables still sees two tables through a plugin holding "*".
 */
export const CONTENT_ACCESS_ALL = '*'

export function assertContentTableAccess(
  entry: HostPluginRecord,
  tableSlug: string,
  mode: ContentAccessMode,
): void {
  const access = entry.manifest.contentAccess ?? []
  const found =
    access.find((row) => row.table === tableSlug) ??
    access.find((row) => row.table === CONTENT_ACCESS_ALL)
  if (!found) {
    throw new Error(
      `Plugin "${entry.manifest.id}" does not have contentAccess declared for table "${tableSlug}"`,
    )
  }
  if (!found.modes.includes(mode)) {
    throw new Error(
      `Plugin "${entry.manifest.id}" has contentAccess for table "${tableSlug}" but not for mode "${mode}"`,
    )
  }
}

let dbForApi: DbClient | null = null

export function setPluginWorkerDbClient(db: DbClient): void {
  dbForApi = db
}

export function getDbForApi(): DbClient | null {
  return dbForApi
}

/**
 * Uploads root for api-call handlers, set at plugin activation.
 *
 * Module-level for the same reason `dbForApi` is: `dispatchApiCall` calls every
 * handler with the fixed `(msg, entry, db)` signature, so a handler that needs
 * the uploads root has no parameter to receive it through. Both values are set
 * together in `activateInstalledServerPlugins`.
 *
 * Null when plugins were never activated (the activation helper returns early
 * without an uploads dir), so callers treat the prune as best-effort.
 */
let uploadsDirForApi: string | null = null

export function setPluginWorkerUploadsDir(uploadsDir: string): void {
  uploadsDirForApi = uploadsDir
}

export function getUploadsDirForApi(): string | null {
  return uploadsDirForApi
}
