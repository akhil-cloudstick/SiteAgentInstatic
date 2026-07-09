// Encryption for settings-at-rest + signed per-tenant gateway tokens. Built-ins only.
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual, scryptSync } from 'node:crypto';
import config from './env.mjs';

// AES-256-GCM. Returns base64(iv[12] | tag[16] | ciphertext), or null for empty.
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', config.encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Per-tenant gateway token: "<slug>.<hmac>". The gateway validates this so a
// leaked gateway URL can't be replayed for a different tenant.
export function signTenantToken(slug) {
  const mac = createHmac('sha256', config.tokenSecret).update(`tenant:${slug}`).digest('hex');
  return `${slug}.${mac}`;
}

export function verifyTenantToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const slug = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac('sha256', config.tokenSecret).update(`tenant:${slug}`).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return slug;
}

export const genPassword = (n = 18) => randomBytes(n).toString('base64url');
export const genSecretKeyHex = () => randomBytes(32).toString('hex');

// --- Tenant-user password hashing (scrypt). Stored as "scrypt$<saltHex>$<hashHex>". ---
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- One-time invite tokens: return the raw token (shared once) + its keyed hash
// (the only thing persisted, so a registry leak can't be replayed as an invite). ---
export const genInviteToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) =>
  createHmac('sha256', config.tokenSecret).update(`invite:${token}`).digest('hex');

// --- Signed, EXPIRING tokens for hub sessions AND SSO hand-offs. ---
// Format: base64url(JSON payload incl. `exp`) + "." + hmac. verifyValue returns the
// payload only when the signature is valid AND unexpired, else null.
export function signValue(payload, ttlSec = 3600) {
  const body = JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 });
  const b64 = Buffer.from(body, 'utf8').toString('base64url');
  const mac = createHmac('sha256', config.tokenSecret).update(b64).digest('base64url');
  return `${b64}.${mac}`;
}

export function verifyValue(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const b64 = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac('sha256', config.tokenSecret).update(b64).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}
