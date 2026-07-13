'use client';

// The product is a pure client-driven SPA (client-app reads window.location at
// runtime). Rendering it client-only (`ssr: false`) means Next.js never tries to
// prerender it during `output: 'export'` — which otherwise fails with an internal
// "Expected workStore to be initialized" invariant on the root route. The static
// export is just an empty shell; the client mounts the app on load, exactly what a
// SPA wants.
import dynamic from 'next/dynamic';

const ClientApp = dynamic(() => import('./client-app').then((m) => m.ClientApp), {
  ssr: false,
});

export function ClientShell() {
  return <ClientApp />;
}
