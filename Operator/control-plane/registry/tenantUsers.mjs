// The people of a project (R3, NEW-2). Each person has one hub login used for
// both tools via SSO, and a role — the CMS's own four, which the CMS enforces
// once the person arrives:
//
//   owner  — the account holder; one per project; the CMS owner account
//   admin  — "Publisher": edits and publishes
//   client — "Author": edits content, cannot publish
//   member — "Viewer"
//
// Only the invite token's keyed hash and the scrypt password hash are stored.
import { query } from './db.mjs';
import { genInviteToken, hashToken, hashPassword, verifyPassword } from '../lib/crypto.mjs';

export const ROLES = Object.freeze(['owner', 'admin', 'client', 'member']);
export const ROLE_LABELS = Object.freeze({ owner: 'Owner', admin: 'Publisher', client: 'Author', member: 'Viewer' });
/** Roles an administrator can give an invited person (the owner is set at provisioning). */
export const INVITABLE_ROLES = Object.freeze(['admin', 'client', 'member']);

const normEmail = (e) => String(e ?? '').trim().toLowerCase();

const status = (msg, code) => Object.assign(new Error(msg), { status: code });

/**
 * What inviting `email` as `role` should do, given the project's existing rows.
 * Pure, so the rule that fixes NEW-2 is testable without a database:
 *
 *   insert  — a new person; nobody's account is touched
 *   reissue — the same person is still invited; only their link is replaced
 *   refuse  — they already have access (never lock an active person out), a
 *             second owner was asked for, or the input is unusable
 */
export function planInvite(rows, email, role) {
  if (!ROLES.includes(role)) return { action: 'refuse', reason: `Unknown role "${role}"` };
  const e = normEmail(email);
  if (!e && role !== 'owner') return { action: 'refuse', reason: 'An email is required' };
  if (e && !e.includes('@')) return { action: 'refuse', reason: 'That is not an email address' };
  const live = rows.filter((r) => r.status !== 'removed');
  const same = live.find((r) => (e ? normEmail(r.email) === e : r.role === 'owner' && !normEmail(r.email)));
  if (role === 'owner') {
    const owner = live.find((r) => r.role === 'owner');
    if (owner && owner !== same) return { action: 'refuse', reason: 'This project already has an owner' };
  }
  if (same) {
    if (same.status !== 'invited') return { action: 'refuse', reason: 'That person already has access to this project' };
    if (same.role === 'owner' && role !== 'owner') {
      return { action: 'refuse', reason: "The owner's role cannot be changed" };
    }
    return { action: 'reissue', id: same.id };
  }
  return { action: 'insert' };
}

async function rowsOf(slug) {
  const { rows } = await query('select * from siteagent_control.tenant_users where tenant_slug = $1', [slug]);
  return rows;
}

/**
 * Invite a person to a project. Adds an account; never replaces one (NEW-2).
 * Returns { person, token } — the raw token is shared once and never stored.
 */
export async function invitePerson(slug, { email, role, displayName }) {
  const plan = planInvite(await rowsOf(slug), email, role);
  if (plan.action === 'refuse') throw status(plan.reason, 409);
  const token = genInviteToken();
  const e = normEmail(email) || null;
  const name = String(displayName ?? '').trim() || null;
  if (plan.action === 'insert') {
    const { rows } = await query(
      `insert into siteagent_control.tenant_users
         (tenant_slug, email, role, display_name, invite_token_hash, invite_expires_at, status)
       values ($1, $2, $3, $4, $5, null, 'invited')
       returning *`,
      [slug, e, role, name, hashToken(token)],
    );
    return { person: rows[0], token };
  }
  const { rows } = await query(
    `update siteagent_control.tenant_users
        set invite_token_hash = $2, role = $3,
            display_name = coalesce($4, display_name),
            invite_token_enc = null, invite_expires_at = null, updated_at = now()
      where id = $1 and status = 'invited'
      returning *`,
    [plan.id, hashToken(token), role, name],
  );
  if (!rows[0]) throw status('That invite changed while it was being re-issued; try again', 409);
  return { person: rows[0], token };
}

/** A fresh project (including a re-provisioned slug) starts with nobody. */
export async function resetPeople(slug) {
  await query(
    `update siteagent_control.tenant_users
        set status = 'removed', password_hash = null, invite_token_hash = null,
            invite_token_enc = null, updated_at = now()
      where tenant_slug = $1 and status <> 'removed'`,
    [slug],
  );
}

// Look up a person by a raw invite token (hash match + unexpired + invited).
export async function findByInviteToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `select * from siteagent_control.tenant_users
      where invite_token_hash = $1 and status = 'invited'
        and (invite_expires_at is null or invite_expires_at > now())`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

/** Accept an invite: set the password, activate, burn the token. Returns the person. */
export async function acceptInvite(token, password) {
  const user = await findByInviteToken(token);
  if (!user) return null;
  const { rows } = await query(
    `update siteagent_control.tenant_users
        set password_hash = $2, status = 'active',
            invite_token_hash = null, invite_token_enc = null,
            invite_expires_at = null, updated_at = now()
      where id = $1 and status = 'invited'
      returning *`,
    [user.id, hashPassword(password)],
  );
  return rows[0] || null;
}

/**
 * Every project this password opens for this identifier.
 *
 * The identifier is an email. One person can belong to several projects, with
 * a different password in each, so every candidate is checked. A bare project
 * name (no "@") is the older sign-in and matches only that project's owner.
 */
