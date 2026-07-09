import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BRAND_NAME } from '@core/brand'

const INDEX_HTML_PATH = join(import.meta.dir, '../../../index.html')

describe('initial HTML loading shell', () => {
  it('renders the loading spinner before the React bundle executes', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf8')
    const styleIndex = html.indexOf('<style data-initial-loader>')
    const rootIndex = html.indexOf('<div id="root">')
    const scriptIndex = html.indexOf('<script type="module" src="/src/admin/main.tsx">')

    expect(styleIndex).toBeGreaterThan(-1)
    expect(rootIndex).toBeGreaterThan(-1)
    expect(scriptIndex).toBeGreaterThan(rootIndex)
    expect(styleIndex).toBeLessThan(rootIndex)
    expect(html).toContain('role="status"')
    expect(html).toContain('data-initial-loader-spinner="true"')
    expect(html).not.toContain('<div id="root"></div>')
  })

  // index.html renders before any JS loads, so its <title> and loading
  // aria-label CANNOT import BRAND_NAME — they're hardcoded. This gate makes
  // `src/core/brand.ts` the single source of truth anyway: if someone rebrands
  // the constant but forgets these two lines, the test fails.
  it('keeps the static index.html brand text in sync with BRAND_NAME', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf8')
    expect(html).toContain(`<title>${BRAND_NAME}</title>`)
    expect(html).toContain(`aria-label="Loading ${BRAND_NAME}"`)
  })
})
