/**
 * MMSBUILD shared-header contract — the two-row shell.
 *
 * Row 1 (`ProductHubHeader`) is shared verbatim with Product Hub and MMS
 * Design: brand, Product Hub context control, role-scoped Hub navigation, and
 * the five utilities in a fixed order. Row 2 (`Toolbar`) carries only this
 * product's own navigation and local actions.
 *
 * These are the invariants a future change is most likely to break by accident:
 * a utility drifting out of order or gaining a second home, an eighth
 * destination appearing on row 2, a Hub link claiming the active state, or a
 * "Back to Product Hub" button rendering when there is no Hub to return to.
 *
 * Replaces `toolbarBrand.test.tsx`, whose subject (the brand lockup) moved from
 * row 2 to row 1 when the shared row took ownership of it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React, { type ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { Toolbar } from '@site/toolbar/Toolbar'
import { ProductHubHeader } from '@admin/shared/ProductHubHeader'
import { AdminSectionNavigation } from '@admin/shared/AdminSectionNavigation'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { resetHubContext, setHubContext } from '@admin/state/hubContext'
import { CORE_CAPABILITIES } from '@core/capabilities'
import type { HubContext } from '@core/hubContext'
import type { CmsCurrentUser } from '@core/persistence'

const now = '2026-06-10T10:00:00.000Z'

function shellUser(capabilities: readonly string[] = CORE_CAPABILITIES): CmsCurrentUser {
  return {
    id: 'shell-header-user',
    email: 'admin@example.com',
    displayName: 'Admin',
    status: 'active',
    role: {
      id: 'admin',
      slug: 'admin',
      name: 'Admin',
      description: '',
      isSystem: true,
      capabilities: [...capabilities],
    },
    capabilities: [...capabilities],
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordUpdatedAt: null,
    mfaEnabled: false,
    mfaEnabledAt: null,
    mfaRecoveryCodesRemaining: 0,
    stepUpAuthMode: 'required',
    stepUpWindowMinutes: 15,
    avatarMediaId: null,
    avatarUrl: null,
    gravatarHash: '',
    createdAt: now,
    updatedAt: now,
  }
}

function hubContext(overrides: Partial<HubContext> = {}): HubContext {
  return {
    hubBaseUrl: 'https://hub.example.com',
    role: 'operator',
    client: null,
    project: null,
    site: null,
    origin: 'hub',
    returnUrl: 'https://hub.example.com/hub?tab=portfolio',
    ...overrides,
  }
}

function Wrapper({ user, children }: { user: CmsCurrentUser; children: ReactNode }) {
  return (
    <MemoryRouter>
      <AdminSessionProvider user={user}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

function renderShell(options: { user?: CmsCurrentUser } = {}) {
  const user = options.user ?? shellUser()
  render(
    <Wrapper user={user}>
      <ProductHubHeader />
      <Toolbar
        section="site"
        adminNavigationSlot={<AdminSectionNavigation section="site" currentUser={user} />}
      />
    </Wrapper>,
  )
  return {
    hubRow: screen.getByTestId('product-hub-header'),
    productRow: screen.getByTestId('toolbar'),
  }
}

beforeEach(() => {
  resetHubContext()
})

afterEach(() => {
  cleanup()
  resetHubContext()
})

// ---------------------------------------------------------------------------
// Row 1 — the shared MMS Create shell
// ---------------------------------------------------------------------------

describe('Row 1 — shared Product Hub header', () => {
  it('owns the MMSBUILD brand lockup, and row 2 does not', () => {
    const { hubRow, productRow } = renderShell()

    const brand = within(hubRow).getByTestId('hub-header-brand')
    const mark = brand.querySelector('img')
    // The approved reference bakes mascot + wordmark into one artwork, so the
    // link carries the accessible name and the image is decorative.
    expect(mark?.getAttribute('src')).toBe('/mmsbuild-logo-light.png')
    expect(mark?.getAttribute('width')).toBe('141')
    expect(mark?.getAttribute('height')).toBe('25')
    expect(mark?.getAttribute('alt')).toBe('')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')

    expect(within(productRow).queryByTestId('hub-header-brand')).toBeNull()
  })

  it('renders the Product Hub context control naming the current product', () => {
    const { hubRow } = renderShell()

    const context = within(hubRow).getByTestId('hub-header-context')
    expect(context.textContent).toContain('Product Hub')
    // The product half comes from @core/brand, the white-label surface.
    expect(context.textContent).toContain('MMS-CMS')
  })

  it('orders the utilities Help -> Notifications -> Theme -> Settings -> Account', () => {
    const { hubRow } = renderShell()

    const order = ['Help', 'Notifications', 'Theme', 'Settings', 'Account']
    const rendered = Array.from(hubRow.querySelectorAll('button[aria-label]'))
      .map((button) => button.getAttribute('aria-label') ?? '')
      // The compact-width menu button is present in the DOM at every width —
      // CSS hides it above the breakpoint — so it is excluded here rather than
      // asserted as a sixth utility.
      .filter((label) => label !== 'Product Hub menu')
      .map((label) => order.find((name) => label.startsWith(name)) ?? label)

    expect(rendered).toEqual(order)
  })

  it('does not repeat any shared utility on row 2', () => {
    const { productRow } = renderShell()

    for (const testId of [
      'hub-header-help',
      'hub-header-notifications',
      'toolbar-theme-toggle',
      'hub-header-settings',
      'account-menu-trigger',
    ]) {
      expect(within(productRow).queryByTestId(testId)).toBeNull()
    }
  })

  it('renders no Hub navigation when the install runs without a Product Hub', () => {
    const { hubRow } = renderShell()

    // A link to a Hub that is not there is the same failure as a wrong default.
    expect(within(hubRow).queryByRole('navigation', { name: 'Product Hub navigation' })).toBeNull()
    expect(hubRow.getAttribute('data-has-hub')).toBe('false')
  })

  it('renders the role-scoped Hub navigation when a Hub opened the session', () => {
    setHubContext(hubContext({ role: 'client' }))
    const { hubRow } = renderShell()

    const nav = within(hubRow).getByRole('navigation', { name: 'Product Hub navigation' })
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(labels).toEqual(['Home', 'My Projects', 'My Actions', 'Approvals', 'Reports'])
  })

  it('never marks a Hub destination as the active page', () => {
    setHubContext(hubContext())
    const { hubRow } = renderShell()

    // Inside this product the active destination belongs to row 2.
    expect(hubRow.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Row 2 — this product's specialist navigation
// ---------------------------------------------------------------------------

describe('Row 2 — specialist navigation', () => {
  const CONTRACT_LINKS = ['Dashboard', 'Site', 'Content', 'Data', 'Media', 'Plugins', 'Users']

  it('renders exactly the seven contract destinations', () => {
    const { productRow } = renderShell()

    const nav = within(productRow).getByRole('navigation')
    const labels = Array.from(nav.children).map((node) => node.textContent?.trim())
    expect(labels).toEqual(CONTRACT_LINKS)
  })

  it('marks the active destination with aria-current', () => {
    const { productRow } = renderShell()

    const current = productRow.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toContain('Site')
  })

  it('hides destinations the signed-in role cannot reach', () => {
    // The `client` system role: dashboard, site, media and custom-table reads.
    const { productRow } = renderShell({
      user: shellUser([
        'dashboard.read',
        'site.read',
        'site.content.edit',
        'media.read',
        'data.custom.tables.read',
      ]),
    })

    const nav = within(productRow).getByRole('navigation')
    const labels = Array.from(nav.children).map((node) => node.textContent?.trim())
    // No Content (needs a content capability), no Plugins, no Users. Data stays:
    // `data.custom.tables.read` alone opens the workspace.
    expect(labels).toEqual(['Dashboard', 'Site', 'Data', 'Media'])
  })

  it('shows the product identity, and the site scope once it is known', () => {
    setHubContext(hubContext({ client: 'Harbour Suites', site: 'Marketing site' }))
    const { productRow } = renderShell()

    const identity = within(productRow).getByTestId('toolbar-product-identity')
    expect(identity.textContent).toContain('MMS-CMS')
    expect(identity.textContent).toContain('Harbour Suites')
  })

  it('omits Back to Product Hub when there is no Hub to return to', () => {
    const { productRow } = renderShell()

    expect(within(productRow).queryByTestId('toolbar-back-to-product-hub')).toBeNull()
  })

  it('returns to the exact originating Hub view', () => {
    setHubContext(hubContext())
    const { productRow } = renderShell()

    const back = within(productRow).getByTestId('toolbar-back-to-product-hub')
    expect(back.textContent).toContain('Back to Product Hub')
  })
})
