// Create an operator console administrator, or reset one's password (R14),
// optionally scoped to one Operator or one Business (R1).
//
//   npm run admin:create -- --email <email>                         (platform)
//   npm run admin:create -- --email <email> --operator <slug>
//   npm run admin:create -- --email <email> --business <slug>
//   npm run admin:create -- --email <email> --disable
//
// Run from Operator/. The password is generated here and printed exactly once;
// only its scrypt hash is stored. Re-running for the same email issues a new
// password and signs that admin out everywhere; without a scope flag the
// existing scope is kept. The schema is applied first, so this works on a fresh
// database before the control plane has ever booted.
import { migrate, close } from './db.mjs';
import { upsertAdmin, disableAdminByEmail } from './adminUsers.mjs';
import { getOperatorBySlug, getBusinessBySlug } from './org.mjs';
import { genPassword } from '../lib/crypto.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = String(flag('email') || '').trim().toLowerCase();

async function scopeFromFlags() {
  const op = flag('operator');
  const biz = flag('business');
  if (op && biz) throw new Error('Use --operator or --business, not both');
  if (op) {
    const o = await getOperatorBySlug(op);
    if (!o) throw new Error(`No operator "${op}"`);
    return { level: 'operator', operatorId: String(o.id), label: `operator ${o.name}` };
  }
  if (biz) {
    const b = await getBusinessBySlug(biz);
    if (!b) throw new Error(`No business "${biz}"`);
    return { level: 'business', businessId: String(b.id), label: `business ${b.name}` };
  }
  if (args.includes('--platform')) return { level: 'platform', label: 'the platform' };
  return null;
}

try {
  if (!email || !email.includes('@')) {
    throw new Error('Usage: npm run admin:create -- --email <email> [--operator <slug> | --business <slug> | --platform] [--disable]');
  }
  await migrate();
  if (args.includes('--disable')) {
    const row = await disableAdminByEmail(email);
    if (!row) throw new Error(`No administrator ${email}`);
    console.log(`[admin] ${email} is disabled; every session it held has ended.`);
  } else {
    const scope = await scopeFromFlags();
    const password = genPassword(18);
    const row = await upsertAdmin(email, password, scope);
    const where = scope ? scope.label : `its existing scope (${row.scope_level})`;
    console.log(`[admin] ${email} can now sign in at <gateway>/operator/login, scoped to ${where}`);
    console.log(`[admin] password (shown once, store it now): ${password}`);
  }
} catch (e) {
  console.error('[admin] FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
