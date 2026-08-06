/**
 * routing.test.tsx
 *
 * In-house admin router: wildcard (`*`) matching and the AdminRoutes
 * catch-all. Unknown ADMIN URLs (e.g. /admin/login, a typo, a stale deep
 * link) must never render an empty tree — they redirect to /admin/dashboard,
 * which shows the login form when unauthenticated and the dashboard when
 * authenticated. The catch-all is scoped to /admin/* so public-site 404s —
 * which have their own treatment in the publish pipeline (NotFound template)
 * — are never claimed by the admin SPA.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { matchPath, MemoryRouter, Navigate, Route, Routes, useLocation } from '@admin/lib/routing'
import { AdminRoutes } from '@admin/router'

afterEach(cleanup)

describe('matchPath — wildcard patterns', () => {
  it("matches '*' against any pathname", () => {
    expect(matchPath('*', '/')).not.toBeNull()
    expect(matchPath('*', '/cms/login')).not.toBeNull()
    expect(matchPath('*', '/totally/unknown/path')).not.toBeNull()
  })

  it("matches a trailing '/*' segment against any subpath", () => {
    expect(matchPath('/cms/*', '/cms/login')).not.toBeNull()
    expect(matchPath('/cms/*', '/cms/a/b/c')).not.toBeNull()
    expect(matchPath('/cms/*', '/other')).toBeNull()
  })

  it('still treats non-wildcard patterns literally', () => {
    expect(matchPath('/cms/site', '/cms/site')).not.toBeNull()
    expect(matchPath('/cms/site', '/cms/site2')).toBeNull()
    expect(matchPath('/cms/plugins/:pluginId/:pageId', '/cms/plugins/a/b')).not.toBeNull()
  })
})

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="probe">{pathname}</div>
}

describe('Routes — catch-all route', () => {
  it('renders the * route when nothing else matches, and Navigate redirects', async () => {
    render(
      <MemoryRouter initialEntries={['/cms/login']}>
        <Routes>
          <Route path="/cms/dashboard" element={<LocationProbe />} />
          <Route path="*" element={<Navigate to="/cms/dashboard" replace />} />
        </Routes>
      </MemoryRouter>,
    )
    const probe = await screen.findByTestId('probe')
    expect(probe.textContent).toBe('/cms/dashboard')
  })

  it('prefers an earlier explicit match over the catch-all', () => {
    render(
      <MemoryRouter initialEntries={['/cms/site']}>
        <Routes>
          <Route path="/cms/site" element={<div data-testid="site" />} />
          <Route path="*" element={<div data-testid="fallback" />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('site')).toBeDefined()
    expect(screen.queryByTestId('fallback')).toBeNull()
  })
})

describe('AdminRoutes — unknown admin URLs never render an empty tree', () => {
  it('declares a final /admin/* catch-all redirecting to /admin/dashboard', () => {
    // Inspect the declared route table (no DOM mount — AdminEntry is heavy).
    const routes = AdminRoutes()
    const routeElements = React.Children.toArray(routes.props.children) as Array<
      React.ReactElement<{ path: string; element: React.ReactElement }>
    >
    const last = routeElements[routeElements.length - 1]
    expect(last.props.path).toBe('/cms/*')
    expect(last.props.element.type).toBe(Navigate)
    expect(
      (last.props.element as React.ReactElement<{ to: string; replace?: boolean }>).props.to,
    ).toBe('/cms/dashboard')
  })

  it('does not claim non-admin paths (public 404s keep their own treatment)', () => {
    const routes = AdminRoutes()
    const routeElements = React.Children.toArray(routes.props.children) as Array<
      React.ReactElement<{ path: string }>
    >
    // No declared route may swallow an arbitrary public URL.
    const publicPath = '/some-public-page'
    const claiming = routeElements.filter((r) => matchPath(r.props.path, publicPath) !== null)
    expect(claiming).toEqual([])
  })
})
