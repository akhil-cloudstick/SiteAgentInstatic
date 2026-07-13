'use client';

// FIRST import on the client: patch fetch/EventSource to prefix daemon-bound
// paths with the gateway basePath (/od/<slug>) before any request is made.
import './gateway-basepath-shim';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

// The product is a pure client-driven SPA. Loading the whole provider tree
// client-only (`ssr: false`) means Next.js renders NOTHING during static
// generation for `output: 'export'` — which is what dodges the Next 16.2.6
// internal "Expected workStore to be initialized" invariant that fires while
// prerendering the providers server-side. The static HTML is just the shell;
// the client mounts the providers + app on load.
const Inner = dynamic(
  () => import('./client-providers-inner').then((m) => m.ClientProvidersInner),
  { ssr: false },
);

export function ClientProviders({ children }: { children: ReactNode }) {
  return <Inner>{children}</Inner>;
}
