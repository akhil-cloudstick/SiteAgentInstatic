// OpenDesignRuntime — runs each tenant's OpenDesign as its own daemon process
// (own OD_DATA_DIR + port), mirroring TenantRuntime for Instatic. Isolation is by
// process + data dir: an OD daemon only ever sees the projects in its own data dir.
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';

const isWin = process.platform === 'win32';
const running = new Map(); // slug -> { child, port, pid, slug }

// Per-tenant OD data dir (LOCAL disk — SQLite can't run on the SMB share).
export function odPaths(slug) {
  const dataDir = resolve(config.odDataBase, slug);
  return { dataDir, log: resolve(dataDir, 'daemon.log') };
}

export const isRunning = (slug) => running.has(slug);
export const listRunning = () => [...running.values()].map((r) => ({ slug: r.slug, port: r.port, pid: r.pid }));

// tenant: { slug, odPort, aiGatewayUrl? }
export function start(tenant) {
  const { slug, odPort } = tenant;
  if (running.has(slug)) return running.get(slug);

  const p = odPaths(slug);
  mkdirSync(p.dataDir, { recursive: true });

  const daemonCwd = resolve(config.openDesignDir, 'apps', 'daemon');
  const origin = `http://127.0.0.1:${odPort}`;
  const env = {
    ...process.env,
    OD_DATA_DIR: p.dataDir,
    OD_PORT: String(odPort),
    // The daemon must trust its own served web origin for API calls.
    OD_ALLOWED_ORIGINS: `${origin},http://localhost:${odPort}`,
    // SSO: the control-plane signs a short-lived token; the OD daemon verifies it
    // with this same secret and mints its own session (Phase 3b, OD-side /sso).
    OD_SSO_SECRET: config.tokenSecret,
    OD_TENANT_SLUG: slug,
    // Advanced tenants: where this tenant's Instatic lives, so "Share to CMS" can
    // push there. Unset for lite tenants (no Instatic) -> the button is inert.
    ...(tenant.instaticUrl ? { OD_INSTATIC_URL: tenant.instaticUrl } : {}),
    // Operator-managed AI keys are injected here in Phase 6 (env overrides OD's
    // in-workspace key files, and the in-app BYOK UI is disabled).
    ...(tenant.aiGatewayUrl ? { OD_AI_GATEWAY_URL: tenant.aiGatewayUrl } : {}),
  };
  // Clear inherited control-plane secrets the child shouldn't see.
  delete env.SETTINGS_ENC_KEY;

  const out = createWriteStream(p.log, { flags: 'a' });
  out.write(`\n[od-runtime] starting ${slug} on :${odPort} @ ${new Date().toISOString()}\n`);

  // --serve-web serves the built web UI on the same port (one process per tenant,
  // no separate Next.js). Requires `pnpm --filter @open-design/web build` once.
  // OD_SERVE_WEB=0 runs the daemon (API) only — used to verify isolation without
  // a web build, or when a separate web server is fronted.
  const args = ['bin/od.mjs', '--port', String(odPort), '--no-open'];
  if (process.env.OD_SERVE_WEB !== '0') args.push('--serve-web');
  const child = spawn('node', args, { cwd: daemonCwd, env, shell: isWin, windowsHide: true });
  child.stdout.on('data', (d) => out.write(d));
  child.stderr.on('data', (d) => out.write(d));
  child.on('exit', (code) => { out.write(`\n[od-runtime] ${slug} exited code=${code} @ ${new Date().toISOString()}\n`); running.delete(slug); });
  child.on('error', (err) => { out.write(`\n[od-runtime] ${slug} spawn error: ${err?.message ?? err}\n`); running.delete(slug); });

  const rec = { child, port: odPort, pid: child.pid, slug };
  running.set(slug, rec);
  return rec;
}

export function stop(slug) {
  const rec = running.get(slug);
  if (!rec) return false;
  try {
    if (isWin && rec.pid) spawn('taskkill', ['/pid', String(rec.pid), '/T', '/F'], { windowsHide: true });
    else rec.child.kill('SIGTERM');
  } catch { /* best effort */ }
  running.delete(slug);
  return true;
}

// Poll until the daemon answers its health endpoint.
export async function waitHealthy(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.status > 0) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}
