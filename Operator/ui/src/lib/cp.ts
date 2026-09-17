// Server-side client for the control-plane API (R14).
//
// The control plane refuses every admin route without a signed-in
// administrator, so each call forwards the session this console holds in the
// `sa_admin` cookie. The browser never calls the control plane directly.
import type { AstroCookies } from 'astro';

export const CP = 'http://127.0.0.1:4400';
export const ADMIN_COOKIE = 'sa_admin';
// A freshly minted invite link, carried across the post-redirect-get so it is
// shown once and never re-derived from the registry (NEW-1).
export const INVITE_FLASH_COOKIE = 'sa_invite_once';

/** The console's base with exactly one trailing slash: "/operator/". */
export function basePath(): string {
  const raw = import.meta.env.BASE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** Cookie path covering the console and nothing else: "/operator". */
export const cookiePath = (): string => basePath().replace(/\/$/, '');

/**
 * Secure only when the browser is on HTTPS: through the gateway the proxy
 * says so, but local access on http://127.0.0.1 must still get a cookie.
 */
export function secureCookie(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') || '';
  return proto === 'https' && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

export function sessionCookieOptions(request: Request, maxAge: number) {
  return { path: cookiePath(), httpOnly: true, sameSite: 'strict' as const, secure: secureCookie(request), maxAge };
}

/**
 * Where to go after signing in. Only a path inside this console — never a full
 * URL, never `//host` — so the login page cannot become an open redirect.
 */
export function safeNext(raw: string | null | undefined): string {
  const base = basePath();
  if (typeof raw !== 'string' || raw.startsWith('//')) return base;
  if (raw === cookiePath() || raw.startsWith(base)) return raw;
  return base;
}

export function cpFetch(cookies: AstroCookies, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = cookies.get(ADMIN_COOKIE)?.value;
  if (session) headers.set('cookie', `${ADMIN_COOKIE}=${encodeURIComponent(session)}`);
  return fetch(`${CP}${path}`, { ...init, headers });
}
