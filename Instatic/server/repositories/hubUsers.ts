/**
 * CMS accounts for people who arrive from the Product Hub (MMS Phase 1).
 *
 * The hub is the identity provider: it names the person and their role (one of
 * the four CMS roles) in a signed hand-off, and this module maps that onto a
 * CMS account the CMS's own capability checks then govern on every request.
 *
 *  - The hub's `owner` is the project's single owner account.
 *  - Anyone else gets an account of their own, created on first arrival and
 *    marked `auth_source = 'hub'`: it has no usable local password, and its
 *    role follows the hub.
 *  - A local account (made in the CMS itself) is never taken over by a hub
 *    hand-off, whatever its email.
 */
import { randomBytes } from 'node:crypto'
import { placeholder, type DbClient } from '../db/client'
import { hashPassword } from '../auth/tokens'
import { createUser, findActiveOwner, UserMutationError } from './users'
import type { HubPerson, PeopleSync } from '../auth/tenantSso'

export type HubAccountResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string }

interface AccountRow {
  id: string
  role_id: string
  status: string
  auth_source: string
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

async function findAccount(db: DbClient, email: string): Promise<AccountRow | null> {
  const { rows } = await db.unsafe<AccountRow>(
    `select id, role_id, status, auth_source
       from users
      where email_normalized = ${placeholder(db.dialect, 1)}
        and deleted_at is null
      limit 1`,
    [normalizeEmail(email)],
  )
  return rows[0] ?? null
}

async function revokeUserSessions(db: DbClient, userId: string): Promise<void> {
  await db.unsafe(
    `update sessions set revoked_at = current_timestamp
      where user_id = ${placeholder(db.dialect, 1)} and revoked_at is null`,
    [userId],
  )
}

/** A password nobody knows: hub accounts sign in only through the hub. */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(48).toString('base64url'))
}

export async function resolveHubAccount(db: DbClient, person: HubPerson): Promise<HubAccountResult> {
  if (person.role === 'owner') {
    const owner = await findActiveOwner(db)
    if (!owner) return { ok: false, status: 409, message: 'This workspace is not set up yet.' }
    return { ok: true, userId: owner.id }
  }

  const email = (person.email ?? '').trim()
  if (!email.includes('@')) {
    return { ok: false, status: 400, message: 'Your hub account has no email address. Ask your operator to add one.' }
  }

  let account = await findAccount(db, email)
  if (!account) {
    try {
      const created = await createUser(db, {
        email,
        displayName: (person.name ?? '').trim(),
        passwordHash: await unusablePasswordHash(),
        roleId: person.role,
        status: 'active',
      })
      await db.unsafe(
        `update users set auth_source = 'hub' where id = ${placeholder(db.dialect, 1)}`,
        [created.id],
      )
      return { ok: true, userId: created.id }
    } catch (error) {
      // Two first arrivals at once: the other one created it. Re-read below.
      account = await findAccount(db, email)
      if (!account) {
        const message = error instanceof UserMutationError ? error.message : 'Could not create your CMS account.'
        return { ok: false, status: 500, message }
      }
    }
  }

  if (account.auth_source !== 'hub') {
    return {
      ok: false,
      status: 409,
      message: 'This email already belongs to an account managed inside the CMS. Ask your operator to invite you with a different email.',
    }
  }

  // The hub is authoritative for a hub account's role and standing.
  if (account.role_id !== person.role || account.status !== 'active') {
    await db.unsafe(
      `update users
          set role_id = ${placeholder(db.dialect, 1)},
              status = 'active',
              updated_at = current_timestamp
        where id = ${placeholder(db.dialect, 2)}`,
      [person.role, account.id],
    )
  }
  return { ok: true, userId: account.id }
}

/**
 * Apply the control plane's people list: hub accounts take the listed role;
 * a hub account that is not listed as active is suspended and signed out.
 * Local accounts and the owner are never touched.
 */
export async function syncHubPeople(
  db: DbClient,
  people: PeopleSync['people'],
): Promise<{ updated: number; suspended: number }> {
  const wanted = new Map<string, PeopleSync['people'][number]>()
  for (const p of people) {
    if (p.role !== 'owner') wanted.set(normalizeEmail(p.email), p)
  }
  const { rows } = await db.unsafe<AccountRow & { email_normalized: string }>(
    `select id, email_normalized, role_id, status, auth_source
       from users
      where auth_source = 'hub' and deleted_at is null and role_id <> 'owner'`,
    [],
  )
  let updated = 0
  let suspended = 0
  for (const row of rows) {
    const p = wanted.get(row.email_normalized)
    if (p && p.status === 'active') {
      if (row.role_id !== p.role) {
        await db.unsafe(
          `update users set role_id = ${placeholder(db.dialect, 1)}, updated_at = current_timestamp
            where id = ${placeholder(db.dialect, 2)}`,
          [p.role, row.id],
        )
        // A narrower role applies to live sessions at once: capabilities are
        // read from the role on every request.
        updated++
      }
      continue
    }
    if (row.status !== 'suspended') {
      await db.unsafe(
        `update users set status = 'suspended', updated_at = current_timestamp
          where id = ${placeholder(db.dialect, 1)}`,
        [row.id],
      )
      suspended++
    }
    await revokeUserSessions(db, row.id)
  }
  return { updated, suspended }
}
