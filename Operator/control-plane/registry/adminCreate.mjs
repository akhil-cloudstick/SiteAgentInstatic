// Create an operator console administrator, or reset one's password (R14).
//
//   npm run admin:create -- --email <email>             (run from Operator/)
//   npm run admin:create -- --email <email> --disable
//
// The password is generated here and printed exactly once; only its scrypt hash
// is stored. Re-running for the same email issues a new password and signs that
// admin out everywhere. The schema is applied first, so this works on a fresh
// database before the control plane has ever booted.
import { migrate, close } from './db.mjs';
import { upsertAdmin, disableAdmin } from './adminUsers.mjs';
import { genPassword } from '../lib/crypto.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = String(flag('email') || '').trim().toLowerCase();

try {
  if (!email || !email.includes('@')) {
    throw new Error('Usage: npm run admin:create -- --email <email> [--disable]');
  }
  await migrate();
  if (args.includes('--disable')) {
    const row = await disableAdmin(email);
    if (!row) throw new Error(`No administrator ${email}`);
    console.log(`[admin] ${email} is disabled; every session it held has ended.`);
  } else {
    const password = genPassword(18);
    await upsertAdmin(email, password);
    console.log(`[admin] ${email} can now sign in at <gateway>/operator/login`);
    console.log(`[admin] password (shown once, store it now): ${password}`);
  }
} catch (e) {
  console.error('[admin] FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
