// TenantRuntime — runs each tenant as a NATIVE Bun Instatic process (no Docker).
// The control-plane (Node) spawns `bun server/index.ts` with per-tenant env.
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';
import { signTenantToken } from '../lib/crypto.mjs';
import { isPortOpen, waitPortOpen } from '../lib/ports.mjs';

const isWin = process.platform === 'win32';
const running = new Map(); // slug -> { child, port, pid, slug }

// ---- readiness ------------------------------------------------------------
// Same split as OpenDesignRuntime: `running` means "we spawned it", `ready`
// means "the port answers". Only the second one makes a proxy forward safe.
//
// This side also has to survive a real situation seen in production here: a
// tenant's bun process ORPHANED by a hard kill keeps serving its port across
// control-plane restarts, while the resumed spawn dies of EADDRINUSE.
//
// Adopting that orphan (what this used to do) is NOT safe. It serves, so the
// port probe calls it ready and the supervisor stops respawning — but it runs
// whatever code it was started with. The tenant then serves a freshly rebuilt
// `dist` against an arbitrarily old server, and the version skew surfaces as
// unexplained 4xx on the CMS API (seen for real: a 17-day-old orphan on :3117
// answered every `PUT /cms/api/cms/site-document` with a bare 400, which broke
// site import and could not be fixed by any rebuild or restart). `ensure` now
// reaps a squatter it did not spawn and brings the tenant up on current code.
const ready = new Set();
const inflight = new Map();
const START_TIMEOUT_MS = Number(process.env.TENANT_START_TIMEOUT_MS || 120_000);

export function tenantPaths(slug) {
  const dir = resolve(config.tenantsDir, slug);
  return {
    dir,
    uploads: resolve(dir, 'uploads'),
    published: resolve(dir, 'uploads', 'published'),
    log: resolve(dir, 'instatic.log'),
  };
}

// Tenant role; its DEFAULT search_path is its own schema (set via ALTER ROLE at
// provision time), so unqualified Instatic DDL lands in the tenant schema.
export function buildDatabaseUrl(role, password) {
  return `postgres://${encodeURIComponent(role)}:${encodeURIComponent(password)}@${config.pgHost}:${config.pgPort}/${config.pgDb}`;
}

// The canonical production bundle. (The earlier delete-pending lock on
// `dist/runtime` — which forced a temporary `dist_new`/`dist_build*` workaround —
// was cleared by killing the leaked processes that held it, so tenants serve the
// clean `dist` again.) Rebuild flow: build to a scratch dir, then mirror it into
// `dist` in place (robocopy /MIR) so the served folder updates without a
// clear-gap and a browser refresh picks it up — no restart needed.
export const distDir = () => resolve(config.instaticDir, 'dist');

export function isRunning(slug) {
  return running.has(slug);
}

export function listRunning() {
  return [...running.values()].map((r) => ({ slug: r.slug, port: r.port, pid: r.pid }));
}

// Has this tenant's Instatic answered its port? Read on the request path.
export const isReady = (slug) => ready.has(slug);

// Drop a readiness verdict after a failed forward, so the next request re-ensures.
export function markUnavailable(slug) {
  ready.delete(slug);
}

// Kill whatever is LISTENING on a tenant port that this control plane did not
// spawn. Mirrors odRuntime's reapStaleWebOnPort — the same orphan-squatter
// failure mode, which on the CMS side stranded a tenant on weeks-old server code.
function reapPortSquatter(port, slug) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, { encoding: 'utf8', windowsHide: true });
      const pids = new Set(out.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x) && x !== '0'));
      for (const pid of pids) {
        if (Number(pid) === process.pid) continue;
        console.warn(`[tenant-runtime] ${slug}: reaping orphan pid ${pid} squatting :${port}`);
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }); } catch { /* already gone */ }
      }
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    }
  } catch { /* nothing listening — the normal case */ }
}

