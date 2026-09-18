/**
 * Undo an unaccepted invite — put a tenant's hub login back to `active`.
 *
 *   node scripts/restore-tenant-login.mjs <slug>
 *
 * Since Phase 1 a re-invite of an active person is refused, so this is only
 * needed for rows left behind by the older invite flow. It acts on the
 * project's OWNER row only.
 *
 * Why this exists: the old `createTenantInvite()` set `status = 'invited'` so the
 * invite flow can run, and `validateLogin()` only matches `status = 'active'`.
 * So minting an invite link for an account that already has a password LOCKS
 * THAT PERSON OUT until they accept it — their password is still stored and
 * still correct, but the row is invisible to login.
 *
 * That is a reasonable design for a genuine re-invite. It is a trap when the
 * link was generated to inspect an account and never used, which leaves a
 * working login broken with no obvious cause: the password is right, the
 * account exists, and the hub still says "Wrong email/account or password."
 *
 * This restores the row without touching `password_hash`, so the existing
 * password keeps working and nobody has to be told to reset anything. The
 * pending invite token is cleared at the same time — leaving a live token for a
 * login that no longer needs one is a credential nobody is tracking.
 *
 * Refuses when the account has no password: there is nothing to restore to, and
 * flipping it to `active` would produce a row that can never authenticate. Send
 * a real invite instead.
 */

import { query, close } from '../control-plane/registry/db.mjs';

const slug = (process.argv[2] ?? '').trim();
if (!slug) {
  console.error('Usage: node scripts/restore-tenant-login.mjs <slug>');
  process.exit(1);
}

const { rows: before } = await query(
  `select tenant_slug, email, status,
          (password_hash is not null)     as has_password,
          (invite_token_hash is not null) as invite_pending
     from siteagent_control.tenant_users
    where tenant_slug = $1 and role = 'owner' and status <> 'removed'`,
  [slug],
);

const user = before[0];
if (!user) {
  console.error(`No hub account for tenant "${slug}".`);
  await close();
  process.exit(1);
}

console.log(`before: status=${user.status} password_set=${user.has_password} invite_pending=${user.invite_pending}`);

if (!user.has_password) {
  console.error(
    `\n"${slug}" has no password set, so there is no login to restore.\n` +
      `Generate an invite and have the owner set one.`,
  );
  await close();
  process.exit(1);
}

if (user.status === 'active' && !user.invite_pending) {
  console.log('\nAlready active with no pending invite — nothing to do.');
  await close();
  process.exit(0);
}

await query(
  `update siteagent_control.tenant_users
      set status = 'active',
          invite_token_hash = null,
          invite_token_enc = null,
          invite_expires_at = null,
          updated_at = now()
    where tenant_slug = $1 and role = 'owner' and status <> 'removed'`,
  [slug],
);

const { rows: after } = await query(
  `select status,
          (password_hash is not null)     as has_password,
          (invite_token_hash is not null) as invite_pending
     from siteagent_control.tenant_users
    where tenant_slug = $1 and role = 'owner' and status <> 'removed'`,
  [slug],
);

const now = after[0];
console.log(`after : status=${now.status} password_set=${now.has_password} invite_pending=${now.invite_pending}`);
console.log(
  `\n"${slug}" can log in again with its existing password. Any invite link\n` +
    `previously generated for it is now dead.`,
);
console.log(
  `\nIf one email belongs to more than one project, the hub asks which one after\n` +
    `sign-in. The owner can also sign in with the project name ("${slug}").`,
);

await close();
