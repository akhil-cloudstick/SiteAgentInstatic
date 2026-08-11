import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { UsersPage } from '@users/UsersPage'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { useEditorStore } from '@site/store/store'
import type { CmsCurrentUser } from '@core/persistence'
import { makeSite } from '../fixtures'

const originalFetch = globalThis.fetch
const now = '2026-05-07T10:00:00.000Z'

const roles = [
  {
    id: 'owner',
    slug: 'owner',
    name: 'Owner',
    description: 'Permanent first-site owner with full system access.',
    isSystem: true,
    capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit', 'users.manage', 'roles.manage', 'audit.read'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'admin',
    slug: 'admin',
    name: 'Admin',
    description: 'Full admin access.',
    isSystem: true,
    capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit', 'plugins.read', 'plugins.configure', 'plugins.install', 'plugins.lifecycle', 'users.manage', 'roles.manage', 'audit.read'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'member',
    slug: 'member',
    name: 'Member',
    description: 'Public-facing member account — no admin access by default.',
    isSystem: true,
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'custom-ops',
    slug: 'custom-ops',
    name: 'Ops',
    description: 'Can manage plugins and media.',
    isSystem: false,
    capabilities: ['site.read', 'plugins.read', 'plugins.configure', 'media.read', 'media.write'],
    createdAt: now,
    updatedAt: now,
  },
]

function userFixture(overrides: Partial<CmsCurrentUser>): CmsCurrentUser {
  return {
    id: 'user',
    email: 'user@example.com',
    displayName: 'User',
    status: 'active',
    role: roles[2],
    capabilities: roles[2].capabilities,
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
    ...overrides,
  }
}

const users = [
  userFixture({
    id: 'owner_1',
    email: 'hello@davidbabinec.com',
    displayName: 'hello@davidbabinec.com',
    role: roles[0],
    capabilities: roles[0].capabilities,
  }),
  userFixture({
    id: 'user_1',
    email: 'test@test.com',
    displayName: 'Tester One',
    role: roles[2],
    capabilities: roles[2].capabilities,
  }),
]

