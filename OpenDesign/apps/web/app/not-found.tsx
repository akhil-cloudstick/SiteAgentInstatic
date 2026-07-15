import { ClientShell } from './[[...slug]]/client-shell';

// SPA deep-link fallback.
//
// The root route ([[...slug]]/page.tsx) is force-static and only pre-generates the
// empty-slug shell, so a FULL page load / refresh of a deep URL (e.g.
// /od/<slug>/projects/…/files/x.html) is unmatched and Next.js renders THIS file.
// Under `output: export` the daemon serves the shell for such paths; under
// `next dev` (how each SiteAgent per-tenant web runs behind the gateway) there is
// no such fallback — so we render the SAME client shell here. The client router
// (src/router.ts, basePath-aware) then reads window.location and resolves the real
// view, exactly as it would after a client-side navigation.
export default function NotFound() {
  return <ClientShell />;
}
