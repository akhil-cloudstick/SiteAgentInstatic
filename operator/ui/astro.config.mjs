import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Operator Console — Astro SSR on the Node adapter. Talks to the control-plane on :4000.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 3000, host: '127.0.0.1' },
  vite: { server: { watch: { usePolling: true } } },
});
