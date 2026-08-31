/**
 * Role-scoped Product Hub navigation — the link sets defined by the MMSBUILD
 * shared-header contract, transcribed verbatim.
 *
 * Pure data, no behaviour: the header renders whichever set the Hub-supplied
 * role selects, and nothing here decides authority. That separation is the
 * point — the contract says "do not show links a role is not allowed to use",
 * and the only system that knows a user's portfolio-wide authority is the Hub
 * itself. A product's own capabilities gate its specialist row, never this one.
 *
 * `operator` and `agency` share one set per the contract.
 */
import type { HubRole } from './types'

export interface HubNavigationLink {
  /** Visible label, exactly as the contract spells it. */
  label: string
  /** Hub-relative path, resolved against `hubContext.hubBaseUrl`. */
  path: string
}

const OPERATOR_LINKS: HubNavigationLink[] = [
  { label: 'Home', path: '/hub' },
  { label: 'Portfolio', path: '/hub/portfolio' },
  { label: 'Actions', path: '/hub/actions' },
  { label: 'Approvals', path: '/hub/approvals' },
  { label: 'Reports', path: '/hub/reports' },
]

const CLIENT_LINKS: HubNavigationLink[] = [
  { label: 'Home', path: '/hub' },
  { label: 'My Projects', path: '/hub/projects' },
  { label: 'My Actions', path: '/hub/actions' },
  { label: 'Approvals', path: '/hub/approvals' },
  { label: 'Reports', path: '/hub/reports' },
]

const SUPER_ADMIN_LINKS: HubNavigationLink[] = [
  { label: 'Home', path: '/hub' },
  { label: 'Governance', path: '/hub/governance' },
  { label: 'Global Library', path: '/hub/library' },
  { label: 'Intelligence', path: '/hub/intelligence' },
  { label: 'Knowledge', path: '/hub/knowledge' },
  { label: 'Integrations', path: '/hub/integrations' },
  { label: 'Health & Audit', path: '/hub/health' },
]

/**
 * The contract table, complete and unfiltered.
 *
 * Exported so the contract test can assert it verbatim: `hubNavigationLinks()`
 * returns only what the Hub serves today, so asserting through that function
 * would silently stop covering the labels and paths as more get hidden.
 */
export const HUB_NAVIGATION_CONTRACT: Record<HubRole, HubNavigationLink[]> = {
  operator: OPERATOR_LINKS,
  agency: OPERATOR_LINKS,
  client: CLIENT_LINKS,
  'super-admin': SUPER_ADMIN_LINKS,
}

const LINKS_BY_ROLE = HUB_NAVIGATION_CONTRACT

/**
 * Hub paths that actually resolve today.
 *
 * The link sets above are the CONTRACT — they stay complete, and are the record
 * of what Product Hub will serve. This is the much shorter list of what it
 * serves *now*: `hub.mjs` matches `/hub` exactly, so every other path falls
 * through the gateway to the tenant's CMS and 404s there. Showing a link that
 * dead-ends is worse than not showing it, so the rest are hidden until built.
 *
 * To turn one on: implement the route in `Operator/control-plane/hub/hub.mjs`
 * and add its path here. It reappears in every role that already lists it —
 * nothing above needs touching.
 */
const IMPLEMENTED_HUB_PATHS: ReadonlySet<string> = new Set(['/hub'])

/**
 * Is there a Product Hub worth navigating to?
 *
 * With one product enabled the Hub immediately bounces back into that product,
 * so `Home` would link to the page you are already on. Absent flags mean an
 * older hand-off that predates them: treated as enabled, because the routing
 * gate is server-side and wrongly hiding a link is the worse failure.
 */
function hubIsReachable(products?: HubNavigationProducts): boolean {
  const design = products?.designActive !== false
  const cms = products?.cmsActive !== false
  return design && cms
}

export interface HubNavigationProducts {
  designActive?: boolean
  cmsActive?: boolean
}

export function hubNavigationLinks(
  role: HubRole,
  products?: HubNavigationProducts,
): HubNavigationLink[] {
  if (!hubIsReachable(products)) return []
  return LINKS_BY_ROLE[role].filter((link) => IMPLEMENTED_HUB_PATHS.has(link.path))
}

/** Absolute URL for a Hub link. Both halves are already normalised. */
export function hubLinkHref(hubBaseUrl: string, path: string): string {
  return `${hubBaseUrl}${path}`
}
