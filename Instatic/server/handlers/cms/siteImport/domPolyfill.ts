/**
 * Server-side browser-global polyfills for the headless Share-to-CMS import.
 *
 * The import pipeline uses two browser APIs Bun lacks natively:
 *   - `DOMParser` — `src/core/htmlImport/parseHtml.ts` parses each page's HTML.
 *   - `CSSStyleSheet` — `src/core/siteImport/cssToStyleRules.ts` parses every
 *     `<style>` block via `CSSStyleSheet.replaceSync()`. Without a WORKING
 *     constructor the parser yields ZERO rules, so ALL imported CSS (colours,
 *     class styles, fonts) is silently dropped and pages import unstyled.
 *
 * We ALWAYS install happy-dom's `CSSStyleSheet` (overwriting any pre-existing
 * global, which on Bun may be a non-parsing stub) and self-test that it parses.
 */
import { GlobalWindow } from 'happy-dom'

let installed = false

export function ensureServerDomParser(): void {
  if (installed) return
  const g = globalThis as unknown as {
    DOMParser?: typeof DOMParser
    CSSStyleSheet?: typeof CSSStyleSheet
  }
  const win = new GlobalWindow({ url: 'http://localhost/' })
  if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = win.DOMParser as unknown as typeof DOMParser
  }
  // Unconditionally install a known-good CSS parser. A pre-existing global may
  // be a stub that returns no rules; happy-dom's parses correctly.
  g.CSSStyleSheet = win.CSSStyleSheet as unknown as typeof CSSStyleSheet

  // Self-test: prove the installed constructor actually parses. If not, an
  // import would silently drop every style — so make that failure LOUD.
  try {
    const probe = new g.CSSStyleSheet()
    ;(probe as unknown as { replaceSync(css: string): void }).replaceSync('.od-probe{color:red}')
    const count = (probe as unknown as { cssRules: { length: number } }).cssRules?.length ?? 0
    if (count === 0) {
      console.error('[domPolyfill] CSSStyleSheet installed but parses 0 rules — CSS import will be EMPTY')
    } else {
      console.error('[domPolyfill] CSSStyleSheet OK (self-test parsed', count, 'rule)')
    }
  } catch (err) {
    console.error('[domPolyfill] CSSStyleSheet self-test threw:', (err as Error)?.message ?? err)
  }
  installed = true
}
