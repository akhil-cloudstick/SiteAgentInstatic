/**
 * Per-widget dashboard data hooks.
 *
 * Each hook owns ONE network round-trip against a per-domain endpoint
 * (`/cms/api/cms/dashboard/<domain>`). The 6 hooks fire in parallel
 * when the dashboard mounts, and each widget unblocks AS ITS DATA
 * ARRIVES — the dashboard fills in progressively instead of stalling
 * on the slowest endpoint (the audit-events-driven Activity feed).
 *
 *   • `usePagesStats()`        — Pages widget (cheap; 2 small counts)
 *   • `usePostsStats()`        — Posts widget (one query per postType
 *                                  + a 28-day histogram)
 *   • `useMediaStats()`        — Media widget (totals + 16 thumbs)
 *   • `usePluginsStats()`      — Plugins widget (one scan of
 *                                  `installed_plugins`)
 *   • `useStorageStats()`      — Storage widget (media bytes + plugin
 *                                  dir size + database file/db size +
 *                                  the active dialect label)
 *   • `usePublishLineupStats()`— Publish Lineup widget (three small
 *                                  range queries)
 *   • `useRecentActivityStats()`— Activity widget (a 50-row audit-events
 *                                  scan + projections; slowest)
 *
 * Validation: each response is validated at the JSON boundary against the
 * TypeBox schema below via the canonical `apiRequest` (`@core/http`).
 * On any failure — non-OK status, abort, or a payload that doesn't match —
 * the hook keeps `null` (the widget keeps showing its skeleton, which is
 * better than throwing and blanking the dashboard). That swallow-on-failure
 * behaviour is `useAsyncResource`'s `swallowErrors` mode.
 *
 * Cancellation + boundary validation are handled by the shared
 * `useAsyncResource` primitive (each load aborts its in-flight request on
 * unmount and discards stale responses).
 *
 * No SWR / cache here yet — the dashboard is a single mount per
 * session and the responses are small. If we later cache across
 * mounts, do it module-level so multiple sibling widgets that share a
 * domain (none today) reuse one fetch.
 */
import type { TSchema, TProperties } from '@sinclair/typebox'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { apiRequest } from '@core/http'
import { useAsyncResource } from '@admin/lib/useAsyncResource'

// ---------------------------------------------------------------------------
// Response shapes (must stay in sync with `server/handlers/cms/dashboard.ts`).
// The schemas are the source of truth; the exported types follow. Objects
// allow additional properties so a server-side additive change never trips
// the boundary and blanks a widget.
// ---------------------------------------------------------------------------

const looseObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: true })

const DashboardMediaThumbSchema = looseObject({
  id: Type.String(),
  publicPath: Type.String(),
  altText: Type.String(),
  mimeType: Type.String(),
  width: Type.Union([Type.Number(), Type.Null()]),
  height: Type.Union([Type.Number(), Type.Null()]),
  variants: Type.Array(
    looseObject({
      width: Type.Number(),
      height: Type.Number(),
      format: Type.String(),
      path: Type.String(),
    }),
  ),
})

const DashboardPluginRowSchema = looseObject({
  id: Type.String(),
  name: Type.String(),
  version: Type.String(),
  state: Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('error')]),
  /**
   * Public URL for the plugin's manifest-declared icon, resolved on the
   * server. `null` when the plugin omits an icon — the widget renders
   * its fallback plug glyph in that case.
   */
  iconUrl: Type.Union([Type.String(), Type.Null()]),
})
export type DashboardPluginRow = Static<typeof DashboardPluginRowSchema>

const DashboardPublishLineupRowSchema = looseObject({
  id: Type.String(),
  /** Public path (`/blog/sandbox-deep-dive`). */
  path: Type.String(),
  status: Type.Union([Type.Literal('scheduled'), Type.Literal('published'), Type.Literal('draft')]),
  /**
   * ISO datetime relevant to the status:
   *   - scheduled → future scheduled_publish_at
   *   - published → past published_at
   *   - draft     → null
   * The widget renders this as a relative-time label client-side.
   */
  at: Type.Union([Type.String(), Type.Null()]),
})
export type DashboardPublishLineupRow = Static<typeof DashboardPublishLineupRowSchema>

