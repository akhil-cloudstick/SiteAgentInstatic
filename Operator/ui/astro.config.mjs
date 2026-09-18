import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

// The shared MMSBUILD header (row 1 + row 2) is ONE React component that every
// MMS product imports as source — the CMS, MMS-Design, and this console. It
// lives in the design studio's workspace; nothing is copied from it.
const shellDir = fileURLToPath(new URL('../../OpenDesign/packages/mms-shell', import.meta.url));
const shellSrc = fileURLToPath(new URL('../../OpenDesign/packages/mms-shell/src', import.meta.url));

// Operator Console — Astro SSR on the Node adapter. Talks to the control-plane on :4400.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  server: { port: 3000, host: '127.0.0.1' },
  // Served behind the single public gateway under /operator (funnel :443 ->
  // control-plane -> proxy to this Astro server). `base` makes every asset, link,
  // and form action resolve under that prefix so nothing 404s. Local access is
  // then http://127.0.0.1:3000/operator.
  base: '/operator',
  // Astro's CSRF origin check compares a POST's Origin against the request host.
  // Behind the Tailscale funnel the public Origin (…ts.net:8443) differs from the
  // proxied host, so every form POST was rejected with "Cross-site POST form
  // submissions are forbidden". Disabled so the funnel-exposed console works.
  // Cross-site POSTs are refused another way since R14: the admin session cookie
  // is SameSite=Strict, so a forged form arrives signed out and the middleware
  // sends it to sign-in. (A full CSRF review is security item E7.)
  security: { checkOrigin: false },
  vite: {
    resolve: {
      alias: [
        { find: /^@mms\/shell\/styles\/fontawesome\.css$/, replacement: `${shellSrc}/styles/fontawesome/fontawesome-solid.css` },
        { find: /^@mms\/shell\/(.*)$/, replacement: `${shellSrc}/$1` },
        { find: /^@mms\/shell$/, replacement: `${shellSrc}/index.ts` },
      ],
      // The shell has no node_modules of its own, so a bare `react` import
      // inside it would otherwise resolve to the design studio's React 18 —
      // two Reacts in one page. Dedupe resolves both from this app.
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      // Compiled as source, like the CMS does, so its CSS modules and images
      // go through Vite rather than Node's loader.
      noExternal: ['@mms/shell'],
    },
    server: {
      // allowedHosts lets the Vite dev server accept requests proxied in over
      // Tailscale Funnel (Host: <node>.<tailnet>.ts.net); without it Vite replies
      // "Blocked request. This host is not allowed." A leading dot matches the
      // domain and all subdomains. The server still binds 127.0.0.1 — tailscaled
      // connects locally and forwards the public request.
      allowedHosts: ['.ts.net'],
      watch: { usePolling: true },
      // The shared shell's source, fonts and logos live outside this app.
      fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), shellDir] },
    },
  },
});
