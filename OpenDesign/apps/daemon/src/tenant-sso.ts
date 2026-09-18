// Tenant SSO for multi-tenant hosting.
//
// When the SiteAgent control-plane spawns this daemon per tenant it sets
// OD_SSO_SECRET (this project's own HMAC key, derived by the control plane from
// its master key — useless for any other project) and OD_TENANT_SLUG. In that mode the
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

// MMS Phase 1: a hand-off names the PERSON and their role (one of the CMS's
// four roles). Design has no roles of its own; the session records who is
// working ("Design as that role") and the CMS enforces the role on import.
export const HUB_ROLES = ['owner', 'admin', 'client', 'member'] as const;

export interface HubPerson {
  id: string;
  email: string | null;
  role: (typeof HUB_ROLES)[number];
  name?: string | null;
}

function isHubPerson(value: unknown): value is HubPerson {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' && /^[0-9]+$/.test(p.id) &&
    (p.email === null || typeof p.email === 'string') &&
    typeof p.role === 'string' && (HUB_ROLES as readonly string[]).includes(p.role)
  );
}

// A machine hand-off for the tenant's Instatic (target 'instatic'), used only
// by "Share to CMS" for its SERVER-SIDE staging call: an owner session with
// step-up open, because the daemon has no password to re-enter. A person is
// never handed one — the browser goes through the hub and arrives in the CMS
// as themselves (see server.ts, share-to-cms).
export function signInstaticMachineToken(slug: string, ttlSec = 120): string {
  const b64 = Buffer.from(
    JSON.stringify({ sub: slug, target: 'instatic', kind: 'sso', actor: 'machine', exp: Date.now() + ttlSec * 1000 }),
    'utf8',
  ).toString('base64url');
  return `${b64}.${hmacB64(ssoSecret(), b64)}`;
}

interface SignedPayload {
  sub: string;
  kind: string;
  exp: number;
  target?: string;
  person?: HubPerson;
  pid?: string;
  role?: string;
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

// Mint an od_session cookie value (signed, expiring) for a tenant slug and the
// person who opened it.
export function signSession(sub: string, person: HubPerson, ttlSec = 7 * 24 * 3600): string {
  const b64 = Buffer.from(
    JSON.stringify({ sub, kind: 'od', pid: person.id, role: person.role, exp: Date.now() + ttlSec * 1000 }),
    'utf8',
  ).toString('base64url');
  return `${b64}.${hmacB64(ssoSecret(), b64)}`;
}

// A session from before Phase 1 names no person and is treated as signed out;
// the hub re-signs the person in silently.
export function verifySession(cookieVal: string | undefined): SignedPayload | null {
  const p = cookieVal ? verifySigned(cookieVal, 'od') : null;
  return p && typeof p.pid === 'string' && typeof p.role === 'string' ? p : null;
}

// Validate the control-plane hand-off token (kind 'sso', target 'od', matching
// slug, naming a person). A token without a person is the pre-Phase-1 shape.
export function verifyCpSsoToken(token: string): (SignedPayload & { person: HubPerson }) | null {
  const p = verifySigned(token, 'sso');
  if (!p || p.target !== 'od' || !isHubPerson(p.person)) return null;
  const slug = (process.env.OD_TENANT_SLUG ?? '').trim();
  if (slug && p.sub !== slug) return null;
  return p as SignedPayload & { person: HubPerson };
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
