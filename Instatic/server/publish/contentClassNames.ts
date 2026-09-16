/**
 * Classes that published content HTML uses, per publish version.
 *
 * The `style` bundle keeps a class rule only when something uses it, and a
 * data row whose body is HTML uses classes no node references — see
 * `collectContentClassNames`. Reading every published row's cells is one
 * query, but the CSS is rebuilt on request paths, so the answer is kept for the
 * publish version it was read at; a publish bumps the version and re-reads.
 *
 * Every caller building the CSS for one publish version must pass these same
 * names: they decide which rules the `style` file keeps, and so its hash.
 */

import { collectContentClassNames } from '@core/publisher'
import type { DbClient } from '../db/client'
import { listPublishedRowCells } from '../repositories/data/publish'
import { getPublishVersion, registerVersionedCacheReset } from './publishState'

let cache: { version: number; names: ReadonlySet<string> } | null = null
registerVersionedCacheReset(() => {
  cache = null
})

/** A dialect that hands `cells_json` back as text still yields its strings. */
function parseIfJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export async function getPublishedContentClassNames(
  db: DbClient,
  version: number = getPublishVersion(),
): Promise<ReadonlySet<string>> {
  if (cache?.version === version) return cache.names
  const names = collectContentClassNames((await listPublishedRowCells(db)).map(parseIfJsonText))
  cache = { version, names }
  return names
}
