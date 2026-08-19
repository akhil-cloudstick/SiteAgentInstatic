// SiteAgent control-plane HTTP API. Node built-ins + pg only.
// Wires Registry + Provisioner + Deployer + AI Gateway. The Astro console calls this.
import http from 'node:http';
import config from './lib/env.mjs';
import { migrate } from './registry/db.mjs';
import { getSettings, saveSettings, getSecrets, getDefaultGuidance, saveDefaultGuidance } from './registry/settings.mjs';
import * as tenantsRepo from './registry/tenants.mjs';
import { provisionTenant, deprovisionTenant, startTenant, resumeAll, editTenant, repairTenantCf, pointTestFunnel, createTenantInvite } from './provisioner/provision.mjs';
import { deployTenant, hasBakedOutput } from './deployer/deploy.mjs';
import { handleGateway } from './ai-gateway/gateway.mjs';
import { signTenantToken, verifyTenantToken, decrypt } from './lib/crypto.mjs';
import * as rt from './runtime/tenantRuntime.mjs';
import * as odrt from './runtime/odRuntime.mjs';
import { handleHub } from './hub/hub.mjs';
import { handleMcpGateway } from './mcp/gateway.mjs';
import * as mcpAgents from './registry/mcpAgents.mjs';
import { normalizePermissions, normalizeTables, PERMISSION_PRESETS } from './mcp/permissions.mjs';
import { pluginInstalled } from './mcp/session.mjs';
import { installBridge } from './mcp/bridgeInstall.mjs';
import { handleGatewayProxy, handleGatewayUpgrade } from './gateway/proxy.mjs';
import { openFunnel, closeFunnel } from './gateway/funnel.mjs';

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
  // Hub identity: `hub_activated` once the tenant has set a password. Until then the
  // console shows the pending invite link — decrypted from the stored token so the
  // SAME link stays valid across page views (no re-mint that would burn a shared copy).
  const hubActivated = row.hub_status === 'active';
  const inviteExpired = row.invite_expires_at && new Date(row.invite_expires_at) <= new Date();
  let inviteToken = null;
  if (!hubActivated && !inviteExpired && row.invite_token_enc) {
    try { inviteToken = decrypt(row.invite_token_enc); } catch { inviteToken = null; }
  }
  return {
    ...row,
    invite_token_enc: undefined, // never expose the at-rest blob to the client
    hub_activated: hubActivated,
    invite_url: inviteToken ? `${config.gatewayOrigin}/invite/${inviteToken}` : null,
    running: rt.isRunning(row.slug),
    od_running: odrt.isRunning(row.slug),
    published: hasBakedOutput(row.slug),
    admin_url: row.port ? `http://127.0.0.1:${row.port}/cms` : null,
    // One shared OD web serves every tenant; the tenant is resolved from the hub
    // session, so the reachable URL is the gateway's /od mount, not a per-tenant
    // localhost port. (The od_web_port column is legacy and no longer used.)
    od_url: row.od_port ? `${config.gatewayOrigin}/design` : null,
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
    // MCP gateway (external AI agents). Mounted ahead of the hub and the tenant
    // proxy: it authenticates with its own bearer key, not a hub session, so it
    // must never fall through to either.
    if (path.startsWith('/mcp/') && (await handleMcpGateway(req, res, method, path))) return;

    // Tenant Hub (login / invite / two-card home) — the HTML surface tenants use.
    if (await handleHub(req, res, method, path)) return;

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
    // ---- MCP agent keys (operator console) --------------------------------
    // Minting happens HERE, not in the tenant: the QuickJS sandbox has no
    // CSPRNG, and keeping every key in one registry means one revoke path.
    if (path === '/api/mcp/agents') {
      if (method === 'GET') {
        const tenant = new URL(req.url, 'http://x').searchParams.get('tenant');
        return send(res, 200, { agents: await mcpAgents.listAgentKeys(tenant || null) });
      }
      if (method === 'POST') {
        const b = await readJson(req);
        if (!b.tenantSlug) throw new Error('tenantSlug is required');
        const permissions = b.preset
          ? normalizePermissions(PERMISSION_PRESETS[b.preset])
          : normalizePermissions(b.permissions);
        if (permissions.length === 0) throw new Error('Grant at least one permission');
        const agent = await mcpAgents.createAgentKey({
          tenantSlug: b.tenantSlug,
          label: b.label,
          permissions,
          tables: normalizeTables(b.tables),
          expiresInDays: b.expiresInDays,
        });
        // `token` is present exactly once, here.
        return send(res, 200, { agent, endpoint: `${config.gatewayOrigin}/mcp/${b.tenantSlug}` });
      }
    }
    if (path === '/api/mcp/presets' && method === 'GET') {
      return send(res, 200, { presets: PERMISSION_PRESETS });
    }
    if (path === '/api/mcp/directory' && method === 'GET') {
      const [tenants, counts] = await Promise.all([
        tenantsRepo.listTenants(),
        mcpAgents.agentKeyCounts(),
      ]);
      const byTenant = new Map(counts.map((c) => [c.tenant_slug, c]));
      const rows = await Promise.all(
        tenants.map(async (t) => {
          const c = byTenant.get(t.slug);
          // Probing costs an SSO round-trip per tenant, so only ask a tenant
          // that could actually answer. A stopped or unprovisioned one reports
          // `null` (unknown) rather than a misleading "not installed".
          const reachable = t.status === 'active' && !!t.port;
          return {
            slug: t.slug,
            status: t.status,
            endpoint: `${config.gatewayOrigin}/mcp/${t.slug}`,
            activeKeys: c ? Number(c.active) : 0,
            totalKeys: c ? Number(c.total) : 0,
            lastUsed: c ? c.last_used : null,
            bridgeInstalled: reachable ? await pluginInstalled(t.slug).catch(() => false) : null,
          };
        }),
      );
      return send(res, 200, { tenants: rows });
    }
    if (path === '/api/mcp/audit' && method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const tenant = url.searchParams.get('tenant');
      if (!tenant) throw new Error('tenant is required');
      return send(res, 200, { events: await mcpAgents.listAgentAudit(tenant, url.searchParams.get('limit')) });
    }
    // Build the bridge package from source and install it into one tenant.
    // Zipping by hand and uploading through each tenant's admin UI does not
    // scale, so rollout is one call per site — and re-callable to upgrade.
    const mcpInstall = path.match(/^\/api\/mcp\/tenants\/([a-z0-9-]+)\/install-bridge$/);
    if (mcpInstall && method === 'POST') {
      return send(res, 200, await installBridge(mcpInstall[1]));
    }

    const mcpKey = path.match(/^\/api\/mcp\/agents\/([A-Za-z0-9_-]+)(?:\/(revoke|reveal))?$/);
    if (mcpKey) {
      const keyId = mcpKey[1];
      if (mcpKey[2] === 'revoke' && method === 'POST') {
        const agent = await mcpAgents.revokeAgentKey(keyId);
        if (!agent) return send(res, 404, { error: 'key not found or already revoked' });
        return send(res, 200, { agent });
      }
      if (mcpKey[2] === 'reveal' && method === 'GET') {
        const token = await mcpAgents.revealAgentKey(keyId);
        if (!token) return send(res, 404, { error: 'key not found or revoked' });
        return send(res, 200, { token });
      }
    }

    const m = path.match(/^\/api\/tenants\/([a-z0-9-]+)(?:\/(start|deploy|update|repair|expose|invite))?$/);
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
      if (action === 'invite' && method === 'POST') return send(res, 200, await createTenantInvite(slug));
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

    // Anything the control-plane didn't claim: reverse-proxy it to the right
    // backend — /od/<slug>/* to that tenant's OpenDesign, everything else to the
    // current hub session's Instatic (at root). Returns false if nothing matched.
    if (await handleGatewayProxy(req, res, method, path)) return;

    // A bare visit with no session lands on the tenant sign-in.
    if (method === 'GET' && path === '/') { res.writeHead(302, { location: '/login' }); return res.end(); }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[control-plane]', e.message);
    send(res, 400, { error: e.message });
  }
});

