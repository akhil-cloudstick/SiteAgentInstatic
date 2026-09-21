/**
 * Full-publish baking of data-row Layer A artefacts.
 *
 * A full publish wipes the inactive slot, writes every page artefact, and
 * swaps — which used to strand every row artefact (`/posts/hello-world`)
 * that incremental publishes had written into the previously-active slot.
 * After every full publish, ALL row routes fell back to the live renderer
 * until each row was individually republished.
 *
 * `bakePublishedDataRowArtefacts` closes that hole: it enumerates every
 * published data row whose table has an entry-template chain and bakes its
 * HTML into the given (still-inactive) slot directory, through the exact
 * render path the live fallback uses — `renderPublishedDataRowTemplate` +
 * `applyPublishedHtmlPipeline` — stamped with the publish version that
 * becomes current at the swap. Output bytes are identical to a live render;
 * only the serving tier changes.
 *
 * One bad row never aborts the bake: per-row failures are logged and the
 * route falls through to the live renderer at request time, mirroring the
 * per-page bake behaviour in `publishDraftSite`.
 */

import type { DbClient } from '../db/client'
import type { SiteCssBundle } from '@core/publisher'
import { resolveTemplateChain } from '@core/templates'
import {
  getPublishedDataRowByRoute,
  listPublishedRowRoutes,
} from '../repositories/data/publish'
import { renderPublishedDataRowTemplate } from './publicRenderer'
import { applyPublishedHtmlPipeline } from './publishedHtmlPipeline'
import { applyRoutePolicy, publicRowPath } from '../../src/core/publisher/routePolicy'
import { writeArtefact } from './staticArtefact'
import { getLatestSnapshotForVersion } from './publishedSnapshotCache'
import { snapshotForEntryRoute } from './entryTemplateSnapshot'

interface DataRowBakeResult {
  /** Routes successfully baked into the slot. */
  baked: number
  /**
   * Those routes, by address. The full publish reports them so a pre-flight's
   * predicted routes can be compared against what actually landed (AC-C11.3).
   */
  routes: string[]
  /**
   * CSS bundles referenced by the baked HTML. The caller writes their files
   * into the slot alongside the page bundles — entry-template renders can
   * carry a merged-page `userStyles` hash no raw page bundle produces.
   */
  cssBundles: SiteCssBundle[]
}

// `publicRowPath` moved to `@core/publisher/routePolicy`, so the pre-flight
// projection predicts entry routes with the same function that bakes them
// rather than a second copy (AC-C11.3). Imported above.

/**
 * Bake every published data-row route into `slotDir`. Called by the full
 * publish AFTER its transaction commits (the row list and snapshot reads see
 * the freshly-committed publish) and BEFORE the slot swap.
 *
 * `publishVersion` is the NEXT publish version — the bake runs before
 * `bumpPublishVersion()`, so baked hole shells must carry the version that
 * becomes current at the swap. Passing it to the versioned snapshot memo
 * also pre-warms the cache visitors are about to read.
 */
export async function bakePublishedDataRowArtefacts(
  db: DbClient,
  slotDir: string,
  publishVersion: number,
): Promise<DataRowBakeResult> {
  const result: DataRowBakeResult = { baked: 0, routes: [], cssBundles: [] }

  const routes = await listPublishedRowRoutes(db)
  if (routes.length === 0) return result

  const siteSnapshot = await getLatestSnapshotForVersion(db, publishVersion)
  if (!siteSnapshot) return result

  // Tables without an entry-template chain have no public row routes —
  // resolve once per table, not once per row.
  const tableHasChain = new Map<string, boolean>()
  const hasEntryChain = (tableSlug: string): boolean => {
    const known = tableHasChain.get(tableSlug)
    if (known !== undefined) return known
    const chain = resolveTemplateChain(siteSnapshot.site, { kind: 'entry', tableSlug })
    const has = chain.length > 0
    tableHasChain.set(tableSlug, has)
    return has
  }

  for (const route of routes) {
    if (!hasEntryChain(route.tableSlug)) continue
    const urlPath = applyRoutePolicy(
      publicRowPath(route.tableRouteBase, route.rowSlug),
      siteSnapshot.site.settings.trailingSlash,
    )
    try {
      const row = await getPublishedDataRowByRoute(db, route.tableRouteBase, route.rowSlug)
      if (!row) continue
      const syntheticUrl = new URL(`http://localhost${urlPath}`)
      // Runtime assets come from this table's entry template, not from the
      // arbitrary page the site-wide snapshot happens to name.
      const snapshot = await snapshotForEntryRoute(db, siteSnapshot, route.tableSlug)
      const rendered = await renderPublishedDataRowTemplate(snapshot, row, {
        db,
        url: syntheticUrl,
        publishVersion,
      })
      if (!rendered) continue
      const html = await applyPublishedHtmlPipeline(rendered, db)
      await writeArtefact(slotDir, urlPath, html)
      result.cssBundles.push(rendered.cssBundle)
      result.baked++
      result.routes.push(urlPath)
    } catch (err) {
      console.error('[publish:site] failed to bake row artefact for', urlPath, '(falls through to live renderer):', err)
    }
  }

  return result
}
