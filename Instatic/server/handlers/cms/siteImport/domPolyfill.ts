/**
 * Server-side DOMParser polyfill for the headless Share-to-CMS import.
 *
 * `src/core/htmlImport/parseHtml.ts` uses the global `DOMParser` (a browser API)
 * and explicitly defers server use to "a guarded dynamic import at that call
 * site". This is that call site's guard: it installs happy-dom's DOMParser onto
 * `globalThis` once, mirroring how `src/__tests__/setup.ts` and
 * `server/richtextSanitizer.ts` bring a DOM into the Bun server.
 */
import { GlobalWindow } from 'happy-dom'

let installed = false

export function ensureServerDomParser(): void {
  if (installed || typeof globalThis.DOMParser !== 'undefined') {
    installed = true
    return
  }
  const win = new GlobalWindow({ url: 'http://localhost/' })
  globalThis.DOMParser = win.DOMParser as unknown as typeof DOMParser
  installed = true
}
