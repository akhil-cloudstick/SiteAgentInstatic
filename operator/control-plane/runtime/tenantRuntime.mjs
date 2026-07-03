// TenantRuntime — runs each tenant as a NATIVE Bun Instatic process (no Docker).
// The control-plane (Node) spawns `bun server/index.ts` with per-tenant env.
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';
import { signTenantToken } from '../lib/crypto.mjs';

const isWin = process.platform === 'win32';
const running = new Map(); // slug -> { child, port, pid, slug }

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

export const distDir = () => resolve(config.instaticDir, 'dist');

export function isRunning(slug) {
  return running.has(slug);
}

export function listRunning() {
  return [...running.values()].map((r) => ({ slug: r.slug, port: r.port, pid: r.pid }));
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
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    // CLIENT-TEST ONLY (see pending.md): trust the public test-funnel origin for
    // the CSRF check so the ONE tenant currently pointed at the funnel accepts a
    // remote client login. We use VITE_ALLOWED_ORIGIN (Instatic's dev-allowlist,
    // read into a static const at module load) rather than PUBLIC_ORIGIN because
    // running tenants from this mapped network drive makes Bun load
    // server/auth/security.ts twice — the request-time copy never sees the
    // configured publicOrigins, but the static DEV_ORIGIN_ALLOWLIST is identical
    // in both copies. See server/auth/security.ts.
    VITE_ALLOWED_ORIGIN: config.testFunnelOrigin,
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
  });
  // A child that fails to spawn (bad cwd, bun not found, EBUSY, killed) emits
  // an 'error' event. With NO listener Node re-throws it as an uncaught
  // exception — which crashed the whole control-plane every time a provision
  // hiccuped. Handle it: log, drop the record, and let the provision saga's
  // `waitHealthy` time out and report failure instead of taking the server down.
  child.on('error', (err) => {
    out.write(`\n[runtime] ${slug} spawn error: ${err?.message ?? err} @ ${new Date().toISOString()}\n`);
    running.delete(slug);
  });

  const rec = { child, port, pid: child.pid, slug };
  running.set(slug, rec);
  return rec;
}

export function stop(slug) {
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
  const url = `http://127.0.0.1:${port}/admin`;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status > 0) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}
