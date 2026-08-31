/**
 * Document hash — the site half of the approval binding.
 *
 * Mirrors exactly what Instatic's publisher hashes, which is NOT "the whole site
 * document" despite the name. `getDraftSiteDocument` assembles shell + pages +
 * visualComponents and then sets `layouts: []`, with the comment "Saved layouts
 * are editor-only; publishing ignores them".
 *
 * Including layouts here would flip the hash whenever someone saved a layout and
 * trigger a full-site publish that changes nothing published — the exact false
 * positive the conditional publish exists to prevent.
 */

import type { SiteDocument } from '@core/page-tree/siteDocument'
import { siteContentHash } from './canonical'

export function documentHash(site: SiteDocument): string {
  // Force the publisher's own normalization rather than trusting the caller.
  return siteContentHash({ ...site, layouts: [] } as SiteDocument)
}
