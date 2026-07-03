import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Operator Console — Astro SSR on the Node adapter. Talks to the control-plane on :4400.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 3000, host: '127.0.0.1' },
  // Astro's CSRF origin check compares a POST's Origin against the request host.
  // Behind the Tailscale funnel the public Origin (…ts.net:8443) differs from the
  // proxied host, so every form POST was rejected with "Cross-site POST form
  // submissions are forbidden". Disabled so the funnel-exposed console works.
  // CLIENT-TEST ONLY — see pending.md (re-enable for a production/authed setup).
  security: { checkOrigin: false },
  // allowedHosts lets the Vite dev server accept requests proxied in over
  // Tailscale Funnel (Host: <node>.<tailnet>.ts.net); without it Vite replies
  // "Blocked request. This host is not allowed." A leading dot matches the
  // domain and all subdomains. The server still binds 127.0.0.1 — tailscaled
  // connects locally and forwards the public request.
  vite: { server: { watch: { usePolling: true }, allowedHosts: ['.ts.net'] } },
});
