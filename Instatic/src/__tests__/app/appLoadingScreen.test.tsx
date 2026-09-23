import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { AppLoadingScreen } from '@admin/AppLoadingScreen'

afterEach(cleanup)

describe('AppLoadingScreen', () => {
  it('renders one accessible centered loader without visible raw loading text or skeleton chrome', () => {
    render(<AppLoadingScreen />)

    // The product is MMS-CMS in every user-visible string — the upstream name
    // never appears in the UI. This used to look for /loading instatic/i, which
    // stopped matching when the screen was renamed and would have gone on
    // passing if the old name ever came back.
    const status = screen.getByRole('status', { name: /loading mms-cms/i })
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.querySelector('[data-loader-spinner="true"]')).not.toBeNull()
    expect(status.querySelector('[data-editor-skeleton="true"]')).toBeNull()
    expect(screen.queryByText(/^Loading\.\.\.$/)).toBeNull()
    expect(status.textContent ?? '').not.toMatch(/instatic/i)
  })
})
