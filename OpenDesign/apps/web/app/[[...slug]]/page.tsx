import { ClientShell } from './client-shell';

// The whole product is a client-driven SPA: project IDs and file paths are
// unbounded user input, so we route every URL through this single optional
// catch-all and let the existing client router (src/router.ts, which reads
// window.location at runtime) decide what to render.
//
// For `output: 'export'` we return a single empty `slug` so Next.js emits
// one shell HTML at out/index.html; the daemon's SPA fallback (see
// apps/daemon/src/server.ts) serves it for any unknown non-API path so deep
// links still hydrate to the right view.
// Force a fully-static shell — the whole app is a client SPA (providers + app are
// client-only, see client-providers.tsx / client-shell.tsx), so there is nothing
// request-dependent to render at build time. (`dynamic` MUST be a static literal —
// Next parses it at compile time, so it can't be computed per env.)
// NOTE: `output: 'export'` currently still fails on an UPSTREAM Next.js 16.2.6
// internal bug ("Expected workStore to be initialized") while prerendering this
// route — reproduced with nothing rendering, single-worker, and no request-scoped
// APIs in source. `next dev` builds/runs fine; the fix is a Next version bump.
//
// generateStaticParams emits ONLY the root shell. Deep URLs (e.g. a refresh of
// /od/<slug>/projects/…/files/x.html) aren't pre-generated, so a full page load of
// one would 404 — under `output: export` the daemon's SPA fallback covers that, but
// `next dev` (how each SiteAgent per-tenant web runs) has no such fallback. `app/
// not-found.tsx` renders the SAME client shell, so any unmatched deep path still
// hydrates the SPA and the client router (src/router.ts) resolves the real view.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return <ClientShell />;
}
