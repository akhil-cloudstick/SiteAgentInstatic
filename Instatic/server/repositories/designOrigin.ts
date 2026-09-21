/**
 * Which design this website came from (MMSBUILD R2).
 *
 * A Share to CMS replaces the website: the design studio is the source of
 * truth, so re-sharing the same design overwrites it in place and nothing
 * stale accumulates. That is correct — as long as it really is the same
 * design.
 *
 * Until now the handover was files and nothing else, so "the same design
 * again" and "a completely different design" arrived down one path, looking
 * identical. The second one destroyed a live website and reported success.
 *
 * This is the missing half: the design that landed, remembered, so the two can
 * be told apart before anything is touched.
 */
import type { DbClient } from '../db/client'

export interface DesignOrigin {
  designId: string
  designName: string | null
  firstSharedAt: string
  lastSharedAt: string
}

interface OriginRow {
  design_id: string
  design_name: string | null
  first_shared_at: string | Date
  last_shared_at: string | Date
}

const asIso = (value: string | Date): string =>
  value instanceof Date ? value.toISOString() : String(value)

/** The design this website was built from, or null if none was ever recorded. */
export async function getDesignOrigin(db: DbClient): Promise<DesignOrigin | null> {
  const { rows } = await db<OriginRow>`
    select design_id, design_name, first_shared_at, last_shared_at
    from site_design_origin
    where site_id = 'default'
    limit 1
  `
  const row = rows[0]
  if (!row) return null
  return {
    designId: row.design_id,
    designName: row.design_name,
    firstSharedAt: asIso(row.first_shared_at),
    lastSharedAt: asIso(row.last_shared_at),
  }
}

/**
 * Record the design that just landed. The first share sets the origin; every
 * later share of the SAME design only moves `last_shared_at`, so the record
 * says both "who built this website" and "when was it last brought up to date".
 */
export async function recordDesignOrigin(
  db: DbClient,
  designId: string,
  designName: string | null,
): Promise<void> {
  if (!designId) return
  await db`
    insert into site_design_origin (site_id, design_id, design_name)
    values ('default', ${designId}, ${designName})
    on conflict (site_id) do update
      set design_id      = excluded.design_id,
          design_name    = excluded.design_name,
          last_shared_at = current_timestamp,
          first_shared_at = case
            when site_design_origin.design_id = excluded.design_id
              then site_design_origin.first_shared_at
            else current_timestamp
          end
  `
}
