/**
 * Store a tenant's Instatic owner password in the registry, encrypted.
 *
 *   node scripts/set-tenant-password.mjs <slug>
 *
 * The password is read from the TENANT_PASSWORD environment variable, never
 * from an argument. An argument lands in shell history and in the process list
 * on a shared box — the same reason the connector refuses a token passed that
 * way. Set it with a prompt that does not echo:
 *
 *   $p = Read-Host "Instatic password" -AsSecureString
 *   $env:TENANT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
 *     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p))
 *   node scripts/set-tenant-password.mjs akhil
 *   Remove-Item Env:TENANT_PASSWORD
 *
 * Why this exists: tenants provisioned by the current saga store their owner
 * credential, but older ones — and any whose owner set their own password
 * through an invite — have none. Without it the connector cannot log in to that
 * tenant, and `dev.mjs` silently leaves it off the target list.
 */
import { query, close } from '../control-plane/registry/db.mjs';
import { encrypt, decrypt } from '../control-plane/lib/crypto.mjs';

const slug = process.argv[2];
// An email argument stores the CONNECTOR account instead of the owner's. That
// is the preferred shape: a shared machine identity should not be a person's
// login, or their lockouts become outages and their password changes become
// silent breakages.
const connectorEmail = process.argv[3];
const password = process.env.TENANT_PASSWORD;

if (!slug) {
  console.error('Usage: node scripts/set-tenant-password.mjs <slug> [connector-email]');
  console.error('       password in $env:TENANT_PASSWORD');
  console.error('       with an email: stores the connector account. without: stores the owner password.');
  process.exit(1);
}
if (!password) {
  console.error('TENANT_PASSWORD is not set. See the header of this file for a prompt that does not echo.');
  process.exit(1);
}

try {
  const { rows } = await query(
    'select slug, owner_email, (owner_password_enc is not null) as had_password from siteagent_control.tenants where slug = $1',
    [slug],
  );
  if (rows.length === 0) throw new Error(`Unknown tenant "${slug}".`);

  const enc = encrypt(password);
  // Read it straight back rather than trusting the write: a credential that
  // stored but cannot be decrypted fails later, at connect time, looking like
  // a wrong password rather than a broken record.
  if (decrypt(enc) !== password) throw new Error('Encrypted value did not decrypt back — refusing to store it.');

  if (connectorEmail) {
    await query(
      'update siteagent_control.tenants set connector_email = $2, connector_password_enc = $3, updated_at = now() where slug = $1',
      [slug, connectorEmail, enc],
    );
    console.log(`Stored connector account for "${slug}": ${connectorEmail}`);
  } else {
    await query(
      'update siteagent_control.tenants set owner_password_enc = $2, updated_at = now() where slug = $1',
      [slug, enc],
    );
    console.log(`Stored owner password for "${slug}" (${rows[0].owner_email ?? 'no email on record'}).`);
    console.log(rows[0].had_password ? 'Replaced the previous credential.' : 'No credential was stored before.');
  }
  console.log('Restart the stack for the connector to pick it up as a target.');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
