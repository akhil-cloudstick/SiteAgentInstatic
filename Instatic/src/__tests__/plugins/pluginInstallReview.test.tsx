/**
 * Tests for the install / update review screen.
 *
 * The critical safety invariant is: when a plugin upgrade requests new
 * permissions, the UI must surface them prominently so the site owner can spot
 * a permission expansion before approving. The screen was rebuilt to the
 * approved MMSBUILD design, which is drawn for a fresh install and has no
 * upgrade-specific banner — so the diff callout is carried explicitly here to
 * make sure the redesign never quietly drops it.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import {
  PluginInstallReview,
  computePermissionDiff,
} from '@plugins/components/PluginInstallReview'
import type { PluginManifest, PluginPermission } from '@core/plugin-sdk'

afterEach(() => {
  cleanup()
})

const baseManifest: PluginManifest = {
  id: 'acme.test',
  name: 'Acme Plugin',
  version: '2.0.0',
  apiVersion: 1,
  description: 'Test plugin',
  permissions: [],
  resources: [],
  adminPages: [],
}

function renderReview(pending: Parameters<typeof PluginInstallReview>[0]['pending']) {
  return render(
    <PluginInstallReview
      pending={pending}
      uploading={false}
      canInstall
      onCancel={() => {}}
      onApprove={() => {}}
    />,
  )
}

describe('computePermissionDiff', () => {
  it('returns all requested as new for a fresh install (no previously-granted)', () => {
    const rows = computePermissionDiff(['cms.routes', 'cms.storage'], undefined)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'new')).toBe(true)
  })

  it('puts new permissions first, then existing, then dropped', () => {
    const rows = computePermissionDiff(
      ['editor.commands', 'cms.routes', 'editor.canvas'] satisfies PluginPermission[],
      ['editor.commands', 'cms.storage'] satisfies PluginPermission[],
    )
    expect(rows.map((r) => r.permission)).toEqual([
      'cms.routes',
      'editor.canvas',
      'editor.commands',
      'cms.storage',
    ])
    expect(rows.map((r) => r.status)).toEqual(['new', 'new', 'existing', 'dropped'])
  })

  it('returns no rows when nothing is requested or previously granted', () => {
    expect(computePermissionDiff([], undefined)).toEqual([])
    expect(computePermissionDiff([], [])).toEqual([])
  })

  it('returns only dropped rows when the new manifest requests nothing', () => {
    const rows = computePermissionDiff([], ['cms.routes'])
    expect(rows).toEqual([{ permission: 'cms.routes', status: 'dropped' }])
  })

  it('returns only existing rows when nothing changes', () => {
    const rows = computePermissionDiff(
      ['cms.routes', 'cms.storage'],
      ['cms.routes', 'cms.storage'],
    )
    expect(rows.every((r) => r.status === 'existing')).toBe(true)
  })
})

describe('PluginInstallReview — fresh install', () => {
  it('shows the review heading and the approve action', () => {
    renderReview({
      manifest: { ...baseManifest, permissions: ['cms.routes', 'cms.storage'] },
    })
    expect(screen.getByText('Review before installing')).toBeDefined()
    expect(screen.getByRole('button', { name: /Approve and install/ })).toBeDefined()
    // A fresh install has nothing to diff against, so no upgrade banners.
    expect(screen.queryByTestId('permission-diff-alert')).toBeNull()
    expect(screen.queryByTestId('permission-diff-noop')).toBeNull()
  })

  it('renders a "no permissions requested" notice for a zero-permission install', () => {
    renderReview({ manifest: { ...baseManifest, permissions: [] } })
    const empty = screen.getByTestId('permission-review-empty')
    expect(empty.textContent).toContain('No permissions requested')
    expect(screen.getByRole('button', { name: /Approve and install/ })).toBeDefined()
    expect(screen.queryByTestId('unsandboxed-code-alert')).toBeNull()
  })

  it('flags editor.code installs with an unsandboxed-code alert and a danger banner', () => {
    renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['editor.code', 'editor.commands'] satisfies PluginPermission[],
        entrypoints: { editor: 'editor/index.js' },
      },
    })
    const alert = screen.getByTestId('unsandboxed-code-alert')
    expect(alert.textContent).toContain('outside QuickJS')
    // The headline banner escalates too — an operator scanning the top of the
    // page must not have to reach the table to learn this.
    expect(screen.getByText('This package contains unsandboxed editor code.')).toBeDefined()
  })

  it('grades each permission and counts the high-risk ones', () => {
    const { container } = renderReview({
      manifest: {
        ...baseManifest,
        // `cms.content.read` is the catalog's only low-risk permission here;
        // `network.outbound` is high.
        permissions: ['cms.content.read', 'network.outbound'] satisfies PluginPermission[],
      },
    })
    const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-risk]'))
    expect(chips.map((c) => c.dataset.risk)).toEqual(['low', 'high'])
    expect(screen.getByText(/1 high risk/)).toBeDefined()
  })

  it('discloses the outbound host allowlist, and says so when there is none', () => {
    const { unmount } = renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['network.outbound'] satisfies PluginPermission[],
        networkAllowedHosts: ['api.example.com'],
      },
    })
    expect(screen.getByText('api.example.com')).toBeDefined()
    unmount()

    renderReview({ manifest: { ...baseManifest, permissions: [] } })
    expect(screen.getByText('No outbound hosts requested')).toBeDefined()
  })
})

describe('PluginInstallReview — upgrade with new permissions', () => {
  it('shows the alert highlighting the new-permission count', () => {
    renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['cms.routes', 'editor.canvas'] satisfies PluginPermission[],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: ['cms.routes'] satisfies PluginPermission[],
    })
    const alert = screen.getByTestId('permission-diff-alert')
    expect(alert.textContent).toContain('1 new permission')
  })

  it('puts the NEW row before existing rows in DOM order', () => {
    const { container } = renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['cms.storage', 'editor.canvas'] satisfies PluginPermission[],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: ['cms.storage'] satisfies PluginPermission[],
    })
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-permission]'))
    expect(rows[0].dataset.permission).toBe('editor.canvas')
    expect(rows[0].dataset.status).toBe('new')
    expect(rows[1].dataset.permission).toBe('cms.storage')
    expect(rows[1].dataset.status).toBe('existing')
  })

  it('switches the heading and confirm verb to the update wording', () => {
    renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['cms.routes'] satisfies PluginPermission[],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: ['cms.routes'] satisfies PluginPermission[],
    })
    expect(screen.getByText('Review before updating')).toBeDefined()
    expect(screen.getByRole('button', { name: /Approve update/ })).toBeDefined()
  })

  it('shows a reassurance banner when the upgrade adds zero new permissions', () => {
    renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['cms.routes'] satisfies PluginPermission[],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: ['cms.routes'] satisfies PluginPermission[],
    })
    expect(screen.getByTestId('permission-diff-noop')).toBeDefined()
    expect(screen.queryByTestId('permission-diff-alert')).toBeNull()
  })

  it('renders dropped permissions as informational rows', () => {
    const { container } = renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['cms.routes'] satisfies PluginPermission[],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: [
        'cms.routes',
        'cms.storage',
      ] satisfies PluginPermission[],
    })
    const droppedRow = container.querySelector('[data-status="dropped"]')
    expect(droppedRow).not.toBeNull()
    expect(droppedRow?.getAttribute('data-permission')).toBe('cms.storage')
  })

  it('flags hosts the update drops, so a shrinking allowlist is visible too', () => {
    const { container } = renderReview({
      manifest: {
        ...baseManifest,
        permissions: ['network.outbound'] satisfies PluginPermission[],
        networkAllowedHosts: ['api.example.com'],
      },
      upgradeFromVersion: '1.0.0',
      previouslyGrantedPermissions: ['network.outbound'] satisfies PluginPermission[],
      previousNetworkAllowedHosts: ['api.example.com', 'legacy.example.com'],
    })
    const dropped = container.querySelector('[data-network-host="legacy.example.com"]')
    expect(dropped).not.toBeNull()
    expect(dropped?.textContent).toContain('Removed: legacy.example.com')
  })
})