const DashboardActivityActorSchema = looseObject({
  displayName: Type.String(),
  email: Type.String(),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  gravatarHash: Type.String(),
})

const DashboardActivityEntrySchema = looseObject({
  id: Type.String(),
  action: Type.String(),
  actor: Type.Union([DashboardActivityActorSchema, Type.Null()]),
  targetCode: Type.Union([Type.String(), Type.Null()]),
  targetText: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})
export type DashboardActivityEntry = Static<typeof DashboardActivityEntrySchema>

const DashboardPagesStatsSchema = looseObject({
  total: Type.Number(),
  published: Type.Number(),
  drafts: Type.Number(),
  scheduled: Type.Number(),
  deltaPublishedThisWeek: Type.Number(),
})
type DashboardPagesStats = Static<typeof DashboardPagesStatsSchema>

const DashboardPostsStatsSchema = looseObject({
  total: Type.Number(),
  categories: Type.Number(),
  scheduled: Type.Number(),
  daily28: Type.Array(Type.Number()),
})
type DashboardPostsStats = Static<typeof DashboardPostsStatsSchema>

const DashboardMediaStatsSchema = looseObject({
  count: Type.Number(),
  totalBytes: Type.Number(),
  latestThumbs: Type.Array(DashboardMediaThumbSchema),
})
type DashboardMediaStats = Static<typeof DashboardMediaStatsSchema>

const DashboardPluginsStatsSchema = looseObject({
  total: Type.Number(),
  active: Type.Number(),
  disabled: Type.Number(),
  errored: Type.Number(),
  rows: Type.Array(DashboardPluginRowSchema),
})
type DashboardPluginsStats = Static<typeof DashboardPluginsStatsSchema>

const DashboardPublishLineupStatsSchema = looseObject({
  rows: Type.Array(DashboardPublishLineupRowSchema),
})
type DashboardPublishLineupStats = Static<typeof DashboardPublishLineupStatsSchema>

/**
 * Storage widget payload. Mirrors `StorageStats` on the server (see
 * `server/handlers/cms/dashboard.ts`). All byte counts are raw integers;
 * the widget formats them with the `formatSize` helper. `dialect` powers
 * the "SQLite" / "Postgres" label the widget shows in its caption so
 * operators can see at a glance which adapter is in use.
 *
 * Media is split into `imageBytes` / `videoBytes` / `documentBytes` by
 * mime-type prefix on the server; anything that isn't `image/*` or
 * `video/*` (PDFs, audio, archives, rows with NULL mime_type) lands in
 * `documentBytes`, so the three sub-counters sum to the full media total.
 */
const DashboardStorageStatsSchema = looseObject({
  imageBytes: Type.Number(),
  videoBytes: Type.Number(),
  documentBytes: Type.Number(),
  pluginBytes: Type.Number(),
  databaseBytes: Type.Number(),
  totalBytes: Type.Number(),
  dialect: Type.Union([Type.Literal('sqlite'), Type.Literal('postgres')]),
})
type DashboardStorageStats = Static<typeof DashboardStorageStatsSchema>

const DashboardActivityStatsSchema = looseObject({
  rows: Type.Array(DashboardActivityEntrySchema),
})
type DashboardActivityStats = Static<typeof DashboardActivityStatsSchema>

const DashboardChangeEntrySchema = looseObject({
  id: Type.String(),
  kind: Type.Union([
    Type.Literal('added'),
    Type.Literal('updated'),
    Type.Literal('removed'),
  ]),
  icon: Type.String(),
  title: Type.String(),
  location: Type.String(),
  createdAt: Type.String(),
})
export type DashboardChangeEntry = Static<typeof DashboardChangeEntrySchema>

const DashboardChangesStatsSchema = looseObject({
  rows: Type.Array(DashboardChangeEntrySchema),
  total: Type.Number(),
  since: Type.Union([Type.String(), Type.Null()]),
})
type DashboardChangesStats = Static<typeof DashboardChangesStatsSchema>

