// Encryption for settings-at-rest + signed per-tenant gateway tokens. Built-ins only.
import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
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
