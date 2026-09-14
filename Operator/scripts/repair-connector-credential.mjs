/**
 * Repair a tenant's CONNECTOR credential after its owner email changed.
 *
 *   node scripts/repair-connector-credential.mjs <slug> [cms-email]
 *
 * Two different identities share one row and are easy to conflate:
 *
 *   owner_email      — the HUB login (who signs in at /login to open the CMS)
 *   connector_email  — the CMS login the connector authenticates with
 *
 * `owner_password_enc` is the password of the Instatic user created at
 * provisioning, and that user's email is fixed at seed time. Changing
 * `owner_email` afterwards — to hand a site to a real person, say — renames
 * nothing inside Instatic, so the registry ends up pairing a NEW email with an
 * OLD password. The connector then fails to log in, and the failure looks like
 * a wrong password rather than a mismatched pair.
 *
 * This repairs it by pinning the connector to the CMS user that the stored
 * password actually belongs to, leaving the hub identity alone. It VERIFIES the
 * login before writing, because storing a credential that does not work just
 * moves the failure later.
 *
 * Defaults the CMS email to `<slug>@tenant.local`, which is what
 * `seedInstaticOwner` uses when a tenant is provisioned without an owner email.
 */
import { query, close } from '../control-plane/registry/db.mjs';
import { decrypt } from '../control-plane/lib/crypto.mjs';

const slug = process.argv[2];
const cmsEmail = process.argv[3] || (slug ? `${slug}@tenant.local` : null);

if (!slug) {
  console.error('Usage: node scripts/repair-connector-credential.mjs <slug> [cms-email]');
  process.exit(1);
}

try {
  const { rows } = await query(
    `select slug, port, owner_email, connector_email, owner_password_enc
       from siteagent_control.tenants where slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (!row) throw new Error(`Unknown tenant "${slug}".`);
  if (!row.port) throw new Error(`Tenant "${slug}" has no port — is it provisioned?`);
  if (!row.owner_password_enc) throw new Error(`Tenant "${slug}" has no stored password to repair from.`);

  const password = decrypt(row.owner_password_enc);
  if (!password) throw new Error('Stored password did not decrypt.');

  console.log(`hub owner_email      : ${row.owner_email}`);
  console.log(`testing CMS login as : ${cmsEmail}  (on port ${row.port})`);

  // Verified BEFORE writing. A credential that stores but cannot log in fails
  // later, at connect time, looking like a wrong password rather than a bad
  // repair.
  const res = await fetch(`http://127.0.0.1:${row.port}/cms/api/cms/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cmsEmail, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `CMS login as "${cmsEmail}" failed (HTTP ${res.status}) ${body.slice(0, 160)}\n` +
        `Nothing was written. Pass the correct CMS email as the second argument.`,
    );
  }
  console.log(`CMS login            : OK (HTTP ${res.status})`);

  await query(
    `update siteagent_control.tenants
        set connector_email = $2, connector_password_enc = owner_password_enc, updated_at = now()
      where slug = $1`,
    [slug, cmsEmail],
  );
  console.log(`\nStored connector account for "${slug}": ${cmsEmail}`);
  console.log('The hub owner email is unchanged — the two identities are now separate.');
  console.log('Restart the stack for the connector to pick it up.');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
