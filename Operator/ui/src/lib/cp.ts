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

// ---------------------------------------------------------------------------
// CSRF (security item E7)
// ---------------------------------------------------------------------------

/**
 * Origins allowed to make a state-changing request to the console when it is
 * reached directly rather than through the gateway.
 */
const LOOPBACK_ORIGINS = new Set([
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]);

const stripSlash = (value: string): string => value.replace(/\/+$/, '');

/**
 * The public origin this console is served on, or null when it is unknown.
 *
 * `dev.mjs` passes the control plane's own resolved `config.gatewayOrigin`, so
 * both sides agree on one value instead of each applying its own default. Null
 * here means nobody told us, and a request arriving through the proxy is then
 * refused rather than guessed at.
 */
export function expectedConsoleOrigin(): string | null {
  const raw = process.env.GATEWAY_ORIGIN;
  return raw && raw.trim() ? stripSlash(raw.trim()) : null;
}

/**
 * May this state-changing request proceed? (E7)
 *
 * The console previously had NO server-side origin check at all —
 * `astro.config.mjs` set `security: { checkOrigin: false }` because Astro's
 * built-in check compares Origin against the request Host, and the gateway
 * rewrites Host to `127.0.0.1:3000` (`gateway/proxy.mjs`), so every funnel POST
 * was rejected. The defence was left to `SameSite=Strict` on `sa_admin`.
 *
 * That is not sufficient here, and the reason is specific to this deployment:
 * the console, the CMS and the design studio are all served from ONE origin by
 * the gateway. `SameSite` distinguishes sites, not paths — so a script running
 * on any tenant page the gateway serves is same-site *and* same-origin with
 * this console, and `Path=/operator` limits which requests carry the cookie,
 * not which pages may send them. The exposed handlers include act-as, remove
 * and expose.
 *
 * So: compare against a CONFIGURED origin rather than the request host, which
 * is the same fix Instatic already uses (`server/auth/security.ts`).
 *
 * `Sec-Fetch-Site` is consulted first because it is the browser's own
 * statement about the caller and cannot be set by page script. A browser that
 * says the request is cross-site is refused whatever Origin claims. It is also
 * what covers the no-Origin case rather than refusing outright: Safari has
 * historically omitted Origin on same-origin form POSTs, and the console is
 * reached by browsers only — the browser never calls the control plane
 * directly, so there is no server-to-server caller to accommodate.
 *
 * P2: unknown configuration refuses. A proxied request with no configured
 * origin is not waved through.
 */
export function consoleOriginAllowed(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  // 'none' is a user-initiated navigation (typed URL, bookmark); same-origin is
  // this console's own pages. Anything else the browser labels is refused.
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = request.headers.get('origin');
  const viaGateway = Boolean(request.headers.get('x-forwarded-host'));

  if (origin) {
    const expected = viaGateway
      ? [expectedConsoleOrigin()].filter((v): v is string => v !== null)
      : [...LOOPBACK_ORIGINS];
    return expected.includes(stripSlash(origin));
  }

  // No Origin header. Accept only when the browser positively stated the
  // request came from this same origin.
  return fetchSite === 'same-origin';
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

export type Loaded = { ok: boolean; status: number; body: any };

// One browser request often needs the same listing twice — the page renders the
// projects table and the header counts the same projects for its notifications.
// Each GET is therefore fetched once per request and shared. The key is the
// request's own AstroCookies object, so nothing leaks between requests or
// between administrators, and a WeakMap keeps no entry alive after it.
const requestGets = new WeakMap<AstroCookies, Map<string, Promise<Loaded>>>();

/** A control-plane GET, fetched at most once per browser request. */
export function cpLoad(cookies: AstroCookies, path: string): Promise<Loaded> {
  let byPath = requestGets.get(cookies);
  if (!byPath) {
    byPath = new Map();
    requestGets.set(cookies, byPath);
  }
  let pending = byPath.get(path);
  if (!pending) {
    pending = cpFetch(cookies, path).then(async (res) => ({
      ok: res.ok,
      status: res.status,
      body: await res.json().catch(() => ({})),
    }));
    byPath.set(path, pending);
  }
  return pending;
}
