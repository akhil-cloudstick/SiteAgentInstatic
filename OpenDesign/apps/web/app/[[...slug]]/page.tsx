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
// request-dependent to render at build time.
// NOTE: `output: 'export'` currently still fails on an UPSTREAM Next.js 16.2.6
// internal bug ("Expected workStore to be initialized") while prerendering this
// route — reproduced with nothing rendering, single-worker, and no request-scoped
// APIs in source. `next dev` builds/runs fine; the fix is a Next version bump.
export const dynamic = 'force-static';

export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return <ClientShell />;
}
