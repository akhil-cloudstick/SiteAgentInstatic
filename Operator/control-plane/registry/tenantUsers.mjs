// Tenant hub identity — the single login a tenant uses for BOTH tools (via SSO).
// One row per tenant (the owner's hub account). Only the invite token's keyed hash
// and the scrypt password hash are ever stored.
import { query } from './db.mjs';
import { genInviteToken, hashToken, hashPassword, verifyPassword, encrypt } from '../lib/crypto.mjs';

// Create/replace the tenant's hub user and mint a fresh one-time invite token.
// Returns the RAW token (share it once); only its hash + an encrypted copy persist.
// Invite links do NOT expire — they stay valid until accepted (or regenerated),
// so a link the operator shared can't go stale on its own.
export async function createInvite(tenantSlug, email) {
  const token = genInviteToken();
  await query(
    `insert into siteagent_control.tenant_users
       (tenant_slug, email, invite_token_hash, invite_token_enc, invite_expires_at, status)
     values ($1,$2,$3,$4, null, 'invited')
     on conflict (tenant_slug) do update set
       email = coalesce(excluded.email, siteagent_control.tenant_users.email),
       invite_token_hash = excluded.invite_token_hash,
       invite_token_enc = excluded.invite_token_enc,
       invite_expires_at = null,
       status = 'invited',
       updated_at = now()`,
    [tenantSlug, email || null, hashToken(token), encrypt(token)],
  );
  return token;
}

// Look up a tenant_user by a raw invite token (hash match + unexpired + invited).
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

// Accept an invite: set the password, activate, and burn the token. Returns slug.
export async function acceptInvite(token, password) {
  const user = await findByInviteToken(token);
  if (!user) return null;
  await query(
    `update siteagent_control.tenant_users
        set password_hash = $2, status = 'active',
            invite_token_hash = null, invite_token_enc = null,
            invite_expires_at = null, updated_at = now()
      where id = $1`,
    [user.id, hashPassword(password)],
  );
  return user.tenant_slug;
}

/**
 * Validate a login. The identifier may be the email OR the tenant slug.
 *
 * One person can own more than one site — the same address is the owner of two
 * tenants the moment an agency runs a second client through us. The previous
 * query took `limit 1` with no ordering, so that person's email matched an
 * arbitrary row and they landed on whichever site Postgres returned first. Not
 * an error, not a wrong password: the wrong site, silently, and a different one
 * on another day.
 *
 * A tenant slug is unique, so it is never ambiguous. Only an email can be, and
 * when it is, the honest answer is to say so and name the way through rather
 * than to pick. Returns:
 *
 *   { slug }        — signed in
 *   null            — no match, or wrong password
 *   { ambiguous }   — the password was right for several sites; ask which
 */
export async function validateLogin(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id || !password) return null;
  const { rows } = await query(
    `select * from siteagent_control.tenant_users
      where status = 'active' and (lower(email) = $1 or tenant_slug = $1)
      order by tenant_slug`,
    [id],
  );
  // Checked against every candidate, because two sites owned by one person can
  // have different passwords — matching only the first would reject a correct
  // one for the second site.
  const matches = rows.filter((u) => verifyPassword(password, u.password_hash));
  return resolveLogin(matches.map((u) => u.tenant_slug));
}

/**
 * Decide the outcome from the slugs whose password matched.
 *
 * Split out from the query so it can be tested without a database — this is the
 * part that decides which client's content someone sees, and it is three lines
 * that are easy to get subtly wrong.
 *
 * @param {string[]} slugs tenants whose stored password matched
 * @returns {string | null | { ambiguous: string[] }}
 */
export function resolveLogin(slugs) {
  if (slugs.length === 0) return null;
  if (slugs.length === 1) return slugs[0];
  // Never pick. Picking is what the old `limit 1` did, and it put a person on
  // an arbitrary one of their sites without saying so.
  return { ambiguous: [...slugs].sort() };
}

export async function getTenantUser(tenantSlug) {
  const { rows } = await query(
    'select * from siteagent_control.tenant_users where tenant_slug = $1', [tenantSlug],
  );
  return rows[0] || null;
}
