/**
 * Central product-brand constants — the white-label surface.
 *
 * Every USER-FACING mention of the product name and the project's external
 * links flows from here, so the whole admin can be rebranded in ONE place.
 *
 * What is INTENTIONALLY NOT routed through here: internal wire identifiers that
 * only look like branding but are code contracts — custom elements
 * (`<instatic-loop>`, `<instatic-outlet>`, `<instatic-hole>`), route prefixes
 * (`/_instatic/…`), storage keys (`instatic-editor-*`), the plugin-SDK
 * specifiers (`@instatic/*`), and the MCP server id. Renaming those would break
 * the running app; they are not brand text.
 *
 * NOTE: the static browser-tab `<title>` and `<link rel="icon">` in
 * `index.html`, and the initial loading `aria-label` there, render before any
 * JS module loads, so they CANNOT import this constant. Keep them in sync with
 * `BRAND_NAME` / the shared favicon by hand.
 */

/** The product name shown in the admin UI (tab title, login, dialogs, help). */
export const BRAND_NAME = 'SiteAgent'

// External project links surfaced in the Help menu and the Plugins page.
// Point these at your own docs/repo/issue tracker for a full white-label; they
// default to the upstream project so a fresh clone still has working links.
export const BRAND_DOCS_URL = 'https://github.com/corebunch/instatic/blob/main/docs/'
export const BRAND_REPO_URL = 'https://github.com/corebunch/instatic'
export const BRAND_ISSUES_URL = 'https://github.com/corebunch/instatic/issues/new'