// Guarantee this tenant's instance is coming up; say whether it is usable NOW.
// Never blocks — the caller shows a waiting page and polls. Same shape as
// odRuntime.ensure(). tenant: the full params object start() takes.
export function ensure(tenant) {
  const slug = tenant?.slug;
  const port = tenant?.port;
  if (!slug || !port) return { ready: false, starting: false, error: 'no port for this tenant' };
  if (ready.has(slug)) return { ready: true };
  if (inflight.has(slug)) return { ready: false, starting: true };

  const job = (async () => {
    if (!(await isPortOpen(port))) {
      start(tenant);
    } else if (!running.has(slug)) {
      // Port answers but we never spawned it — reap the orphan (see header) and
      // start this tenant on the code that is actually on disk.
      reapPortSquatter(port, slug);
      for (let i = 0; i < 10 && (await isPortOpen(port)); i += 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
      start(tenant);
    }
    const ok = await waitPortOpen(port, START_TIMEOUT_MS);
    if (ok) ready.add(slug);
    return ok;
  })();
  inflight.set(slug, job);
  job.catch(() => false).finally(() => { if (inflight.get(slug) === job) inflight.delete(slug); });
  return { ready: false, starting: true };
}

// tenant: { slug, port, dbRole, dbPassword, secretKey, aiBaseUrl? }
export function start(tenant) {
  const { slug, port } = tenant;
  if (running.has(slug)) return running.get(slug);

  const p = tenantPaths(slug);
  mkdirSync(p.uploads, { recursive: true });

  const env = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: buildDatabaseUrl(tenant.dbRole, tenant.dbPassword),
    UPLOADS_DIR: p.uploads,
    STATIC_DIR: distDir(),
    INSTATIC_SECRET_KEY: tenant.secretKey,
    // Tenant SSO: the hub redirects the tenant to /cms/sso?token=<signed>; the
    // instance verifies it with this shared secret and mints an Owner session.
    INSTATIC_SSO_SECRET: config.tokenSecret,
    INSTATIC_TENANT_SLUG: slug,
    // ONE LOGIN: where to bounce an unauthenticated page load. The hub silently
    // re-mints an SSO token when the hub session is alive, so an expired admin
    // session never surfaces Instatic's own login form. See hub.mjs `/sso/<tool>`.
    INSTATIC_HUB_SSO_URL: `${config.gatewayOrigin}/sso/cms`,
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    // Public gateway: the browser reaches this tenant's Instatic through the
    // single funnel origin (funnel :443 -> control-plane -> session-routed proxy),
    // so its state-changing requests carry Origin = gatewayOrigin. Trust it for
    // the CSRF check. We use VITE_ALLOWED_ORIGIN (Instatic's dev-allowlist, a
    // static const read at module load) rather than PUBLIC_ORIGIN because running
    // tenants from this mapped network drive makes Bun load server/auth/security.ts
    // twice — the request-time copy never sees the configured publicOrigins, but
    // the static DEV_ORIGIN_ALLOWLIST is identical in both copies. The SSO handler
    // redirects to a RELATIVE /cms, so no localhost bounce. See security.ts.
    VITE_ALLOWED_ORIGIN: config.gatewayOrigin,
    // Managed AI: point the tenant's OpenRouter driver at this tenant's signed
    // AI-Gateway URL. This alone enables managed mode (gateway credential
    // auto-provided, provider settings locked). The MODEL is read LIVE from the
    // gateway per request — a Settings change applies without a restart — so it
    // is NOT pinned here; INSTATIC_AI_MODEL is passed only as an offline
    // fallback for when the gateway is briefly unreachable at boot.
    INSTATIC_AI_GATEWAY_URL: `${config.publicBaseUrl}/ai/${signTenantToken(slug)}/v1`,
    ...(tenant.aiModel ? { INSTATIC_AI_MODEL: tenant.aiModel } : {}),
    // Auto-deploy hook: Instatic POSTs here (token-authenticated) right after an
    // explicit Publish, so the tenant's Publish also ships the baked site to
    // Cloudflare — the control-plane runs the deploy with the operator's CF token.
    INSTATIC_DEPLOY_WEBHOOK: `${config.publicBaseUrl}/deploy/${signTenantToken(slug)}`,
  };
  // Remove inherited vars that would confuse the child.
  delete env.SETTINGS_ENC_KEY;

  const out = createWriteStream(p.log, { flags: 'a' });
  out.write(`\n[runtime] starting ${slug} on :${port} @ ${new Date().toISOString()}\n`);

  const child = spawn('bun', ['server/index.ts'], {
    cwd: config.instaticDir,
    env,
    shell: isWin,          // resolve bun.cmd via the shell on Windows
    windowsHide: true,
  });
  child.stdout.on('data', (d) => out.write(d));
  child.stderr.on('data', (d) => out.write(d));
  child.on('exit', (code) => {
    out.write(`\n[runtime] ${slug} exited code=${code} @ ${new Date().toISOString()}\n`);
    running.delete(slug);
    // Only THIS process stopped serving; an orphan may still hold the port. Let
    // the next ensure() re-probe rather than asserting the tenant is down.
    ready.delete(slug);
  });
  // A child that fails to spawn (bad cwd, bun not found, EBUSY, killed) emits
  // an 'error' event. With NO listener Node re-throws it as an uncaught
  // exception — which crashed the whole control-plane every time a provision
  // hiccuped. Handle it: log, drop the record, and let the provision saga's
  // `waitHealthy` time out and report failure instead of taking the server down.
  child.on('error', (err) => {
    out.write(`\n[runtime] ${slug} spawn error: ${err?.message ?? err} @ ${new Date().toISOString()}\n`);
    running.delete(slug);
    ready.delete(slug);
  });

  const rec = { child, port, pid: child.pid, slug };
  running.set(slug, rec);
  waitPortOpen(port, START_TIMEOUT_MS).then((ok) => { if (ok) ready.add(slug); });
  return rec;
}

export function stop(slug) {
  ready.delete(slug);
  const rec = running.get(slug);
  if (!rec) return false;
  try {
    if (isWin && rec.pid) {
      // Kill the whole tree (the shell + the bun child) so nothing is orphaned.
      spawn('taskkill', ['/pid', String(rec.pid), '/T', '/F'], { windowsHide: true });
    } else {
      rec.child.kill('SIGTERM');
    }
  } catch { /* best effort */ }
  running.delete(slug);
  return true;
}

// Poll until the instance answers HTTP (any status = the port is bound + serving).
export async function waitHealthy(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/cms`;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status > 0) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}
