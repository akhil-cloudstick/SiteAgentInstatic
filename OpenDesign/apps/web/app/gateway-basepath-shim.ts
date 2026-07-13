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
  // The app always lives under /od/<slug>; take that as the basePath. Empty when
  // served at the root, which makes every helper below a no-op.
  const match = window.location.pathname.match(/^\/od\/[a-z0-9-]+/);
  const BASE = match ? match[0] : '';

  if (BASE) {
    window.__odBasePathPatched = true;

    const isDaemonPath = (p: string) =>
      p.startsWith('/api') || p.startsWith('/artifacts') || p.startsWith('/frames') || p.startsWith('/sso');
    const withBase = (p: string) => (p === BASE || p.startsWith(BASE + '/') ? p : BASE + p);
    const sameOrigin = (origin: string) => origin === window.location.origin;

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
      return origFetch(input as RequestInfo | URL, init);
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
      Patched.CONNECTING = OrigES.CONNECTING;
      Patched.OPEN = OrigES.OPEN;
      Patched.CLOSED = OrigES.CLOSED;
      window.EventSource = Patched;
    }
  }
}

export {};
