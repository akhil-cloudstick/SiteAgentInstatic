// Operator console authentication (R14).
//
// Every admin/operator action requires a signed-in administrator. The session is
// a signed, expiring value (lib/crypto.mjs signValue) that the Astro console
// keeps in the `sa_admin` cookie and forwards on its server-side calls here.
//
// There is deliberately NO loopback exemption: the Tailscale funnel delivers
// public traffic to this server over loopback, so "came from 127.0.0.1" says
// nothing about who is asking.
import { timingSafeEqual } from 'node:crypto';
import { signValue, verifyValue } from './crypto.mjs';
import { findActiveAdmin } from '../registry/adminUsers.mjs';
import { scopeOf } from './scope.mjs';

export const ADMIN_COOKIE = 'sa_admin';
export const ADMIN_SESSION_TTL_SEC = 12 * 3600;

// Constant-time, and length-guarded because timingSafeEqual throws on a length
// mismatch — which would otherwise be a 500 that leaks the expected length.
export function tokenMatches(presented, expected) {
  if (!presented || !expected || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

export function parseCookieHeader(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* malformed: skip */ }
  });
  return out;
}

const versionOf = (admin) => new Date(admin.updated_at).getTime();

/** Sign a session for an admin row ({ id, updated_at }). */
export function signAdminSession(admin) {
  return signValue({ sub: String(admin.id), kind: 'admin', v: versionOf(admin) }, ADMIN_SESSION_TTL_SEC);
}

/**
 * The { id, v } a session token carries, or null. `kind` must be 'admin': the
 * tenant hub and SSO hand-offs are signed with the same secret, and a tenant's
 * `sa_hub` cookie must never pass as an administrator.
 */
export function readAdminSession(token) {
  const p = verifyValue(token);
  if (!p || p.kind !== 'admin' || typeof p.sub !== 'string' || typeof p.v !== 'number') return null;
  return { id: p.sub, v: p.v };
}

/**
 * The signed-in admin for a request, or null. The row must still be active and
 * unchanged since the session was signed — a password reset or a disable ends
 * every earlier session.
 */
export async function currentAdmin(req, find = findActiveAdmin) {
  const s = readAdminSession(parseCookieHeader(req.headers.cookie)[ADMIN_COOKIE]);
  if (!s) return null;
  const admin = await find(s.id);
  if (!admin || versionOf(admin) !== s.v) return null;
  // The scope is read from the row on every request, never from the cookie,
  // so narrowing an administrator applies at once.
  return { id: String(admin.id), email: admin.email, scope: scopeOf(admin) };
}

// Routes this server owns that act as, or read for, the operator. Anything
// under /api/ that is NOT listed falls through to the tenant proxy (the OD
// daemon and Instatic own those), so this is an explicit list, not a prefix.
const ADMIN_EXACT = new Set([
  '/api/settings',
  '/api/ai-guidance-default',
  '/api/models',
  '/api/tenants',
  '/api/admin/session',
  '/api/org',
  '/api/operators',
  '/api/businesses',
  '/api/admins',
  '/api/act-as',
  '/api/audit',
  '/api/ai-spend',
]);
const ADMIN_PREFIXES = ['/api/tenants/', '/api/mcp/', '/api/operators/', '/api/businesses/', '/api/admins/', '/api/act-as/'];

/** Routes under /api/ this server answers without an admin session. */
export const OPEN_API_PATHS = Object.freeze([
  '/api/health', // liveness only; the detail is admin-only
  '/api/connector/targets', // its own bearer (MMS_CONNECTOR_MCP_TOKEN)
  '/api/admin/login', // the way in
  '/api/admin/accept', // an invited administrator sets a password (token-authenticated)
]);

export function isAdminApiPath(path) {
  return ADMIN_EXACT.has(path) || ADMIN_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * The Connector's bearer may create a site, and nothing else: POST /api/tenants
 * is the one admin route it calls (its create_site tool).
 */
export function connectorMayCall(method, path, req, expected = process.env.MMS_CONNECTOR_MCP_TOKEN) {
  if (method !== 'POST' || path !== '/api/tenants') return false;
  const want = String(expected || '').trim();
  const presented = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return !!want && tokenMatches(presented, want);
}

// ---- Login throttle ---------------------------------------------------------
// Per email, in memory: MAX_FAILS wrong passwords inside WINDOW_MS lock that
// email for LOCK_MS. Keyed by email, not IP — every request reaches this server
// from the console on loopback, so the IP says nothing.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const attempts = new Map(); // email -> { fails: number[], lockedUntil: number }

const keyOf = (email) => String(email || '').trim().toLowerCase();

/** Milliseconds the email stays locked, or 0. */
export function loginLockedFor(email, now = Date.now()) {
  const a = attempts.get(keyOf(email));
  return a && a.lockedUntil > now ? a.lockedUntil - now : 0;
}

export function recordLoginFailure(email, now = Date.now()) {
  const k = keyOf(email);
  const a = attempts.get(k) || { fails: [], lockedUntil: 0 };
  a.fails = a.fails.filter((t) => now - t < WINDOW_MS);
  a.fails.push(now);
  if (a.fails.length >= MAX_FAILS) {
    a.lockedUntil = now + LOCK_MS;
    a.fails = [];
  }
  attempts.set(k, a);
}

export function clearLoginFailures(email) {
  attempts.delete(keyOf(email));
}