// ---------------------------------------------------------------------------
// Generic fetch hook factory
// ---------------------------------------------------------------------------

/**
 * What a widget data hook hands back.
 *
 * `data` and `loading` are SEPARATE signals on purpose. Collapsing them
 * into a single `T | null` (which this module used to do) makes
 * "still fetching" and "the request failed" indistinguishable, so a
 * widget whose endpoint 404s or 403s sits under a shimmer skeleton
 * forever instead of telling the operator anything. The rule is:
 *
 *   loading            → skeleton
 *   !loading && !data  → the widget's empty / unavailable state
 *   !loading && data   → the real thing
 */
export interface DashboardResource<T> {
  data: T | null
  loading: boolean
}

/**
 * Generic per-domain fetcher over {@link useAsyncResource}: TypeBox boundary
 * validation via `apiRequest`, abort-on-unmount, and `swallowErrors` so a
 * failure leaves `data` null rather than throwing into the widget tree.
 *
 * Every request carries the viewer's IANA timezone (`tz`) so server readers
 * that bin timestamps per calendar day bucket into the operator's local day
 * rather than UTC. Endpoints that don't bucket ignore it.
 */
function useDashboardEndpoint<S extends TSchema>(
  endpoint: string,
  schema: S,
): DashboardResource<Static<S>> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const resource = useAsyncResource(
    (signal) =>
      apiRequest(`/cms/api/cms/dashboard/${endpoint}`, {
        schema,
        signal,
        query: { tz: timeZone },
      }),
    [endpoint, schema, timeZone],
    { swallowErrors: true },
  )
  return { data: resource.data, loading: resource.loading }
}

// ---------------------------------------------------------------------------
// Per-domain hooks
// ---------------------------------------------------------------------------

/** Pages widget. Two cheap counts on `data_rows` for the system pages table. */
export function usePagesStats(): DashboardResource<DashboardPagesStats> {
  return useDashboardEndpoint('pages', DashboardPagesStatsSchema)
}

/** Posts widget. One query per postType table + a 28-day histogram. */
export function usePostsStats(): DashboardResource<DashboardPostsStats> {
  return useDashboardEndpoint('posts', DashboardPostsStatsSchema)
}

/** Media widget. Totals + 16 most-recent image thumbnails. */
export function useMediaStats(): DashboardResource<DashboardMediaStats> {
  return useDashboardEndpoint('media', DashboardMediaStatsSchema)
}

/** Plugins widget. One scan of `installed_plugins`. */
export function usePluginsStats(): DashboardResource<DashboardPluginsStats> {
  return useDashboardEndpoint('plugins', DashboardPluginsStatsSchema)
}

/**
 * Storage widget. One mime-bucketed sum over `media_assets.size_bytes`
 * (image / video / other) + an `fs.stat` walk of `<uploadsDir>/plugins/`
 * + a dialect-aware database size query.
 */
export function useStorageStats(): DashboardResource<DashboardStorageStats> {
  return useDashboardEndpoint('storage', DashboardStorageStatsSchema)
}

/** Publish Lineup widget. Three small queries against `data_rows`. */
export function usePublishLineupStats(): DashboardResource<DashboardPublishLineupStats> {
  return useDashboardEndpoint('publish-lineup', DashboardPublishLineupStatsSchema)
}

/** Activity widget. The heaviest endpoint — a 50-row `audit_events` scan. */
export function useRecentActivityStats(): DashboardResource<DashboardActivityStats> {
  return useDashboardEndpoint('activity', DashboardActivityStatsSchema)
}

/**
 * Changes widget. The per-version change manifest — `audit_events` sliced
 * at the most recent `publish` boundary, so the list is everything sitting
 * in the draft but not yet live.
 */
export function useChangeManifestStats(): DashboardResource<DashboardChangesStats> {
  return useDashboardEndpoint('changes', DashboardChangesStatsSchema)
}
