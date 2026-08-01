/**
 * "Changes in this version" reader — the per-version change manifest.
 *
 * Instatic has no revision-manifest table, and the approved MMSBUILD
 * screen's change list must not be fabricated. It doesn't have to be:
 * `audit_events` already records every operational change with an actor,
 * a target and a timestamp, and `action = 'publish'` marks each release
 * boundary. Everything recorded AFTER the most recent publish is, by
 * definition, in the draft but not yet live — which is exactly what the
 * card means by "this version".
 *
 * So this reader:
 *   1. finds the most recent `publish` event (the version boundary),
 *   2. counts + reads the operational events after it,
 *   3. projects each into the reference's row shape (icon well, title,
 *      location, Added/Updated/Removed chip, timestamp).
 *
 * Sign-in and AI-assistant chatter is filtered out for the same reason
 * the Activity feed drops it: neither changes the site.
 *
 * Data-row events resolve `tableId + slug → /route_base/slug` so a row
 * reads "Updated /blog/launching-instatic", batched against `data_tables`
 * to avoid an N+1 — same approach as `activity.ts`.
 */
import type { DbClient } from '../../../db/client'
import type { AuditAction } from '../../../repositories/audit'
import { isoDateOrNull } from '@core/utils/isoDate'
import { buildRowPath } from './shared'
import type { ChangeManifestEntry, ChangeManifestStats } from './types'

/** Rows the widget can show before it starts scrolling. */
const WIDGET_LIMIT = 12

/**
 * Ceiling on the post-publish scan. `total` is counted from this window,
 * so a release with more than 60 recorded changes reports 60 — the count
 * badge saturates rather than lying upward. That is the right trade for a
 * dashboard glance: `audit_events` is indexed on `created_at desc`, and
 * an unbounded scan on a busy install would cost far more than the badge
 * is worth.
 */
const FETCH_LIMIT = 60

type ChangeRow = {
  id: string
  action: AuditAction
  target_type: string | null
  target_id: string | null
  metadata_json: unknown
  created_at: string | Date
}

export async function readChangeManifest(db: DbClient): Promise<ChangeManifestStats> {
  const since = await readLastPublishAt(db)

  // `where created_at > ?` needs a value in both branches; when the site
  // has never been published every recorded change belongs to version 1,
  // so we fall back to the epoch rather than branching the query (which
  // would mean two near-identical tagged templates).
  const boundary = since ?? '1970-01-01T00:00:00.000Z'

  const { rows } = await db<ChangeRow>`
    select id, action, target_type, target_id, metadata_json, created_at
    from audit_events
    where created_at > ${boundary}
    order by created_at desc
    limit ${FETCH_LIMIT}
  `

  // Noise filtering happens in JS for the same reason as `activity.ts`:
  // `action not in (...)` is dialect-painful (Postgres wants
  // `ANY($n::text[])`, SQLite wants an inline expansion the tagged-
  // template binding can't produce). The set is small and bounded.
  const changes = rows.filter((r) => isChange(r.action))
  const visible = changes.slice(0, WIDGET_LIMIT)
  const routeBaseById = await loadRouteBases(db, visible)

  return {
    rows: visible.map((r) => projectChangeRow(r, routeBaseById)),
    total: changes.length,
    since,
  }
}

/**
 * Timestamp of the most recent `publish` audit event — the boundary
 * between "already live" and "in this version". `null` when the site has
 * never been published.
 */
async function readLastPublishAt(db: DbClient): Promise<string | null> {
  const { rows } = await db<{ created_at: string | Date }>`
    select created_at
    from audit_events
    where action = 'publish'
    order by created_at desc
    limit 1
  `
  const raw = rows[0]?.created_at
  return raw === undefined ? null : isoDateOrNull(raw)
}

/**
 * Is this action a change to the SITE (as opposed to session or
 * assistant noise)? Mirrors `isDashboardActivityNoise` in `activity.ts`,
 * and additionally drops `publish` itself — the publish event is the
 * boundary, not a change within the version.
 */
function isChange(action: AuditAction): boolean {
  if (action.startsWith('login.') || action === 'logout') return false
  if (action.startsWith('ai.')) return false
  return action !== 'publish'
}

/**
 * Batch the `route_base` lookups for every data-row event in the window,
 * so the projection can build "/blog/launching-…" paths in one pass.
 */
async function loadRouteBases(
  db: DbClient,
  visible: readonly ChangeRow[],
): Promise<Map<string, string | null>> {
  const tableIds = new Set<string>()
  for (const r of visible) {
    if (!r.action.startsWith('data.row.') && r.action !== 'data.author.assign') continue
    const tableId = readMetadataString(metadataAsRecord(r.metadata_json), 'tableId')
    if (tableId) tableIds.add(tableId)
  }
  const routeBaseById = new Map<string, string | null>()
  for (const id of tableIds) {
    const { rows } = await db<{ route_base: string | null }>`
      select route_base from data_tables where id = ${id}
    `
    routeBaseById.set(id, rows[0]?.route_base ?? null)
  }
  return routeBaseById
}

