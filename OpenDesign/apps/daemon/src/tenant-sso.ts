// Tenant SSO for multi-tenant hosting.
//
// When the SiteAgent control-plane spawns this daemon per tenant it sets
// OD_SSO_SECRET (a shared HMAC secret) and OD_TENANT_SLUG. In that mode the
// human-facing surface (the SPA, /artifacts, /frames) requires a tenant session:
// the hub redirects the tenant to `/sso?token=<control-plane-signed>`, this module
// validates it, and the daemon sets an `od_session` cookie. `/api` keeps its own
// bearer/origin auth (untouched). Plain local dev (no OD_SSO_SECRET) is unaffected.
//
// The token format mirrors the control-plane's signValue():
//   base64url(JSON incl. `exp` in ms) + "." + base64url(HMAC-SHA256(base64url part)).
import { createHmac, timingSafeEqual } from 'node:crypto';

function hmacB64(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function ssoSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OD_SSO_SECRET ?? '').trim();
}

export function tenantSsoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ssoSecret(env).length > 0;
}

// Sign a short-lived hand-off token for the tenant's Instatic (target 'instatic').
// Used by "Share to CMS" to open an Owner session on Instatic before pushing.
export function signInstaticSsoToken(slug: string, ttlSec = 120): string {
  const b64 = Buffer.from(
    JSON.stringify({ sub: slug, target: 'instatic', kind: 'sso', exp: Date.now() + ttlSec * 1000 }),
    'utf8',
  ).toString('base64url');
  return `${b64}.${hmacB64(ssoSecret(), b64)}`;
}

interface SignedPayload {
  sub: string;
  kind: string;
  exp: number;
  target?: string;
}

function verifySigned(token: string, wantKind: string): SignedPayload | null {
  const secret = ssoSecret();
  if (!secret || !token || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const b64 = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const a = Buffer.from(mac);
  const b = Buffer.from(hmacB64(secret, b64));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (payload.kind !== wantKind) return null;
  return payload;
}

// Mint an od_session cookie value (signed, expiring) for a tenant slug.
export function signSession(sub: string, ttlSec = 7 * 24 * 3600): string {
  const b64 = Buffer.from(
    JSON.stringify({ sub, kind: 'od', exp: Date.now() + ttlSec * 1000 }),
    'utf8',
  ).toString('base64url');
  return `${b64}.${hmacB64(ssoSecret(), b64)}`;
}

export function verifySession(cookieVal: string | undefined): SignedPayload | null {
  return cookieVal ? verifySigned(cookieVal, 'od') : null;
}

// Validate the control-plane hand-off token (kind 'sso', target 'od', matching slug).
export function verifyCpSsoToken(token: string): SignedPayload | null {
  const p = verifySigned(token, 'sso');
  if (!p || p.target !== 'od') return null;
  const slug = (process.env.OD_TENANT_SLUG ?? '').trim();
  if (slug && p.sub !== slug) return null;
  return p;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const SESSION_MAX_AGE_SEC = 7 * 24 * 3600;
