import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Operator Console — Astro SSR on the Node adapter. Talks to the control-plane on :4400.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
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
  // allowedHosts lets the Vite dev server accept requests proxied in over
  // Tailscale Funnel (Host: <node>.<tailnet>.ts.net); without it Vite replies
  // "Blocked request. This host is not allowed." A leading dot matches the
  // domain and all subdomains. The server still binds 127.0.0.1 — tailscaled
  // connects locally and forwards the public request.
  vite: { server: { watch: { usePolling: true }, allowedHosts: ['.ts.net'] } },
});