/**
 * Status chip. `create`/`install` read as Added, `delete`/`remove` as
 * Removed, everything else as Updated — which matches how the reference
 * labels its three sample rows.
 */
function changeKind(action: AuditAction): ChangeManifestEntry['kind'] {
  if (action.endsWith('.create') || action === 'plugin.install' || action === 'plugin.pack.install') {
    return 'added'
  }
  if (action.endsWith('.delete')) return 'removed'
  return 'updated'
}

/**
 * Icon well glyph — Font Awesome Solid names, chosen to match the
 * reference's own vocabulary (`fa-font` for text edits, `fa-image` for
 * media, `fa-file-lines` for content rows).
 */
function changeIcon(action: AuditAction): string {
  if (action.startsWith('data.row.')) return 'file-lines'
  if (action === 'data.author.assign') return 'user-pen'
  if (action.startsWith('data.table.')) return 'table-list'
  if (action.startsWith('plugin.')) return 'cube'
  if (action.startsWith('role.')) return 'shield-halved'
  if (action.startsWith('user.') || action === 'password.change') return 'user'
  return 'font'
}

/** Human title for the row's first line ("Updated hero headline"). */
const ACTION_TITLE: Partial<Record<AuditAction, string>> = {
  'data.row.create': 'Added a content entry',
  'data.row.update': 'Updated a content entry',
  'data.row.delete': 'Removed a content entry',
  'data.row.publish': 'Published a content entry',
  'data.row.schedule': 'Scheduled a content entry',
  'data.row.schedule.cancel': 'Unscheduled a content entry',
  'data.row.status': 'Changed entry status',
  'data.row.move': 'Moved a content entry',
  'data.author.assign': 'Reassigned an author',
  'data.table.create': 'Added a collection',
  'data.table.update': 'Updated a collection',
  'data.table.delete': 'Removed a collection',
  'plugin.install': 'Installed a plugin',
  'plugin.update': 'Updated a plugin',
  'plugin.enable': 'Enabled a plugin',
  'plugin.disable': 'Disabled a plugin',
  'plugin.delete': 'Removed a plugin',
  'plugin.pack.install': 'Installed a plugin pack',
  'plugin.settings.update': 'Updated plugin settings',
  'user.create': 'Added a user',
  'user.update': 'Updated a user',
  'user.delete': 'Removed a user',
  'user.suspend': 'Suspended a user',
  'password.change': 'Changed a password',
  'role.create': 'Added a role',
  'role.update': 'Updated a role',
  'role.delete': 'Removed a role',
  'role.assign': 'Assigned a role',
}

function projectChangeRow(
  row: ChangeRow,
  routeBaseById: Map<string, string | null>,
): ChangeManifestEntry {
  const metadata = metadataAsRecord(row.metadata_json)
  return {
    id: row.id,
    kind: changeKind(row.action),
    icon: changeIcon(row.action),
    // Unknown / future actions degrade to a humanised form of the action
    // string ("plugin.foobar" → "plugin foobar") so a newly-added audit
    // event still renders something useful before this map is updated.
    title: ACTION_TITLE[row.action] ?? row.action.replace(/[._]/g, ' '),
    location: resolveLocation(row, metadata, routeBaseById),
    createdAt: isoDateOrNull(row.created_at) ?? '',
  }
}

/**
 * Second line of the row — the reference's "Home page · Section: Hero".
 * We surface the most specific real locator we have: a resolved route
 * path for content rows, otherwise a collection / plugin / user label,
 * otherwise the target type. Never a fabricated section name.
 */
function resolveLocation(
  row: ChangeRow,
  metadata: Record<string, unknown>,
  routeBaseById: Map<string, string | null>,
): string {
  if (row.action.startsWith('data.row.') || row.action === 'data.author.assign') {
    const tableId = readMetadataString(metadata, 'tableId')
    const slug = readMetadataString(metadata, 'slug')
    if (tableId && slug) {
      return buildRowPath(routeBaseById.get(tableId) ?? null, tableId, slug)
    }
    const tableName = readMetadataString(metadata, 'tableName')
    if (tableName) return tableName
  }

  const name =
    readMetadataString(metadata, 'name') ??
    readMetadataString(metadata, 'pluginId') ??
    readMetadataString(metadata, 'email') ??
    readMetadataString(metadata, 'title')
  if (name) return name

  return row.target_type ?? 'Site'
}


function metadataAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const v = metadata[key]
  return typeof v === 'string' && v.trim() ? v : null
}

