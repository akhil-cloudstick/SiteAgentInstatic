import { afterEach, describe, expect, it } from 'bun:test'
import React, { type ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { Toolbar } from '@site/toolbar/Toolbar'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import type { CmsCurrentUser } from '@core/persistence'

const now = '2026-06-10T10:00:00.000Z'

function toolbarUser(): CmsCurrentUser {
  return {
    id: 'toolbar-brand-user',
    email: 'admin@example.com',
    displayName: 'Admin',
    status: 'active',
    role: {
      id: 'admin',
      slug: 'admin',
      name: 'Admin',
      description: '',
      isSystem: true,
      capabilities: ['site.read', 'site.structure.edit', 'site.content.edit', 'site.style.edit'],
    },
    capabilities: ['site.read', 'site.structure.edit', 'site.content.edit', 'site.style.edit'],
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

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AdminSessionProvider user={toolbarUser()}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

function renderToolbar() {
  render(
    <Wrapper>
      <Toolbar
        adminNavigationSlot={<span data-testid="toolbar-nav-slot" />}
        rightSlot={<span data-testid="toolbar-right-slot" />}
      />
    </Wrapper>,
  )

  const toolbar = screen.getByTestId('toolbar')
  const brand = within(toolbar).getByTestId('toolbar-brand')
  return { toolbar, brand }
}

afterEach(() => {
  cleanup()
})

describe('Toolbar brand mark', () => {
  it('renders the fixed MMSBUILD product lockup', () => {
    const { brand } = renderToolbar()

    // Fixed product lockup — a link, not the per-site name. The approved
    // screen reference bakes the mascot + wordmark into one artwork, so the
    // link itself carries the accessible name rather than a text node.
    expect(brand.tagName).toBe('A')
    expect(brand.getAttribute('aria-label')).toBe('MMSBUILD')
  })

  it('shows the themed lockup artwork from public assets, marked decorative', () => {
    const { brand } = renderToolbar()

    const mark = brand.querySelector('img')
    // Light is the default theme in this harness; the dark asset is drawn
    // larger, hence the intrinsic size travels with the source.
    expect(mark?.getAttribute('src')).toBe('/mmsbuild-logo-light.png')
    expect(mark?.getAttribute('width')).toBe('141')
    expect(mark?.getAttribute('height')).toBe('25')
    // The link carries the accessible name, so the artwork is decorative.
    expect(mark?.getAttribute('alt')).toBe('')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('links the brand through to the dashboard', () => {
    const { brand } = renderToolbar()

    expect(brand.getAttribute('href')).toBe('/admin/dashboard')
  })
})
