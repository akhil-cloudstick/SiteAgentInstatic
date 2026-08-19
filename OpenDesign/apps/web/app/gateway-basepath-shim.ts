// Gateway sub-path shim.
//
// When this OpenDesign web runs behind the SiteAgent public gateway it is served
// under /od/<slug> (Next.js basePath). Next prefixes <Link> and router navigation
// with the basePath automatically — but NOT raw `fetch('/api/…')` or
// `new EventSource('/api/…')`. The app targets its daemon with root-relative
// paths (/api, /artifacts, /frames, /sso); left unprefixed they hit the gateway
// ROOT (control-plane / another tenant's Instatic) and 404 instead of routing
// back to THIS tenant's OD web (which proxies them to the daemon).
//
// This module (imported once, first thing on the client) prefixes exactly those
// daemon-bound, same-origin, root-relative requests with the basePath. Served at
// the root (local dev, no gateway) it is a complete no-op.

declare global {
  interface Window { __odBasePathPatched?: boolean }
}

if (typeof window !== 'undefined' && !window.__odBasePathPatched) {
  // Behind the gateway the app lives under a FIXED, tenant-agnostic `/design`; take
  // that as the basePath. Empty when served at the root, which makes every
  // helper below a no-op. (It used to be `/od/<slug>` — that forced one Next
  // build per tenant, because basePath is baked in at build time. The tenant is
  // now resolved by the gateway from the hub session cookie instead.)
  const match = window.location.pathname.match(/^\/design(?=\/|$)/);
  const BASE = match ? match[0] : '';

  if (BASE) {
    window.__odBasePathPatched = true;

    const isDaemonPath = (p: string) =>
      p.startsWith('/api') || p.startsWith('/artifacts') || p.startsWith('/frames') || p.startsWith('/sso');
    const withBase = (p: string) => (p === BASE || p.startsWith(BASE + '/') ? p : BASE + p);
    const sameOrigin = (origin: string) => origin === window.location.origin;

    // ---- expired hub session ----
    // The gateway answers 401 for a daemon request whose `sa_hub` session is
    // gone or expired. A top-level navigation gets bounced to /login, but a
    // fetch cannot follow that, so the app used to sit on a dead page throwing
    // errors it could not recover from — the user had no way to know they had
    // simply been signed out.
    //
    // One login covers both tools, so the fix is to re-enter the SAME hand-off
    // the shell uses: /sso/design silently re-mints when the hub session is
    // still valid and only shows /login when it genuinely is not. `next`
    // carries the current location so the user lands back where they were.
    //
    // Latched, because a signed-out page usually fails many requests at once
    // and each one must not queue its own navigation.
    let hubSessionRedirectStarted = false;
    function handleExpiredHubSession(response: Response): void {
      if (response.status !== 401 || hubSessionRedirectStarted) return;
      // Only the gateway's own "not signed in" is a session problem. A 401 from
      // a daemon route (an unauthenticated API-token call, a provider probe) is
      // the app's business and must not eject the user.
      const path = (() => {
        try { return new URL(response.url, window.location.origin).pathname; }
        catch { return ''; }
      })();
      if (!isDaemonPath(path.startsWith(BASE) ? path.slice(BASE.length) || '/' : path)) return;
      hubSessionRedirectStarted = true;
      const next = window.location.pathname + window.location.search;
      window.location.replace(`/sso/design?next=${encodeURIComponent(next)}`);
    }

    // ---- fetch ----
    const origFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string') {
        if (input.startsWith('/') && !input.startsWith('//') && isDaemonPath(input)) {
          input = withBase(input);
        }
      } else if (input instanceof URL) {
        if (sameOrigin(input.origin) && isDaemonPath(input.pathname)) {
          input = new URL(withBase(input.pathname) + input.search + input.hash, input.origin);
        }
      } else if (input instanceof Request) {
        try {
          const u = new URL(input.url);
          if (sameOrigin(u.origin) && isDaemonPath(u.pathname)) {
            input = new Request(withBase(u.pathname) + u.search + u.hash, input);
          }
        } catch { /* leave non-absolute Request URLs untouched */ }
      }
      return origFetch(input as RequestInfo | URL, init).then((response) => {
        handleExpiredHubSession(response);
        return response;
      });
    }) as typeof window.fetch;

    // ---- EventSource (SSE: /api/memory/events, /api/library/events, terminals) ----
    const OrigES = window.EventSource;
    if (OrigES) {
      const Patched = function EventSource(url: string | URL, config?: EventSourceInit) {
        if (typeof url === 'string') {
          if (url.startsWith('/') && !url.startsWith('//') && isDaemonPath(url)) url = withBase(url);
        } else if (url instanceof URL && sameOrigin(url.origin) && isDaemonPath(url.pathname)) {
          url = new URL(withBase(url.pathname) + url.search + url.hash, url.origin);
        }
        return new OrigES(url as string, config);
      } as unknown as typeof EventSource;
      Patched.prototype = OrigES.prototype;
      // `typeof EventSource` declares CONNECTING/OPEN/CLOSED readonly, so copy
      // them through a mutable alias — we are building this constructor here,
      // not mutating a live one.
      const statics = Patched as unknown as { CONNECTING: number; OPEN: number; CLOSED: number };
      statics.CONNECTING = OrigES.CONNECTING;
      statics.OPEN = OrigES.OPEN;
      statics.CLOSED = OrigES.CLOSED;
      window.EventSource = Patched;
    }
  }
}

export {};
