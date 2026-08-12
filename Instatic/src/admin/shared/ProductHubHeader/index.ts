/**
 * Row 1 of the shared MMS shell.
 *
 * `ProductHubHeader` is this product's thin adapter; the row itself, its
 * geometry and the role-scoped Hub link sets all live in `@mms/shell`. The
 * navigation helpers are re-exported here so existing CMS imports keep
 * resolving at their original specifier.
 */
export { ProductHubHeader } from './ProductHubHeader'
export { hubNavigationLinks, hubLinkHref } from '@mms/shell'
export type { HubNavigationLink } from '@mms/shell'