const auditEvents = [
  {
    id: 'audit_1',
    actorUserId: 'owner_1',
    action: 'user.create',
    targetType: 'user',
    targetId: 'user_1',
    metadata: { roleId: 'member' },
    actorLabel: 'hello@davidbabinec.com',
    targetLabel: 'Tester One',
    metadataLabels: { roleId: 'Member' },
    ipAddress: '127.0.0.1',
    userAgent: 'Test Browser',
    createdAt: now,
  },
  {
    id: 'audit_2',
    actorUserId: null,
    action: 'login.failure',
    targetType: 'user',
    targetId: null,
    metadata: { email: 'missing@example.com' },
    actorLabel: null,
    targetLabel: null,
    metadataLabels: {},
    ipAddress: 'unknown',
    userAgent: 'Test Browser',
    createdAt: now,
  },
  {
    id: 'audit_3',
    actorUserId: 'owner_1',
    action: 'role.delete',
    targetType: 'role',
    targetId: 'deleted-role',
    metadata: { name: 'Deleted Role', slug: 'deleted-role' },
    actorLabel: 'hello@davidbabinec.com',
    targetLabel: 'Deleted Role',
    metadataLabels: {},
    ipAddress: null,
    userAgent: 'Test Browser',
    createdAt: now,
  },
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Ambient fetch fallback for endpoints AdminPageLayout calls on mount
 * (site load, plugin list) so individual tests don't have to enumerate
 * them. Returns `undefined` for non-ambient URLs — the caller's own
 * handler should still answer those.
 */
function ambientFetchFallback(url: string): Response | undefined {
  if (url.endsWith('/cms/api/cms/plugins')) {
    return json({ plugins: [], adminPages: [] })
  }
  if (url.endsWith('/cms/api/cms/site')) {
    return json({ site: null }, 404)
  }
  if (url.endsWith('/cms/api/cms/site/publish-status')) {
    return json({ ok: false }, 404)
  }
  return undefined
}

function Wrapper({
  user,
  children,
}: {
  user: CmsCurrentUser
  children: ReactNode
}) {
  return (
    <MemoryRouter>
      <AdminSessionProvider user={user}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

function currentUser(capabilities: string[]): CmsCurrentUser {
  return {
    id: 'current-user',
    email: 'current@example.com',
    displayName: 'Current User',
    status: 'active',
    role: {
      id: 'custom',
      slug: 'custom',
      name: 'Custom',
      description: '',
      isSystem: false,
      capabilities,
    },
    capabilities,
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

function setupEditorState() {
  const site = makeSite({ name: 'Users Test Site' })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    leftSidebarWidth: 320,
    focusedPanel: 'canvas',
    codeEditorPanelOpen: false,
    activeEditorFileId: null,
    activeMediaAssetPreview: null,
    dependenciesPanelOpen: false,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(() => {
  localStorage.clear()
  setupEditorState()
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/cms/api/cms/users' && init?.method === 'GET') return json({ users })
    if (url === '/cms/api/cms/roles' && init?.method === 'GET') return json({ roles })
    if (url === '/cms/api/cms/audit' && init?.method === 'GET') return json({ events: auditEvents })
    const ambient = ambientFetchFallback(url)
    if (ambient) return ambient
    return json({ error: `Unhandled ${url}` }, 500)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('UsersPage — Team Access workspace', () => {
  it('limits a user manager to the People roster and its supporting role options', async () => {
    render(<Wrapper user={currentUser(['users.manage'])}><UsersPage /></Wrapper>)

    expect(await screen.findByRole('table', { name: 'CMS team access roster' })).toBeDefined()
    // A single available state renders no tablist — there is nothing to switch
    // between, and an inert one-cell segmented control reads as broken.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Roles' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /create account/i }).length).toBeGreaterThan(0)
  })

  it('limits a role manager to the workbench without exposing the roster', async () => {
    render(<Wrapper user={currentUser(['roles.manage'])}><UsersPage /></Wrapper>)

    expect(await screen.findByRole('complementary', { name: 'Roles' })).toBeDefined()
    expect(screen.queryByRole('table', { name: 'CMS team access roster' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('button', { name: /create role/i })).toBeDefined()
    // The roster is not loaded for this capability, so a derived usage count
    // would read "Used by 0 accounts" — a lie. It is omitted instead.
    expect(screen.queryByText(/used by/i)).toBeNull()
  })

  it('limits an audit reader to read-only activity with resolved labels', async () => {
    useEditorStore.setState({ site: null } as Parameters<typeof useEditorStore.setState>[0])
    render(<Wrapper user={currentUser(['audit.read'])}><UsersPage /></Wrapper>)

    expect(await screen.findByRole('table', { name: 'Access activity' })).toBeDefined()
    expect(screen.queryByRole('table', { name: 'CMS team access roster' })).toBeNull()
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /create role/i })).toBeNull()

    // The live user map wins over the snapshot label captured at write time…
    expect(screen.getByText('Tester One was created')).toBeDefined()
    expect(screen.getAllByText('by hello@davidbabinec.com').length).toBeGreaterThan(0)
    expect(screen.getByText('Role: Member')).toBeDefined()
    // …and falls back to the snapshot when the target no longer exists.
    expect(screen.getByText('Deleted Role was deleted')).toBeDefined()

    expect(screen.queryByText('user_1 was created')).toBeNull()
    expect(screen.queryByText('by owner_1')).toBeNull()
    expect(screen.queryByText('Role: viewer')).toBeNull()
  })

  it('renders the activity empty state instead of an empty table', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/cms/api/cms/audit' && init?.method === 'GET') return json({ events: [] })
      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(<Wrapper user={currentUser(['audit.read'])}><UsersPage /></Wrapper>)

    expect(await screen.findByText('No audit events yet')).toBeDefined()
  })

  it('surfaces audit API load failures without hiding the empty state', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/cms/api/cms/audit' && init?.method === 'GET') {
        return json({ error: 'Audit service unavailable' }, 503)
      }
      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(<Wrapper user={currentUser(['audit.read'])}><UsersPage /></Wrapper>)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Audit service unavailable')
    expect(screen.getByText('No audit events yet')).toBeDefined()
  })

  it('switches between the three states through the segmented tablist', async () => {
    render(
      <Wrapper user={currentUser(['users.manage', 'roles.manage', 'audit.read'])}>
        <UsersPage />
      </Wrapper>,
    )

    const tablist = await screen.findByRole('tablist', { name: 'Team access sections' })
    const people = within(tablist).getByRole('tab', { name: 'People' })
    const roles = within(tablist).getByRole('tab', { name: 'Roles' })
    const activity = within(tablist).getByRole('tab', { name: 'Activity' })

    // Roving tabindex: only the selected tab is in the tab order.
    expect(people.getAttribute('aria-selected')).toBe('true')
    expect(people.getAttribute('tabindex')).toBe('0')
    expect(roles.getAttribute('tabindex')).toBe('-1')

    fireEvent.click(roles)
    expect(await screen.findByRole('complementary', { name: 'Roles' })).toBeDefined()
    expect(screen.queryByRole('table', { name: 'CMS team access roster' })).toBeNull()

    fireEvent.click(activity)
    expect(await screen.findByRole('table', { name: 'Access activity' })).toBeDefined()
  })

  it('protects the owner row and exposes the row actions for everyone else', async () => {
    render(
      <Wrapper user={currentUser(['users.manage', 'roles.manage', 'audit.read'])}>
        <UsersPage />
      </Wrapper>,
    )

    const ownerRow = await screen.findByLabelText('User hello@davidbabinec.com')
    expect(within(ownerRow).getByText('Owner protected')).toBeDefined()
    expect(within(ownerRow).getByText(/permanent/i)).toBeDefined()
    expect(within(ownerRow).queryByRole('button', { name: /actions for/i })).toBeNull()

    const memberRow = screen.getByLabelText('User test@test.com')
    expect(within(memberRow).getByText('Active')).toBeDefined()
    expect(within(memberRow).getByText('Member')).toBeDefined()
    // Security is real data, not a placeholder — `mfaEnabled` ships on every
    // row of the users list response.
    expect(within(memberRow).getByText('MFA off')).toBeDefined()
    // Actions live in the overflow menu only; no inline verbs on the row.
    expect(within(memberRow).queryByRole('button', { name: /^edit/i })).toBeNull()

    fireEvent.click(within(memberRow).getByRole('button', { name: /actions for tester one/i }))
    const menu = screen.getByRole('menu', { name: 'User actions for Tester One' })
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeDefined()
    expect(within(menu).getByRole('menuitem', { name: 'Reset password' })).toBeDefined()
    expect(within(menu).getByRole('menuitem', { name: 'Suspend' })).toBeDefined()
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeDefined()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }))
    const editDialog = screen.getByRole('dialog', { name: 'Edit User' })
    expect(within(editDialog).getByDisplayValue('test@test.com')).toBeDefined()
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Close dialog' }))

    fireEvent.click(within(memberRow).getByRole('button', { name: /actions for tester one/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset password' }))
    const resetDialog = screen.getByRole('dialog', { name: 'Reset Password' })
    expect(within(resetDialog).getByLabelText('New password')).toBeDefined()
  })

  it('filters the roster by search', async () => {
    render(<Wrapper user={currentUser(['users.manage'])}><UsersPage /></Wrapper>)

    await screen.findByRole('table', { name: 'CMS team access roster' })
    expect(screen.getByLabelText('User test@test.com')).toBeDefined()

    const search = screen.getByLabelText('Search team members')
    fireEvent.change(search, { target: { value: 'tester' } })
    expect(screen.getByLabelText('User test@test.com')).toBeDefined()
    expect(screen.queryByLabelText('User hello@davidbabinec.com')).toBeNull()

    fireEvent.change(search, { target: { value: 'nobody-matches-this' } })
    expect(screen.getByText('No matching team members')).toBeDefined()

    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByLabelText('User hello@davidbabinec.com')).toBeDefined()
  })

  it('opens the create-account side sheet with its safety copy', async () => {
    render(<Wrapper user={currentUser(['users.manage'])}><UsersPage /></Wrapper>)

    await screen.findByRole('table', { name: 'CMS team access roster' })
    expect(screen.queryByRole('dialog', { name: 'Create account' })).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: /create account/i })[0])

    const sheet = screen.getByRole('dialog', { name: 'Create account' })
    expect(within(sheet).getByText('Add a person who needs backstage CMS access.')).toBeDefined()
    expect(within(sheet).getByText(/at least 12 characters/i)).toBeDefined()
    expect(within(sheet).getByText('Account starts active')).toBeDefined()
    expect(within(sheet).getByText(/confirm your password before this account is created/i)).toBeDefined()
    // Direct creation, never an invitation queue.
    expect(within(sheet).queryByText(/invite/i)).toBeNull()
  })

  it('validates the create-account form before it reaches the server', async () => {
    render(<Wrapper user={currentUser(['users.manage'])}><UsersPage /></Wrapper>)

    await screen.findByRole('table', { name: 'CMS team access roster' })
    fireEvent.click(screen.getAllByRole('button', { name: /create account/i })[0])
    const sheet = screen.getByRole('dialog', { name: 'Create account' })

    fireEvent.submit(within(sheet).getByRole('button', { name: /^create account$/i }).closest('form')!)
    expect(within(sheet).getByRole('alert').textContent).toContain('Enter a valid email address.')
  })

  it('renders the role workbench with every capability group', async () => {
    render(<Wrapper user={currentUser(['roles.manage'])}><UsersPage /></Wrapper>)

    const rail = await screen.findByRole('complementary', { name: 'Roles' })
    // Owner is locked; the other system roles and the custom role are not.
    expect(within(rail).getByText('Owner')).toBeDefined()
    expect(within(rail).getByText('System · Locked')).toBeDefined()
    expect(within(rail).getByText('Admin')).toBeDefined()
    expect(within(rail).getByText('Ops')).toBeDefined()

    // The canonical groups, and the real capability labels — not the reference
    // bundle's fictional ones.
    for (const group of ['Dashboard', 'Site', 'Pages', 'Content', 'Data', 'Media', 'Plugins', 'Audit']) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('complementary', { name: 'Access summary' })).toBeDefined()

    // The per-group shortcut reflects the selected role: Owner holds every
    // Site capability so it offers Clear, the partial custom role offers
    // Select all.
    expect(screen.getByRole('button', { name: 'Clear Site capabilities' })).toBeDefined()
    fireEvent.click(within(rail).getByRole('button', { name: /ops/i }))
    expect(screen.getByRole('button', { name: 'Select all Site capabilities' })).toBeDefined()
  })

  it('locks the owner role and keeps save inert until something changes', async () => {
    render(<Wrapper user={currentUser(['roles.manage'])}><UsersPage /></Wrapper>)

    const rail = await screen.findByRole('complementary', { name: 'Roles' })
    fireEvent.click(within(rail).getByRole('button', { name: /owner/i }))

    expect(screen.getByRole('button', { name: 'Save role' }).hasAttribute('disabled')).toBe(true)
    // Owner is server-locked, so its name field is read-only here too.
    expect(screen.getByLabelText('Name').hasAttribute('disabled')).toBe(true)
  })

  it('renders audit events as human-readable activity rows', async () => {
    render(<Wrapper user={currentUser(['audit.read'])}><UsersPage /></Wrapper>)

    expect(await screen.findByRole('table', { name: 'Access activity' })).toBeDefined()
    expect(screen.getByText('Tester One was created')).toBeDefined()
    // The owner is the actor on more than one fixture event.
    expect(screen.getAllByText('by hello@davidbabinec.com').length).toBeGreaterThan(0)
    expect(screen.getByText('Role: Member')).toBeDefined()
    expect(screen.getByText('IP: 127.0.0.1')).toBeDefined()
    expect(screen.getByText('Failed login for missing@example.com')).toBeDefined()
    // The `unknown` sentinel is filtered rather than rendered as a chip…
    expect(screen.queryByText('IP: unknown')).toBeNull()
    // …and a raw action id never reaches the UI.
    expect(screen.queryByText('user.create')).toBeNull()
  })

  it('searches activity across titles, actors and details', async () => {
    render(<Wrapper user={currentUser(['audit.read'])}><UsersPage /></Wrapper>)

    await screen.findByRole('table', { name: 'Access activity' })
    fireEvent.change(screen.getByLabelText('Search access activity'), {
      target: { value: 'failed login' },
    })

    expect(screen.getByText('Failed login for missing@example.com')).toBeDefined()
    expect(screen.queryByText('Tester One was created')).toBeNull()
  })
})
