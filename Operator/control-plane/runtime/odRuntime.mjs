// OpenDesignRuntime — runs each tenant's OpenDesign as its own daemon process
// (own OD_DATA_DIR + port), mirroring TenantRuntime for Instatic. Isolation is by
// process + data dir: an OD daemon only ever sees the projects in its own data dir.
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';
import { signTenantToken } from '../lib/crypto.mjs';

const isWin = process.platform === 'win32';
const running = new Map(); // slug -> { child, port, pid, slug }

// Per-tenant OD data dir (LOCAL disk — SQLite can't run on the SMB share).
export function odPaths(slug) {
  const dataDir = resolve(config.odDataBase, slug);
  return { dataDir, log: resolve(dataDir, 'daemon.log') };
}

export const isRunning = (slug) => running.has(slug);
export const listRunning = () => [...running.values()].map((r) => ({ slug: r.slug, port: r.port, pid: r.pid }));

// tenant: { slug, odPort, webPort?, instaticUrl? }
export function start(tenant) {
  const { slug, odPort, webPort } = tenant;
  if (running.has(slug)) return running.get(slug);

  const p = odPaths(slug);
  mkdirSync(p.dataDir, { recursive: true });

  const daemonCwd = resolve(config.openDesignDir, 'apps', 'daemon');
  const origin = `http://127.0.0.1:${odPort}`;
  const env = {
    ...process.env,
    OD_DATA_DIR: p.dataDir,
    OD_PORT: String(odPort),
    // The daemon trusts its own web origin for /api calls via OD_WEB_PORT: the
    // browser loads the per-tenant Next web (webPort) and its /api requests carry
    // Origin http://127.0.0.1:<webPort>, so the daemon must know that port or it
    // 403s "Cross-origin requests are not allowed". (allowedBrowserPorts() reads
    // OD_WEB_PORT.) Belt-and-suspenders: also list the web origins explicitly.
    ...(webPort ? { OD_WEB_PORT: String(webPort) } : {}),
    OD_ALLOWED_ORIGINS: [
      origin,
      `http://localhost:${odPort}`,
      ...(webPort ? [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`] : []),
    ].join(','),
    // SSO: the control-plane signs a short-lived token; the OD daemon verifies it
    // with this same secret and mints its own session (Phase 3b, OD-side /sso).
    OD_SSO_SECRET: config.tokenSecret,
    OD_TENANT_SLUG: slug,
    // Advanced tenants: where this tenant's Instatic lives, so "Share to CMS" can
    // push there. Unset for lite tenants (no Instatic) -> the button is inert.
    ...(tenant.instaticUrl ? { OD_INSTATIC_URL: tenant.instaticUrl } : {}),
    // Advanced tenants also get the website build rule OD must follow so their
    // pages import into Instatic cleanly. OD reads this file live (cached by
    // mtime), so editing it updates the enforced rule with no redeploy. Only
    // pass it when the file exists; OD falls back to its embedded rule otherwise.
    ...(tenant.instaticUrl && existsSync(config.cmsRuleFile)
      ? { OD_CMS_RULE_FILE: config.cmsRuleFile }
      : {}),
    // Operator-managed AI (Phase 6): managed mode points OD's AI at the
    // control-plane's key-hiding gateway (same per-tenant signed token as
    // Instatic). The real provider key NEVER enters the OD process — it stays in
    // the control-plane. OD_MANAGED_AI signals the web app to hide the BYOK UI.
    OD_MANAGED_AI: '1',
    OD_AI_GATEWAY_URL: `${config.publicBaseUrl}/ai/${signTenantToken(slug)}/v1`,
  };
  // Clear inherited control-plane secrets the child shouldn't see.
  delete env.SETTINGS_ENC_KEY;

  const out = createWriteStream(p.log, { flags: 'a' });
  out.write(`\n[od-runtime] starting ${slug} on :${odPort} @ ${new Date().toISOString()}\n`);

  // The daemon serves the API + tenant SSO (/sso) + the auth gate — NOT the web UI.
  // The web UI is served by a per-tenant Next.js dev server (below) that proxies
  // /api, /artifacts, /frames, and /sso back to this daemon. (OpenDesign's
  // production `next build` is currently blocked by an upstream Next.js 16.2 bug,
  // so we serve the web via `next dev` — the mode OpenDesign already runs reliably.)
  const daemon = spawn('node', ['bin/od.mjs', '--port', String(odPort), '--no-open'], {
    cwd: daemonCwd, env, shell: isWin, windowsHide: true,
  });
  daemon.stdout.on('data', (d) => out.write(d));
  daemon.stderr.on('data', (d) => out.write(d));
  daemon.on('exit', (code) => { out.write(`\n[od-runtime] ${slug} daemon exited code=${code} @ ${new Date().toISOString()}\n`); running.delete(slug); });
  daemon.on('error', (err) => { out.write(`\n[od-runtime] ${slug} daemon spawn error: ${err?.message ?? err}\n`); running.delete(slug); });

  // Per-tenant web (Next.js dev). Its next.config proxies /api,/artifacts,/frames,
  // /sso to OD_PORT (this daemon), so the whole surface is same-origin for cookies.
  let web = null;
  if (webPort) {
    const webCwd = resolve(config.openDesignDir, 'apps', 'web');
    const nextBin = resolve(config.openDesignDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    const webEnv = {
      ...process.env,
      OD_PORT: String(odPort),
      OD_WEB_PORT: String(webPort),
      OD_ALLOWED_ORIGINS: `${origin},http://127.0.0.1:${webPort},http://localhost:${webPort}`,
      // Each tenant's Next dev server needs its OWN build dir, or they collide on
      // the shared apps/web `.next` lock ("Another next dev server is already
      // running"). One `.next-<slug>` per tenant keeps them independent.
      OD_WEB_DIST_DIR: `.next-${slug}`,
      // Managed-AI flag the browser can read (NEXT_PUBLIC_*). Groundwork for hiding
      // the "bring your own key" UI — NOT yet wired to actually hide it, because the
      // hide must land together with routing OD's in-browser AI through the gateway
      // (hiding the key box alone would leave the design chat with no key). See the
      // Phase 6 follow-up in docs/CHANGELOG.md.
      NEXT_PUBLIC_OD_MANAGED_AI: '1',
      WATCHPACK_POLLING: 'true',
      CHOKIDAR_USEPOLLING: 'true',
    };
    delete webEnv.SETTINGS_ENC_KEY;
    web = spawn('node', [nextBin, 'dev', '--turbopack', '--port', String(webPort)], {
      cwd: webCwd, env: webEnv, shell: isWin, windowsHide: true,
    });
    web.stdout.on('data', (d) => out.write(d));
    web.stderr.on('data', (d) => out.write(d));
    web.on('exit', (code) => out.write(`\n[od-runtime] ${slug} web exited code=${code}\n`));
    web.on('error', (err) => out.write(`\n[od-runtime] ${slug} web spawn error: ${err?.message ?? err}\n`));
  }

  const rec = { child: daemon, web, port: odPort, webPort, pid: daemon.pid, webPid: web?.pid, slug };
  running.set(slug, rec);
  return rec;
}

export function stop(slug) {
  const rec = running.get(slug);
  if (!rec) return false;
  for (const pid of [rec.pid, rec.webPid]) {
    if (!pid) continue;
    try {
      if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } catch { /* best effort */ }
  }
  if (!isWin) {
    try { rec.child?.kill('SIGTERM'); rec.web?.kill('SIGTERM'); } catch { /* best effort */ }
  }
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
