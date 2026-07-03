// SiteAgent control-plane HTTP API. Node built-ins + pg only.
// Wires Registry + Provisioner + Deployer + AI Gateway. The Astro console calls this.
import http from 'node:http';
import config from './lib/env.mjs';
import { migrate } from './registry/db.mjs';
import { getSettings, saveSettings, getSecrets, getDefaultGuidance, saveDefaultGuidance } from './registry/settings.mjs';
import * as tenantsRepo from './registry/tenants.mjs';
import { provisionTenant, deprovisionTenant, startTenant, resumeAll, editTenant, repairTenantCf, pointTestFunnel } from './provisioner/provision.mjs';
import { deployTenant, hasBakedOutput } from './deployer/deploy.mjs';
import { handleGateway } from './ai-gateway/gateway.mjs';
import { signTenantToken, verifyTenantToken } from './lib/crypto.mjs';
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
    published: hasBakedOutput(row.slug),
    admin_url: row.port ? `http://127.0.0.1:${row.port}/admin` : null,
    ai_base_url: `${config.publicBaseUrl}/ai/${signTenantToken(row.slug)}`,
  };
}

// Live OpenRouter model catalogue for the console picker, fetched with the
// operator's key. Returns [] until a key is saved (or on any upstream error) so
// the settings page still renders — it just shows no options yet.
async function listOpenrouterModels() {
  const { openrouterKey } = await getSecrets();
  if (!openrouterKey) return [];
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${openrouterKey}` },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.data || [])
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        // Tool-calling capability for the category picker (Codex #4). OpenRouter
        // lists it in supported_parameters; null = unknown metadata (UI warns
        // instead of hard-blocking). Routed chat categories need this true.
        toolCalling: Array.isArray(m.supported_parameters)
          ? m.supported_parameters.includes('tools')
          : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

// Reject categories whose model is KNOWN to lack tool-calling (routed chat
// categories always send tools) — server-side enforcement (Codex R2-#1). Models
// with unknown capability are allowed (the UI warns). If the catalogue can't be
// loaded (no key / upstream down) we can't verify, so we don't block.
async function enforceToolCapability(aiCategories) {
  if (!Array.isArray(aiCategories) || aiCategories.length === 0) return;
  const models = await listOpenrouterModels();
  if (!models.length) return;
  const cap = new Map(models.map((m) => [m.id, m.toolCalling]));
  for (const c of aiCategories) {
    if (c && typeof c === 'object' && cap.get(c.modelId) === false) {
      throw new Error(`model "${c.modelId}" for category "${c.slug || c.name}" does not support tool calling`);
    }
  }
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
      if (method === 'POST') {
        const bodyIn = await readJson(req);
        await enforceToolCapability(bodyIn.aiCategories); // throws -> 400
        return send(res, 200, await saveSettings(bodyIn));
      }
    }
    if (path === '/api/ai-guidance-default') {
      // The global AI guidance file (/rules/globalAiGuidanceRule.md), edited from
      // the console. GET reads it; POST overwrites it (the AI Gateway serves the
      // fresh text to every tenant's next message).
      if (method === 'GET') return send(res, 200, { guidance: getDefaultGuidance() });
      if (method === 'POST') {
        const b = await readJson(req);
        return send(res, 200, { guidance: saveDefaultGuidance(b.guidance ?? '') });
      }
    }
    if (path === '/api/models') {
      // Model picker source for the console: the live OpenRouter catalogue,
      // fetched with the operator's key. Empty until a key is saved.
      if (method === 'GET') return send(res, 200, { models: await listOpenrouterModels() });
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
    const m = path.match(/^\/api\/tenants\/([a-z0-9-]+)(?:\/(start|deploy|update|repair|expose))?$/);
    if (m) {
      const slug = m[1];
      const action = m[2];
      if (!action && method === 'DELETE') {
        const deleteCf = new URL(req.url, 'http://x').searchParams.get('cf') === '1';
        return send(res, 200, await deprovisionTenant(slug, { deleteCf }));
      }
      if (action === 'start' && method === 'POST') return send(res, 200, await startTenant(slug));
      if (action === 'deploy' && method === 'POST') return send(res, 200, await deployTenant(slug));
      if (action === 'update' && method === 'POST') return send(res, 200, await editTenant(slug, await readJson(req)));
      if (action === 'repair' && method === 'POST') return send(res, 200, await repairTenantCf(slug));
      if (action === 'expose' && method === 'POST') return send(res, 200, await pointTestFunnel(slug));
    }
    // Tenant-triggered deploy: a tenant's Instatic instance calls this (with its
    // signed token) right after an explicit Publish. The control-plane runs the
    // Cloudflare deploy with the operator's token — the token never leaves here.
    // Kicked off in the BACKGROUND so the tenant's Publish returns immediately;
    // progress + result land in the deploys registry (visible in the console).
    const dm = path.match(/^\/deploy\/(.+)$/);
    if (dm && method === 'POST') {
      const slug = verifyTenantToken(decodeURIComponent(dm[1]));
      if (!slug) return send(res, 401, { error: 'invalid tenant token' });
      deployTenant(slug).catch((e) => console.error(`[deploy] ${slug} failed:`, e.message));
      return send(res, 202, { accepted: true, slug });
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
