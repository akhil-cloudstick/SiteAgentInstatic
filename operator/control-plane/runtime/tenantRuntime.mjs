// TenantRuntime — runs each tenant as a NATIVE Bun Instatic process (no Docker).
// The control-plane (Node) spawns `bun server/index.ts` with per-tenant env.
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../lib/env.mjs';

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
