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

const LINKS_BY_ROLE: Record<HubRole, HubNavigationLink[]> = {
  operator: OPERATOR_LINKS,
  agency: OPERATOR_LINKS,
  client: CLIENT_LINKS,
  'super-admin': SUPER_ADMIN_LINKS,
}

export function hubNavigationLinks(role: HubRole): HubNavigationLink[] {
  return LINKS_BY_ROLE[role]
}

/** Absolute URL for a Hub link. Both halves are already normalised. */
export function hubLinkHref(hubBaseUrl: string, path: string): string {
  return `${hubBaseUrl}${path}`
}
