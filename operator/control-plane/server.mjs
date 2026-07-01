// SiteAgent control-plane HTTP API. Node built-ins + pg only.
// Wires Registry + Provisioner + Deployer + AI Gateway. The Astro console calls this.
import http from 'node:http';
import config from './lib/env.mjs';
import { migrate } from './registry/db.mjs';
import { getSettings, saveSettings } from './registry/settings.mjs';
import * as tenantsRepo from './registry/tenants.mjs';
import { provisionTenant, deprovisionTenant, startTenant, resumeAll } from './provisioner/provision.mjs';
import { deployTenant } from './deployer/deploy.mjs';
import { handleGateway } from './ai-gateway/gateway.mjs';
import { signTenantToken } from './lib/crypto.mjs';
import * as rt from './runtime/tenantRuntime.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Add the live runtime status + gateway token to a tenant row for the UI.
function decorate(row) {
  return {
    ...row,
    running: rt.isRunning(row.slug),
    admin_url: row.port ? `http://127.0.0.1:${row.port}/admin` : null,
    ai_base_url: `${config.publicBaseUrl}/ai/${signTenantToken(row.slug)}`,
  };
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const method = req.method;

  if (method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // AI gateway (instances call this; the key never leaves the control plane)
  if (path.startsWith('/ai/')) return handleGateway(req, res, path.slice(4));

  try {
    if (path === '/api/health') {
      return send(res, 200, { ok: true, running: rt.listRunning() });
    }
    if (path === '/api/settings') {
      if (method === 'GET') return send(res, 200, await getSettings());
      if (method === 'POST') return send(res, 200, await saveSettings(await readJson(req)));
    }
    if (path === '/api/tenants') {
      if (method === 'GET') {
        const rows = await tenantsRepo.listTenants();
        return send(res, 200, { tenants: rows.map(decorate) });
      }
      if (method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, await provisionTenant(body));
      }
    }
    const m = path.match(/^\/api\/tenants\/([a-z0-9-]+)(?:\/(start|deploy))?$/);
    if (m) {
      const slug = m[1];
      const action = m[2];
      if (!action && method === 'DELETE') return send(res, 200, await deprovisionTenant(slug));
      if (action === 'start' && method === 'POST') return send(res, 200, await startTenant(slug));
      if (action === 'deploy' && method === 'POST') return send(res, 200, await deployTenant(slug));
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[control-plane]', e.message);
    send(res, 400, { error: e.message });
  }
});

// --- resilience: a single tenant/child failure must never crash the whole
// control-plane. Without these guards an unhandled async error (e.g. a child
// process 'error' that slipped a listener) took the supervisor down mid-request,
// which is why provisioning intermittently killed the server. Log and stay up. ---
process.on('uncaughtException', (err) => {
  console.error('[control-plane] uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[control-plane] unhandledRejection (kept alive):', err);
});

// --- boot ---
await migrate();
const resumed = await resumeAll();
server.listen(config.controlPlanePort, '127.0.0.1', () => {
  console.log(`[control-plane] listening on ${config.publicBaseUrl}`);
  console.log(`[control-plane] resumed instances: ${resumed.length ? resumed.join(', ') : '(none)'}`);
});

// --- graceful shutdown: stop tenant instances so none are orphaned ---
function shutdown() {
  console.log('\n[control-plane] shutting down; stopping tenant instances...');
  for (const r of rt.listRunning()) rt.stop(r.slug);
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