// WebSocket / upgrade passthrough so Next.js dev HMR and live editor bridges work
// through the gateway (best-effort; a failed upgrade just closes the socket).
server.on('upgrade', (req, socket, head) => {
  handleGatewayUpgrade(req, socket, head).catch(() => socket.destroy());
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
server.listen(config.controlPlanePort, '127.0.0.1', async () => {
  console.log(`[control-plane] listening on ${config.publicBaseUrl}`);
  console.log(`[control-plane] resumed instances: ${resumed.length ? resumed.join(', ') : '(none)'}`);
  console.log(`[gateway] public entry  : ${config.gatewayOrigin}  (funnel :${config.gatewayPort} -> 127.0.0.1:${config.controlPlanePort})`);
  console.log(`[gateway] tenant sign-in: ${config.gatewayOrigin}/login`);
  console.log(`[gateway] operator      : ${config.gatewayOrigin}/operator   (open — no login)`);
  // Open the funnel only now the gated server is up (never point it at ungated code).
  await openFunnel();
});

// --- graceful shutdown: stop tenant instances so none are orphaned ---
function shutdown() {
  console.log('\n[control-plane] shutting down; stopping tenant instances...');
  closeFunnel().catch(() => {}); // take the public gateway down first
  for (const r of rt.listRunning()) rt.stop(r.slug);
  // Also stop each tenant's OpenDesign (daemon + Next web), or they orphan and
  // keep holding their ports — the next boot's resume would then fail to rebind.
  for (const r of odrt.listRunning()) odrt.stop(r.slug);
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
