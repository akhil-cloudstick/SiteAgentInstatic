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

// Validate a login. The identifier may be the email OR the tenant slug.
export async function validateLogin(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id || !password) return null;
  const { rows } = await query(
    `select * from siteagent_control.tenant_users
      where status = 'active' and (lower(email) = $1 or tenant_slug = $1)
      limit 1`,
    [id],
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return user.tenant_slug;
}

export async function getTenantUser(tenantSlug) {
  const { rows } = await query(
    'select * from siteagent_control.tenant_users where tenant_slug = $1', [tenantSlug],
  );
  return rows[0] || null;
}