export async function validateLogin(identifier, password) {
  const id = normEmail(identifier);
  if (!id || !password) return [];
  // A removed project offers nobody a sign-in, whatever its rows say.
  const { rows } = id.includes('@')
    ? await query(
        `select u.* from siteagent_control.tenant_users u
           join siteagent_control.tenants t on t.slug = u.tenant_slug and t.status <> 'removed'
          where u.status = 'active' and lower(u.email) = $1
          order by u.tenant_slug`,
        [id],
      )
    : await query(
        `select u.* from siteagent_control.tenant_users u
           join siteagent_control.tenants t on t.slug = u.tenant_slug and t.status <> 'removed'
          where u.status = 'active' and u.tenant_slug = $1 and u.role = 'owner'`,
        [id],
      );
  return rows.filter((u) => verifyPassword(password, u.password_hash));
}

/**
 * Decide the outcome from the people whose password matched.
 *
 * Split out from the query so it can be tested without a database — this is the
 * part that decides which client's content someone sees.
 *
 * @returns {null | object | { choose: object[] }} one person, nobody, or a list
 *          to choose from (sorted by project, so the chooser is stable)
 */
export function resolveLogin(people) {
  if (people.length === 0) return null;
  if (people.length === 1) return people[0];
  // Never pick. Picking is what the old `limit 1` did, and it put a person on
  // an arbitrary one of their sites without saying so.
  return { choose: [...people].sort((a, b) => String(a.tenant_slug).localeCompare(String(b.tenant_slug))) };
}

/** The person behind a hub session, while they are still active. */
export async function findActivePerson(id) {
  if (!/^\d+$/.test(String(id ?? ''))) return null;
  const { rows } = await query(
    `select u.* from siteagent_control.tenant_users u
       join siteagent_control.tenants t on t.slug = u.tenant_slug and t.status <> 'removed'
      where u.id = $1 and u.status = 'active'`,
    [String(id)],
  );
  return rows[0] || null;
}

export async function listPeople(slug) {
  const { rows } = await query(
    `select id, tenant_slug, email, display_name, role, status, created_at, updated_at,
            invite_token_hash is not null as has_invite
       from siteagent_control.tenant_users
      where tenant_slug = $1 and status <> 'removed'
      order by case role when 'owner' then 0 when 'admin' then 1 when 'client' then 2 else 3 end, email`,
    [slug],
  );
  return rows.map(({ has_invite, ...p }) => ({ ...p, invite_pending: p.status === 'invited' && has_invite }));
}

async function personIn(slug, id) {
  if (!/^\d+$/.test(String(id ?? ''))) return null;
  const { rows } = await query(
    `select * from siteagent_control.tenant_users where tenant_slug = $1 and id = $2 and status <> 'removed'`,
    [slug, String(id)],
  );
  return rows[0] || null;
}

/**
 * Change a person's role. The owner is neither given nor taken this way.
 * Bumping `updated_at` ends their current hub session, so the new role applies
 * from their next sign-in rather than drifting.
 */
export async function setRole(slug, id, role) {
  if (!INVITABLE_ROLES.includes(role)) throw status(`Choose one of: ${INVITABLE_ROLES.join(', ')}`, 400);
  const p = await personIn(slug, id);
  if (!p) throw status('not found', 404);
  if (p.role === 'owner') throw status("The owner's role cannot be changed", 409);
  const { rows } = await query(
    `update siteagent_control.tenant_users set role = $3, updated_at = now()
      where tenant_slug = $1 and id = $2 returning *`,
    [slug, p.id, role],
  );
  return rows[0];
}

/** Remove a person: their login and any pending link stop working. Never the owner. */
export async function removePerson(slug, id) {
  const p = await personIn(slug, id);
  if (!p) throw status('not found', 404);
  if (p.role === 'owner') throw status('The owner cannot be removed', 409);
  const { rows } = await query(
    `update siteagent_control.tenant_users
        set status = 'removed', password_hash = null, invite_token_hash = null,
            invite_token_enc = null, updated_at = now()
      where tenant_slug = $1 and id = $2 returning *`,
    [slug, p.id],
  );
  return rows[0];
}

/** A new link for someone still invited. Returns { person, token }. */
export async function reissueInvite(slug, id) {
  const p = await personIn(slug, id);
  if (!p) throw status('not found', 404);
  if (p.status !== 'invited') throw status('That person has already accepted their invite', 409);
  return invitePerson(slug, { email: p.email, role: p.role, displayName: p.display_name });
}

/** Everyone the CMS should know about, with what they may do there. */
export async function peopleForSync(slug) {
  const { rows } = await query(
    `select email, role, status from siteagent_control.tenant_users
      where tenant_slug = $1 and email is not null and role <> 'owner'`,
    [slug],
  );
  return rows.map((r) => ({ email: normEmail(r.email), role: r.role, status: r.status === 'active' ? 'active' : 'removed' }));
}

/**
 * Step-up for a portal person: is this their current hub password? By person
 * id, because an owner may have no email on record.
 */
export async function verifyPersonPassword(slug, personId, password) {
  if (!/^\d+$/.test(String(personId ?? '')) || !password) return false;
  const { rows } = await query(
    `select password_hash from siteagent_control.tenant_users
      where tenant_slug = $1 and id = $2 and status = 'active'`,
    [slug, String(personId)],
  );
  return rows.some((r) => verifyPassword(password, r.password_hash));
}
