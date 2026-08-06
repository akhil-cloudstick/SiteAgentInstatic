/**
 * The Site column announces itself to whatever panel it hosts.
 *
 * The approved screen draws ONE header on this column: the mode's title, its
 * action, one search field, and a kicker naming what is listed below. A panel
 * that renders its own title bar, tab row or search field inside that column
 * produces a second header over the same content.
 *
 * Rather than every host passing a `hosted` flag down through each panel, the
 * column publishes itself here and the panels adapt: presence of this context
 * IS "you are inside the Site column". It also carries the column's single
 * search query, so the one field in the header filters whatever is showing.
 */
import { createContext, useContext } from 'react'

export interface SiteColumnHost {
  /** The query typed into the column's single search field. */
  query: string
  setQuery: (query: string) => void
}

export const SiteColumnContext = createContext<SiteColumnHost | null>(null)

/** Null when the panel is mounted anywhere other than the Site column. */
export function useSiteColumnHost(): SiteColumnHost | null {
  return useContext(SiteColumnContext)
}
