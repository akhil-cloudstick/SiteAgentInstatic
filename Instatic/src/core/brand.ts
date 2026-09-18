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

/** What this product is called when no Operator has rebranded it. */
export const PLATFORM_BRAND_NAME = 'MMS-CMS'

/**
 * The product name shown in the admin UI (tab title, login, dialogs, help).
 *
 * An Operator reselling the platform renames it for its own customers — "MMS-CMS"
 * becomes "BrightLeaf CMS" (R5). The name arrives with the Hub hand-off and is
 * published on `window.__mmsBrandName` before any module runs, so this stays a
 * plain constant and the ~13 places that render it are untouched.
 *
 * It is read once, at module load, exactly as a constant would be: the brand of
 * a project cannot change while its page is open.
 */
export const BRAND_NAME: string = (() => {
  try {
    const supplied = (globalThis as { __mmsBrandName?: unknown }).__mmsBrandName
    return typeof supplied === 'string' && supplied.trim() ? supplied.trim() : PLATFORM_BRAND_NAME
  } catch {
    return PLATFORM_BRAND_NAME
  }
})()

// External project links (docs / repo / issues) were removed with the MMS-CMS
// rebrand: no branded destinations exist yet, and pointing them at the upstream
// project would leak the old name into user-facing help actions. Re-introduce
// them here (and the Help-menu commands in spotlight/commands/help.ts) once
// branded URLs exist.
